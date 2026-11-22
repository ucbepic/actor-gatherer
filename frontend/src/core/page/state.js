"use strict";
// what the context's groups are (core/model/items.ts): the page's other modules import them from here
import { GROUP_ORDER, NOT_COUNTED, PREAMBLE, label, uncounted } from "../model/items";
const SNAPSHOT = window.AG_SNAPSHOT ?? null;            // a snapshot's data (index.html), or none
// No pane is the page again in a frame any more (every pane is a part of this page: features/layout/panes.js); PANE,
// what a frame's page had of the page around it, is none -- kept only for the list's modules that still ask, till they
// are rewritten.
const PANE = null;
// The server pushes each change (/api/stream); this is only how often the "ago" texts are redrawn.
const AGO_MS = 30000;
let state = { home: null, selected: null, paused: false, stream: null,
  adding: null,         // the form open in the agent list: {gatherer: ""} a new gatherer's, {gatherer: G} a new session's in G
  renaming: null,       // the actor being named in the list: {g, c, value (as typed so far), was (its name before)}; a
                        // task or an app: c its item, kind, auto (features/list/list.js's startItemRename); the gatherer: c null
  // the page's own pane's actor's calls, as the list's select() lets them go for another actor: each pane keeps its own
  // (features/layout/panes.js's makePane)
  get agent() { return panes.here ? panes.here.agent : null; },
  set agent(v) { if (panes.here) panes.here.agent = v; },
  get agentVersion() { return panes.here ? panes.here.agentVersion : 0; },
  set agentVersion(v) { if (panes.here) panes.here.agentVersion = v; } };
// The actors open side by side (panes, below): this page's own pane (`here`, its actor state.selected), the first, and
// the others (`others`), each a pane of this page too, its actor its own (the one in focus: the layout model's,
// panes.js's focusedPane). `checked`: the panes kept in this browser opened again. `top`: the panes' heads' height.
const MAX_PANES = 4;
const panes = { here: null, others: [], checked: false, top: null };

export {
  AGO_MS, GROUP_ORDER, MAX_PANES, NOT_COUNTED, PANE, PREAMBLE, SNAPSHOT, label, panes, state,
  uncounted,
};
