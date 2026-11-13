// The WORK AREA as the reader arranges it: one block for each task shown (or each panel of none, a terminal's), side by
// side, each laid out as its task's arrangement says (arrange.ts) -- kept per task in this browser, made the first time
// the task shows (its apps side by side above its actors side by side; or as an older page kept the task: firstTree),
// and a panel opened in it since put where a panel of its kind goes (addItem). Built from the panels shown (the page's
// own pane, the others, the apps' panels) each time the work area is placed (build): the panels not shown left out of
// it, the chat minimized under the apps (the panes as tall as their message boxes), the apps' row never dragged as tall
// as the one dragged last. A bar dragged keeps its sizes in the task's arrangement; a panel dragged by its head
// (move.ts), or moved from its menu, changes it.
import { addItem, keepSizes, leaves, move, swap, toSide, view, type Side, type Zone } from "./arrange";
import { arrangeBlocks, type Put } from "./blocks";
import { Mover } from "./move";
import { Placer } from "./place";
import { Tabs } from "./tabs";
import { isSplit, type Node, type Rect, type Size, type Split } from "./tree";

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

export { addItem };
export const leafId = (block: string, item: string): string => `${block}\u0001${item}`;
const STRIP = "\u0003strip", // a block's strip, as an item of it
  STRIP_H = 24;

/** The work area's tree for the panels `shown`, the arrangements kept (`trees`) and an older page's (`old`): a block for
 * each task shown, arranged as `screen` says (blocks.ts; `put`, where one newly shown goes), each under its `strip` while
 * there are others, each its arrangement as it shows the panels shown -- `min`: the chat minimized under the apps; `top`:
 * the apps' row dragged last; `h`: the work area's height. */
