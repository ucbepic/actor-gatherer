// Notes: tables.
// A table block (notebook.py's TABLE) holds its own rows and columns, each with an id. A cell is typed in as a line is:
// its words kept with cell.put (a run of typing one step of undo), [[ links a page, ⌘B ⌘I ⌘E ⌘K mark it up. Rows and
// columns are added (the + bars at its bottom and right edge, clicked or dragged for several; Tab past its last cell;
// Enter in its last row), moved (their handles dragged), deleted, sorted, and made headers (their handles' menus, or
// the table's own); a column's right edge is dragged to change its width (double-click: back to an equal share).
// Keys: Tab ⇧Tab the next and the last cell, Enter the cell below, ⇧Enter a new line in the cell, the arrows on to the
// next cell at a cell's edge and out of the table at its own, Esc the table picked as a line. Cells dragged across (or
// Shift+clicked, or ⇧+arrows past a cell's edge) are picked: copied as rows of tab-separated cells, as a spreadsheet
// has them, cut or emptied together. Cells copied from a spreadsheet, or a table from a web page, pasted into a line
// make a table, and pasted into a cell fill the cells from there, rows and columns added as needed.
// In the page's editor (editor.js) a table is a block with nothing typed in it: its cells, each an editable element of
// its own, are drawn and typed in here, unseen by the editor -- which isn't editable while cells are picked.
import { $, clean, el, esc, plainOf, rid, SVG } from "./helpers.js";
import { current, known, pages, setEatMouse } from "./state.js";
import { drawLinks, placeAt, withLinks } from "./model.js";
import { change, dirty, forget, saved, sendTyped } from "./send.js";
import { copied, inRun, replaying, standing, undoStep } from "./undo.js";
import { blockOf, box, drawPage, page, rowOf, shown } from "./page.js";
import { caretIn, edge, editable, focusBlock, onLine, setCaret } from "./caret.js";
import { addAfter, codeMark, format, linkBox } from "./typing.js";
import { item, menu, popUp } from "./popups.js";
import { overLink, pageInput, pageKey } from "./pagelinks.js";
import { CLIP, clipBlocks, clipped, holdKeys, inField, mdInline, pickRange } from "./picked.js";
import { say } from "./actors.js";
import { refreshView } from "./editor.js";

