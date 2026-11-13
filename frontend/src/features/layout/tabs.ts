// SCREEN TABS: the work area as several screens, one shown at a time, each a set of tasks and how they are arranged
// (blocks.ts). A task is in one tab at most: it is OPEN if any of its items is shown in a tab -- the tab shown (what the
// work area shows) or another (what it was left showing). A tab not shown keeps its tasks, their arrangement and the
// task in focus; shown again, its tasks are opened again as they were left (the page's task switching does it:
// hooks.enter), the tab left kept so first. A plain click in the list on a task (route) shows it where it is open -- the
// tab shown, or another, brought forward -- and a task open nowhere in a tab of its own, new (the tab shown, if it
// shows nothing). ⌥+click makes the tab shown the task's alone (take: out of any other tab; the page closes the rest).
// The tabs' bar, over the work area always: each tab its tasks' faces, its name (its tasks', or one given it by a
// double-click), a dot for what its actors do (asking, failed, working), its × (none, the only one); pressed, shown;
// dragged, put elsewhere; and a "+" for a new tab, empty.
import type { Node } from "./tree";

export interface Tab {
  id: string;
  name: string;
  /** the tasks it shows (kept as it is left; the tab shown: what the work area shows) */
  tasks: string[];
  screen: Node | null;
  focus: string | null;
}
export interface TabsHooks {
  /** The tasks the work area shows, in order. */
  shown: () => string[];
  /** The task in focus. */
  focus: () => string | null;
  /** Show these tasks (`focus` first, the others beside it), as they were left, in place of the tasks shown. */
  enter: (tasks: string[], focus: string | null) => Promise<void>;
  /** The tab shown emptied: every task's panels closed (a new tab, "+"). */
  clear?: () => Promise<void>;
  /** These tasks, shown, about to be left: each kept as it is now (its actors, apps, views), to be opened so again. */
  remember?: (tasks: string[]) => void;
  name: (task: string) => string;
  /** A task's faces: its lead's (or its app's mark). */
  faces?: (task: string) => HTMLElement[];
  /** What a tab's actors do, all told: "asking", "error", "working", or "". */
  status: (tasks: string[]) => string;
  /** The tasks' arrangement in the work area (work.ts's): read, set, and held as it is while a tab is being shown. */
  screen: () => Node | null;
  setScreen: (screen: Node | null) => void;
  hold: (on: boolean) => void;
  /** A tab shown, made, closed: the work area placed again (and the list marked again). */
  changed: () => void;
}

const TABS_KEY = "ag-dashboard-screen-tabs";
export const TABS_H = 40;
const FACES = 3; // a tab's faces at most, then how many more
let made = 0;
const newId = (): string => `s${Date.now().toString(36)}${(made++).toString(36)}`;

export class Tabs {
  private tabs: Tab[];
  private current: string;
  private switching = false;
  private readonly strip: HTMLElement;
  private readonly list: HTMLElement;
  private readonly add: HTMLButtonElement;

  constructor(
    work: HTMLElement,
    private readonly hooks: TabsHooks,
  ) {
    let kept: { tabs?: Tab[]; current?: string } = {};
    try {
      kept = JSON.parse(localStorage.getItem(TABS_KEY) || "{}") || {};
    } catch {
      /* none kept */
    }
    this.tabs = Array.isArray(kept.tabs) ? kept.tabs.filter((t) => t && t.id) : [];
    if (!this.tabs.length) this.tabs = [{ id: newId(), name: "", tasks: [], screen: null, focus: null }];
    this.current = this.tabs.some((t) => t.id === kept.current) ? kept.current! : this.tabs[0].id;
    this.strip = document.createElement("div");
    this.strip.className = "lay-tabs";
    this.list = document.createElement("div");
    this.list.className = "lay-tab-list";
    this.list.setAttribute("role", "tablist");
    this.list.setAttribute("aria-label", "Screen tabs");
    this.add = document.createElement("button");
    this.add.type = "button";
    this.add.className = "lay-tab-add";
    this.add.textContent = "+";
    this.add.title = this.add.ariaLabel = "New tab, empty: what you open next goes in it";
    this.add.addEventListener("click", () => void this.blank());
    this.strip.append(this.list, this.add);
    work.append(this.strip);
  }

