// Notes: the caret. In a line it is the editor's (editor.js: caretTo puts it, here() says where it is); in the title
// and in a table's cell -- each an editable element of its own -- where it is (in characters), put there, and whether
// it is at the element's edge or on its first or last row.
import { MEDIA, UNSENT } from "./helpers.js";
import { blockOf, rowOf } from "./page.js";
import { focusCell } from "./tables.js";
import { caretTo, lineNode } from "./editor.js";

export function caretIn(tx) {
  const s = getSelection();
  if (!s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!tx.contains(r.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(tx);
  pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  pre.setEnd(r.endContainer, r.endOffset);
  return { start, end: pre.toString().length, collapsed: r.collapsed };
}
export function pointAt(tx, n) {
  const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT);
  let node, last = null;
  while ((node = w.nextNode())) { if (n <= node.length) return besideLink(tx, node, n); n -= node.length; last = node; }
  return last ? besideLink(tx, last, last.length) : { node: tx, offset: tx.childNodes.length };
}
function besideLink(tx, node, n) {                     // a point in a link to a page: before it (at its start), else after it
  const a = node.parentElement && node.parentElement.closest("a.pg");
  if (!a || !tx.contains(a)) return { node, offset: n };
  const i = [...a.parentNode.childNodes].indexOf(a);
  return { node: a.parentNode, offset: n ? i + 1 : i };
}
export function setCaret(tx, start, end = start) {
  const a = pointAt(tx, start), z = pointAt(tx, end), r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(z.node, z.offset);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
export function edge(tx, atEnd) {                       // nothing (no text, no line break) between the caret and an end
  const s = getSelection();
  if (!s.rangeCount || !s.isCollapsed) return false;
  const r = s.getRangeAt(0), part = document.createRange();
  part.selectNodeContents(tx);
  if (atEnd) part.setStart(r.endContainer, r.endOffset); else part.setEnd(r.startContainer, r.startOffset);
  const f = part.cloneContents();
  return f.textContent.replace(/\u200b/g, "") === "" && !f.querySelector("br");
}
export function onLine(tx, last) {                      // the caret on the first (or last) line of the block
  const s = getSelection();
  if (!s.rangeCount) return true;
  const rects = s.getRangeAt(0).getClientRects();
  const r = rects[last ? rects.length - 1 : 0];
  if (!r) return true;
  const t = tx.getBoundingClientRect(), lh = parseFloat(getComputedStyle(tx).lineHeight) || 22;
  return last ? t.bottom - r.bottom < lh * 0.9 : r.top - t.top < lh * 0.9;
}
// The caret put in a block: a line's words at their start, end, or a place in them as plain text (a number); a table's
// first or last cell; a divider, the Agents or Work table, focused itself.
export function focusBlock(id, where = "end") {
  const n = rowOf(id), t = n && blockOf(id);
  if (!n) return;
  if (t && t.type === "table") return focusCell(t, where === "start" ? 0 : t.rows.length - 1, 0, where === "start" ? "start" : "end");
  if (caretTo(id, where)) return;
  const f = n.querySelector(".hr, .agt, .fig");
  if (f) f.focus();
}
export const empty = (tx) => tx.textContent.replace(/\u200b/g, "") === "" && !tx.querySelector("br, a");   // (a cell)
export const blank = (id) => { const node = lineNode(id); return !!node && node.content.size === 0; };       // (a line)
export const editable = (b) => !UNSENT.includes(b.type) || MEDIA.includes(b.type);   // (a picture's caption: typed in)
