// The Chat view (ag_dashboard/DESIGN.md, A5), drawn where the old page's chat card puts its frame (features/chat/chat.js's
// chatCard, through the view's `mount`): each actor's frame a node of its own, #chat-list, the same from draw to draw --
// the page's patch() finds it where it is and leaves it there (its data-sig) -- so its React root stays and React
// changes in place only what changed, the actor's stage among it keeping its animations running. Drawn as the page
// draws, at once (flushSync): the page's keepingPlace() keeps its places around the draw, and follows its ends. Between
// the page's draws, it draws itself as what it shows changes (ChatMain.tsx).
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ChatMain } from "./ChatMain";
import { ChatContext } from "./context";
import { drawn, listenForPulls } from "./pull";
import { commandsAfresh } from "./side/Side";
import { sideFolded } from "./side/store";
import { TURNS_SHOWN, useOnPage, useTurns } from "./store";
import { feedOf } from "./feed";
import type { ChatHost, PageFeed } from "./types";
import { pickedOf, turnsOf } from "./view";

/** The frames kept drawn, each in its root, so one shown again is as it was at once (its stage's animations running):
 * those of the actors shown lately, as many as Chat keeps the data of (data.ts's KEPT_ACTORS), the one shown last
 * last. An older one, not on the page, is unmounted: each holds the feed it was last drawn from. */
export const KEPT_TALKS = 12;
const frames = new Map<string, { node: HTMLDivElement; root: Root }>();

/** How many frames are kept drawn (for tests). */
export const talksKept = (): number => frames.size;

/** The actor's frame, as the chat card has it (chat.js's frame, the Chat view's: `name` its name), drawn from what the
 * page hands it for the actor (`page`) and what Chat keeps of the actor itself: its node, for the page to put where it
 * goes. */
export function drawChat(page: PageFeed, host: ChatHost, name = "Chat"): HTMLDivElement {
  listenForPulls();
  const feed = feedOf(page);
  let frame = frames.get(feed.key);
  if (frame) frames.delete(feed.key);
  else {
    const node = document.createElement("div");
    frame = { node, root: createRoot(node) };
  }
  frames.set(feed.key, frame);
  for (const [k, f] of frames) {
    if (frames.size <= KEPT_TALKS) break;
    if (k === feed.key || f.node.isConnected) continue;
    f.root.unmount();
    frames.delete(k);
  }
  useOnPage.setState({ key: feed.key });
  useTurns.getState().forFiles(feed.files);
  const turns = turnsOf(feed);
  if (feed.afresh) commandsAfresh(); // its view opened again: each turn's commands at their end again as it shows
  if (turns.length) {
    if (feed.afresh) useTurns.getState().setShown(null); // and the turn shown brought into view again
    // the first turn drawn: the latest few, at first; then where the reader pulled it to, or the turn they picked. Kept
    // as the conversation grows: a new turn is drawn at the end, none taken from the top.
    const first = useTurns.getState().first ?? turns.length - TURNS_SHOWN;
    useTurns.getState().setFirst(Math.max(0, Math.min(pickedOf(feed, turns) ?? 0, first)));
  }
  const node = frame.node;
  Object.assign(node, { className: "chat-frame files", id: "chat-list" });
  Object.assign(node.dataset, { keep: "chat-list", follow: "1", sig: encodeURIComponent(feed.key) });
  node.setAttribute("role", "log");
  node.setAttribute("aria-label", `Chat history, ${name}`);
  drawn.feed = feed;
  const chat = { feed, host, folds: useTurns.getState(), sideFolded: sideFolded() };
  flushSync(() =>
    frame.root.render(
      <ChatContext value={chat}>
        <ChatMain frame={node} />
      </ChatContext>,
    ),
  );
  return node;
}
