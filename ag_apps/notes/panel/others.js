// Notes: what others change -- the batches the backend tells every panel of, applied here (another window's,
// an agent's: never this panel's own), and the notebook read again when one was missed.
import { $, SPECIAL } from "./helpers.js";
import { ag, book, current, known, ME, pages, ready, setBook, setCurrent, titleDirty } from "./state.js";
import { apply, linksTo, reindex } from "./model.js";
import { dirty, queue } from "./send.js";
import { drawSide } from "./sidebar.js";
import { drawPage } from "./page.js";
import { cellEl, setCell, TABLE_OPS } from "./tables.js";
import { actorOf, nameOf } from "./actors.js";

export const early = [];
export function heard(m) {
  if (m.version <= book.version) return;
  const gap = m.version !== book.version + 1;          // a batch missed: everything read again, after these
  book.version = m.version;
  if (m.by !== ME) {
    const touched = new Set(), blocks = new Set(), retitled = new Set(), cells = [];
    for (const op of m.ops) {
      apply(op);
      touched.add(typeof op.page === "string" ? op.page : op.page && op.page.id);
      if (op.op === "block.put") blocks.add(op.block.id);
      if (op.op === "cell.put") cells.push([op.block, op.row, op.col]);                    // (a cell changed: that cell flashes)
      else if (op.op === "row.put") cells.push(...Object.keys(op.row.cells || {}).map((c) => [op.block, op.row.id, c]));
      else if (TABLE_OPS.includes(op.op)) blocks.add(op.block);
      if (op.op === "block.move" || op.op === "thread.add") blocks.add(op.block);
      if (op.op.startsWith("page.")) for (const id of op.pages || [typeof op.page === "string" ? op.page : op.page.id]) retitled.add(id);
    }
    if (current && !pages.has(current)) setCurrent(null);
    drawSide(m.agent ? touched : null);
    if (current && touched.has(current)) {
      drawPage(m.quiet ? null : blocks);                // (a snapshot fetched again: no flash)
      for (const [bid, row, col] of cells) { const c = cellEl(bid, row, col), td = c && c.parentElement; if (td) { td.classList.remove("flash"); void td.offsetWidth; td.classList.add("flash"); } }
    }
    else if (!current || SPECIAL.includes(current) || linksTo(pages.get(current), retitled)) drawPage();
    if (m.agent) told(m.agent, [...touched].map((id) => pages.get(id)).filter(Boolean));
  }
  if (gap) resync();
}
let whoTimer = 0;
function told(channel, changed) {
  const st = ag.agents.state(channel), a = actorOf(channel);
  const name = a ? nameOf(a, channel) : (st && st.name) || "An agent";
  const what = changed.length === 1 ? `“${changed[0].title || "Untitled"}”` : changed.length ? `${changed.length} pages` : "the notes";
  const w = $("who");
  w.textContent = `${name} changed ${what}`;
  w.style.opacity = "1";
  clearTimeout(whoTimer);
  whoTimer = setTimeout(() => { w.style.opacity = "0"; setTimeout(() => { if (w.style.opacity === "0") w.textContent = ""; }, 450); }, 6000);
}
export async function resync() {
  let got;
  try { got = await (await ag.api("state")).json(); } catch { return; }
  if (!got || !Array.isArray(got.pages) || got.version < book.version) return;
  setBook(got);
  reindex();
  for (const op of queue) apply(op);                   // what this window has not sent yet stays as it has it
  for (const [id, d] of dirty) {
    const p = pages.get(d.page), b = p && p.blocks.find((x) => x.id === (d.cell ? d.cell.block : id));
    if (b && d.cell) { if (b.type === "table") { setCell(b, d.cell.row, d.cell.col, d.text); known.set(id, d.text); } }
    else if (b) { b.text = d.text; known.set(id, d.text); }
  }
  if (titleDirty && pages.get(titleDirty.page)) pages.get(titleDirty.page).title = titleDirty.title;
  if (current && !pages.has(current)) setCurrent(null);
  drawSide();
  drawPage();
}

export function wireOthers() {
  ag.onMessage((m) => {
    if (!m || !Array.isArray(m.ops)) return;
    if (!ready) early.push(m);
    else heard(m);
  });
}
