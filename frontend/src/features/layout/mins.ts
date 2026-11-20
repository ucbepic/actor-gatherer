// PANES MINIMIZED (work.ts): only their message boxes, where something is above or below them -- of their task, or
// another task -- by a pane's own button, or by the bar beside them dragged past its least (place.ts's folds); panes side
// by side always together, all minimized or all whole (one minimized beside one whole would leave a blank above it);
// never where nothing whole is left above or below to take the room (a blank below them: build.ts shows them whole):
// which are as last placed, each told as that changes; which can be.
import { leaves, mark } from "./arrange";
import { APP, isStrip, type Built } from "./build";
import { isSplit, type Node } from "./tree";

export class Mins {
  private mins = new Set<HTMLElement>(); // the panes minimized, as last placed; those that can be
  private cans = new Set<HTMLElement>();
  private built: Built | null = null; // as last placed, and built again with panes marked
  private marking: Marking | null = null;
  private readonly folding = new Map<string, boolean>(); // (folds' answers, for the one last placed)

  constructor(private readonly changed: (node: HTMLElement, on: boolean) => void) {}

  /** `built` placed: the panes minimized now, or no longer -- or able to be, or no longer -- each told (once placed), to
   * draw itself so. `marking`: the work area built again with some panes marked minimized. */
  placed(built: Built, marking: Marking): void {
    const now = new Set([...built.minimized].map((id) => built.nodes.get(id)!)),
      can = new Set(cans(built, marking).map((id) => built.nodes.get(id)!));
    for (const n of new Set([...now, ...this.mins, ...can, ...this.cans]))
      if (now.has(n) !== this.mins.has(n) || can.has(n) !== this.cans.has(n))
        queueMicrotask(() => this.changed(n, now.has(n)));
    this.mins = now;
    this.cans = can;
    this.built = built;
    this.marking = marking;
    this.folding.clear();
  }
  /** Whether kid `kid` of split `key` is minimized by its bar dragged past its least (place.ts asks as it draws the bars
   * and as one is dragged): every panel of it a pane, something whole left above or below it -- once for each placing. */
  folds(key: string, kid: number): boolean {
    const asked = `${key} ${kid}`;
    let can = this.folding.get(asked);
    if (can === undefined) {
      can = !!this.marking && takes(foldable(this.built, key, kid), this.marking);
      this.folding.set(asked, can);
    }
    return can;
  }
  /** Whether a pane is minimized now. */
  has(node: HTMLElement): boolean {
    return this.mins.has(node);
  }
  /** Whether a pane can be minimized, as last placed. */
  can(node: HTMLElement): boolean {
    return this.cans.has(node);
  }
}

/** The work area built again with panes `ids` (of the one built) marked minimized too. */
export type Marking<N = HTMLElement> = (ids: string[]) => Built<N>;

/** The work area `built` from the tasks' arrangements `trees` (by `rebuild`), built again with panes marked: nothing
 * kept. */
export const markingOf =
  <N>(built: Built<N>, trees: Record<string, Node>, rebuild: (trees: Record<string, Node>) => Built<N>): Marking<N> =>
  (ids) => {
    const then = { ...trees };
    for (const [task, t] of marked(built, ids, true, (k) => then[k] || null)) then[task] = t;
    return rebuild(then);
  };

/** Whether marking panes `ids` minimized shows them so -- not where nothing whole would be left above or below
 * them to take the room (build.ts shows them whole there). */
export const takes = <N>(ids: string[], marking: Marking<N>): boolean => {
  if (!ids.length) return false;
  const then = marking(ids);
  return ids.every((id) => then.minimized.has(id));
};

/** A panel's id in `built`, by its element. */
export const idOf = <N>(built: Built<N> | null, node: N): string | null =>
  [...(built?.nodes || [])].find(([, n]) => n === node)?.[0] ?? null;

/** Whether a pane can be minimized: something of its task, or another task, above or below it, still whole once it is
 * -- and beside it, panes of tasks alone (an app there stays whole: the pane minimized would leave a blank above it). */
