// Notes: lines picked -- several at once.
// Whole lines (Notion's block selection), always a run of the page's, `anchor` to `head`: picked by a drag from one
// line's words into others (back into its own, its text selected again), a box dragged from beside the lines,
// Shift+click, Esc in a line (then Shift+↑↓ more or fewer), Shift+↑↓ past a line's end, ⌘A twice, or words selected
// from one line into another. While lines are picked the keys are the page's (the blocks' box has them, no caret): ⌫
// deletes them (Undo brings them back), ⌘C ⌘X copy and cut them (as markdown, and as themselves for these notes), ⌘V
// puts lines after them, Tab and ⇧Tab indent them, ⌘D duplicates them, ⌘↵ ticks their to-dos, ⌘⇧↑↓ moves them, ↵ goes
// back to typing; their grip drags them all, and its menu (or the bar over them) turns them into a type, or sends them
// to an agent as one message. A click anywhere else, or Esc, puts them down.
// In the editor (editor.js) they are its selection, a LinesSelection (doc.js): while they are, the view isn't editable --
// no caret, no text selected -- and the keys and the clipboard are the page's, here.
import { $, clean, el, esc, INDENTED, KINDS, MAX_INDENT, now, plainOf, rid, SPECIAL, SVG, TYPES,
  UNSENT } from "./helpers.js";
import { convo, current, eatMouse, pages, sayTimer, setConvo, setEatMouse, setSayTimer } from "./state.js";
import { pageOfLink } from "./model.js";
import { Selection, TextSelection } from "./vendor/prosemirror.js";
import { blockAt, LinesSelection } from "./doc.js";
import { edit, here, refreshView, view } from "./editor.js";
import { change, flushTyped, forget, pump } from "./send.js";
import { historyOf, undoStep } from "./undo.js";
import { blockOf, box, drawPage, openPage, page, rowOf, shown } from "./page.js";
import { editable, focusBlock } from "./caret.js";
import { retypeOp } from "./typing.js";
import { item, menu, popUp } from "./popups.js";
import { drag, moveOps } from "./gutter.js";
import { belowClick } from "./title.js";
import { parsed, putBlocks } from "./paste.js";
import { freshTable, tableMd, tableOf, tsv, unpickCells } from "./tables.js";
import { figmaTitle } from "./pictures.js";
import { isWork, markWork } from "./actors.js";
import { openPicker } from "./picker.js";

