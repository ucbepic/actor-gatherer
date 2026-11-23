// A PANE'S CARD (section.chat): its view's frame, then -- for the conversation -- what the agent asks, what runs in the
// background, and the message box with the line under it (or the line saying it cannot be messaged here), and the view's
// footer. React's: one root for each pane, the section itself, the same node from draw to draw -- the page's patch()
// leaves it where it is (it is the node it put there, and its data-sig says so) -- drawn as the page draws the pane
// (chat.ts's chatCard), at once. A view switched, or the pane minimized, draws the same card again: its parts change in
// place, the message box kept where it is (its focus, its caret).
//
// The parts it draws are React's (the cards, the background, the lines, the box); the frame (a view's own: each a node
// of its own, React's too, kept per actor -- mount.tsx, core/ui/frame.tsx) and what a view of the reader's own makes (its
// message box, its footer, a minimized pane's lines and avatar) are nodes made outside it, put in their places among
// them after each draw: the frame first, a view's own message box before the line under it, the footer last.
import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { BackgroundNote } from "./Background";
import { Cards, type CardProps } from "./asking/Cards";
import { ComposerForm, type ComposerProps } from "./Composer";
import type { Pane } from "./link";
import { SendError, type SendErrorProps } from "./SendError";
import type { Actor } from "./types";

/** What a card is drawn with (chat.ts makes it from the pane's view). */
export interface CardParts {
  /** the pane minimized: the card a strip (.chat.mini) */
  mini: boolean;
  /** its name: the actor's harness and group */
  label: string;
  /** the view's frame; none minimized */
  frame: Node | null;
  /** what the agent asks, or the call it stopped on */
  cards: CardProps | null;
  /** what runs in the background, of this actor */
  background: Actor | null;
  /** the line saying the actor cannot be messaged here, and its tooltip (the whole reason); null: none */
  readOnly: string | null;
  /** the message box: the page's own, or a view's own (its nodes) */
  composer: ComposerProps | null;
  ownComposer: Node[] | null;
  /** the line under the box */
  err: SendErrorProps | null;
  /** the view's footer */
  footer: Node[];
  /** whatever the view drew that sends (data-send), off: held by another process (its boxes too), or a send on its way */
  off: { held: boolean; sending: boolean };
}

/** The nodes made outside the card, as put in it: the frame, a view's own message box, the footer. */
export interface Placed {
  frame: Node | null;
  own: Node[];
  footer: Node[];
}
export const NONE_PLACED: Placed = { frame: null, own: [], footer: [] };

/** Each of `now` -- or, where the one put there last (`was`, at its place) is the same, that one: kept, with what the
 * reader did to it (typed in it, hovered it), as the page's patch() kept a node that had not changed. */
const keptOf = (was: readonly Node[], now: readonly Node[]): Node[] =>
  now.map((n, i) => (was[i] && was[i] !== n && was[i].parentNode && was[i].isEqualNode(n) ? was[i] : n));

/** The nodes made outside the card put in their places (see above), those of the last draw no longer in it taken out:
 * what is put now. A node already in its place stays where it is. */
export function place(section: Element, parts: CardParts, errLine: Element | null, was: Placed): Placed {
  const own = keptOf(was.own, parts.ownComposer || []),
    footer = keptOf(was.footer, parts.footer);
  const now = [parts.frame, ...own, ...footer].filter((n): n is Node => !!n);
  for (const n of [was.frame, ...was.own, ...was.footer])
    if (n && !now.includes(n) && n.parentNode === section) section.removeChild(n);
  if (parts.frame && section.firstChild !== parts.frame) section.insertBefore(parts.frame, section.firstChild);
  let before: Node | null = errLine;
  for (const n of [...own].reverse()) {
    if (n.parentNode !== section || n.nextSibling !== before) section.insertBefore(n, before);
    before = n;
  }
  const tail = [...section.childNodes].slice(-footer.length);
  if (footer.length && footer.some((n, i) => tail[i] !== n)) for (const n of footer) section.appendChild(n);
  return { frame: parts.frame, own, footer };
}

function Card({ section, parts }: { section: HTMLElement; parts: CardParts }) {
  const err = useRef<HTMLDivElement>(null),
    placed = useRef<Placed>(NONE_PLACED);
  useLayoutEffect(() => {
    placed.current = place(section, parts, err.current, placed.current);
    const { held, sending } = parts.off;
    if (held || sending)
      for (const n of section.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>("[data-send], #composer-text"))
        if (held || n.matches("[data-send]")) n.disabled = true;
  });
  return (
    <>
      {parts.cards ? <Cards {...parts.cards} /> : null}
      {parts.background ? <BackgroundNote info={parts.background} /> : null}
      {parts.readOnly !== null ? (
        <div className="readonly" title={parts.readOnly}>
          Read only. Can&apos;t be messaged from here.
        </div>
      ) : null}
      {parts.composer ? <ComposerForm key={parts.composer.actor} {...parts.composer} /> : null}
      {parts.err ? <SendError ref={err} {...parts.err} /> : null}
    </>
  );
}

const cards = new WeakMap<Pane, { node: HTMLElement; root: Root }>();
let made = 0;

/** Pane `p`'s card, drawn now with `parts`: its node, for the page to put where it goes. */
export function drawCard(p: Pane, parts: CardParts): HTMLElement {
  let card = cards.get(p);
  if (!card) {
    const node = document.createElement("section");
    node.dataset.sig = `card-${++made}`; // the page's patch() keeps it while it is the node there
    card = { node, root: createRoot(node) };
    cards.set(p, card);
  }
  const { node, root } = card;
  node.className = "chat" + (parts.mini ? " mini" : "");
  node.setAttribute("aria-label", parts.label);
  flushSync(() => root.render(<Card section={node} parts={parts} />));
  return node;
}
