// What was typed in an actor's message box and not sent, by actor (its key), kept in this browser tab (sessionStorage):
// its box, drawn again once the reader comes back from another actor or view, or reloads, starts with it. Read and
// written whole each time; and in a store, so a box drawn by React shows it as it changes
// (Composer.tsx) -- typed there, put back after a send that failed, taken out as sent, put in by an Esc's take-back.
import { create } from "zustand";

const DRAFTS_KEY = "ag-dashboard-drafts";
/** This page's own, where sessionStorage cannot be read */
const here: Record<string, string> = {};

/** Every actor's draft, as kept now. */
export function drafts(): Record<string, string> {
  try {
    const v = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) ?? "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return here;
  }
}

/** The drafts as last kept here: what a box drawn by React shows. */
export const useDrafts = create<{ all: Record<string, string> }>()(() => ({ all: drafts() }));

/** `text` kept as the actor's draft (none: its draft gone). */
export function keepDraft(actor: string | null | undefined, text: string): void {
  if (!actor) return;
  const d = drafts();
  if (text) d[actor] = text;
  else delete d[actor];
  try {
    sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(d));
  } catch {
    /* this page only: `here` */
  }
  useDrafts.setState({ all: { ...d } });
}