export const picked = new Set();                         // the lines picked: a run of the page's, `anchor` to `head` (the
let anchor = null, head = null;                          // editor's selection's, as drawPicked last drew it)
let pending = null;                                      // {a, z}: lines picked by a drag going on, the editor's once it ends
let undo = null;                                         // {pid, step}: lines just deleted, the toast's Undo
const order = () => { const p = shown(); return p ? p.blocks.map((b) => b.id) : []; };   // (the lines shown: none folded away)
const pickedBlocks = () => { const p = page(); return p ? p.blocks.filter((b) => picked.has(b.id)) : []; };
export function pickRange(a, z) {
  unpickCells();
  if (sweep || band) {                                   // (the browser's own selection left alone while the mouse drags)
    pending = order().includes(a) && order().includes(z) ? { a, z } : null;
    return drawPicked();
  }
  const sel = view && LinesSelection.create(view.state.doc, a, z);
  if (!sel) return unpick();
  edit(view.state.tr.setSelection(sel), "select");
  const r = rowOf(z);
  if (r && !drag && !band && !sweep) r.scrollIntoView({ block: "nearest" });
}
export function pickAll() { const ids = order(); if (ids.length) pickRange(ids[0], ids[ids.length - 1]); }
// the lines put down: the caret (should the keys come back to the page) at the end of the last of them
export function unpick() {
  if (pending) { pending = null; return drawPicked(); }
  const sel = view && view.state.selection;
  if (!(sel instanceof LinesSelection)) return;
  const doc = view.state.doc, at = blockAt(doc, sel.head), end = at ? at.pos + at.node.nodeSize - (at.node.inlineContent ? 1 : 0) : 0;
  edit(view.state.tr.setSelection(at && at.node.inlineContent ? TextSelection.create(doc, end) : Selection.near(doc.resolve(end))), "select");
}
// the page's keys, not a line's: no caret, no text selected (the editor not editable: lines or cells picked)
export function holdKeys() {
  flushTyped();
  pump();
  const s = getSelection();
  if (s.rangeCount) s.removeAllRanges();
  refreshView();
  if (document.activeElement !== box) box.focus({ preventScroll: true });
}
// the rows marked as picked, as the editor's selection has them now, and the bar over a run of several
export function drawPicked() {
  const sel = view && view.state.selection, lines = sel instanceof LinesSelection, all = order();
  const run = pending ? all.slice(Math.min(all.indexOf(pending.a), all.indexOf(pending.z)), Math.max(all.indexOf(pending.a), all.indexOf(pending.z)) + 1) : null;
  const ids = run || (lines ? sel.ids : []);
  picked.clear();
  for (const id of ids) picked.add(id);
  anchor = pending ? pending.a : lines ? sel.anchorId : null;
  head = pending ? pending.z : lines ? sel.headId : null;
  for (const n of box.children) n.classList.toggle("picked", picked.has(n.dataset.id));
  box.classList.toggle("picking", ids.length > 0);
  box.classList.toggle("grp", ids.length > 1);
  const bar = $("pk-bar"), p = page();
  if (ids.length < 2 || !p || p.deleted) { bar.hidden = true; return; }
  const n = ids.length, can = sendable(pickedBlocks()).length;
  if (bar.dataset.n !== `${n}:${can}`) {
    bar.dataset.n = `${n}:${can}`;
    bar.replaceChildren(el("span", { class: "pk-n", text: `${n} lines` }),
      can ? el("button", { type: "button", class: "pk-send", title: `Send ${can === n ? "" : `${can} of ${n} lines `}to an agent as one message`,
        onclick: (ev) => {                               // the lines picked now (the bar is drawn again only as their count changes)
          const now = pickedBlocks().map((b) => b.id);
          if (now.length) openPicker(now[0], ev.currentTarget.getBoundingClientRect(), now);
        } },
      el("span", { html: SVG.at }), el("span", { text: "Send to an agent" })) : null,
      el("button", { type: "button", class: "pk-more", title: "More", "aria-label": "More", html: SVG.more,
        onclick: (ev) => linesMenu(ev.currentTarget.getBoundingClientRect()) }));
  }
  bar.hidden = false;
  const first = rowOf(ids[0]);
  bar.style.top = `${Math.max(0, first.offsetTop - bar.offsetHeight - 4)}px`;
  bar.style.left = `${box.offsetLeft + box.offsetWidth - bar.offsetWidth}px`;
}
// a line as its copy has it: a new id, and nothing of whom it was sent to or how it was ended
export const copyOf = ({ calls: _calls, to: _to, sent: _sent, thread: _thread, extra: _extra, group: _group, work: _work, ended: _ended, ended_at: _at,
  source: _source, source_at: _sourceAt, ...rest }) => ({ ...(rest.type === "table" ? freshTable(rest) : rest), id: rid() });
// lines with words to send (no divider, no agents table)
export const sendable = (bs) => bs.filter((b) => !UNSENT.includes(b.type) && plainOf(b.type === "code" ? esc(b.text) : b.text).trim());

