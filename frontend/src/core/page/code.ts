// ------------------------------------------------------------------ code, coloured
// The page's own highlighter, its shell reader and how it lays a command out, a command's output in its terminal's
// colours, and a fenced block in a message: src/core/ui/highlight/ (ag_dashboard/DESIGN.md, A5), the old page's modules
// importing them from here.
import { el } from "./dom";
import { startClocks } from "../ui/clocks";
import {
  ansiHtml,
  codeClick,
  guessWeb,
  hlLines,
  hlPart,
  langOfPath,
  outputHtml,
  shellHtml,
  tildePath,
} from "../ui/highlight";

/** A shell command, coloured, in a span of its own. */
export const shellSpan = (text: string): HTMLSpanElement => {
  const s = el("span", { class: "sh-t" });
  s.innerHTML = hlLines(text, "shell").join("\n");
  return s;
};

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  startClocks(); // every count-up time on the page set each second (core/ui/clocks.ts)
  // a code block's Copy (codeFence's, callView's): the command as written (data-copy), else the block's own text; its
  // Fold and Show all
  document.addEventListener("click", (ev) => codeClick(ev));
}

export { ansiHtml, guessWeb, hlLines, hlPart, langOfPath, outputHtml, shellHtml, tildePath };
