// Notes: the page's lines, edited in one ProseMirror view -- #blocks its root, each line a row drawn as it always was
// (page.js's makeRow: its gutter, marker, words, buttons, what it was sent), its words the row's content.
// The notebook is what the page says: the doc is drawn from it (drawDoc: the fewest steps, the caret mapped through,
// a line with words not yet sent left as the reader has it), and each change the reader makes in the doc is the
// notebook's ops (doc.js's opsOf): a line's words typed queued after a pause (send.js's typed), anything else one
// change() -- one step of undo.js's. Keys, typed characters and pastes go to the panel's own handlers first (typing.js,
// paste.js); the browser's own undo never reaches the doc (title.js). Lines picked are a LinesSelection, and while they
// are -- or a table's cells are -- the view isn't editable: no caret, the page's keys (picked.js).
import { EditorState, EditorView, Plugin, PluginKey, TextSelection } from "./vendor/prosemirror.js";
import { attrsOf, blockAt, fieldsOf, LinesSelection, nodeOf, nodeTypeOf, offsetOfPlain, opsOf, posOf, schema, selectionAt,
  selectionIn, syncTr, typeOf } from "./doc.js";
import { rid } from "./helpers.js";
import { current, pages } from "./state.js";
import { change, dirty, sendTyped, typed } from "./send.js";
import { blockOf, box, drawRows, makeRow, rowNode } from "./page.js";
import { lineKey, textIn } from "./typing.js";
import { linePaste } from "./paste.js";
import { crossPick, drawPicked, picked } from "./picked.js";
import { cellsPicked, unpickCells } from "./tables.js";
import { drawLink } from "./model.js";
import { closePop, menu } from "./popups.js";
import { followMenu } from "./slash.js";

export let view = null;
const KEY = new PluginKey("notes");                     // a transaction's meta: what it is (below)
let docPage = null, readOnly = false;                   // the page the doc is, and whether it is in the trash
let undoCaret = null;                                   // where the caret was before a change the doc made (undo.js)
export const caretBefore = () => undoCaret;
export const titleOf = (id) => { const p = pages.get(id); return p ? p.title || "Untitled" : null; };

// -- the doc's ids: a block with none, or another's (a line split by the browser), given one of its own
const ids = new Plugin({
  appendTransaction(trs, _was, state) {
    if (!trs.some((t) => t.docChanged)) return null;
    const seen = new Set();
    let tr = null;
    state.doc.forEach((n, pos) => {
      if (n.attrs.id && !seen.has(n.attrs.id)) return void seen.add(n.attrs.id);
      (tr = tr || state.tr).setNodeMarkup(pos, null, { ...n.attrs, id: rid() });
    });
    return tr;
  },
  // lines picked are put down by the panel, never by the browser's selection moving under them (a drag goes on)
  filterTransaction: (tr, state) => !(state.selection instanceof LinesSelection && tr.selectionSet && !tr.docChanged && !tr.getMeta(KEY)),
});

// -- each block a row: made as page.js makes one, its words (if it has any) its content; what is not its words
// (gutter, marker, buttons, a picture, a table, what it was sent) the panel's, unseen by the editor
class Row {
  constructor(node) {
    this.node = node;
    this.dom = makeRow(typeOf(node), node.attrs.id);
    this.contentDOM = this.dom.querySelector(":scope > .tx") || null;
    rowNode(this.dom, node, true);
  }
  update(node) {
    const shape = (n) => (n.isAtom || n.type.spec.code ? typeOf(n) : n.type.name === "image" || n.type.name === "figma" ? "media" : "tx");
    if (shape(node) !== shape(this.node) || (node.isAtom && node.type !== this.node.type)) return false;
    this.node = node;
    rowNode(this.dom, node, false);
    return true;
  }
  ignoreMutation(m) {
    const c = this.contentDOM;
    if (!c) return true;
    if (m.type === "selection") return m.target !== this.dom && !c.contains(m.target);
    return m.target === c ? m.type === "attributes" : !c.contains(m.target);
  }
  stopEvent(ev) {
    const t = ev.target;
    return !!t && t !== this.dom && !(this.contentDOM && this.contentDOM.contains(t));
  }
}
// a link to a page: drawn as the page is now (model.js), kept whole, a click its own
function pageLink(node) {
  const a = document.createElement("a");
  a.setAttribute("href", `page:${node.attrs.page}`);
  a.textContent = node.attrs.title;
  a.dataset.was = node.attrs.title;
  drawLink(a);
  return { dom: a, ignoreMutation: () => true, stopEvent: (ev) => ev.type.startsWith("mouse") || ev.type === "click",
    update: (n) => n.attrs.page === node.attrs.page };
}

