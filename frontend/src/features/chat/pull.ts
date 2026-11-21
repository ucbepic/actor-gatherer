// Moving about the conversation as the reader does: a turn's replies or its files shown or folded from its message,
// that message kept where it was on the screen; and the earlier turns pulled in as the reader scrolls up past the top,
// what they look at kept in place.
import { flushSync } from "react-dom";
import { placed } from "./follow";
import { TURNS_MORE, foldsOf } from "./store";
import type { ChatFeed } from "./types";

/** Each actor's feed of its turn list's last draw by the page (mount.tsx): what its pane shows now. */
export const drawn = new Map<string, ChatFeed>();

// an actor's conversation on the page: in its frame (mount.tsx's, keyed by its data-sig), in the pane showing it
const talkNow = (key: string) =>
  [...document.querySelectorAll<HTMLElement>(".pane .chat-frame.files")]
    .find((f) => f.dataset.sig === encodeURIComponent(key))
    ?.querySelector<HTMLElement>(".fl-talk") ?? null;
// the actor whose conversation `talk` is
const keyOf = (talk: Element): string | null => {
  const sig = talk.closest<HTMLElement>(".chat-frame")?.dataset.sig;
  return sig ? decodeURIComponent(sig) : null;
};
const turnIn = (talk: HTMLElement | null, n: number) => talk?.querySelector<HTMLElement>(`#fl-turn-${n}`) ?? null;

/**
 * A turn's files and commands, or its replies, shown or folded from its message (`change`: drawn at once, or -- a turn's
 * files loaded first -- once the page draws them): that message kept where it was on the screen -- not the turn picked
 * brought into view, as a new pick is (Turns's effect, by the store's `shown`).
 */
export async function keepTurn(key: string, n: number, change: () => unknown): Promise<void> {
  const top = (x: Element) => x.getBoundingClientRect().top,
    talk = talkNow(key);
  const turn = turnIn(talk, n),
    y = talk && turn ? top(turn) - top(talk) : null;
  let changed: unknown;
  flushSync(() => {
    changed = change();
  });
  await changed;
  const feed = drawn.get(key);
  if (feed) foldsOf(key).getState().setShown(`${feed.key}:${feed.data.turn}`);
  const now = talkNow(key),
    again = turnIn(now, n);
  if (y !== null && now && again) now.scrollTop += top(again) - top(now) - y;
  if (now) placed(now); // not at its end, if it is no longer: the message stays where it is as the box changes size
}

/** More of the conversation above where the reader is (`change`, drawn at once), what they look at kept in place. */
function showMore(key: string, change: () => void) {
  const n = talkNow(key),
    below = n ? n.scrollHeight - n.scrollTop : 0;
  flushSync(change);
  const again = talkNow(key);
  if (n && again) again.scrollTop = again.scrollHeight - below;
}

// Scrolled to its top, a pull further up -- the wheel, a finger drawn down, or ↑, Page Up or Home with the focus in it --
// shows TURNS_MORE earlier turns above, the reader's place kept. Reaching the top is not one: what is drawn ends there,
// and only a pull PULL_WAIT_MS after (of PULL_PX, so a jolt of the trackpad is not one) shows more. Chrome scrolls before
// the page hears of the wheel, so the top is known by when the conversation got there (`topAt`), not by the event.
export const PULL_PX = 60,
  PULL_WAIT_MS = 300;
let topAt: number | null = null,
  pulled = 0,
  touchedAt: number | null = null;
const talkOf = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>(".pane .fl-talk") : null);

export function pullEarlier(talk: HTMLElement | null, by: number): void {
  const key = talk && keyOf(talk);
  if (!talk || !key) return;
  const first = foldsOf(key).getState().first;
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
  showMore(key, () =>
    foldsOf(key)
      .getState()
      .setFirst(Math.max(0, first - TURNS_MORE)),
  );
}

let listening = false;
/** The page listened to for pulls, once: on the document, as the conversation's node comes and goes with its view. */
export function listenForPulls(): void {
  if (listening) return;
  listening = true;
  document.addEventListener(
    "scroll",
    (ev) => {
      const n = ev.target;
      if (n instanceof Element && n.matches(".pane .fl-talk")) topAt = n.scrollTop > 0 ? null : (topAt ?? Date.now());
    },
    true,
  );
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
