// Screen tabs (tabs.ts): a task in one tab at most; a plain click routed to the tab holding its task, or a new tab for a
// task open nowhere (the tab shown, if empty); ⌥ takes a task out of the other tabs; a tab shown again given back its
// tasks, their arrangement and the one in focus; a tab left kept so (each task remembered).
import { beforeEach, describe, expect, it } from "vitest";
import { MARKS, pressing, Tabs, type State, type TabsHooks } from "./tabs";
import type { Node } from "./tree";

let shown: string[],
  screen: Node | null,
  entered: [string[], string | null][],
  work: HTMLElement,
  remembered: string[][],
  now: Record<string, string>, // a key's key now (a lone item put in a task since)
  states: Record<string, State[]>, // each task's items' states
  faced: Set<string>; // the tasks with a face
function tabs(): Tabs {
  const hooks: TabsHooks = {
    shown: () => shown,
    focus: () => shown[0] || null,
    enter: async (tasks, focus) => {
      entered.push([tasks, focus]);
      shown = [...new Set([focus, ...tasks].filter((k): k is string => !!k))];
    },
    clear: async () => {
      shown = [];
    },
    remember: (k) => remembered.push(k),
    canon: (k) => now[k] ?? k,
    name: (k) => k.toUpperCase(),
    status: (k) => states[k] || [],
    faces: (k) => (faced.has(k) ? [Object.assign(document.createElement("img"), { alt: k })] : []),
    screen: () => screen,
    setScreen: (s) => (screen = s),
    hold: () => {},
    changed: () => {},
  };
  return new Tabs(work, hooks);
}
// the strip as drawn: each tab's name, the one shown marked
function strip(t: Tabs): string[] {
  t.draw();
  return [...work.querySelectorAll(".lay-tab")].map(
    (e) => `${e.querySelector(".lay-name")!.textContent}${e.getAttribute("aria-selected") === "true" ? " *" : ""}`,
  );
}
const ids = () => [...work.querySelectorAll<HTMLElement>(".lay-tab")].map((e) => e.dataset.id!);

beforeEach(() => {
  localStorage.clear();
  work = document.createElement("div");
  shown = ["a"];
  screen = null;
  entered = [];
  remembered = [];
  now = {};
  states = {};
  faced = new Set();
});

