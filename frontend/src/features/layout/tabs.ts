// SCREEN TABS: the work area as several screens, one shown at a time, each a set of tasks and how they are arranged
// (blocks.ts). A task is in one tab at most: it is OPEN if any of its items is shown in a tab -- the tab shown (what the
// work area shows) or another (what it was left showing). A tab not shown keeps its tasks, their arrangement and the
// task in focus; shown again, its tasks are opened again as they were left (the page's task switching does it:
// hooks.enter), the tab left kept so first. A plain click in the list on a task (route) shows it where it is open -- the
// tab shown, or another, brought forward -- and a task open nowhere in a tab of its own, new (the tab shown, if it
// shows nothing). ⌥+click makes the tab shown the task's alone (take: out of any other tab; the page closes the rest).
// The tabs' bar, over the work area always: each tab a map of its panels as they are laid out (tab-map.ts: a tab reads
// as a screen of panels, never as a Browser's tab), its name (its tasks', or one given it by a double-click), each
// task's state marked on its lead's box in the map (MARKS: waiting on the reader, failed, an app's notification, done
// since they looked, at work, in the background -- idle, none), its × (none, the only one; shown while pointed at);
// pressed, shown; dragged along the bar, the others slid aside where it would go (bar-drag.ts), and let go anywhere on
// it, put there (dragged off it, onto the work area, a tab not shown opens its tasks there: work.ts); and a "+" for a new
// tab, empty. A task of the tab shown, the tab showing others too, moved to another tab (put): dragged by its card head
// onto another tab's name, into that tab -- anywhere else on the bar ("New tab" shown there meanwhile), into a new tab --
// or from its menu; the tab shown stays shown.
// A new tab ("+", or the new-tab key) shows the page's new-tab page (work.ts's `blank` hook): a message box for a new
// actor, its apps. What is typed there is the tab's DRAFT, kept with it: a tab with one is kept when left, as one with
// tasks is, and a task clicked in the list goes in a tab of its own, as from a tab with tasks -- but what its page opens
// (filling) goes in it. The close key closes the tab shown (closeShown) -- the only one, emptied: a new tab again.
// A task closed in the list (its ×) is closed in the tabs too (closed): its tab closed, as that tab's × does, if it held
// nothing else; else the task out of it.
// A PAGE of the dashboard's -- the Apps page -- is a tab's too (openPage): a tab holding no task shows it in place of
// the new-tab page, named after it, kept when left as one with tasks is; a task clicked in the list goes in a tab of
// its own, as from a tab with tasks. One tab at most shows a page: opened again, that tab is shown.
import { glyph } from "../../core/ui/glyphs";
import { BarDrag } from "./bar-drag";
import { nameInPlace } from "./tab-naming";
import { drawMap, pageMark, sameMap, snapshot, type CellLook } from "./tab-map";
import type { Node, Rect } from "./tree";
import { MARKS, PAGES, pressing, tabLook, type State, type TabLook } from "./tab-look";
import * as M from "./model";
import { shadow } from "./shadow";

/** A screen tab: the layout model's (model.ts). */
export type Tab = M.Tab;
export interface TabsHooks {
  /** The tasks the work area shows, in order. */
  shown: () => string[];
  /** The task in focus. */
  focus: () => string | null;
  /** Show these tasks (`focus` first, the others beside it), as they were left, in place of the tasks shown: their panes
   * opened, not waiting on what each loads to show. */
  enter: (tasks: string[], focus: string | null) => Promise<void>;
  /** A task's key as it is now (a lone item since put in a task: the task's), null if it is gone: a tab keeps keys,
   * and a key changes as its items join or leave a task. */
  canon?: (task: string) => string | null;
  /** The tab shown emptied: every task's panels closed (a new tab, "+"). */
  clear?: () => Promise<void>;
  /** These tasks, shown, about to be left: each kept as it is now (its actors, apps, views), to be opened so again. */
  remember?: (tasks: string[]) => void;
  name: (task: string) => string;
  /** What a panel's box shows in a tab's map: an actor's hue and face, an app's mark (tab-map.ts). */
  look?: (task: string, item: string) => CellLook | null;
  /** A task's lead's item (an actor's channel, its app's): its box in a tab's map when none is kept of it. */
  lead?: (task: string) => string;
  /** The states of a task's items (its actors', its apps'), its lead's first: each its mark (MARKS', or "": idle,
   * closed) and its word (as the list says it). */
  status?: (task: string) => State[];
  /** The tasks' arrangement in the work area (work.ts's): read, set, and held as it is while a tab is being shown. */
  screen: () => Node | null;
  setScreen: (screen: Node | null) => void;
  hold: (on: boolean) => void;
  /** A tab shown, made, closed: the work area placed again (and the list marked again). */
  changed: () => void;
  /** A tab's name picked up to be dragged (its id), or let go (null): dropped on the work area, its tasks open there. */
  dragged?: (id: string | null) => void;
  /** The task of the tab shown being dragged (by its card head, or its only panel's) that can go to another tab, if one
   * is: the tab showing other tasks too. */
  carried?: () => string | null;
  /** That task let go on the bar: on another tab's name (`to`, its id), into that tab; anywhere else on it (null), into a
   * new tab at its end. */
  carry?: (task: string, to: string | null) => void;
}

