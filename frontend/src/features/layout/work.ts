// The WORK AREA as the reader arranges it: one block for each task shown (or each panel of none, a terminal's), each
// laid out as its task's arrangement says -- kept per task in this browser, with its tabs (tasks.ts) -- the blocks as
// the tasks' arrangement says (blocks.ts), all built afresh from the panels shown each time the work area is placed
// (build.ts), in one of several screens (tabs.ts). A bar dragged keeps its sizes in the arrangement it is of; a panel
// dragged by its head, or a task by its strip (move.ts), or either moved from its menu, changes it.
// Drawn so a task reads as one thing, a tab as another: the tabs' bar on top, the tasks under it in a well of their own,
// each task a card (its frame drawn over its panels, the well showing between cards), its panels split by a line only;
// a tab showing nothing, a note saying so.
import { addItem, keepSizes, leaves, mark, move, remove, swap, toSide, type Side, type Zone } from "./arrange";
import { type Put } from "./blocks";
import { APP, build, TOP_BAND, type Built, type Old, type Shown } from "./build";
import { Mover } from "./move";
import { Placer } from "./place";
import { TABS_H, Tabs } from "./tabs";
import { drawStrip, Tasks } from "./tasks";
import type { Node, Rect, Size } from "./tree";

export { addItem };
export { build, firstTree, leafId, PANE_MIN, TOP_BAND, TOP_MIN, BELOW_MIN } from "./build";
export type { Built, Old, Shown, Shows } from "./build";

const TOP_KEY = "ag-dashboard-editor-height";
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
  /** A pane minimized now, or shown whole again (its own choice, or something moved from above or below it). */
  minChanged: (node: HTMLElement, on: boolean) => void;
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
  /** A task's key as it is now (tabs.ts's): a lone item's since put in a task, the task's; null, gone. */
  canon?: (key: string) => string | null;
  /** What the actors of these tasks do, all told: "asking", "error", "working", or "". */
  status: (tasks: string[]) => string;
  /** A task's tab shown: these of its panels open, its others closed. */
  showItems: (key: string, items: string[]) => Promise<void>;
  /** A task's lead actor (a new tab of it holds it). */
  lead: (key: string) => string | null;
  /** The tab shown emptied: every task's panels closed (a new tab, empty). */
  clear?: () => Promise<void>;
  /** These tasks, shown, about to be left for another tab: each kept as it is now, to be opened so again. */
  remember?: (keys: string[]) => void;
  /** A block's faces (its task's actors', its apps' marks) and what is in it, in words: on its card's head, its tab. */
  faces?: (block: string) => HTMLElement[];
  about?: (block: string) => string;
  /** Where the tasks are open changed (a tab shown, made, closed; a task opened or closed): the list marked again. */
  listed?: () => void;
}
/** What a panel (or a task, by its strip) can be moved to from its menu: a side, or another's place; `task`: the task is
 * moved (its strip, or the head of its only panel shown); another tab of its task, or a new one (`split`). */
export interface Moves {
  sides: Side[];
  others: HTMLElement[];
  task: boolean;
  tabs: { id: string; name: string }[];
  split: boolean;
}

const SCREEN_KEY = "ag-dashboard-screen";
// the well under the tabs' bar, this far from the work area's sides and bottom; the cards this far in it, and apart
export const WELL = 6,
  PAD = 6,
  GAP = 6;
const EMPTY = "\u0007empty"; // a tab showing nothing: its note, placed as a panel
// a block dragged, by its strip or its row in the list; a task not shown, dropped from the list
const BLOCK = "\u0004",
  NEW = "\u0005",
  TAB = "\u0006"; // another tab of a panel's task, by its name in the task's strip: TAB block \u0001 tab

export class Work {
  private readonly tasks = new Tasks(); // each task's arrangement, and its tabs
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
  private mins = new Set<HTMLElement>(); // the panes minimized, as last placed; those that can be
  private unders = new Set<HTMLElement>();
  private readonly cardBox: HTMLElement; // each block's card: its frame, drawn over its panels
  private readonly cards = new Map<string, HTMLElement>();
  private readonly empty: HTMLElement;
  private listedFor = "";

