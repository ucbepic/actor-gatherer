// What a task of a tab opens as it was left (facts.ts's factsOf), and the keys a task reads as now that items joined or
// left it (taskKeysNow).
import { describe, expect, it } from "vitest";
import { factsOf, taskKeysNow, type FactsIn } from "./facts";
import type { Left } from "./model";

const left = (over: Partial<Left> = {}): Left => ({
  actors: [],
  apps: [],
  focus: null,
  focusApp: null,
  views: {},
  shut: null,
  ...over,
});
const app = (id: string) => ({ app: "notes", id, g: "g" });
const task = (over: Partial<FactsIn> = {}): FactsIn => ({
  key: "g\u0000t1",
  g: "g",
  kind: "task",
  id: "t1",
  members: ["a", "b", "c"],
  lead: "a",
  order: ["a", "b", "c"],
  was: null,
  open: () => true,
  apps: () => [],
  mine: false,
  selected: null,
  ...over,
});

describe("factsOf, a task of several items", () => {
  it("never left: its lead first, its others in order, its apps for that actor", () => {
    const asked: (string | null)[] = [];
    const f = factsOf(task({ apps: (first) => (asked.push(first), [app("i1")]) }));
    expect(f).toMatchObject({ first: "a", rest: ["b", "c"], shut: false, back: null, focusApp: null, mine: false });
    expect(f.apps).toEqual([app("i1")]);
    expect(asked).toEqual(["a"]);
  });
  it("as it was left: its first actor then first, its others as they were, closed ones left out, its views", () => {
    const f = factsOf(
      task({
        was: left({ actors: ["c", "b", "x"], focus: "b", views: { c: "terminal" } }),
        open: (c) => c !== "x",
      }),
    );
    expect(f).toMatchObject({ first: "c", rest: ["b"], back: "b", views: { c: "terminal" } });
  });
  it("the actor asked for first, nothing of what was in focus then", () => {
    const f = factsOf(task({ was: left({ actors: ["b", "c"], focus: "b", focusApp: "i1" }) }), "c");
    expect(f).toMatchObject({ first: "c", rest: ["b"], back: null, focusApp: null });
  });
  it("an actor asked for that is not its own is not taken", () => {
    expect(factsOf(task(), "z").first).toBe("a");
  });
  it("its pane closed by the reader, none of its others open: that actor out of sight, its first app in focus", () => {
    const f = factsOf(
      task({ was: left({ actors: [], shut: "b", apps: [{ app: "notes", id: "i1" }] }), apps: () => [app("i1")] }),
    );
    expect(f).toMatchObject({ first: "b", shut: true, focusApp: "i1" });
  });
  it("apps alone (no actor to open first): its first app in focus", () => {
    const f = factsOf(task({ members: [], lead: null, order: [], apps: () => [app("i2")] }));
    expect(f).toMatchObject({ first: null, focusApp: "i2", mine: false });
  });
  it("the page's own pane showing one of its actors already: so told, while it opens one", () => {
    expect(factsOf(task({ mine: true })).mine).toBe(true);
  });
});

describe("factsOf, an item alone", () => {
  it("an app: its apps, no actor", () => {
    const f = factsOf(task({ kind: "app", id: "app:i1", apps: () => [app("i1")] }));
    expect(f).toMatchObject({ first: null, rest: [], apps: [app("i1")], views: {} });
  });
  it("an actor: itself first, the others it was left with beside it; mine only if it is the one shown", () => {
    const base = task({
      kind: "actor",
      id: "a",
      members: ["a"],
      was: left({ actors: ["a", "b"], views: { a: "history" } }),
    });
    expect(factsOf(base)).toMatchObject({ first: "a", rest: ["b"], views: { a: "history" } });
    expect(factsOf({ ...base, mine: true, selected: "b" }).mine).toBe(false);
    expect(factsOf({ ...base, mine: true, selected: "a" }).mine).toBe(true);
  });
});

describe("taskKeysNow", () => {
  const tasks = { tasks: [{ id: 1 }], tasked: { a: 1, b: 1 } };
  const keyOf = (item: string) => `g\u0000${item}`;
  it("a task still there, holding what it held: itself", () => {
    expect(taskKeysNow("g\u0000t1", 1, tasks, ["a", "b"], new Set(["a", "b"]), keyOf)).toEqual(["g\u0000t1"]);
  });
  it("an item taken out of it, its panel open: itself and that item's own", () => {
    const now = { tasks: [{ id: 1 }], tasked: { a: 1 } };
    expect(taskKeysNow("g\u0000t1", 1, now, ["a", "b"], new Set(["a", "b"]), keyOf)).toEqual(["g\u0000t1", "g\u0000b"]);
  });
  it("an item taken out of it and closed: not kept", () => {
    const now = { tasks: [{ id: 1 }], tasked: { a: 1 } };
    expect(taskKeysNow("g\u0000t1", 1, now, ["a", "b"], new Set(["a"]), keyOf)).toEqual(["g\u0000t1"]);
  });
  it("a task gone: the items it held still open, each its own; none held, itself", () => {
    const none = { tasks: [], tasked: {} };
    expect(taskKeysNow("g\u0000t1", 1, none, ["a", "b"], new Set(["a", "b"]), keyOf)).toEqual(["g\u0000a", "g\u0000b"]);
    expect(taskKeysNow("g\u0000t1", 1, none, [], new Set(), keyOf)).toEqual(["g\u0000t1"]);
  });
});
