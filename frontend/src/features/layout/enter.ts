// A TASK ENTERED, or opened beside, closed here, left alone: each change to what a tab shows worked out at once as a plan
// (plan.ts, pure) from what is open (open.ts's openNow) and what each task was left with (remember.ts), and rendered
// (render.ts's renderLayout); the apps the page did not know yet opened once read, if the task is still the one asked
// for. An actor shown in the pane in focus (show.ts) of another task than the one shown: the panes beside of the task left
// closed (terminals kept), and so are the apps' panels of other tasks (one whose agent is at work held out of sight, as
// closing it does); the new task's actor taken into this page's pane, and its apps' panels opened above (openTaskApps).
// A task of apps only entered (enterAppTask): its apps' panels alone, the actors' panes out of sight (`appsOnly`).
import { plural } from "../../core/format";
import { parse as parseKey, taskNumber } from "../../core/model/keys";
import { appClosedSince, instCache, instOf, renderApps, wantTaskApp } from "./app-panels";
import { paneNote } from "./heads";
import { gathererNamed, isAt, L, maxPanes, panes, snap, state, statusOf } from "./link";
import * as model from "./model";
import {
  actorPanes,
  appsOnlyKey,
  focusPane,
  focusedActor,
  isAway,
  isShut,
  openActors,
  openNow,
  selectAppPane,
  setTaskNow,
  shownPanels,
  taskKey,
  taskNow,
  tasksLaidOut,
} from "./open";
import {
  appsPlan,
  besidePlan,
  clearPlan,
  closePlan,
  enterPlan,
  itemsPlan,
  layOutPlan,
  onlyPlan,
  tabPlan,
  type TaskFacts,
} from "./plan";
import { appsWanted, rememberTask, taskAppsFound, taskFacts, taskLayout, taskOrder, forgetActor } from "./remember";
import { closeHerePane, closePane, renderLayout } from "./render";
import { shadow } from "./shadow";
import type { AppItem } from "./types";
import { workClosed, workPlacer } from "./work-area";

/** The apps' panels the task last entered opens (openTaskApps): waited on (the list's openTask). */
export let taskAppsOpening: Promise<unknown> = Promise.resolve();
const opening = (p: Promise<unknown>) => (taskAppsOpening = p);

/** The actor `c` of `g` about to be shown in the pane in focus (show): of another task than the one shown, the one left
 * remembered (only one laid out in this page -- one shown by chance as the page opened, its apps never opened, would be
 * remembered as having none), the others' panels closed (enterPlan), the new task's apps' panels opened above
 * (openTaskApps) -> `view`, the view `c` showed then (not open already), and `after`, what to do once `c` is shown: the
 * rest of its actors' panes opened beside it, as the task was left, or, never left, every one not closed (its lead
 * first). The same task: nothing to do -- but, never laid out in this page, laid out now, adding to what is open. */
export function enterTask(g: string, c: string): { view: string | null; after: () => void } | null {
  if (snap()) return null;
  const to = taskKey(g, c),
    sel = focusedActor();
  const from = appsOnlyKey() || (sel && taskKey(sel[0], sel[1])) || (state.selected && taskKey(...state.selected));
  if (to) setTaskNow(to);
  if (to && from !== to) shadow.update(model.open, to);
  if (!to || !sel) return null;
  const was = taskLayout(to),
    open = openActors().some((s) => isAt(s, g, c));
  if (from === to) {
    if (tasksLaidOut.has(to)) return null; // shown, laid out: as it is
    // shown by chance (the page opened on it), never laid out in this page: laid out now, adding to what is open
  } else {
    // one never laid out here (its apps never opened) is not remembered, nor one out of sight (an empty tab's, kept as
    // it was when that tab was left) -- but one whose actor's pane the reader closed is (its apps shown still, or not)
    if (tasksLaidOut.has(from) && (!isAway() || isShut())) rememberTask(from);
    void renderLayout(enterPlan(openNow(), to)); // the others' panels closed
  }
  tasksLaidOut.add(to);
  opening(openTaskApps(g, c, to, was ? was.apps : null));
  const view = !open && from !== to && was && was.views ? was.views[c] || null : null;
  return { view, after: () => layOutTask(g, to, c, was ? was.actors : taskOrder(g, to), was) };
}
/** A task of apps only entered (`k`: its key; an app alone, or a task holding no actor): the task left remembered, its
 * actors' panes closed (terminals kept) and the rest out of sight, the apps' panels of other tasks closed, its own
 * opened above -- as it was left, else all of them (openTaskApps). */