export function canMin<N>(built: Built<N> | null, node: N, marking: Marking<N>): boolean {
  const id = idOf(built, node);
  return id !== null && cans(built!, marking).includes(id);
}
// the panes of `built` that can be minimized: each with those beside it (built again once for them all)
function cans<N>(built: Built<N>, marking: Marking<N>): string[] {
  const out: string[] = [],
    asked = new Set<string>();
  for (const id of built.under) {
    if (asked.has(id) || built.minimized.has(id)) continue; // (one minimized: shown whole by its own button)
    const group = besides(built, id);
    for (const other of group) asked.add(other);
    if (takes(group, marking)) out.push(...group);
  }
  return out;
}

// the ids of `ids` -- strips left out -- if every one is a pane of a task: not an app's, nor of no task (a terminal's)
function panesOnly<N>(built: Built<N>, ids: string[]): string[] {
  const of = ids.filter((id) => !built.strips.has(id));
  const pane = (id: string): boolean => {
    const it = built.items.get(id);
    return !!it && it.key !== null && !it.item.startsWith(APP);
  };
  return of.length && of.every(pane) ? of : [];
}

/** The panels of kid `kid` of split `key` of `built` -- one above another, in a task or among the tasks shown -- if every
 * one is a pane of a task: the panes its bar minimizes, dragged past its least (their ids in `built`). None: an app in it
 * (it stops at its least), or a panel of no task (a terminal's, kept nowhere). */
export function foldable<N>(built: Built<N> | null, key: string, kid: number): string[] {
  const s = built?.splits.get(key);
  if (!built || !s || (!s.screen && s.task === null) || s.dir !== "col" || !s.kids[kid]) return [];
  return panesOnly(built, leaves(s.kids[kid]));
}

// the panes beside pane `id` of `built`, it among them: the panels of the kid of the column it is in (a task's, or the
// tasks' own; a strip's aside) -- those its bar minimizes. None: no column it is in, or an app or a terminal's among them.
function besides<N>(built: Built<N>, id: string): string[] {
  const find = (n: Node, kid: Node | null): Node | null | undefined => {
    if (!isSplit(n)) return n.id === id ? kid : undefined;
    const col = n.dir === "col" && !isStrip(built, n);
    for (const k of n.kids) {
      const got = find(k, col ? k : kid);
      if (got !== undefined) return got;
    }
    return undefined;
  };
  const kid = built.tree ? find(built.tree, null) : null;
  return kid ? panesOnly(built, leaves(kid)) : [];
}

/** The panes minimized with pane `id` of `built` by its own button (`on`), or shown whole with it: the panes beside it --
 * and shown whole, each pane minimized beside it in a row further out too (its row whole again). */
export function together<N>(built: Built<N> | null, id: string, on: boolean): string[] {
  if (!built || !built.items.has(id)) return [];
  if (on) return besides(built, id);
  const out = new Set([id, ...besides(built, id)]);
  for (const other of built.items.keys()) if (besides(built, other).includes(id)) out.add(other);
  return [...out];
}

/** The arrangements of the tasks of panes `ids` of `built` (as kept: `tree`, by task), with those panes minimized (or
 * shown whole): by task. */
export function marked<N>(
  built: Built<N> | null,
  ids: string[],
  on: boolean,
  tree: (task: string) => Node | null,
): Map<string, Node> {
  const items = new Map<string, string[]>();
  for (const id of ids) {
    const it = built?.items.get(id);
    if (!it || it.key === null) continue;
    items.set(it.key, [...(items.get(it.key) || []), it.item]);
  }
  const out = new Map<string, Node>();
  for (const [task, of] of items) {
    const kept = tree(task);
    if (kept) out.set(task, minimized(kept, of, on));
  }
  return out;
}

/** A task's arrangement with `items` minimized (or shown whole). */
export const minimized = (tree: Node, items: string[], on: boolean): Node =>
  items.reduce((t, item) => mark(t, item, { min: on || undefined }), tree);
