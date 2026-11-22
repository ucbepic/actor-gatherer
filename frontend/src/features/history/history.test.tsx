// The History view: its tree and rows (tree.ts), and the view drawn by its mount (mount.tsx) -- rows selected by click,
// shift and ⌘, Esc clearing them, the panel at the right, a message opened to its whole text, the outline loaded a page
// at a time (data.ts).
import { act, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../core/api/query";
import { key } from "../../core/model/keys";
import { sizesForTests } from "../../core/ui/lists";
import { loadOutline, outlineKey, outlineOf, setHistHost, useAsked } from "./data";
import { drawHistory } from "./mount";
import { useHist } from "./store";
import {
  buildTree,
  marked,
  rangeOf,
  ranges,
  selState,
  visibleRows,
  withRows,
  type Outline,
  type OutlineEvent,
} from "./tree";

// jsdom lays nothing out: the list (react-virtuoso) takes its box as tall as a few hundred rows, each 40px
sizesForTests.now = { viewportHeight: 20_000, itemHeight: 40 };

const ev = (row_id: number, type: string, text = type, channel = "c1"): OutlineEvent => ({
  row_id,
  channel,
  type,
  text,
  tokens: 10,
  at: 100 + row_id,
});

const EVENTS = [
  ev(1, "system", "setup"),
  ev(2, "user_message", "first ask"),
  ev(3, "tool_call", "ls"),
  ev(4, "agent_message", "done one"),
  ev(5, "user_message", "second ask"),
  ev(6, "agent_message", "done two"),
];

const outline = (over: Partial<Outline> = {}): Outline => ({
  key: key("demo", "c1"),
  gatherer: "demo",
  channel: "c1",
  events: EVENTS,
  tasks: [],
  builds: { c1: { status: "done", since: 2, build_id: null } },
  last: 6,
  more: false,
  error: "",
  loaded: true,
  ...over,
});

const ALL = () => true;

describe("the history as a tree", () => {
  it("is turns under one task of their own, without tasks; each turn its messages", () => {
    const { tree, byId } = buildTree(outline());
    const task = tree[0].children[0];
    expect(task.whole).toBe(true);
    expect(task.children.map((t) => [t.n, t.ask, t.rows])).toEqual([
      [0, "", [1]],
      [1, "first ask", [2, 3, 4]],
      [2, "second ask", [5, 6]],
    ]);
    expect(byId.get("t:c1:-2:1")!.reply).toBe("done one");
  });

  it("splits by tasks from their first rows, the last one current", () => {
    const tasks = [
      { channel: "c1", name: "Setup", first_row: 1 },
      { channel: "c1", name: "Work", first_row: 5 },
    ];
    const { tree } = buildTree(outline({ tasks }));
    expect(tree[0].children.map((k) => [k.task?.name, k.current, k.rows])).toEqual([
      ["Setup", false, [1, 2, 3, 4]],
      ["Work", true, [5, 6]],
    ]);
  });

  it("lists the turns holding a type shown, opened to their messages; grouped, each task's row first", () => {
    const { tree } = buildTree(outline({ tasks: [{ channel: "c1", name: "All", first_row: 1 }] }));
    const users = (r: number) => [2, 5].includes(r);
    const flat = visibleRows(tree, false, new Set(["t:c1:0:1"]), users, null);
    expect(flat.rows.map((r) => [r.key, r.depth])).toEqual([
      ["t:c1:0:1", 1],
      ["m:2", 2],
      ["t:c1:0:2", 1],
    ]);
    expect(flat.tops.map((n) => n.id)).toEqual(["t:c1:0:1", "t:c1:0:2"]);
    const grouped = visibleRows(tree, true, new Set(), ALL, null);
    expect(grouped.rows.map((r) => r.key)).toEqual(["k:c1:0"]);
    // searching: only what matches
    expect(visibleRows(tree, false, new Set(), ALL, new Map([[6, "two"]])).rows.map((r) => r.key)).toEqual([
      "t:c1:0:2",
    ]);
  });

  it("selects as text is selected: a row's all, a range of rows, runs for the server", () => {
    const { tree, byId } = buildTree(outline());
    const { rows } = visibleRows(tree, false, new Set(), ALL, null);
    const flat = rows.map((r) => r.key);
    const sel = withRows(rangeOf(flat, flat[1], flat[2], byId), new Map(), byId);
    expect([...sel.keys()]).toEqual([2, 3, 4, 5, 6]);
    expect(sel.get(3)).toEqual(["c1", 10]);
    expect(selState(byId.get(flat[1])!, sel)).toBe("all");
    expect(selState(byId.get(flat[0])!, sel)).toBe("none");
    expect(selState(byId.get(flat[1])!, new Map([[2, ["c1", 1] as const]]))).toBe("some");
    expect(ranges([6, 2, 3, 4, 9])).toEqual([
      [2, 4],
      [6, 6],
      [9, 9],
    ]);
    expect(marked("Probe probe", "PRO")).toEqual([
      { text: "", hit: false },
      { text: "Pro", hit: true },
      { text: "be ", hit: false },
      { text: "pro", hit: true },
      { text: "be", hit: false },
    ]);
  });
});

const ACTOR = key("demo", "c1");
const page = { actor: ACTOR, home: null, cwd: "/w", harness: null, icons: { x: "M0 0" }, now: 1000 };

function drawn(h: Outline = outline()) {
  queryClient.setQueryData(outlineKey(ACTOR), h);
  const node = drawHistory(page, "History");
  document.body.append(node);
  return node;
}
const rows = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>(".h-row")];
const press = (row: Element, opts: MouseEventInit = {}) => {
  fireEvent.mouseDown(row.querySelector(".h-main")!, { button: 0, ...opts });
  fireEvent.mouseUp(document);
};

