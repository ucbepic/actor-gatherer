// WHAT A DRAG MAY DO, and what a drop does -- apart from the page (drag.ts runs them): an actor's row, a task's, an app's,
// a folder's line or a gatherer's row dragged within its group (into a folder, or an item's task), into another group (a
// move, asked first in Manage groups), or outside every group; what each takes with it (a task moves whole, an app's
// own agent with its window).
import { appItem } from "../../core/model/keys";
import * as LG from "./groups";
import { isCoordinator } from "./status";
import * as LK from "./tasks";
import { GF } from "./tree";
import * as LT from "./tree";
import type { Actor, Gatherer, ListCtx } from "./types";

const APP_ITEM = "app:";
const isAppItem = (k: string): boolean => k.startsWith(APP_ITEM);

/** What is dragged (drag.ts's listDrag), of its gatherer only: actors and apps (`cs`, by item), gatherers (`gs`), or a
 * folder; `ask`: from Manage groups, a change of group asked first. */
export interface Drag {
  g: string;
  cs: string[] | null;
  gs: string[] | null;
  folder: number | null;
  ask: boolean;
}
/** What the rules read: the list's derivations' context, and the app instance an actor is the own agent of (its role:
 * features/apps/app-actors.js's appRole), if any. */
export interface Rules {
  ctx: ListCtx;
  ownKey(a: Actor): string | null;
}
const named = (r: Rules, name: string): Gatherer | null => LG.gathererNamed(r.ctx, name);

/** What dragging `cs` (items of group `g`) takes (groups.py's `actors`): each one's task, which moves whole, and an app's
 * own agent with its window, the window with its agents, as they are one task. */
export function withOwn(r: Rules, g: Gatherer, cs: string[]): string[] {
  let out = LK.withTasks(r.ctx, g, cs);
  for (;;) {
    const more = new Set(out);
    for (const a of g.agents) {
      const key = r.ownKey(a);
      if (!key) continue;
      if (more.has(appItem(key))) more.add(a.channel);
      else if (more.has(a.channel) && LK.appInfo(r.ctx, g.name, key)) more.add(appItem(key));
    }
    const grown = LK.withTasks(r.ctx, g, [...more]);
    if (grown.length === out.length) return out;
    out = grown;
  }
}
const ownAgentIn = (r: Rules, gname: string, id: string, items: string[]): boolean => {
  const g = named(r, gname);
  return !!g && g.agents.some((a) => items.includes(a.channel) && r.ownKey(a) === id);
};
/** Whether the app item `k` of group `gname` may go to another group with `items`: one with many instances, or a
 * group's only one of its app with its own agent among them (groups.py's `apps`) -- else it stays. */
export function appCanMove(r: Rules, gname: string, k: string, items: string[] = []): boolean {
  const o = LK.appInfo(r.ctx, gname, k.slice(APP_ITEM.length));
  return !!o && (o.app.instances === "many" || ownAgentIn(r, gname, o.id, items));
}
/** Whether folder `id` of group `g` may go: it is there, and every app in it, or in its actors' tasks, may go too. */
export function folderCanMove(r: Rules, g: Gatherer, id: number): boolean {
  if (!LT.folderById(r.ctx, g.name, id)) return false;
  const filed = r.ctx.apps(g.name).filter((o) => {
    const f = LT.appFolder(r.ctx, g.name, o.id);
    return f !== null && LT.within(r.ctx, g.name, f, id);
  });
  const items = withOwn(r, g, [
    ...LT.actorsWithin(r.ctx, g, id).map((a) => a.channel),
    ...filed.map((o) => appItem(o.id)),
  ]);
  return items.every((c) => !isAppItem(c) || appCanMove(r, g.name, c, items));
}

/** Whether what is dragged may go into group `g` from another -- a group, not the list's head (GF) -- asked first. */
export function canCross(r: Rules, d: Drag | null, g: Gatherer): boolean {
  const home = r.ctx.home;
  if (!d || d.g === g.name || !home.merged || d.gs || g.alone || !home.gatherers.some((x) => x.name === g.name))
    return false;
  const from = named(r, d.g);
  if (!from) return false;
  if (d.folder !== null) return folderCanMove(r, from, d.folder);
  const items = withOwn(r, from, d.cs || []);
  return (
    items.length > 0 &&
    items.every((c) => {
      if (isAppItem(c)) return appCanMove(r, from.name, c, items);
      const a = LK.actorOf(from, c);
      return !!a && !isCoordinator(a);
    })
  );
}
/** Whether the group dragged (`gs`: one) may go into group `g`: in the home's one database, neither on its own, not
 * into itself, nor into one inside it, nor where it is. */
export function canMerge(r: Rules, d: Drag | null, g: Gatherer, id: number | null = null): boolean {
  const home = r.ctx.home;
  if (!d || !d.gs || d.gs.length !== 1 || !home.merged || g.name === GF || g.alone || d.gs[0] === g.name) return false;
  const from = named(r, d.gs[0]),
    p = from && LG.placeOf(r.ctx, from.name);
  return (
    !!from &&
    !from.alone &&
    home.gatherers.some((x) => x.name === g.name) &&
    !LG.insideOf(r.ctx, g.name, from.name) &&
    !(p && p.in === g.name && p.folder === id)
  );
}
/** Whether what is dragged may go outside every group: in the home's one database, from a group, a folder whose apps may
 * go with it, or one actor -- not the coordinator agent, and not one of a task with other actors (a task moves whole) --
 * with the apps of its task, and its window if it is an app's own agent, that may go. */
