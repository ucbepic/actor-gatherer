import { describe, expect, it } from "vitest";
import { keptToDrop, tabHolding } from "./kept";

describe("keptToDrop", () => {
  it("drops a panel no tab not shown holds", () => {
    expect(
      keptToDrop(
        [
          { id: "a", tab: "t1" },
          { id: "b", tab: null },
        ],
        new Map([["t1", 5]]),
        3,
      ),
    ).toEqual(["b"]);
  });
  it("keeps the panels of the tabs left latest, `max` of them", () => {
    const left = new Map([
      ["t1", 1],
      ["t2", 2],
      ["t3", 3],
      ["t4", 4],
    ]);
    const kept = [
      { id: "a", tab: "t1" },
      { id: "b", tab: "t2" },
      { id: "c", tab: "t3" },
      { id: "d", tab: "t4" },
      { id: "e", tab: "t1" },
    ];
    expect(keptToDrop(kept, left, 2).sort()).toEqual(["a", "b", "e"]);
    expect(keptToDrop(kept, left, 4)).toEqual([]);
    expect(keptToDrop(kept, left, 0).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("counts a tab never left here as left first", () => {
    const kept = [
      { id: "a", tab: "old" },
      { id: "b", tab: "t2" },
    ];
    expect(keptToDrop(kept, new Map([["t2", 2]]), 1)).toEqual(["a"]);
  });
});

describe("tabHolding", () => {
  const tabs = [
    { id: "t1", tasks: ["g\0a", "g\0task:3"] },
    { id: "t2", tasks: ["g\0b"] },
  ];
  it("finds the tab not shown holding the task", () => {
    expect(tabHolding(tabs, "t2", "g\0task:3")).toBe("t1");
    expect(tabHolding(tabs, "t1", "g\0b")).toBe("t2");
  });
  it("never the tab shown, nor none for no task", () => {
    expect(tabHolding(tabs, "t1", "g\0a")).toBeNull();
    expect(tabHolding(tabs, "t1", null)).toBeNull();
    expect(tabHolding(tabs, "t1", "g\0zzz")).toBeNull();
  });
  it("reads the tabs' keys as they are now", () => {
    const canon = (k: string) => (k === "g\0b" ? "g\0task:9" : k); // b put in task 9 since its tab was left
    expect(tabHolding(tabs, "t1", "g\0task:9", canon)).toBe("t2");
  });
});
