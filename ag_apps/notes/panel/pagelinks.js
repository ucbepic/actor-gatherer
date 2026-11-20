// Notes: [[ -- a link to a page.
// "[[" typed opens a list of the pages, found by the words typed after it; one picked takes the "[[..." out and puts a
// link to it there. A page not there yet can be made, inside this one, and linked.
import { el, esc, rid, SVG } from "./helpers.js";
import { current, pages, store } from "./state.js";
import { drawLinks, isText, kidsOf, pageOfLink, ZW } from "./model.js";
import { change } from "./send.js";
import { opened } from "./sidebar.js";
import { blockOf, openPage, page } from "./page.js";
import { caretIn, pointAt } from "./caret.js";
import { closePop, item, menu, place, popUp } from "./popups.js";
import { retyped } from "./tables.js";

export function pageInput(n, tx, b, ev) {
  if (menu && menu.kind === "page") {
    const c = caretIn(tx);
    if (menu.tx !== tx || !c || c.start < menu.from + 2 || tx.textContent.slice(menu.from, menu.from + 2) !== "[[") return closePop();
    const q = tx.textContent.slice(menu.from + 2, c.start);
    if (q.length > 80 || q.includes("]")) return closePop();
    return drawPages(q);
  }
  if (ev.inputType !== "insertText" || !ev.data || !ev.data.endsWith("[") || b.type === "code") return;
  const c = caretIn(tx);
  if (!c || !c.collapsed || c.start < 2 || tx.textContent.slice(c.start - 2, c.start) !== "[[") return;
  const r = getSelection().getRangeAt(0).getBoundingClientRect();
  const rect = r.width || r.height ? r : tx.getBoundingClientRect();
  popUp(rect, () => {}, null, "page");
  Object.assign(menu, { tx, from: c.start - 2, block: b.id, rect });
  drawPages("");
}
const pathOf = (p) => { const up = []; for (let q = p.parent && pages.get(p.parent); q; q = q.parent && pages.get(q.parent)) up.unshift(q.title || "Untitled"); return up.join(" / "); };
// the pages to link, for the words typed: none, this page's subpages first, then the rest as the sidebar has them; some,
// the pages whose title has them, those starting with them first
function pagesFor(q) {
  const words = q.trim().toLowerCase(), order = [];
  const walk = (id) => { for (const p of kidsOf(id)) { order.push(p); walk(p.id); } };
  walk(null);
  const others = order.filter((p) => p.id !== current);
  if (!words) return [...kidsOf(current), ...others.filter((p) => p.parent !== current)];
  const t = (p) => (p.title || "Untitled").toLowerCase();
  return others.filter((p) => t(p).includes(words)).sort((a, z) => Number(t(z).startsWith(words)) - Number(t(a).startsWith(words)));
}
function drawPages(q) {
  const name = q.trim(), here = page(), m = menu;       // (the menu: closed before a pick runs)
  const hits = pagesFor(q).slice(0, 50);
  const picks = hits.map((p) => ({ k: { glyph: p.icon || SVG.doc, sm: !p.icon, label: p.title || "Untitled", note: pathOf(p) }, run: () => pagePick(m, p.id) }));
  if (name && !hits.some((p) => (p.title || "").trim().toLowerCase() === name.toLowerCase()))
    picks.push({ k: { glyph: SVG.plus, sm: true, label: `New page “${name}”`, note: here ? `Inside ${here.title || "Untitled"}` : "" }, run: () => pagePick(m, null, name) });
  menu.items = picks;
  menu.on = Math.min(menu.on || 0, Math.max(0, picks.length - 1));
  const pop = menu.el;
  pop.replaceChildren(el("div", { class: "hd", text: "Link to a page" }));
  if (!picks.length) pop.append(el("div", { class: "none", text: "No pages yet. Type a name to create one." }));
  picks.forEach((x, j) => {
    const it = item(x.k, x.run);
    if (j === menu.on) it.classList.add("on");
    it.addEventListener("mousemove", () => { if (menu.on !== j) { menu.on = j; drawPages(q); } });
    pop.append(it);
  });
  place(pop, menu.rect);
  const on = pop.querySelector(".it.on");
  if (on) on.scrollIntoView({ block: "nearest" });
}
export function pageKey(ev) {
  const n = menu.items ? menu.items.length : 0;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawPages(menu.tx.textContent.slice(menu.from + 2, caretIn(menu.tx).start)); }
    return true;
  }
  if ((ev.key === "Enter" || ev.key === "Tab") && n) { ev.preventDefault(); const run = menu.items[menu.on].run; closePop(); run(); return true; }
  if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
  return false;
}
// A page picked from the menu `m` (or `title`: one made, inside this page): the "[[..." typed swapped for a link to it.
function pagePick(m, id, title = "") {
  closePop();
  if (!m || !m.tx || !m.tx.isConnected || !blockOf(m.tx.closest(".blk").dataset.id)) return;
  const c = caretIn(m.tx), to = Math.max(c && c.start > m.from ? c.start : m.from + 2, m.from + 2);
  putLink(m.tx, m.from, to, id || subpage(title));
}
// A new page inside the one open (its row in the sidebar shown): its id.
export function subpage(title) {
  const made = { id: rid(), title, icon: "", parent: current };
  change([{ op: "page.new", page: made, blocks: [{ id: rid(), type: "text", text: "", checked: false, indent: 0 }] }]);
  if (current) { opened.add(current); store.set("open", [...opened]); }
  return made.id;
}
// The line's text from `from` to `to` (caret positions) swapped for a link to the page `id`, the caret after it, and kept.
export function putLink(tx, from, to, id) {
  const n = tx.closest(".blk"), b = blockOf(n.dataset.id), name = pages.get(id).title || "Untitled";
  const r = document.createRange(), a = pointAt(tx, from), z = pointAt(tx, to);
  r.setStart(a.node, a.offset);
  r.setEnd(z.node, z.offset);
  r.deleteContents();
  const t = document.createElement("template");
  t.innerHTML = `<a href="page:${id}">${esc(name)}</a>`;
  drawLinks(t.content);
  const link = t.content.firstChild;
  // a space after it, unless one is there already: the caret goes after it
  const next = tx.textContent.charAt(from), gap = next && /\s/.test(next) ? null : document.createTextNode(" ");
  if (gap) r.insertNode(gap);
  r.insertNode(link);
  if (!isText(link.previousSibling)) link.before(ZW);
  for (const x of [...tx.childNodes]) if (x.nodeType === 3 && !x.length) x.remove();
  tx.focus();
  const at = document.createRange(), sel = getSelection();
  if (gap) at.setStart(gap, 1); else at.setStartAfter(link);
  at.collapse(true);
  sel.removeAllRanges();
  sel.addRange(at);
  retyped(n, tx, b);
}
// Backspace (Delete: forward) with only the zero-width space put beside a link between the caret and it: the link taken
// out whole, with the space -- not the space alone, which would leave the key seeming to do nothing.
export function overLink(n, tx, b, fwd) {
  const s = getSelection();
  if (!s.rangeCount || !s.isCollapsed) return false;
  const { startContainer: node, startOffset: off } = s.getRangeAt(0);
  if (node.nodeType !== 3 || !tx.contains(node) || node.data.charAt(fwd ? off : off - 1) !== ZW) return false;
  const link = fwd ? (off + 1 === node.length ? node.nextSibling : null) : (off === 1 ? node.previousSibling : null);
  if (!link || link.nodeType !== 1 || !link.matches("a.pg")) return false;
  node.deleteData(fwd ? off : off - 1, 1);
  link.remove();
  if (!node.length && !tx.textContent) tx.replaceChildren();
  retyped(n, tx, b);
  return true;
}
// A link to a page clicked: that page opened (one in the trash too; one gone, nothing).
export function followPage(ev) {
  const a = ev.target.closest && ev.target.closest("a.pg");
  if (!a) return false;
  ev.preventDefault();
  const id = pageOfLink(a);
  if (id && pages.has(id)) openPage(id);
  return true;
}
