import { MAX_PANES, SNAPSHOT, panes, state } from "../../core/page/state";
import {
  HUE_MAIN, ICONS, MAC, el, gathererNamed, get, harnessBadge, harnessInfo, harnessLogo, harnessName, isShell, key,
  parseKey, post, runnableNames, runsHere, shellOf, shellPath, signature, strokeIcon, taskId,
  taskNumber,
} from "../../core/page/helpers";
import { loadAgent, loadChat, loadHome, setAbout, setLive } from "../page/data";
import { connect } from "../settings/panel";
import { markSeen, statusOf } from "../list/seen";
import {
  APP_ITEM, MANAGER, actorOf, actorTitle, actorsWithin, aimStart, appInfo, appItem, appMarkOf, appShown, appStatusOf,
  appTaskOf, appsKnown, collapsed, crewAt, crewFace, crewHidden, crewHideKey, crewPlace, fileStarted,
  gathererApps, groupCrew, isAppItem, isCoordinator, listDrag, openTask, readApps, renderAgents, retask, savedAs,
  selectApp, setCrewHidden, shellFolder, shellLogo, showItemsTask, startIn, taskActors, taskApps, taskById, taskLead,
  taskMembers, taskName, taskOf, titleOf, within,
} from "../list/list";
import { GF, gfOf } from "../list/gatherer-folders";
import { ALONE_NEW, everyActor } from "../list/group-moves";
import { cardRelease, listMode, select, setListMode } from "../list/modes";
import { drawNewTab, keptHarness, keptStart } from "./new-tab";
import { drawPane } from "../page/main-view";
import { askKey, askWhere } from "../chat/chat";
import { tildePath } from "../../core/page/code";
import { firstLine, plural } from "../../core/format";
import { CHAT_VIEWS, CHAT_VIEW_KEY, chatView, setChatView } from "../chat/views";
import { termOf } from "../terminal/terminal";
import { minRedraw, topChanged } from "./top";
import { allPanes as everyPane, makePane, paneAt, paneBox, paneInfo } from "../page/pane-view";
import { herePane, newPane } from "./pane";
import { appsPlan, besidePlan, clearPlan, closePlan, enterPlan, herePlan, itemsPlan, layOutPlan, onlyPlan, tabPlan } from "./plan";
import { keptToDrop, tabHolding } from "./kept";
import { actorLogo, appAsked, appAskedOf, appRole } from "../apps/app-actors";
import * as model from "./model";
import { shadow } from "./shadow";
import { work as workLayout } from "./work";
import * as appHost from "../apps/host";
import { FILE_FORM, fileHref, filePath, isAppHref, joinPath, matchPath, parseHref } from "../apps/links";
import { PRESSED_AWAY } from "../list/Menus";
import { popShown, showPop, startPops } from "./Pops";
import * as prefs from "../../core/prefs";

