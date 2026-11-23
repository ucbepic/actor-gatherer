// WHAT IS OPEN in this page, as the layout's store (shadow.ts) holds it: the actors open in the panes, the one in focus,
// the app selected, the task each panel is of, the task of apps only shown, the page's own pane out of sight -- each read
// from the store and written by its rules (model.ts), the panes marked to match.
// Actors side by side: a click in the list shows its actor in the pane in focus; Ctrl+click (⌘+click on a Mac, where
// Ctrl+click is a right click) opens it in a new pane at that one's right, up to MAX_PANES. An actor open in a pane
// already is not opened twice: its pane is focused. A click in a pane focuses it; its × closes it; the bar between two
// resizes them. The first pane is this page's own (state.selected, panes.here); each other is a pane of this page too
// (pane.ts, features/page/pane-view.js's record), showing its own actor in its own view, drawn from the page's one stream
// and store.
import { isShell, key, parse as parseKey, taskId, taskNumber } from "../../core/model/keys";
import { appsSelected } from "./app-panels";
import { gathererNamed, isAt, L, panes, renderAgents, state } from "./link";
import * as model from "./model";
import { shadow } from "./shadow";
import { savePanes } from "./render";
import { placeWork, workPlacer } from "./work-area";
import type { AppPanel, At, OtherPane, Pane } from "./types";

export { isAt };
/** Every pane, this page's own first; every pane beside it (each an actor's: the apps' panels are apart). */
export const allPanes = (): Pane[] => L.paneView.allPanes();
export const actorPanes = (): OtherPane[] => panes.others;
/** The actors open in this page's panes, this page's own first. */
export function openActors(): At[] {
  return [...(state.selected ? [state.selected] : []), ...actorPanes().map((p): At => [p.g, p.c])];
}
/** The actor in the pane in focus. */
export function focusedActor(): At | null {
  const p = focusedPane();
  return p === panes.here || !panes.others.includes(p as OtherPane) ? state.selected : [p.g!, p.c!];
}
/** What the panes show and which is in focus, for the page's check of what changed (features/page/data.js). */
export const paneSig = () => [
  state.selected,
  panes.others.map((p) => [p.g, p.c]),
  allPanes().indexOf(focusedPane()),
  appSelected(),
];

// TASKS: the panels follow the task shown: one of several items (the list's tasks: actors and apps), else an item alone,
// an actor or an app -- the coordinator agent too, as an actor on its own -- a terminal is in none (`taskKey` null).
/** The key of the task actor (or app item) `c` of `g` is in: the task's, else its own; none for a terminal or an actor
 * gone. */
export function taskKey(g: string | null, c: string | null): string | null {
  if (!g || !c || isShell(c)) return null;
  if (L.list.isAppItem(c)) {
    const t = L.list.appTaskOf(g, c.slice(L.list.APP_ITEM.length));
    return key(g, t === null ? c : taskId(t));
  }
  const gg = gathererNamed(g);
  const a = gg && gg.agents.find((x) => x.channel === c);
  if (!a) return null;
  const t = L.list.taskOf(g, a);
  return key(g, t === null ? c : taskId(t));
}
/** The task an app's panel is of: its instance's. */
export const appPaneTask = (p: AppPanel): string | null => taskKey(p.g, L.list.appItem(p.instance.id));

/** A TASK OF APPS ONLY shown (its key): the actors' panes out of sight, its apps' panels taking the room; null: none. */
export const appsOnlyKey = (): string | null => shadow.layout.appsOnly || null;
export function setAppsOnly(k: string | null): void {
  shadow.update(model.setAppsOnly, k || null);
  document.querySelector(".work")?.classList.toggle("apps-only", !!k);
  placeWork();
}
/** THE TASK LAST ENTERED, what the apps opened for it wait on. */
export const taskNow = (): string | null => shadow.layout.entered || null;
export const setTaskNow = (k: string | null): void => shadow.update(model.setEntered, k || null);
/** The task entered, and the one whose apps alone show, under the key a change of the tasks gave it (`was` -> `now`). */
export function rekeyTask(was: string, now: string): void {
  if (taskNow() === was) setTaskNow(now);
  if (appsOnlyKey() === was) shadow.update(model.setAppsOnly, now);
}
/** The tasks laid out in this page (entered, or opened at first by the list's openTask): a task shown, laid out, stays as
 * it is -- read and written as a set (the list's openTask too). */
