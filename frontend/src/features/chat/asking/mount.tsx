// The cards for the old page's own drawing (features/chat/chat.js): under the other views' frames (chatCard), and for the
// views of the reader's own (agDashboard.askingNote, .errorNote). Each a node of its own, by what it is for (`id`: the
// actor, and which cards), the same from draw to draw -- the page's patch() leaves it where it is, and React changes in
// it only what changed, its focus and what is typed in it with it. The node is the card's box itself: its classes, role
// and name set here, as the card shown says -- so the page's CSS finds it where it was (`.asking-note + .composer`). A
// card answered or dismissed between the page's draws hides its box.
import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { cardOf, type CardKind } from "./ask";
import { useAnswers } from "./answers";
import { CardBody, shellOf, useCard, type CardProps } from "./Cards";

const KEPT = 24;
const boxes = new Map<string, { node: HTMLDivElement; root: Root }>();

function Boxed({ node, only, ...props }: CardProps & { node: HTMLDivElement; only?: CardKind }) {
  const kind = useCard(props.info, only);
  const shell = kind ? shellOf(kind, props) : null;
  useLayoutEffect(() => {
    for (const a of ["class", "role", "aria-label"]) node.removeAttribute(a);
    node.toggleAttribute("hidden", !shell);
    if (!shell) return;
    node.setAttribute("class", shell.className);
    node.setAttribute("role", shell.role);
    if (shell["aria-label"]) node.setAttribute("aria-label", shell["aria-label"]);
  });
  return kind ? <CardBody kind={kind} {...props} /> : null;
}

/** The card shown for the actor (of `only`), drawn now in its node, for the page to put where it goes; null for none. */
export function drawCards(id: string, props: CardProps, only?: CardKind): HTMLDivElement | null {
  const kind = cardOf(props.info, useAnswers.getState().seen);
  if (!kind || (only && kind !== only)) return null;
  let kept = boxes.get(id);
  if (kept) boxes.delete(id);
  else {
    const node = document.createElement("div");
    kept = { node, root: createRoot(node) };
  }
  boxes.set(id, kept);
  for (const [k, b] of boxes) {
    if (boxes.size <= KEPT) break;
    if (k === id || b.node.isConnected) continue;
    b.root.unmount();
    boxes.delete(k);
  }
  const { node, root } = kept;
  flushSync(() => root.render(<Boxed node={node} only={only} {...props} />));
  return node;
}
