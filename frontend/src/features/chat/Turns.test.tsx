// The Chat view's turns as the page draws them: which turns, folded or whole, their replies, the actor at work or done
// under the latest, what was opened or waits since -- and what stays from draw to draw: its node, the actor's stage, the
// folds a click made.
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sizesForTests } from "../../core/ui/lists";
import { loadVendored } from "../../core/ui/testing";
import { chatOf } from "./actors";
import { useSide } from "./side/store";
import { useTurns } from "./store";
import { ACTOR, AT, chatView, now, testPage, turn, withTurns } from "./testing";

const NOW = AT + 3600;
const turns = (n: number) => Array.from({ length: n }, (_, i) => turn(i));
/** The turns drawn: each in its item box of the list (react-virtuoso's). */
const drawnTurns = (node: HTMLElement) => [...node.querySelectorAll(".fl-item > .fl-turn")];
const ids = (node: HTMLElement) => drawnTurns(node).map((t) => t.id);

beforeAll(() => loadVendored());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("Turns", () => {
  it("draws the latest turns, the earlier counted above them, those before the latest two answered folded", () => {
    const { page } = testPage(turns(8));
    const node = page.draw();
    expect(node.className).toBe("fl-talk fl-list");
    expect(node.querySelector(".fl-top > .fl-earlier")!.textContent).toBe("3 earlier turns · scroll up for more");
    expect(ids(node)).toEqual(["fl-turn-3", "fl-turn-4", "fl-turn-5", "fl-turn-6", "fl-turn-7"]);
    expect(drawnTurns(node).map((t) => t.className)).toEqual([
      "fl-turn folded",
      "fl-turn folded",
      "fl-turn folded",
      "fl-turn",
      "fl-turn on",
    ]);
    // an earlier turn's message a button, folding or showing it; the latest's not
    const folded = node.querySelector("#fl-turn-4 .fl-head > .fl-user")!;
    expect(folded.tagName).toBe("BUTTON");
    expect(folded.getAttribute("aria-expanded")).toBe("false");
    expect(folded.getAttribute("title")).toBe("Show this turn's replies. ⌘+click: show this turn's files and commands");
    expect(node.querySelector("#fl-turn-4 .fl-reply")).toBeNull();
    const shown = node.querySelector("#fl-turn-6 .fl-head > .fl-user")!;
    expect(shown.getAttribute("title")).toBe(
      "Fold this turn to your message. ⌘+click: show this turn's files and commands",
    );
    const latest = node.querySelector("#fl-turn-7 .fl-head > .fl-user")!;
    expect(latest.tagName).toBe("DIV");
    expect(latest.getAttribute("title")).toBe("⌘+click: show this turn's files and commands");
    expect(latest.querySelector(".fold-mark")).toBeNull();
    expect(latest.querySelector(".fl-count")!.textContent).toBe("1 message");
    const main = node.querySelector<HTMLDetailsElement>("#fl-m-7-0")!;
    expect(main.open).toBe(true);
    expect(main.querySelector(".md")!.textContent!.trim()).toBe("Answer 7");
    // over: the actor done under it, and short of height, how long it took
    expect(node.querySelector("#fl-turn-7 .fl-finished .fl-times")!.textContent).toBe("took 5s");
    expect(node.querySelector(".fl-foot > .fl-done > .done")!.getAttribute("data-sig")).toBe(
      '["rest","animal/fox",107]',
    );
    expect(node.querySelector(".fl-foot > .fl-done")!.getAttribute("title")).toBe("Done · 10m ago");
  });

  it("keeps its node, and the actor's stage while it shows the same, from draw to draw", () => {
    const { page } = testPage(turns(3));
    const node = page.draw();
    const stage = node.querySelector(".fl-done > .done")!;
    expect(page.draw(withTurns(turns(3)))).toBe(node);
    expect(node.querySelector(".fl-done > .done")).toBe(stage);
    // the stage put its next moment in its place meanwhile: that one is compared, and kept
    const next = stage.cloneNode(true) as HTMLElement;
    stage.replaceWith(next);
    page.draw();
    expect(node.querySelector(".fl-done > .done")).toBe(next);
    // a new turn: another stage
    page.draw(withTurns(turns(4)));
    expect(node.querySelector(".fl-done > .done")).not.toBe(next);
    expect(node.querySelectorAll(".fl-done").length).toBe(1);
  });

  it("shows an earlier turn's replies on a click on its message, kept as turns come; the setting picked again starts over", () => {
    const { page } = testPage(turns(5));
    const node = page.draw();
    const message = () => node.querySelector<HTMLElement>("#fl-turn-1 .fl-head > .fl-user")!;
    act(() => message().click());
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn shown");
    expect(message().getAttribute("aria-expanded")).toBe("true");
    expect(node.querySelector("#fl-m-1-0")).not.toBeNull();
    page.draw(withTurns(turns(6)));
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn shown");
    useTurns.getState().clearFlips();
    page.draw();
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn folded");
    // under "Whole", every turn shown; a click folds one
    page.draw({ earlierTurns: "whole" });
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn");
    act(() => message().click());
    expect(node.querySelector("#fl-turn-1")!.className).toBe("fl-turn folded");
  });

  it("shows a turn's earlier messages behind its +, and folds them again by its −", () => {
    const replies = [0, 1, 2, 3].map((i) => ({ kind: "text", text: `on the way ${i}` }));
    const { page } = testPage([turn(0, { replies: [...replies, { kind: "text", text: "Done." }] })]);
    const node = page.draw();
    const more = () => node.querySelector<HTMLButtonElement>("#fl-turn-0 .fl-more")!;
    expect(more().textContent).toBe("+2 earlier messages");
    expect(more().getAttribute("aria-expanded")).toBe("false");
    expect([...node.querySelectorAll("#fl-turn-0 .fl-minor > details")].map((d) => d.id)).toEqual([
      "fl-r-0-2",
      "fl-r-0-3",
    ]);
    act(() => more().click());
    expect(more().textContent).toBe("−2 earlier messages");
    expect(more().getAttribute("title")).toBe("Fold earlier messages");
    expect(node.querySelectorAll("#fl-turn-0 .fl-minor > details").length).toBe(4);
    act(() => more().click());
    expect(node.querySelectorAll("#fl-turn-0 .fl-minor > details").length).toBe(2);
  });

  it("keeps the latest reply folded by a click across draws; another files feed starts the folds over", () => {
    const { page } = testPage(turns(2));
    const node = page.draw();
    const main = () => node.querySelector<HTMLDetailsElement>("#fl-m-1-0")!;
    act(() => {
      main().open = false;
      fireEvent(main(), new Event("toggle"));
    });
    expect(useTurns.getState().closed.has("fl-m-1-0")).toBe(true);
    page.draw(withTurns(turns(2)));
    expect(main().open).toBe(false);
    expect(main().hasAttribute("open")).toBe(false);
    page.draw({ files: {} });
    expect(main().open).toBe(true);
  });

  it("draws what a turn's agent thought, its notes, and its latest call while nothing followed it", () => {
    const t = turn(0, {
      replies: [
        { kind: "thinking", texts: ["**Plan**: read the file", "then answer"] },
        { kind: "thinking", texts: [] },
        { kind: "report", text: "It's 42.", name: "counter" },
        { kind: "peer", text: "Hello from there\nmore", name: "Bob" },
      ],
      last: {
        id: "c1",
        text: "ls -la",
        call: { input: { command: "ls -la" }, view: { shape: "shell", command: "ls -la" } },
        running: false,
        error: true,
        output: "denied",
      },
    });
    const { page } = testPage([t]);
    const node = page.draw();
    const thought = node.querySelector("#fl-r-0-0")!;
    expect(thought.className).toBe("fl-reply thought");
    expect(thought.querySelector(".lbl")!.textContent).toBe("Thought:");
    expect(thought.querySelector(".first")!.textContent).toBe("Plan: read the file");
    expect(node.querySelector("#fl-r-0-1")).toBeNull(); // encrypted: nothing to read
    const report = node.querySelector("#fl-r-0-2")!;
    expect(report.className).toBe("fl-reply noted report");
    expect(report.querySelector(".lbl")!.textContent).toBe("Subagent's report:");
    expect(report.querySelector(".first")!.textContent).toBe("counter");
    const peer = node.querySelector("#fl-r-0-3")!;
    expect(peer.querySelector(".lbl")!.textContent).toBe("Message from Bob:");
    expect(peer.querySelector(".first")!.textContent).toBe("Hello from there");
    const call = node.querySelector("#fl-c-0-c1")!;
    expect(call.querySelector("summary")!.textContent).toBe("●Failed:ls -la");
    expect(call.querySelector(".dot")!.className).toBe("dot err");
    expect(call.querySelector(".cv.err pre.out")!.textContent).toBe("denied");
    expect(node.querySelector(".fl-count")!.getAttribute("title")).toBe("3 messages from the agent, 0 commands");
  });

  it("says how the latest call is: running, waiting for the user, stopped, or ran", () => {
    const words = (state: "working" | "asking" | "done", running: boolean) => {
      const ts = [turn(0, { replies: [], last: { id: "x", text: "sleep 9", running } })];
      const { page } = testPage(ts, { view: chatView(ts, { current: now(ts, state) }) });
      return page.draw().querySelector("#fl-c-0-x summary .lbl")!.textContent;
    };
    expect(words("working", true)).toBe("Running:");
    expect(words("asking", true)).toBe("Waiting for you:");
    expect(words("done", true)).toBe("Stopped:");
    expect(words("done", false)).toBe("Ran:");
  });

  it("draws the actor at work under a running turn, from the view: the line under it, its stage below", () => {
    const at = turn(1, { at: NOW - 120, began: NOW - 125, work: { doing: "read" } });
    const ts = [turn(0), at];
    const { page } = testPage(ts, {
      view: chatView(ts, { current: now(ts, "working") }),
      info: { ...ACTOR, last: NOW - 3 },
      canInterrupt: true,
    });
    const node = page.draw();
    const line = node.querySelector("#fl-turn-1 .fl-working")!;
    expect(line.querySelector(".fl-times")!.textContent).toBe(
      "last activity 3s ago · 2m 05s so far · esc to interrupt", // from when its message was sent
    );
    expect(line.querySelector("[data-ago]")!.getAttribute("data-ago")).toBe(String(NOW - 3));
    expect(line.querySelector(".now")!.textContent).toBe("Working…");
    expect(line.querySelector(".fl-mini img")!.getAttribute("src")).toBe("/avatars/animal/fox.svg?bare=1");
    const status = node.querySelector(".fl-foot > .fl-status")!;
    expect([...status.children].map((c) => c.className)).toEqual(["stage-box", "now"]);
    expect(status.firstElementChild!.getAttribute("data-sig")).toBe('["work","animal/fox",{"doing":"read"}]');
    expect(node.querySelector(".fl-done")).toBeNull();
    expect(node.querySelector("#fl-turn-1 .fl-finished")).toBeNull();
    // thinking; its calls failing; Esc sent
    const thinking = [turn(0), { ...at, now: { kind: "thinking" } }];
    page.draw(withTurns(thinking, { current: now(thinking, "working") }));
    expect(status.querySelector(".now")!.textContent).toBe("Thinking…");
    page.draw(withTurns(ts, { current: now(ts, "working", { failing: { at: NOW - 7 } }) }));
    expect(node.querySelector("#fl-turn-1 .fl-times")!.textContent).toMatch(/^last try 7s ago/);
    expect(status.querySelector(".now")!.textContent).toBe("Retrying…");
    page.draw({ interrupting: true });
    expect(status.querySelector(".now")!.textContent).toBe("Interrupting…");
  });

  it("draws nothing at work nor done before the view has come", () => {
    const { page } = testPage(turns(2), { view: null });
    const node = page.draw();
    expect(ids(node)).toEqual(["fl-turn-0", "fl-turn-1"]); // the files feed's turns
    expect(node.querySelector(".fl-working, .fl-status, .fl-done")).toBeNull();
  });

  it("ends the Esc sent once the view has the latest turn no longer at work", () => {
    const ts = turns(2);
    const { page } = testPage(ts, { view: chatView(ts, { current: now(ts, "working") }), interrupting: true });
    page.draw();
    expect(chatOf(page.feed.key).interrupting).not.toBeNull();
    page.draw({ view: chatView(ts, { current: now(ts, "stopped") }) });
    expect(chatOf(page.feed.key).interrupting).toBeNull();
  });

  it("keeps an Esc sent while a message sent from here opens the turn", () => {
    const mine = [{ cid: "p1", text: "And now?", at: NOW * 1000 }];
    const { page } = testPage(turns(2), { interrupting: true, mine });
    page.draw();
    expect(chatOf(page.feed.key).interrupting).not.toBeNull();
    page.draw({ mine: [] }); // taken back: the view has the turn before done
    expect(chatOf(page.feed.key).interrupting).toBeNull();
  });

  it("draws a turn sent and not stored yet, at work; the turn stored in its place counts from when it was sent", () => {
    const ts = turns(2);
    const opening = { text: "And now?", cid: "p1", began: NOW - 30, seen: true };
    const { page } = testPage(ts, { view: chatView(ts, { opening, current: { state: "opening", turn: "opening" } }) });
    const node = page.draw();
    const opened = node.querySelector(".fl-foot > .fl-turn.opened")!;
    expect(opened.querySelector(".fl-user")!.getAttribute("title")).toBe("Sent to the agent");
    expect(opened.querySelector(".fl-times")!.textContent).toBe("last activity 30s ago · 30s so far");
    expect(node.querySelector(".fl-foot")!.lastElementChild!.className).toBe("fl-status");
    expect(node.querySelector("#fl-turn-1 .fl-working, .fl-done")).toBeNull(); // the latest stored: not at work
    // stored, at a later time: still from when it was sent
    const stored = [...ts, turn(2, { text: "And now?", at: NOW - 10, began: NOW - 30, cid: "p1" })];
    page.draw(withTurns(stored, { current: now(stored, "working") }));
    expect(node.querySelector(".fl-turn.opened")).toBeNull();
    expect(node.querySelector("#fl-turn-2 .fl-times")!.textContent).toBe("last activity 30s ago · 30s so far");
  });

  it("grows the turn a message opens in, and the turn stored in its place on from there", () => {
    const ts = turns(1);
    const { page } = testPage(ts);
    const node = page.draw({ mine: [{ cid: "p9", text: "And now?", at: NOW * 1000 }] });
    const opened = node.querySelector<HTMLElement>(".fl-foot > .fl-turn.opened")!;
    expect(opened.classList.contains("fl-in")).toBe(true);
    expect(opened.style.getPropertyValue("--in")).toBe("-0ms");
    vi.setSystemTime(NOW * 1000 + 100);
    const stored = [...ts, turn(1, { text: "And now?", cid: "p9", began: NOW })];
    page.draw({ mine: [], ...withTurns(stored, { current: now(stored, "working") }) });
    const t = node.querySelector<HTMLElement>("#fl-turn-1")!;
    expect([t.classList.contains("fl-in"), t.style.getPropertyValue("--in")]).toEqual([true, "-100ms"]);
    vi.setSystemTime(NOW * 1000 + 1000);
    page.draw(withTurns(stored)); // grown: drawn as any turn, its box kept
    expect(node.querySelector("#fl-turn-1")).toBe(t);
  });

  it("opens the turn of a message sent from here to an actor not at work, before the view has it", () => {
    const { page } = testPage(turns(1));
    expect(page.draw().querySelector(".fl-done")).not.toBeNull();
    const node = page.draw({ mine: [{ cid: "p1", text: "And now?", at: NOW * 1000 }] });
    expect(node.querySelector(".fl-done")).toBeNull();
    expect(node.querySelector(".fl-foot > .fl-turn.opened .tx")!.textContent).toBe("And now?");
    expect(node.querySelector(".fl-turn.opened .fl-times")!.textContent).toBe("last activity 0s ago · 0s so far");
    expect(node.querySelector(".fl-pending")).toBeNull();
  });

  it("says a turn sent and stopped before the harness recorded it is interrupted, not at work", () => {
    const ts = turns(1);
    const opening = { text: "Hello", cid: "p1", began: NOW - 2, seen: false, stopped: { kind: "interrupted" } };
    const { page } = testPage(ts, {
      view: chatView(ts, { opening, current: { state: "stopped", turn: "opening", stopped: opening.stopped } }),
      interrupting: true,
    });
    const node = page.draw();
    const opened = node.querySelector(".fl-foot > .fl-turn.opened")!;
    expect(opened.querySelector(".fl-stopped")!.textContent).toBe("⎿Interrupted");
    expect(node.querySelector(".fl-working, .fl-status")).toBeNull();
    expect(chatOf(page.feed.key).interrupting).toBeNull(); // the Esc sent is over
  });

  it("draws what waits for the agent's next step at the latest turn's end", () => {
    const ts = turns(1);
    const waiting = [
      { text: "queued one", how: "queued" as const },
      { text: "in its queue", how: "dashboard" as const },
    ];
    const { page } = testPage(ts, {
      view: chatView(ts, { current: now(ts, "working"), waiting }),
      mine: [{ cid: "p1", text: "sent here", at: NOW * 1000 - 1000 }], // at work: it waits too
    });
    const node = page.draw();
    const pending = node.querySelector("#fl-turn-0 > .fl-pending")!;
    expect([...pending.querySelectorAll(".fl-user .tx")].map((t) => t.textContent)).toEqual([
      "queued one",
      "in its queue",
      "sent here",
    ]);
    expect(pending.querySelector(".lbl")!.textContent).toBe("Pending");
    expect(node.querySelector(".fl-turn.opened")).toBeNull();
  });

  it("says a sent message is not seen by the session for long, and the way to its terminal", () => {
    const ts = turns(1);
    const opening = { text: "And now?", cid: "p1", began: NOW - 20, seen: false, unseen: true };
    const { page, host } = testPage(ts, {
      info: { ...ACTOR, session: { status: "terminal", terminal: { cols: 80 } } },
      view: chatView(ts, { opening, current: { state: "opening", turn: "opening" } }),
    });
    const node = page.draw();
    const opened = node.querySelector(".fl-foot > .fl-turn.opened")!;
    expect(opened.querySelector(".lbl")!.textContent).toBe(
      "Not received by the session yet. Its terminal may be asking something first. Open the terminal",
    );
    expect(opened.querySelector(".fl-working")).toBeNull();
    act(() => opened.querySelector<HTMLButtonElement>(".to-term")!.click());
    expect(host.calls).toContainEqual(["setChatView", "terminal"]);
  });

  it("stacks what was written mid-turn on the turn's message", () => {
    const t = turn(0, { more: [{ text: "Also this.", kind: "mid_turn" }] });
    const { page } = testPage([t, turn(1, { more: [{ text: "And that.", kind: "user", cid: "p2" }] })]);
    const node = page.draw();
    const joined = node.querySelector("#fl-turn-0 > .fl-user.joined")!;
    expect(joined.tagName).toBe("BUTTON");
    expect(joined.getAttribute("title")).toBe(
      "Sent while the agent was working. Fold this turn to your message. ⌘+click: show this turn's files and commands",
    );
    expect(node.querySelector("#fl-turn-1 > .fl-user.joined")!.textContent).toBe("And that.");
  });

  it("shows a turn's files and commands by its button: the side unfolded, the turn picked", async () => {
    const { page, host } = testPage(turns(3));
    const node = page.draw();
    await act(async () => node.querySelector<HTMLElement>("#fl-turn-0 .fl-side-btn")!.click());
    expect(host.calls).toContainEqual(["foldSide", page.feed.key, false]);
    expect(host.calls).toContainEqual(["setFilesTurn", page.feed.key, 0]);
    // the latest, its files shown: folded again
    act(() => useSide.setState({ folded: false, narrow: false }));
    page.draw();
    const btn = node.querySelector<HTMLElement>("#fl-turn-2 .fl-side-btn")!;
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.getAttribute("title")).toBe("Fold this turn's files and commands");
    await act(async () => btn.click());
    expect(host.calls).toContainEqual(["foldSide", page.feed.key, true]);
  });

  it("says how a turn stopped short, unless the actor's error note says it", () => {
    const stopped = { kind: "error", text: "overloaded" };
    const { page } = testPage([turn(0, { stopped: { kind: "interrupted" } }), turn(1, { stopped })], {
      home: {
        home: "/h",
        now: AT,
        gatherers: [],
        harness_info: { h1: { stopped: { lead: "■", interrupted: "Stopped by you", error: "Error" } } },
      },
      earlierTurns: "whole",
    });
    const node = page.draw();
    expect(node.querySelector("#fl-turn-0 .fl-stopped")!.textContent).toBe("■Stopped by you");
    expect(node.querySelector("#fl-turn-1 .fl-stopped.error")!.textContent).toBe("■overloaded");
    page.draw({ info: { ...ACTOR, status: "error" } });
    expect(node.querySelector("#fl-turn-1 .fl-stopped")).toBeNull();
  });

  it("says the latest turn stopped as the view has it, before the harness's record says", () => {
    const ts = turns(2);
    const { page } = testPage(ts, {
      view: chatView(ts, { current: now(ts, "stopped", { stopped: { kind: "interrupted" } }) }),
    });
    const node = page.draw();
    expect(node.querySelector("#fl-turn-1 .fl-stopped")!.textContent).toBe("⎿Interrupted");
    expect(node.querySelector(".fl-foot > .fl-done")).not.toBeNull();
  });
});