export const TABS_H = 40;
let made = 0;
const newId = (): string => `s${Date.now().toString(36)}${(made++).toString(36)}`;

export { MARKS, PAGES, pressing, type State }; // (tab-look.ts's, as tabs.ts gave them)

export class Tabs {
  // the tabs and the tab shown: the layout model's (model.ts, kept by shadow.ts), read -- every change made by its rules
  private get tabs(): Tab[] {
    return shadow.now().tabs;
  }
  private get current(): string {
    return shadow.now().current;
  }
  private switching = false; // a tab being shown, its tasks' panes opened one by one (the screen held as it is meanwhile)
  private settling: Promise<void> = Promise.resolve(); // the tab being shown (or made): done
  private started = false; // the page's first tab shown as it was left (start): the tab shown kept as it changes since
  private fill = false; // the tab shown's new-tab page opening something in it: its draft does not keep it from it
  private readonly strip: HTMLElement;
  private readonly list: HTMLElement;
  private readonly add: HTMLButtonElement;
  private readonly drag: BarDrag; // what is dragged over the bar: a tab along it, or a task onto it
  private readonly slot: HTMLElement | null; // the top bar's place for it, if the page has one
  private later = false; // the bar to be drawn again once a tab dragged along it is let go (not till then)

  constructor(
    work: HTMLElement,
    private readonly hooks: TabsHooks,
  ) {
    shadow.start(); // the layout model (model.ts): the tabs kept read, or one new tab
    shadow.canonWith(hooks.canon);
    this.strip = document.createElement("div");
    this.strip.className = "lay-tabs";
    this.list = document.createElement("div");
    this.list.className = "lay-tab-list";
    this.list.setAttribute("role", "tablist");
    this.list.setAttribute("aria-label", "Screen tabs");
    this.add = document.createElement("button");
    this.add.type = "button";
    this.add.className = "lay-tab-add";
    this.add.append(glyph("plus", 16));
    this.add.title = this.add.ariaLabel = "New tab";
    this.add.addEventListener("click", () => void this.blank());
    this.drag = new BarDrag(this.list);
    this.strip.append(this.list, this.drag.ghost, this.add);
    // in the page's top bar, beside its logo (its #tab-slot); with none (a test's bare page), over the work area
    this.slot = document.getElementById("tab-slot");
    (this.slot ?? work).append(this.strip);
    // a tab dragged along the bar: the others slid aside where it would go; let go, it goes there. A task dragged over
    // it: where it would go marked; let go, it goes there. Taken on entering each part of the bar too: the browser lets
    // go there by what the drag's last event over it said, and it is that one when the pointer has just come onto it
    const over = (ev: DragEvent): void => {
      if (this.drag.lifted) {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        this.drag.slide(this.drag.slotAt(ev.clientX));
        return;
      }
      if (!this.hooks.carried?.()) return;
      const to = this.drag.into(ev, this.current);
      this.drag.mark(to);
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = to ? "move" : "none";
      if (to) ev.preventDefault();
    };
    this.strip.addEventListener("dragenter", over);
    this.strip.addEventListener("dragover", over);
    this.strip.addEventListener("dragleave", (ev) => {
      if (this.strip.contains(ev.relatedTarget as globalThis.Node | null)) return;
      this.drag.mark(null);
      this.drag.slide(null); // (off the bar: onto the work area, or nowhere)
    });
    this.strip.addEventListener("drop", (ev) => {
      if (this.drag.lifted) {
        ev.preventDefault();
        const id = this.drag.lifted,
          at = this.drag.slotAt(ev.clientX);
        this.letGo();
        this.move(id, at);
        return;
      }
      const task = this.hooks.carried?.(),
        to = task ? this.drag.into(ev, this.current) : null;
      this.drag.mark(null);
      if (!task || !to) return;
      ev.preventDefault();
      this.hooks.carry?.(task, to === "new" ? null : to.dataset.id!);
    });
  }

