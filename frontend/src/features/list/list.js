import { PANE, SNAPSHOT, panes, state } from "../../core/page/state.js";
import {
  BESIDE_KEY, ICONS, ago, closable, closeIcon, el, foldMark, gathererNamed, get, harnessBadge, harnessInfo,
  harnessLogo, harnessName, hideIcon, key, post, saveIcon, shellPath, strokeIcon,
} from "../../core/page/helpers.js";
import { drawn, listSignature, loadHome, redrawList, setLive } from "../page/data.js";
import { discardable, homeSince, homesTaken, newerTasks, seen, statusOf } from "./seen.js";
import {
  GF, GFS, GF_NEW, dragGatherer, fileGatherers, gPicks, gfFolded, gfLines, gfMakingNow, gfOf, gfShow, nameGroup,
} from "./gatherer-folders.js";
import {
  ALONE_SAYS, aloneNew, askMerge, askMove, canCross, canMerge, drawManage, isAloneName, manage, manageEntry,
  outsideDrop, placeGroup, placeOf, showOutside,
} from "./group-moves.js";
import {
  HOVERS, cardDraw, cardHide, cardLive, cardMoving, drawTotals, hover, listButtons, listPlaces, railDragged,
  renderFolded, slideList,
} from "./modes.js";
import {
  actorPanes, appClosed, appMarkImg, appPaneTask, appPanelMenu, appSelected, appsOnlyKey, branchChip,
  closeAppPane, closePane, closedInTabs, crewButton, cwdOf, drawWho, enterAppTask, focusPane, focusedActor, isAt,
  isAway, moveEnd, newForm, openActors, openPop, openTaskBeside, paneNote, pick, pickBeside, showAppPanel,
  placeIfShown, popMenu, rekeyTask, rememberTask, rowMore, rowPop, selectAppPane, selectedTask, show, shownPanels,
  startButtons, startCwd, startSession, startable, taskAppsOpening, taskKey, taskLayout, tasksLaidOut, viaTabs,
  workPlacer,
} from "../layout/panes.js";
import { refreshNewTab } from "../layout/new-tab.js";
import { TASK_KINDS } from "../chat/chat.js";
import { opened } from "../chat/files-view.js";
import { firstLine, plural } from "../../core/format";
import { shownGone } from "../terminal/shell.js";
import * as appHost from "../apps/host";
import * as prefs from "../../core/prefs";
// the list's view-model (features/list/model.ts) and what it derives from the home: statuses, folders, tasks, groups
import { boxKey, buildList, folderKey } from "./model";
import * as LS from "./status";
import * as LT from "./tree";
import * as LK from "./tasks";
import * as LG from "./groups";
import { crewLine, envelope } from "./envelope";

// What the list's derivations read besides their arguments (features/list/types.ts's ListCtx): the home, and what the
// page knows of it -- each read when asked, so the same object serves every draw
const CTX = {
  get home() { return state.home; },
  snapshot: !!SNAPSHOT,
  now: () => Date.now() / 1000,
  get seenAt() { return seen.at; },
  opened: (a) => opened(a),
  apps: (gname) => gathererApps(gname),
};

