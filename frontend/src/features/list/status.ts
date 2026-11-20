// AN ITEM'S STATUS, as the list says it: an actor's (statusOf), worked out by the server from what was recorded of it
// (data.py's status_of), what the page started (core/model/session.ts) and what the reader has seen of it (seen.js); an
// app's from the notifications its app sent and the reader has not seen (appStatusOf). Each said as [its class, its
// word]; an actor's then put in a GROUP of the list (groupOf), as the counts, a task's lead and the monitor's columns
// rank them.
import { closable, sessionStatus } from "../../core/model/session";
import { appItem, key } from "../../core/model/keys";
import type { Actor, Gatherer, ListCtx, Status } from "./types";

/** An actor that has stopped with activity since the reader last looked at it: finished, not yet seen. */
export const unseen = (ctx: ListCtx, a: Actor): boolean => !!a.key && !!a.last && a.last > (ctx.seenAt[a.key] || 0);

/** What the page started says first (starting, a message waiting, failed); then the selected actor's harness opening a
 * turn before ag stored it; then what data.py decided: waiting for the reader, an error, a build, running, something
 * in the background, finished (not yet seen), closed, idle. */
export const statusOf = (ctx: ListCtx, a: Actor): Status =>
  sessionStatus(a.session) ||
  (ctx.opened(a)
    ? ["running", "Running"]
    : a.status === "asking"
      ? ["asking", "Waiting for you"]
      : a.status === "error"
        ? ["error", "Error"]
        : a.building
          ? ["building", "Building"]
          : (a.status ? a.status === "running" : a.running)
            ? ["running", "Running"]
            : a.status === "background"
              ? ["background", "Background"]
              : unseen(ctx, a)
                ? ["finished", "Finished"]
                : a.status === "closed"
                  ? ["closed", "Closed"]
                  : ["idle", "Idle"]);

/** A session made here that never started -- no process of it now, none starting, nothing of it in its gatherer (no
 * events, no calls): its × discards it (sessions.py's `discard`). */
export const discardable = (ctx: ListCtx, a: Actor): boolean =>
  !ctx.snapshot &&
  !!a.session &&
  !a.events &&
  !a.reads &&
  !closable(a, ctx.snapshot) &&
  a.chattable !== false &&
  !["starting", "running", "idle", "terminal"].includes(a.session.status || "") &&
  !(a.session.queued || []).length &&
  !ctx.opened(a);

/** What an actor's × does: its process closed, it discarded (one that never started), or nothing. */
export const closeHow = (ctx: ListCtx, a: Actor): "close" | "discard" | null =>
  closable(a, ctx.snapshot) ? "close" : discardable(ctx, a) ? "discard" : null;

export const isCoordinator = (a: Actor | null | undefined): boolean => !!a && a.role === "coordinator";

/** The channel the actor was saved as (saved.py's `home.saved`: its own, or the one it was started under); null: not
 * saved. */
export function savedAs(ctx: ListCtx, gname: string, a: Actor): string | null {
  const kept = (ctx.home.saved || {})[gname] || {};
  return a.channel in kept
    ? a.channel
    : a.session && a.session.started_as && a.session.started_as in kept
      ? a.session.started_as
      : null;
}

/** The groups an actor is listed under, in order: those waiting on the reader, stopped on an error, saved for later
 * (closed, saved: one saved but still open is listed by its status), running, their turn over but something they
 * started still running, finished (not yet looked at), idle, closed. */
export const GROUPS = [
  "Waiting for you",
  "Error",
  "Saved",
  "Running",
  "Background",
  "Finished",
  "Idle",
  "Closed",
] as const;
export type Group = (typeof GROUPS)[number];
const BY_STATUS: Record<string, Group> = {
  "Waiting for you": "Waiting for you",
  Error: "Error",
  Failed: "Error",
  Building: "Running",
  Running: "Running",
  Starting: "Running",
  Background: "Background",
  Finished: "Finished",
  Closed: "Closed",
};
export function groupOf(ctx: ListCtx, g: Gatherer, a: Actor): Group {
  const by = BY_STATUS[statusOf(ctx, a)[1]] || "Idle";
  return by === "Closed" && savedAs(ctx, g.name, a) ? "Saved" : by;
}
/** Neither saved nor closed: open. */
export const isOpen = (group: Group): boolean => group !== "Saved" && group !== "Closed";
/** Each group's mark, as the list marks its actors. */
export const GROUP_CLS: Partial<Record<Group, string>> = {
  "Waiting for you": "asking",
  Error: "error",
  Running: "running",
  Background: "background",
  Finished: "finished",
  Idle: "idle",
  Closed: "closed",
};
/** How pressing each group is, where an item of it leads (a task's lead, its row's state): the one waiting on the reader
 * first; closed and saved, never (9). */
export const LEAD_RANK: Readonly<Record<string, number>> = {
  "Waiting for you": 0,
  Error: 1,
  Notification: 2,
  Running: 3,
  Background: 4,
  Finished: 5,
  Idle: 6,
};
export const rankOf = (ctx: ListCtx, g: Gatherer, a: Actor): number => LEAD_RANK[groupOf(ctx, g, a)] ?? 9;

/** An app with a notification since the reader last looked: NOTIFIED, as an actor done since is finished. */
export const NOTIFIED: Status = ["notified", "Notification"];
const gathererNamed = (ctx: ListCtx, name: string): Gatherer | null =>
  ctx.home.gatherers.find((x) => x.name === name) || null;
/** An app's key, as the page keeps what the reader saw of it. */
export const appKey = (gname: string, id: string): string => key(gname, appItem(id));
/** An app instance's notifications open, newest first: none, []. */
export function appNotices(ctx: ListCtx, gname: string, id: string) {
  const got = (gathererNamed(ctx, gname)?.apps || {})[id];
  return got ? [...(got.notices || [])].reverse() : [];
}
/** An app instance's status: notified, or none (null). */
export function appStatusOf(ctx: ListCtx, gname: string, id: string): Status | null {
  const got = (gathererNamed(ctx, gname)?.apps || {})[id];
  return got && got.last && got.last > (ctx.seenAt[appKey(gname, id)] || 0) ? NOTIFIED : null;
}
