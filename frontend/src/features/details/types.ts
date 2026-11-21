// What the Details panel draws from (ag_dashboard/DESIGN.md, A5): what ag recorded of an actor's calls (/api/agent,
// the stream's `agent`: data.py's `agent`), the context one of them sent (/api/context: data.py's `context`), and what
// the page hands it for the actor (DetailsFeed) -- the actor as the home has it, the history's other views.
import type { Home } from "../../core/api/types";

/** An item of a context, or of the history (data.py's `context` items): an event, ag's made item, a preamble's part. */
export interface Item {
  position?: number | null;
  group: string;
  name: string;
  tokens: number;
  row_id?: number | null;
  made_id?: number | null;
  at?: number | null;
  clipped?: number;
  text: string;
}

/** A model call ag answered (a read) and its sizes. `counted_tokens`: ag's count of all it sent, made by the page as
 * it takes the actor (data.js's takeAgent). */
export interface Read {
  read_id: number;
  at: number | null;
  row_id?: number | null;
  basis?: number | null;
  recorded_tokens?: number | null;
  est_tokens?: number | null;
  real_tokens?: number | null;
  limit_tokens?: number | null;
  sent_tokens?: number | null;
  preamble_tokens?: number | null;
  counted_tokens?: number | null;
  tasks: number;
  rebuild: boolean;
}

/** One kind of what all calls sent, added up (data.py's `_usage`). */
export interface UsageEntry {
  group: string;
  name: string;
  tokens: number;
  items: number;
}

export interface Usage {
  entries?: UsageEntry[];
  tokens: number;
  calls: number;
  real_tokens?: number;
  real_calls?: number;
  not_counted?: number;
}

/** A build of the actor's history (an analysis): why it started, how long it took, how it ended. */
export interface Build {
  build_id: number;
  status: string;
  started: number | null;
  finished: number | null;
  error?: string | null;
  reason?: string | null;
}

/** ag's own model calls for the actor, by what they were for. */
export interface LlmRow {
  purpose: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
  seconds: number;
  errors: number;
  cost: number | null;
  unpriced?: number;
  models: string[];
}

export interface Llm {
  by_purpose: LlmRow[];
  total: {
    calls: number;
    tokens_in: number;
    tokens_out: number;
    errors: number;
    cost: number | null;
    unpriced?: number;
  };
}

/** What ag recorded of an actor's calls (data.py's `agent`); `error` for a gatherer with no database yet. */
export interface Agent {
  error?: string;
  harness?: string | null;
  reads?: Read[];
  usage?: Usage;
  tasks: unknown[];
  builds?: Build[];
  checks: { new_task: boolean | null }[];
  rebuilds: number;
  llm: Llm;
  llm_attributed_by_time?: number;
  /** what the channel has since the latest call: the next call will carry it */
  after_read?: Item[];
  pending?: Item[];
}

/** The context a call sent (data.py's `context`), in order. */
export interface Context {
  read_id: number;
  at: number | null;
  items: Item[];
  tokens: number;
  real_tokens?: number | null;
  /** what the harness sent besides its messages, part by part */
  preamble?: Item[];
  not_counted?: number;
  basis?: number | null;
  cut?: number | null;
}

/** The actor as the home has it, as far as Details reads it. */
export interface ActorInfo {
  channel: string;
  harness?: string | null;
  cwd?: string | null;
  pid?: number | null;
  session?: { cwd?: string | null; terminal?: unknown; permission_mode?: string } | null;
}

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
  /** what ag recorded of its calls, as the page has it (null: not loaded) */
  agent: Agent | null;
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
