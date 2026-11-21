// A screen tab's panels worked out at once (plan.ts): the first task with actors in the page's own pane, its others beside
// it, each other task beside them in the order the page opened them, apps alone last, terminals kept, at most so many.
import { describe, expect, it } from "vitest";
import { tabPlan, type Open, type TaskFacts } from "./plan";

const task = (key: string, over: Partial<TaskFacts> = {}): TaskFacts => ({
  key,
  g: "g",
  first: null,
  rest: [],
  shut: false,
  views: {},
  apps: [],
  back: null,
  focusApp: null,
  mine: false,
  ...over,
});
const nothing: Open = { here: { g: "g", c: "old" }, view: "files", others: [], apps: [] };
const app = (id: string) => ({ app: "notes", id, g: "g" });

describe("tabPlan", () => {
  it("puts the first task's first actor in the page's own pane, in its view, and its others beside it", () => {
    const plan = tabPlan(
      [task("g\u0000t1", { first: "a", rest: ["b", "c"], views: { a: "terminal", c: "history" }, apps: [app("i1")] })],
      "g\u0000t1",
      nothing,
      4,
    );
    expect(plan.here).toEqual({ g: "g", c: "a", view: "terminal", shut: false, keep: false });
    // a pane beside takes the view of the one it is opened from, unless it was left with its own
    expect(plan.others).toEqual([
      { g: "g", c: "b", view: "terminal" },
      { g: "g", c: "c", view: "history" },
    ]);
    expect(plan.apps.map((a) => a.id)).toEqual(["i1"]);
    expect(plan.focus).toEqual({ g: "g", c: "a" });
    expect([plan.order, plan.appsOnly, plan.left]).toEqual([["g\u0000t1"], null, 0]);
  });

  it("opens each other task beside, those with actors before those of apps alone; a terminal kept, room counted", () => {
    const now: Open = { ...nothing, others: [{ g: "g", c: "shell:1", view: null, keep: true }] };
    const plan = tabPlan(
      [
        task("g\u0000app:i9", { apps: [app("i9")] }),
        task("g\u0000t1", { first: "a", rest: ["b"] }),
        task("g\u0000x", { first: "x", rest: ["y", "z"] }),
      ],
      "g\u0000app:i9",
      now,
      4,
    );
    expect(plan.order).toEqual(["g\u0000t1", "g\u0000x", "g\u0000app:i9"]);
    // b beside a; x beside the pane in focus then (a's: the first task laid out); y and z: no room (four at most)
    expect(plan.others.map((o) => o.c)).toEqual(["x", "b", "shell:1"]);
    expect(plan.left).toBe(2);
    expect(plan.apps.map((a) => a.id)).toEqual(["i9"]);
    expect(plan.focus).toEqual({ app: "i9" }); // the tab's task in focus: apps alone, its panel
  });

  it("keeps the actor the page opened on, its task not laid out yet; shows one closed by the reader out of sight", () => {
    const kept = tabPlan(
      [task("g\u0000t1", { first: "a", rest: ["b"], mine: true })],
      null,
      {
        ...nothing,
        here: { g: "g", c: "b" },
      },
      4,
    );
    expect(kept.here).toMatchObject({ c: "b", keep: true, view: null });
    expect(kept.others.map((o) => o.c)).toEqual([]); // (b's own pane is the page's; a is not in its rest)
    const shut = tabPlan(
      [task("g\u0000t1", { first: "a", shut: true, apps: [app("i1")], focusApp: "i1" })],
      null,
      nothing,
      4,
    );
    expect(shut.here).toMatchObject({ c: "a", shut: true });
    expect(shut.focus).toEqual({ app: "i1" });
  });

  it("shows a tab of apps alone with the actors' panes out of sight; the first task's panels open already kept", () => {
    const plan = tabPlan(
      [task("g\u0000t2", { apps: [app("i2"), app("i3")], focusApp: "i3" })],
      "g\u0000t2",
      {
        ...nothing,
        apps: [
          { ...app("i3"), task: "g\u0000t2" },
          { ...app("i8"), task: "g\u0000t8" },
        ],
      },
      4,
    );
    expect([plan.appsOnly, plan.here]).toEqual(["g\u0000t2", null]);
    expect(plan.apps.map((a) => a.id)).toEqual(["i3", "i2"]);
    expect(plan.focus).toEqual({ app: "i3" });
  });

  it("puts the focus back on the actor in focus when the task was left", () => {
    const plan = tabPlan([task("g\u0000t1", { first: "a", rest: ["b", "c"], back: "c" })], "g\u0000t1", nothing, 4);
    expect(plan.focus).toEqual({ g: "g", c: "c" });
  });
});
