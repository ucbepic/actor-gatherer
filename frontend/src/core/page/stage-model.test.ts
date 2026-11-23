// What an actor's stage shows, worked out apart (stage-model.ts): its reactions, its look from one draw to the next, its
// classes, and when it looks again.
import { describe, expect, it } from "vitest";
import {
  MOVE_MS,
  PUT_AFTER,
  PUT_MS,
  REACT_MS,
  WIND_MS,
  motionOf,
  reactOf,
  reactionIn,
  stageClass,
  stageLeft,
  stageStep,
  wound,
  type Reactions,
  type Shown,
} from "./stage-model";

describe("a stage's reactions", () => {
  it("reacts to a change it sees, for REACT_MS, once", () => {
    const r: Reactions = new Map();
    expect(reactionIn(r, "c call", null, null, 1000, 50)).toBeNull(); // none
    expect(reactionIn(r, "c call", 7, 49, 2000, 50)).toBe(0); // seen changing: from now
    expect(reactionIn(r, "c call", 7, 49, 2000 + REACT_MS - 1, 50)).toBe(REACT_MS - 1);
    expect(reactionIn(r, "c call", 7, 49, 2000 + REACT_MS, 50)).toBeNull(); // over
    expect(reactionIn(r, "c call", 8, 50, 9000, 50)).toBe(0); // the next
  });

  it("first seen: from when it happened if lately, else not at all", () => {
    const r: Reactions = new Map();
    expect(reactionIn(r, "a done", 3, 98, 5000, 100)).toBe(2000); // two seconds ago
    expect(reactionIn(r, "b done", 3, 90, 5000, 100)).toBeNull(); // ten: long over
    expect(reactionIn(r, "c done", undefined, 0, 5000, 100)).toBeNull(); // undefined is none
  });

  it("says how a call ended, while it reacts", () => {
    expect(reactOf({ id: "c1", ok: true, kind: "test", at: 0 }, 10)).toBe("pass");
    expect(reactOf({ id: "c1", ok: false, kind: "test", at: 0 }, 10)).toBe("tfail");
    expect(reactOf({ id: "c1", ok: true, kind: "ship", at: 0 }, 10)).toBe("ship");
    expect(reactOf({ id: "c1", ok: false, kind: "read", at: 0 }, 10)).toBe("fail");
    expect(reactOf({ id: "c1", ok: true, kind: "read", at: 0 }, 10)).toBeNull();
    expect(reactOf({ id: "c1", ok: false, kind: "test", at: 0 }, null)).toBeNull(); // over
  });
});

describe("an avatar's motion", () => {
  it("is its move and its effect, each a CSS name or none", () => {
    expect(motionOf("bob sparkle")).toEqual(["bob", "sparkle"]);
    expect(motionOf("bob")).toEqual(["bob", ""]);
    expect(motionOf("Bad! x")).toEqual(["", "x"]);
    expect(motionOf(null)).toEqual(["", ""]);
  });
});

describe("the action winding down", () => {
  it("slows evenly to a stop over WIND_MS", () => {
    expect(wound(1000, 1000)).toBe(1000);
    expect(wound(1000, 500)).toBe(1000); // not before it ended
    expect(wound(1000, 1000 + WIND_MS)).toBe(1000 + WIND_MS / 2);
    expect(wound(1000, 1000 + 10 * WIND_MS)).toBe(1000 + WIND_MS / 2); // stopped
  });
});

describe("a stage from one draw to the next", () => {
  it("first seen: as it is, no move, not arriving", () => {
    const s = stageStep(undefined, { doing: "read" }, null, 1000);
    expect(s).toMatchObject({ doing: "read", look: "read", musing: false, putting: false, moving: false });
    expect(s.sh).toMatchObject({ look: "read", arrivedAt: -Infinity, at: -Infinity });
    expect(stageClass(s, null, 0, false, 1000)).toBe("stage s-read");
  });

  it("a call over: its tool kept a while, then put away while it thinks", () => {
    const sh = stageStep(undefined, { doing: "edit" }, null, 1000).sh;
    const over = stageStep(sh, { doing: null, last: "edit" }, null, 2000);
    expect(over.sh).toBe(sh); // the same record, made so
    expect(over).toMatchObject({ musing: true, putting: true, doing: "edit", look: "edit" });
    expect(sh.putAt).toBe(2000 + PUT_AFTER);
    expect(stageClass(over, null, 0, false, 2000)).toBe("stage s-edit musing putting");
    expect(stageLeft(over, null, 2000)).toBe(PUT_AFTER + PUT_MS);
    const thinking = stageStep(sh, { doing: null, last: "edit" }, null, 2000 + PUT_AFTER + PUT_MS);
    expect(thinking).toMatchObject({ putting: false, doing: "think", moving: false }); // put away already: no move
    expect(sh.was).toBeNull();
  });

  it("moves from one tool to the next, and a team's size is its look", () => {
    const sh = stageStep(undefined, { doing: "read" }, null, 1000).sh;
    const s = stageStep(sh, { doing: "team", helpers: 5 }, null, 1500);
    expect(s).toMatchObject({ doing: "team", look: "team3", moving: true });
    expect(sh.was).toBe("read");
    expect(stageLeft(s, null, 1500)).toBe(MOVE_MS);
    expect(stageStep(sh, { doing: "team", helpers: 5 }, null, 1500 + MOVE_MS).moving).toBe(false);
  });

  it("reacts on the tool of what ended, with its class, and a streak of failures", () => {
    const sh = stageStep(undefined, { doing: "run" }, null, 0).sh;
    const s = stageStep(sh, { doing: null, last: "run", failed: 3 }, "tfail", 100);
    expect(s.doing).toBe("test");
    expect(sh.putAt).toBe(100 + REACT_MS - 300);
    expect(stageClass(s, "tfail", 3, true, 100)).toBe("stage s-test musing putting r-tfail retry");
    expect(stageClass(s, "fail", 3, false, 100)).toBe("stage s-test musing putting r-fail streak");
    expect(stageLeft(s, 40, 100)).toBe(Math.max(REACT_MS - 40, MOVE_MS, s.sh.putAt! + PUT_MS - 100));
  });

  it("a turn over: the next arrives; its thought pops in as a call begins", () => {
    const rested = stageStep({ done: true }, { doing: null }, null, 5000);
    expect(rested.sh.arrivedAt).toBe(5000);
    expect(stageClass(rested, null, 0, false, 5000)).toBe("stage s-think musing arriving");
    const sh: Shown = rested.sh;
    const begun = stageStep(sh, { doing: "search" }, null, 5100);
    expect(sh.popBubble).toBe(true);
    expect(stageClass(begun, null, 0, false, 5100)).toContain("popping");
    expect(stageClass(begun, null, 0, false, 5600)).not.toContain("popping");
  });
});