  /** How much of the work area's top the tabs' bar takes: none, in the page's top bar. */
  height(): number {
    return this.slot ? 0 : TABS_H;
  }
  /** Whether a tab is being shown (its tasks' panes opened one by one): a click waits (settled) before it goes anywhere --
   * a moment, the panes not waiting on what they load. */
  busy(): boolean {
    return this.switching;
  }
  /** Once the tab being shown, or made, is. */
  settled(): Promise<void> {
    return this.settling;
  }

  /** The page opened, what it shows known: the tab shown's tasks shown as it was left, if the page shows others (the
   * actor it opens on by itself) -- true if so. From then on the tab shown is kept as it changes, for a reload. */
  async start(): Promise<boolean> {
    if (this.started) return false;
    this.started = true;
    const tab = this.tab(),
      kept = this.tasksOf({ ...tab, id: "" }),
      shown = this.hooks.shown();
    if (!kept.length && (tab.draft || tab.page) && shown.length) {
      await this.switch(() => this.hooks.clear?.() ?? Promise.resolve()); // a new tab left with something typed: its page
      return true;
    }
    if (!kept.length || (kept.length === shown.length && kept.every((k) => shown.includes(k)))) return false;
    const focus = tab.focus && this.hooks.canon ? this.hooks.canon(tab.focus) : tab.focus;
    this.hooks.setScreen(tab.screen);
    await this.switch(() => this.hooks.enter(kept, focus));
    return true;
  }
  // the tab shown kept as it is now, once started: its tasks, their arrangement, the one in focus (a reload shows it so)
  private note(): void {
    if (!this.started || this.switching) return;
    const tab = this.tab(),
      screen = this.hooks.screen(),
      focus = this.hooks.focus();
    if (JSON.stringify([screen, focus]) !== JSON.stringify([tab.screen, tab.focus]))
      shadow.update(M.noted, screen, focus);
    this.save(); // (the tasks shown too: the page changes them by the model's rules)
  }
  /** The tab shown's panels placed (work.ts): its map, kept with it -- drawn again only if it looks different (a bar
   * dragged moves its boxes a pixel now and then); none taken while a tab is being shown. */
  mapped(rects: Map<string, Rect>, items: Map<string, { key: string | null; item: string }> | undefined): void {
    const tab = this.tab(),
      cells = snapshot(rects, items);
    if (this.switching || sameMap(cells, tab.map || [])) return;
    shadow.update(M.mapped, tab.id, cells);
    this.save();
    this.draw();
  }

  /** Where a task is open: the tab holding it (its number, from 1), and whether that is the tab shown; null: nowhere. */
  where(task: string): { n: number; here: boolean } | null {
    const at = this.tabs.findIndex((t) => this.tasksOf(t).includes(task));
    return at < 0 ? null : { n: at + 1, here: this.tabs[at].id === this.current };
  }

  /** A plain click in the list on a task: open in the tab shown, as it is; open in another, that tab shown, the task in
   * focus; open nowhere, a new tab for it -- the tab shown, if it shows nothing (or, `idle`, only what the page opened
   * on by itself). */
  async route(task: string, idle = false): Promise<void> {
    if (this.switching) await this.settling;
    const id = newId(),
      { layout, go } = M.route(shadow.now(), task, { idle, fill: this.fill, id });
    if (go === "tab") return this.show(layout.current, task);
    if (go === "fresh") this.fresh(id);
  }
  /** The tab shown's new-tab page opening something (an actor, an app), or done: meanwhile, a task routed goes in it,
   * whatever is typed there. */
  filling(on: boolean): void {
    this.fill = on;
  }