// -- what picked lines do
function deleteLines() {
  const p = page(), bs = pickedBlocks();
  if (!p || p.deleted || !bs.length) return;
  const i = p.blocks.indexOf(bs[0]), before = i > 0 ? p.blocks[i - 1].id : "";
  const gone = bs.map((b) => JSON.parse(JSON.stringify(b)));
  for (const b of bs) forget(b.id);
  const ops = bs.map((b) => ({ op: "block.delete", page: p.id, block: b.id }));
  const fresh = p.blocks.length === bs.length ? { id: rid(), type: "text", text: "", checked: false, indent: 0 } : null;
  if (fresh) ops.push({ op: "block.put", page: p.id, block: fresh });   // a page keeps a line to type in
  change(ops);
  unpick();
  if (convo && gone.some((b) => b.id === convo.block)) setConvo(null);
  drawPage();
  const near = fresh || (before ? blockOf(before) : page().blocks[0]);
  if (near) focusBlock(near.id, before ? "end" : "start");
  const h = historyOf(p.id);
  undoable(`${gone.length === 1 ? "Line" : `${gone.length} lines`} deleted`, p.id, h.done[h.done.length - 1]);
}
// a toast with Undo, for as long as its step is still the page's last
function undoable(text, pid, step) {
  const w = $("who");
  undo = { pid, step };
  w.classList.remove("bad");
  w.replaceChildren(el("span", { text }), el("button", { type: "button", class: "undo", text: "Undo", onclick: () => takeBack() }));
  w.style.opacity = "1";
  clearTimeout(sayTimer);
  setSayTimer(setTimeout(() => { w.style.opacity = "0"; undo = null; }, 12000));
}
function takeBack() {
  const u = undo;
  undo = null;
  $("who").style.opacity = "0";
  if (!u) return;
  const h = historyOf(u.pid);
  if (h.done[h.done.length - 1] !== u.step) return;
  if (current !== u.pid) openPage(u.pid);
  undoStep();
}
function indentLines(by) {
  const ops = pickedBlocks().filter((b) => INDENTED.includes(b.type)).map((b) => [b, Math.max(0, Math.min(MAX_INDENT, (b.indent || 0) + by))])
    .filter(([b, to]) => to !== (b.indent || 0)).map(([b, to]) => ({ op: "block.put", page: current, block: { id: b.id, indent: to } }));
  if (ops.length) { change(ops); drawPage(); }
}
function tickLines() {                                   // all ticked, unless all are: then none
  const todos = pickedBlocks().filter((b) => b.type === "todo");
  if (!todos.length) return;
  const to = todos.some((b) => !b.checked), at = now();
  change(todos.map((b) => ({ op: "block.put", page: current, block: { id: b.id, checked: to, ...(isWork(b) ? { ended: to ? "done" : "", ended_at: at } : {}) } })));
  drawPage();
}
function duplicateLines() {
  const bs = pickedBlocks();
  if (!bs.length) return;
  let after = bs[bs.length - 1].id;
  const copies = bs.map(copyOf);
  change(copies.map((c) => { const op = { op: "block.put", page: current, block: c, after }; after = c.id; return op; }));
  drawPage();
  pickRange(copies[0].id, copies[copies.length - 1].id);
}
function moveLines(by) {
  const all = order(), ids = all.filter((id) => picked.has(id));
  const i = all.indexOf(ids[0]), j = all.indexOf(ids[ids.length - 1]);
  if (by < 0 ? i <= 0 : j >= all.length - 1) return;
  change(moveOps(ids, by < 0 ? (i >= 2 ? all[i - 2] : "") : all[j + 1]));
  drawPage();
  const r = rowOf(head);
  if (r) r.scrollIntoView({ block: "nearest" });
}
function retypeLines(type) {
  const ops = pickedBlocks().filter(editable).filter((b) => b.type !== type).map((b) => retypeOp(b, type));
  if (ops.length) { change(ops); drawPage(); }
}
// the picked lines' menu: a type for them all, sent to an agent together, duplicated, deleted
export function linesMenu(rect, n = null) {
  const bs = pickedBlocks(), can = sendable(bs), unmarked = can.filter((b) => !isWork(b));
  if (!bs.length) return;
  const types = new Set(bs.map((b) => b.type));
  if (n) n.classList.add("menu-open");
  popUp(rect, (pop) => {
    pop.append(el("div", { class: "hd", text: `Turn ${bs.length} lines into` }));
    for (const k of KINDS) if (!UNSENT.includes(k.type))
      pop.append(item({ ...k, note: "", sm: true, cur: types.size === 1 && types.has(k.type) }, () => { retypeLines(k.type); holdKeys(); }));
    pop.append(el("div", { class: "sep" }),
      ...(can.length ? [item({ glyph: SVG.at, sm: true, label: `Send ${can.length === bs.length ? "them" : `${can.length} of them`} to an agent…` },
        () => openPicker(can[0].id, rect, can.map((b) => b.id)))] : []),
      ...(bs.some((b) => b.type === "todo") ? [item({ glyph: SVG.check, sm: true, label: bs.some((b) => b.type === "todo" && !b.checked) ? "Tick the to-dos" : "Untick the to-dos", note: "⌘↵" },
        () => { tickLines(); holdKeys(); })] : []),
      ...(unmarked.length ? [item({ glyph: SVG.work, sm: true, label: unmarked.length === 1 ? "Mark 1 as a work item" : `Mark ${unmarked.length} as work items`, note: "Tracked on the Work page" },
        () => { markWork(unmarked, true); holdKeys(); })] : []),
      item({ glyph: "⧉", sm: true, label: "Duplicate", note: "⌘D" }, () => { duplicateLines(); holdKeys(); }),
      item({ glyph: SVG.trash, sm: true, label: `Delete ${bs.length} lines`, note: "⌫", bad: true }, () => deleteLines()));
  }, () => { if (n) n.classList.remove("menu-open"); });
}

