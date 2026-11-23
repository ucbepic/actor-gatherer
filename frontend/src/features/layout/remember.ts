// Each task's LAYOUT, as it was left (the layout's store's record of it, `left`: model.ts): its actors' panes, in order,
// the one in focus, the view each shows, and its apps' panels -- with the chat minimized under them or not -- so a task is
// opened again as it was, an actor's pane or an app's panel closed in it staying closed; where each goes, and how wide or
// tall, its arrangement (work.ts). A task never left yet opens as a task does at first: its actors not closed side by
// side, its apps above, the chat not minimized. This page's own pane closed by its × (closeHerePane) is not among its
// actors' panes: its actor, `shut`, is the one it opens with out of sight if none of the others was open. And what the
// page knows of a task, from that and the home (taskFacts, facts.ts), and the keys a task the store holds reads as now.
import { parse as parseKey, taskNumber } from "../../core/model/keys";
import { instCache, instOf } from "./app-panels";
import { factsOf, taskKeysNow } from "./facts";
import { gathererNamed, L, panes, state, statusOf } from "./link";
import * as model from "./model";
import {
  actorPanes,
  appPaneTask,
  appSelected,
  appsOnlyKey,
  focusedActor,
  isAway,
  isShut,
  keyNow,
  openActors,
  rekeyTask,
  taskKey,
  tasksLaidOut,
} from "./open";
import type { AppWant, TaskFacts } from "./plan";
import { shadow } from "./shadow";
import type { AppItem, Gatherer, Instance } from "./types";

/** The apps' panels a task opens at most. */
export const TASK_APPS = 3;

/** Task `key` kept as it is now: its actors' panes open, the one in focus, their views, its apps' panels, the actor whose
 * pane the reader closed. */
export function rememberTask(key: string | null): void {
  if (!key) return;
  const sel = focusedActor(),
    g = parseKey(key).group,
    its = (pg: string, c: string) => pg === g && taskKey(pg, c) === key;
  const shut = isShut() && state.selected && its(...state.selected) ? state.selected[1] : null;
  const actors = openActors()
    .filter(([pg, c]) => its(pg, c) && c !== shut)
    .map(([, c]) => c);
  const views: Record<string, string> = {}; // each of its actors' panes: the view it shows
  if (state.selected && its(...state.selected)) views[state.selected[1]] = L.views.chatView(panes.here).id;
  for (const p of actorPanes()) if (its(p.g, p.c) && p.view) views[p.c] = p.view;
  const apps = panes.apps
    .filter((p) => !p.held && p.g === g && appPaneTask(p) === key)
    .map((p) => ({ app: p.app.name, id: p.instance.id }));
  const chosen = appSelected(),
    focusApp = chosen && apps.some((a) => a.id === chosen) ? chosen : null; // an app selected in it
  const only = !!appsOnlyKey();
  const mine = !only && !!sel && sel[1] !== shut && taskKey(sel[0], sel[1]) === key;
  const left: model.Left = {
    actors: only ? [] : actors,
    focus: mine ? sel![1] : only ? null : actors[0] || null,
    focusApp,
    apps,
    views: only ? {} : views,
    shut: only ? null : shut,
  };
  shadow.update(model.remember, key, left, Date.now());
  shadow.persist();
}
export const taskLayout = (key: string): model.Left | null => shadow.now().tasks[key]?.left || null;
/** Actor `c` closed from the list (closedInTabs): out of task `key` as it was left -- not opened with it again. */
export function forgetActor(key: string, c: string): void {
  shadow.update(model.forgetActor, key, c);
  shadow.persist();
}
/** A task's actors not closed, as it opens at first: its lead first (the list's taskActors). */
export function taskOrder(g: string, key: string): string[] {
  const gg = gathererNamed(g),
    n = taskNumber(parseKey(key).id);
  return gg && n !== null ? L.list.taskActors(gg, n).map((a) => a.channel) : [];
}

/** One of a task's apps to open: its app, its instance's id, its width if kept, its instance if the page knows it. */
export interface TaskApp {
  app: string;
  id: string;
  size?: number;
  inst?: Instance | null;
}
/** A task's apps to open (openTaskApps), as the page has them now: {to, the task `to` is now (an actor or app alone, made
 * one task with others since: that one's), found, its apps -- `only`, those of them -- up to TASK_APPS, in that order,
 * each once}. */
