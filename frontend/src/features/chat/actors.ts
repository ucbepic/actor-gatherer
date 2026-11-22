// Chat's own state of each actor, by its key: what was sent from here that the server's view of the conversation does
// not have yet (`sends`: shown at once, by its id, until the view has it a moment later -- the dashboard keeps each from
// the moment it is sent), a send on its way, why the last one was not sent, the Esc sent for it, and the turn picked
// (its files and commands shown at the left; null: the latest, followed). What sends, interrupts and picks is an action
// here or beside it (send.ts, esc.ts); Chat (ChatMain.tsx, Controls.tsx, SendError.tsx) draws from it, and draws again as
// it changes -- each actor's its own, so several can be shown at once.
import { create } from "zustand";
import { viewOf } from "./data";
import { foldsOf, onPage } from "./store";
import { AT_WORK, cidsOf } from "./view";
import type { ChatView } from "./types";

/** A message sent from here: its id, its words, when (the page's ms), and whether into a terminal open already, at its
 * message box (sessions.py's `send`) -- not one it opens, which may ask first. */
export interface Send {
  cid: string;
  text: string;
  at: number;
  ran: boolean;
}

/** Why a message was not sent: the server's words, and whether its terminal's box could not take it (NotAtBox). */
export interface Failed {
  text: string;
  box?: unknown;
}

export interface ActorChat {
  sends: readonly Send[];
  sending: boolean;
  failed: Failed | null;
  /** when Esc was sent for it (the page's ms) */
  interrupting: number | null;
  /** the turn whose files and commands show: null, the latest */
  picked: number | null;
}

const NONE: ActorChat = { sends: [], sending: false, failed: null, interrupting: null, picked: null };

export const useActors = create<{ all: ReadonlyMap<string, ActorChat> }>()(() => ({ all: new Map() }));

/** The actor's Chat state now. */
export const chatOf = (actor: string): ActorChat => useActors.getState().all.get(actor) ?? NONE;

/** The actor's Chat state, drawn again as it changes. */
export const useActorChat = (actor: string): ActorChat => useActors((s) => s.all.get(actor) ?? NONE);

/** The actor's state changed as `how` says. */
export function change(actor: string, how: (c: ActorChat) => Partial<ActorChat>): void {
  useActors.setState((st) => {
    const c = st.all.get(actor) ?? NONE;
    return { all: new Map(st.all).set(actor, { ...c, ...how(c) }) };
  });
}

/** The sends from here the actor's view has now taken: shown as the view has them, no longer as sent. */
export function viewTaken(actor: string, view: ChatView | null): void {
  const has = cidsOf(view),
    sends = chatOf(actor).sends;
  if (sends.some((m) => has.has(m.cid))) change(actor, (c) => ({ sends: c.sends.filter((m) => !has.has(m.cid)) }));
}

/** A turn picked, its files and commands shown (null: the latest, followed again). */
export const pickTurn = (actor: string, n: number | null): void => {
  if (chatOf(actor).picked !== n) change(actor, () => ({ picked: n }));
};

/** A turn picked in the conversation shown (its files come with it): the file picked in the turn before let go of, and
 * the turn drawn if it is above the first drawn -- then shown, its files and commands at the left. */
export function showTurn(actor: string, n: number | null): void {
  if (onPage(actor)) {
    const t = foldsOf(actor).getState();
    t.pick(null);
    if (n !== null && t.first !== null && n < t.first) t.setFirst(n);
  }
  pickTurn(actor, n);
}

/** The actor at work as its view has it: a turn opening (the session has it), working or asking. */
export function viewAtWork(actor: string): boolean {
  const v = viewOf(actor);
  return !!v && AT_WORK.has(v.current.state) && !(v.opening && v.opening.unseen);
}

/** A turn its session opened that ag has not stored yet: the harness has its message (the view's opening, `seen`). */
export function opened(actor: string): boolean {
  const v = viewOf(actor);
  return !!v?.opening?.seen;
}
