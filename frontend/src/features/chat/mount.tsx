// The Chat view's turn list (ag_dashboard/DESIGN.md, A5), drawn where the old page's Chat view puts it (16-files-view.js's
// filesRender, which hands it its feed and host at each draw): into a node of each actor's own, .fl-talk, the same from
// draw to draw -- the page's patch() finds it where it is and leaves it there (its data-sig: the actor's) -- so its React
// root stays and React changes in place only what changed, the actor's stage among it keeping its animations running.
// Drawn when the page draws, and at once (flushSync): the page's keepingPlace() keeps the conversation's scroll, and its
// end followed, around the draw as it did; and its end kept as its box changes size (follow.ts).
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ChatContext } from "./context";
import { followEnd } from "./follow";
import { FirstTurns } from "./Hello";
import { drawn, listenForPulls } from "./pull";
import { TURNS_SHOWN, useTurns } from "./store";
import { Turns } from "./Turns";
import type { ChatFeed, ChatHost } from "./types";
import { AT_WORK, currentOf, openingOf, pickedOf, turnsOf } from "./view";

const talks = new Map<string, { node: HTMLDivElement; root: Root }>();

/** The actor's conversation drawn from `feed`: its node, for the page to put where it goes. */
export function drawTurns(feed: ChatFeed, host: ChatHost): HTMLDivElement {
  listenForPulls();
  let talk = talks.get(feed.key);
  if (!talk) {
    const node = document.createElement("div");
    talk = { node, root: createRoot(node) };
    talks.set(feed.key, talk);
    followEnd(node);
  }
  useTurns.getState().forFiles(feed.files);
  const turns = turnsOf(feed),
    opening = openingOf(feed),
    cur = currentOf(feed);
  // the latest turn no longer at work, as the view has it (opening, at work or asking: an Esc sent stops it): the Esc
  // sent for it is over too
  let interrupting = feed.interrupting;
  if (interrupting && cur && !AT_WORK.has(cur.state)) {
    host.interruptOver();
    interrupting = false;
  }
  if (turns.length) {
    if (feed.afresh) useTurns.getState().setShown(null); // its view opened again: the turn shown brought into view again
    // the first turn drawn: the latest few, at first; then where the reader pulled it to, or the turn they picked. Kept
    // as the conversation grows: a new turn is drawn at the end, none taken from the top.
    const first = useTurns.getState().first ?? turns.length - TURNS_SHOWN;
    useTurns.getState().setFirst(Math.max(0, Math.min(pickedOf(feed, turns) ?? 0, first)));
  }
  const node = talk.node;
  // its box as the old page's: the turns', kept where the reader left it and following its end; or, before them, the
  // turns the session opened, or the actor's hello
  node.className = turns.length || opening ? "fl-talk" : "fl-talk hi";
  if (turns.length) Object.assign(node.dataset, { keep: "files-talk", follow: "1" });
  else for (const k of ["keep", "follow"]) delete node.dataset[k];
  node.dataset.sig = encodeURIComponent(feed.key);
  drawn.feed = feed;
  drawn.host = host;
  const chat = { feed, host, folds: useTurns.getState() };
  flushSync(() =>
    talk.root.render(
      <ChatContext value={chat}>
        {turns.length ? <Turns interrupting={interrupting} /> : <FirstTurns interrupting={interrupting} />}
      </ChatContext>,
    ),
  );
  return node;
}
