// An actor SHOWN: in the pane in focus, or (⌘/Ctrl) beside it -- where its task is open, first (viaTabs: the screen
// tabs) -- its task entered if it is another than the one shown (enter.ts), the rest of the task laid out beside it.
import * as prefs from "../../core/prefs";
import { parse as parseKey, taskNumber } from "../../core/model/keys";
import { showActorsApp } from "./app-hooks";
import { enterTask, onlyTask, openTaskBeside, outOfAppsOnly } from "./enter";
import { paneNote } from "./heads";
import { isAt, L, maxPanes, panes, renderAgents, snap, state } from "./link";
import * as model from "./model";
import {
  actorPanes,
  allPanes,
  appPaneTask,
  appsOnlyKey,
  autoShown,
  awayOf,
  backInSight,
  focusPane,
  focusedPane,
  isAway,
  putAway,
  retarget,
  selectAppPane,
  selectedTask,
  setAutoShown,
  shownPanels,
  taskKey,
} from "./open";
import { paneGiven, renderPanes, savePanes } from "./render";
import { shadow } from "./shadow";
import type { OtherPane, Pane } from "./types";
import { workPlacer } from "./work-area";

/** What a click carries that the layout reads: its keys, whether the screen tabs routed it already, its target. */
export interface Click {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  inTabs?: boolean;
  target?: EventTarget | null;
  preventDefault?: () => void;
}

/** A row of the list clicked: shown in the pane in focus, or (Ctrl/⌘) beside it -- where its task is open, first. An actor
 * that is a task of its own, with ⌘/Ctrl: it and its apps beside (openTaskBeside); one in a task with others, it alone
 * beside. */
export async function pick(g: string, c: string, ev?: Click): Promise<void> {
  const beside = !!(ev && (ev.ctrlKey || ev.metaKey) && !snap());
  if ((await viaTabs(taskKey(g, c), ev, c)) || !beside) return show(g, c);
  await outOfAppsOnly(g, c);
  const k = taskKey(g, c);
  return k && taskNumber(parseKey(k).id) === null ? openTaskBeside(g, k, c) : openBeside(g, c);
}
/** A Mac's Ctrl+click: a right click, no click after it -- opened beside. */
export function pickBeside(g: string, c: string, ev: MouseEvent): void {
  const t = ev.target instanceof Element ? ev.target : null;
  if (!L.helpers.MAC || !ev.ctrlKey || snap() || t?.closest(".close-btn, .save-btn")) return;
  ev.preventDefault();
  void openBeside(g, c);
}

/** The actor in the pane in focus -- in `view`, if given; one open already, its pane focused instead. Of another task
 * than the one shown: the panels changed for it first (enterTask), and the rest of its task laid out beside it, its pane
 * in focus, as soon as it is in its pane -- not once what it shows (its Chat) has loaded: a click meanwhile (an app
 * selected, another pane) would lose its focus to it. `wait` false: done then, its Chat loading still. `shut`: its pane
 * closed by the reader when its task was left, shown out of sight, as it was, the task's apps beside. */
export async function show(g: string, c: string, view: string | null = null, wait = true, shut = false): Promise<void> {
  if (shut)
    putAway([g, c], true); // (out of sight once it is the one in this page's pane)
  else if (isAt(awayOf(), g, c)) {
    // asked for: in sight again (and in its task's tab shown)
    backInSight();
    const k = taskKey(g, c);
    if (k) shadow.update(model.open, k, true);
  }
  const entered = enterTask(g, c);
  const shown = await showIn(g, c, view || entered?.view || null, false);
  if (entered) entered.after();
  if (wait && shown) await shown.loading;
}
/** `c` shown in the pane in focus, or its own pane focused: what it shows (its Chat) loaded first -- `wait` false, not
 * waited on: then {loading}, the load under way, if one is. */
