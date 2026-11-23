// What the list works out apart from the page for its presses and drags: what a drag may do and what its drop does, what
// a change of the folders does to a tree, the words a move between groups says first, the looks and tasks a home brings,
// and where the hover card goes.
import { describe, expect, it } from "vitest";
import { cardPlace } from "./card-place";
import * as DR from "./drag-rules";
import * as FE from "./folder-edits";
import * as MP from "./move-plan";
import { everySeen, newerTasks } from "./seen-model";
import { actor, app, ctxOf, gatherer } from "./testing";
import type { Tree } from "./types";

const drag = (more: Partial<DR.Drag>): DR.Drag => ({ g: "g", cs: null, gs: null, folder: null, ask: false, ...more });
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("a drag of the list's rows", () => {
  const a1 = actor("g", "a1"),
    a2 = actor("g", "a2"),
    crew = actor("g", "boss", { role: "coordinator" });
  const folders: Tree = {
    folders: [
      { id: 1, parent: null, name: "Work" },
      { id: 2, parent: 1, name: "Inner" },
    ],
    filed: { a2: 1 },
  };
  const home = {
    gatherers: [gatherer("g", [a1, a2, crew]), gatherer("lab", [actor("lab", "b1")])],
    folders: { g: folders },
    tasks: { g: { tasks: [{ id: 7, name: null }], tasked: { a1: 7, "app:n1": 7 } } },
    merged: true,
  };
  const rules = (more = {}): DR.Rules => ({
    ctx: ctxOf({ ...home, ...more }, { apps: { g: [app("g", "n1"), app("g", "n2")] } }),
    ownKey: (a) => (a.channel === "a2" ? "n2" : null),
  });
  const g = home.gatherers[0],
    lab = home.gatherers[1];

  it("takes a task whole, and an app's own agent with its window", () => {
    expect(DR.withOwn(rules(), g, ["a1"]).sort()).toEqual(["a1", "app:n1"]);
    expect(DR.withOwn(rules(), g, ["a2"]).sort()).toEqual(["a2", "app:n2"]);
    expect(DR.withOwn(rules(), g, ["app:n2"]).sort()).toEqual(["a2", "app:n2"]);
  });
  it("puts items in a folder they are not all in, a folder not into itself nor where it is", () => {
    expect(DR.canDrop(rules(), drag({ cs: ["a2"] }), g, 1)).toBe(false); // there already
    expect(DR.canDrop(rules(), drag({ cs: ["a2"] }), g, null)).toBe(true);
    expect(DR.canDrop(rules(), drag({ folder: 1 }), g, 2)).toBe(false); // into one of its own
    expect(DR.canDrop(rules(), drag({ folder: 2 }), g, 1)).toBe(false); // where it is
    expect(DR.canDrop(rules(), drag({ folder: 2 }), g, null)).toBe(true);
    expect(DR.canDrop(rules(), null, g, null)).toBe(false);
  });
  it("puts an item in another's task, not in its own, nor a coordinator's", () => {
    expect(DR.canJoin(rules(), drag({ cs: ["a2"] }), g, "a1")).toBe(true);
    expect(DR.canJoin(rules(), drag({ cs: ["a1"] }), g, "a1")).toBe(false);
    expect(DR.canJoin(rules(), drag({ cs: ["app:n1"] }), g, "a1")).toBe(false); // in its task already
    expect(DR.canJoin(rules(), drag({ g: "lab", cs: ["b1"] }), g, "a1")).toBe(false); // of another group
  });
  it("moves between groups only in the home's one database, never a coordinator agent, nor a group's only app", () => {
    expect(DR.canCross(rules(), drag({ cs: ["a2"] }), lab)).toBe(true); // its own app's window with it
    expect(DR.canCross(rules({ merged: false }), drag({ cs: ["a2"] }), lab)).toBe(false);
    expect(DR.canCross(rules(), drag({ cs: ["boss"] }), lab)).toBe(false);
    expect(DR.canCross(rules(), drag({ cs: ["a1"] }), lab)).toBe(false); // its task's app stays with its group
    expect(DR.canDrop(rules(), drag({ cs: ["a2"] }), lab, null)).toBe(true);
  });
  it("takes one actor, alone in its task, outside every group; not two", () => {
    expect(DR.canOutside(rules(), drag({ cs: ["a2"] }))).toBe(true);
    expect(DR.canOutside(rules(), drag({ cs: ["a1", "a2"] }))).toBe(false);
    expect(DR.canOutside(rules({ merged: false }), drag({ cs: ["a2"] }))).toBe(false);
  });
  it("says what a drop does: items filed with their tasks, a folder moved, a move asked, a group merged", () => {
    expect(DR.dropOf(rules(), drag({ cs: ["a1", "a2"] }), g, 1)).toEqual({
      do: "file",
      items: ["a1", "app:n1"],
      id: 1,
      picks: "actors",
    });
    expect(DR.dropOf(rules(), drag({ folder: 2 }), g, null)).toEqual({ do: "folder", folder: 2, id: null });
    expect(DR.dropOf(rules(), drag({ cs: ["a2"] }), lab, null)).toEqual({ do: "move", id: null });
    expect(DR.dropOf(rules(), drag({ g: "/", gs: ["lab"] }), g, 1)).toEqual({
      do: "merge",
      name: "lab",
      id: 1,
      picks: "groups",
    });
    expect(DR.outsideOf(drag({ folder: 1 }))).toBe("split");
    expect(DR.outsideOf(drag({ g: "self:x", cs: ["x"] }))).toBe("place-alone");
    expect(DR.outsideOf(drag({ cs: ["a1"] }))).toBe("alone");
  });
});

