// Screen tabs (tabs.ts): a task in one tab at most; a click routed to the tab holding its task, or a new tab when the
// tab shown is kept; a tab shown again given back its tasks, their arrangement and the one in focus.
import { beforeEach, describe, expect, it } from "vitest";
import { Tabs, type TabsHooks } from "./tabs";
import type { Node } from "./tree";

let shown: string[], screen: Node | null, entered: [string[], string | null][], work: HTMLElement;
function tabs(): Tabs {
  const hooks: TabsHooks = {
    shown: () => shown,
    focus: () => shown[0] || null,
    enter: async (tasks, focus) => {
      entered.push([tasks, focus]);
      shown = [...new Set([focus, ...tasks].filter((k): k is string => !!k))];
    },
    name: (k) => k.toUpperCase(),
    status: () => "",
    screen: () => screen,
    setScreen: (s) => (screen = s),
    hold: () => {},
    changed: () => {},
  };
  return new Tabs(work, hooks);
}
// the strip as drawn: each tab's name, the one shown marked
function strip(t: Tabs): string[] {
  t.draw();
  return [...work.querySelectorAll(".lay-tab")].map(
    (e) => `${e.querySelector(".lay-name")!.textContent}${e.getAttribute("aria-selected") === "true" ? " *" : ""}`,
  );
}
const ids = () => [...work.querySelectorAll<HTMLElement>(".lay-tab")].map((e) => e.dataset.id!);

beforeEach(() => {
  localStorage.clear();
  work = document.createElement("div");
  shown = ["a"];
  screen = null;
  entered = [];
});

describe("screen tabs", () => {
  it("a new tab for what is shown next, the tab left kept with its tasks and their arrangement", async () => {
    const t = tabs();
    screen = { id: "a" };
    t.fresh();
    expect(screen).toBe(null);
    shown = ["b"];
    expect(strip(t)).toEqual(["A", "B *"]);
    await t.route("a"); // a, in the first tab: that tab shown again, as it was left
    expect(entered).toEqual([[["a"], "a"]]);
    expect(screen).toEqual({ id: "a" });
    expect(strip(t)).toEqual(["A *", "B"]);
  });

  it("a click on a task in no tab shows it in the tab shown -- or, that tab kept, in a new one", async () => {
    const t = tabs();
    await t.route("b"); // one task shown: shown in its place, no new tab
    expect(t.height()).toBe(0);
    shown = ["a", "b"];
    await t.route("c"); // two tasks shown: kept, a new tab for c
    shown = ["c"];
    expect(strip(t)).toEqual(["A + B", "C *"]);
  });

  it("keeps a task in one tab only: shown in another, it leaves the first, and a tab left with none goes", () => {
    const t = tabs();
    t.fresh(); // tab 1: a
    shown = ["a", "b"]; // a opened beside b in tab 2
    t.fresh(); // tab 2 kept with a and b: a leaves tab 1, left empty
    shown = ["c"];
    expect(strip(t)).toEqual(["A + B", "C *"]);
  });

  it("closing the tab shown shows the next first; the last one is not closed", async () => {
    const t = tabs();
    t.fresh();
    shown = ["b"];
    strip(t);
    const [first, second] = ids();
    await t.close(second); // the tab shown: the first shown again, then the second closed
    expect(shown).toEqual(["a"]);
    expect(t.height()).toBe(0);
    await t.close(first); // the only one: kept
    expect(t.height()).toBe(0);
    expect(shown).toEqual(["a"]);
  });
});
