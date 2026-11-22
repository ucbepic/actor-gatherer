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
  /** the page's own pane: its actor -- kept as it is (`keep`), or another, in `view` (as wide as `size`) -- shown out
   * of sight (`shut`) */
  here: { g: string; c: string; view: string | null; shut: boolean; keep: boolean; size?: number } | null;
  /** none for the page's own pane: its actor put out of sight (a terminal's kept in sight) */
  away?: boolean;
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
  here: { g: string; c: string; task?: string | null } | null;
  view: string;
  others: (PaneWant & { keep: boolean; task?: string | null; size?: number })[];
  apps: (AppWant & { task: string | null })[];
  /** the task of apps alone shown, and the task in focus */
  appsOnly?: string | null;
  focus?: string | null;
  /** the page's own pane's actor while out of sight; the pane in focus among `others` (-1: the page's own) */
  away?: { g: string; c: string; task?: string | null } | null;
  at?: number;
}

const bare = ({ g, c, view }: PaneWant): PaneWant => ({ g, c, view });
const appOf = ({ app, id, g, size }: AppWant): AppWant => ({ app, id, g, size });
const isShell = (c: string) => c.startsWith("shell:");

/** The tab shown emptied (a new tab): every task's panels closed, the terminals kept, the page's own pane out of
 * sight (a terminal's kept). */
export function clearPlan(now: Open): Plan {
  return {
    order: [],
    appsOnly: null,
    here: now.here && isShell(now.here.c) ? { ...now.here, view: null, shut: false, keep: true } : null,
    away: true,
    others: now.others.filter((o) => isShell(o.c)).map(bare),
    apps: [],
    focus: null,
    left: 0,
  };
}

/** Task `k` closed in the tab shown (its card head's ×, or moved to another tab): its panels closed, the others as they
 * are -- the page's own pane, if it showed one of k's actors, given the next pane's actor (and view and width), else out
 * of sight -- and, k in focus, the next task shown in focus. */
export function closePlan(now: Open, k: string): Plan {
  const others = now.others.filter((o) => o.task !== k);
  const apps = now.apps.filter((a) => a.task !== k).map(appOf);
  let here: Plan["here"] = null,
    away = false,
    appsOnly = now.appsOnly ?? null;
  if (appsOnly === k) {
    appsOnly = null;
    away = true; // (the actors' panes stay out of sight)
  } else if (now.here && now.here.task === k) {
    const next = others.shift();
    if (next) here = { g: next.g, c: next.c, view: next.view, shut: false, keep: false, size: next.size };
    else away = true;
  } else if (now.here) here = { g: now.here.g, c: now.here.c, view: null, shut: false, keep: true };
  let focus: Plan["focus"] = null;
  if (!now.focus || now.focus === k) {
    const p = here && !here.keep ? here : here && now.here && now.here.task ? here : others.find((o) => o.task);
    if (p) focus = { g: p.g, c: p.c };
    else if (apps.length) focus = { app: apps[0].id };
  }
  return { order: [], appsOnly, here, away, others: others.map(bare), apps, focus, left: 0 };
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

/** Task `k` alone in the tab shown (⌥+click on it while others show): the others' panels closed (terminals kept) -- the
 * page's own pane, if it showed another's actor, given k's first pane's actor, else (k of apps alone) out of sight while
 * k's apps alone show -- k in focus. */
export function onlyPlan(now: Open, k: string): Plan {
  const others = now.others.filter((o) => isShell(o.c) || o.task === k);
  const apps = now.apps.filter((a) => a.task === k).map(appOf);
  let appsOnly = now.appsOnly ?? null;
  let here: Plan["here"] = now.here ? { g: now.here.g, c: now.here.c, view: null, shut: false, keep: true } : null;
  if (!appsOnly && now.here && now.here.task !== k) {
    const at = others.findIndex((o) => o.task === k);
    if (at >= 0) {
      const [next] = others.splice(at, 1);
      here = { g: next.g, c: next.c, view: next.view, shut: false, keep: false, size: next.size };
    } else appsOnly = k;
  }
  const mine = here && (!here.keep || now.here?.task === k) ? here : others.find((o) => o.task === k);
  const focus: Plan["focus"] = appsOnly
    ? null
    : mine
      ? { g: mine.g, c: mine.c }
      : apps.length
        ? { app: apps[0].id }
        : null;
  return { order: [], appsOnly, here: appsOnly ? null : here, others: others.map(bare), apps, focus, left: 0 };
}

/** Task `k`'s tab shown (tasks.ts: a tab of the task's own), holding `items` (its actors, by channel, each in `views`'
 * view; its apps, "app:<id>", `apps` those the page knows): its panels not in the tab closed -- the page's own pane, if it
 * showed one of k's actors not in it, given the first of the tab's actors not open, else the next pane's actor, else out
 * of sight (in sight again if it shows one in it) -- the tab's actors not open opened beside the pane in focus, as many
 * as there is room for, its apps added. */
export function itemsPlan(
  now: Open,
  k: string,
  g: string,
  items: string[],
  views: Record<string, string>,
  apps: AppWant[],
  max: number,
): Plan {
  const want = new Set(items),
    actors = items.filter((c) => !c.startsWith("app:") && !isShell(c));
  const focused = now.at !== undefined && now.at >= 0 ? now.others[now.at] : null;
  const list: PaneWant[] = now.others.filter((o) => !(o.task === k && !want.has(o.c))).map(bare);
  const kept = now.apps.filter((a) => !(a.task === k && !want.has(`app:${a.id}`))).map(appOf);
  const sel = now.here ?? now.away ?? null,
    out = !now.here && !!now.away;
  let here: Plan["here"] = sel ? { g: sel.g, c: sel.c, view: null, shut: false, keep: true } : null,
    away = false,
    at = focused ? list.findIndex((p) => p.g === focused.g && p.c === focused.c) : -1;
  const open = (c: string) => (here && here.g === g && here.c === c) || list.some((p) => p.g === g && p.c === c);
  if (sel && sel.task === k && !want.has(sel.c)) {
    const next = actors.find((c) => !open(c));
    here = null;
    if (next) here = { g, c: next, view: views[next] || null, shut: false, keep: false };
    else if (list.length) {
      const n = list.shift()!,
        size = now.others.find((o) => o.g === n.g && o.c === n.c)?.size;
      here = { g: n.g, c: n.c, view: n.view, shut: false, keep: false, size };
    } else away = true;
    at = -1;
  } else if (out && sel && want.has(sel.c)) here = { g: sel.g, c: sel.c, view: null, shut: false, keep: true };
  else if (out) here = null; // (out of sight still)
  for (const c of actors) {
    if (open(c) || 1 + list.length >= max) continue;
    const from = at < 0 ? (here?.view ?? now.view) : list[at].view;
    list.splice(at + 1, 0, { g, c, view: views[c] || from });
    at += 1;
  }
  for (const a of apps) if (!kept.some((x) => x.id === a.id)) kept.push(a);
  // in focus: the pane last opened, else the page's own given another actor
  const last = at >= 0 ? list[at] : here && !here.keep ? here : null;
  const focus = last ? { g: last.g, c: last.c } : null;
  return { order: [], appsOnly: now.appsOnly ?? null, here, away, others: list, apps: kept, focus, left: 0 };
}
