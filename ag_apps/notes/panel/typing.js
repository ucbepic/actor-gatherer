// Notes: typing in a line -- the editor's keys (lineKey) and characters typed (textIn), before ProseMirror's own: markdown
// at a line's start, Enter, Backspace, Delete, Tab, the arrows and the ⌘ keys; a line turned into another type; inline
// marks. The words themselves are the editor's (editor.js keeps them as they change). Keys in a table's cell are
// tables.js's, and on a divider, a picture or the Agents or Work table (each focused itself), dividerKey's.
import { $, clean, el, esc, INDENTED, LISTS, MAX_INDENT, MEDIA, now, plainOf, rid } from "./helpers.js";
import { current } from "./state.js";
import { TextSelection, toggleMark } from "./vendor/prosemirror.js";
import { LinesSelection, schema } from "./doc.js";
import { change, dirty, forget, sendTyped } from "./send.js";
import { undoStep } from "./undo.js";
import { blockOf, box, drawPage, shown } from "./page.js";
import { focusBlock, setCaret } from "./caret.js";
import { closePop, menu, popUp } from "./popups.js";
import { slashKey, slashTyped } from "./slash.js";
import { pageKey, pageTyped } from "./pagelinks.js";
import { holdKeys, pickAll, pickRange } from "./picked.js";
import { canType, cellInput, cellKey, cellKeys, cellOf, retyped } from "./tables.js";
import { captionKey, figmaKey, focusFig } from "./pictures.js";
import { isWork } from "./actors.js";
import { atKey, atTyped } from "./picker.js";
import { boxAt, edit, here, readCaret, view, wordsOf } from "./editor.js";

// Markdown at the start of a block, as it is typed: "# " a heading, "- " a list, "[] " a to-do, "> " a quote, "```" code,
// "---" a divider.
const SHORT = [[/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^[-*+]\s$/, "bullet"], [/^1[.)]\s$/, "number"],
  [/^\[\s?\]\s$/, "todo"], [/^\[x\]\s$/i, "todo", true], [/^>\s$/, "quote"]];
function shortcut(b, at, text) {                         // (`text` typed at `at`, not yet in the line)
  if (!["text", "bullet"].includes(b.type) || at.from !== at.to) return false;
  const { node } = at, before = node.textBetween(0, at.from, "") + text, whole = before + node.textBetween(at.to, node.content.size, "");
  let to = null, checked = false;
  if (text === " ") { const hit = SHORT.find(([rx]) => rx.test(before)); if (hit) { to = hit[1]; checked = !!hit[2]; } }
  else if (text === "`" && before === "```") to = "code";
  else if (text === "-" && whole === "---") to = "divider";
  if (!to || (b.type === "bullet" && to !== "todo")) return false;
  if (to === "divider") {
    forget(b.id);
    const next = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    change([{ op: "block.put", page: current, block: { id: b.id, type: "divider", text: "", indent: 0 } },
      { op: "block.put", page: current, block: next, after: b.id }]);
    drawPage();
    focusBlock(next.id, 0);
    return true;
  }
  // what follows the markdown stays: plain, into code
  retype(b, to, { checked, text: to === "code" ? node.textBetween(at.to, node.content.size, "") : wordsOf(node, at.to) });
  focusBlock(b.id, 0);
  return true;
}
// Characters typed in a line (ProseMirror's handleTextInput: never while composing): markdown at its start, else typed
// as ProseMirror types them, then the / menu, @ and [[ opened or followed. Over lines picked, nothing.
export function textIn(from, to, text, deflt) {
  const st = view.state;                                // (over lines picked, or outside a line's words: nothing)
  if (st.selection instanceof LinesSelection) return true;
  const $from = st.doc.resolve(from), $to = st.doc.resolve(to);
  if ($from.depth !== 1 || !$from.sameParent($to)) return true;
  const node = $from.parent, b = blockOf(node.attrs.id);
  if (!b) return false;
  if (shortcut(b, { node, from: $from.parentOffset, to: $to.parentOffset }, text)) return true;
  view.dispatch(deflt());
  if (!MEDIA.includes(b.type)) { slashTyped(b, text); atTyped(b, text); }   // (a caption: words and links to pages, no / or @)
  pageTyped(b, text);
  return true;
}
/** Words typed into the line the caret is in, as typing them does (the gutter's + types "/"). */
export function typeIn(text) {
  const { from, to } = view.state.selection;
  textIn(from, to, text, () => view.state.tr.insertText(text, from, to));
}

