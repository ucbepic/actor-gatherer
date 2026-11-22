// FOLDERS OF GATHERERS (gatherer_folders.py, `home.gatherer_folders`: {folders: [{id, parent, name}], filed: {gatherer:
// folder id}}), kept by the server so every dashboard on this home shows the same: above the gatherers, only to organise
// the list. None kept: the list as without them, every gatherer at its top. One holds gatherers and folders of gatherers
// and nothing else: no actor is started in one, none is counted on its line -- its buttons, on hover: a folder in it,
// rename (F2), delete (what is in it moves up a level). A folder made outside every group -- from the list's head (its
// folder button), or in one of these -- is a GROUP of its own (groups.py's `make`, nameGroup), as the default rule has
// it: the list shows folders, and says nothing of groups (who shares with whom is set in Manage groups, manage.ts).
// These are made no more from the list; those kept still hold groups. A gatherer put in one by dragging its row onto
// its line (dragGatherer), or onto the list's head for the top; a folder of them dragged so too. A gatherer dragged onto
// another is merged into it, as a folder of it (group-moves.ts's askMerge). The list's folder code draws and changes
// them, as a gatherer's folders: their gatherer GF, a name no gatherer has (each a directory's name: no "/") -- treeOf,
// folderPost, makeFolder, startFolderEdit, ... -- and GFS where a gatherer is asked for. Each open till the reader
// folds it (gfFolded, kept in this browser); folded, nothing of it is in view, not even an actor open in a pane. The
// rail shows them so too, to fold and open only.
import type { MouseEvent } from "react";
import { post } from "../../core/api/client";
import * as prefs from "../../core/prefs";
import { GFS } from "./Boxes";
import { FOLDER_CHARS, nameRefused, tidyName } from "./folder-edits";
import { folderPost, showFolder } from "./folders";
import * as LG from "./groups";
import { L, S } from "./link";
import { CTX, renderAgents, titleOf } from "./list";
import { GF } from "./tree";
import type { Gatherer } from "./types";

export { GF, GFS };
export const GF_NEW = "New folder";
const GF_FOLDED_KEY = "ag-dashboard-gatherer-folders-folded";
export const gfFolded = new Set((prefs.list(GF_FOLDED_KEY) as number[] | null) || []);
export function gfShow(id: number, open: boolean): void {
  if (open) gfFolded.delete(id);
  else gfFolded.add(id);
  prefs.keep(GF_FOLDED_KEY, [...gfFolded]);
}
// The folder the gatherer named `name` is kept in: its id, or null for the list's top (its folder deleted since: the top)
export const gfOf = (name: string): number | null => LG.gfOf(CTX, name);
// Gatherers put in folder `id` (null: the list's top), by name: it opened
export function fileGatherers(names: string[], id: number | null): ReturnType<typeof folderPost> | null {
  if (!names.length) return null;
  showFolder(GF, id, true);
  return folderPost(GF, { do: "file", gatherers: names, folder: id }, (tree) => {
    for (const n of names) {
      if (id === null) delete tree.filed[n];
      else tree.filed[n] = id;
    }
  });
}
// Gatherers selected (⌘+click on a Mac, else Ctrl+click: either key, as for an actor opened beside, rather than one
// guessed from the platform the browser names) to drag into a folder at once; Esc, or a drop, clears it
export const gPicks = new Set<string>();
function clearGPicks() {
  if (gPicks.size) {
    gPicks.clear();
    renderAgents();
  }
}
// A gatherer's row, made to drag into a folder of gatherers, once there is one, or into another gatherer, in the home's
// one database -- not while its name is typed (Boxes.tsx's GathererBox: the list's model says whether it can be; its
// click captured, before its name's button folds it)
export function pickGatherer(ev: MouseEvent, g: Gatherer): boolean {
  if (!(ev.metaKey || ev.ctrlKey) || (ev.target as Element).closest(".g-acts")) return false;
  ev.preventDefault();
  ev.stopPropagation();
  if (!gPicks.delete(g.name)) gPicks.add(g.name);
  renderAgents();
  return true;
}
// The new folder outside every group named `text`, in folder of groups `parent` (null: the list's top): a group of its
// own (groups.py's `make`). None typed is nothing done; a name a group beside it has (whatever its case), or one with
// "/", refused, and said why. -> whether something was done.
export function nameGroup(parent: number | null, value: string): boolean {
  const text = tidyName(value, FOLDER_CHARS);
  if (!text) return false;
  const beside = S()
    .home!.gatherers.filter((g) => !g.alone && gfOf(g.name) === parent)
    .map((g) => titleOf(g));
  const refused = nameRefused(text, beside, "group");
  if (refused) {
    L.data.setLive(refused);
    return false;
  }
  void makeGroup(text, parent);
  return true;
}
let gfMaking: { text: string; parent: number | null } | null = null;
export const gfMakingNow = (): typeof gfMaking => gfMaking; // (the list's view-model draws it: model.ts)
async function makeGroup(text: string, parent: number | null) {
  if (parent !== null) showFolder(GF, parent, true);
  gfMaking = { text, parent };
  renderAgents();
  try {
    const got = await post<{ made: { title: string } }>("/api/groups", { do: "new", name: text, folder: parent });
    await L.data.loadHome();
    L.data.setLive(`Made the group ${got.made.title}`);
  } catch (err) {
    L.data.setLive(`Not made: ${(err as Error).message}`);
  } finally {
    gfMaking = null;
    renderAgents();
  }
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start(): void {
  document.addEventListener("keydown", (ev) => {
    const t = ev.target as Element | null;
    if (
      ev.key !== "Escape" ||
      !gPicks.size ||
      ev.defaultPrevented ||
      (t && t.closest && t.closest("input, textarea, [contenteditable], .xterm"))
    )
      return;
    clearGPicks();
  });
}
