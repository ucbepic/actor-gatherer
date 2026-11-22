// Moving about the conversation as the reader does: a turn's replies or its files shown or folded from its message,
// that message kept where it was on the screen; and the earlier turns pulled in as the reader scrolls up past the top --
// what they look at kept in place by react-virtuoso, the turns put before its first (Turns.tsx's firstItemIndex).
import { flushSync } from "react-dom";
import { placed } from "./follow";
import { TURNS_MORE, useTurns } from "./store";
import type { ChatFeed } from "./types";

/** The feed of the turn list's last draw by the page (mount.tsx): what the page shows now. */
export const drawn: { feed: ChatFeed | null } = { feed: null };

const talkNow = () => document.querySelector<HTMLElement>("#main .fl-talk");
const top = (n: Element) => n.getBoundingClientRect().top;

/**
 * A turn's files and commands, or its replies, shown or folded from its message (`change`: drawn at once, or -- a turn's
 * files loaded first -- once the page draws them): that message kept where it was on the screen -- not the turn picked
 * brought into view, as a new pick is (Turns's effect, by the store's `shown`).
 */
export async function keepTurn(n: number, change: () => unknown): Promise<void> {
  const talk = talkNow();
  const turn = document.getElementById(`fl-turn-${n}`),
    y = talk && turn ? top(turn) - top(talk) : null;
  let changed: unknown;
  flushSync(() => {
    changed = change();
  });
  await changed;
  const feed = drawn.feed;
  if (feed) useTurns.getState().setShown(`${feed.key}:${feed.data.turn}`);
  const now = talkNow(),
    again = document.getElementById(`fl-turn-${n}`);
  if (y !== null && now && again) now.scrollTop += top(again) - top(now) - y;
  if (now) placed(now); // not at its end, if it is no longer: the message stays where it is as the box changes size
}

// Scrolled to its top, a pull further up -- the wheel, a finger drawn down, or ↑, Page Up or Home with the focus in it --
// shows TURNS_MORE earlier turns above, the reader's place kept. Reaching the top is not one: what is drawn ends there,
// and only a pull PULL_WAIT_MS after (of PULL_PX, so a jolt of the trackpad is not one) shows more -- not react-virtuoso's
// startReached, which a conversation shorter than its box is at as it opens. Chrome scrolls before the page hears of the
// wheel, so the top is known by when the conversation got there (`topAt`, as react-virtuoso tells it), not by the event.
export const PULL_PX = 60,
  PULL_WAIT_MS = 300;
let topAt: number | null = null,
  pulled = 0,
  touchedAt: number | null = null;

// A turn held where the reader is to see it, as turns are drawn about it: the turn first drawn as earlier turns are pulled
// in, where it was on the screen; a turn picked, at the top (Turns.tsx's useShown). react-virtuoso puts turns before the
// first a frame after it has them, keeping the reader's place by the height it guesses they have, and a turn not on the
// page where it reckons it is from the heights it knows; and the count of earlier turns above them goes once the first
// turn is on the page. So as they are drawn -- the turn held, or one above it (Turns.tsx's TurnItem), and the count
// (its Top) -- the turn is put back where it is to be: in that draw, and only for a moment after, so a turn drawn above
// it later, as the reader scrolls on, does not move it.
let held: { talk: HTMLElement; n: number; y: number; at: number } | null = null;
const HELD_MS = 2000;

/** Turn `n` held `y` from the top of `talk` until it, or a turn above it, is drawn. */
export function holdTurn(talk: HTMLElement, n: number, y: number): void {
  held = { talk, n, y, at: performance.now() };
}

const talkOf = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>("#main .fl-talk") : null);

export function pullEarlier(talk: HTMLElement | null, by: number): void {
  if (!talk) return;
  const first = useTurns.getState().first;
  if (talk.scrollTop > 0 || !first) {
    topAt = null;
    pulled = 0;
    return;
  }
  if (topAt === null) {
    // at the top only now: drawn up to here
    topAt = Date.now();
    pulled = 0;
    return;
  }
  if (Date.now() - topAt < PULL_WAIT_MS || (pulled += by) < PULL_PX) return;
  pulled = 0;
  topAt = null;
  const turn = talk.querySelector(`#fl-turn-${first}`);
  if (turn) holdTurn(talk, first, top(turn) - top(talk));
  useTurns.getState().setFirst(Math.max(0, first - TURNS_MORE));
}

/** The turn held put where it is to be, if one is and it is on the page. */
export function keepHeld(): void {
  const h = held;
  if (!h) return;
  const turn = performance.now() - h.at < HELD_MS && h.talk.isConnected && h.talk.querySelector(`#fl-turn-${h.n}`);
  if (!turn) return;
  h.talk.scrollTop += top(turn) - top(h.talk) - h.y;
  placed(h.talk);
}

/** Turn `n` drawn: if the turn held or one above it, the turn held put where it is to be -- and let go of once this draw
 * is over (the turns drawn with it, and the count above them, put back too). */
export function drawnAt(n: number): void {
  const h = held;
  if (!h || n > h.n) return;
  keepHeld();
  queueMicrotask(() => {
    if (held === h) held = null;
  });
}

/** The conversation got to its top, or left it (Turns.tsx's atTopStateChange). */
export function reachedTop(there: boolean): void {
  topAt = there ? (topAt ?? Date.now()) : null;
}

let listening = false;
/** The page listened to for pulls, once: on the document, as the conversation's node comes and goes with its view. */
export function listenForPulls(): void {
  if (listening) return;
  listening = true;
  document.addEventListener(
    "wheel",
    (ev) => {
      // lines or pages: a pull each
      if (ev.deltaY < 0) pullEarlier(talkOf(ev.target), -ev.deltaY * (ev.deltaMode ? 20 : 1));
    },
    { passive: true },
  );
  document.addEventListener(
    "touchstart",
    (ev) => {
      touchedAt = talkOf(ev.target) ? ev.touches[0].clientY : null;
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    (ev) => {
      if (touchedAt === null) return;
      const by = ev.touches[0].clientY - touchedAt;
      if (by > 0) {
        touchedAt = ev.touches[0].clientY;
        pullEarlier(talkOf(ev.target), by);
      }
    },
    { passive: true },
  );
  document.addEventListener("keydown", (ev) => {
    const t = ev.target;
    if (
      ["ArrowUp", "PageUp", "Home"].includes(ev.key) &&
      !ev.defaultPrevented &&
      !(t instanceof Element && t.closest("input, textarea, [contenteditable]"))
    )
      pullEarlier(talkOf(t), PULL_PX);
  });
}
