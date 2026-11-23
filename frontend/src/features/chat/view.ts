// What the conversation shows now: the server's view of it (types.ts's ChatView, chat_view.py's), and the page's own sends
// the view does not have yet (the feed's `mine`: the dashboard has each from the moment it is sent, so a send is in the
// view a moment later, by its id). Nothing here matches messages by their words or times: the view did that once.
import type { ChatFeed, Current, Opening, Turn, Waits } from "./types";

/** The states of a turn at work: a message sent from here waits for the agent's next step. */
export const AT_WORK: ReadonlySet<string> = new Set(["opening", "working", "asking"]);

/** The turns: the view's -- before it has come for this actor, the page's files feed's, drawn with no state; none before
 * either has come (an actor shown for the first time, or the page's first draw after a reload: Chat says "Loading…"). */
export const turnsOf = (feed: ChatFeed): Turn[] => feed.view?.turns ?? feed.data?.turns ?? [];

/** The turn sent and not stored yet: the view's; else a send from here the view does not have yet, while the actor is
 * not at work (at work, it waits). Null: none. */
export function openingOf(feed: ChatFeed): Opening | null {
  const v = feed.view;
  if (v?.opening) return v.opening;
  if (v && AT_WORK.has(v.current.state)) return null;
  const m = feed.mine[0];
  return m ? { text: m.text, cid: m.cid, began: m.at / 1000, seen: false, unseen: false } : null;
}

/** The latest turn's state: the view's -- opening, for a send from here it does not have yet that opens the turn. Null
 * before the view has come (and nothing sent from here). */
export function currentOf(feed: ChatFeed): Current | null {
  const v = feed.view;
  if (!v?.opening && openingOf(feed)) return { state: "opening", turn: "opening" };
  return v ? v.current : null;
}

/** What waits for the agent's next step: the view's, and the sends from here it does not have yet, but one opening a
 * turn. */
export function waitsOf(feed: ChatFeed): Waits[] {
  const opening = openingOf(feed);
  const mine = feed.mine.filter((m) => m.cid !== opening?.cid);
  return [...(feed.view?.waiting ?? []), ...mine.map((m): Waits => ({ text: m.text, cid: m.cid, how: "chat" }))];
}

/** Every send's id the view has: in a turn, opening one, waiting, or taken back. */
export function cidsOf(view: ChatFeed["view"]): Set<string> {
  const out = new Set<string>();
  if (!view) return out;
  const add = (cid?: string | null) => {
    if (cid) out.add(cid);
  };
  for (const t of view.turns) {
    add(t.cid);
    for (const m of t.more || []) add(m.cid);
  }
  add(view.opening?.cid);
  for (const w of view.waiting) add(w.cid);
  add(view.taken_back?.cid);
  return out;
}

/** What the line under the turn at work says it does: the Esc sent for it, its calls retried, thinking, at work. */
export const nowWords = (cur: Current | null, t: Turn | null, interrupting: boolean): string =>
  interrupting
    ? "Interrupting…"
    : cur?.failing
      ? "Retrying…"
      : (cur?.doing ?? t?.now)?.kind === "thinking"
        ? "Thinking…"
        : "Working…";

/** The turn picked, its files and commands shown at the left -- the latest, unless one is. */
export const pickedOf = (feed: ChatFeed, turns: Turn[]): number | null =>
  feed.picked ?? (turns.length ? turns.length - 1 : null);
