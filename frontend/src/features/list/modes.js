import { PANE, SNAPSHOT, state } from "../../core/page/state.js";
import {
  ICONS, MAC, atWork, avatarMode, el, gathererNamed, get, isShell, key, parseKey, strokeIcon,
} from "../../core/page/helpers.js";
import { loadChat, refresh, render } from "../page/data.js";
import { connect } from "../settings/panel.js";
import { markSeen, statusOf } from "./seen.js";
import {
  APP_ITEM, CTX, addInfo, openAdd, tabAt, LIST_HOST, appInfo, appTitle,
  collapsed, deleteFolder, dropFolderClosing, folderById, folderClosing, folderKey, isAppItem, isOpenFolder, itemNamed, keepTitle, listDrag, listView, markDragged, nameFolder, nameItem, pressClose, renderAgents, reopenFolder, setHidden, showFolder, takeOut, taskById,
  taskName, titleOf,
  toggleFolder, } from "./list.js";
import {
  appsSelected, cwdOf, focusedActor, isAt, pick, pickBeside,
  cardStart, cardStartPress, popButton, rowPop, savePanes, showActorsApp, } from "../layout/panes.js";
import { dismissNotice, openNotice } from "../notify/notify.js";
import { TASK_KINDS, chatAtEnd, chatToEnd, permissionVerb } from "../chat/chat.js";
import { tildePath } from "../../core/page/code.js";
import { FILE_KINDS, showKept } from "../chat/files-view.js";
import { enc } from "../history/history.js";
import { actorLogo } from "../apps/app-actors.js";
import { useSettings } from "../settings/store";
import * as prefs from "../../core/prefs";
import { buildMonitor } from "./monitor-model";
import { buildRail } from "./rail-model";
import { drawCard, drawMonitor, drawRail, drawTotals as drawTotalsIn, forget } from "./modes-mount";

