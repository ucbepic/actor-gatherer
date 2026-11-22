// What a change of the folders does to a tree (folders.py's, gatherer_folders.py's), as the page makes it at once before
// the server answers (folders.ts's folderPost), and the words and names it checks first -- apart from the page.
import { plural } from "../../core/format";
import type { Folder, Tree } from "./types";

/** A folder's name: as long as the server keeps (folders.py). */
export const FOLDER_CHARS = 60;

/** A closed folder something is put in (or made in) open again, and the closed folders it is in (folders.py's
 * `_opened`). */
export function openUp(tree: Tree, id: number | null): void {
  for (let f = tree.folders.find((x) => x.id === id), n = 0; f && n < 500; n++) {
    f.closed = null;
    const up = f.parent;
    f = tree.folders.find((x) => x.id === up);
  }
}
/** Items filed in folder `id` (null: the top): each by its channel, or an app by its item. */
export function fileInto(tree: Tree, items: string[], id: number | null): void {
  for (const c of items) {
    if (id === null) delete tree.filed[c];
    else tree.filed[c] = id;
  }
}
export function renameIn(tree: Tree, id: number, to: string): void {
  const f = tree.folders.find((x) => x.id === id);
  if (f) f.name = to;
}
/** Folder `id` moved into `parent` (null: the top), opened if it was closed. */
export function moveIn(tree: Tree, id: number, parent: number | null): void {
  const f = tree.folders.find((x) => x.id === id);
  if (f) f.parent = parent;
  openUp(tree, parent);
}
/** Folder `id` deleted: what was in it -- its items, its folders -- moved up into the one it was in. */
export function deleteFrom(tree: Tree, id: number): void {
  const f = tree.folders.find((x) => x.id === id);
  if (!f) return;
  const up = tree.folders.some((x) => x.id === f.parent) ? f.parent : null;
  for (const x of tree.folders) if (x.parent === id) x.parent = up;
  for (const [c, at] of Object.entries(tree.filed))
    if (at === id) {
      if (up === null) delete tree.filed[c];
      else tree.filed[c] = up;
    }
  tree.folders = tree.folders.filter((x) => x.id !== id);
}
/** The folders `ids` closed at `at` (an ISO time), or open again (null). */
export function closeIn(tree: Tree, ids: ReadonlySet<number>, at: string | null): void {
  for (const x of tree.folders) if (ids.has(x.id)) x.closed = at;
}

/** A name for a new folder among `beside` none of them has, whatever its case: `base`, else `base 2`, ... */
export function freeName(beside: Folder[], base: string): string {
  const taken = new Set(beside.map((f) => f.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}
/** A name as typed, as it is kept: its spaces one each, trimmed, at most `max` long. */
export const tidyName = (text: unknown, max: number): string =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
/** Why a folder (or a group: `what`) can't be named `text` beside `others` (their names): one has it, whatever its
 * case, or it has a "/"; null: it can. */
export function nameRefused(text: string, others: string[], what = "folder"): string | null {
  const other = others.find((x) => x.toLowerCase() === text.toLowerCase());
  if (other !== undefined) return `A ${what} named "${other}" is already there`;
  if (text.includes("/")) return `${what === "folder" ? "Folder" : "Group"} names can't contain "/"`;
  return null;
}

/** What closing a folder would do: its actors open, those at work, its bookmarks, its terminals. */
export interface CloseWhat {
  open: number;
  busy: number;
  marks: number;
  shells: number;
}
/** What a folder's × asks first: what closing it does, in words ("closes 2 actors (stopping 1 mid-turn) and ends a
 * terminal"). */
export function closeSays(w: CloseWhat): string {
  const parts = [
    w.open ? `closes ${plural(w.open, "actor")}${w.busy ? ` (stopping ${w.busy} mid-turn)` : ""}` : null,
    w.shells ? `ends ${plural(w.shells, "terminal")}` : null,
    w.marks ? `removes ${plural(w.marks, "bookmark")}` : null,
  ].filter((x): x is string => !!x);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] || "closes it";
}
