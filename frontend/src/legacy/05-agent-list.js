// ------------------------------------------------------------------ the agent list
const COLLAPSED_KEY = "ag-dashboard-collapsed-gatherers";
const collapsed = (() => {                        // gatherers the reader folded, kept in this browser
  try { const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
// Closed actors (their process gone), and those saved for later, are each folded away under a line ("N closed",
// "N saved"), unless the reader opened that gatherer's, kept in this browser. A selected one stays in view. So are the
// gatherer's shells ("N terminals", SHELLS) -- but none in view while folded, even one open in a pane.
const FOLD_KEYS = { Closed: "ag-dashboard-closed-shown", Saved: "ag-dashboard-saved-shown", Terminals: "ag-dashboard-terminals-shown" };
const foldOpen = Object.fromEntries(Object.entries(FOLD_KEYS).map(([group, key]) => {
  try { const v = JSON.parse(localStorage.getItem(key)); if (Array.isArray(v)) return [group, new Set(v)]; } catch (e) { /* none kept */ }
  return [group, new Set()];
}));
function toggleFold(group, name) {
  const open = foldOpen[group];
  if (open.has(name)) open.delete(name); else open.add(name);
  try { localStorage.setItem(FOLD_KEYS[group], JSON.stringify([...open])); } catch (e) { /* kept for this page only */ }
  renderAgents();
}
// The gatherer agents the reader hid from the list, by their gatherer, kept in this browser: its face on the gatherer's row
// (startButtons) shows it again, and opens it.
const CREW_HIDDEN_KEY = "ag-dashboard-crew-hidden";
const crewHidden = (() => {
  try { const v = JSON.parse(localStorage.getItem(CREW_HIDDEN_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
function setCrewHidden(name, hide) {
  if (hide) crewHidden.add(name); else crewHidden.delete(name);
  try { localStorage.setItem(CREW_HIDDEN_KEY, JSON.stringify([...crewHidden])); } catch (e) { /* kept for this page only */ }
  renderAgents();
}
// The actor shown when none is chosen: the newest not closed, else the newest.
const firstAgent = (g) => g.agents.find((a) => a.status !== "closed") || g.agents[0];
function toggleGatherer(name) {
  if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch (e) { /* kept for this page only */ }
  renderAgents();
}
// Hidden gatherers, kept by the server (hiding.py, `home.hiding`) so every dashboard on this home
// hides the same ones: those the reader hid ("hidden"), and those with nothing for a week
// (STALE_SECONDS) unless the reader kept them in view ("shown").
const HIDDEN_KEY = "ag-dashboard-hidden-gatherers";   // where this browser kept them before
const STALE_SECONDS = 7 * 86400;
const choiceOf = (g) => (state.home.hiding || {})[g.name] || "";
const stale = (g) => !!g.last && (state.home.now || Date.now() / 1000) - g.last > STALE_SECONDS;
const isHidden = (g) => choiceOf(g) === "hidden" || (stale(g) && choiceOf(g) !== "shown" && !g.agents.some((a) => savedAs(g.name, a)));
async function keepChoice(name, choice) {
  state.home.hiding = { ...(state.home.hiding || {}) };
  if (choice) state.home.hiding[name] = choice; else delete state.home.hiding[name];
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  const asked = homesTaken;                        // its answer kept unless a home came meanwhile (takeHome)
  try { const got = await post("/api/hiding", { gatherer: name, choice }); if (!homeSince(asked)) state.home.hiding = got; }
  catch (err) { setLive(`Not saved: ${err.message}`); }
}
// The reader's name for a gatherer, kept by the server (titles.py, `home.titles`) and shown in place of its own, which
// everything else -- its directory, its actors, `ag` -- still goes by.
const titleOf = (g) => (state.home.titles || {})[g.name] || g.name;
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
// its gatherer from being hidden for having had nothing for a week. The channel it was saved as: a codex
// session's, renamed to its thread since, its first.
const savedAs = (gname, a) => {
  const kept = (state.home.saved || {})[gname] || {};
  return a.channel in kept ? a.channel : a.session && a.session.started_as in kept ? a.session.started_as : null;
};
async function setSaved(gname, a, save) {
  const channel = savedAs(gname, a) || a.channel;
  const kept = { ...((state.home.saved || {})[gname] || {}) };
  if (save) kept[channel] = new Date().toISOString(); else delete kept[channel];
  state.home.saved = { ...(state.home.saved || {}), [gname]: kept };
  renderAgents();
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  const asked = homesTaken;
  try { const got = await post("/api/saved", { gatherer: gname, channel, saved: save }); if (!homeSince(asked)) state.home.saved = got; }
  catch (err) { setLive(`Not saved: ${err.message}`); }
  redrawList();
}
// FOLDERS (folders.py, `home.folders`: {gatherer: {folders: [{id, parent, name}], filed: {channel: folder id}}}), kept by
// the server so every dashboard on this home shows the same: the list as a tree, each gatherer its top folder. An actor is
// in one folder, or at its gatherer's top (one filed in a folder deleted since: at the top); a folder in another, or at
// the top. Each gatherer's and each folder's BOX (boxRows) lists, in this order: its folders, by name; its actors open,
// the newest first -- each staying in its place whatever its status does, under no heading (its dot says it; a folder's
// line counts those wanting the reader, stopped on an error, running); its terminals ("N terminals"), its saved actors
// once closed ("N saved") and its other closed ones ("N closed"), each folded till opened, as before folders. A folder is folded till opened (kept in this browser);
// folded, its actors open in a pane stay in view under it. Folders only organise the list: what a gatherer's actors
// share of one another's context is the gatherer's, whatever folder each is in. A folder CLOSED (its ×, closeFolder:
// folders.py's `close`) is listed in its parent's closed line, with its actors (shownClosed); deleted (its bin), what was
// in it moves up a level.
const FOLDER_CHARS = 60;
const byName = (x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }) || (x < y ? -1 : x > y ? 1 : 0);
// `gname` GF: the folders gatherers are kept in (05-gatherer-folders.js), their tree as a gatherer's, filed by gatherer
const treeOf = (gname) => (gname === GF ? state.home.gatherer_folders : (state.home.folders || {})[gname]) || { folders: [], filed: {} };
const folderById = (gname, id) => id === null || id === undefined ? null : treeOf(gname).folders.find((f) => f.id === id) || null;
// the folder a folder is in: its id, or null for the gatherer's top (one gone: the top)
const parentOf = (gname, f) => folderById(gname, f.parent) ? f.parent : null;
const kidFolders = (gname, id) => treeOf(gname).folders.filter((f) => parentOf(gname, f) === id);
// The channel the actor is filed as (its own, or the one it was started under, as savedAs finds it); null: in none
const filedAs = (gname, a) => {
  const filed = treeOf(gname).filed;
  return a.channel in filed ? a.channel : a.session && a.session.started_as in filed ? a.session.started_as : null;
};
// The folder the actor is in: its id, or null for its gatherer's top
function folderOf(gname, a) {
  const at = filedAs(gname, a), id = at ? treeOf(gname).filed[at] : null;
  return folderById(gname, id) ? id : null;
}
// Whether folder `id` is folder `inside`, or in it at any depth
function within(gname, id, inside) {
  for (let f = folderById(gname, id), n = 0; f && n < 500; f = folderById(gname, f.parent), n++) if (f.id === inside) return true;
  return false;
}
// A folder's path: its name after those of the folders it is in
function folderPath(gname, id, sep = " / ") {
  const names = [], seen = new Set();
  for (let f = folderById(gname, id); f && !seen.has(f.id); f = folderById(gname, f.parent)) { seen.add(f.id); names.unshift(f.name); }
  return names.join(sep);
}
// The actors (not the gatherer agent) in folder `id`, or in a folder in it
const actorsWithin = (g, id) => g.agents.filter((a) => {
  if (isCoordinator(a)) return false;
  const at = folderOf(g.name, a);
  return at !== null && within(g.name, at, id);
});
// Those of them open in a pane: in view under the folder while it is folded
const inPane = (g, a) => openActors().some((sel) => isAt(sel, g.name, a.channel));
const openIn = (g, id) => actorsWithin(g, id).filter((a) => inPane(g, a));
// What a folder holds, its folders' too: how many actors wait on the reader, stopped on an error, run, are idle; how
// many are open, saved (closed), closed
function folderTally(g, id) {
  const t = { asking: 0, error: 0, notified: appsNotified(g, id), running: 0, idle: 0, open: 0, saved: 0, closed: 0 };
  for (const a of actorsWithin(g, id)) {
    const group = groupOf(g, a);
    if (group === "Saved") t.saved++; else if (group === "Closed") t.closed++; else t.open++;
    if (group === "Waiting for you") t.asking++; else if (group === "Error") t.error++; else if (group === "Running") t.running++;
    else if (group === "Idle") t.idle++;
  }
  return t;
}
// A CLOSED folder (folders.py's `close`: its actors closed, their bookmarks off, its terminals ended; then it, and the
// folders in it, marked `closed`) is listed in its parent's closed line -- for as long as nothing in it is open again: no
// terminal opened in it, no actor in it open and used since it was closed (messaged, opened again: active, or its process
// started, since). Then it is listed with the open folders; its actor closed again, back in the closed line.
const shellsWithin = (g, id) => (state.home.shells || []).filter((s) => s.gatherer === g.name && folderById(g.name, s.folder) && within(g.name, s.folder, id));
function shownClosed(g, f) {
  if (!f || !f.closed) return false;
  const at = Date.parse(f.closed) / 1000;
  if (shellsWithin(g, f.id).length) return false;
  return !actorsWithin(g, f.id).some((a) => !["Saved", "Closed"].includes(groupOf(g, a))
    && ((a.last || 0) > at || !!(a.session && (a.session.since || 0) > at)));
}
const closedKids = (g, id) => kidFolders(g.name, id).filter((f) => shownClosed(g, f));
// What a box's closed line counts: its own closed actors (`own`), and every actor in its closed folders
const closedCount = (g, id, own) => own + closedKids(g, id).reduce((n, f) => n + actorsWithin(g, f.id).length, 0);
const closedSays = (g, id, own) => {
  const n = closedCount(g, id, own), k = closedKids(g, id).length;
  return n || !k ? `${n} closed` : plural(k, "closed folder");
};
// Each folder open or not (its key: its gatherer, its id), kept in this browser; a folder made, or one an actor is put
// in, opened
const FOLDERS_OPEN_KEY = "ag-dashboard-folders-open";
const foldersOpen = (() => {
  try { const v = JSON.parse(localStorage.getItem(FOLDERS_OPEN_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
const folderKey = (gname, id) => `${gname}\u0000${id}`;
const isOpenFolder = (gname, id) => gname === GF ? !gfFolded.has(id) : foldersOpen.has(folderKey(gname, id));
function showFolder(gname, id, open) {
  if (id === null) return;
  if (gname === GF) return gfShow(id, open);
  const k = folderKey(gname, id);
  if (open) foldersOpen.add(k); else foldersOpen.delete(k);
  try { localStorage.setItem(FOLDERS_OPEN_KEY, JSON.stringify([...foldersOpen])); } catch (e) { /* kept for this page only */ }
}
function toggleFolder(gname, id) {
  showFolder(gname, id, !isOpenFolder(gname, id));
  renderAgents();
}
// A box's folds (Closed, Saved, Terminals) open or not, by its key: a gatherer's top by its name (as before folders), a
// folder's by its gatherer and id
const boxKey = (gname, id) => id === null ? gname : `${gname}\u0000f${id}`;
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
  const g = picks.g && state.home.gatherers.find((x) => x.name === picks.g);
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
      title: `Put them in a folder of ${titleOf(g)}, or at its top`, onclick: (ev) => openMoveMenu(g, list, ev.currentTarget) },
      strokeIcon(ICONS.folder, 14), "Move to…"),
    el("button", { type: "button", class: "pb", title: allSaved ? "Unsave them all" : "Save them all for later",
      onclick: () => savePicks(g, list, !allSaved) }, saveIcon(allSaved), allSaved ? "Unsave" : "Save"),
    el("button", { type: "button", class: "pb", title: "Close them all: their processes ended, even mid-turn",
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
  items.push({ icon: ICONS.folderNew, text: "New folder…", note: "made at the top, the selected actors put in it: name it next",
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
    if (closable(a)) await closeSession(a);
    else if (discardable(a)) await discardSession(g, a);
  }
}
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || !picks.g || rowPop.el || ev.defaultPrevented) return;
  if (ev.target.closest && ev.target.closest("input, textarea, [contenteditable], .xterm")) return;
  clearPicks();
});
// Choices this browser kept before the server did: handed to the server once, then dropped here.
async function moveHidingToServer() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(HIDDEN_KEY)); } catch (e) { /* none kept */ }
  if (SNAPSHOT || !v) return;
  const had = state.home.hiding || {};
  for (const name of v.hidden || []) if (!had[name]) await keepChoice(name, "hidden");
  for (const name of v.shown || []) if (!had[name]) await keepChoice(name, "shown");
  try { localStorage.removeItem(HIDDEN_KEY); } catch (e) { /* stays; the server's choices win */ }
  renderAgents();
}
// A gatherer's or a folder's actors as its box lists them (FOLDERS): [group, list] for each that has any -- its actors
// open ("Open"), the newest first, whatever their status; then its shells, the oldest first (SHELLS), its saved actors
// once closed ("Saved"), its other closed ones, the newest first ("Closed") -- under which its closed folders are listed
// too, first (closedKids). `id`: the folder; null, the gatherer's top. The rail (railBox) has them so too.
const OPEN = "Open";
function boxGroups(g, id) {
  const mine = g.agents.filter((a) => !isCoordinator(a) && folderOf(g.name, a) === id);
  const latest = (x, y) => (y.last || 0) - (x.last || 0);
  const groups = [[OPEN, mine.filter((a) => !["Saved", "Closed"].includes(groupOf(g, a))).sort((x, y) => (y.created || 0) - (x.created || 0))]];
  const shells = (state.home.shells || []).filter((s) => s.gatherer === g.name && (folderById(g.name, s.folder) ? s.folder : null) === id);
  groups.push([SHELLS, shells], ["Saved", mine.filter((a) => groupOf(g, a) === "Saved").sort(latest)],
    ["Closed", mine.filter((a) => groupOf(g, a) === "Closed").sort(latest)]);
  // its closed line there too while it holds only closed folders (closedKids): drawn with them first
  return groups.filter(([name, list]) => list.length || (name === "Closed" && closedKids(g, id).length));
}
// how many of its actors wait on the user, how many stopped on an error, and how many run now; nothing while none does
function gathererCounts(g) {
  const n = (group) => g.agents.filter((a) => groupOf(g, a) === group).length, of = plural(g.agents.length, "actor");
  const count = (k, cls, what) => k ? el("span", { class: "count" + cls, title: `${k} of ${of} ${what}` }, el("i", { "aria-hidden": "true" }), String(k)) : null;
  const told = appsNotified(g);
  return [count(n("Waiting for you"), " asking", "waiting for you"), count(n("Error"), " error", "stopped on an error"),
    told ? el("span", { class: "count notified", title: `${plural(told, "app")} with a notification you haven't seen` }, el("i", { "aria-hidden": "true" }), String(told)) : null,
    count(n("Running"), "", "running")].filter(Boolean);
}
function renderAgents() {
  if (PANE) return;                                  // a frame has no list: the page around it has
  if (listDrag && !listDrag.force) { listDrag.later = true; return; }   // an actor dragged: once it is over
  drawn.agents = listSignature();                    // what render() compares a home's with
  tasksDrawn.clear();                                // each task's row drawn once, where its first actor is (rowsOf)
  for (const g of state.home.gatherers) if (!isHidden(g)) readApps(g.name);   // the apps its actors are attached to
  renderFolded();
  const aside = document.getElementById("agents");
  const was = listPlaces(aside);
  const typing = nameInput && document.activeElement === nameInput && [nameInput.selectionStart, nameInput.selectionEnd];
  const folderTyping = folderInput && document.activeElement === folderInput && [folderInput.selectionStart, folderInput.selectionEnd];
  nameMoving = true;                                 // taken out and put back: not a blur that names it
  document.getElementById("home").textContent = document.getElementById("home").title = state.home.home;
  const shown = state.home.gatherers.filter((g) => !isHidden(g)), hidden = state.home.gatherers.filter(isHidden);
  // its head: a gatherer or a folder of gatherers dropped on it, at the list's top (05-gatherer-folders.js)
  aside.replaceChildren(dropOn(el("div", { class: "aside-head" }, el("h2", { text: "Agents" }),
    SNAPSHOT ? null : el("button", { type: "button", onclick: () => openForm(""), title: "Make a new group" }, "+ New group"),
    SNAPSHOT ? null : el("button", { class: "gf-new", type: "button", title: "New folder, to keep groups in",
      "aria-label": "New folder, to keep groups in", onclick: () => startFolderEdit(GF, null, null) }, strokeIcon(ICONS.folderNew, 15)),
    el("span", { class: "list-btns" }, ...listButtons())), GFS, null, () => {}));
  if (state.adding && state.adding.gatherer === "") aside.append(gathererForm());
  if (!state.home.gatherers.length) aside.append(el("div", { class: "servers", text: "No groups in this home yet." }));
  else if (!shown.length) aside.append(el("div", { class: "servers", text: "Every group is hidden." }));
  aside.append(...gfLevel(shown, null, gathererBox));   // its gatherers, in the folders the reader keeps them in, if any
  if (hidden.length) {
    const list = el("details", { class: "hidden-list", id: "hidden-gatherers" },
      el("summary", { text: `${hidden.length} hidden group${hidden.length === 1 ? "" : "s"}` }));
    for (const g of hidden) list.append(el("div", { class: "hidden-row" }, el("span", { class: "gname", text: titleOf(g) }),
      el("span", { class: "why", text: choiceOf(g) === "hidden" ? "hidden" : `nothing for ${ago(g.last).replace(" ago", "")}` }),
      el("button", { type: "button", onclick: () => setHidden(g, false) }, "Show")));
    const wasOpen = document.getElementById("hidden-gatherers");
    if (wasOpen && wasOpen.open) list.open = true;
    aside.append(list);
  }
  slideList(aside, was);
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
  const servers = state.home.hook_servers || [];     // in the dashboard's panel (the header's button)
  document.getElementById("servers").textContent = servers.length
    ? servers.map((s) => `:${s.port} → ${s.upstream}`).join("\n") : "None running.";
}
// A gatherer's box in the list: its row -- its name, its gatherer agent, its counts, its buttons over them on hover --
// and, open, what is in it set in under it. Its row dragged (dragGatherer): put in a folder of gatherers.
function gathererBox(g) {
  const open = !collapsed.has(g.name);
  const crew = g.agents.find(isCoordinator);
  const box = el("div", { class: "gatherer" + (picks.g === g.name && picks.cs.size > 1 ? " picking" : "") },
    dropOn(dragGatherer(el("div", { class: "gatherer-row", "data-key": g.name },
      el("button", { class: "name", type: "button", "aria-expanded": open ? "true" : "false", onclick: () => toggleGatherer(g.name),
        title: g.policy ? `${g.name} · policy ${g.policy}` : g.name },
        el("span", { class: "caret", text: "▶" }),
        state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, null) ? null
          : el("span", { class: "gname", text: titleOf(g) })),
      state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, null) ? nameBox() : null,
      SNAPSHOT ? null : crewButton(g),                 // its gatherer agent, just after its name
      // how many of its actors wait on the user, how many stopped on an error, and how many run now; nothing while none does
      // -- and over them while it is hovered (or in focus), in a folder's line's order: "+ actor", "+ ⋯", a new folder,
      // rename, and hide (a folder's: delete)
      el("span", { class: "fill", onclick: () => toggleGatherer(g.name) }, ...gathererCounts(g),
        el("span", { class: "g-acts", onclick: (ev) => ev.stopPropagation() }, ...(SNAPSHOT ? [] : startButtons(g)),
          SNAPSHOT ? null : el("button", { class: "act newfolder", type: "button", title: `New folder in ${titleOf(g)}`,
            "aria-label": `New folder in ${titleOf(g)}`, onclick: () => startFolderEdit(g.name, null, null) }, strokeIcon(ICONS.folderNew, 14)),
          SNAPSHOT ? null : el("button", { class: "act rename", type: "button", title: `Rename ${titleOf(g)}`, "aria-label": `Rename ${titleOf(g)}`,
            onclick: () => retitle(g) }, strokeIcon("M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8", 14)),
          el("button", { class: "act hide", type: "button", title: `Hide ${g.name}`, "aria-label": `Hide ${g.name}`, onclick: () => setHidden(g, true) },
            hideIcon())))), g), g, null, () => { if (collapsed.has(g.name)) toggleGatherer(g.name); }));
  if (state.adding && state.adding.gatherer === g.name) box.append(newForm());
  if (g.error) box.append(el("div", { class: "servers", text: `Database unreadable: ${g.error}` }));
  // open: what is in it -- its gatherer agent, then its box's rows -- set in under its row, as a folder's are (g-kids)
  const kids = open ? [crew && !crewHidden.has(g.name) ? agentRow(g, crew, CREW_GROUP) : null, ...boxRows(g, null)].filter(Boolean) : [];
  if (kids.length) box.append(el("div", { class: "g-kids" }, ...kids));
  return box;
}
// A user's message in a chat bubble: src/features/chat/Bubble.tsx (ag_dashboard/DESIGN.md, A5).
// A message between the actors of a gatherer (coordination.py's `envelope`), typed into the receiver's terminal: its first
// line who it is from -- the gatherer agent, or another actor (its id, its name as JSON) -- and how to answer, then a
// blank line, then the message (or, as the list has it, its lines made one). Or the news of a watch the actor asked for
// (coordination.py's `update`, UPDATE): which actor is done, and how, then what it was asked and said. null: neither.
// Chat draws a message with its sender's avatar and name (src/features/chat/Bubble.tsx); the list, as a line (crewLine).
const ENVELOPE = /^Message from (the gatherer agent|actor ([\w-]+)(?:, ("(?:[^"\\]|\\.)*"))?)(?: \(answer it with: [^\n]*?\))?:\s+([\s\S]*)$/;
const UPDATE = /^Update \(you asked with `ag actors when`, watch (\d+)\): actor ([\w-]+)(?: \(("(?:[^"\\]|\\.)*")\))? is done: ([^\n]*?)\.(?:\s+([\s\S]*))?$/;
function envelope(text) {
  const s = String(text ?? "");
  const named = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
  let m = UPDATE.exec(s);
  if (m) return { from: "update", id: m[2], name: named(m[3]), how: m[4], watch: +m[1], text: m[5] || "" };
  m = ENVELOPE.exec(s);
  return m && { from: m[1] === "the gatherer agent" ? "coordinator" : "actor", id: m[2] || null, name: named(m[3]), text: m[4] };
}
const MANAGER = "roles/manager";             // the gatherer agent's picture (avatars.py's ROLES), before it has one
// An actor's avatar, small, as the list draws it (actorLogo) less its harness's mark: `fallback`, the picture with none.
function crewFace(a, fallback = null) {
  const name = (a && a.avatar) || fallback;
  const svg = SNAPSHOT && name && (SNAPSHOT.avatars || {})[name];
  const src = !name ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${name}.svg`;
  return src ? el("img", { class: "crew-face", src, alt: "", draggable: "false" })
    : el("span", { class: "crew-face none", "aria-hidden": "true" }, strokeIcon(ICONS.crew, 12));
}
// An actor's id as a label shows it: its first characters. Messages name ids whole (coordination.py's `_view`), for
// the actors to answer by; the page finds the actor by the whole id.
const crewId = (id) => String(id || "").slice(0, 8);
// in a line (the list's): who it is from, and its words
const crewLine = (env) => env.from === "update" ? `${env.name || `Actor ${crewId(env.id)}`} is done: ${env.how}`
  : `${env.from === "coordinator" ? "From the gatherer agent" : `From ${env.name || `actor ${crewId(env.id)}`}`}: ${env.text}`;
const isCoordinator = (a) => !!a && a.role === "coordinator";
// An actor is a TASK too (07-panes.js's taskKey): its row says how it stands at its left, its state in a word on its
// meta line (none, idle), and shows its face at its right.
function agentRow(g, a, group) {
  const [cls, label] = statusOf(a);
  const pk = picked(g, a);
  const current = !appSelected() && !appsOnly && isAt(focusedActor(), g.name, a.channel);   // an app selected: it is, not the actor
  const open = !current && !appsOnly && openActors().some((sel) => isAt(sel, g.name, a.channel));   // (out of sight: not)
  const naming = !!state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, a.channel);
  const named = a.name && a.name.text;
  // its name -- else what it was last asked -- double-clicked once it is the one shown (or F2): named there. Not a single
  // click: the row is its name alone, and a click on the row shown shows it (its task laid out again, if it was not)
  const nameIt = SNAPSHOT || !current ? {} : { ...(HOVERS.matches ? {} : { title: `${nameNote(g, a)}Double-click to ${named ? "rename" : "name"} it` }),
    ondblclick: (ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.stopPropagation(); startRename(g, a); } };
  const env = envelope(a.last_user_message);         // a message from another actor: who from, and its words
  const asked = env ? crewLine(env) : a.last_user_message;
  const row = el(naming ? "div" : "button", { class: "agent" + (naming ? " renaming" : "") + (isCoordinator(a) ? " coordinator" : "") + (pk ? " picked" : ""),
    ...(naming ? {} : { type: "button" }),
    "aria-current": current ? "true" : "false", "data-key": `${g.name}/${a.channel}`, "data-group": group,
    ...(open ? { "data-open": "true" } : {}), ...(naming ? {} : { "data-card": key(g.name, a.channel) }),
    // hovered, the card (actorCard) says who it is; where there is no hovering, its title
    ...(HOVERS.matches ? {} : { title: `${harnessName(a.harness)} · ${label} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}`
      + (asked && named ? `\nAsked: ${firstLine(asked, 300)}` : "") + (a.recap && a.recap.text ? `\nRecap, ${ago(a.recap.at)}: ${a.recap.text}` : "")
      + (SNAPSHOT ? "" : `\n${BESIDE_KEY}+click: open beside the one shown${isCoordinator(a) ? "" : "\nShift+click: select it, to move several"}`) }),
    ...(naming ? {} : { onclick: (ev) => {
      if (ev.shiftKey && !SNAPSHOT && !isCoordinator(a)) { ev.preventDefault(); togglePick(g, a); return; }
      pick(g.name, a.channel, ev);
    }, oncontextmenu: (ev) => pickBeside(g.name, a.channel, ev),
      onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startRename(g, a); } } }) },
    // its state at its left -- the list is drawn again on every change: the glyph's turn set by the clock, not restarted
    // each time -- and its face at its right
    el("span", { class: `dot ${cls}`, "aria-label": label, style: `--spin-at: -${Date.now() % 1200}ms` }),
    el("div", {},
      // just its name, else what it was last asked, on one line: what it was asked and its recap, in its title (and over
      // the whole page, the monitor's card)
      naming ? nameBox() : el("div", { class: "name" + (named ? "" : asked ? " unnamed" : " none"), ...nameIt,
        text: named || (asked ? firstLine(asked, 200) : isCoordinator(a) ? "Coordinates this gatherer's actors" : "No message yet") }),
      rowActs(addButton(g, a.channel), saveButton(g, a), closeButton(g, a)),
      branchChip(g, a),
      (a.background || []).length ? el("div", { class: "bgline", title: a.background.map((t) => `${TASK_KINDS[t.kind] || t.kind}: ${t.label || t.id}`).join("\n") },
        `${a.background.length} in background · ${a.background.map((t) => t.label || t.id).join(", ")}`) : null),
    el("span", { class: "a-face" }, pickMark(g, a, plainFace(a))));
  return naming || isCoordinator(a) ? row : dropOnItem(dragRow(row, g, a), g, a.channel);
}
// TASKS (tasks.py, `home.tasks`: {gatherer: {tasks: [{id, name}], tasked: {item: task id}}}): what the reader works with
// at once -- actors and apps alike, its ITEMS: an actor by its channel, an app's instance by "app:<its id>" (appItem) --
// one row in the list (taskRow), a leaf: what is in it shown in its card (06-list-modes.js's taskCard), and in its layout,
// opened by a click (openTask). An item in none is a task of its own: an actor's row (agentRow), an app's (appRow). Within
// a task every agent is attached to every app (task_links.py). Its "+" (addButton) adds to it a new agent (addToTask) or
// an app (addAppToTask); an item dragged onto another's row is put in its task (dropOnItem); the × in its card takes one
// out (takeOut).
const APP_ITEM = "app:";
const appItem = (id) => `${APP_ITEM}${id}`;
const isAppItem = (k) => String(k || "").startsWith(APP_ITEM);
const tasksOf = (gname) => (state.home.tasks || {})[gname] || { tasks: [], tasked: {} };
// a change's answer ({tasks, now}): its tasks taken, those of every gatherer (04-seen.js's newerTasks)
const takeTasks = (got) => { state.home.tasks = newerTasks(state.home.tasks, got.tasks, got.now); };
// the channel the actor is in its task as (its own, or the one it was started under, as filedAs finds it); null: none
const taskedAs = (gname, a) => {
  const t = tasksOf(gname).tasked;
  return a.channel in t ? a.channel : a.session && a.session.started_as in t ? a.session.started_as : null;
};
const taskById = (gname, id) => tasksOf(gname).tasks.find((t) => t.id === id) || null;
function taskOf(gname, a) {
  const at = taskedAs(gname, a), id = at ? tasksOf(gname).tasked[at] : null;
  return taskById(gname, id) ? id : null;
}
// the task an app's instance is in; null: none
function appTaskOf(gname, id) {
  const t = tasksOf(gname).tasked[appItem(id)];
  return t !== undefined && taskById(gname, t) ? t : null;
}
const actorOf = (g, c) => g.agents.find((x) => x.channel === c) || null;
// the task an item (an actor's channel, or an app's "app:<id>") is in; null: none
const itemTaskOf = (g, k) => isAppItem(k) ? appTaskOf(g.name, k.slice(APP_ITEM.length)) : ((a) => a ? taskOf(g.name, a) : null)(actorOf(g, k));
// an item as the server keeps it: an actor by the channel it is in its task as, or filed as (taskedAs, filedAs)
const keptAs = (g, k) => isAppItem(k) ? k : ((a) => a ? taskedAs(g.name, a) || filedAs(g.name, a) || a.channel : k)(actorOf(g, k));
const taskMembers = (g, id) => g.agents.filter((a) => taskOf(g.name, a) === id);
// its actors not closed: the one waiting on the reader first, then one stopped on an error, at work, done, the latest
// used; its LEAD the first of them -- none open, the latest used of all -- whose state its row says
const LEAD_RANK = { "Waiting for you": 0, Error: 1, Notification: 2, Running: 3, Background: 4, Finished: 5, Idle: 6 };
function taskActors(g, id) {
  const rank = (a) => LEAD_RANK[groupOf(g, a)] ?? 9;
  return taskMembers(g, id).filter((a) => rank(a) < 9).sort((x, y) => rank(x) - rank(y) || (y.last || 0) - (x.last || 0));
}
const taskLead = (g, id) => taskActors(g, id)[0] || taskMembers(g, id).sort((x, y) => (y.last || 0) - (x.last || 0))[0] || null;
// AN ITEM'S STATUS, an app's as an actor's (statusOf): worked out by the server from what was recorded of it, on every
// read of the home -- an app's from the notifications its app sent the user and has not cleared, nor they dismissed
// (data.py's `app_notices`: a gatherer's `apps`, {instance: {app, notices, last}}) -- and what the reader has seen of
// it (04-seen.js: an app's panel shown, as an actor's pane): one sent since they last looked, NOTIFIED, as an actor
// done since is FINISHED. Each said as [its class, its word], and ranked among an actor's (LEAD_RANK) where they are
// counted together: a task's row, a folder's and a gatherer's counts.
const NOTIFIED = ["notified", "Notification"];
const appKey = (gname, id) => key(gname, appItem(id));
// its notifications open, newest first: none, []
function appNotices(gname, id) {
  const g = state.home && state.home.gatherers.find((x) => x.name === gname), got = g && (g.apps || {})[id];
  return got ? [...(got.notices || [])].reverse() : [];
}
function appStatusOf(gname, id) {
  const g = state.home && state.home.gatherers.find((x) => x.name === gname), got = g && (g.apps || {})[id];
  return got && got.last && got.last > (seen.at[appKey(gname, id)] || 0) ? NOTIFIED : null;
}
// a task's state, as its row says it: its most pressing item's -- its lead actor's, or a notification of one of its apps,
// where that ranks first -- else, of apps only, "Apps"; nothing in it, closed
function taskStatus(g, id) {
  const lead = taskLead(g, id), apps = taskApps(g, id), told = apps.some((o) => appStatusOf(g.name, o.id));
  if (told && !(lead && (LEAD_RANK[groupOf(g, lead)] ?? 9) < LEAD_RANK.Notification)) return NOTIFIED;
  return lead ? statusOf(lead) : apps.length ? ["idle", "Apps"] : ["closed", "Closed"];
}
// how many apps of a gatherer (`inside`: in folder `inside`, its folders' too) have a notification the reader has not seen
const appsNotified = (g, inside = undefined) => gathererApps(g.name).filter((o) => {
  if (!appStatusOf(g.name, o.id)) return false;
  if (inside === undefined) return true;
  const f = appFolder(g.name, o.id);
  return f !== null && within(g.name, f, inside);
}).length;
const actorTitle = (a) => (a.name && a.name.text) || (a.last_user_message ? firstLine(a.last_user_message, 120) : "No message yet");
// an app as said: the user's name for it, else its kind and what it shows; in its row and card, its name, else what it
// shows, else its kind (its face says the kind)
const appTitle = (o) => o.name || (o.title ? `${o.app.label} · ${o.title}` : o.app.label);
const appShown = (o) => o.name || o.title || o.app.label;
// its items: its actors' channels, then its apps' (those open)
const taskItems = (g, id) => [...taskMembers(g, id).map((a) => a.channel), ...taskApps(g, id).map((o) => appItem(o.id))];
// its name: the reader's, else its lead actor's, else its first app's
function taskName(g, t) {
  if (t.name) return t.name;
  const lead = taskLead(g, t.id), o = lead ? null : taskApps(g, t.id)[0];
  return lead ? actorTitle(lead) : o ? appTitle(o) : "A task";
}
// a list's rows of an actor: its own, or its task's, once -- where the first of its items comes (`tasksDrawn`, cleared as
// the list is drawn)
const tasksDrawn = new Set();
function rowsOf(g, a, group) {
  const id = taskOf(g.name, a);
  return id === null ? [agentRow(g, a, group)] : taskRows(g, id, group);
}
function taskRows(g, id, group) {
  const k = `${g.name}\u0000${id}`;
  if (tasksDrawn.has(k)) return [];
  tasksDrawn.add(k);
  const t = taskById(g.name, id);
  return [taskRow(g, t, group)];
}
// The apps of a box (folder `id`, null: the gatherer's top) as rows of their own, after its open actors (boxRows): each
// in no task (appRow), and each task of apps only (no actor's rows draws it) -- where they are filed (appFolder)
function appRowsIn(g, id) {
  const out = [];
  for (const o of gathererApps(g.name)) {
    if (appFolder(g.name, o.id) !== id) continue;
    const t = appTaskOf(g.name, o.id);
    if (t === null) out.push(appRow(g, o));
    else if (!taskMembers(g, t).length) out.push(...taskRows(g, t, OPEN));
  }
  return out;
}
// the folder an app is filed in (folders.py's `filed`, by its item); null: its gatherer's top
const appFolder = (gname, id) => { const f = treeOf(gname).filed[appItem(id)]; return folderById(gname, f) ? f : null; };
// THE APPS of each gatherer (/api/apps, the host's): its open instances, and its tasks with them (which an app is in) --
// read again as the list is drawn, at most every APPS_READ ms (`now`: at once; -> once read) -- the list drawn again if
// they changed
const APPS_READ = 2000, appsKnown = new Map(), appsRead = new Map();
function readApps(gname, now = false) {
  if (PANE || SNAPSHOT || !window.agNext || !window.agNext.apps.found().length) return Promise.resolve();
  if (!now && Date.now() - (appsRead.get(gname) || 0) < APPS_READ) return Promise.resolve();
  appsRead.set(gname, Date.now());
  return get(`/api/apps?gatherer=${encodeURIComponent(gname)}`).then((got) => {
    const is = JSON.stringify({ instances: got.instances || [], attached: got.attached || {} });
    const had = JSON.stringify(state.home.tasks || {});
    if (got.tasks) state.home.tasks = newerTasks(state.home.tasks, got.tasks.tasks && got.tasks.tasks.length ? { [gname]: got.tasks } : {}, got.now, gname);
    const moved = had !== JSON.stringify(state.home.tasks || {});
    if (!moved && JSON.stringify(appsKnown.get(gname) || null) === is) return;
    appsKnown.set(gname, JSON.parse(is));
    renderAgents();
  }).catch(() => { /* none known: none shown */ });
}
// an open instance as the list has it -- {app (its manifest), id, title, name (the user's), folder, inst} -- null: of an
// app not found here
function appOf(i) {
  const app = window.agNext && window.agNext.apps.named(i.app);
  return app ? { app, id: i.id, title: i.title || "", name: i.name || "", folder: i.folder || null, inst: i } : null;
}
const gathererApps = (gname) => PANE || SNAPSHOT ? [] : ((appsKnown.get(gname) || {}).instances || []).map(appOf).filter(Boolean);
const appInfo = (gname, id) => gathererApps(gname).find((o) => o.id === id) || null;
// a task's apps, as they were opened
const taskApps = (g, id) => gathererApps(g.name).filter((o) => appTaskOf(g.name, o.id) === id);
// an app's mark: small, beside a task's faces
const appMarkOf = (o) => o.app.mark
  ? el("img", { class: "t-app", src: `/apps/mark/${encodeURIComponent(o.app.name)}.svg`, alt: o.app.label, title: appTitle(o), draggable: "false" })
  : el("span", { class: "t-app none", title: o.app.label }, strokeIcon(ICONS.app, 12));
// an app's face: its mark at an avatar's size, where an actor has its face
const appFace = (o) => el("span", { class: "logo app-face", title: appTitle(o) }, o.app.mark
  ? el("img", { src: `/apps/mark/${encodeURIComponent(o.app.name)}.svg`, alt: "", draggable: "false" }) : strokeIcon(ICONS.app, 16));
// several apps' marks, stacked over one another as faces are (`most` at most); none: nothing
const appStack = (list, most = 3) => list.length ? el("span", { class: "t-apps" }, ...list.slice(0, most).map(appMarkOf)) : null;
// an actor's face alone, no harness's badge (actorLogo's): its avatar, else its harness's mark
function plainFace(a) {
  const svg = SNAPSHOT && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
  const src = !a.avatar ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${a.avatar}.svg`;
  return src ? el("span", { class: "logo avatar" }, el("img", { src, alt: "", draggable: "false" })) : harnessLogo(a.harness);
}
// its actors' faces, those not closed (three at most, then how many more), and the marks of its apps
function taskFaces(g, id) {
  const list = taskActors(g, id), out = [];
  for (const a of list.slice(0, 3)) {
    const svg = SNAPSHOT && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
    const src = !a.avatar ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${a.avatar}.svg`;
    out.push(src ? el("img", { class: "t-face", src, alt: "", title: `${actorTitle(a)} · ${statusOf(a)[1]}`, draggable: "false" })
      : el("span", { class: "t-face none", title: actorTitle(a) }, harnessLogo(a.harness)));
  }
  if (list.length > 3) out.push(el("span", { class: "t-more", text: `+${list.length - 3}` }));
  const apps = appStack(taskApps(g, id));
  if (apps) out.push(apps);
  return out;
}
// A task's row: as an actor's -- its lead's state at its left, its name -- its actors' faces and its apps' marks at its
// right, its "+" over them hovered. A group, not a folder: what is in it is listed in its card (hovered), not in the
// list. Pressed: opened (openTask). Dragged: all in it; an item dropped on it, put in it.
function taskRow(g, t, group) {
  const all = taskMembers(g, t.id), apps = taskApps(g, t.id), lead = taskLead(g, t.id);
  const [cls, label] = taskStatus(g, t.id);
  const name = taskName(g, t), first = lead ? lead.channel : apps.length ? appItem(apps[0].id) : null;
  // the task of what is selected: marked
  const current = selectedTask() === `${g.name}\u0000t${t.id}`;
  const open = !current && (all.some((a) => openActors().some((s) => isAt(s, g.name, a.channel)))
    || apps.some((o) => panes.apps.some((p) => !p.held && p.instance.id === o.id)));
  const what = [all.length ? plural(all.length, "actor") : null, apps.length ? plural(apps.length, "app") : null].filter(Boolean).join(", ");
  const k = `${TASK_ITEM}${t.id}`, naming = renamingItem(g.name, k);
  const row = el(naming ? "div" : "button", { class: "agent task" + (naming ? " renaming" : ""), ...(naming ? {} : { type: "button" }),
    "aria-current": current ? "true" : "false", "data-key": `${g.name}/task:${t.id}`,
    "data-group": group, ...(open ? { "data-open": "true" } : {}), ...(naming ? {} : { "data-card": key(g.name, `task:${t.id}`) }),
    ...(HOVERS.matches ? {} : { title: `${name}: ${what || "nothing"}${SNAPSHOT ? "" : `\nClick: open it · ${BESIDE_KEY}+click: open it beside the one shown\nDouble-click its name (or F2) to ${t.name ? "rename" : "name"} it`}` }),
    // pressed, its card put away (as the rail's tile does): a live card stays while the pointer is on the row, over the
    // panels the task opens
    ...(naming ? {} : { onclick: (ev) => { cardHide(ev); openTask(g.name, t.id, null, ev); }, onkeydown: (ev) => renameKey(ev, g, k) }) },
  el("span", { class: `dot ${cls}`, "aria-label": label, style: `--spin-at: -${Date.now() % 1200}ms` }),
  el("div", {},
    naming ? nameBox() : el("div", { class: "name", text: name, ...nameOnDouble(g, k) }),
    rowActs(first ? addButton(g, first) : null, taskSaveButton(g, t), taskCloseButton(g, t))),
  el("span", { class: "t-faces" }, ...taskFaces(g, t.id)));
  return naming || !first ? row : dropOnItem(dragItems(row, g, () => taskItems(g, t.id)), g, first);
}
// A task SAVED: every actor in it saved for later, as an actor's bookmark saves it -- the bookmark filled once every one
// is; closed, the task is then listed in its folder's saved line, not its closed one (where its first actor comes)
function taskSaveButton(g, t) {
  const all = taskMembers(g, t.id);
  if (!all.length) return null;
  const saved = all.every((a) => !!savedAs(g.name, a));
  if (SNAPSHOT) return saved ? el("span", { class: "save-btn on", title: "Saved for later" }, saveIcon(true)) : null;
  return rowButton("save-btn" + (saved ? " on" : ""), { "aria-pressed": saved ? "true" : "false",
    title: saved ? "Saved for later: click to unsave its actors" : "Save the task for later: once closed, kept in its folder's saved line",
    "aria-label": saved ? "Unsave the task" : "Save the task for later" }, () => saveTask(g.name, t.id, !saved), saveIcon(saved));
}
async function saveTask(gname, id, save) {
  const g = state.home.gatherers.find((x) => x.name === gname);
  for (const a of g ? taskMembers(g, id) : []) if (!!savedAs(gname, a) !== save) await setSaved(gname, a, save);
}
// A task CLOSED (its ×, while an actor of it runs): its actors' processes closed, as an actor's × does, and its apps put
// to sleep -- kept, in the task, with nothing running for them (a Browser's tabs closed, their pages kept: app_host.py's
// `sleep_instance`) -- their panels here closed first, the task's layout remembered. Clicked again later, it opens as
// it was: its apps above (a Browser's tabs opened again), its actors as closed ones are, started again by a message.
function taskCloseButton(g, t) {
  if (SNAPSHOT || !taskMembers(g, t.id).some(closable)) return null;
  return rowButton("close-btn", { title: "Close the task: its actors closed, its apps put to sleep (a Browser's tabs kept) -- opened again as it was",
    "aria-label": "Close the task" }, () => closeTask(g.name, t.id), closeIcon());
}
async function closeTask(gname, id) {
  const g = state.home.gatherers.find((x) => x.name === gname);
  if (!g) return;
  const k = `${gname}\u0000t${id}`, apps = taskApps(g, id);
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
// under it, its "+" and its × (closeApp), its face at its right. Pressed: selected (selectApp); dragged onto another item's
// row, put in its task, as an item dropped on it is put in one with it.
function appRow(g, o) {
  const chosen = appSelected() === o.id, shown = !chosen && panes.apps.some((p) => !p.held && p.instance.id === o.id), k = appItem(o.id);
  const told = appStatusOf(g.name, o.id), last = told && appNotices(g.name, o.id)[0], naming = renamingItem(g.name, k);
  const row = el(naming ? "div" : "button", { class: "agent app-row" + (naming ? " renaming" : ""), ...(naming ? {} : { type: "button" }),
    "aria-current": chosen ? "true" : "false", "data-key": `${g.name}/${k}`,
    "data-group": OPEN, ...(shown ? { "data-open": "true" } : {}), ...(naming ? {} : { "data-card": appKey(g.name, o.id) }),
    ...(HOVERS.matches ? {} : { title: `${o.name ? `${o.name} · ` : ""}${o.title ? `${o.app.label} · ${o.title}` : o.app.label}${last ? `\n${last.title}` : ""}${o.folder ? `\n${o.folder}` : ""}${SNAPSHOT ? "" : `\n${BESIDE_KEY}+click: beside the ones shown\nDouble-click its name (or F2) to ${o.name ? "rename" : "name"} it`}` }),
    ...(naming ? {} : { onclick: (ev) => { cardHide(ev); selectApp(g.name, o, ev); }, onkeydown: (ev) => renameKey(ev, g, k) }) },
  told ? el("span", { class: `dot ${told[0]}`, "aria-label": told[1] }) : el("span", { class: "dot-none", "aria-hidden": "true" }),
  el("div", {},
    naming ? nameBox() : el("div", { class: "name", text: appShown(o), ...nameOnDouble(g, k) }),
    rowActs(addButton(g, k), SNAPSHOT ? null : rowButton("close-btn", { title: `Close ${o.app.label}: the app closed`, "aria-label": `Close ${o.app.label}` },
      () => closeApp(g.name, o), closeIcon()))),
  el("span", { class: "a-face" }, appFace(o)));
  return naming ? row : dropOnItem(dragItems(row, g, () => [k]), g, k);
}
// An app SELECTED, as an actor is (07-panes.js's selectAppPane): its task entered first, if another is shown -- as a click
// on that task would; one of apps only, its apps alone shown (enterAppTask) -- its panel shown (opened, if it was not) and
// selected. ⌘/Ctrl: no task entered, its panel added beside the ones shown.
async function selectApp(gname, o, ev = null) {
  const g = state.home.gatherers.find((x) => x.name === gname);
  if (!g) return;
  if (!(ev && (ev.ctrlKey || ev.metaKey) && !SNAPSHOT)) {
    const k = taskKey(gname, appItem(o.id));
    if (selectedTask() !== k) {
      const id = appTaskOf(gname, o.id), lead = id === null ? null : taskLead(g, id);
      if (lead) await openTask(gname, id);
      else enterAppTask(gname, k);
      await taskAppsOpening;
    }
  }
  let p = panes.apps.find((q) => q.instance.id === o.id);
  if (p && p.held) holdAppPane(p, false);
  if (!p) {
    const inst = await window.agNext.apps.instanceOf(o.app.name, gname, o.id).catch(() => null);
    if (!inst) { paneNote(`${o.app.label}: closed`); readApps(gname, true); return; }
    p = panes.apps.find((q) => q.instance.id === inst.id) || addAppPane(o.app, inst);
    saveAppPanes();
  }
  selectAppPane(p);
}
// an app closed: its instance closed (its agents detached, out of its task), its panel gone
async function closeApp(gname, o) {
  try { await post("/api/apps/close", { gatherer: gname, instance: o.id }); }
  catch (e) { paneNote(`Close ${o.app.label}: ${e.message}`); return; }
  unselectApp(o.id);
  for (const p of panes.apps.filter((q) => q.instance.id === o.id)) {
    panes.apps.splice(panes.apps.indexOf(p), 1);
    p.panel.destroy(); p.gutter.remove(); p.node.remove();
    topRow(p, null);
  }
  appsOnlyLeft();
  topLayout(); saveAppPanes();
  await loadHome();
  readApps(gname, true);
  renderAgents();
}
// A task opened: shown as it was left (07-panes.js's enterTask and rememberTask) -- `focus`, else the one in focus then,
// else its lead, in the pane in focus -- or, never left, its actors not closed side by side, its apps above. The task
// shown already: as it is (an actor's pane closed in it stays closed) -- but one shown by chance, never laid out in this
// page (as the page opened on one of its actors), laid out as at first. One of apps only: its apps alone (enterAppTask).
// ⌘/Ctrl: the whole task beside the one shown (07-panes.js's openTaskBeside).
async function openTask(gname, id, focus = null, ev = null) {
  const g = state.home.gatherers.find((x) => x.name === gname);
  if (!g) return;
  const k = `${gname}\u0000t${id}`, sel = focusedActor(), was = taskLayout(k);
  const ok = (c) => !!c && taskActors(g, id).some((a) => a.channel === c);
  // as it was left: its panes in their order (the first in this page's own), the one in focus then in focus again
  const first = focus || (was && ok(was.actors[0]) ? was.actors[0] : null) || (was && ok(was.focus) ? was.focus : null)
    || (taskLead(g, id) || {}).channel;
  if (!first) {                                            // apps only
    if (selectedTask() === k) return;
    enterAppTask(gname, k);
    await taskAppsOpening;
    const p = panes.apps.find((q) => !q.held && q.instance.id === (was && was.focusApp)) || panes.apps.find((q) => !q.held && appPaneTask(q) === k);
    if (p) selectAppPane(p);
    return;
  }
  if (ev && (ev.ctrlKey || ev.metaKey) && !SNAPSHOT) return openTaskBeside(gname, k, first);   // the whole task, beside
  if (!appsOnly && sel && taskKey(sel[0], sel[1]) === k) {   // shown already: as it is, once laid out
    if (focus) await show(gname, focus);
    else if (!tasksLaidOut.has(k)) await show(gname, sel[1]);   // shown by chance (as the page opened): laid out now (enterTask)
    return;
  }
  await show(gname, first);
  const back = !focus && was && ok(was.focus) && was.focus !== first && actorPanes().find((p) => isAt([p.g, p.c], gname, was.focus));
  if (back) focusPane(back);
  if (!focus && was && was.focusApp) {                     // an app selected in it when it was left: selected again
    await taskAppsOpening;
    const p = panes.apps.find((q) => q.instance.id === was.focusApp && !q.held);
    if (p) selectAppPane(p);
  }
}
// "+" on an item's row, a task's (on its first item), and in a task's card (`label` beside it): something added to the
// item's task -- a new agent on a harness picked (addToTask), or an app (addAppToTask) -- from its menu
function addButton(g, k, label = null) {
  const a = isAppItem(k) ? null : actorOf(g, k), o = a ? null : appInfo(g.name, k.slice(APP_ITEM.length));
  if ((!a && !o) || (a && isCoordinator(a))) return null;
  const hs = SNAPSHOT ? [] : startable();
  const apps = SNAPSHOT || PANE || !window.agNext ? [] : window.agNext.apps.found();
  if (!hs.length && !apps.length) return null;
  // its menu's key: its own, apart from the list's "+" for the same item, which the menu would hang from otherwise
  const mk = `${label ? "card-" : ""}task-add:${g.name}/${k}`, id = itemTaskOf(g, k);
  const where = id !== null ? taskName(g, taskById(g.name, id)) : a ? actorTitle(a) : appTitle(o);
  const items = [
    ...hs.map((h) => ({ mark: harnessBadge(h), text: harnessName(h), note: "a new agent, in the same directory", run: () => addToTask(g.name, k, h) })),
    ...apps.map((app) => ({ icon: ICONS.app, mark: app.mark ? appMarkImg(app) : null, text: app.label, note: "an app, the task's agents attached to it",
      run: () => addAppToTask(g.name, k, app.name) })),
  ];
  const b = rowButton("task-add", { title: `Add to this task: ${[hs.length ? "an agent" : null, apps.length ? "an app" : null].filter(Boolean).join(" or ")}`,
    "aria-label": "Add to this task", "data-pop": mk, "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === mk) },
  () => openPop(mk, b, popMenu(`Add to ${where}`, items)),
  el("span", { class: "task-add-in", "aria-hidden": "true" }, "+", label ? el("span", { class: "t-lbl", text: label }) : null));
  return b;
}
// the task of item `k` shown, if another is: entered as a click on it would
async function showItemsTask(g, k) {
  if (selectedTask() === taskKey(g.name, k)) return;
  const id = itemTaskOf(g, k), a = isAppItem(k) ? null : actorOf(g, k);
  if (a) await (id === null ? show(g.name, a.channel) : openTask(g.name, id));
  else { const o = appInfo(g.name, k.slice(APP_ITEM.length)); if (o) await selectApp(g.name, o); }
}
// The task shown, its key changed by a change of the tasks (a lone item made one with others, or one joined): laid out
// still, and still the one entered, under its new key
function retask(was) {
  const now = selectedTask();
  if (!was || !now || was === now) return;
  if (tasksLaidOut.has(was)) tasksLaidOut.add(now);
  if (taskNow === was) taskNow = now;
  if (appsOnly === was) appsOnly = now;
}
async function addToTask(gname, k, harness) {
  const g = state.home.gatherers.find((x) => x.name === gname);
  const a = g && !isAppItem(k) ? actorOf(g, k) : null, o = g && !a ? appInfo(gname, k.slice(APP_ITEM.length)) : null;
  if (!a && !o) return;
  const cwd = (a ? cwdOf(a) : o.folder) || startCwd(g);
  if (!cwd) return paneNote("Add an agent: this has no directory to start one in");
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
  const g = state.home.gatherers.find((x) => x.name === gname);
  const a = g && !isAppItem(k) ? actorOf(g, k) : null, o = g && !a ? appInfo(gname, k.slice(APP_ITEM.length)) : null;
  const app = (a || o) && window.agNext ? window.agNext.apps.named(name) : null;
  if (!app) return;
  await showItemsTask(g, k);
  const was = selectedTask();
  try {
    const inst = await window.agNext.apps.open(name, gname, (a ? cwdOf(a) : o.folder) || null);
    if (!o || inst.id !== o.id) takeTasks(await post("/api/tasks", { gatherer: gname, do: "add", to: keptAs(g, k), items: [appItem(inst.id)] }));
    await readApps(gname, true);
    let there = panes.apps.find((p) => p.instance.id === inst.id);
    if (!there) there = addAppPane(app, inst);
    else { if (there.held) holdAppPane(there, false); there.panel.refresh(); }
    saveAppPanes();
    retask(was);
    selectAppPane(there);                              // added: selected, as an actor started is shown
  } catch (e) { paneNote(`${app.label}: ${e.message}`); }
  renderAgents();
}
// An item taken out of its task: a task of its own again (the task gone, if one item is left in it) -- detached from the
// task's others (task_links.py)
async function takeOut(gname, k) {
  const g = state.home.gatherers.find((x) => x.name === gname);
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
  const g = state.home.gatherers.find((x) => x.name === gname);
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
// A row's buttons ("+", bookmark, ×), one group -- shown over its face while it is hovered (04-list.css); none: nothing
const rowActs = (...bs) => bs.some(Boolean) ? el("span", { class: "a-acts" }, ...bs) : null;
// A selected actor's check, on its avatar, once two or more are selected: a click on it leaves it out
function pickMark(g, a, logo) {
  if (!picked(g, a) || picks.cs.size < 2 || !(logo instanceof HTMLElement)) return logo;
  logo.append(el("span", { class: "pick", role: "button", title: "Selected: click to leave it out", "aria-label": "Leave it out of the selection",
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
function saveButton(g, a) {
  if (isCoordinator(a)) return SNAPSHOT ? null : rowButton("save-btn", { title: "Hide the gatherer agent from the list: its face on the gatherer's row shows it again, and opens it",
    "aria-label": "Hide the gatherer agent" }, () => setCrewHidden(g.name, true), hideIcon());
  const saved = !!savedAs(g.name, a);
  if (SNAPSHOT) return saved ? el("span", { class: "save-btn on", title: "Saved for later" }, saveIcon(true)) : null;
  return rowButton("save-btn" + (saved ? " on" : ""), { "aria-pressed": saved ? "true" : "false",
    title: saved ? "Saved for later: click to unsave (it stays in its folder)"
      : "Save for later: once closed, kept in its folder's saved line, apart from the closed ones",
    "aria-label": saved ? "Unsave" : "Save for later" }, () => setSaved(g.name, a, !saved), saveIcon(saved));
}
// Its ×: its process closed (closable), or, one that never started, it discarded (discardable); null: neither.
function closeButton(g, a) {
  return closable(a) ? rowButton("close-btn", { title: "Close this session's process (the dashboard's agent or terminal), even mid-turn",
      "aria-label": "Close session" }, () => closeSession(a), closeIcon())
    : discardable(a) ? rowButton("close-btn", { title: "Close: it never started, so it goes from the list, and nothing of it is kept",
      "aria-label": "Close session" }, () => discardSession(g, a), closeIcon()) : null;
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
function drawNamed() { renderAgents(); drawWho(); }
const redrawNamed = () => pressHeld ? pressHeld.add(drawNamed) : drawNamed();
const nameAnswers = new Map();                       // what came of each name given from this page: actor -> the answer
const nameKey = (gname, c) => `${gname}\u0000${c}`;
function nameNote(g, a) {
  if (!a.name || !a.name.text) return "";
  if (a.name.by !== "user") return `${harnessInfo(a.name.by) ? `${harnessName(a.name.by)}'s` : "Its harness's"} name for it\n`;
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
  const g = state.home.gatherers.find((x) => x.name === r.g), a = g && g.agents.find((x) => x.channel === r.c);
  const text = r.value.replace(/\s+/g, " ").trim().slice(0, 120);
  if (r.c === null) return keep && g && text !== titleOf(g) ? keepTitle(r.g, text) : redrawNamed();
  if (!keep || !a || text === ((a.name && a.name.text) || "") || (!text && !r.was)) { redrawNamed(); return; }
  const before = a.name;
  a.name = text ? { text, by: "user" } : null;     // shown at once; the gatherer's event confirms it (the harness's own back)
  redrawNamed();
  try {
    const got = await post("/api/name", { gatherer: r.g, channel: r.c, name: text, harness: a.harness, cwd: a.cwd });
    nameAnswers.set(nameKey(r.g, r.c), got);
    if (got.error) setLive(`${text ? "Named" : "Name taken back"} here; not in ${harnessName(a.harness)}: ${got.error}`);
  } catch (err) {
    a.name = before;
    setLive(`Not named: ${err.message}`);
  }
  redrawNamed();
}
// Naming a TASK or an APP, as an actor is named: its name in its row double-clicked (or F2 on its row), or its card's
// pencil (06-list-modes.js's editInCard) -- `state.renaming.c` its item ("task:<id>", "app:<instance id>"), `kind`
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
  const g = state.home.gatherers.find((x) => x.name === gname), got = g && itemNamed(g, k);
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
// A box's rows (FOLDERS): its folders -- each a line, and under it, opened, its own box, indented -- then its actors open,
// then its folds. `id`: the folder; null, the gatherer's top.
function boxRows(g, id) {
  const out = [], edit = state.folderEdit;
  if (edit && edit.g === g.name && edit.id === null && edit.parent === id)
    out.push(el("div", { class: "folder-line editing", "data-key": `${g.name}/folder:new` }, folderBox()));
  for (const f of kidFolders(g.name, id)) if (!shownClosed(g, f)) out.push(...folderRows(g, f));   // the closed: in its closed line
  let apps = false;
  for (const [name, list] of boxGroups(g, id)) {
    if (!apps && name !== OPEN) { out.push(...appRowsIn(g, id)); apps = true; }   // the apps: after the open actors
    if (name in FOLD_KEYS) { out.push(...foldRows(g, id, name, list)); continue; }
    for (const a of list) out.push(...rowsOf(g, a, name));
  }
  if (!apps) out.push(...appRowsIn(g, id));
  return out;
}
// A folder's rows: its line, and under it, opened, its box, set in -- a closed one's (shownClosed) all it holds, as
// closedRows has it -- or, folded, its actors open in a pane; under its line, while its × asks first, the question
// (closeAsk).
function folderRows(g, f) {
  const out = [folderLine(g, f)], closed = shownClosed(g, f);
  if (folderClosing && folderClosing.from === "list" && folderClosing.g === g.name && folderClosing.id === f.id) out.push(closeAsk(g, f));
  if (isOpenFolder(g.name, f.id)) {
    const rows = closed ? closedRows(g, f.id) : boxRows(g, f.id);
    out.push(el("div", { class: "f-kids" }, ...(rows.length ? rows
      : [el("div", { class: "f-empty", text: SNAPSHOT || closed ? "Empty" : "Empty: drag actors here, or start one with its +" })])));
  } else {
    const peek = openIn(g, f.id);                    // folded: those open in a pane, in view under it
    if (peek.length) out.push(el("div", { class: "f-kids peek" }, ...peek.map((a) => agentRow(g, a, groupOf(g, a)))));
  }
  return out;
}
// What a closed folder holds, all closed: its folders, then its actors, the latest first -- under no line of their own
function closedRows(g, id) {
  const mine = g.agents.filter((a) => !isCoordinator(a) && folderOf(g.name, a) === id).sort((x, y) => (y.last || 0) - (x.last || 0));
  return [...kidFolders(g.name, id).flatMap((f) => folderRows(g, f)), ...mine.flatMap((a) => rowsOf(g, a, groupOf(g, a)))];
}
// A box's fold: its line ("▸ N closed"), and under it, once opened, its actors (or shells) -- folded, those open in a
// pane (no shell) -- open or not kept in this browser, for each box (boxKey). Its closed line holds its closed folders
// too, first, and counts their actors (closedSays).
function foldRows(g, id, name, list) {
  const k = boxKey(g.name, id), shown = foldOpen[name].has(k), shells = name === SHELLS;
  const kids = name === "Closed" ? closedKids(g, id) : [];
  const line = el("button", { class: "agent-group fold-line", type: "button", "aria-expanded": shown ? "true" : "false",
    "data-key": `${g.name}/${id === null ? "" : id}/${name}`,
    title: shells ? (shown ? "Hide the terminals" : "Show the terminals")
      : name === "Saved" ? `${shown ? "Hide" : "Show"} the saved actors that are closed: kept here, apart from the closed ones, till unsaved`
      : `${shown ? "Hide" : "Show"} the closed ${kids.length ? "folders and actors" : "actors"}`,
    onclick: () => toggleFold(name, k) },
    `${shown ? "▾" : "▸"} `,
    shells ? plural(list.length, "terminal") : name === "Closed" ? closedSays(g, id, list.length) : `${list.length} ${name.toLowerCase()}`);
  if (shells) return [line, ...(shown ? list.map((s) => shellRow(g, s)) : [])];
  if (shown) return [line, ...kids.flatMap((f) => folderRows(g, f)), ...list.flatMap((a) => rowsOf(g, a, name))];
  return [line, ...[...kids.flatMap((f) => openIn(g, f.id)), ...list.filter((a) => inPane(g, a))].map((a) => agentRow(g, a, groupOf(g, a)))];
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
const folderSays = (f, t) => `${f.name}: ${plural(t.open, "actor")} open${t.saved ? `, ${t.saved} saved` : ""}${t.closed ? `, ${t.closed} closed` : ""}`
  + " (its folders' too)";
// A folder's line: a button opening or folding it -- its caret, its name -- and at its right how many of the actors it
// holds open (its folders' too) wait on the reader, stopped on an error, run, are idle (a click there too opens or
// folds it). Hovered or in focus, its buttons over those counts: "+ actor" and "+ ⋯", started in it (startButtons), a
// folder made in it, it renamed (F2), it deleted (its bin), it closed (its ×: closeFolder). A closed one (shownClosed),
// greyed, says how many actors it holds, its buttons: rename, delete, reopen. Dragged: put in another folder, or onto its
// gatherer's row, at its top; actors dropped on it are put in it (a closed one reopened), and it opens when one is held
// over it.
function folderLine(g, f) {
  const open = isOpenFolder(g.name, f.id), t = folderTally(g, f.id), edit = state.folderEdit, closed = shownClosed(g, f);
  if (edit && edit.g === g.name && edit.id === f.id)
    return el("div", { class: "folder-line editing", "data-key": `${g.name}/folder:${f.id}` }, folderBox());
  const toggle = () => toggleFolder(g.name, f.id), held = t.open + t.saved + t.closed;
  const acts = closed ? [
    folderAct("rename", `Rename ${f.name} (F2)`, strokeIcon(ICONS.pencil, 13), () => startFolderEdit(g.name, f.id)),
    folderAct("delete", `Delete ${f.name}: what is in it moves up a level`, strokeIcon(ICONS.bin, 14), () => deleteFolder(g.name, f.id)),
    folderAct("reopen", `Reopen ${f.name}: back with the open folders, its actors still closed`, strokeIcon(ICONS.folderOpen, 14), () => reopenFolder(g.name, f.id)),
  ] : [...startButtons(g, f),
    folderAct("new", `New folder in ${f.name}`, strokeIcon(ICONS.folderNew, 14), () => startFolderEdit(g.name, null, f.id)),
    folderAct("rename", `Rename ${f.name} (F2)`, strokeIcon(ICONS.pencil, 13), () => startFolderEdit(g.name, f.id)),
    folderAct("delete", `Delete ${f.name}: what is in it moves up a level`, strokeIcon(ICONS.bin, 14), () => deleteFolder(g.name, f.id)),
    folderAct("close", `Close ${f.name}: every actor in it closed, and it put in the closed line`, closeIcon(), () => pressClose(g, f, "list"))];
  const line = el("div", { class: "folder-line" + (closed ? " closed" : ""), "data-key": `${g.name}/folder:${f.id}`, "data-card": key(g.name, `folder:${f.id}`) },
    el("button", { class: "fbtn", type: "button", "aria-expanded": open ? "true" : "false",
      ...(HOVERS.matches ? {} : { title: closed ? `${f.name}: closed, ${plural(held, "actor")} in it` : folderSays(f, t) }), onclick: toggle,
      onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startFolderEdit(g.name, f.id); } } },
      el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "fname", text: f.name })),
    el("span", { class: "fill", onclick: toggle },
      ...(closed ? [held ? el("span", { class: "count closed", title: `${plural(held, "actor")} in it, closed` }, el("i", { "aria-hidden": "true" }), String(held)) : null]
        : tallyChips(t, plural(t.open, "actor"), true)),
      SNAPSHOT ? null : el("span", { class: "f-acts", onclick: (ev) => ev.stopPropagation() }, ...acts)));
  return dropOn(dragFolder(line, g, f), g, f.id, () => { if (!isOpenFolder(g.name, f.id)) toggle(); });
}
// CLOSING a folder (its ×, on its line or its card): at once, if all in it is closed already, none saved, no terminal in
// it; else first the question under it (`folderClosing`: {g, id, from: "list" | "card"}) -- what closing it would close,
// end, take off -- with "Close folder" and Cancel (Esc). Its buttons keep their focus through the list's redraws
// (askRefocus).
let folderClosing = null;
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
  const parts = [w.open ? `closes ${plural(w.open, "actor")}${w.busy ? ` (${w.busy} mid-turn: cut off)` : ""}` : null,
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
    el("p", {}, el("b", { text: `Close ${f.name}?` }), ` This ${said}. Everything in it becomes closed, and it moves into ${where}'s closed line.`),
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
  const kept = { ...((state.home.saved || {})[g.name] || {}) };
  for (const a of actorsWithin(g, f.id)) { const k = savedAs(g.name, a); if (k) delete kept[k]; }
  for (const [c, at] of Object.entries(tree.filed)) if (ids.has(at)) delete kept[c];
  state.home.saved = { ...(state.home.saved || {}), [g.name]: kept };
  state.home.shells = (state.home.shells || []).filter((s) => !(s.gatherer === g.name && ids.has(s.folder)));
  const asked = homesTaken, at = new Date().toISOString();
  const got = await folderPost(g.name, { do: "close", id: f.id }, (t) => { for (const x of t.folders) if (ids.has(x.id)) x.closed = at; });
  if (!got) return;
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
  state.folderEdit = { g: gname, id, parent: f ? parentOf(gname, f) : parent, value: f ? f.name : "" };
  folderInput = null;
  if (collapsed.has(gname)) {
    collapsed.delete(gname);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch (e) { /* kept for this page only */ }
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
  if (!keep || !nameFolder(f.g, f.id, f.parent, f.value)) renderAgents();
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
    setLive(other ? `There is a folder "${other.name}" there already` : 'A folder\'s name can\'t hold "/"');
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
}
// what is dragged, shown so -- again after the list, or the rail, is drawn mid-drag (the rail's by their data-card, its
// \u0000 one CSS.escape cannot write)
function markDragged() {
  if (!listDrag) return;
  const keys = listDrag.cs ? listDrag.cs.map((c) => `${listDrag.g}/${c}`) : listDrag.gs ? listDrag.gs   // a gatherer: its row's
    : [`${listDrag.g}/folder:${listDrag.folder}`];
  for (const k of keys) for (const n of document.querySelectorAll(`#agents [data-key="${CSS.escape(k)}"]`)) n.classList.add("dragging");
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
const withTasks = (g, cs) => [...new Set(cs.flatMap((c) => ((t) => t === null ? [c] : taskItems(g, t))(itemTaskOf(g, c))))];
// the folder an item is in (null: its gatherer's top)
const itemFolder = (g, c) => isAppItem(c) ? appFolder(g.name, c.slice(APP_ITEM.length)) : ((a) => a ? folderOf(g.name, a) : null)(actorOf(g, c));
// Items put in folder `id` (null: their gatherer's top): actors as fileActors has them, apps by their item
function fileItems(gname, items, id) {
  const g = state.home.gatherers.find((x) => x.name === gname);
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
// and one of them at least not in its task yet
function canJoin(g, k) {
  const d = listDrag;
  if (!d || d.g !== g.name || !d.cs || d.cs.includes(k)) return false;
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
  for (const n of document.querySelectorAll(":is(#agents, #rail) :is(.dragging, .drop-on)")) n.classList.remove("dragging", "drop-on");
  if (d.later || d.revealed) renderAgents();         // the rail, its folders shown for the drag: as it was again
}
document.addEventListener("dragover", () => { if (listDrag) listDrag.seen = Date.now(); }, true);
document.addEventListener("drop", () => { if (listDrag) setTimeout(endDrag, 0); }, true);   // anywhere: after the line's own
// Whether what is dragged may go into folder `id` (null: the gatherer's top): of that gatherer; a folder, not into
// itself nor one of its own, nor where it is; actors, one of them at least not there yet. A gatherer (`gs`) only into a
// folder of gatherers (`g` GFS), or the list's top: not where it is.
function canDrop(g, id) {
  const d = listDrag;
  if (!d || d.g !== g.name) return false;
  if (d.folder !== null) {
    const f = folderById(g.name, d.folder);
    return !!f && parentOf(g.name, f) !== id && !(id !== null && within(g.name, id, d.folder));
  }
  if (d.gs) return d.gs.some((name) => gfOf(name) !== id);
  return withTasks(g, d.cs).some((c) => (isAppItem(c) || !!actorOf(g, c)) && itemFolder(g, c) !== id);
}
// `id`: the folder what is dropped on `n` goes into (null: the gatherer's top); `open`, what opens when one is held over it
function dropOn(n, g, id, open) {
  if (SNAPSHOT) return n;
  n.addEventListener("dragenter", (ev) => {
    if (!canDrop(g, id)) return;
    ev.preventDefault();
    n.classList.add("drop-on");
    clearTimeout(listDrag.spring);
    listDrag.spring = setTimeout(() => {
      if (!listDrag || listDrag.g !== g.name) return;
      listDrag.force = true;
      try { open(); } finally { if (listDrag) listDrag.force = false; }
    }, DROP_OPEN_MS);
  });
  n.addEventListener("dragover", (ev) => { if (canDrop(g, id)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; } });
  n.addEventListener("dragleave", (ev) => {
    if (n.contains(ev.relatedTarget)) return;
    n.classList.remove("drop-on");
    if (listDrag) clearTimeout(listDrag.spring);
  });
  n.addEventListener("drop", (ev) => {
    if (!canDrop(g, id)) return;
    ev.preventDefault();
    const d = listDrag, now = state.home.gatherers.find((x) => x.name === g.name) || g;
    d.later = false;                                 // drawn by the move, next
    endDrag();
    if (d.folder !== null) { moveFolder(g.name, d.folder, id); return; }
    if (d.gs) { gPicks.clear(); fileGatherers(d.gs.filter((name) => gfOf(name) !== id), id); return; }
    const items = withTasks(now, d.cs).filter((c) => (isAppItem(c) || !!actorOf(now, c)) && itemFolder(now, c) !== id);
    if (d.cs.length > 1) clearPicks(false);
    fileItems(g.name, items, id);
  });
  return n;
}
// A shell's row (isShell): where it was opened, and when; its close button closes its terminal, as a window's does.
const SHELLS = "Terminals";
function shellRow(g, s) {
  const current = isAt(focusedActor(), g.name, s.id);
  const open = !current && openActors().some((sel) => isAt(sel, g.name, s.id));
  const where = shellPath(s), close = (ev) => { ev.stopPropagation(); closeShell(s); };
  return el("button", { class: "agent shell", type: "button", "aria-current": current ? "true" : "false", "data-key": `${g.name}/${s.id}`,
    "data-group": SHELLS, ...(open ? { "data-open": "true" } : {}),
    title: `Terminal · ${s.cwd}${SNAPSHOT ? "" : `\n${BESIDE_KEY}+click: open beside the one shown`}`,
    onclick: (ev) => pick(g.name, s.id, ev), oncontextmenu: (ev) => pickBeside(g.name, s.id, ev) },
    shellLogo(),
    el("div", {},
      el("div", { class: "name", text: where.split("/").filter(Boolean).pop() || where }),
      el("div", { class: "asked", text: where }),
      el("div", { class: "meta" }, el("span", { text: `Terminal · opened ${ago(s.since)}` }),
        rowActs(el("span", { class: "close-btn", role: "button", tabindex: "0", title: "Terminate: end the shell, and whatever runs in it",
          "aria-label": "Terminate the terminal", onclick: close,
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); close(ev); } } }, closeIcon())))));
}
const shellLogo = () => el("span", { class: "logo shell-logo", "aria-hidden": "true" }, strokeIcon(ICONS.terminal, 18));
async function closeShell(s) {
  try { await post("/api/shells/close", { id: s.id }); }
  catch (err) { setLive(`Not closed: ${err.message}`); }
}
// The group an actor is listed under: those waiting on the user first, then those stopped on an error, then saved for later
// (closed, saved by the reader: one saved but still open is listed by its status), then running, then those whose turn is over but something they started still runs,
// then finished (not yet looked at), then idle, then closed; in the list, each in the order the data has them, newest created
// first, so an actor stays in its place, and moves only between them -- but closed, the latest active first: nothing moves
// there once closed
const GROUPS = ["Waiting for you", "Error", "Saved", "Running", "Background", "Finished", "Idle", "Closed"];
const BY_STATUS = { "Waiting for you": "Waiting for you", Error: "Error", Failed: "Error", Building: "Running", Running: "Running",
  Starting: "Running", Background: "Background", Finished: "Finished", Closed: "Closed" };
function groupOf(g, a) {
  const by = BY_STATUS[statusOf(a)[1]] || "Idle";
  return by === "Closed" && savedAs(g.name, a) ? "Saved" : by;
}
// each group's mark, as the list marks its actors
const GROUP_CLS = { "Waiting for you": "asking", Error: "error", Running: "running", Background: "background", Finished: "finished",
  Idle: "idle", Closed: "closed" };
const groupMark = (name) => name === "Saved" ? saveIcon(true) : el("span", { class: `status ${GROUP_CLS[name]}`, "aria-hidden": "true" },
  el("i", { style: `--spin-at: -${Date.now() % 1200}ms` }));

