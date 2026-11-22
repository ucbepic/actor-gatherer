// The page's state, which its modules share: its own fields in a store (core/store/page.ts), read and set as
// `state.<field>`; its own pane's actor's calls (`state.agent`, that pane's own); the panes open side by side.
import { usePage } from "../store/page";
import type { AgentCalls, PageFields, PageState, Panes, Snapshot } from "./types";
// what the context's groups are (core/model/items.ts): the page's other modules import them from here
export { GROUP_ORDER, NOT_COUNTED, PREAMBLE, label, uncounted } from "../model/items";

/** A snapshot's data (index.html), or none. */
export const SNAPSHOT: Snapshot | null = (window as unknown as { AG_SNAPSHOT?: Snapshot | null }).AG_SNAPSHOT ?? null;
// No pane is the page again in a frame any more (every pane is a part of this page: features/layout/panes.js); PANE,
// what a frame's page had of the page around it, is none -- kept only for the list's modules that still ask, till they
// are rewritten.
export const PANE = null;
/** The server pushes each change (/api/stream); this is only how often the "ago" texts are redrawn. */
export const AGO_MS = 30000;

// The actors open side by side: this page's own pane (`here`, its actor state.selected), the first, and the others
// (`others`), each a pane of this page too, its actor its own (the one in focus: the layout model's, panes.js's
// focusedPane); the apps' panels above them (`apps`, panes.js's). `checked`: the panes kept in this browser opened again.
// `top`: the panes' heads' height.
export const MAX_PANES = 4;
export const panes: Panes = { here: null, others: [], apps: [], checked: false, top: null };

const field = <K extends keyof PageFields>(k: K) => ({
  get: (): PageFields[K] => usePage.getState()[k],
  set: (v: PageFields[K]) => usePage.setState({ [k]: v } as Pick<PageFields, K>),
  enumerable: true,
});
const fields: (keyof PageFields)[] = [
  "home",
  "selected",
  "paused",
  "stream",
  "adding",
  "renaming",
  "folderEdit",
  "starting",
];

/** The page's state: each of its own fields the store's (core/store/page.ts); `agent`, the calls of its own pane's
 * actor, as the list's select() lets them go for another actor -- each pane keeps its own (pane-view.ts's makePane). */
export const state = Object.defineProperties({} as PageState, {
  ...Object.fromEntries(fields.map((k) => [k, field(k)])),
  agent: {
    get: (): AgentCalls | null => (panes.here ? panes.here.agent : null),
    set: (v: AgentCalls | null) => {
      if (panes.here) panes.here.agent = v;
    },
    enumerable: true,
  },
  agentVersion: {
    get: (): number => (panes.here ? panes.here.agentVersion : 0),
    set: (v: number) => {
      if (panes.here) panes.here.agentVersion = v;
    },
    enumerable: true,
  },
});
