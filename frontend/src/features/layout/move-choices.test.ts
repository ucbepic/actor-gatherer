// What a panel's menu offers (move-choices.ts): its sides, the panels whose place it takes, its task's tabs, the screen
// tabs, each doing what it says.
import { describe, expect, it } from "vitest";
import { moveChoices, moveHead, short, type MovesOf } from "./move-choices";

const moves = (over: Partial<MovesOf<string>> = {}): MovesOf<string> => ({
  sides: [],
  others: [],
  task: false,
  tabs: [],
  split: false,
  screens: null,
  ...over,
});

describe("moveChoices", () => {
  it("lists the sides in their order, the swaps, the task's tabs, a new one, the screen tabs and a new one", () => {
    const done: string[] = [];
    const choices = moveChoices(
      moves({
        sides: ["bottom", "left"],
        others: ["p2"],
        tabs: [{ id: "x", name: "Second" }],
        split: true,
        screens: [{ id: "s2", n: 2, name: "a".repeat(45) }],
      }),
      (o) => `pane ${o}`,
      {
        toSide: (s) => done.push(`side ${s}`),
        swapWith: (o) => done.push(`swap ${o}`),
        toTab: (id) => done.push(`tab ${id}`),
        toNewTab: () => done.push("new tab"),
        toScreenTab: (id) => done.push(`screen ${id}`),
      },
    );
    expect(choices.map((c) => [c.mark, c.text])).toEqual([
      ["←", "To the left"],
      ["↓", "To the bottom"],
      ["⇄", "Swap with pane p2"],
      ["⇥", "To Second"],
      ["+", "To a new tab of this task"],
      ["⇥", `To tab 2 · ${"a".repeat(39)}…`],
      ["+", "To a new tab"],
    ]);
    for (const c of choices) c.run();
    expect(done).toEqual(["side left", "side bottom", "swap p2", "tab x", "new tab", "screen s2", "screen null"]);
  });
  it("offers nothing where it can go nowhere", () => {
    expect(
      moveChoices(moves(), String, { toSide() {}, swapWith() {}, toTab() {}, toNewTab() {}, toScreenTab() {} }),
    ).toEqual([]);
  });
});

describe("moveHead and short", () => {
  it("heads a task's menu as the task's, else the panel's; cuts a long name", () => {
    expect(moveHead({ task: true })).toBe("Move this task");
    expect(moveHead(null)).toBe("Move this panel");
    expect(short("x".repeat(50))).toBe(`${"x".repeat(47)}…`);
    expect(short("short")).toBe("short");
  });
});
