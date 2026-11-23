// Screen tabs (tabs.ts): a task in one tab at most; a plain click routed to the tab holding its task, or a new tab for a
// task open nowhere (the tab shown, if empty); ⌥ takes a task out of the other tabs; a tab shown again given back its
// tasks, their arrangement and the one in focus; a tab left kept so (each task remembered).
import { beforeEach, describe, expect, it } from "vitest";
import type { CellLook } from "./tab-map";
import * as M from "./model";
import { shadow } from "./shadow";
import { MARKS, pressing, Tabs, type State, type TabsHooks } from "./tabs";
import type { Node, Rect } from "./tree";

let shown: string[],
  screen: Node | null,
  entered: [string[], string | null][],
  work: HTMLElement,
  remembered: string[][],
  now: Record<string, string>, // a key's key now (a lone item put in a task since)
  states: Record<string, State[]>, // each task's items' states
  looks: Record<string, CellLook>, // what each item's box in a map shows (none: grey)
  dragging: string | null, // the task being dragged by its card head, if one can go to another tab
  carried: [string, string | null][]; // each let go on the bar: the task, the tab it goes in (null: a new one)
// what the page shows changed: the layout model told, as the page's own changes tell it (the layout's modules: a task entered, opened
// beside, closed)
function setShown(list: string[]) {
  shown = list;
  shadow.update((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === l.current ? { ...t, tasks: [...list] } : t)) }));
}
// what a page just loaded opens on by itself (its first actor): shown, the model told as the page tells it (opened)
function openedOn(list: string[]) {
  shown = list;
  for (const k of list) shadow.update(M.opened, k);
}
// a page loaded: the model read from what this browser keeps, the page showing what it opened on by itself (`shown`) --
// in the tab shown only if it holds nothing, as the page's first actor is (model.ts's opened)
function tabs(): Tabs {
  shadow.reset();
  const hooks: TabsHooks = {
    shown: () => shown,
    focus: () => shown[0] || null,
    enter: async (tasks, focus) => {
      entered.push([tasks, focus]);
      setShown([...new Set([focus, ...tasks].filter((k): k is string => !!k))]);
    },
    clear: async () => {
      setShown([]);
    },
    remember: (k) => remembered.push(k),
    canon: (k) => now[k] ?? k,
    name: (k) => k.toUpperCase(),
    status: (k) => states[k] || [],
    look: (_k, item) => looks[item] ?? null,
    lead: (k) => `${k}1`,
    screen: () => screen,
    setScreen: (s) => (screen = s),
    hold: () => {},
    changed: () => {},
    carried: () => dragging,
    carry: (k, to) => carried.push([k, to]),
  };
  const t = new Tabs(work, hooks);
  if (!shadow.now().tabs.find((x) => x.id === shadow.now().current)!.tasks.length) setShown(shown);
  return t;
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
  setShown(["a"]);
  screen = null;
  entered = [];
  remembered = [];
  now = {};
  states = {};
  looks = {};
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
    setShown(["b"]);
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
    setShown(["b"]);
    expect(strip(t)).toEqual(["A", "B *"]);
    setShown([]);
    await t.route("c"); // the tab shown showing nothing: c goes in it
    setShown(["c"]);
    expect(strip(t)).toEqual(["A", "C *"]);
  });

  it("a tab left with a lone item, put in a task since, holds the task: a click on it brings the tab forward", async () => {
    const t = tabs();
    t.fresh(); // tab 1 left with a, alone
    setShown(["b"]);
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
    setShown(["a", "b"]);
    t.draw(); // kept as it is now
    const again = tabs(); // the page reloaded, on the actor it opens on by itself
    openedOn(["z"]);
    expect(await again.start()).toBe(true);
    expect(entered).toEqual([[["a", "b"], "a"]]);
    expect(await again.start()).toBe(false); // once
  });

  it("where a task is open: its tab's number, and whether it is the tab shown", () => {
    const t = tabs();
    setShown(["a", "b"]);
    t.fresh();
    setShown(["c"]);
    expect(t.where("a")).toEqual({ n: 1, here: false });
    expect(t.where("c")).toEqual({ n: 2, here: true });
    expect(t.where("d")).toBe(null);
  });

  it("⌥: the task taken out of the tab holding it, a tab left with none closed", () => {
    const t = tabs();
    t.fresh(); // tab 1: a
    setShown(["b"]);
    t.take("a"); // a, ⌥+clicked in tab 2: out of tab 1, which goes
    expect(strip(t)).toEqual(["B *"]);
    expect(t.where("a")).toBe(null);
  });

  it("keeps a task in one tab only: shown in another, it leaves the first, and a tab left with none goes", () => {
    const t = tabs();
    t.fresh(); // tab 1: a
    setShown(["a", "b"]); // a opened beside b in tab 2
    t.fresh(); // tab 2 kept with a and b: a leaves tab 1, left empty
    setShown(["c"]);
    expect(strip(t)).toEqual(["A, B", "C *"]);
  });

  it('"+": a new tab, empty, the tab left kept with its tasks', async () => {
    const t = tabs();
    setShown(["a", "b"]);
    await t.blank();
    expect(shown).toEqual([]);
    expect(strip(t)).toEqual(["A, B", "New tab *"]);
    await t.route("a"); // open in the first tab: brought forward
    expect(strip(t)).toEqual(["A, B *"]);
  });

  it("closing the tab shown shows the next first; the last one is not closed, nor has a ×", async () => {
    const t = tabs();
    t.fresh();
    setShown(["b"]);
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

  it("the close key: the tab shown closed, the next shown; the only one emptied, a new tab -- already one, as it is", async () => {
    const t = tabs();
    t.fresh();
    setShown(["b"]);
    await t.closeShown(); // two tabs: the one shown (b's) closed, a's shown
    expect(shown).toEqual(["a"]);
    expect(strip(t)).toEqual(["A *"]);
    remembered = [];
    t.rename(ids()[0], "Mine");
    await t.closeShown(); // the only one: emptied, its tasks kept as they were, its name gone
    expect(shown).toEqual([]);
    expect(remembered).toEqual([["a"]]);
    expect(strip(t)).toEqual(["New tab *"]);
    await t.closeShown(); // showing nothing already: as it is
    expect(strip(t)).toEqual(["New tab *"]);
    await t.route("a"); // a open nowhere now: it goes in the empty tab, not a new one
    setShown(["a"]);
    expect(strip(t)).toEqual(["A *"]);
  });

  it("a task closed in the list: its tab closed if it held nothing else, else the task out of it", async () => {
    const t = tabs(),
      here: string[] = [];
    const closeHere = (k: string) => async () => {
      here.push(k);
      setShown(shown.filter((x) => x !== k));
    };
    setShown(["a", "b"]);
    t.fresh(); // tab 1: a and b, a in focus
    setShown(["c"]);
    t.fresh(); // tab 2: c
    setShown(["d", "e"]); // tab 3, shown: d and e
    expect(strip(t)).toEqual(["A, B", "C", "D, E *"]);
    await t.closed("a", closeHere("a")); // in tab 1 with b: out of it, b in focus there now
    expect(strip(t)).toEqual(["B", "C", "D, E *"]);
    await t.closed("c", closeHere("c")); // all tab 2 held: the tab closed
    expect(strip(t)).toEqual(["B", "D, E *"]);
    await t.closed("e", closeHere("e")); // in the tab shown with d: its panels closed here, the tab kept
    expect(here).toEqual(["e"]);
    expect(strip(t)).toEqual(["B", "D *"]);
    await t.closed("d", closeHere("d")); // all the tab shown held: closed, the next shown, b in focus
    expect(entered).toEqual([[["b"], "b"]]);
    expect(strip(t)).toEqual(["B *"]);
    await t.closed("b", closeHere("b")); // the only tab: emptied, a new tab again
    expect(shown).toEqual([]);
    expect(strip(t)).toEqual(["New tab *"]);
    await t.closed("z", closeHere("z")); // open nowhere: nothing
    expect(here).toEqual(["e"]);
    expect(strip(t)).toEqual(["New tab *"]);
  });

  it("a new tab's draft is kept with it: left with one, it stays (and has it shown again); left with none, it goes", async () => {
    const t = tabs();
    await t.blank(); // tab 2, empty
    t.setDraft("fix the parser");
    expect(t.shownTab().draft).toBe("fix the parser");
    const drafted = t.shownTab().id;
    setShown([]);
    await t.route("b"); // open nowhere: a tab of its own, not this one with something typed in it
    expect(t.shownTab().id).not.toBe(drafted);
    setShown(["b"]);
    expect(strip(t)).toEqual(["A", "New tab", "B *"]);
    await t.route("a"); // a, in tab 1: tab 3 left, b in it
    expect(strip(t)).toEqual(["A *", "New tab", "B"]);
    await t.show(drafted); // shown again: the panels shown closed, its page
    expect(shown).toEqual([]);
    expect(t.shownTab()).toEqual({ id: drafted, draft: "fix the parser", page: "" });
    setShown([]);
    t.filling(true); // what its page opens: in it, whatever is typed
    await t.route("c");
    t.filling(false);
    expect(t.shownTab().id).toBe(drafted);
    t.setDraft(""); // sent, or cleared
    await t.route("a");
    expect(strip(t)).toEqual(["A *", "B"]); // left with nothing in it: gone
    await t.blank();
    t.setDraft("next"); // a reload on a new tab with something typed: its page, not what the page opened on
    const again = tabs();
    openedOn(["z"]);
    expect(await again.start()).toBe(true);
    expect(shown).toEqual([]);
    expect(again.shownTab().draft).toBe("next");
  });

  it("the Apps page: in a tab of its own (the tab shown, if empty), kept when left, one at most, a task clicked elsewhere", async () => {
    const t = tabs();
    await t.openPage("apps"); // tab 1 shows a: a new tab after it, its panels closed
    expect(shown).toEqual([]);
    expect(t.shownTab().page).toBe("apps");
    expect(strip(t)).toEqual(["A", "Apps *"]);
    expect(work.querySelector('.lay-tab[aria-selected="true"] .lay-page')).not.toBeNull(); // its mark in its map
    const page = t.shownTab().id;
    await t.route("b"); // a task open nowhere: a tab of its own, not this page's
    setShown(["b"]);
    expect(strip(t)).toEqual(["A", "Apps", "B *"]);
    await t.openPage("apps"); // opened again: its tab shown, no second one
    expect(t.shownTab()).toEqual({ id: page, draft: "", page: "apps" });
    expect(strip(t)).toEqual(["A", "Apps *", "B"]);
    await t.closeShown(); // closed: gone, the next shown
    expect(strip(t)).toEqual(["A", "B *"]);
    await t.blank(); // an empty tab shown: the page opens in it
    await t.openPage("apps");
    expect(strip(t)).toEqual(["A", "B", "Apps *"]);
    const again = tabs(); // a reload on it: its page, not what the page opened on by itself
    openedOn(["z"]);
    expect(await again.start()).toBe(true);
    expect(shown).toEqual([]);
    expect(again.shownTab().page).toBe("apps");
  });

  it("each task's state marked on its lead's box in the map: its first actor's, top left first", () => {
    const t = tabs();
    const st = (mark: string, said: string): State => ({ mark, said });
    setShown(["a", "b", "c"]);
    looks = { a1: { hue: "#f97316", src: "/avatars/a.svg" }, b1: { app: true } };
    states = {
      a: [st("", "Idle"), st("working", "Running"), st("finished", "Finished")], // done since looked: before at work
      b: [st("", "Idle")], // idle: no mark
      c: [st("asking", "Waiting for you")],
    };
    t.draw();
    const tab = work.querySelector<HTMLElement>(".lay-tab")!;
    const boxes = [...tab.querySelectorAll<HTMLElement>(".lay-map > .lay-mcell")];
    // no map kept: a box for each task, side by side, its lead's
    expect(boxes.map((b) => `${b.title}:${b.querySelector<HTMLElement>(".lay-dot")?.dataset.status || ""}`)).toEqual([
      "A · Finished:finished",
      "B · Idle:",
      "C · Waiting for you:asking",
    ]);
    expect(boxes[0].style.getPropertyValue("--hue")).toBe("#f97316");
    expect(boxes[0].querySelector("img")!.getAttribute("src")).toBe("/avatars/a.svg");
    expect(boxes[1].className).toBe("lay-mcell app");
    expect(boxes[2].className).toBe("lay-mcell"); // nothing known of it: grey
    expect(tab.title.split("\n")).toEqual([
      "A, B +1 · double-click to name it",
      "A · Finished",
      "B · Idle",
      "C · Waiting for you",
    ]);
  });

  it("the tab shown's map taken as its panels are placed, kept with it when left, drawn so till its tasks change", async () => {
    const t = tabs();
    setShown(["a"]);
    const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
    const items = new Map([
      ["p1", { key: "a", item: "app:n" }],
      ["p2", { key: "a", item: "a1" }],
    ]);
    // a Notepad above its actor
    t.mapped(
      new Map([
        ["p1", rect(10, 10, 400, 100)],
        ["p2", rect(10, 110, 400, 300)],
      ]),
      items,
    );
    const map = (n: number): string[] =>
      [...work.querySelectorAll(".lay-tab")[n].querySelectorAll<HTMLElement>(".lay-mcell")].map(
        (b) => `${b.style.left},${b.style.top},${b.style.width},${b.style.height}`,
      );
    expect(map(0)).toEqual(["1px,1px,35px,4px", "1px,6px,35px,14px"]);
    t.fresh(); // left: kept as it was
    setShown(["b"]);
    t.draw();
    expect(map(0)).toEqual(["1px,1px,35px,4px", "1px,6px,35px,14px"]);
    expect(map(1)).toEqual(["1px,1px,35px,19px"]); // b: no map yet, one box
    now = { a: "t1" }; // a put in a task since: its key now, the same map
    t.draw();
    expect(map(0)).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("ag-dashboard-layout")!).tabs[0].map).toHaveLength(2); // kept on reload
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

  it("a task put in a new tab: after the tab shown, or last; the tab shown stays; shown, the new tab opens it", async () => {
    const t = tabs();
    t.fresh();
    setShown(["b", "c", "d", "e"]); // tab 1: a; tab 2 (shown): b, c, d, e
    setShown(["b", "d", "e"]); // c closed here (the page's), then put
    t.put("c", null);
    expect(strip(t)).toEqual(["A", "B, D +1 *", "C"]);
    setShown(["b", "e"]);
    t.put("d", null, true); // dropped on the bar: at its end
    setShown(["b"]);
    t.put("e", null); // from the menu: after the tab shown
    expect(strip(t)).toEqual(["A", "B *", "E", "C", "D"]);
    await t.route("c"); // shown: c opened, in focus
    expect(entered).toEqual([[["c"], "c"]]);
    expect(strip(t)).toEqual(["A", "B", "E", "C *", "D"]);
  });

  it("a task put in another tab, last, that tab's focus kept; the tabs to go to, the others", async () => {
    const t = tabs();
    t.fresh();
    setShown(["b", "c", "d"]);
    strip(t);
    const [first, second] = ids();
    expect(t.others()).toEqual([{ id: first, n: 1, name: "A" }]);
    setShown(["b", "d"]);
    t.put("c", first);
    setShown(["b"]);
    t.put("d", second); // the tab shown: no tab to go in -- a new one
    expect(strip(t)).toEqual(["A, C", "B *", "D"]);
    await t.show(first);
    expect(entered).toEqual([[["a", "c"], "a"]]);
  });

  it("a task dragged onto the bar: on another tab's name, into it; on the tab shown's, nowhere; elsewhere, a new tab", () => {
    const t = tabs();
    t.fresh();
    setShown(["b", "c"]);
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

  it("a tab dragged along the bar: the others slid aside where it would go; let go anywhere on it, it goes there", () => {
    const t = tabs();
    t.fresh();
    setShown(["b"]);
    t.fresh();
    setShown(["c"]);
    expect(strip(t)).toEqual(["A", "B", "C *"]);
    // each tab 98px wide, 100px apart (the bar itself at 0)
    const chips = () => [...work.querySelectorAll<HTMLElement>(".lay-tab")];
    const lay = () =>
      chips().forEach((e, i) => {
        Object.defineProperty(e, "offsetLeft", { value: i * 100, configurable: true });
        Object.defineProperty(e, "offsetWidth", { value: 98, configurable: true });
      });
    lay();
    const fire = (on: Element, type: string, x = 0): boolean =>
      on.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }));
    const bar = work.querySelector(".lay-tabs")!;
    const [a, b, c] = ids();
    fire(chips()[0], "dragstart"); // A picked up
    expect(fire(bar, "dragenter", 160)).toBe(false); // taken, as the pointer comes onto a part of the bar ...
    expect(fire(bar, "dragover", 160)).toBe(false); // ... and over it: past B's middle, before C's
    expect(chips().map((e) => e.style.transform)).toEqual(["translateX(98px)", "translateX(-98px)", ""]);
    fire(bar, "dragover", 20); // back at its own place: nothing slid
    expect(chips().map((e) => e.style.transform)).toEqual(["", "", ""]);
    states.b = [{ mark: "working", said: "Working" }];
    t.draw(); // meanwhile: the bar held as it is, A's name the drag's own
    expect(chips()[1].querySelector(".lay-dot")).toBe(null);
    expect(fire(bar, "drop", 290)).toBe(false); // past every tab: last
    expect(ids()).toEqual([b, c, a]);
    expect(chips()[0].querySelector(".lay-dot")).not.toBe(null); // drawn again, as it is now
    expect(chips().map((e) => e.style.transform)).toEqual(["", "", ""]);
    // kept: the tab shown still C, and so after a reload
    expect(strip(t)).toEqual(["B", "C *", "A"]);
    work = document.createElement("div");
    const again = tabs();
    expect(strip(again)).toEqual(["B", "C *", "A"]);
    // C dragged to the front, then given up: nothing moved
    lay();
    fire(chips()[1], "dragstart");
    fire(work.querySelector(".lay-tabs")!, "dragover", 30);
    expect(chips().map((e) => e.style.transform)).toEqual(["translateX(98px)", "translateX(-98px)", ""]);
    fire(chips()[1], "dragend");
    expect(chips().map((e) => e.style.transform)).toEqual(["", "", ""]);
    expect(ids()).toEqual([b, c, a]);
    again.move(c, 0);
    expect(strip(again)).toEqual(["C *", "B", "A"]);
  });
});