async function showIn(
  g: string,
  c: string,
  view: string | null = null,
  wait = true,
): Promise<{ loading: Promise<unknown> } | null> {
  const there: Pane | null =
    actorPanes().find((p) => isAt([p.g, p.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null);
  if (there) void showActorsApp(g, c); // shown already: its app's panel, closed since, opened again
  const p = there || focusedPane();
  if (p !== panes.here) {
    const q = p as OtherPane;
    focusPane(q);
    if (!there) {
      retarget(q, g, c);
      q.view = view || q.view;
      savePanes();
      L.panel.connect();
      renderAgents();
      void paneGiven(q);
    } else if (view) void L.views.setChatView(q, view);
    return null;
  }
  focusPane(panes.here);
  let loading: Promise<unknown> | null = null;
  if (there) {
    if (view) loading = L.views.setChatView(panes.here, view);
  } else {
    if (view) setViewHere(view);
    loading = L.modes.select(g, c);
  }
  if (!loading) return null;
  if (wait) {
    await loading;
    return null;
  }
  loading.catch(() => {});
  return { loading };
}
/** This page's own pane's view, kept in this browser as the page's choice. */
export function setViewHere(id: string): void {
  panes.here.view = id;
  prefs.setText(L.views.CHAT_VIEW_KEY, id);
}
/** Actor `c` of `g` in a new pane at the right of the one in focus (in `view`, else that one's); open already, its pane
 * focused. */
export function openBeside(g: string, c: string, view: string | null = null): Promise<void> | void {
  if (snap() || !state.selected) return show(g, c, view);
  const there = actorPanes().find((p) => isAt([p.g, p.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null);
  if (there) return focusPane(there);
  if (allPanes().length >= maxPanes())
    return paneNote(`At most ${maxPanes()} actors fit side by side. Close one to open another.`);
  const bk = taskKey(g, c);
  if (bk) shadow.update(model.open, bk, true);
  const from = focusedPane(),
    at = from === panes.here ? 0 : panes.others.indexOf(from as OtherPane) + 1;
  shadow.update(model.wantPane, { g, c, view: view || from.view || undefined, size: 1 }, at);
  renderPanes();
  focusPane(actorPanes().find((p) => isAt([p.g, p.c], g, c)));
}

// SCREEN TABS (tabs.ts). A task is OPEN where any of its items is shown: in the tab shown, or in another. A click in the
// list on an item (`item`, if one) of task `k` -- `ev`, the click; a notification's, a link's, an actor started, as a
// plain click: {} -- goes where the task is, before it is shown as the click shows it:
// - plain: the task open in the tab shown, its panel in focus (the tab of its own tabs holding `item` shown); open in
//   another tab, that tab shown; open nowhere, a new tab for it (the tab shown, if it shows nothing);
// - ⌥: the tab shown made the task's alone -- the task out of any other tab, the tab's other tasks closed (onlyTask), or,
//   it not shown here, replaced by it;
// - ⌘/Ctrl: open in another tab, that tab shown; else opened beside, as before. Shift: selected, nothing here.
// The actor the page opened on by itself, nothing kept to show, counts as nothing shown: the first click on another task
// shows it in its place, not in a new tab.
/** True: the task now shown where the click goes on as a plain one (⌘ having brought its tab forward). */
export async function viaTabs(
  k: string | null,
  ev: Click | null | undefined,
  item: string | null = null,
): Promise<boolean> {
  if (!workPlacer || !k || !ev || ev.inTabs || snap() || ev.shiftKey) return false;
  const tabs = workPlacer.tabs;
  if (tabs.busy()) await tabs.settled(); // a tab still being shown (its panes opened one by one): once it is
  const at = tabs.where(k);
  const chance = !!autoShown() && shownPanels().every((s) => !s.key || s.key === autoShown());
  setAutoShown(null);
  if (ev.ctrlKey || ev.metaKey) {
    if (!at || at.here) return false;
    await tabs.route(k);
  } else if (ev.altKey) {
    tabs.take(k);
    if (at && at.here) await onlyTask(k);
  } else await tabs.route(k, chance);
  if (shownPanels().some((s) => s.key === k)) {
    focusTask(k);
    const t = item && workPlacer.itemTab(k, item);
    if (t) await workPlacer.showTab(k, t);
  }
  return !!(ev.ctrlKey || ev.metaKey);
}
/** The page opened, the home come: the tab shown's tasks shown as it was left (tabs.ts's start), in place of what the
 * page opened on by itself (the first actor; with one pane, the page keeps none) -- once. */
let tabsStarted = false;
export async function startTabs(): Promise<void> {
  if (tabsStarted || !workPlacer || !state.home || snap()) return;
  tabsStarted = true;
  if (await workPlacer.tabs.start()) setAutoShown(null);
}
/** Task `k`'s panel in focus, if one is shown: its actor's pane (this page's own first), else its app's panel selected. */
export function focusTask(k: string | null): void {
  if (!k || selectedTask() === k) return;
  const mine = (g: string, c: string) => taskKey(g, c) === k;
  if (!appsOnlyKey() && state.selected && !isAway() && mine(...state.selected)) return focusPane(panes.here);
  const p = actorPanes().find((q) => mine(q.g, q.c));
  if (p) return focusPane(p);
  const a = panes.apps.find((q) => !q.held && appPaneTask(q) === k);
  if (a) selectAppPane(a);
}