// ------------------------------------------------------------------ the list folded, or over the whole page
// The list's shape, kept in this browser: "list"; folded to a rail ("folded"), the actors at work or wanting the reader
// as their avatars; or over the whole page ("full"), the monitor -- left again for the shape it came from (listFrom),
// by its button, by Esc, or by picking an actor there. Over the whole page, the panes stay under it as they are: their
// terminals not resized, nor typed into.
const LIST_KEY = "ag-dashboard-list";
let listMode = "list", listFrom = "list";
const LIST_ICONS = {
  full: "M9.75 2.25h4v4M13.75 2.25l-4.5 4.5M6.25 13.75h-4v-4M2.25 13.75l4.5-4.5",
  unfull: "M13.75 2.25l-4.5 4.5M9.25 3v3.75H13M2.25 13.75l4.5-4.5M6.75 13V9.25H3",
  fold: "M11 6l-2 2 2 2", unfold: "M9 6l2 2-2 2",
  hide: "M2.75 2.75v10.5M11 5L8 8l3 3M8 8h5.25", keep: "M2.75 2.75v10.5M8.5 5l3 3-3 3M11.5 8H5.5",
};
function setListMode(mode, keep = true) {
  if (PANE || !["list", "folded", "full"].includes(mode)) mode = "list";
  if (mode === "full" && listMode !== "full") listFrom = listMode;
  const was = listMode;
  listMode = mode;
  document.documentElement.classList.toggle("list-folded", mode === "folded");
  document.documentElement.classList.toggle("list-full", mode === "full");
  document.documentElement.classList.toggle("list-was-folded", mode === "full" && listFrom === "folded");   // the panes as wide as they were
  drawListButtons();
  if (keep) { prefs.keep(LIST_KEY, { mode, from: listFrom }); }
  if (mode === "full" && was !== "full") {          // what had the keys -- a terminal, a pane's frame -- has them no more
    const at = document.activeElement;
    if (at && at !== document.body && at.closest(".panes")) at.blur();
    document.getElementById("monitor").focus({ preventScroll: true });
  }
  if (mode !== "full") monForget();
  if (state.home) renderAgents();
}
// A column's width, dragged at its edge (grip): set as node's prop, at least min (its most: the stylesheet's
// max), kept under key; at(x) is the width the pointer at x gives. A double click: the stylesheet's width again.
function widthGrip(grip, key, node, prop, min, at) {
  const set = (w) => w > 0 ? node.style.setProperty(prop, `${Math.round(Math.max(min, w))}px`) : node.style.removeProperty(prop);
  set(Number(prefs.text(key)));
  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    const box = document.getElementById("panes");
    grip.classList.add("on"); box.classList.add("resizing");   // the frames let the pointer by while it drags
    const move = (e) => set(at(e.clientX));
    const up = () => {
      grip.classList.remove("on"); box.classList.remove("resizing");
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
      prefs.setText(key, String(parseInt(node.style.getPropertyValue(prop)) || ""));
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => { set(0); prefs.drop(key); });
}
// the folded rail's own width (--rail-w), its right edge dragged as the list's is: 76px at the least, 360px at the most
const RAIL_GRIP = el("div", { class: "rail-grip", "aria-hidden": "true", title: "Drag to resize · double-click to reset" });
// its buttons, as the list is: folded (or open again), and hidden (or kept open); none over the whole page
function listButtons() {
  const full = listMode === "full", folded = listMode === "folded";
  const fold = folded ? "Open the list" : "Fold the list";
  return [full ? null : el("button", { class: "list-btn lb-fold", type: "button", "aria-expanded": folded ? "false" : "true", title: fold,
      "aria-label": fold, onclick: () => setListMode(folded ? "list" : "folded") },
      strokeIcon(ICONS.sidebar + (folded ? LIST_ICONS.unfold : LIST_ICONS.fold))),
    full || PANE ? null : el("button", { class: "list-btn lb-hide", type: "button", "aria-pressed": listHidden ? "true" : "false",
      title: listHidden ? "Keep the list open" : "Hide the list · hover the left edge to show it",
      "aria-label": listHidden ? "Keep the list open" : "Hide the list", onclick: () => setListHidden(!listHidden) },
      strokeIcon(listHidden ? LIST_ICONS.keep : LIST_ICONS.hide))];
}
// THE LIST HIDDEN (its button; kept in this browser), whatever its shape (the list, the rail): out of the way at once,
// the panes the page's whole width, a thin edge at the page's left. The pointer on that edge, or on the top bar's counts
// (#top-totals, drawTotals: what the list is for; or the keys in the list), it slides out over the panes, and stays
// while the pointer is on it -- still or moving -- or on those counts, a menu or card of it, a name is typed in it or a
// row dragged from it; it slides back a moment after the pointer has left (the counts too: a moment to get from them
// down to the list, though the rail is narrower than where they sit). Where the pointer
// is, is asked of the page at its last place (elementFromPoint): a list slid in under a still pointer is under it,
// though the browser's own hover may not say so till it moves -- and a pointer over a pane's frame moves unseen.
const HIDE_KEY = "ag-dashboard-list-hidden", UNPEEK_MS = 300;
let listHidden = false, peekTimer = null;
const pointerAt = { x: -1, y: -1 };
function setListHidden(on, keep = true) {
  listHidden = !!on && !PANE;
  document.documentElement.classList.toggle("list-hidden", listHidden);
  peekList(false);                                   // pressed to hide it: hidden now, out again at the edge
  drawListButtons();
  if (keep) { prefs.setText(HIDE_KEY, listHidden ? "1" : ""); }
}
function peekList(on) {
  clearTimeout(peekTimer);
  const was = document.documentElement.classList.contains("list-peek");
  document.documentElement.classList.toggle("list-peek", on && listHidden);
  // out over the panes, it floats over them (features/apps/native.ts): a Browser's own page under it, in the ag app,
  // pictured in its place from the first frame it is over any of it
  document.querySelector(".side").classList.toggle("floats", on && listHidden);
  if (on && listHidden && !was) unpeekSoon();        // (left again at once, never come onto it: back too)
}
// in use: the pointer on it (or a menu or card of it), a name typed in it, a row dragged from it
function listInUse() {
  if (listDrag || document.querySelector(".row-menu, .side :is(input, textarea, [contenteditable]):focus")) return true;
  const at = pointerAt.x < 0 ? null : document.elementFromPoint(pointerAt.x, pointerAt.y);
  return !!(at && at.closest(".side, .list-edge, #top-totals, .row-menu, #actor-card"));
}
function unpeekSoon() {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { if (listInUse()) unpeekSoon(); else peekList(false); }, UNPEEK_MS);
}
// every actor over the whole page (or back): in the top bar, by the logo and the counts it shows in full
function fullButton() {
  const full = listMode === "full";
  return el("button", { class: "list-btn lb-full", type: "button", "aria-pressed": full ? "true" : "false",
    title: full ? "Back to the list (Esc)" : "Show every actor full screen",
    "aria-label": full ? "Leave full screen" : "Full screen", onclick: () => full ? leaveFull() : setListMode("full") },
    strokeIcon(full ? LIST_ICONS.unfull : LIST_ICONS.full));
}
function drawListButtons() {
  document.getElementById("list-btns").replaceChildren(...listButtons().filter(Boolean));
  document.getElementById("top-full").replaceChildren(fullButton());
}
const leaveFull = () => setListMode(listFrom === "full" ? "list" : listFrom);
// The list in the shape it is in: the rail, or the monitor, drawn from the home (the list itself is drawn all the same).
function renderFolded() {
  if (listMode === "folded") renderRail();
  else if (listMode === "full") renderMonitor();
  if (hover.from === "rail" && listMode !== "folded") cardHide();
}
// The rail: the list, small (features/list/Rail.tsx, from rail-model.ts's model). Each gatherer not hidden, its name over
// its actors -- a button folding it, as the list's does; hovered, its card has its buttons (gathererCard) -- then its box
// as the list has it: its folders folded to their names and counts, or open in place; its saved and closed lines, as the
// reader checks at its foot (railShow); its actors' tiles. A double-click on a gatherer's or folder's name shows only it
// (railDrill). Dragged (every selected one with it) onto a folder's name, a gatherer's, the name drilled into or a step
// of the path over it, an actor moves there (railDragged).
// The rail drilled into a gatherer or a folder: only the tree from there, under "Up" and "Root". `railAt`: {g, f} (a
// gatherer's name, a folder's id; f null: the gatherer's top), or null: every gatherer. Kept across reloads; gone (a
// folder deleted, a gatherer hidden): its gatherer's top, or every gatherer.
const RAIL_AT_KEY = "ag-dashboard-rail-at";
let railAt = (() => {
  const v = prefs.json(RAIL_AT_KEY);
  if (v && v.at && typeof v.at.g === "string") return v.at;
  return null;
})();
let railMoved = false;                                // stepped in or out: the rail drawn from its top
const sameAt = (x, y) => (!x && !y) || (!!x && !!y && x.g === y.g && x.f === y.f);
function railGo(at) {
  railAt = at; railMoved = true;
  prefs.keep(RAIL_AT_KEY, { at: railAt });
  cardHide(); renderRail();
}
const railDrill = (at) => { if (!sameAt(at, railAt)) railGo(at); };
// In the page's top bar, beside its logo, whatever shape the list is in: every shown group's actors open, counted by what
// they do (features/list/Totals.tsx draws them; `t`, features/list/groups.ts's totals, the list's view-model's). The whole
// home's, wherever the list or the rail is, so what needs the reader elsewhere still shows.
const drawTotals = (t) => drawTotalsIn(document.getElementById("top-totals"), t);
// The rail shows only what the reader checks at its foot, over every gatherer and drilled in alike, kept in this
// browser, each unchecked at first: "folders" -- unchecked, only the folders with an actor not closed in them, at any
// depth; "saved", "closed" -- their lines (unchecked, none: only those of them open in a pane, in view).
const RAIL_SHOW_KEY = "ag-dashboard-rail-show";
const railShow = (() => {
  const v = { folders: false, saved: false, closed: false };
  const k = prefs.json(RAIL_SHOW_KEY) || {};
  for (const n of Object.keys(v)) v[n] = k[n] === true;
  return v;
})();
function setRailShow(what, on) {
  railShow[what] = on;
  prefs.keep(RAIL_SHOW_KEY, railShow);
  renderRail();
}
// A busy folder (an actor not closed in it) is open in the rail unless the reader folded it there (busyFolded, kept in
// this browser) -- forgotten once it is busy no more, so it opens again the next time; any other folder open or not as
// the list has it.
const BUSY_FOLDED_KEY = "ag-dashboard-rail-busy-folded";
const busyFolded = (() => {
  { const v = prefs.list(BUSY_FOLDED_KEY); if (v) return new Set(v); }
  return new Set();
})();
const keepBusyFolded = () => { prefs.keep(BUSY_FOLDED_KEY, [...busyFolded]); };
const railOpen = (gname, id, busy) => busy ? !busyFolded.has(folderKey(gname, id)) : isOpenFolder(gname, id);
function railFold(gname, id, busy) {
  if (!busy) return toggleFolder(gname, id);
  const k = folderKey(gname, id);
  if (busyFolded.has(k)) busyFolded.delete(k); else busyFolded.add(k);
  keepBusyFolded(); renderAgents();
}
// what the rail calls of the page (features/list/Rail.tsx's RailHost): the list's own, and the rail's
let railHost = null;
const RAIL_HOST = () => railHost ??= { ...LIST_HOST, ctx: CTX, railGo, railDrill, railFold, setRailShow,
  railSpring: (gname, id, busy) => { if (!railOpen(gname, id, busy)) railFold(gname, id, busy); } };
