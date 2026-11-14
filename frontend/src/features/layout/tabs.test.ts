// Screen tabs (tabs.ts): a task in one tab at most; a plain click routed to the tab holding its task, or a new tab for a
// task open nowhere (the tab shown, if empty); ⌥ takes a task out of the other tabs; a tab shown again given back its
// tasks, their arrangement and the one in focus; a tab left kept so (each task remembered).
import { beforeEach, describe, expect, it } from "vitest";
import { Tabs, type TabsHooks } from "./tabs";
import type { Node } from "./tree";

let shown: string[],
  screen: Node | null,
  entered: [string[], string | null][],
  work: HTMLElement,
  remembered: string[][],
  now: Record<string, string>, // a key's key now (a lone item put in a task since)
  dragging: string | null, // the task being dragged by its card head, if one can go to another tab
  carried: [string, string | null][]; // each let go on the bar: the task, the tab it goes in (null: a new one)
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
    status: () => "",
    screen: () => screen,
    setScreen: (s) => (screen = s),
    hold: () => {},
    changed: () => {},
    carried: () => dragging,
    carry: (k, to) => carried.push([k, to]),
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
  dragging = null;
  carried = [];
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

  it("a task put in a new tab: after the tab shown, or last; the tab shown stays; shown, the new tab opens it", async () => {
    const t = tabs();
    t.fresh();
    shown = ["b", "c", "d", "e"]; // tab 1: a; tab 2 (shown): b, c, d, e
    shown = ["b", "d", "e"]; // c closed here (the page's), then put
    t.put("c", null);
    expect(strip(t)).toEqual(["A", "B, D +1 *", "C"]);
    shown = ["b", "e"];
    t.put("d", null, true); // dropped on the bar: at its end
    shown = ["b"];
    t.put("e", null); // from the menu: after the tab shown
    expect(strip(t)).toEqual(["A", "B *", "E", "C", "D"]);
    await t.route("c"); // shown: c opened, in focus
    expect(entered).toEqual([[["c"], "c"]]);
    expect(strip(t)).toEqual(["A", "B", "E", "C *", "D"]);
  });

  it("a task put in another tab, last, that tab's focus kept; the tabs to go to, the others", async () => {
    const t = tabs();
    t.fresh();
    shown = ["b", "c", "d"];
    strip(t);
    const [first, second] = ids();
    expect(t.others()).toEqual([{ id: first, n: 1, name: "A" }]);
    shown = ["b", "d"];
    t.put("c", first);
    shown = ["b"];
    t.put("d", second); // the tab shown: no tab to go in -- a new one
    expect(strip(t)).toEqual(["A, C", "B *", "D"]);
    await t.show(first);
    expect(entered).toEqual([[["a", "c"], "a"]]);
  });

  it("a task dragged onto the bar: on another tab's name, into it; on the tab shown's, nowhere; elsewhere, a new tab", () => {
    const t = tabs();
    t.fresh();
    shown = ["b", "c"];
    strip(t);
    const [first] = ids();
    const drop = (on: Element): boolean => on.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    const chip = (i: number): Element => work.querySelectorAll(".lay-tab")[i];
    expect(drop(chip(0))).toBe(true); // nothing dragged: not taken
    dragging = "c";
    t.carrying(true);
    expect(work.querySelector<HTMLElement>(".lay-tab-ghost")!.hidden).toBe(false); // "New tab" shown
    expect(drop(chip(1))).toBe(true); // the tab shown's: nowhere
    expect(drop(chip(0))).toBe(false);
    expect(drop(work.querySelector(".lay-tab-add")!)).toBe(false);
    expect(carried).toEqual([
      ["c", first],
      ["c", null],
    ]);
    t.carrying(false);
    expect(work.querySelector<HTMLElement>(".lay-tab-ghost")!.hidden).toBe(true);
  });
});
