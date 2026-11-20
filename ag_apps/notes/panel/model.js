// Notes: the notebook, as this panel has it (state.js keeps it) -- its pages, the links to pages a line holds
// drawn and written as markdown, and an op applied here as the backend applies it.
import { clean, now } from "./helpers.js";
import { book, known, pages } from "./state.js";
import { keepTyped, tableApply } from "./tables.js";

export const reindex = () => {
  pages.clear();
  known.clear();
  for (const p of book.pages) { p.blocks = p.blocks || []; pages.set(p.id, p); for (const b of p.blocks) known.set(b.id, b.text); }
};
export const live = () => book.pages.filter((p) => !p.deleted);
export const kidsOf = (id) => live().filter((p) => (p.parent || null) === id);
export function below(id) {                            // a page's subpages, theirs, ...
  const out = [], todo = [id];
  while (todo.length) { const here = todo.pop(); for (const p of book.pages) if (p.parent === here && !out.includes(p)) { out.push(p); todo.push(p.id); } }
  return out;
}
// A line's links to pages (href "page:<id>", notebook.py's), drawn as the page is now: its icon and title, struck while it
// is in the trash or gone, and kept whole (not typed into: a click opens the page). What is saved of one is its href and
// the title (clean() drops the rest).
const PAGE_HREF = /^page:([a-z0-9]{6,24})$/;
export const pageOfLink = (a) => { const m = PAGE_HREF.exec(a.getAttribute("href") || ""); return m ? m[1] : null; };
// Beside a link at a line's start or end, a zero-width space: a place for the caret, which Chrome has none for there
// (never saved: clean() drops it).
export const ZW = "\u200b";
export function withLinks(h) {
  if (!h || !h.includes('href="page:')) return h;
  const t = document.createElement("template");
  t.innerHTML = h;
  drawLinks(t.content);
  for (const a of t.content.querySelectorAll("a.pg")) padLink(a);
  return t.innerHTML;
}
export const isText = (n) => !!n && n.nodeType === 3 && n.length > 0;
function padLink(a) {
  if (!isText(a.nextSibling)) a.after(ZW);
  if (!isText(a.previousSibling)) a.before(ZW);
}
export function drawLinks(root) {                      // (a line being typed in too: the caret is never in a link)
  for (const a of root.querySelectorAll("a")) {
    const id = pageOfLink(a);
    if (!id) continue;
    const p = pages.get(id), cls = `pg${!p ? " gone" : p.deleted ? " binned" : ""}`;
    const tip = !p ? "That page was deleted" : p.deleted ? "Open page (in the trash)" : "Open page";
    if (a.className !== cls) a.className = cls;
    if (a.getAttribute("contenteditable") !== "false") a.setAttribute("contenteditable", "false");
    if (p && a.textContent !== (p.title || "Untitled")) a.textContent = p.title || "Untitled";
    if (a.dataset.icon !== (p && p.icon ? p.icon : "")) a.dataset.icon = p && p.icon ? p.icon : "";
    if (a.title !== tip) a.title = tip;
  }
}
// whether a page has a link to one of those pages (renamed, binned, ...: the links drawn again)
export const linksTo = (p, ids) => !!p && ids.size > 0 && p.blocks.some((b) => b.text && b.text.includes('href="page:')
  && [...ids].some((id) => b.text.includes(`href="page:${id}"`)));
// ... and as markdown, `[its title](ag://notes/page/<id>)` -- the link to the page agents write, which Chat opens --
// the rest of the line as it was: a line sent to an agent, so it can read the page
export function pagesAsMd(h) {
  if (!h || !h.includes('href="page:')) return h;
  const t = document.createElement("template");
  t.innerHTML = clean(h);
  for (const a of t.content.querySelectorAll("a")) {
    const id = pageOfLink(a), p = id && pages.get(id);
    if (id) a.replaceWith(`[${p ? p.title || "Untitled" : a.textContent}](ag://notes/page/${id})`);
  }
  return t.innerHTML;
}
export function placeAt(blocks, after) {
  if (after === "") return 0;
  const i = after == null ? -1 : blocks.findIndex((b) => b.id === after);
  return i < 0 ? blocks.length : i + 1;
}
// An op applied to the notebook here: the same as the backend applies it (notebook.py's Notebook.apply).
export function apply(op) {
  const p = typeof op.page === "string" ? pages.get(op.page) : null;
  switch (op.op) {
    case "page.new": {
      if (pages.has(op.page.id)) return;
      const made = { title: "", icon: "", parent: null, ...op.page, blocks: (op.blocks || []).map((b) => ({ ...b })) };
      book.pages.push(made);
      pages.set(made.id, made);
      return;
    }
    case "page.set": if (p) for (const k of ["title", "icon", "parent"]) if (k in op) p[k] = op[k]; return;
    case "page.delete":
      for (const id of op.pages || [op.page]) { const q = pages.get(id); if (q) { q.deleted = op.at || now(); q.deleted_with = op.page; } }
      return;
    case "page.restore":
      for (const id of op.pages || [op.page]) { const q = pages.get(id); if (q) { delete q.deleted; delete q.deleted_with; } }
      if (p && "parent" in op) p.parent = op.parent;
      return;
    case "page.purge": {
      const gone = new Set(op.pages || [op.page]);
      book.pages = book.pages.filter((q) => !gone.has(q.id));
      for (const id of gone) pages.delete(id);
      return;
    }
    case "block.put": {
      if (!p) return;
      const b = p.blocks.find((x) => x.id === op.block.id);
      if (b) Object.assign(b, op.block);
      else p.blocks.splice(placeAt(p.blocks, op.after), 0, { type: "text", text: "", checked: false, indent: 0, ...op.block });
      if (!b || "text" in op.block) known.set(op.block.id, op.block.text || "");
      const t = b || p.blocks.find((x) => x.id === op.block.id);
      if (t.type === "table") keepTyped(t);
      return;
    }
    case "cell.put": case "row.put": case "row.move": case "row.delete": case "col.put": case "col.move": case "col.delete": {
      const b = p && p.blocks.find((x) => x.id === op.block);
      if (b && b.type === "table") { tableApply(b, op); keepTyped(b); }
      return;
    }
    case "block.move": {
      if (!p) return;
      const i = p.blocks.findIndex((x) => x.id === op.block);
      if (i < 0) return;
      const [b] = p.blocks.splice(i, 1);
      p.blocks.splice(placeAt(p.blocks, op.after), 0, b);
      return;
    }
    case "block.delete": if (p) p.blocks = p.blocks.filter((x) => x.id !== op.block); known.delete(op.block); return;
    case "thread.add": {
      const b = p && p.blocks.find((x) => x.id === op.block);
      if (!b) return;
      b.thread = b.thread || [];
      if (!b.thread.some((l) => l.id === op.line.id)) b.thread.push({ at: now(), ...op.line });
      return;
    }
  }
}
