// THE READER'S OWN VIEWS: what a view gets to draw with (`agDashboard`, window.agDashboard: how a view in a file of its
// own adds itself, views.ts's chatView, and the page's helpers -- markdown, times, counts, the context's and size cards,
// the Transcript's blocks, the cards under the history), and each file in <home>/dashboard/views/, loaded once the page
// is up. One that does not load, or throws, is reported and left out.
import { get } from "../../core/api/client";
import { ago, clock, compact, firstLine, full, plural } from "../../core/format";
import { itemType } from "../../core/model/items";
import { markdown } from "../../core/ui/md";
import { backgroundNote } from "./Background";
import { P } from "./link";
import { askingNote, errorNote } from "./notes";
import { addChatView } from "./views";

/** What a view draws with (see above); set as the page starts, once everything a view is drawn with is there. */
export let agDashboard: Readonly<Record<string, unknown>> | null = null;

declare global {
  interface Window {
    agDashboard?: Readonly<Record<string, unknown>>;
  }
}

/** The reader's own views, each a script of its own, loaded in order. */
export async function loadOwnViews(): Promise<void> {
  if (P().snapshot) return;
  let names: string[];
  try {
    names = await get<string[]>("/api/views");
  } catch {
    return;
  }
  for (const name of names)
    await new Promise<void>((done) => {
      const tag = document.createElement("script");
      tag.src = `/views/${encodeURIComponent(name)}`;
      tag.onload = () => done();
      tag.onerror = () => {
        console.error(`chat view ${name}: not loaded`);
        done();
      };
      document.head.append(tag);
    });
}

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  const r = P().reader;
  agDashboard = window.agDashboard = Object.freeze({
    chatView: addChatView,
    el: r.el,
    svgEl: r.svgEl,
    markdown,
    clock,
    ago,
    full,
    compact,
    plural,
    firstLine,
    contextItem: r.contextItem,
    columns: r.columns,
    typeChips: r.typeChips,
    itemType,
    transcriptBlocks: r.transcriptBlocks,
    foldedOutput: r.foldedOutput,
    notesSwitch: r.notesSwitch,
    sizeCard: r.sizeCard,
    contextCard: r.contextCard,
    statusOf: r.statusOf,
    harnessName: r.harnessName,
    harnessLogo: r.harnessLogo,
    harnessBadge: r.harnessBadge,
    actorLogo: r.actorLogo,
    backgroundNote,
    askingNote,
    errorNote,
  });
}