describe("a long conversation", () => {
  it("lists every turn from the first drawn, and puts on the page only those around the view", () => {
    const tall = sizesForTests.now;
    sizesForTests.now = { viewportHeight: 400, itemHeight: 40 }; // the box 10 turns tall
    try {
      const { page } = testPage(turns(1000), { picked: 0 }); // the first turn picked: all from it on in the list
      const node = page.draw();
      const shown = ids(node);
      expect(shown[0]).toBe("fl-turn-0");
      expect(shown.length).toBeGreaterThan(10); // the box's and more around it
      expect(shown.length).toBeLessThan(200);
      expect(node.querySelector("#fl-turn-999")).toBeNull();
      expect(node.querySelector(".fl-earlier")).toBeNull(); // none earlier: all are in the list
      expect(node.querySelector("#fl-turn-0")!.className).toBe("fl-turn on folded"); // picked: its files shown
    } finally {
      sizesForTests.now = tall;
    }
  });

  it("says how many earlier turns are not in the list, above the first", () => {
    const { page } = testPage(turns(1000));
    const node = page.draw();
    expect(ids(node)).toEqual(["fl-turn-995", "fl-turn-996", "fl-turn-997", "fl-turn-998", "fl-turn-999"]);
    expect(node.querySelector(".fl-top > .fl-earlier")!.textContent).toBe("995 earlier turns · scroll up for more");
  });
});

