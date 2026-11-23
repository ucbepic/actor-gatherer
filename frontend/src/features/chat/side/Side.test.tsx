// The files and commands of a turn (side/): the files as a tree of their folders, the kinds switched in its legend, git's
// and the temporary folders' files left out until asked for, the commands with how they went and the files they
// touched; the bar the panel folds to; a file opened call by call.
import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { commandOf, sourceOf, turnFileOf } from "../../../core/api/testing";
import { Paths } from "./CallView";
import { FileView } from "./FileView";
import { cmdCounts, Side, SideBar, type SideProps } from "./Side";
import { useSide } from "./store";
import type { Command, FilesData, TurnFile } from "../types";

const ICONS = { sidebar: "M1 1", page: "M2 2", terminal: "M3 3", pulse: "M4 4", x: "M5 5" };
const file = (path: string, kinds: string[], over: Partial<TurnFile> = {}): TurnFile =>
  turnFileOf(path, { kinds, ...over });
const cmd = (text: string, over: Partial<Command> = {}): Command => commandOf(text, over);

const data = (files: TurnFile[], commands: Command[] = []): FilesData => ({
  turns: [],
  turn: 0,
  files,
  commands,
  home: "/home/u",
});

function side(over: Partial<SideProps> = {}) {
  const picked: (string | null)[] = [],
    folded: string[] = [];
  const props: SideProps = {
    actor: "g\0a",
    d: data([]),
    cwd: "/home/u/app",
    home: "/home/u",
    running: false,
    opening: false,
    sel: null,
    folded: new Set(),
    side: useSide.getState(),
    background: [],
    harnesses: {},
    icons: ICONS,
    pick: (p) => picked.push(p),
    fold: (p) => folded.push(p),
    foldSide: () => {},
    ...over,
  };
  const got = render(<Side {...props} side={useSide.getState()} />);
  return { ...got, picked, folded };
}

beforeEach(() => {
  localStorage.clear();
  useSide.setState({ hiddenKinds: new Set(["hit"]), showTmp: false, showGit: false, bgOpen: false });
});

