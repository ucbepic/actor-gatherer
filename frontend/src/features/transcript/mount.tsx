// The Transcript view (ag_dashboard/DESIGN.md, A5) in its frame (core/ui/frame.tsx), for the actor the page hands it: its
// blocks kept by what they are from one draw to the next, so a call opened stays open as the transcript grows. And, for
// the reader's own views (agDashboard's transcriptBlocks, foldedOutput, notesSwitch), its parts, each a node of its own.
import { nodeOf } from "../../core/ui/node";
import { viewFrame } from "../../core/ui/frame";
import { FoldedOutput } from "./calls";
import { transcriptBlocks, type TxItem } from "./blocks";
import {
  BlockBody,
  NOTES_TITLE,
  NotesSwitchBody,
  Transcript,
  blockClass,
  useNotes,
  type TxFrame,
} from "./TranscriptView";

/** The view's frame for `f.key`, drawn now: its node, for the page to put where it goes. */
export const drawTranscript = (f: TxFrame, name: string): HTMLDivElement =>
  viewFrame("transcript", "term", name, <Transcript key={f.key} f={f} />, f.key);

/** The switch for the system messages and ag's notes, as a node (the view's tools, in the pane's head). */
export const notesSwitchNode = (): HTMLLabelElement => nodeOf("label", { title: NOTES_TITLE }, <NotesSwitchBody />);

/** The transcript's blocks for `items`, each a node of its own; `cwd`, where paths are shown from. */
export const transcriptBlockNodes = (items: TxItem[], running: boolean, cwd = ""): HTMLDivElement[] =>
  transcriptBlocks(items, running, useNotes.getState().on).map((b) =>
    nodeOf("div", { class: blockClass(b) }, <BlockBody b={b} cwd={cwd} />),
  );

/** A result folded to its first lines, as a node. */
export function foldedOutputNode(text: unknown, id: string, cls = ""): Element {
  const box = nodeOf("div", {}, <FoldedOutput text={text} id={id} cls={cls} />);
  return box.firstElementChild!;
}
