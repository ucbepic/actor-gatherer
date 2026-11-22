// What seen.ts works out of a home, apart from the page: every actor taken as seen, and the newest of each gatherer's tasks.
import type { ListHome, Tasks } from "./types";

/** Every actor of `home` taken as seen: as of `had`, where it has one (by its key); else as it is now (its `last`). */
export function everySeen(home: Pick<ListHome, "gatherers">, had: Record<string, number>): Record<string, number> {
  const at = { ...had };
  for (const g of home.gatherers) for (const a of g.agents) if (a.last && a.key && !at[a.key]) at[a.key] = a.last;
  return at;
}

/** When each gatherer's tasks were last read on the server (its clock). */
export type TasksRead = Map<string, number>;

/** The tasks the page has (`had`) with those just read (`got`, read on the server at `at`) taken in: a gatherer's from
 * `got` unless the page's were read later -- a home read before a change can come after the change's own answer -- and
 * a gatherer none of `got` has, gone (`only`: that gatherer's alone). `read` keeps when each was read. */
export function newerTasks(
  read: TasksRead,
  had: Record<string, Tasks> | undefined,
  got: Record<string, Tasks> | undefined,
  at: number | undefined,
  only: string | null = null,
): Record<string, Tasks> {
  const next = { ...(had || {}) };
  for (const g of only ? [only] : new Set([...Object.keys(next), ...Object.keys(got || {})])) {
    if ((at || 0) < (read.get(g) || 0)) continue;
    read.set(g, at || 0);
    if (got && got[g]) next[g] = got[g];
    else delete next[g];
  }
  return next;
}
