// A panel moved by dragging (move.ts): the work area covered once the drag is under way -- by a moment after it starts,
// or by the drag reaching the work area first, whichever comes first -- where the drop would go marked, and the drop
// going there.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Zone } from "./arrange";
import { Mover } from "./move";
import type { Rect } from "./tree";

let work: HTMLElement, moved: Mock<(id: string, target: string, zone: Zone, copy: boolean) => void>, mover: Mover;
const RECTS = new Map<string, Rect>([
  ["a", { x: 0, y: 0, w: 500, h: 400 }],
  ["b", { x: 500, y: 0, w: 500, h: 400 }],
]);

beforeEach(() => {
  vi.useFakeTimers();
  work = document.body.appendChild(document.createElement("div"));
  work.append(Object.assign(document.createElement("div"), { className: "panel" }));
  moved = vi.fn();
  mover = new Mover(work, {
    rects: () => RECTS,
    targets: (id) => [...RECTS.keys()].filter((k) => k !== id),
    moved,
  });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** A drag's event at (x, y) on `on` (jsdom has no DragEvent: a mouse event of its name, as the mover reads it). */
const drag = (on: Element, type: string, x = 0, y = 0) =>
  on.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
const cover = () => work.querySelector<HTMLElement>(".lay-cover");
const to = () => work.querySelector<HTMLElement>(".lay-to")!;

describe("Mover", () => {
  it("covers the work area a moment after the drag starts, and marks where it would go", () => {
    expect(mover.start("a")).toBe(true);
    expect(cover()).toBeNull(); // not as the drag starts
    vi.runAllTimers();
    expect(cover()).not.toBeNull();
    drag(cover()!, "dragover", 520, 200);
    expect([to().hidden, to().dataset.zone]).toEqual([false, "left"]);
    drag(cover()!, "drop", 520, 200);
    expect(moved).toHaveBeenCalledWith("a", "b", "left", false);
    expect(cover()).toBeNull();
  });

  it("covers it at once if the drag comes over it first -- the moment's timer behind other work -- so its next events reach the cover", () => {
    mover.start("a");
    drag(work.querySelector(".panel")!, "dragenter", 520, 200);
    expect(cover()).not.toBeNull();
    drag(cover()!, "dragover", 980, 200);
    expect([to().hidden, to().dataset.zone]).toEqual([false, "right"]);
    vi.runAllTimers(); // the timer, late: one cover still
    expect(work.querySelectorAll(".lay-cover").length).toBe(1);
  });

  it("covers nothing for a drag it does not hold", () => {
    drag(work.querySelector(".panel")!, "dragenter", 520, 200);
    drag(work.querySelector(".panel")!, "dragover", 520, 200);
    expect(cover()).toBeNull();
    mover.start("a");
    mover.end(); // let go of before the moment came
    drag(work.querySelector(".panel")!, "dragover", 520, 200);
    vi.runAllTimers();
    expect(cover()).toBeNull();
  });
});
