// The work area's LAYOUT -- the column right of the list -- as a tree: a panel (a leaf: an actor's pane or an app's
// panel, by its id), or a split of the room among its kids, side by side ("row") or one above another ("col"), a bar
// between each two. Each kid's size is a share of the room the others leave (`share`), a length of its own (`px`: a row
// as tall as it was dragged), or the length of what it shows (`fit`: a chat minimized to its message box); `min`, what
// dragging a bar leaves it at the least. No DOM here: where each panel goes (lay), and what a bar dragged (drag) or
// double-clicked (even) makes of a split's sizes. place.ts puts the panels there.

export type Dir = "row" | "col";
export interface Leaf {
  id: string;
}
export interface Size {
  share?: number;
  px?: number;
  fit?: boolean;
  min?: number;
  /** a task's apps' row, never dragged in it: as tall as the one dragged last (work.ts makes it a `px`) */
  top?: boolean;
}
export interface Split {
  /** what the split is, to whoever made the tree: told with its sizes when a bar of it is dragged */
  key: string;
  dir: Dir;
  kids: Node[];
  sizes: Size[];
  /** the bar between two kids: how much room it takes */
  bar: number;
  /** its bars not dragged */
  still?: boolean;
  /** its bars drawn as a band, not a line */
  thick?: boolean;
  /** a split of the panels shown (arrange.ts's view): the one kept it came from, and where each of its kids is in it */
  src?: Split;
  at?: number[];
}
export type Node = Leaf | Split;
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A bar between kids `at` and `at + 1` of `split`: where it is (the room it takes), and the kids' lengths laid out. */
export interface Bar {
  split: Split;
  at: number;
  rect: Rect;
  lengths: number[];
}
export interface Laid {
  rects: Map<string, Rect>;
  /** the panels as long as what they show (in a kid sized `fit`) */
  fitted: Set<string>;
  bars: Bar[];
}
/** A kid's length when its size is `fit`: what it shows, `cross` wide (or tall, in a row). */
export type Fit = (kid: Node, cross: number) => number;

export const isSplit = (n: Node): n is Split => "kids" in n;
const shareOf = (z: Size | undefined): number => (z && z.share !== undefined ? z.share : 1);
const fixed = (z: Size | undefined): boolean => !!z && (!!z.fit || z.px !== undefined);

/** The lengths of a split's kids along `len` (`cross` the other way): its bars' room taken first, then each kid of a
 * length of its own (no longer than what is left), the rest shared by the others as their shares say. */
export function lengths(s: Split, len: number, cross: number, fit: Fit = () => 0): number[] {
  let left = Math.max(0, len - s.bar * (s.kids.length - 1));
  const own = s.kids.map((k, i) => {
    const z = s.sizes[i];
    if (!fixed(z)) return null;
    const want = z.fit ? fit(k, cross) : Math.max(z.min || 0, z.px || 0);
    const got = Math.max(0, Math.min(want, left));
    left -= got;
    return got;
  });
  const shares = s.kids.reduce((n, _, i) => (own[i] === null ? n + shareOf(s.sizes[i]) : n), 0);
  return own.map((l, i) => (l !== null ? l : shares > 0 ? (left * shareOf(s.sizes[i])) / shares : 0));
}

/** Where each panel of `node` goes in `box`, and each bar. */
export function lay(node: Node, box: Rect, fit: Fit = () => 0): Laid {
  const out: Laid = { rects: new Map(), fitted: new Set(), bars: [] };
  const into = (n: Node, r: Rect, fitted: boolean): void => {
    if (!isSplit(n)) {
      out.rects.set(n.id, r);
      if (fitted) out.fitted.add(n.id);
      return;
    }
    const row = n.dir === "row";
    const ls = lengths(n, row ? r.w : r.h, row ? r.h : r.w, fit);
    let at = row ? r.x : r.y;
    n.kids.forEach((k, i) => {
      if (i) {
        out.bars.push({
          split: n,
          at: i - 1,
          rect: row ? { x: at, y: r.y, w: n.bar, h: r.h } : { x: r.x, y: at, w: r.w, h: n.bar },
          lengths: ls,
        });
        at += n.bar;
      }
      into(
        k,
        row ? { x: at, y: r.y, w: ls[i], h: r.h } : { x: r.x, y: at, w: r.w, h: ls[i] },
        fitted || !!n.sizes[i]?.fit,
      );
      at += ls[i];
    });
  };
  into(node, box, false);
  return out;
}

/** Whether the bar after kid `at` can be dragged: not a still split's, nor one beside a kid as long as what it shows. */
export const draggable = (s: Split, at: number): boolean => !s.still && !s.sizes[at]?.fit && !s.sizes[at + 1]?.fit;

/** A split's sizes once the bar after kid `at` is dragged `by` from where it was (`ls`: the kids' lengths then): the two
 * kids beside it longer and shorter, neither under its `min` (or under its length then, if that was less) -- two shares
 * keeping their sum, a length of its own its new length, whole. */
export function drag(s: Split, at: number, ls: number[], by: number): Size[] {
  const sizes = s.sizes.map((z) => ({ ...z }));
  if (!draggable(s, at)) return sizes;
  const [a0, b0] = [ls[at], ls[at + 1]];
  const both = a0 + b0;
  const lo = Math.min(sizes[at].min || 0, a0),
    hi = Math.max(lo, both - Math.min(sizes[at + 1].min || 0, b0));
  const a = Math.min(Math.max(a0 + by, lo), hi),
    b = both - a;
  const [za, zb] = [sizes[at], sizes[at + 1]];
  if (za.px !== undefined) za.px = Math.round(a);
  if (zb.px !== undefined) zb.px = Math.round(b);
  if (za.px === undefined && zb.px === undefined && both > 0) {
    const sum = shareOf(za) + shareOf(zb);
    za.share = (sum * a) / both;
    zb.share = sum - za.share;
  }
  return sizes;
}

/** Whether double-clicking a split's bars evens anything out: two kids or more that share the room. */
export const evens = (s: Split): boolean => s.sizes.filter((z) => !fixed(z)).length > 1;

/** A split's sizes with every kid sharing the room sharing it evenly. */
export const even = (s: Split): Size[] => s.sizes.map((z) => (fixed(z) ? { ...z } : { ...z, share: 1 }));
