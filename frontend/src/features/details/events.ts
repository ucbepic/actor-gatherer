// The history feed (/api/history, data.py's `history`): the actor's events, each a row -- what the Messages view lists,
// and the feed the reader's own views draw from by default -- kept for the actor shown, append-only: the stored ones
// since the last loaded, then what is pending. One load at a time (a stream message and the reader's own action can
// ask at once), and only rows past the last one kept are added: an event is never listed twice.
import { create } from "zustand";
import { get } from "../../core/api/client";
import { parse } from "../../core/model/keys";
import { failed, type History } from "../../core/api/types";
import type { HistoryItem as Item } from "./types";

export interface EventsFeed {
  /** the actor's */
  key: string;
  items: Item[];
  pending: Item[];
  last_row: number;
}

export const useEvents = create<{ feed: EventsFeed | null }>()(() => ({ feed: null }));

/** The feed kept, if it is `actor`'s. */
export const eventsOf = (actor: string | null): EventsFeed | null => {
  const f = useEvents.getState().feed;
  return f && f.key === actor ? f : null;
};

let loading: Promise<void> = Promise.resolve();

/** `actor`'s events loaded: those stored since the last kept, and what is pending now. */
export function loadEvents(actor: string | null): Promise<void> {
  const load = () => loadNow(actor);
  loading = loading.then(load, load);
  return loading;
}

const stored = (i: Item) => i.row_id !== undefined && i.row_id !== null;

async function loadNow(actor: string | null): Promise<void> {
  if (!actor) return;
  const { group: g, id: c } = parse(actor);
  let f = eventsOf(actor);
  if (!f) useEvents.setState({ feed: (f = { key: actor, items: [], pending: [], last_row: 0 }) });
  let got: History | null;
  try {
    got = await get(
      `/api/history?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}&from=${f.last_row + 1}`,
    );
  } catch {
    return; // no database yet: the gatherer is made on the first call
  }
  const now = eventsOf(actor);
  if (!got || failed(got) || !now) return;
  const fresh = got.items.filter((i) => stored(i) && i.row_id! > now.last_row);
  useEvents.setState({
    feed: {
      ...now,
      items: fresh.length ? [...now.items, ...fresh] : now.items,
      last_row: fresh.length ? fresh[fresh.length - 1].row_id! : now.last_row,
      pending: got.items.filter((i) => !stored(i)),
    },
  });
}
