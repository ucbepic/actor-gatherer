// The layout model (model.ts) run beside the page, step 2 of 4 (ag_dashboard/DESIGN.md, A6): the page tells it each
// change it makes -- the tab bar's (tabs.ts), a click routed (panes.js's viaTabs), a task opened or closed -- and after
// each placement (tabs.ts's note) what the model says is shown is checked against what the page shows. A difference is
// a rule the model lacks, or a change the page makes without telling it: logged, and kept for the browser tests, which
// fail on any (e2e/test.ts). Nothing reads the model yet.
import * as M from "./model";

interface Mismatch {
  /** what differed */
  what: string;
  model: unknown;
  page: unknown;
  /** the changes told since the last check */
  since: string[];
  log?: string[];
}

const KEEP = 40; // changes told kept, for a mismatch's report
const QUIET = 300; // ms with no placement and no change told: the page settled
/** The page's own state: the tab shown, the tasks it shows, every tab's tasks. */
interface Page {
  current: string;
  shown: string[];
  tabs: { id: string; tasks: string[] }[];
}

class Shadow {
  layout: M.Layout = M.empty();
  mismatches: Mismatch[] = [];
  private told: string[] = [];
  private started = false;
  /** every change told since the page loaded, with the tabs it left (the newest 200): a mismatch's whole story */
  readonly log: string[] = [];

