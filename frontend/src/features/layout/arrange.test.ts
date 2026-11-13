// A task's arrangement changed by the reader (arrange.ts): a panel put beside another, swapped, along a side, taken out;
// the tree as it shows the panels open, a bar dragged in it kept in the tree it came from; where a drop goes.
import { describe, expect, it } from "vitest";
import { insert, keepSizes, leaves, move, remove, swap, toSide, view, zoneAt, zoneRect } from "./arrange";
import type { Node, Split } from "./tree";

const S = (dir: "row" | "col", kids: Node[], shares: number[] = kids.map(() => 1)): Split => ({
  key: "",
  dir,
  bar: 1,
  kids,
  sizes: shares.map((share) => ({ share })),
});
const L = (id: string): Node => ({ id });
// at first: the apps above (as tall as dragged last), the actors below
const first = (): Split => ({
  key: "",
  dir: "col",
  bar: 5,
  kids: [L("app:b"), S("row", [L("c1"), L("c2")])],
  sizes: [{ top: true }, { share: 1 }],
});
// a tree's shape, ids and sizes only, to compare
const shape = (n: Node | null): unknown =>
  !n
    ? null
    : "kids" in n
      ? [n.dir, n.kids.map(shape), n.sizes.map((z) => z.share ?? z.px ?? (z.top ? "top" : z))]
      : n.id;

describe("a panel moved", () => {
  it("dropped on a side of another: the two side by side, in its place", () => {
    // the chat at the Browser's left: the Browser's row a row of the two, the other chat below alone
    const t = move(first(), "c1", "app:b", "left");
    expect(shape(t)).toEqual(["col", [["row", ["c1", "app:b"], [1, 1]], "c2"], ["top", 1]]);
  });

  it("dropped on a side of one in a split that way: beside it there, the two sharing its room", () => {
    const t = insert(S("row", [L("a"), L("b")], [2, 1]), "a", "x", "right");
    expect(shape(t)).toEqual(["row", ["a", "x", "b"], [1, 1, 1]]);
  });

  it("dropped on another's middle: the two swapped", () => {
    expect(leaves(move(first(), "c2", "app:b", "center"))).toEqual(["c2", "c1", "app:b"]);
  });

  it("onto itself, or onto one not in the tree: nothing changes", () => {
    const t = first();
    expect(move(t, "c1", "c1", "left")).toBe(t);
    expect(move(t, "c1", "zz", "left")).toBe(t);
  });

  it("leaves no split of one kid, nor a row in a row", () => {
    // c2 out of the chats' row: c1 alone takes the row's place
    expect(shape(remove(first(), "c2"))).toEqual(["col", ["app:b", "c1"], ["top", 1]]);
    // a row put in a row's middle: its kids taken into it, their shares as theirs of its share
    const t = insert(S("row", [S("col", [L("a"), L("b")]), L("c")], [2, 2]), "a", "x", "left");
    expect(shape(remove(t, "b"))).toEqual(["row", ["x", "a", "c"], [1, 1, 2]]);
  });

  it("along a whole side: one more kid of a tree split that way, else the halves of a split of its own", () => {
    expect(shape(toSide(first(), "c2", "left"))).toEqual(["row", ["c2", ["col", ["app:b", "c1"], ["top", 1]]], [1, 1]]);
    expect(shape(toSide(S("row", [L("a"), L("b"), L("c")], [1, 2, 3]), "a", "right"))).toEqual([
      "row",
      ["b", "c", "a"],
      [2, 3, 2.5],
    ]);
  });

  it("swapped from its menu: each in the other's place, every size as it was", () => {
    expect(shape(swap(first(), "app:b", "c1"))).toEqual(["col", ["c1", ["row", ["app:b", "c2"], [1, 1]]], ["top", 1]]);
  });
});

describe("the tree as it shows the panels open", () => {
  it("leaves out the others, each split shown knowing where its kids are in the one kept", () => {
    const kept = S("row", [L("a"), L("b"), L("c")], [1, 2, 3]);
    const v = view(kept, (id) => id !== "b") as Split;
    expect(shape(v)).toEqual(["row", ["a", "c"], [1, 3]]);
    expect(v.src).toBe(kept);
    expect(v.at).toEqual([0, 2]);
    keepSizes(v, [{ share: 2.5 }, { share: 1.5 }]); // its bar dragged
    expect(kept.sizes.map((z) => z.share)).toEqual([2.5, 2, 1.5]); // the one not shown as it was
  });

  it("gives a split shown with one kid's place to that kid; none shown, nothing", () => {
    expect(shape(view(first(), (id) => id !== "c2"))).toEqual(["col", ["app:b", "c1"], ["top", 1]]);
    expect(view(first(), () => false)).toBe(null);
  });

  it("keeps a length of its own dragged as that length, nothing else of it", () => {
    const kept = first(),
      v = view(kept, () => true) as Split;
    keepSizes(v, [
      { px: 300, min: 135 },
      { share: 1, min: 220 },
    ]);
    expect(kept.sizes).toEqual([{ px: 300 }, { share: 1 }]);
  });
});

describe("where a drop goes", () => {
  const r = { x: 100, y: 0, w: 400, h: 200 };
  it("on the side nearest, within a quarter of the panel from it; in its place nearer the middle", () => {
    expect(zoneAt(r, 120, 100)).toBe("left");
    expect(zoneAt(r, 480, 100)).toBe("right");
    expect(zoneAt(r, 300, 20)).toBe("top");
    expect(zoneAt(r, 300, 190)).toBe("bottom");
    expect(zoneAt(r, 300, 100)).toBe("center");
  });
  it("takes half the panel on that side, or all of it", () => {
    expect(zoneRect(r, "right")).toEqual({ x: 300, y: 0, w: 200, h: 200 });
    expect(zoneRect(r, "bottom")).toEqual({ x: 100, y: 100, w: 400, h: 100 });
    expect(zoneRect(r, "center")).toEqual(r);
  });
});