export function enterAppTask(g: string, k: string): void {
  if (snap()) return;
  const sel = focusedActor(),
    from = appsOnlyKey() || (sel && taskKey(sel[0], sel[1]));
  if (from === k) return;
  shadow.update(model.open, k);
  if (from && tasksLaidOut.has(from) && (!isAway() || isShut())) rememberTask(from);
  setTaskNow(k);
  tasksLaidOut.add(k);
  const was = taskLayout(k),
    gg = gathererNamed(g);
  // its apps the page knows, opened with it (appsPlan); the rest once read (openTaskApps)
  const known = gg ? taskAppsFound(g, gg, null, k, was ? was.apps : null).found.filter((a) => a.inst) : [];
  void renderLayout(appsPlan(openNow(), k, appsWanted(g, known)));
  opening(openTaskApps(g, null, k, was ? was.apps : null)); // as it was left
}
/** A task's actors `rest`, not closed, opened beside `c` (shown), as many as there is room for -- each in the view it
 * showed when the task was left (`was`); `c` in focus after. */
function layOutTask(g: string, to: string, c: string, rest: string[], was: model.Left | null = null): void {
  tasksLaidOut.add(to);
  void renderLayout(layOutPlan(openNow(), g, c, rest.filter(openIn(g, to)), was?.views || {}, maxPanes()));
}
// whether actor `ch` of `g` is open (not closed) and of task `to`
const openIn = (g: string, to: string) => (ch: string) => {
  const a = gathererNamed(g)?.agents.find((x) => x.channel === ch);
  return !!a && statusOf(a)[0] !== "closed" && taskKey(g, ch) === to;
};
const tooMany = (n: number) =>
  paneNote(`${plural(n, "actor")} of the task not opened. At most ${maxPanes()} fit side by side.`);

/** A task opened BESIDE the one shown (⌘/Ctrl+click on it): nothing of the one shown closed -- its actors not closed, as
 * it was left (else its lead first; `first`, first), in panes beside the one in focus, as many as there is room for, and
 * its apps' panels added above (openTaskApps, `beside`); `first`'s pane in focus after. */
export async function openTaskBeside(g: string, key: string, first: string): Promise<void> {
  shadow.update(model.open, key, true);
  const gg = gathererNamed(g),
    was = taskLayout(key);
  if (!gg) return;
  tasksLaidOut.add(key);
  const order = [first, ...(was ? was.actors : taskOrder(g, key))].filter(
    (ch, i, all) => ch && all.indexOf(ch) === i && openIn(g, key)(ch),
  );
  const found = taskAppsFound(g, gg, first, key, was ? was.apps : null).found;
  const facts: TaskFacts = {
    key,
    g,
    first: order[0] || null,
    rest: order.slice(1),
    shut: false,
    views: was?.views || {},
    apps: appsWanted(g, found),
    back: null,
    focusApp: null,
    mine: false,
  };
  const plan = besidePlan(openNow(), facts, maxPanes());
  await renderLayout(plan);
  if (plan.left) tooMany(plan.left);
  await openTaskApps(g, first, key, was ? was.apps : null, true); // its apps the page did not know, once read
  const p = actorPanes().find((q) => isAt([q.g, q.c], g, first));
  if (p) focusPane(p);
}
/** An actor opened beside a task of apps alone (⌘+click): this page's own pane, out of sight while apps alone show, in
 * sight again with `c` in it -- the apps kept, beside (besidePlan, of `c` alone). */
export async function outOfAppsOnly(g: string, c: string): Promise<void> {
  if (!appsOnlyKey() || !c) return;
  const facts: TaskFacts = {
    key: "",
    g,
    first: c,
    rest: [],
    shut: false,
    views: {},
    apps: [],
    back: null,
    focusApp: null,
    mine: false,
  };
  await renderLayout(besidePlan(openNow(), facts, maxPanes()));
}

/** The apps' panels of a task -- its apps (the list's taskApps), as the host has them now; an app alone, it -- up to
 * TASK_APPS, not open already; `only`, the task's layout as it was left: those of them it had open alone. Those whose
 * instance the page knows open at once, in the same frame as the rest of the task entered (its actor shown, the task
 * left's panels closed): waited for the server's apps, the work area was drawn a frame without them at each switch
 * between tasks with apps -- the Chat its whole height, its actor done large, then short again: a flicker. The server's
 * apps read then, the rest opened, as the host has them now; one opened at once, its app closed since, closed. */
export async function openTaskApps(
  g: string,
  c: string | null,
  to: string,
  only: { app: string; id: string; size?: number }[] | null = null,
  beside = false,
): Promise<void> {
  const gg = gathererNamed(g);
  if (!gg) return;
  let found;
  ({ to, found } = taskAppsFound(g, gg, c, to, only));
  if (!beside && taskNow() !== to) return;
  const early = found.filter((k) => k.inst);
  for (const k of early) wantTaskApp(k, g);
  if (early.length) renderApps();
  await L.list.readApps(g, true);
  if (!beside && taskNow() !== to) return; // another task entered meanwhile: its apps are wanted, not these
  const open = new Set((L.list.appsKnown.get(g)?.instances || []).map((i) => i.id));
  appClosedSince(early.filter((k) => !open.has(k.id)).map((k) => k.id));
  for (const k of taskAppsFound(g, gg, c, to, only).found) if (open.has(k.id)) wantTaskApp(k, g); // (open still; made
  // one task with others since: that one's)
  renderApps();
}

