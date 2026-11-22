// FOLDERS (folders.py, `home.folders`: {gatherer: {folders: [{id, parent, name}], filed: {channel: folder id}}}), kept by
// the server so every dashboard on this home shows the same: the list as a tree, each gatherer its top folder -- what
// each box lists, and in which order, is tree.ts's and model.ts's. A folder is folded till opened (kept in this
// browser); folded, its actors open in a pane stay in view under it. Folders only organise the list: what a gatherer's
// actors share of one another's context is the gatherer's, whatever folder each is in. A folder CLOSED (its ×,
// closeFolder: folders.py's `close`) is listed in its parent's closed line, with its actors (shownClosed); deleted (its
// bin), what was in it moves up a level.
import { post } from "../../core/api/client";
import { plural } from "../../core/format";
import * as prefs from "../../core/prefs";
import { GF, gfFolded, gfShow, nameGroup } from "./gatherer-folders";
import * as FE from "./folder-edits";
import { L, S, snap } from "./link";
import { CTX, collapsed, COLLAPSED_KEY, renderAgents, titleOf } from "./list";
import { folderKey } from "./model";
import { homeSince, homesTaken } from "./seen";
import { savedAs } from "./status";
import { actorOf } from "./tasks";
import * as LT from "./tree";
import type { Actor, Folder, Gatherer, Tree } from "./types";

export const FOLDER_CHARS = FE.FOLDER_CHARS;
export const byName = LT.byName;
// `gname` GF: the folders gatherers are kept in (gatherer-folders.ts), their tree as a gatherer's, filed by gatherer
export const treeOf = (gname: string): Tree => LT.treeOf(CTX, gname);
export const folderById = (gname: string, id: number | null | undefined): Folder | null =>
  LT.folderById(CTX, gname, id);
export const parentOf = (gname: string, f: Folder): number | null => LT.parentOf(CTX, gname, f);
export const kidFolders = (gname: string, id: number | null): Folder[] => LT.kidFolders(CTX, gname, id);
export const filedAs = (gname: string, a: Actor): string | null => LT.filedAs(CTX, gname, a);
export const folderOf = (gname: string, a: Actor): number | null => LT.folderOf(CTX, gname, a);
export const within = (gname: string, id: number | null, inside: number | null): boolean =>
  LT.within(CTX, gname, id, inside);
export const actorsWithin = (g: Gatherer, id: number | null): Actor[] => LT.actorsWithin(CTX, g, id);
export const shownClosed = (g: Gatherer, f: Folder | null): boolean => LT.shownClosed(CTX, g, f);
// Each folder open or not (its key: its gatherer, its id), kept in this browser; a folder made, or one an actor is put
// in, opened
const FOLDERS_OPEN_KEY = "ag-dashboard-folders-open";
export const foldersOpen = new Set((prefs.list(FOLDERS_OPEN_KEY) as string[] | null) || []);
export const isOpenFolder = (gname: string, id: number): boolean =>
  gname === GF ? !gfFolded.has(id) : foldersOpen.has(folderKey(gname, id));
export function showFolder(gname: string, id: number | null, open: boolean): void {
  if (id === null) return;
  if (gname === GF) return gfShow(id, open);
  const k = folderKey(gname, id);
  if (open) foldersOpen.add(k);
  else foldersOpen.delete(k);
  prefs.keep(FOLDERS_OPEN_KEY, [...foldersOpen]);
}
export function toggleFolder(gname: string, id: number): void {
  showFolder(gname, id, !isOpenFolder(gname, id));
  renderAgents();
}
// A name for a new folder in `parent` none beside it has: `base`, else `base 2`, ...
export const freeName = (gname: string, parent: number | null, base: string): string =>
  FE.freeName(kidFolders(gname, parent), base);
