// Notes: pasting -- lines as blocks.
// Lines copied from these notes come back as they were (their own clipboard type: types, ticks, indents); other text
// of several lines is read as markdown, a line each; one line's text is typed in, plain. A picture pasted is kept
// (pictures.js), cells of a spreadsheet make a table, a Figma link alone on a line asks how to show it.
import { ag, current } from "./state.js";
import { change, forget } from "./send.js";
import { blockOf, box, drawPage, page } from "./page.js";
import { focusBlock } from "./caret.js";
import { clipBlocks } from "./picked.js";
import { cellPaste, tableOf, tsv } from "./tables.js";
import { FIGMA_URL, figmaChoice, putPictures } from "./pictures.js";
import { edit, here, view } from "./editor.js";

export const parsed = async (text) => (await (await ag.api("parse", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ markdown: text }) })).json()).blocks || [];
// Blocks put in after one (`after`), in order -- the first into the empty line `into` (its id), if there is one -- and
// the last one's id.
export function putBlocks(got, after, into = null) {
  const ops = [];
  got = [...got];
  if (into) {
    const first = got.shift();
    forget(into);
    ops.push({ op: "block.put", page: current, block: { ...first, id: into } });
  }
  for (const nb of got) { ops.push({ op: "block.put", page: current, block: nb, after }); after = nb.id; }
  change(ops);
  drawPage();
  return after;
}
// A paste in a line (the editor's paste event, before its own: true, taken).
export function linePaste(ev) {
  const h = here(), b = h && blockOf(h.id), p = page();
  if (!b || !p || !view.editable || !ev.clipboardData) return false;
  ev.preventDefault();
  const text = (ev.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n");
  const ours = clipBlocks(ev.clipboardData), blank = h.node.content.size === 0;
  const pics = [...(ev.clipboardData.files || [])].filter((f) => f.type.startsWith("image/"));
  if (pics.length && !ours && b.type !== "code") { putPictures(pics, b); return true; }
  if (!text && !ours) return true;
  const into = blank && b.type === "text" ? b.id : null;
  const grid = !ours && b.type !== "code" ? tsv(text) : null;   // cells of a spreadsheet: a table
  if (grid) { focusBlock(putBlocks([tableOf(grid)], b.id, into), "end"); return true; }
  if (b.type === "code" || (!ours && !text.trim().includes("\n"))) {
    const alone = b.type === "text" && blank && FIGMA_URL.test(text.trim());
    edit(view.state.tr.insertText(b.type === "code" ? text : text.replace(/\n+/g, " ")).scrollIntoView());
    if (alone) figmaChoice(b, text.trim());              // a Figma link alone on a line: the frame, or a link?
    return true;
  }
  (async () => {
    let got = ours || [];
    if (!ours) {
      try { got = await parsed(text); }
      catch { edit(view.state.tr.insertText(text.replace(/\n+/g, " ")).scrollIntoView()); return; }
    }
    if (!got.length || !blockOf(b.id)) return;
    focusBlock(putBlocks(got, b.id, into && blockOf(into) && !blockOf(into).text ? into : null), "end");
  })();
  return true;
}

export function wirePaste() {                           // (a table's cell: its own, tables.js's)
  box.addEventListener("paste", (ev) => {
    const cell = ev.target.closest && ev.target.closest(".tbl .cell");
    if (cell) cellPaste(ev, cell);
  });
}
