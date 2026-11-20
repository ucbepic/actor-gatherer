// A session the page started or keeps (sessions.py's), as every view reads it: what its agent is doing, said before
// what data.py decided of the actor, and whether the page can close it.

interface SessionLike {
  status?: string;
  queued?: unknown[] | null;
  terminal?: unknown;
  pid?: number | null;
  kept?: unknown;
  turns?: number;
}

/** A session started from the page says first what its agent is doing: starting, a message waiting, failed; null: none
 * of those (or no session), what data.py decided then. [its class, its word]. */
export const sessionStatus = (s: SessionLike | null | undefined): readonly [string, string] | null =>
  !s
    ? null
    : s.status === "starting"
      ? ["building", "Starting"]
      : s.status === "running" || (s.queued && s.queued.length)
        ? ["running", "Running"]
        : s.status === "failed"
          ? ["failed", "Failed"]
          : null;

/** Whether the dashboard runs a process for the session -- its agent, mid-turn or not, or its terminal -- or kept it,
 * idle, from a restart, or it ran and is listed open with no process now (used since it ended: an app's note to it,
 * say), and no process outside has it: it can be closed from the list. Never in a snapshot (`snapshot`). */
export const closable = (
  a: { session?: SessionLike | null; status?: string; chattable?: boolean },
  snapshot: boolean,
): boolean =>
  !snapshot &&
  !!a.session &&
  !!(a.session.terminal || a.session.pid || a.session.kept || (a.session.turns && a.status !== "closed")) &&
  a.chattable !== false;