// ------------------------------------------------------------------ panes
// Actors side by side. A click in the list shows its actor in the pane in focus; Ctrl+click (⌘+click on a
// Mac, where Ctrl+click is a right click) opens it in a new pane at that one's right, up to MAX_PANES. An actor
// open in a pane already is not opened twice: its pane is focused. A click in a pane focuses it; its × closes
// it; the bar between two resizes them (a double click: all even). The first pane is this page's own (state.selected,
// panes.here); each other is a pane of this page too (features/layout/pane.ts, features/page/pane-view.js's record),
// showing its own actor in its own view, its controls in its head, drawn from the page's one stream and store (connect:
// each pane's actor on it). Kept in this browser while there is more than one; with one, the page is as it always was.
function isAt(sel, g, c) { return !!sel && sel[0] === g && sel[1] === c; }
const allPanes = everyPane;
const actorPanes = () => panes.others;           // every pane is an actor's: apps' panels are in the top row (below)
// The actors open in this page's panes, this page's own first; the one in the pane in focus.
function openActors() { return [...(state.selected ? [state.selected] : []), ...actorPanes().map((p) => [p.g, p.c])]; }
function focusedActor() {
  const p = focusedPane();
  return p === panes.here || !panes.others.includes(p) ? state.selected : [p.g, p.c];
}
function paneSig() { return [state.selected, panes.others.map((p) => [p.g, p.c]), allPanes().indexOf(focusedPane()), appSelected()]; }
// A row of the list clicked: shown in the pane in focus, or (Ctrl/⌘) beside it -- where its task is open, first (viaTabs).
// An actor that is a task of its own (features/layout/panes.js's TASKS), with ⌘/Ctrl: it and its apps beside (openTaskBeside); one in a
// task with others, it alone beside.
async function pick(g, c, ev) {
  const beside = !!(ev && (ev.ctrlKey || ev.metaKey) && !SNAPSHOT);
  if (await viaTabs(taskKey(g, c), ev, c) || !beside) return show(g, c);
  await outOfAppsOnly(g, c);
  const k = taskKey(g, c);
  return k && taskNumber(parseKey(k).id) === null ? openTaskBeside(g, k, c) : openBeside(g, c);
}
function pickBeside(g, c, ev) {
  if (!MAC || !ev.ctrlKey || SNAPSHOT || ev.target.closest(".close-btn, .save-btn")) return;   // a Mac's Ctrl+click: a right click, no click after it
  ev.preventDefault();
  openBeside(g, c);
}
// TASKS: the panels follow the task shown: one of several items (features/list/list.js's TASKS: actors and apps), else an
// item alone, an actor or an app -- the coordinator agent too, as an actor on its own -- a terminal is in none
// (`taskKey` null). An actor shown in the pane in focus (show) of another task than the one shown before: the panes
// beside of the task left are closed (terminals kept), and so are the apps' panels of other tasks (one whose agent is at
// work held out of sight, as closing it does); the new task's actor taken into this page's pane, and its apps' panels
// opened above (openTaskApps). A task of apps only entered (enterAppTask): its apps' panels alone, the actors' panes out
// of sight (`appsOnly`).
const TASK_APPS = 3;                                 // the apps' panels a task opens at most
function taskKey(g, c) {
  if (!g || !c || isShell(c)) return null;
  if (isAppItem(c)) {                                // an app's instance, "app:<id>"
    const t = appTaskOf(g, c.slice(APP_ITEM.length));
    return key(g, t === null ? c : taskId(t));
  }
  const gg = gathererNamed(g);
  const a = gg && gg.agents.find((x) => x.channel === c);
  if (!a) return null;
  const t = taskOf(g, a);                              // in a task with others (features/list/list.js's TASKS): the task's
  return key(g, t === null ? c : taskId(t));
}
// the task an app's panel is of: its instance's
const appPaneTask = (p) => taskKey(p.g, appItem(p.instance.id));
// A TASK OF APPS ONLY shown (its key): the actors' panes out of sight, its apps' panels taking the room; null: none is --
// the layout model's (model.ts's appsOnly)
const appsOnlyKey = () => shadow.layout.appsOnly || null;
function setAppsOnly(k) {
  shadow.update(model.setAppsOnly, k || null);
  const work = document.querySelector(".work");
  if (work) work.classList.toggle("apps-only", !!k);
  placeWork();
}
// THE TASK LAST ENTERED, what the apps opened for it wait on -- the layout model's (model.ts's entered)
const taskNow = () => shadow.layout.entered || null;
const setTaskNow = (k) => shadow.update(model.setEntered, k || null);
// The task entered, and the one whose apps alone show, under the key a change of the tasks gave it (`was` -> `now`).
function rekeyTask(was, now) {
  if (taskNow() === was) setTaskNow(now);
  if (appsOnlyKey() === was) shadow.update(model.setAppsOnly, now);
}
// Each task's LAYOUT, as it was left (the layout model's record of it, `left`: model.ts): its actors' panes, in order, the one in focus,
// the view each shows, and its apps' panels -- with the chat minimized under them or not -- so a task is opened again as
// it was, an actor's pane or an app's panel closed in it staying closed; where each goes, and how wide or tall, its
// arrangement (features/layout/work.ts; made, the first time, from the widths and height an older page kept here). A
// task never left yet opens as a task does at first: its actors not closed side by side, its apps above, the chat not
// minimized. This page's own pane closed by its × (closeHerePane) is not among its actors' panes: its actor, `shut`, is
// the one it opens with out of sight if none of the others was open (openTask).
function rememberTask(key) {
  if (!key) return;
  const sel = focusedActor(), g = parseKey(key).group, its = (pg, c) => pg === g && taskKey(pg, c) === key;
  const shut = isShut() && its(...state.selected) ? state.selected[1] : null;
  const actors = openActors().filter(([pg, c]) => its(pg, c) && c !== shut).map(([, c]) => c);
  const views = {};                                  // each of its actors' panes: the view it shows
  if (state.selected && its(...state.selected)) views[state.selected[1]] = chatView(panes.here).id;
  for (const p of actorPanes()) if (its(p.g, p.c) && p.view) views[p.c] = p.view;
  const apps = panes.apps.filter((p) => !p.held && p.g === g && appPaneTask(p) === key).map((p) => ({ app: p.app.name, id: p.instance.id }));
  const chosen = appSelected(), focusApp = chosen && apps.some((a) => a.id === chosen) ? chosen : null;   // an app selected in it
  const mine = !appsOnlyKey() && sel && sel[1] !== shut && taskKey(sel[0], sel[1]) === key;
  const left = { actors: appsOnlyKey() ? [] : actors, focus: mine ? sel[1] : appsOnlyKey() ? null : actors[0] || null, focusApp, apps,
    views: appsOnlyKey() ? {} : views, shut: appsOnlyKey() ? null : shut };
  shadow.update(model.remember, key, left, Date.now());   // (the layout model's record of it: model.ts)
  shadow.persist();
}
const taskLayout = (key) => shadow.now().tasks[key]?.left || null;
// Actor `c` closed from the list (closedInTabs): out of task `key` as it was left -- not opened with it again
function forgetActor(key, c) {
  shadow.update(model.forgetActor, key, c);
  shadow.persist();
}
// The actor `c` of `g` about to be shown in the pane in focus (show): of another task than the one shown, the one left
// remembered (rememberTask: only one laid out in this page -- one shown by chance as the page opened, its apps never
// opened, would be remembered as having none), its panes closed (terminals kept) and its apps' panels (one attached to
// none kept: no task's; one whose agent is at work held out of sight, as closing it does), the new task's actor taken
// into this page's pane and its apps' panels opened above (openTaskApps) -- each pane minimized or not as its task's
// arrangement keeps it -> `view`, the view `c` showed then (not open already), and `after`, what
// to do once `c` is shown: the rest of its actors' panes opened beside it, as the task was left, or, never left, every
// one not closed (its lead first). The same task: nothing to do -- but, never laid out in this page, laid out now, adding
// to what is open.
function enterTask(g, c) {
  if (SNAPSHOT) return null;
  const to = taskKey(g, c), sel = focusedActor();
  const from = appsOnlyKey() || (sel && taskKey(sel[0], sel[1])) || (state.selected && taskKey(...state.selected));
  if (to) setTaskNow(to);
  if (to && from !== to) shadow.update(model.open, to);   // the layout model beside the page (shadow.ts)
  if (!to || !sel) return null;
  const was = taskLayout(to), open = openActors().some((s) => isAt(s, g, c));
  if (from === to) {
    if (tasksLaidOut.has(to)) return null;           // shown, laid out: as it is
    // shown by chance (the page opened on it), never laid out in this page: laid out now, adding to what is open
  } else {
    // one never laid out here (its apps never opened) is not remembered, nor one out of sight (an empty tab's, kept as it
    // was when that tab was left) -- but one whose actor's pane the reader closed is (its apps shown still, or not)
    if (tasksLaidOut.has(from) && (!isAway() || isShut())) rememberTask(from);
    renderLayout(enterPlan(openNow(), to));          // the others' panels closed (features/layout/plan.ts's enterPlan)
  }
  tasksLaidOut.add(to);
  taskAppsOpening = openTaskApps(g, c, to, was ? was.apps : null);   // (each pane minimized as it was: its arrangement)
  const view = !open && from !== to && was && was.views ? was.views[c] || null : null;
  return { view, after: () => layOutTask(g, to, c, was ? was.actors : taskOrder(g, to), was) };
}
let taskAppsOpening = Promise.resolve();            // the apps' panels the task last entered opens (openTaskApps): waited on
// A task of apps only entered (`k`: its key; an app alone, or a task holding no actor): the task left remembered, its
// actors' panes closed (terminals kept) and the rest out of sight (setAppsOnly), the apps' panels of other tasks closed,
// its own opened above -- as it was left, else all of them (openTaskApps)
function enterAppTask(g, k) {
  if (SNAPSHOT) return;
  const sel = focusedActor(), from = appsOnlyKey() || (sel && taskKey(sel[0], sel[1]));
  if (from === k) return;
  shadow.update(model.open, k);                 // (the layout model beside the page: shadow.ts)
  if (from && tasksLaidOut.has(from) && (!isAway() || isShut())) rememberTask(from);
  setTaskNow(k);
  tasksLaidOut.add(k);
  const was = taskLayout(k), gg = gathererNamed(g);
  // its apps the page knows, opened with it (features/layout/plan.ts's appsPlan); the rest once read (openTaskApps)
  const known = gg ? taskAppsFound(g, gg, null, k, was ? was.apps : null).found.filter((a) => a.inst) : [];
  for (const a of known) instCache.set(a.id, a.inst);
  renderLayout(appsPlan(openNow(), k, known.map((a) => ({ app: a.app, id: a.id, g, ...(+a.size > 0 ? { size: +a.size } : {}) }))));
  taskAppsOpening = openTaskApps(g, null, k, was ? was.apps : null);   // as it was left
}
// The tasks laid out in this page (entered, or opened at first by openTask): a task shown, laid out, stays as it is -- the
// layout model's (model.ts's laidOut), read and written as a set (the list's openTask too)
const tasksLaidOut = Object.freeze({
  has: (k) => model.isLaidOut(shadow.layout, k),
  add: (k) => shadow.update(model.layOut, k, true),
  delete: (k) => shadow.update(model.layOut, k, false),
});
// a task's actors `rest`, not closed, opened beside `c` (shown), as many as there is room for -- each in the view it showed
// when the task was left (`was`); `c` in focus after
function layOutTask(g, to, c, rest, was = null) {
  const gg = gathererNamed(g);
  const open = (ch) => { const a = gg && gg.agents.find((x) => x.channel === ch); return a && statusOf(a)[0] !== "closed" && taskKey(g, ch) === to; };
  tasksLaidOut.add(to);
  renderLayout(layOutPlan(openNow(), g, c, rest.filter(open), (was && was.views) || {}, MAX_PANES));   // (features/layout/plan.ts)
}
// A task opened BESIDE the one shown (⌘/Ctrl+click on it): nothing of the one shown closed -- its actors not closed, as it
// was left (else its lead first; `first`, first), in panes beside the one in focus, as many as there is room for, and its
// apps' panels added above (openTaskApps, `beside`); `first`'s pane in focus after.
async function openTaskBeside(g, key, first) {
  shadow.update(model.open, key, true);
  const gg = gathererNamed(g), was = taskLayout(key);
  tasksLaidOut.add(key);
  const open = (ch) => { const a = gg && gg.agents.find((x) => x.channel === ch); return a && statusOf(a)[0] !== "closed" && taskKey(g, ch) === key; };
  const order = [first, ...(was ? was.actors : taskOrder(g, key))].filter((ch, i, all) => ch && all.indexOf(ch) === i && open(ch));
  const found = taskAppsFound(g, gg, first, key, was ? was.apps : null).found;
  for (const a of found) if (a.inst) instCache.set(a.id, a.inst);
  const facts = { key, g, first: order[0] || null, rest: order.slice(1), shut: false, views: (was && was.views) || {},
    apps: found.map((a) => ({ app: a.app, id: a.id, g, ...(+a.size > 0 ? { size: +a.size } : {}) })), back: null, focusApp: null,
    mine: false };
  const plan = besidePlan(openNow(), facts, MAX_PANES);   // (features/layout/plan.ts)
  await renderLayout(plan);
  if (plan.left) paneNote(`${plural(plan.left, "actor")} of the task not opened. At most ${MAX_PANES} fit side by side.`);
  await openTaskApps(g, first, key, was ? was.apps : null, true);   // its apps the page did not know, once read
  const p = actorPanes().find((q) => isAt([q.g, q.c], g, first));
  if (p) focusPane(p);
}
// An actor opened beside a task of apps alone (⌘+click): this page's own pane, out of sight while apps alone show, in
// sight again with `c` in it -- the apps kept, beside (features/layout/plan.ts's besidePlan, of `c` alone)
async function outOfAppsOnly(g, c) {
  if (!appsOnlyKey() || !c) return;
  await renderLayout(besidePlan(openNow(), { key: "", g, first: c, rest: [], shut: false, views: {}, apps: [], back: null,
    focusApp: null, mine: false }, MAX_PANES));
}
// a task's actors not closed, as it opens at first: its lead first (features/list/list.js's taskActors)
function taskOrder(g, key) {
  const gg = gathererNamed(g), id = parseKey(key).id;
  return gg && taskNumber(id) !== null ? taskActors(gg, taskNumber(id)).map((a) => a.channel) : [];
}
// The apps' panels of a task -- its apps (features/list/list.js's taskApps), as the host has them now; an app alone, it -- up
// to TASK_APPS, not open already; `only`, the task's layout as it was left (rememberTask): those of them it had open alone.
// Those whose instance the page knows open at once, in the same frame as the rest of the task entered (its actor shown,
// the task left's panels closed): waited for the server's apps, the work area was drawn a frame without them at each
// switch between tasks with apps -- the Chat its whole height, its actor done large, then short again: a flicker. The
// server's apps read then, the rest opened, as the host has them now; one opened at once, its app closed since, closed.
async function openTaskApps(g, c, to, only = null, beside = false) {
  const gg = gathererNamed(g);
  if (!gg) return;
  let found;
  ({ to, found } = taskAppsFound(g, gg, c, to, only));
  if (!beside && taskNow() !== to) return;
  const early = found.filter((k) => k.inst);
  for (const k of early) wantTaskApp(k, g);
  if (early.length) renderApps();
  await readApps(g, true);
  if (!beside && taskNow() !== to) return;           // another task entered meanwhile: its apps are wanted, not these
  const open = new Set(((appsKnown.get(g) || {}).instances || []).map((i) => i.id));
  const gone = early.filter((k) => !open.has(k.id)).map((k) => k.id);   // closed since
  if (gone.length) shadow.update(model.unwantApps, (w) => gone.includes(w.instance));
  for (const k of taskAppsFound(g, gg, c, to, only).found) if (open.has(k.id)) wantTaskApp(k, g);   // (open still; made one
  // task with others since: that one's)
  renderApps();
}
// A task's apps to open (openTaskApps), as the page has them now: {to, the task `to` is now (an actor or app alone, made one
// task with others since: that one's), found, its apps -- `only`, those of them -- up to TASK_APPS, in that order, each
// once: {app, id, size?, inst (its instance; one the page does not know open: none)}}
function taskAppsFound(g, gg, c, to, only) {
  const item = c || parseKey(to).id, now = taskKey(g, item);
  if (now && now !== to && taskNumber(parseKey(to).id) === null) {   // made one task with others since: that one's
    rekeyTask(to, now);
    tasksLaidOut.add(now);
    to = now;
  }
  const found = [];
  const add = (k) => { if (appHost.named(k.app) && !found.some((f) => f.id === k.id)) found.push(k); };
  const id = parseKey(to).id;
  const mine = taskNumber(id) !== null ? taskApps(gg, taskNumber(id))
    : isAppItem(id) ? [appInfo(g, id.slice(APP_ITEM.length))].filter(Boolean) : [];
  const known = (o) => (mine.find((m) => m.id === o.id) || [appInfo(g, o.id)].find((m) => m && m.app.name === o.app) || {}).inst;
  if (only) for (const o of only) add({ ...o, inst: known(o) });   // as it was left
  else for (const o of mine) add({ app: o.app.name, id: o.id, inst: o.inst });
  return { to, found: found.slice(0, TASK_APPS) };
}
// The actor in the pane in focus -- in `view`, if given; one open already, its pane focused instead. Of another task than
// the one shown: the panels changed for it first (enterTask), and the rest of its task laid out beside it, its pane in
// focus, as soon as it is in its pane -- not once what it shows (its Chat) has loaded: a click meanwhile (an app
// selected, another pane) would lose its focus to it. `wait` false: done then, its Chat loading still. `shut`: its pane
// closed by the reader when its task was left (rememberTask), shown out of sight, as it was, the task's apps beside.
async function show(g, c, view = null, wait = true, shut = false) {
  if (shut) putAway([g, c], true);                   // (out of sight once it is the one in this page's pane)
  else if (isAt(awayOf(), g, c)) {                  // asked for: in sight again (and in its task's tab shown)
    backInSight();
    const k = taskKey(g, c);
    if (k) shadow.update(model.open, k, true);
  }
  const entered = enterTask(g, c);
  const shown = await showIn(g, c, view || (entered && entered.view) || null, false);
  if (entered) entered.after();
  if (wait && shown) await shown.loading;
}
// `c` shown in the pane in focus, or its own pane focused: what it shows (its Chat) loaded first -- `wait` false, not
// waited on: then {loading}, the load under way, if one is
async function showIn(g, c, view = null, wait = true) {
  const there = actorPanes().find((p) => isAt([p.g, p.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null);
  if (there) showActorsApp(g, c);                    // shown already: its app's panel, closed since, opened again
  const p = there || focusedPane();
  if (p !== panes.here) {
    focusPane(p);
    if (!there) { retarget(p, g, c); p.view = view || p.view; savePanes(); connect(); renderAgents(); paneGiven(p); }
    else if (view) setChatView(p, view);
    return null;
  }
  focusPane(panes.here);
  let loading = null;
  if (there) { if (view) loading = setChatView(panes.here, view); }
  else { if (view) setViewHere(view); loading = select(g, c); }
  if (!loading) return null;
  if (wait) { await loading; return null; }
  loading.catch(() => {});
  return { loading };
}
function setViewHere(id) {
  panes.here.view = id;
  prefs.setText(CHAT_VIEW_KEY, id);
}
function openBeside(g, c, view = null) {
  if (SNAPSHOT || !state.selected) return show(g, c, view);
  const there = actorPanes().find((p) => isAt([p.g, p.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null);
  if (there) return focusPane(there);
  if (allPanes().length >= MAX_PANES) return paneNote(`At most ${MAX_PANES} actors fit side by side. Close one to open another.`);
  const bk = taskKey(g, c);
  if (bk) shadow.update(model.open, bk, true);
  const from = focusedPane(), at = from === panes.here ? 0 : panes.others.indexOf(from) + 1;
  shadow.update(model.wantPane, { g, c, view: view || from.view, size: 1 }, at);
  renderPanes();
  focusPane(actorPanes().find((p) => isAt([p.g, p.c], g, c)));
}
// A pane of its own for an actor (features/layout/pane.ts), put at `at` among the others, and drawn: its actor's calls
// and view loaded from the page's own (its stream: connect). Nothing else on the page is moved: an app's frame moved is
// a frame loaded again.
function addPane(g, c, view, at, size = 1) {
  const p = makePane(newPane(), false, { g, c, view, size });
  p.close.addEventListener("click", () => { workClosed(p.node); closePane(p); });
  p.node.addEventListener("pointerdown", () => focusPane(p), true);
  p.top.draggable = true;                            // dragged by its head (MOVE_FROM)
  watchTop(p.head, p);
  document.getElementById("panes").insertBefore(p.node, panes.others[at] ? panes.others[at].node : null);
  panes.others.splice(at, 0, p);
  paneGiven(p);
  return p;
}
// Pane `p` given its actor (opened, or another actor shown in it): what it shows of the last let go of, its view drawn
// at once ("Loading…" till what it shows has come), then its actor's calls and view loaded and drawn.
async function paneGiven(p) {
  Object.assign(p, { agent: null, agentVersion: (p.agentVersion || 0) + 1, files: null, chatSend: async () => false });
  p.drawn.who = null;
  drawPane(p);
  drawWho(p);
  const at = [p.g, p.c];
  await Promise.all([loadAgent(p).catch(() => { p.agent = null; }), loadChat(p)]);
  if (panes.others.includes(p) && isAt(at, p.g, p.c)) drawPane(p, true);
}
// the layout model told task `k` is closed here once none of its panels is left (shadow.ts)
function shadowGone(k) {
  if (k && !shownPanels().some((s) => s.key === k)) shadow.update(model.closeHere, k);
}
// THE PANES BESIDE this page's own follow the layout model's `panes.others` (model.ts): what opens or closes one says so to
// the model (openBeside, closePane, closeHere) and renderPanes makes them match -- each wanted one opened at its place
// (its frame loaded), each open one no longer wanted gone. (This page's own pane is state.selected's.)
const wantedPanes = () => ((shadow.layout.panes || {}).others || []);
function renderPanes() {
  if (SNAPSHOT) return;
  const want = wantedPanes();
  let changed = false;
  for (const p of [...panes.others]) if (!want.some((o) => isAt([o.g, o.c], p.g, p.c))) { dropPane(p); changed = true; }
  want.forEach((o, i) => {
    if (panes.others.some((p) => isAt([p.g, p.c], o.g, o.c))) return;
    addPane(o.g, o.c, o.view, Math.min(i, panes.others.length), +o.size || 1);
    changed = true;
  });
  if (changed) { layout(); savePanes(); connect(); if (state.home) renderAgents(); }
}
// its frame gone (its page, and its terminal's stream; the session stays); the focus, if it had it, to the pane before
function dropPane(p, gone = true) {
  const i = panes.others.indexOf(p);
  if (i < 0) return;
  if (gone) queueMicrotask(() => shadowGone(state.home ? taskKey(p.g, p.c) : null));
  panes.others.splice(i, 1);
  p.node.remove();
  if (p.watch) p.watch.disconnect();
  topRow(p, null);
  if (focusedPane() === p) focusPane(panes.others[i - 1] || panes.here);
}
// an actor's pane closed (its ×, its task left, a tab cleared): no longer wanted
function closePane(p) {
  if (!panes.others.includes(p)) return;
  shadow.update(model.unwantPanes, (o) => isAt([o.g, o.c], p.g, p.c));
  renderPanes();
}
// This page's own pane closed: the next pane's actor (`next`) -- and view -- moves into it, its frame gone.
async function closeHere() {
  if (!actorPanes().length) return;
  return renderLayout(herePlan(openNow()));         // (features/layout/plan.ts's herePlan: the next pane's actor in it)
}
// This page's own pane closed by its × -- its head's, its Chat bar's, its minimized box's -- as an app's panel's × closes
// it: out of its task's tab shown (workClosed); the next pane's actor moved into it, or, none, it out of sight (away) and
// what else is shown taking its room (nothing: the tab's new-tab page) -- an app of its task selected. Its actor, or
// terminal, goes on; a click on it in the list shows it again. Its task remembered so (rememberTask's `shut`): left and
// opened again, its apps alone. At a phone's width, none placed, there is nothing to show instead: it stays.
async function closeHerePane() {
  if (!state.selected || isAway()) return;
  const hk = taskKey(...state.selected);
  queueMicrotask(() => shadowGone(hk));
  if (actorPanes().length) { workClosed(panes.here.node); return closeHere(); }
  if (NARROW.matches) return;
  workClosed(panes.here.node);
  const k = taskKey(...state.selected);
  renderLayout(herePlan(openNow()));                 // out of sight, closed by the reader; an app of its task selected
  if (k && tasksLaidOut.has(k)) rememberTask(k);
}
// An actor's pane focused: the app selected, if one was, no longer (selectAppPane)
function focusPane(p) {
  if (!p) return;
  const had = appSelected(), same = focusedPane() === p;
  shadow.update(model.focusOn, paneKey(p), true);    // (the app selected, if one was, no longer)
  if (had) markSelected();
  if (same) { if (had && state.home) renderAgents(); return; }
  for (const q of allPanes()) q.node.classList.toggle("focused", q === p);
  savePanes();
  appsSelected();
  if (state.home) renderAgents();
}
// The APP SELECTED (its instance's id): as an actor's pane is focused, one thing at a time, an app or an actor -- its panel
// marked as a focused pane is (.focused), the actors' panes not while it is; its line in the list filled. Selected by a
// click on it in the list or a task's card (features/list/list.js's selectApp), a press on its panel's head, or the focus going
// into its frame; an actor's pane focused (focusPane: a press in it, an actor shown) ends it.
// FOCUS is the layout model's (model.ts's focus and lastActor: one item, an actor's or an app's, and the actor last in
// focus): the pane focused is the one showing that actor (none: this page's own), the app selected the one focus names.
const paneKey = (p) => (p === panes.here ? (state.selected ? key(state.selected[0], state.selected[1]) : null) : key(p.g, p.c));
function focusedPane() {
  const k = shadow.layout.lastActor;
  return (k && allPanes().find((p) => paneKey(p) === k)) || panes.here;
}
function appSelected() {
  const f = shadow.layout.focus, id = f ? parseKey(f).id : null;
  if (!id || !isAppItem(id)) return null;
  const inst = id.slice(APP_ITEM.length);
  return panes.apps.some((p) => !p.held && p.instance.id === inst) ? inst : null;
}
// pane `p` showing actor `c` of `g` in place of its own: focus goes with it, if it had it
function retarget(p, g, c) {
  const had = focusedPane() === p;
  shadow.update(model.retargetPane, p.g, p.c, { g, c });
  p.g = g; p.c = c;
  if (had) shadow.update(model.focusOn, key(g, c), true);
}
function markSelected() {
  const sel = appSelected();
  for (const q of panes.apps) q.node.classList.toggle("focused", !!sel && q.instance.id === sel);
  for (const q of allPanes()) q.node.classList.toggle("focused", !sel && q === focusedPane());
}
// an app's panel gone (closed, held out of sight, its app closed): no longer selected, the focused actor's pane marked again
function unselectApp(id) {
  const f = shadow.layout.focus;
  if (!f || parseKey(f).id !== appItem(id)) return;
  shadow.update(model.unfocus, f);
  markSelected();
}
function selectAppPane(p) {
  if (!p || p.held) return;
  shadow.update(model.focusOn, key(p.instance.gatherer, appItem(p.instance.id)), false);
  markSelected();
  if (state.home) renderAgents();
}
// the task of what is selected: the selected app's, else the task of apps only shown, else the focused actor's
function selectedTask() {
  const sel = appSelected(), p = sel && panes.apps.find((q) => q.instance.id === sel);
  if (p) return appPaneTask(p);
  if (appsOnlyKey()) return appsOnlyKey();
  const f = focusedActor();
  return f && !(focusedPane() === panes.here && isAway()) ? taskKey(f[0], f[1]) : null;   // (this page's own out of sight: none)
}
// A press this page never hears -- in an app's panel (its `pressed`), a native page of
// the ag app (agApp.onPressed), the focus gone into a frame: what floats over the page and closes on a press elsewhere
// (Settings, a row's drop-down, the branch drop-down, History's types) closed, as such a press on the page closes it.
function pressedAway() {
  setAbout(false);
  closePop();
  brMenuClose();
  dispatchEvent(new Event(PRESSED_AWAY));            // the list's own drop-downs (features/list/Menus.tsx)
  const types = document.getElementById("hist-types");
  if (types && types.open) types.open = false;
}
// The panes' widths (each its share, `size`), which is in focus, and whether the page is split at all: split,
// each pane's head says whose it is, and has its ×. Placed so (placeWork).
function layout() {
  const split = panes.others.length > 0;
  document.getElementById("panes").classList.toggle("split", split);
  for (const p of allPanes()) { p.node.style.flexGrow = split ? String(p.size) : ""; p.node.classList.toggle("focused", p === focusedPane() && !appSelected()); }
  placeWork();
  for (const p of allPanes()) { p.drawn.who = null; drawWho(p); }
}
// ------------------------------------------------------------------ the work area placed
// The panels shown, as the work area arranges them (features/layout/work.ts): each task shown a block of its own, side by
// side, laid out as the reader arranged it (kept per task in this browser) -- at first its apps' panels side by side
// above its actors' panes side by side -- the chat minimized under the apps only as tall as their message boxes; a task
// of apps only shown (appsOnly), its apps alone. A pane's head (or its Chat bar's grip, the head put there) or an app's
// panel's head dragged moves it beside another panel of its task, or into its place; right-clicked, a menu does. None
// placed at a phone's width: the stylesheet lays them out, one under another.
let workPlacer = null;
// The panels shown, in order -- this page's own pane, the others, the apps' panels -- each with its task's key (null: a
// terminal, the gatherer's agent, the page with no actor, or any panel before the home has come and says what tasks
// there are: a block of its own, kept nowhere) and its item there.
// This page's own pane AWAY: its actor not in its task's tab shown (none of the tab's to show in it instead: TASK TABS),
// out of sight till it shows another, or the reader asks for that one (show).
// CLOSED by the reader (its ×: closeHerePane), and not by a tab that leaves it out: its task, left and opened again, shows
// what else of it was shown, without it (rememberTask's `shut`)
// -- the layout model's (model.ts's away)
const awayOf = () => { const a = shadow.layout.away; return a ? [a.g, a.c] : null; };
function putAway(sel, closed = false) { shadow.update(model.setAway, sel ? [sel[0], sel[1]] : null, closed); }
// this page's own pane in sight again: its actor looked at now (features/list/seen.js), the list and the tabs' marks drawn so
function backInSight() { shadow.update(model.setAway, null); markSeen(); if (state.home) renderAgents(); }
const isAway = () => { const a = shadow.layout.away; return !!a && isAt(state.selected, a.g, a.c); };
const isShut = () => !!(shadow.layout.away && shadow.layout.away.shut) && isAway();
// No actor to show in it at all (none yet), the home come: out of sight too -- the tab, showing nothing, shows its
// new-tab page (features/layout/new-tab.js), not this pane's "No actors yet".
function shownPanels() {
  const known = !!state.home, out = [], actor = (g, c, node) => out.push({ key: known ? taskKey(g, c) : null, item: c, node, app: false });
  const none = known && !state.selected && !!workPlacer;
  panes.here.node.classList.toggle("lay-away", isAway() || none);
  if (!appsOnlyKey()) {
    if (state.selected && isAway()) { /* out of sight */ }
    else if (state.selected) actor(state.selected[0], state.selected[1], panes.here.node);
    else if (!none) out.push({ key: null, item: "here", node: panes.here.node, app: false });
    for (const p of actorPanes()) actor(p.g, p.c, p.node);
  }
  for (const p of panes.apps) if (!p.held) out.push({ key: known ? appPaneTask(p) : null, item: appItem(p.instance.id), node: p.node, app: true });
  return out;
}
let placedFor = "";
const shownSig = () => JSON.stringify([isAway(), shownPanels().map((s) => [s.key, s.item])]);
// (a failure placing them breaks nothing that called it -- a panel being opened, the panels kept being restored: thrown
// again on its own)
function placeWork() {
  if (!workPlacer) return;
  try { placedFor = shownSig(); workPlacer.place(); } catch (e) { setTimeout(() => { throw e; }, 0); }
  noteOpen();
}
// the items open as placed, by task, kept in the layout model (model.ts's noteOpen): what a task held, read after it
// changes (keysNow)
function noteOpen() {
  if (!state.home) return;
  const byTask = {}, shown = shownPanels();
  for (const s of shown) if (s.key) (byTask[s.key] = byTask[s.key] || []).push(s.item);
  shadow.update(model.noteOpen, byTask, shown.map((s) => s.item));
}
// placed again only if what it shows changed since (an actor shown in this page's own pane, one put in a task): each draw
function placeIfShown() { if (workPlacer && shownSig() !== placedFor) placeWork(); }
function startPlacing() {
  if (SNAPSHOT || workPlacer) return;
  const work = document.querySelector(".work");
  workPlacer = workLayout(work, { shown: shownPanels, narrow: () => NARROW.matches,
    old: (k) => taskLayout(k), known: () => !!state.home, label: blockName, open: openDropped, minChanged: paneMinimized,
    focus: selectedTask, enter: enterTasks, status: taskStates, showItems: showTaskItems, lead: taskLeadOf, canon: keyNow,
    clear: clearWork, remember: (keys) => { for (const k of keys) if (tasksLaidOut.has(k)) rememberTask(k); },
    faces: blockFaces, about: blockAbout, look: cellLook, closeTask: closeTaskHere, openBeside: openTaskHereBeside, listed: () => { sweepKept(); if (state.home) renderAgents(); },
    blank: drawNewTab });                            // a tab showing nothing: its new-tab page (features/layout/new-tab.js)
  NARROW.addEventListener("change", placeWork);
  // a task's row dragged from the list over the work area (features/list/list.js's listDrag): one open in no tab, opened beside
  // the tasks shown, on the side of the one it is dropped on
  work.addEventListener("dragenter", () => {
    const k = listDrag && !listDrag.offered ? draggedTask() : null;
    if (k && workPlacer.offer(k)) listDrag.offered = true;
  });
  placeWork();
}
// SCREEN TABS (features/layout/tabs.ts). A task is OPEN where any of its items is shown: in the tab shown, or in another.
// A click in the list on an item (`item`, if one) of task `k` -- `ev`, the click; a notification's, a link's, an actor
// started, as a plain click: {} -- goes where the task is, before it is shown as the click shows it:
// - plain: the task open in the tab shown, its panel in focus (the tab of its own tabs holding `item` shown); open in
//   another tab, that tab shown; open nowhere, a new tab for it (the tab shown, if it shows nothing);
// - ⌥: the tab shown made the task's alone -- the task out of any other tab, the tab's other tasks closed (onlyTask), or,
//   it not shown here, replaced by it;
// - ⌘/Ctrl: open in another tab, that tab shown; else opened beside, as before. Shift: selected, nothing here.
// The actor the page opened on by itself, nothing kept to show (features/settings/panel.js), counts as nothing shown: the first click
// on another task shows it in its place, not in a new tab.
// True: the task now shown where the click goes on as a plain one (⌘ having brought its tab forward).
// The task of the actor the page opened on by itself -- the layout model's (model.ts's auto) -- set where it is opened
// (features/page/data.js's refresh, features/settings/panel.js's restore).
const autoShown = () => shadow.layout.auto || null;
const setAutoShown = (k) => {
  shadow.update(model.setAuto, k || null);
  if (k) shadow.update(model.opened, k);       // (shown by itself: state.selected set)
};
async function viaTabs(k, ev, item = null) {
  if (!workPlacer || !k || !ev || ev.inTabs || SNAPSHOT || ev.shiftKey) return false;
  const tabs = workPlacer.tabs;
  if (tabs.busy()) await tabs.settled();             // a tab still being shown (its panes opened one by one): once it is
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
// The page opened, the home come: the tab shown's tasks shown as it was left (tabs.ts's start), in place of what the page
// opened on by itself (the first actor; with one pane, the page keeps none) -- once
let tabsStarted = false;
async function startTabs() {
  if (tabsStarted || !workPlacer || !state.home || SNAPSHOT) return;
  tabsStarted = true;
  if (await workPlacer.tabs.start()) setAutoShown(null);
}
// Task `k`'s panel in focus, if one is shown: its actor's pane (this page's own first), else its app's panel selected
function focusTask(k) {
  if (!k || selectedTask() === k) return;
  const mine = (g, c) => taskKey(g, c) === k;
  if (!appsOnlyKey() && state.selected && !isAway() && mine(...state.selected)) return focusPane(panes.here);
  const p = actorPanes().find((q) => mine(q.g, q.c));
  if (p) return focusPane(p);
  const a = panes.apps.find((q) => !q.held && appPaneTask(q) === k);
  if (a) selectAppPane(a);
}
// The tab shown left with task `k` alone (⌥+click on it while others show): the others kept as they are (rememberTask),
// their panes and panels closed (terminals kept) -- this page's own pane given one of k's actors if it showed another's,
// or, k of apps alone, the actors' panes out of sight (enterAppTask)
async function onlyTask(k) {
  shadow.update(model.open, k);                 // (the layout model: this task alone in the tab shown)
  const others = [...new Set(shownPanels().map((s) => s.key))].filter((x) => x && x !== k);
  if (!others.length) return;
  for (const o of others) if (tasksLaidOut.has(o)) rememberTask(o);
  const plan = onlyPlan(openNow(), k), apps = plan.appsOnly === k && appsOnlyKey() !== k;   // (features/layout/plan.ts)
  if (apps) { setTaskNow(k); tasksLaidOut.add(k); }
  renderLayout(plan);
  if (apps) taskAppsOpening = openTaskApps(parseKey(k).group, null, k, (taskLayout(k) || {}).apps || null);   // as it was left
}
// A task of a screen tab dragged into the tab shown (features/layout/work.ts's mergeTab): opened beside the tasks shown,
// as ⌘+click opens one -- not routed, its tab gone from the bar
async function openTaskHereBeside(k) {
  const { group: g, id } = parseKey(k), gg = gathererNamed(g);
  if (!gg || id === undefined) return;
  if (taskNumber(id) !== null) {
    const t = taskNumber(id);
    if (!taskById(g, t)) return;
    if (!taskLead(gg, t)) return openTaskApps(g, null, k, (taskLayout(k) || {}).apps || null, true);   // apps alone
    return openTask(g, t, null, { metaKey: true, inTabs: true });
  }
  if (isAppItem(id)) { if (appInfo(g, id.slice(APP_ITEM.length))) await openTaskApps(g, null, k, null, true); return; }
  if (gg.agents.some((a) => a.channel === id)) await openTaskBeside(g, k, id);
}
// A task CLOSED HERE (its card head's ×, or moved to another tab): kept as it is now (rememberTask), its panes and panels
// closed -- its agents go on -- this page's own pane given the next pane's actor if it showed one of k's, else out of
// sight (the tab showing nothing else: its note says so); the focus, if it was k's, on the next task shown
// (features/layout/plan.ts's closePlan, rendered)
async function closeTaskHere(k) {
  shadow.update(model.closeHere, k);
  if (tasksLaidOut.has(k)) rememberTask(k);
  renderLayout(closePlan(openNow(), k));
  if (taskNow() === k) setTaskNow(null);
}
// An item CLOSED FROM THE LIST -- an actor, an app: its row's ×, its rail tile's, its task's card's -- or a whole task (its
// row's ×: no `item`), task `k`'s: closed in the screen tabs too, before it is closed itself, as there a tab's × or a
// panel's would. A task of its own (a lone actor, a lone app), or the whole task, out of the tab holding it (tabs.ts's
// `closed`): that tab closed if it held nothing else (the tab shown: the next shown; the only one, emptied), else the task
// out of it -- the tab shown's, its panels closed here, as its card head's × does (closeTaskHere). An actor of a task with
// others: its pane closed, as its pane's × does (closeHerePane: this page's own), and left out of its task as kept for
// another tab (forgetActor); an app of one: its panel closed with it (features/list/list.js's closeApp).
async function closedInTabs(k, item = null) {
  if (!workPlacer || !k || SNAPSHOT) return;
  const { group: g, id } = parseKey(k);
  if (item === null || id === item) return workPlacer.tabs.closed(k, () => closeTaskHere(k));
  if (isAppItem(item)) return;
  for (const p of [...actorPanes()]) if (isAt([p.g, p.c], g, item)) { workClosed(p.node); closePane(p); }
  if (isAt(state.selected, g, item) && !isAway()) await closeHerePane();
  forgetActor(k, item);
}
// A new tab, empty ("+" on the tabs' bar): the tasks shown kept as they are (the tab left keeps them: hooks.remember),
// their panes and panels closed (terminals kept), this page's own pane out of sight till a task is opened in it
// (features/layout/plan.ts's clearPlan, rendered)
async function clearWork() {
  renderLayout(clearPlan(openNow()));
  setTaskNow(null);
}
// What is open now, as a plan reads it (features/layout/plan.ts's Open): this page's own pane's actor (none, out of
// sight), the panes beside it (each kept if `keep` says so of its task, and terminals) and the apps' panels shown, each
// with its task; the task of apps alone shown, and the task in focus.
function openNow(keep = () => false) {
  const t = (g, c) => (state.home ? taskKey(g, c) : null);
  return {
    here: state.selected && !isAway() ? { g: state.selected[0], c: state.selected[1], task: t(...state.selected) } : null,
    view: panes.here.view,
    others: actorPanes().map((p) => ({ g: p.g, c: p.c, view: p.view || null, size: p.size, task: t(p.g, p.c),
      keep: isShell(p.c) || keep(t(p.g, p.c)) })),
    apps: panes.apps.filter((p) => !p.held).map((p) => ({ app: p.app.name, id: p.instance.id, g: p.instance.gatherer, size: p.size,
      task: state.home ? appPaneTask(p) : null })),
    appsOnly: appsOnlyKey(), focus: selectedTask(),
    away: state.selected && isAway() ? { g: state.selected[0], c: state.selected[1], task: t(...state.selected) } : null,
    at: panes.others.indexOf(focusedPane()),
  };
}
// A TAB SHOWN: its tasks in place of those shown, each as it was left -- worked out at once (features/layout/plan.ts's
// tabPlan: the first with an actor in this page's own pane, its other actors beside it, each other task beside them, those
// of apps alone last, terminals kept; `focus` in focus after), the model made so and the page made to match it
// (renderLayout), not waiting on what each pane loads to show (a Chat at times slow): a click while a tab is shown waits
// for this (viaTabs). The apps the page does not know yet opened once read, if the tab is still the one shown.
let entering = null;
async function enterTasks(keys, focus) {
  const all = [focus, ...keys].filter((k, i, them) => k && them.indexOf(k) === i);
  // an app's among them: its group's apps read first -- a tab shown at a reload, before the page read them, would skip
  // its app's task (unknown), its panel then restored beside the actor the page opened on (restoreAppPanes)
  const groups = [...new Set(all.map((k) => parseKey(k).group).filter(Boolean))];
  if (all.some((k) => isAppItem(parseKey(k).id || "")) && groups.some((g) => !appsKnown.has(g))) {
    await appHost.load();
    await Promise.all(groups.map((g) => readApps(g, true)));
  }
  const mine = entering = {};
  const facts = all.map(taskFacts).filter(Boolean), keys2 = new Set(facts.map((f) => f.key));
  const plan = tabPlan(facts, focus, openNow((k) => keys2.has(k)), MAX_PANES);
  renderLayout(plan, facts.length && facts[0].first && facts[0].mine);
  if (plan.left) paneNote(`${plural(plan.left, "actor")} of the task not opened. At most ${MAX_PANES} fit side by side.`);
  await Promise.all(groups.map((g) => readApps(g, true).catch(() => {})));   // the apps as the server has them now
  if (entering !== mine) return;                     // another tab shown meanwhile
  const open = new Set(groups.flatMap((g) => ((appsKnown.get(g) || {}).instances || []).map((i) => i.id)));
  const known = facts.flatMap((f) => f.apps.map((a) => a.id));
  const gone = known.filter((id) => !open.has(id));
  if (gone.length) shadow.update(model.unwantApps, (w) => gone.includes(w.instance));
  for (const k of plan.order) {
    const f = taskFacts(k);
    if (f) for (const a of f.apps) if (open.has(a.id)) wantTaskApp({ ...a, inst: instCache.get(a.id) }, parseKey(k).group);
  }
  renderApps();
  if (plan.focus && plan.focus.app) { const p = panes.apps.find((q) => !q.held && q.instance.id === plan.focus.app); if (p) selectAppPane(p); }
}
// What the page knows of task `k` of a tab, as it was left (features/layout/plan.ts's TaskFacts): the actor it opens first
// -- the one whose pane the reader closed (`shut`, its apps beside), else the first of its actors then, else the one in
// focus then, else its lead; an actor alone, itself; apps alone, none -- its others, its views, its apps (as the page knows
// them now: openTaskApps), the actor and the app in focus then. None: a task gone.
// `focus`: the actor it opens first, asked for (the list's openTask): none of what was in focus then.
function taskFacts(k, focus = null) {
  const { group: g, id } = parseKey(k), gg = gathererNamed(g);
  if (!gg || id === undefined) return null;
  const was = taskLayout(k), n = taskNumber(id);
  const open = (c) => { const a = gg.agents.find((x) => x.channel === c); return !!a && statusOf(a)[0] !== "closed" && taskKey(g, c) === k; };
  const appsOf = (first) => {
    const found = taskAppsFound(g, gg, first, k, was ? was.apps : null).found;
    for (const a of found) if (a.inst) instCache.set(a.id, a.inst);
    return found.map((a) => ({ app: a.app, id: a.id, g, ...(+a.size > 0 ? { size: +a.size } : {}) }));
  };
  const mine = !!state.selected && !isAway() && !appsOnlyKey() && state.selected[0] === g && taskKey(...state.selected) === k
    && !tasksLaidOut.has(k);   // its actor in this page's own pane already, the task not laid out (the page opened on it)
  if (n !== null) {
    if (!taskById(g, n)) return null;
    const ok = (c) => !!c && taskActors(gg, n).some((a) => a.channel === c);
    const asked = ok(focus) ? focus : null;
    const shut = !asked && was && ok(was.shut) && !was.actors.some(ok) && (was.apps || []).length ? was.shut : null;
    const first = asked || shut || (was && ok(was.actors[0]) ? was.actors[0] : null) || (was && ok(was.focus) ? was.focus : null)
      || (taskLead(gg, n) || {}).channel || null;
    const apps = appsOf(first);
    const rest = (was ? was.actors : taskOrder(g, k)).filter((c, i, them) => c !== first && them.indexOf(c) === i && open(c));
    return { key: k, g, first, rest, shut: !!shut, views: (was && was.views) || {}, apps,
      back: !asked && first && was && ok(was.focus) && was.focus !== first ? was.focus : null,
      focusApp: asked ? null : (was && was.focusApp) || ((shut || !first) && apps.length ? apps[0].id : null), mine: !!first && mine };
  }
  if (isAppItem(id)) {
    if (!appInfo(g, id.slice(APP_ITEM.length))) return null;
    return { key: k, g, first: null, rest: [], shut: false, views: {}, apps: appsOf(null), back: null, focusApp: null, mine: false };
  }
  if (!gg.agents.some((a) => a.channel === id)) return null;
  const rest = (was ? was.actors : []).filter((c, i, them) => c !== id && them.indexOf(c) === i && open(c));
  return { key: k, g, first: id, rest, shut: false, views: (was && was.views) || {}, apps: appsOf(id), back: null,
    focusApp: null, mine: mine && isAt(state.selected, g, id) };
}
// A TASK OPENED by a click on it in the list (features/list/task-acts.ts's openTask), not shown as it is already: shown as
// it was left, in place of what is shown -- worked out at once (features/layout/plan.ts's tabPlan, of that task alone:
// `focus`, else the actor it opens first, in this page's own pane, the others beside it, its apps above, terminals kept)
// and rendered (renderLayout); the task left kept as it is first (rememberTask). `wait` false: done once the panes are
// open, what this page's own shows (its Chat) still loading.
async function openTaskHere(k, focus = null, wait = true) {
  const f = taskFacts(k, focus);
  if (!f || !f.first) return;
  const sel = focusedActor(), from = appsOnlyKey() || (sel && taskKey(sel[0], sel[1])) || (state.selected && taskKey(...state.selected));
  if (from && from !== k && tasksLaidOut.has(from) && (!isAway() || isShut())) rememberTask(from);
  const loading = renderLayout(tabPlan([f], k, openNow((t) => t === k), MAX_PANES), f.mine || from === k);
  taskAppsOpening = openTaskApps(f.g, f.first, k, (taskLayout(k) || {}).apps || null);   // its apps not known yet, once read
  if (wait && loading) await loading;
}
// THE RENDERER: the page made to match a tab's plan (features/layout/plan.ts) -- the model first (the tab's tasks, the
// panes beside, the apps' panels, the task of apps alone, this page's own pane out of sight or not), then the page: its
// own pane given its actor (the list's select), the panes and panels opened and closed to match (renderPanes,
// renderApps), what is in focus. `kept`: the first task's actor in this page's own pane already (the page opened on it).
let laying = false;                                  // a plan being rendered
function renderLayout(plan, firstKept = false) {
  laying = true;
  try { return layOut(plan, firstKept); } finally { laying = false; }
}
function layOut(plan, firstKept) {
  plan.order.forEach((k, i) => { if (i || !firstKept) shadow.update(model.open, k, i > 0); });
  for (const k of plan.order) tasksLaidOut.add(k);
  if (plan.order.length) setTaskNow(plan.order[0]);
  const was = shadow.layout.apps || [];
  shadow.update(model.keptApps, plan.apps.map((a) => {
    const w = was.find((x) => x.instance === a.id), size = +(a.size || (w && w.size)) || 0;
    return { app: a.app, instance: a.id, g: a.g, ...(size > 0 ? { size } : {}) };
  }));
  const kept = (shadow.layout.panes || {}).others || [];
  shadow.update((l) => ({ ...l, panes: { ...(l.panes || { here: null }), others: plan.others.map((o) => {
    const k0 = kept.find((x) => x.g === o.g && x.c === o.c);
    return { ...(k0 || {}), g: o.g, c: o.c, ...(o.view ? { view: o.view } : {}), size: (k0 && k0.size) || 1 };
  }) } }));
  // this page's own pane out of sight, or in sight again, before anything is placed: a panel placed in sight is put in
  // its task's arrangement (work.ts)
  const h = plan.here;
  let loading = null;
  if (!h && plan.away && state.selected && !isShell(state.selected[1])) putAway(state.selected);
  if (h && h.shut) putAway([h.g, h.c], true);
  else if (h && shadow.layout.away) backInSight();
  setAppsOnly(plan.appsOnly);
  if (h) {
    if (h.size) panes.here.size = h.size;
    if (!h.keep && !isAt(state.selected, h.g, h.c)) {
      if (h.view) setViewHere(h.view);
      loading = select(h.g, h.c);
      loading.catch(() => {});
    }
  }
  renderPanes();
  renderApps();
  const f = plan.focus;
  if (f && f.app) { const p = panes.apps.find((q) => !q.held && q.instance.id === f.app); if (p) selectAppPane(p); }
  else if (f) focusPane(isAt(state.selected, f.g, f.c) ? panes.here : actorPanes().find((q) => isAt([q.g, q.c], f.g, f.c)) || panes.here);
  markSelected(); placeWork();
  if (state.home) renderAgents();
  return loading;                                    // this page's own pane's actor loading, if it was given another
}
// A task's key as it is now: a lone item's -- an actor's, an app's -- the task it has been put in since, if it has (taskKey);
// any other, as it is (a task's; one not known yet, its apps not read). A screen tab keeps the keys of the tasks it was
// left with (features/layout/tabs.ts).
function keyNow(k) {
  const { group: g, id } = parseKey(k);
  if (!id || taskNumber(id) !== null || !state.home) return k;
  return taskKey(g, id) || k;
}
// The layout model's keys now (shadow.ts): keyNow's -- and for a task, the keys now of the items it held when last asked
// about and holds no more whose panels are open (taken out of it: each a task of its own, shown still; one closed for
// good, not), with its own if it is left. (Step 4's model knows each task's open items itself.)
function keysNow(k) {
  const { group: g, id } = parseKey(k), n = taskNumber(id);
  if (!state.home) return [k];
  if (n === null) return isAppItem(id) || taskKey(g, id) ? [keyNow(k)] : [];   // (an actor gone from its group: none)
  const kept = (state.home.tasks || {})[g] || { tasks: [], tasked: {} };
  // its items open as last placed, and those open then (the layout model's: noteOpen, at each placing)
  const was = (shadow.layout.items || {})[k] || [], open = new Set(shadow.layout.open || []);
  const left = (now) => was.filter((item) => !now.includes(item) && open.has(item)).map((item) => taskKey(g, item)).filter(Boolean);
  if (!kept.tasks.some((t) => String(t.id) === String(n))) return was.length ? [...new Set(left([]))] : [k];
  const now = Object.keys(kept.tasked).filter((item) => String(kept.tasked[item]) === String(n));
  return [...new Set([k, ...left(now)])];
}
shadow.keysWith(keysNow);   // (how the layout's store reads a task's key now)
// A TASK'S STATES, for its face in its screen tab (tabs.ts marks the most pressing): each of its actors' (statusOf),
// its lead's first, and its apps' notifications not seen -- each as a mark (tabs.ts's MARKS: a turn, a build, a start
// all "working"; idle, closed none) and its word as the list says it
const TAB_MARK = { asking: "asking", error: "error", failed: "error", notified: "notified", finished: "finished",
  running: "working", building: "working", background: "background" };
function taskStates(k) {
  const { group: g, id } = parseKey(k), gg = gathererNamed(g);
  if (!gg || id === undefined || isShell(id)) return [];
  const told = (o) => appStatusOf(g, o.id), t = taskNumber(id);
  const one = isAppItem(id) ? appInfo(g, id.slice(APP_ITEM.length)) : null;
  const lead = t !== null ? taskLead(gg, t) : null;
  const actors = t !== null ? [lead, ...taskMembers(gg, t).filter((a) => a !== lead)].filter(Boolean)
    : one ? [] : gg.agents.filter((a) => a.channel === id);
  const apps = t !== null ? taskApps(gg, t) : one ? [one] : [];
  return [...actors.map(statusOf), ...apps.map(told).filter(Boolean)]
    .map(([cls, said]) => ({ mark: TAB_MARK[cls] || "", said }));
}
// TASK TABS (features/layout/tasks.ts). A task's tab shown: `items` of task `k` open, each in the view it showed, and
// the task's other panels closed -- this page's own pane given another of the tab's actors, if it showed one not in it
async function showTaskItems(k, items) {
  const g = parseKey(k).group, views = (taskLayout(k) || {}).views || {};   // (features/layout/plan.ts's itemsPlan)
  const apps = items.filter(isAppItem).map((it) => appInfo(g, it.slice(APP_ITEM.length))).filter(Boolean);
  for (const o of apps) if (o.inst) instCache.set(o.id, o.inst);
  renderLayout(itemsPlan(openNow(), k, g, items, views, apps.map((o) => ({ app: o.app.name, id: o.id, g })), MAX_PANES));
  if (apps.length) await openTaskApps(g, null, k, apps.map((o) => ({ app: o.app.name, id: o.id, inst: o.inst })), true);
}
// a task's lead actor (a new tab of the task holds it)
function taskLeadOf(k) {
  const { group: g, id } = parseKey(k), gg = gathererNamed(g);
  if (!gg || id === undefined || isAppItem(id) || isShell(id)) return null;
  if (taskNumber(id) === null) return id;
  const a = taskLead(gg, taskNumber(id));
  return a && a.channel ? a.channel : null;
}
// a pane minimized now, or shown whole again: drawn so
function paneMinimized(node) {
  const p = allPanes().find((q) => q.node === node);
  if (p) minRedraw(p);
}
// a panel closed by the reader (its ×): out of its task's tab shown, if the task has tabs
function workClosed(node) { if (workPlacer && node) workPlacer.closed(node); }
// What a block of the work area is called on its strip (shown while there are others): its task's name, an actor's (the
// coordinator agent's, unnamed: what it is), an app's; a terminal's (no task)
function blockName(k) {
  const { group: g, id } = parseKey(k), gg = gathererNamed(g);
  if (k.startsWith("\u0002")) return isShell(k.slice(1)) ? "Terminal" : "";
  if (!gg || id === undefined) return "";
  if (taskNumber(id) !== null) { const t = taskById(g, taskNumber(id)); return t ? taskName(gg, t) : "A task"; }
  if (isAppItem(id)) { const o = appInfo(g, id.slice(APP_ITEM.length)); return o ? appShown(o) : "An app"; }
  const a = gg.agents.find((x) => x.channel === id);
  return !a ? id : isCoordinator(a) && !(a.name && a.name.text) ? (a.over ? `${crewPlace(a.over, gg)} coordinator` : CREW_GROUP)
    : actorTitle(a);
}
// A block's faces, on its card's head: its task's actors' (not closed; three at most) and its apps'
// marks -- an actor's, an app's, alone
function blockFaces(k) {
  const { group: g, id } = parseKey(k), gg = gathererNamed(g);
  if (!gg || id === undefined) return [];
  const face = (a) => {
    const src = a.avatar && !SNAPSHOT ? `/avatars/${a.avatar}.svg` : null;
    return src ? el("img", { class: "lay-face", src, alt: "", draggable: "false" }) : el("span", { class: "lay-face" }, harnessLogo(a.harness));
  };
  const mark = (o) => el("span", { class: "lay-face app" }, appMarkOf(o));
  if (taskNumber(id) !== null) {
    const t = taskNumber(id), actors = taskActors(gg, t);
    return [...actors.slice(0, 3).map(face), ...(actors.length ? [] : taskApps(gg, t).slice(0, 1).map(mark))];
  }
  if (isAppItem(id)) { const o = appInfo(g, id.slice(APP_ITEM.length)); return o ? [mark(o)] : []; }
  const a = gg.agents.find((x) => x.channel === id);
  return a ? [face(a)] : [];
}
// What a panel's box shows in its screen tab's map (tab-map.ts): an actor's, its avatar's hue and face; an app's, its
// mark on grey. A task's key for its item (a tab with no map kept of it): its lead's, else its first app's.
function cellLook(k, item) {
  const { group: g, id } = parseKey(k), gg = gathererNamed(g);
  if (!gg || id === undefined) return null;
  if (item === k && taskNumber(id) !== null) {
    const o = taskApps(gg, taskNumber(id))[0];
    item = o ? APP_ITEM + o.id : "";
  } else if (item === k) item = id;
  if (isAppItem(item)) {
    const o = appInfo(g, item.slice(APP_ITEM.length));
    return { app: true, src: o && o.app.mark && !SNAPSHOT ? `/apps/mark/${encodeURIComponent(o.app.name)}.svg` : null };
  }
  const a = gg.agents.find((x) => x.channel === item);
  return a ? { hue: HUE_MAIN[a.avatar_hue] || null, src: a.avatar && !SNAPSHOT ? `/avatars/${a.avatar}.svg` : null } : null;
}
// What is in a block, in words, on its card's head: its actors, how many; its apps, by name
function blockAbout(k) {
  const { group: g, id } = parseKey(k), gg = gathererNamed(g);
  if (!gg || taskNumber(id) === null) return "";
  const t = taskNumber(id), n = taskActors(gg, t).length, apps = taskApps(gg, t).map((o) => o.app.label);
  return [n ? plural(n, "actor") : null, apps.length ? [...new Set(apps)].join(", ") : null].filter(Boolean).join(" · ");
}
// the task whose row (or a row of it) is dragged from the list: one task's items only; one not shown with an actor to
// open beside (a task of apps alone opens alone)
function draggedTask() {
  const cs = listDrag.cs || [], keys = [...new Set(cs.map((c) => taskKey(listDrag.g, c)))];
  if (keys.length !== 1 || !keys[0]) return null;
  const k = keys[0];
  return !workPlacer.tabs.where(k) && cs.some((c) => !isAppItem(c)) ? k : null;   // open in a tab: not dropped
}
// a task dropped on the work area from the list, not shown: opened beside the tasks shown (as ⌘+click on its row does)
function openDropped(k) {
  const { group: g, id } = parseKey(k);
  if (taskNumber(id) !== null) openTask(g, taskNumber(id), null, { metaKey: true });
  else if (!isAppItem(id)) openTaskBeside(g, k, id);
}
// A panel's head dragged -- an actor's pane's, its Chat bar's grip (the head put there) -- picks it up (none from a press
// on a button in it, nor one with nowhere to go); let go, it is put down. Right-clicked: what it can be moved to, as a
// menu. An app's panel has no head: its row in the list, right-clicked, opens that menu for it (appPanelMenu).
const MOVE_FROM = "#panes > .pane > .pane-top, .pane .fl-grip, .lay-strip";
let movePress = null;                                // what the last press was on: a drag starting from a button is none
function moveStart(node) { return !!workPlacer && !!node && workPlacer.startMove(node); }
function moveEnd() { if (workPlacer) workPlacer.endMove(); }
// The menu a panel's head right-clicked opens at (x, y): which side of its task's block it goes along, or whose place it
// takes. None for a panel with no other of its task shown -- unless `more` ({head, items}) gives it items of its own.
// (a task's strip, or the head of its only panel shown: the task moved among the tasks shown -- or, others shown with it,
// to another screen tab, or a new one)
const MOVE_SIDES = [["left", "←", "To the left"], ["right", "→", "To the right"], ["top", "↑", "To the top"], ["bottom", "↓", "To the bottom"]];
function moveMenu(node, x, y, more = null) {
  const m = workPlacer && node && workPlacer.moves(node);
  if (!m && !more) return false;
  let at = document.getElementById("lay-anchor");    // what the menu hangs from: the point pressed
  if (!at) { at = el("span", { id: "lay-anchor", class: "lay-anchor", "data-pop": "lay-move", "aria-hidden": "true" }); document.body.append(at); }
  at.style.left = `${Math.round(x)}px`; at.style.top = `${Math.round(y)}px`;
  const mark = (t) => el("span", { class: "lay-mark", "aria-hidden": "true", text: t });
  const moves = !m ? [] : [
    ...MOVE_SIDES.filter(([side]) => m.sides.includes(side))
      .map(([side, arrow, text]) => ({ mark: mark(arrow), text, run: () => workPlacer.toSide(node, side) })),
    ...m.others.map((o) => ({ mark: mark("⇄"), text: `Swap with ${panelName(o)}`, run: () => workPlacer.swapWith(node, o) })),
    ...m.tabs.map((t) => ({ mark: mark("⇥"), text: `To ${t.name}`, run: () => workPlacer.toTab(node, t.id) })),
    ...(m.split ? [{ mark: mark("+"), text: "To a new tab of this task", run: () => workPlacer.toNewTab(node) }] : []),
    ...(m.screens || []).map((t) => ({ mark: mark("⇥"), text: `To tab ${t.n} · ${t.name.length > 40 ? `${t.name.slice(0, 39)}…` : t.name}`, run: () => workPlacer.toScreenTab(node, t.id) })),
    ...(m.screens ? [{ mark: mark("+"), text: "To a new tab", run: () => workPlacer.toScreenTab(node, null) }] : [])];
  const head = more ? more.head(m) : m.task ? "Move this task" : "Move this panel";
  openPop("lay-move", at, popMenu(head, [...moves, ...(more ? more.items(mark) : [])]));
  return true;
}
// An app's row in the list (features/list/list.js's appRow), or its row in its task's card, right-clicked: its panel's menu,
// as a head's -- where the panel can be moved (moveMenu), and the panel closed, the app left open (its row, or its task,
// opens it again). Its panel not shown: the browser's own menu.
function appPanelMenu(gname, o, ev) {
  if (SNAPSHOT) return;
  const p = panes.apps.find((q) => q.g === gname && q.instance.id === o.id && !q.held && !q.node.hidden);
  if (!p) return;
  ev.preventDefault();
  ev.stopPropagation();
  const name = appShown(o);
  moveMenu(p.node, ev.clientX, ev.clientY, {
    head: (m) => (!m ? name : m.task ? `Move ${name}'s task` : `Move ${name}`),
    items: (mark) => [{ mark: mark("×"), text: "Close panel (app stays open)", run: () => { workClosed(p.node); closeAppPane(p); } }],
  });
}
// what a panel is called in the menu: an app's as its head names it, an actor's as the list does
function panelName(node) {
  if (node.matches(".lay-strip")) return node.dataset.name || "this task";
  const app = panes.apps.find((p) => p.node === node);
  const short = (t) => (t.length > 48 ? `${t.slice(0, 47)}…` : t);
  if (app) return short(app.instance.name || app.instance.title || app.app.label);
  const q = allPanes().find((p) => p.node === node), at = q && q.c ? [q.g, q.c] : null;
  if (!at) return "this pane";
  if (isShell(at[1])) return "the terminal";
  const a = appActor(at[0], at[1]);
  return short(a ? (a.name && a.name.text) || firstLine(a.last_user_message || "", 60) || at[1] : at[1]);
}
// The panes' top row -- each pane's head -- as tall as the tallest of them, so the rule under it runs straight
// across: each says how tall it is by itself (`tops`: each pane's head's), and all are given the tallest (--top-h). Not
// where the page is a phone's, its panes one under the other. A head put in its Chat view's bar (the Editor open:
// barActs) is hidden, of no height.
const tops = new Map(), NARROW = matchMedia("(max-width: 760px)");
function topRow(who, height) {
  if (height === null) tops.delete(who); else tops.set(who, height);
  const tallest = NARROW.matches ? 0 : Math.ceil(Math.max(0, ...tops.values())) + 1;   // and the rule under it
  if (tallest === panes.top) return;
  panes.top = tallest;
  setTopRow(tallest);
}
const setTopRow = (h) => document.documentElement.style.setProperty("--top-h", `${h}px`);
// pane `who`'s head `node` (this page's own: "here") watched for its height
function watchTop(node, who) {
  const watch = new ResizeObserver(() => { if (node.isConnected) topRow(who, node.getBoundingClientRect().height); });
  watch.observe(node);
  if (who && typeof who === "object") who.watch = watch;
}
// A pane's head (every pane's, `p` given: that one's): whose it is, as the list has the actor -- its avatar, its name or
// what it was last asked. This page's own, alone, has none.
function drawWho(p) {
  if (!p) { for (const q of allPanes()) drawWho(q); return; }
  if (p === panes.here && !panes.others.length) return;
  const sh = p.c && isShell(p.c) ? shellOf(p.c) : null;
  if (sh) {
    const sig = signature([p.g, p.c, sh, state.home.home_dir]);
    if (sig === p.drawn.who) return;
    p.drawn.who = sig;
    p.who.replaceChildren(shellLogo(), el("span", { class: "tx", text: shellPath(sh) }));
    p.who.title = `Terminal · ${sh.gatherer}\n${sh.cwd}`;
    return;
  }
  const info = paneInfo(p);
  const sig = signature([p.g, p.c, info && [info.avatar, info.harness, info.last_user_message, info.name && info.name.text]]);
  if (sig === p.drawn.who) return;
  p.drawn.who = sig;
  const named = info && info.name && info.name.text;
  p.who.replaceChildren(...(info ? [actorLogo(info), el("span", { class: "tx", text: named || info.last_user_message || info.channel })] : []));
  p.who.title = info ? [named, info.last_user_message, `${harnessName(info.harness)} · ${p.g} · ${info.channel}`]
    .filter(Boolean).join("\n") : "";
}
// A line over the panes for a moment: why nothing opened.
function paneNote(text) {
  const n = el("div", { class: "pane-note", role: "status", text });
  document.getElementById("panes").append(n);
  if (document.querySelector(".work.placed")) n.style.top = `${panes.here.node.offsetTop + 12}px`;   // over the actors' panes
  setTimeout(() => n.remove(), 3500);
}
function savePanes() {
  if (SNAPSHOT) return;
  shadow.update(model.panesNoted, state.selected, panes.here.size, panes.others.indexOf(focusedPane()), (o) => {
    const p = panes.others.find((q) => isAt([q.g, q.c], o.g, o.c));   // (which panes beside: the layout model's, model.ts)
    return p ? { view: p.view || undefined, size: p.size } : null;
  });
  shadow.persist();
}
// The panes kept, opened again once the home is known: those whose actors are still in it.
function restorePanes() {
  panes.checked = true;
  if (SNAPSHOT) return;
  const kept = shadow.now().panes;                  // (the layout model's: model.ts)
  if (!kept || !Array.isArray(kept.others) || !kept.others.length) return;   // none beside: the tab's tasks say (tabs.ts's
                                                     // start), its own pane closed staying so
  const exists = (g, c) => isShell(c) ? (state.home.shells || []).some((s) => s.id === c && s.gatherer === g)
    : state.home.gatherers.some((x) => x.name === g && x.agents.some((a) => a.channel === c));
  if (!state.selected && Array.isArray(kept.here) && exists(...kept.here)) state.selected = kept.here;
  if (!state.selected) return;
  panes.here.size = +kept.size || 1;
  let room = MAX_PANES - 1;                           // those still in the home, not this page's own, as many as fit
  shadow.update(model.unwantPanes, (o) => !o || !exists(o.g, o.c) || isAt(state.selected, o.g, o.c) || room-- <= 0);
  renderPanes();
  focusPane(panes.others[kept.focus] || panes.here);
  layout();
}
// ------------------------------------------------------------------ apps' panels
// An app's panel (app_kit/DESIGN.md) is in the top row (where it goes, the work area's arrangement: placeWork), above the
// actors' panes at first, each panel's width its share (`size`, for a phone's width). Opening
// one opens the actor it is attached to below it, in the pane in focus (one open already: its pane focused). Its head
// and its iframe are made by features/apps/host.ts (appHost); what its panel asks goes through it to the
// dashboard's /api/apps; the actor in focus (appsSelected) and the theme are told to it. The panels open are kept in
// this browser (the layout model's `apps`: model.ts), opened again once the apps are known (restoreAppPanes).
const topRowEl = () => document.getElementById("top-row");
function topLayout() {
  for (const p of panes.apps) p.node.style.flexGrow = String(p.size);
  placeWork();
}
// An actor of the home (its gatherer, its channel), as the page has it now; a codex actor's thread it was renamed to (one
// from before `ag --channel`).
const appActor = (g, c) => {
  const gg = gathererNamed(g);
  return (gg && gg.agents.find((a) => a.channel === c || a.started_as === c || (a.session && a.session.started_as === c))) || null;
};
// The actors as the list has them, for a panel that asks (the SDK's ag.actors): each one's name, avatar, hue, folder,
// status -- what an app shows of an actor -- and what it asks the user, by gatherer; the harnesses a new one can start
// on here; and the dashboard's own folder and the home folder.
function appActors() {
  const h = state.home;
  if (!h) return { gatherers: [], home_dir: "", cwd: "", harnesses: [] };
  return { home_dir: h.home_dir || "", cwd: h.cwd || "",
    harnesses: startable().map((x) => ({ name: x, label: harnessName(x) })),
    gatherers: h.gatherers.map((g) => ({ name: g.name, start_cwd: startCwd(g) || null, agents: g.agents.map((a) => appActorSaid(g, a)) })) };
}
// An actor as a panel is told of it: as appActors says. What it asks: as Chat shows it (askingNote), less what only
// Chat draws (a permission's input, a dialog's screen), and whether its answer can be given from the page (askWhere).
// What its latest message is about, when an app wrote it (`asked_of`: the app, and the item its [asked] pattern's third
// group names -- a Notes line): the item it is on now.
function appActorSaid(g, a) {
  const ask = a.status === "asking" || (a.status === "running" && a.asking && a.asking.async) ? a.asking : null;
  const { input, view, lines, ...said } = ask || {};
  return { channel: a.channel, started_as: (a.session && a.session.started_as) || null, name: a.name || null,
    last_user_message: firstLine(appAsked(a, a.last_user_message || ""), 200), avatar: a.avatar || null,
    avatar_hue: a.avatar_hue || null, cwd: cwdOf(a) || null, last: a.last || 0, status: statusOf(a),
    harness: a.harness || null, role: a.role || null, over: a.over || null, saved: !!savedAs(g.name, a), turn_over: !!a.turn_over,
    asked_of: a.asked_of || appAskedOf(a.last_user_message || ""),        // (read before the apps were: from it now)
    recap: a.recap && a.recap.text ? { text: a.recap.text, at: a.recap.at } : null,
    asking: ask ? { ...said, id: askKey(ask) } : null, answerable: !!ask && askWhere(a, ask).here };
}
// What a panel is told of an attached agent (the SDK's agents.state), as DocWriter's page was told its actor's.
function appAgentState(g, c) {
  const a = appActor(g, c);
  return a && { channel: a.channel, status: statusOf(a)[0], turn_over: a.turn_over, asking: a.asking || null,
    failing: a.failing || null, stopped: a.stopped || null, name: (a.name && a.name.text) || null,
    session: a.session ? { session_id: a.session.session_id, terminal: !!a.session.terminal } : null };
}
// A message to an attached agent, its question answered, its turn stopped -- as Chat sends, answers and stops (Esc).
const appSessionOf = (g, c) => { const a = appActor(g, c); return a && a.session ? a.session.session_id : null; };
function appSend(g, c, text) {
  const sid = appSessionOf(g, c);
  return post("/api/send", sid ? { session_id: sid, text } : { gatherer: g, channel: c, text });
}
function appAnswer(g, c, call, choice) {
  return post("/api/answer", { session_id: appSessionOf(g, c) || c, call, choice });
}
function appInterrupt(g, c) {
  const sid = appSessionOf(g, c);
  return sid ? post("/api/terminal/input", { session_id: sid, data: "\u001b" }) : Promise.resolve(null);
}
// A message to any actor of a gatherer, as Chat sends one (an app asking message_actors): "gatherer", its gatherer agent,
// started first if it has none, as its button starts it (openCoordinator). -> {channel}, the actor's.
async function appSendActor(g, c, text) {
  const gg = gathererNamed(g);
  if (!gg) throw new Error(`no gatherer ${g}`);
  const a = c === "gatherer" ? groupCrew(gg) : appActor(g, c);
  if (a) { await appSend(g, a.channel, text); return { channel: a.channel }; }
  if (c !== "gatherer") throw new Error(`${c}: not an actor of ${g}`);
  const s = await post("/api/coordinator", { gatherer: g, cwd: startCwd(gg), harness: startable()[0] || "" });
  await post("/api/send", { session_id: s.session_id, text });
  loadHome();
  return { channel: s.session_id };
}
// A new actor of a gatherer, started on `harness` in `folder` with `text` its first message (an app asking
// message_actors): listed, not shown -- the reader stays where they are. -> {channel}.
async function appStartActor(g, harness, folder, text) {
  if (!startable().includes(harness)) throw new Error(`${harness ? harnessName(harness) : "No harness"} can't start an actor here`);
  if (!folder) throw new Error("which folder it works in");
  const s = await post("/api/sessions", { gatherer: g, cwd: folder, harness });
  await post("/api/send", { session_id: s.session_id, text });
  loadHome();
  return { channel: s.session_id };
}
// An actor of a gatherer shown in the pane in focus, in Chat (an app asking message_actors).
function appShowActor(g, c) {
  const a = appActor(g, c);
  return a ? show(g, a.channel, CHAT_VIEWS.has("files") ? "files" : null) : null;
}
// The message box of the actor `c` of gatherer `g`, focused, if a pane shows it: its keys taken back from a native page
// first, in the desktop app.
function appFocusAgent(g, c) {
  const a = appActor(g, c), p = a && allPanes().find((q) => isAt([q.g, q.c], g, a.channel));
  if (!p) return;
  window.agApp?.focusDashboard?.();
  paneBox(p)?.focus();
}
function addAppPane(app, instance, size = 1, held = false) {
  const p = { app, instance, g: instance.gatherer, size, held };
  p.panel = new appHost.AppPane(app, instance, {
    close: () => { workClosed(p.node); closeAppPane(p); },   // its panel asking (ag.close)
    intent: (kind, data, from) => appIntent(kind, data, from.instance.gatherer),
    openLink: (href, from) => openAppLink(from.instance.gatherer, null, href,   // ag.links.open
      { folder: from.instance.folder, item: appItem(from.instance.id) }),
    selection: () => appsSelection(),
    agents: (g) => (gathererNamed(g) || { agents: [] }).agents     // a gatherer's own
      .filter((a) => !a.closed && !isCoordinator(a))                                                           // agent: attached to no app
      .map((a) => ({ channel: a.channel, name: (a.name && a.name.text) || a.last_user_message || a.channel })),
    agentState: appAgentState, send: appSend, answer: appAnswer, interrupt: appInterrupt, focusAgent: appFocusAgent,
    actors: appActors, sendActor: appSendActor, startActor: appStartActor, showActor: appShowActor,
    pressed: pressedAway,                            // a press in its panel
  });
  p.node = p.panel.node; p.frame = p.panel.frame;
  p.node.hidden = held;
  topRowEl().append(p.node);
  panes.apps.push(p);
  const ak = !held && state.home ? appPaneTask(p) : null;
  if (ak) shadow.update(model.open, ak, true);
  topLayout();
  p.panel.refresh();                                 // its agents, as the host has them
  topChanged();
  return p;
}
// An app's pane shown again for `inst` -- the same instance, now of another group (features/list/group-moves.js's followMoved):
// its panel opened anew in its place, as wide, held or not as it was; selected still, if it was (by its id)
function swapAppPane(p, inst) {
  const i = panes.apps.indexOf(p);
  if (i < 0) return null;
  const was = state.home && !p.held ? appPaneTask(p) : null;
  queueMicrotask(() => shadowGone(was));            // (its key in the group it left: the layout model told, shadow.ts)
  instCache.set(inst.id, inst);
  shadow.update(model.swapApp, p.instance.id, { app: p.app.name, instance: inst.id, g: inst.gatherer });
  const q = addAppPane(p.app, inst, p.size, p.held);  // made at the row's end: put where p was
  q.kept = p.kept || null;
  topRowEl().insertBefore(q.node, p.node);
  panes.apps.splice(panes.apps.indexOf(q), 1);
  panes.apps.splice(i, 1, q);
  p.panel.destroy();
  p.node.remove();
  markSelected(); topLayout(); saveAppPanes(); topChanged();
  return q;
}
// A panel held out of sight shown (wanted again: renderApps), or one shown held (no longer wanted while it is needed:
// appsAtWork).
function holdAppPane(p, held) {
  p.held = held;
  if (!held) p.kept = null;
  if (held) unselectApp(p.instance.id);
  p.node.hidden = held;
  topLayout(); saveAppPanes(); topChanged();
}
// THE APPS' PANELS follow the layout model's `apps` (model.ts): what opens or closes one says so to the model
// (showAppPanel, closeAppPane, appClosed, the plans: renderLayout) and renderApps makes the panels match -- each wanted one shown,
// its instance known (the page's apps, or the one given) at once, in the frame that asked for it, else once the host
// gives it, if it is still wanted then (a task entered meanwhile no longer wants another's); each shown one no longer
// wanted closed, or held out of sight while its agent is at work (appNeeded).
const instCache = new Map(), fetching = new Set();
const wanted = (id) => (shadow.layout.apps || []).some((w) => w.instance === id);
function renderApps() {
  if (SNAPSHOT) return;
  let changed = false;
  for (const p of [...panes.apps]) if (!p.held && !wanted(p.instance.id)) { dropAppPanel(p); changed = true; }
  for (const w of shadow.layout.apps || []) {
    const p = panes.apps.find((q) => q.instance.id === w.instance);
    if (p) { if (p.held) { holdAppPane(p, false); changed = true; } continue; }
    const app = appHost.named(w.app);
    if (!app) continue;
    const inst = instCache.get(w.instance) || (appInfo(w.g, w.instance) || {}).inst;
    if (inst) { addAppPane(app, inst, +w.size > 0 ? +w.size : 1); changed = true; continue; }
    if (fetching.has(w.instance)) continue;
    fetching.add(w.instance);
    appHost.instanceOf(w.app, w.g, w.instance).catch(() => null).then((got) => {
      fetching.delete(w.instance);
      if (!got) { shadow.update(model.unwantApps, (x) => x.instance === w.instance); saveAppPanes(); return; }   // closed since
      instCache.set(got.id, got);
      if (wanted(got.id)) renderApps();
    });
  }
  if (changed) { appsOnlyLeft(); markSelected(); topLayout(); saveAppPanes(); if (state.home) renderAgents(); topChanged(); }
}
// its panel gone from the page (its instance stays open): held out of sight instead while a tab not shown holds its task
// (keepForTab), or while its agent is at work
function dropAppPanel(p) {
  const i = panes.apps.indexOf(p);
  if (i < 0) return;
  const gk = state.home ? appPaneTask(p) : null;
  queueMicrotask(() => shadowGone(gk));
  if (keepForTab(p)) return;                         // its tab left: shown as it is when that tab is shown again
  if (appNeeded(p)) return holdAppPane(p, true);     // its agent at work: its page answers its tools, out of sight
  destroyAppPanel(p);
}
function destroyAppPanel(p) {
  const i = panes.apps.indexOf(p);
  if (i < 0) return;
  panes.apps.splice(i, 1);
  unselectApp(p.instance.id);
  p.panel.destroy();                                 // its streams go; the instance stays open
  p.node.remove();
}
// A SCREEN TAB'S APP PANELS KEPT READY (features/layout/kept.ts). An app's panel no longer wanted in the tab shown whose
// task a tab not shown holds -- the tab just left, kept as it was (tabs.ts), or the tab the task was moved to -- is held
// out of sight, its frame as it is (the Browser's page, its picture, its stream; in the ag app, its native page placed
// again once its panel shows: features/apps/native.ts), not closed: that tab shown, the panel is wanted again and shown
// as it is (renderApps), with no frame to load. `p.kept`: the tab it is kept for. The panels of the KEPT_TABS tabs left
// latest are kept so, those of a tab left before them closed; a panel whose task no tab not shown holds any longer (its
// task closed, its tab closed or emptied, the task shown and not wanted) closed, unless its agent is at work.
const KEPT_TABS = 3;
const tabsLeft = new Map();                          // a tab's id -> the order its panels were last kept in (1, 2, ...)
let keptCount = 0;
const tabKeeping = (p) => {
  if (!state.home) return null;
  const l = shadow.now();
  return tabHolding(l.tabs, l.current, appPaneTask(p), keyNow);
};
function keepForTab(p) {
  if (SNAPSHOT || !workPlacer) return false;
  const tab = tabKeeping(p);
  if (!tab) return false;
  p.kept = tab;
  tabsLeft.set(tab, ++keptCount);
  p.held = true;                                     // (holdAppPane's, but the row laid out once: renderApps, after)
  unselectApp(p.instance.id);
  p.node.hidden = true;
  queueMicrotask(sweepKept);                         // (the cap: a tab left before the latest ones, its panels closed)
  return true;
}
// on each change of the screen tabs (a tab shown, closed, a task moved or closed in one) and each panel kept -- not while a
// tab is being shown: its kept panels are shown again only once its plan is rendered
function sweepKept() {
  const kept = panes.apps.filter((p) => p.kept);
  if (!kept.length || !workPlacer || workPlacer.tabs.busy()) return;   // (a tab being shown: swept once it is, tabs.ts)
  for (const p of kept) p.kept = tabKeeping(p) || null;       // (moved to another tab meanwhile: kept for that one)
  const drop = new Set(keptToDrop(kept.map((p) => ({ id: p.instance.id, tab: p.kept })), tabsLeft, KEPT_TABS));
  let gone = false;
  for (const p of kept) {
    if (!drop.has(p.instance.id)) continue;
    p.kept = null;
    if (!appNeeded(p)) { destroyAppPanel(p); gone = true; }   // (its agent at work: held for it, as before)
  }
  const tabs = new Set(shadow.now().tabs.map((t) => t.id));
  for (const id of [...tabsLeft.keys()]) if (!tabs.has(id)) tabsLeft.delete(id);
  if (gone) { topLayout(); topChanged(); }
}
// instance `inst` of `app` shown above the panes (as wide as `size`, if given) -> its panel
function showAppPanel(app, inst, size = 0) {
  instCache.set(inst.id, inst);
  shadow.update(model.wantApp, { app: app.name, instance: inst.id, g: inst.gatherer, ...(size > 0 ? { size } : {}) });
  renderApps();
  return panes.apps.find((q) => q.instance.id === inst.id) || null;
}
// one of a task's apps to show ({app, id, size?, inst?}: openTaskApps), wanted
function wantTaskApp(k, g) {
  if (k.inst) instCache.set(k.id, k.inst);
  shadow.update(model.wantApp, { app: k.app, instance: k.id, g, ...(+k.size > 0 ? { size: +k.size } : {}) });
}
// an app's panel closed by the reader (its × or menu, a task's tab, a group move): no longer wanted
function closeAppPane(p) {
  if (!panes.apps.includes(p)) return;
  shadow.update(model.unwantApps, (w) => w.instance === p.instance.id);
  if (p.held) { if (!appNeeded(p)) dropAppPanel(p); }
  else renderApps();
  saveAppPanes(); if (state.home) renderAgents(); topChanged();
}
// instance `id` closed, or its app gone: its panel gone, held or not
function appClosed(id) {
  shadow.update(model.unwantApps, (w) => w.instance === id);
  unselectApp(id);
  for (const p of panes.apps.filter((q) => q.instance.id === id)) {
    panes.apps.splice(panes.apps.indexOf(p), 1);
    p.panel.destroy(); p.node.remove();
  }
  appsOnlyLeft();
  topLayout(); saveAppPanes();
}
// a task of apps only shown, its last panel gone: out of apps only -- under screen tabs the tab is left showing nothing
// (its new-tab page), this page's own actor not brought back into it: that actor's task was left when the apps were
// entered (it is another tab's, or ⌥ replaced it), and one task is never in two tabs
// (not while a plan is rendered: the task of apps alone it shows is its own, its panels still opening)
function appsOnlyLeft() {
  if (laying || !appsOnlyKey() || panes.apps.some((q) => !q.held)) return;
  setAppsOnly(null);
  if (workPlacer && state.selected && !isShell(state.selected[1]) && !isAway()) putAway(state.selected);
}
// An app whose panel answers tools of its own (DocWriter's documents' tools) runs while an agent attached to it is at
// work, out of sight if the reader has not opened it: the agent's calls are answered at once, as they were when the
// app was its actor's view. `appsAtWork`, on each change of the home, holds one for each such agent; one held whose
// agents are done goes.
const panelTools = (app) => (app.tools || []).some((t) => t.handled_by === "panel");
const agentAtWork = (a) => !!a && ["running", "asking"].includes(statusOf(a)[0]);
function appNeeded(p) {
  if (!panelTools(p.app)) return false;
  return (p.panel.agents ? p.panel.agents() : []).some((c) => agentAtWork(appActor(p.instance.gatherer, c)));
}
let appsWorking = "";
async function appsAtWork() {
  if (SNAPSHOT || !state.home) return;
  for (const p of panes.apps) { p.panel.agentsChanged(); p.panel.actorsChanged(); }
  const working = [];
  for (const g of state.home.gatherers) for (const a of g.agents) if (agentAtWork(a)) working.push([g.name, a.channel]);
  const sig = JSON.stringify(working);
  if (sig !== appsWorking) {
    appsWorking = sig;
    for (const [g, c] of working) {
      let held;
      try { held = await appHost.attachedTo(g, c); } catch (e) { continue; }
      for (const inst of held) {
        const app = appHost.named(inst.app);
        if (!app || !panelTools(app) || panes.apps.some((p) => p.instance.id === inst.id)) continue;
        addAppPane(app, inst, 1, true);
      }
    }
  }
  for (const p of [...panes.apps]) if (p.held && !p.kept && !appNeeded(p)) {     // its agents done: it goes (one kept for a
                                                                                   // tab: sweepKept's)
    panes.apps.splice(panes.apps.indexOf(p), 1);
    p.panel.destroy(); p.node.remove();
  }
}
function saveAppPanes() {
  if (SNAPSHOT) return;
  for (const p of panes.apps) if (!p.held && wanted(p.instance.id))   // their widths (the panels: the model's already)
    shadow.update(model.wantApp, { app: p.app.name, instance: p.instance.id, g: p.instance.gatherer, size: p.size });
  shadow.persist();
}
// The actor an app's instance is attached to, shown below it: in the pane in focus, unless one of them is open in a
// pane already (that pane focused). None attached: the panes as they are.
async function showAttached(p) {
  const chans = await p.panel.refresh();
  if (!chans.length) return;
  const g = p.instance.gatherer;
  const there = chans.map((c) => actorPanes().find((q) => isAt([q.g, q.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null)).find(Boolean);
  if (there) return focusPane(there);
  const agents = (gathererNamed(g) || { agents: [] }).agents;
  const c = chans.find((ch) => agents.some((a) => a.channel === ch && !a.closed)) || chans.find((ch) => agents.some((a) => a.channel === ch));
  if (c) await show(g, c);
}
// The app's instance for gatherer `g` (in `folder`: the one there, for an app with one per folder) in the top row --
// its panel there already, if it is open -- and the actor it is attached to below it. No agent attached by opening
// it: attaching puts the two in one task (task_links.py), so the actor in focus would take a new instance into its
// task, its other apps and agents with it. A task's "+" (features/list/list.js's addAppToTask) or the panel's agents
// menu put it with agents.
async function openApp(g, name, folder) {
  const app = appHost.named(name);
  if (!app || SNAPSHOT) return null;
  let instance;
  try { instance = await appHost.open(name, g, folder || null); }
  catch (e) { paneNote(`${app.label}: ${e.message}`); return null; }
  const p = showAppPanel(app, instance);             // (one held out of sight while its agent worked: shown now)
  renderAgents();
  await readApps(g, true);                           // the task it is in, as the server has it now
  await showAttached(p);
  return p;
}
// An app opened from a group's menu: as a click on its row does (selectApp) -- in the tab its task is open in, else in a
// tab of its own
async function openAppTab(gname, name, folder) {
  const app = appHost.named(name);
  if (!app || SNAPSHOT) return;
  let inst;
  try { inst = await appHost.open(name, gname, folder || null); }
  catch (e) { paneNote(`${app.label}: ${e.message}`); return; }
  await readApps(gname, true);
  const o = appInfo(gname, inst.id);
  if (o) await selectApp(gname, o, {});
  else await openApp(gname, name, folder);
}
// An intent (app_kit's INTENTS) raised by a panel or a view: the app that takes it opened (in `g`) and told it.
async function appIntent(kind, data, g) {
  const ext = kind === "open-file" && data && data.path ? String(data.path).split(".").pop().toLowerCase() : "";
  const type = { md: "text/markdown", txt: "text/plain", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", svg: "image/svg+xml", html: "text/html", json: "application/json", tex: "text/x-tex",
    ltx: "text/x-tex", sty: "text/x-tex", cls: "text/x-tex", bib: "text/x-bibtex" }[ext] || (ext ? "text/plain" : undefined);
  const apps = appHost.handlers(kind, type), app = apps[0];
  if (!app) throw new Error(`no app here takes ${kind}`);
  const into = g || (focusedActor() || [])[0] || ((state.home && state.home.gatherers[0]) || {}).name;
  // an app opened anew each time (instances "many": the Files app's, the LaTeX editor's) with one open above the panes:
  // that one told, not another opened -- the first of the apps that take it that has one open (a LaTeX source: a
  // LaTeX editor's, else the Files app's); none open, the first is opened as its instances say (one per folder: the
  // file's folder's)
  const open = apps.map((a) => a.instances === "many"
    && panes.apps.find((q) => !q.held && q.app.name === a.name && q.instance.gatherer === into)).find(Boolean);
  if (open) return open.panel.intent(kind, data || {});
  // a web page (open-url), none shown: one the gatherer has open in no task -- so no agent's: a Browser a panel's link
  // opened before, its panel closed since -- shown again and told, not another opened each time (a page needs no
  // folder: any will do; for a file, the server's open picks the instance by its folder)
  if (kind === "open-url") {
    await readApps(into, true);
    const free = gathererApps(into).find((o) => o.app.name === app.name && appTaskOf(into, o.id) === null);
    const p = free && showAppPanel(app, free.inst);
    if (p) {
      renderAgents();
      return p.panel.intent(kind, data || {});
    }
  }
  const folder = data && data.path ? String(data.path).replace(/\/[^/]*$/, "") : null;
  const p = await openApp(into, app.name, folder);
  if (!p) throw new Error(`${app.label} could not be opened`);
  p.panel.intent(kind, data || {});
}
// An actor an app started, selected: its app's panel in the top row -- shown, if held out of sight -- as a DocWriter's
// actor showed DocWriter when it was its view. Any other actor: nothing opened.
async function showActorsApp(g, c) {
  if (SNAPSHOT) return;
  const k = taskKey(g, c);
  if (k && (tasksLaidOut.has(k) || taskLayout(k))) return;   // its task laid out, or remembered: its layout decides (enterTask)
  const gg = gathererNamed(g);
  const r = appRole(gg && gg.agents.find((a) => a.channel === c));
  const app = r && appHost.named(r.app);
  if (!app) return;
  const there = panes.apps.find((p) => p.instance.id === r.key);
  if (there) { showAppPanel(app, there.instance); return; }
  const inst = await appHost.instanceOf(app.name, g, r.key).catch(() => null);
  if (!inst || !isAt(state.selected, g, c)) return;
  showAppPanel(app, inst);
}
// The agent in focus, as the apps' panels are told it: the actor of the pane in focus.
function appsSelection() {
  const sel = focusedActor();
  return sel && !isShell(sel[1]) ? { gatherer: sel[0], channel: sel[1] } : null;
}
function appsSelected() {
  const sel = appsSelection();
  for (const p of panes.apps) p.panel.selection(sel);
}
// The apps' panels kept, opened again once the apps are known: those whose instance is still open; the actors below
// as the panes kept them (restorePanes), not opened again for them.
async function restoreAppPanes() {
  if (SNAPSHOT) return;
  renderApps();                                      // the model's (model.ts), as kept
  topLayout();
}
// ------------------------------------------------------------------ links
// A link clicked in an actor's pane -- in a message, in its terminal -- opened in a Browser of that actor's task, by
// app_kit's open-url intent (the Browser's panel takes it): the Browser attached to the actor -- the one whose panel
// shows, if several are -- in a new tab; with none, a new Browser in the actor's folder, put in its task (an actor
// alone made a task with it: task_links.py), opened at the link. Its panel shown above, selected; the actor's task
// entered first, if another is shown. Left as they were: a link to this dashboard or to no web page (mailto:, file:), a
// click with a key held (⌘, Ctrl, Shift, ⌥) or another button -- a tab of the browser's own, in the ag app the user's
// browser -- and a link where there is no agent to give a Browser: a terminal of its own, the gatherer agent's.
const LINK_APP = "browser";
const linkOpening = new Map(), linkMade = new Map();   // per actor: its links, opened one after another; the Browser
                                                        // a link made it (attachedTo's read may be a second old)
const webLink = (href) => {
  try {
    const u = new URL(href, location.href);
    return /^https?:$/.test(u.protocol) && u.origin !== location.origin ? u.href : "";
  } catch (e) { return ""; }
};
const plainClick = (ev) => !ev || (!ev.button && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey);
const appLink = (href) => isAppHref(href);
const fileLink = (href) => !!filePath(href);   // a file's path (openFileLink)
// Whether the page takes a click on a link to `href` shown with the actor of pane `p` (the one clicked in; this page's
// own, by default). A link to something in an app (ag://, openAppLink), or to a file -- file://, or a path in what an
// agent wrote (`path`: one Chat drew from its words, core/ui/md.ts's data-path; not one of the dashboard's own, as
// /api/image?…): openFileLink -- always, whatever key is held: never the browser's to open (a path, as a page of this
// dashboard's).
function linkClicked(href, ev, path = false, p = null) {
  const pane = p || paneAt(ev && ev.target) || panes.here, sel = pane.c ? [pane.g, pane.c] : [];
  if (appLink(href) || (fileLink(href) && (path || /^file:/i.test(String(href).trim())))) {
    if (ev && ev.button) return true;               // another button: nothing opened (nor by the browser)
    openLink(sel[0] || ((state.home && state.home.gatherers[0]) || {}).name, sel[1] || null, String(href).trim());
    return true;
  }
  const url = webLink(href);
  if (!url || !plainClick(ev) || SNAPSHOT || !sel.length) return false;
  return openLink(sel[0], sel[1], url);
}
// `url` opened for actor `c` of `gname`, if a Browser can be given it: false, nothing done (a link to something in an
// app: opened there, openAppLink; a file's path: in an app that shows files, openFileLink)
function openLink(gname, c, url) {
  if (appLink(url)) { openAppLink(gname, c, url).catch((e) => paneNote(e.message)); return true; }
  if (fileLink(url)) { openFileLink(gname, c, url).catch((e) => paneNote(e.message)); return true; }
  const g = gathererNamed(gname);
  const a = g && !isShell(c) ? actorOf(g, c) : null;
  const app = appHost.named(LINK_APP);
  if (!a || !app || isCoordinator(a)) return false;
  const k = key(gname, a.channel);
  const next = (linkOpening.get(k) || Promise.resolve()).then(() => linkInBrowser(g, a, app, url))
    .catch((e) => paneNote(`${app.label}: ${e.message}`));
  linkOpening.set(k, next);
  return true;
}
async function linkInBrowser(g, a, app, url) {
  await showItemsTask(g, a.channel);
  const k = key(g.name, a.channel), made = linkMade.get(k);
  const had = (await appHost.attachedTo(g.name, a.channel)).filter((i) => i.app === app.name);
  const shown = (id) => panes.apps.find((p) => !p.held && p.instance.id === id);
  let inst = (had.find((i) => shown(i.id)) || (made && shown(made) && shown(made).instance) || had[0]) || null;
  if (!inst) {
    const was = selectedTask();
    inst = await appHost.open(app.name, g.name, cwdOf(a) || null, a.channel);
    linkMade.set(k, inst.id);
    await readApps(g.name, true);                    // the task it made, as the server has it now
    retask(was);
  }
  const p = showAppPanel(app, inst);
  selectAppPane(p);
  p.panel.intent("open-url", { url });               // held by the panel's host until a new panel has connected
}
// ------------------------------------------------------------------ links to apps
// A link to something in an app (`ag://<app>/<path>[?instance=<id>][#<part>]`, app_kit/links.py) -- clicked in an
// actor's pane (`c`, the actor whose message it is in), or opened by a panel (the SDK's ag.links.open; `from`: its
// instance's folder and item) -- opened in the app: its panel shown, selected, and handed the link (its `link` intent:
// the SDK's ag.links.onOpen), which takes it there. Only a path of a form the app's manifest lists ([[links]]).
// THE INSTANCE, the first of:
//   1. the one the link names, if it is still open in the gatherer;
//   2. for an actor's link, one of its task's (one attached to it: the one whose panel shows, of several);
//   3. one whose panel is shown;
//   4. one open in the gatherer -- one that opens here (in no task, or in this one) before one of another task, and of
//      those one on the actor's folder (the panel's) first;
//   5. the gatherer's for that folder, from the server: one that opens a new one only where the gatherer has none of
//      the app (or none for the folder, of an app with one per folder) -- put in no task.
// WHERE: its panel shown, it is selected there; else, an instance of another task, that task shown as a click on the
// app's row shows it (features/list/list.js's selectApp) -- as a notification of the app's is opened; else its panel opened
// above what is shown. A click calls no tool and attaches no agent: the user only looks. What can't be opened: an error
// saying why.
async function openAppLink(gname, c, href, from = {}) {
  const h = parseHref(href);
  if (!h) throw new Error(`Not a link to anything in an app: ${href}`);
  const app = appHost.named(h.app);
  if (!app || app.failed) throw new Error(`No app called ${h.app} here, to open ${href}`);
  const m = matchPath(app.links, h.path);
  if (!m) throw new Error(`${app.label}: no such place to open (${h.path || "nothing"})`);
  const g = gathererNamed(gname);
  if (!g || SNAPSHOT) return;
  const a = c && !isShell(c) ? actorOf(g, c) : null;
  const here = a ? taskKey(gname, a.channel) : from.item ? taskKey(gname, from.item) : selectedTask();
  const shown = (id) => panes.apps.find((q) => !q.held && q.instance.id === id);
  const elsewhere = (id) => appTaskOf(gname, id) !== null && taskKey(gname, appItem(id)) !== here;
  const folder = (a && cwdOf(a)) || from.folder || null;
  let inst = null;
  if (h.instance) {
    inst = await appHost.instanceOf(app.name, gname, h.instance);
    if (!inst) throw new Error(`${app.label}: that one (${h.instance}) is closed`);
  }
  if (!inst && a) {
    const had = (await appHost.attachedTo(gname, a.channel)).filter((i) => i.app === app.name);
    inst = had.find((i) => shown(i.id)) || had[0] || null;
  }
  if (!inst) {
    const p = panes.apps.find((q) => !q.held && q.app.name === app.name && q.instance.gatherer === gname);
    if (p) inst = p.instance;
  }
  if (!inst) {
    await readApps(gname);
    const open = gathererApps(gname).filter((o) => o.app.name === app.name);
    const onFolder = (list) => (folder && list.find((o) => o.folder === folder)) || list[0];
    const o = onFolder(open.filter((x) => !elsewhere(x.id))) || onFolder(open.filter((x) => elsewhere(x.id)));
    if (o) inst = o.inst;
  }
  let fresh = false;
  if (!inst) {
    inst = await appHost.open(app.name, gname, folder);
    fresh = true;
  }
  let p = shown(inst.id) || null;
  if (!p && elsewhere(inst.id)) {                    // another task's: that task shown, its panel there
    const o = appInfo(gname, inst.id) || (await readApps(gname, true), appInfo(gname, inst.id));
    if (!o) throw new Error(`${app.label}: closed`);
    await selectApp(gname, o);
    p = panes.apps.find((q) => q.instance.id === inst.id);
    if (!p) throw new Error(`${app.label}: not shown`);
  } else if (!p) {
    fresh = !panes.apps.some((q) => q.instance.id === inst.id);
    p = showAppPanel(app, inst);
    selectAppPane(p);
  } else selectAppPane(p);
  // held by the panel's host until a panel just opened has connected
  p.panel.intent("link", { href: h.href, path: h.path, part: h.part, values: m.values, form: m.form });
  if (fresh) await readApps(gname, true);           // the list's rows, the app now open
}
// A FILE'S PATH an agent wrote (features/apps/links.ts's `file`: `[parser.py](src/parser.py#L12)`, file:///…, a path its
// terminal marks as a link) opened as a link to it (openAppLink) in an app that shows files -- one whose [[links]] take
// `file/<path...>` (FILE_FORM): the one whose FILE_FORM says `paths` (the app files open in, as its manifest says), else
// of several, one the actor has open, else the first installed. A relative path is from the actor's folder (a panel's:
// its instance's). None installed: an error saying so.
async function openFileLink(gname, c, href, from = {}) {
  const f = filePath(href);
  if (!f) throw new Error(`Not a file's path: ${href}`);
  const g = gathererNamed(gname);
  if (!g || SNAPSHOT) return;
  const a = c && !isShell(c) ? actorOf(g, c) : null;
  let path = f.path;
  if (!path.startsWith("/")) {
    const base = (a && cwdOf(a)) || from.folder;
    if (!base) throw new Error(`${path}: from which folder isn't known`);
    path = joinPath(base, path);
  }
  const takers = appHost.found().filter((x) => !x.failed && (x.links || []).some((l) => l.form === FILE_FORM));
  if (!takers.length) throw new Error(`No app here opens files, to open ${path}`);
  const plain = takers.find((x) => (x.links || []).some((l) => l.form === FILE_FORM && l.paths));
  let app = plain || takers[0];
  if (!plain && takers.length > 1 && a) {
    const had = await appHost.attachedTo(gname, a.channel);
    app = takers.find((x) => had.some((i) => i.app === x.name)) || app;
  }
  await openAppLink(gname, c, fileHref(app.name, path, f.line), from);
}
// A gatherer's start buttons, one for each harness a new session can run on here (the server's `harnesses`:
// in ag's config.toml, and installed): a click starts one, on the harness's default model, in the directory of
// the gatherer's most recently active actor -- or, when no actor has one (or starting there failed), the form
// asks for the directory first, its buttons the same.
const startable = () => (state.home.harnesses || []).filter(runsHere);
const noHarness = () => `None of ${runnableNames("or")} is set up. Install one, or set its command under [cli.harnesses] in config.toml.`;
// Last, its terminal button: a shell (isShell), in that same directory -- or, with none, the form asks for it too.
const SHELL_START = "shell";                       // the terminal button's, where a harness's name goes
const APP_START = "app:";                          // an app's with an agent of its own ([agent] offered): app:<name>:<harness>
const startAny = (gatherer, cwd, harness) => harness === SHELL_START ? startShell(gatherer, cwd)
  : harness.startsWith(APP_START) ? startWithApp(gatherer, cwd, ...appStart(harness))
  : startSession(gatherer, cwd, harness);
const appStart = (v) => { const [name, ...h] = v.slice(APP_START.length).split(":"); return [name, h.join(":")]; };
// THE APPS OFFERED, one order wherever they are listed (a group's "+ ⋯" menu, the new-tab page): each app once, by its
// name (openableApps), then a terminal -- "…" only on an entry that opens a box to fill in first. An app that can have an
// agent of its own (DocWriter, say) opens the way the reader chose on the Apps page (app_settings.py's `opens_with_agent`,
// yes until they say not): with a new actor attached to it (opensWithAgent), or on its own -- on its own also when no
// harness here can give an agent its tools (`tooled`). startingApps: those that open with one, which the list's form
// for a new actor also offers on each harness.
const byLabel = (x, y) => x.label.localeCompare(y.label);
const openableApps = () => (SNAPSHOT ? [] : appHost.found()).filter((a) => !a.failed).sort(byLabel);
const withAgentChosen = (a) => !!(a.agent && a.agent.offered && a.opens_with_agent !== false);
const opensWithAgent = (a, tooled) => withAgentChosen(a) && tooled.length > 0;
const startingApps = () => openableApps().filter(withAgentChosen);
const cwdOf = (a) => a.cwd || (a.session && a.session.cwd) || "";    // a session started here: its own, before any call names one
const startCwd = (g) => cwdOf(g.agents.filter(cwdOf).sort((x, y) => (y.last || 0) - (x.last || 0))[0] || {});
// A coordinator agent's button (CREW_START), on its node's row -- a group's, a folder's, a folder of groups', the list's
// head for everything: the agent shown, started over the node if it has none -- on the first harness a session can run
// on here, in the directory of the actor latest at work under the node (coordination.py's `ensure`). Shown as a click on
// its row shows an actor on its own: where it is open in a screen tab, else in a tab of its own (viaTabs) -- started,
// once listed, as any actor started.
const CREW_START = "crew", CREW_GROUP = "Coordinator agent";
// the directory a coordinator agent over `node` starts in: that of the actor latest at work under it
function crewCwd(node, g) {
  const kind = node.slice(0, Math.max(0, node.indexOf(":")));
  const under = kind === "folder" && g ? actorsWithin(g, +node.slice(node.indexOf(":") + 1))
    : kind === "group" && g ? g.agents
    : state.home.gatherers.filter((x) => !x.alone && (node === "all" || within(GF, gfOf(x.name), +node.slice(node.indexOf(":") + 1))))
      .flatMap((x) => x.agents);
  return cwdOf(under.filter((a) => cwdOf(a) && !isCoordinator(a)).sort((x, y) => (y.last || 0) - (x.last || 0))[0] || {});
}
async function openCoordinator(g, node = g ? `group:${g.name}` : "all") {
  const hk = crewHideKey(node);
  if (crewHidden.has(hk)) setCrewHidden(hk, false);
  const [cg, there] = crewAt(node, g);
  const view = CHAT_VIEWS.has("files") ? "files" : null;
  if (there) { await viaTabs(taskKey(cg.name, there.channel), {}, there.channel); return show(cg.name, there.channel, view); }
  state.starting = { gatherer: g ? g.name : "", harness: CREW_START, node };
  renderAgents();
  try {
    const s = await post("/api/coordinator", { over: node, cwd: crewCwd(node, g), harness: startable()[0] || "" });
    collapsed.delete(s.gatherer);
    await loadHome();
    await viaTabs(taskKey(s.gatherer, s.session_id), {});   // a tab of its own
    await show(s.gatherer, s.session_id, view);
  } catch (e) {
    if (g) state.adding = { gatherer: g.name, cwd: startCwd(g), harness: null, error: e.message };
    else alert(e.message);
  } finally { state.starting = null; renderAgents(); }
  const box = paneBox(focusedPane());
  if (box) box.focus();
}
// A node's coordinator agent, its face on the node's row (a group's just after its name): a click shows it (started if
// it has none), and, hidden from the list, its status at the face's corner.
function crewButton(g, node = g ? `group:${g.name}` : "all") {
  const hs = startable(), [, crew] = crewAt(node, g), hidden = !!crew && crewHidden.has(crewHideKey(node));
  if (!hs.length && !crew) return null;
  const [cls, label] = hidden ? statusOf(crew) : [null, null];      // hidden from the list: its status here
  const busy = state.starting && state.starting.harness === CREW_START && state.starting.node === node;
  const place = crewPlace(node, g), what = node === "all" ? "every group's actors" : node.startsWith("groups:")
    ? `the actors of the groups in ${place}` : node.startsWith("group:") ? "this group's actors" : `the actors in ${place}`;
  return el("button", { class: "act start crew" + (busy ? " busy" : "") + (crew ? " on" : ""), type: "button",
    ...(state.starting ? { disabled: "" } : {}),
    title: hidden ? `Coordinator agent over ${place} · ${label} · hidden from the list`
      : crew ? `Coordinator agent over ${place}`
      : `Start a coordinator agent for ${what}`,
    "aria-label": crew ? `The coordinator agent over ${place}` : `Start a coordinator agent over ${place}`,
    onclick: (ev) => { ev.stopPropagation(); openCoordinator(g, node); } },
    crewFace(crew, MANAGER), hidden ? el("i", { class: `crew-dot ${cls}`, "aria-hidden": "true" }) : null);
}
// A gatherer row's "+" -- and a folder's line's (`folder`: what it starts goes in it, folders.py), shown, on each, while
// it is hovered (features/list/Menus.tsx's StartPlus): ONE "+", everything that can start here, in one menu -- an actor
// on each harness, then an actor on a branch, the apps, a terminal (moreStarts) -- headed by where (the folder, else the
// group) and its directory. Its classes are both the old buttons' (new-actor, new-more): what started from either starts
// from it. Pressed, it aims what is started next at its folder, or its gatherer's top (aimStart): the actor filed there
// once started (fileStarted). With nothing to start (no items), its title says why.
function startMenu(g, folder = null) {
  const hs = startable(), cwd = startCwd(g), where = cwd ? tildePath(cwd, state.home.home_dir) : null;
  const fid = folder ? folder.id : null, place = folder ? folder.name : g.name, at = folder ? `:${fid}` : "";
  const ours = state.starting && state.starting.gatherer === g.name;
  const starting = ours && startIn.g === g.name && startIn.folder === fid ? String(state.starting.harness) : "";
  const key = `start:${g.name}${at}`;
  const items = [...hs.map((h) => ({ mark: harnessBadge(h), text: harnessName(h), run: () => addSession(g, h) })),
    ...(hs.length ? [{ sep: true }] : []), ...moreStarts(g, hs, where, key)];
  const busy = hs.includes(starting) || starting === SHELL_START || starting === BRANCH_START || starting.startsWith(APP_START);
  if (!items.some((it) => !it.sep)) return { key, busy: false, off: true, title: noHarness(), label: noHarness(), head: "", items: [] };
  return { key, busy, off: !!state.starting, title: `New in ${place}${where ? ` · ${where}` : ""}`, label: `New in ${place}`,
    head: `New in ${place}`, sub: where, items };
}
// Every drop-down of the page's open closed: one hung from a button by openPop, the branch drop-down
function closePops() { closePop(); brMenuClose(); }
// The "+ more" drop-down's starts: what each is (an app by its name and mark alone, no description under it; a branch and
// a terminal say where they work), and what choosing it does. `key`: its button's data-pop.
function moreStarts(g, hs, where, key = `more:${g.name}`) {
  const there = where ? `in ${where}` : "in a directory you choose";
  const tooled = hs.filter((h) => (harnessInfo(h) || {}).mcp);    // an app's agent: given its tools
  return [
    hs.length ? { icon: ICONS.branch, text: "Actor on a branch…", note: "in its own worktree, merged into the project",
      run: (button) => openBranchMenu(g, button) } : null,
    ...openableApps().map((a) => ({ icon: ICONS.app, mark: a.mark ? appMarkImg(a) : null,
      ...(opensWithAgent(a, tooled)
        ? { text: `${a.label}…`, run: (button) => openPop(key, button, appStartBox(g, tooled, a)) }   // and its actor
        : { text: a.label, run: () => openAppTab(g.name, a.name, startCwd(g)) }) })),
    // (where it opens: the menu's heading says it)
    state.home.terminals !== false ? { icon: ICONS.terminal, text: "Terminal", note: where ? null : there, run: () => addSession(g, SHELL_START) } : null,
  ].filter(Boolean);
}
// `key`: the button's data-pop (the list's "+ actor", or the rail's "+"); `start`: what a harness chosen does; `place`: the
// folder it starts in, named in its heading (else the directory's).
function openActorMenu(g, hs, button, key = `actor:${g.name}`, start = (h) => addSession(g, h), place = null) {
  const cwd = startCwd(g);
  const where = cwd ? tildePath(cwd, state.home.home_dir) : "";
  // headed by where it goes -- the folder, else the group, as the "+ ⋯" menu's -- its directory under that
  openPop(key, button, popMenu(`New actor in ${place || titleOf(g)}`,
    hs.map((h) => ({ mark: harnessBadge(h), text: harnessName(h), run: () => start(h) })), where, where));
}
// The "+ actor" and "+ ⋯" of a gatherer's or a folder's card in the rail (features/list/CardFolder.tsx's StartAct; `f`
// null: the gatherer's top): what each says (cardStart), and what a press does (cardStartPress). "+ actor": a new actor
// there, as the list's "+ actor" starts one -- on the one harness at once, or on the one picked from a drop-down -- in
// the directory of its gatherer's most recently active actor. With none (or starting there failed), a box under it asks
// for the directory first (railNewBox): the list's form, under its gatherer's row, is out of sight with the list
// folded. Pressed again, what it opened closes. "+ ⋯": the list's "+ more" drop-down, under it.
const railKey = (g, f = null) => `rail:${g.name}${f ? `:${f.id}` : ""}`;
const railMoreKey = (g, f = null) => `railmore:${g.name}${f ? `:${f.id}` : ""}`;
function cardStart(which, g, f = null) {
  const hs = startable(), place = f ? f.name : titleOf(g), off = !!state.starting;
  if (which === "more") {
    const key = railMoreKey(g, f), others = moreStarts(g, hs, null, key);
    if (!others.length) return null;
    return { key, disabled: off, busy: false, label: `More to start in ${place}`, haspopup: "menu", expanded: rowPop.key === key,
      title: `More to start in ${place}: ${others.map((o) => o.text.replace("…", "").toLowerCase()).join(", ")}` };
  }
  if (!hs.length) return { key: null, disabled: true, busy: false, title: noHarness(), label: noHarness(), haspopup: null, expanded: null };
  const key = railKey(g, f), cwd = startCwd(g), where = cwd ? tildePath(cwd, state.home.home_dir) : null;
  const busy = !!state.starting && state.starting.gatherer === g.name && startIn.folder === (f ? f.id : null)
    && hs.includes(String(state.starting.harness));
  const pops = hs.length > 1 || !cwd;
  return { key, disabled: off, busy, label: `New actor in ${place}`,
    title: `New actor in ${place}${where ? ` · ${where}` : ""} · ${hs.map(harnessName).join(" or ")}`,
    haspopup: pops ? (cwd ? "menu" : "dialog") : null, expanded: pops ? rowPop.key === key : null };
}
function cardStartPress(which, g, f, button) {
  const hs = startable(), place = f ? f.name : titleOf(g);
  if (which === "more") { aimStart(g.name, f ? f.id : null); openMoreMenu(g, hs, button, railMoreKey(g, f), place); return; }
  const key = railKey(g, f), cwd = startCwd(g);
  if (rowPop.key === key) return closePop();
  aimStart(g.name, f ? f.id : null);
  if (!cwd) openPop(key, button, railNewBox(g, hs));
  else if (hs.length > 1) openActorMenu(g, hs, button, key, (h) => railStart(g, h, key), f ? place : null);
  else railStart(g, hs[0], key);
}
async function railStart(g, harness, key = railKey(g)) {
  const cwd = startCwd(g);
  try { await startSession(g.name, cwd, harness); }
  catch (e) {
    const button = document.querySelector(`[data-pop="${CSS.escape(key)}"]`);
    if (button) openPop(key, button, railNewBox(g, startable(), harness, cwd, e.message));
    else setLive(`Not started: ${e.message}`);
  }
}
// The rail's box for a new actor: the directory it works in (the one tried, if starting there failed; else the dashboard's
// own), the folders the gatherer's actors work in a click away, and a button for each harness: a click on one starts it
// there, Enter the one tried (or the first). The box closes once it has started; why not, if it cannot, is said in it.
// `alone`: the list head's box for an actor on its own, run under `g` (features/list/group-moves.js's aloneNew) -- the folders any
// actor works in a click away.
function railNewBox(g, hs, harness = hs[0], cwd = "", error = "", alone = false) {
  const dir = tildePath(cwd || state.home.cwd || "", state.home.home_dir);
  const err = el("div", { class: "err", role: "alert", text: error });
  const input = el("input", { type: "text", value: dir, spellcheck: "false", "aria-label": "Working directory", placeholder: "~/projects/my-project",
    oninput: () => { err.textContent = ""; },
    onkeydown: (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(harness); } } });
  const go = async (h) => {
    const at = input.value.trim();
    if (!at) { err.textContent = "Which directory?"; input.focus(); return; }
    const buttons = [...box.querySelectorAll("button.go")];
    for (const b of buttons) b.disabled = true;
    try {
      await startSession(g.name, at, h, null, alone);
      if (rowPop.el === box) closePop();
    } catch (e) {
      if (box.isConnected) err.textContent = e.message; else setLive(`Not started: ${e.message}`);
    } finally { for (const b of buttons) b.disabled = false; }
  };
  const title = alone ? "New actor on its own" : `New actor in ${titleOf(g)}`;
  const box = el("div", { class: "dw-menu" + (alone ? " alone-box" : ""), role: "dialog", "aria-label": title },
    el("div", { class: "head", text: title }),
    alone ? el("div", { class: "note", text: "Shares context with no group." }) : null,
    el("label", {}, "Working directory", input),
    alone ? folderPicks(everyActor(), dir, input, err, "Where actors work") : folderPicks(g, dir, input, err),
    el("div", { text: "Run on" }),
    el("div", { class: "on" }, ...hs.map((h) => el("button", { type: "button", class: "go", onclick: () => go(h) }, harnessBadge(h), harnessName(h)))),
    err);
  return box;
}
function openMoreMenu(g, hs, button, key = `more:${g.name}`, place = titleOf(g)) {
  if (brPick.menu && brPick.menu.g === g.name) return brMenuClose();     // the branch drop-down it opened: pressed again
  const dir = startCwd(g) && tildePath(startCwd(g), state.home.home_dir);
  openPop(key, button, popMenu(`New in ${place}`, moreStarts(g, hs, dir, key), dir, dir));
}
// A drop-down's choices (features/layout/Pops.tsx's menu): its heading, then an item for each choice -- its mark, what it
// is, and a note under it. `sub`: a second line under its heading, muted (where a new actor would work); `cls`, a class
// of its own (the new-tab page's: one that scrolls).
function popMenu(head, items, title, sub, cls) {
  return { menu: { head, items, title, sub, cls } };
}
// A drop-down or a box of the page's ("+ actor"'s drop-down, "+ more"'s, the DocWriter box one of those opens, a panel's
// moves, the new-tab page's): hung from a button -- `key`, that button's data-pop, so found again after the list is drawn
// again -- outside the list, so it may reach past the list's edge without the list scrolling, and the list's redraws leave
// it be: Radix's (features/layout/Pops.tsx), which closes it by its button pressed again, a press elsewhere, Esc, the page
// resizing, or the page or a box holding its button scrolling. `rowPop`: what is open -- its button's key, and its node
// (a box's; a menu's, its content).
const rowPop = { key: "", el: null };
const popButton = () => rowPop.key && document.querySelector(`[data-pop="${CSS.escape(rowPop.key)}"]`) || null;
// the one open, closed: its button told, the card it hung from let go of (unless the pointer is on it); an Esc's, the
// focus back on its button
function popClosed(pop, how = "away") {
  if (rowPop.key !== pop.key) return;
  const button = popButton() || pop.anchor;
  Object.assign(rowPop, { key: "", el: null });
  if (button) button.setAttribute("aria-expanded", "false");
  cardRelease();
  if (how === "esc" && button && button.isConnected) button.focus();
}
function closePop() {
  const pop = popShown();
  if (!pop) return;
  showPop(null);
  popClosed(pop);
}
// `what`: a menu (popMenu), or a box -- the page's node, a form to fill in. The same menu's button pressed again: closed.
function openPop(key, button, what) {
  const again = rowPop.key === key && !!what.menu;
  closePop();
  brMenuClose();
  if (again) return;
  const pop = what.menu ? { key, anchor: button, menu: what.menu } : { key, anchor: button, box: what };
  Object.assign(rowPop, { key, el: what.menu ? null : what });
  button.setAttribute("aria-expanded", "true");
  showPop(pop);
  if (what.menu) rowPop.el = document.querySelector(".br-menu.row-menu[role=menu]") || {};
}
// The folders a gatherer's actors work in, newest first, under a box's folder `input` (its `dir` to start with): another
// a click away. null: none other than `dir`.
function folderPicks(g, dir, input, err, label = "Where its actors work") {
  const seen = new Set(), folders = [];
  for (const a of [...g.agents].sort((x, y) => (y.last || 0) - (x.last || 0))) {
    const d = cwdOf(a);
    if (d && !seen.has(d)) { seen.add(d); folders.push(tildePath(d, state.home.home_dir)); }
  }
  return folders.length > 1 || (folders.length === 1 && folders[0] !== dir) ? el("div", { class: "folders" },
    el("div", { class: "lbl", text: label }),
    ...folders.slice(0, 5).map((d) => el("button", { type: "button", title: d,
      onclick: () => { input.value = d; err.textContent = ""; input.focus(); input.setSelectionRange(d.length, d.length); } },
      el("span", { class: "nm", text: d.replace(/\/+$/, "").split("/").pop() || d }), el("span", { class: "at", text: d })))) : null;
}
const appMarkImg = (a) => el("img", { class: "app-mark", src: `/apps/mark/${encodeURIComponent(a.name)}.svg`, alt: "", draggable: "false" });
// A new one of an app with an agent of its own (DocWriter, say) -- and its actor -- in a folder of the reader's choice:
// its box asks which (the gatherer's current one to start with, the folders its actors work in a click away) and the
// harness its actor runs on: a click on one starts it.
function appStartBox(g, hs, app) {
  const cwd = startCwd(g), dir = cwd ? tildePath(cwd, state.home.home_dir) : "";
  const err = el("div", { class: "err", role: "alert" });
  const input = el("input", { type: "text", value: dir, spellcheck: "false", "aria-label": "Folder", placeholder: "~/writing/my-paper",
    oninput: () => { err.textContent = ""; },
    onkeydown: (ev) => { if (ev.key === "Enter") { ev.preventDefault(); appGo(g, hs[0], box, app); } } });
  const box = el("div", { class: "dw-menu", role: "dialog", "aria-label": `New ${app.label}` },
    el("div", { class: "head", text: `New ${app.label}` }),
    el("label", {}, "Folder", input),
    folderPicks(g, dir, input, err),
    el("div", { text: "Run its agent on" }),
    el("div", { class: "on" }, ...hs.map((h) => el("button", { type: "button", class: "go", onclick: () => appGo(g, h, box, app) },
      harnessBadge(h), harnessName(h)))),
    err);
  return box;
}
// One started from its box, in the folder typed there: the box closed once it is, and why not, if it cannot be,
// said in it.
async function appGo(g, harness, box, app) {
  const input = box.querySelector("input"), err = box.querySelector(".err"), cwd = input.value.trim();
  if (!cwd) { err.textContent = "Which folder?"; input.focus(); return; }
  const go = [...box.querySelectorAll("button.go")];
  for (const b of go) b.disabled = true;
  try {
    await startWithApp(g.name, cwd, app.name, harness);
    if (rowPop.el === box) closePop();
  } catch (e) {
    if (box.isConnected) err.textContent = e.message; else setLive(`Not started: ${e.message}`);
  } finally { for (const b of go) b.disabled = false; }
}
async function addSession(g, harness) {
  const cwd = startCwd(g);
  if (harness && cwd) {
    try { return await startAny(g.name, cwd, harness); }
    catch (e) { state.adding = { gatherer: g.name, cwd, harness, error: e.message }; }
  } else state.adding = { gatherer: g.name, cwd, harness };
  if (listMode === "folded") setListMode("list");     // its form is the list's: in sight
  renderAgents();
  const first = document.querySelector(".newform input");
  if (first) first.focus();
}
// The new session shown in Chat, its message box ready: its agent starts with its first message. Listed before it is
// shown: drawn at once, the box there to take the focus.
// `join`, for one added to a task (features/list/list.js's addToTask): what puts it there, once started -- where it is filed --
// and it shown beside the actor it was added to, the rest as any other's. `alone`: an actor on its own from its start,
// run under `gatherer` (features/list/group-moves.js's aloneNew): filed in no folder, listed as its group of one. -> the session.
// Where it started kept for the next new tab (features/layout/new-tab.js's keptStart), but for one added to a task.
async function startSession(gatherer, cwd, harness, join = null, alone = false) {
  state.starting = { gatherer: alone ? ALONE_NEW : gatherer, harness };
  renderAgents();
  let s;
  try {
    s = await post("/api/sessions", { gatherer, cwd, harness, ...(alone ? { alone: true } : {}) });
    if (!join) { keptStart(gatherer, alone); keptHarness(harness); }
    if (join) await join(s); else if (!alone) await fileStarted(gatherer, s.session_id);
    state.adding = null;
    collapsed.delete(s.gatherer);
    await loadHome();
    if (join && state.selected && !appsOnlyKey()) await openBeside(s.gatherer, s.session_id, "files");
    else { await viaTabs(taskKey(s.gatherer, s.session_id), {}); await show(s.gatherer, s.session_id, "files"); }   // a tab of its own
  } finally { state.starting = null; renderAgents(); }
  const box = paneBox(focusedPane());
  if (box) box.focus();
  return s;
}
// One of an app with an agent of its own started (app_agents.py's `start`): its actor listed and shown, its panel above.
async function startWithApp(gatherer, cwd, name, harness) {
  state.starting = { gatherer, harness: `${APP_START}${name}:${harness}` };
  renderAgents();
  try {
    const got = await appHost.start(name, gatherer, cwd, harness);
    keptStart(gatherer);
    await fileStarted(gatherer, got.session.session_id);
    state.adding = null;
    collapsed.delete(gatherer);
    await loadHome();
    await viaTabs(taskKey(gatherer, got.session.session_id), {});   // a tab of its own (features/layout/panes.js)
    await show(gatherer, got.session.session_id, "files");
    const app = appHost.named(name);
    if (app) {
      showAppPanel(app, got.instance);
    }
  } finally { state.starting = null; renderAgents(); }
}
// A shell started: shown in the pane in focus, its terminal opened at once (sessions.py's `shell`), at the size of the
// terminal this page draws now, if it draws one (fitted to its pane once drawn there).
async function startShell(gatherer, cwd) {
  state.starting = { gatherer, harness: SHELL_START };
  renderAgents();
  try {
    const shown = focusedPane(), t = shown && shown.c ? termOf(shown.c) : null;   // the terminal the pane in focus draws
    const size = t && t.opened && t.host.isConnected ? { cols: t.xterm.cols, rows: t.xterm.rows } : {};
    const folder = shellFolder(gatherer);            // opened in the folder aimed at, listed there
    const s = await post("/api/shells", { gatherer, cwd, ...size, ...(folder !== null ? { folder } : {}) });
    keptStart(gatherer, false, folder);
    state.adding = null;
    collapsed.delete(gatherer);
    await loadHome();                                // listed before it is shown: its pane's head says where it is
    await show(gatherer, s.id);
  } finally { state.starting = null; renderAgents(); }
}
// An actor on a branch of its own (branches.py): made from one of the gatherer's PROJECTS -- the git repositories set for
// it, each a clone here -- in a worktree beside it, on a new branch from its last commit; what it changes there merged
// into the project's folder (the one the Editor shows) as it changes it, but for the lines being edited in the Editor
// (its conflict zone) and those the project changed too, which wait for the reader -- and, with "auto-merge with
// approval", every change waits (kept in this browser, as the last choice). Its button opens a drop-down of the gatherer's
// sources (its projects) and "Add a source…"; either opens a popup to start it from.
const BRANCH_START = "branch", BRANCH_APPROVE_KEY = "ag-branch-approve";
const branchOf = (g, a) => ((state.home && state.home.branches) || []).find((b) => b.gatherer === g && b.channel === a.channel) || null;
const branchWaiting = (b) => Object.values(b.held || {}).reduce((n, v) => n + v.n, 0);
// What a folder has checked out (branches.py's `checked_out`): its branch, or its commit alone.
const checkedOut = (o) => !o || !o.head ? "?" : o.branch || `${o.head} (no branch)`;
// Where an actor's branch came from, and where its changes go: said whole, for a title.
const branchRoute = (b) => `Branch ${b.branch} in ${tildePath(b.worktree, state.home.home_dir)}, `
  + `from ${b.started_on || "a commit"} at ${(b.start || "").slice(0, 7)}.\n`
  + `Merges into ${tildePath(b.project, state.home.home_dir)} (on ${checkedOut(b.onto)})`
  + `${b.approve ? " after you approve each change" : ". Lines you're editing or also changed wait for you"}.`;
function branchChip(g, a) {
  const b = branchOf(g.name, a);
  if (!b) return null;
  const n = branchWaiting(b);
  return el("div", { class: "branchline", title: branchRoute(b) + (n ? `\n${plural(n, "change")} to approve in the LaTeX editor` : "") },
    strokeIcon(ICONS.branch, 11), el("span", { class: "rt", text: `${b.branch} → ${checkedOut(b.onto)}` }),
    n ? el("span", { class: "wait", text: `${n} to approve` }) : null);
}
// The directories the gatherer's actors work in, the latest first: where its sources are suggested from.
const actorDirs = (g) => [...new Set([...g.agents].sort((x, y) => (y.last || 0) - (x.last || 0)).map(cwdOf).filter(Boolean)
  .concat(state.home.cwd ? [state.home.cwd] : []))];
const projectName = (p) => p.github || p.name;
// The branch button's drop-down: the gatherer's sources so far (its projects), each opening the popup with it chosen, and
// "Add a source…", opening it at the choice of one. Closed by a press elsewhere, Esc, or the page scrolling or resizing.
// Outside the list, so the list's redraws leave it be.
const brPick = { g: "", menu: null, dialog: null, projects: [], suggestions: [], dirs: [], project: "", choosing: false,
  where: "", error: "", busy: false, approve: false };
async function brLoad(g) {
  brPick.dirs = actorDirs(g);
  const got = await get(`/api/projects?${new URLSearchParams({ gatherer: g.name, dirs: JSON.stringify(brPick.dirs) })}`);
  Object.assign(brPick, { projects: got.projects, suggestions: got.suggestions });
}
function brMenuClose() {
  const m = brPick.menu;
  if (!m) return;
  brPick.menu = null;
  m.el.remove();
  document.removeEventListener("pointerdown", m.away, true);
  document.removeEventListener("keydown", m.esc, true);
  window.removeEventListener("resize", brMenuClose);
  window.removeEventListener("scroll", brMenuClose, true);
  m.button.setAttribute("aria-expanded", "false");
}
async function openBranchMenu(g, button) {
  if (brPick.menu && brPick.menu.g === g.name) return brMenuClose();
  brMenuClose();
  const box = el("div", { class: "br-menu", role: "menu", "aria-label": `New actor on a branch, in ${g.name}` },
    el("div", { class: "hd", text: "Loading sources…" }));
  const m = brPick.menu = { g: g.name, el: box, button,
    away: (ev) => { if (!box.contains(ev.target) && !button.contains(ev.target)) brMenuClose(); },
    esc: (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); brMenuClose(); button.focus(); } } };
  document.body.append(box);
  const r = button.getBoundingClientRect();
  box.style.top = `${Math.round(r.bottom + 4)}px`;
  box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)))}px`;
  button.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", m.away, true);
  document.addEventListener("keydown", m.esc, true);
  window.addEventListener("resize", brMenuClose);
  window.addEventListener("scroll", brMenuClose, true);
  let error = "";
  try { await brLoad(g); } catch (e) { error = e.message; }
  if (brPick.menu !== m) return;
  const pick = (p) => () => { brMenuClose(); openBranchDialog(g, p ? p.path : null); };
  box.replaceChildren(
    el("div", { class: "hd", text: error || (brPick.projects.length ? "New actor on a branch of" : "No sources yet") }),
    ...brPick.projects.map((p) => el("button", { type: "button", role: "menuitem", title: `${p.path}${p.remote ? "\n" + p.remote : ""}`,
      onclick: pick(p) },
      el("span", { class: "nm", text: projectName(p) }), el("span", { class: "on", text: checkedOut(p) }),
      el("span", { class: "at", text: tildePath(p.path, state.home.home_dir) }))),
    brPick.projects.length ? el("div", { class: "sep" }) : null,
    el("button", { type: "button", role: "menuitem", class: "add", onclick: pick(null) }, "+ Add a source…"));
  box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)))}px`;
  const first = box.querySelector("button");
  if (first) first.focus();
}
// The popup: the source (chosen in the drop-down, or here -- among the gatherer's, the repositories its actors work in,
// or a folder or GitHub repository typed), where the branch comes from and where its changes go, whether each change
// waits for approval (the last choice, kept in this browser), and the harness that starts it.
async function openBranchDialog(g, project) {
  brPick.approve = prefs.flag(BRANCH_APPROVE_KEY);
  Object.assign(brPick, { g: g.name, project: project || "", choosing: !project, where: "", error: "", busy: false });
  if (!brPick.dialog) {
    brPick.dialog = el("dialog", { class: "br-dialog", "aria-label": "New actor on a branch" });
    brPick.dialog.addEventListener("close", () => { brPick.g = ""; });
    brPick.dialog.addEventListener("click", (ev) => { if (ev.target === brPick.dialog) brPick.dialog.close(); });   // the backdrop
    document.body.append(brPick.dialog);
  }
  brRender();
  if (!brPick.dialog.open) brPick.dialog.showModal();
  const first = brPick.dialog.querySelector(brPick.choosing ? ".br-add input" : "button[type=submit]");
  if (first) first.focus();
}
async function brSources(body) {
  brPick.busy = true; brPick.error = ""; brRender();
  try {
    const had = new Set(brPick.projects.map((p) => p.path));
    const got = await post("/api/projects", { gatherer: brPick.g, dirs: brPick.dirs, ...body });
    Object.assign(brPick, { projects: got.projects, suggestions: got.suggestions });
    const added = got.projects.find((p) => !had.has(p.path));
    if (added) Object.assign(brPick, { project: added.path, where: "", choosing: false });
    if (!got.projects.some((p) => p.path === brPick.project)) Object.assign(brPick, { project: "", choosing: true });
  } catch (e) { brPick.error = e.message; }
  brPick.busy = false;
  brRender();
}
function brRender() {
  const d = brPick.dialog, g = brPick.g, hs = startable(), home = state.home.home_dir;
  if (!d) return;
  const chosen = brPick.projects.find((p) => p.path === brPick.project);
  const busy = brPick.busy ? { disabled: "" } : {};
  const form = el("form", { class: "newform", method: "dialog" });
  let source;
  if (brPick.choosing || !chosen) {
    const where = el("input", { value: brPick.where, placeholder: "a folder in a git repository, or owner/repo", spellcheck: "false",
      "aria-label": "A folder in a git repository, or a GitHub repository", oninput: (ev) => { brPick.where = ev.target.value; },
      onkeydown: (ev) => { if (ev.key === "Enter") { ev.preventDefault(); if (brPick.where.trim()) brSources({ add: brPick.where.trim() }); } } });
    source = [
      brPick.projects.length ? el("div", { class: "projects" }, el("div", { class: "lbl", text: `${g}'s sources` }),
        ...brPick.projects.map((p) => el("div", { class: "br-row" + (p.path === brPick.project ? " on" : "") },
          el("button", { type: "button", class: "use", title: p.path, ...busy,
            onclick: () => { Object.assign(brPick, { project: p.path, choosing: false, error: "" }); brRender(); } },
            el("span", { class: "nm", text: projectName(p) }), el("span", { class: "at", text: tildePath(p.path, home) }),
            el("span", { class: "on", text: checkedOut(p) })),
          el("button", { type: "button", class: "rm", title: `Remove from ${g}'s sources. Existing branches are kept.`,
            "aria-label": `Remove ${projectName(p)}`, ...busy, onclick: () => brSources({ remove: p.path }) }, strokeIcon(ICONS.x, 14))))) : null,
      brPick.suggestions.length ? el("div", { class: "projects" }, el("div", { class: "lbl", text: "Where its actors work" }),
        ...brPick.suggestions.map((p) => el("button", { type: "button", class: "suggest", title: `${p.path}${p.remote ? "\n" + p.remote : ""}`,
          ...busy, onclick: () => brSources({ add: p.path }) },
          el("span", { text: `+ ${projectName(p)}` }), el("span", { class: "at", text: tildePath(p.path, home) })))) : null,
      el("div", { class: "projects br-add" }, el("div", { class: "lbl", text: "Another source" }),
        el("div", { class: "addrow" }, where, el("button", { type: "button", ...busy,
          onclick: () => { if (brPick.where.trim()) brSources({ add: brPick.where.trim() }); } }, brPick.busy ? "Adding…" : "Add")),
        el("div", { class: "desc", text: "A GitHub repository with no clone here is cloned under ag's home." })),
    ];
  } else {
    source = [el("div", { class: "br-src" },
      el("div", { class: "top" }, el("span", { class: "nm", text: projectName(chosen) }),
        el("span", { class: "at", title: chosen.path, text: tildePath(chosen.path, home) }),
        el("button", { type: "button", class: "link", onclick: () => { brPick.choosing = true; brRender(); } }, "Change")),
      el("div", { class: "desc route" }, "A new branch off ", el("code", { text: checkedOut(chosen) }),
        ` at ${chosen.head || "?"}, merged into `, el("code", { text: tildePath(chosen.path, home) }), " on ",
        el("code", { text: checkedOut(chosen) }), "."))];
  }
  const approve = el("input", { type: "checkbox", checked: brPick.approve ? "" : null, onchange: (ev) => {
    brPick.approve = ev.target.checked;
    prefs.setFlag(BRANCH_APPROVE_KEY, brPick.approve);
  } });
  const ready = chosen && !brPick.choosing && !brPick.busy && !state.starting;
  const starts = hs.map((h) => el("button", { type: "submit", value: h, ...(ready ? {} : { disabled: "" }) },
    harnessBadge(h), harnessName(h)));
  form.append(...[
    el("div", { class: "br-title" }, el("h3", {}, strokeIcon(ICONS.branch, 15), "New actor on a branch"),
      el("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => d.close() }, strokeIcon(ICONS.x, 16))),
    el("div", { class: "desc", text: `In ${g}. Works in its own worktree on a new branch from the source's last commit. Its changes are merged into the source's folder as it makes them.` }),
    el("div", { class: "lbl", text: "Source" }),
    ...source,
    el("label", { class: "check", title: "When off, changes merge as they come. Lines you're editing in the LaTeX editor, or also changed, wait for you." },
      approve, el("span", {}, el("b", { text: "Auto-merge with approval" }), ": accept or reject each change in the LaTeX editor")),
    el("div", { class: "err", role: "alert", text: brPick.error || (hs.length ? "" : noHarness()) }),
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => d.close() }, "Cancel"), ...starts),
  ].filter(Boolean));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!chosen || brPick.choosing) return;
    const harness = ev.submitter ? ev.submitter.value : hs[0];
    brPick.busy = true; brRender();
    try { await startBranch(g, chosen.path, harness, brPick.approve); d.close(); }
    catch (e) { brPick.error = e.message; brPick.busy = false; brRender(); }
  });
  d.replaceChildren(form);
}
async function startBranch(gatherer, project, harness, approve) {
  state.starting = { gatherer, harness: BRANCH_START };
  renderAgents();
  try {
    const s = await post("/api/branches", { gatherer, project, harness, approve });
    await fileStarted(gatherer, s.session_id);
    state.adding = null;
    collapsed.delete(s.gatherer);
    await loadHome();
    await viaTabs(taskKey(s.gatherer, s.session_id), {});   // a tab of its own
    await show(s.gatherer, s.session_id, "files");
  } finally { state.starting = null; renderAgents(); }
  const box = paneBox(focusedPane());
  if (box) box.focus();
}
function newForm() {
  const adding = state.adding, fixed = adding.gatherer, hs = startable(), shell = adding.harness === SHELL_START;
  const cwd = el("input", { name: "cwd", value: adding.cwd || state.home.cwd || "", spellcheck: "false" });
  const err = el("div", { class: "err", role: "alert", text: adding.error || (hs.length || shell ? "" : noHarness()) });
  const starts = hs.map((h) => el("button", { type: "submit", value: h, class: h === adding.harness ? "primary" : "",
    ...(state.starting ? { disabled: "" } : {}) }, harnessBadge(h), harnessName(h)));
  const tooled = hs.filter((h) => (harnessInfo(h) || {}).mcp);
  for (const a of tooled.length ? startingApps() : []) for (const h of tooled) starts.push(el("button", { type: "submit",
    value: `${APP_START}${a.name}:${h}`, class: adding.harness === `${APP_START}${a.name}:${h}` ? "primary" : "",
    title: `${a.label} with its agent on ${harnessName(h)}`, ...(state.starting ? { disabled: "" } : {}) },
    a.mark ? appMarkImg(a) : strokeIcon(ICONS.app, 14), a.label, harnessBadge(h)));
  if (state.home.terminals !== false) starts.push(el("button", { type: "submit", value: SHELL_START, class: shell ? "primary" : "",
    ...(state.starting ? { disabled: "" } : {}) }, strokeIcon(ICONS.terminal, 14), "Terminal"));
  const appAt = String(adding.harness || "").startsWith(APP_START) ? appHost.named(appStart(adding.harness)[0]) : null;
  const form = el("form", { class: "newform", "aria-label": "New session" },
    el("div", { class: "desc", text: shell ? `New terminal in ${fixed}` : appAt ? `New ${appAt.label} in ${fixed}`
      : `New actor in ${fixed}` }),
    el("label", {}, "Working directory", cwd),
    err,
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => { state.adding = null; renderAgents(); } }, "Cancel"), ...starts));
  // Enter starts the harness last chosen (the primary), not the first of the buttons; with none chosen (a new
  // gatherer's first session), no harness is marked, and Enter waits for a click
  cwd.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const chosen = starts.find((b) => b.classList.contains("primary"));
    if (chosen) form.requestSubmit(chosen);
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const harness = ev.submitter ? ev.submitter.value : adding.harness;
    Object.assign(adding, { cwd: cwd.value.trim(), harness, error: "" });
    try { await startAny(fixed, adding.cwd, harness); }
    catch (e) { adding.error = e.message; renderAgents(); }
  });
  return form;
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  panes.here = makePane(herePane(), true, { view: prefs.text(CHAT_VIEW_KEY) || "files" });
  startPops({ icon: (icon, size) => strokeIcon(ICONS[icon] || icon, size), closed: popClosed });   // (an icon: its path)
  shadow.update(model.focusOn, null, true);          // (focus: this page's own pane)
  if (!SNAPSHOT) window.addEventListener("blur", () => setTimeout(() => {   // the focus gone into an app's frame
    if (document.activeElement && document.activeElement.localName === "iframe") pressedAway();   // (any frame's: one of a page no panel runs)
    const p = panes.apps.find((q) => q.frame === document.activeElement);
    if (p && appSelected() !== p.instance.id) selectAppPane(p);
  }, 0));
  if (!SNAPSHOT) { try { if (window.agApp && window.agApp.onPressed) window.agApp.onPressed(pressedAway); } catch (e) { /* not the app */ } }
  // ⌃Tab (⌃⇧Tab: back) in the ag app -- a browser keeps those keys for its own tabs: the next screen tab shown
  if (!SNAPSHOT) document.addEventListener("keydown", (ev) => {
    if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.key !== "Tab") return;
    let app = false;
    try { app = !!window.top.agApp; } catch (e) { /* not ours */ }
    if (!app) return;
    ev.preventDefault();
    if (workPlacer) workPlacer.tabs.step(ev.shiftKey ? -1 : 1);
  }, true);
  if (!SNAPSHOT) {
    const head = document.querySelector("#pane-here > .pane-top");
    if (head) head.draggable = true;
    const from = (ev) => (ev.target.closest ? ev.target.closest(MOVE_FROM) : null);
    const panel = (f) => (f.matches(".lay-strip") ? f : f.closest("#panes > .pane"));   // a task's strip: the task
    const busy = () => !!(movePress && movePress.closest && movePress.closest("button, input, textarea, select, a, [contenteditable]"));
    document.addEventListener("pointerdown", (ev) => { movePress = ev.target; }, true);
    document.addEventListener("dragstart", (ev) => {
      const f = from(ev);
      if (!f) return;
      if (busy() || !moveStart(panel(f))) { ev.preventDefault(); return; }
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("application/x-ag-panel", "1");
    });
    document.addEventListener("dragend", (ev) => { if (from(ev)) moveEnd(); });
    document.addEventListener("contextmenu", (ev) => {
      const f = from(ev);
      if (!f || (ev.target.closest && ev.target.closest("input, textarea, [contenteditable]"))) return;
      if (moveMenu(panel(f), ev.clientX, ev.clientY)) ev.preventDefault();
    });
  }
  NARROW.addEventListener("change", () => { panes.top = null; topRow("here", tops.get("here") || 0); });
  panes.apps = [];
  if (!SNAPSHOT) document.addEventListener("click", (ev) => {
    const a = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download") || ev.defaultPrevented || !a.closest("#panes > .pane")) return;
    if (!linkClicked(a.getAttribute("href"), ev, a.hasAttribute("data-path"))) return;
    ev.preventDefault();
    ev.stopPropagation();                              // a link's click: not also its message's
  }, true);
}