async function closeSession(a) {
  try { await post("/api/stop", { session_id: a.session.session_id }); }
  catch (err) { setLive(`Not closed: ${err.message}`); }
}
async function discardSession(g, a) {
  try { await post("/api/discard", { session_id: a.session.session_id }); }
  catch (err) { return setLive(`Not closed: ${err.message}`); }
  await loadHome();
  for (const p of [...panes.others]) if (isAt([p.g, p.c], g.name, a.channel)) closePane(p);
  if (isAt(state.selected, g.name, a.channel) && !isAway()) return shownGone(a.channel);
  renderAgents();
}
// ------------------------------------------------------------------ the agent list
const COLLAPSED_KEY = "ag-dashboard-collapsed-gatherers";
const collapsed = (() => {                        // gatherers the reader folded, kept in this browser
  { const v = prefs.list(COLLAPSED_KEY); if (v) return new Set(v); }
  return new Set();
})();
// Closed actors (their process gone), and those saved for later, are each folded away under a line ("N closed",
// "N saved"), unless the reader opened that gatherer's, kept in this browser. A selected one stays in view. So are the
// gatherer's shells ("N terminals", SHELLS) -- but none in view while folded, even one open in a pane.
const FOLD_KEYS = { Closed: "ag-dashboard-closed-shown", Saved: "ag-dashboard-saved-shown", Terminals: "ag-dashboard-terminals-shown" };
const foldOpen = Object.fromEntries(Object.entries(FOLD_KEYS).map(([group, key]) => {
  { const v = prefs.list(key); if (v) return [group, new Set(v)]; }
  return [group, new Set()];
}));
function toggleFold(group, name) {
  const open = foldOpen[group];
  if (open.has(name)) open.delete(name); else open.add(name);
  prefs.keep(FOLD_KEYS[group], [...open]);
  renderAgents();
}
// The coordinator agents the reader hid from the list, kept in this browser: a group's by the group's name, any other's by
// its node (crewHideKey) -- its face on its group's or folder's row (crewButton) shows it again, and opens it.
const CREW_HIDDEN_KEY = "ag-dashboard-crew-hidden";
const crewHidden = (() => {
  { const v = prefs.list(CREW_HIDDEN_KEY); if (v) return new Set(v); }
  return new Set();
})();
function setCrewHidden(name, hide) {
  if (hide) crewHidden.add(name); else crewHidden.delete(name);
  prefs.keep(CREW_HIDDEN_KEY, [...crewHidden]);
  renderAgents();
}
// The actor shown when none is chosen: the newest not closed, else the newest.
const firstAgent = (g) => g.agents.find((a) => a.status !== "closed") || g.agents[0];
function toggleGatherer(name) {
  if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
  prefs.keep(COLLAPSED_KEY, [...collapsed]);
  renderAgents();
}
// Hidden gatherers, kept by the server (hiding.py, `home.hiding`) so every dashboard on this home hides the same ones:
// features/list/groups.ts's isHidden.
const HIDDEN_KEY = "ag-dashboard-hidden-gatherers";   // where this browser kept them before
const stale = (g) => LG.stale(CTX, g);
// The groups inactive by now: what the time changes in the list (page/data.js's listSignature)
const staleNames = () => LG.staleNames(CTX);
const isHidden = (g) => LG.isHidden(CTX, g);
async function keepChoice(name, choice) {
  const before = state.home.hiding;
  state.home.hiding = { ...(state.home.hiding || {}) };
  if (choice) state.home.hiding[name] = choice; else delete state.home.hiding[name];
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  const asked = homesTaken;                        // its answer kept unless a home came meanwhile (takeHome)
  try { const got = await post("/api/hiding", { gatherer: name, choice }); if (!homeSince(asked)) state.home.hiding = got; }
  catch (err) { undone(asked, { hiding: before }); setLive(`Not saved: ${err.message}`); }
}
// A change the page made at once, as the reader asked, taken back when the server refused it -- unless a home came
// since, which has what the server keeps (the stream sends a home only when it changed: without this, the page would
// show the change till something else did)
function undone(asked, was) {
  if (homeSince(asked)) return;
  Object.assign(state.home, was);
  redrawList();
}
// The reader's name for a gatherer, kept by the server (titles.py, `home.titles`) and shown in place of its own, which
// everything else -- its directory, its actors, `ag` -- still goes by (features/list/groups.ts).
const titleOf = (g) => LG.titleOf(CTX, g);
// Named in the actor's name box (nameBox), its channel null: Enter keeps it, Esc leaves it, empty gives its own back.
function retitle(g) {
  state.renaming = { g: g.name, c: null, value: titleOf(g), was: "" };
  nameInput = null;
  renderAgents();
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}
async function keepTitle(gname, text) {
  const asked = homesTaken;
  try { const got = await post("/api/title", { gatherer: gname, title: text }); if (!homeSince(asked)) state.home.titles = got; }
  catch (err) { setLive(`Not named: ${err.message}`); }
  renderAgents();
}
async function setHidden(g, hide) {
  const kept = keepChoice(g.name, hide ? "hidden" : stale(g) ? "shown" : "");
  renderAgents();
  await kept;
  redrawList();
}
// Actors saved for later, kept by the server (saved.py, `home.saved`: {gatherer: {channel: when}}) so every
// dashboard on this home shows the same. One saved is listed in its folder's saved line once it is closed, not with
// the closed ones; while open it is listed by its status (idle among the idle), its bookmark filled. It keeps
// its gatherer from being hidden for having had nothing for a week (features/list/status.ts's savedAs).
const savedAs = (gname, a) => LS.savedAs(CTX, gname, a);
async function setSaved(gname, a, save) {
  const channel = savedAs(gname, a) || a.channel, before = state.home.saved;
  const kept = { ...((state.home.saved || {})[gname] || {}) };
  if (save) kept[channel] = new Date().toISOString(); else delete kept[channel];
  state.home.saved = { ...(state.home.saved || {}), [gname]: kept };
  renderAgents();
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  const asked = homesTaken;
  try { const got = await post("/api/saved", { gatherer: gname, channel, saved: save }); if (!homeSince(asked)) state.home.saved = got; }
  catch (err) { undone(asked, { saved: before }); setLive(`Not saved: ${err.message}`); }
  redrawList();
}
// FOLDERS (folders.py, `home.folders`: {gatherer: {folders: [{id, parent, name}], filed: {channel: folder id}}}), kept by
// the server so every dashboard on this home shows the same: the list as a tree, each gatherer its top folder -- what
// each box lists, and in which order, is features/list/tree.ts's and model.ts's. A folder is folded till opened (kept in
// this browser); folded, its actors open in a pane stay in view under it. Folders only organise the list: what a
// gatherer's actors share of one another's context is the gatherer's, whatever folder each is in. A folder CLOSED (its
// ×, closeFolder: folders.py's `close`) is listed in its parent's closed line, with its actors (shownClosed); deleted
// (its bin), what was in it moves up a level.
const FOLDER_CHARS = 60;
const byName = LT.byName;
// `gname` GF: the folders gatherers are kept in (features/list/gatherer-folders.js), their tree as a gatherer's, filed by gatherer
const treeOf = (gname) => LT.treeOf(CTX, gname);
const folderById = (gname, id) => LT.folderById(CTX, gname, id);
const parentOf = (gname, f) => LT.parentOf(CTX, gname, f);
const kidFolders = (gname, id) => LT.kidFolders(CTX, gname, id);
const filedAs = (gname, a) => LT.filedAs(CTX, gname, a);
const folderOf = (gname, a) => LT.folderOf(CTX, gname, a);
const within = (gname, id, inside) => LT.within(CTX, gname, id, inside);
const folderPath = (gname, id, sep = " / ") => LT.folderPath(CTX, gname, id, sep);
const actorsWithin = (g, id) => LT.actorsWithin(CTX, g, id);
// Those of them open in a pane: in view under the folder while it is folded
const inPane = (g, a) => openActors().some((sel) => isAt(sel, g.name, a.channel));
const openIn = (g, id) => actorsWithin(g, id).filter((a) => inPane(g, a));
const folderTally = (g, id) => LT.folderTally(CTX, g, id);
const shellsWithin = (g, id) => LT.shellsWithin(CTX, g, id);
const shownClosed = (g, f) => LT.shownClosed(CTX, g, f);
const closedKids = (g, id) => LT.closedKids(CTX, g, id);
const closedSays = (g, id, own) => LT.closedSays(CTX, g, id, own);
// Each folder open or not (its key: its gatherer, its id), kept in this browser; a folder made, or one an actor is put
// in, opened
const FOLDERS_OPEN_KEY = "ag-dashboard-folders-open";
const foldersOpen = (() => {
  { const v = prefs.list(FOLDERS_OPEN_KEY); if (v) return new Set(v); }
  return new Set();
})();
const isOpenFolder = (gname, id) => gname === GF ? !gfFolded.has(id) : foldersOpen.has(folderKey(gname, id));
function showFolder(gname, id, open) {
  if (id === null) return;
  if (gname === GF) return gfShow(id, open);
  const k = folderKey(gname, id);
  if (open) foldersOpen.add(k); else foldersOpen.delete(k);
  prefs.keep(FOLDERS_OPEN_KEY, [...foldersOpen]);
}
function toggleFolder(gname, id) {
  showFolder(gname, id, !isOpenFolder(gname, id));
  renderAgents();
}
// A box's folds (Closed, Saved, Terminals) open or not, by its key (features/list/model.ts's boxKey)
// A name for a new folder in `parent` none beside it has: `base`, else `base 2`, ...
function freeName(gname, parent, base) {
  const taken = new Set(kidFolders(gname, parent).map((f) => f.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}
// The page's own copy changed as the server will change it (`change(the gatherer's tree)`), so the list shows it at
// once; the server's answer, or the next home, has the last word (whichever is newer: takeHome). -> the answer, or null.
// The folders gatherers are kept in (GF): their own request, their own field of the home.
async function folderPost(gname, body, change = null) {
  const gf = gname === GF, field = gf ? "gatherer_folders" : "folders", before = state.home[field];
  if (change) {
    if (gf) { const tree = structuredClone(treeOf(GF)); change(tree); state.home.gatherer_folders = tree; } else {
      const all = structuredClone(state.home.folders || {});
      change(all[gname] = all[gname] || { folders: [], filed: {} });
      state.home.folders = all;
    }
  }
  renderAgents();
  if (SNAPSHOT) return null;                       // a snapshot has no server: this page only
  const asked = homesTaken;
  try {
    const got = await post(gf ? "/api/gatherer-folders" : "/api/folders", gf ? body : { gatherer: gname, ...body });
    if (!homeSince(asked)) state.home[field] = got[field];
    return got;
  } catch (err) {
    if (!homeSince(asked)) state.home[field] = before;
    setLive(`Not done: ${err.message}`);
    return null;
  } finally { redrawList(); }
}
// A closed folder something is put in (or made in) open again, and the closed folders it is in (folders.py's `_opened`),
// in the page's copy of its gatherer's tree
function openUp(tree, id) {
  for (let f = tree.folders.find((x) => x.id === id), n = 0; f && n < 500; f = tree.folders.find((x) => x.id === f.parent), n++) f.closed = null;
}
// Actors put in folder `id` (null: their gatherer's top), by the channels they are filed as (or will be): it opened
function fileActors(gname, actors, id) {
  const channels = actors.map((a) => filedAs(gname, a) || a.channel);
  if (!channels.length) return null;
  showFolder(gname, id, true);
  return folderPost(gname, { do: "file", channels, folder: id }, (tree) => {
    for (const c of channels) { if (id === null) delete tree.filed[c]; else tree.filed[c] = id; }
    openUp(tree, id);
  });
}
// A folder made in `parent` (null: the gatherer's top), opened -- drawn once the server has made it (its id is the
// server's) -> the answer ({made: its id}), or null
async function makeFolder(gname, name, parent) {
  showFolder(gname, parent, true);
  const got = await folderPost(gname, { do: "new", name, parent });
  if (got && got.made !== undefined) { showFolder(gname, got.made, true); renderAgents(); }
  return got;
}
const renameFolder = (gname, id, to) => folderPost(gname, { do: "rename", id, to }, (tree) => {
  const f = tree.folders.find((x) => x.id === id);
  if (f) f.name = to;
});
function moveFolder(gname, id, parent) {
  showFolder(gname, parent, true);
  return folderPost(gname, { do: "move", id, parent }, (tree) => {
    const f = tree.folders.find((x) => x.id === id);
    if (f) f.parent = parent;
    openUp(tree, parent);
  });
}
// A folder deleted: what was in it -- its actors, its folders -- moved up into the one it was in
const deleteFolder = (gname, id) => folderPost(gname, { do: "delete", id }, (tree) => {
  const f = tree.folders.find((x) => x.id === id);
  if (!f) return;
  const up = tree.folders.some((x) => x.id === f.parent) ? f.parent : null;
  for (const x of tree.folders) if (x.parent === id) x.parent = up;
  for (const [c, at] of Object.entries(tree.filed)) if (at === id) { if (up === null) delete tree.filed[c]; else tree.filed[c] = up; }
  tree.folders = tree.folders.filter((x) => x.id !== id);
});
// Where the next actor started from the list goes: the folder whose "+ actor" or "+ ⋯" was pressed last, or its gatherer's
// top (null) -- set by each start button as it is pressed (startButtons; railNew, railMore in the rail's cards). Once started, the actor is filed
// there (fileStarted), as the server answers with its id; a terminal is opened there (startShell, `shellFolder`).
let startIn = { g: "", folder: null };
const aimStart = (gname, id) => { startIn = { g: gname, folder: id }; };
async function fileStarted(gname, id) {
  const fid = startIn.g === gname ? startIn.folder : null;
  if (fid === null || !id || !folderById(gname, fid)) return;
  showFolder(gname, fid, true);
  await folderPost(gname, { do: "file", channels: [id], folder: fid }, (tree) => { tree.filed[id] = fid; openUp(tree, fid); });
}
const shellFolder = (gname) => startIn.g === gname && folderById(gname, startIn.folder) ? startIn.folder : null;
// SELECTING several actors of one gatherer, to move them at once (or save, or close them): Shift+click adds an actor to
// the selection, or takes it out (⌘/Ctrl+click opens one beside the one shown). One selected is only tinted; from two,
// each has a check on its avatar, and a bar under the list (renderPickBar) offers Move to…, Save, Close. Dragging a
// selected actor drags them all. A selection is of one gatherer, as actors never leave theirs; Esc, or ✕, clears it.
const picks = { g: null, cs: new Set() };
const picked = (g, a) => picks.g === g.name && picks.cs.has(a.channel);
function togglePick(g, a) {
  if (picks.g !== g.name) { picks.g = g.name; picks.cs = new Set(); }
  if (picks.cs.has(a.channel)) picks.cs.delete(a.channel); else picks.cs.add(a.channel);
  if (!picks.cs.size) picks.g = null;
  renderAgents();
}
function clearPicks(draw = true) {
  if (!picks.g) return;
  picks.g = null; picks.cs = new Set();
  if (draw) renderAgents();
}
// [its gatherer, the actors selected] as the home has them now (one gone since: left out)
function pickedActors() {
  const g = picks.g && gathererNamed(picks.g);
  return g ? [g, g.agents.filter((a) => picks.cs.has(a.channel) && !isCoordinator(a))] : [null, []];
}
function renderPickBar() {
  let bar = document.getElementById("pick-bar");
  if (!bar) {
    bar = el("div", { id: "pick-bar", class: "pick-bar", role: "toolbar", "aria-label": "Selected actors" });
    document.getElementById("agents").after(bar);
  }
  const [g, list] = pickedActors();
  bar.hidden = SNAPSHOT || list.length < 2;
  if (bar.hidden) { bar.replaceChildren(); return; }
  const allSaved = list.every((a) => savedAs(g.name, a));
  bar.replaceChildren(
    el("span", { class: "n", text: `${list.length} selected` }),
    el("button", { type: "button", class: "pb", "data-pop": "picks:move", "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === "picks:move"),
      title: `Move to a folder in ${titleOf(g)}`, onclick: (ev) => openMoveMenu(g, list, ev.currentTarget) },
      strokeIcon(ICONS.folder, 14), "Move to…"),
    el("button", { type: "button", class: "pb", title: allSaved ? "Unsave them all" : "Save them all for later",
      onclick: () => savePicks(g, list, !allSaved) }, saveIcon(allSaved), allSaved ? "Unsave" : "Save"),
    el("button", { type: "button", class: "pb", title: "Close them all, even mid-turn",
      onclick: () => closePicks(g, list) }, closeIcon(), "Close"),
    el("button", { type: "button", class: "pb x", title: "Clear the selection (Esc)", "aria-label": "Clear the selection", onclick: () => clearPicks() }, "✕"));
}
// "Move to…": the gatherer's top, each of its folders as a tree, or a new folder (at the top, then named in its line)
function openMoveMenu(g, list, button) {
  const items = [{ mark: el("span", { class: "top-mark" }, strokeIcon(ICONS.folder, 16)), text: `Top of ${titleOf(g)}`, run: () => movePicks(g, list, null) }];
  const walk = (id, depth) => {
    for (const f of kidFolders(g.name, id)) {
      items.push({ icon: ICONS.folder, text: f.name, depth, run: () => movePicks(g, list, f.id) });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  items.push({ icon: ICONS.folderNew, text: "New folder…", note: "at the top, with the selected actors",
    run: async () => {
      const got = await makeFolder(g.name, freeName(g.name, null, "New folder"), null);
      if (got && got.made !== undefined) { await movePicks(g, list, got.made); startFolderEdit(g.name, got.made); }
    } });
  openPop("picks:move", button, popMenu(`Move ${list.length} actors to`, items));
}
function movePicks(g, list, id) {
  clearPicks(false);
  return fileActors(g.name, list, id);
}
async function savePicks(g, list, save) {
  for (const a of list) if (!!savedAs(g.name, a) !== save) await setSaved(g.name, a, save);
}
async function closePicks(g, list) {
  clearPicks();
  for (const a of list) {
    if (closable(a)) await closeActor(g, a, closeSession);
    else if (discardable(a)) await closeActor(g, a, () => discardSession(g, a));
  }
}
// Choices this browser kept before the server did: handed to the server once, then dropped here.
async function moveHidingToServer() {
  const v = prefs.json(HIDDEN_KEY);
  if (SNAPSHOT || !v) return;
  const had = state.home.hiding || {};
  for (const name of v.hidden || []) if (!had[name]) await keepChoice(name, "hidden");
  for (const name of v.shown || []) if (!had[name]) await keepChoice(name, "shown");
  prefs.drop(HIDDEN_KEY);
  renderAgents();
}
// A gatherer's or a folder's actors as its box lists them (features/list/tree.ts's boxGroups): [group, list] for each
// that has any. `id`: the folder; null, the gatherer's top. The rail (railBox) has them so too.
const OPEN = LT.OPEN;
const boxGroups = (g, id) => LT.boxGroups(CTX, g, id);
// how many of a group's actors wait on the user, how many stopped on an error, and how many run now (features/list/
// groups.ts's Counts), as chips; nothing while none does
function countChips(c) {
  const of = plural(c.of, "actor");
  const count = (k, cls, what) => k ? el("span", { class: "count" + cls, title: `${k} of ${of} ${what}` }, el("i", { "aria-hidden": "true" }), String(k)) : null;
  return [count(c.asking, " asking", "waiting for you"), count(c.error, " error", "stopped on an error"),
    c.notified ? el("span", { class: "count notified", title: `${plural(c.notified, "app")} with a notification you haven't seen` }, el("i", { "aria-hidden": "true" }), String(c.notified)) : null,
    count(c.running, "", "running")].filter(Boolean);
}
const gathererCounts = (g) => countChips(LG.gathererCounts(CTX, g));
// The reader's choices, and what is shown, as the list's view-model reads them (features/list/model.ts's ListView)
function listView() {
  return {
    collapsed, foldOpen, crewHidden, foldersOpen, gfFolded, picks, gPicks,
    renaming: state.renaming || null, folderEdit: state.folderEdit || null, folderClosing, adding: state.adding || null,
    gfMaking: gfMakingNow(),
    open: openActors(), focused: focusedActor() || null, selected: state.selected || null, away: isAway(),
    appSelected: appSelected(), appsOnly: appsOnlyKey(), selectedTask: selectedTask(),
    appPanels: new Set(panes.apps.filter((p) => !p.held).map((p) => p.instance.id)),
    tab: tabAt,
  };
}
// The list as its view-model has it now (features/list/model.ts)
const listModel = () => buildList(CTX, listView());
function renderAgents() {
  if (PANE) return;                                  // a frame has no list: the page around it has
  if (listDrag && !listDrag.force) { listDrag.later = true; return; }   // an actor dragged: once it is over
  drawn.agents = listSignature();                    // what render() compares a home's with
  const model = listModel();
  for (const g of model.visible) readApps(g.name);   // the apps its actors are attached to
  renderFolded();
  drawTotals(model.totals);                          // in the top bar, whatever shape the list is in
  const aside = document.getElementById("agents");
  const was = listPlaces(aside);
  const typing = nameInput && document.activeElement === nameInput && [nameInput.selectionStart, nameInput.selectionEnd];
  const folderTyping = folderInput && document.activeElement === folderInput && [folderInput.selectionStart, folderInput.selectionEnd];
  nameMoving = true;                                 // taken out and put back: not a blur that names it
  document.getElementById("home").textContent = document.getElementById("home").title = model.home;
  manageEntry();                                     // Manage groups, in the settings panel (features/list/group-moves.js)
  // its head: a gatherer or a folder of gatherers dropped on it, at the list's top (features/list/gatherer-folders.js)
  aside.replaceChildren(dropOn(el("div", { class: "aside-head" }, el("h2", { text: "Agents" }), outsideDrop(),
    SNAPSHOT ? null : el("button", { class: "gf-new", type: "button", title: GF_NEW, "aria-label": GF_NEW,
      onclick: () => startFolderEdit(GF, null, null) }, strokeIcon(ICONS.folderNew, 15)),   // a group (features/list/gatherer-folders.js)
    aloneNew(),                                      // an actor on its own (features/list/group-moves.js)
    SNAPSHOT || !model.merged ? null : crewButton(null, "all"),   // the coordinator agent over everything
    el("span", { class: "list-btns" }, ...listButtons())), GFS, null, () => {}));
  if (model.empty) aside.append(el("div", { class: "servers", text: model.empty }));
  // the coordinator agent over everything; its gatherers, in the folders the reader keeps them in, if any; then the
  // actors on their own closed, in their lines
  if (model.overAll) aside.append(el("div", { class: "g-kids crew-top" }, agentRow(model.overAll)));
  aside.append(...model.top.flatMap(drawNode));
  if (model.hidden.length) {
    const list = el("details", { class: "hidden-list", id: "hidden-gatherers" },
      el("summary", { text: `${model.hidden.length} hidden group${model.hidden.length === 1 ? "" : "s"}` }));
    for (const h of model.hidden) list.append(el("div", { class: "hidden-row" }, el("span", { class: "gname", text: h.title }),
      el("span", { class: "why" }, ...(h.hidden ? ["hidden"]
        : ["inactive, last active ", el("span", { "data-ago": h.last, text: ago(h.last) })])),
      el("button", { type: "button", onclick: () => setHidden(h.g, false) }, "Show")));
    const wasOpen = document.getElementById("hidden-gatherers");
    if (wasOpen && wasOpen.open) list.open = true;
    aside.append(list);
  }
  slideList(aside, was);
  if (manage.dialog && manage.dialog.open) drawManage();   // the groups as they are now (features/list/group-moves.js)
  if (hover.from === "agents") cardDraw();           // its card, said again from the new data
  nameMoving = false;
  if (state.renaming && !(nameInput && nameInput.isConnected)) { state.renaming = null; nameInput = null; }   // its row folded away
  else if (typing) { nameInput.focus({ preventScroll: true }); nameInput.setSelectionRange(...typing); }
  if (state.folderEdit && !(folderInput && folderInput.isConnected)) { state.folderEdit = null; folderInput = null; }   // folded away
  else if (folderTyping) { folderInput.focus({ preventScroll: true }); folderInput.setSelectionRange(...folderTyping); }
  if (folderClosing && folderClosing.from === "list" && !document.querySelector("#agents .f-ask")) folderClosing = null;   // folded away
  askRefocus();
  markDragged();                                     // drawn again mid-drag: what is dragged, still shown as it
  renderPickBar();
  placeIfShown();                                    // an actor or an app put in a task, or taken out: its block now
  if (workPlacer) workPlacer.tabs.draw();            // what each screen tab's actors do
  refreshNewTab();                                   // a new tab's page: its groups, folders, harnesses as they are now
  const servers = state.home.hook_servers || [];     // in the dashboard's panel (the header's button)
  document.getElementById("servers").textContent = servers.length
    ? servers.map((s) => `:${s.port} → ${s.upstream}`).join("\n") : "None running.";
}
// A node of the list's view-model drawn: its elements, in order
function drawNode(n) {
  switch (n.kind) {
    case "gatherer": return [gathererBox(n)];
    case "alone": return [el("div", { class: "gatherer alone", title: ALONE_SAYS }, ...n.kids.flatMap(drawNode))];   // an actor on its own: its rows alone
    case "alone-shut": return [el("div", { class: "gatherer alone shut" }, ...n.folds.flatMap(foldRows))];   // those closed, in their lines
    case "gf-folder": return gfLines(n, drawNode);   // a folder of gatherers (features/list/gatherer-folders.js)
    case "gf-making": return [el("div", { class: "folder-line gf-line making", "data-key": n.key, role: "status" },
      el("span", { class: "fname", text: n.text }), el("span", { class: "fill", text: "Making the group…" }))];
    case "folder-new": return [el("div", { class: "folder-line" + (n.g === GF ? " gf-line" : "") + " editing", "data-key": n.key }, folderBox())];
    case "folder": return folderRows(n);
    case "fold": return foldRows(n);
    case "actor": return [agentRow(n)];
    case "task": return [taskRow(n)];
    case "app": return [appRow(n)];
    case "shell": return [shellRow(n)];
    default: return [];
  }
}
// A gatherer's box in the list: its row -- its name, its gatherer agent, its counts, its buttons over them on hover --
// and, open, what is in it set in under it. Its row dragged (dragGatherer): put in a folder of gatherers.
function gathererBox(n) {
  const g = n.g;
  const box = el("div", { class: "gatherer" + (n.nested ? " nested" : "") + (n.picking ? " picking" : "") },
    dropOn(dragGatherer(el("div", { class: "gatherer-row", "data-key": n.key },
      el("button", { class: "name", type: "button", "aria-expanded": n.open ? "true" : "false", onclick: () => toggleGatherer(g.name),
        title: g.policy ? `${g.name} · policy ${g.policy}` : g.name },
        el("span", { class: "caret", text: "▶" }),
        n.renaming ? null : el("span", { class: "gname", text: n.title })),
      n.renaming ? nameBox() : null,
      SNAPSHOT ? null : crewButton(g),                 // its coordinator agent, just after its name
      // how many of its actors wait on the user, how many stopped on an error, and how many run now; nothing while none does
      // -- and over them while it is hovered (or in focus), in a folder's line's order: "+ actor", "+ ⋯", a new folder,
      // rename, and hide (a folder's: delete)
      el("span", { class: "fill", onclick: () => toggleGatherer(g.name) }, ...countChips(n.counts),
        el("span", { class: "g-acts", onclick: (ev) => ev.stopPropagation() }, ...(SNAPSHOT ? [] : startButtons(g)),
          rowMore(`gmore:${g.name}`, n.title, [
            ...(SNAPSHOT ? [] : [{ icon: ICONS.folderNew, text: "New folder", run: () => startFolderEdit(g.name, null, null) },
              { icon: ICONS.pencil, text: "Rename", run: () => retitle(g) }]),
            { mark: hideIcon(), text: "Hide", run: () => setHidden(g, true) }])))), g), g, null,
    () => { if (collapsed.has(g.name)) toggleGatherer(g.name); }));
  if (n.adding) box.append(newForm());
  if (n.error) box.append(el("div", { class: "servers", text: `Database unreadable: ${n.error}` }));
  // open: what is in it -- its gatherer agent, then its box's rows -- set in under its row, as a folder's are (g-kids)
  if (n.kids.length) box.append(el("div", { class: "g-kids" }, ...n.kids.flatMap(drawNode)));
  return box;
}
// A user's message in a chat bubble: src/features/chat/Bubble.tsx (ag_dashboard/DESIGN.md, A5). A message between the
// actors of a gatherer (coordination.py's `envelope`), or the news of a watch: features/list/envelope.ts (envelope,
// crewLine), which Chat reads too.
const MANAGER = "roles/manager";             // the gatherer agent's picture (avatars.py's ROLES), before it has one
// An actor's avatar, small, as the list draws it (actorLogo) less its harness's mark: `fallback`, the picture with none.
function crewFace(a, fallback = null) {
  const name = (a && a.avatar) || fallback;
  const svg = SNAPSHOT && name && (SNAPSHOT.avatars || {})[name];
  const src = !name ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${name}.svg`;
  return src ? el("img", { class: "crew-face", src, alt: "", draggable: "false" })
    : el("span", { class: "crew-face none", "aria-hidden": "true" }, strokeIcon(ICONS.crew, 12));
}
// A COORDINATOR AGENT is over a NODE of the list (features/list/groups.ts): "all", "groups:<id>", "group:<name>" or
// "folder:<id>"
const isCoordinator = LS.isCoordinator;
const crewNode = LG.crewNode;
const isCrewHome = LG.isCrewHome;
const groupCrew = LG.groupCrew;
const crewAt = (node, g = null) => LG.crewAt(CTX, node, g);
const crewHideKey = LG.crewHideKey;
const crewPlace = (node, g = null) => LG.crewPlace(CTX, node, g);
// An actor is a TASK too (features/layout/panes.js's taskKey): its row says how it stands at its left, its state in a word on its
// meta line (none, idle), and shows its face at its right. `r`: its row in the list's view-model (model.ts's ActorRow).
function agentRow(r) {
  const { g, a, group, current, naming, named, asked } = r, [cls, label] = r.status;
  // its name -- else what it was last asked -- double-clicked once it is the one shown (or F2): named there. Not a single
  // click: the row is its name alone, and a click on the row shown shows it (its task laid out again, if it was not)
  const nameIt = SNAPSHOT || !current ? {} : { ...(HOVERS.matches ? {} : { title: `${nameNote(g, a)}Double-click to ${named ? "rename" : "name"} it` }),
    ondblclick: (ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.stopPropagation(); startRename(g, a); } };
  const row = el(naming ? "div" : "button", { class: "agent" + (naming ? " renaming" : "") + (r.coordinator ? " coordinator" : "") + (r.picked ? " picked" : ""),
    ...(naming ? {} : { type: "button" }),
    "aria-current": current ? "true" : "false", "data-key": r.key, "data-group": group,
    ...(r.open ? { "data-open": "true" } : {}), ...(naming ? {} : { "data-card": key(g.name, a.channel) }),
    // hovered, the card (actorCard) says who it is; where there is no hovering, its title
    ...(HOVERS.matches ? {} : { title: `${harnessName(a.harness)} · ${label} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}`
      + (asked && named ? `\nAsked: ${firstLine(asked, 300)}` : "") + (a.recap && a.recap.text ? `\nRecap, ${ago(a.recap.at)}: ${a.recap.text}` : "")
      + (SNAPSHOT ? "" : `\n${BESIDE_KEY}+click to open side by side${r.coordinator ? "" : "\nShift+click to select several"}`) }),
    ...(naming ? {} : { onclick: (ev) => {
      if (ev.shiftKey && !SNAPSHOT && !r.coordinator) { ev.preventDefault(); togglePick(g, a); return; }
      pick(g.name, a.channel, ev);
    }, oncontextmenu: (ev) => pickBeside(g.name, a.channel, ev),
      onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startRename(g, a); } } }) },
    // its state at its left -- the list is drawn again on every change: the glyph's turn set by the clock, not restarted
    // each time -- and its face at its right
    el("span", { class: `dot ${cls}`, "aria-label": label, style: `--spin-at: -${Date.now() % 1200}ms` }),
    el("div", {},
      // just its name, else what it was last asked, on one line: what it was asked and its recap, in its title (and over
      // the whole page, the monitor's card)
      naming ? nameBox() : el("div", { class: "name" + (r.label.cls ? ` ${r.label.cls}` : ""), ...nameIt }, r.label.text),
      rowActs(addButton(g, a.channel), saveButton(g, a, r.saved), closeButton(g, a, r.close)),
      branchChip(g, a),
      (a.background || []).length ? el("div", { class: "bgline", title: a.background.map((t) => `${TASK_KINDS[t.kind] || t.kind}: ${t.label || t.id}`).join("\n") },
        `${a.background.length} in background · ${a.background.map((t) => t.label || t.id).join(", ")}`) : null),
    el("span", { class: "a-face" }, tabMark(r.tab), pickMark(g, a, plainFace(a), r.checked)));
  return naming || r.coordinator ? row : dropOnItem(dragRow(row, g, a), g, a.channel);
}
// TASKS (tasks.py, `home.tasks`: {gatherer: {tasks: [{id, name}], tasked: {item: task id}}}): what the reader works with
// at once -- actors and apps alike, its ITEMS: an actor by its channel, an app's instance by "app:<its id>" (appItem) --
// one row in the list (taskRow), a leaf: what is in it shown in its card (features/list/modes.js's taskCard), and in its layout,
// opened by a click (openTask). An item in none is a task of its own: an actor's row (agentRow), an app's (appRow). Within
// a task every agent is attached to every app (task_links.py). Its "+" (addButton) adds to it a new agent (addToTask) or
// an app (addAppToTask); an item dragged onto another's row is put in its task (dropOnItem); the × in its card takes one
// out (takeOut). What is in a task, its lead and its state: features/list/tasks.ts.
const APP_ITEM = "app:";
const appItem = (id) => `${APP_ITEM}${id}`;
const isAppItem = (k) => String(k || "").startsWith(APP_ITEM);
// a change's answer ({tasks, now}): its tasks taken, those of every gatherer (features/list/seen.js's newerTasks)
const takeTasks = (got) => { state.home.tasks = newerTasks(state.home.tasks, got.tasks, got.now); };
const taskById = (gname, id) => LK.taskById(CTX, gname, id);
const taskOf = (gname, a) => LK.taskOf(CTX, gname, a);
const appTaskOf = (gname, id) => LK.appTaskOf(CTX, gname, id);
const actorOf = LK.actorOf;
const itemTaskOf = (g, k) => LK.itemTaskOf(CTX, g, k);
// an item as the server keeps it: an actor by the channel it is in its task as, or filed as
const keptAs = (g, k) => LK.keptAs(CTX, g, k);
const taskMembers = (g, id) => LK.taskMembers(CTX, g, id);
const LEAD_RANK = LS.LEAD_RANK;
const taskActors = (g, id) => LK.taskActors(CTX, g, id);
const taskLead = (g, id) => LK.taskLead(CTX, g, id);
// AN ITEM'S STATUS, an app's as an actor's (features/list/status.ts)
const appKey = LS.appKey;
const appNotices = (gname, id) => LS.appNotices(CTX, gname, id);
const appStatusOf = (gname, id) => LS.appStatusOf(CTX, gname, id);
const taskStatus = (g, id) => LK.taskStatus(CTX, g, id);
const appsNotified = (g, inside = undefined) => LT.appsNotified(CTX, g, inside);
const actorTitle = LK.actorTitle;
const appTitle = LK.appTitle;
const appShown = LK.appShown;
const taskItems = (g, id) => LK.taskItems(CTX, g, id);
const taskName = (g, t) => LK.taskName(CTX, g, t);
// the folder an app is filed in (folders.py's `filed`, by its item); null: its gatherer's top
const appFolder = (gname, id) => LT.appFolder(CTX, gname, id);
// THE APPS of each gatherer (/api/apps, the host's): its open instances, and its tasks with them (which an app is in) --
// read again as the list is drawn, at most every APPS_READ ms (`now`: at once; -> once read) -- the list drawn again if
// they changed
const APPS_READ = 2000, appsKnown = new Map(), appsRead = new Map();
function readApps(gname, now = false) {
  if (PANE || SNAPSHOT || !appHost.found().length) return Promise.resolve();
  if (!now && Date.now() - (appsRead.get(gname) || 0) < APPS_READ) return Promise.resolve();
  appsRead.set(gname, Date.now());
  return get(`/api/apps?gatherer=${encodeURIComponent(gname)}`).then((got) => {
    const is = JSON.stringify({ instances: got.instances || [], attached: got.attached || {} });
    const had = JSON.stringify(state.home.tasks || {});
    if (got.tasks) state.home.tasks = newerTasks(state.home.tasks, got.tasks.tasks && got.tasks.tasks.length ? { [gname]: got.tasks } : {}, got.now, gname);
    const moved = had !== JSON.stringify(state.home.tasks || {});
    if (!moved && JSON.stringify(appsKnown.get(gname) || null) === is) return;
    appsKnown.set(gname, JSON.parse(is));
    appsFollowHome(state.home);                      // read before a move the home has since: where the home has it
    renderAgents();
  }).catch(() => { /* none known: none shown */ });
}
// Each app where the home says it is (its `app_groups`, the server's app host's: read with the actors): one read under
// another group -- moved since with its task or folder -- taken over to that one, its agents with it. Else the list
// draws it twice for a moment: in its task in the new group, and alone in the old one, as last read there.
function appsFollowHome(home) {
  const where = home && home.app_groups;
  if (!where) return;
  for (const [g, known] of [...appsKnown]) {
    const gone = (known.instances || []).filter((i) => where[i.id] !== undefined && where[i.id] !== g);
    if (!gone.length) continue;
    const ids = new Set(gone.map((i) => i.id)), attached = known.attached || {};
    appsKnown.set(g, { ...known, instances: known.instances.filter((i) => !ids.has(i.id)),
      attached: Object.fromEntries(Object.entries(attached).filter(([id]) => !ids.has(id))) });
    for (const i of gone) {
      const to = where[i.id], there = appsKnown.get(to) || { instances: [], attached: {} };
      appsKnown.set(to, { ...there, instances: [...(there.instances || []).filter((x) => x.id !== i.id), { ...i, gatherer: to }],
        attached: { ...(there.attached || {}), [i.id]: attached[i.id] || [] } });
    }
  }
}
// an open instance as the list has it -- {app (its manifest), id, title, name (the user's), folder, inst} -- null: of an
// app not found here
function appOf(i, gname) {
  const app = appHost.named(i.app);
  return app ? { app, id: i.id, title: i.title || "", name: i.name || "", folder: i.folder || null, group: gname, inst: i } : null;
}
const gathererApps = (gname) => PANE || SNAPSHOT ? [] : ((appsKnown.get(gname) || {}).instances || []).map((i) => appOf(i, gname)).filter(Boolean);
const appInfo = (gname, id) => gathererApps(gname).find((o) => o.id === id) || null;
// an app every agent of its group may use, in no task ever; what adding an app to an actor or a task does ("join",
// put in its task: addAppToTask; "folder", opened at its directory: openAppAt; "no", not offered); an item that is an
// app's instance whose app doesn't join tasks, not put in one by dragging (canJoin): features/list/tasks.ts
const groupApp = LK.groupApp;
const onTask = LK.onTask;
const keptOut = (g, k) => LK.keptOut(CTX, g, k);
// a task's apps, as they were opened
const taskApps = (g, id) => LK.taskApps(CTX, g, id);
// an app's mark: small, beside a task's faces
const appMarkOf = (o) => o.app.mark
  ? el("img", { class: "t-app", src: `/apps/mark/${encodeURIComponent(o.app.name)}.svg`, alt: o.app.label, title: appTitle(o), draggable: "false" })
  : el("span", { class: "t-app none", title: o.app.label }, strokeIcon(ICONS.app, 12));
// an app's face: its mark at an avatar's size, where an actor has its face
const appFace = (o) => el("span", { class: "logo app-face", title: appTitle(o) }, o.app.mark
  ? el("img", { src: `/apps/mark/${encodeURIComponent(o.app.name)}.svg`, alt: "", draggable: "false" }) : strokeIcon(ICONS.app, 16));
// several apps' marks, stacked over one another as faces are (`most` at most); none: nothing
const appStack = (list, most = 3) => list.length ? el("span", { class: "t-apps" }, ...list.slice(0, most).map(appMarkOf)) : null;
// Where a row's task is OPEN (features/layout/panes.js's screen tabs): its tab's number, for a screen reader only (features/list/list.css) -- a
// boxed number by a face read as an unread count, and the row's bar already says it is open; the hover card says which
// tab (tabLine). None, open nowhere: a click opens it in a tab of its own, and it can be dragged onto the work area.
const tabAt = (k) => k && workPlacer && !SNAPSHOT ? workPlacer.tabs.where(k) : null;
// `at`: where it is open (tabAt), as the row has it
function tabMark(at) {
  if (!at) return null;
  const said = at.here ? `Open here in tab ${at.n}` : `Open in tab ${at.n} · click to switch to it`;
  return el("span", { class: "tab-no" + (at.here ? " here" : ""), "aria-label": said }, String(at.n));
}
// the same, said in its hover card
function tabLine(k) {
  const at = tabAt(k);
  return at ? el("div", { class: "c-tab", text: at.here ? `Open here, in tab ${at.n}` : `Open in tab ${at.n}` }) : null;
}
// an actor's face alone, no harness's badge (actorLogo's): its avatar, else its harness's mark
function plainFace(a) {
  const svg = SNAPSHOT && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
  const src = !a.avatar ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${a.avatar}.svg`;
  return src ? el("span", { class: "logo avatar" }, el("img", { src, alt: "", draggable: "false" })) : harnessLogo(a.harness);
}
// its actors' faces, those not closed (three at most, then how many more: `faces`, [{a, status}], and `more`, as a
// task's row has them), and the marks of its apps
function facesOf(faces, more, apps) {
  const out = [];
  for (const { a, status } of faces) {
    const svg = SNAPSHOT && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
    const src = !a.avatar ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${a.avatar}.svg`;
    out.push(src ? el("img", { class: "t-face", src, alt: "", title: `${actorTitle(a)} · ${status[1]}`, draggable: "false" })
      : el("span", { class: "t-face none", title: actorTitle(a) }, harnessLogo(a.harness)));
  }
  if (more) out.push(el("span", { class: "t-more", text: `+${more}` }));
  const stack = appStack(apps);
  if (stack) out.push(stack);
  return out;
}
function taskFaces(g, id) {
  const list = taskActors(g, id);
  return facesOf(list.slice(0, 3).map((a) => ({ a, status: statusOf(a) })), Math.max(0, list.length - 3), taskApps(g, id));
}
// A task's row: as an actor's -- its lead's state at its left, its name -- its actors' faces and its apps' marks at its
// right, its "+" over them hovered. A group, not a folder: what is in it is listed in its card (hovered), not in the
// list. Pressed: opened (openTask). Dragged: all in it; an item dropped on it, put in it. `r`: its row in the list's
// view-model (model.ts's TaskRow).
function taskRow(r) {
  const { g, t, name, first, naming } = r, [cls, label] = r.status;
  const k = `${TASK_ITEM}${t.id}`;
  const row = el(naming ? "div" : "button", { class: "agent task" + (naming ? " renaming" : ""), ...(naming ? {} : { type: "button" }),
    "aria-current": r.current ? "true" : "false", "data-key": r.key,
    "data-group": r.group, ...(r.open ? { "data-open": "true" } : {}), ...(naming ? {} : { "data-card": key(g.name, `task:${t.id}`) }),
    ...(HOVERS.matches ? {} : { title: `${name} · ${r.what || "empty"}${SNAPSHOT ? "" : `\n${BESIDE_KEY}+click to open side by side\nDouble-click the name (or F2) to ${t.name ? "rename" : "name"} it`}` }),
    // pressed, its card put away (as the rail's tile does): a live card stays while the pointer is on the row, over the
    // panels the task opens
    ...(naming ? {} : { onclick: (ev) => { cardHide(ev); openTask(g.name, t.id, null, ev); }, onkeydown: (ev) => renameKey(ev, g, k) }) },
  el("span", { class: `dot ${cls}`, "aria-label": label, style: `--spin-at: -${Date.now() % 1200}ms` }),
  el("div", {},
    naming ? nameBox() : el("div", { class: "name", text: name, ...nameOnDouble(g, k) }),
    rowActs(first ? addButton(g, first) : null, taskSaveButton(g, t, r.members, r.saved), taskCloseButton(g, t, r.closable))),
  el("span", { class: "t-faces" }, tabMark(r.tab), ...facesOf(r.faces, r.more, r.apps)));
  return naming || !first ? row : dropOnItem(dragItems(row, g, () => taskItems(g, t.id)), g, first);
}
// A task SAVED: every actor in it saved for later, as an actor's bookmark saves it -- the bookmark filled once every one
// is; closed, the task is then listed in its folder's saved line, not its closed one (where its first actor comes).
// `all`, `saved`: its actors, and whether each is saved.
function taskSaveButton(g, t, all = taskMembers(g, t.id), saved = all.length > 0 && all.every((a) => !!savedAs(g.name, a))) {
  if (!all.length) return null;
  if (SNAPSHOT) return saved ? el("span", { class: "save-btn on", title: "Saved for later" }, saveIcon(true)) : null;
  return rowButton("save-btn" + (saved ? " on" : ""), { "aria-pressed": saved ? "true" : "false",
    title: saved ? "Saved for later · click to unsave" : "Save the task for later",
    "aria-label": saved ? "Unsave the task" : "Save the task for later" }, () => saveTask(g.name, t.id, !saved), saveIcon(saved));
}
async function saveTask(gname, id, save) {
  const g = gathererNamed(gname);
  for (const a of g ? taskMembers(g, id) : []) if (!!savedAs(gname, a) !== save) await setSaved(gname, a, save);
}
// A task CLOSED (its ×, while an actor of it runs): closed in the screen tabs first, as its tab's × would (features/layout/panes.js's
// closedInTabs: kept as it is now, its tab closed if it held nothing else), its actors' processes closed, as an actor's ×
// does, and its apps put to sleep -- kept, in the task, with nothing running for them (a Browser's tabs closed, their pages
// kept: app_host.py's `sleep_instance`) -- their panels here closed first. Clicked again later, it opens as
// it was: its apps above (a Browser's tabs opened again), its actors as closed ones are, started again by a message.
// `can`: one of its actors can be closed.
function taskCloseButton(g, t, can = !SNAPSHOT && taskMembers(g, t.id).some(closable)) {
  if (!can) return null;
  return rowButton("close-btn", { title: "Close the task · it reopens as it was",
    "aria-label": "Close the task" }, () => closeTask(g.name, t.id), closeIcon());
}
async function closeTask(gname, id) {
  const g = gathererNamed(gname);
  if (!g) return;
  const k = `${gname}\u0000t${id}`, apps = taskApps(g, id);
  await closedInTabs(k);
  if (tasksLaidOut.has(k) && selectedTask() === k) rememberTask(k);   // shown: opened again as it is now
  tasksLaidOut.delete(k);                            // its row clicked next, even while shown: laid out again, its apps back
  for (const p of [...panes.apps]) if (apps.some((o) => o.id === p.instance.id)) closeAppPane(p);
  await Promise.all(taskMembers(g, id).filter(closable).map(closeSession));
  await Promise.all(apps.map((o) => post("/api/apps/sleep", { gatherer: gname, instance: o.id })
    .catch((e) => paneNote(`${o.app.label}: ${e.message}`))));
  await loadHome();
  renderAgents();
}
// An app in no task, a task of its own: its row, as an actor's -- what it shows (its title, else its kind) and its kind
// under it, its "+" and its × (closeApp), its face at its right. Pressed: selected (selectApp); right-clicked, its panel's
// menu (features/layout/panes.js's appPanelMenu: moved, or closed); dragged onto another item's row, put in its task, as an item
// dropped on it is put in one with it. `r`: its row in the list's view-model (model.ts's AppRow).
function appRow(r) {
  const { g, o, item: k, told, last, naming } = r;
  const row = el(naming ? "div" : "button", { class: "agent app-row" + (naming ? " renaming" : ""), ...(naming ? {} : { type: "button" }),
    "aria-current": r.chosen ? "true" : "false", "data-key": r.key, "data-instance": o.id,
    "data-group": OPEN, ...(r.shown ? { "data-open": "true" } : {}), ...(naming ? {} : { "data-card": appKey(g.name, o.id) }),
    ...(HOVERS.matches ? {} : { title: `${o.name ? `${o.name} · ` : ""}${o.title ? `${o.app.label} · ${o.title}` : o.app.label}${last ? `\n${last.title}` : ""}${o.folder ? `\n${o.folder}` : ""}${SNAPSHOT ? "" : `\n${BESIDE_KEY}+click to open side by side\nRight-click to move or close the panel\nDouble-click the name (or F2) to ${o.name ? "rename" : "name"} it`}` }),
    ...(naming ? {} : { onclick: (ev) => { cardHide(ev); selectApp(g.name, o, ev); }, onkeydown: (ev) => renameKey(ev, g, k),
      oncontextmenu: (ev) => appPanelMenu(g.name, o, ev) }) },
  told ? el("span", { class: `dot ${told[0]}`, "aria-label": told[1] }) : el("span", { class: "dot-none", "aria-hidden": "true" }),
  el("div", {},
    naming ? nameBox() : el("div", { class: "name", text: appShown(o), ...nameOnDouble(g, k) }),
    rowActs(addButton(g, k), SNAPSHOT ? null : rowButton("close-btn", { title: `Close ${o.app.label}`, "aria-label": `Close ${o.app.label}` },
      () => closeApp(g.name, o), closeIcon()))),
  el("span", { class: "a-face" }, tabMark(r.tab), appFace(o)));
  return naming ? row : dropOnItem(dragItems(row, g, () => [k]), g, k);
}
// An app SELECTED, as an actor is (features/layout/panes.js's selectAppPane): its task entered first, if another is shown -- as a click
// on that task would; one of apps only, its apps alone shown (enterAppTask) -- its panel shown (opened, if it was not) and
// selected. ⌘/Ctrl: no task entered, its panel added beside the ones shown.
async function selectApp(gname, o, ev = null) {
  if (!state.home.gatherers.some((x) => x.name === gname)) return;
  const there = await viaTabs(taskKey(gname, appItem(o.id)), ev, appItem(o.id));   // where its task is open (features/layout/panes.js)
  const g = gathererNamed(gname);
  if (!g) return;
  if (there || !(ev && (ev.ctrlKey || ev.metaKey) && !SNAPSHOT)) {
    const k = taskKey(gname, appItem(o.id));
    if (selectedTask() !== k) {
      const id = appTaskOf(gname, o.id), lead = id === null ? null : taskLead(g, id);
      if (lead) await openTask(gname, id);
      else enterAppTask(gname, k);
      await taskAppsOpening;
    }
  }
  let p = panes.apps.find((q) => q.instance.id === o.id);
  if (p) p = showAppPanel(o.app, p.instance);        // (one held out of sight: shown)
  else {
    const inst = await appHost.instanceOf(o.app.name, gname, o.id).catch(() => null);
    if (!inst) { paneNote(`${o.app.label}: closed`); readApps(gname, true); return; }
    p = showAppPanel(o.app, inst);
  }
  selectAppPane(p);
}
// an app closed: closed in the screen tabs first (features/layout/panes.js's closedInTabs: one in no task, its tab closed if it held
// nothing else), its instance closed (its agents detached, out of its task), its panel gone
async function closeApp(gname, o) {
  await closedInTabs(taskKey(gname, appItem(o.id)), appItem(o.id));
  try { await post("/api/apps/close", { gatherer: gname, instance: o.id }); }
  catch (e) { paneNote(`Close ${o.app.label}: ${e.message}`); return; }
  appClosed(o.id);
  await loadHome();
  readApps(gname, true);
  renderAgents();
}
// A task opened: shown as it was left (features/layout/panes.js's enterTask and rememberTask) -- `focus`, else the one in focus then,
// else its lead, in the pane in focus -- or, never left, its actors not closed side by side, its apps above. The task
// shown already: as it is (an actor's pane closed in it stays closed) -- but one shown by chance, never laid out in this
// page (as the page opened on one of its actors), laid out as at first; one whose actor is out of sight in this page's pane
// with nothing else of it shown (its pane and panels closed), laid out again as it was left. One of apps only: its apps
// alone (enterAppTask); one left with its actor's pane closed by the reader (features/layout/panes.js's closeHerePane), its apps alone,
// that actor out of sight in this page's pane (`shut`) till it is asked for. ⌘/Ctrl: the whole task beside the one shown
// (features/layout/panes.js's openTaskBeside).
async function openTask(gname, id, focus = null, ev = null) {
  if (!state.home.gatherers.some((x) => x.name === gname)) return;
  const there = await viaTabs(`${gname}\u0000t${id}`, ev);   // where it is open (features/layout/panes.js)
  const g = gathererNamed(gname);
  if (!g) return;
  const k = `${gname}\u0000t${id}`, sel = focusedActor(), was = taskLayout(k);
  const wait = !(ev && ev.inTabs);                   // a tab being shown (features/layout/panes.js's enterTasks): its actor's Chat not waited on
  const ok = (c) => !!c && taskActors(g, id).some((a) => a.channel === c);
  const mine = !appsOnlyKey() && !!sel && taskKey(sel[0], sel[1]) === k;   // its actor in the pane in focus
  const blank = mine && isAway() && !shownPanels().some((s) => s.key === k);   // ... out of sight, nothing else of it shown
  if (blank) tasksLaidOut.delete(k);                       // laid out again, as it was left (enterTask)
  const laid = mine && !blank && tasksLaidOut.has(k);      // shown already, laid out: as it is
  const shut = !focus && !blank && !laid && was && ok(was.shut) && !was.actors.some(ok) && (was.apps || []).length ? was.shut : null;
  // as it was left: its panes in their order (the first in this page's own), the one in focus then in focus again
  const first = shut || focus || (was && ok(was.actors[0]) ? was.actors[0] : null) || (was && ok(was.focus) ? was.focus : null)
    || (taskLead(g, id) || {}).channel;
  if (!first) {                                            // apps only
    if (selectedTask() === k) return;
    enterAppTask(gname, k);
    await taskAppsOpening;
    const p = panes.apps.find((q) => !q.held && q.instance.id === (was && was.focusApp)) || panes.apps.find((q) => !q.held && appPaneTask(q) === k);
    if (p) selectAppPane(p);
    return;
  }
  if (!there && ev && (ev.ctrlKey || ev.metaKey) && !SNAPSHOT) return openTaskBeside(gname, k, first);   // the whole task, beside
  if (mine && !blank) {                                    // shown already: as it is, once laid out
    if (focus) await show(gname, focus, null, wait);
    else if (!laid) await show(gname, shut || sel[1], null, wait, !!shut);   // shown by chance (as the page opened): laid out now (enterTask)
    if (!shut) return;
  } else await show(gname, first, null, wait, !!shut);
  const back = !focus && was && ok(was.focus) && was.focus !== first && actorPanes().find((p) => isAt([p.g, p.c], gname, was.focus));
  if (back) focusPane(back);
  if (!focus && was && (was.focusApp || shut)) {           // an app selected in it when it was left: selected again (its
    await taskAppsOpening;                                 // actor's pane closed: one of its apps)
    const p = panes.apps.find((q) => q.instance.id === was.focusApp && !q.held)
      || (shut ? panes.apps.find((q) => !q.held && appPaneTask(q) === k) : null);
    if (p) selectAppPane(p);
  }
}
// "+" on an item's row, a task's (on its first item), and in a task's card (`label` beside it): something added to the
// item's task -- a new agent on a harness picked (addToTask), or an app, as adding it does (onTask): put in the task
// (addAppToTask), or opened at the item's directory beside it (openAppAt) -- from its menu
function addButton(g, k, label = null) {
  const a = isAppItem(k) ? null : actorOf(g, k), o = a ? null : appInfo(g.name, k.slice(APP_ITEM.length));
  if ((!a && !o) || (a && isCoordinator(a)) || (o && groupApp(o.app))) return null;
  const hs = SNAPSHOT ? [] : startable();
  const apps = SNAPSHOT || PANE ? [] : appHost.found().filter((app) => onTask(app) !== "no" && !app.failed);
  if (!hs.length && !apps.length) return null;
  // its menu's key: its own, apart from the list's "+" for the same item, which the menu would hang from otherwise
  const mk = `${label ? "card-" : ""}task-add:${g.name}/${k}`, id = itemTaskOf(g, k);
  const where = id !== null ? taskName(g, taskById(g.name, id)) : a ? actorTitle(a) : appTitle(o);
  const items = [
    ...hs.map((h) => ({ mark: harnessBadge(h), text: harnessName(h), note: "a new agent in the same directory", run: () => addToTask(g.name, k, h) })),
    ...apps.map((app) => onTask(app) === "folder"
      ? { icon: ICONS.app, mark: app.mark ? appMarkImg(app) : null, text: app.label, note: "opened at its directory, beside the task",
        run: () => openAppAt(g.name, k, app.name) }
      : { icon: ICONS.app, mark: app.mark ? appMarkImg(app) : null, text: app.label, note: "an app the task's agents can use",
        run: () => addAppToTask(g.name, k, app.name) }),
  ];
  const b = rowButton("task-add", { title: `Add ${[hs.length ? "an agent" : null, apps.length ? "an app" : null].filter(Boolean).join(" or ")} to this task`,
    "aria-label": "Add to this task", "data-pop": mk, "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === mk) },
  () => openPop(mk, b, popMenu(`Add to ${where}`, items)),
  el("span", { class: "task-add-in", "aria-hidden": "true" }, "+", label ? el("span", { class: "t-lbl", text: label }) : null));
  return b;
}
// the task of item `k` shown, if another is: entered as a click on it would -- where it is open, else in a tab of its own
async function showItemsTask(g, k) {
  if (selectedTask() === taskKey(g.name, k)) return;
  const id = itemTaskOf(g, k), a = isAppItem(k) ? null : actorOf(g, k);
  if (a) await (id === null ? pick(g.name, a.channel, {}) : openTask(g.name, id, null, {}));
  else { const o = appInfo(g.name, k.slice(APP_ITEM.length)); if (o) await selectApp(g.name, o, {}); }
}
// The task shown, its key changed by a change of the tasks (a lone item made one with others, or one joined): laid out
// still, and still the one entered, under its new key
function retask(was) {
  const now = selectedTask();
  if (!was || !now || was === now) return;
  if (tasksLaidOut.has(was)) tasksLaidOut.add(now);
  rekeyTask(was, now);
}
async function addToTask(gname, k, harness) {
  const g = gathererNamed(gname);
  const a = g && !isAppItem(k) ? actorOf(g, k) : null, o = g && !a ? appInfo(gname, k.slice(APP_ITEM.length)) : null;
  if (!a && !o) return;
  const cwd = (a ? cwdOf(a) : o.folder) || startCwd(g);
  if (!cwd) return paneNote("Can't add an agent: no directory to start it in");
  const fid = a ? folderOf(gname, a) : appFolder(gname, o.id), to = keptAs(g, k);
  await showItemsTask(g, k);
  const was = selectedTask();
  try {
    // started as any actor is (startSession): listed, shown in Chat -- beside the one it is added to -- its task joined
    // and its folder taken first
    await startSession(gname, cwd, harness, async (s) => {
      takeTasks(await post("/api/tasks", { gatherer: gname, do: "add", to, items: [s.session_id] }));
      if (fid !== null) await folderPost(gname, { do: "file", channels: [s.session_id], folder: fid }, (tree) => { tree.filed[s.session_id] = fid; });
      retask(was);
      readApps(gname, true);
    });
  } catch (e) { paneNote(`Add an agent: ${e.message}`); }
}
// An app added to an item's task: an instance of it (for the directory it works in, where the app has one per folder),
// put in the task -- every agent of it attached to it (task_links.py) -- its panel above them, selected; the task shown
// first, if another is. Agents attached so are given the app's tools the next time they start (tool_gateway.py: at
// launch).
async function addAppToTask(gname, k, name) {
  const g = gathererNamed(gname);
  const a = g && !isAppItem(k) ? actorOf(g, k) : null, o = g && !a ? appInfo(gname, k.slice(APP_ITEM.length)) : null;
  const app = (a || o) ? appHost.named(name) : null;
  if (!app) return;
  await showItemsTask(g, k);
  const was = selectedTask();
  try {
    const inst = await appHost.open(name, gname, (a ? cwdOf(a) : o.folder) || null);
    if (!o || inst.id !== o.id) takeTasks(await post("/api/tasks", { gatherer: gname, do: "add", to: keptAs(g, k), items: [appItem(inst.id)] }));
    await readApps(gname, true);
    const had = panes.apps.some((p) => p.instance.id === inst.id);
    const there = showAppPanel(app, inst);
    if (had) there.panel.refresh();
    retask(was);
    selectAppPane(there);                              // added: selected, as an actor started is shown
  } catch (e) { paneNote(`${app.label}: ${e.message}`); }
  renderAgents();
}
// An app added to an item that it doesn't join (onTask "folder": the Files app's): opened at the item's directory -- an
// actor's working directory, an app's folder -- the one open there already, if the app has any number (`reuse`), its
// panel shown above and selected; put in no task, no agent attached to it. The item's task shown first, if another is.
// Not kept with the task's layout yet: the task left and entered again, it is not opened with it.
async function openAppAt(gname, k, name) {
  const g = gathererNamed(gname);
  const a = g && !isAppItem(k) ? actorOf(g, k) : null, o = g && !a ? appInfo(gname, k.slice(APP_ITEM.length)) : null;
  const app = (a || o) ? appHost.named(name) : null;
  if (!app) return;
  const folder = (a ? cwdOf(a) : o.folder) || startCwd(g);
  if (!folder) return paneNote(`${app.label}: no directory to open it at`);
  await showItemsTask(g, k);
  try {
    const inst = await appHost.open(name, gname, folder, null, true);
    await readApps(gname, true);
    selectAppPane(showAppPanel(app, inst));           // (through the layout model, as addAppToTask's)
  } catch (e) { paneNote(`${app.label}: ${e.message}`); }
  renderAgents();
}
// An item taken out of its task: a task of its own again (the task gone, if one item is left in it) -- detached from the
// task's others (task_links.py)
async function takeOut(gname, k) {
  const g = gathererNamed(gname);
  if (!g || itemTaskOf(g, k) === null) return;
  try { takeTasks(await post("/api/tasks", { gatherer: gname, do: "out", items: [keptAs(g, k)] })); }
  catch (e) { paneNote(`Take it out of the task: ${e.message}`); }
  readApps(gname, true);
  renderAgents();
  if (hover.node && !hover.node.hidden) cardDraw();
}
// Items put in item `k`'s task (dropped on its row): each out of its own, the task made if `k` is in none; filed where
// `k` is
async function joinTask(gname, k, items) {
  const g = gathererNamed(gname);
  if (!g) return;
  const was = selectedTask(), a = isAppItem(k) ? null : actorOf(g, k);
  const fid = a ? folderOf(gname, a) : appFolder(gname, k.slice(APP_ITEM.length));
  try { takeTasks(await post("/api/tasks", { gatherer: gname, do: "add", to: keptAs(g, k), items: items.map((c) => keptAs(g, c)) })); }
  catch (e) { paneNote(`Put in the task: ${e.message}`); return; }
  const away = items.filter((c) => (isAppItem(c) ? appFolder(gname, c.slice(APP_ITEM.length)) : ((m) => m ? folderOf(gname, m) : fid)(actorOf(g, c))) !== fid);
  if (away.length) await fileItems(gname, away, fid);
  retask(was);
  readApps(gname, true);
  renderAgents();
}
// A row's buttons ("+", bookmark, ×), one group -- shown over its face while it is hovered (features/list/list.css); none: nothing
const rowActs = (...bs) => bs.some(Boolean) ? el("span", { class: "a-acts" }, ...bs) : null;
// A selected actor's check, on its avatar, once two or more are selected (`checked`): a click on it leaves it out
function pickMark(g, a, logo, checked = picked(g, a) && picks.cs.size >= 2) {
  if (!checked || !(logo instanceof HTMLElement)) return logo;
  logo.append(el("span", { class: "pick", role: "button", title: "Selected · click to deselect", "aria-label": "Deselect",
    onclick: (ev) => { ev.stopPropagation(); togglePick(g, a); } }, strokeIcon("M4.25 8.25l2.5 2.5 5-5.25", 11)));
  return logo;
}
// An actor's own buttons, in its row of the list and over its avatar in the rail (railActor): a press on one does only
// what it says, not showing the actor. A span the keys reach (its row a button already), Enter or Space pressing it.
const rowButton = (cls, attrs, run, icon) => el("span", { class: cls, role: "button", tabindex: "0", ...attrs,
  onclick: (ev) => { ev.stopPropagation(); run(); },
  onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); run(); } } }, icon);
// Its bookmark: saved for later (filled), or to be, a press either way -- in a snapshot, filled if saved, and nothing to
// press. The gatherer agent's, in its place: hidden from the list (its face on the gatherer's row shows it again).
function saveButton(g, a, saved = !!savedAs(g.name, a)) {
  if (isCoordinator(a)) return SNAPSHOT ? null : rowButton("save-btn", { title: "Hide the coordinator agent · click its face on the folder's row to show it again",
    "aria-label": "Hide the coordinator agent" }, () => setCrewHidden(crewHideKey(crewNode(g, a)), true), hideIcon());
  if (SNAPSHOT) return saved ? el("span", { class: "save-btn on", title: "Saved for later" }, saveIcon(true)) : null;
  return rowButton("save-btn" + (saved ? " on" : ""), { "aria-pressed": saved ? "true" : "false",
    title: saved ? "Saved for later · click to unsave" : "Save for later",
    "aria-label": saved ? "Unsave" : "Save for later" }, () => setSaved(g.name, a, !saved), saveIcon(saved));
}
// Its ×: its process closed (closable), or, one that never started, it discarded (discardable); null: neither. `how`:
// which (features/list/status.ts's closeHow).
function closeButton(g, a, how = LS.closeHow(CTX, a)) {
  return how === "close" ? rowButton("close-btn", { title: "Close this session, even mid-turn",
      "aria-label": "Close session" }, () => closeActor(g, a, closeSession), closeIcon())
    : how === "discard" ? rowButton("close-btn", { title: "Never started · remove it from the list",
      "aria-label": "Close session" }, () => closeActor(g, a, () => discardSession(g, a)), closeIcon()) : null;
}
// An actor closed from the list (`how`: its process closed, or it discarded): closed in the screen tabs first, as its tab's
// × or its pane's would (features/layout/panes.js's closedInTabs: alone, its tab closed if it held nothing else)
async function closeActor(g, a, how) {
  await closedInTabs(taskKey(g.name, a.channel), a.channel);
  await how(a);
}
// Naming an actor: its top line in the list, clicked once it is the one shown, becomes a box with its name in it;
// Enter (or a press anywhere else in the page, or Tab away) keeps what is typed, Esc leaves it as it was, and nothing
// typed takes the reader's name back -- the harness's own, or what it was last asked, shows again. Kept as an event in
// its gatherer and given to its harness (POST /api/name): Claude Code's or codex's own list of sessions shows it, and
// a session in the dashboard's terminal is told with its harness's /rename once its turn is over. The box is one
// element for as long as it is open (`nameInput`), put back in each redraw of the list (`nameMoving`), its caret kept.
let nameInput = null, nameMoving = false;
// A press anywhere but in the box ends it -- also where the keys stay put (History's rows, a scroll bar) or go into a
// pane's frame (agPanes.focus) -- and the list is drawn again only once the press is over (`pressHeld`: what waits
// for it), so its click still lands on the row it was pressed on: another actor's shows that actor.
let pressHeld = null;
function drawNamed() { renderAgents(); drawWho(); }
const redrawNamed = () => pressHeld ? pressHeld.add(drawNamed) : drawNamed();
const nameAnswers = new Map();                       // what came of each name given from this page: actor -> the answer
const nameKey = (gname, c) => `${gname}\u0000${c}`;
function nameNote(g, a) {
  if (!a.name || !a.name.text) return "";
  if (a.name.by !== "user") return `Named by ${harnessInfo(a.name.by) ? harnessName(a.name.by) : "its harness"}\n`;
  const how = nameAnswers.get(nameKey(g.name, a.channel));
  return "Named by you" + (!how ? "" : how.error ? ` · not in ${harnessName(a.harness)}: ${how.error}`
    : how.store || how.terminal ? ` · in ${harnessName(a.harness)} too` : "") + "\n";
}
function startRename(g, a) {
  if (state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, a.channel)) return;
  const was = (a.name && a.name.by === "user" && a.name.text) || "";
  state.renaming = { g: g.name, c: a.channel, value: (a.name && a.name.text) || "", was };
  nameInput = null;
  renderAgents();
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}
function nameBox() {
  if (nameInput) return nameInput;
  const r = state.renaming;
  nameInput = el("input", { class: "name-box", type: "text", maxlength: "120", spellcheck: "false", autocomplete: "off",
    placeholder: r.c === null ? r.g : r.kind ? r.auto : "Name this actor",
    "aria-label": r.c === null ? "This group's name" : r.kind ? `This ${r.kind}'s name` : "This actor's name" });
  nameInput.value = r.value;
  nameInput.addEventListener("input", () => { r.value = nameInput.value; });
  nameInput.addEventListener("keydown", (ev) => {
    ev.stopPropagation();                            // the page's own keys are not this box's
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); endRename(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); endRename(false); }
  });
  // Tab away keeps it (a press has ended it already); not a redraw (`nameMoving`), nor the window going to the back
  // (it comes back focused)
  nameInput.addEventListener("blur", () => { if (!nameMoving && document.hasFocus() && state.renaming === r) endRename(true); });
  return nameInput;
}
async function endRename(keep) {
  const r = state.renaming;
  if (!r) return;
  state.renaming = null; nameInput = null;
  if (r.kind) return keep ? nameItem(r.g, r.c, r.value) : redrawNamed();
  const g = gathererNamed(r.g), a = g && g.agents.find((x) => x.channel === r.c);
  const text = r.value.replace(/\s+/g, " ").trim().slice(0, 120);
  if (r.c === null) return keep && g && text !== titleOf(g) ? keepTitle(r.g, text) : redrawNamed();
  if (!keep || !a || text === ((a.name && a.name.text) || "") || (!text && !r.was)) { redrawNamed(); return; }
  const before = a.name;
  a.name = text ? { text, by: "user" } : null;     // shown at once; the gatherer's event confirms it (the harness's own back)
  redrawNamed();
  try {
    const got = await post("/api/name", { gatherer: r.g, channel: r.c, name: text, harness: a.harness, cwd: a.cwd });
    nameAnswers.set(nameKey(r.g, r.c), got);
    if (got.error) setLive(`${text ? "Renamed" : "Name removed"} here but not in ${harnessName(a.harness)}: ${got.error}`);
  } catch (err) {
    a.name = before;
    setLive(`Not named: ${err.message}`);
  }
  redrawNamed();
}
// Naming a TASK or an APP, as an actor is named: its name in its row double-clicked (or F2 on its row), or its card's
// pencil (features/list/modes.js's editInCard) -- `state.renaming.c` its item ("task:<id>", "app:<instance id>"), `kind`
// which, `auto` what it is called when not named. Kept: a task's name by the dashboard (tasks.py: POST /api/tasks
// rename), an app's with its instance (app_host.py's `rename`: POST /api/apps/rename), which its panel's head shows too.
// Nothing typed takes the name back: a task named by what is in it again, an app by its own title.
const TASK_ITEM = "task:";
const renamingItem = (gname, k) => !!state.renaming && state.renaming.g === gname && state.renaming.c === k;
const nameOnDouble = (g, k) => SNAPSHOT ? {} : { ondblclick: (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
  ev.stopPropagation(); cardHide(ev); startItemRename(g, k);
} };
function renameKey(ev, g, k) {
  if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startItemRename(g, k); }
}
// a task's or an app's item -> [kind, it, its name now, its name when not named, the user's]; null: no longer here
function itemNamed(g, k) {
  if (k.startsWith(TASK_ITEM)) {
    const t = taskById(g.name, Number(k.slice(TASK_ITEM.length)));
    return t && ["task", t, taskName(g, t), taskName(g, { ...t, name: "" }), t.name || ""];
  }
  const o = isAppItem(k) ? appInfo(g.name, k.slice(APP_ITEM.length)) : null;
  return o && ["app", o, appShown(o), o.title || o.app.label, o.name];
}
function startItemRename(g, k) {
  const got = itemNamed(g, k);
  if (!got || renamingItem(g.name, k)) return;
  if (state.renaming) endRename(true);
  state.renaming = { g: g.name, c: k, kind: got[0], value: got[2], auto: got[3], was: got[4] };
  nameInput = null;
  renderAgents();
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}
async function nameItem(gname, k, value) {
  const g = gathererNamed(gname), got = g && itemNamed(g, k);
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!got || text === got[2] || (!text && !got[4])) return redrawNamed();   // as it was
  const [kind, it] = got;
  if (kind === "task") {
    it.name = text;                                  // shown at once; the answer confirms it
    redrawNamed();
    try { takeTasks(await post("/api/tasks", { gatherer: gname, do: "rename", id: it.id, to: text })); }
    catch (e) { it.name = got[4]; setLive(`Not named: ${e.message}`); }
    return redrawNamed();
  }
  const inst = ((appsKnown.get(gname) || {}).instances || []).find((i) => i.id === it.id);
  if (inst) inst.name = text;                        // shown at once; the apps read again confirm it
  redrawNamed();
  try { await post("/api/apps/rename", { gatherer: gname, instance: it.id, name: text }); }
  catch (e) { if (inst) inst.name = got[4]; setLive(`Not named: ${e.message}`); }
  await readApps(gname, true);
  redrawNamed();
}
// A folder's rows (model.ts's FolderNode `n`): its line, and under it, opened, its box, set in -- a closed one's all it
// holds -- or, folded, its actors open in a pane; under its line, while its × asks first, the question (closeAsk).
function folderRows(n) {
  const out = [folderLine(n)];
  if (n.asking) out.push(closeAsk(n.g, n.f));
  if (n.kids) out.push(el("div", { class: "f-kids" }, ...(n.kids.length ? n.kids.flatMap(drawNode) : [el("div", { class: "f-empty", text: n.empty })])));
  else if (n.peek.length) out.push(el("div", { class: "f-kids peek" }, ...n.peek.map(agentRow)));
  return out;
}
// A box's fold (model.ts's FoldNode `n`): its line ("▸ N closed"), and under it, once opened, its actors (or shells) --
// folded, those open in a pane (no shell) -- open or not kept in this browser, for each box (boxKey). Its closed line holds
// its closed folders too, first, and counts their actors (closedSays). The actors on their own closed have theirs too.
function foldRows(n) {
  const line = el("button", { class: "agent-group fold-line", type: "button", "aria-expanded": n.shown ? "true" : "false",
    "data-key": n.key, title: n.title, onclick: () => toggleFold(n.name, n.foldKey) },
    foldMark(n.shown), " ", n.says);
  return [line, ...n.kids.flatMap(drawNode)];
}
// a folder's icon: the full-page view's folder headings (the list's lines have none, its caret and indent enough)
const folderMark = (open) => el("span", { class: "folder-mark", "aria-hidden": "true" }, strokeIcon(open ? ICONS.folderOpen : ICONS.folder, 14));
// a small button on a folder's line, beside its start buttons
const folderAct = (cls, title, icon, fn) => el("button", { class: `act folder-act ${cls}`, type: "button", title, "aria-label": title,
  onclick: (ev) => { ev.stopPropagation(); fn(); } }, icon);
