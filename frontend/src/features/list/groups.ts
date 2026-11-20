// GATHERERS, or groups, as the list has them: hidden or not, by the reader's name for each; where each is drawn -- in a
// folder of gatherers (gatherer_folders.py), inside another group's folder (groups.py's `place`), or at the list's top;
// an actor on its own (a group of one); the coordinator agents over the list's nodes; and what each group's actors do,
// counted.
import { appsNotified, byName, folderById, GF, treeOf } from "./tree";
import { groupOf, isCoordinator, savedAs } from "./status";
import type { Actor, Gatherer, ListCtx } from "./types";

// HIDDEN gatherers, kept by the server (hiding.py, `home.hiding`) so every dashboard on this home hides the same ones:
// those the reader hid ("hidden"), and those with nothing for a week (STALE_SECONDS) unless the reader kept them in view
// ("shown") -- nothing: no actor's work (`last`), and no change made to what it holds (`changed`).
export const STALE_SECONDS = 7 * 86400;
export const choiceOf = (ctx: ListCtx, g: Gatherer): string => (ctx.home.hiding || {})[g.name] || "";
/** When it was last active; none: no actor yet, never stale. */
export const lastOf = (g: Gatherer): number | null => (g.last ? Math.max(g.last, g.changed || 0) : null);
export const stale = (ctx: ListCtx, g: Gatherer): boolean =>
  !!lastOf(g) && (ctx.home.now || ctx.now()) - lastOf(g)! > STALE_SECONDS;
/** The groups inactive by now: what the time changes in the list. */
export const staleNames = (ctx: ListCtx): string[] =>
  ctx.home.gatherers.filter((g) => stale(ctx, g)).map((g) => g.name);
/** An actor on its own never: closed, it is in its line at the list's end (aloneShut). */
export const isHidden = (ctx: ListCtx, g: Gatherer): boolean =>
  !g.alone &&
  (choiceOf(ctx, g) === "hidden" ||
    (stale(ctx, g) && choiceOf(ctx, g) !== "shown" && !g.agents.some((a) => savedAs(ctx, g.name, a))));
/** The reader's name for a gatherer (titles.py, `home.titles`), shown in place of its own; an actor on its own's. */
export const titleOf = (ctx: ListCtx, g: Gatherer): string =>
  g.alone ? "On its own" : (ctx.home.titles || {})[g.name] || g.name;
export const gathererNamed = (ctx: ListCtx, name: string): Gatherer | null =>
  ctx.home.gatherers.find((x) => x.name === name) || null;

/** The folder of gatherers the gatherer named `name` is kept in: its id, or null for the list's top. */
export function gfOf(ctx: ListCtx, name: string): number | null {
  const id = treeOf(ctx, GF).filed[name];
  return folderById(ctx, GF, id) ? id : null;
}

// AN ACTOR ON ITS OWN: a group of one (groups.py's `alone`, `self:<channel>`), listed as its row alone.
export const isAloneName = (name: string | null | undefined): boolean => String(name || "").startsWith("self:");
export const aloneActor = (g: Gatherer): Actor | undefined => g.agents.find((x) => !isCoordinator(x));
/** Once closed (saved too), an actor on its own leaves the top of the list for a line at its end. */
export function aloneShut(ctx: ListCtx, g: Gatherer): boolean {
  const a = g.alone && aloneActor(g);
  return !!a && ["Saved", "Closed"].includes(groupOf(ctx, g, a));
}
/** [Saved | Closed, those of `gs` (each aloneShut) in it, the latest first], each with any. */
export function aloneFolds(ctx: ListCtx, gs: Gatherer[]): ["Saved" | "Closed", Gatherer[]][] {
  const latest = (x: Gatherer, y: Gatherer) => (aloneActor(y)!.last || 0) - (aloneActor(x)!.last || 0);
  return (["Saved", "Closed"] as const)
    .map((name): ["Saved" | "Closed", Gatherer[]] => [
      name,
      gs.filter((g) => groupOf(ctx, g, aloneActor(g)!) === name).sort(latest),
    ])
    .filter(([, list]) => list.length);
}