// A block made another type: its text kept (plain, into code; out of code, as text), its indent where it may have one.
export function retypeOp(b, type, extra = {}) {
  const was = b.type;
  let text = "text" in extra ? extra.text : b.text;
  if (!("text" in extra)) {
    if (type === "code" && was !== "code") text = plainOf(b.text);
    else if (was === "code" && type !== "code") text = esc(b.text).replace(/\n/g, "<br>");
  }
  forget(b.id);
  const put = { id: b.id, type, text, indent: INDENTED.includes(type) ? b.indent || 0 : 0, checked: type === "todo" ? !!(extra.checked ?? b.checked) : false };
  return { op: "block.put", page: current, block: put };
}
export function retype(b, type, extra = {}) {             // (the caret stays in it: editor.js finds it by its line)
  change([retypeOp(b, type, extra)]);
  drawPage();
}

// a divider, a picture or the Agents or Work table, focused (not typed in): Esc picks it, ⌫ deletes it, ↑↓ go on
function dividerKey(ev, n) {
  const p = shown(), i = p.blocks.findIndex((b) => b.id === n.dataset.id);
  if (ev.key === "Escape") { ev.preventDefault(); pickRange(n.dataset.id, n.dataset.id); return holdKeys(); }
  if (p.deleted) return;
  if (ev.key === "Backspace" || ev.key === "Delete") {
    ev.preventDefault();
    const near = p.blocks[i - 1] || p.blocks[i + 1];
    change([{ op: "block.delete", page: p.id, block: n.dataset.id }]);
    drawPage();
    if (near) focusBlock(near.id, "end");
  } else if (ev.key === "ArrowDown" && MEDIA.includes(p.blocks[i].type)) {   // a picture: down to its caption
    ev.preventDefault();
    focusBlock(p.blocks[i].id, "start");
  } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
    const to = ev.key === "ArrowUp" ? p.blocks[i - 1] : p.blocks[i + 1];
    if (to) { ev.preventDefault(); focusBlock(to.id, ev.key === "ArrowUp" ? "end" : "start"); }
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    addAfter(p.blocks[i], "text");
  }
}
// Enter: an empty list item leaves the list (or comes out a level); at the start of a block, an empty one goes above
// it; else the block is split at the caret (what is selected taken out), its rest a new block below -- a list's next
// item, or text.
function enter(p, i, h) {
  const b = p.blocks[i], blank = h.node.content.size === 0;
  if ([...LISTS, "quote"].includes(b.type) && blank) {
    if (b.indent > 0 && b.type !== "quote") return indent(b, -1);
    return retype(b, "text");
  }
  const kind = LISTS.includes(b.type) ? b.type : "text";
  const ind = INDENTED.includes(b.type) ? b.indent || 0 : 0;
  if (h.start && !blank) {
    const above = { id: rid(), type: kind, text: "", checked: false, indent: ind };
    change([{ op: "block.put", page: p.id, block: above, after: i ? p.blocks[i - 1].id : "" }]);
    drawPage();
    return;
  }
  const left = wordsOf(h.node, 0, h.from), rest = wordsOf(h.node, h.to);
  const next = { id: rid(), type: kind, text: rest, checked: false, indent: ind };
  forget(b.id);
  change([{ op: "block.put", page: p.id, block: { id: b.id, text: left } }, { op: "block.put", page: p.id, block: next, after: b.id }]);
  drawPage();
  focusBlock(next.id, "start");
}
// Backspace at a block's start: a heading, list item or the like made text; text set in, out a level; else joined to
// the block above (a divider above, removed; a picture above, focused; a table or the Agents or Work table, left).
function backspace(p, i, h) {
  const b = p.blocks[i];
  if (b.type !== "text") return retype(b, "text");
  if (b.indent > 0) return indent(b, -1);
  if (!i) return;
  const prev = p.blocks[i - 1];
  if (MEDIA.includes(prev.type)) {                       // a picture above: never joined; an empty line goes
    if (!h.node.content.size) { forget(b.id); change([{ op: "block.delete", page: p.id, block: b.id }]); drawPage(); }
    return focusFig(prev.id);
  }
  if (prev.type === "divider") {
    change([{ op: "block.delete", page: p.id, block: prev.id }]);
    drawPage();
    return focusBlock(b.id, "start");
  }
  if (!canType(prev) || prev.type === "table") return;
  const at = prev.type === "code" ? prev.text.length : plainOf(prev.text).length;
  const joined = prev.type === "code" ? prev.text + plainOf(b.text) : clean(prev.text + clean(b.text));
  forget(b.id);
  forget(prev.id);
  change([{ op: "block.put", page: p.id, block: { id: prev.id, text: joined } }, { op: "block.delete", page: p.id, block: b.id }]);
  drawPage();
  focusBlock(prev.id, at);
}
function joinNext(p, i) {
  const b = p.blocks[i], next = p.blocks[i + 1];
  if (MEDIA.includes(next.type)) return focusFig(next.id);
  if (next.type === "divider") { change([{ op: "block.delete", page: p.id, block: next.id }]); drawPage(); return; }
  if (!canType(next) || next.type === "table") return;
  const at = b.type === "code" ? b.text.length : plainOf(b.text).length;
  const joined = b.type === "code" ? b.text + plainOf(next.text) : clean(clean(b.text) + (next.type === "code" ? esc(next.text) : next.text));
  forget(b.id);
  forget(next.id);
  change([{ op: "block.put", page: p.id, block: { id: b.id, text: joined } }, { op: "block.delete", page: p.id, block: next.id }]);
  drawPage();
  focusBlock(b.id, at);
}
function indent(b, by) {                                // (the caret stays where it is: the line is changed in place)
  const to = Math.max(0, Math.min(MAX_INDENT, (b.indent || 0) + by));
  if (to === (b.indent || 0)) return;
  change([{ op: "block.put", page: current, block: { id: b.id, indent: to } }]);
  drawPage();
}
export function tick(b) {                               // (a to-do work item: done as it is ticked, open again as it is not)
  change([{ op: "block.put", page: current, block: { id: b.id, checked: !b.checked, ...(isWork(b) ? { ended: b.checked ? "" : "done", ended_at: now() } : {}) } }]);
  drawPage();
}
export function addAfter(b, type) {
  const next = { id: rid(), type, text: "", checked: false, indent: LISTS.includes(type) && INDENTED.includes(b.type) ? b.indent || 0 : 0 };
  change([{ op: "block.put", page: current, block: next, after: b.id }]);
  drawPage();
  focusBlock(next.id, 0);
  return next;
}
function shift(p, i, by) {                              // (the caret goes with it: editor.js finds it by its line)
  const j = i + by;
  if (j < 0 || j >= p.blocks.length) return;
  const b = p.blocks[i], rest = p.blocks.filter((x) => x.id !== b.id);
  const after = by < 0 ? (j ? rest[j - 1].id : "") : rest[i].id;
  change([{ op: "block.move", page: p.id, block: b.id, after }]);
  drawPage();
}

