// Notes: the / menu -- "/" typed at a word's start in a line lists the blocks, found by the words typed after it;
// one picked turns the line into it (or, the line holding other words, puts it below).
import { $, el, FIGMA_KIND, IMAGE_KIND, KINDS, LINK_KIND, PAGE_KIND, rid, TABLE_KIND, UNSENT } from "./helpers.js";
import { current } from "./state.js";
import { change, forget } from "./send.js";
import { blockOf, drawPage, openPage } from "./page.js";
import { caretIn, empty, focusBlock, pointAt, setCaret, textOf } from "./caret.js";
import { addAfter, retype } from "./typing.js";
import { closePop, item, menu, place, popUp } from "./popups.js";
import { putLink, subpage } from "./pagelinks.js";
import { putTable } from "./tables.js";
import { figmaBox, pickPictures } from "./pictures.js";

export function slashInput(n, tx, b, ev) {
  if (menu && menu.kind === "slash") {
    const c = caretIn(tx);
    if (menu.tx !== tx || !c || c.start <= menu.from || tx.textContent[menu.from] !== "/") return closePop();
    const q = tx.textContent.slice(menu.from + 1, c.start);
    if (q.length > 24 || /\s\s/.test(q)) return closePop();
    return drawSlash(q);
  }
  if (ev.inputType !== "insertText" || ev.data !== "/" || b.type === "code") return;
  const c = caretIn(tx);
  if (!c) return;
  const before = tx.textContent.slice(0, c.start - 1);
  if (before && !/\s$/.test(before)) return;
  const r = getSelection().getRangeAt(0).getBoundingClientRect();
  const rect = r.width || r.height ? r : tx.getBoundingClientRect();
  popUp(rect, () => {}, null, "slash");
  Object.assign(menu, { tx, from: c.start - 1, block: b.id, rect });
  drawSlash("");
}
function drawSlash(q) {
  const words = q.trim().toLowerCase();
  const rank = (k) => { const l = k.label.toLowerCase(); return l.startsWith(words) ? 0 : l.includes(words) ? 1 : 2; };   // (its name, then its other words)
  const items = [...KINDS, TABLE_KIND, PAGE_KIND, LINK_KIND, IMAGE_KIND, FIGMA_KIND].filter((k) => !words || k.label.toLowerCase().includes(words) || k.words.includes(words))
    .sort((x, y) => (words ? rank(x) - rank(y) : 0));
  menu.items = items;
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
    if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawSlash(menu.tx.textContent.slice(menu.from + 1, caretIn(menu.tx).start)); }
    return true;
  }
  if ((ev.key === "Enter" || ev.key === "Tab") && n) { ev.preventDefault(); slashPick(menu.items[menu.on].type); return true; }
  if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
  return false;
}
// A block type picked from the / menu: the "/..." typed taken out, and the block made that type -- or, if it holds
// other words, a new block of it below.
function slashPick(type, picked = null) {
  const m = picked || menu;
  closePop();
  if (!m || !m.tx || !m.tx.isConnected) return;
  const tx = m.tx, n = tx.closest(".blk"), b = blockOf(n.dataset.id);
  const c = caretIn(tx) || { start: m.from + 1 };
  const r = document.createRange(), a = pointAt(tx, m.from), z = pointAt(tx, Math.max(c.start, m.from + 1));
  r.setStart(a.node, a.offset);
  r.setEnd(z.node, z.offset);
  r.deleteContents();
  if (tx.innerHTML === "<br>") tx.innerHTML = "";
  b.text = textOf(n, b);
  tx.focus();
  setCaret(tx, m.from);
  if (type === LINK_KIND.type) return void document.execCommand("insertText", false, "[[");   // the pages, as "[[" opens them
  if (type === IMAGE_KIND.type) return pickPictures(b);
  if (type === TABLE_KIND.type) return putTable(b, tx);
  if (type === FIGMA_KIND.type) return figmaBox(b, tx);
  if (type === PAGE_KIND.type) {                         // a page made inside this one, linked here, and opened
    const id = subpage("");
    putLink(tx, m.from, m.from, id);
    openPage(id);
    return $("title").focus();
  }
  if (UNSENT.includes(type)) {
    forget(b.id);
    const next = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    if (empty(tx)) change([{ op: "block.put", page: current, block: { id: b.id, type, text: "", indent: 0 } },
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
  if (empty(tx)) { retype(b, type, { text: "" }); return focusBlock(b.id, 0); }
  forget(b.id);
  change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } }]);
  addAfter(b, type);
}