  constructor(
    private readonly work: HTMLElement,
    private readonly hooks: WorkHooks,
  ) {
    const read = <T>(key: string, none: T): T => {
      try {
        return JSON.parse(localStorage.getItem(key) || "null") ?? none;
      } catch {
        return none;
      }
    };
    this.screen = read(SCREEN_KEY, null);
    const well = document.createElement("div");
    well.className = "lay-well";
    work.prepend(well); // (first: under every panel)
    this.stripBox = document.createElement("div");
    this.stripBox.className = "lay-strips";
    this.cardBox = document.createElement("div");
    this.cardBox.className = "lay-cards";
    this.empty = document.createElement("div");
    this.empty.className = "lay-empty";
    this.empty.hidden = true;
    const head = document.createElement("strong"),
      line = document.createElement("span");
    head.textContent = "Nothing open in this tab";
    line.textContent = "Click a task in the list to open it here.";
    this.empty.append(head, line);
    work.append(this.stripBox, this.cardBox, this.empty);
    this.tabs = new Tabs(work, {
      // the tasks shown, by their keys now (the panels', not as last placed: a lone item put in a task since has its
      // task's key, whether or not the work area was placed again)
      shown: () => {
        const keys = this.hooks.shown().map((s) => s.key);
        return keys.filter((k, i): k is string => !!k && keys.indexOf(k) === i);
      },
      focus: hooks.focus,
      enter: hooks.enter,
      canon: hooks.canon,
      clear: hooks.clear,
      remember: hooks.remember,
      name: hooks.label,
      faces: (k) => (hooks.faces ? hooks.faces(k).slice(0, 1) : []),
      status: hooks.status,
      screen: () => this.screen,
      setScreen: (screen) => {
        this.screen = screen;
        this.saveScreen();
      },
      hold: (on) => (this.holding = on),
      changed: () => {
        this.place();
        this.hooks.listed?.();
      },
    });
    this.placer = new Placer(work, {
      tree: (box) => this.tree(box),
      node: (id) => this.last?.nodes.get(id) ?? null,
      resized: (key, sizes, done) => this.resized(key, sizes, done),
      inset: () => ({ top: TABS_H + PAD, right: WELL + PAD, bottom: WELL + PAD, left: WELL + PAD }),
      fitted: (id) => !!this.last?.minimized.has(id),
      placed: () => this.drawCards(),
    });
    this.mover = new Mover(work, {
      rects: () => this.rects(),
      targets: (id) => this.targets(id),
      // a task not shown: on a side of another, never in its place; a panel on another tab's name: into that tab
      edge: (id, target) => (target.startsWith(TAB) ? 0 : id.startsWith(NEW) ? 0.5 : 0.25),
      moved: (id, target, zone, copy) => this.moved(id, target, zone, copy),
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
  /** A task's row dragged from the list over the work area: opened where it is dropped -- one open in a tab, none. */
  offer(key: string): boolean {
    if (!this.last || this.last.blocks.includes(key) || this.tabs.where(key)) return false;
    return this.mover.start(NEW + key);
  }
  /** The tab of task `key` holding `item`, when the one shown does not: to be shown before it (a click on it, listed). */
  itemTab(key: string, item: string): string | null {
    const tabs = this.tasks.tabs(key);
    if (!tabs) return null;
    const holds = (id: string): boolean => {
      const t = tabs.tabs.find((x) => x.id === id);
      return !!t && leaves(t.tree).includes(item);
    };
    return holds(tabs.shown) ? null : (tabs.tabs.find((t) => holds(t.id))?.id ?? null);
  }
  /** What a panel (or a task, by its strip) can be moved to from its menu: a side, another's place, another tab of its
   * task, a new one. */
  moves(node: HTMLElement): Moves | null {
    const id = this.idOf(node);
    if (!id) return null;
    const others = this.targets(id).filter((o) => !o.startsWith(TAB));
    // a task, by its strip -- or its only panel shown, which has none
    const nodeOf = (o: string): HTMLElement | undefined => {
      if (!o.startsWith(BLOCK)) return this.last!.nodes.get(o);
      const b = o.slice(1);
      return (
        this.strips.get(b) ||
        [...this.last!.items].filter(([, v]) => v.block === b).map(([i]) => this.last!.nodes.get(i))[0]
      );
    };
    const of = id.startsWith(BLOCK) ? null : this.itemOf(node),
      tabs = of ? this.tasks.tabs(of.key) : null;
    const moves: Moves = {
      sides: others.length ? ["left", "right", "top", "bottom"] : [],
      others: others.map(nodeOf).filter((n): n is HTMLElement => !!n),
      task: id.startsWith(BLOCK),
      tabs: tabs ? tabs.tabs.filter((t) => t.id !== tabs.shown).map((t) => ({ id: t.id, name: t.name })) : [],
      split: !!of && others.length > 0, // into a new tab: its tab keeps the others
    };
    return moves.sides.length || moves.tabs.length || moves.split ? moves : null;
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
    const built = build(this.hooks.shown(), this.tasks.trees(), this.hooks.old, {
      top: lastTop(),
      h: box.h,
      screen: this.screen,
      put: this.put,
      strip: (b) => this.strip(b),
      tabbed: (b) => !!this.tasks.tabs(b),
      gap: GAP,
    });
    for (const [k, t] of Object.entries(built.added)) this.tasks.set(k, t);
    if (Object.keys(built.added).length) this.tasks.save();
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
    const listed = JSON.stringify(built.blocks); // what is open here changed: the list marked again
    if (listed !== this.listedFor) {
      this.listedFor = listed;
      queueMicrotask(() => this.hooks.listed?.());
    }
    // the panes minimized now, or no longer -- or able to be, or no longer: each told (once placed), to draw itself so
    const now = new Set([...built.minimized].map((id) => built.nodes.get(id)!)),
      under = new Set([...built.under].map((id) => built.nodes.get(id)!));
    for (const n of new Set([...now, ...this.mins, ...under, ...this.unders]))
      if (now.has(n) !== this.mins.has(n) || under.has(n) !== this.unders.has(n))
        queueMicrotask(() => this.hooks.minChanged(n, now.has(n)));
    this.mins = now;
    this.unders = under;
    this.empty.hidden = !!built.tree;
    if (built.tree) return built.tree;
    built.nodes.set(EMPTY, this.empty); // nothing open: the note, in the whole well
    return { id: EMPTY };
  }

  // Each block's card: a frame round its panels (its strip with them), where they were placed -- over them, letting the
  // pointer by; none at a phone's width
  private drawCards(): void {
    const rects = this.last ? this.rects() : new Map<string, Rect>(),
      now = new Set<string>();
    for (const b of this.last?.blocks || []) {
      const r = rects.get(BLOCK + b);
      if (!r) continue;
      now.add(b);
      let e = this.cards.get(b);
      if (!e) {
        e = document.createElement("div");
        e.className = "lay-card";
        e.setAttribute("aria-hidden", "true");
        this.cardBox.append(e);
        this.cards.set(b, e);
      }
      const s = e.style;
      [s.left, s.top, s.width, s.height] = [r.x, r.y, r.w, r.h].map((n) => `${n}px`);
    }
    for (const [b, e] of this.cards)
      if (!now.has(b)) {
        e.remove();
        this.cards.delete(b);
      }
  }

  // PANES MINIMIZED, each on its own: only its message box, where something of its task is above or below it
  /** Whether a pane is minimized now. */
  isMin(node: HTMLElement): boolean {
    return this.mins.has(node);
  }
  /** Whether a pane can be minimized: something of its task above or below it. */
  canMin(node: HTMLElement): boolean {
    for (const [id, n] of this.last?.nodes || []) if (n === node) return !!this.last?.under.has(id);
    return false;
  }
  /** A pane minimized, or shown whole again: kept in its task's arrangement (the tab shown). */
  setMin(node: HTMLElement, on: boolean): void {
    const id = [...(this.last?.nodes || [])].find(([, n]) => n === node)?.[0] ?? null;
    this.arrange(id, (t, item) => mark(t, item, { min: on || undefined }));
  }

  // A block's strip, while other blocks are shown (or its task has tabs): what it is called, dragged (or right-clicked)
  // to move it; its task's tabs (tasks.ts's drawStrip)
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
    const head = { name: this.hooks.label(b), faces: this.hooks.faces?.(b) || [], about: this.hooks.about?.(b) || "" };
    drawStrip(e, head, this.tasks.tabs(b), {
      show: (tab) => void this.showTab(b, tab),
      close: (tab) => this.closeTab(b, tab),
      rename: (tab, name) => {
        this.tasks.rename(b, tab, name);
        this.tasks.save();
        this.place();
      },
      add: this.hooks.lead(b)
        ? () => {
            const lead = this.hooks.lead(b);
            if (lead) void this.showTab(b, this.tasks.addTab(b, { id: lead }));
          }
        : null,
    });
    return e;
  }

  // TASK TABS (tasks.ts). A panel put in a new tab of its task, or in another (`copy`: kept in this one too), that tab
  // shown -- or, its tab left with nothing, that one closed.
  toNewTab(node: HTMLElement, copy = false): void {
    const of = this.itemOf(node);
    if (!of) return;
    const id = this.tasks.addTab(of.key, { id: of.item });
    this.toTab(node, id, copy, true);
  }
  toTab(node: HTMLElement, tab: string, copy = false, show = false): void {
    const of = this.itemOf(node),
      tabs = of && this.tasks.tabs(of.key);
    if (!of || !tabs) return;
    const kind = { item: of.item, app: of.item.startsWith(APP) };
    this.tasks.changeTab(of.key, tab, (t) => (leaves(t).includes(of.item) ? t : addItem(t, kind, [kind])));
    const left = copy || this.tasks.changeTab(of.key, tabs.shown, (t) => remove(t, of.item));
    this.tasks.save();
    void this.showTab(of.key, show || !left ? tab : this.tasks.tabs(of.key)?.shown || tab);
  }
  /** A tab of a task shown: its panels open, the task's others closed (hooks.showItems). */
  async showTab(key: string, tab: string): Promise<void> {
    const tree = this.tasks.showTab(key, tab);
    if (!tree) return;
    this.tasks.save();
    this.holding = true;
    try {
      await this.hooks.showItems(key, leaves(tree));
    } finally {
      this.holding = false;
      this.place();
    }
  }
  private closeTab(key: string, tab: string): void {
    const was = this.tasks.tabs(key)?.shown;
    this.tasks.closeTab(key, tab);
    this.tasks.save();
    const tree = this.tasks.tree(key);
    if (was === tab && tree) void this.hooks.showItems(key, leaves(tree)).then(() => this.place());
    else this.place();
  }
  /** A panel closed by the reader: out of its task's tab shown (a task of tabs; one of one keeps where it was). */
  closed(node: HTMLElement): void {
    const of = this.itemOf(node),
      tabs = of && this.tasks.tabs(of.key);
    if (!of || !tabs) return;
    if (!this.tasks.changeTab(of.key, tabs.shown, (t) => remove(t, of.item))) {
      const tree = this.tasks.tree(of.key); // its tab emptied, closed: the next shown
      if (tree) void this.hooks.showItems(of.key, leaves(tree)).then(() => this.place());
    }
    this.tasks.save();
  }
  // a panel's task and item there (a task's, not a terminal's)
  private itemOf(node: HTMLElement): { key: string; item: string } | null {
    for (const [id, n] of this.last?.nodes || []) {
      const of = n === node ? this.last!.items.get(id) : null;
      if (of && of.key !== null) return { key: of.key, item: of.item };
    }
    return null;
  }

  // what a node moves: a strip, its task; a panel, itself -- or, the only one of its task shown, its task
  private idOf(node: HTMLElement): string | null {
    for (const [id, n] of this.last?.nodes || []) {
      if (n !== node) continue;
      if (this.last!.strips.has(id)) return BLOCK + this.last!.strips.get(id);
      const { block: b, key } = this.last!.items.get(id)!;
      const alone = ![...this.last!.items].some(([o, v]) => o !== id && v.block === b);
      const tabbed = key !== null && !!this.tasks.tabs(key); // (its strip moves the task)
      return alone && !tabbed && this.last!.blocks.length > 1 ? BLOCK + b : id;
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
    const box = this.work.getBoundingClientRect(); // and each tab's name in a task's strip
    for (const [b, e] of this.strips)
      for (const chip of e.querySelectorAll<HTMLElement>(".lay-ttab[data-tab]")) {
        const r = chip.getBoundingClientRect();
        out.set(`${TAB}${b}\u0001${chip.dataset.tab}`, {
          x: r.left - box.left,
          y: r.top - box.top,
          w: r.width,
          h: r.height,
        });
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
    const tabs = this.tasks.tabs(of.key);
    return [
      ...[...this.last!.items].filter(([o, v]) => o !== id && v.block === of.block).map(([o]) => o),
      ...(tabs ? tabs.tabs.filter((t) => t.id !== tabs.shown).map((t) => `${TAB}${of.block}\u0001${t.id}`) : []),
    ];
  }
  private moved(id: string, target: string, zone: Zone, copy = false): void {
    if (target.startsWith(TAB)) {
      const node = this.last?.nodes.get(id);
      if (node) this.toTab(node, target.split("\u0001")[1], copy);
    } else if (id.startsWith(NEW)) {
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
    const kept = of && of.key !== null ? this.tasks.tree(of.key) : null;
    if (!of || !kept) return;
    this.tasks.set(of.key!, change(kept, of.item));
    this.tasks.save();
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
        if (s.task) this.tasks.touch(s.task);
        this.tasks.save();
      }
    }
    this.place();
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