export const TABLE_OPS = ["cell.put", "row.put", "row.move", "row.delete", "col.put", "col.move", "col.delete"];
const AUTO_MIN = 96;                                     // px: a column with no width of its own, at the least
const COL_W = [48, 1600], MAX_ROWS = 500, MAX_COLS = 30;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const cellKey = (bid, row, col) => `${bid}:${row}:${col}`;
const cellText = (b, row, col) => { const r = b.rows.find((x) => x.id === row); return (r && r.cells[col]) || ""; };
export const cellEl = (bid, row, col) => { const n = rowOf(bid); return n && n.querySelector(`tr[data-row="${CSS.escape(row)}"] .cell[data-col="${CSS.escape(col)}"]`); };
export const cellOp = (pid, bid, row, col, text) => ({ op: "cell.put", page: pid, block: bid, row, col, text });
export const canType = (b) => editable(b) || b.type === "table";
// where a cell is: its line's row, the table, its row's and column's ids and places
export function cellOf(cell) {
  const n = cell && cell.closest(".blk"), tr = cell && cell.closest("tr"), b = n && blockOf(n.dataset.id);
  if (!b || b.type !== "table" || !tr) return null;
  const row = tr.dataset.row, col = cell.dataset.col, ri = b.rows.findIndex((r) => r.id === row), ci = b.cols.findIndex((c) => c.id === col);
  return ri < 0 || ci < 0 ? null : { n, b, row, col, ri, ci };
}
function newTable(rows = 3, cols = 3) {
  return { id: rid(), type: "table", text: "", checked: false, indent: 0, head: true, head_col: false,
    cols: Array.from({ length: cols }, () => ({ id: rid() })), rows: Array.from({ length: rows }, () => ({ id: rid(), cells: {} })) };
}
export function tableOf(grid) {                          // rows of cells' text (clean HTML): a table, its first row a header
  const t = newTable(Math.min(MAX_ROWS, grid.length), Math.min(MAX_COLS, Math.max(...grid.map((r) => r.length))));
  t.rows.forEach((r, i) => t.cols.forEach((c, j) => { const h = clean(grid[i][j] || ""); if (h) r.cells[c.id] = h; }));
  return t;
}
export function freshTable(b) {                          // a copy's rows and columns: new ids, the cells moved over
  const cols = b.cols.map((c) => ({ ...c, id: rid() })), to = new Map(b.cols.map((c, j) => [c.id, cols[j].id]));
  return { ...b, cols, rows: b.rows.map((r) => ({ id: rid(), cells: Object.fromEntries(Object.entries(r.cells || {})
    .filter(([k, v]) => to.has(k) && typeof v === "string").map(([k, v]) => [to.get(k), clean(v)])) })) };
}
const gridOf = (b, rows = b.rows, cols = b.cols) => rows.map((r) => cols.map((c) => r.cells[c.id] || ""));
// text copied from a spreadsheet, or a web page's table: several lines, each with as many tabs (not all set in by one:
// code) -- its rows of cells' text; else null
export function tsv(text) {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (lines.length < 2 || lines.some((l) => !l.includes("\t"))) return null;
  const grid = lines.map((l) => l.split("\t"));
  if (grid.some((r) => r.length !== grid[0].length) || grid.every((r) => !r[0].trim())) return null;
  return grid.map((r) => r.map((c) => esc(c.trim())));
}
// a table as markdown (notebook.py's table_lines): a row a line, its first the header
export function tableMd(b) {
  const line = (r) => `| ${b.cols.map((c) => mdInline(r.cells[c.id] || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>")).join(" | ")} |`;
  return [line(b.rows[0]), `|${" --- |".repeat(b.cols.length)}`, ...b.rows.slice(1).map(line)];
}
// an op on a table's rows or columns applied here, as notebook.py applies it
export function tableApply(b, op) {
  const [what, act] = op.op.split(".");
  if (what === "cell") {
    const r = b.rows.find((x) => x.id === op.row);
    if (!r || !b.cols.some((c) => c.id === op.col)) return;
    if (op.text) r.cells[op.col] = op.text; else delete r.cells[op.col];
    known.set(cellKey(b.id, op.row, op.col), op.text || "");
    return;
  }
  const list = what === "row" ? b.rows : b.cols;
  if (act === "put") {
    const given = op[what];
    let x = list.find((y) => y.id === given.id);
    if (!x) { x = what === "row" ? { id: given.id, cells: {} } : { id: given.id }; list.splice(placeAt(list, op.after), 0, x); }
    if (what === "col" && "w" in given) { if (given.w == null) delete x.w; else x.w = given.w; }
    const cells = what === "row" ? given.cells || {} : op.cells || {};
    for (const [k, v] of Object.entries(cells)) {
      const r = what === "row" ? x : b.rows.find((y) => y.id === k), col = what === "row" ? k : x.id;
      if (!r || !b.cols.some((c) => c.id === col)) continue;
      if (v) r.cells[col] = v; else delete r.cells[col];
      known.set(cellKey(b.id, r.id, col), v || "");
    }
    return;
  }
  const i = list.findIndex((y) => y.id === op[what]);
  if (i < 0) return;
  const [x] = list.splice(i, 1);
  if (act === "move") list.splice(placeAt(list, op.after), 0, x);
  else if (what === "col") for (const r of b.rows) delete r.cells[x.id];
}
export function keepTyped(b) {                           // cells typed here, not yet sent: as the reader has them
  for (const d of dirty.values()) if (d.cell && d.cell.block === b.id) setCell(b, d.cell.row, d.cell.col, d.text);
}
export function setCell(b, row, col, text) {
  const r = b.rows.find((x) => x.id === row);
  if (r) { if (text) r.cells[col] = text; else delete r.cells[col]; }
}
// an op's way back (undo), from the table as it is just before it
export function tableBack(pid, b, op) {
  const [what, act] = op.op.split("."), base = { page: pid, block: b.id };
  if (what === "cell") return cellOp(pid, b.id, op.row, op.col, known.get(cellKey(b.id, op.row, op.col)) ?? cellText(b, op.row, op.col));
  const list = what === "row" ? b.rows : b.cols;
  if (act === "put") {
    const given = op[what], x = list.find((y) => y.id === given.id);
    if (!x) return { ...base, op: `${what}.delete`, [what]: given.id };
    if (what === "row") return { ...base, op: "row.put", row: { id: x.id, cells: Object.fromEntries(Object.keys(given.cells || {}).map((k) => [k, x.cells[k] || ""])) } };
    const col = { id: x.id, ...("w" in given ? { w: x.w ?? null } : {}) };
    return { ...base, op: "col.put", col, cells: Object.fromEntries(Object.keys(op.cells || {}).map((k) => [k, cellText(b, k, x.id)])) };
  }
  const i = list.findIndex((y) => y.id === op[what]);
  if (i < 0) return null;
  const prev = i > 0 ? list[i - 1].id : "";
  if (act === "move") return op.after === prev ? null : { ...base, op: `${what}.move`, [what]: op[what], after: prev };
  if (what === "row") return { ...base, op: "row.put", row: copied(list[i]), after: prev };
  return { ...base, op: "col.put", col: copied(list[i]), cells: Object.fromEntries(b.rows.filter((r) => r.cells[op.col]).map((r) => [r.id, r.cells[op.col]])), after: prev };
}