/** A folder change's answer: the tree (or the gatherers' tree) as kept, and what it made, closed or left open. */
export interface FolderAnswer {
  folders?: Record<string, Tree>;
  gatherer_folders?: Tree;
  made?: number;
  saved?: Record<string, Record<string, string>>;
  left?: { why: string }[];
}
// The page's own copy changed as the server will change it (`change(the gatherer's tree)`), so the list shows it at
// once; the server's answer, or the next home, has the last word (whichever is newer: seen.ts's takeHome). -> the answer,
// or null. The folders gatherers are kept in (GF): their own request, their own field of the home.
export async function folderPost(
  gname: string,
  body: Record<string, unknown>,
  change: ((tree: Tree) => void) | null = null,
): Promise<FolderAnswer | null> {
  const home = S().home!;
  const gf = gname === GF,
    field = gf ? "gatherer_folders" : "folders",
    before = home[field];
  if (change) {
    if (gf) {
      const tree = structuredClone(treeOf(GF));
      change(tree);
      home.gatherer_folders = tree;
    } else {
      const all = structuredClone(home.folders || {});
      change((all[gname] = all[gname] || { folders: [], filed: {} }));
      home.folders = all;
    }
  }
  renderAgents();
  if (snap()) return null; // a snapshot has no server: this page only
  const asked = homesTaken;
  try {
    const got = await post<FolderAnswer>(
      gf ? "/api/gatherer-folders" : "/api/folders",
      gf ? body : { gatherer: gname, ...body },
    );
    if (!homeSince(asked)) (S().home as unknown as Record<string, unknown>)[field] = got[field];
    return got;
  } catch (err) {
    if (!homeSince(asked)) (S().home as unknown as Record<string, unknown>)[field] = before;
    L.data.setLive(`Not done: ${(err as Error).message}`);
    return null;
  } finally {
    L.data.redrawList();
  }
}
export const openUp = FE.openUp;
// Actors put in folder `id` (null: their gatherer's top), by the channels they are filed as (or will be): it opened
export function fileActors(gname: string, actors: Actor[], id: number | null): Promise<FolderAnswer | null> | null {
  const channels = actors.map((a) => filedAs(gname, a) || a.channel);
  if (!channels.length) return null;
  showFolder(gname, id, true);
  return folderPost(gname, { do: "file", channels, folder: id }, (tree) => {
    FE.fileInto(tree, channels, id);
    FE.openUp(tree, id);
  });
}
// Items put in folder `id` (null: their gatherer's top): actors as fileActors has them, apps by their item
export function fileItems(gname: string, items: string[], id: number | null): Promise<FolderAnswer | null> | null {
  const g = S().home!.gatherers.find((x) => x.name === gname);
  if (!g) return null;
  const channels = items
    .map((c) => (c.startsWith("app:") ? c : ((a) => (a ? filedAs(gname, a) || a.channel : null))(actorOf(g, c))))
    .filter((c): c is string => !!c);
  if (!channels.length) return null;
  showFolder(gname, id, true);
  return folderPost(gname, { do: "file", channels, folder: id }, (tree) => {
    FE.fileInto(tree, channels, id);
    FE.openUp(tree, id);
  });
}
// A folder made in `parent` (null: the gatherer's top), opened -- drawn once the server has made it (its id is the
// server's) -> the answer ({made: its id}), or null
export async function makeFolder(gname: string, name: string, parent: number | null): Promise<FolderAnswer | null> {
  showFolder(gname, parent, true);
  const got = await folderPost(gname, { do: "new", name, parent });
  if (got && got.made !== undefined) {
    showFolder(gname, got.made, true);
    renderAgents();
  }
  return got;
}
const renameFolder = (gname: string, id: number, to: string) =>
  folderPost(gname, { do: "rename", id, to }, (tree) => FE.renameIn(tree, id, to));
export function moveFolder(gname: string, id: number, parent: number | null): Promise<FolderAnswer | null> {
  showFolder(gname, parent, true);
  return folderPost(gname, { do: "move", id, parent }, (tree) => FE.moveIn(tree, id, parent));
}
// A folder deleted: what was in it -- its actors, its folders -- moved up into the one it was in
export const deleteFolder = (gname: string, id: number): Promise<FolderAnswer | null> =>
  folderPost(gname, { do: "delete", id }, (tree) => FE.deleteFrom(tree, id));
