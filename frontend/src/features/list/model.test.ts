// The list's view-model: what aside#agents draws, in its order, from a home and what is shown.
import { describe, expect, it } from "vitest";
import { buildList, type ActorRow, type FolderNode, type FoldNode, type GathererNode, type Node } from "./model";
import { actor, app, ctxOf, gatherer, viewOf } from "./testing";

/** A node, as its kind and key, and what is in it, so a list reads as an outline. */
function outline(n: Node): unknown {
  switch (n.kind) {
    case "gatherer":
      return [n.key, n.kids.map(outline)];
    case "folder":
      return [n.key, n.kids ? n.kids.map(outline) : n.peek.map(outline)];
    case "fold":
      return [n.says, n.kids.map(outline)];
    case "gf-folder":
      return [n.key, n.kids ? n.kids.map(outline) : null];
    case "alone":
      return [n.key, n.kids.map(outline)];
    case "alone-shut":
      return n.folds.map(outline);
    default:
      return n.key;
  }
}

describe("the list", () => {
  const crew = actor("g", "crew", { role: "coordinator" });
  const newer = actor("g", "new", { created: 5 }),
    older = actor("g", "old", { created: 1, status: "running" });
  const inFolder = actor("g", "inf", { created: 3 }),
    closed = actor("g", "shut", { status: "closed", last: 50 }),
    saved = actor("g", "kept", { status: "closed", last: 60 });
  const t1 = actor("g", "t1", { created: 4, status: "asking" }),
    t2 = actor("g", "t2", { created: 2 });
  const g = gatherer("g", [crew, newer, older, inFolder, closed, saved, t1, t2]);
  const home = {
    gatherers: [g],
    folders: { g: { folders: [{ id: 1, parent: null, name: "F" }], filed: { inf: 1 } } },
    saved: { g: { kept: "2026-01-01" } },
    tasks: { g: { tasks: [{ id: 9 }], tasked: { t1: 9, t2: 9, "app:i1": 9 } } },
    shells: [{ id: "shell:s", gatherer: "g", cwd: "/w" }],
  };
  const apps = { g: [app("g", "i1"), app("g", "i2")] };

  it("draws a gatherer's coordinator agent, folders, open rows, apps, then its folds -- a task once, where it comes", () => {
    const m = buildList(ctxOf(home, { apps }), viewOf());
    expect(m.top.map(outline)).toEqual([
      [
        "g",
        [
          "g/crew",
          ["g/folder:1", []], // folded: none of it open in a pane
          "g/new",
          "g/task:9",
          "g/old",
          "g/app:i2", // the apps: after the open actors (i1 is in the task)
          ["1 terminal", []],
          ["1 saved", []],
          ["1 closed", []],
        ],
      ],
    ]);
    const task = (m.top[0] as GathererNode).kids[3];
    expect(task).toMatchObject({
      kind: "task",
      first: "t1",
      what: "2 actors, 1 app",
      status: ["asking", "Waiting for you"],
    });
    expect((m.top[0] as GathererNode).kids[0]).toMatchObject({ group: "Coordinator agent", coordinator: true });
    expect((m.top[0] as GathererNode).counts).toMatchObject({ asking: 1, running: 1 });
  });

  it("opens folds and folders as the reader left them; folded, keeps those open in a pane in view", () => {
    const view = viewOf({
      foldersOpen: new Set(["g\u00001"]),
      foldOpen: { Closed: new Set(["g"]), Saved: new Set(), Terminals: new Set(["g"]) },
      open: [["g", "kept"]],
      crewHidden: new Set(["g"]),
    });
    const kids = (buildList(ctxOf(home, { apps }), view).top[0] as GathererNode).kids;
    expect(kids.map(outline)).toEqual([
      ["g/folder:1", ["g/inf"]],
      "g/new",
      "g/task:9",
      "g/old",
      "g/app:i2",
      ["1 terminal", ["g/shell:s"]],
      ["1 saved", ["g/kept"]], // folded, but open in a pane
      ["1 closed", ["g/shut"]],
    ]);
    const peek = (kids[6] as FoldNode).kids[0] as ActorRow;
    expect(peek).toMatchObject({ group: "Saved", open: true, saved: true });
  });

  it("marks the row in focus, those open, the one being named, and the selection", () => {
    const view = viewOf({
      focused: ["g", "new"],
      selected: ["g", "new"],
      open: [
        ["g", "new"],
        ["g", "old"],
      ],
      renaming: { g: "g", c: "old" },
      picks: { g: "g", cs: new Set(["new", "old"]) },
      tab: (k) => (k === "g\u0000new" ? { n: 2, here: true } : null),
    });
    const m = buildList(ctxOf(home, { apps }), view);
    const rows = (m.top[0] as GathererNode).kids.filter((n): n is ActorRow => n.kind === "actor");
    const by = Object.fromEntries(rows.map((r) => [r.a.channel, r]));
    expect(by.new).toMatchObject({
      current: true,
      open: false,
      picked: true,
      checked: true,
      tab: { n: 2, here: true },
    });
    expect(by.old).toMatchObject({ current: false, open: true, naming: true });
    expect((m.top[0] as GathererNode).picking).toBe(true);
    // this page's own pane out of sight: neither in focus nor open
    const away = buildList(ctxOf(home, { apps }), { ...view, away: true });
    const own = (away.top[0] as GathererNode).kids.find((n) => n.kind === "actor" && n.a.channel === "new");
    expect(own).toMatchObject({ current: false, open: false });
  });

  it("says each row's line: its name, else what it was asked, else nothing yet", () => {
    const named = actor("h", "n", { name: { text: "Parser", by: "user" }, last_user_message: "fix it" });
    const asked = actor("h", "a", { last_user_message: "line one\nline two" });
    const m = buildList(ctxOf({ gatherers: [gatherer("h", [named, asked, actor("h", "x")])] }), viewOf());
    const labels = (m.top[0] as GathererNode).kids.map((n) => (n as ActorRow).label);
    expect(labels).toEqual([
      { text: "Parser", cls: "" },
      { text: "line one", cls: "unnamed" },
      { text: "No message yet", cls: "none" },
    ]);
  });

  it("puts gatherers in their folders of gatherers, groups placed inside another's folder, and hidden ones aside", () => {
    const a = gatherer("a", [actor("a", "1")]),
      b = gatherer("b", [actor("b", "2")]),
      c = gatherer("c", [actor("c", "3")]),
      h = gatherer("h", [actor("h", "4")]);
    const ctx = ctxOf({
      gatherers: [a, b, c, h],
      gatherer_folders: { folders: [{ id: 5, parent: null, name: "Work" }], filed: { a: 5 } },
      places: { c: { in: "b", folder: null } },
      merged: true,
      hiding: { h: "hidden" },
    });
    const m = buildList(ctx, viewOf({ collapsed: new Set(["a"]) }));
    expect(m.top.map(outline)).toEqual([
      ["//folder:5", [["a", []]]],
      ["b", [["c", ["c/3"]], "b/2"]], // placed groups: after the box's folders, before its actors
    ]);
    expect(((m.top[1] as GathererNode).kids[0] as GathererNode).nested).toBe(true);
    expect(m.hidden.map((x) => [x.title, x.hidden])).toEqual([["h", true]]);
    expect(m.visible.map((x) => x.name)).toEqual(["a", "b", "c"]);
    const folded = buildList(ctx, viewOf({ gfFolded: new Set([5]) }));
    expect(folded.top.map(outline)[0]).toEqual(["//folder:5", null]);
  });

  it("lists the actors on their own closed in lines at the end, and the coordinator over everything at the top", () => {
    const shut = gatherer("self:a", [actor("self:a", "a", { status: "closed" })], { alone: true });
    const live = gatherer("self:b", [actor("self:b", "b")], { alone: true });
    const top = gatherer("self:c", [actor("self:c", "c", { role: "coordinator", over: "all" })], { alone: true });
    const m = buildList(ctxOf({ gatherers: [shut, live, top] }), viewOf());
    expect(m.top.map(outline)).toEqual([["self:b", ["self:b/b"]], [["1 closed", []]]]);
    expect(m.overAll).toMatchObject({ key: "self:c/c", label: { text: "Coordinates everything", cls: "none" } });
    expect(buildList(ctxOf({ gatherers: [] }), viewOf()).empty).toBe(
      "No groups yet. Make one with the folder button above.",
    );
  });

  it("shows a closed folder in its parent's closed line, all it holds under it once opened", () => {
    const b1 = actor("g", "b1", { status: "closed", last: 900 });
    const ctx = ctxOf({
      gatherers: [gatherer("g", [b1])],
      folders: {
        g: { folders: [{ id: 1, parent: null, name: "Done", closed: "1970-01-01T00:16:40Z" }], filed: { b1: 1 } },
      },
    });
    const view = viewOf({ foldOpen: { Closed: new Set(["g"]), Saved: new Set(), Terminals: new Set() } });
    const [fold] = (buildList(ctx, view).top[0] as GathererNode).kids as FoldNode[];
    expect(fold.says).toBe("1 closed");
    expect(fold.title).toBe("Hide the closed folders and actors");
    const folder = fold.kids[0] as FolderNode;
    expect(folder).toMatchObject({ closed: true, held: 1, kids: null });
    const opened = buildList(ctx, { ...view, foldersOpen: new Set(["g\u00001"]) });
    const inside = ((opened.top[0] as GathererNode).kids[0] as FoldNode).kids[0] as FolderNode;
    expect(inside.kids!.map(outline)).toEqual(["g/b1"]);
  });
});
