// A turn's files and commands (/api/files, files.py's `files`): fetched on demand and kept by the actor and the turn
// (TanStack Query, core/api/query.ts), as the conversation's turns come on the stream (data.ts). The latest turn's are
// fetched again only once the stream's view says the turns moved on since they were (`stampOf`): not at every message
// of the stream -- the home's, every few seconds while anything runs anywhere, the actor's calls -- as they were. An
// earlier turn's, once: it is over. Kept a while after its actor is shown no more, so one shown again is drawn at once.
import { get } from "../../core/api/client";
import { failed, type Failed } from "../../core/api/types";
import { queryClient } from "../../core/api/query";
import { stampOf } from "./data";
import type { FilesData } from "./types";

/** Which files: the actor's, its turn's (null: the latest), with paths read from its directory; an earlier turn's by
 * its row too, so the same index of other turns (one taken back since) is not taken for it. */
export interface FilesOf {
  gatherer: string;
  channel: string;
  turn: number | null;
  row?: number | null;
  cwd: string;
}

export const filesKey = (f: FilesOf) =>
  ["files", f.gatherer, f.channel, f.cwd, f.turn ?? "latest", f.turn === null ? null : (f.row ?? null)] as const;

const idOf = (f: FilesOf) => filesKey(f).join("\u0000");

/** A gatherer with no database yet (none before its first call): no turns. */
const NONE: FilesData = { turns: [], turn: null, files: [], commands: [], home: "" };

async function fetchFiles(f: FilesOf): Promise<FilesData> {
  const q = (k: string, v: string) => `${k}=${encodeURIComponent(v)}`;
  const got = await get<FilesData | Failed>(
    `/api/files?${q("gatherer", f.gatherer)}&${q("channel", f.channel)}` +
      `${f.turn === null ? "" : `&turn=${f.turn}`}&${q("cwd", f.cwd)}`,
  );
  if (!failed(got)) return got;
  if (got.error.startsWith("no database")) return NONE;
  throw new Error(got.error);
}

/** By each latest turn's files: the stamp of the turns they are known to be current for -- what the files fetched had,
 * or the view's they were fetched again for. */
const current = new Map<string, string>();
const flying = new Map<string, Promise<FilesData>>(),
  queued = new Map<string, Promise<FilesData>>();

/** Fetched now: one fetch at a time for each, and at most one more after it for all that asked meanwhile -- not one
 * each, which would pile up while one is held up (the browser's connections all taken by streams). */
function fetchNow(f: FilesOf): Promise<FilesData> {
  const id = idOf(f),
    now = flying.get(id);
  if (now) {
    let next = queued.get(id);
    if (!next) {
      next = now
        .catch(() => undefined)
        .then(() => {
          queued.delete(id);
          return fetchNow(f);
        });
      queued.set(id, next);
    }
    return next;
  }
  const got = queryClient
    .fetchQuery({ queryKey: filesKey(f), queryFn: () => fetchFiles(f), staleTime: 0 })
    .then((fetched) => {
      // as kept: the object kept before, if what came is the same (the query's structural sharing)
      const d = queryClient.getQueryData<FilesData>(filesKey(f)) ?? fetched;
      if (f.turn === null) current.set(id, stampOf(d.turns));
      return d;
    })
    .finally(() => flying.delete(id));
  flying.set(id, got);
  return got;
}

/**
 * The files of `f`, as kept -- fetched if none are, or if `fresh` (the page not streaming: nothing says when they
 * move on), or (the latest turn's) if the stream's view has turns (`stamp`, data.ts's stampOf) they were not fetched
 * for.
 */
export function loadFiles(f: FilesOf, { fresh = false, stamp }: { fresh?: boolean; stamp?: string } = {}) {
  const id = idOf(f),
    kept = queryClient.getQueryData<FilesData>(filesKey(f));
  const behind = f.turn === null && stamp !== undefined && current.get(id) !== stamp;
  if (kept && !fresh && !behind) return Promise.resolve(kept);
  if (behind) current.set(id, stamp);
  return fetchNow(f);
}

/** The files of `f` as kept; undefined if none are. */
export const keptFiles = (f: FilesOf): FilesData | undefined => queryClient.getQueryData<FilesData>(filesKey(f));

const seqs = new WeakMap<FilesData, number>();
let seq = 0;
/** Which files these are, as a number: the same for the same data -- fetched again unchanged, the query keeps the
 * object it had (its structural sharing) -- so the page's change checks compare it, not what the files hold. */
export function filesSeq(d: FilesData | null): number {
  if (!d) return 0;
  let n = seqs.get(d);
  if (n === undefined) seqs.set(d, (n = ++seq));
  return n;
}
