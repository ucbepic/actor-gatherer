// Notes: a page's lines as a ProseMirror document, and back -- pure functions of the notebook's blocks and the
// document, nothing of the page drawn (Vitest tests them: frontend/src/features/apps/notes-doc.test.ts).
// - The schema: the doc a run of top-level blocks, each with the block's id; a line's words its inline content, as
//   notebook.py keeps them (the allowlisted HTML of helpers.js's clean(): b i u s code, links, line breaks, links to
//   pages); code its plain text. Only what is edited is in the doc (type, words, indent, ticked): a block's calls,
//   thread, work, picture and cells stay in the notebook, read by id.
// - nodeOf(block) and docOf(blocks): the notebook to the doc; fieldsOf(node) and htmlOf(content): the doc to the
//   notebook's fields and words.
// - opsOf(old doc, new doc): what a change to the doc is as the notebook's ops (block.put, block.move, block.delete).
// - syncTr(state, nodes): the doc made what the notebook says, in the fewest steps (each block changed where it
//   differs, the caret mapped through), for others' changes and the panel's own ops.
// - LinesSelection: whole lines picked, a run from an anchor line to a head line (picked.js).
import { DOMParser, Schema, Selection, SelectionRange, Slice, TextSelection } from "./vendor/prosemirror.js";

const TEXTS = ["text", "h1", "h2", "h3", "todo", "bullet", "number", "quote"];          // a line's words, marked up
const ATOMS = ["divider", "agents", "work", "table"];                                   // nothing typed in them
const CAPTIONED = ["image", "figma"];                                                   // a picture; the words its caption
const INDENTED = ["text", "todo", "bullet", "number", "quote"];
const PAGE_HREF = /^page:([a-z0-9]{6,24})$/;
const LINK_OK = /^(?:https?:|mailto:|ag:\/\/[a-z])/i;                                    // (clean()'s, but a page's)
const ATTRS = { id: { default: "" }, indent: { default: 0 }, checked: { default: false } };
// a block's type as its node's name: "text" is ProseMirror's own (words), "code" a mark too -- so a line of text is a
// "line", and code a "codeblock"
const NAMES = { text: "line", code: "codeblock" }, TYPES = { line: "text", codeblock: "code" };
export const nodeName = (type) => NAMES[type] || type;
export const typeOf = (node) => TYPES[node.type.name] || node.type.name;