// -- drawn: rows and cells kept, moved, made or removed; a cell typed in (or not yet sent) left as the reader has it
export function drawTable(n, b, ro) {
  const wrap = n.querySelector(".tbl"), body = wrap.querySelector("tbody");
  wrap.classList.toggle("ro", !!ro);
  const have = new Map([...body.rows].map((tr) => [tr.dataset.row, tr])), want = new Set(b.rows.map((r) => r.id));
  for (const [id, tr] of have) if (!want.has(id)) tr.remove();
  let prev = null;
  b.rows.forEach((r, i) => {
    const tr = have.get(r.id) || el("tr", { "data-row": r.id });
    const there = prev ? prev.nextSibling : body.firstChild;
    if (tr !== there) body.insertBefore(tr, there);
    prev = tr;
    tr.classList.toggle("hd", !!b.head && i === 0);
    drawCells(tr, b, r, i, ro);
  });
  layoutTable(n, b);
  drawCellPick();
}
function drawCells(tr, b, r, i, ro) {
  const have = new Map([...tr.cells].map((td) => [td.firstChild.dataset.col, td])), want = new Set(b.cols.map((c) => c.id));
  for (const [id, td] of have) if (!want.has(id)) td.remove();
  let prev = null;
  b.cols.forEach((c, j) => {
    const tag = (b.head && i === 0) || (b.head_col && j === 0) ? "TH" : "TD";
    let td = have.get(c.id);
    if (td && td.tagName !== tag) { const made = el(tag.toLowerCase()); made.append(td.firstChild); td.replaceWith(made); td = made; }
    if (!td) td = el(tag.toLowerCase(), {}, el("div", { class: "cell", "data-col": c.id, spellcheck: "true" }));
    if (tag === "TH") td.setAttribute("scope", b.head && i === 0 ? "col" : "row"); else td.removeAttribute("scope");
    const there = prev ? prev.nextSibling : tr.firstChild;
    if (td !== there) tr.insertBefore(td, there);
    prev = td;
    const cell = td.firstChild;
    cell.setAttribute("contenteditable", ro ? "false" : "true");
    if (cell !== document.activeElement && !dirty.has(cellKey(b.id, r.id, c.id))) {
      const h = withLinks(clean(r.cells[c.id] || ""));
      if (cell.innerHTML !== h) cell.innerHTML = h;
    } else drawLinks(cell);
  });
}
// each column's width: its own, or an equal share of what the page leaves (at least AUTO_MIN); wider than the page,
// the table scrolls sideways. Its edges, to drag, at the columns' right sides.
function layoutTable(n, b, cols = b.cols) {
  const wrap = n.querySelector(".tbl"), table = wrap.querySelector("table"), cg = table.querySelector("colgroup");
  const room = wrap.clientWidth || 640, fixed = cols.reduce((s, c) => s + (c.w || 0), 0), free = cols.filter((c) => !c.w).length;
  const share = free ? Math.max(AUTO_MIN, Math.floor((room - fixed - 1) / free)) : 0, ws = cols.map((c) => c.w || share);
  while (cg.children.length < ws.length) cg.append(el("col"));
  while (cg.children.length > ws.length) cg.lastChild.remove();
  ws.forEach((w, j) => { if (cg.children[j].style.width !== `${w}px`) cg.children[j].style.width = `${w}px`; });
  table.style.width = `${ws.reduce((s, w) => s + w, 0)}px`;
  const edges = wrap.querySelector(".tbl-edges");
  while (edges.children.length < ws.length) edges.append(el("div", { class: "tbl-rs", title: "Drag to resize · double-click to reset" }));
  while (edges.children.length > ws.length) edges.lastChild.remove();
  let x = 0;
  ws.forEach((w, j) => { x += w; edges.children[j].dataset.col = cols[j].id; edges.children[j].style.left = `${x - 3}px`; });
}

