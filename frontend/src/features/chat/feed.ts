// What Chat draws of an actor: what the page hands it for the actor (types.ts's PageFeed) with what Chat keeps of the
// actor itself (actors.ts) -- what was sent from here and the view does not have yet, the turn picked, the Esc sent and
// whether an Esc would interrupt it -- read again as that changes (ChatMain.tsx), not only as the page draws.
import { chatOf, type ActorChat } from "./actors";
import { canInterrupt, isInterrupting } from "./esc";
import type { ChatFeed, PageFeed } from "./types";

export function feedOf(
  page: PageFeed,
  own: ActorChat = chatOf(page.key),
  interrupting = isInterrupting(page.key, own.interrupting),
): ChatFeed {
  return {
    ...page,
    mine: own.sends.map(({ cid, text, at }) => ({ cid, text, at })),
    picked: own.picked,
    interrupting,
    canInterrupt: canInterrupt(page.key, page.info),
  };
}