  /** ⌥+click: the task out of any other tab (one left with none closed, unless named), to be the tab shown's alone. */
  take(task: string): void {
    shadow.update(M.take, task);
    this.save();
    this.hooks.changed();
  }

  /** A new tab, shown, for what is shown next (a task open nowhere, clicked), the tab shown kept as it is. Its panels are
   * still there till what is shown next replaces them (blank: closed at once). */
  fresh(id = newId()): void {
    this.leave();
    shadow.update(M.fresh, id);
    this.hooks.setScreen(null);
    this.save();
    this.hooks.changed();
  }

  /** "+": a new tab, shown empty -- the tab left kept as it is, its panels closed. */
  async blank(): Promise<void> {
    if (this.switching) await this.settling;
    this.fresh();
    await this.switch(() => this.hooks.clear?.() ?? Promise.resolve());
  }

  /** The tab `id` shown, `focus` in focus (else the task in focus when it was left). */
  async show(id: string, focus: string | null = null): Promise<void> {
    if (this.switching) await this.settling; // one at a time
    if (id === this.current || !this.tabs.some((t) => t.id === id)) return;
    this.leave();
    shadow.update(M.show, id, focus);
    await this.enter();
  }
  // the tab now shown (the model's), its panes opened: its tasks, as they were left -- one showing nothing (a new tab
  // kept for what is typed in it, a page), the panels shown closed
  private async enter(): Promise<void> {
    const to = this.tab(),
      tasks = this.tasksOf(to),
      focus = to.focus && this.hooks.canon ? this.hooks.canon(to.focus) : to.focus;
    this.save();
    this.hooks.setScreen(to.screen);
    await this.switch(() =>
      tasks.length ? this.hooks.enter(tasks, focus) : (this.hooks.clear?.() ?? Promise.resolve()),
    );
  }

  // the panels of the tab shown changed (`work`): the tasks' arrangement held as it is, nothing routed, till it is done
  private async switch(work: () => Promise<void>): Promise<void> {
    this.switching = true;
    this.hooks.hold(true);
    this.draw();
    const done = (async () => {
      try {
        await work();
      } finally {
        this.switching = false;
        this.hooks.hold(false);
        this.hooks.changed();
      }
    })();
    this.settling = done.catch(() => {});
    await done;
  }

  /** The tab next to the one shown (`by` -1: before it), shown. */
  async step(by: number): Promise<void> {
    const at = this.tabs.findIndex((t) => t.id === this.current);
    if (this.tabs.length > 1) await this.show(this.tabs[(at + by + this.tabs.length) % this.tabs.length].id);
  }

  /** A tab closed (not the only one): the one shown, the next shown first. Its actors go on. */
  async close(id: string): Promise<void> {
    if (this.switching) await this.settling;
    if (this.tabs.length < 2) return;
    const shown = id === this.current;
    if (shown) this.leave();
    shadow.update(M.close, id);
    if (shown) await this.enter();
    this.save();
    this.hooks.changed();
  }
  /** The close key: the tab shown closed, the next shown -- the only one, emptied (its tasks kept as they were, its name
   * and draft gone): a new tab again. Its actors go on. */
  async closeShown(): Promise<void> {
    if (this.switching) await this.settling;
    if (this.tabs.length > 1) return this.close(this.current);
    const tab = this.tab();
    if (!this.hooks.shown().length && !tab.tasks.length && !tab.name && !tab.draft && !tab.page) return;
    this.leave();
    shadow.update(M.closeShown);
    this.hooks.setScreen(null);
    this.save();
    await this.switch(() => this.hooks.clear?.() ?? Promise.resolve());
  }
  /** Task `task` closed in the list (its ×): out of the tab holding it, as that tab's × would close it -- the tab closed
   * if it held nothing else (the tab shown: the next shown; the only one, emptied: a new tab again), else the task out of
   * it: the tab shown's, its panels closed here (`here`, as its card head's × does); another's, not opened when shown. */
  async closed(task: string, here: () => Promise<void>): Promise<void> {
    if (this.switching) await this.settling;
    const tab = this.tabs.find((t) => this.tasksOf(t).includes(task));
    if (!tab) return;
    const rest = this.tasksOf(tab).filter((k) => k !== task);
    if (tab.id === this.current) return rest.length ? here() : this.closeShown();
    if (!rest.length) return this.close(tab.id);
    shadow.update(M.closed, task);
    this.save();
    this.hooks.changed();
  }

