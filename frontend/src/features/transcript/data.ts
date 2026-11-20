// The transcript feed (/api/transcript, data.py's `transcript`): the actor's events as the Transcript view draws them,
// kept for the actor shown. Its newest TRANSCRIPT_ITEMS at first, then each time only those after the last one kept, so
// an event is never listed twice; earlier ones a page at a time, as asked for; the pending ones replaced each time. One
// load at a time: a stream message and the reader's own action can ask at once.
import { create } from "zustand";
import { get } from "../../core/api/client";
import { parse } from "../../core/model/keys";
import type { TxItem } from "./blocks";

export interface TxFeed {
  /** the actor's */
  key: string;
  items: TxItem[];
  pending: TxItem[];
  first_row: number | null;
  last_row: number;
  /** earlier events not loaded */
  earlier: boolean;
}

interface Got {
  items: TxItem[];
  earlier?: boolean;
  newest?: boolean;
  error?: string;
}

export const useTxFeed = create<{ feed: TxFeed | null }>()(() => ({ feed: null }));

/** The feed kept, if it is `actor`'s. */
export const txFeedOf = (actor: string | null): TxFeed | null => {
  const f = useTxFeed.getState().feed;
  return f && f.key === actor ? f : null;
};

let loading: Promise<void> = Promise.resolve();

/** `actor`'s events loaded: what came since the last kept, or (`earlier`) the page before the first. */
export function loadTranscript(actor: string | null, earlier = false): Promise<void> {
  const load = () => loadNow(actor, earlier);
  loading = loading.then(load, load);
  return loading;
}

async function loadNow(actor: string | null, earlier: boolean): Promise<void> {
  if (!actor || window.AG_SNAPSHOT) return;
  const { group: g, id: c } = parse(actor);
  const url = (q: string) => `/api/transcript?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}${q}`;
  const stored = (got: Got) => got.items.filter((i) => i.row_id !== null);
  const pending = (got: Got, was: TxItem[]) => (got.newest ? got.items.filter((i) => i.row_id === null) : was);
  let f = txFeedOf(actor);
  if (!f) {
    const got = await get<Got>(url(""));
    if (got.error) {
      useTxFeed.setState({ feed: null });
      return;
    }
    f = {
      key: actor,
      items: stored(got),
      pending: pending(got, []),
      first_row: null,
      last_row: 0,
      earlier: !!got.earlier,
    };
  } else if (earlier) {
    if (!f.first_row) return;
    const first = f.first_row;
    const got = await get<Got>(url(`&before=${first}`));
    f = txFeedOf(actor);
    if (got.error || !f) return;
    f = {
      ...f,
      items: [...got.items.filter((i) => i.row_id !== null && i.row_id < first), ...f.items],
      earlier: !!got.earlier,
    };
  } else {
    for (;;) {
      // all that came since, a page at a time
      const got: Got = await get<Got>(url(`&after=${f.last_row}`));
      const now = txFeedOf(actor);
      if (got.error || !now) return;
      const fresh: TxItem[] = stored(got).filter((i) => i.row_id! > now.last_row);
      f = {
        ...now,
        items: [...now.items, ...fresh],
        pending: pending(got, now.pending),
        last_row: fresh.length ? fresh[fresh.length - 1].row_id! : now.last_row,
      };
      useTxFeed.setState({ feed: f });
      if (got.newest || !fresh.length) break;
    }
  }
  const items = f.items;
  if (items.length)
    f = {
      ...f,
      first_row: items[0].row_id,
      last_row: Math.max(f.last_row, items[items.length - 1].row_id!),
    };
  useTxFeed.setState({ feed: f });
}

/** What the page's draws compare, to draw again when it changes. */
export const txSignature = (f: TxFeed | null) =>
  f ? [f.key, f.items.length, f.last_row, f.first_row, JSON.stringify(f.pending)] : null;
