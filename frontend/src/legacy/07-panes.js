// ------------------------------------------------------------------ panes
// Actors side by side. A click in the list shows its actor in the pane in focus; Ctrl+click (⌘+click on a
// Mac, where Ctrl+click is a right click) opens it in a new pane at that one's right, up to MAX_PANES. An actor
// open in a pane already is not opened twice: its pane is focused. A click in a pane focuses it; its × closes
// it; the bar between two resizes them (a double click: all even). The first pane is this page's own view
// (state.selected, panes.here); each other is this page again in a frame (PANE), showing one actor in its own
// view, its controls in its pane's head, its updates handed to it from this page's one stream (connect). Kept
// in this browser while there is more than one; with one, the page is as it always was.
const MAC = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");
const BESIDE_KEY = MAC ? "⌘" : "Ctrl";
panes.here = { node: document.getElementById("pane-here"), size: 1 };
panes.focus = panes.here;
function isAt(sel, g, c) { return !!sel && sel[0] === g && sel[1] === c; }
function allPanes() { return [panes.here, ...panes.others]; }
const actorPanes = () => panes.others;           // every pane is an actor's: apps' panels are in the top row (below)
// The actors open in this page's panes, this page's own first; the one in the pane in focus.
function openActors() { return PANE ? [] : [...(state.selected ? [state.selected] : []), ...actorPanes().map((p) => [p.g, p.c])]; }
function focusedActor() {
  const p = panes.focus;
  return p === panes.here || !panes.others.includes(p) ? state.selected : [p.g, p.c];
}
function paneSig() { return [state.selected, panes.others.map((p) => [p.g, p.c]), allPanes().indexOf(panes.focus), appSel]; }
function paneOf(win) { return panes.others.find((p) => p.frame.contentWindow === win) || null; }
// A row of the list clicked: shown in the pane in focus, or (Ctrl/⌘) beside it -- where its task is open, first (viaTabs).
// An actor that is a task of its own (07-panes.js's TASKS), with ⌘/Ctrl: it and its apps beside (openTaskBeside); one in a
// task with others, it alone beside.
async function pick(g, c, ev) {
  const beside = !!(ev && (ev.ctrlKey || ev.metaKey) && !SNAPSHOT);
  if (await viaTabs(taskKey(g, c), ev, c) || !beside) return show(g, c);
  await outOfAppsOnly(g, c);
  const k = taskKey(g, c);
  return k && !k.startsWith(`${g}\u0000t`) ? openTaskBeside(g, k, c) : openBeside(g, c);
}
function pickBeside(g, c, ev) {
  if (!MAC || !ev.ctrlKey || SNAPSHOT || ev.target.closest(".close-btn, .save-btn")) return;   // a Mac's Ctrl+click: a right click, no click after it
  ev.preventDefault();
  openBeside(g, c);
}
// TASKS: the panels follow the task shown: one of several items (05-agent-list.js's TASKS: actors and apps), else an
// item alone, an actor or an app -- a terminal and a gatherer agent are in none (`taskKey` null). An actor shown in the
// pane in focus (show) of another task than the one shown before: the panes beside of the task left are closed (terminals
// kept), and so are the apps' panels of other tasks (one whose agent is at work held out of sight, as closing it does);
// the new task's actor taken into this page's pane, and its apps' panels opened above (openTaskApps). A task of apps only
// entered (enterAppTask): its apps' panels alone, the actors' panes out of sight (`appsOnly`).
const TASK_APPS = 3;                                 // the apps' panels a task opens at most
function taskKey(g, c) {
  if (!g || !c || isShell(c)) return null;
  if (isAppItem(c)) {                                // an app's instance, "app:<id>"
    const t = appTaskOf(g, c.slice(APP_ITEM.length));
    return t === null ? `${g}\u0000${c}` : `${g}\u0000t${t}`;
  }
  const gg = state.home && state.home.gatherers.find((x) => x.name === g);
  const a = gg && gg.agents.find((x) => x.channel === c);
  if (!a || isCoordinator(a)) return null;
  const t = taskOf(g, a);                              // in a task with others (05-agent-list.js's TASKS): the task's
  return t === null ? `${g}\u0000${c}` : `${g}\u0000t${t}`;
}
// the task an app's panel is of: its instance's
const appPaneTask = (p) => taskKey(p.g, appItem(p.instance.id));
// A TASK OF APPS ONLY shown (its key): the actors' panes out of sight, its apps' panels taking the room; null: none is
let appsOnly = null;
function setAppsOnly(k) {
  appsOnly = k;
  const work = document.querySelector(".work");
  if (work) work.classList.toggle("apps-only", !!k);
  placeWork();
}
let taskNow = null;                                  // the task last entered: what the apps opened for it wait on
// Each task's LAYOUT, as it was left (`taskLayouts`, kept in this browser): its actors' panes, in order, the one in focus,
// the view each shows, and its apps' panels -- with the chat minimized under them or not -- so a task is opened again as
// it was, an actor's pane or an app's panel closed in it staying closed; where each goes, and how wide or tall, its
// arrangement (features/layout/work.ts; made, the first time, from the widths and height an older page kept here). A
// task never left yet opens as a task does at first: its actors not closed side by side, its apps above, the chat not
// minimized.
const TASK_LAYOUTS_KEY = "ag-dashboard-task-layouts-2", TASK_LAYOUTS_KEPT = 200;   // -2: none kept of a task never laid out
const taskLayouts = (() => { try { return JSON.parse(localStorage.getItem(TASK_LAYOUTS_KEY)) || {}; } catch (e) { return {}; } })();
function rememberTask(key) {
  if (!key) return;
  const sel = focusedActor(), [g] = key.split("\u0000"), its = (pg, c) => pg === g && taskKey(pg, c) === key;
  const actors = openActors().filter(([pg, c]) => its(pg, c)).map(([, c]) => c);
  const views = {};                                  // each of its actors' panes: the view it shows
  if (state.selected && its(...state.selected)) views[state.selected[1]] = chatView().id;
  for (const p of actorPanes()) if (its(p.g, p.c) && p.view) views[p.c] = p.view;
  const apps = panes.apps.filter((p) => !p.held && p.g === g && appPaneTask(p) === key).map((p) => ({ app: p.app.name, id: p.instance.id }));
  const chosen = appSelected(), focusApp = chosen && apps.some((a) => a.id === chosen) ? chosen : null;   // an app selected in it
  const mine = !appsOnly && sel && taskKey(sel[0], sel[1]) === key;
  taskLayouts[key] = { actors: appsOnly ? [] : actors, focus: mine ? sel[1] : appsOnly ? null : actors[0] || null, focusApp, apps,
    views: appsOnly ? {} : views, at: Date.now() };
  const keys = Object.keys(taskLayouts).sort((x, y) => taskLayouts[y].at - taskLayouts[x].at);
  for (const k of keys.slice(TASK_LAYOUTS_KEPT)) delete taskLayouts[k];
  try { localStorage.setItem(TASK_LAYOUTS_KEY, JSON.stringify(taskLayouts)); } catch (e) { /* this page only */ }
}
const taskLayout = (key) => taskLayouts[key] || null;
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
  if (PANE || SNAPSHOT) return null;
  const to = taskKey(g, c), sel = focusedActor();
  const from = appsOnly || (sel && taskKey(sel[0], sel[1])) || (state.selected && taskKey(...state.selected));
  if (to) taskNow = to;
  if (!to || !sel) return null;
  const was = taskLayout(to), open = openActors().some((s) => isAt(s, g, c));
  if (from === to) {
    if (tasksLaidOut.has(to)) return null;           // shown, laid out: as it is
    // shown by chance (the page opened on it), never laid out in this page: laid out now, adding to what is open
  } else {
    // one never laid out here (its apps never opened) is not remembered, nor one out of sight (an empty tab's, kept as it
    // was when that tab was left)
    if (tasksLaidOut.has(from) && !isAway()) rememberTask(from);
    setAppsOnly(null);
    for (const p of [...actorPanes()]) if (!isShell(p.c) && taskKey(p.g, p.c) !== to) closePane(p);
    if (state.selected && taskKey(...state.selected) !== to) focusPane(panes.here);   // the new task's actor: in this page's pane
    for (const p of [...panes.apps]) if (!p.held && appPaneTask(p) !== to) closeAppPane(p);
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
  if (PANE || SNAPSHOT) return;
  const sel = focusedActor(), from = appsOnly || (sel && taskKey(sel[0], sel[1]));
  if (from === k) return;
  if (from && tasksLaidOut.has(from) && !isAway()) rememberTask(from);
  taskNow = k;
  for (const p of [...actorPanes()]) if (!isShell(p.c)) closePane(p);
  for (const p of [...panes.apps]) if (!p.held && appPaneTask(p) !== k) closeAppPane(p);
  setAppsOnly(k);
  const was = taskLayout(k);
  tasksLaidOut.add(k);
  taskAppsOpening = openTaskApps(g, null, k, was ? was.apps : null);
  renderAgents();
}
// The tasks laid out in this page (entered, or opened at first by openTask): a task shown, laid out, stays as it is
const tasksLaidOut = new Set();
// a task's actors `rest`, not closed, opened beside `c` (shown), as many as there is room for -- each in the view it showed
// when the task was left (`was`); `c` in focus after
function layOutTask(g, to, c, rest, was = null) {
  const gg = state.home && state.home.gatherers.find((x) => x.name === g);
  const open = (ch) => { const a = gg && gg.agents.find((x) => x.channel === ch); return a && statusOf(a)[0] !== "closed" && taskKey(g, ch) === to; };
  tasksLaidOut.add(to);
  for (const ch of rest) {
    if (ch === c || !open(ch) || openActors().some((s) => isAt(s, g, ch))) continue;
    if (allPanes().length >= MAX_PANES) break;
    openBeside(g, ch, (was && was.views && was.views[ch]) || null);
  }
  focusPane(actorPanes().find((p) => isAt([p.g, p.c], g, c)) || panes.here);
}
// A task opened BESIDE the one shown (⌘/Ctrl+click on it): nothing of the one shown closed -- its actors not closed, as it
// was left (else its lead first; `first`, first), in panes beside the one in focus, as many as there is room for, and its
// apps' panels added above (openTaskApps, `beside`); `first`'s pane in focus after.
async function openTaskBeside(g, key, first) {
  await outOfAppsOnly(g, first);
  const gg = state.home && state.home.gatherers.find((x) => x.name === g), was = taskLayout(key);
  tasksLaidOut.add(key);
  const open = (ch) => { const a = gg && gg.agents.find((x) => x.channel === ch); return a && statusOf(a)[0] !== "closed" && taskKey(g, ch) === key; };
  const order = [first, ...(was ? was.actors : taskOrder(g, key))].filter((ch, i, all) => ch && all.indexOf(ch) === i && open(ch));
  let left = 0;
  for (const ch of order) {
    if (openActors().some((s) => isAt(s, g, ch))) continue;
    if (allPanes().length >= MAX_PANES) { left++; continue; }
    openBeside(g, ch, (was && was.views && was.views[ch]) || null);
  }
  if (left) paneNote(`At most ${MAX_PANES} actors side by side: ${plural(left, "actor")} of the task left out`);
  await openTaskApps(g, first, key, was ? was.apps : null, true);
  const p = actorPanes().find((q) => isAt([q.g, q.c], g, first));
  if (p) focusPane(p);
}
// An actor opened beside a task of apps alone (⌘+click): this page's own pane, out of sight while apps alone show (its
// actor not shown, though selected), in sight again with `c` in it -- the apps kept, beside
async function outOfAppsOnly(g, c) {
  if (!appsOnly || !c || PANE) return;
  setAppsOnly(null);
  focusPane(panes.here);
  if (!isAt(state.selected, g, c)) await showIn(g, c, null);
  placeWork(); renderAgents();
}
// a task's actors not closed, as it opens at first: its lead first (05-agent-list.js's taskActors)
function taskOrder(g, key) {
  const gg = state.home && state.home.gatherers.find((x) => x.name === g), id = key.split("\u0000")[1];
  return gg && id.startsWith("t") ? taskActors(gg, Number(id.slice(1))).map((a) => a.channel) : [];
}
// The apps' panels of a task -- its apps (05-agent-list.js's taskApps), as the host has them now; an app alone, it -- up
// to TASK_APPS, not open already; `only`, the task's layout as it was left (rememberTask): those of them it had open alone
async function openTaskApps(g, c, to, only = null, beside = false) {
  const gg = state.home && state.home.gatherers.find((x) => x.name === g);
  if (!gg || !window.agNext) return;
  await readApps(g, true);
  const item = c || (to.split("\u0000")[1] || ""), now = taskKey(g, item);
  if (now && now !== to && !to.split("\u0000")[1].startsWith("t")) {   // made one task with others since: that one's
    if (taskNow === to) taskNow = now;
    if (appsOnly === to) appsOnly = now;
    tasksLaidOut.add(now);
    to = now;
  }
  const found = [];                                  // {app, id, inst?}, in that order, each instance once
  const add = (k) => { if (window.agNext.apps.named(k.app) && !found.some((f) => f.id === k.id)) found.push(k); };
  const id = to.split("\u0000")[1] || "";
  const mine = id.startsWith("t") ? taskApps(gg, Number(id.slice(1)))
    : isAppItem(id) ? [appInfo(g, id.slice(APP_ITEM.length))].filter(Boolean) : [];
  if (only) for (const o of only) add({ ...o, inst: (mine.find((m) => m.id === o.id) || {}).inst });   // as it was left
  else for (const o of mine) add({ app: o.app.name, id: o.id, inst: o.inst });
  let opened = false;
  for (const k of found.slice(0, TASK_APPS)) {
    if (!beside && taskNow !== to) return;           // another task entered meanwhile
    if (panes.apps.some((p) => p.instance.id === k.id)) continue;
    const inst = k.inst || await window.agNext.apps.instanceOf(k.app, g, k.id).catch(() => null);
    if (!inst || (!beside && taskNow !== to) || panes.apps.some((p) => p.instance.id === inst.id)) continue;
    addAppPane(window.agNext.apps.named(k.app), inst, +k.size > 0 ? +k.size : 1);   // as wide as it was left
    opened = true;
  }
  if (opened) { saveAppPanes(); renderAgents(); }
}
// The actor in the pane in focus -- in `view`, if given; one open already, its pane focused instead. Of another task than
// the one shown: the panels changed for it first (enterTask), and the rest of its task laid out beside it, its pane in
// focus, as soon as it is in its pane -- not once what it shows (its Chat) has loaded: a click meanwhile (an app
// selected, another pane) would lose its focus to it. `wait` false: done then, its Chat loading still.
async function show(g, c, view = null, wait = true) {
  if (isAt(hereAway, g, c)) backInSight();          // asked for: in sight again (and in its task's tab shown)
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
  const p = there || panes.focus;
  if (p !== panes.here) {
    focusPane(p);
    if (!there) { Object.assign(p, { g, c, view: view || p.view }); savePanes(); connect(); renderAgents(); p.call("select", g, c, view); }
    else if (view) p.call("view", view);
    return null;
  }
  focusPane(panes.here);
  let loading = null;
  if (there) { if (view) loading = setChatView(view); }
  else { if (view) setViewHere(view); loading = select(g, c); }
  if (!loading) return null;
  if (wait) { await loading; return null; }
  loading.catch(() => {});
  return { loading };
}
function setViewHere(id) {
  state.chatViewId = id;
  try { localStorage.setItem(CHAT_VIEW_KEY, id); } catch (e) { /* this page only */ }
}
function openBeside(g, c, view = null) {
  if (PANE || SNAPSHOT || !state.selected) return show(g, c, view);
  const there = actorPanes().find((p) => isAt([p.g, p.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null);
  if (there) return focusPane(there);
  if (allPanes().length >= MAX_PANES) return paneNote(`At most ${MAX_PANES} actors side by side: close one (its ×) to open another.`);
  const from = panes.focus, at = from === panes.here ? 0 : panes.others.indexOf(from) + 1;
  const p = addPane(g, c, view || (from === panes.here ? chatView().id : from.view), at);
  focusPane(p);
  layout(); savePanes(); connect();
}
// A pane of its own for an actor, its frame put at `at` among the others. Nothing else on the page is moved:
// a frame moved is a frame loaded again.
function addPane(g, c, view, at, size = 1) {
  const p = { g, c, view: view || null, size, ready: false };
  const q = new URLSearchParams({ pane: "1", gatherer: g, channel: c, ...(view ? { view } : {}) });
  p.frame = el("iframe", { src: `/?${q}`, title: isShell(c) ? `Terminal in ${g}` : `Actor ${c} of ${g}` });
  p.node = el("section", { class: "pane" }, p.frame);
  p.call = (what, ...args) => {                      // what the frame's page does when asked (agPane, its paneReady)
    let api = null;
    try { api = p.ready && p.frame.contentWindow && p.frame.contentWindow.agPane; } catch (e) { /* gone */ }
    return api && api[what] ? api[what](...args) : undefined;
  };
  document.getElementById("panes").insertBefore(p.node, panes.others[at] ? panes.others[at].node : null);
  panes.others.splice(at, 0, p);
  return p;
}
function closePane(p) {
  const i = panes.others.indexOf(p);
  if (i < 0) return;
  panes.others.splice(i, 1);
  p.node.remove();                                   // its page goes, and its terminal's stream; the session stays
  topRow(p, null);
  if (panes.focus === p) focusPane(panes.others[i - 1] || panes.here);
  layout(); savePanes(); connect(); renderAgents();
}
// This page's own pane closed: the next pane's actor (`next`) -- and view -- moves into it, its frame gone.
async function closeHere(next = actorPanes()[0]) {
  if (!next) return;
  panes.others.splice(panes.others.indexOf(next), 1);
  next.node.remove();
  topRow(next, null);
  panes.here.size = next.size;
  if (next.view) setViewHere(next.view);
  focusPane(panes.here);
  layout();
  await select(next.g, next.c);
}
// An actor's pane focused: the app selected, if one was, no longer (selectAppPane)
function focusPane(p) {
  if (!p) return;
  const had = appSel;
  if (had) { appSel = null; markSelected(); }
  if (panes.focus === p) { if (had && state.home) renderAgents(); return; }
  panes.focus = p;
  for (const q of allPanes()) q.node.classList.toggle("focused", q === p);
  for (const q of panes.others) q.call("focused", q === p);
  savePanes();
  appsSelected();
  if (state.home) renderAgents();
}
// The APP SELECTED (its instance's id): as an actor's pane is focused, one thing at a time, an app or an actor -- its panel
// marked as a focused pane is (.focused), the actors' panes not while it is; its line in the list filled. Selected by a
// click on it in the list or a task's card (05-agent-list.js's selectApp), a press on its panel's head, or the focus going
// into its frame; an actor's pane focused (focusPane: a press in it, an actor shown) ends it.
let appSel = null;
const appSelected = () => (appSel && panes.apps.some((p) => !p.held && p.instance.id === appSel) ? appSel : null);
function markSelected() {
  const sel = appSelected();
  for (const q of panes.apps) q.node.classList.toggle("focused", !!sel && q.instance.id === sel);
  for (const q of allPanes()) q.node.classList.toggle("focused", !sel && q === panes.focus);
  for (const q of panes.others) q.call("focused", !sel && q === panes.focus);
}
// an app's panel gone (closed, held out of sight, its app closed): no longer selected, the focused actor's pane marked again
function unselectApp(id) { if (appSel && appSel === id) { appSel = null; markSelected(); } }
function selectAppPane(p) {
  if (!p || p.held) return;
  appSel = p.instance.id;
  markSelected();
  if (state.home) renderAgents();
}
// the task of what is selected: the selected app's, else the task of apps only shown, else the focused actor's
function selectedTask() {
  const sel = appSelected(), p = sel && panes.apps.find((q) => q.instance.id === sel);
  if (p) return appPaneTask(p);
  if (appsOnly) return appsOnly;
  const f = focusedActor();
  return f && !(panes.focus === panes.here && isAway()) ? taskKey(f[0], f[1]) : null;   // (this page's own out of sight: none)
}
if (!PANE && !SNAPSHOT) window.addEventListener("blur", () => setTimeout(() => {   // the focus gone into an app's frame
  const p = panes.apps.find((q) => q.frame === document.activeElement);
  if (p && appSel !== p.instance.id) selectAppPane(p);
}, 0));
// The panes' widths (each its share, `size`), which is in focus, and whether the page is split at all: split,
// each pane's head says whose it is, and has its ×. Placed so (placeWork).
function layout() {
  const split = panes.others.length > 0;
  document.getElementById("panes").classList.toggle("split", split);
  for (const p of allPanes()) { p.node.style.flexGrow = split ? String(p.size) : ""; p.node.classList.toggle("focused", p === panes.focus && !appSelected()); }
  placeWork();
  drawn.who = null; drawWho();
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
let hereAway = null;
// this page's own pane in sight again: its actor looked at now (04-seen.js), the list and the tabs' marks drawn so
function backInSight() { hereAway = null; markSeen(); if (state.home) renderAgents(); }
const isAway = () => !!hereAway && isAt(state.selected, hereAway[0], hereAway[1]);
function shownPanels() {
  const known = !!state.home, out = [], actor = (g, c, node) => out.push({ key: known ? taskKey(g, c) : null, item: c, node, app: false });
  panes.here.node.classList.toggle("lay-away", isAway());
  if (!appsOnly) {
    if (state.selected && isAway()) { /* out of sight */ }
    else if (state.selected) actor(state.selected[0], state.selected[1], panes.here.node);
    else out.push({ key: null, item: "here", node: panes.here.node, app: false });
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
}
// placed again only if what it shows changed since (an actor shown in this page's own pane, one put in a task): each draw
function placeIfShown() { if (workPlacer && shownSig() !== placedFor) placeWork(); }
function startPlacing() {
  if (PANE || SNAPSHOT || workPlacer) return;
  const work = document.querySelector(".work");
  workPlacer = window.agNext.layout.work(work, { shown: shownPanels, narrow: () => NARROW.matches,
    old: (k) => taskLayout(k), known: () => !!state.home, label: blockName, open: openDropped, minChanged: paneMinimized,
    focus: selectedTask, enter: enterTasks, status: taskStates, showItems: showTaskItems, lead: taskLeadOf, canon: keyNow,
    clear: clearWork, remember: (keys) => { for (const k of keys) if (tasksLaidOut.has(k)) rememberTask(k); },
    faces: blockFaces, about: blockAbout, closeTask: closeTaskHere, openBeside: openTaskHereBeside, listed: () => { if (state.home) renderAgents(); } });
  NARROW.addEventListener("change", placeWork);
  // a task's row dragged from the list over the work area (05-agent-list.js's listDrag): one open in no tab, opened beside
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
// The actor the page opened on by itself, nothing kept to show (03-settings.js), counts as nothing shown: the first click
// on another task shows it in its place, not in a new tab.
// True: the task now shown where the click goes on as a plain one (⌘ having brought its tab forward).
let autoShown = null;
async function viaTabs(k, ev, item = null) {
  if (!workPlacer || !k || !ev || ev.inTabs || SNAPSHOT || ev.shiftKey) return false;
  const tabs = workPlacer.tabs;
  if (tabs.busy()) await tabs.settled();             // a tab still being shown (its panes opened one by one): once it is
  const at = tabs.where(k);
  const chance = !!autoShown && shownPanels().every((s) => !s.key || s.key === autoShown);
  autoShown = null;
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
  if (tabsStarted || !workPlacer || !state.home || PANE || SNAPSHOT) return;
  tabsStarted = true;
  if (await workPlacer.tabs.start()) autoShown = null;
}
// Task `k`'s panel in focus, if one is shown: its actor's pane (this page's own first), else its app's panel selected
function focusTask(k) {
  if (!k || selectedTask() === k) return;
  const mine = (g, c) => taskKey(g, c) === k;
  if (!appsOnly && state.selected && !isAway() && mine(...state.selected)) return focusPane(panes.here);
  const p = actorPanes().find((q) => mine(q.g, q.c));
  if (p) return focusPane(p);
  const a = panes.apps.find((q) => !q.held && appPaneTask(q) === k);
  if (a) selectAppPane(a);
}
// The tab shown left with task `k` alone (⌥+click on it while others show): the others kept as they are (rememberTask),
// their panes and panels closed (terminals kept) -- this page's own pane given one of k's actors if it showed another's,
// or, k of apps alone, the actors' panes out of sight (enterAppTask)
async function onlyTask(k) {
  const others = [...new Set(shownPanels().map((s) => s.key))].filter((x) => x && x !== k);
  if (!others.length) return;
  for (const o of others) if (tasksLaidOut.has(o)) rememberTask(o);
  const [g] = k.split("\u0000"), mine = (pg, c) => taskKey(pg, c) === k;
  for (const p of [...panes.apps]) if (!p.held && appPaneTask(p) !== k) closeAppPane(p);
  for (const p of [...actorPanes()]) if (!isShell(p.c) && !mine(p.g, p.c)) closePane(p);
  if (!appsOnly && state.selected && !isAway() && !mine(...state.selected)) {
    const next = actorPanes().find((p) => mine(p.g, p.c));
    if (next) await closeHere(next);
    else enterAppTask(g, k);
  }
  focusTask(k);
  placeWork(); renderAgents();
}
// A task of a screen tab dragged into the tab shown (features/layout/work.ts's mergeTab): opened beside the tasks shown,
// as ⌘+click opens one -- not routed, its tab gone from the bar
async function openTaskHereBeside(k) {
  const [g, id] = k.split("\u0000"), gg = state.home && state.home.gatherers.find((x) => x.name === g);
  if (!gg || id === undefined) return;
  if (/^t\d+$/.test(id)) {
    const t = Number(id.slice(1));
    if (!taskById(g, t)) return;
    if (!taskLead(gg, t)) return openTaskApps(g, null, k, (taskLayout(k) || {}).apps || null, true);   // apps alone
    return openTask(g, t, null, { metaKey: true, inTabs: true });
  }
  if (isAppItem(id)) { if (appInfo(g, id.slice(APP_ITEM.length))) await openTaskApps(g, null, k, null, true); return; }
  if (gg.agents.some((a) => a.channel === id)) await openTaskBeside(g, k, id);
}
// A task CLOSED HERE (its card head's ×): kept as it is now (rememberTask), its panes and panels closed -- its agents go on
// -- this page's own pane given the next pane's actor if it showed one of k's, else out of sight (the tab showing nothing
// else: its note says so)
async function closeTaskHere(k) {
  const mine = (g, c) => taskKey(g, c) === k;
  if (tasksLaidOut.has(k)) rememberTask(k);
  for (const p of [...panes.apps]) if (!p.held && appPaneTask(p) === k) closeAppPane(p);
  for (const p of [...actorPanes()]) if (mine(p.g, p.c)) closePane(p);
  if (appsOnly === k) {                              // apps alone: the actors' panes out of sight still
    if (state.selected) hereAway = state.selected;
    setAppsOnly(null);
  } else if (state.selected && !isAway() && mine(...state.selected)) {
    if (actorPanes().length) await closeHere();
    else hereAway = state.selected;
  }
  if (taskNow === k) taskNow = null;
  placeWork(); renderAgents();
}
// A new tab, empty ("+" on the tabs' bar): the tasks shown kept as they are (the tab left keeps them: hooks.remember),
// their panes and panels closed (terminals kept), this page's own pane out of sight till a task is opened in it
async function clearWork() {
  for (const p of [...panes.apps]) if (!p.held) closeAppPane(p);
  for (const p of [...actorPanes()]) if (!isShell(p.c)) closePane(p);
  setAppsOnly(null);
  if (state.selected && !isShell(state.selected[1])) hereAway = state.selected;
  taskNow = null;
  placeWork(); renderAgents();
}
// A tab shown: its tasks in place of those shown, each as it was left -- the first of them with an actor (`focus`, if it
// has one) entered as a click on its row does, closing the rest (terminals kept), the others opened beside it, as ⌘+click
// does: those with actors first, those of apps alone after (one entered first would put the actors' panes out of sight,
// and the actors opened beside it would not be shown); `focus` in focus after. Their panes opened, not waiting on what
// each loads to show (a Chat at times slow): a click while a tab is shown waits for this (viaTabs).
async function enterTasks(keys, focus) {
  const all = [focus, ...keys].filter((k, i, them) => k && them.indexOf(k) === i);
  const actor = (k) => {
    const [g, id] = k.split("\u0000"), gg = state.home && state.home.gatherers.find((x) => x.name === g);
    if (!gg || id === undefined || isAppItem(id)) return false;
    return /^t\d+$/.test(id) ? !!taskLead(gg, Number(id.slice(1))) : gg.agents.some((a) => a.channel === id);
  };
  const order = [...all.filter(actor), ...all.filter((k) => !actor(k))];
  for (const [i, k] of order.entries()) {
    const [g, id] = k.split("\u0000"), gg = state.home && state.home.gatherers.find((x) => x.name === g);
    if (!gg || id === undefined) continue;
    const beside = i > 0;
    if (/^t\d+$/.test(id)) {
      const t = Number(id.slice(1));
      if (!taskById(g, t)) continue;
      if (beside && !taskLead(gg, t)) await openTaskApps(g, null, k, (taskLayout(k) || {}).apps || null, true);   // apps alone
      else await openTask(g, t, null, { metaKey: beside, inTabs: true });   // (the tab's own: not routed, not waited on)
    } else if (isAppItem(id)) {
      if (!appInfo(g, id.slice(APP_ITEM.length))) continue;
      if (beside) await openTaskApps(g, null, k, null, true);
      else { enterAppTask(g, k); await taskAppsOpening; }
    } else if (gg.agents.some((a) => a.channel === id)) await (beside ? openTaskBeside(g, k, id) : show(g, id, null, false));
  }
  focusTask(focus);
}
// A task's key as it is now: a lone item's -- an actor's, an app's -- the task it has been put in since, if it has (taskKey);
// any other, as it is (a task's; one not known yet, its apps not read). A screen tab keeps the keys of the tasks it was
// left with (features/layout/tabs.ts).
function keyNow(k) {
  const [g, id] = String(k).split("\u0000");
  if (id === undefined || /^t\d+$/.test(id) || !state.home) return k;
  return taskKey(g, id) || k;
}
// A TASK'S STATES, for its face in its screen tab (tabs.ts marks the most pressing): each of its actors' (statusOf),
// its lead's first, and its apps' notifications not seen -- each as a mark (tabs.ts's MARKS: a turn, a build, a start
// all "working"; idle, closed none) and its word as the list says it
const TAB_MARK = { asking: "asking", error: "error", failed: "error", notified: "notified", finished: "finished",
  running: "working", building: "working", background: "background" };
function taskStates(k) {
  const [g, id] = k.split("\u0000"), gg = state.home && state.home.gatherers.find((x) => x.name === g);
  if (!gg || id === undefined || isShell(id)) return [];
  const told = (o) => appStatusOf(g, o.id), t = /^t\d+$/.test(id) ? Number(id.slice(1)) : null;
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
  const [g] = k.split("\u0000"), want = new Set(items), mine = (pg, c) => pg === g && taskKey(pg, c) === k;
  const views = (taskLayout(k) || {}).views || {}, actors = items.filter((c) => !isAppItem(c) && !isShell(c));
  const open = (c) => openActors().some((s) => isAt(s, g, c));
  for (const p of [...actorPanes()]) if (mine(p.g, p.c) && !want.has(p.c)) closePane(p);
  for (const p of [...panes.apps]) if (!p.held && appPaneTask(p) === k && !want.has(appItem(p.instance.id))) closeAppPane(p);
  if (state.selected && mine(...state.selected) && !want.has(state.selected[1])) {
    const next = actors.find((c) => !open(c));
    if (next) { focusPane(panes.here); await showIn(g, next, views[next] || null); }
    else if (actorPanes().length) await closeHere();
    else hereAway = state.selected;                  // none to show in it: away while this tab shows
  } else if (isAway() && want.has(state.selected[1])) backInSight();
  for (const c of actors) if (!open(c) && allPanes().length < MAX_PANES) openBeside(g, c, views[c] || null);
  const apps = items.filter(isAppItem).map((it) => appInfo(g, it.slice(APP_ITEM.length))).filter(Boolean)
    .map((o) => ({ app: o.app.name, id: o.id, inst: o.inst }));
  if (apps.length) await openTaskApps(g, null, k, apps, true);
  placeWork();
}
// a task's lead actor (a new tab of the task holds it)
function taskLeadOf(k) {
  const [g, id] = k.split("\u0000"), gg = state.home && state.home.gatherers.find((x) => x.name === g);
  if (!gg || id === undefined || isAppItem(id) || isShell(id)) return null;
  if (!/^t\d+$/.test(id)) return id;
  const a = taskLead(gg, Number(id.slice(1)));
  return a && a.channel ? a.channel : null;
}
// a pane minimized now, or shown whole again: drawn so -- this page's own, or a frame's (told)
function paneMinimized(node, on) {
  if (node === panes.here.node) minRedraw();
  else { const p = actorPanes().find((q) => q.node === node); if (p) p.call("minimized", on); }
}
// a panel closed by the reader (its ×): out of its task's tab shown, if the task has tabs
function workClosed(node) { if (workPlacer && node) workPlacer.closed(node); }
// ⌃Tab (⌃⇧Tab: back) in the ag app -- a browser keeps those keys for its own tabs: the next screen tab shown
if (!SNAPSHOT) document.addEventListener("keydown", (ev) => {
  if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.key !== "Tab") return;
  let app = false;
  try { app = !!window.top.agApp; } catch (e) { /* not ours */ }
  if (!app) return;
  ev.preventDefault();
  if (PANE) PANE.tab(window, ev.shiftKey ? -1 : 1); else if (workPlacer) workPlacer.tabs.step(ev.shiftKey ? -1 : 1);
}, true);
// What a block of the work area is called on its strip (shown while there are others): its task's name, an actor's, an
// app's; a terminal's, the coordinator agent's (no task)
function blockName(k) {
  const [g, id] = k.split("\u0000"), gg = state.home && state.home.gatherers.find((x) => x.name === g);
  if (k.startsWith("\u0002")) return isShell(k.slice(1)) ? "Terminal" : "";
  if (!gg || id === undefined) return "";
  if (/^t\d+$/.test(id)) { const t = taskById(g, Number(id.slice(1))); return t ? taskName(gg, t) : "A task"; }
  if (isAppItem(id)) { const o = appInfo(g, id.slice(APP_ITEM.length)); return o ? appShown(o) : "An app"; }
  const a = gg.agents.find((x) => x.channel === id);
  return a ? actorTitle(a) : id;
}
// A block's faces, on its card's head and its screen tab: its task's actors' (not closed; three at most) and its apps'
// marks -- an actor's, an app's, alone
function blockFaces(k) {
  const [g, id] = k.split("\u0000"), gg = state.home && state.home.gatherers.find((x) => x.name === g);
  if (!gg || id === undefined) return [];
  const face = (a) => {
    const src = a.avatar && !SNAPSHOT ? `/avatars/${a.avatar}.svg` : null;
    return src ? el("img", { class: "lay-face", src, alt: "", draggable: "false" }) : el("span", { class: "lay-face" }, harnessLogo(a.harness));
  };
  const mark = (o) => el("span", { class: "lay-face app" }, appMarkOf(o));
  if (/^t\d+$/.test(id)) {
    const t = Number(id.slice(1)), actors = taskActors(gg, t);
    return [...actors.slice(0, 3).map(face), ...(actors.length ? [] : taskApps(gg, t).slice(0, 1).map(mark))];
  }
  if (isAppItem(id)) { const o = appInfo(g, id.slice(APP_ITEM.length)); return o ? [mark(o)] : []; }
  const a = gg.agents.find((x) => x.channel === id);
  return a ? [face(a)] : [];
}
// What is in a block, in words, on its card's head: its actors, how many; its apps, by name
function blockAbout(k) {
  const [g, id] = k.split("\u0000"), gg = state.home && state.home.gatherers.find((x) => x.name === g);
  if (!gg || !/^t\d+$/.test(id || "")) return "";
  const t = Number(id.slice(1)), n = taskActors(gg, t).length, apps = taskApps(gg, t).map((o) => o.app.label);
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
  const [g, id] = k.split("\u0000");
  if (/^t\d+$/.test(id)) openTask(g, Number(id.slice(1)), null, { metaKey: true });
  else if (!isAppItem(id)) openTaskBeside(g, k, id);
}
// A panel's head dragged -- this page's own pane's, its Chat bar's grip (the head put there); in a frame, the page
// around it told -- picks it up (none from a press on a button in it, nor one with nowhere to go); let go, it is put
// down. Right-clicked: what it can be moved to, as a menu. An app's panel has no head: its row in the list, right-clicked,
// opens that menu for it (appPanelMenu).
const MOVE_FROM = "#pane-here > .pane-top, .fl-grip, .lay-strip";
let movePress = null;                                // what the last press was on: a drag starting from a button is none
if (!SNAPSHOT) {
  const head = document.querySelector("#pane-here > .pane-top");
  if (head) head.draggable = true;
  const from = (ev) => (ev.target.closest ? ev.target.closest(MOVE_FROM) : null);
  const panel = (f) => (f.matches(".lay-strip") ? f : f.closest("#pane-here"));   // a task's strip: the task
  const busy = () => !!(movePress && movePress.closest && movePress.closest("button, input, textarea, select, a, [contenteditable]"));
  document.addEventListener("pointerdown", (ev) => { movePress = ev.target; }, true);
  document.addEventListener("dragstart", (ev) => {
    const f = from(ev);
    if (!f) return;
    if (busy() || !(PANE ? PANE.move(window, true) : moveStart(panel(f)))) { ev.preventDefault(); return; }
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("application/x-ag-panel", "1");
  });
  document.addEventListener("dragend", (ev) => { if (from(ev)) { if (PANE) PANE.move(window, false); else moveEnd(); } });
  document.addEventListener("contextmenu", (ev) => {
    const f = from(ev);
    if (!f || (ev.target.closest && ev.target.closest("input, textarea, [contenteditable]"))) return;
    if (PANE ? PANE.menu(window, ev.clientX, ev.clientY) : moveMenu(panel(f), ev.clientX, ev.clientY)) ev.preventDefault();
  });
}
function moveStart(node) { return !!workPlacer && !!node && workPlacer.startMove(node); }
function moveEnd() { if (workPlacer) workPlacer.endMove(); }
// The menu a panel's head right-clicked opens at (x, y): which side of its task's block it goes along, or whose place it
// takes. None for a panel with no other of its task shown -- unless `more` ({head, items}) gives it items of its own.
// (a task's strip, or the head of its only panel shown: the task moved among the tasks shown)
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
    ...(m.split ? [{ mark: mark("+"), text: "To a new tab of this task", run: () => workPlacer.toNewTab(node) }] : [])];
  const head = more ? more.head(m) : m.task ? "Move this task" : "Move this panel";
  openPop("lay-move", at, popMenu(head, [...moves, ...(more ? more.items(mark) : [])]));
  return true;
}
// An app's row in the list (05-agent-list.js's appRow), or its row in its task's card, right-clicked: its panel's menu,
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
    items: (mark) => [{ mark: mark("×"), text: "Close its panel (the app stays open)", run: () => { workClosed(p.node); closeAppPane(p); } }],
  });
}
// what a panel is called in the menu: an app's as its head names it, an actor's as the list does
function panelName(node) {
  if (node.matches(".lay-strip")) return node.dataset.name || "this task";
  const app = panes.apps.find((p) => p.node === node);
  const short = (t) => (t.length > 48 ? `${t.slice(0, 47)}…` : t);
  if (app) return short(app.instance.name || app.instance.title || app.app.label);
  const q = actorPanes().find((p) => p.node === node), at = node === panes.here.node ? state.selected : q ? [q.g, q.c] : null;
  if (!at) return "this pane";
  if (isShell(at[1])) return "the terminal";
  const a = appActor(at[0], at[1]);
  return short(a ? (a.name && a.name.text) || firstLine(a.last_user_message || "", 60) || at[1] : at[1]);
}
// The page's top row -- the page's name at the left, each pane's head -- as tall as the tallest of them, so the
// rule under it runs straight across the page: each says how tall it is by itself (`tops`: the name's, this
// page's head's, each frame's), and all are given the tallest (--top-h). Not where the page is a phone's, its
// panes one under the other. A frame tells the page around it, and is told. A head put in its Chat view's bar (the
// Editor open: barActs) is hidden, of no height.
const tops = new Map(), NARROW = matchMedia("(max-width: 760px)");
function topRow(who, height) {
  if (height === null) tops.delete(who); else tops.set(who, height);
  if (PANE) return PANE.top(window, height);
  const tallest = NARROW.matches ? 0 : Math.ceil(Math.max(0, ...tops.values())) + 1;   // and the rule under it
  if (tallest === panes.top) return;
  panes.top = tallest;
  setTopRow(tallest);
  for (const p of panes.others) p.call("top", tallest);
}
const setTopRow = (h) => document.documentElement.style.setProperty("--top-h", `${h}px`);
function watchTop(node, who) {
  new ResizeObserver(() => topRow(who, node.getBoundingClientRect().height)).observe(node);
}
if (!PANE) NARROW.addEventListener("change", () => { panes.top = null; topRow("brand", tops.get("brand") || 0); });
// The pane's head: whose it is, as the list has the actor -- its avatar, its name or what it was last asked.
function drawWho() {
  if (!PANE && !panes.others.length) return;
  const sh = state.selected && isShell(state.selected[1]) ? shellOf(state.selected[1]) : null;
  if (sh) {
    const sig = signature([state.selected, sh, state.home.home_dir]);
    if (sig === drawn.who) return;
    drawn.who = sig;
    const who = document.getElementById("pane-who");
    who.replaceChildren(shellLogo(), el("span", { class: "tx", text: shellPath(sh) }));
    who.title = `Terminal · ${sh.gatherer}\n${sh.cwd}`;
    return;
  }
  const info = selectedInfo();
  const sig = signature([state.selected, info && [info.avatar, info.harness, info.last_user_message, info.name && info.name.text]]);
  if (sig === drawn.who) return;
  drawn.who = sig;
  const who = document.getElementById("pane-who");
  const named = info && info.name && info.name.text;
  who.replaceChildren(...(info ? [actorLogo(info), el("span", { class: "tx", text: named || info.last_user_message || info.channel })] : []));
  who.title = info ? [named, info.last_user_message, `${harnessName(info.harness)} · ${state.selected[0]} · ${info.channel}`]
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
  if (PANE || SNAPSHOT) return;
  try {
    if (!panes.others.length) localStorage.removeItem(PANES_KEY);
    else localStorage.setItem(PANES_KEY, JSON.stringify({ here: state.selected, size: panes.here.size, focus: panes.others.indexOf(panes.focus),
      others: panes.others.map((p) => ({ g: p.g, c: p.c, view: p.view, size: p.size })) }));
  } catch (e) { /* this page only */ }
}
// The panes kept, opened again once the home is known: those whose actors are still in it.
function restorePanes() {
  panes.checked = true;
  if (PANE || SNAPSHOT) return;
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(PANES_KEY)); } catch (e) { /* none kept */ }
  if (!kept || !Array.isArray(kept.others)) return;
  const exists = (g, c) => isShell(c) ? (state.home.shells || []).some((s) => s.id === c && s.gatherer === g)
    : state.home.gatherers.some((x) => x.name === g && x.agents.some((a) => a.channel === c));
  if (!state.selected && Array.isArray(kept.here) && exists(...kept.here)) state.selected = kept.here;
  if (!state.selected) return;
  panes.here.size = +kept.size || 1;
  for (const o of kept.others) {
    if (!o || allPanes().length >= MAX_PANES || !exists(o.g, o.c) || openActors().some((sel) => isAt(sel, o.g, o.c))) continue;
    addPane(o.g, o.c, o.view, panes.others.length, +o.size || 1);
  }
  focusPane(panes.others[kept.focus] || panes.here);
  layout();
}
// What this page's stream says for the frames: the home for each, an actor for its pane's; kept, for a frame not
// ready yet (or one shown a new actor).
function panesTake(name, data) {
  let to = null;
  if (name === "home") panes.home = data;
  else { const got = JSON.parse(data); to = [got.gatherer, got.channel]; panes.actors.set(key(...to), data); }
  for (const p of actorPanes()) if (!to || isAt(to, p.g, p.c)) p.call("take", name, data);
}
// ------------------------------------------------------------------ apps' panels
// An app's panel (app_kit/DESIGN.md) is in the top row (where it goes, the work area's arrangement: placeWork), above the
// actors' panes at first, each panel's width its share (`size`, for a phone's width). Opening
// one opens the actor it is attached to below it, in the pane in focus (one open already: its pane focused). Its head
// and its iframe are made by features/apps/host.ts (window.agNext.apps); what its panel asks goes through it to the
// dashboard's /api/apps; the actor in focus (appsSelected) and the theme are told to it. The panels open are kept in
// this browser (TOP_APPS_KEY), opened again once the apps are known (restoreAppPanes).
const TOP_APPS_KEY = "ag-dashboard-top-apps";
panes.apps = [];
const topRowEl = () => document.getElementById("top-row");
function topLayout() {
  for (const p of panes.apps) p.node.style.flexGrow = String(p.size);
  placeWork();
}
// An actor of the home (its gatherer, its channel), as the page has it now; a codex actor's thread it was renamed to.
const appActor = (g, c) => {
  const gg = state.home && state.home.gatherers.find((x) => x.name === g);
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
    harness: a.harness || null, role: a.role || null, saved: !!savedAs(g.name, a), turn_over: !!a.turn_over,
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
  const gg = state.home && state.home.gatherers.find((x) => x.name === g);
  if (!gg) throw new Error(`no gatherer ${g}`);
  const a = c === "gatherer" ? gg.agents.find(isCoordinator) : appActor(g, c);
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
// The message box of the actor `c` of gatherer `g`, focused, if it is shown here (the pane in focus's): its keys taken
// back from a native page first, in the desktop app.
function appFocusAgent(g, c) {
  const a = appActor(g, c);
  if (!a || !isAt(state.selected, g, a.channel)) return;
  window.agApp?.focusDashboard?.();
  document.getElementById("composer-text")?.focus();
}
function addAppPane(app, instance, size = 1, held = false) {
  const p = { app, instance, g: instance.gatherer, size, held };
  p.panel = window.agNext.apps.pane(app, instance, {
    close: () => { workClosed(p.node); closeAppPane(p); },   // its panel asking (ag.close)
    intent: (kind, data, from) => appIntent(kind, data, from.instance.gatherer),
    selection: () => appsSelection(),
    agents: (g) => ((state.home && state.home.gatherers.find((x) => x.name === g)) || { agents: [] }).agents     // a gatherer's own
      .filter((a) => !a.closed && !isCoordinator(a))                                                           // agent: attached to no app
      .map((a) => ({ channel: a.channel, name: (a.name && a.name.text) || a.last_user_message || a.channel })),
    agentState: appAgentState, send: appSend, answer: appAnswer, interrupt: appInterrupt, focusAgent: appFocusAgent,
    actors: appActors, sendActor: appSendActor, startActor: appStartActor, showActor: appShowActor,
  });
  p.node = p.panel.node; p.frame = p.panel.frame;
  p.node.hidden = held;
  topRowEl().append(p.node);
  panes.apps.push(p);
  topLayout();
  p.panel.refresh();                                 // its agents, as the host has them
  topChanged();
  return p;
}
// An app's pane shown again for `inst` -- the same instance, now of another group (05-group-moves.js's followMoved):
// its panel opened anew in its place, as wide, held or not as it was; selected still, if it was (by its id)
function swapAppPane(p, inst) {
  const i = panes.apps.indexOf(p);
  if (i < 0) return null;
  const q = addAppPane(p.app, inst, p.size, p.held);  // made at the row's end: put where p was
  topRowEl().insertBefore(q.node, p.node);
  panes.apps.splice(panes.apps.indexOf(q), 1);
  panes.apps.splice(i, 1, q);
  p.panel.destroy();
  p.node.remove();
  markSelected(); topLayout(); saveAppPanes(); topChanged();
  return q;
}
// A panel held out of sight shown (opened by the reader), or one shown held (closed while it is needed: appsAtWork).
function holdAppPane(p, held) {
  p.held = held;
  if (held) unselectApp(p.instance.id);
  p.node.hidden = held;
  topLayout(); saveAppPanes(); topChanged();
}
function closeAppPane(p) {
  const i = panes.apps.indexOf(p);
  if (i < 0) return;
  if (appNeeded(p)) return holdAppPane(p, true);     // its agent at work: its page answers its tools, out of sight
  panes.apps.splice(i, 1);
  unselectApp(p.instance.id);
  p.panel.destroy();                                 // its streams go; the instance stays open
  p.node.remove();
  appsOnlyLeft();
  saveAppPanes(); renderAgents(); topChanged();
}
// a task of apps only shown, its last panel gone: the actors' panes in sight again (nothing else to show)
function appsOnlyLeft() { if (appsOnly && !panes.apps.some((q) => !q.held)) setAppsOnly(null); }
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
  if (PANE || SNAPSHOT || !state.home || !window.agNext) return;
  for (const p of panes.apps) { p.panel.agentsChanged(); p.panel.actorsChanged(); }
  const working = [];
  for (const g of state.home.gatherers) for (const a of g.agents) if (agentAtWork(a)) working.push([g.name, a.channel]);
  const sig = JSON.stringify(working);
  if (sig !== appsWorking) {
    appsWorking = sig;
    for (const [g, c] of working) {
      let held;
      try { held = await window.agNext.apps.attachedTo(g, c); } catch (e) { continue; }
      for (const inst of held) {
        const app = window.agNext.apps.named(inst.app);
        if (!app || !panelTools(app) || panes.apps.some((p) => p.instance.id === inst.id)) continue;
        addAppPane(app, inst, 1, true);
      }
    }
  }
  for (const p of [...panes.apps]) if (p.held && !appNeeded(p)) {     // its agents done: it goes
    panes.apps.splice(panes.apps.indexOf(p), 1);
    p.panel.destroy(); p.node.remove();
  }
}
function saveAppPanes() {
  if (PANE || SNAPSHOT) return;
  try {
    if (!panes.apps.some((p) => !p.held)) localStorage.removeItem(TOP_APPS_KEY);
    else localStorage.setItem(TOP_APPS_KEY, JSON.stringify({
      apps: panes.apps.filter((p) => !p.held).map((p) => ({ app: p.app.name, instance: p.instance.id, g: p.instance.gatherer, size: p.size })) }));
  } catch (e) { /* this page only */ }
}
// The actor an app's instance is attached to, shown below it: in the pane in focus, unless one of them is open in a
// pane already (that pane focused). None attached: the panes as they are.
async function showAttached(p) {
  const chans = await p.panel.refresh();
  if (!chans.length) return;
  const g = p.instance.gatherer;
  const there = chans.map((c) => actorPanes().find((q) => isAt([q.g, q.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null)).find(Boolean);
  if (there) return focusPane(there);
  const agents = ((state.home && state.home.gatherers.find((x) => x.name === g)) || { agents: [] }).agents;
  const c = chans.find((ch) => agents.some((a) => a.channel === ch && !a.closed)) || chans.find((ch) => agents.some((a) => a.channel === ch));
  if (c) await show(g, c);
}
// The app's instance for gatherer `g` (in `folder`: the one there, for an app with one per folder) in the top row --
// its panel there already, if it is open -- and the actor it is attached to below it. No agent attached by opening
// it: attaching puts the two in one task (task_links.py), so the actor in focus would take a new instance into its
// task, its other apps and agents with it. A task's "+" (05-agent-list.js's addAppToTask) or the panel's agents
// menu put it with agents.
async function openApp(g, name, folder) {
  const app = window.agNext.apps.named(name);
  if (!app || PANE || SNAPSHOT) return null;
  let instance;
  try { instance = await window.agNext.apps.open(name, g, folder || null); }
  catch (e) { paneNote(`${app.label}: ${e.message}`); return null; }
  const there = panes.apps.find((q) => q.instance.id === instance.id);
  const p = there || addAppPane(app, instance);
  if (p.held) holdAppPane(p, false);                 // held out of sight while its agent worked: shown now
  saveAppPanes(); renderAgents();
  await readApps(g, true);                           // the task it is in, as the server has it now
  await showAttached(p);
  return p;
}
// An app opened from a group's menu: as a click on its row does (selectApp) -- in the tab its task is open in, else in a
// tab of its own
async function openAppTab(gname, name, folder) {
  const app = window.agNext.apps.named(name);
  if (!app || PANE || SNAPSHOT) return;
  let inst;
  try { inst = await window.agNext.apps.open(name, gname, folder || null); }
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
    jpeg: "image/jpeg", svg: "image/svg+xml", html: "text/html", json: "application/json" }[ext] || (ext ? "text/plain" : undefined);
  const app = window.agNext.apps.handler(kind, type);
  if (!app) throw new Error(`no app here takes ${kind}`);
  const into = g || (focusedActor() || [])[0] || ((state.home && state.home.gatherers[0]) || {}).name;
  // an app opened anew each time (instances "many": the Editor's) with one open above the panes: that one told, not
  // another opened -- any other is opened as its instances say (one per folder: the file's folder's)
  const open = app.instances === "many" && panes.apps.find((q) => !q.held && q.app.name === app.name && q.instance.gatherer === into);
  if (open) return open.panel.intent(kind, data || {});
  const folder = data && data.path ? String(data.path).replace(/\/[^/]*$/, "") : null;
  const p = await openApp(into, app.name, folder);
  if (!p) throw new Error(`${app.label} could not be opened`);
  p.panel.intent(kind, data || {});
}
// An actor an app started, selected: its app's panel in the top row -- shown, if held out of sight -- as a DocWriter's
// actor showed DocWriter when it was its view. Any other actor: nothing opened.
async function showActorsApp(g, c) {
  if (PANE || SNAPSHOT || !window.agNext) return;
  const k = taskKey(g, c);
  if (k && (tasksLaidOut.has(k) || taskLayout(k))) return;   // its task laid out, or remembered: its layout decides (enterTask)
  const gg = state.home && state.home.gatherers.find((x) => x.name === g);
  const r = appRole(gg && gg.agents.find((a) => a.channel === c));
  const app = r && window.agNext.apps.named(r.app);
  if (!app) return;
  const there = panes.apps.find((p) => p.instance.id === r.key);
  if (there) { if (there.held) holdAppPane(there, false); return; }
  const inst = await window.agNext.apps.instanceOf(app.name, g, r.key).catch(() => null);
  if (!inst || panes.apps.some((p) => p.instance.id === inst.id) || !isAt(state.selected, g, c)) return;
  addAppPane(app, inst);
  saveAppPanes();
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
  if (PANE || SNAPSHOT) return;
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(TOP_APPS_KEY)); } catch (e) { /* none kept */ }
  if (!kept || !Array.isArray(kept.apps)) return;
  for (const o of kept.apps) {
    const app = o && window.agNext.apps.named(o.app);
    if (!app || panes.apps.some((p) => p.instance.id === o.instance)) continue;
    const inst = await window.agNext.apps.instanceOf(o.app, o.g, o.instance);
    if (inst) addAppPane(app, inst, +o.size || 1);
  }
  topLayout(); saveAppPanes();
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
// Whether the page takes a click on a link to `href` shown with this page's actor (a frame's: the page around it does)
function linkClicked(href, ev) {
  const url = webLink(href);
  if (!url || !plainClick(ev) || SNAPSHOT || !state.selected) return false;
  return PANE ? !!(PANE.openLink && PANE.openLink(window, url)) : openLink(state.selected[0], state.selected[1], url);
}
// `url` opened for actor `c` of `gname`, if a Browser can be given it: false, nothing done
function openLink(gname, c, url) {
  const g = state.home && state.home.gatherers.find((x) => x.name === gname);
  const a = g && !isShell(c) ? actorOf(g, c) : null;
  const app = window.agNext && window.agNext.apps.named(LINK_APP);
  if (PANE || !a || !app || isCoordinator(a)) return false;
  const k = key(gname, a.channel);
  const next = (linkOpening.get(k) || Promise.resolve()).then(() => linkInBrowser(g, a, app, url))
    .catch((e) => paneNote(`${app.label}: ${e.message}`));
  linkOpening.set(k, next);
  return true;
}
async function linkInBrowser(g, a, app, url) {
  await showItemsTask(g, a.channel);
  const k = key(g.name, a.channel), made = linkMade.get(k);
  const had = (await window.agNext.apps.attachedTo(g.name, a.channel)).filter((i) => i.app === app.name);
  const shown = (id) => panes.apps.find((p) => !p.held && p.instance.id === id);
  let inst = (had.find((i) => shown(i.id)) || (made && shown(made) && shown(made).instance) || had[0]) || null;
  if (!inst) {
    const was = selectedTask();
    inst = await window.agNext.apps.open(app.name, g.name, cwdOf(a) || null, a.channel);
    linkMade.set(k, inst.id);
    await readApps(g.name, true);                    // the task it made, as the server has it now
    retask(was);
  }
  let p = panes.apps.find((q) => q.instance.id === inst.id);
  if (!p) p = addAppPane(app, inst);
  else if (p.held) holdAppPane(p, false);
  saveAppPanes();
  selectAppPane(p);
  p.panel.intent("open-url", { url });               // held by the panel's host until a new panel has connected
}
if (!SNAPSHOT) document.addEventListener("click", (ev) => {
  const a = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
  if (!a || a.hasAttribute("download") || ev.defaultPrevented || !a.closest("#pane-here")) return;
  if (!linkClicked(a.getAttribute("href"), ev)) return;
  ev.preventDefault();
  ev.stopPropagation();                              // a link's click: not also its message's
}, true);
// What a frame's page asks of this one (its PANE).
if (!PANE && !SNAPSHOT) window.agPanes = Object.freeze({
  get stream() { return state.stream; },
  ready(win, sel) {                                  // its page is up: given what the stream has said so far
    const p = paneOf(win);
    if (!p) return;
    p.ready = true;
    p.call("focused", panes.focus === p);
    if (panes.top) p.call("top", panes.top);
    if (!isAt(sel, p.g, p.c)) return p.call("select", p.g, p.c, p.view);   // shown another actor while it loaded
    if (panes.home) p.call("take", "home", panes.home);
    const a = panes.actors.get(key(p.g, p.c));
    if (a) p.call("take", "actor", a);
  },
  shows(win, sel) {                                  // its actor, chosen or renamed (a codex thread)
    const p = paneOf(win);
    if (!p || !p.ready || !sel) return;              // not up yet: its pane's actor is the one it is given (ready)
    if (!isAt(sel, p.g, p.c)) { [p.g, p.c] = sel; savePanes(); connect(); renderAgents(); return; }
    const a = panes.actors.get(key(p.g, p.c));
    if (a) p.call("take", "actor", a);
  },
  viewed(win, id) { const p = paneOf(win); if (p) { p.view = id; savePanes(); } },
  top(win, height) { const p = paneOf(win); if (p) topRow(p, height); },
  focus(win) { if (state.renaming) endRename(true); const p = paneOf(win); if (p) focusPane(p); },   // a press in its frame
  close(win) { const p = paneOf(win); if (p) { workClosed(p.node); closePane(p); } },
  openLink(win, url) { const p = paneOf(win); return !!p && openLink(p.g, p.c, url); },   // a link clicked in it (linkClicked)
  move(win, on) { const p = paneOf(win); if (!on) { moveEnd(); return true; } return !!p && moveStart(p.node); },   // its head dragged
  tab(win, by) { if (workPlacer) workPlacer.tabs.step(by); },   // ⌃Tab in it (the ag app): the next screen tab
  menu(win, x, y) {                                  // its head right-clicked, at (x, y) in its frame
    const p = paneOf(win), r = p && p.frame.getBoundingClientRect();
    return !!p && moveMenu(p.node, r.left + p.frame.clientLeft + x, r.top + p.frame.clientTop + y);
  },
});
// In a frame: its URL says what it shows -- its actor and view -- so that loaded again it shows them still.
function paneUrl() {
  const [g, c] = state.selected || [];
  try { history.replaceState(null, "", "/?" + new URLSearchParams({ pane: "1", gatherer: g || "", channel: c || "", view: state.chatViewId })); }
  catch (e) { /* stays as it was */ }
}
// In a frame: what the page around it can ask of it, and its word that it is up.
function paneReady() {
  window.agPane = Object.freeze({
    take: (name, data) => streamTake(name, data),
    select: (g, c, view) => { if (view) state.chatViewId = view; select(g, c); },
    view: (id) => setChatView(id),
    theme: (pick) => setTheme(pick, false),
    avatar: (pick) => setAvatarMode(pick, false),
    earlier: (pick) => setEarlierTurns(pick, false),
    focused: (on) => document.documentElement.classList.toggle("pane-focused", !!on),
    top: (h) => setTopRow(h),
    toprow: () => minRedraw(),                       // a panel opened, or the last closed, above the panes: its head, in the bar or not
    minimized: () => minRedraw(),                    // the chat minimized under the top row, or shown again (setChatMin)
    escape: () => escapeShown(),                     // an Esc on the page outside the frame, this pane in focus
  });
  PANE.ready(window, state.selected);
  watchTop(document.getElementById("pane-head"), "here");
}
// The forms in the agent list: a new gatherer's ("+ New gatherer", gatherer ""), a new session's in a gatherer (its "+").
function openForm(gatherer) {
  state.adding = state.adding && state.adding.gatherer === gatherer ? null : { gatherer };
  renderAgents();
  const first = document.querySelector(".newform input, .newform select");
  if (first) first.focus();
}
function gathererForm() {
  const name = el("input", { name: "name", required: "", placeholder: "letters, digits, . _ -", pattern: "[A-Za-z0-9._\\-]+",
    spellcheck: "false", autocomplete: "off" });
  const err = el("div", { class: "err", role: "alert" });
  const make = el("button", { type: "submit", class: "primary" }, "Create");
  const form = el("form", { class: "newform", "aria-label": "New group" },
    el("label", {}, "Group name", name),
    el("div", { class: "desc", text: "Made with ag's default policy and pollers. Agents in it share context with each other." }),
    err,
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => { state.adding = null; renderAgents(); } }, "Cancel"), make));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    make.disabled = true; err.textContent = "";
    try {
      const g = await post("/api/gatherers", { name: name.value.trim() });
      collapsed.delete(g.name);
      await loadHome();
      state.adding = null;
      addSession(state.home.gatherers.find((x) => x.name === g.name) || { name: g.name, agents: [] });   // next: its first session
    } catch (e) { err.textContent = e.message; make.disabled = false; }
  });
  return form;
}
// A gatherer's start buttons, one for each harness a new session can run on here (the server's `harnesses`:
// in ag's config.toml, and installed): a click starts one, on the harness's default model, in the directory of
// the gatherer's most recently active actor -- or, when no actor has one (or starting there failed), the form
// asks for the directory first, its buttons the same.
const startable = () => (state.home.harnesses || []).filter(runsHere);
const noHarness = () => `None of ${runnableNames("or")} is set up here: install one, or set its command in config.toml ([cli.harnesses])`;
// Last, its terminal button: a shell (isShell), in that same directory -- or, with none, the form asks for it too.
const SHELL_START = "shell";                       // the terminal button's, where a harness's name goes
const APP_START = "app:";                          // an app's with an agent of its own ([agent] start): app:<name>:<harness>
const startAny = (gatherer, cwd, harness) => harness === SHELL_START ? startShell(gatherer, cwd)
  : harness.startsWith(APP_START) ? startWithApp(gatherer, cwd, ...appStart(harness))
  : startSession(gatherer, cwd, harness);