export const tasksLaidOut = Object.freeze({
  has: (k: string | null | undefined): boolean => !!k && model.isLaidOut(shadow.layout, k),
  add: (k: string): void => shadow.update(model.layOut, k, true),
  delete: (k: string): void => shadow.update(model.layOut, k, false),
});

// FOCUS: one item, an actor's pane or an app's panel selected, and the actor last in focus (model.ts's focus and
// lastActor): the pane focused is the one showing that actor (none: this page's own), the app selected the one focus
// names -- its panel marked as a focused pane is (.focused), the actors' panes not while it is; its line in the list
// filled. Selected by a click on it in the list or a task's card (the list's selectApp), a press on its panel, or the
// focus going into its frame; an actor's pane focused (focusPane: a press in it, an actor shown) ends it.
export const paneKey = (p: Pane): string | null =>
  p === panes.here ? (state.selected ? key(state.selected[0], state.selected[1]) : null) : key(p.g!, p.c!);
export function focusedPane(): Pane {
  const k = shadow.layout.lastActor;
  return (k && allPanes().find((p) => paneKey(p) === k)) || panes.here;
}
/** The app selected (its instance's id), if its panel is shown. */
export function appSelected(): string | null {
  const f = shadow.layout.focus,
    id = f ? parseKey(f).id : null;
  if (!id || !L.list.isAppItem(id)) return null;
  const inst = id.slice(L.list.APP_ITEM.length);
  return panes.apps.some((p) => !p.held && p.instance.id === inst) ? inst : null;
}
/** Pane `p` showing actor `c` of `g` in place of its own: focus goes with it, if it had it. */
export function retarget(p: OtherPane, g: string, c: string): void {
  const had = focusedPane() === p;
  shadow.update(model.retargetPane, p.g, p.c, { g, c });
  p.g = g;
  p.c = c;
  if (had) shadow.update(model.focusOn, key(g, c), true);
}
export function markSelected(): void {
  const sel = appSelected();
  for (const q of panes.apps) q.node.classList.toggle("focused", !!sel && q.instance.id === sel);
  for (const q of allPanes()) q.node.classList.toggle("focused", !sel && q === focusedPane());
}
/** An app's panel gone (closed, held out of sight, its app closed): no longer selected, the focused pane marked again. */
export function unselectApp(id: string): void {
  const f = shadow.layout.focus;
  if (!f || parseKey(f).id !== L.list.appItem(id)) return;
  shadow.update(model.unfocus, f);
  markSelected();
}
export function selectAppPane(p: AppPanel | null | undefined): void {
  if (!p || p.held) return;
  shadow.update(model.focusOn, key(p.instance.gatherer, L.list.appItem(p.instance.id)), false);
  markSelected();
  if (state.home) renderAgents();
}
/** An actor's pane focused: the app selected, if one was, no longer. */
export function focusPane(p: Pane | null | undefined): void {
  if (!p) return;
  const had = appSelected(),
    same = focusedPane() === p;
  shadow.update(model.focusOn, paneKey(p), true);
  if (had) markSelected();
  if (same) {
    if (had && state.home) renderAgents();
    return;
  }
  for (const q of allPanes()) q.node.classList.toggle("focused", q === p);
  savePanes();
  appsSelected();
  if (state.home) renderAgents();
}
/** The task of what is selected: the selected app's, else the task of apps only shown, else the focused actor's. */
export function selectedTask(): string | null {
  const sel = appSelected(),
    p = sel && panes.apps.find((q) => q.instance.id === sel);
  if (p) return appPaneTask(p);
  if (appsOnlyKey()) return appsOnlyKey();
  const f = focusedActor();
  return f && !(focusedPane() === panes.here && isAway()) ? taskKey(f[0], f[1]) : null; // (its own out of sight: none)
}