// Where the next actor started from the list goes: the folder whose "+" was pressed last, or its gatherer's top (null)
// -- set by each start button as it is pressed (startMenu's; cardStartPress in the rail's cards). Once started, the
// actor is filed there (fileStarted), as the server answers with its id; a terminal is opened there (startShell,
// `shellFolder`).
export let startIn: { g: string; folder: number | null } = { g: "", folder: null };
export const aimStart = (gname: string, id: number | null): void => {
  startIn = { g: gname, folder: id };
};
export async function fileStarted(gname: string, id: string): Promise<void> {
  const fid = startIn.g === gname ? startIn.folder : null;
  if (fid === null || !id || !folderById(gname, fid)) return;
  showFolder(gname, fid, true);
  await folderPost(gname, { do: "file", channels: [id], folder: fid }, (tree) => {
    tree.filed[id] = fid;
    FE.openUp(tree, fid);
  });
}
export const shellFolder = (gname: string): number | null =>
  startIn.g === gname && folderById(gname, startIn.folder) ? startIn.folder : null;

// CLOSING a folder (its ×, on its line or its card): at once, if all in it is closed already, none saved, no terminal in
// it; else first the question under it (`folderClosing`: {g, id, from: "list" | "card"}) -- what closing it would close,
// end, take off -- with "Close folder" and Cancel (Esc). Its buttons keep their focus through the list's redraws
// (askRefocus).
export let folderClosing: { g: string; id: number; from: "list" | "card"; focus: string } | null = null;
export const setFolderClosing = (v: typeof folderClosing): void => {
  folderClosing = v;
};
// The question let go of where it was asked (`from`): its card hidden (card.ts's cardHide).
export const dropFolderClosing = (from: "list" | "card"): void => {
  if (folderClosing && folderClosing.from === from) folderClosing = null;
};
function closeWhat(g: Gatherer, f: Folder): FE.CloseWhat {
  const inside = actorsWithin(g, f.id),
    t = LT.folderTally(CTX, g, f.id);
  return {
    open: t.open,
    busy: t.running + t.asking,
    marks: inside.filter((a) => savedAs(CTX, g.name, a)).length,
    shells: LT.shellsWithin(CTX, g, f.id).length,
  };
}
export function pressClose(g: Gatherer, f: Folder, from: "list" | "card", redraw: () => void): void {
  const w = closeWhat(g, f);
  if (!w.open && !w.marks && !w.shells) {
    void closeFolder(g, f);
    return;
  }
  folderClosing = { g: g.name, id: f.id, from, focus: "cancel" };
  redraw();
  askRefocus(true);
}
// what the question says: what closing it does, and where it goes ({said, where}) -- drawn by Parts.tsx's AskClose,
// under the folder's line or in its card
export function closeAskSays(g: Gatherer, f: Folder): { said: string; where: string } {
  const up = parentOf(g.name, f),
    where = up === null ? titleOf(g) : folderById(g.name, up)!.name;
  return { where, said: FE.closeSays(closeWhat(g, f)) };
}
// the question's button that had the focus, given it again once drawn anew (`now`: the question just asked -- Cancel)
export function askRefocus(now = false): void {
  if (!folderClosing) return;
  const lost = !document.activeElement || document.activeElement === document.body;
  if (!now && !lost) return;
  const b = document.querySelector<HTMLElement>(`.f-ask [data-ask="${folderClosing.focus}"]`);
  if (b) b.focus({ preventScroll: true });
}
// Closed (folders.py's `close`, by the server): every actor in it closed, its bookmark off, every terminal in it ended,
// then it and the folders in it marked closed -- shown so at once, the server's answer (and the next home) having the
// last word. Those it could not close said (`left`).
export async function closeFolder(g: Gatherer, f: Folder): Promise<void> {
  const home = S().home!;
  folderClosing = null;
  const tree = treeOf(g.name),
    ids = new Set(tree.folders.filter((x) => within(g.name, x.id, f.id)).map((x) => x.id));
  const was = { saved: home.saved, shells: home.shells };
  const kept = { ...((home.saved || {})[g.name] || {}) };
  for (const a of actorsWithin(g, f.id)) {
    const k = savedAs(CTX, g.name, a);
    if (k) delete kept[k];
  }
  for (const [c, at] of Object.entries(tree.filed)) if (ids.has(at)) delete kept[c];
  home.saved = { ...(home.saved || {}), [g.name]: kept };
  home.shells = (home.shells || []).filter((s) => !(s.gatherer === g.name && ids.has(s.folder as number)));
  const asked = homesTaken,
    at = new Date().toISOString();
  const got = await folderPost(g.name, { do: "close", id: f.id }, (t) => FE.closeIn(t, ids, at));
  if (!got) {
    if (!snap() && !homeSince(asked)) {
      Object.assign(S().home!, was); // (folderPost took its folders back)
      L.data.redrawList();
    }
    return;
  }
  if (got.saved && !homeSince(asked)) {
    S().home!.saved = got.saved;
    L.data.redrawList();
  }
  const left = got.left || [];
  if (left.length)
    L.data.setLive(
      `${f.name} closed, but ${plural(left.length, "actor")} in it ${left.length === 1 ? "stays" : "stay"} open: ${left[0].why}`,
    );
}
// Reopened: it and the folders in it with the open ones again, its actors as they are
export function reopenFolder(gname: string, id: number): Promise<FolderAnswer | null> {
  const ids = new Set(
    treeOf(gname)
      .folders.filter((x) => within(gname, x.id, id))
      .map((x) => x.id),
  );
  showFolder(gname, id, true);
  return folderPost(gname, { do: "reopen", id }, (t) => FE.closeIn(t, ids, null));
}