// -- inline marks in a line: bold, italic, underline, struck, code (each toggled), and links
const markLine = (name) => toggleMark(schema.marks[name])(view.state, (tr) => edit(tr));
// the link around a place in a line: its href and its extent, or null
function linkAt(state, pos) {
  const $p = state.doc.resolve(pos), L = schema.marks.link;
  const m = ($p.nodeAfter && L.isInSet($p.nodeAfter.marks)) || ($p.nodeBefore && L.isInSet($p.nodeBefore.marks));
  if (!m) return null;
  const runs = [];
  let from = null;
  $p.parent.forEach((c, off) => {
    const a = $p.start() + off;
    if (m.isInSet(c.marks)) { if (from === null) from = a; runs.push([from, a + c.nodeSize]); }
    else from = null;
  });
  const r = runs.filter(([a, z]) => pos >= a && pos <= z).pop();
  return r ? { href: m.attrs.href, from: r[0], to: r[1] } : null;
}
function linkLine() {
  const st = view.state, { from, to, empty } = st.selection, near = linkAt(st, from), L = schema.marks.link;
  popUp(boxAt(from), (pop) => {
    const input = el("input", { type: "url", placeholder: "Paste a link", value: near ? near.href : "" });
    const done = (url) => {
      closePop();
      view.focus();
      const size = view.state.doc.content.size, a = Math.min(from, size), z = Math.min(to, size), tr = view.state.tr;
      if (!url) tr.removeMark(near ? near.from : a, near ? near.to : z, L);
      else {
        const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
        if (empty && !near) tr.insertText(url, a).addMark(a, a + url.length, L.create({ href }));
        else if (empty) tr.removeMark(near.from, near.to, L).addMark(near.from, near.to, L.create({ href }));
        else tr.addMark(a, z, L.create({ href }));
      }
      edit(tr);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(input.value.trim()); }
      else if (e.key === "Escape") { e.preventDefault(); closePop(); view.focus(); }
    });
    pop.append(el("div", { class: "row" }, input, el("button", { type: "button", text: near ? "Remove" : "Link",
      onclick: () => done(near ? "" : input.value.trim()) })));
    setTimeout(() => input.focus(), 0);
  });
}
// ... and in a table's cell (an editable element of its own): the browser's, and code and links here
export function format(ev, n, command) {
  ev.preventDefault();
  document.execCommand(command, false);
}
export function codeMark(n, tx) {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0);
  const start = r.commonAncestorContainer;
  const inCode = (start.nodeType === 3 ? start.parentElement : start).closest("code");
  if (inCode && tx.contains(inCode)) inCode.replaceWith(...inCode.childNodes);
  else {
    const code = document.createElement("code");
    code.append(r.extractContents());
    for (const c of code.querySelectorAll("code")) c.replaceWith(...c.childNodes);
    r.insertNode(code);
    const pick = document.createRange();
    pick.selectNodeContents(code);
    s.removeAllRanges();
    s.addRange(pick);
  }
  retyped(n, tx, blockOf(n.dataset.id));
}
export function linkBox(n, tx) {
  const s = getSelection();
  if (!s.rangeCount) return;
  const kept = s.getRangeAt(0).cloneRange();
  const a0 = (kept.startContainer.nodeType === 3 ? kept.startContainer.parentElement : kept.startContainer).closest("a");
  const rect = kept.getBoundingClientRect().width ? kept.getBoundingClientRect() : tx.getBoundingClientRect();
  popUp(rect, (pop) => {
    const input = el("input", { type: "url", placeholder: "Paste a link", value: a0 ? a0.getAttribute("href") : "" });
    const done = (url) => {
      closePop();
      tx.focus();
      s.removeAllRanges();
      s.addRange(kept);
      if (!url) document.execCommand("unlink", false);
      else {
        const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
        if (kept.collapsed && !a0) document.execCommand("insertHTML", false, `<a href="${esc(href).replace(/"/g, "&quot;")}">${esc(url)}</a>`);
        else document.execCommand("createLink", false, href);
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(input.value.trim()); }
      else if (e.key === "Escape") { e.preventDefault(); closePop(); tx.focus(); s.removeAllRanges(); s.addRange(kept); }
    });
    pop.append(el("div", { class: "row" }, input, el("button", { type: "button", text: a0 ? "Remove" : "Link",
      onclick: () => done(a0 ? "" : input.value.trim()) })));
    setTimeout(() => input.focus(), 0);
  });
}

