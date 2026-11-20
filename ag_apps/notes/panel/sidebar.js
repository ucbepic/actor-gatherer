// Notes: the sidebar -- the pages' tree with the Work, Logbook and Agents pages above it, the search, the trash;
// hidden, shown and resized; pages made, put in the trash, restored and deleted for good.
import { $, el, now, plainOf, rid, SVG } from "./helpers.js";
import { book, current, pages, setCurrent, store } from "./state.js";
import { below, kidsOf, live } from "./model.js";
import { change } from "./send.js";
import { drawPage, openPage } from "./page.js";
import { item, popUp } from "./popups.js";
import { agentsEntry } from "./agents.js";
import { logEntry, workEntry } from "./work.js";

export const opened = new Set();                       // the pages shown open in the sidebar (kept in this browser)
let trashOpen = false;
export function drawSide(flash = null) {
  const tree = $("tree"), q = $("find").value.trim().toLowerCase();
  tree.replaceChildren();
  const row = (p, depth, flat = false) => {
    const kids = flat ? [] : kidsOf(p.id);
    const open = opened.has(p.id);
    const todos = p.blocks.filter((b) => b.type === "todo"), left = todos.filter((b) => !b.checked).length;
    const r = el("div", { class: `pg-row${p.id === current ? " on" : ""}`, role: "treeitem", "data-id": p.id, style: `--d:${depth}`,
      "aria-selected": String(p.id === current), ...(kids.length ? { "aria-expanded": String(open) } : {}),
      onclick: () => openPage(p.id) },
      el("button", { class: `caret${kids.length ? "" : " none"}${open ? " open" : ""}`, type: "button", tabindex: "-1",
        "aria-label": open ? "Collapse" : "Expand", html: SVG.caret,
        onclick: (ev) => { ev.stopPropagation(); fold(p.id, !open); } }),
      el("span", { class: "ic", ...(p.icon ? { text: p.icon } : { html: SVG.doc }) }),
      el("span", { class: `nm${p.title ? "" : " untitled"}`, text: p.title || "Untitled" }),
      left ? el("span", { class: "count", title: `${left} of ${todos.length} to-dos open`, text: String(left) }) : null,
      el("span", { class: "acts" },
        el("button", { type: "button", title: "Add a page inside", "aria-label": "Add a page inside", html: SVG.plus,
          onclick: (ev) => { ev.stopPropagation(); newPage(p.id); } }),
        el("button", { type: "button", title: "More", "aria-label": "More", html: SVG.more,
          onclick: (ev) => { ev.stopPropagation(); pageMenu(p, ev.currentTarget); } })));
    if (flash && flash.has(p.id)) r.classList.add("flash");
    tree.append(r);
    if (open) for (const k of kids) row(k, depth + 1);
  };
  if (!q) tree.append(workEntry(), logEntry(), agentsEntry(), ...(live().length ? [el("div", { class: "tree-hd", text: "Pages" })] : []));
  if (q) {
    const hits = live().filter((p) => (p.title || "").toLowerCase().includes(q) || p.blocks.some((b) => plainOf(b.text).toLowerCase().includes(q)));
    for (const p of hits) row(p, 0, true);
    if (!hits.length) tree.append(el("div", { class: "tree-none", text: "No results" }));
  } else {
    for (const p of kidsOf(null)) row(p, 0);
    if (!live().length) tree.append(el("div", { class: "tree-none", text: "No pages yet" }));
  }
  const binned = book.pages.filter((p) => p.deleted && p.deleted_with === p.id);
  $("trash-btn").replaceChildren(el("span", { html: SVG.trash }), el("span", { text: "Trash" }),
    binned.length ? el("span", { class: "n", text: String(binned.length) }) : "");
  $("trash-btn").setAttribute("aria-expanded", String(trashOpen));
  const trash = $("trash");
  trash.hidden = !trashOpen;
  trash.replaceChildren(...(binned.length ? binned.map((p) => el("div", { class: "trash-row" },
    el("span", { class: "nm", text: `${p.icon ? p.icon + " " : ""}${p.title || "Untitled"}`, title: "Open", onclick: () => openPage(p.id) }),
    el("button", { type: "button", title: "Restore", "aria-label": "Restore", html: SVG.restore, onclick: () => restore(p) }),
    el("button", { type: "button", title: "Delete for good", "aria-label": "Delete for good", html: SVG.x, onclick: () => purge(p) })))
    : [el("div", { class: "trash-none", text: "Nothing in the trash" })]));
}
function fold(id, open) {
  if (open) opened.add(id); else opened.delete(id);
  store.set("open", [...opened]);
  drawSide();
}
// -- the pages' list: hidden by its own button (or ⌘\), shown by the bar's, and as wide as its edge is dragged
// (both kept in this browser). Narrow, it opens over the page instead and is never kept open.
export const narrow = () => matchMedia("(max-width: 600px)").matches;
export const app = $("app"), sideEl = $("side"), sideGrip = $("side-grip");
const SIDE_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘\\" : "Ctrl+\\";
const sideShown = () => (narrow() ? app.classList.contains("side-on") : !app.classList.contains("side-off"));
function showSide(on) {
  if (narrow()) return app.classList.toggle("side-on", on);
  app.classList.toggle("side-off", !on);
  store.set("side", on);
}
const SIDE_W = 236, SIDE_MIN = 160, SIDE_MAX = 520;
const fitW = (w) => Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, w)));
function sideWidth(w) {                                // null: back to the default
  if (w === null) app.style.removeProperty("--side-w"); else app.style.setProperty("--side-w", `${fitW(w)}px`);
  sideGrip.setAttribute("aria-valuenow", w === null ? SIDE_W : fitW(w));
  return w === null ? null : fitW(w);
}

