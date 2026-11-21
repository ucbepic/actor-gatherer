// Details' own state, and the data it fetches. Which call's context it shows: the latest's, followed as calls come,
// unless one was picked on the size chart -- each actor's, kept while a pane shows it (`shown`). A call's context,
// fetched from /api/context (data.py's `context`; a snapshot's inside it) and kept by its gatherer and read (TanStack
// Query): what a call sent never changes, so it is fetched once.
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { create } from "zustand";
import { get } from "../../core/api/client";
import { queryClient } from "../../core/api/query";
import { key } from "../../core/model/keys";
import type { Agent, Context } from "./types";

interface Picked {
  /** the read picked on each actor's size chart, by its key (none: the latest) */
  picks: Readonly<Record<string, number>>;
  /** the actors the panes show now: their picks kept, the others' let go of */
  shown(keys: string[]): void;
  /** a read picked (null: back to the latest) */
  pick(key: string, readId: number | null): void;
}

export const usePicked = create<Picked>()((set, get) => ({
  picks: {},
  shown(keys) {
    const was = get().picks,
      picks = Object.fromEntries(Object.entries(was).filter(([k]) => keys.includes(k)));
    if (Object.keys(picks).length !== Object.keys(was).length) set({ picks });
  },
  pick(k, readId) {
    const picks = { ...get().picks };
    if (readId === null) delete picks[k];
    else picks[k] = readId;
    set({ picks });
  },
}));

/** The read picked for the actor `k`; null: the latest. */
export const pickedFor = (s: Pick<Picked, "picks">, k: string): number | null => s.picks[k] ?? null;

/** The read whose context is shown for the actor: the one picked, else the latest; null before any. */
export function shownRead(agent: Agent | null, picked: number | null): number | null {
  const reads = agent?.reads || [];
  if (!reads.length) return null;
  return picked ?? reads[reads.length - 1].read_id;
}

declare global {
  interface Window {
    AG_SNAPSHOT?: { contexts?: Record<string, Context> } | null;
  }
}

export const contextKey = (gatherer: string, readId: number) => ["context", gatherer, readId] as const;

async function fetchContext(gatherer: string, readId: number): Promise<Context | null> {
  const snap = window.AG_SNAPSHOT;
  if (snap) return snap.contexts?.[key(gatherer, String(readId))] ?? null; // a snapshot keeps only each actor's latest
  return get<Context>(`/api/context?gatherer=${encodeURIComponent(gatherer)}&read_id=${readId}`);
}

const contextQuery = (gatherer: string, readId: number) => ({
  queryKey: contextKey(gatherer, readId),
  queryFn: () => fetchContext(gatherer, readId),
});

/** The context of `readId` fetched, if it is not kept yet: the page waits on it before it draws an actor whose context
 * it is, as Details then has it at once. */
export async function loadContext(gatherer: string, readId: number | null): Promise<void> {
  if (readId === null) return;
  await queryClient.ensureQueryData(contextQuery(gatherer, readId));
}

/** A read picked on the size chart, its context fetched first: shown with it at once. The latest picked is followed. */
export async function pickRead(k: string, gatherer: string, agent: Agent | null, readId: number | null): Promise<void> {
  const reads = agent?.reads || [];
  const latest = reads.length ? reads[reads.length - 1].read_id : null;
  const want = readId === latest ? null : readId;
  await loadContext(gatherer, want ?? latest);
  usePicked.getState().pick(k, want);
}

/** The context of `readId` in `gatherer`: as kept, else fetched -- the one shown before kept while it comes. */
export function useContextOf(gatherer: string, readId: number | null): Context | null {
  const q = useQuery(
    { ...contextQuery(gatherer, readId ?? -1), enabled: readId !== null, placeholderData: keepPreviousData },
    queryClient,
  );
  return readId === null ? null : (q.data ?? null);
}