  /** Read once, as the page starts (the keys of before; nothing written). */
  start(
    get: (k: string) => string | null = (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
  ): void {
    if (this.started) return;
    this.started = true;
    this.layout = M.load(get);
  }

  /** What the page keeps with the tab shown, not a change of what it shows (its arrangement, its map): the model's rule
   * `f` applied, not listed among the changes told. */
  update<A extends unknown[]>(f: (l: M.Layout, ...a: A) => M.Layout, ...args: A): void {
    this.start();
    this.layout = f(this.layout, ...args);
  }
  /** How the page reads a key now (tabs.ts's hooks.canon), when no reader of keysWith's is given. */
  canonWith(canon: ((k: string) => string | null) | undefined): void {
    if (canon) this.canon = canon;
  }
  private persisted = "";
  private dragged = false;
  /** A bar between panels being dragged (`on`), or let go: the model kept in this browser only once it is let go --
   * each move of it would write it all. */
  dragging(on: boolean): void {
    this.dragged = on;
  }
  /** The model kept in this browser (M.KEY), if it changed since -- and the keys of before it was made from, dropped. */
  persist(): void {
    this.start();
    if (this.dragged) return;
    const kept = { ...this.layout }; // (focus: this page's alone, not kept)
    delete kept.focus;
    delete kept.lastActor;
    delete kept.away;
    delete kept.appsOnly;
    delete kept.entered;
    delete kept.laidOut;
    delete kept.auto;
    const now = JSON.stringify(kept);
    if (now === this.persisted) return;
    this.persisted = now;
    try {
      localStorage.setItem(M.KEY, now);
      for (const k of M.OLD_KEYS) localStorage.removeItem(k);
    } catch {
      /* this page only */
    }
  }
  /** The model as the page reads it: each task by its key now. */
  now(): M.Layout {
    this.start();
    return (this.layout = this.keyed());
  }
  /** Back to a page not started (the unit tests' each new page). */
  reset(): void {
    this.started = false;
    this.persisted = "";
    this.dragged = false;
    this.layout = M.empty();
    this.told = [];
    this.log.length = 0;
    this.mismatches.length = 0;
    this.pending = null;
  }

  /** A change the page made, by the model's rule `name`. */
  tell<A extends unknown[]>(name: string, f: (l: M.Layout, ...a: A) => M.Layout, ...args: A): void {
    this.start(); // (the keys of before read first: a change told before the tabs were made is kept)
    this.told.push(`${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
    if (this.told.length > KEEP) this.told.shift();
    if (this.pending) this.wait(); // (the page is not quiet yet)
    try {
      this.layout = f(this.keyed(), ...args);
      this.log.push(
        `${name} -> ${JSON.stringify(this.layout.tabs.map((t) => [t.id, t.tasks]))} ${this.layout.current}`,
      );
      if (this.log.length > 200) this.log.shift();
    } catch (e) {
      this.miss("threw", String(e), null);
    }
  }

  private canon: (k: string) => string | null = (k) => k;
  private unknown: () => boolean = () => false;
  /** Whether the page shows what the model can't know yet -- an actor the home does not list (just started, the home
   * not read again yet): no check meanwhile. */
  waitWhile(unknown: () => boolean): void {
    this.unknown = unknown;
  }
  private panesShown: (() => string[]) | null = null;
  /** The panes beside the page's own (their actors' item keys): checked against the model's `panes.others`. */
  panesWith(shown: () => string[]): void {
    this.panesShown = shown;
  }
  private appsShown: (() => string[]) | null = null;
  /** The apps' panels the page shows (their instances): checked against the model's `apps`, the panels' source. */
  appsWith(shown: () => string[]): void {
    this.appsShown = shown;
  }
  private keys: ((k: string) => string[]) | null = null;
  /** How a key the model holds reads now: the task an item joined since, or -- a task gone -- the items it held. */
  keysWith(keys: (k: string) => string[]): void {
    this.keys = keys;
  }
  // the model's keys as the page reads its own: each task by its key now (an item joined a task, or left one, since)
  private keyed(): M.Layout {
    const one = (k: string): string[] => {
      if (this.keys) return this.keys(k);
      const c = this.canon(k);
      return c ? [c] : [];
    };
    const now = (ks: string[]) => [...new Set(ks.flatMap(one))];
    return { ...this.layout, tabs: this.layout.tabs.map((t) => ({ ...t, tasks: now(t.tasks) })) };
  }
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Checked once the page is quiet: QUIET ms after its last placement or change told -- not half way through one (an
   * actor's task entered, its pane not yet showing it). `page` null: still busy (a tab being shown), checked later. */
  later(page: () => Page | null, canon?: (k: string) => string | null): void {
    this.pending = { page, canon };
    this.wait();
  }
  private pending: { page: () => Page | null; canon?: (k: string) => string | null } | null = null;
  /** The check waiting, run now (the page quiet or not, unless busy): what the browser tests read at a test's end. */
  flush(): Mismatch[] {
    const p = this.pending,
      now = p?.page();
    if (p && now && !this.unknown()) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.pending = null;
      this.check(now, p.canon);
    }
    return this.mismatches;
  }
  private wait(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const p = this.pending,
        now = p?.page();
      if (!p) return;
      if (!now || this.unknown()) return this.wait();
      this.pending = null;
      this.check(now, p.canon);
    }, QUIET);
  }

  /** The page's own state now: the tab shown, the tasks shown, every tab's tasks. Checked against the model's. */
  check(page: Page, canon: (k: string) => string | null = (k) => k): void {
    if (canon) this.canon = canon;
    const l = (this.layout = this.keyed()),
      norm = (ks: string[]) => [...new Set(ks)].sort();
    const shownNow = norm(M.shown(l)),
      pageShown = norm(page.shown);
    let ok = true;
    if (l.current !== page.current) ok = this.miss("tab shown", l.current, page.current);
    if (this.appsShown) {
      const want = norm((l.apps || []).map((a) => a.instance)),
        shown = norm(this.appsShown());
      if (JSON.stringify(want) !== JSON.stringify(shown)) this.miss("apps", want, shown); // (the model's the source: kept)
    }
    if (this.panesShown) {
      const want = norm((l.panes?.others || []).map((o) => `${o.g}\u0000${o.c}`)),
        shown = norm(this.panesShown());
      if (JSON.stringify(want) !== JSON.stringify(shown)) this.miss("panes", want, shown); // (the model's the source)
    }
    if (JSON.stringify(shownNow) !== JSON.stringify(pageShown)) ok = this.miss("tasks shown", shownNow, pageShown);
    const tabs = (ts: { id: string; tasks: string[] }[]) =>
      ts.map((t) => [t.id, t.id === page.current ? [] : norm(t.tasks)]);
    if (JSON.stringify(tabs(l.tabs)) !== JSON.stringify(tabs(page.tabs)))
      ok = this.miss("tabs", tabs(l.tabs), tabs(page.tabs));
    if (ok) this.told = [];
    else {
      // taken as the page has it, so the next difference is the next change's
      this.layout = {
        ...l,
        current: page.current,
        tabs: page.tabs.map((t) => {
          const kept = l.tabs.find((x) => x.id === t.id);
          return {
            ...(kept ?? { name: "", screen: null, focus: null }),
            id: t.id,
            tasks: t.id === page.current ? page.shown : t.tasks,
          };
        }),
      };
      this.told = [];
    }
  }

  private miss(what: string, model: unknown, page: unknown): false {
    const m = { what, model, page, since: [...this.told], log: [...this.log] };
    this.mismatches.push(m);
    console.warn("layout model differs from the page:", m);
    return false;
  }
}

export const shadow = new Shadow();
declare global {
  interface Window {
    agLayoutShadow?: Shadow;
  }
}
if (typeof window !== "undefined") window.agLayoutShadow = shadow; // read by the browser tests (e2e/test.ts)
