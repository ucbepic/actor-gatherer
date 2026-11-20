// FOLDERS (folders.py, `home.folders`: {gatherer: {folders: [{id, parent, name}], filed: {channel: folder id}}}), kept by
// the server so every dashboard on this home shows the same: the list as a tree, each gatherer its top folder. An actor
// is in one folder, or at its gatherer's top (one filed in a folder deleted since: at the top); a folder in another, or
// at the top. Each gatherer's and each folder's BOX lists, in this order: its folders; its actors open, the newest
// first, each staying in its place whatever its status does; its terminals, its saved actors once closed and its other
// closed ones, each folded till opened (boxGroups). A folder CLOSED (folders.py's `close`) is listed in its parent's
// closed line, with its actors (shownClosed). The folders gatherers are kept in (gatherer_folders.py) are a tree too:
// their gatherer GF, a name no gatherer has.
import { plural } from "../../core/format";
import { appItem } from "../../core/model/keys";
import { appStatusOf, groupOf, isCoordinator, isOpen, type Group } from "./status";
import type { Actor, Folder, Gatherer, ListCtx, Shell, Tree } from "./types";

/** The gatherer the folders of gatherers are kept under (gatherer_folders.py): a name no gatherer has. */
export const GF = "/";
/** A name for a person, by name (case aside), then as written. */
export const byName = (x: string, y: string): number =>
  x.localeCompare(y, undefined, { sensitivity: "base" }) || (x < y ? -1 : x > y ? 1 : 0);

export const treeOf = (ctx: ListCtx, gname: string): Tree =>
  (gname === GF ? ctx.home.gatherer_folders : (ctx.home.folders || {})[gname]) || { folders: [], filed: {} };
export const folderById = (ctx: ListCtx, gname: string, id: number | null | undefined): Folder | null =>
  id === null || id === undefined ? null : treeOf(ctx, gname).folders.find((f) => f.id === id) || null;
/** The folder a folder is in: its id, or null for the gatherer's top (one gone: the top). */
export const parentOf = (ctx: ListCtx, gname: string, f: Folder): number | null =>
  folderById(ctx, gname, f.parent) ? f.parent : null;
/** The folders in folder `id` (null: the gatherer's top), as the tree has them. */
export const kidFolders = (ctx: ListCtx, gname: string, id: number | null): Folder[] =>
  treeOf(ctx, gname).folders.filter((f) => parentOf(ctx, gname, f) === id);

/** The channel the actor is filed as (its own, or the one it was started under); null: in none. */
export function filedAs(ctx: ListCtx, gname: string, a: Actor): string | null {
  const filed = treeOf(ctx, gname).filed;
  return a.channel in filed
    ? a.channel
    : a.session && a.session.started_as && a.session.started_as in filed
      ? a.session.started_as
      : null;
}
/** The folder the actor is in: its id, or null for its gatherer's top. */
export function folderOf(ctx: ListCtx, gname: string, a: Actor): number | null {
  const at = filedAs(ctx, gname, a),
    id = at ? treeOf(ctx, gname).filed[at] : null;
  return folderById(ctx, gname, id) ? id : null;
}
/** The folder an app's instance is filed in (by its item); null: its gatherer's top. */
export function appFolder(ctx: ListCtx, gname: string, id: string): number | null {
  const f = treeOf(ctx, gname).filed[appItem(id)];
  return folderById(ctx, gname, f) ? f : null;
}
/** Whether folder `id` is folder `inside`, or in it at any depth. */
export function within(ctx: ListCtx, gname: string, id: number | null, inside: number | null): boolean {
  for (let f = folderById(ctx, gname, id), n = 0; f && n < 500; f = folderById(ctx, gname, f.parent), n++)
    if (f.id === inside) return true;
  return false;
}
/** A folder's path: its name after those of the folders it is in. */
export function folderPath(ctx: ListCtx, gname: string, id: number | null, sep = " / "): string {
  const names: string[] = [],
    seen = new Set<number>();
  for (let f = folderById(ctx, gname, id); f && !seen.has(f.id); f = folderById(ctx, gname, f.parent)) {
    seen.add(f.id);
    names.unshift(f.name);
  }
  return names.join(sep);
}
/** The actors (not a coordinator agent) in folder `id`, or in a folder in it. */
export const actorsWithin = (ctx: ListCtx, g: Gatherer, id: number | null): Actor[] =>
  g.agents.filter((a) => {
    if (isCoordinator(a)) return false;
    const at = folderOf(ctx, g.name, a);
    return at !== null && within(ctx, g.name, at, id);
  });
/** The shells opened in folder `id`, or in a folder in it. */
export const shellsWithin = (ctx: ListCtx, g: Gatherer, id: number | null): Shell[] =>
  (ctx.home.shells || []).filter(
    (s) => s.gatherer === g.name && folderById(ctx, g.name, s.folder) && within(ctx, g.name, s.folder ?? null, id),
  );

