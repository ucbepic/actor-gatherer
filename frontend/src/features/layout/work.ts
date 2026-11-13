// The WORK AREA as the reader arranges it: one block for each task shown (or each panel of none, a terminal's), side by
// side, each laid out as its task's arrangement says (arrange.ts) -- kept per task in this browser, made the first time
// the task shows (its apps side by side above its actors side by side; or as an older page kept the task: firstTree),
// and a panel opened in it since put where a panel of its kind goes (addItem). Built from the panels shown (the page's
// own pane, the others, the apps' panels) each time the work area is placed (build): the panels not shown left out of
// it, the chat minimized under the apps (the panes as tall as their message boxes), the apps' row never dragged as tall
// as the one dragged last. A bar dragged keeps its sizes in the task's arrangement; a panel dragged by its head
// (move.ts), or moved from its menu, changes it.
import { keepSizes, leaves, insert, move, swap, toSide, view, type Side, type Zone } from "./arrange";
import { Mover } from "./move";
import { Placer } from "./place";
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
const APP = "app:";

/** A split laid out, the task whose arrangement it shows. */
export type Shows = Split & { task: string | null };
export interface Built<N = HTMLElement> {
  tree: Node | null;
  /** each block's key, in order (a task's, or the panel's own); the blocks of each split of blocks, by its key */
  blocks: string[];
  rows: Record<string, string[]>;
  /** by its id in the tree: each panel's element, and its block and item */
  nodes: Map<string, N>;
  items: Map<string, { block: string; key: string | null; item: string }>;
  splits: Map<string, Shows>;
  /** the arrangements made or added to, by task */
  added: Record<string, Node>;
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

/** `it`, shown but not in its task's arrangement, put where a panel of its kind goes: after the one before it among the
 * panels shown of its kind (as a pane opened beside another goes right of it), else before the one after it, else after
 * the last of its kind (one shown before); an app with none of its kind, above them all; an actor, below them all. */
export function addItem(tree: Node | null, it: Shown<unknown>, items: Shown<unknown>[]): Node {
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
  const kin = [...has].filter((id) => id.startsWith(APP) === it.app).pop();
  if (kin) return insert(tree, kin, it.item, "right");
  const leaf: Node = { id: it.item };
  return {
    key: "",
    dir: "col",
    bar: TOP_BAND,
    kids: it.app ? [leaf, tree] : [tree, leaf],
    sizes: [{ top: true }, { share: 1 }], // the apps above: as tall as the row dragged last
  };
}

export const leafId = (block: string, item: string): string => `${block}\u0001${item}`;
// the splits of the blocks themselves: the blocks of apps alone side by side, the others, and the band between the two
const SCREEN_TOP = "screen-top",
  SCREEN = "screen",
  SCREEN_BAND = "screen-band";

/** The work area's tree for the panels `shown`, the arrangements kept (`trees`) and an older page's (`old`): a block for
 * each task shown, side by side (`shares`: each one's share of the width; the blocks of apps alone above the others,
 * `band` the band under them as dragged), each its arrangement as it shows the panels shown -- `min`: the chat minimized
 * under the apps; `top`: the apps' row dragged last; `h`: the work area's height. */
export function build<N>(
  shown: Shown<N>[],
  trees: Record<string, Node>,
  old: (key: string) => Old | null,
  opts: { min: boolean; top: number | null; h: number; shares?: Map<string, number>; band?: number | null },
): Built<N> {
  const out: Built<N> = {
    tree: null,
    blocks: [],
    rows: {},
    nodes: new Map(),
    items: new Map(),
    splits: new Map(),
    added: {},
  };
  const blockOf = (s: Shown<N>): string => s.key ?? `\u0002${s.item}`;
  for (const s of shown) if (!out.blocks.includes(blockOf(s))) out.blocks.push(blockOf(s));
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
  function shows(v: Node, block: string, key: string | null, items: Shown<N>[]): Node {
    if (!isSplit(v)) {
      const id = leafId(block, v.id);
      out.nodes.set(id, items.find((i) => i.item === v.id)!.node);
      out.items.set(id, { block, key, item: v.id });
      return { id };
    }
    const apps = v.kids.map((k) => leaves(k).every((id) => id.startsWith(APP))),
      none = v.kids.map((k) => !leaves(k).some((id) => id.startsWith(APP)));
    // the band under apps: one above (or under) another of no app
    const band = v.dir === "col" && apps.some(Boolean) && none.some(Boolean),
      min = opts.min && band;
    const kids = v.kids.map((k) => shows(k, block, key, items));
    const sizes = v.sizes.map((z, i): Size => {
      if (min) return none[i] ? { fit: true } : { share: 1 };
      const least = v.dir === "row" ? PANE_MIN : apps[i] ? TOP_MIN - TOP_BAND : BELOW_MIN;
      if (z.top) return { px: Math.max(TOP_MIN, opts.top || opts.h / 2) - TOP_BAND, min: least };
      return z.px !== undefined ? { px: z.px, min: least } : { share: z.share ?? 1, min: least };
    });
    const s: Shows = {
      key: `s${out.splits.size}`,
      dir: v.dir,
      bar: band ? TOP_BAND : 1,
      thick: band,
      still: min,
      kids,
      sizes,
      src: v.src,
      at: v.at,
      task: key,
    };
    out.splits.set(s.key, s);
    return s;
  }
  // the blocks side by side -- those of apps alone above the others, as an app's panel always was
  const of = out.blocks.filter((_, i) => !!laid[i]),
    node = (b: string): Node => laid[out.blocks.indexOf(b)]!;
  const alone = (b: string): boolean => shown.filter((s) => blockOf(s) === b).every((s) => s.app);
  const side = (key: string, blocks: string[]): Node | null => {
    if (blocks.length < 2) return blocks.length ? node(blocks[0]) : null;
    out.rows[key] = blocks;
    const sizes = blocks.map((b) => ({ share: opts.shares?.get(b) || 1, min: PANE_MIN }));
    return { key, dir: "row", bar: 1, kids: blocks.map(node), sizes };
  };
  const above = side(SCREEN_TOP, of.filter(alone)),
    below = side(
      SCREEN,
      of.filter((b) => !alone(b)),
    );
  if (above && below) {
    const min = opts.min && !leaves(below).some((id) => out.items.get(id)?.item.startsWith(APP));
    const top = Math.max(TOP_MIN, opts.top || opts.h / 2) - TOP_BAND;
    out.tree = {
      key: SCREEN_BAND,
      dir: "col",
      bar: TOP_BAND,
      thick: true,
      still: min,
      kids: [above, below],
      sizes: min
        ? [{ share: 1 }, { fit: true }]
        : [
            { px: opts.band ?? top, min: TOP_MIN - TOP_BAND },
            { share: 1, min: BELOW_MIN },
          ],
    };
  } else out.tree = above || below;
  out.blocks = of;
  return out;
}

const TREES_KEY = "ag-dashboard-task-trees",
  TREES_KEPT = 200,
  TOP_KEY = "ag-dashboard-editor-height";
const lastTop = (): number | null => {
  try {
    const h = Number(localStorage.getItem(TOP_KEY));
    return h > 0 ? h : null;
  } catch {
    return null;
  }
};

export interface WorkHooks {
  /** The panels shown, in order: the page's own pane, the others, the apps' panels shown. */
  shown: () => Shown[];
  /** The chat minimized under the apps. */
  min: () => boolean;
  /** None placed: the page's own stylesheet lays the panels out (a phone's width). */
  narrow: () => boolean;
  old: (key: string) => Old | null;
}
/** What a panel can be moved to from its menu: a side of its task's block, or another panel's place. */
export interface Moves {
  sides: Side[];
  others: HTMLElement[];
}

export class Work {
  private trees: Record<string, { tree: Node; at: number }>;
  private last: Built | null = null;
  private readonly shares = new Map<string, number>();
  private band: number | null = null; // the band under the blocks of apps alone, dragged on this page
  private readonly placer: Placer;
  private readonly mover: Mover;

