// THE LAYOUT'S STORE (ag_dashboard/DESIGN.md, A6): the one layout value (model.ts) the work area is drawn from -- the
// screen tabs, the tab shown, what each task was left with, the panes and the apps' panels, the focus -- changed only by
// the model's rules (`update`), kept in this browser under one key (`persist`), and read by its tasks' keys as they are
// now (`now`): an item that joined a task since is read as the task, a task that lost items as itself and theirs (the
// page's `keysWith`). The page renders what it holds (render.ts's renderLayout, renderPanes,
// renderApps). It began as the model run beside the page, checked against what the page showed; that check went once
// every change the page makes was the model's.
import * as M from "./model";

class LayoutStore {
  layout: M.Layout = M.empty();
  private started = false;
  private persisted = "";
  private dragged = false;

  /** Read once, as the page starts (the one key, else the keys of before; nothing written). */
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

  /** The layout changed by the model's rule `f`, applied to it as its tasks' keys are now. */
  update<A extends unknown[]>(f: (l: M.Layout, ...a: A) => M.Layout, ...args: A): void {
    this.start();
    this.layout = f(this.keyed(), ...args);
  }
  /** How the page reads a key now (tabs.ts's hooks.canon), when no reader of keysWith's is given. */
  canonWith(canon: ((k: string) => string | null) | undefined): void {
    if (canon) this.canon = canon;
  }
  /** A bar between panels being dragged (`on`), or let go: the layout kept in this browser only once it is let go --
   * each move of it would write it all. */
  dragging(on: boolean): void {
    this.dragged = on;
  }
  /** The layout kept in this browser (M.KEY), if it changed since -- and the keys of before it was made from, dropped.
   * What is this page's alone (the focus, the page's own pane out of sight, ...) is not kept. */
  persist(): void {
    this.start();
    if (this.dragged) return;
    const kept: Partial<M.Layout> = { ...this.layout };
    for (const k of M.PAGE_ONLY) delete kept[k];
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
  /** The layout as the page reads it: each task by its key now. */
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
  }

  private canon: (k: string) => string | null = (k) => k;
  private keys: ((k: string) => string[]) | null = null;
  /** How a key the layout holds reads now: the task an item joined since, or -- a task that lost items -- itself and
   * theirs, each a task of its own (remember.ts's keysNow, from the items each task held open). */
  keysWith(keys: (k: string) => string[]): void {
    this.keys = keys;
  }
  // the layout's tabs as the page reads its keys: each task by its key now
  private keyed(): M.Layout {
    const one = (k: string): string[] => {
      if (this.keys) return this.keys(k);
      const c = this.canon(k);
      return c ? [c] : [];
    };
    const now = (ks: string[]) => [...new Set(ks.flatMap(one))];
    return { ...this.layout, tabs: this.layout.tabs.map((t) => ({ ...t, tasks: now(t.tasks) })) };
  }
}

/** The layout's store (the name it had as the model run beside the page, `shadow`, kept: every module reads it so). */
export const shadow = new LayoutStore();