// -- typing in a cell
export function cellInput(cell, ev) {
  const at = cellOf(cell);
  if (!at) return;
  if (cell.innerHTML === "<br>") cell.innerHTML = "";
  const was = cellText(at.b, at.row, at.col), text = clean(cell.innerHTML);
  setCell(at.b, at.row, at.col, text);
  cellTyped(current, at.b.id, at.row, at.col, text, was);
  pageInput(at.n, cell, at.b, ev);
}
function cellTyped(pid, bid, row, col, text, was) {
  const key = cellKey(bid, row, col), p = pages.get(pid);
  if (!known.has(key)) known.set(key, was);
  if (!replaying && p && !p.deleted && pid === current && known.get(key) !== text) {
    const step = inRun(p, key, cellOp(pid, bid, row, col, known.get(key)));
    known.set(key, text);
    step.fwd = [cellOp(pid, bid, row, col, text)];
    step.after = standing(p, [key]);
  } else known.set(key, text);
  const d = dirty.get(key);
  if (d) clearTimeout(d.timer);
  dirty.set(key, { page: pid, text, cell: { block: bid, row, col }, timer: setTimeout(() => sendTyped(key), 450) });
  saved("saving");
}
// the words in a cell changed other than by typing (a link put in or taken out, code marked): kept
export function retyped(n, tx) {
  if (tx.classList.contains("cell")) cellInput(tx, { inputType: "" });
}
export function focusCell(b, ri, ci, where = "end") {
  const r = b.rows[ri], c = b.cols[ci], cell = r && c && cellEl(b.id, r.id, c.id);
  if (!cell) return;
  cell.focus({ preventScroll: true });
  setCaret(cell, where === "start" ? 0 : cell.textContent.length);
  cell.closest("td, th").scrollIntoView({ block: "nearest", inline: "nearest" });
}
function outOf(b, by) {                                  // the arrows past the table's edge: the line there (none below: one made)
  const p = shown(), i = p.blocks.findIndex((x) => x.id === b.id);
  const to = by < 0 ? p.blocks.slice(0, i).reverse().find(canType) : p.blocks.slice(i + 1).find(canType);
  if (to) return focusBlock(to.id, by < 0 ? "end" : "start");
  if (by > 0) return addAfter(b, "text");
  $("title").focus();
  setCaret($("title"), $("title").textContent.length);
}
function tabCell(b, ri, ci, back) {
  const C = b.cols.length, at = ri * C + ci + (back ? -1 : 1);
  if (at < 0) return;
  if (at >= b.rows.length * C) return addRows(b, 1, b.rows[b.rows.length - 1].id, 0);
  focusCell(b, Math.floor(at / C), at % C);
}
const DIRS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
export function cellKeys(ev, cell) {
  const at = cellOf(cell);
  if (!at) return;
  const { n, b, ri, ci } = at, R = b.rows.length, C = b.cols.length, mod = ev.metaKey || ev.ctrlKey, k = ev.key;
  if (menu && menu.kind === "page" && pageKey(ev)) return;
  if (mod && !ev.altKey) {
    const low = k.toLowerCase();
    if (low === "z") { ev.preventDefault(); return undoStep(ev.shiftKey); }
    if (!ev.shiftKey && low === "a") {                   // ⌘A: the cell's words, then (all of them selected) every cell
      const c = caretIn(cell);
      ev.preventDefault();
      if (c && c.start === 0 && c.end === cell.textContent.length) { pickCells(b, 0, 0, R - 1, C - 1); return holdKeys(); }
      return setCaret(cell, 0, cell.textContent.length);
    }
    if (!ev.shiftKey && low === "b") return format(ev, n, "bold");
    if (!ev.shiftKey && low === "i") return format(ev, n, "italic");
    if (!ev.shiftKey && low === "u") return format(ev, n, "underline");
    if (ev.shiftKey && (low === "s" || low === "x")) return format(ev, n, "strikeThrough");
    if (!ev.shiftKey && low === "e") { ev.preventDefault(); return codeMark(n, cell); }
    if (!ev.shiftKey && low === "k") { ev.preventDefault(); return linkBox(n, cell); }
    if (k === "Enter") { ev.preventDefault(); return addAfter(b, "text"); }     // ⌘↵: a line after the table
    return;
  }
  if (k === "Escape" && !ev.shiftKey) { ev.preventDefault(); pickRange(b.id, b.id); return holdKeys(); }
  if (k === "Tab") { ev.preventDefault(); return tabCell(b, ri, ci, ev.shiftKey); }
  if (k === "Enter" && !ev.shiftKey) { ev.preventDefault(); return ri + 1 < R ? focusCell(b, ri + 1, ci) : addRows(b, 1, b.rows[R - 1].id, ci); }
  if (k === "Enter") { ev.preventDefault(); return void document.execCommand("insertLineBreak"); }   // ⇧↵: a new line in the cell
  if ((k === "Backspace" || k === "Delete") && !ev.altKey && overLink(n, cell, b, k === "Delete")) return ev.preventDefault();
  if ((k === "Backspace" && edge(cell, false)) || (k === "Delete" && edge(cell, true))) return ev.preventDefault();   // no cell to join it to
  const dir = DIRS[k];
  if (!dir || ev.altKey) return;
  const [dr, dc] = dir, past = dr ? onLine(cell, dr > 0) : edge(cell, dc > 0);
  if (!past) return;
  ev.preventDefault();
  if (ev.shiftKey) { pickCells(b, ri, ci, ri + dr, ci + dc); return holdKeys(); }   // ⇧ past its edge: the cells picked
  if (dr) return ri + dr >= 0 && ri + dr < R ? focusCell(b, ri + dr, ci, dr > 0 ? "start" : "end") : outOf(b, dr);
  const to = ri * C + ci + dc;
  return to >= 0 && to < R * C ? focusCell(b, Math.floor(to / C), to % C, dc > 0 ? "start" : "end") : outOf(b, dc);
}