// This page's own pane AWAY: its actor not in its task's tab shown (none of the tab's to show in it instead), out of sight
// till it shows another, or the reader asks for that one (show). CLOSED by the reader (its ×: closeHerePane), and not by a
// tab that leaves it out: its task, left and opened again, shows what else of it was shown, without it (rememberTask's
// `shut`).
export const awayOf = (): At | null => {
  const a = shadow.layout.away;
  return a ? [a.g, a.c] : null;
};
export function putAway(sel: At | null, closed = false): void {
  shadow.update(model.setAway, sel ? [sel[0], sel[1]] : null, closed);
}
/** This page's own pane in sight again: its actor looked at now (the list's seen), the list and the tabs' marks drawn so. */
export function backInSight(): void {
  shadow.update(model.setAway, null);
  L.seen.markSeen();
  if (state.home) renderAgents();
}
export const isAway = (): boolean => {
  const a = shadow.layout.away;
  return !!a && isAt(state.selected, a.g, a.c);
};
export const isShut = (): boolean => !!shadow.layout.away?.shut && isAway();

/** The task of the actor the page opened on by itself (model.ts's auto), set where it is opened (features/page/data.js's
 * refresh, features/settings/panel.js's restore): a click on another task shows it in its place, not in a new tab. */
export const autoShown = (): string | null => shadow.layout.auto || null;
export function setAutoShown(k: string | null): void {
  shadow.update(model.setAuto, k || null);
  if (k) shadow.update(model.opened, k); // (shown by itself: state.selected set)
}

/** A panel shown, as the work area arranges it: its task's key (null: a terminal, the gatherer's agent, the page with no
 * actor, or any panel before the home has come), its item there, its element. */
export interface ShownPanel {
  key: string | null;
  item: string;
  node: HTMLElement;
  app: boolean;
}
/** The panels shown, in order -- this page's own pane, the others, the apps' panels. No actor to show in its own at all
 * (none yet), the home come: out of sight too -- the tab, showing nothing, shows its new-tab page, not "No actors yet". */
export function shownPanels(): ShownPanel[] {
  const known = !!state.home,
    out: ShownPanel[] = [];
  const actor = (g: string, c: string, node: HTMLElement) =>
    out.push({ key: known ? taskKey(g, c) : null, item: c, node, app: false });
  const none = known && !state.selected && !!workPlacer;
  panes.here.node.classList.toggle("lay-away", isAway() || none);
  if (!appsOnlyKey()) {
    if (state.selected && isAway()) {
      /* out of sight */
    } else if (state.selected) actor(state.selected[0], state.selected[1], panes.here.node);
    else if (!none) out.push({ key: null, item: "here", node: panes.here.node, app: false });
    for (const p of actorPanes()) actor(p.g, p.c, p.node);
  }
  for (const p of panes.apps)
    if (!p.held)
      out.push({
        key: known ? appPaneTask(p) : null,
        item: L.list.appItem(p.instance.id),
        node: p.node,
        app: true,
      });
  return out;
}

/** What is open now, as a plan reads it (plan.ts's Open): this page's own pane's actor (none, out of sight), the panes
 * beside it (each kept if `keep` says so of its task, and terminals) and the apps' panels shown, each with its task; the
 * task of apps alone shown, and the task in focus. */
export function openNow(keep: (task: string | null) => boolean = () => false) {
  const t = (g: string, c: string) => (state.home ? taskKey(g, c) : null);
  const sel = state.selected;
  return {
    here: sel && !isAway() ? { g: sel[0], c: sel[1], task: t(...sel) } : null,
    view: panes.here.view || "files",
    others: actorPanes().map((p) => ({
      g: p.g,
      c: p.c,
      view: p.view || null,
      size: p.size,
      task: t(p.g, p.c),
      keep: isShell(p.c) || keep(t(p.g, p.c)),
    })),
    apps: panes.apps
      .filter((p) => !p.held)
      .map((p) => ({
        app: p.app.name,
        id: p.instance.id,
        g: p.instance.gatherer,
        size: p.size,
        task: state.home ? appPaneTask(p) : null,
      })),
    appsOnly: appsOnlyKey(),
    focus: selectedTask(),
    away: sel && isAway() ? { g: sel[0], c: sel[1], task: t(...sel) } : null,
    at: panes.others.indexOf(focusedPane() as OtherPane),
  };
}

/** A task's key as it is now: a lone item's -- an actor's, an app's -- the task it has been put in since, if it has
 * (taskKey); any other, as it is (a task's; one not known yet, its apps not read). A screen tab keeps the keys of the
 * tasks it was left with (tabs.ts). */
export function keyNow(k: string): string {
  const { group: g, id } = parseKey(k);
  if (!id || taskNumber(id) !== null || !state.home) return k;
  return taskKey(g, id) || k;
}
