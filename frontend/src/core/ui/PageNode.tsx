// A node the old page builds -- nothing listening on it, nothing changing it after it is built -- drawn as React's own,
// for a view in React that shows it (Chat's turn list, the list of actors) until what builds it moves too.
import { createElement, type ReactNode } from "react";

const PROP: Record<string, string> = { class: "className", for: "htmlFor", tabindex: "tabIndex" };
const EMPTY = new Set(["img", "br", "hr", "input", "wbr"]);
const camel = (k: string) => (k.startsWith("--") ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));
const styleOf = (s: string) =>
  Object.fromEntries(
    s
      .split(";")
      .map((d) => d.split(/:(.*)/s))
      .filter(([k, v]) => k.trim() && v !== undefined)
      .map(([k, v]) => [camel(k.trim()), v.trim()]),
  );

/**
 * A node the old page builds -- nothing listening on it, nothing changing it after it is built: a call opened, a call's
 * line, a face, a Browser's message -- drawn as React's own: the same element, attributes and contents, its contents set
 * again only when they change. A text as it is; none, nothing.
 */
export function Html({ node }: { node: Node | string | null }): ReactNode {
  if (node === null) return null;
  if (typeof node === "string") return node;
  if (!(node instanceof Element)) return node.textContent;
  const props: Record<string, unknown> = {};
  for (const a of node.attributes) props[PROP[a.name] ?? a.name] = a.name === "style" ? styleOf(a.value) : a.value;
  const tag = node.tagName.toLowerCase();
  if (!EMPTY.has(tag)) props.dangerouslySetInnerHTML = { __html: node.innerHTML };
  return createElement(tag, props);
}
