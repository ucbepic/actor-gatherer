// SCREEN TABS: the work area as several screens, one shown at a time, each a set of tasks and how they are arranged
// (blocks.ts). A task is in one tab at most: it is OPEN if any of its items is shown in a tab -- the tab shown (what the
// work area shows) or another (what it was left showing). A tab not shown keeps its tasks, their arrangement and the
// task in focus; shown again, its tasks are opened again as they were left (the page's task switching does it:
// hooks.enter), the tab left kept so first. A plain click in the list on a task (route) shows it where it is open -- the
// tab shown, or another, brought forward -- and a task open nowhere in a tab of its own, new (the tab shown, if it
// shows nothing). ⌥+click makes the tab shown the task's alone (take: out of any other tab; the page closes the rest).
// The tabs' bar, over the work area always: each tab its tasks' faces, its name (its tasks', or one given it by a
// double-click), each task's state marked on its face (MARKS: waiting on the reader, failed, an app's notification,
// done since they looked, at work, in the background -- idle, none), its × (none, the only one); pressed, shown; dragged,
// put elsewhere; and a "+" for a new tab, empty. A task of the tab shown, the tab showing others too, moved to another
// tab (put): dragged by its card head onto another tab's name, into that tab -- anywhere else on the bar ("New tab" shown
// there meanwhile), into a new tab -- or from its menu; the tab shown stays shown.
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
  /** A task's faces: its lead's (or its app's mark). */
  faces?: (task: string) => HTMLElement[];
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

/** An item's state, as a tab marks it: `mark` one of MARKS (or "", none), `said` its word ("Waiting for you"). */
export interface State {
  mark: string;
  said: string;
}
/** The marks, the most pressing first: what waits on the reader (a question, an error, an app's notification, a turn
 * done since they looked) before what is at work (a turn, in the background). A task's mark, its items' most pressing. */
export const MARKS = ["asking", "error", "notified", "finished", "working", "background"];
const rank = (m: string): number => (MARKS.includes(m) ? MARKS.indexOf(m) : MARKS.length);
/** The most pressing of these states (none marked: the first, its word only). */
export function pressing(states: State[]): State {
  const best = states.reduce<State | null>((b, s) => (!b || rank(s.mark) < rank(b.mark) ? s : b), null);
  return best || { mark: "", said: "" };
}
interface Face {
  html: string;
  mark: string;
  title: string;
}

const TABS_KEY = "ag-dashboard-screen-tabs";
export const TABS_H = 40;
const FACES = 3; // a tab's faces at most, then how many more
let made = 0;
const newId = (): string => `s${Date.now().toString(36)}${(made++).toString(36)}`;

