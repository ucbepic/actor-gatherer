// The conversation, at the right of the Chat view: each of the user's messages a turn, and under it the agent's (Turn).
// The latest turns drawn, the earlier a few more at a time as the reader scrolls up past the top (pull.ts). The turns
// before the latest folded as the setting "Chat's earlier turns" has them -- all but the latest two the agent answered in
// (a message, a thought or a call), and any after them it has yet to answer: the one before those two folds once a newer
// turn has its first answer; never by the actor's status, nor by a message sent and not yet stored, so a turn is not
// folded and shown again as the next starts. Then the turn a message opened that is not stored yet. What each shows of
// its state -- at work, done, stopped -- is the server's view's (view.ts), one moment's for all of them.
//
// Laid out by react-virtuoso: its scroller the conversation's box (.fl-talk), each turn in an item box of its own
// (.fl-item), how many earlier turns are not drawn its header (.fl-top), the actor under the latest and a turn opened
// since its footer (.fl-foot). It puts on the page the turns in sight and OVERSCAN_PX above and below them -- a
// conversation of a few screens whole, so the browser's find reads all of it; a longer one only around where the reader
// is. Each item draws its turn from the feed (TurnItem), so a draw of the page changes the turns in place, and the list
// itself only as turns come or are pulled in. Those pulled in are put before the first (firstItemIndex: the first one's
// number), the reader's place kept (pull.ts's drawnAbove, to the pixel); a turn picked, or the end, is brought into view
// at once where it is drawn, by scrollToIndex where it is not. Not its followOutput: it follows the end by its own
// at-bottom, which a turn growing turns false and its next draw acts on -- undoing a turn kept in place by a click
// (keepTurn) -- where the end is followed by the reader's last scroll (follow.ts), as each turn's box and the footer
// change size: a turn added, a reply streaming in, a turn growing in, alike.
import { createContext, memo, use, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Virtuoso, type ItemProps, type VirtuosoHandle } from "react-virtuoso";
import { plural } from "../../core/format";
import { Measured, OVERSCAN_PX } from "../../core/ui/lists";
import { TurnBoundary } from "./Boundary";
import { useChat } from "./context";
import { followContent, followEnd, placed, unfollow } from "./follow";
import { OpenedTurn } from "./Pending";
import { drawn, drawnAt, holdTurn, keepHeld, reachedTop } from "./pull";
import { TURNS_SHOWN, useOnPage, useTurns } from "./store";
import { Turn, type TurnPlace } from "./Turn";
import type { ChatFeed, Turn as TurnData } from "./types";
import { currentOf, nowWords, openingOf, pickedOf, turnsOf } from "./view";
import { Done, Status } from "./Working";

/** The most turns put on the page as the list is made, before it has measured its box: all of an ordinary one. */
const DRAWN_AT_FIRST = 60;
/** Above each turn, in its item box (files-view.css's .fl-item): a turn picked is brought to its own top, not its box's. */
const TURN_GAP = 2;

/** What each part of the list reads of this draw, beside the feed (ChatContext): where each turn is, and the list's own. */
interface Drawing {
  placeOf: (t: TurnData) => TurnPlace;
  /** the first turn of the list's, and the first on the page: the same but for the frame after earlier turns are pulled
   * in, which Virtuoso puts on the page on the next */
  first: number;
  firstDrawn: number;
  setFirstDrawn: (n: number) => void;
  interrupting: boolean;
}
const DrawingContext = createContext<Drawing | null>(null);
const useDrawing = () => use(DrawingContext)!;