// -- copied and pasted: as markdown for anywhere, and as the blocks themselves for these notes
export const CLIP = "application/x-ag-notes-blocks";
function clip(dt) {
  const bs = pickedBlocks();
  dt.setData("text/plain", mdLines(bs).join("\n"));
  dt.setData(CLIP, JSON.stringify(bs.map(clipped)));
}
export const clipped = (b) => (b.type === "table" ? { type: "table", text: "", checked: false, indent: 0, cols: b.cols, rows: b.rows, head: !!b.head, head_col: !!b.head_col }
  : { type: b.type, text: b.text, checked: !!b.checked, indent: b.indent || 0 });
export function clipBlocks(dt) {
  let got;
  try { got = JSON.parse(dt.getData(CLIP) || "null"); } catch { return null; }
  if (!Array.isArray(got) || !got.length) return null;
  const isTable = (b) => b.type === "table" && Array.isArray(b.cols) && Array.isArray(b.rows) && b.cols.length && b.rows.length
    && b.cols.every((c) => c && typeof c.id === "string") && b.rows.every((r) => r && typeof r.id === "string" && r.cells && typeof r.cells === "object");
  const ok = got.filter((b) => b && ((TYPES.includes(b.type) && typeof b.text === "string") || isTable(b)));
  return ok.length ? ok.map((b) => (b.type === "table" ? { ...freshTable({ cols: b.cols.map((c) => ({ id: c.id, ...(Number.isFinite(c.w) ? { w: c.w } : {}) })), rows: b.rows }),
    id: rid(), type: "table", text: "", checked: false, indent: 0, head: b.head !== false, head_col: !!b.head_col } : { id: rid(), type: b.type, text: b.text, checked: !!b.checked && b.type === "todo",
    indent: INDENTED.includes(b.type) ? Math.max(0, Math.min(MAX_INDENT, Number(b.indent) || 0)) : 0 })) : null;
}
// a block's text (clean HTML) as markdown: notebook.py's inline_markdown, a line break a new line
export function mdInline(h) {
  const t = document.createElement("template");
  t.innerHTML = clean(h);
  const walk = (node) => [...node.childNodes].map((c) => {
    if (c.nodeType === 3) return c.textContent;
    if (c.nodeType !== 1) return "";
    const tag = c.nodeName.toLowerCase(), inner = walk(c);
    if (tag === "br") return "\n";
    if (tag === "a") { const id = pageOfLink(c), p = id && pages.get(id); return `[${p ? p.title || "Untitled" : inner}](${c.getAttribute("href") || ""})`; }
    const m = { b: "**", i: "*", s: "~~", code: "`" }[tag] || "";
    return m + inner + m;
  }).join("");
  return walk(t.content);
}
// lines as markdown (notebook.py's markdown_lines, without ids): indents from the least of them, lists numbered afresh
export function mdLines(bs) {
  const ins = bs.filter((b) => INDENTED.includes(b.type)).map((b) => b.indent || 0);
  const base = ins.length ? Math.min(...ins) : 0, out = [], counts = new Map();
  for (const b of bs) {
    const k = INDENTED.includes(b.type) ? Math.max(0, (b.indent || 0) - base) : 0;
    for (const d of [...counts.keys()]) if (d > k) counts.delete(d);
    if (b.type === "number") counts.set(k, (counts.get(k) || 0) + 1); else counts.delete(k);
    if (b.type === "code") { out.push("```", ...String(b.text).split("\n"), "```"); continue; }
    if (b.type === "divider") { out.push("---"); continue; }
    if (b.type === "agents" || b.type === "work") continue;
    if (b.type === "table") { out.push(...tableMd(b)); continue; }
    if (b.type === "image") { out.push(`![${mdInline(b.text)}](image:${b.file})`); continue; }
    if (b.type === "figma") { out.push(`[Figma: ${b.title || figmaTitle(b.url) || "a frame"}](${b.url})${b.text ? ` -- ${mdInline(b.text)}` : ""}`); continue; }
    const pad = "  ".repeat(k), mark = { text: "", h1: "# ", h2: "## ", h3: "### ", bullet: "- ", quote: "> ",
      todo: b.checked ? "- [x] " : "- [ ] ", number: `${counts.get(k)}. ` }[b.type] || "";
    out.push(pad + mark + mdInline(b.text).replace(/\n/g, `\n${pad}${" ".repeat(mark.length)}`));
  }
  return out;
}

