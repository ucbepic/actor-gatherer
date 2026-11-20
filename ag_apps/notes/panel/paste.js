// Notes: pasting -- lines as blocks.
// Lines copied from these notes come back as they were (their own clipboard type: types, ticks, indents); other text
// of several lines is read as markdown, a line each.
import { clean } from "./helpers.js";
import { ag, current } from "./state.js";
import { withLinks } from "./model.js";
import { change, forget } from "./send.js";
import { blockOf, box, drawPage, page } from "./page.js";
import { empty, focusBlock } from "./caret.js";
import { clipBlocks } from "./picked.js";
import { cellPaste, tableOf, tsv } from "./tables.js";
import { FIGMA_URL, figmaChoice, putPictures } from "./pictures.js";

export const parsed = async (text) => (await (await ag.api("parse", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ markdown: text }) })).json()).blocks || [];
// Blocks put in after one (`after`), in order -- the first into the empty line typed in (`into`), if it is one -- and
// the last one's id.
export function putBlocks(got, after, into = null) {
  const ops = [];
  got = [...got];
  if (into) {
    const id = into.closest(".blk").dataset.id, first = got.shift();
    forget(id);
    ops.push({ op: "block.put", page: current, block: { ...first, id } });
    if (first.type === "code") into.textContent = first.text; else into.innerHTML = withLinks(clean(first.text));
  }
  for (const nb of got) { ops.push({ op: "block.put", page: current, block: nb, after }); after = nb.id; }
  change(ops);
  drawPage();
  return after;
}

export function wirePaste() {
  box.addEventListener("paste", async (ev) => {
    const cell = ev.target.closest && ev.target.closest(".tbl .cell");
    if (cell) return cellPaste(ev, cell);
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    ev.preventDefault();
    const text = (ev.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    const ours = clipBlocks(ev.clipboardData);
    const n = tx.closest(".blk"), b = blockOf(n.dataset.id);
    const pics = [...(ev.clipboardData.files || [])].filter((f) => f.type.startsWith("image/"));
    if (b && pics.length && !ours && b.type !== "code" && !page().deleted) return void putPictures(pics, b);
    if (!b || (!text && !ours)) return;
    const grid = !ours && b.type !== "code" && !page().deleted ? tsv(text) : null;   // cells of a spreadsheet: a table
    if (grid) return void focusBlock(putBlocks([tableOf(grid)], b.id, empty(tx) && b.type === "text" ? tx : null), "end");
    if (b.type === "code" || (!ours && !text.trim().includes("\n"))) {
      const alone = b.type === "text" && empty(tx) && FIGMA_URL.test(text.trim());
      document.execCommand("insertText", false, b.type === "code" ? text : text.replace(/\n+/g, " "));
      if (alone) figmaChoice(b, tx, text.trim());           // a Figma link alone on a line: the frame, or a link?
      return;
    }
    let got = ours || [];
    if (!ours) {
      try { got = await parsed(text); }
      catch { document.execCommand("insertText", false, text.replace(/\n+/g, " ")); return; }
    }
    if (!got.length || !blockOf(b.id)) return;
    focusBlock(putBlocks(got, b.id, empty(tx) && b.type === "text" ? tx : null), "end");
  });
}