export class Tabs {
  private tabs: Tab[];
  private current: string;
  private switching = false; // a tab being shown, its tasks' panes opened one by one (the screen held as it is meanwhile)
  private settling: Promise<void> = Promise.resolve(); // the tab being shown (or made): done
  private started = false; // the page's first tab shown as it was left (start): the tab shown kept as it changes since
  private readonly strip: HTMLElement;
  private readonly list: HTMLElement;
  private readonly add: HTMLButtonElement;
  private readonly ghost: HTMLElement; // "New tab", while a task that can go to another tab is dragged

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
    this.ghost = document.createElement("div");
    this.ghost.className = "lay-tab-ghost";
    this.ghost.textContent = "New tab";
    this.ghost.hidden = true;
    this.strip.append(this.list, this.ghost, this.add);
    work.append(this.strip);
    // a task dragged over the bar: where it would go marked; let go, it goes there
    this.strip.addEventListener("dragover", (ev) => {
      if (!this.hooks.carried?.()) return;
      const to = this.carriedTo(ev);
      this.markCarry(to);
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = to ? "move" : "none";
      if (to) ev.preventDefault();
    });
    this.strip.addEventListener("dragleave", (ev) => {
      if (!this.strip.contains(ev.relatedTarget as globalThis.Node | null)) this.markCarry(null);
    });
    this.strip.addEventListener("drop", (ev) => {
      const task = this.hooks.carried?.(),
        to = task ? this.carriedTo(ev) : null;
      this.markCarry(null);
      if (!task || !to) return;
      ev.preventDefault();
      this.hooks.carry?.(task, to === "new" ? null : to.dataset.id!);
    });
  }

  /** How tall the tabs' bar is. */
  height(): number {
    return TABS_H;
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
      now = { tasks: this.hooks.shown(), screen: this.hooks.screen(), focus: this.hooks.focus() };
    if (JSON.stringify(now) === JSON.stringify({ tasks: tab.tasks, screen: tab.screen, focus: tab.focus })) return;
    Object.assign(tab, now);
    this.save();
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
    const here = this.tasksOf(this.tab());
    if (here.includes(task)) return;
    const holding = this.tabs.find((t) => t.id !== this.current && this.tasksOf(t).includes(task));
    if (holding) return this.show(holding.id, task);
    if (here.length && !idle) this.fresh();
  }

  /** ⌥+click: the task out of any other tab (one left with none closed, unless named), to be the tab shown's alone. */
  take(task: string): void {
    for (const t of this.tabs) if (t.id !== this.current) t.tasks = this.tasksOf(t).filter((k) => k !== task);
    this.tabs = this.tabs.filter((t) => t.id === this.current || t.tasks.length > 0 || t.name);
    this.save();
    this.hooks.changed();
  }

  /** A new tab, shown, for what is shown next (a task open nowhere, clicked), the tab shown kept as it is. Its panels are
   * still there till what is shown next replaces them (blank: closed at once). */
  fresh(): void {
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
    if (this.switching) await this.settling;
    this.fresh();
    await this.switch(() => this.hooks.clear?.() ?? Promise.resolve());
  }

  /** The tab `id` shown, `focus` in focus (else the task in focus when it was left). */
  async show(id: string, focus: string | null = null): Promise<void> {
    if (this.switching) await this.settling; // one at a time
    const to = this.tabs.find((t) => t.id === id);
    if (!to || id === this.current) return;
    const tasks = this.tasksOf(to),
      kept = to.focus && this.hooks.canon ? this.hooks.canon(to.focus) : to.focus;
    const left = this.leave();
    this.current = id;
    this.drop(left);
    this.save();
    this.hooks.setScreen(to.screen);
    await this.switch(() => this.hooks.enter(tasks, focus ?? kept));
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
    if (id === this.current) {
      const at = this.tabs.findIndex((t) => t.id === id);
      await this.show((this.tabs[at + 1] || this.tabs[at - 1]).id);
    }
    this.tabs = this.tabs.filter((t) => t.id !== id);
    this.save();
    this.hooks.changed();
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
    this.tabs = this.tabs.filter((t) => t.id !== id);
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
    let tab = to && to !== this.current ? this.tabs.find((t) => t.id === to) : undefined;
    if (!tab) {
      tab = { id: newId(), name: "", tasks: [], screen: null, focus: task };
      this.tabs.splice(last ? this.tabs.length : this.tabs.findIndex((t) => t.id === this.current) + 1, 0, tab);
    }
    for (const t of this.tabs)
      if (t !== tab && t.id !== this.current) t.tasks = this.tasksOf(t).filter((k) => k !== task);
    tab.tasks = [...this.tasksOf(tab).filter((k) => k !== task), task];
    tab.focus ||= task;
    this.save();
    this.hooks.changed();
  }
  /** A task that can go to another tab picked up (work.ts), or put down: "New tab" shown in the bar meanwhile. */
  carrying(on: boolean): void {
    this.ghost.hidden = !on;
    if (!on) this.markCarry(null);
  }
  // where a task dragged over the bar would go: on another tab's name, that tab; on the tab shown's, nowhere; anywhere
  // else, a new tab
  private carriedTo(ev: DragEvent): HTMLElement | "new" | null {
    const chip = ev.target instanceof Element ? ev.target.closest<HTMLElement>(".lay-tab[data-id]") : null;
    if (!chip) return "new";
    return chip.dataset.id === this.current ? null : chip;
  }
  private markCarry(to: HTMLElement | "new" | null): void {
    for (const e of this.list.querySelectorAll(".lay-into")) if (e !== to) e.classList.remove("lay-into");
    if (to instanceof HTMLElement) to.classList.add("lay-into");
    this.ghost.classList.toggle("lay-into", to === "new");
  }

  rename(id: string, name: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    tab.name = name.trim();
    this.save();
    this.draw();
  }

  /** The bar drawn again: each tab's faces, name and what its actors do (the tab shown kept as it is now). */
  draw(): void {
    this.note();
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
  // a tab's tasks: the tab shown's, what is shown; another's, the ones it was left with, by their keys now
  private tasksOf(t: Tab): string[] {
    if (t.id === this.current && !this.switching) return this.hooks.shown();
    if (!this.hooks.canon) return t.tasks;
    const now = t.tasks.map((k) => this.hooks.canon!(k)).filter((k): k is string => !!k);
    return now.filter((k, i) => now.indexOf(k) === i);
  }
  private look(t: Tab): {
    id: string;
    name: string;
    given: boolean;
    on: boolean;
    faces: Face[];
    rest: string;
    says: string[];
  } {
    const tasks = this.tasksOf(t),
      names = tasks.map((k) => this.hooks.name(k)).filter(Boolean);
    const said = names.length
      ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "")
      : "New tab";
    // each task: its face (its lead's), its state marked on it; the tasks past FACES, or with no face, marked as one
    const faces: Face[] = [],
      rest: State[] = [],
      says: string[] = [];
    for (const k of tasks) {
      const st = pressing(this.hooks.status?.(k) || []),
        name = this.hooks.name(k),
        title = st.said ? `${name} · ${st.said}` : name;
      if (st.said) says.push(title);
      const face = this.hooks.faces?.(k)[0];
      if (face && faces.length < FACES) faces.push({ html: face.outerHTML, mark: st.mark, title });
      else if (face) faces.push({ html: "", mark: st.mark, title });
      else rest.push(st);
    }
    for (const f of faces.slice(FACES)) rest.push({ mark: f.mark, said: "" });
    return {
      id: t.id,
      name: t.name || said,
      given: !!t.name,
      on: t.id === this.current,
      faces,
      rest: pressing(rest).mark,
      says,
    };
  }

  // the tab shown kept as it is left: its tasks (each kept as it is: hooks.remember), their arrangement, the one in focus
  // -- none of them in another tab now (one left with none closed, unless named)
  private leave(): Tab {
    const tab = this.tab(),
      tasks = this.hooks.shown();
    this.hooks.remember?.(tasks);
    Object.assign(tab, { tasks, screen: this.hooks.screen(), focus: this.hooks.focus() });
    for (const t of this.tabs) if (t !== tab) t.tasks = this.tasksOf(t).filter((k) => !tasks.includes(k));
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
    e.title = [`${look.name}${look.given ? "" : " · double-click to name it"}`, ...look.says].join("\n");
    const faces = document.createElement("span");
    faces.className = "lay-faces";
    faces.setAttribute("aria-hidden", "true");
    for (const f of look.faces.slice(0, FACES)) {
      const one = document.createElement("span");
      one.className = "lay-fmark";
      one.title = f.title;
      one.innerHTML = f.html;
      if (f.mark) one.append(mark(f.mark));
      faces.append(one);
    }
    if (look.faces.length > FACES) {
      const more = document.createElement("span");
      more.className = "lay-more";
      more.textContent = `+${look.faces.length - FACES}`;
      faces.append(more);
    }
    const name = document.createElement("span");
    name.className = "lay-name";
    name.textContent = look.name;
    // the tasks past its faces' (or with none), marked as one, after its name
    e.append(...(look.faces.length ? [faces] : []), name, ...(look.rest ? [mark(look.rest)] : []));
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
      this.hooks.dragged?.(t.id); // (onto the work area: its tasks there)
    });
    e.addEventListener("dragend", () => this.hooks.dragged?.(null));
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

// a state's mark: a dot in its colour -- at work, the list's turning star, in step with the list's (one clock for all)
function mark(m: string): HTMLElement {
  const i = document.createElement("i");
  i.className = "lay-dot";
  i.dataset.status = m;
  i.setAttribute("aria-hidden", "true");
  if (m === "working") i.style.setProperty("--spin-at", `-${Date.now() % 1200}ms`);
  return i;
}
