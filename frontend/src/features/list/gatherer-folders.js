import { state } from "../../core/page/state.js";
import { post } from "../../core/page/helpers.js";
import { loadHome, setLive } from "../page/data.js";
import {
  CTX, FOLDER_CHARS, folderPost, renderAgents, showFolder, titleOf, } from "./list.js";
import * as LG from "./groups";
import * as prefs from "../../core/prefs";

// FOLDERS OF GATHERERS (gatherer_folders.py, `home.gatherer_folders`: {folders: [{id, parent, name}], filed: {gatherer:
// folder id}}), kept by the server so every dashboard on this home shows the same: above the gatherers, only to organise
// the list. None kept: the list as without them, every gatherer at its top. One holds gatherers and folders of gatherers
// and nothing else: no actor is started in one, none is counted on its line -- its buttons, on hover: a folder in it,
// rename (F2), delete (what is in it moves up a level). A folder made outside every group -- from the list's head (its
// folder button), or in one of these -- is a GROUP of its own (groups.py's `make`, nameGroup), as the default rule has
// it: the list shows folders, and says nothing of groups (who shares with whom is set in Manage groups,
// features/list/group-moves.js). These are made no more from the list; those kept still hold groups. A gatherer put in one by dragging its row onto its line
// (dragGatherer), or onto the list's head for the top; a folder of them dragged so too. A gatherer dragged onto another
// is merged into it, as a folder of it (features/list/group-moves.js's askMerge). The list's folder code draws and changes them, as a gatherer's folders: their gatherer GF, a name no gatherer
// has (each a directory's name: no "/") -- treeOf, folderPost, makeFolder, startFolderEdit, ... -- and GFS where a
// gatherer is asked for. Each open till the reader folds it (gfFolded, kept in this browser); folded, nothing of it is in
// view, not even an actor open in a pane. The rail shows them so too (railGfLevel), to fold and open only.
const GF = "/";
const GF_NEW = "New folder";
const GFS = { name: GF, agents: [] };
const GF_FOLDED_KEY = "ag-dashboard-gatherer-folders-folded";
const gfFolded = (() => {
  { const v = prefs.list(GF_FOLDED_KEY); if (v) return new Set(v); }
  return new Set();
})();
function gfShow(id, open) {
  if (open) gfFolded.delete(id); else gfFolded.add(id);
  prefs.keep(GF_FOLDED_KEY, [...gfFolded]);
}
// The folder the gatherer named `name` is kept in: its id, or null for the list's top (its folder deleted since: the top)
const gfOf = (name) => LG.gfOf(CTX, name);
// Gatherers put in folder `id` (null: the list's top), by name: it opened
function fileGatherers(names, id) {
  if (!names.length) return null;
  showFolder(GF, id, true);
  return folderPost(GF, { do: "file", gatherers: names, folder: id }, (tree) => {
    for (const n of names) { if (id === null) delete tree.filed[n]; else tree.filed[n] = id; }
  });
}
// Gatherers selected (⌘+click on a Mac, else Ctrl+click: either key, as for an actor opened beside, rather than one
// guessed from the platform the browser names) to drag into a folder at once; Esc, or a drop, clears it
const gPicks = new Set();
function clearGPicks() { if (gPicks.size) { gPicks.clear(); renderAgents(); } }
// A gatherer's row, made to drag into a folder of gatherers, once there is one, or into another gatherer, in the home's
// one database -- not while its name is typed
// (features/list/Boxes.tsx's GathererBox: the list's model says whether it can be; its click captured, before its name's
// button folds it)
function pickGatherer(ev, g) {
  if (!(ev.metaKey || ev.ctrlKey) || ev.target.closest(".g-acts")) return false;
  ev.preventDefault(); ev.stopPropagation();
  if (!gPicks.delete(g.name)) gPicks.add(g.name);
  renderAgents();
  return true;
}
// The new folder outside every group named `text`, in folder of groups `parent` (null: the list's top): a group of its
// own (groups.py's `make`). None typed is nothing done; a name a group beside it has (whatever its case), or one with
// "/", refused, and said why. -> whether something was done.
function nameGroup(parent, text) {
  text = String(text || "").replace(/\s+/g, " ").trim().slice(0, FOLDER_CHARS);
  if (!text) return false;
  const other = state.home.gatherers.find((g) => !g.alone && gfOf(g.name) === parent && titleOf(g).toLowerCase() === text.toLowerCase());
  if (text.includes("/") || other) {
    setLive(other ? `A group named "${titleOf(other)}" is already there` : 'Group names can\'t contain "/"');
    return false;
  }
  makeGroup(text, parent);
  return true;
}
let gfMaking = null;
const gfMakingNow = () => gfMaking;                // (the list's view-model draws it: features/list/model.ts)
async function makeGroup(text, parent) {
  if (parent !== null) showFolder(GF, parent, true);
  gfMaking = { text, parent };
  renderAgents();
  try {
    const got = await post("/api/groups", { do: "new", name: text, folder: parent });
    await loadHome();
    setLive(`Made the group ${got.made.title}`);
  } catch (err) { setLive(`Not made: ${err.message}`); } finally {
    gfMaking = null;
    renderAgents();
  }
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || !gPicks.size || ev.defaultPrevented || (ev.target.closest && ev.target.closest("input, textarea, [contenteditable], .xterm"))) return;
    clearGPicks();
  });
}
export {
  GF, GFS, GF_NEW, fileGatherers, gPicks, gfFolded, gfMakingNow, gfOf, gfShow, nameGroup, pickGatherer,
};