// how many of a folder's actors wait on the reader, stopped on an error, run: as a gatherer's row counts its own -- and,
// on its line in the list (idle), how many are idle, a grey dot as an idle actor's
function tallyChips(t, of, idle = false) {
  const count = (k, cls, what) => k ? el("span", { class: "count" + cls, title: `${k} of ${of} ${what}` }, el("i", { "aria-hidden": "true" }), String(k)) : null;
  const told = t.notified ? el("span", { class: "count notified", title: `${plural(t.notified, "app")} with a notification you haven't seen` },
    el("i", { "aria-hidden": "true" }), String(t.notified)) : null;
  return [count(t.asking, " asking", "waiting for you"), count(t.error, " error", "stopped on an error"), told, count(t.running, "", "running"),
    idle ? count(t.idle, " idle", "idle") : null].filter(Boolean);
}
const folderSays = (f, t) => `${f.name}: ${plural(t.open, "actor")} open${t.saved ? `, ${t.saved} saved` : ""}${t.closed ? `, ${t.closed} closed` : ""}`;
// A folder's line (model.ts's FolderNode `n`): a button opening or folding it -- its caret, its name -- and at its right
// how many of the actors it holds open (its folders' too) wait on the reader, stopped on an error, run, are idle (a click
// there too opens or folds it). Hovered or in focus, its buttons over those counts: "+ actor" and "+ ⋯", started in it
// (startButtons), a folder made in it, it renamed (F2), it deleted (its bin), it closed (its ×: closeFolder). A closed one
// (shownClosed), greyed, says how many actors it holds, its buttons: rename, delete, reopen. Dragged: put in another
// folder, or onto its gatherer's row, at its top; actors dropped on it are put in it (a closed one reopened), and it
// opens when one is held over it.
function folderLine(n) {
  const { g, f, closed, held } = n, t = n.tally;
  if (n.editing) return el("div", { class: "folder-line editing", "data-key": n.key }, folderBox());
  const toggle = () => toggleFolder(g.name, f.id);
  const acts = closed ? [
    folderAct("rename", `Rename ${f.name} (F2)`, strokeIcon(ICONS.pencil, 13), () => startFolderEdit(g.name, f.id)),
    folderAct("delete", `Delete ${f.name} · its contents move up a level`, strokeIcon(ICONS.bin, 14), () => deleteFolder(g.name, f.id)),
    folderAct("reopen", `Reopen ${f.name} · its actors stay closed`, strokeIcon(ICONS.folderOpen, 14), () => reopenFolder(g.name, f.id)),
  ] : [...startButtons(g, f), n.crew ? null : crewButton(g, `folder:${f.id}`),
    rowMore(`fmore:${g.name}:${f.id}`, f.name, [
      { icon: ICONS.folderNew, text: "New folder", run: () => startFolderEdit(g.name, null, f.id) },
      { icon: ICONS.pencil, text: "Rename", run: () => startFolderEdit(g.name, f.id) },
      { icon: ICONS.bin, text: n.crew ? "Delete (its coordinator agent closes)" : "Delete", run: () => deleteFolder(g.name, f.id) }]),
    folderAct("close", `Close ${f.name} and every actor in it`, closeIcon(), () => pressClose(g, f, "list"))];
  const line = el("div", { class: "folder-line" + (closed ? " closed" : ""), "data-key": n.key, "data-card": key(g.name, `folder:${f.id}`) },
    el("button", { class: "fbtn", type: "button", "aria-expanded": n.open ? "true" : "false",
      ...(HOVERS.matches ? {} : { title: closed ? `${f.name}: closed, ${plural(held, "actor")} in it` : folderSays(f, t) }), onclick: toggle,
      onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startFolderEdit(g.name, f.id); } } },
      el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "fname", text: f.name })),
    SNAPSHOT || closed || !n.crew ? null : crewButton(g, `folder:${f.id}`),   // its coordinator agent's
    el("span", { class: "fill", onclick: toggle },
      ...(closed ? [held ? el("span", { class: "count closed", title: plural(held, "closed actor") }, el("i", { "aria-hidden": "true" }), String(held)) : null]
        : tallyChips(t, plural(t.open, "actor"), true)),
      SNAPSHOT ? null : el("span", { class: "f-acts", onclick: (ev) => ev.stopPropagation() }, ...acts)));
  return dropOn(dragFolder(line, g, f), g, f.id, () => { if (!isOpenFolder(g.name, f.id)) toggle(); });
}
// CLOSING a folder (its ×, on its line or its card): at once, if all in it is closed already, none saved, no terminal in
// it; else first the question under it (`folderClosing`: {g, id, from: "list" | "card"}) -- what closing it would close,
// end, take off -- with "Close folder" and Cancel (Esc). Its buttons keep their focus through the list's redraws
// (askRefocus).
let folderClosing = null;
// The question let go of where it was asked (`from`): its card hidden (features/list/modes.js's cardHide).
const dropFolderClosing = (from) => { if (folderClosing && folderClosing.from === from) folderClosing = null; };
function closeWhat(g, f) {
  const inside = actorsWithin(g, f.id), t = folderTally(g, f.id);
  return { open: t.open, busy: t.running + t.asking, marks: inside.filter((a) => savedAs(g.name, a)).length,
    shells: shellsWithin(g, f.id).length };
}
function pressClose(g, f, from) {
  const w = closeWhat(g, f);
  if (!w.open && !w.marks && !w.shells) { closeFolder(g, f); return; }
  folderClosing = { g: g.name, id: f.id, from, focus: "cancel" };
  if (from === "card") cardDraw(); else renderAgents();
  askRefocus(true);
}
function closeAsk(g, f) {
  const w = closeWhat(g, f), up = parentOf(g.name, f), where = up === null ? titleOf(g) : folderById(g.name, up).name;
  const parts = [w.open ? `closes ${plural(w.open, "actor")}${w.busy ? ` (stopping ${w.busy} mid-turn)` : ""}` : null,
    w.shells ? `ends ${plural(w.shells, "terminal")}` : null, w.marks ? `removes ${plural(w.marks, "bookmark")}` : null].filter(Boolean);
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "closes it";
  const from = folderClosing.from;
  const cancel = () => { folderClosing = null; if (from === "card") cardDraw(); else renderAgents(); };
  const btn = (which, cls, text, fn) => el("button", { type: "button", class: `pb ${cls}`, "data-ask": which, onclick: (ev) => { ev.stopPropagation(); fn(); },
    onfocus: () => { if (folderClosing) folderClosing.focus = which; } }, text);
  return el("div", { class: "f-ask", role: "alertdialog", "aria-label": `Close ${f.name}?`, "data-key": `${g.name}/folder:${f.id}/ask`,
    onclick: (ev) => ev.stopPropagation(),
    onkeydown: (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancel(); } },
    // in a card, the focus gone from it (a click elsewhere): taken back, the card let go of once the pointer is off it
    onfocusout: (ev) => {
      if (from !== "card" || cardMoving || (ev.relatedTarget && hover.node && hover.node.contains(ev.relatedTarget))) return;
      setTimeout(() => {
        if (!folderClosing || folderClosing.from !== "card" || (hover.node && hover.node.contains(document.activeElement))) return;
        folderClosing = null;
        if (cardLive() && !hover.node.matches(":hover")) cardHide(); else cardDraw();
      }, 0);
    } },
    el("p", {}, el("b", { text: `Close ${f.name}?` }), ` This ${said}. The folder moves to ${where}'s closed line.`),
    el("div", { class: "f-ask-btns" },
      btn("go", "go", "Close folder", () => { folderClosing = null; if (from === "card") cardHide(); closeFolder(g, f); }),
      btn("cancel", "", "Cancel", cancel)));
}
// the question's button that had the focus, given it again once drawn anew (`now`: the question just asked -- Cancel)
function askRefocus(now = false) {
  if (!folderClosing) return;
  const lost = !document.activeElement || document.activeElement === document.body;
  if (!now && !lost) return;
  const b = document.querySelector(`.f-ask [data-ask="${folderClosing.focus}"]`);
  if (b) b.focus({ preventScroll: true });
}
// Closed (folders.py's `close`, by the server): every actor in it closed, its bookmark off, every terminal in it ended,
// then it and the folders in it marked closed -- shown so at once, the server's answer (and the next home) having the
// last word. Those it could not close said (`left`).
async function closeFolder(g, f) {
  folderClosing = null;
  const tree = treeOf(g.name), ids = new Set(tree.folders.filter((x) => within(g.name, x.id, f.id)).map((x) => x.id));
  const was = { saved: state.home.saved, shells: state.home.shells };
  const kept = { ...((state.home.saved || {})[g.name] || {}) };
  for (const a of actorsWithin(g, f.id)) { const k = savedAs(g.name, a); if (k) delete kept[k]; }
  for (const [c, at] of Object.entries(tree.filed)) if (ids.has(at)) delete kept[c];
  state.home.saved = { ...(state.home.saved || {}), [g.name]: kept };
  state.home.shells = (state.home.shells || []).filter((s) => !(s.gatherer === g.name && ids.has(s.folder)));
  const asked = homesTaken, at = new Date().toISOString();
  const got = await folderPost(g.name, { do: "close", id: f.id }, (t) => { for (const x of t.folders) if (ids.has(x.id)) x.closed = at; });
  if (!got) { if (!SNAPSHOT) undone(asked, was); return; }   // (folderPost took its folders back)
  if (got.saved && !homeSince(asked)) { state.home.saved = got.saved; redrawList(); }
  const left = got.left || [];
  if (left.length) setLive(`${f.name} closed, but ${plural(left.length, "actor")} in it ${left.length === 1 ? "stays" : "stay"} open: ${left[0].why}`);
}
// Reopened: it and the folders in it with the open ones again, its actors as they are
function reopenFolder(gname, id) {
  const ids = new Set(treeOf(gname).folders.filter((x) => within(gname, x.id, id)).map((x) => x.id));
  showFolder(gname, id, true);
  return folderPost(gname, { do: "reopen", id }, (t) => { for (const x of t.folders) if (ids.has(x.id)) x.closed = null; });
}
// Naming a folder, new (`state.folderEdit.id` null, made in its `parent`) or not: a box in its line, kept through the
// list's redraws as the actor's is (`folderInput`, `nameMoving`); Enter or leaving it keeps what is typed, Esc or nothing
// typed leaves it. A name another folder beside it has (whatever its case), or one with "/", is refused, and said why.
let folderInput = null;
function startFolderEdit(gname, id = null, parent = null) {
  const f = id === null ? null : folderById(gname, id);
  state.folderEdit = { g: gname, id, parent: f ? parentOf(gname, f) : parent, value: f ? f.name : "", group: gname === GF && id === null };
  folderInput = null;
  if (collapsed.has(gname)) {
    collapsed.delete(gname);
    prefs.keep(COLLAPSED_KEY, [...collapsed]);
  }
  showFolder(gname, state.folderEdit.parent, true);
  renderAgents();
  if (folderInput) { folderInput.focus(); folderInput.select(); }
}
function folderBox() {
  if (folderInput) return folderInput;
  const f = state.folderEdit;
  folderInput = el("input", { class: "name-box folder-box", type: "text", maxlength: String(FOLDER_CHARS), spellcheck: "false",
    autocomplete: "off", placeholder: "Folder name", "aria-label": f.id === null ? "The new folder's name" : "The folder's name" });
  folderInput.value = f.value;
  folderInput.addEventListener("input", () => { f.value = folderInput.value; });
  folderInput.addEventListener("keydown", (ev) => {
    ev.stopPropagation();                            // the page's own keys are not this box's
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); endFolderEdit(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); endFolderEdit(false); }
  });
  folderInput.addEventListener("blur", () => { if (!nameMoving && document.hasFocus() && state.folderEdit === f) endFolderEdit(true); });
  return folderInput;
}
function endFolderEdit(keep) {
  const f = state.folderEdit;
  if (!f) return;
  state.folderEdit = null; folderInput = null;
  if (!keep || !(f.group ? nameGroup(f.parent, f.value) : nameFolder(f.g, f.id, f.parent, f.value))) renderAgents();
}
// The folder `id` named `text` (`id` null: one made in `parent`), as typed in the list's box or a card's: none typed,
// or the name it has, is nothing done; a name another folder beside it has (whatever its case), or one with "/", is
// refused, and said why. -> whether something was done.
function nameFolder(gname, id, parent, text) {
  text = String(text || "").replace(/\s+/g, " ").trim().slice(0, FOLDER_CHARS);
  const was = id === null ? null : folderById(gname, id);
  if (!text || (was && text === was.name)) return false;
  const other = kidFolders(gname, parent).find((x) => x.id !== id && x.name.toLowerCase() === text.toLowerCase());
  if (text.includes("/") || other) {
    setLive(other ? `A folder named "${other.name}" is already there` : 'Folder names can\'t contain "/"');
    return false;
  }
  if (was) renameFolder(gname, id, text); else makeFolder(gname, text, parent);
  return true;
}
// DRAGGING an actor's row -- every selected one's, if it is selected -- or a folder's line, onto a folder's line (into
// it) or its gatherer's row (to its top): `listDrag`, what is dragged, of its gatherer only. While one is, the list is
// not drawn again (`later`, drawn once it is over) -- but to open the folder held over for DROP_OPEN_MS (`force`) -- so
// the lines stay under the pointer. Over when its row says (dragend), or, its row drawn again meanwhile, once the page
// has heard of the drag for DRAG_LOST_MS no more. The rail's actors are dragged so too, onto its names (railActor,
// railDragged: the folders it leaves out shown while one is).
let listDrag = null;
const DROP_OPEN_MS = 700, DRAG_LOST_MS = 3000;
function startDrag(ev, g, what) {
  if (listDrag) endDrag();
  listDrag = { g: g.name, cs: what.cs || null, gs: what.gs || null, folder: what.folder ?? null, later: false, force: false, revealed: false, seen: Date.now(), spring: null,
    ask: ev.target instanceof Element && !!ev.target.closest(".mg-dialog"),   // from Manage groups: a change of group asked first
    watch: setInterval(() => { if (listDrag && Date.now() - listDrag.seen > DRAG_LOST_MS) endDrag(); }, 500) };
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("text/plain", what.cs ? what.cs.join(",") : what.gs ? what.gs.join(",") : `folder:${what.folder}`);
  if (what.cs && what.cs.length > 1) {               // several: said on what is dragged
    const ghost = el("div", { class: "drag-ghost", text: `${what.cs.length} ${what.cs.some(isAppItem) ? "items" : "actors"}` });
    document.body.append(ghost);
    ev.dataTransfer.setDragImage(ghost, 14, 14);
    setTimeout(() => ghost.remove(), 0);
  }
  markDragged();
  cardHide();
  railDragged();
  setTimeout(showOutside, 0);                        // after dragstart: the page unmoved till then
}
// what is dragged, shown so -- again after the list, or the rail, is drawn mid-drag (the rail's by their data-card, its
// \u0000 one CSS.escape cannot write)
function markDragged() {
  if (!listDrag) return;
  const keys = listDrag.cs ? listDrag.cs.map((c) => `${listDrag.g}/${c}`) : listDrag.gs ? listDrag.gs   // a gatherer: its row's
    : [`${listDrag.g}/folder:${listDrag.folder}`];
  for (const k of keys) for (const n of document.querySelectorAll(`:is(#agents, .mg-dialog) [data-key="${CSS.escape(k)}"]`)) n.classList.add("dragging");
  const cards = new Set(listDrag.cs ? listDrag.cs.map((c) => key(listDrag.g, c)) : []);
  for (const n of document.querySelectorAll("#rail .r-actor[data-card]")) if (cards.has(n.dataset.card)) n.classList.add("dragging");
}
// An actor's row dragged: the selection, if it is in it; else it -- one of a task, the task: all in it, which are in one
// place
function dragRow(row, g, a) {
  if (SNAPSHOT || isCoordinator(a)) return row;
  return dragItems(row, g, () => {
    if (picked(g, a) && picks.cs.size > 1) return [...picks.cs];
    const id = taskOf(g.name, a);
    return id === null ? [a.channel] : taskItems(g, id);
  });
}
// a row dragged: the items `cs()` says (actors' channels, apps' "app:<id>")
function dragItems(row, g, cs) {
  if (SNAPSHOT) return row;
  row.draggable = true;
  row.addEventListener("dragstart", (ev) => { ev.stopPropagation(); startDrag(ev, g, { cs: cs() }); });
  row.addEventListener("dragend", endDrag);
  return row;
}
// What is dragged, with every item of the tasks it is of: what goes into a folder, so no task is split across two
const withTasks = (g, cs) => LK.withTasks(CTX, g, cs);
// the folder an item is in (null: its gatherer's top)
const itemFolder = (g, c) => LK.itemFolder(CTX, g, c);
// Items put in folder `id` (null: their gatherer's top): actors as fileActors has them, apps by their item
function fileItems(gname, items, id) {
  const g = gathererNamed(gname);
  if (!g) return null;
  const channels = items.map((c) => isAppItem(c) ? c : ((a) => a ? filedAs(gname, a) || a.channel : null)(actorOf(g, c))).filter(Boolean);
  if (!channels.length) return null;
  showFolder(gname, id, true);
  return folderPost(gname, { do: "file", channels, folder: id }, (tree) => {
    for (const c of channels) { if (id === null) delete tree.filed[c]; else tree.filed[c] = id; }
    openUp(tree, id);
  });
}
// Whether what is dragged may be put in item `k`'s task (dropped on its row): of its gatherer, items -- not `k` itself,
// and one of them at least not in its task yet; none of them an app that doesn't join tasks (onTask: a group's app, in no
// task, among them), nor `k` one in no task (a task made of it)
function canJoin(g, k) {
  const d = listDrag;
  if (!d || d.g !== g.name || !d.cs || d.cs.includes(k)) return false;
  if ((keptOut(g, k) && itemTaskOf(g, k) === null) || d.cs.some((c) => keptOut(g, c))) return false;
  const t = itemTaskOf(g, k);
  return d.cs.some((c) => t === null || itemTaskOf(g, c) !== t);
}
// An item's row, what is dragged dropped on it: put in its task (joinTask)
function dropOnItem(row, g, k) {
  if (SNAPSHOT) return row;
  row.addEventListener("dragenter", (ev) => { if (canJoin(g, k)) { ev.preventDefault(); row.classList.add("drop-on"); } });
  row.addEventListener("dragover", (ev) => { if (canJoin(g, k)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; } });
  row.addEventListener("dragleave", (ev) => { if (!row.contains(ev.relatedTarget)) row.classList.remove("drop-on"); });
  row.addEventListener("drop", (ev) => {
    if (!canJoin(g, k)) return;
    ev.preventDefault();
    const d = listDrag;
    d.later = false;                                 // drawn by the change, next
    endDrag();
    if (d.cs.length > 1) clearPicks(false);
    joinTask(g.name, k, d.cs);
  });
  return row;
}
function dragFolder(line, g, f) {
  if (SNAPSHOT) return line;
  line.draggable = true;
  line.addEventListener("dragstart", (ev) => startDrag(ev, g, { folder: f.id }));
  line.addEventListener("dragend", endDrag);
  return line;
}
function endDrag() {
  const d = listDrag;
  if (!d) return;
  listDrag = null;
  clearTimeout(d.spring); clearInterval(d.watch);
  document.body.classList.remove("drag-out");
  for (const n of document.querySelectorAll(":is(#agents, #rail, .mg-dialog) :is(.dragging, .drop-on)")) n.classList.remove("dragging", "drop-on", "drop-across");
  if (d.later || d.revealed) renderAgents();         // the rail, its folders shown for the drag: as it was again
  if (d.offered) moveEnd();                          // over the work area too: its cover put away (features/layout/panes.js)
}
// Whether what is dragged may go into folder `id` (null: the gatherer's top): of that gatherer; a folder, not into
// itself nor one of its own, nor where it is; actors, one of them at least not there yet. A gatherer (`gs`) only into a
// folder of gatherers (`g` GFS), or the list's top: not where it is. From another group: as canCross says -- done at
// once by the default rule, dropped in the list; asked first, dragged in Manage groups (listDrag's `ask`).
function canDrop(g, id) {
  const d = listDrag;
  if (!d) return false;
  if (d.gs && g.name !== GF) return canMerge(g, id);   // a group into another: a folder of it, or a group inside it (features/list/group-moves.js)
  if (d.g !== g.name) return canCross(g);
  if (d.folder !== null) {
    const f = folderById(g.name, d.folder);
    return !!f && parentOf(g.name, f) !== id && !(id !== null && within(g.name, id, d.folder));
  }
  if (d.gs) return d.gs.some((name) => gfOf(name) !== id || !!placeOf(name));   // (inside a group's folder: out of it)
  return withTasks(g, d.cs).some((c) => (isAppItem(c) || !!actorOf(g, c)) && itemFolder(g, c) !== id);
}
// `id`: the folder what is dropped on `n` goes into (null: the gatherer's top); `open`, what opens when one is held over it
function dropOn(n, g, id, open) {
  if (SNAPSHOT) return n;
  n.addEventListener("dragenter", (ev) => {
    if (!canDrop(g, id)) return;
    ev.preventDefault();
    n.classList.add("drop-on");
    n.classList.toggle("drop-across", listDrag.ask && listDrag.g !== g.name);   // into another group, in Manage groups: asked first
    clearTimeout(listDrag.spring);
    listDrag.spring = setTimeout(() => {
      if (!listDrag || !canDrop(g, id)) return;
      listDrag.force = true;
      try { open(); } finally { if (listDrag) listDrag.force = false; }
    }, DROP_OPEN_MS);
  });
  n.addEventListener("dragover", (ev) => { if (canDrop(g, id)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; } });
  n.addEventListener("dragleave", (ev) => {
    if (n.contains(ev.relatedTarget)) return;
    n.classList.remove("drop-on", "drop-across");
    if (listDrag) clearTimeout(listDrag.spring);
  });
  n.addEventListener("drop", (ev) => {
    if (!canDrop(g, id)) return;
    ev.preventDefault();
    const d = listDrag, now = gathererNamed(g.name) || g;
    d.later = false;                                 // drawn by the move, next
    endDrag();
    const was = placeOf(d.gs ? d.gs[0] : d.g);       // a group, or an actor on its own, already inside `g`: just moved
    if (d.gs && g.name !== GF) { gPicks.clear(); if (was && was.in === g.name) placeGroup(d.gs[0], g.name, id); else askMerge(d.gs[0], now, id, false, d.ask); return; }
    if (d.g !== g.name) { if (isAloneName(d.g) && was && was.in === g.name) placeGroup(d.g, g.name, id); else askMove(d, g, id); return; }
    if (d.folder !== null) { moveFolder(g.name, d.folder, id); return; }
    if (d.gs) { gPicks.clear(); fileGatherers(d.gs.filter((name) => gfOf(name) !== id), id); return; }
    const items = withTasks(now, d.cs).filter((c) => (isAppItem(c) || !!actorOf(now, c)) && itemFolder(now, c) !== id);
    if (d.cs.length > 1) clearPicks(false);
    fileItems(g.name, items, id);
  });
  return n;
}
// A shell's row (isShell; model.ts's ShellRow `r`): where it was opened, and when; its close button closes its terminal,
// as a window's does.
const SHELLS = LT.SHELLS;
function shellRow(r) {
  const { g, s, current } = r;
  const where = shellPath(s), close = (ev) => { ev.stopPropagation(); closeShell(s); };
  return el("button", { class: "agent shell", type: "button", "aria-current": current ? "true" : "false", "data-key": r.key,
    "data-group": SHELLS, ...(r.open ? { "data-open": "true" } : {}),
    title: `Terminal · ${s.cwd}${SNAPSHOT ? "" : `\n${BESIDE_KEY}+click to open side by side`}`,
    onclick: (ev) => pick(g.name, s.id, ev), oncontextmenu: (ev) => pickBeside(g.name, s.id, ev) },
    shellLogo(),
    el("div", {},
      el("div", { class: "name", text: where.split("/").filter(Boolean).pop() || where }),
      el("div", { class: "asked", text: where }),
      el("div", { class: "meta" }, el("span", {}, "Terminal · opened ", el("span", { "data-ago": s.since || "", text: ago(s.since) })),
        rowActs(el("span", { class: "close-btn", role: "button", tabindex: "0", title: "End the shell and everything running in it",
          "aria-label": "Terminate shell", onclick: close,
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); close(ev); } } }, closeIcon())))));
}
const shellLogo = () => el("span", { class: "logo shell-logo", "aria-hidden": "true" }, strokeIcon(ICONS.terminal, 18));
async function closeShell(s) {
  try { await post("/api/shells/close", { id: s.id }); }
  catch (err) { setLive(`Not closed: ${err.message}`); }
}
// The group an actor is listed under (features/list/status.ts's GROUPS, groupOf): those waiting on the user first, then
// those stopped on an error, saved for later, running, in the background, finished, idle, closed
const GROUPS = LS.GROUPS;
const groupOf = (g, a) => LS.groupOf(CTX, g, a);
// each group's mark, as the list marks its actors
const groupMark = (name) => name === "Saved" ? saveIcon(true) : el("span", { class: `status ${LS.GROUP_CLS[name]}`, "aria-hidden": "true" },
  el("i", { style: `--spin-at: -${Date.now() % 1200}ms` }));
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !picks.g || rowPop.el || ev.defaultPrevented) return;
    if (ev.target.closest && ev.target.closest("input, textarea, [contenteditable], .xterm")) return;
    clearPicks();
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!state.renaming || ev.target === nameInput) return;
    pressHeld = pressHeld || new Set();
    const over = () => {
      removeEventListener("pointerup", over, true); removeEventListener("pointercancel", over, true); clearTimeout(late);
      setTimeout(() => { const waiting = pressHeld; pressHeld = null; for (const fn of waiting || []) fn(); }, 0);   // after its click
    };
    addEventListener("pointerup", over, true); addEventListener("pointercancel", over, true);
    const late = setTimeout(over, 3000);               // released where this page never hears it
    endRename(true);
  }, true);
  document.addEventListener("dragover", () => { if (listDrag) listDrag.seen = Date.now(); }, true);
  document.addEventListener("drop", () => { if (listDrag) setTimeout(endDrag, 0); }, true);   // anywhere: after the line's own
}

