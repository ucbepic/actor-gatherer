// A minimized pane's lines and card, worked out (model.ts): the user's last message and what the actor does now, or how
// its turn ended; whether the turn is over as Chat shows it; a turn's steps in order; the latest turn's commands.
import { describe, expect, it } from "vitest";
import { callRunOf, commandOf, currentOf, failingOf, replyOf } from "../../../core/api/testing";
import { chatView, turn } from "../testing";
import type { Command, FilesData } from "../types";
import { finalAtOf, latestCommands, linesOf, plainLine, restOf, stepsOf, stoppedWords, type MiniOf } from "./model";

const MARKS = { asking: ["ask", "?"], error: ["err", "!"], failed: ["err", "!"] } as const;
const of = (over: Partial<MiniOf> = {}): MiniOf => ({
  turns: [],
  view: null,
  files: null,
  mine: [],
  viewAtWork: false,
  running: false,
  status: "idle",
  marks: MARKS,
  ...over,
});
const cmd = (text: string, over: Partial<Command> = {}): Command => commandOf(text, over);

describe("a minimized pane's lines", () => {
  it("are none before a turn or a message sent", () => {
    expect(linesOf(of())).toBeNull();
  });

  it("say the user's last message and what the actor said last, its turn over: its check", () => {
    const t = turn(1, { replies: [replyOf({ kind: "text", text: "**Done** with `x`" })] });
    const m = of({ turns: [turn(0), t], view: chatView([turn(0), t]) });
    const [you, now] = linesOf(m)!;
    expect(you).toMatchObject({ kind: "you", icon: { kind: "you" }, text: ["Ask 1"], ago: t.at });
    expect(now).toMatchObject({
      kind: "now reply",
      icon: { kind: "done", turn: t },
      text: ["Done with x"],
      ago: t.end,
    });
    expect(restOf(m)).toBe(t);
  });

  it("say what waits to reach the agent, and a message sent being opened", () => {
    const mine = [{ cid: "page:1", text: "go on", at: 1 }];
    const [you, now] = linesOf(of({ mine }))!;
    expect(you).toMatchObject({ kind: "you pending", text: [{ sub: "Pending ·" }, "go on"] });
    expect(now).toMatchObject({ kind: "now quiet", icon: { kind: "me", alt: "history" } });
    expect(restOf(of({ turns: [turn(0)], mine }))).toBeNull(); // something sent: not over
  });

  it("say what the actor does at work: its latest call, thinking, retrying, or what it said", () => {
    const at = turn(1, { last: callRunOf("npm test", { running: true }), replies: [], began: 99 });
    const working = (over = {}) =>
      chatView([turn(0), at], { current: currentOf({ state: "working", turn: 1, ...over }) });
    const live = linesOf(of({ turns: [turn(0), at], view: working(), viewAtWork: true }))![1];
    expect(live).toMatchObject({ kind: "now live", extra: "", icon: { alt: "spin" }, since: 99 });
    expect(live.text).toEqual([{ dot: "run" }, { call: at.last }]);
    const thinking = turn(1, { replies: [], now: { kind: "thinking" } });
    expect(
      linesOf(
        of({ turns: [thinking], view: chatView([thinking], { current: currentOf({ state: "working", turn: 0 }) }) }),
      )![1].text,
    ).toEqual(["Thinking…"]);
    expect(linesOf(of({ turns: [turn(0), at], view: working({ failing: failingOf({ at: 1 }) }) }))![1].text).toEqual([
      "Retrying…",
    ]);
    const said = turn(1, { replies: [replyOf({ kind: "text", text: "Looking" })] });
    const saying = linesOf(of({ turns: [said], running: true }))![1];
    expect([saying.extra, saying.text]).toEqual([" said", ["Looking"]]);
  });

  it("say an asking actor waits for the reader, a stopped turn how it stopped, an error its mark", () => {
    const t = turn(0, { stopped: { kind: "interrupted" }, calls: 2 });
    const asking = linesOf(
      of({ turns: [t], view: chatView([t], { current: currentOf({ state: "asking", turn: 0 }) }) }),
    )![1];
    expect(asking).toMatchObject({ kind: "now ask", icon: { kind: "me", mark: ["ask", "?"], alt: "ask" } });
    const stopped = linesOf(
      of({ turns: [t], view: chatView([t], { current: currentOf({ state: "stopped", turn: 0 }) }) }),
    )![1];
    expect(stopped).toMatchObject({ kind: "now quiet", text: ["Interrupted"] });
    const failed = linesOf(of({ turns: [turn(0, { replies: [] })], status: "error" }))![1];
    expect(failed).toMatchObject({ icon: { kind: "me", mark: ["err", "!"], alt: "stop" }, text: ["Done"] });
    expect(stoppedWords({ kind: "error", text: "429\nmore" })).toBe("Stopped: 429");
    expect(plainLine("# Title\nrest")).toBe("Title");
  });
});

describe("a turn's steps", () => {
  it("puts its messages among its commands by their place, its last message left for its reply", () => {
    const t = turn(0, {
      replies: [
        { kind: "text", text: "First", after: 1 },
        { kind: "thinking", texts: [], after: 1 },
        { kind: "report", text: "Report", name: "sub", after: 2 },
        { kind: "text", text: "Last", after: 3 },
      ],
    });
    const cmds = [cmd("a"), cmd("b"), cmd("c")];
    const finalAt = finalAtOf(t, false);
    expect(finalAt).toBe(3);
    const steps = stepsOf(t, cmds, finalAt).map((s) => ("r" in s ? s.r.text : s.c.text));
    expect(steps).toEqual(["a", "First", "b", "Report", "c"]);
    expect(finalAtOf(t, true)).toBe(-1); // at work: its last message may not be its last
  });

  it("takes the latest turn's commands from the files feed once it has that turn", () => {
    const t = turn(1, { calls: 2 });
    const files: FilesData = { turns: [turn(0), t], turn: 1, files: [], commands: [cmd("x")], home: "/h" };
    expect(latestCommands(files, 2, t)).toEqual([cmd("x")]);
    expect(latestCommands({ ...files, turn: 0 }, 2, t)).toBeNull(); // not that turn yet
    expect(latestCommands(null, 2, turn(1, { calls: 0 }))).toEqual([]);
  });
});
