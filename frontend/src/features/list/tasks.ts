// TASKS (tasks.py, `home.tasks`: {gatherer: {tasks: [{id, name}], tasked: {item: task id}}}): what the reader works with
// at once -- actors and apps alike, its ITEMS: an actor by its channel, an app's instance by "app:<its id>" -- one row in
// the list, its LEAD's state at its left. An item in none is a task of its own. Within a task every agent is attached to
// every app (task_links.py).
import { firstLine, plural } from "../../core/format";
import { APP, appItem, isApp } from "../../core/model/keys";
import { appStatusOf, groupOf, LEAD_RANK, NOTIFIED, rankOf, statusOf } from "./status";
import { appFolder, filedAs, folderOf } from "./tree";
import type { Actor, AppItem, AppManifest, Gatherer, ListCtx, Status, Task, Tasks } from "./types";

export const tasksOf = (ctx: ListCtx, gname: string): Tasks =>
  (ctx.home.tasks || {})[gname] || { tasks: [], tasked: {} };
/** The channel the actor is in its task as (its own, or the one it was started under); null: none. */
export function taskedAs(ctx: ListCtx, gname: string, a: Actor): string | null {
  const t = tasksOf(ctx, gname).tasked;
  return a.channel in t
    ? a.channel
    : a.session && a.session.started_as && a.session.started_as in t
      ? a.session.started_as
      : null;
}
export const taskById = (ctx: ListCtx, gname: string, id: number | null | undefined): Task | null =>
  tasksOf(ctx, gname).tasks.find((t) => t.id === id) || null;
/** The task an actor is in; null: none (a task of its own). */
export function taskOf(ctx: ListCtx, gname: string, a: Actor): number | null {
  const at = taskedAs(ctx, gname, a),
    id = at ? tasksOf(ctx, gname).tasked[at] : null;
  return taskById(ctx, gname, id) ? id : null;
}
/** The task an app's instance is in; null: none. */
export function appTaskOf(ctx: ListCtx, gname: string, id: string): number | null {
  const t = tasksOf(ctx, gname).tasked[appItem(id)];
  return t !== undefined && taskById(ctx, gname, t) ? t : null;
}
export const actorOf = (g: Gatherer, c: string): Actor | null => g.agents.find((x) => x.channel === c) || null;
/** An open instance of a gatherer's app, by its id; null: none open. */
export const appInfo = (ctx: ListCtx, gname: string, id: string): AppItem | null =>
  ctx.apps(gname).find((o) => o.id === id) || null;
/** The task an item (an actor's channel, or an app's "app:<id>") is in; null: none. */
export function itemTaskOf(ctx: ListCtx, g: Gatherer, k: string): number | null {
  if (isApp(k)) return appTaskOf(ctx, g.name, k.slice(APP.length));
  const a = actorOf(g, k);
  return a ? taskOf(ctx, g.name, a) : null;
}
/** An item as the server keeps it: an actor by the channel it is in its task as, or filed as. */
export function keptAs(ctx: ListCtx, g: Gatherer, k: string): string {
  if (isApp(k)) return k;
  const a = actorOf(g, k);
  return a ? taskedAs(ctx, g.name, a) || filedAs(ctx, g.name, a) || a.channel : k;
}
export const taskMembers = (ctx: ListCtx, g: Gatherer, id: number): Actor[] =>
  g.agents.filter((a) => taskOf(ctx, g.name, a) === id);
/** A task's actors not closed: the one waiting on the reader first, then one stopped on an error, at work, done, the
 * latest used. */
export function taskActors(ctx: ListCtx, g: Gatherer, id: number): Actor[] {
  return taskMembers(ctx, g, id)
    .filter((a) => rankOf(ctx, g, a) < 9)
    .sort((x, y) => rankOf(ctx, g, x) - rankOf(ctx, g, y) || (y.last || 0) - (x.last || 0));
}
/** Its LEAD, whose state its row says: the first of them -- none open, the latest used of all. */
export const taskLead = (ctx: ListCtx, g: Gatherer, id: number): Actor | null =>
  taskActors(ctx, g, id)[0] || taskMembers(ctx, g, id).sort((x, y) => (y.last || 0) - (x.last || 0))[0] || null;
/** A task's apps, as they were opened. */
export const taskApps = (ctx: ListCtx, g: Gatherer, id: number): AppItem[] =>
  ctx.apps(g.name).filter((o) => appTaskOf(ctx, g.name, o.id) === id);