/** The tab shown left with task `k` alone (⌥+click on it while others show): the others kept as they are, their panes
 * and panels closed (terminals kept) -- this page's own pane given one of k's actors if it showed another's, or, k of
 * apps alone, the actors' panes out of sight. */
export async function onlyTask(k: string): Promise<void> {
  shadow.update(model.open, k); // (this task alone in the tab shown)
  const others = [...new Set(shownPanels().map((s) => s.key))].filter((x): x is string => !!x && x !== k);
  if (!others.length) return;
  for (const o of others) if (tasksLaidOut.has(o)) rememberTask(o);
  const plan = onlyPlan(openNow(), k),
    apps = plan.appsOnly === k && appsOnlyKey() !== k;
  if (apps) {
    setTaskNow(k);
    tasksLaidOut.add(k);
  }
  void renderLayout(plan);
  if (apps) opening(openTaskApps(parseKey(k).group, null, k, taskLayout(k)?.apps || null)); // as it was left
}
/** A task of a screen tab dragged into the tab shown (work.ts's mergeTab): opened beside the tasks shown, as ⌘+click
 * opens one -- not routed, its tab gone from the bar. */
export async function openTaskHereBeside(k: string): Promise<void> {
  const { group: g, id } = parseKey(k),
    gg = gathererNamed(g);
  if (!gg || id === undefined) return;
  const t = taskNumber(id);
  if (t !== null) {
    if (!L.list.taskById(g, t)) return;
    if (!L.list.taskLead(gg, t)) return openTaskApps(g, null, k, taskLayout(k)?.apps || null, true); // apps alone
    await L.openTask(g, t, null, { metaKey: true, inTabs: true });
    return;
  }
  if (L.list.isAppItem(id)) {
    if (L.list.appInfo(g, id.slice(L.list.APP_ITEM.length))) await openTaskApps(g, null, k, null, true);
    return;
  }
  if (gg.agents.some((a) => a.channel === id)) await openTaskBeside(g, k, id);
}
/** A task CLOSED HERE (its card head's ×, or moved to another tab): kept as it is now, its panes and panels closed -- its
 * agents go on -- this page's own pane given the next pane's actor if it showed one of k's, else out of sight (the tab
 * showing nothing else: its note says so); the focus, if it was k's, on the next task shown (closePlan, rendered). */
export async function closeTaskHere(k: string): Promise<void> {
  shadow.update(model.closeHere, k);
  if (tasksLaidOut.has(k)) rememberTask(k);
  void renderLayout(closePlan(openNow(), k));
  if (taskNow() === k) setTaskNow(null);
}
/** An item CLOSED FROM THE LIST -- an actor, an app: its row's ×, its rail tile's, its task's card's -- or a whole task
 * (its row's ×: no `item`), task `k`'s: closed in the screen tabs too, before it is closed itself, as there a tab's × or
 * a panel's would. A task of its own (a lone actor, a lone app), or the whole task, out of the tab holding it (tabs.ts's
 * `closed`): that tab closed if it held nothing else (the tab shown: the next shown; the only one, emptied), else the
 * task out of it -- the tab shown's, its panels closed here, as its card head's × does (closeTaskHere). An actor of a task
 * with others: its pane closed, as its pane's × does (closeHerePane: this page's own), and left out of its task as kept
 * for another tab (forgetActor); an app of one: its panel closed with it (the list's closeApp). */
export async function closedInTabs(k: string | null, item: string | null = null): Promise<void> {
  if (!workPlacer || !k || snap()) return;
  const { group: g, id } = parseKey(k);
  if (item === null || id === item) return workPlacer.tabs.closed(k, () => closeTaskHere(k));
  if (L.list.isAppItem(item)) return;
  for (const p of [...actorPanes()])
    if (isAt([p.g, p.c], g, item)) {
      workClosed(p.node);
      closePane(p);
    }
  if (isAt(state.selected, g, item) && !isAway()) await closeHerePane();
  forgetActor(k, item);
}
/** A new tab, empty ("+" on the tabs' bar): the tasks shown kept as they are (the tab left keeps them), their panes and
 * panels closed (terminals kept), this page's own pane out of sight till a task is opened in it (clearPlan, rendered). */
export async function clearWork(): Promise<void> {
  void renderLayout(clearPlan(openNow()));
  setTaskNow(null);
}

