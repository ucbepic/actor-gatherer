// The WORK AREA as the reader arranges it: one block for each task shown (or each panel of none, a terminal's), each
// laid out as its task's arrangement says -- kept per task in this browser, with its tabs (tasks.ts) -- the blocks as
// the tasks' arrangement says (blocks.ts), all built afresh from the panels shown each time the work area is placed
// (build.ts), in one of several screens (tabs.ts). A bar dragged keeps its sizes in the arrangement it is of; a panel
// dragged by its head, or a task by its strip (move.ts), or either moved from its menu, changes it. A task, the tab
// showing others too, goes to another screen tab dragged onto the tabs' bar, or from its menu (toScreenTab).
// Drawn so a task reads as one thing, a tab as another: the tabs' bar on top, the tasks under it in a well of their own,
// each task a card (its frame drawn over its panels, the well showing between cards), its panels split by a line only;
// a tab showing nothing, the page's new-tab page (hooks.blank: a box to message a new actor, its apps), or a note.
import { addItem, keepSizes, leaves, move, remove, swap, toSide, type Side, type Zone } from "./arrange";
import { type Put } from "./blocks";
import { APP, build, FOLD_UNDER, TOP_BAND, type Built, type Old, type Shown } from "./build";
import { Cards, withBlocks } from "./cards";
import { foldable, idOf, marked, markingOf, Mins, together } from "./mins";
import { Mover } from "./move";
import { Placer } from "./place";
import * as M from "./model";
import { shadow } from "./shadow";
import { Tabs, type State, type TabsHooks } from "./tabs";
import { drawStrip, Tasks } from "./tasks";
import type { Node, Rect, Size } from "./tree";

export { addItem };
export { build, firstTree, leafId, PANE_MIN, TOP_BAND, TOP_MIN, BELOW_MIN, FOLD_UNDER } from "./build";
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
  /** The states of a task's items, its lead's first: on its face in its tab (tabs.ts's State). */
  status?: (key: string) => State[];
  /** A task's tab shown: these of its panels open, its others closed. */
  showItems: (key: string, items: string[]) => Promise<void>;
  /** A task's lead actor (a new tab of it holds it). */
  lead: (key: string) => string | null;
  /** The tab shown emptied: every task's panels closed (a new tab, empty). */
  clear?: () => Promise<void>;
  /** These tasks, shown, about to be left for another tab: each kept as it is now, to be opened so again. */
  remember?: (keys: string[]) => void;
  /** A task of another tab, dropped with it on the work area: opened beside the tasks shown (where `put` says). */
  openBeside?: (key: string) => Promise<void>;
  /** A task closed by its card head's ×, or moved to another tab: its panels out of the tab shown, kept as they are (its
   * agents go on). */
  closeTask?: (key: string) => void | Promise<void>;
  /** A block's faces (its task's actors', its apps' marks) and what is in it, in words: on its card's head. */
  faces?: (block: string) => HTMLElement[];
  about?: (block: string) => string;
  /** What a panel's box shows in its screen tab's map (tab-map.ts): an actor's hue and face, an app's mark. */
  look?: TabsHooks["look"];
  /** Where the tasks are open changed (a tab shown, made, closed; a task opened or closed): the list marked again. */
  listed?: () => void;
  /** The tab shown, showing nothing: its new-tab page -- or the page it shows in its place (its `page`: the Apps page)
   * -- drawn in `box` (placed in the whole well), each time it comes in sight, or another tab showing nothing is shown
   * (`tab`, its id), or its page changes. None: a note says to click a task in the list. */
  blank?: (box: HTMLElement, tab: string) => void;
}
/** What a panel (or a task, by its strip) can be moved to from its menu: a side, or another's place; `task`: the task is
 * moved (its strip, or the head of its only panel shown); another tab of its task, or a new one (`split`); a task, the
 * tab shown showing others too, another screen tab, or a new one (`screens`: the others; null, none). */
export interface Moves {
  sides: Side[];
  others: HTMLElement[];
  task: boolean;
  tabs: { id: string; name: string }[];
  split: boolean;
  screens: { id: string; n: number; name: string }[] | null;
}

// the well under the tabs' bar, this far from the work area's sides and bottom (none: it is the work area -- the cards
// 6px in from every side and 6px apart, the least room the page's frame takes from what they show); the cards this far
// in it, and apart
export const WELL = 0,
  PAD = 6,
  GAP = 6,
  IN = WELL + PAD; // a panel's least distance from the work area's sides and bottom