  /** How tall the tabs' bar is. */
  height(): number {
    return TABS_H;
  }
  /** Whether a tab is being shown (its tasks opened one by one): no click routed meanwhile. */
  busy(): boolean {
    return this.switching;
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
    if (this.switching || this.hooks.shown().includes(task)) return;
    const holding = this.tabs.find((t) => t.id !== this.current && t.tasks.includes(task));
    if (holding) return this.show(holding.id, task);
    if (this.hooks.shown().length && !idle) this.fresh();
  }

  /** ⌥+click: the task out of any other tab (one left with none closed, unless named), to be the tab shown's alone. */
  take(task: string): void {
    if (this.switching) return;
    for (const t of this.tabs) if (t.id !== this.current) t.tasks = t.tasks.filter((k) => k !== task);
    this.tabs = this.tabs.filter((t) => t.id === this.current || t.tasks.length > 0 || t.name);
    this.save();
    this.hooks.changed();
  }

  /** A new tab, shown, for what is shown next (a task open nowhere, clicked), the tab shown kept as it is. Its panels are
   * still there till what is shown next replaces them (blank: closed at once). */
  fresh(): void {
    if (this.switching) return;
    const left = this.leave();
    const at = this.tabs.indexOf(left);
    const tab: Tab = { id: newId(), name: "", tasks: [], screen: null, focus: null };
    this.tabs.splice(at + 1, 0, tab);
    this.current = tab.id;
    this.drop(left);
    this.hooks.setScreen(null);
    this.save();
    this.hooks.changed();
  }

  /** "+": a new tab, shown empty -- the tab left kept as it is, its panels closed. */
  async blank(): Promise<void> {
    if (this.switching) return;
    this.fresh();
    this.switching = true;
    this.hooks.hold(true);
    try {
      await this.hooks.clear?.();
    } finally {
      this.switching = false;
      this.hooks.hold(false);
      this.hooks.changed();
    }
  }

  /** The tab `id` shown, `focus` in focus (else the task in focus when it was left). */
  async show(id: string, focus: string | null = null): Promise<void> {
    const to = this.tabs.find((t) => t.id === id);
    if (!to || id === this.current || this.switching) return;
    const left = this.leave();
    this.current = id;
    this.drop(left);
    this.save();
    this.switching = true;
    this.hooks.hold(true);
    this.hooks.setScreen(to.screen);
    this.draw();
    try {
      await this.hooks.enter(to.tasks, focus ?? to.focus);
    } finally {
      this.switching = false;
      this.hooks.hold(false);
      this.hooks.changed();
    }
  }

  /** The tab next to the one shown (`by` -1: before it), shown. */
  async step(by: number): Promise<void> {
    const at = this.tabs.findIndex((t) => t.id === this.current);
    if (this.tabs.length > 1) await this.show(this.tabs[(at + by + this.tabs.length) % this.tabs.length].id);
  }

  /** A tab closed (not the only one): the one shown, the next shown first. Its actors go on. */
  async close(id: string): Promise<void> {
    if (this.tabs.length < 2 || this.switching) return;
    if (id === this.current) {
      const at = this.tabs.findIndex((t) => t.id === id);
      await this.show((this.tabs[at + 1] || this.tabs[at - 1]).id);
    }
    this.tabs = this.tabs.filter((t) => t.id !== id);
    this.save();
    this.hooks.changed();
  }

  rename(id: string, name: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.name = name.trim();
    this.save();
    this.draw();
  }

  /** The bar drawn again: each tab's faces, name and what its actors do. */
  draw(): void {
    if (this.list.querySelector("input")) return; // a name being typed: left as it is
    const want = this.tabs.map((t) => this.look(t));
    const sig = JSON.stringify([want, this.tabs.length > 1]);
    if (this.list.dataset.sig === sig) return;
    this.list.dataset.sig = sig;
    this.list.replaceChildren(...this.tabs.map((t, i) => this.tabEl(t, want[i])));
  }

