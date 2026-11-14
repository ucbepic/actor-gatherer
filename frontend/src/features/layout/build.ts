// The work area's tree BUILT from the panels shown (work.ts places it): a block for each task shown (or each panel of
// none, a terminal's), arranged as the tasks' arrangement says (blocks.ts), each laid out as its task's arrangement says
// (arrange.ts) -- made the first time the task shows (its apps side by side above its actors side by side; or as an
// older page kept the task: firstTree), a panel opened in it since put where a panel of its kind goes (addItem) -- the
// panels not shown left out, the chat minimized under the apps (the panes as tall as their message boxes), the apps' row
// never dragged as tall as the one dragged last, and a block under a strip of its own while others are shown.
import { addItem, leafNodes, leaves, view } from "./arrange";
import { arrangeBlocks, type Put } from "./blocks";
import { isSplit, type Node, type Size, type Split } from "./tree";

/** A panel shown: its task's key (null: a block of its own, kept nowhere -- a terminal, the page with no actor), its item
 * there (an actor's channel, an app's "app:<id>"), its element, and whether it is an app's. */
export interface Shown<N = HTMLElement> {
  key: string | null;
  item: string;
  node: N;
  app: boolean;
}
/** A task's layout as an older page kept it (src/legacy/07-panes.js's taskLayouts): its panes' widths, its apps' panels'
 * and its row's height, the first arrangement made of them. */
export interface Old {
  actors?: string[] | null;
  sizes?: Record<string, number> | null;
  apps?: { id: string; size?: number }[] | null;
  topH?: number | null;
}
export const PANE_MIN = 260, // a pane's width, a bar dragged
  TOP_BAND = 5, // the band under the apps' row
  TOP_MIN = 140, // the apps' row's height, the band in it
  BELOW_MIN = 220; // the panes' under it: room for a view and its message box
export const APP = "app:";

/** A split laid out: the task whose arrangement it shows, or (`screen`) the blocks' own. */
export type Shows = Split & { task: string | null; screen?: boolean };
export interface Built<N = HTMLElement> {
  tree: Node | null;
  /** each block's key, in order (a task's, or the panel's own); their arrangement (blocks.ts); each strip's block, by its
   * id in the tree */
  blocks: string[];
  screen: Node | null;
  strips: Map<string, string>;
  /** by its id in the tree: each panel's element, and its block and item */
  nodes: Map<string, N>;
  items: Map<string, { block: string; key: string | null; item: string }>;
  splits: Map<string, Shows>;
  /** the arrangements made or added to, by task */
  added: Record<string, Node>;
  /** the panes with something of their task above or below them; of those, the ones minimized */
  under: Set<string>;
  minimized: Set<string>;
}

const sized = (n: number | undefined): Size => ({ share: n && n > 0 ? n : 1 });
// side by side: one panel, or a row of them
function row(items: string[], size: (item: string) => number | undefined): Node {
  if (items.length === 1) return { id: items[0] };
  return { key: "", dir: "row", bar: 1, kids: items.map((id) => ({ id })), sizes: items.map((i) => sized(size(i))) };
}

/** A task's arrangement the first time it shows: its apps side by side above its actors side by side -- as an older page
 * kept the task, if it did: every pane and panel it had open (each shown when it opens again), in its order, each as
 * wide, and the apps' row as tall. */
export function firstTree(items: Shown<unknown>[], old: Old | null): Node | null {
  const after = (kept: string[], now: string[]): string[] => [...kept, ...now.filter((i) => !kept.includes(i))];
  const apps = after(
      (old?.apps || []).map((a) => APP + a.id),
      items.filter((i) => i.app).map((i) => i.item),
    ),
    actors = after(
      old?.actors || [],
      items.filter((i) => !i.app).map((i) => i.item),
    );
  const above = apps.length ? row(apps, (i) => old?.apps?.find((a) => APP + a.id === i)?.size) : null;
  const below = actors.length ? row(actors, (i) => old?.sizes?.[i]) : null;
  if (!above || !below) return above || below;
  const top: Size = old && old.topH && old.topH > 0 ? { px: old.topH - TOP_BAND } : { top: true };
  return { key: "", dir: "col", bar: TOP_BAND, kids: [above, below], sizes: [top, { share: 1 }] };
}

export const leafId = (block: string, item: string): string => `${block}\u0001${item}`;
const STRIP = "\u0003strip", // a block's strip, as an item of it: the head of its card
  STRIP_H = 34;

/** The work area's tree for the panels `shown`, the arrangements kept (`trees`) and an older page's (`old`): a block for
 * each task shown, arranged as `screen` says (blocks.ts; `put`, where one newly shown goes), each under its `strip` while
 * there are others, each its arrangement as it shows the panels shown (a pane minimized only as tall as its message box) -- `top`:
 * the apps' row dragged last; `h`: the work area's height. */
