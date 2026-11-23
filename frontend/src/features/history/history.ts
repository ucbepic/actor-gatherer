// THE HISTORY VIEW: the actor's history to look through and pick from -- its turns, grouped by the tasks ag split it into
// when the reader asks, each opening to its messages -- searched (history.py). What is picked is exported, or given to
// the Gatherer's model to summarize, or to make a memory or a skill of, with what the reader asks of it; what the model
// made is listed at the right, kept by the server (<home>/dashboard/extracts/). Drawn by React (its frame HistoryView.tsx,
// the panel Side.tsx), for the actor a pane shows; its outline fetched as data.ts says. Added among the panes' views (Chat's
// registry) through what the page hands it (setHistoryPage, src/links/history.ts): a feature's TypeScript may not import
// another feature (ag_dashboard/DESIGN.md's Rules).
import type { Home } from "../../core/api/types";
import { loadOutline, outlineOf, setHistHost } from "./data";
import { drawHistory, outlineSignature } from "./mount";

/** What a view draws from for a pane (Chat's feeds): its outline's events. The pane is the page's: History reads only
 * the key of its actor. */
export interface OutlineFeed<P> {
  load(p: P): Promise<unknown>;
  data(p: P): { items: unknown[]; pending: unknown[]; earlier: boolean } | null;
  signature(p: P): unknown;
}

/** The view, as it is added (Chat's views.ts), drawn for an actor (its key) as the home has it. */
export interface HistView {
  id: string;
  name: string;
  feed: string;
  frame: string;
  chat: false;
  icon: string;
  description: string;
  render(): Node[];
  mount(ctx: { actor: string; info: { cwd?: string | null; harness?: string | null } }): Node;
}

/** What History takes from the page around it. */
export interface HistoryPage<P = unknown> {
  readonly snapshot: boolean;
  readonly icons: Readonly<Record<string, string>>;
  home(): Home | null;
  /** the page paused: no polling then */
  paused(): boolean;
  /** a pane shows the History view */
  shown(): boolean;
  /** the actor a pane shows, by its key */
  paneKey(p: P): string | null;
  /** a feed and a view added among the panes' views */
  addFeed(name: string, feed: OutlineFeed<P>): void;
  addView(view: HistView): void;
}

let page: HistoryPage | null = null;
export const setHistoryPage = <P>(link: HistoryPage<P>): void => {
  page = link as HistoryPage;
};

/** What this module did as the page's script ran, in that order: main.ts runs it once every module is loaded. */
export function start(): void {
  const H = page!;
  // what its data asks of the page: the view shown, the page paused (no polling then)
  setHistHost({ shown: () => H.shown(), paused: () => H.paused() });
  H.addFeed("outline", {
    load: (p) => loadOutline(H.paneKey(p)),
    data: (p) => {
      const h = outlineOf(H.paneKey(p));
      return h ? { items: h.events, pending: [], earlier: false } : null;
    },
    signature: (p) => outlineSignature(H.paneKey(p)),
  });
  if (H.snapshot) return;
  H.addView({
    id: "history",
    name: "History",
    feed: "outline",
    frame: "hist",
    chat: false,
    icon: H.icons.history,
    description: "Search, export and summarize the history",
    render: () => [],
    mount: ({ actor, info }) =>
      drawHistory(
        {
          actor,
          home: H.home(),
          cwd: info.cwd || "",
          harness: info.harness || null,
          icons: H.icons as Record<string, string>,
          now: Date.now() / 1000,
        },
        "History",
      ),
  });
}

/** A value put in a URL's query (the list's modes.ts takes it from here). */
export const enc = encodeURIComponent;
