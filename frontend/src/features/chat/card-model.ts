// What a pane's card holds (card.tsx), worked out apart from drawing it: why an actor cannot be messaged here, what a view
// says while there is nothing yet, and which of the card's parts a view has.
import type { FeedData } from "./views";

/** Why an actor cannot be messaged from here at all -- a harness the dashboard does not run, or no directory -- said the
 * same in every view (the card's foot, the Terminal's cover); `names`, the harnesses it runs. */
export const readOnlyWhy = (names: string): string =>
  `Read only. Only ${names} sessions with a known directory can be messaged here.`;

/** Why an actor the dashboard can run cannot be messaged now -- another process has it open (data.py's chattable false)
 * -- or "": none. Closing that process would change it. */
export function heldWhy(
  info: { chattable?: boolean; holder?: { pid?: number } | null; pid?: number | null },
  canChat: boolean,
): string {
  if (!canChat || info.chattable !== false) return "";
  const pid = info.holder ? info.holder.pid : info.pid;
  return `Open in another process${info.holder || info.pid ? ` (PID ${pid})` : ""}. Close it there to message it here.`;
}

/** That there is no conversation yet: said under a view's blocks, or by a view that draws its frame itself. */
export function noneYetWords(snapshot: boolean, status: string | undefined, writable: boolean): string {
  if (snapshot) return "A snapshot has no conversation. Run `ag dashboard` live to see it.";
  if (status === "starting") return "Starting the agent…";
  return writable ? "No messages yet. Write one below." : "No messages yet.";
}

/** What of a view decides its card's parts. */
export interface ViewShape {
  feed: string;
  chat?: boolean;
  queued?: boolean;
  greets?: boolean;
  asking?: boolean;
  background: boolean;
  readOnly?: boolean;
  mini?: boolean;
}

/** A card's parts, in their order: the view's frame (not minimized) -- and in a frame the card makes, after the view's
 * blocks, what waits for the turn to end and that there is nothing yet; then, for the conversation, what the agent asks
 * (answered here unless the view is to read by), what runs in the background, and either the line saying it cannot be
 * messaged here or the message box and the line under it; the view's footer last. */
export interface CardShape {
  frame: boolean;
  queuedInFrame: boolean;
  noneYetInFrame: boolean;
  cards: boolean;
  answerable: boolean;
  background: boolean;
  readOnlyLine: boolean;
  composer: boolean;
}

export function cardShape(
  view: ViewShape,
  o: { writable: boolean; snapshot: boolean; data: FeedData; queued: readonly string[] },
): CardShape {
  const history = view.feed !== "none" && view.chat !== false; // a view that draws the history
  const conversation = view.chat !== false;
  return {
    frame: !view.mini,
    queuedInFrame: history && view.queued !== false && o.queued.length > 0,
    noneYetInFrame: history && !o.data.items.length && !o.data.pending.length && !o.queued.length && !view.greets,
    cards: conversation && view.feed !== "none" && view.asking !== false, // the terminal shows it itself
    answerable: !view.readOnly,
    background: conversation && view.background,
    readOnlyLine: conversation && !o.writable && !o.snapshot && !view.readOnly,
    composer: conversation && o.writable,
  };
}