export function build<N>(
  shown: Shown<N>[],
  trees: Record<string, Node>,
  old: (key: string) => Old | null,
  opts: {
    top: number | null;
    h: number;
    screen?: Node | null;
    put?: Put | null;
    strip?: (block: string) => N;
    tabbed?: (block: string) => boolean;
    /** the room between two blocks (their cards apart); none given, a line -- a band under blocks of apps alone */
    gap?: number;
  },
): Built<N> {
  const out: Built<N> = {
    tree: null,
    blocks: [],
    screen: null,
    strips: new Map(),
    nodes: new Map(),
    items: new Map(),
    splits: new Map(),
    added: {},
    under: new Set(),
    minimized: new Set(),
  };
  const blockOf = (s: Shown<N>): string => s.key ?? `\u0002${s.item}`;
  for (const s of shown) if (!out.blocks.includes(blockOf(s))) out.blocks.push(blockOf(s));
  const blocks0 = [...out.blocks];
  const laid = out.blocks.map((block) => {
    const items = shown.filter((s) => blockOf(s) === block),
      key = items[0].key;
    let tree = key !== null ? trees[key] || null : null;
    const made = !tree;
    if (!tree) tree = firstTree(items, key !== null ? old(key) : null);
    const before = tree;
    for (const it of items) if (!leaves(tree).includes(it.item)) tree = addItem(tree, it, items);
    if (key !== null && tree && (made || tree !== before)) out.added[key] = tree;
    const v = tree && view(tree, (id) => items.some((i) => i.item === id));
    return v ? shows(v, block, key, items) : null;
  });
  // `under`: something of its task above or below it -- a pane there minimized (its leaf marked) only as tall as its
  // message box: a kid of a column all of whose panes are, as long as what it shows
  function shows(v: Node, block: string, key: string | null, items: Shown<N>[], under = false): Node {
    if (!isSplit(v)) {
      const id = leafId(block, v.id);
      out.nodes.set(id, items.find((i) => i.item === v.id)!.node);
      out.items.set(id, { block, key, item: v.id });
      if (under) out.under.add(id);
      if (under && v.min && !v.id.startsWith(APP)) out.minimized.add(id);
      return { id };
    }
    const apps = v.kids.map((k) => leaves(k).every((id) => id.startsWith(APP))),
      none = v.kids.map((k) => !leaves(k).some((id) => id.startsWith(APP)));
    // the band under apps: one above (or under) another of no app
    const band = v.dir === "col" && apps.some(Boolean) && none.some(Boolean);
    const fits = v.kids.map((k) => v.dir === "col" && leafNodes(k).every((l) => l.min && !l.id.startsWith(APP)));
    const kids = v.kids.map((k) => shows(k, block, key, items, under || v.dir === "col"));
    const sizes = v.sizes.map((z, i): Size => {
      if (fits[i]) return { fit: true };
      if (fits.some(Boolean)) return { share: 1 }; // (the others: the rest of the column)
      const least = v.dir === "row" ? PANE_MIN : apps[i] ? TOP_MIN - TOP_BAND : BELOW_MIN;
      if (z.top) return { px: Math.max(TOP_MIN, opts.top || opts.h / 2) - TOP_BAND, min: least };
      return z.px !== undefined ? { px: z.px, min: least } : { share: z.share ?? 1, min: least };
    });
    const s: Shows = {
      key: `s${out.splits.size}`,
      dir: v.dir,
      bar: band ? TOP_BAND : 1,
      thick: band,
      kids,
      sizes,
      src: v.src,
      at: v.at,
      task: key,
    };
    out.splits.set(s.key, s);
    return s;
  }
  // the blocks as the reader arranged them (blocks.ts), each under a strip of its own while others are shown
  out.blocks = out.blocks.filter((_, i) => !!laid[i]);
  const own = (b: string): Shown<N>[] => shown.filter((s) => blockOf(s) === b);
  out.screen = arrangeBlocks(
    opts.screen ?? null,
    out.blocks.map((b) => ({ key: b, alone: own(b).every((s) => s.app) })),
    opts.put ?? null,
  );
  // (a block of one panel has none: that panel's head moves the block -- unless its task has tabs, which it shows)
  const block = (b: string): Node => {
    const n = laid.find((_, i) => blocks0[i] === b)!;
    const tabbed = !!opts.tabbed && opts.tabbed(b);
    if (!opts.strip || !(tabbed || (out.blocks.length > 1 && own(b).length > 1))) return n;
    const id = leafId(b, STRIP);
    out.nodes.set(id, opts.strip!(b));
    out.strips.set(id, b);
    const sizes = [{ px: STRIP_H }, { share: 1 }];
    return { key: `t${out.strips.size}`, dir: "col", bar: 0, still: true, kids: [{ id }, n], sizes };
  };
  const apps = (n: Node): boolean[] => leaves(n).map((b) => own(b).some((s) => s.app));
  const blocks = (v: Node): Node => {
    if (!isSplit(v)) return block(v.id);
    const all = v.kids.map((k) => leaves(k).every((b) => own(b).every((s) => s.app))),
      none = v.kids.map((k) => !apps(k).some(Boolean));
    const band = v.dir === "col" && all.some(Boolean) && none.some(Boolean);
    const kids = v.kids.map(blocks);
    const sizes = v.sizes.map((z, i): Size => {
      const least = v.dir === "row" ? PANE_MIN : all[i] ? TOP_MIN - TOP_BAND : BELOW_MIN;
      if (z.top) return { px: Math.max(TOP_MIN, opts.top || opts.h / 2) - TOP_BAND, min: least };
      return z.px !== undefined ? { px: z.px, min: least } : { share: z.share ?? 1, min: least };
    });
    const s: Shows = {
      key: `b${out.splits.size}`,
      dir: v.dir,
      bar: opts.gap ?? (band ? TOP_BAND : 1),
      thick: band,
      gap: opts.gap !== undefined,
      kids,
      sizes,
      src: v.src,
      at: v.at,
      task: null,
      screen: true,
    };
    out.splits.set(s.key, s);
    return s;
  };
  const v = out.screen && view(out.screen, () => true);
  out.tree = v ? blocks(v) : null;
  return out;
}
