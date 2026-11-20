// Sending a message to an actor, from any view's message box: what is typed goes to its session (POST /api/send), shown
// at once by its id (actors.ts's `sends`) until the server's view has it; the box emptied, and on a failure the words
// put back as the actor's draft (unless something new was typed meanwhile) and why said under the box (SendError.tsx).
// A "/" command of the harness's own is not shown pending: what it does (a dialog, a report) is drawn in the session's
// terminal and may never come back as a message -- the terminal shown once the session has one. What it needs of the
// page it is sent from is handed to it (`SendFrom`).
import { post } from "../../core/api/client";
import { parse } from "../../core/model/keys";
import { change, chatOf, type Send } from "./actors";
import { drafts, keepDraft } from "./drafts";
import type { Actor } from "./types";

/** What a send needs of the page it is sent from. */
export interface SendFrom {
  /** the actor as the page has it now: its session, if the dashboard runs one */
  info: Actor;
  /** another process has its session open: nothing sent from here */
  held: boolean;
  /** one of the dashboard's own commands (`/context`), done by the page: true, and not sent */
  command(text: string): boolean;
  /** what a terminal the message opens is opened with: full screen or not, its size */
  opens(): Record<string, unknown>;
  /** sent: the page's data loaded again */
  sent(): Promise<unknown>;
  /** the Terminal view shown, a "/" command having opened the session's terminal; null: no Terminal view */
  toTerminal: (() => Promise<unknown>) | null;
  /** the page's own message boxes for the actor (not React's) showing `text`: emptied, or the words put back */
  boxed(text: string): void;
  /** the controls of a view's own that send (data-send) off while a message is on its way, and on again */
  sending(on: boolean): void;
}

/** A send's id: random (crypto.randomUUID is only there in a secure context: else the time and a random part). */
function newCid(): string {
  try {
    return "page:" + crypto.randomUUID();
  } catch {
    return `page:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** `text` sent to `actor`: true once sent (or done here, a command of the dashboard's), false if not. */
export async function send(actor: string, text: unknown, from: SendFrom): Promise<boolean> {
  const t = String(text ?? "").trim();
  if (from.command(t)) {
    from.boxed("");
    keepDraft(actor, "");
    return true;
  }
  if (!t || chatOf(actor).sending || from.held) return false;
  const slash = t.startsWith("/");
  const mine: Send | null = slash
    ? null
    : { cid: newCid(), text: t, at: Date.now(), ran: !!from.info.session?.terminal };
  const cid = mine?.cid ?? newCid();
  const was = drafts()[actor] ?? "";
  change(actor, (c) => ({
    sending: true,
    failed: null,
    interrupting: null,
    sends: mine ? [...c.sends, mine] : c.sends,
  }));
  from.sending(true);
  from.boxed("");
  keepDraft(actor, "");
  const { group: gatherer, id: channel } = parse(actor);
  const s = from.info.session;
  try {
    const opens = from.opens();
    const got = await post<{ terminal?: unknown }>(
      "/api/send",
      s ? { session_id: s.session_id, text: t, cid, ...opens } : { gatherer, channel, text: t, cid, ...opens },
    );
    if (slash && got?.terminal && from.toTerminal) {
      await from.toTerminal();
      return true;
    }
    await from.sent();
    return true;
  } catch (e) {
    if (mine) change(actor, (c) => ({ sends: c.sends.filter((m) => m !== mine) }));
    // not sent: back as the actor's draft, unless something new was typed for it meanwhile
    if (!drafts()[actor]) {
      keepDraft(actor, was);
      from.boxed(was);
    }
    const err = e as Error & { box?: unknown };
    change(actor, () => ({ failed: { text: err.message, box: err.box } }));
    return false;
  } finally {
    change(actor, () => ({ sending: false }));
    from.sending(false);
  }
}
