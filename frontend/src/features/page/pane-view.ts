// ------------------------------------------------------------------ an actor's pane
// Each actor's pane is a part of this page (features/layout/pane.ts: its head and its main view), drawn from the page's
// one stream and store for the actor it is given (main-view.ts's renderPane) -- no frame, no second copy of the page.
// Its RECORD (core/page/types.ts's Pane), kept by the panes (core/page/state.ts's `panes`: this page's own, `here`,
// then the others beside it): its parts; its actor (`g`, `c` -- this page's own pane's is the page's selection,
// state.selected, which the list sets); and what it shows of it -- the view picked (`view`), Details open beside it
// (`details`), what ag recorded of the actor's calls (`agent`, drawn again when `agentVersion` moves on), Chat's files
// feed (`files`), the send its message box calls (`chatSend`: the latest draw's, which knows the session as it is then),
// its width among the panes (`size`), and what was last drawn in it (`drawn`: its view's signature and its head's).
import { SNAPSHOT, panes, state } from "../../core/page/state";
import { gathererNamed } from "../../core/page/home";
import { key } from "../../core/model/keys";
import type { At, PageActor, Pane, PaneParts } from "../../core/page/types";

/** A pane's record, made of its parts: this page's own (`here`, its actor the page's selection), or one beside it. */
export function makePane(
  parts: PaneParts,
  here: boolean,
  {
    g = null,
    c = null,
    view = null,
    size = 1,
  }: { g?: string | null; c?: string | null; view?: string | null; size?: number } = {},
): Pane {
  const p = Object.assign(parts, {
    here,
    size,
    view: view || "files",
    details: here && !!SNAPSHOT,
    agent: null,
    agentVersion: 0,
    files: null,
    chatSend: async () => false,
    drawn: { main: null, who: null },
  }) as Pane;
  if (here)
    Object.defineProperties(p, {
      g: { get: () => (state.selected ? state.selected[0] : null), enumerable: true },
      c: { get: () => (state.selected ? state.selected[1] : null), enumerable: true },
    });
  else Object.assign(p, { g, c });
  return p;
}
/** Every pane, this page's own first. */
export const allPanes = (): Pane[] => (panes.here ? [panes.here, ...panes.others] : []);
/** A pane's actor: [gatherer, channel], and its key; none before it has one (this page's, no actor yet). */
export const paneSel = (p: Pane | null | undefined): At | null => (p && p.g && p.c ? [p.g, p.c] : null);
export const paneKey = (p: Pane | null | undefined): string | null => (p && p.g && p.c ? key(p.g, p.c) : null);
/** A pane's actor as the home has it now. */
export const paneInfo = (p: Pane | null | undefined): PageActor | null => {
  if (!p || !p.c || !state.home) return null;
  return (gathererNamed(p.g) || { agents: [] as PageActor[] }).agents.find((x) => x.channel === p.c) || null;
};
/** The pane holding `node`, the one showing actor `c` of `g`, the one showing session `c` (whichever group): none. */
export const paneAt = (node: Node | null | undefined): Pane | null =>
  node ? allPanes().find((p) => p.node.contains(node)) || null : null;
export const paneOf = (g: string | null, c: string | null): Pane | null =>
  allPanes().find((p) => p.g === g && p.c === c) || null;
export const paneWith = (c: string | null): Pane | null => allPanes().find((p) => p.c === c) || null;
/** Its message box (the Chat view's, or another view's), if it shows one. */
export const paneBox = (p: Pane | null | undefined): HTMLTextAreaElement | null =>
  p ? p.main.querySelector<HTMLTextAreaElement>("textarea#composer-text") : null;
// The pane being drawn now -- what the reader's own views draw for (features/chat/own-views.js), the old page's helpers
// they call asking -- else the page's own.
let drawingNow: Pane | null = null;
export const drawingPane = (): Pane => (drawingNow || panes.here) as Pane;
/** `draw` run as pane `p`'s draw. */
export function drawingIn<T>(p: Pane, draw: () => T): T {
  const was = drawingNow;
  drawingNow = p;
  try {
    return draw();
  } finally {
    drawingNow = was;
  }
}