export function startView() {
  const rows = Object.fromEntries(Object.keys(schema.nodes).filter((n) => schema.nodes[n].isBlock && n !== "doc").map((n) => [n, (node) => new Row(node)]));
  view = new EditorView({ mount: box }, {
    state: EditorState.create({ schema, plugins: [ids] }),
    nodeViews: { ...rows, pagelink: pageLink },
    editable: (state) => !readOnly && !(state.selection instanceof LinesSelection) && !cellsPicked(),
    handleKeyDown: (_v, ev) => lineKey(ev),
    handleTextInput: (_v, from, to, text, deflt) => textIn(from, to, text, deflt),
    handleDOMEvents: {
      paste: (_v, ev) => linePaste(ev),
      // lines picked: copied and cut as lines (picked.js), not as the browser's selection
      copy: () => picked.size > 0,
      cut: () => picked.size > 0,
      drop: (_v, ev) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes("Files"),   // pictures: pictures.js's
      focus: () => { setTimeout(markCaret); return false; },
      blur: (_v, ev) => {
        setTimeout(markCaret);
        const h = here();
        if (h && dirty.has(h.id)) sendTyped(h.id);         // (leaving the line: its words sent)
        if (menu && menu.line && !(ev.relatedTarget && menu.el.contains(ev.relatedTarget))) closePop();
        return false;
      },
    },
    dispatchTransaction: dispatch,
  });
}
// the view told its props anew: whether it is editable (cells picked, or put down)
export const refreshView = () => { if (view) view.setProps({}); };

function dispatch(tr) {
  const was = view.state, { state, transactions } = was.applyTransaction(tr);
  view.updateState(state);
  const how = tr.getMeta(KEY);
  if (how !== "book" && state.doc !== was.doc && docPage && docPage === current) toOps(was, state, how);
  if (menu && menu.line) { for (const t of transactions) menu.from = t.mapping.map(menu.from, 1); followMenu(); }
  const a = was.selection, z = state.selection;
  if (a instanceof LinesSelection || z instanceof LinesSelection) { if (!a.eq(z)) drawPicked(); }
  else crossPick();
  const left = a instanceof TextSelection && blockAt(was.doc, a.head), now = blockAt(state.doc, z.head);
  if (left && (!now || now.node.attrs.id !== left.node.attrs.id) && dirty.has(left.node.attrs.id)) sendTyped(left.node.attrs.id);
  markCaret();
}
// A change the reader made in the doc, as ops: a line's words alone, typed (a run of typing, sent after a pause);
// anything else one change, its caret before it kept for undo.
function toOps(was, state, how) {
  const ops = opsOf(was.doc, state.doc, docPage, titleOf);
  if (!ops.length) return;
  const words = ops.length === 1 && ops[0].op === "block.put" && Object.keys(ops[0].block).join() === "id,text";
  if (words && how !== "change") {
    const b = blockOf(ops[0].block.id);
    if (!b) return;
    b.text = ops[0].block.text;
    return typed(docPage, b.id, b.text);
  }
  undoCaret = caretAt(was);
  try { change(ops); } finally { undoCaret = null; }
  drawRows();
}
/** A transaction of the panel's: "typed" (words, as typing is: the default), "change" (one step of undo), "select"
 * (the selection alone, lines picked or put down), "book" (the notebook drawn: no ops of its own). */
export function edit(tr, how = "typed") { view.dispatch(tr.setMeta(KEY, how)); }

// -- the doc drawn from the notebook: `blocks`, the page's lines shown (none folded away)
const made = new Map();                                 // block id -> {key, node}: nodes made from the notebook, kept
function wanted(b, have, composing) {
  const d = dirty.get(b.id), n = have && have.get(b.id);
  // typed and not sent, or being composed (an input method's words not yet in the doc): as the reader has it
  if (((d && !d.cell) || composing === b.id) && n && n.type === nodeTypeOf(b.type)) return n.type.create(attrsOf(b), n.content);
  const key = `${b.type}\0${b.indent || 0}\0${!!b.checked}\0${b.text || ""}`, got = made.get(b.id);
  if (got && got.key === key) return got.node;
  const node = nodeOf(b);
  made.set(b.id, { key, node });
  return node;
}
export function drawDoc(pid, blocks, ro) {
  if (!view) return;
  const fresh = pid !== docPage;
  docPage = pid;
  readOnly = ro;
  const have = new Map();
  view.state.doc.forEach((n) => have.set(n.attrs.id, n));
  const composing = view.composing && here() ? here().id : null;
  const want = blocks.map((b) => wanted(b, fresh ? null : have, composing));
  if (fresh) {
    if (menu && menu.line) closePop();
    made.clear();
    view.updateState(EditorState.create({ doc: schema.node("doc", null, want), plugins: view.state.plugins }));
    return markCaret();
  }
  const kept = selectionAt(view.state.selection), tr = syncTr(view.state, want);
  const mapped = selectionAt(tr.selection);
  if (kept && (!mapped || mapped.anchor !== kept.anchor || mapped.head !== kept.head || !!mapped.lines !== !!kept.lines)) {
    const back = selectionIn(tr.doc, kept);
    if (back) tr.setSelection(back);
  }
  edit(tr, "book");
}