export function Turns({ talkRef, interrupting }: { talkRef: RefObject<HTMLDivElement | null>; interrupting: boolean }) {
  const { feed, folds } = useChat();
  const turns = turnsOf(feed),
    last = turns.length - 1,
    cur = currentOf(feed),
    opening = openingOf(feed);
  // the first turn drawn (the mount's, as the page drew it; the latest few until it has)
  const first = Math.min(folds.first ?? Math.max(0, turns.length - TURNS_SHOWN), last);
  const answered = turns.filter((t) => (t.replies || []).length || t.calls).map((t) => t.n);
  const foldsAt = answered.length < 2 ? 0 : answered[answered.length - 2]; // the turns before this one fold
  const placeOf = (t: TurnData): TurnPlace => {
    const latest = t.n === last && !opening;
    const live = latest && cur?.state === "working"; // asking: what it asks shows, not the actor at work
    return {
      live,
      done: latest && (cur?.state === "done" || cur?.state === "stopped"),
      folds: foldsAt,
      opened: !!opening,
      began: live ? (t.began ?? t.at ?? undefined) : undefined,
      // a call under way is drawn above, as the turn's latest call: the line under it only says the agent works
      now: live ? nowWords(cur, t, interrupting) : "",
      failing: live ? (cur?.failing ?? null) : null,
      stopped: t.stopped || (t.n === last && cur?.state === "stopped" ? (cur.stopped ?? null) : null),
    };
  };
  // the list's items: the turns' numbers, the same array until turns come or are pulled in
  const items = useMemo(() => Array.from({ length: last - first + 1 }, (_, i) => first + i), [first, last]);
  const [firstDrawn, setFirstDrawn] = useState(first);
  const list = useRef<VirtuosoHandle>(null);
  const at = useRef({ first, last });
  useLayoutEffect(() => {
    at.current = { first, last };
  });
  useShown(feed, talkRef, list, at);
  useSent(feed, talkRef, list, last);
  return (
    <DrawingContext value={{ placeOf, first, firstDrawn, setFirstDrawn, interrupting }}>
      <Measured>
        <Virtuoso
          ref={list}
          scrollerRef={(n) => {
            if (n instanceof HTMLDivElement) followEnd((talkRef.current = n));
          }}
          className="fl-talk fl-list"
          tabIndex={undefined} // no tab stop of its own, as the box had none
          data={items}
          firstItemIndex={first}
          computeItemKey={(_, n) => n}
          itemContent={turnItem}
          initialItemCount={items.length <= DRAWN_AT_FIRST ? items.length : 0}
          increaseViewportBy={OVERSCAN_PX}
          atTopStateChange={reachedTop}
          components={PARTS}
        />
      </Measured>
    </DrawingContext>
  );
}

/** A turn, an item of the list: drawn from the feed by its number, as the feed changes (the list's items do not). */
const TurnItem = memo(function TurnItem({ n }: { n: number }) {
  const { feed } = useChat();
  const { placeOf, first, setFirstDrawn } = useDrawing();
  useLayoutEffect(() => drawnAt(n), [n]); // a turn pulled in or picked: the one held put where it is to be (pull.ts)
  useLayoutEffect(() => {
    if (n === first) setFirstDrawn(n);
  }, [n, first, setFirstDrawn]);
  const t = turnsOf(feed)[n];
  if (!t) return null;
  return (
    <TurnBoundary n={t.n} of={t}>
      <Turn t={t} place={placeOf(t)} />
    </TurnBoundary>
  );
});
const turnItem = (_: number, n: number) => <TurnItem n={n} />;

/** Above the turns: how many earlier ones are not drawn -- said as the first turn is on the page, not a frame before. */
function Top() {
  const { firstDrawn } = useDrawing();
  useLayoutEffect(keepHeld); // the count gone as the first turn came: the turn held put back (pull.ts)
  return (
    <div className="fl-top">
      {firstDrawn ? (
        <div className="fl-earlier">{`${plural(firstDrawn, "earlier turn")} · scroll up for more`}</div>
      ) : null}
    </div>
  );
}

/** Under the turns: the actor at work under the latest, or, its turn over, the actor done; or the turn a message opened
 * since, not stored yet. */
