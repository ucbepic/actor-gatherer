// Esc, as in the harness's own terminal: the agent's turn interrupted -- the key typed into the session's terminal, which
// the dashboard runs. Only while it works or asks (an idle Claude Code takes Esc twice for its rewind; one starting, for
// "No" to trusting its folder), and once a second. And the message the harness took back on an Esc before any of its
// answer came (data.py's `taken_back`), put in Chat's message box as it is in the harness's own -- once.
import { post } from "../../core/api/client";
import { change, chatOf, viewAtWork } from "./actors";
import { viewOf } from "./data";
import { drafts, keepDraft } from "./drafts";
import type { Actor } from "./types";

/** "Interrupting…" shown at most this long, if the turn goes on. */
export const INTERRUPTING_MS = 10000;

/** Whether an Esc would interrupt the actor: its session's terminal the dashboard's, not starting, and the actor at work
 * or asking -- or its view says so (a turn opening, at work), or a message sent from here into its terminal is pending:
 * its turn under way before the dashboard has heard of it (the key waits for the message's Enter: sessions.py's `type`)
 * -- not into a terminal the message opened, which may ask first whether to trust the folder, where Esc is "No". Not a
 * build of its context, idle. */
export function canInterrupt(actor: string, info: Actor | null | undefined): boolean {
  const s = info?.session;
  return (
    !!info &&
    !!s &&
    !!s.terminal &&
    s.status !== "starting" &&
    (["running", "asking"].includes(info.status ?? "") || viewAtWork(actor) || chatOf(actor).sends.some((m) => m.ran))
  );
}

/** Esc typed into the actor's terminal, if it would interrupt it and none was sent within the second: true if sent.
 * `say`: a word on the page, the key not taken. */
export function interrupt(actor: string, info: Actor | null | undefined, say: (text: string) => void): boolean {
  const was = chatOf(actor).interrupting;
  if (!canInterrupt(actor, info) || (was !== null && Date.now() - was < 1000)) return false;
  change(actor, () => ({ interrupting: Date.now() }));
  post("/api/terminal/input", { session_id: info!.session!.session_id, data: "\u001b" }).catch((err: Error) => {
    change(actor, () => ({ interrupting: null }));
    say(`Not interrupted: ${err.message}`);
  });
  return true;
}

/** Whether an Esc sent for the actor is still taken to be stopping it: until it is over, or for INTERRUPTING_MS. */
export function isInterrupting(actor: string, at = chatOf(actor).interrupting): boolean {
  return at !== null && Date.now() - at < INTERRUPTING_MS;
}

/** The Esc sent is over: the turn it was sent for is. */
export const interruptOver = (actor: string): void => {
  if (chatOf(actor).interrupting !== null) change(actor, () => ({ interrupting: null }));
};

// The message the harness took back is in its input box untouched, as sessions.py's `took_back` reads it: what was last
// typed into its terminal, the dashboard's, is the key that stopped the turn, after the call before (`since`).
const takenBack = (actor: string, info: Actor | null | undefined) =>
  viewOf(actor)?.taken_back || info?.taken_back || null;

export function untouched(actor: string, info: Actor | null | undefined): boolean {
  const tb = takenBack(actor, info),
    s = info?.session;
  return !!tb && !!s && !!s.stopped_at && s.stopped_at > (tb.since || 0);
}

// What was put in the box, by the actor ({at, text}), kept in the tab as drafts are, so a reload does not put back what
// was cleared.
const REFILLED_KEY = "ag-dashboard-refilled";
const refilledHere: Record<string, { at?: number | null; text: string }> = {};
function refills(): Record<string, { at?: number | null; text: string }> {
  try {
    const v = JSON.parse(sessionStorage.getItem(REFILLED_KEY) ?? "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return refilledHere;
  }
}
function markRefill(actor: string, mark: { at?: number | null; text: string } | null) {
  const m = refills();
  if (mark) m[actor] = mark;
  else delete m[actor];
  try {
    sessionStorage.setItem(REFILLED_KEY, JSON.stringify(m));
  } catch {
    if (mark) refilledHere[actor] = mark;
    else delete refilledHere[actor];
  }
}

/**
 * The harness put the message it was stopped on (Esc before any of its answer came) back in its input box, out of the
 * conversation -- as Chat shows it too, the message in no turn. Untouched there: in this message box too, as the
 * actor's draft -- once, and only where nothing is written for the actor. Sent from here, the harness's box is emptied
 * first (sessions.py's `took_back`), so the two do not go as one. Once it is no longer there untouched -- sent or
 * changed in the terminal, or its process gone -- it is taken out of this box too, if it is still as it was put.
 * `boxed`: the page's own boxes for the actor (not React's, which show the draft) showing what was put or taken out.
 */
export function refill(actor: string, info: Actor | null | undefined, boxed: (text: string) => void = () => {}): void {
  const tb = takenBack(actor, info),
    mark = refills()[actor];
  if (tb && untouched(actor, info)) {
    if (mark && mark.at === tb.at) return;
    markRefill(actor, { at: tb.at, text: tb.text });
    if (drafts()[actor]) return;
    keepDraft(actor, tb.text);
    boxed(tb.text);
  } else if (mark) {
    markRefill(actor, null);
    if (drafts()[actor] !== mark.text) return;
    keepDraft(actor, "");
    boxed("");
  }
}