const appStart = (v) => { const [name, ...h] = v.slice(APP_START.length).split(":"); return [name, h.join(":")]; };
// The apps found whose menu entry starts an agent of their own (DocWriter, say): those a new actor is started with.
const startingApps = () => (PANE || SNAPSHOT || !window.agNext ? [] : window.agNext.apps.found())
  .filter((a) => a.agent && a.agent.start && !a.failed);
const cwdOf = (a) => a.cwd || (a.session && a.session.cwd) || "";    // a session started here: its own, before any call names one
const startCwd = (g) => cwdOf(g.agents.filter(cwdOf).sort((x, y) => (y.last || 0) - (x.last || 0))[0] || {});
// Its gatherer agent's button, first (CREW_START): the agent shown, started for the gatherer if it has none -- on the
// first harness a session can run on here, in the directory a new session would start in (coordination.py's `ensure`).
const CREW_START = "crew", CREW_GROUP = "Coordinator agent";
async function openCoordinator(g) {
  if (crewHidden.has(g.name)) setCrewHidden(g.name, false);
  const there = g.agents.find(isCoordinator);
  const view = CHAT_VIEWS.has("files") ? "files" : null;
  if (there) return show(g.name, there.channel, view);
  state.starting = { gatherer: g.name, harness: CREW_START };
  renderAgents();
  try {
    const s = await post("/api/coordinator", { gatherer: g.name, cwd: startCwd(g), harness: startable()[0] || "" });
    collapsed.delete(s.gatherer);
    await show(s.gatherer, s.session_id, view);
  } catch (e) { state.adding = { gatherer: g.name, cwd: startCwd(g), harness: null, error: e.message }; }
  finally { state.starting = null; renderAgents(); }
  const box = panes.focus !== panes.here ? null : document.getElementById("composer-text");
  if (box) box.focus();
}
// A gatherer's gatherer agent, its face just after the gatherer's name in its row: a click shows it (started if it has
// none), and, hidden from the list, its status at the face's corner.
function crewButton(g) {
  const hs = startable(), crew = g.agents.find(isCoordinator), hidden = !!crew && crewHidden.has(g.name);
  if (!hs.length && !crew) return null;
  const [cls, label] = hidden ? statusOf(crew) : [null, null];      // hidden from the list: its status here
  const busy = state.starting && state.starting.gatherer === g.name && state.starting.harness === CREW_START;
  return el("button", { class: "act start crew" + (busy ? " busy" : "") + (crew ? " on" : ""), type: "button",
    ...(state.starting ? { disabled: "" } : {}),
    title: hidden ? `The coordinator agent (${label.toLowerCase()}), hidden from the list: click to show it and open it`
      : crew ? "The coordinator agent: it coordinates this group's actors -- tell it what to arrange"
      : "Start the coordinator agent: it coordinates this group's actors, settles their conflicts, and arranges their work for you",
    "aria-label": crew ? `The coordinator agent of ${g.name}` : `Start the coordinator agent of ${g.name}`, onclick: () => openCoordinator(g) },
    crewFace(crew, MANAGER), hidden ? el("i", { class: `crew-dot ${cls}`, "aria-hidden": "true" }) : null);
}
// A gatherer row's start buttons -- and a folder's line's (`folder`: what they start goes in it, folders.py), shown, on
// each, while it is hovered: "+ actor" -- a drop-down of the harnesses a new actor may run on, or, with one, that one at
// once -- and "+ more", a drop-down of the other things started there: an actor on a branch of its own, a DocWriter, a
// Browser, a terminal. Each, pressed, aims what is started next at its folder, or its gatherer's top (aimStart): the
// actor filed there once started (fileStarted).
function startButtons(g, folder = null, prefix = "") {
  const hs = startable(), cwd = startCwd(g), where = cwd ? tildePath(cwd, state.home.home_dir) : null;
  const fid = folder ? folder.id : null, place = folder ? folder.name : g.name, at = folder ? `:${fid}` : "";
  const ours = state.starting && state.starting.gatherer === g.name;
  const starting = ours && startIn.g === g.name && startIn.folder === fid ? String(state.starting.harness) : "";
  const off = state.starting ? { disabled: "" } : {};
  const plus = () => el("span", { class: "plus", "aria-hidden": "true", text: "+" });
  const actorKey = `${prefix}actor:${g.name}${at}`, moreKey = `${prefix}more:${g.name}${at}`;   // a card's: its own (prefix)
  const actor = !hs.length ? el("button", { class: "act add", type: "button", disabled: "", title: noHarness(), "aria-label": noHarness() }, "+")
    : el("button", { class: "act start new-actor" + (hs.includes(starting) ? " busy" : ""), type: "button", ...off, "data-pop": actorKey,
      title: `New actor in ${place}${where ? `, in ${where}` : ""}: ${hs.map(harnessName).join(" or ")}`,
      "aria-label": `New actor in ${place}`, ...(hs.length > 1 ? { "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === actorKey) } : {}),
      onclick: (ev) => {
        aimStart(g.name, fid);
        if (hs.length > 1) openActorMenu(g, hs, ev.currentTarget, actorKey, undefined, folder ? place : null); else addSession(g, hs[0]);
      } },
      plus(), strokeIcon(ICONS.agent, 16));
  const others = moreStarts(g, hs, where, moreKey);
  const more = others.length ? el("button", { class: "act start new-more" + (starting === SHELL_START || starting === BRANCH_START
      || starting.startsWith(APP_START) ? " busy" : ""), type: "button", ...off, "data-pop": moreKey,
    title: `More to start in ${place}: ${others.map((o) => o.text.replace("…", "").toLowerCase()).join(", ")}`,
    "aria-label": `More to start in ${place}`, "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === moreKey),
    onclick: (ev) => { aimStart(g.name, fid); openMoreMenu(g, hs, ev.currentTarget, moreKey, place); } }, plus(), strokeIcon(ICONS.more, 16)) : null;
  return [actor, more].filter(Boolean);
}
// The "+ more" drop-down's starts: what each is, said under it, and what choosing it does. `key`: its button's data-pop.
function moreStarts(g, hs, where, key = `more:${g.name}`) {
  const there = where ? `in ${where}` : "in a directory you choose";
  const tooled = hs.filter((h) => (harnessInfo(h) || {}).mcp);    // an app's agent: given its tools
  return [
    hs.length ? { icon: ICONS.branch, text: "Actor on a branch…", note: "in a worktree of a project: its changes merged into the project",
      run: (button) => openBranchMenu(g, button) } : null,
    ...(tooled.length ? startingApps() : []).map((a) => ({ icon: ICONS.app, mark: a.mark ? appMarkImg(a) : null,
      text: `${a.label}…`, note: a.description || "an app, with an agent of its own",
      run: (button) => openPop(key, button, appStartBox(g, tooled, a)) })),
    state.home.terminals !== false ? { icon: ICONS.terminal, text: "Terminal", note: there, run: () => addSession(g, SHELL_START) } : null,
    ...(PANE || SNAPSHOT ? [] : window.agNext.apps.found()).filter((a) => !(a.agent && a.agent.start)).map((a) => ({ icon: ICONS.app,
      mark: a.mark ? appMarkImg(a) : null, text: a.label, note: a.description || "an app", run: () => openAppTab(g.name, a.name, startCwd(g)) })),
  ].filter(Boolean);
}
// `key`: the button's data-pop (the list's "+ actor", or the rail's "+"); `start`: what a harness chosen does; `place`: the
// folder it starts in, named in its heading (else the directory's).
function openActorMenu(g, hs, button, key = `actor:${g.name}`, start = (h) => addSession(g, h), place = null) {
  const cwd = startCwd(g);
  const where = cwd ? tildePath(cwd, state.home.home_dir) : "";
  openPop(key, button, popMenu(place ? `New actor in ${place}` : where ? `New actor in ${where.replace(/\/+$/, "").split("/").pop() || where}` : `New actor in ${g.name}`,
    hs.map((h) => ({ mark: harnessBadge(h), text: harnessName(h), run: () => start(h) })), where));
}
// The "+ actor" of a gatherer's or a folder's card in the rail (gathererCard, folderCard; `f` null: the gatherer's top): a
// new actor there, as the list's "+ actor" starts one -- on the one harness at once, or on the one picked from a drop-down
// -- in the directory of its gatherer's most recently active actor. With none (or starting there failed), a box under it
// asks for the directory first (railNewBox): the list's form, under its gatherer's row, is out of sight with the list
// folded. Pressed again, what it opened closes. `cls`: its classes.
const railKey = (g, f = null) => `rail:${g.name}${f ? `:${f.id}` : ""}`;
function railNew(g, f = null, cls = "r-new") {
  const hs = startable(), key = railKey(g, f), plus = el("span", { class: "plus", "aria-hidden": "true", text: "+" });
  const fid = f ? f.id : null, place = f ? f.name : titleOf(g);
  if (!hs.length) return el("button", { class: cls, type: "button", disabled: "", title: noHarness(), "aria-label": noHarness() },
    plus, strokeIcon(ICONS.agent, 14));
  const cwd = startCwd(g), where = cwd ? tildePath(cwd, state.home.home_dir) : null;
  const busy = state.starting && state.starting.gatherer === g.name && startIn.folder === fid && hs.includes(String(state.starting.harness));
  const pops = hs.length > 1 || !cwd;
  return el("button", { class: cls + (busy ? " busy" : ""), type: "button", "data-pop": key, ...(state.starting ? { disabled: "" } : {}),
    title: `New actor in ${place}${where ? `, in ${where}` : ""}: ${hs.map(harnessName).join(" or ")}`,
    "aria-label": `New actor in ${place}`,
    ...(pops ? { "aria-haspopup": cwd ? "menu" : "dialog", "aria-expanded": String(rowPop.key === key) } : {}),
    onclick: (ev) => {
      const button = ev.currentTarget;
      if (rowPop.key === key) return closePop();
      aimStart(g.name, fid);
      if (!cwd) openPop(key, button, railNewBox(g, hs));
      else if (hs.length > 1) openActorMenu(g, hs, button, key, (h) => railStart(g, h, key), f ? place : null);
      else railStart(g, hs[0], key);
    } },
    plus, strokeIcon(ICONS.agent, 14));
}
// A card's "+ ⋯" in the rail: the list's "+ more" drop-down, under it
function railMore(g, f = null, cls = "r-new r-more") {
  const hs = startable(), key = `railmore:${g.name}${f ? `:${f.id}` : ""}`, place = f ? f.name : titleOf(g);
  const others = moreStarts(g, hs, null, key);
  if (!others.length) return null;
  return el("button", { class: cls, type: "button", "data-pop": key, ...(state.starting ? { disabled: "" } : {}),
    title: `More to start in ${place}: ${others.map((o) => o.text.replace("…", "").toLowerCase()).join(", ")}`,
    "aria-label": `More to start in ${place}`, "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === key),
    onclick: (ev) => { aimStart(g.name, f ? f.id : null); openMoreMenu(g, hs, ev.currentTarget, key, place); } },
    el("span", { class: "plus", "aria-hidden": "true", text: "+" }), strokeIcon(ICONS.more, 14));
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
function railNewBox(g, hs, harness = hs[0], cwd = "", error = "") {
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
      await startSession(g.name, at, h);
      if (rowPop.el === box) closePop();
    } catch (e) {
      if (box.isConnected) { err.textContent = e.message; placePop(); } else setLive(`Not started: ${e.message}`);
    } finally { for (const b of buttons) b.disabled = false; }
  };
  const box = el("div", { class: "dw-menu", role: "dialog", "aria-label": `New actor in ${titleOf(g)}` },
    el("div", { class: "head", text: `New actor in ${titleOf(g)}` }),
    el("label", {}, "Working directory", input),
    folderPicks(g, dir, input, err),
    el("div", { text: "Run it on" }),
    el("div", { class: "on" }, ...hs.map((h) => el("button", { type: "button", class: "go", onclick: () => go(h) }, harnessBadge(h), harnessName(h)))),
    err);
  return box;
}
function openMoreMenu(g, hs, button, key = `more:${g.name}`, place = g.name) {
  if (brPick.menu && brPick.menu.g === g.name) return brMenuClose();     // the branch drop-down it opened: pressed again
  openPop(key, button, popMenu(`New in ${place}`, moreStarts(g, hs, startCwd(g) && tildePath(startCwd(g), state.home.home_dir), key)));
}
// A drop-down's box: its heading, then an item for each choice -- its mark, what it is, and a note under it.
function popMenu(head, items, title) {
  return el("div", { class: "br-menu row-menu", role: "menu", "aria-label": head }, el("div", { class: "hd", text: head, ...(title ? { title } : {}) }),
    ...items.map((it) => el("button", { type: "button", role: "menuitem", ...(it.depth ? { style: `padding-left: ${10 + it.depth * 14}px` } : {}), onclick: (ev) => {
      ev.stopPropagation();
      const button = popButton();
      closePop();
      it.run(button);
    } }, it.mark || strokeIcon(it.icon, 16), el("span", { class: "nm", text: it.text }), it.note ? el("span", { class: "at", text: it.note }) : null)));
}
// A gatherer row's pop-up ("+ actor"'s drop-down, "+ more"'s, the DocWriter box one of those opens): outside the list,
// fixed under the button it hangs from -- `key`, that button's data-pop, so found again after the list is drawn again --
// so it may reach past the list's edge without the list scrolling, and the list's redraws leave it be. Closed by its
// button pressed again, a press elsewhere, Esc, the page resizing, or the page or a box holding its button scrolling.
const rowPop = { key: "", el: null, off: null };
const popButton = () => rowPop.key && document.querySelector(`[data-pop="${CSS.escape(rowPop.key)}"]`) || null;
function closePop() {
  if (!rowPop.el) return;
  const button = popButton();
  rowPop.el.remove();
  rowPop.off();
  Object.assign(rowPop, { key: "", el: null, off: null });
  if (button) button.setAttribute("aria-expanded", "false");
  cardRelease();                                     // a card it hung from: let go, unless the pointer is on it
}
function placePop() {
  const box = rowPop.el, button = popButton();
  if (!box || !button) return;
  const r = button.getBoundingClientRect(), h = box.offsetHeight;
  const rail = button.closest("#rail"), side = rail && rail.getBoundingClientRect();
  if (side && side.height > side.width) {           // from the rail down the page's side: beside it, level with its button
    box.style.left = `${Math.round(side.right + 6)}px`;
    box.style.top = `${Math.round(Math.max(8, Math.min(r.top, window.innerHeight - h - 8)))}px`;
    return;
  }
  const below = r.bottom + 4 + h <= window.innerHeight - 8 || r.top - 4 - h < 8;   // above it only where there is room above
  box.style.top = `${Math.round(below ? r.bottom + 4 : r.top - 4 - h)}px`;
  box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)))}px`;
}
function openPop(key, button, box) {
  const again = rowPop.key === key && box.getAttribute("role") === "menu";
  closePop();
  brMenuClose();
  if (again) return;
  const away = (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-pop]");
    if (!box.contains(ev.target) && !(b && b.dataset.pop === key)) closePop();
  };
  const keys = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault(); ev.stopPropagation();
      const b = popButton();
      closePop();
      if (b) b.focus();
    } else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && box.contains(document.activeElement) && box.getAttribute("role") === "menu") {
      ev.preventDefault();
      const items = [...box.querySelectorAll("[role=menuitem]")], at = items.indexOf(document.activeElement);
      items[(at + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    }
  };
  // the page, or a box holding its button, scrolled: it no longer hangs where it should. Another box scrolling by itself
  // (a Chat's history kept at its end as its pane is resized) leaves it be.
  const scrolled = (ev) => {
    const b = popButton() || button;
    if (!box.contains(ev.target) && ev.target.contains && ev.target.contains(b)) closePop();
  };
  document.addEventListener("pointerdown", away, true);
  document.addEventListener("keydown", keys, true);
  window.addEventListener("resize", closePop);
  window.addEventListener("scroll", scrolled, true);
  Object.assign(rowPop, { key, el: box, off: () => {
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", keys, true);
    window.removeEventListener("resize", closePop);
    window.removeEventListener("scroll", scrolled, true);
  } });
  document.body.append(box);
  button.setAttribute("aria-expanded", "true");
  placePop();
  const first = box.querySelector("input, [role=menuitem]");
  if (!first) return;
  first.focus({ preventScroll: true });
  if (first.select) { first.setSelectionRange(first.value.length, first.value.length); first.scrollLeft = first.scrollWidth; }   // a folder's end
}
// The folders a gatherer's actors work in, newest first, under a box's folder `input` (its `dir` to start with): another
// a click away. null: none other than `dir`.
function folderPicks(g, dir, input, err) {
  const seen = new Set(), folders = [];
  for (const a of [...g.agents].sort((x, y) => (y.last || 0) - (x.last || 0))) {
    const d = cwdOf(a);
    if (d && !seen.has(d)) { seen.add(d); folders.push(tildePath(d, state.home.home_dir)); }
  }
  return folders.length > 1 || (folders.length === 1 && folders[0] !== dir) ? el("div", { class: "folders" },
    el("div", { class: "lbl", text: "Where its actors work" }),
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
    el("div", { text: "Its agent on" }),
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
    if (box.isConnected) { err.textContent = e.message; placePop(); } else setLive(`Not started: ${e.message}`);
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
// `join`, for one added to a task (05-agent-list.js's addToTask): what puts it there, once started -- where it is filed --
// and it shown beside the actor it was added to, the rest as any other's.
async function startSession(gatherer, cwd, harness, join = null) {
  state.starting = { gatherer, harness };
  renderAgents();
  try {
    const s = await post("/api/sessions", { gatherer, cwd, harness });
    if (join) await join(s); else await fileStarted(gatherer, s.session_id);
    state.adding = null;
    collapsed.delete(s.gatherer);
    await loadHome();
    if (join && state.selected && !appsOnly) await openBeside(s.gatherer, s.session_id, "files");
    else { await viaTabs(taskKey(s.gatherer, s.session_id), {}); await show(s.gatherer, s.session_id, "files"); }   // a tab of its own
  } finally { state.starting = null; renderAgents(); }
  const box = panes.focus !== panes.here ? null : document.getElementById("composer-text");
  if (box) box.focus();
}
// One of an app with an agent of its own started (app_agents.py's `start`): its actor listed and shown, its panel above.
async function startWithApp(gatherer, cwd, name, harness) {
  state.starting = { gatherer, harness: `${APP_START}${name}:${harness}` };
  renderAgents();
  try {
    const got = await window.agNext.apps.start(name, gatherer, cwd, harness);
    await fileStarted(gatherer, got.session.session_id);
    state.adding = null;
    collapsed.delete(gatherer);
    await loadHome();
    await viaTabs(taskKey(gatherer, got.session.session_id), {});   // a tab of its own (07-panes.js)
    await show(gatherer, got.session.session_id, "files");
    const app = window.agNext.apps.named(name);
    if (app) {
      const there = panes.apps.find((q) => q.instance.id === got.instance.id);
      if (there) { if (there.held) holdAppPane(there, false); }
      else addAppPane(app, got.instance);
      saveAppPanes();
    }
  } finally { state.starting = null; renderAgents(); }
}
// A shell started: shown in the pane in focus, its terminal opened at once (sessions.py's `shell`), at the size of the
// terminal this page draws now, if it draws one (fitted to its pane once drawn there).
async function startShell(gatherer, cwd) {
  state.starting = { gatherer, harness: SHELL_START };
  renderAgents();
  try {
    const size = term.opened && term.host && term.host.isConnected ? { cols: term.xterm.cols, rows: term.xterm.rows } : {};
    const folder = shellFolder(gatherer);            // opened in the folder aimed at, listed there
    const s = await post("/api/shells", { gatherer, cwd, ...size, ...(folder !== null ? { folder } : {}) });
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
const branchRoute = (b) => `From: its own branch, ${b.branch}, in ${tildePath(b.worktree, state.home.home_dir)}, `
  + `started from ${b.started_on || "a commit"} at ${(b.start || "").slice(0, 7)}.\n`
  + `Into: ${tildePath(b.project, state.home.home_dir)}, on ${checkedOut(b.onto)} now: its changes merged there`
  + `${b.approve ? " once you approve each" : ", but for lines you are editing, and lines you changed too"}.`;
function branchChip(g, a) {
  const b = branchOf(g.name, a);
  if (!b) return null;
  const n = branchWaiting(b);
  return el("div", { class: "branchline", title: branchRoute(b) + (n ? `\n${plural(n, "change")} wait for you in the Editor` : "") },
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
    el("div", { class: "hd", text: "Reading its sources…" }));
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
    el("div", { class: "hd", text: error || (brPick.projects.length ? "New actor on a branch of" : "No source yet") }),
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
  try { brPick.approve = localStorage.getItem(BRANCH_APPROVE_KEY) === "1"; } catch (e) { brPick.approve = false; }
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
          el("button", { type: "button", class: "rm", title: `No longer one of ${g}'s sources (its actors' branches are left as they are)`,
            "aria-label": `Remove ${projectName(p)}`, ...busy, onclick: () => brSources({ remove: p.path }) }, "×")))) : null,
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
      el("div", { class: "desc route" }, "From: a new branch, off ", el("code", { text: checkedOut(chosen) }),
        ` at ${chosen.head || "?"}. Into: `, el("code", { text: tildePath(chosen.path, home) }), ", on ",
        el("code", { text: checkedOut(chosen) }), "."))];
  }
  const approve = el("input", { type: "checkbox", checked: brPick.approve ? "" : null, onchange: (ev) => {
    brPick.approve = ev.target.checked;
    try { localStorage.setItem(BRANCH_APPROVE_KEY, brPick.approve ? "1" : "0"); } catch (e) { /* this page only */ }
  } });
  const ready = chosen && !brPick.choosing && !brPick.busy && !state.starting;
  const starts = hs.map((h) => el("button", { type: "submit", value: h, ...(ready ? {} : { disabled: "" }) },
    harnessBadge(h), harnessName(h)));
  form.append(...[
    el("div", { class: "br-title" }, el("h3", {}, strokeIcon(ICONS.branch, 15), "New actor on a branch"),
      el("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => d.close() }, "×")),
    el("div", { class: "desc", text: `In ${g}. It works in a worktree of its source, on a new branch from the source's last commit; what it changes is merged into the source's folder as it changes it.` }),
    el("div", { class: "lbl", text: "Source" }),
    ...source,
    el("label", { class: "check", title: "Without it, its changes are merged in as they come, but for lines you are editing in the Editor, and lines you changed too, which wait for you" },
      approve, el("span", {}, el("b", { text: "Auto-merge with approval" }), ": each change waits in the Editor for you to accept or reject it")),
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
  const box = panes.focus !== panes.here ? null : document.getElementById("composer-text");
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
    title: `${a.label}, its agent on ${harnessName(h)}`, ...(state.starting ? { disabled: "" } : {}) },
    a.mark ? appMarkImg(a) : strokeIcon(ICONS.app, 14), a.label, harnessBadge(h)));
  if (state.home.terminals !== false) starts.push(el("button", { type: "submit", value: SHELL_START, class: shell ? "primary" : "",
    ...(state.starting ? { disabled: "" } : {}) }, strokeIcon(ICONS.terminal, 14), "Terminal"));
  const appAt = String(adding.harness || "").startsWith(APP_START) ? window.agNext.apps.named(appStart(adding.harness)[0]) : null;
  const form = el("form", { class: "newform", "aria-label": "New session" },
    el("div", { class: "desc", text: shell ? `A new terminal, listed under ${fixed}` : appAt ? `A new ${appAt.label} in ${fixed}`
      : `A new session in ${fixed}` }),
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

