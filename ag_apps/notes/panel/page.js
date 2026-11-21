// Notes: the page open, drawn as the notebook has it -- its trail, title, icon and lines, a row each -- and its
// ended work items folded away. The lines are one editor's (editor.js): the doc drawn from the notebook, each row's
// parts other than its words drawn here.
import { $, AGENTS, el, LOG, MEDIA, PH, SPECIAL, SVG, WORK } from "./helpers.js";
import { convo, current, pages, setConvo, setCurrent, store } from "./state.js";
import { drawLinks, live } from "./model.js";
import { flushTyped, pump } from "./send.js";
import { app, drawSide, narrow, opened, purge, restore } from "./sidebar.js";
import { drawDoc } from "./editor.js";
import { typeOf } from "./doc.js";
import { drawPicked, picked, unpick } from "./picked.js";
import { drawTable } from "./tables.js";
import { drawMedia } from "./pictures.js";
import { crossed, endedOf, isWork, onIt } from "./actors.js";
import { outgoing, sentPart } from "./sent.js";
import { drawConvo } from "./convo.js";
import { drawAgentsBlock, drawAgentsPage } from "./agents.js";
import { drawWorkBlock, drawWorkPage } from "./work.js";

export function openPage(id) {
  flushTyped();
  pump();
  if (current !== id) unpick();
  if (convo && convo.page !== id) setConvo(null);         // a line's conversation: on its own page only
  setCurrent(id);
  store.set("page", id);
  for (let p = pages.get(id); p && p.parent; p = pages.get(p.parent)) opened.add(p.parent);
  if (narrow()) app.classList.remove("side-on");
  drawSide();
  drawPage();
  $("scroll").scrollTop = 0;
}
export function drawPage(flash = null) {
  $("agents-page").hidden = current !== AGENTS;
  $("work-page").hidden = current !== WORK && current !== LOG;
  if (SPECIAL.includes(current)) {
    for (const id of ["empty", "page", "banner", "done-btn"]) $(id).hidden = true;
    $("crumbs").replaceChildren(el("button", { type: "button", text: current === AGENTS ? "Agents" : current === WORK ? "Work" : "Logbook" }));
    if (current === AGENTS) drawAgentsPage(); else drawWorkPage();
    return drawConvo();
  }
  const p = current && pages.get(current);
  const none = !live().length && !p;
  $("empty").hidden = !none;
  $("page").hidden = !p;
  $("banner").hidden = !(p && p.deleted);
  drawCrumbs(p);
  drawDoneBtn(p);
  if (!p) { drawDoc(null, [], true); $("fold-all").hidden = true; return drawConvo(); }
  const ro = !!p.deleted;
  $("page").classList.toggle("ro", ro);
  if (ro) $("banner").replaceChildren(el("span", { text: "This page is in the trash." }),
    el("button", { type: "button", text: "Restore", onclick: () => restore(pages.get(p.deleted_with) || p) }),
    el("button", { type: "button", text: "Delete for good", onclick: () => purge(pages.get(p.deleted_with) || p) }));
  const title = $("title");
  title.setAttribute("contenteditable", ro ? "false" : "plaintext-only");
  if (document.activeElement !== title && title.textContent !== (p.title || "")) title.textContent = p.title || "";
  $("icon").hidden = !p.icon;
  $("icon").textContent = p.icon || "";
  $("add-icon").hidden = !!p.icon || ro;
  drawBlocks(p, flash, ro);
  drawConvo();
}
export function drawCrumbs(p) {
  const trail = [];
  for (let q = p; q; q = q.parent ? pages.get(q.parent) : null) trail.unshift(q);
  const c = $("crumbs");
  c.replaceChildren();
  trail.forEach((q, i) => {
    if (i) c.append(el("span", { class: "sep", text: "/" }));
    c.append(el("button", { type: "button", text: `${q.icon ? q.icon + " " : ""}${q.title || "Untitled"}`, onclick: () => openPage(q.id) }));
  });
}
export const box = $("blocks");
export const rowOf = (id) => box.querySelector(`.blk[data-id="${CSS.escape(id)}"]`);
export const page = () => current && pages.get(current);
export const blockOf = (id) => { const p = page(); return p && p.blocks.find((b) => b.id === id); };
// A block's row, as the editor makes one for its node (editor.js's Row): its words (.tx, if it has any) the node's
// content; the rest -- the gutter, the marker, a picture, a table, its buttons, what it was sent -- not words
// (contenteditable false), drawn by updateRow.
export function makeRow(type, id) {
  const gut = el("div", { class: "gut", contenteditable: "false" },
    el("button", { class: "add", type: "button", tabindex: "-1", title: "Add a block below", "aria-label": "Add a block below", html: SVG.plus }),
    el("button", { class: "grip", type: "button", tabindex: "-1", title: "Drag to move · click for menu", "aria-label": "Move or open menu", html: SVG.grip }));
  const n = el("div", { class: "blk", "data-id": id, "data-type": type }, gut);
  if (type === "divider") n.append(el("div", { class: "hr", tabindex: "0", role: "separator" }));
  else if (type === "agents") n.append(el("div", { class: "agt", tabindex: "0", role: "group", "aria-label": "Actors" }));
  else if (type === "work") n.append(el("div", { class: "agt wkb", tabindex: "0", role: "group", "aria-label": "Open work items" }));
  else if (MEDIA.includes(type)) n.append(el("div", { class: "fig", tabindex: "0", role: "figure", contenteditable: "false" }), el("div", { class: "tx cap", spellcheck: "true" }));
  else if (type === "table") n.append(el("div", { class: "tbl" }, el("div", { class: "tbl-scroll" }, el("div", { class: "tbl-in" },
    el("table", { class: "grid" }, el("colgroup"), el("tbody")),
    el("div", { class: "tbl-edges" }),
    el("button", { class: "tbl-h tbl-ch", type: "button", tabindex: "-1", title: "Drag to move · click for menu", "aria-label": "Move column or open menu", html: SVG.more }),
    el("button", { class: "tbl-h tbl-rh", type: "button", tabindex: "-1", title: "Drag to move · click for menu", "aria-label": "Move row or open menu", html: SVG.grip }),
    el("button", { class: "tbl-add tbl-add-col", type: "button", tabindex: "-1", title: "Add a column (drag for more)", "aria-label": "Add a column", html: SVG.plus }),
    el("button", { class: "tbl-add tbl-add-row", type: "button", tabindex: "-1", title: "Add a row (drag for more)", "aria-label": "Add a row", html: SVG.plus })))));
  else n.append(el("div", { class: "mk", contenteditable: "false" }), el("div", { class: "tx", spellcheck: "true" }),
    el("button", { class: "to-btn", type: "button", tabindex: "-1", contenteditable: "false", title: "Send to an agent (or type @)", html: SVG.at }));
  return n;
}
// A row's node, as the editor has it now: its type, indent, tick and marker, and whether it has words (its
// placeholder); a row just made (`made`), all of it, as the notebook has its block.
export function rowNode(n, node, made) {
  const type = typeOf(node), id = node.attrs.id, b = blockOf(id), p = page();
  n.dataset.id = id;
  const tx = n.querySelector(":scope > .tx");
  if (tx) { tx.classList.toggle("blank", node.content.size === 0); tx.dataset.ph = PH[type] || ""; }
  if (made && b && b.type === type) return updateRow(n, b, !!(p && p.deleted));
  n.dataset.type = type;
  n.style.setProperty("--ind", node.attrs.indent || 0);
  n.classList.toggle("done", type === "todo" && !!node.attrs.checked);
  if (n.querySelector(":scope > .mk")) drawMark(n, type, node.attrs.indent || 0, !!node.attrs.checked);
}
function updateRow(n, b, ro) {
  n.dataset.type = b.type;
  n.style.setProperty("--ind", b.indent || 0);
  n.classList.toggle("done", b.type === "todo" && !!b.checked);
  n.classList.toggle("ended", crossed(b));
  n.classList.toggle("is-sent", onIt(b).length > 0 || outgoing.has(b.id));
  n.classList.toggle("ro", !!ro);
  if (b.type === "agents") return drawAgentsBlock(n);
  if (b.type === "work") return drawWorkBlock(n);
  if (b.type === "table") return drawTable(n, b, ro);
  const tx = n.querySelector(":scope > .tx");
  if (!tx) return;
  const to = n.querySelector(".to-btn");                 // its words drawn by the style: not the block's text
  if (to) { to.dataset.label = b.type === "todo" ? "Assign" : "Ask"; to.setAttribute("aria-label", b.type === "todo" ? "Assign to an agent" : "Ask an agent"); }
  n.classList.toggle("picked", picked.has(b.id));
  sentPart(n, b, ro);
  tx.dataset.ph = PH[b.type] || "";
  if (b.type !== "code") drawLinks(tx);                  // (its links to pages: as the pages are now)
  if (MEDIA.includes(b.type)) return drawMedia(n, b, ro);
  drawMark(n, b.type, b.indent || 0, !!b.checked);
}
function drawMark(n, type, indent, checked) {
  const mk = n.querySelector(":scope > .mk");
  const want = type === "todo" ? `todo:${checked}` : type === "bullet" ? `bullet:${indent % 3}` : type;
  if (mk.dataset.is === want) return;
  mk.dataset.is = want;
  mk.replaceChildren();
  if (type === "todo") mk.append(el("button", { class: "chk", type: "button", role: "checkbox", tabindex: "-1",
    "aria-checked": String(checked), "aria-label": checked ? "Done" : "To do", html: SVG.check }));
  else if (type === "bullet") mk.append(el("span", { class: `dot d${indent % 3}` }));
}
// The page's blocks drawn as the notebook has them: the doc made so (editor.js's drawDoc: a line with words typed and
// not yet sent left as the reader has it -- they are theirs until they are sent), then each row's other parts. Lines
// folded away (`foldOf`) are not in the doc: a fold says where they are.
function drawBlocks(p, flash, ro) {
  foldedNow = foldOf(p);
  drawDoc(p.id, p.blocks.filter((b) => !foldedNow.has(b.id)), ro);
  drawRows(flash);
}
// each row's parts other than its words, as the notebook has the block; the folds, the numbers, the lines picked
export function drawRows(flash = null) {
  const p = page();
  if (!p) return;
  for (const n of box.children) {
    const b = blockOf(n.dataset.id);
    if (!b) continue;
    updateRow(n, b, !!p.deleted);
    if (flash && flash.has(b.id)) { n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash"); }
  }
  drawFolds(p);
  numbers(p);
  drawPicked();
}
function numbers(p) {
  const counts = new Map();
  for (const b of p.blocks) {
    const k = b.indent || 0;
    for (const d of [...counts.keys()]) if (d > k) counts.delete(d);
    if (b.type !== "number") { counts.delete(k); continue; }
    counts.set(k, (counts.get(k) || 0) + 1);
    const mk = rowOf(b.id) && rowOf(b.id).querySelector(".mk");
    if (mk) mk.textContent = `${counts.get(k)}.`;
  }
}
// -- ended work items, folded away: a page's, unless the reader shows them (the bar's "Show done", or a fold)
export let foldedNow = new Set();                        // the lines of the page shown folded away now
const doneShown = new Set();   // pages whose ended lines the reader shows
export function showDone(pid, on) {
  if (on) doneShown.add(pid); else doneShown.delete(pid);
  store.set("doneShown", [...doneShown]);
}
// The lines folded away on a page: the work items the reader ticked (`crossed`), and what is set in under one -- but
// an open work item.
export function foldOf(p) {
  const out = new Set();
  if (!p || doneShown.has(p.id)) return out;
  let under = null;
  for (const b of p.blocks) {
    const k = b.indent || 0;
    if (under !== null && k > under && !(isWork(b) && !endedOf(b))) { out.add(b.id); continue; }
    under = null;
    if (crossed(b)) { out.add(b.id); under = k; }
  }
  return out;
}
// the page as the reader sees it: its lines less those folded away (what the keys move among, and pick)
export const shown = () => { const p = page(); return p && { ...p, blocks: p.blocks.filter((b) => !foldedNow.has(b.id)) }; };
// A fold for each run of lines folded away: in the line above them (at the top: the first line shown; every line
// folded: alone), saying how many were done and canceled. A click shows them.
function drawFolds(p) {
  for (const f of box.querySelectorAll(":scope > .blk > .fold")) f.remove();
  const all = $("fold-all");
  all.hidden = true;
  if (!foldedNow.size) return;
  const runs = [];
  let prev = null, run = null;
  for (const b of p.blocks) {
    if (!foldedNow.has(b.id)) { prev = b; run = null; continue; }
    if (!run) { run = { after: prev, items: [] }; runs.push(run); }
    run.items.push(b);
  }
  const first = p.blocks.find((b) => !foldedNow.has(b.id));
  for (const r of runs) {
    const f = foldRow(p, r.items), at = r.after || first;
    const n = at && rowOf(at.id);
    if (!n) { all.replaceChildren(f); all.hidden = false; continue; }
    f.classList.toggle("top", !r.after);
    f.style.setProperty("--fi", Math.max(0, (r.items[0].indent || 0) - (at.indent || 0)));
    n.append(f);
  }
}
function foldRow(p, items) {
  const d = items.filter((b) => endedOf(b) === "done").length, c = items.filter((b) => endedOf(b) === "canceled").length;
  const said = [d ? `${d} done` : "", c ? `${c} canceled` : ""].filter(Boolean).join(" · ") || `${items.length} folded`;
  return el("div", { class: "fold", contenteditable: "false" }, el("button", { type: "button", title: "Show done and canceled lines", "aria-label": `Show ${said}`,
    onclick: () => { showDone(p.id, true); drawPage(); } }, el("span", { html: SVG.check }), el("span", { text: said })));
}
function drawDoneBtn(p) {
  const btn = $("done-btn"), n = p && !p.deleted ? p.blocks.filter(crossed).length : 0;
  btn.hidden = !n;
  if (!n) return;
  const on = doneShown.has(p.id);
  btn.setAttribute("aria-pressed", String(on));
  btn.title = on ? "Hide done and canceled lines" : "Show done and canceled lines";
  btn.replaceChildren(el("span", { class: "sw", "aria-hidden": "true" }), el("span", { text: `Show done (${n})` }));
}

export function wirePage() {
  for (const id of store.get("doneShown", [])) doneShown.add(id);
  $("done-btn").addEventListener("click", () => { const p = page(); if (!p) return; showDone(p.id, !doneShown.has(p.id)); drawPage(); });
  $("fold-all").addEventListener("animationend", (ev) => ev.target.classList.remove("flash"));
  box.addEventListener("animationend", (ev) => ev.target.classList.remove("flash"));
  $("tree").addEventListener("animationend", (ev) => ev.target.classList.remove("flash"));
}
