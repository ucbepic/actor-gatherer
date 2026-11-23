// What the page knows of a task, worked out apart from the page (pure; Vitest: facts.test.ts): what a task of a tab opens
// as it was left (plan.ts's TaskFacts), and the keys a task the layout holds reads as now that items joined or left it.
import type { Left } from "./model";
import type { AppWant, TaskFacts } from "./plan";

/** What factsOf reads of a task and the page: the task's key, its group, what it is (a task of several items, an app
 * alone, an actor alone), its own actors (a task's), its lead, its actors not closed in order (as it opens at first),
 * what it was left with, whether an actor of it is open (its own, not closed), its apps' panels to open (for the actor it
 * opens first), and whether the page's own pane shows one of its actors already, the task not laid out yet. */
export interface FactsIn {
  key: string;
  g: string;
  kind: "task" | "app" | "actor";
  /** the actor alone's channel (an actor's) */
  id: string;
  members: string[];
  lead: string | null;
  order: string[];
  was: Left | null;
  open: (c: string) => boolean;
  apps: (first: string | null) => AppWant[];
  mine: boolean;
  /** the actor in the page's own pane, if it is of the task's group */
  selected: string | null;
}

/** The facts of a task of a tab, as it was left: the actor it opens first -- the one asked for (`focus`), else the one
 * whose pane the reader closed (`shut`, its apps beside), else the first of its actors then, else the one in focus then,
 * else its lead; an actor alone, itself; apps alone, none -- its others, its views, its apps, the actor and the app in
 * focus then. */
export function factsOf(t: FactsIn, focus: string | null = null): TaskFacts {
  const { key, g, was } = t;
  if (t.kind === "app")
    return {
      key,
      g,
      first: null,
      rest: [],
      shut: false,
      views: {},
      apps: t.apps(null),
      back: null,
      focusApp: null,
      mine: false,
    };
  const uniqOpen = (first: string | null) => (c: string, i: number, them: string[]) =>
    c !== first && them.indexOf(c) === i && t.open(c);
  if (t.kind === "actor") {
    const rest = (was ? was.actors : []).filter(uniqOpen(t.id));
    return {
      key,
      g,
      first: t.id,
      rest,
      shut: false,
      views: was?.views || {},
      apps: t.apps(t.id),
      back: null,
      focusApp: null,
      mine: t.mine && t.selected === t.id,
    };
  }
  const ok = (c: string | null | undefined): c is string => !!c && t.members.includes(c);
  const asked = ok(focus) ? focus : null;
  const shut = !asked && was && ok(was.shut) && !was.actors.some(ok) && (was.apps || []).length ? was.shut : null;
  const first =
    asked ||
    shut ||
    (was && ok(was.actors[0]) ? was.actors[0] : null) ||
    (was && ok(was.focus) ? was.focus : null) ||
    t.lead;
  const apps = t.apps(first);
  return {
    key,
    g,
    first,
    rest: (was ? was.actors : t.order).filter(uniqOpen(first)),
    shut: !!shut,
    views: was?.views || {},
    apps,
    back: !asked && first && was && ok(was.focus) && was.focus !== first ? was.focus : null,
    focusApp: asked ? null : was?.focusApp || ((shut || !first) && apps.length ? apps[0].id : null),
    mine: !!first && t.mine,
  };
}

/** The keys task `k` (its number `n`, of a group whose tasks are `tasks`) reads as now: itself, if it is still there, and
 * the keys now (`keyOf`) of the items it held when last placed (`held`) and holds no more whose panels are open (`open`)
 * -- taken out of it, each a task of its own, shown still; one closed for good, not. A task gone: those items' alone (or
 * itself, if it held none). */
export function taskKeysNow(
  k: string,
  n: number,
  tasks: { tasks: { id: number }[]; tasked: Record<string, number> },
  held: string[],
  open: ReadonlySet<string>,
  keyOf: (item: string) => string | null,
): string[] {
  const left = (now: string[]) =>
    held
      .filter((item) => !now.includes(item) && open.has(item))
      .map(keyOf)
      .filter((x): x is string => !!x);
  if (!tasks.tasks.some((t) => String(t.id) === String(n))) return held.length ? [...new Set(left([]))] : [k];
  const now = Object.keys(tasks.tasked).filter((item) => String(tasks.tasked[item]) === String(n));
  return [...new Set([k, ...left(now)])];
}
