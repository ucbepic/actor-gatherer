// The work area's layout as a tree (tree.ts): where each panel goes, and what dragging or double-clicking a bar does.
import { describe, expect, it } from "vitest";
import { drag, draggable, even, evens, lay, lengths, type Split } from "./tree";

const box = { x: 0, y: 0, w: 1001, h: 800 };
const row = (key: string, ids: string[], shares: number[] = ids.map(() => 1), min?: number): Split => ({
  key,
  dir: "row",
  bar: 1,
  kids: ids.map((id) => ({ id })),
  sizes: shares.map((share) => ({ share, min })),
});
// today's work area: the apps' panels above, as tall as the row was dragged (the band under them part of it), the
// actors' panes below
const work = (top: number): Split => ({
  key: "work",
  dir: "col",
  bar: 5,
  thick: true,
  kids: [row("apps", ["n", "b"]), row("actors", ["here", "a2"])],
  sizes: [
    { px: top - 5, min: 135 },
    { share: 1, min: 220 },
  ],
});

describe("where each panel goes", () => {
  it("gives a panel alone the whole box", () => {
    const laid = lay({ id: "here" }, box);
    expect(laid.rects.get("here")).toEqual(box);
    expect(laid.bars).toEqual([]);
  });

  it("shares a row by its kids' shares, each bar taking its room between two", () => {
    const laid = lay(row("actors", ["a", "b", "c"], [2, 1, 1]), { x: 0, y: 0, w: 1002, h: 600 });
    expect(laid.rects.get("a")).toEqual({ x: 0, y: 0, w: 500, h: 600 });
    expect(laid.rects.get("b")).toEqual({ x: 501, y: 0, w: 250, h: 600 });
    expect(laid.rects.get("c")).toEqual({ x: 752, y: 0, w: 250, h: 600 });
    expect(laid.bars.map((b) => [b.at, b.rect.x, b.rect.w])).toEqual([
      [0, 500, 1],
      [1, 751, 1],
    ]);
  });

  it("puts the apps above, as tall as dragged, and the actors' panes below in the rest", () => {
    const laid = lay(work(300), box);
    expect(laid.rects.get("n")).toEqual({ x: 0, y: 0, w: 500, h: 295 });
    expect(laid.rects.get("b")).toEqual({ x: 501, y: 0, w: 500, h: 295 });
    expect(laid.rects.get("here")).toEqual({ x: 0, y: 300, w: 500, h: 500 });
    expect(laid.rects.get("a2")).toEqual({ x: 501, y: 300, w: 500, h: 500 });
    const band = laid.bars.find((b) => b.split.key === "work")!;
    expect(band.rect).toEqual({ x: 0, y: 295, w: 1001, h: 5 });
    expect(band.lengths).toEqual([295, 500]);
  });

  it("keeps a length of its own at its least, and no longer than leaves the others their least", () => {
    expect(lengths(work(40), 800, 1001)).toEqual([135, 660]);
    expect(lengths(work(2000), 800, 1001)).toEqual([575, 220]);
    expect(lengths(work(2000), 300, 1001)).toEqual([135, 160]); // too little room for both: its own least first
  });

  it("makes a kid sized `fit` as long as what it shows, its panels marked so", () => {
    const s: Split = { ...work(300), sizes: [{ share: 1 }, { fit: true }] };
    const laid = lay(s, box, (kid, cross) => {
      expect(kid).toBe(s.kids[1]);
      expect(cross).toBe(1001);
      return 64;
    });
    expect(laid.rects.get("n")!.h).toBe(731);
    expect(laid.rects.get("here")).toEqual({ x: 0, y: 736, w: 500, h: 64 });
    expect([...laid.fitted].sort()).toEqual(["a2", "here"]);
  });
});

describe("a bar dragged", () => {
  const actors = row("actors", ["a", "b", "c"], [1, 1, 1], 260);

  it("makes the panes beside it wider and narrower, their shares keeping their sum", () => {
    const sizes = drag(actors, 0, [400, 400, 400], -100);
    expect(sizes.map((z) => z.share)).toEqual([0.75, 1.25, 1]);
  });

  it("leaves neither under its least, nor under its width then if that was less", () => {
    expect(drag(actors, 0, [400, 400, 400], -300)[0].share).toBeCloseTo(0.65); // 260 of 800
    expect(drag(actors, 0, [400, 400, 400], 300)[1].share).toBeCloseTo(0.65);
    const narrow = row("actors", ["a", "b", "c"], [1, 0.5, 1], 260); // the middle one narrower than its least already
    expect(drag(narrow, 1, [400, 200, 400], -100)[1].share).toBe(0.5); // no narrower
  });

  it("sets a length of its own whole, the kid sharing the rest as it was", () => {
    const sizes = drag(work(300), 0, [295, 500], 120.4);
    expect(sizes).toEqual([
      { px: 415, min: 135 },
      { share: 1, min: 220 },
    ]);
    expect(drag(work(300), 0, [295, 500], 1000)[0].px).toBe(575); // the panes below keep 220
  });

  it("moves nothing in a still split, or beside a kid as long as what it shows", () => {
    const still: Split = { ...work(300), still: true };
    const fit: Split = { ...work(300), sizes: [{ share: 1 }, { fit: true }] };
    expect(draggable(still, 0)).toBe(false);
    expect(draggable(fit, 0)).toBe(false);
    expect(drag(fit, 0, [731, 64], 50)).toEqual(fit.sizes);
  });
});

describe("a bar double-clicked", () => {
  it("evens out the kids that share the room", () => {
    expect(even(row("apps", ["a", "b"], [0.4, 1.6])).map((z) => z.share)).toEqual([1, 1]);
    expect(evens(row("apps", ["a", "b"]))).toBe(true);
  });

  it("leaves a length of its own as it is, and evens nothing with one sharing kid", () => {
    expect(even(work(300))).toEqual(work(300).sizes);
    expect(evens(work(300))).toBe(false);
  });
});