function renderRail() {
  const rail = document.getElementById("rail");
  const m = buildRail(CTX, listView(), { show: { ...railShow }, busyFolded, at: railAt, dragging: listDrag ? listDrag.g : null });
  if (m.forget.length) { for (const k of m.forget) busyFolded.delete(k); keepBusyFolded(); }   // busy no more
  drawRail(rail, m, RAIL_HOST());
  const list = rail.querySelector(".r-actors");
  if (railMoved && list) { list.scrollTop = 0; list.scrollLeft = 0; }
  railMoved = false;
  markDragged();                                     // drawn mid-drag: what is dragged, still shown as it
  if (hover.from === "rail") cardDraw();
}
// An actor dragged from the rail (dragRow, startDrag): the rail drawn again with every folder of its gatherer -- those
// the foot's "folders" leaves out too, folded -- so it can be dropped in one (renderRail's view); as it was once the
// drag is over (endDrag, `revealed`). Drawn next, not now: the browser takes what is dragged's picture first.
function railDragged() {
  if (listMode !== "folded" || railShow.folders) return;
  setTimeout(() => {
    if (!listDrag || listMode !== "folded") return;
    listDrag.revealed = true;
    renderRail();
  }, 0);
}
// The card an actor shows while hovered, in the rail or the list (or in focus from the keys): its avatar and name, its
// gatherer and harness, its directory, its status, when it last did something and its size, what it was last asked
// (under its name, if it has one), its recap, what runs in the background, its branch. Beside the rail or the list (under
// the actor, where there is no room beside: the rail across a phone's top, the list as wide as the page), level with the
// actor, inside the window; the pointer passes through it (but a live card's: cardLive). It waits a moment the first
// time (HOVER_WAIT), then follows
// the pointer from actor to actor at once; none over an actor's own buttons, which say what they do. Kept by where it
// came from and the actor's key (data-card): the rail or the list drawn again under it, the card is said again from the
// new data, at the actor's new place. Where there is no hovering (a touch screen), the actor's title says it instead.
const HOVERS = matchMedia("(hover: hover)");
const HOVER_WAIT = 250, hover = { from: null, key: null, shown: false, timer: null, node: null, keys: false, still: null };
const HOVER_FROM = { rail: () => listMode === "folded", agents: () => listMode === "list" };
function hoverTo(from, k) {
  clearTimeout(hover.timer);
  if (!k) { hover.timer = setTimeout(cardLetGo, cardLive() ? 300 : 120); return; }
  if (k === hover.key && from === hover.from && hover.shown) return;
  const go = () => { hover.from = from; hover.key = k; hover.shown = true; cardDraw(); };
  // a live card shown: the pointer, on its way to it, may cross another item -- switched only once it lingers there
  // (CARD_ON_THE_WAY), the card's own pointerenter keeping it
  if (hover.shown && cardLive()) hover.timer = setTimeout(go, CARD_ON_THE_WAY);
  else if (hover.shown) go(); else hover.timer = setTimeout(go, HOVER_WAIT);
}
const CARD_ON_THE_WAY = 250;
// `ev`, the click that put it away: no card again until the pointer moves from where that was (`still`) -- the list
// drawn again under a pointer at rest is a pointerover there, which would bring a task's live card back over the panels
// the click opened, for as long as the pointer rests
function cardHide(ev = null) {
  clearTimeout(hover.timer);
  if (ev && "clientX" in ev) hover.still = [ev.clientX, ev.clientY];
  hover.from = null; hover.key = null; hover.shown = false;
  cardEdit = null;
  dropFolderClosing("card");
  if (hover.node) hover.node.hidden = true;
}
// A LIVE card -- a folder's or a gatherer's, in the rail -- is one to use, not only read: the pointer may go onto it,
// and it stays while the pointer, a menu opened from it, or its name box is on it, or something starts (cardLetGo); its buttons do what the
// list's do on the folder's line or the gatherer's row, its name box names there (cardEdit), and a click on one of its
// actors shows it.
const cardLive = () => !!hover.node && !hover.node.hidden && hover.node.classList.contains("live");
function cardLetGo() {
  const card = hover.node;
  if (cardLive() && state.starting) { hover.timer = setTimeout(cardLetGo, 300); return; }   // what it started: its answer, first
  if (cardLive() && (card.matches(":hover") || ((cardEdit || folderClosing) && card.contains(document.activeElement))
    || (rowPop.el && card.contains(popButton())))) return;
  cardHide();
}
// a menu opened from the card closed: the card let go of too, once the pointer is not on it
function cardRelease() { if (cardLive() && !hover.node.matches(":hover")) hoverTo(hover.from, null); }
function cardDraw() {
  const box = hover.from && document.getElementById(hover.from);
  const at = box && [...box.querySelectorAll("[data-card]")].find((n) => n.dataset.card === hover.key);
  const { group: gname, id: channel } = parseKey(hover.key);
  const g = gathererNamed(gname), a = g && g.agents.find((x) => x.channel === channel);
  const f = g && !a && /^folder:\d+$/.test(channel || "") ? folderById(g.name, Number(channel.slice(7))) : null;
  const t = g && !a && /^task:\d+$/.test(channel || "") ? taskById(g.name, Number(channel.slice(5))) : null;
  const o = g && !a && isAppItem(channel) ? appInfo(g.name, channel.slice(APP_ITEM.length)) : null;
  const top = !!g && !a && channel === "gatherer:";
  if (!at || !(a || f || t || o || top) || !HOVER_FROM[hover.from]()) { cardHide(); return; }
  if (!hover.node) {
    hover.node = el("div", { class: "actor-card floats", id: "actor-card", role: "tooltip" });   // (floats: over a native page, it covers it -- apps/native.ts)
    hover.node.addEventListener("pointerenter", () => clearTimeout(hover.timer));
    hover.node.addEventListener("pointerleave", () => { if (cardLive()) hoverTo(hover.from, null); });
    document.body.append(hover.node);
  }
  // a task's: in the list too -- but one shown by the keys (a row in focus) only read, the pointer passing through it: its
  // buttons are the pointer's, and one put over the panels (focus given back to the row, Esc closing a menu) would take
  // the next click meant for what is under it
  const card = hover.node, live = !SNAPSHOT && !hover.keys && (!!t || !!o || (hover.from === "rail" && (!!f || top)));
  card.classList.toggle("live", live);
  card.setAttribute("role", live ? "group" : "tooltip");
  if (live) card.setAttribute("aria-label", t ? `The task ${taskName(g, t)}` : o ? `The app ${appTitle(o)}` : f ? `The folder ${f.name}` : `The group ${titleOf(g)}`);
  else card.removeAttribute("aria-label");
  if (cardOpen.key !== hover.key) cardOpen = { key: hover.key, ids: new Set() };   // another card: its tree as it starts
  const asking = !!f && !!folderClosing && folderClosing.from === "card" && folderClosing.g === g.name && folderClosing.id === f.id;
  const what = t ? { kind: "task", g, t } : o ? { kind: "app", g, o }
    : f ? { kind: "folder", g, f, live, opened: cardOpen.ids, asking, here: sameAt(railAt, { g: g.name, f: f.id }) }
    : top ? { kind: "gatherer", g, here: sameAt(railAt, { g: g.name, f: null }), folded: collapsed.has(g.name) }
    : { kind: "actor", g, a, shown: hover.from === "agents" && isAt(focusedActor(), g.name, a.channel) };
  cardDrawing = true;
  try { drawCard(card, { what, edit: cardEdit && cardEdit.g === g.name && cardEdit.key === hover.key ? cardEdit : null }, CARD_HOST()); }
  finally { cardDrawing = false; }
  card.hidden = false;
  at.setAttribute("aria-describedby", "actor-card");
  const r = at.getBoundingClientRect(), side = box.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  if (side.width > side.height || side.right + 8 + w > innerWidth) {      // no room beside it: under the actor
    card.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
    card.style.top = `${clamp(hover.from === "rail" ? side.bottom + 6 : r.bottom + 4, 8, innerHeight - h - 8)}px`;
  } else {
    card.style.left = `${side.right + 8}px`;
    card.style.top = `${clamp(r.top + r.height / 2 - h / 2, 8, innerHeight - h - 8)}px`;
  }
}
// What is in a card (features/list/Card.tsx, CardFolder.tsx): an actor's, a task's and an app's -- live in the list and
// the rail: their items each a button, an app's notifications -- a folder's (live in the rail: its buttons as its line's
// in the list, its tree opened in place by a click, `cardOpen`, for as long as the card shows that folder) and a
// gatherer's. What a press on it does is the page's (CARD_HOST).
let cardOpen = { key: null, ids: new Set() };
// The card's name box: a folder named or made (`cardEdit`: {g, id -- null, made in `parent` -- parent}), the gatherer
// renamed ({g, gatherer: true}), or a task or an app ({g, item}: features/list/list.js's itemNamed), as the list's own
// box does, which is out of sight with the list folded -- in the card it was opened in only (its `key`), each a box of
// its own (`n`). Enter, or leaving it, keeps what is typed; Esc, or nothing typed, leaves it. One the card's own draw
// takes away (the card is another's now) is not left by the reader (`cardDrawing`): kept, for the card again.
let cardEdit = null, cardEdits = 0, cardDrawing = false;
function editInCard(edit) {
  const g = gathererNamed(edit.g);
  const item = edit.item && g ? itemNamed(g, edit.item) : null;
  if (edit.item && !item) return;
  cardEdit = { ...edit, n: ++cardEdits, key: hover.key, ...(item ? { kind: item[0], auto: item[3] } : {}),
    value: item ? item[2] : edit.gatherer ? (g ? titleOf(g) : edit.g) : edit.id !== null && edit.id !== undefined ? (folderById(edit.g, edit.id) || {}).name || "" : "" };
  cardDraw();                                        // its box focused as it opens, all of it selected
}
function endCardEdit(keep) {
  const e = cardEdit;
  if (!e) return;
  cardEdit = null;
  if (keep && e.item) nameItem(e.g, e.item, e.value);
  else if (keep && e.gatherer) {
    const g = gathererNamed(e.g), text = e.value.replace(/\s+/g, " ").trim();
    if (g && text !== titleOf(g)) keepTitle(e.g, text);
  } else if (keep) nameFolder(e.g, e.id ?? null, e.parent ?? null, e.value);
  if (hover.node && !hover.node.hidden) cardDraw();
}
// what a card calls of the page (features/list/Card.tsx's CardHost)
let cardHost = null;
const CARD_HOST = () => cardHost ??= { ...LIST_HOST, ctx: CTX, tabAt, cwdOf, tilde: (p) => tildePath(p, state.home.home_dir),
  actorLogo, cardHide, takeOut, openNotice, dismissNotice, adds: addInfo, openAdd,
  startInfo: cardStart, startPress: cardStartPress,
  editIn: editInCard, editEnd: endCardEdit, editTyped: (v) => { if (cardEdit) cardEdit.value = v; },
  editBlur: (e) => { if (!cardDrawing && document.hasFocus() && cardEdit === e) endCardEdit(true); },
  deleteFolder, reopenFolder, setHidden, railDrill, pressClose: (g, f) => pressClose(g, f, "card"),
  openInRail: (gname, id) => { showFolder(gname, id, true); renderAgents(); },
  treeToggle: (id) => { if (cardOpen.ids.has(id)) cardOpen.ids.delete(id); else cardOpen.ids.add(id); cardDraw(); },
  closeGo: (g, f) => { cardHide(); LIST_HOST.closeFolderGo(g, f); },
  closeCancel: () => { dropFolderClosing("card"); cardDraw(); },
  // the focus gone from its question (a click elsewhere): taken back, the card let go of once the pointer is off it
  askOut: (ev) => {
    if (cardDrawing || (ev.relatedTarget && hover.node && hover.node.contains(ev.relatedTarget))) return;
    setTimeout(() => {
      if (!folderClosing || folderClosing.from !== "card" || (hover.node && hover.node.contains(document.activeElement))) return;
      dropFolderClosing("card");
      if (cardLive() && !hover.node.matches(":hover")) cardHide(); else cardDraw();
    }, 0);
  } };