// -- the keys, the clipboard, and clicks, while lines are picked
// (the lines' editor counts while it is editable: no lines or cells picked; a divider or picture focused in it, not)
export const inField = (t) => !!(t && t.closest && (t.isContentEditable || t.closest(".tx, input, textarea, .pop, .convo")));
const theirs = () => picked.size > 0 && !inField(document.activeElement);

// -- the drags that pick: a sweep from a line's words, a box from beside the lines
let sweep = null, band = null;
const BAND_NOT = ".tx, .tbl, button, input, textarea, a, .pg-title, .pg-icon, .pg-tools, .agt, .hr, .fig, .sent, .fold, .fold-all, .gut, .chk, .banner, .empty, .pk-bar";
function rowAt(y) {                                     // the line at a height (above the first: it; below the last: it)
  const rows = [...box.children];
  return rows.find((r) => y < r.getBoundingClientRect().bottom) || rows[rows.length - 1] || null;
}
function edgeScroll(y) {
  const sc = $("scroll"), r = sc.getBoundingClientRect();
  if (y < r.top + 30) sc.scrollTop -= 12;
  else if (y > r.bottom - 30) sc.scrollTop += 12;
}
function endPick(ev) {
  const got = pending;                                   // the lines the drag picked: the editor's selection now
  pending = null;
  if (sweep) {
    const s = sweep;
    sweep = null;
    document.body.classList.remove("sweeping");
    if (s.on && got) { pickRange(got.a, got.z); holdKeys(); }
  }
  if (band) {
    const b = band;
    band = null;
    $("band").hidden = true;
    document.body.classList.remove("banding");
    if (b.on) { if (got) { pickRange(got.a, got.z); holdKeys(); } }
    else if (b.below && ev.type === "pointerup") belowClick();
  }
  if (got && !picked.size) drawPicked();
}
// Words selected from one line into another, however the browser came to select them (its own Shift+→ out of a line,
// a drag from beside the lines): those lines picked, whole -- words across lines can't be cut, typed over or indented.
// Looked at as the editor's selection changes (editor.js), and once the mouse is let go -- not while it drags.
let held = false;
export function crossPick() {
  if (held || sweep || band || !view) return;
  const sel = view.state.selection, doc = view.state.doc;
  if (!(sel instanceof TextSelection) || sel.empty) return;
  const a = blockAt(doc, sel.anchor), z = blockAt(doc, sel.head);
  if (!a || !z || a.node.attrs.id === z.node.attrs.id) return;
  pickRange(a.node.attrs.id, z.node.attrs.id);
  holdKeys();
}

