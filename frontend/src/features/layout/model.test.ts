import { describe, expect, it } from "vitest";
import {
  close,
  closed,
  isLaidOut,
  layOut,
  setAuto,
  setEntered,
  closeShown,
  empty,
  focusOn,
  forgetActor,
  holds,
  load,
  merge,
  migrate,
  move,
  open,
  openPage,
  put,
  rekey,
  remember,
  route,
  setDraft,
  show,
  shown,
  shownTab,
  take,
  unfocus,
  unwantApps,
  unwantPanes,
  wantPane,
  retargetPane,
  panesNoted,
  swapApp,
  wantApp,
  where,
  type Layout,
} from "./model";

// tabs a (shown) and b, as the e2e home's screen tabs would be
const two = (): Layout => ({
  tabs: [
    { id: "a", name: "", tasks: ["g\u0000c1"], screen: null, focus: "g\u0000c1" },
    { id: "b", name: "", tasks: ["g\u0000c2", "g\u0000t1"], screen: null, focus: "g\u0000c2" },
  ],
  current: "a",
  tasks: {},
});

describe("the layout model's tabs", () => {
  it("routes a click: in the tab shown, here; in another, that tab shown with it in focus; nowhere, a new tab", () => {
    expect(route(two(), "g\u0000c1").go).toBe("here");
    const r = route(two(), "g\u0000t1");
    expect([r.go, r.layout.current, shownTab(r.layout).focus]).toEqual(["tab", "b", "g\u0000t1"]);
    const f = route(two(), "g\u0000c9", { id: "n" });
    expect([f.go, f.layout.current, f.layout.tabs.map((t) => t.id)]).toEqual(["fresh", "n", ["a", "n", "b"]]);
  });

  it("puts a click in the tab shown when it shows nothing, or only what the page opened on by itself", () => {
    const l = empty("e");
    expect(route(l, "g\u0000c9").go).toBe("in");
    expect(route(two(), "g\u0000c9", { idle: true }).go).toBe("in");
    expect(route(setDraft(l, "hi"), "g\u0000c9", { id: "n" }).go).toBe("fresh"); // what was typed is kept
    expect(route(setDraft(l, "hi"), "g\u0000c9", { fill: true }).go).toBe("in"); // ... unless it is opening it
  });

  it("drops a tab left holding nothing, and keeps one with a name, a draft or a page", () => {
    const l = {
      ...empty("e"),
      tabs: [...empty("e").tabs, { id: "b", name: "", tasks: ["g\u0000c2"], screen: null, focus: null }],
    };
    expect(show(l, "b").tabs.map((t) => t.id)).toEqual(["b"]);
    expect(holds({ id: "x", name: "Mine", tasks: [], screen: null, focus: null })).toBe(true);
  });

  it("opens a task in place of the others, or beside them, in focus", () => {
    expect(shown(open(two(), "g\u0000c5"))).toEqual(["g\u0000c5"]);
    const beside = open(two(), "g\u0000c5", true);
    expect([shown(beside), shownTab(beside).focus]).toEqual([["g\u0000c1", "g\u0000c5"], "g\u0000c5"]);
  });

  it("⌥+click takes a task from another tab to be the tab shown's alone, that tab gone if left empty", () => {
    const l = open(
      take({ ...two(), tabs: [two().tabs[0], { ...two().tabs[1], tasks: ["g\u0000c2"] }] }, "g\u0000c2"),
      "g\u0000c2",
    );
    expect([l.tabs.map((t) => t.id), shown(l)]).toEqual([["a"], ["g\u0000c2"]]);
  });

  it("closes a tab: the shown one, the next shown; the only one is emptied, a new tab again", () => {
    expect(close(two(), "a").current).toBe("b");
    expect(close({ ...two(), current: "b" }, "b").current).toBe("a");
    const only = closeShown({ ...two(), tabs: [{ ...two().tabs[0], name: "Mine", draft: "x" }] });
    expect(only.tabs).toEqual([{ id: "a", name: "", tasks: [], screen: null, focus: null }]);
    expect(closeShown(empty("e"))).toEqual(empty("e"));
  });

  it("a task closed in the list leaves its tab, the tab closed if it held nothing else", () => {
    expect(closed(two(), "g\u0000c1").tabs.map((t) => t.id)).toEqual(["b"]);
    const l = closed(two(), "g\u0000c2");
    expect([l.tabs[1].tasks, l.tabs[1].focus]).toEqual([["g\u0000t1"], "g\u0000t1"]);
  });

  it("puts a task in another tab, or in a new one after the shown one, or at the end", () => {
    expect(put(two(), "g\u0000c1", "b").tabs[1].tasks).toEqual(["g\u0000c2", "g\u0000t1", "g\u0000c1"]);
    expect(put(two(), "g\u0000c9", null, false, "n").tabs.map((t) => t.id)).toEqual(["a", "n", "b"]);
    expect(put(two(), "g\u0000c9", null, true, "n").tabs.map((t) => t.id)).toEqual(["a", "b", "n"]);
  });

  it("merges a tab dropped on the work area into the shown one, moves tabs, and finds where a task is", () => {
    const m = merge(two(), "b");
    expect([m.tasks, shown(m.layout), m.layout.tabs.length]).toEqual([
      ["g\u0000c2", "g\u0000t1"],
      ["g\u0000c1", "g\u0000c2", "g\u0000t1"],
      1,
    ]);
    expect(move(two(), "a", 5).tabs.map((t) => t.id)).toEqual(["b", "a"]);
    expect([where(two(), "g\u0000t1"), where(two(), "g\u0000c9")]).toEqual([{ n: 2, here: false }, null]);
  });

  it("opens a page in the tab already showing it, an empty tab, or a new one; keeps or drops a draft", () => {
    const p = openPage(two(), "apps", "n");
    expect([p.current, shownTab(p).page]).toEqual(["n", "apps"]);
    expect(openPage({ ...p, current: "a" }, "apps").current).toBe("n");
    expect(shownTab(openPage(empty("e"), "apps")).page).toBe("apps");
    expect("draft" in shownTab(setDraft(setDraft(empty("e"), "x"), ""))).toBe(false);
  });

  it("follows a task's new key everywhere, and keeps what each task was left with, the newest only", () => {
    let l = remember(
      two(),
      "g\u0000c2",
      { actors: ["c2"], apps: [], focus: "c2", focusApp: null, views: {}, shut: null },
      1,
    );
    l = rekey(l, "g\u0000c2", "g\u0000t1");
    expect([l.tabs[1].tasks, l.tabs[1].focus, Object.keys(l.tasks)]).toEqual([
      ["g\u0000t1"],
      "g\u0000t1",
      ["g\u0000t1"],
    ]);
    l = forgetActor(l, "g\u0000t1", "c2");
    expect([l.tasks["g\u0000t1"].left!.actors, l.tasks["g\u0000t1"].left!.focus]).toEqual([[], null]);
    for (let i = 0; i < 205; i++)
      l = remember(
        l,
        `g\u0000x${i}`,
        { actors: [], apps: [], focus: null, focusApp: null, views: {}, shut: null },
        10 + i,
      );
    expect([Object.keys(l.tasks).length, "g\u0000x0" in l.tasks, "g\u0000x204" in l.tasks]).toEqual([200, false, true]);
  });
});

