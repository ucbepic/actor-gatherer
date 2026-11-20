// Notes: undo.
// ⌘Z takes back the reader's last change to the page open, ⌘⇧Z does it again -- never the browser's own undo, which
// knows nothing of the lines' ops (after a line was moved, it took letters out of another). A step is a change() to the
// page's lines (moved, split, joined, pasted, cut, indented, ticked, turned into another type...) or to its title or
// icon, or a run of typing in one line or the title (until a pause, or another line). It holds the ops that do it and
// those that take it back, worked out from the page as it was just before. If a line it touched has changed since (an
// agent's change, another window's), the step is left as it is, and the reader told: nobody else's words are undone.
// Not steps: a line sent to an agent, or canceled (its message can't be taken back), conversations, pages made, binned
// or restored. One history per page, for as long as the panel is open.
import { plainOf, SPECIAL } from "./helpers.js";
import { current, known, pages, run, setRun } from "./state.js";
import { change, flushTyped } from "./send.js";
import { drawSide } from "./sidebar.js";
import { blockOf, box, drawPage, page } from "./page.js";
import { caretIn, focusBlock, setCaret } from "./caret.js";
import { holdKeys, picked, pickRange, unpick } from "./picked.js";
import { title } from "./title.js";
import { cellEl, cellKey, TABLE_OPS, tableBack } from "./tables.js";
import { say } from "./actors.js";

