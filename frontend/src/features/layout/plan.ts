// A SCREEN TAB'S PANELS, worked out at once (ag_dashboard/DESIGN.md, A6, layout step 4c-3c): what the page shows for the
// tasks of a tab shown -- the actor in the page's own pane, the panes beside it in their order, the apps' panels above,
// what is in focus -- from what each task was left with (model.ts's Left, read by the page into TaskFacts) and what is
// open now. The page then makes the model so and renders it (features/layout/panes.js's enterTasks, renderLayout), in
// place of entering the tasks one by one, each pane opened and the model told. The rules are those the page had: the
// first task with actors in the page's own pane, its other actors beside it; each other task beside, as ⌘+click opens
// one; the tasks of apps alone last; terminals kept; at most `max` panes.
import type { AppKept } from "./model";

/** An app's panel a task opens: its app, its instance (of group `g`), its width if it has one. */
export type AppWant = Pick<AppKept, "app" | "size"> & { id: string; g: string };

/** What the page knows of a task of the tab, as it was left. */
export interface TaskFacts {
  key: string;
  g: string;
  /** the actor it opens in the page's own pane (first of the tab), or first beside (another); none: apps alone */
  first: string | null;
  /** its other actors, in order, open and its own: beside `first` */
  rest: string[];
  /** `first` was closed by the reader when it was left: shown out of sight, its apps beside */
  shut: boolean;
  /** each actor's view, as it was left */
  views: Record<string, string>;
  /** its apps' panels, as it was left (else all of them), at most a task's */
  apps: AppWant[];
  /** the actor in focus when it was left (another than `first`), and the app selected in it */
  back: string | null;
  focusApp: string | null;
  /** whether the page's own pane shows one of its actors already, the task not laid out yet (the page opened on it) */
  mine: boolean;
}

/** A pane beside the page's own, in the plan: its actor and view. */
export interface PaneWant {
  g: string;
  c: string;
  view: string | null;
}

export interface Plan {
  /** the tasks, in the order they are opened (those with actors first): the first entered, the others beside */
  order: string[];
  /** the task of apps alone shown (the actors' panes out of sight), if the tab has only such */
  appsOnly: string | null;
  /** the page's own pane: its actor -- kept as it is (`keep`), or another, in `view` -- shown out of sight (`shut`) */
  here: { g: string; c: string; view: string | null; shut: boolean; keep: boolean } | null;
  /** the panes beside it, in order: the tab's tasks' actors, then those kept (terminals) */
  others: PaneWant[];
  /** the apps' panels: those of the first task open already, then the tasks' own as they come */
  apps: AppWant[];
  /** what is in focus after: an actor's pane (the page's own when it is its actor), or an app's panel */
  focus: { g: string; c: string } | { app: string } | null;
  /** actors of the tab not opened: no room */
  left: number;
}

/** What is open now: the page's own pane's actor, the panes beside it (each kept if `keep` says so: a terminal, or an
 * actor of the tab's tasks), the apps' panels open (by instance, each with its task). */
export interface Open {
  here: { g: string; c: string } | null;
  view: string;
  others: (PaneWant & { keep: boolean })[];
  apps: (AppWant & { task: string | null })[];
}

/** The panels of a tab showing `tasks` (`focus`'s first), as the page opens them. */
export function tabPlan(tasks: TaskFacts[], focus: string | null, now: Open, max: number): Plan {
  const withActors = tasks.filter((t) => t.first),
    appsAlone = tasks.filter((t) => !t.first);
  const order = [...withActors, ...appsAlone];
  const list: PaneWant[] = now.others.filter((o) => o.keep).map(({ g, c, view }) => ({ g, c, view }));
  let at = -1; // the pane in focus among them (-1: the page's own)
  let here: Plan["here"] = null,
    left = 0,
    appsOnly: string | null = null;
  const viewAt = (i: number) => (i < 0 ? (here?.view ?? now.view) : list[i].view);
  const open = (g: string, c: string) =>
    (here && here.g === g && here.c === c) || list.some((p) => p.g === g && p.c === c);
  const put = (g: string, c: string, view: string | null) => {
    list.splice(at + 1, 0, { g, c, view: view || viewAt(at) });
    at += 1;
  };
  const first = order[0];
  let selected: { g: string; c: string } | { app: string } | null = null;
  if (first && first.first) {
    const keep = first.mine && !!now.here;
    const c = keep ? now.here!.c : first.first;
    const was = list.findIndex((p) => p.g === first.g && p.c === c);
    if (was >= 0) list.splice(was, 1); // (open beside: in the page's own pane now)
    here = { g: first.g, c, view: keep ? null : first.views[c] || null, shut: first.shut && !keep, keep };
    for (const r of first.rest) {
      if (open(first.g, r)) continue;
      if (1 + list.length >= max) break;
      put(first.g, r, first.views[r] || null);
    }
    at = -1;
    const back = first.back ? list.findIndex((p) => p.g === first.g && p.c === first.back) : -1;
    if (back >= 0) at = back;
    if (first.focusApp) selected = { app: first.focusApp };
  } else if (first) {
    appsOnly = first.key;
    if (first.focusApp) selected = { app: first.focusApp };
  }
  for (const t of order.slice(1)) {
    if (!t.first) continue;
    for (const c of [t.first, ...t.rest]) {
      if (open(t.g, c)) continue;
      if (1 + list.length >= max) {
        left += 1;
        continue;
      }
      put(t.g, c, t.views[c] || null);
    }
    const f = list.findIndex((p) => p.g === t.g && p.c === t.first);
    if (f >= 0) at = f;
  }
  // the apps: the first task's open already kept, then each task's own as it comes
  const apps: AppWant[] = now.apps
    .filter((a) => first && a.task === first.key)
    .map(({ app, id, g, size }) => ({ app, id, g, size }));
  for (const t of order) for (const a of t.apps) if (!apps.some((x) => x.id === a.id)) apps.push(a);
  if (!selected) {
    const p = at < 0 ? (here && !here.shut ? here : null) : list[at];
    selected = p ? { g: p.g, c: p.c } : null;
  }
  // the tab's task in focus, if what is in focus is another's: its actor's pane (the page's own first), else its app
  const fk = tasks.find((t) => t.key === focus);
  const inFocus = (sel: typeof selected): string | null => {
    if (!sel) return null;
    if ("app" in sel) return tasks.find((t) => t.apps.some((a) => a.id === sel.app))?.key ?? null;
    if (here && sel.g === here.g && sel.c === here.c) return order[0]?.first ? order[0].key : null;
    return tasks.find((t) => t.g === sel.g && (t.first === sel.c || t.rest.includes(sel.c)))?.key ?? null;
  };
  if (fk && inFocus(selected) !== fk.key && !appsOnly) {
    const mine = (c: string) => c === fk.first || fk.rest.includes(c);
    const p =
      here && !here.shut && here.g === fk.g && mine(here.c) ? here : list.find((q) => q.g === fk.g && mine(q.c));
    if (p) selected = { g: p.g, c: p.c };
    else if (fk.apps.length) selected = { app: fk.apps[0].id };
  }
  return { order: order.map((t) => t.key), appsOnly, here, others: list, apps, focus: selected, left };
}