export function build<N>(
  shown: Shown<N>[],
  trees: Record<string, Node>,
  old: (key: string) => Old | null,
  opts: {
    min: boolean;
    top: number | null;
    h: number;
    screen?: Node | null;
    put?: Put | null;
    strip?: (block: string) => N;
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
  // the blocks as the reader arranged them (blocks.ts), each under a strip of its own while others are shown
  out.blocks = out.blocks.filter((_, i) => !!laid[i]);
  const own = (b: string): Shown<N>[] => shown.filter((s) => blockOf(s) === b);
  out.screen = arrangeBlocks(
    opts.screen ?? null,
    out.blocks.map((b) => ({ key: b, alone: own(b).every((s) => s.app) })),
    opts.put ?? null,
  );
  // (a block of one panel has none: that panel's head moves the block)
  const strips = out.blocks.length > 1 && !!opts.strip;
  const block = (b: string): Node => {
    const n = laid.find((_, i) => blocks0[i] === b)!;
    if (!strips || own(b).length < 2) return n;
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
    const band = v.dir === "col" && all.some(Boolean) && none.some(Boolean),
      min = opts.min && band;
    const kids = v.kids.map(blocks);
    const sizes = v.sizes.map((z, i): Size => {
      if (min) return none[i] ? { fit: true } : { share: 1 };
      const least = v.dir === "row" ? PANE_MIN : all[i] ? TOP_MIN - TOP_BAND : BELOW_MIN;
      if (z.top) return { px: Math.max(TOP_MIN, opts.top || opts.h / 2) - TOP_BAND, min: least };
      return z.px !== undefined ? { px: z.px, min: least } : { share: z.share ?? 1, min: least };
    });
    const s: Shows = {
      key: `b${out.splits.size}`,
      dir: v.dir,
      bar: band ? TOP_BAND : 1,
      thick: band,
      still: min,
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
  /** Whether the panels' tasks are known yet (the home come): till then the tasks' arrangement is left as it was kept. */
  known: () => boolean;
  /** What a block is called on its strip: its task's name, or its panel's. */
  label: (block: string) => string;
  /** A task dropped on the work area from the list: opened beside the tasks shown (it goes where it was dropped). */
  open: (key: string) => void;
  /** The task in focus (tabs.ts). */
  focus: () => string | null;
  /** These tasks shown in place of those shown, as they were left: a screen tab shown (tabs.ts). */
  enter: (tasks: string[], focus: string | null) => Promise<void>;
  /** What the actors of these tasks do, all told: "asking", "error", "working", or "". */
  status: (tasks: string[]) => string;
}
/** What a panel (or a task, by its strip) can be moved to from its menu: a side, or another's place; `task`: the task is
 * moved (its strip, or the head of its only panel shown). */
export interface Moves {
  sides: Side[];
  others: HTMLElement[];
  task: boolean;
}

const SCREEN_KEY = "ag-dashboard-screen";
// a block dragged, by its strip or its row in the list; a task not shown, dropped from the list
const BLOCK = "\u0004",
  NEW = "\u0005";

export class Work {
  private trees: Record<string, { tree: Node; at: number }>;
  private screen: Node | null;
  private put: Put | null = null;
  private last: Built | null = null;
  private readonly strips = new Map<string, HTMLElement>();
  private readonly stripBox: HTMLElement;
  private readonly placer: Placer;
  private readonly mover: Mover;
  /** The screen tabs (tabs.ts). */
  readonly tabs: Tabs;
  private holding = false; // a tab being shown: the tasks' arrangement held as it is meanwhile

  constructor(
    work: HTMLElement,
    private readonly hooks: WorkHooks,
  ) {
    const read = <T>(key: string, none: T): T => {
      try {
        return JSON.parse(localStorage.getItem(key) || "null") ?? none;
      } catch {
        return none;
      }
    };
    this.trees = read(TREES_KEY, {});
    this.screen = read(SCREEN_KEY, null);
    this.stripBox = document.createElement("div");
    this.stripBox.className = "lay-strips";
    work.append(this.stripBox);
    this.tabs = new Tabs(work, {
      shown: () => (this.last?.blocks || []).filter((b) => !b.startsWith("\u0002")),
      focus: hooks.focus,
      enter: hooks.enter,
      name: hooks.label,
      status: hooks.status,
      screen: () => this.screen,
      setScreen: (screen) => {
        this.screen = screen;
        this.saveScreen();
      },
      hold: (on) => (this.holding = on),
      changed: () => this.place(),
    });
    this.placer = new Placer(work, {
      tree: (box) => this.tree(box),
      node: (id) => this.last?.nodes.get(id) ?? null,
      resized: (key, sizes, done) => this.resized(key, sizes, done),
      inset: () => this.tabs.height(),
    });
    this.mover = new Mover(work, {
      rects: () => this.rects(),
      targets: (id) => this.targets(id),
      edge: (id) => (id.startsWith(NEW) ? 0.5 : 0.25), // a task not shown: on a side of another, never in its place
      moved: (id, target, zone) => this.moved(id, target, zone),
    });
  }

  place(): void {
    this.placer.place();
  }

  /** A panel's head dragged, or a task's strip: false if it has nowhere to go (its task's only panel shown). */
  startMove(node: HTMLElement): boolean {
    const id = this.idOf(node);
    return !!id && this.mover.start(id);
  }
  endMove(): void {
    this.mover.end();
  }
  /** A task's row dragged from the list over the work area: the task moved, if shown, else opened where it is dropped. */
  offer(key: string): boolean {
    if (!this.last) return false;
    return this.mover.start(this.last.blocks.includes(key) ? BLOCK + key : NEW + key);
  }
  /** What a panel (or a task, by its strip) can be moved to from its menu. */
  moves(node: HTMLElement): Moves | null {
    const id = this.idOf(node),
      others = id ? this.targets(id) : [];
    if (!id || !others.length) return null;
    // a task, by its strip -- or its only panel shown, which has none
    const nodeOf = (o: string): HTMLElement | undefined => {
      if (!o.startsWith(BLOCK)) return this.last!.nodes.get(o);
      const b = o.slice(1);
      return (
        this.strips.get(b) ||
        [...this.last!.items].filter(([, v]) => v.block === b).map(([i]) => this.last!.nodes.get(i))[0]
      );
    };
    const nodes = others.map(nodeOf).filter((n): n is HTMLElement => !!n);
    return { sides: ["left", "right", "top", "bottom"], others: nodes, task: id.startsWith(BLOCK) };
  }
  toSide(node: HTMLElement, side: Side): void {
    const id = this.idOf(node);
    if (id?.startsWith(BLOCK)) this.arrangeBlocks((t) => toSide(t, id.slice(1), side));
    else this.arrange(id, (t, item) => toSide(t, item, side));
  }
  swapWith(node: HTMLElement, other: HTMLElement): void {
    const id = this.idOf(node),
      o = this.idOf(other);
    if (!id || !o) return;
    if (id.startsWith(BLOCK)) this.arrangeBlocks((t) => swap(t, id.slice(1), o.slice(1)));
    else if (this.last?.items.get(o)) this.arrange(id, (t, item) => swap(t, item, this.last!.items.get(o)!.item));
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
      screen: this.screen,
      put: this.put,
      strip: (b) => this.strip(b),
    });
    for (const [k, t] of Object.entries(built.added)) this.trees[k] = { tree: t, at: Date.now() };
    if (Object.keys(built.added).length) this.save();
    if (this.put && leaves(built.screen).includes(this.put.key)) this.put = null; // put where it was dropped
    if (!this.hooks.known() || this.holding) {
      // (no task known yet, each panel a block of its own -- or a tab being shown, its tasks coming one by one: the
      // tasks' arrangement kept as it is till they are)
    } else if (JSON.stringify(built.screen) !== JSON.stringify(this.screen)) {
      this.screen = built.screen;
      this.saveScreen();
    } else this.screen = built.screen;
    const striped = new Set(built.strips.values());
    for (const [b, e] of this.strips)
      if (!striped.has(b)) {
        e.remove(); // its block gone, or the only one left
        this.strips.delete(b);
      }
    this.last = built;
    this.tabs.draw();
    return built.tree;
  }

  // A block's strip, while other blocks are shown: what it is called, dragged (or right-clicked) to move it.
  private strip(b: string): HTMLElement {
    let e = this.strips.get(b);
    if (!e) {
      e = document.createElement("div");
      e.className = "lay-strip";
      e.draggable = true;
      e.title = "Drag to move this task beside another · right-click: move it";
      this.stripBox.append(e);
      this.strips.set(b, e);
    }
    const name = this.hooks.label(b);
    if (e.textContent !== name) e.textContent = name;
    if (e.dataset.name !== name) e.dataset.name = name;
    return e;
  }

  // what a node moves: a strip, its task; a panel, itself -- or, the only one of its task shown, its task
  private idOf(node: HTMLElement): string | null {
    for (const [id, n] of this.last?.nodes || []) {
      if (n !== node) continue;
      if (this.last!.strips.has(id)) return BLOCK + this.last!.strips.get(id);
      const b = this.last!.items.get(id)!.block;
      const alone = ![...this.last!.items].some(([o, v]) => o !== id && v.block === b);
      return alone && this.last!.blocks.length > 1 ? BLOCK + b : id;
    }
    return null;
  }
  // where each panel is, and each block (all its panels, its strip with them)
  private rects(): Map<string, Rect> {
    const out = new Map(this.placer.rects());
    for (const [id, r] of this.placer.rects()) {
      const b = this.last?.items.get(id)?.block ?? this.last?.strips.get(id);
      if (b === undefined) continue;
      const was = out.get(BLOCK + b);
      if (!was) out.set(BLOCK + b, { ...r });
      else {
        const x = Math.min(was.x, r.x),
          y = Math.min(was.y, r.y);
        out.set(BLOCK + b, {
          x,
          y,
          w: Math.max(was.x + was.w, r.x + r.w) - x,
          h: Math.max(was.y + was.h, r.y + r.h) - y,
        });
      }
    }
    return out;
  }
  // where `id` can go: a panel, beside the others of its task shown; a block, beside the other blocks; a task not shown,
  // beside any
  private targets(id: string): string[] {
    const blocks = this.last?.blocks || [];
    if (id.startsWith(NEW)) return blocks.map((b) => BLOCK + b);
    if (id.startsWith(BLOCK)) return blocks.filter((b) => BLOCK + b !== id).map((b) => BLOCK + b);
    const of = this.last?.items.get(id);
    if (!of || of.key === null) return [];
    return [...this.last!.items].filter(([o, v]) => o !== id && v.block === of.block).map(([o]) => o);
  }
  private moved(id: string, target: string, zone: Zone): void {
    if (id.startsWith(NEW)) {
      if (zone === "center") return;
      this.put = { key: id.slice(1), target: target.slice(1), side: zone };
      this.hooks.open(id.slice(1));
    } else if (id.startsWith(BLOCK)) this.arrangeBlocks((t) => move(t, id.slice(1), target.slice(1), zone));
    else {
      const t = this.last?.items.get(target);
      if (t) this.arrange(id, (tree, item) => move(tree, item, t.item, zone));
    }
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
  // the blocks' arrangement changed: kept, and placed so
  private arrangeBlocks(change: (tree: Node) => Node): void {
    if (!this.screen) return;
    this.screen = change(this.screen);
    this.saveScreen();
    this.place();
  }
  private resized(key: string, sizes: Size[], done: boolean): void {
    const s = this.last?.splits.get(key);
    if (!s || !s.src) return;
    keepSizes(s, sizes);
    // an app's panel, or the strip of a block of apps alone
    const items = [...(this.last?.items.values() || [])];
    const app = (id: string): boolean => {
      const b = this.last?.strips.get(id);
      if (b !== undefined) return items.filter((v) => v.block === b).every((v) => v.item.startsWith(APP));
      return !!this.last?.items.get(id)?.item.startsWith(APP);
    };
    const top = s.thick ? sizes.find((z, i) => z.px !== undefined && leaves(s.kids[i]).every(app)) : null;
    if (top && done) {
      try {
        localStorage.setItem(TOP_KEY, String(top.px! + TOP_BAND)); // a task's apps' row not dragged yet: as tall
      } catch {
        /* this page only */
      }
    }
    if (done) {
      if (s.screen) this.saveScreen();
      else {
        if (s.task && this.trees[s.task]) this.trees[s.task].at = Date.now();
        this.save();
      }
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
  private saveScreen(): void {
    try {
      localStorage.setItem(SCREEN_KEY, JSON.stringify(this.screen));
    } catch {
      /* this page only */
    }
  }
}

/** The work area `work` arranged and placed as `hooks` say, from now on: place() again whenever what it shows changes. */
export const work = (node: HTMLElement, hooks: WorkHooks): Work => new Work(node, hooks);