export {
  renderApps, appClosed, showAppPanel, CREW_GROUP, actorPanes, openCoordinator, addAppPane, appMarkImg, appPaneTask, appPanelMenu, appSelected, appsAtWork, appsOnlyKey,
  appsOnlyLeft, appsSelected, branchChip, byLabel, closeAppPane, closeHere, closeHerePane, closePane, closePop,
  closedInTabs, crewButton, cwdOf, drawWho, enterAppTask, focusPane, focusedActor, focusedPane, folderPicks, holdAppPane, isAt,
  isAway, linkClicked, moveEnd, newForm, noHarness, openActors, openApp, openAppTab, openPop, openTaskBeside, opensWithAgent, paneNote,
  openTaskHere, paneGiven, paneSig, pick, pickBeside, placeIfShown, placeWork, popButton, popMenu,
  cardStart, cardStartPress, railNewBox, rekeyTask, retarget, rememberTask, restoreAppPanes, restorePanes, rowPop, saveAppPanes,
  savePanes, selectAppPane, selectedTask, setAutoShown, show, showActorsApp, shownPanels, startMenu, startCwd, closePops,
  startPlacing, startSession, startShell, startTabs, startWithApp, startable, swapAppPane, taskAppsOpening, taskKey,
  taskLayout, tasksLaidOut, topLayout, unselectApp, viaTabs, watchTop, workPlacer,
};
