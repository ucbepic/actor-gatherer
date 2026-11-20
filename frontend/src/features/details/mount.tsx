// The Details panel (ag_dashboard/DESIGN.md, A5), drawn where the old page puts it, beside the chat (features/page/
// main-view.js's renderMain): the panel's `aside` a node of its own, its React root, the same from draw to draw -- the
// page's patch() finds it where it is and leaves it there, so what is open, scrolled or hovered in it stays. Drawn as the
// page draws, at once (flushSync), for the actor the page hands it; between the page's draws, it draws itself as what
// it shows changes (the read picked, its context fetched, the types shown). And, for code that builds nodes -- the
// reader's own views (agDashboard), the old page's views -- its parts, each a node of its own (core/ui/node.tsx).
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { nodeOf } from "../../core/ui/node";
import { usePicked } from "./store";
import { ColumnsBody, ContextCardBody, FILTERS, ItemBody, SizeCardBody, TypeChipsBody, type CallsOf } from "./Context";
import { DetailsPanel } from "./Details";
import type { DetailsFeed, DetailsHost, Item, Read } from "./types";

let panel: { node: HTMLElement; root: Root } | null = null;

/** The panel, drawn now for `feed.key`: its node, for the page to put where it goes. Another actor's is drawn afresh. */
export function drawDetails(feed: DetailsFeed, host: DetailsHost): HTMLElement {
  if (!panel) {
    const node = document.createElement("aside");
    node.className = "drawer";
    node.setAttribute("role", "complementary");
    node.setAttribute("aria-label", "Details");
    panel = { node, root: createRoot(node) };
  }
  const { node, root } = panel;
  flushSync(() => root.render(<DetailsPanel key={feed.key} feed={feed} host={host} />));
  return node;
}

/** The actor shown now (the page's): the read picked on its size chart kept, another actor's let go of. */
export const detailsShown = (key: string): void => usePicked.getState().shown(key);

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