  constructor(
    work: HTMLElement,
    private readonly hooks: WorkHooks,
  ) {
    try {
      this.trees = JSON.parse(localStorage.getItem(TREES_KEY) || "{}") || {};
    } catch {
      this.trees = {};
    }
    this.placer = new Placer(work, {
      tree: (box) => this.tree(box),
      node: (id) => this.last?.nodes.get(id) ?? null,
      resized: (key, sizes, done) => this.resized(key, sizes, done),
    });
    this.mover = new Mover(work, {
      rects: () => this.placer.rects(),
      targets: (id) => this.others(id),
      moved: (id, target, zone) => this.moved(id, target, zone),
    });
  }

  place(): void {
    this.placer.place();
  }

  /** A panel's head dragged: false if it has nowhere to go (its task's only panel shown). */
  startMove(node: HTMLElement): boolean {
    const id = this.idOf(node);
    return !!id && this.mover.start(id);
  }
  endMove(): void {
    this.mover.end();
  }
  /** What a panel can be moved to from its menu. */
  moves(node: HTMLElement): Moves | null {
    const id = this.idOf(node),
      others = id ? this.others(id) : [];
    if (!id || !others.length) return null;
    return { sides: ["left", "right", "top", "bottom"], others: others.map((o) => this.last!.nodes.get(o)!) };
  }
  toSide(node: HTMLElement, side: Side): void {
    this.arrange(this.idOf(node), (t, item) => toSide(t, item, side));
  }
  swapWith(node: HTMLElement, other: HTMLElement): void {
    const o = this.idOf(other);
    const with_ = o && this.last ? this.last.items.get(o)!.item : null;
    if (with_) this.arrange(this.idOf(node), (t, item) => swap(t, item, with_));
  }