const PAUSE = 1000;                                      // a run of typing ends after this long without a key
const LINE = ["type", "text", "checked", "indent"];      // what tells whether a line changed since
const BLANK = { type: "text", text: "", checked: false, indent: 0, calls: [], work: false, ended: "", ended_at: "" };
const histories = new Map();                             // page id -> {done: [step], undone: [step]}
export let replaying = false;                            // a step's ops being applied (⌘Z, ⌘⇧Z): no step of their own
export const historyOf = (id) => { if (!histories.has(id)) histories.set(id, { done: [], undone: [] }); return histories.get(id); };
const blockId = (op) => (typeof op.block === "string" ? op.block : op.block.id);
export const copied = (x) => JSON.parse(JSON.stringify(x));
// how lines (and "@page": the title and icon) stand now, to be told apart from how a step left them
export function standing(p, ids) {
  const m = new Map();
  for (const id of ids) {
    if (id === "@page") { m.set(id, JSON.stringify([p.title || "", p.icon || ""])); continue; }
    if (id.includes(":")) {                            // a table's cell: its words
      const [bid, row, col] = id.split(":"), t = p.blocks.find((x) => x.id === bid), r = t && t.type === "table" && t.rows.find((x) => x.id === row);
      m.set(id, r && t.cols.some((c) => c.id === col) ? JSON.stringify(known.get(id) ?? (r.cells[col] || "")) : "gone");
      continue;
    }
    const b = p.blocks.find((x) => x.id === id);
    if (b && b.type === "table") { m.set(id, JSON.stringify([b.head, b.head_col, b.cols, b.rows])); continue; }
    m.set(id, b ? JSON.stringify(LINE.map((k) => (k === "text" ? known.get(id) ?? b.text : b[k] ?? BLANK[k]))) : "gone");
  }
  return m;
}
function caretNow() {                                    // where the reader is typing: a line (or "@title"), and where in it
  const a = document.activeElement, tx = a === title ? title : a && box.contains(a) && a.closest(".tx");
  if (!tx) return null;
  const c = caretIn(tx);
  return { id: tx === title ? "@title" : tx.closest(".blk").dataset.id, at: c ? c.start : null };
}
function record(h, step) {
  h.done.push(step);
  h.undone.length = 0;
  if (h.done.length > 500) h.done.shift();
}
// -- a change(): its step begun, each op's way back worked out before it is applied, and the step kept
export function stepOf(ops) {
  const p = page(), mine = (op) => op.page === current && (op.op.startsWith("block.") || op.op === "page.set" || TABLE_OPS.includes(op.op));
  if (!p || p.deleted || !ops.some(mine)) return null;
  const ids = [...new Set(ops.filter(mine).map((op) => (op.op === "page.set" ? "@page" : op.op === "cell.put" ? cellKey(op.block, op.row, op.col) : blockId(op))))];
  return { page: p.id, ids, fwd: [], back: [], before: standing(p, ids), pick: picked.size ? [...picked] : null, caret: caretNow() };
}
export function takeBackOf(step, op) {
  const p = pages.get(step.page);
  if (!p || op.page !== step.page) return;
  let back = null;
  if (op.op === "page.set") {
    back = { op: "page.set", page: p.id };
    for (const k of ["title", "icon", "parent"]) if (k in op) back[k] = k === "parent" ? p.parent || null : p[k] || "";
    if (Object.keys(back).every((k) => k === "op" || k === "page" || back[k] === (op[k] ?? back[k]))) return;
  } else if (["block.put", "block.delete", "block.move"].includes(op.op)) {
    const i = p.blocks.findIndex((x) => x.id === blockId(op)), b = p.blocks[i], prev = i > 0 ? p.blocks[i - 1].id : "";
    if (op.op === "block.put" && !b) back = { op: "block.delete", page: p.id, block: op.block.id };
    else if (!b) return;
    else if (op.op === "block.put") {
      const was = { id: b.id };
      for (const k of Object.keys(op.block)) if (k !== "id") was[k] = copied(k === "text" ? known.get(b.id) ?? b.text : b[k] ?? BLANK[k] ?? null);   // (none: null, as notebook.py takes a picture's width none -- "" it refuses)
      if (Object.keys(was).every((k) => JSON.stringify(was[k]) === JSON.stringify(op.block[k]))) return;   // (as it was)
      back = { op: "block.put", page: p.id, block: was };
    } else if (op.op === "block.delete") back = { op: "block.put", page: p.id, block: copied({ ...b, text: known.get(b.id) ?? b.text }), after: prev };
    else if (op.after === prev) return;
    else back = { op: "block.move", page: p.id, block: b.id, after: prev };
  } else if (TABLE_OPS.includes(op.op)) {
    const b = p.blocks.find((x) => x.id === op.block);
    back = b && b.type === "table" ? tableBack(p.id, b, op) : null;
    if (!back) return;
  } else return;
  step.fwd.push(copied(op));
  step.back.unshift(back);
}
export function keep(step) {
  setRun(null);                                            // a run of typing ends at any other change
  const p = pages.get(step.page);
  if (!p || !step.back.length) return;
  step.after = standing(p, step.ids);
  record(historyOf(step.page), step);
  requestAnimationFrame(() => { step.caretAfter = caretNow(); step.pickAfter = picked.size ? [...picked] : null; });
}
// -- typing: each key's change to a line's words (or the title) added to the run it belongs to
export function inRun(p, key, back) {                    // (before the words change: how they stood is the step's "before")
  const h = historyOf(p.id), at = Date.now();
  if (!(run && run.key === key && run.page === p.id && at - run.at <= PAUSE && h.done[h.done.length - 1] === run.step)) {
    const step = { page: p.id, ids: [key], fwd: [], back: [back], before: standing(p, [key]), pick: null, caret: null, words: true };
    record(h, step);
    setRun({ step, key, page: p.id });
  }
  run.at = at;
  return run.step;
}
export function wordsTyped(pid, id, text) {
  const p = pages.get(pid), was = known.has(id) ? known.get(id) : text;
  if (!replaying && p && !p.deleted && pid === current && was !== text) {
    const step = inRun(p, id, { op: "block.put", page: pid, block: { id, text: was } });
    known.set(id, text);
    step.fwd = [{ op: "block.put", page: pid, block: { id, text } }];
    step.after = standing(p, [id]);
  } else known.set(id, text);
}
export function titleTyped(p, was) {                     // (after the title changed, from `was`)
  if (replaying || p.deleted || p.id !== current || was === (p.title || "")) return;
  const now = p.title;
  p.title = was;
  const step = inRun(p, "@page", { op: "page.set", page: p.id, title: was });
  p.title = now;
  step.fwd = [{ op: "page.set", page: p.id, title: now }];
  step.after = standing(p, ["@page"]);
}
// -- ⌘Z, ⌘⇧Z
export function undoStep(again = false) {
  const p = page();
  if (!p || p.deleted || SPECIAL.includes(current)) return;
  flushTyped();
  setRun(null);
  const h = historyOf(p.id), step = (again ? h.undone : h.done).pop();
  if (!step) return;
  const now = standing(p, step.ids), want = again ? step.before : step.after;
  if (step.ids.some((id) => now.get(id) !== want.get(id))) {
    say(again ? "Can't redo: those lines have changed" : "Can't undo: those lines have changed", true);
    return;
  }
  const a = document.activeElement;                      // drawn afresh: no line kept back as being typed in
  if (a && (a === title || box.contains(a))) box.focus({ preventScroll: true });
  replaying = true;
  try { change(copied(again ? step.fwd : step.back)); } finally { replaying = false; }
  (again ? h.done : h.undone).push(step);
  unpick();
  drawSide();
  drawPage();
  placeAfter(step, again);
}
function placeAfter(step, again) {                       // the reader back where the step was: its lines picked, or the caret
  const pick = (again ? step.pickAfter : step.pick || []) || [], ids = pick.filter((id) => blockOf(id));
  if (ids.length) { pickRange(ids[0], ids[ids.length - 1]); return holdKeys(); }
  if (step.words) {                                     // where the words changed, at the end of what is there now
    const op = again ? step.fwd[0] : step.back[0], other = again ? step.back[0] : step.fwd[0];
    if (op.op === "cell.put") {                           // a cell's words: the caret where they changed
      const s = plainOf(op.text), t = plainOf(other.text), c = cellEl(op.block, op.row, op.col);
      let same = 0;
      while (same < s.length && same < t.length && s[s.length - 1 - same] === t[t.length - 1 - same]) same++;
      if (c) { c.focus(); setCaret(c, Math.max(0, Math.min(s.length - same, c.textContent.length))); }
      return;
    }
    const plain = (o) => (o.op === "page.set" ? o.title || "" : (blockOf(o.block.id) || {}).type === "code" ? o.block.text : plainOf(o.block.text || ""));
    const s = plain(op), t = plain(other);
    let same = 0;
    while (same < s.length && same < t.length && s[s.length - 1 - same] === t[t.length - 1 - same]) same++;
    if (op.op === "page.set") { title.focus(); return setCaret(title, Math.min(s.length - same, title.textContent.length)); }
    return focusBlock(op.block.id, Math.max(0, s.length - same));
  }
  const c = again ? step.caretAfter : step.caret;
  if (c && c.id === "@title") { title.focus(); return setCaret(title, Math.min(c.at ?? title.textContent.length, title.textContent.length)); }
  if (c && blockOf(c.id)) return focusBlock(c.id, c.at ?? "end");
  const near = step.ids.find((id) => blockOf(id));
  if (near) focusBlock(near, "end");
}
