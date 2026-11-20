// What Chat shows of each actor, as the stream says it: the server's view of its conversation (the stream's `chat`, or a
// pane's `actor`: chat_view.py's view, ag_dashboard/CHAT_VIEW.md), by the actor's key. The one place its turns come from
// once the stream has sent them (`turnsOf`); the files and commands of a turn are fetched beside it (files.ts), when a
// view says the turns moved on. Kept for the actors shown lately, so one shown again is drawn at once as it was last.
import { create } from "zustand";
import type { ChatView, FilesData, Turn } from "./types";

/** How many actors' views are kept: those shown lately, the one shown last last. */
export const KEPT_ACTORS = 12;

/** A view taken, and which it is: each one taken counts on (`seq`), so the page's change checks compare a number, not
 * the view. `view` null: the server could not make one (its `error`). */
export interface Taken {
  view: ChatView | null;
  seq: number;
}

interface ChatData {
  views: ReadonlyMap<string, Taken>;
  /** the actor's view, as the stream sent it: put last, as the actor shown latest */
  take: (actor: string, view: ChatView | null) => void;
}

let taken = 0;

export const useChatData = create<ChatData>()((set) => ({
  views: new Map(),
  take: (actor, view) =>
    set((st) => {
      const views = new Map(st.views);
      views.delete(actor);
      views.set(actor, { view, seq: ++taken });
      for (const k of views.keys()) {
        if (views.size <= KEPT_ACTORS) break;
        if (k !== actor) views.delete(k);
      }
      return { views };
    }),
}));

/** A view as the stream sends it: none for one the server could not make. */
export const viewOrNone = (got: unknown): ChatView | null => {
  const v = got as (ChatView & { error?: unknown }) | null;
  return v && !v.error && v.current ? v : null;
};

/** The actor's view as last taken; null before one came (or the server could not make it). */
export const viewOf = (actor: string): ChatView | null => useChatData.getState().views.get(actor)?.view ?? null;

/** Which view of the actor's was taken last (0: none yet): what changes when it does. */
export const viewSeq = (actor: string): number => useChatData.getState().views.get(actor)?.seq ?? 0;

/** The actor's turns: its view's -- before one came (the page not streaming: paused), those its files were fetched with. */
export const turnsOf = (actor: string, files: FilesData | null): Turn[] => viewOf(actor)?.turns ?? files?.turns ?? [];

/** Where a conversation's turns are: how many, and how far the latest has got -- the same for turns the same as far as
 * their files and commands go (files.ts compares it to know a turn's files are stale). */
export function stampOf(turns: readonly Turn[]): string {
  const t = turns.length ? turns[turns.length - 1] : null;
  return t ? `${turns.length}:${t.row_id ?? ""}:${t.end ?? ""}:${t.calls ?? 0}:${(t.replies || []).length}` : "0";
}
