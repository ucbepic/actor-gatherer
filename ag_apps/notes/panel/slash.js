// Notes: the / menu -- "/" typed at a word's start in a line lists the blocks, found by the words typed after it;
// one picked turns the line into it (or, the line holding other words, puts it below). The menus typed in a line
// (this one, [[ and @) follow the line as it changes (followMenu): the words typed since narrow them, and the caret
// leaving those words closes them.
import { $, el, FIGMA_KIND, IMAGE_KIND, KINDS, LINK_KIND, PAGE_KIND, rid, TABLE_KIND, UNSENT } from "./helpers.js";
import { current } from "./state.js";
import { change, forget } from "./send.js";
import { blockOf, box, drawPage, openPage } from "./page.js";
import { blank, focusBlock } from "./caret.js";
import { addAfter, retype } from "./typing.js";
import { closePop, item, menu, place, popUp } from "./popups.js";
import { pageFollow, pageTyped, putLinkLine, subpage } from "./pagelinks.js";
import { putTable } from "./tables.js";
import { figmaBox, pickPictures } from "./pictures.js";
import { atFollow } from "./picker.js";
import { boxAt, edit, here, view } from "./editor.js";

// The words of the line a menu was typed in, from where it was typed (`menu.from`, a place in the doc: the "/", "@" or
// "[[", `skip` long) to the caret: {lead, q}; null if the caret is not after them, in that line.
export function menuWords(skip) {
  const st = view.state, sel = st.selection, h = here();
  if (!h || h.id !== menu.block || !sel.empty || sel.head < menu.from + skip || menu.from < h.pos + 1) return null;
  return { lead: st.doc.textBetween(menu.from, menu.from + skip, ""), q: st.doc.textBetween(menu.from + skip, sel.head, "") };
}
// after each change to the doc while a menu typed in a line is open: it narrowed, or closed
export function followMenu() {
  if (menu.kind === "slash") {
    const at = menuWords(1);
    if (!at || at.lead !== "/" || at.q.length > 24 || /\s\s/.test(at.q)) return closePop();
    if (at.q !== menu.q) drawSlash(at.q);
  } else if (menu.kind === "page") pageFollow();
  else if (menu.kind === "at") atFollow();
}
// "/" typed (`text`, just put in the line `b`) at a word's start: the menu, at the caret
export function slashTyped(b, text) {
  const h = here();
  if (text !== "/" || b.type === "code" || !h || !h.empty) return;
  const before = h.node.textBetween(0, h.from - 1, "");
  if (before && !/\s$/.test(before)) return;
  const rect = boxAt(view.state.selection.head);
  popUp(rect, () => {}, null, "slash");
  Object.assign(menu, { tx: box, line: true, from: view.state.selection.head - 1, block: b.id, rect });
  drawSlash("");
}
function drawSlash(q) {
  const words = q.trim().toLowerCase();
  const rank = (k) => { const l = k.label.toLowerCase(); return l.startsWith(words) ? 0 : l.includes(words) ? 1 : 2; };   // (its name, then its other words)
  const items = [...KINDS, TABLE_KIND, PAGE_KIND, LINK_KIND, IMAGE_KIND, FIGMA_KIND].filter((k) => !words || k.label.toLowerCase().includes(words) || k.words.includes(words))
    .sort((x, y) => (words ? rank(x) - rank(y) : 0));
  menu.items = items;
  menu.q = q;
  menu.on = Math.min(menu.on || 0, Math.max(0, items.length - 1));
  const pop = menu.el;
  pop.replaceChildren(el("div", { class: "hd", text: "Blocks" }));
  if (!items.length) pop.append(el("div", { class: "none", text: "No results" }));
  const m = menu;                                       // (closed by a click before its pick runs)
  items.forEach((k, j) => {
    const it = item(k, () => slashPick(k.type, m));
    if (j === menu.on) it.classList.add("on");
    it.addEventListener("mousemove", () => { if (menu.on !== j) { menu.on = j; drawSlash(q); } });
    pop.append(it);
  });
  place(pop, menu.rect);
  const on = pop.querySelector(".it.on");
  if (on) on.scrollIntoView({ block: "nearest" });
}
export function slashKey(ev) {
  const n = menu.items ? menu.items.length : 0;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawSlash(menu.q || ""); }
    return true;
  }
  if ((ev.key === "Enter" || ev.key === "Tab") && n) { ev.preventDefault(); slashPick(menu.items[menu.on].type); return true; }
  if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
  return false;
}
// A block type picked from the / menu: the "/..." typed taken out (as typing would), and the block made that type --
// or, if it holds other words, a new block of it below.
function slashPick(type, picked = null) {
  const m = picked || menu;
  closePop();
  const st = view.state, h = here(), b = m && blockOf(m.block);
  if (!m || !m.line || !b || !h || h.id !== m.block) return;
  const to = Math.max(st.selection.empty && st.selection.head > m.from ? st.selection.head : m.from + 1, m.from + 1);
  if (st.doc.textBetween(m.from, m.from + 1, "") !== "/") return;
  const tr = st.tr.delete(m.from, to);
  if (type === LINK_KIND.type) {                         // the pages, as "[[" opens them
    edit(tr.insertText("[[", m.from));
    view.focus();
    return pageTyped(b, "[[");
  }
  edit(tr);
  view.focus();
  if (type === IMAGE_KIND.type) return pickPictures(b);
  if (type === TABLE_KIND.type) return putTable(b, blank(b.id));
  if (type === FIGMA_KIND.type) return figmaBox(b);
  if (type === PAGE_KIND.type) {                         // a page made inside this one, linked here, and opened
    const id = subpage("");
    putLinkLine(b.id, m.from, m.from, id);
    openPage(id);
    return $("title").focus();
  }
  const none = blank(b.id);
  if (UNSENT.includes(type)) {
    forget(b.id);
    const next = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    if (none) change([{ op: "block.put", page: current, block: { id: b.id, type, text: "", indent: 0 } },
      { op: "block.put", page: current, block: next, after: b.id }]);
    else {
      const line = { id: rid(), type, text: "", checked: false, indent: 0 };
      change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } },
        { op: "block.put", page: current, block: line, after: b.id },
        { op: "block.put", page: current, block: next, after: line.id }]);
    }
    drawPage();
    return focusBlock(next.id, 0);
  }
  if (none) { retype(b, type, { text: "" }); return focusBlock(b.id, 0); }
  forget(b.id);
  change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } }]);
  addAfter(b, type);
}