/** How many apps of a gatherer (`inside`: in folder `inside`, its folders' too) have a notification the reader has not
 * seen. */
export const appsNotified = (ctx: ListCtx, g: Gatherer, inside?: number | null): number =>
  ctx.apps(g.name).filter((o) => {
    if (!appStatusOf(ctx, g.name, o.id)) return false;
    if (inside === undefined) return true;
    const f = appFolder(ctx, g.name, o.id);
    return f !== null && within(ctx, g.name, f, inside);
  }).length;

/** What a folder holds, its folders' too: how many actors wait on the reader, stopped on an error, run, are idle; how
 * many apps have a notification; how many actors are open, saved (closed), closed. */
export interface Tally {
  asking: number;
  error: number;
  notified: number;
  running: number;
  idle: number;
  open: number;
  saved: number;
  closed: number;
}
export function folderTally(ctx: ListCtx, g: Gatherer, id: number | null): Tally {
  const t = {
    asking: 0,
    error: 0,
    notified: appsNotified(ctx, g, id),
    running: 0,
    idle: 0,
    open: 0,
    saved: 0,
    closed: 0,
  };
  for (const a of actorsWithin(ctx, g, id)) {
    const group = groupOf(ctx, g, a);
    if (group === "Saved") t.saved++;
    else if (group === "Closed") t.closed++;
    else t.open++;
    if (group === "Waiting for you") t.asking++;
    else if (group === "Error") t.error++;
    else if (group === "Running") t.running++;
    else if (group === "Idle") t.idle++;
  }
  return t;
}

/** A CLOSED folder (folders.py's `close`) is listed in its parent's closed line for as long as nothing in it is open
 * again: no terminal opened in it, no actor in it open and used since it was closed (messaged, opened again: active,
 * or its process started, since). */
export function shownClosed(ctx: ListCtx, g: Gatherer, f: Folder | null): boolean {
  if (!f || !f.closed) return false;
  const at = Date.parse(f.closed) / 1000;
  if (shellsWithin(ctx, g, f.id).length) return false;
  return !actorsWithin(ctx, g, f.id).some(
    (a) => isOpen(groupOf(ctx, g, a)) && ((a.last || 0) > at || !!(a.session && (a.session.since || 0) > at)),
  );
}
export const closedKids = (ctx: ListCtx, g: Gatherer, id: number | null): Folder[] =>
  kidFolders(ctx, g.name, id).filter((f) => shownClosed(ctx, g, f));
/** What a box's closed line counts: its own closed actors (`own`), and every actor in its closed folders. */
export const closedCount = (ctx: ListCtx, g: Gatherer, id: number | null, own: number): number =>
  own + closedKids(ctx, g, id).reduce((n, f) => n + actorsWithin(ctx, g, f.id).length, 0);
/** "N closed", or, none but closed folders, "K closed folders". */
export function closedSays(ctx: ListCtx, g: Gatherer, id: number | null, own: number): string {
  const n = closedCount(ctx, g, id, own),
    k = closedKids(ctx, g, id).length;
  return n || !k ? `${n} closed` : plural(k, "closed folder");
}

/** A box's groups: open actors, then its shells, its saved actors once closed, its other closed ones. */
export const OPEN = "Open";
export const SHELLS = "Terminals";
export type BoxGroup =
  readonly [typeof OPEN, Actor[]] | readonly [typeof SHELLS, Shell[]] | readonly ["Saved" | "Closed", Actor[]];
/** A gatherer's or a folder's actors as its box lists them: [group, list] for each that has any -- its actors open, the
 * newest first, whatever their status; then its shells, its saved actors once closed, its other closed ones, the
 * latest active first -- its closed line there too while it holds only closed folders (closedKids). `id`: the folder;
 * null, the gatherer's top. */
export function boxGroups(ctx: ListCtx, g: Gatherer, id: number | null): BoxGroup[] {
  const mine = g.agents.filter((a) => !isCoordinator(a) && folderOf(ctx, g.name, a) === id);
  const groups = new Map(mine.map((a) => [a, groupOf(ctx, g, a)] as [Actor, Group]));
  const latest = (x: Actor, y: Actor) => (y.last || 0) - (x.last || 0);
  const opens = mine.filter((a) => isOpen(groups.get(a)!)).sort((x, y) => (y.created || 0) - (x.created || 0));
  const shells = (ctx.home.shells || []).filter(
    (s) => s.gatherer === g.name && (folderById(ctx, g.name, s.folder) ? s.folder : null) === id,
  );
  const saved = mine.filter((a) => groups.get(a) === "Saved").sort(latest);
  const closed = mine.filter((a) => groups.get(a) === "Closed").sort(latest);
  const out: BoxGroup[] = [];
  if (opens.length) out.push([OPEN, opens]);
  if (shells.length) out.push([SHELLS, shells]);
  if (saved.length) out.push(["Saved", saved]);
  if (closed.length || closedKids(ctx, g, id).length) out.push(["Closed", closed]);
  return out;
}
