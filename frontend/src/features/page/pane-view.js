import { SNAPSHOT, panes, state } from "../../core/page/state";
import { gathererNamed, key } from "../../core/page/helpers";

// ------------------------------------------------------------------ an actor's pane
// Each actor's pane is a part of this page (features/layout/pane.ts: its head and its main view), drawn from the page's
// one stream and store for the actor it is given (features/page/main-view.js's renderPane) -- no frame, no second copy of
// the page. Its RECORD, kept by the panes (core/page/state.js's `panes`: this page's own, `here`, then the others beside
// it): its parts; its actor (`g`, `c` -- this page's own pane's is the page's selection, state.selected, which the list
// sets); and what it shows of it -- the view picked (`view`), Details open beside it (`details`), what ag recorded of the
// actor's calls (`agent`, drawn again when `agentVersion` moves on), Chat's files feed (`files`), the send its message
// box calls (`chatSend`: the latest draw's, which knows the session as it is then), its width among the panes (`size`),
// and what was last drawn in it (`drawn`: its view's signature and its head's).
function makePane(parts, here, { g = null, c = null, view = null, size = 1 } = {}) {
  const p = Object.assign(parts, { here, size, view: view || "files", details: here && !!SNAPSHOT, agent: null,
    agentVersion: 0, files: null, chatSend: async () => false, drawn: { main: null, who: null } });
  if (here) Object.defineProperties(p, {
    g: { get: () => (state.selected ? state.selected[0] : null), enumerable: true },
    c: { get: () => (state.selected ? state.selected[1] : null), enumerable: true },
  });
  else Object.assign(p, { g, c });
  return p;
}
// Every pane, this page's own first.
const allPanes = () => (panes.here ? [panes.here, ...panes.others] : []);
// A pane's actor: [gatherer, channel], and its key; none before it has one (this page's, no actor yet).
const paneSel = (p) => (p && p.g && p.c ? [p.g, p.c] : null);
const paneKey = (p) => (p && p.g && p.c ? key(p.g, p.c) : null);
// A pane's actor as the home has it now.
const paneInfo = (p) => {
  if (!p || !p.c || !state.home) return null;
  return (gathererNamed(p.g) || { agents: [] }).agents.find((x) => x.channel === p.c) || null;
};
// The pane holding `node`, the one showing actor `c` of `g`, the one showing session `c` (whichever group): none.
const paneAt = (node) => (node ? allPanes().find((p) => p.node.contains(node)) || null : null);
const paneOf = (g, c) => allPanes().find((p) => p.g === g && p.c === c) || null;
const paneWith = (c) => allPanes().find((p) => p.c === c) || null;
// Its message box (the Chat view's, or another view's), if it shows one.
const paneBox = (p) => (p ? p.main.querySelector("textarea#composer-text") : null);
// The pane being drawn now -- what the reader's own views draw for (features/chat/own-views.js), the old page's helpers
// they call asking -- else the page's own.
let drawingNow = null;
const drawingPane = () => drawingNow || panes.here;
function drawingIn(p, draw) {
  const was = drawingNow;
  drawingNow = p;
  try { return draw(); } finally { drawingNow = was; }
}

export { allPanes, drawingIn, drawingPane, makePane, paneAt, paneBox, paneInfo, paneKey, paneOf, paneSel, paneWith };
