// The work area built from the panels shown (work.ts): each task a block, laid out as its arrangement says -- made the
// first time it shows (or from an older page's layout), a panel opened since put where its kind goes.
import { describe, expect, it } from "vitest";
import { leaves } from "./arrange";
import { addItem, build, firstTree, leafId, type Shown } from "./work";
import type { Node, Split } from "./tree";

const at = (key: string | null, item: string): Shown<string> => ({
  key,
  item,
  node: item,
  app: item.startsWith("app:"),
});
const T = "g\u0000t1",
  U = "g\u0000t2";
const opts = { min: false, top: null, h: 900 };
const shape = (n: Node | null): unknown =>
  !n
    ? null
    : "kids" in n
      ? [n.dir, n.kids.map(shape), n.sizes.map((z) => z.share ?? z.px ?? (z.fit ? "fit" : z.top ? "top" : z))]
      : n.id;

describe("a task's arrangement the first time it shows", () => {
  it("puts its apps side by side above its actors side by side", () => {
    expect(shape(firstTree([at(T, "c1"), at(T, "c2"), at(T, "app:b")], null))).toEqual([
      "col",
      ["app:b", ["row", ["c1", "c2"], [1, 1]]],
      ["top", 1],
    ]);
  });

  it("holds every pane an older page had open in the task, each shown as it opens, in its order and width", () => {
    const old = { actors: ["c1", "c2"], sizes: { c1: 0.5, c2: 1.5 } };
    expect(shape(firstTree([at(T, "c1")], old))).toEqual(["row", ["c1", "c2"], [0.5, 1.5]]);
  });

  it("is made from an older page's layout: its widths and its row's height", () => {
    const old = { sizes: { c1: 0.6, c2: 1.4 }, apps: [{ id: "b", size: 1 }], topH: 400 };
    expect(shape(firstTree([at(T, "c1"), at(T, "c2"), at(T, "app:b")], old))).toEqual([
      "col",
      ["app:b", ["row", ["c1", "c2"], [0.6, 1.4]]],
      [395, 1],
    ]);
  });
});

describe("a panel opened in a task since", () => {
  const items = [at(T, "c1"), at(T, "c3"), at(T, "c2"), at(T, "app:b")];
  it("goes after the one before it of its kind, as a pane opened beside another goes right of it", () => {
    const tree = firstTree([at(T, "c1"), at(T, "c2"), at(T, "app:b")], null)!;
    expect(leaves(addItem(tree, items[1], items))).toEqual(["app:b", "c1", "c3", "c2"]);
  });

  it("an app with none of its kind goes above them all; an actor with none, below", () => {
    const actors = firstTree([at(T, "c1")], null)!;
    const t = addItem(actors, at(T, "app:n"), [at(T, "c1"), at(T, "app:n")]) as Split;
    expect(shape(t)).toEqual(["col", ["app:n", "c1"], ["top", 1]]);
  });
});

describe("the work area built", () => {
  it("lays out each task shown as a block of its own, side by side, its panels not shown left out", () => {
    const kept = { [T]: firstTree([at(T, "c1"), at(T, "c2"), at(T, "app:b")], null)! };
    const b = build([at(T, "c1"), at(T, "app:b"), at(U, "c9"), at(null, "shell-1")], kept, () => null, opts);
    expect(b.blocks).toEqual([T, U, "\u0002shell-1"]);
    const t = b.tree as Split;
    expect(t.key).toBe("screen");
    expect(t.kids.map(leaves)).toEqual([
      [leafId(T, "app:b"), leafId(T, "c1")],
      [leafId(U, "c9")],
      [leafId("\u0002shell-1", "shell-1")],
    ]);
    expect(Object.keys(b.added)).toEqual([U]); // a terminal's is kept nowhere; T's had all it shows
    expect(leaves(kept[T])).toEqual(["app:b", "c1", "c2"]); // c2, not shown, kept in its place
  });

  it("makes the apps' row never dragged as tall as the one dragged last, else half the column, the band in it", () => {
    const items = [at(T, "c1"), at(T, "app:b")];
    const band = (top: number | null) => (build(items, {}, () => null, { ...opts, top }).tree as Split).sizes[0];
    expect(band(null)).toEqual({ px: 445, min: 135 });
    expect(band(520)).toEqual({ px: 515, min: 135 });
    const t = build(items, {}, () => null, opts).tree as Split;
    expect([t.thick, t.bar]).toEqual([true, 5]);
  });

  it("with the chat minimized under the apps: its panes as tall as what they show, the band not dragged", () => {
    const t = build([at(T, "c1"), at(T, "c2"), at(T, "app:b")], {}, () => null, { ...opts, min: true }).tree as Split;
    expect(shape(t)).toEqual([
      "col",
      [leafId(T, "app:b"), ["row", [leafId(T, "c1"), leafId(T, "c2")], [1, 1]]],
      [1, "fit"],
    ]);
    expect(t.still).toBe(true);
  });

  it("puts the blocks of apps alone above the others, as an app's panel always was", () => {
    const lone = "g\u0000app:n";
    const t = build([at(T, "c1"), at(lone, "app:n"), at(U, "c9")], {}, () => null, opts).tree as Split;
    expect(shape(t)).toEqual([
      "col",
      [leafId(lone, "app:n"), ["row", [leafId(T, "c1"), leafId(U, "c9")], [1, 1]]],
      [445, 1],
    ]);
    expect([t.key, t.thick]).toEqual(["screen-band", true]);
  });

  it("knows each panel's element, its block and its item", () => {
    const b = build([at(T, "c1"), at(T, "app:b")], {}, () => null, opts);
    expect(b.nodes.get(leafId(T, "app:b"))).toBe("app:b");
    expect(b.items.get(leafId(T, "c1"))).toEqual({ block: T, key: T, item: "c1" });
  });
});