export {
  APP_ITEM, COLLAPSED_KEY, CTX, FOLDER_CHARS, GROUPS, LEAD_RANK, MANAGER, OPEN, SHELLS, TASK_ITEM, actorOf, actorTitle,
  actorsWithin, addButton, aimStart, appFace, appFolder, appInfo, appItem, appKey, appMarkOf, appNotices,
  appShown, appStatusOf, appTaskOf, appTitle, appsFollowHome, appsKnown, appsNotified, askRefocus, boxGroups, boxKey,
  byName, closeApp, closeAsk, closeButton, closeShell, closedKids, closedSays, collapsed, crewAt, crewFace, crewHidden,
  crewHideKey, crewLine, crewPlace, deleteFolder, dragFolder, dragItems, dragRow, dropFolderClosing, dropOn,
  dropOnItem, endDrag, endRename, envelope, fileStarted, firstAgent, foldOpen, folderAct, folderBox, folderById,
  folderClosing, folderKey, folderMark, folderOf, folderPath, folderPost, folderSays, folderTally, gathererApps,
  gathererCounts, groupCrew, groupMark, groupOf, inPane, isAppItem, isCoordinator, isCrewHome, isHidden,
  isOpenFolder, itemNamed, keepTitle, kidFolders, listDrag, listModel, markDragged, moveHidingToServer, nameFolder, nameItem,
  nameNote, openIn, openTask, openUp, parentOf, pickMark, picked, plainFace, pressClose, readApps, renderAgents,
  reopenFolder, retask, rowButton, saveButton, savedAs, selectApp, setCrewHidden, setHidden, shellFolder,
  shellLogo, showFolder, showItemsTask, shownClosed, staleNames, startDrag, startFolderEdit, startIn, tabLine, takeOut, tallyChips,
  taskActors, taskApps, taskById, taskCloseButton, taskFaces, taskItems, taskLead, taskMembers, taskName, taskOf,
  taskSaveButton, taskStatus, titleOf, toggleFold, toggleFolder, toggleGatherer, togglePick, treeOf, withTasks, within,
};