// The monitor: every actor of the gatherers not hidden, a column for each group of the list that has any, side by side,
// Saved and Closed folded to a strip until opened, each column's fold kept in this browser -- and in each, a card for each
// actor (features/list/Monitor.tsx, from monitor.ts's model). What its turn did is read from the server (monitor.py) for
// the cards in view, again when the actor changes (monSig), at most every MON_GAP ms. A card is drawn again only where
// it changed, so an actor at work goes on as it was (its stage, its glyphs: on the page's clock).
const MON_FOLD_KEY = "ag-dashboard-monitor-folded", MON_GAP = 1000, MON_BATCH = 24;
const monFolded = (() => {
  { const v = prefs.list(MON_FOLD_KEY); if (v) return new Set(v); }
  return new Set(["Saved", "Closed"]);
})();
const mon = { got: new Map(), visible: new Set(), timer: null, busy: false, last: -Infinity, seen: null,
  old: false };                                    // old: the server started before the monitor was, and has no /api/monitor
const monSig = (a) => `${a.last}|${a.events}|${statusOf(a)[0]}`;
function monForget() {                                 // left: nothing in view; what was read stays, for coming back
  forget(document.getElementById("monitor"));
  if (mon.seen) mon.seen.disconnect();
  mon.seen = null; mon.visible.clear();
}
function foldSection(name) {
  if (monFolded.has(name)) monFolded.delete(name); else monFolded.add(name);
  prefs.keep(MON_FOLD_KEY, [...monFolded]);
  renderMonitor();
}
// what the monitor calls of the page (features/list/Monitor.tsx's MonitorHost): made once, so its cards are drawn again
// only when what they show changes
let monHost = null;
const MON_HOST = () => monHost ??= { ...LIST_HOST, ctx: CTX, folderIcon: ICONS.folder,
  observe: (n) => { if (mon.seen) mon.seen.observe(n); },
  unobserve: (n, k) => { if (mon.seen) mon.seen.unobserve(n); mon.visible.delete(k); },
  foldSection,
  show: (g, a, ev) => { leaveFull(); pick(g.name, a.channel, ev); },
  showBeside: (g, a, ev) => { if (MAC && ev.ctrlKey && !SNAPSHOT) leaveFull(); pickBeside(g.name, a.channel, ev); },
  atWork, permissionVerb, taskKind: (k) => TASK_KINDS[k] || k, fileKinds: FILE_KINDS };
