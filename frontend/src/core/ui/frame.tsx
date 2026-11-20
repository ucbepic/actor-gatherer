// A view's frame (#chat-list) drawn by React, for a view of the old page's chat card (features/chat/chat.js's chatCard,
// through the view's `mount`): one node for each view, its React root, the same from draw to draw -- the page's patch()
// finds it where it is and leaves it there, so what is open or scrolled in it stays -- drawn at once (flushSync), as the
// page draws, so its keepingPlace() keeps the frame's place around the draw and follows its end.
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

const frames = new Map<string, { node: HTMLDivElement; root: Root }>();

/** The frame of the view `id` (`cls` its frame's class, `name` its name), `element` drawn in it now: its node. */
export function viewFrame(id: string, cls: string, name: string, element: ReactNode): HTMLDivElement {
  let frame = frames.get(id);
  if (!frame) {
    const node = document.createElement("div");
    node.className = `chat-frame ${cls}`;
    node.id = "chat-list";
    Object.assign(node.dataset, { keep: "chat-list", follow: "1" });
    node.setAttribute("role", "log");
    node.setAttribute("aria-label", `Chat history, ${name}`);
    frame = { node, root: createRoot(node) };
    frames.set(id, frame);
  }
  const { node, root } = frame;
  flushSync(() => root.render(element));
  return node;
}