/** A TAB SHOWN: its tasks in place of those shown, each as it was left -- worked out at once (tabPlan: the first with an
 * actor in this page's own pane, its other actors beside it, each other task beside them, those of apps alone last,
 * terminals kept; `focus` in focus after), the store made so and the page made to match it (renderLayout), not waiting
 * on what each pane loads to show (a Chat at times slow): a click while a tab is shown waits for this (viaTabs). The apps
 * the page does not know yet opened once read, if the tab is still the one shown. */
let entering: object | null = null;
export async function enterTasks(keys: string[], focus: string | null): Promise<void> {
  const all = [focus, ...keys].filter((k, i, them): k is string => !!k && them.indexOf(k) === i);
  // an app's among them: its group's apps read first -- a tab shown at a reload, before the page read them, would skip
  // its app's task (unknown), its panel then restored beside the actor the page opened on (restoreAppPanes)
  const groups = [...new Set(all.map((k) => parseKey(k).group).filter(Boolean))];
  if (all.some((k) => L.list.isAppItem(parseKey(k).id || "")) && groups.some((g) => !L.list.appsKnown.has(g))) {
    await L.appHost.load();
    await Promise.all(groups.map((g) => L.list.readApps(g, true)));
  }
  const mine = (entering = {});
  const facts = all.map((k) => taskFacts(k)).filter((f): f is TaskFacts => !!f),
    keys2 = new Set(facts.map((f) => f.key));
  const plan = tabPlan(
    facts,
    focus,
    openNow((k) => !!k && keys2.has(k)),
    maxPanes(),
  );
  void renderLayout(plan, !!facts.length && !!facts[0].first && facts[0].mine);
  if (plan.left) tooMany(plan.left);
  await Promise.all(groups.map((g) => L.list.readApps(g, true).catch(() => {}))); // the apps as the server has them now
  if (entering !== mine) return; // another tab shown meanwhile
  const open = new Set(groups.flatMap((g) => (L.list.appsKnown.get(g)?.instances || []).map((i) => i.id)));
  appClosedSince(facts.flatMap((f) => f.apps.map((a) => a.id)).filter((id) => !open.has(id)));
  for (const k of plan.order) {
    const f = taskFacts(k);
    if (f)
      for (const a of f.apps) if (open.has(a.id)) wantTaskApp({ ...a, inst: instCache.get(a.id) }, parseKey(k).group);
  }
  renderApps();
  const f = plan.focus;
  if (f && "app" in f) selectAppPane(panes.apps.find((q) => !q.held && q.instance.id === f.app));
}

/** A TASK OPENED by a click on it in the list (the list's openTask), not shown as it is already: shown as it was left, in
 * place of what is shown -- worked out at once (tabPlan, of that task alone: `focus`, else the actor it opens first, in
 * this page's own pane, the others beside it, its apps above, terminals kept) and rendered; the task left kept as it is
 * first. `wait` false: done once the panes are open, what this page's own shows (its Chat) still loading. */
export async function openTaskHere(k: string, focus: string | null = null, wait = true): Promise<void> {
  const f = taskFacts(k, focus);
  if (!f || !f.first) return;
  const sel = focusedActor(),
    from = appsOnlyKey() || (sel && taskKey(sel[0], sel[1])) || (state.selected && taskKey(...state.selected));
  if (from && from !== k && tasksLaidOut.has(from) && (!isAway() || isShut())) rememberTask(from);
  const loading = renderLayout(
    tabPlan(
      [f],
      k,
      openNow((t) => t === k),
      maxPanes(),
    ),
    f.mine || from === k,
  );
  opening(openTaskApps(f.g, f.first, k, taskLayout(k)?.apps || null)); // its apps not known yet, once read
  if (wait && loading) await loading;
}

/** TASK TABS (tasks.ts). A task's tab shown: `items` of task `k` open, each in the view it showed, and the task's other
 * panels closed -- this page's own pane given another of the tab's actors, if it showed one not in it (itemsPlan). */
export async function showTaskItems(k: string, items: string[]): Promise<void> {
  const g = parseKey(k).group,
    views = taskLayout(k)?.views || {};
  const apps = items
    .filter((it) => L.list.isAppItem(it))
    .map((it) => L.list.appInfo(g, it.slice(L.list.APP_ITEM.length)))
    .filter((o): o is AppItem => !!o);
  for (const o of apps) {
    const inst = instOf(o);
    if (inst) instCache.set(o.id, inst);
  }
  const want = apps.map((o) => ({ app: o.app.name, id: o.id, g }));
  void renderLayout(itemsPlan(openNow(), k, g, items, views, want, maxPanes()));
  if (apps.length)
    await openTaskApps(
      g,
      null,
      k,
      apps.map((o) => ({ app: o.app.name, id: o.id })),
      true,
    );
}