function newPage(parent) {
  const p = { id: rid(), title: "", icon: "", parent };
  change([{ op: "page.new", page: p, blocks: [{ id: rid(), type: "text", text: "", checked: false, indent: 0 }] }]);
  if (parent) { opened.add(parent); store.set("open", [...opened]); }
  openPage(p.id);
  $("title").focus();
}
function trashPage(p) {
  const gone = [p, ...below(p.id).filter((q) => !q.deleted)];
  change([{ op: "page.delete", page: p.id, at: now(), pages: gone.map((q) => q.id) }]);
  if (gone.some((q) => q.id === current)) {
    const up = p.parent && pages.get(p.parent);
    setCurrent(up && !up.deleted ? up.id : (kidsOf(null)[0] || {}).id || null);
  }
  drawSide();
  drawPage();
}
export function restore(p) {
  const back = book.pages.filter((q) => q.deleted && q.deleted_with === p.deleted_with && (q === p || below(p.id).includes(q)));
  const up = p.parent && pages.get(p.parent);
  change([{ op: "page.restore", page: p.id, pages: back.map((q) => q.id), parent: up && !up.deleted ? p.parent : null }]);
  drawSide();
  drawPage();
}
export function purge(p) {
  change([{ op: "page.purge", page: p.id, pages: [p.id, ...below(p.id).map((q) => q.id)] }]);
  if (!pages.has(current)) setCurrent((kidsOf(null)[0] || {}).id || null);
  drawSide();
  drawPage();
}
function pageMenu(p, button) {
  const row = button.closest(".pg-row");
  row.classList.add("menu-open");
  popUp(button.getBoundingClientRect(), (box) => {
    box.append(
      item({ glyph: SVG.plus, sm: true, label: "Add a page inside" }, () => newPage(p.id)),
      item({ glyph: SVG.trash, sm: true, label: "Move to trash", bad: true }, () => trashPage(p)));
  }, () => row.classList.remove("menu-open"));
}

export function wireSidebar() {
  for (const id of store.get("open", [])) opened.add(id);
  $("find").addEventListener("input", () => drawSide());
  $("trash-btn").addEventListener("click", () => { trashOpen = !trashOpen; drawSide(); });
  $("new-page").innerHTML = SVG.plus;
  $("new-page").addEventListener("click", () => newPage(null));
  $("empty-new").addEventListener("click", () => newPage(null));
  document.querySelector(".empty-mark").innerHTML = SVG.book;
  $("side-toggle").innerHTML = SVG.side;
  $("side-toggle").title = `Show sidebar (${SIDE_KEY})`;
  $("side-hide").innerHTML = SVG.hide;
  $("side-hide").title = `Hide sidebar (${SIDE_KEY})`;
  document.querySelector(".main").addEventListener("mousedown", (ev) => { if (!ev.target.closest("#side-toggle")) app.classList.remove("side-on"); });
  if (store.get("side", true) === false) app.classList.add("side-off");
  $("side-toggle").addEventListener("click", () => showSide(!sideShown()));
  $("side-hide").addEventListener("click", () => { showSide(false); $("side-toggle").focus(); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "\\" || !(ev.metaKey || ev.ctrlKey) || ev.altKey || ev.shiftKey || ev.isComposing) return;
    ev.preventDefault();
    showSide(!sideShown());
  });
  sideGrip.setAttribute("aria-valuemin", SIDE_MIN);
  sideGrip.setAttribute("aria-valuemax", SIDE_MAX);
  sideGrip.title = "Drag to resize · double-click to reset";
  sideWidth(typeof store.get("side-w", null) === "number" ? store.get("side-w", null) : null);
  sideGrip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    sideGrip.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX, w0 = sideEl.getBoundingClientRect().width;
    let w = null;
    app.classList.add("sizing");
    const move = (e) => { w = sideWidth(w0 + e.clientX - x0); };
    const up = () => {
      sideGrip.removeEventListener("pointermove", move);
      sideGrip.removeEventListener("pointerup", up);
      sideGrip.removeEventListener("pointercancel", up);
      app.classList.remove("sizing");
      if (w !== null) store.set("side-w", w);
    };
    sideGrip.addEventListener("pointermove", move);
    sideGrip.addEventListener("pointerup", up);
    sideGrip.addEventListener("pointercancel", up);
  });
  sideGrip.addEventListener("dblclick", () => { sideWidth(null); store.set("side-w", null); });
  sideGrip.addEventListener("keydown", (ev) => {
    const step = { ArrowLeft: -16, ArrowRight: 16 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    store.set("side-w", sideWidth(sideEl.getBoundingClientRect().width + step));
  });
}
