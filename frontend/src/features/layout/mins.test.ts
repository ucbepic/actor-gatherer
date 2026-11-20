// Panes minimized by the bar beside them dragged past their least (mins.ts's foldable): a task's panes one above or below
// something of it, every panel of that kid a pane -- not an app's, nor one of the blocks' own arrangement.
import { describe, expect, it } from "vitest";
import { leaves, leafNodes } from "./arrange";
import { build, firstTree, type Shown } from "./build";
import { canMin, foldable, marked, markingOf, minimized, takes, together } from "./mins";
import type { Node, Split } from "./tree";

const at = (key: string | null, item: string): Shown<string> => ({
  key,
  item,
  node: item,
  app: item.startsWith("app:"),
});
const T = "g\u0000t1",
  U = "g\u0000t2";
const opts = { top: null, h: 900 };
const items = (built: ReturnType<typeof build<string>>, ids: string[]) => ids.map((id) => built.items.get(id)!.item);
// the work area built (as work.ts does): with each task's arrangement made, and how to build it again with panes marked
function built0(shown: Shown<string>[], trees: Record<string, Node>, o: Parameters<typeof build<string>>[3] = opts) {
  const b = build(shown, trees, () => null, o),
    all = { ...trees, ...b.added };
  return { b, marking: markingOf(b, all, (t) => build(shown, t, () => null, o)) };
}
const key = (built: ReturnType<typeof build<string>>, task: string | null, dir: string) =>
  [...built.splits.values()].find((s) => s.task === task && s.dir === dir && !s.screen)!.key;

describe("the panes a bar minimizes, dragged past their least", () => {
  it("is the panes under their task's app, side by side or alone -- never the app's row above them", () => {
    const shown = [at(T, "app:b"), at(T, "c1"), at(T, "c2")];
    const built = build(shown, {}, () => null, opts);
    const col = key(built, T, "col");
    expect(items(built, foldable(built, col, 1))).toEqual(["c1", "c2"]);
    expect(foldable(built, col, 0)).toEqual([]);
    expect(foldable(built, key(built, T, "row"), 0)).toEqual([]); // (side by side: a bar between widths)
  });

  it("is either of two panes one above the other", () => {
    const tree: Node = { key: "", dir: "col", bar: 1, kids: [{ id: "c1" }, { id: "c2" }], sizes: [{}, {}] };
    const built = build([at(T, "c1"), at(T, "c2")], { [T]: tree }, () => null, opts);
    const col = key(built, T, "col");
    expect(items(built, foldable(built, col, 0))).toEqual(["c1"]);
    expect(items(built, foldable(built, col, 1))).toEqual(["c2"]);
  });

  it("is none where an app is among them", () => {
    const tree: Node = {
      key: "",
      dir: "col",
      bar: 1,
      kids: [{ id: "app:b" }, { key: "", dir: "row", bar: 1, kids: [{ id: "c1" }, { id: "app:n" }], sizes: [{}, {}] }],
      sizes: [{ top: true }, {}],
    };
    const built = build([at(T, "app:b"), at(T, "c1"), at(T, "app:n")], { [T]: tree }, () => null, opts);
    expect(foldable(built, key(built, T, "col"), 1)).toEqual([]);
  });

  it("between two tasks one above the other, is a task of panes alone -- not one with an app, nor a terminal's", () => {
    const screen: Node = {
      key: "",
      dir: "col",
      bar: 1,
      kids: [{ id: T }, { id: U }, { id: "\u0002t" }],
      sizes: [{}, {}, {}],
    };
    const shown = [at(T, "app:b"), at(T, "c1"), at(U, "c2"), at(null, "t")];
    const built = build(shown, {}, () => null, { ...opts, screen, strip: (b) => b });
    const col = [...built.splits.values()].find((s) => s.screen)!.key;
    expect(foldable(built, col, 0)).toEqual([]); // Notepad above Claude's pane, under their strip
    expect(items(built, foldable(built, col, 1))).toEqual(["c2"]);
    expect(foldable(built, col, 2)).toEqual([]); // (a terminal's: kept nowhere)
    const trees = { [T]: firstTree(shown.slice(0, 2), null)!, [U]: minimized({ id: "c2" }, ["c2"], true) };
    const min = build(shown, trees, () => null, { ...opts, screen, strip: (b) => b });
    const s = [...min.splits.values()].find((x) => x.screen)!;
    expect(s.sizes.map((z) => !!z.fit)).toEqual([false, true, false]); // as long as its message box
    expect([...min.minimized].map((id) => min.items.get(id)!.item)).toEqual(["c2"]);
    expect(
      [...min.under].map((id) => min.items.get(id)!.item).sort(), // each task's: above or below another
    ).toEqual(["app:b", "c1", "c2"]); // (a terminal's, of no task: never minimized)
    const side = build(shown.slice(0, 3), trees, () => null, {
      ...opts,
      screen: { key: "", dir: "row", bar: 1, kids: [{ id: T }, { id: U }], sizes: [{}, {}] },
    });
    expect(side.minimized.size).toBe(0); // side by side: shown whole
  });

  it("minimized, is as long as what it shows -- its sizes kept to show it whole again", () => {
    const tree = firstTree([at(T, "app:b"), at(T, "c1"), at(T, "c2")], null)!;
    const folded = minimized(tree, ["c1", "c2"], true);
    expect(leafNodes(folded).map((l) => [l.id, !!l.min])).toEqual([
      ["app:b", false],
      ["c1", true],
      ["c2", true],
    ]);
    const built = build([at(T, "app:b"), at(T, "c1"), at(T, "c2")], { [T]: folded }, () => null, opts);
    expect(built.splits.get(key(built, T, "col"))!.sizes[1]).toEqual({ fit: true });
    expect(minimized(folded, ["c1", "c2"], false)).toEqual(tree);
    expect(leaves(folded)).toEqual(leaves(tree));
  });
});