  private tab(): Tab {
    return this.tabs.find((t) => t.id === this.current)!;
  }
  private tasksOf(t: Tab): string[] {
    return t.id === this.current && !this.switching ? this.hooks.shown() : t.tasks;
  }
  private look(t: Tab): { id: string; name: string; given: boolean; status: string; on: boolean; faces: string[] } {
    const tasks = this.tasksOf(t),
      names = tasks.map((k) => this.hooks.name(k)).filter(Boolean);
    const said = names.length
      ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "")
      : "New tab";
    return {
      id: t.id,
      name: t.name || said,
      given: !!t.name,
      status: this.hooks.status(tasks),
      on: t.id === this.current,
      faces: tasks.flatMap((k) => (this.hooks.faces ? this.hooks.faces(k).map((e) => e.outerHTML) : [])),
    };
  }

  // the tab shown kept as it is left: its tasks (each kept as it is: hooks.remember), their arrangement, the one in focus
  // -- none of them in another tab now (one left with none closed, unless named)
  private leave(): Tab {
    const tab = this.tab(),
      tasks = this.hooks.shown();
    this.hooks.remember?.(tasks);
    Object.assign(tab, { tasks, screen: this.hooks.screen(), focus: this.hooks.focus() });
    for (const t of this.tabs) if (t !== tab) t.tasks = t.tasks.filter((k) => !tasks.includes(k));
    this.tabs = this.tabs.filter((t) => t === tab || t.tasks.length > 0 || t.name);
    return tab;
  }
  // a tab left showing nothing, unnamed (a new one, nothing opened in it): closed
  private drop(left: Tab): void {
    if (!left.tasks.length && !left.name) this.tabs = this.tabs.filter((t) => t !== left);
  }

  private save(): void {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: this.tabs, current: this.current }));
    } catch {
      /* this page only */
    }
  }

  private tabEl(t: Tab, look: ReturnType<Tabs["look"]>): HTMLElement {
    const e = document.createElement("div");
    e.className = "lay-tab";
    e.setAttribute("role", "tab");
    e.setAttribute("aria-selected", String(look.on));
    e.draggable = true;
    e.dataset.id = t.id;
    e.title = `${look.name}${look.given ? "" : " · double-click to name it"}`;
    const faces = document.createElement("span");
    faces.className = "lay-faces";
    faces.setAttribute("aria-hidden", "true");
    faces.innerHTML = look.faces.slice(0, FACES).join("");
    if (look.faces.length > FACES) {
      const more = document.createElement("span");
      more.className = "lay-more";
      more.textContent = `+${look.faces.length - FACES}`;
      faces.append(more);
    }
    const dot = document.createElement("i");
    dot.className = "lay-dot";
    dot.dataset.status = look.status;
    const name = document.createElement("span");
    name.className = "lay-name";
    name.textContent = look.name;
    e.append(...(look.faces.length ? [faces] : []), name, dot);
    if (this.tabs.length > 1) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "lay-close";
      close.textContent = "×";
      close.title = close.ariaLabel = "Close this tab (its actors go on)";
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
    });
    e.addEventListener("dragover", (ev) => {
      if (ev.dataTransfer?.types.includes("application/x-ag-tab")) ev.preventDefault();
    });
    e.addEventListener("drop", (ev) => {
      const from = ev.dataTransfer?.getData("application/x-ag-tab");
      if (!from || from === t.id) return;
      ev.preventDefault();
      const r = e.getBoundingClientRect(),
        after = ev.clientX > r.left + r.width / 2;
      const moved = this.tabs.find((x) => x.id === from)!;
      this.tabs = this.tabs.filter((x) => x.id !== from);
      this.tabs.splice(this.tabs.findIndex((x) => x.id === t.id) + (after ? 1 : 0), 0, moved);
      this.save();
      this.list.dataset.sig = "";
      this.draw();
      this.hooks.changed(); // (the list's numbers)
    });
    return e;
  }

  // its name typed in place: Enter or leaving it keeps it (none: its tasks' names again), Esc as it was
  private naming(t: Tab, span: HTMLElement, was: string): void {
    const input = document.createElement("input");
    input.className = "lay-naming";
    input.value = was;
    input.placeholder = "Name this tab";
    let done = false;
    const end = (keep: boolean): void => {
      if (done) return;
      done = true;
      input.remove();
      this.list.dataset.sig = "";
      if (keep) this.rename(t.id, input.value);
      else this.draw();
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") end(true);
      else if (ev.key === "Escape") end(false);
    });
    input.addEventListener("blur", () => end(true));
    input.addEventListener("click", (ev) => ev.stopPropagation());
    span.replaceWith(input);
    input.focus();
    input.select();
  }
}
