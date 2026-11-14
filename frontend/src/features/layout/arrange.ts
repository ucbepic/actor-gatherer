// What the reader does to a task's ARRANGEMENT -- a tree of tree.ts's, kept per task (work.ts): a panel put on a side of
// another (the two then side by side, or one over the other), two swapped, one put along a whole side of the rest, one
// taken out; and the tree as it shows only the panels open (view), each split of it knowing the one kept it came from,
// so the sizes a bar dragged in it gives are kept there (keepSizes). Each gives a new tree, leaving the one it is given
// as it was -- but keepSizes, which is what it is for. No DOM here.
import { isSplit, type Dir, type Leaf, type Node, type Rect, type Size, type Split } from "./tree";

export type Side = "left" | "right" | "top" | "bottom";
/** Where a panel dropped on another goes: on one of its sides, or in its place (the two swapped). */
export type Zone = Side | "center";
export const SIDES: Side[] = ["left", "right", "top", "bottom"];
export const dirOf = (s: Side): Dir => (s === "left" || s === "right" ? "row" : "col");
const first = (s: Side): boolean => s === "left" || s === "top";
const shareOf = (z: Size | undefined): number => (z && z.share !== undefined ? z.share : 1);
// a kid that shares the room with the others: no length of its own
const sharing = (z: Size | undefined): boolean => !z || (z.px === undefined && !z.fit && !z.top);
const split = (dir: Dir, kids: Node[], sizes: Size[]): Split => ({ key: "", dir, bar: 1, kids, sizes });

/** Every panel of a tree, in order. */
export const leaves = (n: Node | null): string[] => (!n ? [] : isSplit(n) ? n.kids.flatMap(leaves) : [n.id]);

// A split's kids that split the same way taken into it, each its share of the kid's share: no row in a row.
function flat(n: Node): Node {
  if (!isSplit(n)) return n;
  const kids: Node[] = [],
    sizes: Size[] = [];
  n.kids.forEach((k0, i) => {
    const k = flat(k0),
      z = n.sizes[i];
    if (isSplit(k) && k.dir === n.dir && sharing(z) && k.sizes.every(sharing)) {
      const sum = k.sizes.reduce((s, x) => s + shareOf(x), 0) || 1;
      k.kids.forEach((kk, j) => {
        kids.push(kk);
        sizes.push({ share: (shareOf(z) * shareOf(k.sizes[j])) / sum });
      });
    } else {
      kids.push(k);
      sizes.push(z);
    }
  });
  return { ...n, kids, sizes };
}

/** The tree without the panel `id`: a split left with one kid gives its place (and its size there) to that kid. */
export function remove(n: Node, id: string): Node | null {
  const out = (m: Node): Node | null => {
    if (!isSplit(m)) return m.id === id ? null : m;
    const kids: Node[] = [],
      sizes: Size[] = [];
    m.kids.forEach((k, i) => {
      const r = out(k);
      if (r) {
        kids.push(r);
        sizes.push(m.sizes[i]);
      }
    });
    return !kids.length ? null : kids.length === 1 ? kids[0] : { ...m, kids, sizes };
  };
  const r = out(n);
  return r && flat(r);
}

/** The panel `id` put on side `side` of the panel `target`: in the split `target` is in, if it splits that way, the two
 * sharing `target`'s room; else the two in a split of their own, in `target`'s place. */
export function insert(n: Node, target: string, id: string, side: Side, as: Leaf = { id }): Node {
  const dir = dirOf(side),
    leaf: Node = { ...as, id };
  const into = (m: Node): Node => {
    if (!isSplit(m))
      return m.id === target ? split(dir, first(side) ? [leaf, m] : [m, leaf], [{ share: 1 }, { share: 1 }]) : m;
    const at = m.kids.findIndex((k) => !isSplit(k) && k.id === target);
    if (at < 0 || m.dir !== dir) return { ...m, kids: m.kids.map(into) };
    const kids = [...m.kids],
      sizes = [...m.sizes],
      z = m.sizes[at];
    const half: Size = sharing(z) ? { share: shareOf(z) / 2 } : { share: 1 };
    if (sharing(z)) sizes[at] = half;
    const where = first(side) ? at : at + 1;
    kids.splice(where, 0, leaf);
    sizes.splice(where, 0, { ...half });
    return { ...m, kids, sizes };
  };
  return flat(into(n));
}

/** The panels `a` and `b` in each other's place. */
export function swap(n: Node, a: string, b: string): Node {
  const all = (m: Node): Leaf[] => (isSplit(m) ? m.kids.flatMap(all) : [m]);
  const [la, lb] = [all(n).find((l) => l.id === a), all(n).find((l) => l.id === b)];
  const into = (m: Node): Node =>
    isSplit(m) ? { ...m, kids: m.kids.map(into) } : m.id === a ? { ...lb! } : m.id === b ? { ...la! } : m;
  return la && lb ? into(n) : n;
}

/** The panel `id` given `props` (a pane minimized, or not). */
export function mark(n: Node, id: string, props: Partial<Leaf>): Node {
  if (!isSplit(n)) return n.id === id ? { ...n, ...props } : n;
  return { ...n, kids: n.kids.map((k) => mark(k, id, props)) };
}

/** The panels of a tree, as kept (each with what it is marked). */
export const leafNodes = (n: Node | null): Leaf[] => (!n ? [] : isSplit(n) ? n.kids.flatMap(leafNodes) : [n]);