describe("screen tabs", () => {
  it("a new tab for what is shown next, the tab left kept with its tasks and their arrangement", async () => {
    const t = tabs();
    screen = { id: "a" };
    t.fresh();
    expect(screen).toBe(null);
    expect(remembered).toEqual([["a"]]); // each task left kept as it is
    shown = ["b"];
    expect(strip(t)).toEqual(["A", "B *"]);
    await t.route("a"); // a, in the first tab: that tab shown again, as it was left
    expect(entered).toEqual([[["a"], "a"]]);
    expect(screen).toEqual({ id: "a" });
    expect(strip(t)).toEqual(["A *", "B"]);
  });

  it("a plain click: open here, nothing; open nowhere, a tab of its own -- the tab shown, if it shows nothing", async () => {
    const t = tabs();
    expect(t.height()).toBe(40); // the bar, always
    await t.route("a"); // shown here: as it is
    expect(strip(t)).toEqual(["A *"]);
    await t.route("b"); // open nowhere: a new tab, a kept in its own
    shown = ["b"];
    expect(strip(t)).toEqual(["A", "B *"]);
    shown = [];
    await t.route("c"); // the tab shown showing nothing: c goes in it
    shown = ["c"];
    expect(strip(t)).toEqual(["A", "C *"]);
  });

  it("a tab left with a lone item, put in a task since, holds the task: a click on it brings the tab forward", async () => {
    const t = tabs();
    t.fresh(); // tab 1 left with a, alone
    shown = ["b"];
    now = { a: "T" }; // a put in task T since
    expect(t.where("T")).toEqual({ n: 1, here: false });
    expect(t.where("a")).toBe(null);
    await t.route("T");
    expect(entered).toEqual([[["T"], "T"]]); // shown by its key now
    expect(strip(t)).toEqual(["T *", "B"]);
  });

  it("kept as it changes, the tab shown is shown again on a reload, in place of what the page opened on", async () => {
    const t = tabs();
    await t.start(); // nothing kept yet: as it is
    expect(entered).toEqual([]);
    shown = ["a", "b"];
    t.draw(); // kept as it is now
    const again = tabs(); // the page reloaded, on the actor it opens on by itself
    shown = ["z"];
    expect(await again.start()).toBe(true);
    expect(entered).toEqual([[["a", "b"], "a"]]);
    expect(await again.start()).toBe(false); // once
  });

  it("where a task is open: its tab's number, and whether it is the tab shown", () => {
    const t = tabs();
    shown = ["a", "b"];
    t.fresh();
    shown = ["c"];
    expect(t.where("a")).toEqual({ n: 1, here: false });
    expect(t.where("c")).toEqual({ n: 2, here: true });
    expect(t.where("d")).toBe(null);
  });

  it("⌥: the task taken out of the tab holding it, a tab left with none closed", () => {
    const t = tabs();
    t.fresh(); // tab 1: a
    shown = ["b"];
    t.take("a"); // a, ⌥+clicked in tab 2: out of tab 1, which goes
    expect(strip(t)).toEqual(["B *"]);
    expect(t.where("a")).toBe(null);
  });

  it("keeps a task in one tab only: shown in another, it leaves the first, and a tab left with none goes", () => {
    const t = tabs();
    t.fresh(); // tab 1: a
    shown = ["a", "b"]; // a opened beside b in tab 2
    t.fresh(); // tab 2 kept with a and b: a leaves tab 1, left empty
    shown = ["c"];
    expect(strip(t)).toEqual(["A, B", "C *"]);
  });

  it('"+": a new tab, empty, the tab left kept with its tasks', async () => {
    const t = tabs();
    shown = ["a", "b"];
    await t.blank();
    expect(shown).toEqual([]);
    expect(strip(t)).toEqual(["A, B", "New tab *"]);
    await t.route("a"); // open in the first tab: brought forward
    expect(strip(t)).toEqual(["A, B *"]);
  });

  it("closing the tab shown shows the next first; the last one is not closed, nor has a ×", async () => {
    const t = tabs();
    t.fresh();
    shown = ["b"];
    strip(t);
    const [first, second] = ids();
    expect(work.querySelectorAll(".lay-close").length).toBe(2);
    await t.close(second); // the tab shown: the first shown again, then the second closed
    expect(shown).toEqual(["a"]);
    await t.close(first); // the only one: kept
    expect(shown).toEqual(["a"]);
    expect(strip(t)).toEqual(["A *"]);
    expect(work.querySelectorAll(".lay-close").length).toBe(0);
  });

  it("each task's state marked on its face, its most pressing item's; past three faces, or with none, after its name", () => {
    const t = tabs();
    const st = (mark: string, said: string): State => ({ mark, said });
    shown = ["a", "b", "c", "d", "e"];
    faced = new Set(["a", "b", "c", "d"]);
    states = {
      a: [st("", "Idle"), st("working", "Running"), st("finished", "Finished")], // done since looked: before at work
      b: [st("", "Idle")], // idle: no mark
      c: [st("background", "Background"), st("notified", "Notification")],
      d: [st("asking", "Waiting for you")], // past three faces: after the name
      e: [st("error", "Error")], // no face: after the name too
    };
    t.draw();
    const tab = work.querySelector<HTMLElement>(".lay-tab")!;
    const marks = [...tab.querySelectorAll<HTMLElement>(".lay-fmark")].map(
      (f) => `${f.querySelector("img")!.alt}:${f.querySelector<HTMLElement>(".lay-dot")?.dataset.status || ""}`,
    );
    expect(marks).toEqual(["a:finished", "b:", "c:notified"]);
    expect(tab.querySelector(".lay-more")!.textContent).toBe("+1");
    expect(tab.querySelector<HTMLElement>(":scope > .lay-dot")!.dataset.status).toBe("asking"); // d before e
    expect(tab.querySelector<HTMLElement>(".lay-fmark")!.title).toBe("A · Finished");
    expect(tab.title.split("\n")).toEqual([
      "A, B +3 · double-click to name it",
      "A · Finished",
      "B · Idle",
      "C · Notification",
      "D · Waiting for you",
      "E · Error",
    ]);
    states = {}; // nothing to mark: no mark after the name
    t.draw();
    expect(work.querySelector(".lay-tab > .lay-dot")).toBe(null);
  });

  it("marks ranked: what waits on the reader before what is at work", () => {
    expect(MARKS).toEqual(["asking", "error", "notified", "finished", "working", "background"]);
    expect(
      pressing([
        { mark: "working", said: "Running" },
        { mark: "finished", said: "Finished" },
      ]).said,
    ).toBe("Finished");
    expect(
      pressing([
        { mark: "", said: "Idle" },
        { mark: "", said: "Closed" },
      ]).said,
    ).toBe("Idle"); // none: the lead's
    expect(pressing([])).toEqual({ mark: "", said: "" });
  });
});
