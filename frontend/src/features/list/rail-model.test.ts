// The rail's view-model: what nav#rail draws, in its order, from a home, the list's view and the rail's own.
import { describe, expect, it } from "vitest";
import { buildRail, type RailView, type RNode } from "./rail-model";
import { actor, app, ctxOf, gatherer, viewOf } from "./testing";

/** A node as its key, and what is in it, so a rail reads as an outline. */
function outline(n: RNode): unknown {
  switch (n.kind) {
    case "gatherer":
    case "folder":
    case "alone":
    case "gf":
    case "here":
      return [n.key, n.kids.map(outline)];
    case "fold":
      return `[${n.says}]`;
    case "none":
      return `(${n.text})`;
    default:
      return n.key;
  }
}
const railOf = (more: Partial<RailView> = {}): RailView => ({
  show: { folders: false, saved: false, closed: false },
  busyFolded: new Set(),
  at: null,
  dragging: null,
  ...more,
});

describe("the rail", () => {
  const crew = actor("g", "crew", { role: "coordinator" });
  const busy = actor("g", "busy", { created: 5, status: "running" }),
    idle = actor("g", "idle", { created: 4 });
  const shut = actor("g", "shut", { status: "closed", last: 50 }),
    kept = actor("g", "kept", { status: "closed", last: 60 });
  const t1 = actor("g", "t1", { created: 3, status: "asking" }),
    t2 = actor("g", "t2", { created: 2 });
  const g = gatherer("g", [crew, busy, idle, shut, kept, t1, t2]);
  const home = {
    gatherers: [g],
    folders: {
      g: {
        folders: [
          { id: 1, parent: null, name: "Busy" },
          { id: 2, parent: null, name: "Quiet" },
          { id: 3, parent: 1, name: "Inner" },
        ],
        filed: { busy: 3, shut: 2 },
      },
    },
    saved: { g: { kept: "2026-01-01" } },
    tasks: { g: { tasks: [{ id: 9 }], tasked: { t1: 9, t2: 9 } } },
  };
  const apps = { g: [app("g", "i1")] };

  it("draws a gatherer's coordinator agent, its busy folders open, its tiles -- a task once -- then its apps", () => {
    const m = buildRail(ctxOf(home, { apps }), viewOf(), railOf());
    expect(m.nodes.map(outline)).toEqual([
      [
        "g:g",
        [
          "a:g/crew",
          // busy, open; Quiet (only a closed actor in it) left out, as are the saved and closed lines
          ["f:g/1", [["f:g/3", ["a:g/busy"]]]],
          "a:g/idle",
          "t:g/9",
          "o:g/i1",
        ],
      ],
    ]);
    expect(m.foot).toBe(true);
    const task = (m.nodes[0] as { kids: RNode[] }).kids.find((n) => n.kind === "task");
    expect(task).toMatchObject({ n: 2, dot: true, what: "2 actors", first: "t1", face: t1 });
  });

  it("shows every folder, and its saved and closed lines, as its foot says; a busy folder folded by the reader", () => {
    const show = { folders: true, saved: true, closed: true };
    const m = buildRail(
      ctxOf(home, { apps }),
      viewOf(),
      railOf({ show, busyFolded: new Set(["g\u00001", "g\u00002"]) }),
    );
    expect(m.nodes.map(outline)).toEqual([
      // the coordinator agent first, as in the list; then its saved line (no closed one: Quiet's actor is in Quiet), its
      // folders -- Busy folded by the reader in the rail -- its tiles
      ["g:g", ["a:g/crew", "[1 saved]", ["f:g/1", []], ["f:g/2", []], "a:g/idle", "t:g/9", "o:g/i1"]],
    ]);
    expect(m.forget).toEqual(["g\u00002"]); // Quiet is busy no more: forgotten
    expect((m.nodes[0] as { kids: RNode[] }).kids[1]).toMatchObject({
      kind: "fold",
      name: "Saved",
      foldKey: "g",
      shown: false,
    });
  });

  it("folded, a gatherer shows its counts and its actors open in a pane", () => {
    const view = viewOf({ collapsed: new Set(["g"]), open: [["g", "idle"]] });
    const m = buildRail(ctxOf(home, { apps }), view, railOf());
    expect(m.nodes.map(outline)).toEqual([["g:g", ["a:g/idle"]]]);
    expect(m.nodes[0]).toMatchObject({ open: false, counts: { kind: "counts", c: { asking: 1, running: 1 } } });
  });

  it("drilled into a folder: the path over it, Up to the folder it is in, then what is in it", () => {
    const m = buildRail(ctxOf(home, { apps }), viewOf(), railOf({ at: { g: "g", f: 3 } }));
    expect(m.nodes.map(outline)).toEqual([["here:g/3", ["a:g/busy"]]]);
    expect(m.nodes[0]).toMatchObject({
      name: "Inner",
      up: "Up: Busy",
      upAt: { g: "g", f: 1 },
      steps: [
        { name: "g", at: { g: "g", f: null } },
        { name: "Busy", at: { g: "g", f: 1 } },
      ],
    });
    // gone: its gatherer's top
    const gone = buildRail(ctxOf(home, { apps }), viewOf(), railOf({ at: { g: "g", f: 77 } }));
    expect(gone.nodes[0]).toMatchObject({ kind: "here", f: null, up: "Up: every group", upAt: null });
  });

  it("the actors on their own closed, in their lines at the end, as its foot says", () => {
    const lone = gatherer("self:x", [actor("self:x", "x", { status: "closed" })], { alone: true });
    const both = { ...home, gatherers: [g, lone], merged: true };
    expect(buildRail(ctxOf(both), viewOf(), railOf()).nodes.map(outline).slice(1)).toEqual([]);
    const m = buildRail(ctxOf(both), viewOf(), railOf({ show: { folders: false, saved: false, closed: true } }));
    expect(m.nodes.map(outline).slice(1)).toEqual([["alone:shut", ["[1 closed]"]]]);
  });

  it("an actor's tile: who it is, and whether it is the one shown, open beside, or selected", () => {
    const view = viewOf({
      focused: ["g", "idle"],
      open: [["g", "busy"]],
      picks: { g: "g", cs: new Set(["idle", "busy"]) },
    });
    const m = buildRail(ctxOf(home, { apps }), view, railOf());
    const kids = (m.nodes[0] as { kids: RNode[] }).kids;
    expect(kids.find((n) => n.key === "a:g/idle")).toMatchObject({
      current: true,
      open: false,
      checked: true,
      card: "g\u0000idle",
      name: { text: "No message yet", cls: "none" },
    });
    expect(kids.find((n) => n.key === "a:g/crew")).toMatchObject({ name: { text: "Coordinator agent", cls: "none" } });
    expect(buildRail(ctxOf({ gatherers: [] }), viewOf(), railOf())).toMatchObject({
      nodes: [{ kind: "none", text: "No groups" }],
      foot: false,
    });
  });
});