describe("the migration from the six keys", () => {
  it("reads the tabs, the shown tab's arrangement, and what each task was left with and its trees", () => {
    const leaf = { id: "c1" };
    const kept: Record<string, string> = {
      "ag-dashboard-screen-tabs": JSON.stringify({ tabs: two().tabs, current: "b" }),
      "ag-dashboard-screen": JSON.stringify(leaf),
      "ag-dashboard-task-layouts-2": JSON.stringify({
        "g\u0000c1": { actors: ["c1"], focus: "c1", views: { c1: "files" }, at: 5 },
      }),
      "ag-dashboard-task-trees": JSON.stringify({
        "g\u0000c1": { tree: leaf, at: 7 },
        "g\u0000t1": { tree: leaf, at: 3 },
      }),
    };
    const l = migrate((k) => kept[k] ?? null);
    expect([l.current, l.tabs.length, shownTab(l).screen]).toEqual(["b", 2, leaf]);
    expect(l.tasks["g\u0000c1"]).toEqual({
      left: { actors: ["c1"], apps: [], focus: "c1", focusApp: null, views: { c1: "files" }, shut: null, at: 5 },
      tree: leaf,
      at: 7,
    });
    expect(l.tasks["g\u0000t1"].tree).toEqual(leaf);
  });

  it("keeps whatever else an older page kept with a task (its widths), and prefers the one key once it is there", () => {
    const old: Record<string, string> = {
      "ag-dashboard-task-layouts-2": JSON.stringify({ "g\u0000t1": { actors: ["a"], sizes: { a: 0.5 }, at: 1 } }),
    };
    expect(migrate((k) => old[k] ?? null).tasks["g\u0000t1"].left!.sizes).toEqual({ a: 0.5 });
    const now = { ...two(), current: "b" };
    const both: Record<string, string> = { ...old, "ag-dashboard-layout": JSON.stringify(now) };
    expect(load((k) => both[k] ?? null)).toEqual({
      ...now,
      focus: null, // (the page's alone)
      lastActor: null,
      away: null,
      appsOnly: null,
      entered: null,
      laidOut: [],
      auto: null,
    });
    expect(load((k) => (k === "ag-dashboard-layout" ? "{broken" : (old[k] ?? null))).tasks["g\u0000t1"]).toBeTruthy();
  });

  it("reads the page's panes and the apps' panels above them, as the page last showed them", () => {
    const panes = { here: ["g", "c1"], size: 1, focus: 0, others: [{ g: "g", c: "c2", view: "files", size: 2 }] };
    const apps = { apps: [{ app: "notes", instance: "i1", g: "g", size: 1 }] };
    const old: Record<string, string> = {
      "ag-dashboard-panes": JSON.stringify(panes),
      "ag-dashboard-top-apps": JSON.stringify(apps),
    };
    const l = migrate((k) => old[k] ?? null);
    expect([l.panes, l.apps]).toEqual([panes, apps.apps]);
  });

  it("focus: one item, an actor's or an app's; an app unselected, the actor last in focus again", () => {
    let l = focusOn(two(), "g\u0000c1", true);
    l = focusOn(l, "g\u0000app:i1", false);
    expect([l.focus, l.lastActor]).toEqual(["g\u0000app:i1", "g\u0000c1"]);
    expect(unfocus(l, "g\u0000app:i1").focus).toBe("g\u0000c1");
    expect(unfocus(l, "g\u0000app:other").focus).toBe("g\u0000app:i1");
  });

  it("the apps' panels wanted: one added last, once (its width kept), some no longer, one swapped for another", () => {
    let l = wantApp(two(), { app: "notes", instance: "i1", g: "g" });
    l = wantApp(l, { app: "notepad", instance: "i2", g: "g", size: 2 });
    l = wantApp(l, { app: "notes", instance: "i1", g: "g", size: 3 });
    expect(l.apps).toEqual([
      { app: "notes", instance: "i1", g: "g", size: 3 },
      { app: "notepad", instance: "i2", g: "g", size: 2 },
    ]);
    l = swapApp(l, "i2", { app: "notepad", instance: "i9", g: "h" });
    expect(l.apps![1]).toEqual({ app: "notepad", instance: "i9", g: "h", size: 2 });
    l = unwantApps(l, (a) => a.instance === "i1");
    expect(l.apps!.map((a) => a.instance)).toEqual(["i9"]);
    expect("apps" in unwantApps(l, () => true)).toBe(false);
  });

  it("the panes beside wanted at their place, once; some no longer; one showing another actor; each one's view noted", () => {
    let l = wantPane(two(), { g: "g", c: "c2" }, 0);
    l = wantPane(l, { g: "g", c: "c1" }, 0);
    l = wantPane(l, { g: "g", c: "c1" }, 5);
    expect(l.panes!.others.map((o) => o.c)).toEqual(["c1", "c2"]);
    l = retargetPane(l, "g", "c2", { g: "h", c: "c3" });
    expect(l.panes!.others[1]).toEqual({ g: "h", c: "c3" });
    l = panesNoted(l, ["g", "c0"], 2, 1, (o) => (o.c === "c1" ? { view: "files", size: 3 } : null));
    expect(l.panes).toEqual({
      here: ["g", "c0"],
      size: 2,
      focus: 1,
      others: [
        { g: "g", c: "c1", view: "files", size: 3 },
        { g: "h", c: "c3" },
      ],
    });
    expect(unwantPanes(l, (o) => o.g === "h").panes!.others.map((o) => o.c)).toEqual(["c1"]);
  });

  it("starts as a fresh home with nothing kept, or what was kept unreadable", () => {
    expect(migrate(() => null).tabs.length).toBe(1);
    expect(migrate(() => "{not json").tabs[0].tasks).toEqual([]);
  });

  it("the page's own: the task last entered, those laid out here, the one it opened on by itself -- not kept", () => {
    let l = setEntered(two(), "g\u0000t1");
    l = layOut(layOut(layOut(l, "g\u0000t1"), "g\u0000c2"), "g\u0000t1");
    expect(l.laidOut).toEqual(["g\u0000t1", "g\u0000c2"]);
    expect(isLaidOut(l, "g\u0000c2")).toBe(true);
    l = layOut(l, "g\u0000t1", false);
    expect([isLaidOut(l, "g\u0000t1"), l.laidOut]).toEqual([false, ["g\u0000c2"]]);
    l = setAuto(l, "g\u0000c2");
    expect([l.entered, l.auto]).toEqual(["g\u0000t1", "g\u0000c2"]);
    const kept = JSON.stringify(l);
    expect(load((k) => (k === "ag-dashboard-layout" ? kept : null))).toMatchObject({
      entered: null,
      laidOut: [],
      auto: null,
    });
  });
});
