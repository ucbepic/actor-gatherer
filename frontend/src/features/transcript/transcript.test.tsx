// The Transcript view (blocks.ts, calls.tsx, TranscriptView.tsx, mount.tsx) and its feed (data.ts): which blocks, how a
// call is shown, the frame drawn by its mount, and its events loaded a page at a time.
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { key } from "../../core/model/keys";
import { transcriptBlocks, type Part, type TxItem } from "./blocks";
import { callLine, diffRows, patchRows, permissionNode, summary } from "./calls";
import { loadTranscript, txFeedOf, useTxFeed } from "./data";
import { drawTranscript, foldedOutputNode, notesSwitchNode, transcriptBlockNodes } from "./mount";
import { useNotes, type TxFrame } from "./TranscriptView";

const ev = (row_id: number | null, ...parts: Part[]): TxItem => ({ row_id, parts });
const call = (id: string, view: Record<string, unknown> = { shape: "shell", command: `run ${id}` }): Part => ({
  kind: "call",
  id,
  name: "Bash",
  text: "",
  input: {},
  view,
});
const result = (id: string, text = "done", error = false): Part => ({ kind: "result", id, text, error });

afterEach(() => {
  document.body.replaceChildren();
  useNotes.setState({ on: false });
  useTxFeed.setState({ feed: null });
  vi.unstubAllGlobals();
});

describe("the transcript's blocks", () => {
  it("draws each call with its result wherever it was stored, the latest stretch's at work while the actor is", () => {
    const items = [
      ev(1, { kind: "text", role: "user", text: "go" }),
      ev(2, call("a"), call("b")),
      ev(3, result("a")),
      ev(4, { kind: "text", role: "assistant", text: "**done**" }),
      ev(5, call("c")),
    ];
    const blocks = transcriptBlocks(items, true, false);
    expect(blocks.map((b) => [b.kind, b.key])).toEqual([
      ["user", "tx-r1-0"],
      ["call", "tx-r2-0-l"],
      ["call", "tx-r2-1-l"],
      ["text", "tx-r4-0"],
      ["call", "tx-r5-0-l"],
    ]);
    const [, a, b, , c] = blocks as Extract<(typeof blocks)[number], { kind: "call" }>[];
    expect([a.result?.text, b.result, a.running, c.running]).toEqual(["done", null, false, true]);
  });

  it("folds a stretch's earlier calls behind '+N more', and thinking into a line of its own", () => {
    const calls = Array.from({ length: 8 }, (_, i) => call(`c${i}`));
    const blocks = transcriptBlocks([ev(1, { kind: "thinking", text: "hmm" }, ...calls)], false, false);
    expect(blocks.map((b) => b.kind)).toEqual(["more", "call", "call", "call", "call", "call"]);
    expect(blocks[0]).toMatchObject({ key: "tx-r1-0-more" });
    expect((blocks[0] as { lines: { kind: string }[] }).lines.map((l) => l.kind)).toEqual([
      "think",
      "call",
      "call",
      "call",
    ]);
    // thinking alone, and encrypted thinking left out
    expect(
      transcriptBlocks(
        [ev(1, { kind: "thinking", text: "  " }), ev(2, { kind: "thinking", text: "why" })],
        false,
        false,
      ),
    ).toMatchObject([{ kind: "think", id: "tx-r2-0", text: "why" }]);
  });

  it("shows the system messages and ag's notes only when asked, a run of them as one block", () => {
    const items = [ev(1, { kind: "note", name: "ag", text: "a\nb" }, { kind: "text", role: "system", text: "sys" })];
    expect(transcriptBlocks(items, false, false)).toEqual([]);
    expect(transcriptBlocks(items, false, true)).toMatchObject([
      { kind: "notes", id: "tx-n-tx-r1-0", notes: [{ name: "ag" }, { name: "system" }] },
    ]);
  });

  it("draws a result whose call is not loaded alone, and a pending event by where it is", () => {
    expect(transcriptBlocks([ev(null, result("x", "out", true))], false, false)).toEqual([
      { kind: "result", key: "tx-p0-0", id: "tx-p0-0", text: "out", error: true },
    ]);
  });
});