  private tree(box: { w: number; h: number }): Node | null {
    if (this.hooks.narrow()) {
      this.last = null;
      return null;
    }
    const kept: Record<string, Node> = {};
    for (const [k, v] of Object.entries(this.trees)) kept[k] = v.tree;
    const built = build(this.hooks.shown(), kept, this.hooks.old, {
      min: this.hooks.min(),
      top: lastTop(),
      h: box.h,
      shares: this.shares,
      band: this.band,
    });
    for (const [k, t] of Object.entries(built.added)) this.trees[k] = { tree: t, at: Date.now() };
    if (Object.keys(built.added).length) this.save();
    this.last = built;
    return built.tree;
  }

  private idOf(node: HTMLElement): string | null {
    for (const [id, n] of this.last?.nodes || []) if (n === node) return id;
    return null;
  }
  // the panels shown of the same task as `id`'s
  private others(id: string): string[] {
    const of = this.last?.items.get(id);
    if (!of || of.key === null) return [];
    return [...this.last!.items].filter(([o, v]) => o !== id && v.block === of.block).map(([o]) => o);
  }
  private moved(id: string, target: string, zone: Zone): void {
    const t = this.last?.items.get(target);
    if (t) this.arrange(id, (tree, item) => move(tree, item, t.item, zone));
  }
  // a task's arrangement changed as `change` says, for the panel `id`: kept, and placed so
  private arrange(id: string | null, change: (tree: Node, item: string) => Node): void {
    const of = id ? this.last?.items.get(id) : null;
    const kept = of && of.key !== null ? this.trees[of.key] : null;
    if (!of || !kept) return;
    this.trees[of.key!] = { tree: change(kept.tree, of.item), at: Date.now() };
    this.save();
    this.place();
  }
  private resized(key: string, sizes: Size[], done: boolean): void {
    const blocks = this.last?.rows[key];
    if (blocks) {
      blocks.forEach((b, i) => {
        if (sizes[i]?.share) this.shares.set(b, sizes[i].share!);
      });
    } else if (key === SCREEN_BAND) {
      if (sizes[0]?.px !== undefined) this.band = sizes[0].px;
    } else {
      const s = this.last?.splits.get(key);
      if (!s || !s.src) return;
      keepSizes(s, sizes);
      const app = (id: string): boolean => !!this.last?.items.get(id)?.item.startsWith(APP);
      const top = s.thick ? sizes.find((z, i) => z.px !== undefined && leaves(s.kids[i]).every(app)) : null;
      if (top && done) {
        try {
          localStorage.setItem(TOP_KEY, String(top.px! + TOP_BAND)); // a task's apps' row not dragged yet: as tall
        } catch {
          /* this page only */
        }
      }
      if (done && s.task && this.trees[s.task]) this.trees[s.task].at = Date.now();
      if (done) this.save();
    }
    this.place();
  }
  private save(): void {
    const keys = Object.keys(this.trees).sort((a, b) => this.trees[b].at - this.trees[a].at);
    for (const k of keys.slice(TREES_KEPT)) delete this.trees[k];
    try {
      localStorage.setItem(TREES_KEY, JSON.stringify(this.trees));
    } catch {
      /* this page only */
    }
  }
}

/** The work area `work` arranged and placed as `hooks` say, from now on: place() again whenever what it shows changes. */
export const work = (node: HTMLElement, hooks: WorkHooks): Work => new Work(node, hooks);