/** Its items: its actors' channels, then its apps' (those open). */
export const taskItems = (ctx: ListCtx, g: Gatherer, id: number): string[] => [
  ...taskMembers(ctx, g, id).map((a) => a.channel),
  ...taskApps(ctx, g, id).map((o) => appItem(o.id)),
];
/** A task's state, as its row says it: its most pressing item's -- its lead actor's, or a notification of one of its
 * apps, where that ranks first -- else, of apps only, "Apps"; nothing in it, closed. */
export function taskStatus(ctx: ListCtx, g: Gatherer, id: number): Status {
  const lead = taskLead(ctx, g, id),
    apps = taskApps(ctx, g, id),
    told = apps.some((o) => appStatusOf(ctx, g.name, o.id));
  if (told && !(lead && (LEAD_RANK[groupOf(ctx, g, lead)] ?? 9) < LEAD_RANK.Notification)) return NOTIFIED;
  return lead ? statusOf(ctx, lead) : apps.length ? ["idle", "Apps"] : ["closed", "Closed"];
}

/** An actor as named: its name, else its last request's first line, else that it has none. */
export const actorTitle = (a: Actor): string =>
  (a.name && a.name.text) || (a.last_user_message ? firstLine(a.last_user_message, 120) : "No message yet");
/** What an app shows, as a name: none when it is only its group's (a group's Notes shows the group's notebook). */
export const appSays = (o: AppItem): string => (o.title && o.title !== o.group ? o.title : "");
/** An app as said: the user's name for it, else its kind and what it shows. */
export const appTitle = (o: AppItem): string => o.name || (appSays(o) ? `${o.app.label} · ${appSays(o)}` : o.app.label);
/** In its row and card: its name, else what it shows, else its kind (its face says the kind). */
export const appShown = (o: AppItem): string => o.name || appSays(o) || o.app.label;
/** A task's name: the reader's, else its lead actor's, else its first app's. */
export function taskName(ctx: ListCtx, g: Gatherer, t: Task): string {
  if (t.name) return t.name;
  const lead = taskLead(ctx, g, t.id),
    o = lead ? null : taskApps(ctx, g, t.id)[0];
  return lead ? actorTitle(lead) : o ? appTitle(o) : "A task";
}
/** What a task holds, in words: "2 actors, 1 app"; nothing, "". */
export function taskWhat(ctx: ListCtx, g: Gatherer, id: number): string {
  const all = taskMembers(ctx, g, id),
    apps = taskApps(ctx, g, id);
  return [all.length ? plural(all.length, "actor") : null, apps.length ? plural(apps.length, "app") : null]
    .filter(Boolean)
    .join(", ");
}

/** An app every agent of its group may use (its manifest's access "group"): in no task, ever. */
export const groupApp = (app: AppManifest | null | undefined): boolean => !!app && app.access === "group";
/** What adding an app to an actor or a task does (app_policy.py, as the user chose it on the Apps page): "join", put in
 * its task; "folder", opened at its directory; "no", not offered. A server older than the choice: a group app's "no",
 * another's "join". */
export const onTask = (app: AppManifest | null | undefined): string =>
  !app ? "no" : app.on_task || (groupApp(app) ? "no" : "join");
/** An item that is an app's instance whose app doesn't join tasks: not put in one by dragging, either way. */
export const keptOut = (ctx: ListCtx, g: Gatherer, k: string): boolean =>
  isApp(k) && onTask(appInfo(ctx, g.name, k.slice(APP.length))?.app) !== "join";

/** What is dragged, with every item of the tasks it is of: what goes into a folder, so no task is split across two. */
export const withTasks = (ctx: ListCtx, g: Gatherer, cs: string[]): string[] => [
  ...new Set(
    cs.flatMap((c) => {
      const t = itemTaskOf(ctx, g, c);
      return t === null ? [c] : taskItems(ctx, g, t);
    }),
  ),
];
/** The folder an item is in (null: its gatherer's top). */
export function itemFolder(ctx: ListCtx, g: Gatherer, c: string): number | null {
  if (isApp(c)) return appFolder(ctx, g.name, c.slice(APP.length));
  const a = actorOf(g, c);
  return a ? folderOf(ctx, g.name, a) : null;
}