function Foot() {
  const { feed } = useChat();
  const { placeOf, interrupting } = useDrawing();
  const turns = turnsOf(feed),
    t = turns[turns.length - 1],
    opening = openingOf(feed);
  const { live, done, now } = placeOf(t);
  return (
    <div className="fl-foot" ref={watched}>
      {live ? <Status work={t.work} now={now} /> : done ? <Done t={t} /> : null}
      {opening ? <OpenedTurn o={opening} interrupting={interrupting} /> : null}
    </div>
  );
}

/** A turn's item box: Virtuoso's, with its class. */
function Item({ children, style, ...at }: ItemProps<number>) {
  return (
    <div
      className="fl-item"
      style={style}
      data-index={at["data-index"]}
      data-item-index={at["data-item-index"]}
      data-known-size={at["data-known-size"]}
      ref={watched}
    >
      {children}
    </div>
  );
}

/** A part of the list -- a turn's box, the footer -- watched as it changes size: the conversation kept at its end, if the
 * reader is there (follow.ts). */
function watched(part: HTMLDivElement | null) {
  const talk = part?.closest<HTMLElement>(".fl-talk");
  if (!part || !talk) return;
  followContent(talk, part);
  return () => unfollow(talk, [part]);
}

const PARTS = { Header: Top, Footer: Foot, Item };

/** The reader put at the end: at once where the last turn is drawn, else as Virtuoso reckons it. */
function toEnd(talk: HTMLElement, list: VirtuosoHandle | null, last: number) {
  if (talk.querySelector(`#fl-turn-${last}`) || !list) {
    talk.scrollTop = talk.scrollHeight;
    placed(talk);
  } else list.scrollToIndex({ index: "LAST", align: "end" });
}

/** Turn `n` put at the top: at once where it is drawn, else as Virtuoso reckons it -- and held there as it is drawn. */
function toTurn(talk: HTMLElement, list: VirtuosoHandle | null, n: number, first: number) {
  const turn = talk.querySelector(`#fl-turn-${n}`);
  if (turn || !list) {
    if (turn) talk.scrollTop += turn.getBoundingClientRect().top - talk.getBoundingClientRect().top;
    placed(talk);
  } else {
    holdTurn(talk, n, 0);
    list.scrollToIndex({ index: n - first, align: "start", offset: TURN_GAP });
  }
}

/** The turn shown brought into view, once each time one is shown: the latest at its end, one picked at its top -- on the
 * frame after the draw, once the page has put the frame where it goes. */
function useShown(
  feed: ChatFeed,
  talkRef: RefObject<HTMLDivElement | null>,
  list: RefObject<VirtuosoHandle | null>,
  at: RefObject<{ first: number; last: number }>,
) {
  const picked = pickedOf(feed, turnsOf(feed));
  useLayoutEffect(() => {
    const shown = `${feed.key}:${picked}`;
    const mine = () => useOnPage.getState().key === feed.key; // its frame the one on the page
    if (useTurns.getState().shown === shown || !mine()) return;
    requestAnimationFrame(() => {
      if (useTurns.getState().shown === shown || !mine()) return; // already (keepTurn: kept where the reader had it)
      const talk = talkRef.current,
        p = (drawn.feed ?? feed).picked,
        { first, last } = at.current;
      if (!talk?.isConnected || (p !== null && p < first)) return; // not drawn yet
      useTurns.getState().setShown(shown);
      if (p === null) toEnd(talk, list.current, last);
      else toTurn(talk, list.current, p, first);
    });
  });
}

/** A message sent from here: shown at the end, wherever the reader was. */
function useSent(
  feed: ChatFeed,
  talkRef: RefObject<HTMLDivElement | null>,
  list: RefObject<VirtuosoHandle | null>,
  last: number,
) {
  const sent = feed.mine.length,
    before = useRef(sent);
  useLayoutEffect(() => {
    const n = talkRef.current;
    if (n?.isConnected && sent > before.current) toEnd(n, list.current, last);
    before.current = sent;
  }, [talkRef, list, last, sent]);
}
