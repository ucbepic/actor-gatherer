// THE LIST, as the page around it draws it (features/list/list.js's renderAgents): its view-model handed to the list in
// React (AgentList.tsx), drawn into aside#agents at once -- so what the page does next (a box focused, a card placed, the
// rows slid into their places) finds it drawn.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { ListHost } from "./host";
import { AgentList } from "./AgentList";
import type { ListModel } from "./rows";
import { useList } from "./store";

let root: { box: HTMLElement; root: Root } | null = null;
let drawing = false;

/** The list drawn into `box` from `model`, by now. */
export function drawList(box: HTMLElement, model: ListModel, host: ListHost): void {
  drawing = true;
  try {
    flushSync(() => {
      useList.setState({ model, host });
      if (root?.box !== box) {
        root?.root.unmount();
        box.replaceChildren();
        root = { box, root: createRoot(box) };
        root.root.render(createElement(AgentList));
      }
    });
  } finally {
    drawing = false;
  }
}

/** Whether the list is being drawn now: a box of its taken out as it is (a row folded away) has not been left. */
export const listDrawing = (): boolean => drawing;
