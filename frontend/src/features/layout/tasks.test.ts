// A task's tabs (tasks.ts): a second tab made, shown, a panel taken out (emptied, the tab goes), one left and the task
// as a task of one tab again; and the strip drawn with them.
import { beforeEach, describe, expect, it } from "vitest";
import { leaves } from "./arrange";
import { drawStrip, Tasks } from "./tasks";

const T = "g\u0000t1";
beforeEach(() => localStorage.clear());

describe("a task's tabs", () => {
  it("a second tab: the task's one so far its first, the new one holding what it is given", () => {
    const t = new Tasks();
    t.set(T, {
      key: "",
      dir: "col",
      bar: 5,
      kids: [{ id: "app:b" }, { id: "c1" }],
      sizes: [{ top: true }, { share: 1 }],
    });
    expect(t.tabs(T)).toBe(null); // one tab: none to show
    const id = t.addTab(T, { id: "app:b" });
    const tabs = t.tabs(T)!;
    expect(tabs.tabs.map((x) => [x.name, leaves(x.tree)])).toEqual([
      ["Tab 1", ["app:b", "c1"]],
      ["Tab 2", ["app:b"]],
    ]);
    expect(tabs.shown).toBe(tabs.tabs[0].id); // the first still shown
    expect(leaves(t.showTab(T, id))).toEqual(["app:b"]);
    expect(leaves(t.trees()[T])).toEqual(["app:b"]); // the tree laid out: the tab shown's
  });

  it("a tab emptied goes; one left, the task is a task of one tab again", () => {
    const t = new Tasks();
    t.set(T, { id: "c1" });
    const id = t.addTab(T, { id: "app:b" });
    t.showTab(T, id);
    expect(t.changeTab(T, id, () => null)).toBe(false); // its last panel out
    expect(t.tabs(T)).toBe(null);
    expect(t.tree(T)).toEqual({ id: "c1" }); // Tab 1's
  });

  it("kept in this browser, named as the reader names it", () => {
    const t = new Tasks();
    t.set(T, { id: "c1" });
    const id = t.addTab(T, { id: "c2" });
    t.rename(T, id, "  Review ");
    t.save();
    const again = new Tasks();
    expect(again.tabs(T)!.tabs.map((x) => x.name)).toEqual(["Tab 1", "Review"]);
  });

  it("the strip: the task's name, each tab (the one shown marked), a +", () => {
    const t = new Tasks();
    t.set(T, { id: "c1" });
    t.addTab(T, { id: "c2" });
    const e = document.createElement("div");
    drawStrip(e, "Parser work", t.tabs(T), { show: () => {}, close: () => {}, rename: () => {}, add: () => {} });
    expect(e.querySelector(".lay-sname")!.textContent).toBe("Parser work");
    expect([...e.querySelectorAll(".lay-ttab")].map((c) => [c.textContent, c.getAttribute("aria-selected")])).toEqual([
      ["Tab 1×", "true"],
      ["Tab 2×", "false"],
    ]);
    expect(e.querySelector(".lay-tadd")).not.toBe(null);
  });
});