const EMPTY = "\u0007empty"; // a tab showing nothing: its note, placed as a panel
// a block dragged, by its strip or its row in the list; a task not shown, dropped from the list
const BLOCK = "\u0004",
  NEW = "\u0005",
  TAB = "\u0006", // another tab of a panel's task, by its name in the task's strip: TAB block \u0001 tab
  TABS = "\u0008"; // a screen tab, by its name in the tabs' bar: its tasks dropped beside the ones shown

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
  private readonly mins = new Mins((n, on) => this.hooks.minChanged(n, on));
  private readonly cards = new Cards(); // each block's card: its frame, drawn over its panels
  private readonly empty: HTMLElement;
  private blankFor = ""; // the tab whose new-tab page `empty` shows ("": none in sight)
  private listedFor = "";

  constructor(
    private readonly work: HTMLElement,
    private readonly hooks: WorkHooks,
  ) {
    this.screen = shadow.now().tabs.find((t) => t.id === shadow.now().current)?.screen ?? null; // (the layout model's)
    const well = document.createElement("div");
    well.className = "lay-well";
    work.prepend(well); // (first: under every panel)
    this.stripBox = document.createElement("div");
    this.stripBox.className = "lay-strips";
    this.empty = document.createElement("div");
    this.empty.className = "lay-empty";
    this.empty.hidden = true;
    if (!hooks.blank) {
      const head = document.createElement("strong"),
        line = document.createElement("span");
      head.textContent = "Nothing open in this tab";
      line.textContent = "Click a task in the list to open it here.";
      this.empty.append(head, line);
    }
    work.append(this.stripBox, this.cards.el, this.empty);
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
      look: hooks.look,
      lead: (k) => hooks.lead(k) ?? k,
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
      dragged: (id) => {
        if (id && this.hooks.openBeside && this.tabs.held(id).length) this.mover.start(TABS + id);
        else if (!id) this.mover.end();
      },
      carried: () => this.carried(),
      carry: (task, to) => void this.carry(task, to, true),
    });
    this.placer = new Placer(work, {
      tree: (box) => this.tree(box),
      node: (id) => this.last?.nodes.get(id) ?? null,
      resized: (key, sizes, done) => this.resized(key, sizes, done),
      inset: () => ({ top: (this.tabs.height() || WELL) + PAD, right: IN, bottom: IN, left: IN }),
      folds: (key, kid) => (this.mins.folds(key, kid) ? FOLD_UNDER : null),
      fold: (key, kid, on) => this.fold(key, kid, on),
      placed: () => {
        const rects = this.last ? this.rects() : new Map<string, Rect>();
        this.cards.draw(this.last?.blocks || [], (b) => rects.get(BLOCK + b));
        this.tabs.mapped(this.placer.rects(), this.last?.items); // (the tab shown's map)
      },
    });
    this.mover = new Mover(work, {
      rects: () => this.rects(),
      targets: (id) => this.targets(id),
      // a task not shown (or a tab's): on a side of another, never in its place; a panel on another tab's name: into it
      edge: (id, target) => (target.startsWith(TAB) ? 0 : id.startsWith(NEW) || id.startsWith(TABS) ? 0.5 : 0.25),
      moved: (id, target, zone, copy) => this.moved(id, target, zone, copy),
    });
  }

  place(): void {
    this.placer.place();
  }

  /** A panel's head dragged, or a task's strip: false if it has nowhere to go (its task's only panel shown). */
  startMove(node: HTMLElement): boolean {
    const id = this.idOf(node);
    if (!id || !this.mover.start(id)) return false;
    // (not as the drag starts, as the cover: a page changed under a drag then can end it)
    if (this.carried()) setTimeout(() => this.tabs.carrying(!!this.carried()), 0);
    return true;
  }
  endMove(): void {
    this.mover.end();
    this.tabs.carrying(false);
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
      screens: id.startsWith(BLOCK) && this.movable(id.slice(1)) ? this.tabs.others() : null,
    };
    return moves.sides.length || moves.tabs.length || moves.split ? moves : null;
  }
  /** A task (by its strip, or its only panel's head) out of the tab shown, into screen tab `to` -- none, a new one after
   * the tab shown -- its panels closed here, kept as they are, opened so when that tab is shown. The tab shown stays. */
  toScreenTab(node: HTMLElement, to: string | null): void {
    const id = this.idOf(node);
    if (id?.startsWith(BLOCK)) void this.carry(id.slice(1), to);
  }
  private async carry(key: string, to: string | null, last = false): Promise<void> {
    if (!this.movable(key)) return;
    this.endMove(); // (dragged: its panels closed, the head it was dragged by goes, and its drag's end goes unheard)
    await this.hooks.closeTask!(key);
    this.tabs.put(key, to, last);
  }
  // whether task `key` can go to another tab: shown here, a task's block (not a terminal's), others shown beside it
  private movable(key: string): boolean {
    const blocks = this.last?.blocks || [];
    return !!this.hooks.closeTask && blocks.length > 1 && blocks.includes(key) && !key.startsWith("\u0002");
  }
  // the task being dragged, if it can go to another tab
  private carried(): string | null {
    const id = this.mover.held();
    return id.startsWith(BLOCK) && this.movable(id.slice(1)) ? id.slice(1) : null;
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
    const shown = this.hooks.shown(),
      opts = {
        top: lastTop(),
        h: box.h,
        screen: this.screen,
        put: this.put,
        strip: (b: string) => this.strip(b),
        tabbed: (b: string) => !!this.tasks.tabs(b),
        gap: GAP,
      };
    const built = build(shown, this.tasks.trees(), this.hooks.old, opts);
    for (const [k, t] of Object.entries(built.added)) this.tasks.set(k, t);
    if (Object.keys(built.added).length) this.tasks.save();
    const marking = markingOf(built, this.tasks.trees(), (trees) =>
      build(shown, trees, this.hooks.old, { ...opts, strip: (b) => this.strips.get(b) ?? this.empty }),
    );
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
    this.mins.placed(built, marking); // (the panes minimized now, or no longer: each told)
    this.empty.hidden = !!built.tree;
    const tab = built.tree ? null : this.tabs.shownTab(),
      blank = tab ? `${tab.id} ${tab.page}` : ""; // (drawn again as its page changes: the Apps page opened in it)
    if (tab && blank !== this.blankFor) queueMicrotask(() => this.hooks.blank?.(this.empty, tab.id));
    this.blankFor = blank;
    if (built.tree) return built.tree;
    built.nodes.set(EMPTY, this.empty); // nothing open: the note, in the whole well
    return { id: EMPTY };
  }

  // PANES MINIMIZED (mins.ts): only their message boxes, where something is above or below them -- panes side by side
  // together
  /** Whether a pane is minimized now. */
  isMin(node: HTMLElement): boolean {
    return this.mins.has(node);
  }
  /** Whether a pane can be minimized: something of its task, or another task, above or below it and still whole once it
   * is (no app beside it). */
  canMin(node: HTMLElement): boolean {
    return this.mins.can(node);
  }
  /** A pane minimized, or shown whole again, with the panes beside it: kept in their tasks' arrangements (the tabs
   * shown). */
  setMin(node: HTMLElement, on: boolean): void {
    const id = idOf(this.last, node);
    if (id) this.setMins(together(this.last, id, on), on);
  }
  // kid `kid` of a split minimized, or shown whole again, by its bar dragged (place.ts): each of its panes
  private fold(key: string, kid: number, on: boolean): void {
    this.setMins(foldable(this.last, key, kid), on);
  }
  // panes `ids` minimized, or shown whole: each in its task's arrangement (panes of two tasks: each task's)
  private setMins(ids: string[], on: boolean): void {
    for (const [task, t] of marked(this.last, ids, on, (k) => this.tasks.tree(k))) this.tasks.set(task, t);
    this.tasks.save();
    this.place();
  }

  // A block's strip, while other blocks are shown (or its task has tabs): what it is called, dragged (or right-clicked)
  // to move it; its task's tabs (tasks.ts's drawStrip)
  private strip(b: string): HTMLElement {
    let e = this.strips.get(b);
    if (!e) {
      e = document.createElement("div");
      e.className = "lay-strip";
      e.draggable = true;
      e.title = "Drag or right-click to move this task";
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
      closeTask: this.hooks.closeTask && !b.startsWith("\u0002") ? () => void this.hooks.closeTask!(b) : null,
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
    const out = withBlocks(this.placer.rects(), (id) => {
      const b = this.last?.items.get(id)?.block ?? this.last?.strips.get(id);
      return b === undefined ? undefined : BLOCK + b;
    });
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
    if (id.startsWith(TABS)) return blocks.length ? blocks.map((b) => BLOCK + b) : [EMPTY]; // (a tab empty: in it)
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
    } else if (id.startsWith(TABS)) void this.mergeTab(id.slice(1), target, zone);
    else if (id.startsWith(NEW)) {
      if (zone === "center") return;
      this.put = { key: id.slice(1), target: target.slice(1), side: zone };
      this.hooks.open(id.slice(1));
    } else if (id.startsWith(BLOCK)) this.arrangeBlocks((t) => move(t, id.slice(1), target.slice(1), zone));
    else {
      const t = this.last?.items.get(target);
      if (t) this.arrange(id, (tree, item) => move(tree, item, t.item, zone));
    }
  }
  // A screen tab dropped on the work area: gone from the bar, its tasks opened here one by one -- the first on the side of
  // the block it was dropped on, each next beside the one before it, on the same side's way (left or right: to its right;
  // top or bottom: under it) -- a tab showing nothing, its tasks as that tab showed them
  private async mergeTab(id: string, target: string, zone: Zone): Promise<void> {
    const tasks = this.tabs.merge(id);
    if (!tasks.length) return;
    if (target === EMPTY) return this.hooks.enter(tasks, tasks[0]);
    let at = target.slice(1),
      side: Side = zone === "center" ? "right" : zone;
    for (const k of tasks) {
      this.put = { key: k, target: at, side };
      await this.hooks.openBeside!(k);
      at = k;
      side = side === "left" || side === "right" ? "right" : "bottom";
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
    shadow.dragging(!done); // (kept in this browser once it is let go, not at each move)
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
    shadow.update(M.setScreen, this.screen); // the tab shown's arrangement: the layout model's (model.ts)
    shadow.persist();
  }
}

/** The work area `work` arranged and placed as `hooks` say, from now on: place() again whenever what it shows changes. */
export const work = (node: HTMLElement, hooks: WorkHooks): Work => new Work(node, hooks);