// (each row is drawn by the panel's own node view, editor.js; toDOM is what the browser's clipboard is given of it)
const block = (type, tag, spec = {}) => [nodeName(type), { group: "block", attrs: ATTRS, content: "inline*", toDOM: () => [tag, 0], ...spec }];
export const schema = new Schema({
  nodes: Object.fromEntries([
    ["doc", { content: "block*" }],
    block("text", "p", { parseDOM: [{ tag: "p" }] }),              // first: what loose words pasted or dropped become
    ...["h1", "h2", "h3"].map((n) => block(n, n)),
    ...["todo", "bullet", "number"].map((n) => block(n, "li")),
    block("quote", "blockquote"),
    block("code", "pre", { content: "text*", marks: "", code: true }),
    ...ATOMS.map((n) => block(n, "div", { content: "", atom: true, selectable: false, toDOM: () => (n === "divider" ? ["hr"] : ["div"]) })),
    ...CAPTIONED.map((n) => block(n, "p")),
    ["text", { group: "inline" }],
    ["hard_break", { inline: true, group: "inline", selectable: false, leafText: () => "\n", parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"] }],
    ["pagelink", { inline: true, group: "inline", atom: true, selectable: false, attrs: { page: {}, title: { default: "" } },
      leafText: (n) => n.attrs.title,
      parseDOM: [{ tag: "a[href]", priority: 60, getAttrs: (a) => { const m = PAGE_HREF.exec(a.getAttribute("href") || "");
        return m ? { page: m[1], title: a.textContent } : false; } }],
      toDOM: (n) => ["a", { href: `page:${n.attrs.page}`, class: "pg" }, n.attrs.title] }],
  ]),
  marks: {                                                       // (a link outermost: one <a> round the words it marks)
    link: { attrs: { href: {} }, inclusive: false,
      parseDOM: [{ tag: "a[href]", getAttrs: (a) => (LINK_OK.test(a.getAttribute("href") || "") ? { href: a.getAttribute("href") } : false) }],
      toDOM: (m) => ["a", { href: m.attrs.href }, 0] },
    b: { parseDOM: [{ tag: "b" }, { tag: "strong" }], toDOM: () => ["b", 0] },
    i: { parseDOM: [{ tag: "i" }, { tag: "em" }], toDOM: () => ["i", 0] },
    u: { parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
    s: { parseDOM: [{ tag: "s" }, { tag: "strike" }, { tag: "del" }], toDOM: () => ["s", 0] },
    code: { parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
  },
});
// the HTML a mark is written as (htmlOf), in the order the schema ranks them
const TAG = { b: "b", i: "i", u: "u", s: "s", code: "code", link: "a" };

const parser = DOMParser.fromSchema(schema);
/** The node type of a block's type (one the doc doesn't know: a line of text). */
export const nodeTypeOf = (type) => ((TEXTS.includes(type) || ATOMS.includes(type) || CAPTIONED.includes(type) || type === "code")
  && schema.nodes[nodeName(type)]) || schema.nodes.line;
/** A block's node attributes: its id, and its indent and tick where its type has them. */
export const attrsOf = (b) => ({ id: b.id, indent: INDENTED.includes(b.type) ? Number(b.indent) || 0 : 0, checked: b.type === "todo" && !!b.checked });
/** A block of the notebook ({id, type, text, indent, checked}) as a node of the doc. */
export function nodeOf(b) {
  const type = nodeTypeOf(b.type), attrs = attrsOf(b);
  if (type.isAtom) return type.create(attrs);
  const text = String(b.text || "").replace(/\u200b/g, "");
  if (type.spec.code) return type.create(attrs, text ? schema.text(text) : null);
  const t = document.createElement("template");
  t.innerHTML = text;
  return parser.parse(t.content, { topNode: type.create(attrs), preserveWhitespace: "full" });
}
export const docOf = (blocks) => schema.node("doc", null, blocks.map(nodeOf));

const esc = (s) => s.replace(/[&<>\u00a0]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\u00a0": "&nbsp;" }[c]));
const escAttr = (s) => s.replace(/[&"\u00a0]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "\u00a0": "&nbsp;" }[c]));
const open = (m) => (m.type.name === "link" ? `<a href="${escAttr(m.attrs.href)}">` : `<${TAG[m.type.name]}>`);
/** A line's words (inline content) as the notebook keeps them: clean()'s HTML, as the browser writes it (a link to a
 * page with its title as `titleOf` says it is now, else as it was written; a line of line breaks alone, no words). */
export function htmlOf(content, titleOf = () => null) {
  let out = "";
  const on = [];                                         // the marks open, outermost first
  const shut = (k) => { while (on.length > k) out += `</${TAG[on.pop().type.name]}>`; };
  content.forEach((n) => {
    let k = 0;
    while (k < on.length && k < n.marks.length && on[k].eq(n.marks[k])) k++;
    shut(k);
    for (const m of n.marks.slice(k)) { out += open(m); on.push(m); }
    if (n.isText) out += esc(n.text);
    else if (n.type.name === "hard_break") out += "<br>";
    else if (n.type.name === "pagelink") out += `<a href="page:${n.attrs.page}">${esc(titleOf(n.attrs.page) ?? n.attrs.title)}</a>`;
  });
  shut(0);
  return /^(<br>)+$/.test(out) ? "" : out;
}
/** A node of the doc as the notebook's fields of its block. */
export function fieldsOf(node, titleOf) {
  const type = typeOf(node), { id, indent, checked } = node.attrs;
  const text = node.type.spec.code ? node.textContent : node.isAtom ? "" : htmlOf(node.content, titleOf);
  return { id, type, text, indent: INDENTED.includes(type) ? indent : 0, checked: type === "todo" && !!checked };
}

// -- the doc's top-level blocks, and the fewest of them moved to put them in another order
const tops = (doc) => { const out = []; doc.forEach((n, pos) => out.push({ id: n.attrs.id, node: n, pos })); return out; };
/** The longest run of `xs` (numbers) in increasing order: the indexes of its members, as a Set. */
export function kept(xs) {
  const tail = [], from = new Array(xs.length).fill(-1);  // tail[k]: the index ending the best run of k+1
  xs.forEach((x, i) => {
    let lo = 0, hi = tail.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[tail[mid]] < x) lo = mid + 1; else hi = mid; }
    if (lo) from[i] = tail[lo - 1];
    tail[lo] = i;
  });
  const out = new Set();
  for (let i = tail.length ? tail[tail.length - 1] : -1; i >= 0; i = from[i]) out.add(i);
  return out;
}

/** What changed between two docs of a page, as the notebook's ops: blocks gone, blocks new (after the block before
 * them, "" the page's start), blocks moved (the fewest: those off the longest run kept in order), and blocks changed
 * (their type, words, indent or tick; a new type, all of them, as a line turned into another is put). */
export function opsOf(was, now, page, titleOf) {
  const a = tops(was), z = tops(now), at = new Map(a.map((x, i) => [x.id, i])), here = new Set(z.map((x) => x.id));
  const ops = a.filter((x) => !here.has(x.id)).map((x) => ({ op: "block.delete", page, block: x.id }));
  const both = z.filter((x) => at.has(x.id)), stay = kept(both.map((x) => at.get(x.id)));
  const staying = new Set([...stay].map((i) => both[i].id));
  let after = "";
  for (const x of z) {
    if (!at.has(x.id)) ops.push({ op: "block.put", page, block: fieldsOf(x.node, titleOf), after });
    else {
      if (!staying.has(x.id)) ops.push({ op: "block.move", page, block: x.id, after });
      const old = a[at.get(x.id)].node;
      if (!old.eq(x.node)) {
        const f = fieldsOf(x.node, titleOf), g = fieldsOf(old, titleOf), put = { id: x.id };
        for (const k of ["type", "text", "indent", "checked"]) if (f.type !== g.type || f[k] !== g[k]) put[k] = f[k];
        if (Object.keys(put).length > 1) ops.push({ op: "block.put", page, block: put });
      }
    }
    after = x.id;
  }
  return ops;
}

/** The transaction that makes `state`'s doc the blocks `want` (nodes, in order): blocks gone or moved deleted (the
 * longest run in order kept), new and moved ones put in, and each kept one changed only where it differs -- so the
 * caret in a line maps through a change to its words before it or after it. */
export function syncTr(state, want) {
  const tr = state.tr, have = tops(state.doc), wanted = new Map(want.map((n, i) => [n.attrs.id, i]));
  const seen = new Set(), common = [];
  for (const h of have) if (wanted.has(h.id) && !seen.has(h.id)) { seen.add(h.id); common.push(h); }
  const stay = kept(common.map((h) => wanted.get(h.id))), staying = new Set([...stay].map((i) => common[i]));
  for (let i = have.length - 1; i >= 0; i--) if (!staying.has(have[i])) tr.delete(have[i].pos, have[i].pos + have[i].node.nodeSize);
  let pos = 0, k = 0;
  for (const w of want) {
    const cur = k < tr.doc.childCount ? tr.doc.child(k) : null;
    if (cur && cur.attrs.id === w.attrs.id) change(tr, pos, cur, w);
    else tr.insert(pos, w);
    pos += tr.doc.child(k).nodeSize;
    k++;
  }
  return tr;
}
function change(tr, pos, cur, w) {
  if (cur.eq(w)) return;
  if (cur.type !== w.type && (cur.isAtom || w.isAtom || !!cur.type.spec.code !== !!w.type.spec.code))
    return void tr.replaceWith(pos, pos + cur.nodeSize, w);
  if (cur.type !== w.type || JSON.stringify(cur.attrs) !== JSON.stringify(w.attrs)) tr.setNodeMarkup(pos, w.type, w.attrs);
  const start = cur.content.findDiffStart(w.content);
  if (start == null) return;
  let { a, b } = cur.content.findDiffEnd(w.content);
  const overlap = start - Math.min(a, b);
  if (overlap > 0) { a += overlap; b += overlap; }
  tr.replace(pos + 1 + start, pos + 1 + a, new Slice(w.content.cut(start, b), 0, 0));
}

// -- where the caret is, by line and place in it, so it is put back there after the doc is drawn again
/** The top-level block a position is in (or just before): {node, pos, index}; null past the last. */
export function blockAt(doc, at) {
  const c = doc.childAfter(Math.max(0, at));
  return c.node ? { node: c.node, pos: c.offset, index: c.index } : null;
}
export function posOf(doc, id) {
  let found = null;
  doc.forEach((n, pos, index) => { if (found === null && n.attrs.id === id) found = { node: n, pos, index }; });
  return found;
}
/** A selection said by its lines' ids and its places in them, to be found again in another doc. */
export function selectionAt(sel) {
  if (sel instanceof LinesSelection) return { lines: true, anchor: sel.anchorId, head: sel.headId };
  const doc = sel.$anchor.doc, a = blockAt(doc, sel.anchor), h = blockAt(doc, sel.head);
  if (!a || !h) return null;
  return { anchor: a.node.attrs.id, at: sel.anchor - a.pos - 1, head: h.node.attrs.id, to: sel.head - h.pos - 1 };
}
/** ... and found again in `doc`: null if its lines are gone. */
export function selectionIn(doc, s) {
  const a = s && posOf(doc, s.anchor), h = s && posOf(doc, s.head);
  if (!a || !h) return null;
  if (s.lines) return LinesSelection.create(doc, s.anchor, s.head);
  if (!a.node.inlineContent || !h.node.inlineContent) return null;
  const place = (b, n) => b.pos + 1 + Math.max(0, Math.min(n, b.node.content.size));
  return TextSelection.create(doc, place(a, s.at), place(h, s.to));
}

/** A place in a line's words as plain text (each character of its words; a line break one; a link to a page, its title)
 * as a place in its node: in or just after a link to a page, after it. */
export function offsetOfPlain(node, n) {
  let off = 0, left = Math.max(0, n);
  for (let i = 0; i < node.childCount && left > 0; i++) {
    const c = node.child(i), len = c.isText ? c.text.length : c.type.name === "pagelink" ? c.attrs.title.length : 1;
    if (c.isText && left < len) return off + left;
    off += c.nodeSize;
    left -= len;
  }
  return off;
}

// -- whole lines picked, a run of the doc's top-level blocks from the anchor's to the head's (as prosemirror-tables'
// CellSelection is cells): its anchor and head the places before those blocks. Never shown as the browser's selection
// (the view isn't editable while it is the selection, and no text is selected: picked.js).
export class LinesSelection extends Selection {
  constructor($anchor, $head) {
    const doc = $anchor.doc, a = $anchor.pos, h = $head.pos;
    const last = doc.nodeAt(Math.max(a, h));
    super($anchor, $head, [new SelectionRange(doc.resolve(Math.min(a, h)), doc.resolve(Math.max(a, h) + (last ? last.nodeSize : 0)))]);
  }
  get anchorId() { const n = this.$anchor.doc.nodeAt(this.anchor); return n ? n.attrs.id : null; }
  get headId() { const n = this.$head.doc.nodeAt(this.head); return n ? n.attrs.id : null; }
  /** The ids of the lines picked, in order. */
  get ids() {
    const out = [];
    this.$anchor.doc.nodesBetween(this.from, this.to, (n) => { out.push(n.attrs.id); return false; });
    return out;
  }
  map(doc, mapping) {
    const fix = (p) => { const b = blockAt(doc, Math.min(p, doc.content.size)) || blockAt(doc, doc.content.size - 1); return b ? b.pos : null; };
    const a = fix(mapping.map(this.anchor, 1)), h = fix(mapping.map(this.head, 1));
    return a === null || h === null ? Selection.atStart(doc) : new LinesSelection(doc.resolve(a), doc.resolve(h));
  }
  eq(other) { return other instanceof LinesSelection && other.anchor === this.anchor && other.head === this.head; }
  content() { return this.$anchor.doc.slice(this.from, this.to, true); }
  toJSON() { return { type: "lines", anchor: this.anchor, head: this.head }; }
  static fromJSON(doc, json) { return new LinesSelection(doc.resolve(json.anchor), doc.resolve(json.head)); }
  /** The lines from `anchor` to `head` (ids) of `doc`; null if either is not in it. */
  static create(doc, anchor, head) {
    const a = posOf(doc, anchor), h = posOf(doc, head);
    return a && h ? new LinesSelection(doc.resolve(a.pos), doc.resolve(h.pos)) : null;
  }
}
LinesSelection.prototype.visible = false;
Selection.jsonID("lines", LinesSelection);
