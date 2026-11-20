// Notes: typing in a line -- its words kept as they change, markdown at its start, Enter, Backspace, Delete, Tab,
// the arrows and the ⌘ keys; a line turned into another type; inline marks.
import { $, clean, el, esc, INDENTED, LISTS, MAX_INDENT, MEDIA, now, plainOf, rid } from "./helpers.js";
import { current } from "./state.js";
import { withLinks } from "./model.js";
import { change, dirty, forget, sendTyped, typed } from "./send.js";
import { undoStep } from "./undo.js";
import { blockOf, box, drawPage, rowOf, shown } from "./page.js";
import { caretIn, edge, empty, focusBlock, focusOnEdge, onLine, pointAt, setCaret, textOf } from "./caret.js";
import { closePop, menu, popUp } from "./popups.js";
import { slashInput, slashKey } from "./slash.js";
import { overLink, pageInput, pageKey } from "./pagelinks.js";
import { holdKeys, pickAll, pickRange } from "./picked.js";
import { canType, cellInput, cellKey, cellKeys, cellOf, retyped } from "./tables.js";
import { captionKey, figmaKey, focusFig } from "./pictures.js";
import { isWork } from "./actors.js";
import { atInput, atKey } from "./picker.js";

// Markdown at the start of a block, as it is typed: "# " a heading, "- " a list, "[] " a to-do, "> " a quote, "```" code,
// "---" a divider.
const SHORT = [[/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^[-*+]\s$/, "bullet"], [/^1[.)]\s$/, "number"],
  [/^\[\s?\]\s$/, "todo"], [/^\[x\]\s$/i, "todo", true], [/^>\s$/, "quote"]];
