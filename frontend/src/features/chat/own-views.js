import { SNAPSHOT } from "../../core/page/state.js";
import {
  ago, clock, compact, el, full, get, harnessBadge, harnessLogo, harnessName, itemType, svgEl,
} from "../../core/page/helpers.js";
import { drawingPane, paneInfo } from "../page/pane-view.js";
import { statusOf } from "../list/seen.js";
import { askingNote, backgroundNote, errorNote } from "./chat.js";
import { callsNow } from "../page/main-view.js";
import { columnsNode, contextCardNode, contextItemNode, sizeCardNode, typeChipsNode } from "../details/mount";
import { foldedOutputNode, notesSwitchNode, transcriptBlockNodes } from "../transcript/mount";
import { markdown } from "../../core/ui/md";
import { firstLine, plural } from "../../core/format";
import { addChatView } from "./views.js";
import { actorLogo } from "../apps/app-actors.js";

// ------------------------------------------------------------------ the reader's own views
// What a view gets to draw with -- and, for one in a file of its own, how it adds itself.
// (set as the page starts, below: what every view is drawn with is there by then)
let agDashboard = null;
// The reader's own views: each file in <home>/dashboard/views/, loaded once the page is up. One that
// does not load, or throws, is reported and left out.
async function loadOwnViews() {
  if (SNAPSHOT) return;
  let names;
  try { names = await get("/api/views"); } catch (err) { return; }
  for (const name of names) {
    await new Promise((done) => {
      const tag = document.createElement("script");
      tag.src = `/views/${encodeURIComponent(name)}`;
      tag.onload = done;
      tag.onerror = () => { console.error(`chat view ${name}: not loaded`); done(); };
      document.head.append(tag);
    });
  }
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  agDashboard = window.agDashboard = Object.freeze({
    chatView: addChatView,
    el, svgEl, markdown, clock, ago, full, compact, plural, firstLine,
    contextItem: contextItemNode, columns: columnsNode, typeChips: typeChipsNode, itemType,
    transcriptBlocks: (items, running) => transcriptBlockNodes(items, running, (paneInfo(drawingPane()) || {}).cwd || ""),
    foldedOutput: foldedOutputNode, notesSwitch: notesSwitchNode, sizeCard: (reads, hasReal) => sizeCardNode(callsNow(), reads, hasReal), contextCard: () => contextCardNode(callsNow()),
    statusOf, harnessName, harnessLogo, harnessBadge, actorLogo, backgroundNote, askingNote, errorNote,
  });
}

export { agDashboard, loadOwnViews };