// Naming a folder, new (`state.folderEdit.id` null, made in its `parent`) or not: a box in its line (the list's,
// Parts.tsx's FolderBox: `folderInput`, opened for `folderFor`); Enter or leaving it keeps what is typed, Esc or nothing
// typed leaves it. A name another folder beside it has (whatever its case), or one with "/", is refused, and said why.
let folderInput: HTMLInputElement | null = null,
  folderFor: unknown = null;
export const folderBox = {
  get input() {
    return folderInput;
  },
  ref(n: HTMLInputElement | null) {
    folderInput = n;
    folderFor = n ? S().folderEdit : null;
  },
  /** the box left with the folder it was opened for still named there */
  ownsEdit: () => !!S().folderEdit && S().folderEdit === folderFor,
  /** gone with its line (folded away): the naming dropped */
  dropIfGone() {
    if (S().folderEdit && !(folderInput && folderInput.isConnected)) {
      S().folderEdit = null;
      folderInput = null;
    }
  },
};
export function startFolderEdit(gname: string, id: number | null = null, parent: number | null = null): void {
  const state = S();
  const f = id === null ? null : folderById(gname, id);
  state.folderEdit = {
    g: gname,
    id,
    parent: f ? parentOf(gname, f) : parent,
    value: f ? f.name : "",
    group: gname === GF && id === null,
  };
  folderInput = null;
  if (collapsed.has(gname)) {
    collapsed.delete(gname);
    prefs.keep(COLLAPSED_KEY, [...collapsed]);
  }
  showFolder(gname, state.folderEdit.parent, true);
  renderAgents();
  if (folderInput) {
    (folderInput as HTMLInputElement).focus();
    (folderInput as HTMLInputElement).select();
  }
}
export function endFolderEdit(keep: boolean): void {
  const state = S(),
    f = state.folderEdit;
  if (!f) return;
  state.folderEdit = null;
  folderInput = null;
  if (!keep || !(f.group ? nameGroup(f.parent, f.value) : nameFolder(f.g, f.id, f.parent, f.value))) renderAgents();
}
// The folder `id` named `text` (`id` null: one made in `parent`), as typed in the list's box or a card's: none typed,
// or the name it has, is nothing done; a name another folder beside it has (whatever its case), or one with "/", is
// refused, and said why. -> whether something was done.
export function nameFolder(gname: string, id: number | null, parent: number | null, value: string): boolean {
  const text = FE.tidyName(value, FOLDER_CHARS);
  const was = id === null ? null : folderById(gname, id);
  if (!text || (was && text === was.name)) return false;
  const others = kidFolders(gname, parent)
    .filter((x) => x.id !== id)
    .map((x) => x.name);
  const refused = FE.nameRefused(text, others);
  if (refused) {
    L.data.setLive(refused);
    return false;
  }
  if (was) void renameFolder(gname, id!, text);
  else void makeFolder(gname, text, parent);
  return true;
}