describe("a call as it is shown", () => {
  it("by its shape, its paths from the directory", () => {
    const read = summary({ name: "Read", view: { shape: "read", title: "Read", path: "/w/a.py", offset: 3 } }, "/w");
    expect([read.title, read.arg]).toEqual(["Read", "a.py (from line 3)"]);
    const sh = summary({
      name: "Bash",
      view: { shape: "shell", title: "Bash", command: "ls\nmore", description: "List" },
    });
    expect([sh.arg, sh.note, callLine(sh)]).toEqual(["ls", "List", "List"]);
    expect(summary({ name: "mcp__files__read_it", input: { path: "x", n: 2 } })).toEqual({
      title: "files · read_it",
      arg: "path: x, n: 2",
    });
    const script = summary({
      name: "exec",
      calls: [{ name: "Read", input: {}, view: { shape: "read", path: "a" } }, { name: "x" }],
    });
    expect(script.arg).toBe("a + 1 more call");
  });

  it("a change as lines out and in, two lines of context either side; a patch by its lines' marks", () => {
    expect(diffRows("a\nb\nc\nd\ne", "a\nb\nc\nX\ne")).toEqual({
      rows: [
        ["ctx", "  b"],
        ["ctx", "  c"],
        ["del", "- d"],
        ["add", "+ X"],
        ["ctx", "  e"],
      ],
      added: 1,
      removed: 1,
    });
    expect(patchRows("*** Update File: a\n@@ x\n-old\n+new\n same").map(([c]) => c)).toEqual([
      "hunk",
      "hunk",
      "del",
      "add",
      "ctx",
    ]);
  });

  it("a result folded to its first lines; a permission's call with its command", () => {
    const folded = foldedOutputNode("1\n2\n3\n4\n5\n6", "r1");
    expect(folded.matches("details#r1")).toBe(true);
    expect(folded.querySelector(".more")!.textContent).toBe("… +2 lines (click to expand)");
    expect(foldedOutputNode("", "r2").textContent).toBe("(no output)");
    const perm = permissionNode(
      { tool: "Bash", view: { shape: "shell", title: "Bash", command: "rm -rf x" }, said: "Clean" },
      "p",
    );
    expect(perm.matches("div.perm")).toBe(true);
    expect(perm.querySelector(".qline")!.textContent).toBe("Clean");
    expect(perm.querySelector("pre.perm-cmd .sh-t")!.textContent).toBe("rm -rf x");
    const odd = permissionNode({ tool: "Odd", input: { a: 1 } }, "q");
    expect(odd.querySelector("pre.perm-input")!.textContent).toBe('{\n  "a": 1\n}');
  });
});

const frame = (over: Partial<TxFrame> = {}): TxFrame => ({
  key: key("demo", "c1"),
  items: [],
  pending: [],
  earlier: false,
  running: false,
  failing: null,
  last: null,
  cwd: "",
  background: null,
  queued: [],
  noneYet: "No messages yet.",
  loadEarlier: () => {},
  ...over,
});

describe("the view, drawn by its mount", () => {
  it("is the frame of the page's chat card, with the line of a turn at work and what waits", () => {
    const loadEarlier = vi.fn();
    const node = drawTranscript(
      frame({
        items: [ev(1, { kind: "text", role: "user", text: "hi" })],
        running: true,
        last: 5,
        earlier: true,
        queued: ["next"],
        loadEarlier,
      }),
      "Transcript",
    );
    expect(node.matches("div.chat-frame.term#chat-list[role=log][data-keep=chat-list][data-follow]")).toBe(true);
    expect(node.getAttribute("aria-label")).toBe("Chat history, Transcript");
    expect(node.querySelector(".status-line")!.textContent).toContain("Working…");
    expect(node.querySelector(".status-line [data-ago]")!.getAttribute("data-ago")).toBe("5");
    expect(node.querySelector(".queued")!.textContent).toBe("Waiting for the turn to end: next");
    fireEvent.click(node.querySelector("button.earlier")!);
    expect(loadEarlier).toHaveBeenCalled();
    const again = drawTranscript(frame(), "Transcript");
    expect(again).toBe(node);
    expect(node.querySelector(".desc")!.textContent).toBe("No messages yet.");
  });

  it("keeps a block from one draw to the next while it is the same", () => {
    const items = [ev(1, call("a"))];
    const node = drawTranscript(frame({ items }), "Transcript");
    const line = node.querySelector(".call-line")!;
    drawTranscript(frame({ items: [...items, ev(2, result("a"))] }), "Transcript");
    expect(node.querySelector(".call-line")).toBe(line);
    expect(line.querySelector(".g")!.className).toBe("g dot-ok");
  });

  it("gives the reader's own views its blocks and its switch, as nodes", () => {
    const nodes = transcriptBlockNodes([ev(1, { kind: "text", role: "user", text: "hi" })], false);
    expect(nodes.map((n) => n.className)).toEqual(["user"]);
    const sw = notesSwitchNode();
    document.body.append(sw);
    fireEvent.click(sw.querySelector("input")!);
    expect(useNotes.getState().on).toBe(true);
  });
});

describe("the feed", () => {
  it("loads the newest at first, then what came since, a page at a time, and earlier ones as asked", async () => {
    const asked: string[] = [];
    const pages: Record<string, unknown> = {
      "": { items: [ev(5, call("a")), ev(6), ev(null)], earlier: true, newest: true },
      "&after=6": { items: [ev(7), ev(8)], newest: false },
      "&after=8": { items: [ev(9), ev(null, { kind: "text", text: "pending" })], newest: true },
      "&before=5": { items: [ev(3), ev(4)], earlier: false },
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const q = url.replace(/^.*channel=c1/, "");
      asked.push(q);
      return new Response(JSON.stringify(pages[q]));
    });
    const actor = key("demo", "c1");
    await loadTranscript(actor);
    expect(txFeedOf(actor)).toMatchObject({ first_row: 5, last_row: 6, earlier: true });
    expect(txFeedOf(actor)!.pending).toHaveLength(1);
    await loadTranscript(actor);
    expect(txFeedOf(actor)!.items.map((i) => i.row_id)).toEqual([5, 6, 7, 8, 9]);
    expect(txFeedOf(actor)!.pending[0].parts[0].text).toBe("pending");
    await loadTranscript(actor, true);
    expect(txFeedOf(actor)!.items.map((i) => i.row_id)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(txFeedOf(actor)).toMatchObject({ first_row: 3, earlier: false });
    expect(asked).toEqual(["", "&after=6", "&after=8", "&before=5"]);
    expect(txFeedOf(key("demo", "c2"))).toBeNull();
  });
});