// A key in a line (ProseMirror's handleKeyDown, before its own: true, taken). Lines folded away are passed over.
export function lineKey(ev) {
  if (ev.isComposing) return false;
  readCaret();
  const h = here(), p = shown(), i = h && p ? p.blocks.findIndex((b) => b.id === h.id) : -1;
  if (!h) return ev.key === "Enter";                     // (the caret in no line: the browser's Enter would make one)
  if (i < 0 || p.deleted) return false;
  const b = p.blocks[i];
  if (menu && menu.kind === "slash" && slashKey(ev)) return true;
  if (menu && menu.kind === "at" && atKey(ev)) return true;
  if (menu && menu.kind === "page" && pageKey(ev)) return true;
  if (menu && menu.kind === "figma" && figmaKey(ev)) return true;
  const mod = ev.metaKey || ev.ctrlKey, k = ev.key, size = h.node.content.size;
  if (MEDIA.includes(b.type) && !mod && captionKey(ev, p, i, h)) return true;
  if (k === "Escape" && !mod && !ev.shiftKey) { pickRange(b.id, b.id); holdKeys(); return true; }   // the line picked
  if (ev.shiftKey && !mod && !ev.altKey && (k === "ArrowUp" || k === "ArrowDown") && h.same) {
    const up = k === "ArrowUp";
    if (!(up ? h.from : size - h.to)) {                 // its words selected to that end already: the lines from here
      const to = p.blocks[i + (up ? -1 : 1)];
      pickRange(b.id, to ? to.id : b.id);
      holdKeys();
      return true;
    }
    if (view.endOfTextblock(up ? "up" : "down")) {      // on its first (last) row: to that end of the line -- not, as the
      const { anchor } = view.state.selection;          // browser would, out of it into the next line's words
      edit(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, h.pos + 1 + (up ? 0 : size))), "select");
      return true;
    }
  }
  if (mod && !ev.altKey) {
    const low = k.toLowerCase();
    if (low === "z") { undoStep(ev.shiftKey); return true; }   // the page's undo, not the browser's
    if (!ev.shiftKey && low === "a") {                  // ⌘A: the line's words, then (all of them selected) every line
      if (h.same && h.from === 0 && h.to === size) { pickAll(); holdKeys(); return true; }
      edit(view.state.tr.setSelection(TextSelection.create(view.state.doc, h.pos + 1, h.pos + 1 + size)), "select");
      return true;
    }
    if (b.type !== "code" && !ev.shiftKey && ["b", "i", "u", "e"].includes(low)) { markLine(low === "e" ? "code" : low); return true; }
    if (b.type !== "code" && ev.shiftKey && (low === "s" || low === "x")) { markLine("s"); return true; }
    if (b.type !== "code" && !ev.shiftKey && low === "k") { linkLine(); return true; }
    if (ev.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) { shift(p, i, k === "ArrowUp" ? -1 : 1); return true; }
    if (k === "Enter") {
      if (b.type === "todo") tick(b);
      else addAfter(b, "text");
      return true;
    }
    return false;
  }
  if (k === "Enter" && !ev.shiftKey) {
    if (b.type === "code") edit(view.state.tr.insertText("\n"));   // a new line of code
    else if (h.same) enter(p, i, h);
    return true;
  }
  if (k === "Enter") {                                   // ⇧↵: a new line in the line (in code: a line below it)
    if (b.type === "code") addAfter(b, "text");
    else edit(view.state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    return true;
  }
  if (k === "Backspace" && h.start) { backspace(p, i, h); return true; }
  if (k === "Delete" && h.end && i + 1 < p.blocks.length) { joinNext(p, i); return true; }
  if (k === "Tab") {
    if (b.type === "code" && !ev.shiftKey) edit(view.state.tr.insertText("\t"));
    else if (INDENTED.includes(b.type)) indent(b, ev.shiftKey ? -1 : 1);
    return true;
  }
  if ((k === "ArrowUp" && view.endOfTextblock("up")) || (k === "ArrowLeft" && h.start)) {
    const prev = p.blocks.slice(0, i).reverse().find(canType);
    if (prev) focusBlock(prev.id, "end");
    else { $("title").focus(); setCaret($("title"), $("title").textContent.length); }
    return true;
  }
  if ((k === "ArrowDown" && view.endOfTextblock("down")) || (k === "ArrowRight" && h.end)) {
    const next = p.blocks.slice(i + 1).find(canType);
    if (next) { focusBlock(next.id, "start"); return true; }
  }
  return false;
}

export function wireTyping() {
  // a table's cells: typed in as elements of their own (tables.js); a divider, a picture, an Agents or Work table:
  // focused themselves. A line's keys and words are the editor's (lineKey, textIn).
  box.addEventListener("input", (ev) => {
    const cell = ev.target.closest && ev.target.closest(".tbl .cell");
    if (cell) cellInput(cell, ev);
  });
  box.addEventListener("focusout", (ev) => {
    const at = ev.target.classList && ev.target.classList.contains("cell") && cellOf(ev.target);
    if (at && dirty.has(cellKey(at.b.id, at.row, at.col))) sendTyped(cellKey(at.b.id, at.row, at.col));
    if (menu && menu.kind === "page" && menu.tx === ev.target && !(ev.relatedTarget && menu.el.contains(ev.relatedTarget))) closePop();
  });
  box.addEventListener("keydown", (ev) => {
    if (ev.isComposing || ev.target === box) return;
    const cell = ev.target.closest && ev.target.closest(".tbl .cell");
    if (cell) return cellKeys(ev, cell);
    const hr = ev.target.closest && ev.target.closest(".hr, .agt, .fig");
    if (hr && ev.target === hr) return dividerKey(ev, hr.closest(".blk"));
  });
}