// -- where the caret is
/** The line the selection is in (its words: a TextSelection in one block): its id, node, place, and where in it. */
export function here(state = view && view.state) {
  const sel = state && state.selection;
  if (!(sel instanceof TextSelection) || sel.$from.depth !== 1) return null;
  const { $from, $to } = sel, node = $from.parent, same = $from.sameParent($to), size = node.content.size;
  return { id: node.attrs.id, node, pos: $from.before(1), from: $from.parentOffset, to: same ? $to.parentOffset : size, same,
    empty: sel.empty, start: sel.empty && $from.parentOffset === 0, end: sel.empty && $from.parentOffset === size };
}
/** The browser's caret, read into the editor if it moved it and the editor hasn't read it yet (a key pressed right
 * after another the browser moved it with: End, then Enter). */
export function readCaret() {
  const s = getSelection(), sel = view && view.state.selection;
  if (!(sel instanceof TextSelection) || !view.hasFocus() || !s.rangeCount || !box.contains(s.anchorNode) || !box.contains(s.focusNode)) return;
  let a, h;
  try { a = view.posAtDOM(s.anchorNode, s.anchorOffset); h = view.posAtDOM(s.focusNode, s.focusOffset); } catch { return; }
  if (sel.anchor === a && sel.head === h) return;
  const doc = view.state.doc, $a = doc.resolve(a), $h = doc.resolve(h);
  if ($a.parent.inlineContent && $h.parent.inlineContent) edit(view.state.tr.setSelection(TextSelection.between($a, $h)), "select");
}
/** Where the caret is, as undo keeps it: the line, and the place in its words as plain text. */
export function caretAt(state = view && view.state) {
  const h = view && view.hasFocus() ? here(state) : null;
  return h ? { id: h.id, at: h.node.textBetween(0, state.selection.$head.parentOffset, "").length } : null;
}
/** The caret put in a line: at its start, its end, a place in its words as plain text (a number), or {at} a place in
 * its node; the view focused, the line scrolled to. False: no such line in the doc, or none with words. */
export function caretTo(id, where = "end") {
  const at = view && posOf(view.state.doc, id);
  if (!at || !at.node.inlineContent) return false;
  if (cellsPicked()) unpickCells();
  const size = at.node.content.size;
  const off = where === "end" ? size : where === "start" ? 0 : typeof where === "object" ? Math.min(where.at, size) : offsetOfPlain(at.node, where);
  edit(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos + 1 + off)).scrollIntoView(), "select");
  view.focus();
  return true;
}
/** The words of a part of a line (from, to: places in its node), as the notebook keeps them. */
export function wordsOf(node, from = 0, to = node.content.size) {
  return node.type.spec.code ? node.textContent.slice(from, to) : fieldsOf(node.type.create(node.attrs, node.content.cut(from, to)), titleOf).text;
}
export const lineNode = (id) => { const at = view && posOf(view.state.doc, id); return at ? at.node : null; };
/** The screen box of a place in the doc (a pop-up put under it). */
export function boxAt(pos) {
  try { const c = view.coordsAtPos(pos); return { left: c.left, right: c.right, top: c.top, bottom: c.bottom, width: 0, height: c.bottom - c.top }; }
  catch { return box.getBoundingClientRect(); }
}
// the row the caret is in, marked while the view has the keys (its placeholder shown, a caption kept open)
let marked = null;
function markCaret() {
  const h = view && view.hasFocus() ? here() : null, at = h && view.nodeDOM(h.pos);
  const n = at && at.classList && at.classList.contains("blk") ? at : null;
  if (marked && marked !== n) marked.classList.remove("caret");
  if (n) n.classList.add("caret");
  marked = n;
}