/** The panel `id` dropped on `target`'s `zone`: on that side of it, or (its center) the two swapped. */
export function move(n: Node, id: string, target: string, zone: Zone): Node {
  const all = leaves(n);
  if (id === target || !all.includes(id) || !all.includes(target)) return n;
  if (zone === "center") return swap(n, id, target);
  const rest = remove(n, id);
  return rest
    ? insert(
        rest,
        target,
        id,
        zone,
        leafNodes(n).find((l) => l.id === id),
      )
    : n; // (as it was marked)
}

/** The panel `id` put along a whole side of the rest: one more kid of the tree, if it splits that way (as wide as its
 * kids are on the whole), else the two halves of a split of their own. */
export function toSide(n: Node, id: string, side: Side): Node {
  const rest = leaves(n).includes(id) ? remove(n, id) : null;
  if (!rest) return n;
  const leaf: Node = { ...leafNodes(n).find((l) => l.id === id)!, id }, // (as it was marked)
    dir = dirOf(side);
  if (isSplit(rest) && rest.dir === dir && rest.sizes.every(sharing)) {
    const z: Size = { share: rest.sizes.reduce((s, x) => s + shareOf(x), 0) / rest.sizes.length };
    return first(side)
      ? { ...rest, kids: [leaf, ...rest.kids], sizes: [z, ...rest.sizes] }
      : { ...rest, kids: [...rest.kids, leaf], sizes: [...rest.sizes, z] };
  }
  return split(dir, first(side) ? [leaf, rest] : [rest, leaf], [{ share: 1 }, { share: 1 }]);
}

/** An item of a tree, and whether it is of the kind that goes above (an app's panel; a block of apps alone). */
export interface Kinded {
  item: string;
  app: boolean;
}

/** `it`, shown but not in its task's arrangement, put where a panel of its kind goes: after the one before it among the
 * panels shown of its kind (as a pane opened beside another goes right of it), else before the one after it, else after
 * the last of its kind (one shown before); an app with none of its kind, above them all; an actor, below them all. */
export function addItem(
  tree: Node | null,
  it: Kinded,
  items: Kinded[],
  isApp: (id: string) => boolean = (id) => id.startsWith("app:"),
): Node {
  if (!tree) return { id: it.item };
  const has = new Set(leaves(tree)),
    same = items.filter((i) => i.app === it.app),
    at = same.indexOf(it);
  const before = same
    .slice(0, at)
    .reverse()
    .find((i) => has.has(i.item));
  if (before) return insert(tree, before.item, it.item, "right");
  const after = same.slice(at + 1).find((i) => has.has(i.item));
  if (after) return insert(tree, after.item, it.item, "left");
  const kin = [...has].filter((id) => isApp(id) === it.app).pop();
  if (kin) return insert(tree, kin, it.item, "right");
  const leaf: Node = { id: it.item };
  return {
    key: "",
    dir: "col",
    bar: 5,
    kids: it.app ? [leaf, tree] : [tree, leaf],
    sizes: [{ top: true }, { share: 1 }], // the apps above: as tall as the row dragged last
  };
}

/** The tree as it shows the panels `keep` keeps: the others left out (a split left with one kid gives its place to it),
 * each split shown knowing the one it came from and where each of its kids is in it. */
export function view(n: Node, keep: (id: string) => boolean): Node | null {
  if (!isSplit(n)) return keep(n.id) ? { ...n } : null;
  const kids: Node[] = [],
    sizes: Size[] = [],
    at: number[] = [];
  n.kids.forEach((k, i) => {
    const v = view(k, keep);
    if (v) {
      kids.push(v);
      sizes.push({ ...n.sizes[i] });
      at.push(i);
    }
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  return { key: n.key, dir: n.dir, bar: n.bar, kids, sizes, src: n, at };
}

/** The tree with only the panels `keep` keeps, as a tree to keep (view's, knowing nothing of where it came from). */
export function prune(n: Node, keep: (id: string) => boolean): Node | null {
  const clean = (m: Node): Node =>
    isSplit(m)
      ? { key: m.key, dir: m.dir, bar: m.bar, kids: m.kids.map(clean), sizes: m.sizes.map((z) => ({ ...z })) }
      : m;
  const v = view(n, keep);
  return v && clean(v);
}

/** A split shown given its kids' sizes (a bar of it dragged): kept in the split it came from -- a share, or a length of
 * its own, for each kid it shows; the others' left as they were. */
export function keepSizes(v: Split, sizes: Size[]): void {
  const src = v.src,
    at = v.at;
  if (!src || !at) return;
  at.forEach((j, i) => {
    const z = sizes[i];
    if (!z) return;
    if (z.px !== undefined) src.sizes[j] = { px: z.px };
    else if (z.share !== undefined) src.sizes[j] = { share: z.share };
  });
}

/** Where a panel dropped at (x, y) over `r` goes: on the side the point is nearest, within `edge` of `r` from it (a
 * quarter; a half, always a side); in its place nearer the middle. */
export function zoneAt(r: Rect, x: number, y: number, edge = 0.25): Zone {
  const fx = (x - r.x) / (r.w || 1),
    fy = (y - r.y) / (r.h || 1);
  const near: [Zone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  const [side, d] = near.reduce((a, b) => (b[1] < a[1] ? b : a));
  return d < edge ? side : "center";
}

/** The room a panel dropped in `zone` of `r` would take: half of `r` on that side, or all of it. */
export function zoneRect(r: Rect, zone: Zone): Rect {
  if (zone === "left") return { ...r, w: r.w / 2 };
  if (zone === "right") return { ...r, x: r.x + r.w / 2, w: r.w / 2 };
  if (zone === "top") return { ...r, h: r.h / 2 };
  if (zone === "bottom") return { ...r, y: r.y + r.h / 2, h: r.h / 2 };
  return r;
}