export function taskAppsFound(
  g: string,
  gg: Gatherer,
  c: string | null,
  to: string,
  only: { app: string; id: string; size?: number }[] | null,
): { to: string; found: TaskApp[] } {
  const item = c || parseKey(to).id,
    now = taskKey(g, item);
  if (now && now !== to && taskNumber(parseKey(to).id) === null) {
    // made one task with others since: that one's
    rekeyTask(to, now);
    tasksLaidOut.add(now);
    to = now;
  }
  const found: TaskApp[] = [];
  const add = (k: TaskApp) => {
    if (L.appHost.named(k.app) && !found.some((f) => f.id === k.id)) found.push(k);
  };
  const id = parseKey(to).id,
    n = taskNumber(id);
  const mine: AppItem[] =
    n !== null
      ? L.list.taskApps(gg, n)
      : L.list.isAppItem(id)
        ? [L.list.appInfo(g, id.slice(L.list.APP_ITEM.length))].filter((x): x is AppItem => !!x)
        : [];
  const known = (o: { app: string; id: string }) =>
    instOf(mine.find((m) => m.id === o.id) || [L.list.appInfo(g, o.id)].find((m) => m && m.app.name === o.app));
  if (only) for (const o of only) add({ ...o, inst: known(o) });
  else for (const o of mine) add({ app: o.app.name, id: o.id, inst: instOf(o) });
  return { to, found: found.slice(0, TASK_APPS) };
}
/** Apps found, as a plan wants them (their instances the page knows kept for their panels). */
export function appsWanted(g: string, found: TaskApp[]): AppWant[] {
  for (const a of found) if (a.inst) instCache.set(a.id, a.inst);
  return found.map((a) => ({ app: a.app, id: a.id, g, ...(Number(a.size) > 0 ? { size: Number(a.size) } : {}) }));
}

/** What the page knows of task `k` of a tab, as it was left (facts.ts's factsOf); none: a task gone. `focus`: the actor it
 * opens first, asked for (the list's openTask): none of what was in focus then. */
export function taskFacts(k: string, focus: string | null = null): TaskFacts | null {
  const { group: g, id } = parseKey(k),
    gg = gathererNamed(g);
  if (!gg || id === undefined) return null;
  const was = taskLayout(k),
    n = taskNumber(id);
  const open = (c: string) => {
    const a = gg.agents.find((x) => x.channel === c);
    return !!a && statusOf(a)[0] !== "closed" && taskKey(g, c) === k;
  };
  const apps = (first: string | null) => appsWanted(g, taskAppsFound(g, gg, first, k, was ? was.apps : null).found);
  const sel = state.selected;
  // its actor in this page's own pane already, the task not laid out (the page opened on it)
  const mine = !!sel && !isAway() && !appsOnlyKey() && sel[0] === g && taskKey(...sel) === k && !tasksLaidOut.has(k);
  const base = { key: k, g, id, was, open, apps, mine, selected: sel && sel[0] === g ? sel[1] : null };
  if (n !== null) {
    if (!L.list.taskById(g, n)) return null;
    const lead = L.list.taskLead(gg, n);
    return factsOf(
      {
        ...base,
        kind: "task",
        members: L.list.taskActors(gg, n).map((a) => a.channel),
        lead: lead?.channel || null,
        order: taskOrder(g, k),
      },
      focus,
    );
  }
  if (L.list.isAppItem(id)) {
    if (!L.list.appInfo(g, id.slice(L.list.APP_ITEM.length))) return null;
    return factsOf({ ...base, kind: "app", members: [], lead: null, order: [] });
  }
  if (!gg.agents.some((a) => a.channel === id)) return null;
  return factsOf({ ...base, kind: "actor", members: [id], lead: id, order: [] });
}

/** The layout's store's keys now (shadow.ts): keyNow's -- and for a task, itself and the keys now of the items it held
 * when last placed and holds no more whose panels are open (facts.ts's taskKeysNow). */
export function keysNow(k: string): string[] {
  const { group: g, id } = parseKey(k),
    n = taskNumber(id);
  if (!state.home) return [k];
  if (n === null) return L.list.isAppItem(id) || taskKey(g, id) ? [keyNow(k)] : []; // (an actor gone: none)
  const tasks = (state.home.tasks || {})[g] || { tasks: [], tasked: {} };
  return taskKeysNow(k, n, tasks, (shadow.layout.items || {})[k] || [], new Set(shadow.layout.open || []), (item) =>
    taskKey(g, item),
  );
}
shadow.keysWith(keysNow); // (how the layout's store reads a task's key now)