export function canOutside(r: Rules, d: Drag | null): boolean {
  if (!d || !r.ctx.home.merged) return false;
  if (d.gs) return d.gs.length === 1 && !!LG.placeOf(r.ctx, d.gs[0]); // a group inside a folder: back at the top
  const from = named(r, d.g);
  if (!from) return false;
  if (from.alone) return d.folder === null && !!LG.placeOf(r.ctx, from.name); // on its own in a folder: back at the top
  if (d.folder !== null) return folderCanMove(r, from, d.folder);
  const items = withOwn(r, from, d.cs || []),
    actors = items.filter((c) => !isAppItem(c));
  const a = actors.length === 1 ? LK.actorOf(from, actors[0]) : null;
  return !!a && !isCoordinator(a) && items.every((c) => !isAppItem(c) || appCanMove(r, from.name, c, items));
}
/** Whether what is dragged may be put in item `k`'s task (dropped on its row): of its gatherer, items -- not `k`
 * itself, and one of them at least not in its task yet; none of them an app that doesn't join tasks, nor `k` one in no
 * task. */
export function canJoin(r: Rules, d: Drag | null, g: Gatherer, k: string): boolean {
  if (!d || d.g !== g.name || !d.cs || d.cs.includes(k)) return false;
  if ((LK.keptOut(r.ctx, g, k) && LK.itemTaskOf(r.ctx, g, k) === null) || d.cs.some((c) => LK.keptOut(r.ctx, g, c)))
    return false;
  const t = LK.itemTaskOf(r.ctx, g, k);
  return d.cs.some((c) => t === null || LK.itemTaskOf(r.ctx, g, c) !== t);
}
/** Whether what is dragged may go into folder `id` of `g` (null: the gatherer's top): of that gatherer; a folder, not
 * into itself nor one of its own, nor where it is; items, one of them at least not there yet. A gatherer (`gs`) only into
 * a folder of gatherers (`g` GF), or the list's top: not where it is. From another group: as canCross says. */
export function canDrop(r: Rules, d: Drag | null, g: Gatherer, id: number | null): boolean {
  if (!d) return false;
  if (d.gs && g.name !== GF) return canMerge(r, d, g, id); // a group into another: a folder of it, or a group inside it
  if (d.g !== g.name) return canCross(r, d, g);
  if (d.folder !== null) {
    const f = LT.folderById(r.ctx, g.name, d.folder);
    return !!f && LT.parentOf(r.ctx, g.name, f) !== id && !(id !== null && LT.within(r.ctx, g.name, id, d.folder));
  }
  if (d.gs) return d.gs.some((name) => LG.gfOf(r.ctx, name) !== id || !!LG.placeOf(r.ctx, name)); // (inside a group's folder: out of it)
  return LK.withTasks(r.ctx, g, d.cs || []).some(
    (c) => (isAppItem(c) || !!LK.actorOf(g, c)) && LK.itemFolder(r.ctx, g, c) !== id,
  );
}

/** What a drop into folder `id` of `g` does, as drag.ts runs it: a group put in place (its own group kept) or merged into
 * `g`; what is dragged moved to `g` from its group; a folder moved; gatherers filed; items filed. `picks`: the
 * selection it came from let go of. */
export type Drop =
  | { do: "place"; name: string; to: string; id: number | null; picks: "groups" | null }
  | { do: "merge"; name: string; id: number | null; picks: "groups" }
  | { do: "move"; id: number | null }
  | { do: "folder"; folder: number; id: number | null }
  | { do: "gatherers"; names: string[]; id: number | null }
  | { do: "file"; items: string[]; id: number | null; picks: "actors" | null };
export function dropOf(r: Rules, d: Drag, g: Gatherer, id: number | null): Drop {
  const now = named(r, g.name) || g;
  const was = LG.placeOf(r.ctx, d.gs ? d.gs[0] : d.g); // a group, or an actor on its own, already inside `g`: just moved
  if (d.gs && g.name !== GF)
    return was && was.in === g.name
      ? { do: "place", name: d.gs[0], to: g.name, id, picks: "groups" }
      : { do: "merge", name: d.gs[0], id, picks: "groups" };
  if (d.g !== g.name)
    return LG.isAloneName(d.g) && was && was.in === g.name
      ? { do: "place", name: d.g, to: g.name, id, picks: null }
      : { do: "move", id };
  if (d.folder !== null) return { do: "folder", folder: d.folder, id };
  if (d.gs) return { do: "gatherers", names: d.gs.filter((name) => LG.gfOf(r.ctx, name) !== id), id };
  const items = LK.withTasks(r.ctx, now, d.cs || []).filter(
    (c) => (isAppItem(c) || !!LK.actorOf(now, c)) && LK.itemFolder(r.ctx, now, c) !== id,
  );
  return { do: "file", items, id, picks: (d.cs || []).length > 1 ? "actors" : null };
}
/** What a drop outside every group does: a group back at the list's top, a folder made a group of its own, an actor on
 * its own back at the top, or an actor taken out of its group. */
export type OutsideDrop = "place-group" | "split" | "place-alone" | "alone";
export const outsideOf = (d: Drag): OutsideDrop =>
  d.gs ? "place-group" : d.folder !== null ? "split" : LG.isAloneName(d.g) ? "place-alone" : "alone";