// A COORDINATOR AGENT is over a NODE of the list (coordinators.py): "all" (everything), "groups:<id>" (a folder of
// groups), "group:<name>" (a group) or "folder:<id>" (a folder in a group) -- its `over`, else its group's. One above
// groups is in a group of one of its own, as an actor on its own is (isCrewHome), drawn at its node.
export const crewNode = (g: Gatherer, a: Actor): string => a.over || `group:${g.name}`;
export const isCrewHome = (g: Gatherer): boolean => !!g.alone && g.agents.some(isCoordinator);
/** The coordinator agent over a group itself (none: the group has none). */
export const groupCrew = (g: Gatherer): Actor | null => g.agents.find((a) => isCoordinator(a) && !a.over) || null;
/** [its group, the coordinator agent over `node`], or [null, null]: looked for in `g` first, then every group. */
export function crewAt(ctx: ListCtx, node: string, g: Gatherer | null = null): [Gatherer, Actor] | [null, null] {
  const gs = [g, ...ctx.home.gatherers.filter((x) => x !== g)].filter((x): x is Gatherer => !!x);
  for (const x of gs) {
    const a = x.agents.find((y) => isCoordinator(y) && crewNode(x, y) === node);
    if (a) return [x, a];
  }
  return [null, null];
}
/** What the reader's hiding of a coordinator agent is kept by: a group's, the group's name; any other's, its node. */
export const crewHideKey = (node: string): string => (node.startsWith("group:") ? node.slice("group:".length) : node);
/** A node as the list names it: "everything", a folder of groups' or a folder's name, a group's title. */
export function crewPlace(ctx: ListCtx, node: string, g: Gatherer | null = null): string {
  if (node === "all") return "everything";
  const [kind, id] = [node.slice(0, node.indexOf(":")), node.slice(node.indexOf(":") + 1)];
  if (kind === "group") {
    const x = gathererNamed(ctx, id);
    return x ? titleOf(ctx, x) : id;
  }
  if (kind === "groups") {
    const f = folderById(ctx, GF, +id);
    return f ? f.name : "a folder of groups";
  }
  const f = g ? folderById(ctx, g.name, +id) : null;
  return f ? f.name : "a folder";
}

// GROUPS INSIDE ANOTHER GROUP'S FOLDER (groups.py's `place`; home.places: {group: {in, folder}}): drawn there, its row
// set in as a folder's line is.
const placesOf = (ctx: ListCtx) => ctx.home.places || {};
/** Where the group `name` is drawn: {in, folder} -- a folder of a group drawn (null: its top), that folder gone: its
 * top -- or null, at the list's top: placed nowhere, in a group hidden or gone, or in a ring of groups each inside the
 * next. */
export function placeOf(ctx: ListCtx, name: string): { in: string; folder: number | null } | null {
  const p = placesOf(ctx)[name];
  if (!p || !p.in || !ctx.home.merged) return null;
  const seen = new Set([name]);
  for (let at: string | undefined = p.in; at; at = (placesOf(ctx)[at] || {}).in) {
    if (seen.has(at)) return null;
    seen.add(at);
  }
  const outer = gathererNamed(ctx, p.in);
  if (!outer || outer.alone || isHidden(ctx, outer) || isCrewHome(outer)) return null;
  return {
    in: p.in,
    folder: p.folder !== null && p.folder !== undefined && folderById(ctx, p.in, p.folder) ? p.folder : null,
  };
}
/** Whether group `name` is `outer`, or drawn inside it, at any depth. */
export function insideOf(ctx: ListCtx, name: string, outer: string): boolean {
  for (let at: string | undefined = name, n = 0; at && n < 64; at = placeOf(ctx, at)?.in, n++)
    if (at === outer) return true;
  return false;
}
/** The group a group is drawn inside; null: none. */
export const nestedIn = (ctx: ListCtx, g: Gatherer): Gatherer | null => {
  const p = placeOf(ctx, g.name);
  return p ? gathererNamed(ctx, p.in) : null;
};
/** The groups drawn in folder `id` of group `gname` (null: its top): groups, by their titles, then actors on their own. */
export const placedIn = (ctx: ListCtx, gname: string, id: number | null): Gatherer[] =>
  ctx.home.gatherers
    .filter((x) => {
      if (isHidden(ctx, x) || isCrewHome(x)) return false;
      const p = placeOf(ctx, x.name);
      return !!p && p.in === gname && p.folder === id;
    })
    .sort((x, y) => (x.alone ? 1 : 0) - (y.alone ? 1 : 0) || byName(titleOf(ctx, x), titleOf(ctx, y)));

/** How many of a group's actors wait on the reader, stopped on an error, run; how many of its apps have a notification
 * unseen; how many actors it has. */
export interface Counts {
  of: number;
  asking: number;
  error: number;
  notified: number;
  running: number;
}
export function gathererCounts(ctx: ListCtx, g: Gatherer): Counts {
  const n = (group: string) => g.agents.filter((a) => groupOf(ctx, g, a) === group).length;
  return {
    of: g.agents.length,
    asking: n("Waiting for you"),
    error: n("Error"),
    notified: appsNotified(ctx, g),
    running: n("Running"),
  };
}

/** In the page's top bar: every shown group's actors, counted by what they do -- a coordinator agent counted too, but
 * not idle -- and its apps with a notification unseen. */
export interface Totals {
  asking: number;
  error: number;
  notified: number;
  running: number;
  background: number;
  finished: number;
  idle: number;
}
export function totals(ctx: ListCtx, shown: Gatherer[]): Totals {
  const t = { asking: 0, error: 0, notified: 0, running: 0, background: 0, finished: 0, idle: 0 };
  for (const g of shown)
    for (const a of g.agents) {
      const group = groupOf(ctx, g, a);
      if (group === "Idle" && isCoordinator(a)) continue;
      if (group === "Waiting for you") t.asking++;
      else if (group === "Error") t.error++;
      else if (group === "Running") t.running++;
      else if (group === "Background") t.background++;
      else if (group === "Finished") t.finished++;
      else if (group === "Idle") t.idle++;
    }
  t.notified = shown.reduce((n, g) => n + appsNotified(ctx, g), 0);
  return t;
}