// -- rows and columns: added, moved, deleted, sorted
function addRows(b, count = 1, after = undefined, focusCol = null) {
  count = Math.min(count, MAX_ROWS - b.rows.length);
  if (count <= 0) return say(`A table has ${MAX_ROWS} rows at most`, true);
  const ops = [];
  for (let k = 0; k < count; k++) {
    const id = rid();
    ops.push({ op: "row.put", page: current, block: b.id, row: { id, cells: {} }, ...(after !== undefined ? { after } : {}) });
    after = id;
  }
  change(ops);
  drawPage();
  if (focusCol !== null) focusCell(b, b.rows.findIndex((r) => r.id === ops[0].row.id), focusCol, "start");
}
function addCols(b, count = 1, after = undefined) {
  count = Math.min(count, MAX_COLS - b.cols.length);
  if (count <= 0) return say(`A table has ${MAX_COLS} columns at most`, true);
  const ops = [];
  for (let k = 0; k < count; k++) {
    const id = rid();
    ops.push({ op: "col.put", page: current, block: b.id, col: { id }, ...(after !== undefined ? { after } : {}) });
    after = id;
  }
  change(ops);
  drawPage();
}
function tableDo(ops) { if (ops.length) { change(ops); drawPage(); } }
export const tableSet = (b, fields) => tableDo([{ op: "block.put", page: current, block: { id: b.id, ...fields } }]);
function sortBy(b, col, down) {                         // the rows under the header, by the column's words (the empty last)
  const top = b.head ? b.rows.slice(0, 1) : [], body = b.rows.slice(top.length), words = (r) => plainOf(r.cells[col] || "").trim();
  const sorted = [...body].sort((x, y) => (!words(x) - !words(y)) || collator.compare(words(x), words(y)) * (down ? -1 : 1));
  if (sorted.every((r, i) => r === body[i])) return;
  let after = top.length ? top[0].id : "";
  tableDo(sorted.map((r) => { const op = { op: "row.move", page: current, block: b.id, row: r.id, after }; after = r.id; return op; }));
}
function rowMenu(b, id, rect) {
  const i = b.rows.findIndex((r) => r.id === id);
  if (i < 0) return;
  popUp(rect, (pop) => {
    pop.append(item({ glyph: "↑", sm: true, label: "Insert above" }, () => addRows(b, 1, i ? b.rows[i - 1].id : "")),
      item({ glyph: "↓", sm: true, label: "Insert below" }, () => addRows(b, 1, id)),
      ...(i === 0 ? [item({ glyph: b.head ? SVG.check : "", sm: true, label: "Header row", note: b.head ? "On" : "Off" }, () => tableSet(b, { head: !b.head }))] : []),
      ...(b.rows.length > 1 ? [el("div", { class: "sep" }), item({ glyph: SVG.trash, sm: true, label: "Delete row", bad: true },
        () => tableDo([{ op: "row.delete", page: current, block: b.id, row: id }]))] : []));
  });
}
function colMenu(b, id, rect) {
  const j = b.cols.findIndex((c) => c.id === id);
  if (j < 0) return;
  popUp(rect, (pop) => {
    pop.append(item({ glyph: "←", sm: true, label: "Insert left" }, () => addCols(b, 1, j ? b.cols[j - 1].id : "")),
      item({ glyph: "→", sm: true, label: "Insert right" }, () => addCols(b, 1, id)),
      item({ glyph: "A↓", sm: true, label: "Sort A → Z" }, () => sortBy(b, id, false)),
      item({ glyph: "Z↓", sm: true, label: "Sort Z → A" }, () => sortBy(b, id, true)),
      ...(j === 0 ? [item({ glyph: b.head_col ? SVG.check : "", sm: true, label: "Header column", note: b.head_col ? "On" : "Off" }, () => tableSet(b, { head_col: !b.head_col }))] : []),
      ...(b.cols.length > 1 ? [el("div", { class: "sep" }), item({ glyph: SVG.trash, sm: true, label: "Delete column", bad: true },
        () => tableDo([{ op: "col.delete", page: current, block: b.id, col: id }]))] : []));
  });
}
// a line made a table from the / menu: in its place if it is empty (`into`), else after it; a line to type in after it
export function putTable(b, into) {
  forget(b.id);
  const p = page(), t = newTable(), at = into ? b.id : t.id;
  const ops = into ? [{ op: "block.put", page: current, block: { ...t, id: b.id } }]
    : [{ op: "block.put", page: current, block: { id: b.id, text: b.text } }, { op: "block.put", page: current, block: t, after: b.id }];
  const next = p.blocks[p.blocks.indexOf(b) + 1];
  if (!next || next.type !== "text" || plainOf(next.text)) ops.push({ op: "block.put", page: current, block: { id: rid(), type: "text", text: "", checked: false, indent: 0 }, after: at });
  change(ops);
  drawPage();
  focusCell(blockOf(at), 0, 0, "start");
}

let tdrag = null;                                        // {kind: row|col|size|addrow|addcol, n, b, id, h, x, y, moved, ...}
const tdragEnd = (ev) => {
  const d = tdrag;
  if (!d) return;
  tdrag = null;
  d.h.classList.remove("held");
  delete d.h.dataset.n;
  document.body.classList.remove("tsizing");
  const line = d.n.querySelector(".tbl-drop");
  if (line) line.remove();
  if (ev.type === "pointercancel") return drawPage();
  const b = blockOf(d.b.id);
  if (!b) return;
  if (d.kind === "size") return d.moved ? tableDo([{ op: "col.put", page: current, block: b.id, col: { id: d.id, w: d.w } }]) : undefined;
  if (d.kind === "addrow") return addRows(b, d.moved ? d.count : 1, b.rows[b.rows.length - 1].id, d.moved ? null : 0);
  if (d.kind === "addcol") return addCols(b, d.moved ? d.count : 1, b.cols[b.cols.length - 1].id);
  if (!d.moved) return (d.kind === "row" ? rowMenu : colMenu)(b, d.id, d.h.getBoundingClientRect());
  const list = (d.kind === "row" ? b.rows : b.cols).filter((x) => x.id !== d.id), after = d.at > 0 ? list[d.at - 1].id : "";
  const all = d.kind === "row" ? b.rows : b.cols, i = all.findIndex((x) => x.id === d.id);
  if (after === (i > 0 ? all[i - 1].id : "")) return;
  tableDo([{ op: `${d.kind}.move`, page: current, block: b.id, [d.kind]: d.id, after }]);
};