describe("a change of the folders, made at once", () => {
  const tree = (): Tree => ({
    folders: [
      { id: 1, parent: null, name: "Work", closed: "t" },
      { id: 2, parent: 1, name: "Inner", closed: "t" },
    ],
    filed: { a: 2, b: 1 },
  });
  it("opens a closed folder something is put in, and those it is in", () => {
    const t = tree();
    FE.fileInto(t, ["c"], 2);
    FE.openUp(t, 2);
    expect(t.filed.c).toBe(2);
    expect(t.folders.map((f) => f.closed)).toEqual([null, null]);
    FE.fileInto(t, ["c"], null);
    expect("c" in t.filed).toBe(false);
  });
  it("moves what was in a folder deleted up a level", () => {
    const t = tree();
    FE.deleteFrom(t, 2);
    expect(t.folders.map((f) => f.id)).toEqual([1]);
    expect(t.filed).toEqual({ a: 1, b: 1 });
  });
  it("names a new folder apart from those beside it, and refuses a name one has or a /", () => {
    expect(FE.freeName(tree().folders, "Work")).toBe("Work 2");
    expect(FE.freeName(tree().folders, "Other")).toBe("Other");
    expect(FE.tidyName("  a   b ", 60)).toBe("a b");
    expect(FE.nameRefused("work", ["Work"])).toBe('A folder named "Work" is already there');
    expect(FE.nameRefused("a/b", [])).toBe('Folder names can\'t contain "/"');
    expect(FE.nameRefused("a/b", [], "group")).toBe('Group names can\'t contain "/"');
    expect(FE.nameRefused("New", ["Old"])).toBeNull();
  });
  it("says what closing a folder does", () => {
    expect(FE.closeSays({ open: 2, busy: 1, marks: 0, shells: 1 })).toBe(
      "closes 2 actors (stopping 1 mid-turn) and ends 1 terminal",
    );
    expect(FE.closeSays({ open: 0, busy: 0, marks: 0, shells: 0 })).toBe("closes it");
  });
});

describe("what a move between groups says first", () => {
  const a1 = actor("g", "a1", { name: { text: "Parser", by: "user" } }),
    a2 = actor("g", "a2", { name: { text: "Lexer", by: "user" }, status: "running", running: true });
  const home = { gatherers: [gatherer("g", [a1, a2]), gatherer("lab", [actor("lab", "b1")])], titles: { lab: "Lab" } };
  const w: MP.Words = { ctx: ctxOf(home), label: (x) => (x === "browser" ? "Browser" : x) };
  it("who moves where, how many others each group has, who rebuilds, the apps going with them", () => {
    const lines = MP.moveLines(w, home.gatherers[0], home.gatherers[1], {
      actors: ["a1"],
      apps: [{ id: "i", app: "browser" }],
    });
    expect(lines[0]).toBe("Parser moves from the g group (1 other) to the Lab group (1 other).");
    expect(lines[2]).toBe("It rebuilds its context when it next runs.");
    expect(lines[3]).toBe("The app Browser goes with it.");
  });
  it("names those moving when they are more than one", () => {
    expect(MP.moveNames(home.gatherers[0], ["a1"])).toBeNull();
    expect(MP.moveNames(home.gatherers[0], ["a1", "a2"])).toEqual({ shown: ["Parser", "Lexer"], more: 0 });
  });
  it("one on its own: it leaves its group, with no coordinator agent", () => {
    expect(MP.aloneLines(w, home.gatherers[0], a1, false, "", [])).toEqual([
      "Parser leaves the g group (1 other) and works on its own. It won't share context with any other actor.",
      "It has no coordinator agent. Drag it into a group to bring it back.",
      "It rebuilds its context when it next runs.",
    ]);
  });
});

describe("the looks and tasks a home brings", () => {
  it("takes every actor as seen as of what was kept, else as of its last activity", () => {
    const home = { gatherers: [gatherer("g", [actor("g", "a", { last: 5 }), actor("g", "b", { last: 9 })])] };
    expect(everySeen(home, { "g\u0000a": 3 })).toEqual({ "g\u0000a": 3, "g\u0000b": 9 });
  });
  it("keeps a gatherer's tasks read later than those that come", () => {
    const read = new Map<string, number>();
    const t = (id: number) => ({ tasks: [{ id, name: null }], tasked: {} });
    let had = newerTasks(read, {}, { g: t(1) }, 10);
    had = newerTasks(read, had, { g: t(2) }, 5); // read before: not taken
    expect(had.g.tasks[0].id).toBe(1);
    had = newerTasks(read, had, {}, 20); // none now: gone
    expect(had).toEqual({});
  });
});

describe("where the hover card goes", () => {
  const win = { width: 1300, height: 900 };
  it("beside the list, level with its row, inside the window", () => {
    expect(cardPlace(rect(10, 100, 280, 38), rect(0, 50, 320, 800), 300, 120, win, false)).toEqual({
      left: 328,
      top: 59,
    });
    expect(cardPlace(rect(10, 850, 280, 38), rect(0, 50, 320, 800), 300, 120, win, false).top).toBe(772);
  });
  it("under it where there is no room beside: the rail across the top, under the whole rail", () => {
    expect(cardPlace(rect(100, 10, 40, 40), rect(0, 0, 1300, 60), 300, 120, win, true)).toEqual({ left: 8, top: 66 });
  });
});