describe("panes minimized by a pane's own button, or shown whole: those beside it with it", () => {
  const ids = (built: ReturnType<typeof build<string>>, of: string[]) => items(built, of).sort();
  const id = (built: ReturnType<typeof build<string>>, item: string) =>
    [...built.items].find(([, v]) => v.item === item)![0];
  const row = (...kids: Node[]): Node => ({ key: "", dir: "row", bar: 1, kids, sizes: kids.map(() => ({})) });
  const col = (...kids: Node[]): Node => ({ key: "", dir: "col", bar: 1, kids, sizes: kids.map(() => ({})) });

  it("two panes side by side under their task's app: both, either's button -- minimized or shown whole", () => {
    const shown = [at(T, "app:b"), at(T, "c1"), at(T, "c2")];
    const built = build(shown, {}, () => null, opts);
    for (const on of [true, false]) {
      expect(ids(built, together(built, id(built, "c1"), on))).toEqual(["c1", "c2"]);
      expect(ids(built, together(built, id(built, "c2"), on))).toEqual(["c1", "c2"]);
    }
    const tree = firstTree(shown, null)!;
    const min = marked(built, together(built, id(built, "c2"), true), true, () => tree).get(T)!;
    expect(leafNodes(min).map((l) => [l.id, !!l.min])).toEqual([
      ["app:b", false],
      ["c1", true],
      ["c2", true],
    ]);
    const after = build(shown, { [T]: min }, () => null, opts);
    expect(ids(after, [...after.minimized])).toEqual(["c1", "c2"]);
    expect(marked(after, together(after, id(after, "c1"), false), false, () => min).get(T)).toEqual(tree);
  });

  it("one above the other: that one alone", () => {
    const built = build([at(T, "c1"), at(T, "c2")], { [T]: col({ id: "c1" }, { id: "c2" }) }, () => null, opts);
    expect(ids(built, together(built, id(built, "c1"), true))).toEqual(["c1"]);
  });

  it("an app beside it: never minimized (a blank would stand above it), nor offered", () => {
    const tree = col({ id: "c0" }, row({ id: "app:b" }, { id: "c1" }));
    const { b: built, marking } = built0([at(T, "c0"), at(T, "app:b"), at(T, "c1")], { [T]: tree });
    expect(built.under.has(id(built, "c1"))).toBe(true);
    expect(together(built, id(built, "c1"), true)).toEqual([]);
    expect(canMin(built, "c1", marking)).toBe(false);
    expect(canMin(built, "c0", marking)).toBe(true); // (above them: alone in its kid)
  });

  it("two tasks side by side under a third: both tasks' panes, each in its own task's arrangement", () => {
    const V = "g\u0000t3";
    const shown = [at(V, "app:b"), at(T, "c1"), at(U, "c2")];
    const screen = col({ id: V }, row({ id: T }, { id: U }));
    const built = build(shown, {}, () => null, { ...opts, screen });
    const both = together(built, id(built, "c1"), true);
    expect(ids(built, both)).toEqual(["c1", "c2"]);
    const trees = marked(built, both, true, (task) => ({ id: task === T ? "c1" : "c2" }));
    expect([...trees.keys()].sort()).toEqual([T, U]);
    const min = build(shown, Object.fromEntries(trees), () => null, { ...opts, screen });
    expect(ids(min, [...min.minimized])).toEqual(["c1", "c2"]);
    const one = build(shown, { [T]: trees.get(T)! }, () => null, { ...opts, screen }); // c2 whole: c1 shown whole too
    expect(one.minimized.size).toBe(0);
  });

  it("a row further out: minimized with all of it; one shown whole, the row with it -- not a column inside it", () => {
    const tree = col({ id: "app:b" }, row({ id: "a" }, col({ id: "b" }, { id: "c" })));
    const shown = [at(T, "app:b"), at(T, "a"), at(T, "b"), at(T, "c")];
    const built = build(shown, { [T]: tree }, () => null, opts);
    expect(ids(built, together(built, id(built, "a"), true))).toEqual(["a", "b", "c"]);
    expect(ids(built, together(built, id(built, "b"), true))).toEqual(["b"]);
    expect(ids(built, together(built, id(built, "b"), false))).toEqual(["a", "b"]); // c stays, in its column
    expect(ids(built, together(built, id(built, "a"), false))).toEqual(["a", "b", "c"]);
  });
});