// -- cells picked: dragged across, Shift+clicked, ⇧+arrows past a cell's edge
let cpick = null, csweep = null;                         // cpick: {id (the table's), r0, c0 (where it began), r1, c1}
const inCellPick = (id, i, j) => !!cpick && cpick.id === id && i >= Math.min(cpick.r0, cpick.r1) && i <= Math.max(cpick.r0, cpick.r1)
  && j >= Math.min(cpick.c0, cpick.c1) && j <= Math.max(cpick.c0, cpick.c1);
function pickCells(b, r0, c0, r1, c1) {
  const keep = (v, top) => Math.max(0, Math.min(top, v)), was = !!cpick;
  cpick = { id: b.id, r0: keep(r0, b.rows.length - 1), c0: keep(c0, b.cols.length - 1), r1: keep(r1, b.rows.length - 1), c1: keep(c1, b.cols.length - 1) };
  drawCellPick();
  if (!was) refreshView();
}
export function unpickCells() { if (cpick) { cpick = null; drawCellPick(); refreshView(); } }
export const cellsPicked = () => !!cpick;
function drawCellPick() {
  for (const c of box.querySelectorAll(".tbl .cp")) c.classList.remove("cp");
  for (const w of box.querySelectorAll(".tbl.cell-picking")) w.classList.remove("cell-picking");
  const b = cpick && blockOf(cpick.id), n = cpick && rowOf(cpick.id);
  if (!cpick) return;
  if (!b || b.type !== "table" || !n) { cpick = null; return; }
  if (cpick.r0 >= b.rows.length || cpick.r1 >= b.rows.length || cpick.c0 >= b.cols.length || cpick.c1 >= b.cols.length) return pickCells(b, cpick.r0, cpick.c0, cpick.r1, cpick.c1);
  n.querySelector(".tbl").classList.add("cell-picking");
  b.rows.forEach((r, i) => b.cols.forEach((c, j) => { if (inCellPick(b.id, i, j)) { const e = cellEl(b.id, r.id, c.id); if (e) e.parentElement.classList.add("cp"); } }));
}
function pickedCells() {
  const b = cpick && blockOf(cpick.id);
  if (!b) return null;
  const rows = b.rows.slice(Math.min(cpick.r0, cpick.r1), Math.max(cpick.r0, cpick.r1) + 1);
  const cols = b.cols.slice(Math.min(cpick.c0, cpick.c1), Math.max(cpick.c0, cpick.c1) + 1);
  return { b, rows, cols };
}
function emptyCells() {
  const got = pickedCells();
  if (!got) return;
  tableDo(got.rows.flatMap((r) => got.cols.filter((c) => r.cells[c.id]).map((c) => cellOp(current, got.b.id, r.id, c.id, ""))));
  drawCellPick();
}
function clipCells(dt) {
  const got = pickedCells();
  if (!got) return;
  const grid = gridOf(got.b, got.rows, got.cols);
  dt.setData("text/plain", grid.map((r) => r.map((h) => plainOf(h).replace(/\s*\n\s*/g, " ")).join("\t")).join("\n"));
  const t = tableOf(grid);
  t.head = !!got.b.head && got.rows[0] === got.b.rows[0];
  dt.setData(CLIP, JSON.stringify([clipped(t)]));
}
const pickedHere = () => !!cpick && !inField(document.activeElement);
// cells on the clipboard: a table copied from these notes, else a spreadsheet's (tab-separated); else null
function gridIn(dt) {
  const ours = clipBlocks(dt), t = ours && ours.length === 1 && ours[0].type === "table" ? ours[0] : null;
  return t ? gridOf(t) : tsv((dt.getData("text/plain") || "").replace(/\r\n?/g, "\n"));
}
// cells put in from one (ri, ci), down and to the right: rows and columns added as they need, the cells picked after
function fillCells(b, ri, ci, grid) {
  const width = Math.max(...grid.map((r) => r.length)), needR = Math.max(0, ri + grid.length - b.rows.length), needC = Math.max(0, ci + width - b.cols.length);
  if (b.rows.length + needR > MAX_ROWS || b.cols.length + needC > MAX_COLS) return say(`A table has ${MAX_ROWS} rows and ${MAX_COLS} columns at most`, true);
  const ops = [], rows = b.rows.map((r) => r.id), cols = b.cols.map((c) => c.id);
  holdKeys();                                            // (out of the cell typed in: drawn with what is pasted)
  for (let k = 0; k < needC; k++) { const id = rid(); ops.push({ op: "col.put", page: current, block: b.id, col: { id }, after: cols[cols.length - 1] }); cols.push(id); }
  for (let k = 0; k < needR; k++) { const id = rid(); ops.push({ op: "row.put", page: current, block: b.id, row: { id, cells: {} }, after: rows[rows.length - 1] }); rows.push(id); }
  grid.forEach((r, i) => r.forEach((h, j) => { const row = rows[ri + i], col = cols[ci + j]; if (cellText(b, row, col) !== h) ops.push(cellOp(current, b.id, row, col, h)); }));
  tableDo(ops);
  pickCells(blockOf(b.id), ri, ci, ri + grid.length - 1, ci + width - 1);
}
export async function cellPaste(ev, cell) {
  ev.preventDefault();
  const at = cellOf(cell), grid = gridIn(ev.clipboardData), text = (ev.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n");
  if (!at || page().deleted) return;
  if (grid) return fillCells(at.b, at.ri, at.ci, grid);
  if (text) document.execCommand("insertHTML", false, esc(text.replace(/\n+$/, "")).replace(/\n/g, "<br>"));
}

export function wireTables() {
  // the columns laid out again as the page's width changes
  new ResizeObserver(() => { for (const n of box.querySelectorAll('.blk[data-type="table"]')) { const b = blockOf(n.dataset.id); if (b && b.type === "table") layoutTable(n, b); } }).observe(box);
  // -- the handles: shown at the cell the pointer is over; dragged (a row, a column, an edge, a + bar), or clicked
  box.addEventListener("pointerover", (ev) => {
    if (tdrag) return;
    const td = ev.target.closest && ev.target.closest(".tbl td, .tbl th");
    if (!td) return;
    const wrap = td.closest(".tbl"), tr = td.parentElement, ch = wrap.querySelector(".tbl-ch"), rh = wrap.querySelector(".tbl-rh");
    ch.style.left = `${td.offsetLeft + td.offsetWidth / 2}px`;
    ch.dataset.col = td.firstChild.dataset.col;
    rh.style.top = `${tr.offsetTop + tr.offsetHeight / 2}px`;
    rh.dataset.row = tr.dataset.row;
    wrap.classList.add("hover");
  });
  box.addEventListener("pointerout", (ev) => {
    const wrap = ev.target.closest && ev.target.closest(".tbl");
    if (wrap && !tdrag && !(ev.relatedTarget && wrap.contains(ev.relatedTarget))) wrap.classList.remove("hover");
  });
  box.addEventListener("pointerdown", (ev) => {
    const h = ev.target.closest && ev.target.closest(".tbl-h, .tbl-add, .tbl-rs");
    if (!h || ev.button !== 0 || !page() || page().deleted) return;
    ev.preventDefault();
    const n = h.closest(".blk"), b = blockOf(n.dataset.id);
    if (!b || b.type !== "table") return;
    const kind = h.classList.contains("tbl-rs") ? "size" : h.classList.contains("tbl-ch") ? "col" : h.classList.contains("tbl-rh") ? "row"
      : h.classList.contains("tbl-add-col") ? "addcol" : "addrow";
    const id = kind === "row" ? h.dataset.row : h.dataset.col;
    tdrag = { kind, n, b, id, h, x: ev.clientX, y: ev.clientY, moved: false, count: 1 };
    if (kind === "size") {
      const j = b.cols.findIndex((c) => c.id === id);
      tdrag.w0 = parseFloat(n.querySelector("colgroup").children[j].style.width) || AUTO_MIN;
      document.body.classList.add("tsizing");
    }
    h.classList.add("held");
    h.setPointerCapture(ev.pointerId);
  });
  box.addEventListener("pointermove", (ev) => {
    const d = tdrag;
    if (!d) return;
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === "size") {
      d.w = Math.round(Math.max(COL_W[0], Math.min(COL_W[1], d.w0 + dx)));
      return layoutTable(d.n, d.b, d.b.cols.map((c) => (c.id === d.id ? { ...c, w: d.w } : c)));
    }
    if (d.kind === "addrow" || d.kind === "addcol") {
      d.count = Math.max(1, 1 + Math.floor(Math.max(0, d.kind === "addrow" ? dy : dx) / (d.kind === "addrow" ? 34 : 110)));
      d.h.dataset.n = `+${d.count} ${d.kind === "addrow" ? (d.count === 1 ? "row" : "rows") : d.count === 1 ? "column" : "columns"}`;
      return;
    }
    // a row or a column moved: where it would go, a line there
    const body = d.n.querySelector("tbody"), inner = d.n.querySelector(".tbl-in");
    const spots = d.kind === "row" ? [...body.rows].map((tr) => [tr.dataset.row, tr.getBoundingClientRect()])
      : [...body.rows[0].cells].map((td) => [td.firstChild.dataset.col, td.getBoundingClientRect()]);
    const rest = spots.filter(([id]) => id !== d.id), at = d.kind === "row" ? ev.clientY : ev.clientX;
    let i = rest.findIndex(([, r]) => at < (d.kind === "row" ? r.top + r.height / 2 : r.left + r.width / 2));
    if (i < 0) i = rest.length;
    d.at = i;
    const line = inner.querySelector(".tbl-drop") || inner.appendChild(el("div", { class: "tbl-drop" })), o = inner.getBoundingClientRect();
    const edge = i < rest.length ? (d.kind === "row" ? rest[i][1].top : rest[i][1].left) : (d.kind === "row" ? rest[rest.length - 1][1].bottom : rest[rest.length - 1][1].right);
    Object.assign(line.style, d.kind === "row" ? { left: "0", right: "0", width: "", height: "2px", top: `${edge - o.top - 1}px`, bottom: "" }
      : { top: "0", bottom: "0", height: "", width: "2px", left: `${edge - o.left - 1}px`, right: "" });
  });
  box.addEventListener("pointerup", tdragEnd);
  box.addEventListener("pointercancel", tdragEnd);
  box.addEventListener("dblclick", (ev) => {
    const e = ev.target.closest && ev.target.closest(".tbl-rs"), b = e && blockOf(e.closest(".blk").dataset.id);
    if (b && !page().deleted && b.cols.some((c) => c.id === e.dataset.col && c.w)) tableDo([{ op: "col.put", page: current, block: b.id, col: { id: e.dataset.col, w: null } }]);
  });
  // -- cells picked: dragged across, Shift+clicked; put down by a click elsewhere; their keys, and the clipboard
  box.addEventListener("pointerdown", (ev) => {
    const cell = ev.target.closest && ev.target.closest(".tbl .cell");
    if (!cell || ev.button !== 0) return;
    const at = cellOf(cell);
    if (!at) return;
    if (ev.shiftKey) {                                     // from the cell typed in (or those picked) to this one
      const f = document.activeElement, from = cpick && cpick.id === at.b.id ? { ri: cpick.r0, ci: cpick.c0 }
        : f && f.classList && f.classList.contains("cell") ? cellOf(f) : null;
      if (from && (!from.b || from.b.id === at.b.id) && (from.ri !== at.ri || from.ci !== at.ci)) {
        setEatMouse(true);
        pickCells(at.b, from.ri, from.ci, at.ri, at.ci);
        return holdKeys();
      }
    }
    unpickCells();
    csweep = { id: at.b.id, ri: at.ri, ci: at.ci, on: false };
  });
  document.addEventListener("pointermove", (ev) => {
    if (!csweep) return;
    const e = document.elementFromPoint(ev.clientX, ev.clientY), td = e && e.closest && e.closest(".tbl td, .tbl th");
    const at = td && cellOf(td.firstChild);
    if (!at || at.b.id !== csweep.id || (!csweep.on && at.ri === csweep.ri && at.ci === csweep.ci)) return;
    if (!csweep.on) { csweep.on = true; if (document.activeElement && document.activeElement.classList.contains("cell")) document.activeElement.blur(); }
    getSelection().removeAllRanges();
    pickCells(at.b, csweep.ri, csweep.ci, at.ri, at.ci);
  });
  document.addEventListener("pointerup", () => { const s = csweep; csweep = null; if (s && s.on && cpick) holdKeys(); });
  document.addEventListener("pointerdown", (ev) => {        // a click anywhere else puts the cells down
    if (cpick && !(ev.target.closest && ev.target.closest(".pop, .tbl.cell-picking td, .tbl.cell-picking th"))) unpickCells();
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (!cpick || ev.defaultPrevented || ev.isComposing || inField(ev.target) || menu) return;
    const b = blockOf(cpick.id), mod = ev.metaKey || ev.ctrlKey, k = ev.key;
    if (!b) return unpickCells();
    if (k === "Escape") { ev.preventDefault(); return unpickCells(); }
    if (mod && !ev.shiftKey && k.toLowerCase() === "a") { ev.preventDefault(); return pickCells(b, 0, 0, b.rows.length - 1, b.cols.length - 1); }
    const dir = DIRS[k];
    if (dir && ev.shiftKey && !mod) { ev.preventDefault(); return pickCells(b, cpick.r0, cpick.c0, cpick.r1 + dir[0], cpick.c1 + dir[1]); }
    if ((dir || k === "Enter" || k === "Tab") && !mod) {
      ev.preventDefault();
      const r = cpick.r1, c = cpick.c1;
      unpickCells();
      return focusCell(b, r, c);
    }
    if ((k === "Backspace" || k === "Delete") && !page().deleted) { ev.preventDefault(); return emptyCells(); }
  });
  document.addEventListener("copy", (ev) => { if (pickedHere()) { ev.preventDefault(); clipCells(ev.clipboardData); } });
  document.addEventListener("cut", (ev) => { if (pickedHere()) { ev.preventDefault(); clipCells(ev.clipboardData); if (!page().deleted) emptyCells(); } });
  document.addEventListener("paste", (ev) => {
    if (!pickedHere() || page().deleted) return;
    ev.preventDefault();
    const got = pickedCells(), grid = gridIn(ev.clipboardData);
    if (got && grid) fillCells(got.b, got.b.rows.indexOf(got.rows[0]), got.b.cols.indexOf(got.cols[0]), grid);
  });
}