function renderMonitor() {
  if (listMode !== "full" || !state.home) return;
  if (!SNAPSHOT && !mon.seen && "IntersectionObserver" in window)
    mon.seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) mon.visible.add(e.target.dataset.key); else mon.visible.delete(e.target.dataset.key);
      monFetch();
    }, { rootMargin: "200px 0px" });               // the page's: each column scrolls on its own
  drawMonitor(document.getElementById("monitor"),
    buildMonitor(CTX, listView(), { folded: monFolded, got: mon.got, old: mon.old, avatarMode }), MON_HOST());
  monFetch();
}
// What each card in view shows of its actor's turn, read for those changed since (MON_BATCH at a time).
function monFetch(soon = 150) {
  if (SNAPSHOT || listMode !== "full" || mon.timer || mon.busy) return;
  mon.timer = setTimeout(monLoad, Math.max(soon, MON_GAP - (performance.now() - mon.last)));
}
async function monLoad() {
  mon.timer = null;
  if (listMode !== "full" || !state.home) return;
  const stale = [];
  for (const g of state.home.gatherers) for (const a of g.agents) {
    const k = key(g.name, a.channel), had = mon.got.get(k);
    if (mon.visible.has(k) && (!had || had.sig !== monSig(a))) stale.push({ k, sig: monSig(a), ask: [g.name, a.channel, a.cwd || null] });
  }
  if (!stale.length) return;
  const batch = stale.slice(0, MON_BATCH);
  mon.busy = true; mon.last = performance.now();
  try {
    const got = await get(`/api/monitor?actors=${enc(JSON.stringify(batch.map((b) => b.ask)))}`);
    batch.forEach((b, i) => { const d = (got.actors || [])[i]; mon.got.set(b.k, { sig: b.sig, data: d && !d.error ? d : null }); });
    mon.old = false;
  } catch (e) {
    if (/: 404$/.test(e.message)) mon.old = true;
    for (const b of batch) mon.got.set(b.k, { sig: b.sig, data: (mon.got.get(b.k) || {}).data || null });   // tried again once it changes
  } finally { mon.busy = false; }
  renderMonitor();
  if (stale.length > batch.length) monFetch(0);
}
// Where each gatherer's actors were put when the list was last drawn: channel -> place, top first.
// So that a row moved by a change (an actor closed into its fold, a folder opened above it) does not jump to its new
// place, each row, group heading and gatherer is keyed (data-key) -- React keeps it the same element from one draw to
// the next (features/list/AgentList.tsx) -- its place and status taken before the list is drawn again (listPlaces), and
// after it (slideList) set back where it was and moved to where it is now. An actor whose status changed, and so its
// group, slides over the others; one new to the list fades in; its status dot grows into its new state. None of it
// for a reader who asks for less motion.
function listPlaces(root) {
  const places = new Map();
  for (const n of root.querySelectorAll("[data-key]")) {
    const dot = n.querySelector(":scope > .dot");
    places.set(n.dataset.key, { top: n.getBoundingClientRect().top, status: dot && dot.getAttribute("aria-label"), group: n.dataset.group });
  }
  return places;
}
function slideList(root, was) {
  if (!was.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const side = getComputedStyle(root).backgroundColor;
  for (const n of root.querySelectorAll("[data-key]")) {
    const before = was.get(n.dataset.key);
    if (!before) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" }); continue; }
    const dot = n.querySelector(":scope > .dot"), changed = dot && before.status && dot.getAttribute("aria-label") !== before.status;
    const regrouped = changed || (before.group && n.dataset.group !== before.group);
    const dy = before.top - n.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) {
      const frames = [{ transform: `translateY(${dy}px)` }, { transform: "none" }];
      if (regrouped) {     // past the rows between: over them, on the list's own background if it has none
        n.style.position = "relative"; n.style.zIndex = "1";
        const bg = getComputedStyle(n).backgroundColor;
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") { frames[0].backgroundColor = side; frames[1].backgroundColor = side; }
      }
      n.animate(frames, { duration: 380, easing: "cubic-bezier(.2, .8, .2, 1)" }).onfinish = () => { n.style.position = n.style.zIndex = ""; };
    }
    if (changed)
      dot.animate([{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, delay: 120, easing: "ease-out", fill: "backwards" });
  }
}
// Selecting an actor draws its chat as soon as it is loaded; its calls and context (the details) follow
// on the stream, which starts with them. The actor list is the stream's already.
async function select(g, c) {
  state.selected = [g, c]; state.readId = null; state.followLatest = true; state.context = null; state.agent = null;
  state.agentVersion = (state.agentVersion || 0) + 1;
  markSeen();
  savePanes();
  if (!PANE) { appsSelected(); showActorsApp(g, c); }   // an app's actor: its app's panel above it (features/apps/app-actors.js)
  if (SNAPSHOT || state.paused) { await refresh(true); chatToEnd(); return; }
  const kept = !isShell(c) && showKept(g, c);        // shown before: drawn at once as it was, dimmed until brought up to date
  connect();
  const main = document.getElementById("main");
  main.classList.add("stale");
  render(true);                                      // else drawn loading: not the actor shown before, as if this one
  if (kept) chatToEnd();
  try { await loadChat(); } finally { main.classList.remove("stale"); }
  if (state.selected[0] === g && state.selected[1] === c) {
    const end = !kept || chatAtEnd();                // drawn already: the reader's place kept, should they have moved it
    render(true);
    if (end) chatToEnd();
  }
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  widthGrip(document.getElementById("side-grip"), "ag-dashboard-side-width", document.documentElement, "--side-w", 200,
    (x) => x - document.querySelector(".side").getBoundingClientRect().left);
  document.querySelector(".side").append(RAIL_GRIP);
  widthGrip(RAIL_GRIP, "ag-dashboard-rail-width", document.documentElement, "--rail-w", 76,
    (x) => Math.min(360, x - document.querySelector(".side").getBoundingClientRect().left));
  if (!PANE && !SNAPSHOT) {
    const side = document.querySelector(".side"), edge = el("div", { class: "list-edge", "aria-hidden": "true" });
    side.after(edge);
    const at = (ev) => { pointerAt.x = ev.clientX; pointerAt.y = ev.clientY; };
    document.addEventListener("pointermove", at, { capture: true, passive: true });
    edge.addEventListener("pointerenter", (ev) => { at(ev); peekList(true); });
    edge.addEventListener("pointermove", (ev) => { at(ev); if (!document.documentElement.classList.contains("list-peek")) peekList(true); });
    side.addEventListener("pointerleave", (ev) => { at(ev); if (listHidden) unpeekSoon(); });   // (onto a frame: its last place)
    side.addEventListener("focusin", () => peekList(true));
    side.addEventListener("focusout", () => { if (listHidden) unpeekSoon(); });
    // the counts at the top: out as at the edge (over the whole page, there is nothing to slide out)
    const totals = document.getElementById("top-totals");
    const peekHere = (ev) => { at(ev); if (listHidden && listMode !== "full" && !document.documentElement.classList.contains("list-peek")) peekList(true); };
    totals.addEventListener("pointerenter", peekHere);
    totals.addEventListener("pointermove", peekHere);
    totals.addEventListener("pointerleave", (ev) => { at(ev); if (listHidden) unpeekSoon(); });
    listHidden = prefs.flag(HIDE_KEY);
    const root = document.documentElement;
    root.classList.add("list-still");                  // the page opened with it hidden: hidden, not sliding away
    root.classList.toggle("list-hidden", listHidden);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("list-still")));
  }
  document.addEventListener("keydown", (ev) => {        // first: Esc closes the settings first, if they are open
    if (ev.key !== "Escape" || listMode !== "full" || !document.getElementById("about").hidden || useSettings.getState().file.open) return;
    ev.preventDefault();
    leaveFull();
  }, true);
  for (const from of Object.keys(HOVER_FROM)) {
    const box = document.getElementById(from);
    box.addEventListener("pointerover", (ev) => {
      if (ev.pointerType === "touch") return;
      // at rest where a click put the card away (a few pixels: a click's place and a pointer event's are not given alike)
      if (hover.still && Math.abs(ev.clientX - hover.still[0]) < 4 && Math.abs(ev.clientY - hover.still[1]) < 4) return;
      hover.still = null;
      hover.keys = false;
      const at = ev.target.closest("[data-card]");
      hoverTo(from, at && !ev.target.closest(".save-btn, .close-btn, .branchline, .f-acts, .pick") ? at.dataset.card : null);
    });
    box.addEventListener("pointerleave", () => { hover.still = null; hoverTo(from, null); });   // gone and back: a card again
    box.addEventListener("focusin", (ev) => {
      const at = ev.target.closest("[data-card]");
      if (at && ev.target === at && at.matches(":focus-visible")) { hover.shown = true; hover.keys = true; hoverTo(from, at.dataset.card); }
    });
    box.addEventListener("focusout", () => hoverTo(from, null));
    box.addEventListener("scroll", () => { if (hover.shown && hover.from === from) cardDraw(); }, true);   // kept level with its actor
  }
  addEventListener("resize", () => { if (hover.shown) cardDraw(); });
  (() => {                                           // as the reader left it: over the whole page, from where it came
    const v = prefs.json(LIST_KEY);
    if (v && (v.from === "list" || v.from === "folded")) listMode = v.from;
    setListMode(v && v.mode, false);
  })();
}
export {
  HOVERS, cardDraw, cardHide, cardLive, cardRelease, drawTotals, hover, listButtons, listMode, listPlaces,
  railDragged, renderFolded, select, setListMode, slideList,
};