  /** The tab shown: its id, its new-tab page's draft, and the page it shows in its place ("": none). */
  shownTab(): { id: string; draft: string; page: string } {
    const t = this.tab();
    return { id: t.id, draft: t.draft || "", page: t.page || "" };
  }

  /** A page of the dashboard's (PAGES) in a tab of its own: the tab showing it already, shown; else the tab shown, if it
   * shows nothing and has nothing typed in it; else a new tab after it, shown -- the tab left kept as it is. */
  async openPage(page: string): Promise<void> {
    if (this.switching) await this.settling;
    const there = this.tabs.find((t) => t.page === page);
    if (there) return there.id === this.current ? undefined : this.show(there.id);
    const tab = this.tab(),
      empty = !this.hooks.shown().length && !tab.tasks.length && !tab.draft && !tab.page;
    if (!empty) this.fresh();
    shadow.update(M.setPage, page);
    this.save();
    if (empty) return this.hooks.changed();
    await this.switch(() => this.hooks.clear?.() ?? Promise.resolve());
  }

  /** What the new-tab page's box of tab `id` (the tab shown's, by default) holds now, kept with it (none: dropped). */
  setDraft(text: string, id = this.current): void {
    const t = this.tabs.find((x) => x.id === id);
    if (!t || (t.draft || "") === text) return;
    shadow.update(M.setDraft, text, id);
    this.save();
  }

  /** The tasks of tab `id`, not the one shown -- none, the one shown. */
  held(id: string): string[] {
    const t = this.tabs.find((x) => x.id === id);
    return t && id !== this.current ? this.tasksOf(t) : [];
  }
  /** Tab `id` (not the one shown) dropped on the work area: gone from the bar, its tasks -- open nowhere now -- to be
   * opened in the tab shown (work.ts). */
  merge(id: string): string[] {
    const tasks = this.held(id);
    if (!tasks.length) return [];
    shadow.update(M.merged, id);
    this.save();
    this.hooks.changed();
    return tasks;
  }

  /** The tabs but the one shown: each one's id, number (from 1) and name, as the bar shows them. */
  others(): { id: string; n: number; name: string }[] {
    return this.tabs.flatMap((t, i) =>
      t.id === this.current ? [] : [{ id: t.id, n: i + 1, name: this.look(t).name }],
    );
  }
  /** Task `task`, just closed in the tab shown (kept as it was: its panels, its tabs), put in tab `to` (another), last --
   * or, none, in a new tab: after the tab shown, or (`last`) at the bar's end. Not shown: shown, the tab opens it again
   * as it was. */
  put(task: string, to: string | null, last = false): void {
    shadow.update(M.put, task, to, last, newId());
    this.save();
    this.hooks.changed();
  }
  /** A task that can go to another tab picked up (work.ts), or put down: "New tab" shown in the bar meanwhile. */
  carrying(on: boolean): void {
    this.drag.carrying(on);
  }

  /** Tab `id` put at place `at` (from 0) among the others: the bar's order, and so the list's numbers, changed. */
  move(id: string, at: number): void {
    const was = this.tabs.map((t) => t.id).join(" ");
    shadow.update(M.move, id, at);
    if (this.tabs.map((t) => t.id).join(" ") === was) return;
    this.save();
    this.list.dataset.sig = "";
    this.draw();
    this.hooks.changed(); // (the list's numbers)
  }
  // the tab dragged along the bar let go (dropped, or the drag given up): the bar drawn if it was held meanwhile
  private letGo(): void {
    if (!this.drag.drop()) return;
    this.hooks.dragged?.(null);
    if (!this.later) return;
    this.later = false;
    this.draw();
  }

