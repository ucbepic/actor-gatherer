// A view drawn by React for code that builds nodes -- the reader's own views (agDashboard's helpers), the old page's --
// in a node of its own: the node its root, so its events reach React wherever the node is put.
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/** `element` drawn at once inside a new `tag` with `attrs` (its outside, as the element would have drawn it). */
export function nodeOf<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  element: ReactNode,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  const root = createRoot(node);
  flushSync(() => root.render(element));
  return node;
}