export function wirePicked() {
  box.tabIndex = -1;                                     // (the page's keys, while lines are picked: holdKeys)
  // -- the keys, the clipboard, and clicks, while lines are picked
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.isComposing || inField(ev.target)) return;
    const mod = ev.metaKey || ev.ctrlKey, k = ev.key, low = k.toLowerCase();
    if (mod && !ev.altKey && low === "z") { ev.preventDefault(); return undoStep(ev.shiftKey); }
    if (!picked.size || menu) return;
    const p = page(), ro = !p || !!p.deleted, all = order();
    if (k === "Escape") { ev.preventDefault(); return unpick(); }
    if (mod && !ev.shiftKey && low === "a") { ev.preventDefault(); return pickAll(); }
    if (k === "ArrowUp" || k === "ArrowDown") {
      ev.preventDefault();
      const up = k === "ArrowUp";
      if (mod && ev.shiftKey) return ro ? null : moveLines(up ? -1 : 1);
      if (ev.shiftKey) { const j = all.indexOf(head) + (up ? -1 : 1); if (j >= 0 && j < all.length) pickRange(anchor, all[j]); return; }
      const ids = all.filter((id) => picked.has(id)), j = up ? all.indexOf(ids[0]) - 1 : all.indexOf(ids[ids.length - 1]) + 1;
      if (j >= 0 && j < all.length) pickRange(all[j], all[j]);
      return;
    }
    if (k === "Enter" && !mod && !ev.shiftKey) { ev.preventDefault(); const at = head; unpick(); return focusBlock(at, "end"); }
    if (ro) return;
    if (k === "Backspace" || k === "Delete") { ev.preventDefault(); return deleteLines(); }
    if (k === "Tab") { ev.preventDefault(); return indentLines(ev.shiftKey ? -1 : 1); }
    if (mod && k === "Enter") { ev.preventDefault(); return tickLines(); }
    if (mod && !ev.shiftKey && low === "d") { ev.preventDefault(); return duplicateLines(); }
  });
  document.addEventListener("copy", (ev) => { if (theirs()) { ev.preventDefault(); clip(ev.clipboardData); } });
  document.addEventListener("cut", (ev) => {
    if (!theirs()) return;
    ev.preventDefault();
    clip(ev.clipboardData);
    if (!page().deleted) deleteLines();
  });
  document.addEventListener("paste", async (ev) => {      // after the lines picked, and then those picked
    if (!theirs() || page().deleted) return;
    ev.preventDefault();
    const ids = order().filter((id) => picked.has(id)), last = ids[ids.length - 1];
    const text = (ev.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    let got = clipBlocks(ev.clipboardData);
    if (!got && tsv(text)) got = [tableOf(tsv(text))];
    if (!got) { try { got = text.trim() ? await parsed(text) : []; } catch { got = []; } }
    if (!got.length || !blockOf(last)) return;
    putBlocks(got, last);
    pickRange(got[0].id, got[got.length - 1].id);
    holdKeys();
  });
  // a click anywhere puts the lines down -- but in a menu, on the bar, on a picked line's grip, or Shift+click on a line
  document.addEventListener("pointerdown", (ev) => {
    if (!picked.size) return;
    const t = ev.target;
    if (t.closest && t.closest(".pop, .pk-bar, .blk.picked > .gut .grip")) return;
    if (ev.shiftKey && t.closest && t.closest("#blocks > .blk")) return;
    unpick();
  }, true);
  // -- the drags that pick: a sweep from a line's words, a box from beside the lines
  $("scroll").addEventListener("pointerdown", (ev) => {
    const sc = $("scroll");
    if (ev.button !== 0 || SPECIAL.includes(current) || !page() || ev.target.closest(".pop")) return;
    if (ev.target === sc && ev.clientX >= sc.getBoundingClientRect().left + sc.clientWidth) return;   // its scrollbar
    const n = ev.target.closest(".blk");
    if (ev.shiftKey && n && box.contains(n) && !ev.target.closest("button, .chk, a")) {
      const f = document.activeElement, h = f === box && view.editable && here();   // (the line the caret is in, or one focused)
      const fn = f && box.contains(f) && f !== box ? f.closest(".blk") : null;
      const from = picked.size ? anchor : h ? h.id : fn ? fn.dataset.id : null;
      if (from && (picked.size || from !== n.dataset.id)) {   // (Shift+click in the line typed in: its text, as ever)
        setEatMouse(true);
        pickRange(from, n.dataset.id);
        holdKeys();
        return;
      }
    }
    if (ev.target.closest(".tx") && n) { sweep = { row: n, on: false }; return; }
    if (ev.target.closest(BAND_NOT)) return;
    band = { x: ev.clientX, y: ev.clientY + sc.scrollTop, on: false, below: !!ev.target.closest("#below") };
    setEatMouse(true);                                       // no text selected, no focus lost, as the box is dragged
  });
  document.addEventListener("mousedown", (ev) => { if (eatMouse) { setEatMouse(false); ev.preventDefault(); } }, true);
  document.addEventListener("pointermove", (ev) => {
    if (sweep) {
      const r = rowAt(ev.clientY);
      if (!r) return;
      if (r !== sweep.row) {
        if (!sweep.on) { sweep.on = true; document.body.classList.add("sweeping"); }
        pickRange(sweep.row.dataset.id, r.dataset.id);
      } else if (sweep.on) {                               // back in its own line: its text, selected as the drag goes
        sweep.on = false;
        document.body.classList.remove("sweeping");
        unpick();
      }
      edgeScroll(ev.clientY);
    } else if (band) {
      const sc = $("scroll"), y0 = band.y - sc.scrollTop;
      if (!band.on && Math.hypot(ev.clientX - band.x, ev.clientY - y0) < 5) return;
      if (!band.on) { band.on = true; document.body.classList.add("banding"); }
      const top = Math.min(y0, ev.clientY), bottom = Math.max(y0, ev.clientY);
      Object.assign($("band").style, { left: `${Math.min(band.x, ev.clientX)}px`, top: `${top}px`,
        width: `${Math.abs(ev.clientX - band.x)}px`, height: `${bottom - top}px` });
      $("band").hidden = false;
      const hit = [...box.children].filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > top && b.top < bottom; });
      if (!hit.length) unpick();
      else {
        const down = ev.clientY >= y0, a = (down ? hit[0] : hit[hit.length - 1]).dataset.id, z = (down ? hit[hit.length - 1] : hit[0]).dataset.id;
        pickRange(a, z);
      }
      edgeScroll(ev.clientY);
    }
  });
  document.addEventListener("pointerup", endPick);
  document.addEventListener("pointercancel", endPick);
  // -- words selected from one line into another: those lines picked (crossPick), once the mouse is let go
  document.addEventListener("pointerdown", () => { held = true; }, true);
  document.addEventListener("pointerup", () => { held = false; crossPick(); });
  document.addEventListener("pointercancel", () => { held = false; });
  window.addEventListener("blur", () => { held = false; });
}