afterEach(() => {
  document.body.replaceChildren();
  queryClient.clear();
  useHist.setState({
    sel: new Map(),
    open: new Set(),
    last: null,
    panel: false,
    q: "",
    query: "",
    gatherer: null,
    actor: null,
  });
  vi.unstubAllGlobals();
});

describe("the view, drawn by its mount", () => {
  it("says it loads until the actor's outline is in, then lists its turns of the types shown", () => {
    queryClient.setQueryData(outlineKey(ACTOR), outline({ loaded: false }));
    const node = drawHistory(page, "History");
    expect(node.matches("div.chat-frame.hist#chat-list")).toBe(true);
    expect(node.textContent).toBe("Loading…");
    drawn();
    expect(rows(node).map((r) => r.dataset.key)).toEqual(["t:c1:-2:1", "t:c1:-2:2"]);
    expect(node.querySelector(".h-group")!.textContent).toBe("Group by tasks");
    expect(node.querySelector(".h-types-btn")!.textContent).toBe("ShowUser, Assistant▾");
    expect(node.querySelector(".h-build")!.textContent).toBe("No tasks yet · 2 user messages");
  });

  it("selects rows by click, shift-click and ⌘-click, the panel showing what; Esc clears them", () => {
    const node = drawn();
    const [one, two] = rows(node);
    act(() => press(one));
    expect(one.classList.contains("on")).toBe(true);
    expect(node.querySelector(".h-side.open .h-picked")!.textContent).toBe("3 messages · about 30 tokens");
    act(() => press(two, { shiftKey: true }));
    expect(rows(node).every((r) => r.classList.contains("on"))).toBe(true);
    act(() => press(one, { metaKey: true }));
    expect([one.classList.contains("on"), two.classList.contains("on")]).toEqual([false, true]);
    act(() => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(rows(node).some((r) => r.classList.contains("on"))).toBe(false);
    expect(node.querySelector(".h-side.closed")).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document.body, { key: "a", metaKey: true });
    });
    expect(useHist.getState().sel.size).toBe(5);
  });

  it("opens a turn to its messages, and a message to its whole text, fetched once", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return new Response(
        JSON.stringify({ items: [{ name: "user_message", text: "first ask, in full", clipped: 3 }] }),
      );
    });
    const node = drawn();
    act(() => fireEvent.click(rows(node)[0].querySelector(".h-tw")!));
    expect(rows(node).map((r) => r.dataset.key)).toEqual(["t:c1:-2:1", "m:2", "m:4", "t:c1:-2:2"]);
    act(() => fireEvent.click(rows(node)[1].querySelector(".h-tw")!));
    await waitFor(() =>
      expect(node.querySelector(".h-full")!.textContent).toBe("first ask, in full\n… 3 more characters not shown"),
    );
    expect(asked).toEqual(["/api/history?gatherer=demo&channel=c1&from=2&to=2"]);
  });
});

