// A view's frame (#chat-list) drawn by React, for a view of the old page's chat card (features/chat/chat.js's chatCard,
// through the view's `mount`): one node for each view of each actor shown (each pane its own), its React root, the same
// from draw to draw -- the page's patch() finds it where it is and leaves it there, so what is open or scrolled in it
// stays -- drawn at once (flushSync), as the page draws, so its keepingPlace() keeps the frame's place around the draw
// and follows its end.
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

const frames = new Map<string, { node: HTMLDivElement; root: Root }>();
/** The frames kept drawn off the page, the newest: one shown again is as it was. An older one is unmounted. */
export const FRAMES_KEPT = 24;

/** The frame of the view `id` for actor `of` (`cls` its frame's class, `name` its name), `element` drawn in it now: its
 * node. */
export function viewFrame(id: string, cls: string, name: string, element: ReactNode, of = ""): HTMLDivElement {
  const k = `${id}\u0000${of}`;
  let frame = frames.get(k);
  if (frame)
    frames.delete(k); // (the newest last)
  else {
    const node = document.createElement("div");
    node.className = `chat-frame ${cls}`;
    node.id = "chat-list";
    Object.assign(node.dataset, { keep: "chat-list", follow: "1" });
    node.setAttribute("role", "log");
    node.setAttribute("aria-label", `Chat history, ${name}`);
    frame = { node, root: createRoot(node) };
  }
  frames.set(k, frame);
  for (const [o, f] of frames) {
    if (frames.size <= FRAMES_KEPT) break;
    if (o === k || f.node.isConnected) continue;
    f.root.unmount();
    frames.delete(o);
  }
  const { node, root } = frame;
  flushSync(() => root.render(element));
  return node;
}