describe("before the first turn", () => {
  it("draws the actor waving hello and saying its line", () => {
    const { page } = testPage([]);
    const node = page.draw();
    expect(node.className).toBe("fl-talk hi");
    expect(node.dataset.keep).toBeUndefined();
    const hello = node.querySelector(":scope > .fl-hello")!;
    expect(hello.firstElementChild!.getAttribute("data-sig")).toBe('["hello","animal/fox"]');
    expect(hello.querySelector(".fl-say.verse")!.innerHTML).toBe("Hi, I'm Fox.<br>Ready when you are.");
    page.draw({ session: { status: "starting" } });
    expect(hello.lastElementChild!.outerHTML).toBe("<div>Starting the agent…</div>");
    page.draw({ session: { status: "terminal" }, writable: false });
    expect(hello.lastElementChild!.textContent).toBe("No messages yet.");
    page.draw({ writable: true, info: { ...ACTOR, avatar: null } });
    expect(hello.innerHTML).toBe("<div>No messages yet. Write one below.</div>");
  });

  it("draws the first message as the turn it opens, the moment it is sent", () => {
    const { page } = testPage([], { mine: [{ cid: "p1", text: "Hello there", at: NOW * 1000 }] });
    const node = page.draw();
    expect(node.className).toBe("fl-talk");
    expect(node.querySelector(".fl-hello")).toBeNull();
    expect(node.querySelector(":scope > .fl-turn.opened .tx")!.textContent).toBe("Hello there");
    expect(node.lastElementChild!.className).toBe("fl-status");
    // the view has it: the same turn, from it
    const opening = { text: "Hello there", cid: "p1", began: NOW, seen: true };
    page.draw({ mine: [], view: chatView([], { opening, current: { state: "opening", turn: "opening" } }) });
    expect(node.querySelector(":scope > .fl-turn.opened .tx")!.textContent).toBe("Hello there");
  });

  it("draws what waits before the first turn above the actor", () => {
    const { page } = testPage([], { view: chatView([], { waiting: [{ text: "in its queue", how: "dashboard" }] }) });
    const node = page.draw();
    expect(node.querySelector(":scope > .fl-turn > .fl-pending .tx")!.textContent).toBe("in its queue");
    expect(node.querySelector(".fl-hello")!.children.length).toBe(1); // the actor, no line
  });
});

describe("a turn that fails to draw", () => {
  it("says so in its place, the other turns drawn; and is drawn once its turn changes", () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = turn(1, { more: 5 as unknown as [] }); // not a list: its messages written meanwhile cannot be drawn
    const { page } = testPage([turn(0), bad, turn(2)], { earlierTurns: "whole" });
    const node = page.draw();
    expect(node.querySelector("#fl-turn-1 > .warn")!.textContent).toMatch(/^This turn could not be drawn: /);
    expect(node.querySelector("#fl-turn-0 .fl-user .tx")!.textContent).toBe("Ask 0");
    expect(node.querySelector("#fl-turn-2 .fl-user .tx")!.textContent).toBe("Ask 2");
    expect(said).toHaveBeenCalled();
    const fixed = [turn(0), turn(1), turn(2)];
    page.draw(withTurns(fixed));
    expect(node.querySelector("#fl-turn-1 > .warn")).toBeNull();
    expect(node.querySelector("#fl-turn-1 .fl-user .tx")!.textContent).toBe("Ask 1");
    said.mockRestore();
  });
});