describe("the files", () => {
  it("lists them as a tree, a chain of single folders as one row, the session's directory marked", () => {
    const { container } = side({
      d: data([
        file("/home/u/app/src/a.ts", ["edit"]),
        file("/home/u/app/src/b.ts", ["read"]),
        file("/etc/x", ["read"]),
      ]),
    });
    const rows = [...container.querySelectorAll(".fl-dir, .fl-file")].map((n) => n.querySelector(".name")!.textContent);
    expect(rows).toEqual(["/", "etc/", "x", "~/app/", "src/", "a.ts", "b.ts"]);
    expect(container.querySelector(".fl-dir .wd")!.textContent).toBe("cwd");
    expect(container.querySelector(".fl-h > span")!.textContent).toBe("3 files");
    expect(container.querySelector(".fl-wd .p")!.textContent).toBe("~/app");
  });

  it("leaves out the kinds switched off, and says why none is left", () => {
    const { container } = side({ d: data([file("/a/hit.ts", ["hit"])]) });
    expect(container.querySelector(".fl-file")).toBeNull();
    expect(container.querySelector(".fv-note")!.textContent).toBe("Only 1 file of the kinds turned off below.");
    const hits = [...container.querySelectorAll(".fl-kinds .kind")].find((b) => b.textContent === "search hit")!;
    expect(hits.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(hits);
    expect(useSide.getState().hiddenKinds.has("hit")).toBe(false);
    expect(JSON.parse(localStorage.getItem("ag-dashboard-files-hidden-kinds")!)).toEqual([]);
  });

  it("leaves out the temporary folders' and git's files until asked for", () => {
    const { container, unmount } = side({
      d: data([file("/tmp/t.txt", ["write"], { temporary: true }), file("/a/g.ts", [], { git: ["edit"] })]),
    });
    expect(container.querySelector(".fv-note")!.textContent).toBe("Only 1 file git changed.");
    expect(container.querySelector("label.tmp")!.textContent).toBe("tmp (1)");
    expect(container.querySelector(".fl-kinds .kind:last-child")!.textContent).toBe("by git (1)");
    act(() => useSide.getState().setGit(true));
    unmount();
    const again = side({
      d: data([file("/tmp/t.txt", ["write"], { temporary: true }), file("/a/g.ts", [], { git: ["edit"] })]),
    });
    expect([...again.container.querySelectorAll(".fl-file .name")].map((n) => n.textContent)).toEqual(["g.ts"]);
  });

  it("picks a file by a click, and folds a folder", () => {
    const f = file("/home/u/app/a.ts", ["edit"], { changed: [3, 1] });
    const { container, picked, folded } = side({ d: data([f]) });
    expect(container.querySelector(".fl-file .chg")!.textContent).toBe("+3−1");
    fireEvent.click(container.querySelector(".fl-file")!);
    fireEvent.click(container.querySelector(".fl-dir")!);
    expect(picked).toEqual(["/home/u/app/a.ts"]);
    expect(folded).toEqual(["/home/u/app"]);
    const opened = side({ d: data([f]), sel: f, folded: new Set(["/home/u/app"]) });
    expect(opened.container.querySelector(".fl-dir .n")!.textContent).toBe("1"); // folded: its count
    expect(opened.container.querySelector(".fl-file")).toBeNull();
  });
});

describe("the commands", () => {
  it("lists each call with how it went, its line, and the files it touched", () => {
    const commands = [
      cmd("ls", { error: true }),
      cmd("sleep 9", { running: true }),
      cmd("edit a", { files: ["/home/u/app/a.ts"], did: { "/home/u/app/a.ts": ["edit"] } }),
    ];
    const { container, picked } = side({ d: data([], commands), running: true });
    expect(container.querySelector(".cmds-sec .fl-h")!.textContent).toBe("3 commands · 1 failed");
    expect([...container.querySelectorAll(".fl-cmd > .g")].map((n) => n.className)).toEqual(["g err", "g run", "g ok"]);
    expect(container.querySelector("#fl-0-c1 summary")!.textContent).toBe("2sleep 9");
    fireEvent.click(container.querySelector(".fl-cmd-files button")!);
    expect(picked).toEqual(["/home/u/app/a.ts"]);
    expect(cmdCounts(commands, false)).toEqual({ ok: 2, err: 1, run: 0 });
  });

  it("says when there are none, and lists what runs in the background once opened", () => {
    const bg = [{ id: "b1", kind: "monitor", label: "watch the logs", started: 100, output: "/tmp/out" }];
    const { container } = side({ background: bg });
    expect(container.querySelector(".cmds-sec .fv-note")!.textContent).toBe("No commands in this turn.");
    const head = container.querySelector<HTMLElement>(".bg-sec > .fl-h")!;
    expect(head.textContent).toBe("▶1 background task running");
    fireEvent.click(head);
    expect(useSide.getState().bgOpen).toBe(true);
  });
});

describe("the bar the panel folds to", () => {
  it("counts the files by kind and the commands by how they went, and opens the panel", () => {
    let opened = 0;
    const files = [file("/a", ["edit"], { changed: [2, 0] }), file("/b", ["read", "edit"])];
    const { container } = render(
      <SideBar
        files={files}
        counts={{ ok: 2, err: 1, run: 0 }}
        background={0}
        hiddenKinds={new Set(["hit"])}
        icons={ICONS}
        foldSide={(f) => (opened += f ? 0 : 1)}
        acts={null}
      />,
    );
    const bar = container.querySelector("button.fl-bar")!;
    expect(bar.getAttribute("aria-label")).toBe(
      "Show the files and commands: 2 files: 1 read, 2 edited; 2 lines added, 0 removed · 3 commands: 2 passed, 1 failed",
    );
    fireEvent.click(bar);
    expect(opened).toBe(1);
  });
});

describe("a file opened", () => {
  it("lists the calls that touched it, the last opened, each with what it did", () => {
    const f = file("/home/u/app/a.ts", ["read", "edit"], {
      sources: [
        sourceOf({ via: "Read a.ts", kinds: ["read"], blocks: [{ t: "lines", start: 1, lines: ["one", "two"] }] }),
        sourceOf({
          via: "Edit a.ts",
          kind: "edit",
          kinds: ["edit"],
          blocks: [{ t: "diff", at: 2, old: ["two"], new: ["2"] }],
          checked: true,
        }),
      ],
    });
    const { container } = render(
      <Paths value={{ cwd: "/home/u/app", home: "/home/u" }}>
        <FileView f={f} path="a.ts" id="fl-0-0" gatherer="g" showGit={false} close={() => {}} icons={ICONS} />
      </Paths>,
    );
    const calls = container.querySelectorAll<HTMLDetailsElement>("details.fv-call");
    expect([...calls].map((c) => c.open)).toEqual([false, true]);
    expect(calls[1].querySelector(".what")!.textContent).toBe("edited · checked");
    expect([...calls[0].querySelectorAll(".ln .no")].map((n) => n.textContent)).toEqual(["1", "2"]);
    expect([...calls[1].querySelectorAll(".ln .mk")].map((n) => n.textContent)).toEqual(["−", "+"]);
  });
});
