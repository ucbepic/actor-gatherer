// The Details panel (ag_dashboard/DESIGN.md, A5), drawn where the old page puts it, beside the chat (features/page/
// main-view.js's renderMain): the panel's `aside` a node of its own, its React root, the same from draw to draw -- the
// page's patch() finds it where it is and leaves it there, so what is open, scrolled or hovered in it stays. Drawn as the
// page draws, at once (flushSync), for the actor the page hands it; between the page's draws, it draws itself as what
// it shows changes (the read picked, its context fetched, the types shown). And, for code that builds nodes -- the
// reader's own views (agDashboard), the old page's views -- its parts, each a node of its own (core/ui/node.tsx).
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { viewFrame } from "../../core/ui/frame";
import { nodeOf } from "../../core/ui/node";
import { usePicked } from "./store";
import { ColumnsBody, ContextCardBody, FILTERS, ItemBody, SizeCardBody, TypeChipsBody, type CallsOf } from "./Context";
import { DetailsPanel } from "./Details";
import { Messages, type MsgFrame } from "./Messages";
import type { DetailsFeed, DetailsHost, Item, Read } from "./types";

const panels = new Map<string, { node: HTMLElement; root: Root }>();

/** The panel, drawn now for `feed.key` (each pane's its own: one for each actor shown): its node, for the page to put
 * where it goes. Those of actors no longer shown let go of, but the newest few. */
export function drawDetails(feed: DetailsFeed, host: DetailsHost): HTMLElement {
  let panel = panels.get(feed.key);
  if (panel) panels.delete(feed.key);
  else {
    const node = document.createElement("aside");
    node.className = "drawer";
    node.setAttribute("role", "complementary");
    node.setAttribute("aria-label", "Details");
    panel = { node, root: createRoot(node) };
  }
  panels.set(feed.key, panel);
  for (const [k, p] of panels) {
    if (panels.size <= 4) break;
    if (k === feed.key || p.node.isConnected) continue;
    p.root.unmount();
    panels.delete(k);
  }
  const { node, root } = panel;
  flushSync(() => root.render(<DetailsPanel key={feed.key} feed={feed} host={host} />));
  return node;
}

/** The Messages view's frame for `f.key` (core/ui/frame.tsx), drawn now: its node, for the page to put where it goes. */
export const drawMessages = (f: MsgFrame, name: string): HTMLDivElement =>
  viewFrame("messages", "ctx", name, <Messages key={f.key} f={f} />, f.key);

/** The actors the panes show now: the reads picked on their size charts kept, the others' let go of. */
export const detailsShown = (keys: string[]): void => usePicked.getState().shown(keys);

// The parts, as nodes (agDashboard's contextItem, columns, typeChips, contextCard and sizeCard).
const attrs = (a: Record<string, string>) => {
  const { className, ...rest } = a;
  return className ? { class: className, ...rest } : rest;
};
export const contextItemNode = (it: Item) => nodeOf("details", { class: "item" }, <ItemBody it={it} />);
export const columnsNode = () => nodeOf("div", { class: "cols" }, <ColumnsBody />);
export const typeChipsNode = (counts: Record<string, number> | null) =>
  nodeOf("div", attrs(FILTERS), <TypeChipsBody counts={counts} />);
export const contextCardNode = (calls: CallsOf) => nodeOf("section", { class: "card" }, <ContextCardBody {...calls} />);
export const sizeCardNode = (calls: CallsOf, reads: Read[], hasReal: boolean) =>
  nodeOf("section", { class: "card" }, <SizeCardBody {...calls} reads={reads || []} hasReal={!!hasReal} />);