describe("a long history", () => {
  const long = (turns: number) =>
    Array.from({ length: turns * 2 }, (_, i) =>
      ev(i + 1, i % 2 ? "agent_message" : "user_message", i % 2 ? `answer ${i >> 1}` : `ask ${i >> 1}`),
    );

  it("lists every row, puts only those around the view on the page, and marks where the timeline begins", () => {
    const tall = sizesForTests.now;
    sizesForTests.now = { viewportHeight: 400, itemHeight: 40 }; // the list 10 rows tall
    try {
      const node = drawn(outline({ events: long(3000), more: true }));
      const shown = rows(node);
      expect(node.querySelector(".h-list")!.hasAttribute("tabindex")).toBe(false); // no tab stop of its own
      expect(shown.length).toBeGreaterThan(10);
      expect(shown.length).toBeLessThan(200);
      expect(shown[0].className).toBe("h-row turn nested first");
      expect(shown[1].className).toBe("h-row turn nested");
      expect(node.querySelector(".h-row.last")).toBeNull(); // the last of 3,000: not on the page
      // ⌘A selects every row listed, not those on the page
      act(() => {
        fireEvent.keyDown(document.body, { key: "a", metaKey: true });
      });
      expect(useHist.getState().sel.size).toBe(6000);
    } finally {
      sizesForTests.now = tall;
    }
  });

  it("draws Load more under the last row while the outline is not all loaded", () => {
    const node = drawn(outline({ more: true }));
    const [first, last] = rows(node);
    expect([first.classList.contains("first"), last.classList.contains("last")]).toEqual([true, true]);
    expect(node.querySelector(".h-foot > .h-more")!.textContent).toBe("Load more");
  });
});

describe("the outline", () => {
  it("loads all at first, a page at a time, then only what came after", async () => {
    const pages: Record<string, unknown> = {
      "0": { events: EVENTS.slice(0, 3), tasks: [], builds: {}, more: true },
      "3": { events: EVENTS.slice(3), tasks: [], builds: {}, more: false },
      "6": { events: [ev(7, "user_message", "third")], tasks: [], builds: {}, more: false },
    };
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/extracts")) return new Response("[]");
      const after = /after=(\d+)/.exec(url)![1];
      asked.push(after);
      return new Response(JSON.stringify(pages[after]));
    });
    await loadOutline(ACTOR);
    expect(outlineOf(ACTOR)).toMatchObject({ last: 6, loaded: true, more: false });
    await loadOutline(ACTOR);
    expect(outlineOf(ACTOR)!.events.map((e) => e.row_id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(asked).toEqual(["0", "3", "6"]);
  });

  it("asks for a build once the view opens on an actor due one, and loads its tasks as it starts", async () => {
    setHistHost({ shown: () => true, paused: () => true });
    const asked: string[] = [];
    let built = false;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push(init?.method === "POST" ? `POST ${url}` : url.replace(/\?.*after=/, " after="));
      if (url.includes("/api/extracts")) return new Response("[]");
      if (url.includes("/api/history/build")) return new Response(JSON.stringify({ started: (built = true) }));
      const status = built ? "running" : "done";
      return new Response(
        JSON.stringify({ events: [], tasks: [], builds: { c1: { status, since: 12 } }, more: false }),
      );
    });
    await loadOutline(ACTOR);
    await waitFor(() => expect(outlineOf(ACTOR)!.builds.c1.status).toBe("running"));
    await loadOutline(ACTOR); // not held by the ask's own load
    expect(asked).toEqual([
      "/api/outline after=0",
      "/api/extracts?gatherer=demo",
      "POST /api/history/build",
      "/api/outline after=0",
      "/api/outline after=0",
    ]);
    expect(useAsked.getState()).toMatchObject({ askedFor: ACTOR, built: { for: ACTOR, started: true } });
    setHistHost({ shown: () => false, paused: () => false });
  });
});
