// What the Details panel draws from (ag_dashboard/DESIGN.md, A5): what ag recorded of an actor's calls (/api/agent,
// the stream's `agent`: data.py's `agent`), the context one of them sent (/api/context: data.py's `context`), and what
// the page hands it for the actor (DetailsFeed) -- the actor as the home has it, the history's other views.
import type * as api from "../../core/api/types";
import type { Home } from "../../core/api/types";

// What ag recorded of an actor's calls and the context one sent, as generated from the server's schema
// (core/api/types.ts).
export type { Build, Context, HistoryItem, Item, Llm, LlmRow, Usage, UsageEntry } from "../../core/api/types";

/** A model call ag answered (a read) and its sizes -- with `counted_tokens`, ag's count of all it sent, made by the page
 * as it takes the actor (data.js's takeAgent). */
export type Read = api.Read & { counted_tokens?: number | null };

/** What ag recorded of an actor's calls (data.py's `agent`), its reads as the page has them. */
export type Agent = Omit<api.Agent, "reads"> & { reads: Read[] };

/** The actor as the home has it. */
export type ActorInfo = api.Actor;

/** A view of the history the panel offers (`more`: chat/views.js's). */
export interface ViewChoice {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

/** What the page hands the panel for the actor it is drawn for (`key`). */
export interface DetailsFeed {
  key: string;
  info: ActorInfo;
  /** what ag recorded of its calls, as the page has it (null: not loaded; {error}: there was none to give) */
  agent: Agent | api.Failed | null;
  home: Home | null;
  snapshot: boolean;
  /** the history's other views, and the one shown */
  views: ViewChoice[];
  current: string;
  /** when the page draws it (seconds): a build still running lasts until then */
  now: number;
}

/** What the panel calls of the page. */
export interface DetailsHost {
  /** a view picked: shown in place of the chat, the panel closed */
  showView(id: string): unknown;
}