  rename(id: string, name: string): void {
    if (!this.tabs.some((t) => t.id === id)) return;
    shadow.update(M.rename, id, name.trim());
    this.save();
    this.draw();
  }

  /** The bar drawn again: each tab's map, name and what its actors do (the tab shown kept as it is now). */
  draw(): void {
    this.note();
    if (this.list.querySelector("input")) return; // a name being typed: left as it is
    if (this.drag.lifted) {
      this.later = true; // a tab dragged: its name, the drag's own, kept till it is let go
      return;
    }
    const want = this.tabs.map((t) => this.look(t));
    const sig = JSON.stringify([want, this.tabs.length > 1]);
    if (this.list.dataset.sig === sig) return;
    this.list.dataset.sig = sig;
    this.list.replaceChildren(...this.tabs.map((t, i) => this.tabEl(t, want[i])));
  }

  private tab(): Tab {
    return this.tabs.find((t) => t.id === this.current)!;
  }
  // a tab's tasks, the model's, by their keys now (an item joined a task since)
  private tasksOf(t: Tab): string[] {
    if (!this.hooks.canon) return t.tasks;
    const now = t.tasks.map((k) => this.hooks.canon!(k)).filter((k): k is string => !!k);
    return now.filter((k, i) => now.indexOf(k) === i);
  }
  private look(t: Tab): TabLook {
    return tabLook(t, this.tasksOf(t), this.current, this.hooks);
  }

  // the tab shown kept as it is left: its tasks (each kept as it is: hooks.remember), their arrangement, the one in focus
  // -- none of them in another tab now (one left with none closed, unless named)
  private leave(): void {
    this.hooks.remember?.(this.hooks.shown());
    const screen = this.hooks.screen(),
      focus = this.hooks.focus();
    shadow.update(M.noted, screen, focus);
  }

  private save(): void {
    shadow.persist(); // the layout model, kept in this browser (model.ts's KEY)
  }

  private tabEl(t: Tab, look: ReturnType<Tabs["look"]>): HTMLElement {
    const e = document.createElement("div");
    e.className = "lay-tab";
    e.setAttribute("role", "tab");
    e.setAttribute("aria-selected", String(look.on));
    e.draggable = true;
    e.dataset.id = t.id;
    e.title = [`${look.name}${look.given ? "" : " · double-click to name it"}`, ...look.says].join("\n");
    const name = document.createElement("span");
    name.className = "lay-name";
    name.textContent = look.name;
    const map = drawMap(look.map, mark);
    if (look.page) map.append(pageMark()); // a page's tab: its mark in its map, where a tab's panels would be
    e.append(map, name);
    if (this.tabs.length > 1) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "lay-close";
      close.append(glyph("x", 13));
      close.title = close.ariaLabel = "Close tab (actors keep running)";
      close.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void this.close(t.id);
      });
      e.append(close);
    }
    e.addEventListener("click", () => void this.show(t.id));
    name.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      this.naming(t, name, look.given ? look.name : "");
    });
    e.addEventListener("dragstart", (ev) => {
      ev.dataTransfer?.setData("application/x-ag-tab", t.id);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
      this.drag.lift(t.id, e);
      this.hooks.dragged?.(t.id); // (onto the work area: its tasks there)
    });
    e.addEventListener("dragend", () => this.letGo());
    return e;
  }

  // its name typed in place: Enter or leaving it keeps it (none: its tasks' names again), Esc as it was
  private naming(t: Tab, span: HTMLElement, was: string): void {
    nameInPlace(span, was, (keep, value) => {
      this.list.dataset.sig = "";
      if (keep) this.rename(t.id, value);
      else this.draw();
    });
  }
}

// a state's mark: a dot in its colour -- at work, the list's dots going round, in step with the list's (one clock for all)
function mark(m: string): HTMLElement {
  const i = document.createElement("i");
  i.className = "lay-dot";
  i.dataset.status = m;
  i.setAttribute("aria-hidden", "true");
  if (m === "working") i.style.setProperty("--spin-at", `-${Date.now() % 1200}ms`);
  return i;
}
