// The tasks shown, arranged (blocks.ts): those no longer shown left out, one newly shown where it was dropped, else where
// a task shown so goes.
import { describe, expect, it } from "vitest";
import { leaves } from "./arrange";
import { arrangeBlocks } from "./blocks";
import type { Node, Split } from "./tree";

const row = (...ids: string[]): Split => ({
  key: "",
  dir: "row",
  bar: 1,
  kids: ids.map((id) => ({ id })),
  sizes: ids.map(() => ({ share: 1 })),
});
const shape = (n: Node | null): unknown => (!n ? null : "kids" in n ? [n.dir, n.kids.map(shape)] : n.id);

describe("the tasks shown, arranged", () => {
  it("leaves out a task no longer shown", () => {
    expect(
      shape(
        arrangeBlocks(row("A", "B", "C"), [
          { key: "A", alone: false },
          { key: "C", alone: false },
        ]),
      ),
    ).toEqual(["row", ["A", "C"]]);
  });

  it("puts one newly shown right of the one shown before it, a block of apps alone above them all", () => {
    expect(
      leaves(
        arrangeBlocks(row("A"), [
          { key: "A", alone: false },
          { key: "B", alone: false },
        ]),
      ),
    ).toEqual(["A", "B"]);
    expect(
      shape(
        arrangeBlocks(row("A", "B"), [
          { key: "A", alone: false },
          { key: "B", alone: false },
          { key: "N", alone: true },
        ]),
      ),
    ).toEqual(["col", ["N", ["row", ["A", "B"]]]]);
  });

  it("puts one dropped from the list on the side of the task it was dropped on", () => {
    const shown = [
      { key: "A", alone: false },
      { key: "B", alone: false },
      { key: "D", alone: false },
    ];
    expect(shape(arrangeBlocks(row("A", "B"), shown, { key: "D", target: "A", side: "top" }))).toEqual([
      "row",
      [["col", ["D", "A"]], "B"],
    ]);
  });
});
