// The layout's store (shadow.ts): changed by the model's rules, read by its tasks' keys as they are now, kept in this
// browser under one key -- what is this page's alone left out -- and not while a bar is being dragged.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as M from "./model";
import { shadow } from "./shadow";

const kept = () => JSON.parse(localStorage.getItem(M.KEY) || "null");

describe("the layout's store", () => {
  beforeEach(() => {
    localStorage.clear();
    shadow.reset();
  });
  afterEach(() => shadow.keysWith((k) => [k]));

  it("starts from what was kept, and is changed by the model's rules", () => {
    const was = M.open(M.empty("t1"), "g\u0000a");
    localStorage.setItem(M.KEY, JSON.stringify(was));
    shadow.start();
    expect(M.shown(shadow.now())).toEqual(["g\u0000a"]);
    shadow.update(M.open, "g\u0000b", true);
    expect(M.shown(shadow.now())).toEqual(["g\u0000a", "g\u0000b"]);
  });

  it("reads each task by its key now: an item joined a task as the task, a task that lost one as itself and it", () => {
    shadow.start(() => null);
    shadow.update(M.open, "g\u0000a");
    shadow.update(M.open, "g\u0000t1", true);
    shadow.keysWith((k) => (k === "g\u0000a" ? ["g\u0000t2"] : k === "g\u0000t1" ? ["g\u0000t1", "g\u0000c"] : [k]));
    expect(M.shown(shadow.now())).toEqual(["g\u0000t2", "g\u0000t1", "g\u0000c"]);
    shadow.update(M.closeHere, "g\u0000c"); // a rule applied to the keys as they are now
    expect(M.shown(shadow.layout)).toEqual(["g\u0000t2", "g\u0000t1"]);
  });

  it("keeps the layout under one key, but what is the page's alone; not while a bar is dragged", () => {
    shadow.start(() => null);
    shadow.update(M.open, "g\u0000a");
    shadow.update(M.focusOn, "g\u0000a", true);
    shadow.update(M.setEntered, "g\u0000a");
    shadow.update(M.layOut, "g\u0000a", true);
    shadow.persist();
    const k = kept();
    expect(k.tabs[0].tasks).toEqual(["g\u0000a"]);
    for (const page of M.PAGE_ONLY) expect(k).not.toHaveProperty(page);
    shadow.dragging(true);
    shadow.update(M.open, "g\u0000b", true);
    shadow.persist();
    expect(kept().tabs[0].tasks).toEqual(["g\u0000a"]); // (each move of the bar would write it all)
    shadow.dragging(false);
    shadow.persist();
    expect(kept().tabs[0].tasks).toEqual(["g\u0000a", "g\u0000b"]);
  });

  it("drops the keys of before once it keeps its own", () => {
    const old = { tabs: [{ id: "s1", tasks: ["g\u0000a"] }], current: "s1" };
    localStorage.setItem("ag-dashboard-screen-tabs", JSON.stringify(old));
    shadow.start();
    expect(M.shown(shadow.now())).toEqual(["g\u0000a"]);
    shadow.persist();
    expect(localStorage.getItem("ag-dashboard-screen-tabs")).toBeNull();
    expect(kept().current).toBe("s1");
  });
});