function shortcut(n, tx, b, ev) {
  if (ev.inputType !== "insertText" || !["text", "bullet"].includes(b.type)) return false;
  const c = caretIn(tx);
  if (!c || !c.collapsed) return false;
  const before = tx.textContent.slice(0, c.start);
  let to = null, checked = false;
  if (ev.data === " ") { const hit = SHORT.find(([rx]) => rx.test(before)); if (hit) { to = hit[1]; checked = !!hit[2]; } }
  else if (ev.data === "`" && before === "```") to = "code";
  else if (ev.data === "-" && tx.textContent === "---") to = "divider";
  if (!to || (b.type === "bullet" && to !== "todo")) return false;
  const r = document.createRange(), a = pointAt(tx, 0), z = pointAt(tx, before.length);
  r.setStart(a.node, a.offset);
  r.setEnd(z.node, z.offset);
  r.deleteContents();
  if (to === "divider") {
    forget(b.id);
    const next = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    change([{ op: "block.put", page: current, block: { id: b.id, type: "divider", text: "", indent: 0 } },
      { op: "block.put", page: current, block: next, after: b.id }]);
    drawPage();
    focusBlock(next.id, 0);
    return true;
  }
  if (to === "code") tx.textContent = plainOf(clean(tx.innerHTML));
  retype(b, to, { checked, text: to === "code" ? tx.textContent : clean(tx.innerHTML) });
  focusBlock(b.id, 0);
  return true;
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
export function retype(b, type, extra = {}) {
  const was = b.type, op = retypeOp(b, type, extra), text = op.block.text;
  change([op]);
  const tx = rowOf(b.id) && rowOf(b.id).querySelector(".tx");
  if (tx && (type === "code" || was === "code") && document.activeElement === tx) {
    if (type === "code") tx.textContent = text; else tx.innerHTML = withLinks(clean(text));
  }
  drawPage();
}

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
// it; else the block is split at the caret, its rest a new block below -- a list's next item, or text.
function enter(p, i, n, tx) {
  const b = p.blocks[i];
  if ([...LISTS, "quote"].includes(b.type) && empty(tx)) {
    if (b.indent > 0 && b.type !== "quote") return indent(b, -1);
    return retype(b, "text");
  }
  const kind = LISTS.includes(b.type) ? b.type : "text";
  const ind = INDENTED.includes(b.type) ? b.indent || 0 : 0;
  if (edge(tx, false) && !empty(tx)) {
    const above = { id: rid(), type: kind, text: "", checked: false, indent: ind };
    change([{ op: "block.put", page: p.id, block: above, after: i ? p.blocks[i - 1].id : "" }]);
    drawPage();
    return;
  }
  const s = getSelection(), r = s.getRangeAt(0);
  r.deleteContents();
  const tail = document.createRange();
  tail.setStart(r.startContainer, r.startOffset);
  tail.setEnd(tx, tx.childNodes.length);
  const hold = document.createElement("div");
  hold.append(tail.extractContents());
  const rest = clean(hold.innerHTML), left = clean(tx.innerHTML);
  if (tx.innerHTML !== withLinks(left)) tx.innerHTML = withLinks(left);
  const next = { id: rid(), type: kind, text: rest, checked: false, indent: ind };
  forget(b.id);
  change([{ op: "block.put", page: p.id, block: { id: b.id, text: left } }, { op: "block.put", page: p.id, block: next, after: b.id }]);
  drawPage();
  focusBlock(next.id, "start");
}
// Backspace at a block's start: a heading, list item or the like made text; text set in, out a level; else joined to
// the block above (a divider above, removed).
function backspace(p, i, n, tx) {
  const b = p.blocks[i];
  if (b.type !== "text") return retype(b, "text");
  if (b.indent > 0) return indent(b, -1);
  if (!i) return;
  const prev = p.blocks[i - 1];
  if (MEDIA.includes(prev.type)) {                       // a picture above: never joined; an empty line goes
    if (empty(tx)) { forget(b.id); change([{ op: "block.delete", page: p.id, block: b.id }]); drawPage(); }
    return focusFig(prev.id);
  }
  if (prev.type === "divider") {
    change([{ op: "block.delete", page: p.id, block: prev.id }]);
    drawPage();
    return focusBlock(b.id, "start");
  }
  const at = prev.type === "code" ? prev.text.length : plainOf(prev.text).length;
  const joined = prev.type === "code" ? prev.text + tx.textContent : clean(prev.text + clean(tx.innerHTML));
  forget(b.id);
  forget(prev.id);
  change([{ op: "block.put", page: p.id, block: { id: prev.id, text: joined } }, { op: "block.delete", page: p.id, block: b.id }]);
  drawPage();
  const ptx = rowOf(prev.id) && rowOf(prev.id).querySelector(".tx");
  if (ptx) { ptx.focus(); setCaret(ptx, at); }
}
function joinNext(p, i, n, tx) {
  const b = p.blocks[i], next = p.blocks[i + 1];
  if (MEDIA.includes(next.type)) return focusFig(next.id);
  if (next.type === "divider") { change([{ op: "block.delete", page: p.id, block: next.id }]); drawPage(); return; }
  const at = tx.textContent.length;
  const joined = b.type === "code" ? tx.textContent + plainOf(next.text) : clean(clean(tx.innerHTML) + (next.type === "code" ? esc(next.text) : next.text));
  forget(b.id);
  forget(next.id);
  if (b.type === "code") tx.textContent = joined; else tx.innerHTML = withLinks(joined);
  change([{ op: "block.put", page: p.id, block: { id: b.id, text: joined } }, { op: "block.delete", page: p.id, block: next.id }]);
  drawPage();
  setCaret(tx, at);
}
function indent(b, by) {
  const to = Math.max(0, Math.min(MAX_INDENT, (b.indent || 0) + by));
  if (to === (b.indent || 0)) return;
  const tx = rowOf(b.id) && rowOf(b.id).querySelector(".tx"), at = tx && caretIn(tx);
  change([{ op: "block.put", page: current, block: { id: b.id, indent: to } }]);
  drawPage();
  if (tx && at) { tx.focus(); setCaret(tx, at.start, at.end); }
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
function shift(p, i, by) {
  const j = i + by;
  if (j < 0 || j >= p.blocks.length) return;
  const b = p.blocks[i], tx = rowOf(b.id).querySelector(".tx"), at = tx && caretIn(tx);
  const rest = p.blocks.filter((x) => x.id !== b.id);
  const after = by < 0 ? (j ? rest[j - 1].id : "") : rest[i].id;
  change([{ op: "block.move", page: p.id, block: b.id, after }]);
  drawPage();
  if (tx) { tx.focus(); if (at) setCaret(tx, at.start, at.end); }
}

// inline marks: bold, italic, underline, struck (the browser's), code and links (here)
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

export function wireTyping() {
  box.addEventListener("input", (ev) => {
    const cell = ev.target.closest && ev.target.closest(".tbl .cell");
    if (cell) return cellInput(cell, ev);
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    const n = tx.closest(".blk"), b = blockOf(n.dataset.id);
    if (!b) return;
    if (tx.innerHTML === "<br>") tx.innerHTML = "";
    if (shortcut(n, tx, b, ev)) return;
    b.text = textOf(n, b);
    typed(current, b.id, b.text);
    if (MEDIA.includes(b.type)) return pageInput(n, tx, b, ev);   // a caption: words and links to pages, no / or @
    slashInput(n, tx, b, ev);
    atInput(n, tx, b, ev);
    pageInput(n, tx, b, ev);
  });
  box.addEventListener("focusout", (ev) => {
    const n = ev.target.closest && ev.target.closest(".blk"), at = ev.target.classList && ev.target.classList.contains("cell") && cellOf(ev.target);
    if (at && dirty.has(cellKey(at.b.id, at.row, at.col))) sendTyped(cellKey(at.b.id, at.row, at.col));
    if (n && dirty.has(n.dataset.id)) sendTyped(n.dataset.id);
    if (menu && (menu.kind === "slash" || menu.kind === "at" || menu.kind === "page") && ev.target === menu.tx
      && !(ev.relatedTarget && menu.el.contains(ev.relatedTarget))) closePop();   // (into the picker's box: kept)
  });
  box.addEventListener("keydown", (ev) => {
    if (ev.isComposing) return;
    const cell = ev.target.closest && ev.target.closest(".tbl .cell");
    if (cell) return cellKeys(ev, cell);
    const hr = ev.target.closest && ev.target.closest(".hr, .agt, .fig");
    if (hr && ev.target === hr) return dividerKey(ev, hr.closest(".blk"));
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    const n = tx.closest(".blk"), p = shown(), i = p ? p.blocks.findIndex((b) => b.id === n.dataset.id) : -1;   // (lines folded away: passed over)
    if (i < 0 || p.deleted) return;
    const b = p.blocks[i];
    if (menu && menu.kind === "slash" && slashKey(ev)) return;
    if (menu && menu.kind === "at" && atKey(ev)) return;
    if (menu && menu.kind === "page" && pageKey(ev)) return;
    if (menu && menu.kind === "figma" && figmaKey(ev)) return;
    const mod = ev.metaKey || ev.ctrlKey, k = ev.key;
    if (MEDIA.includes(b.type) && !mod && captionKey(ev, p, i, n, tx)) return;
    if (k === "Escape" && !mod && !ev.shiftKey) { ev.preventDefault(); pickRange(b.id, b.id); return holdKeys(); }   // the line picked
    if (ev.shiftKey && !mod && !ev.altKey && (k === "ArrowUp" || k === "ArrowDown")) {
      const c = caretIn(tx), up = k === "ArrowUp", t = tx.textContent;   // its text selected to an end already: the lines
      if (c && !(up ? t.slice(0, c.start) : t.slice(c.end)).replace(/\u200b/g, "")) {   // from here
        ev.preventDefault();
        const to = p.blocks[i + (up ? -1 : 1)];
        pickRange(b.id, to ? to.id : b.id);
        return holdKeys();
      }
      if (c && focusOnEdge(tx, !up)) {                     // on its first (last) row: to that end of the line -- not, as the
        ev.preventDefault();                               // browser would, out of it into the next line's words
        const z = pointAt(tx, up ? 0 : t.length);
        getSelection().extend(z.node, z.offset);
        return;
      }
    }
    if (mod && !ev.altKey) {
      const low = k.toLowerCase();
      if (low === "z") { ev.preventDefault(); return undoStep(ev.shiftKey); }   // the page's undo, not the browser's
      if (!ev.shiftKey && low === "a") {                    // ⌘A: the line's text, then (all of it selected) every line
        const c = caretIn(tx);
        if (c && c.start === 0 && c.end === tx.textContent.length) { ev.preventDefault(); pickAll(); return holdKeys(); }
        return;
      }
      if (b.type !== "code" && !ev.shiftKey && low === "b") return format(ev, n, "bold");
      if (b.type !== "code" && !ev.shiftKey && low === "i") return format(ev, n, "italic");
      if (b.type !== "code" && !ev.shiftKey && low === "u") return format(ev, n, "underline");
      if (b.type !== "code" && ev.shiftKey && (low === "s" || low === "x")) return format(ev, n, "strikeThrough");
      if (b.type !== "code" && !ev.shiftKey && low === "e") { ev.preventDefault(); return codeMark(n, tx); }
      if (b.type !== "code" && !ev.shiftKey && low === "k") { ev.preventDefault(); return linkBox(n, tx); }
      if (ev.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) { ev.preventDefault(); return shift(p, i, k === "ArrowUp" ? -1 : 1); }
      if (k === "Enter") {
        ev.preventDefault();
        if (b.type === "todo") return tick(b);
        return addAfter(b, "text");
      }
      return;
    }
    if (k === "Enter" && !ev.shiftKey) {
      if (b.type === "code") return;                      // a new line of code
      ev.preventDefault();
      return enter(p, i, n, tx);
    }
    if (k === "Enter" && ev.shiftKey && b.type === "code") { ev.preventDefault(); return addAfter(b, "text"); }
    if ((k === "Backspace" || k === "Delete") && !ev.altKey && overLink(n, tx, b, k === "Delete")) return ev.preventDefault();
    if (k === "Backspace" && edge(tx, false)) { ev.preventDefault(); return backspace(p, i, n, tx); }
    if (k === "Delete" && edge(tx, true) && i + 1 < p.blocks.length) { ev.preventDefault(); return joinNext(p, i, n, tx); }
    if (k === "Tab") {
      ev.preventDefault();
      if (b.type === "code" && !ev.shiftKey) document.execCommand("insertText", false, "\t");
      else if (INDENTED.includes(b.type)) indent(b, ev.shiftKey ? -1 : 1);
      return;
    }
    if ((k === "ArrowUp" && onLine(tx, false)) || (k === "ArrowLeft" && edge(tx, false))) {
      const prev = p.blocks.slice(0, i).reverse().find(canType);
      ev.preventDefault();
      if (prev) focusBlock(prev.id, "end");
      else { $("title").focus(); setCaret($("title"), $("title").textContent.length); }
      return;
    }
    if ((k === "ArrowDown" && onLine(tx, true)) || (k === "ArrowRight" && edge(tx, true))) {
      const next = p.blocks.slice(i + 1).find(canType);
      if (next) { ev.preventDefault(); focusBlock(next.id, "start"); }
    }
  });
}