describe("panes minimized only where something whole is left above or below them, to take the room", () => {
  const col = (...kids: Node[]): Node => ({ key: "", dir: "col", bar: 1, kids, sizes: kids.map(() => ({})) });
  const min = (id: string): Node => ({ id, min: true });
  const shownOf = (built: ReturnType<typeof build<string>>) =>
    [...built.minimized].map((i) => built.items.get(i)!.item);

  it("two panes one above the other: either minimized, the other then not; both marked (kept so), both shown whole", () => {
    const shown = [at(T, "c1"), at(T, "c2")];
    const fresh = built0(shown, { [T]: col({ id: "c1" }, { id: "c2" }) });
    expect(canMin(fresh.b, "c1", fresh.marking)).toBe(true);
    expect(canMin(fresh.b, "c2", fresh.marking)).toBe(true);
    const one = built0(shown, { [T]: col(min("c1"), { id: "c2" }) });
    expect(shownOf(one.b)).toEqual(["c1"]);
    expect(canMin(one.b, "c2", one.marking)).toBe(false); // (nothing whole left: a blank below them)
    expect(takes(foldable(one.b, key(one.b, T, "col"), 1), one.marking)).toBe(false); // nor by its bar
    const both = build(shown, { [T]: col(min("c1"), min("c2")) }, () => null, opts);
    expect(both.minimized.size).toBe(0);
    expect((both.tree as Split).sizes.map((z) => !!z.fit)).toEqual([false, false]); // sharing the column
  });

  it("an app above them: each minimized, both -- the app takes the room", () => {
    const shown = [at(T, "app:b"), at(T, "c1"), at(T, "c2")];
    const one = built0(shown, { [T]: col({ id: "app:b" }, min("c1"), { id: "c2" }) });
    expect(canMin(one.b, "c2", one.marking)).toBe(true);
    const both = build(shown, { [T]: col({ id: "app:b" }, min("c1"), min("c2")) }, () => null, opts);
    expect(shownOf(both).sort()).toEqual(["c1", "c2"]);
  });

  it("two tasks one above the other: one minimized, not the other; a task of its panes all minimized, as long as them", () => {
    const shown = [at(T, "c1"), at(U, "c2")];
    const screen = col({ id: T }, { id: U });
    const one = built0(shown, { [T]: min("c1"), [U]: { id: "c2" } }, { ...opts, screen });
    expect(shownOf(one.b)).toEqual(["c1"]);
    expect(canMin(one.b, "c2", one.marking)).toBe(false);
    // a task of two panes one above the other, both marked, over a task whole: its column as long as they are
    const shown3 = [at(T, "c1"), at(T, "c3"), at(U, "c2")];
    const stacked = build(shown3, { [T]: col(min("c1"), min("c3")), [U]: { id: "c2" } }, () => null, {
      ...opts,
      screen,
    });
    expect(shownOf(stacked).sort()).toEqual(["c1", "c3"]);
  });
});
