// A call's line and a call opened, as Chat draws them (CallView.tsx), as nodes of their own for the old page's drawing
// (a minimized pane's history: features/chat/mini-history.js): drawn once, then let go of -- nothing in them listens
// (a Copy is the document's codeClick, by its data-copy).
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { CallLabel, CallView, Paths, shellCommand } from "./CallView";
import { firstLine } from "../../../core/format";
import type { CallRun } from "../types";

function nodeOf(element: ReactNode): Node {
  const box = document.createElement("div"),
    root = createRoot(box);
  flushSync(() => root.render(element));
  const node = box.firstChild!;
  root.unmount(); // its node kept: taken out of the box, whole
  return node;
}

/** A call's line: its words, or (a shell command) its command coloured. */
export const callLabelNode = (c: CallRun, n: number): Node | string =>
  shellCommand(c.call) === null || (c.call as { view: { description?: unknown } }).view.description
    ? firstLine(c.text, n)
    : nodeOf(<CallLabel c={c} n={n} />);

/** A call opened, and what it printed; paths read from `paths`. */
export const callViewNode = (call: unknown, ran: Partial<CallRun>, paths: { cwd: string; home: string }): Node =>
  nodeOf(
    <Paths value={paths}>
      <CallView call={call} ran={ran} />
    </Paths>,
  );
