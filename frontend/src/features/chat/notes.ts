// The cards under an actor's history, as nodes for the views of the reader's own (agDashboard.askingNote, .errorNote):
// the model call its turn stopped on, or keeps failing on; what the agent waits on the user for (answered here where the
// dashboard runs its terminal, unless `answerable` is false: a view to read by); an answer recorded otherwise than
// picked. React's (asking/), each a node of its own kept from draw to draw; null while there is none. A pane's card
// draws them itself (card.tsx).
import { askWhere as askWhereOf, type Ask, type CardKind } from "./asking/ask";
import type { CardProps } from "./asking/Cards";
import { drawCards } from "./asking/mount";
import { CHAT_HOST } from "./host";
import { P } from "./link";
import type { Actor } from "./types";
import { CHAT_VIEWS } from "./views";

/** What the cards draw from for the actor, as the page has it now. */
export const cardsOf = (info: Actor, answerable: boolean): CardProps => ({
  info,
  home: P().home(),
  answerable,
  snapshot: P().snapshot,
  terminalView: CHAT_VIEWS.has("terminal"),
  host: CHAT_HOST,
});

/** The card shown for the actor (`only`: that card alone), as a node; null while there is none. */
const cardNode = (info: Actor | null | undefined, answerable = true, only?: CardKind): HTMLDivElement | null =>
  !info ? null : drawCards(`${info.channel}\u0000${only || ""}\u0000${answerable}`, cardsOf(info, answerable), only);

export const askingNote = (info: Actor | null | undefined, answerable = true) => cardNode(info, answerable, "asking");
export const errorNote = (info: Actor | null | undefined) => cardNode(info, true, "error");
export const answeredNote = (info: Actor | null | undefined) => cardNode(info, true, "answered");

/** Where what an actor asks is answered (asking/ask.ts): from the page, or in its terminal only. */
export const askWhere = (info: Actor, ask: Ask) => askWhereOf(info, ask, P().home(), P().snapshot);
