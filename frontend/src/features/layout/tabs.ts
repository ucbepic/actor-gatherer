// SCREEN TABS: the work area as several screens, one shown at a time, each a set of tasks and how they are arranged
// (blocks.ts). A task is in one tab at most. A tab not shown keeps its tasks, their arrangement and the task in focus;
// shown again, its tasks are opened again as they were left (the page's task switching does it: hooks.enter) -- the tab
// left kept so first. A click in the list on a task of another tab brings that tab forward; on a task in none, it shows
// it in the tab shown, as before -- or, the tab shown kept (two tasks or more, or named), in a new tab; with ⌥, always.
// While there are two tabs or more, a strip of them over the work area: each its name (its tasks', or one given it by a
// double-click), a dot for what its actors do (asking, failed, working), its ×; pressed, shown; dragged, put elsewhere.
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
  name: (task: string) => string;
  /** What a tab's actors do, all told: "asking", "error", "working", or "". */
  status: (tasks: string[]) => string;
  /** The tasks' arrangement in the work area (work.ts's): read, set, and held as it is while a tab is being shown. */
  screen: () => Node | null;
  setScreen: (screen: Node | null) => void;
  hold: (on: boolean) => void;
  /** The strip shown or hidden, a tab shown: the work area placed again. */
  changed: () => void;
}

const TABS_KEY = "ag-dashboard-screen-tabs";
export const TABS_H = 30;
let made = 0;
const newId = (): string => `s${Date.now().toString(36)}${(made++).toString(36)}`;

export class Tabs {
  private tabs: Tab[];
  private current: string;
  private switching = false;
  private readonly strip: HTMLElement;

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
    this.strip.setAttribute("role", "tablist");
    this.strip.setAttribute("aria-label", "Screens");
    work.append(this.strip);
  }

  /** How tall the strip is: none with one tab. */
  height(): number {
    return this.tabs.length > 1 ? TABS_H : 0;
  }

  /** A click in the list on a task (no key held): another tab holding it shown; else, the tab shown kept, a new one. */
  async route(task: string): Promise<void> {
    if (this.switching || this.hooks.shown().includes(task)) return;
    const holding = this.tabs.find((t) => t.id !== this.current && t.tasks.includes(task));
    if (holding) return this.show(holding.id, task);
    const tab = this.tab();
    if (tab.name || this.hooks.shown().length > 1) this.fresh();
  }

  /** A new tab, shown: empty, for what is shown next (⌥+click in the list), the tab shown kept as it is. */
  fresh(): void {
    if (this.switching) return;
    this.keep();
    const at = this.tabs.findIndex((t) => t.id === this.current);
    const tab: Tab = { id: newId(), name: "", tasks: [], screen: null, focus: null };
    this.tabs.splice(at + 1, 0, tab);
    this.current = tab.id;
    this.hooks.setScreen(null);
    this.save();
    this.hooks.changed();
  }

  /** The tab `id` shown, `focus` in focus (else the task in focus when it was left). */
  async show(id: string, focus: string | null = null): Promise<void> {
    const to = this.tabs.find((t) => t.id === id);
    if (!to || id === this.current || this.switching) return;
    this.keep();
    this.current = id;
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

  /** The strip drawn again: each tab's name and what its actors do. */
  draw(): void {
    const shown = this.tabs.length > 1;
    this.strip.hidden = !shown;
    if (!shown) return;
    const now = this.strip.querySelector("input"); // a name being typed: left as it is
    if (now) return;
    const want = this.tabs.map((t) => this.look(t));
    const sig = JSON.stringify(want);
    if (this.strip.dataset.sig === sig) return;
    this.strip.dataset.sig = sig;
    this.strip.replaceChildren(...this.tabs.map((t, i) => this.tabEl(t, want[i])));
  }

  private tab(): Tab {
    return this.tabs.find((t) => t.id === this.current)!;
  }
  private tasksOf(t: Tab): string[] {
    return t.id === this.current && !this.switching ? this.hooks.shown() : t.tasks;
  }
  private look(t: Tab): { id: string; name: string; given: boolean; status: string; on: boolean } {
    const tasks = this.tasksOf(t),
      names = tasks.map((k) => this.hooks.name(k)).filter(Boolean);
    const said = names.length
      ? names.slice(0, 2).join(" + ") + (names.length > 2 ? ` +${names.length - 2}` : "")
      : "New tab";
    return {
      id: t.id,
      name: t.name || said,
      given: !!t.name,
      status: this.hooks.status(tasks),
      on: t.id === this.current,
    };
  }

  // the tab shown kept as it is left: its tasks, their arrangement, the one in focus -- none of them in another tab now
  private keep(): void {
    const tab = this.tab(),
      tasks = this.hooks.shown();
    Object.assign(tab, { tasks, screen: this.hooks.screen(), focus: this.hooks.focus() });
    for (const t of this.tabs) if (t !== tab) t.tasks = t.tasks.filter((k) => !tasks.includes(k));
    this.tabs = this.tabs.filter((t) => t === tab || t.tasks.length > 0 || t.name);
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
    const dot = document.createElement("i");
    dot.className = "lay-dot";
    dot.dataset.status = look.status;
    const name = document.createElement("span");
    name.className = "lay-name";
    name.textContent = look.name;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "lay-close";
    close.textContent = "×";
    close.title = close.ariaLabel = "Close this tab (its actors go on)";
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void this.close(t.id);
    });
    e.append(dot, name, close);
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
      this.strip.dataset.sig = "";
      this.draw();
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
      this.strip.dataset.sig = "";
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
