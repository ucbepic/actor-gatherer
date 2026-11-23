// Put `kids` in `parent`, keeping each node already there that is the same as its new one: the browser lays out again
// only what changed (a long transcript takes it a third of a second), and a kept node keeps its focus, its typed text and
// its scroll. Matched by position, as the chat grows at its end. A node marked data-morph with the same attributes is
// patched inside the same way; one marked data-sig (a message box) is kept while its data-sig is unchanged, whatever was
// typed in it. A node built with its children held apart (`kids`, the chat frame's: features/chat/chat.js) gets them
// here: it is one marked data-morph, or in one.

/** A node as the page builds it: its children, perhaps, held apart till it is put on the page. */
export type Built = Node & { kids?: Node[] | null };

const isEl = (n: Node): n is HTMLElement => n.nodeType === 1;

/** Node `n` with its children held apart put in it, and those of its children marked data-morph. */
export const fill = (n: Built): Node => {
  if (!isEl(n)) return n;
  const b = n as HTMLElement & Built;
  if (b.kids) {
    b.append(...b.kids);
    b.kids = null;
  }
  for (const c of n.children) if ("morph" in (c as HTMLElement).dataset) fill(c);
  return n;
};

/** `parent` made to hold `kids`, each node already in its place kept where it is the same. */
export function patch(parent: Node & ParentNode, kids: Built[]): void {
  const old = [...parent.childNodes];
  const same = (o: Element, n: Element) =>
    o.attributes.length === n.attributes.length && [...o.attributes].every((a) => n.getAttribute(a.name) === a.value);
  const final: Node[] = kids.map((n, i) => {
    const o = old[i];
    if (!o || o === n) return n;
    if (!isEl(o) || !isEl(n)) return o.isEqualNode(n) ? o : n;
    if ("sig" in o.dataset || "sig" in n.dataset)
      return o.dataset.sig === n.dataset.sig && o.tagName === n.tagName ? o : n;
    if ("morph" in o.dataset && o.tagName === n.tagName && same(o, n)) {
      patch(o, (n as Built).kids || [...n.childNodes]);
      return o;
    }
    return o.isEqualNode(fill(n)) ? o : n;
  });
  const was = new Set<Node>(old);
  for (const n of final) if (!was.has(n)) fill(n);
  if (final.some((n, i) => n !== old[i] && was.has(n))) {
    parent.replaceChildren(...final); // moved: drawn whole
    return;
  }
  final.forEach((n, i) => {
    if (i >= old.length) parent.append(n);
    else if (n !== old[i]) parent.replaceChild(n, old[i]);
  });
  for (const o of old.slice(final.length)) (o as ChildNode).remove();
}
