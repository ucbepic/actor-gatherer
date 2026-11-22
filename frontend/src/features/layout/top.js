import { SNAPSHOT, panes } from "../../core/page/state.js";
import {
  ICONS, bareAvatar, doneCheck, el, restDelay, shellOf, shellPath, signature, strokeIcon,
} from "../../core/page/helpers.js";
import { loadChat } from "../page/data.js";
import { markSeen, statusOf } from "../list/seen.js";
import { placeIfShown, placeWork, workPlacer } from "./panes.js";
import { drawPane } from "../page/main-view.js";
import { chatToEnd } from "../chat/chat.js";
import { miniCard, miniHistory, miniRest } from "../chat/mini-history.js";
import { chatOf, showTurn } from "../chat/actors";
import { allPanes } from "../page/pane-view.js";
import * as prefs from "../../core/prefs";

// ------------------------------------------------------------------ the top row, as the actors' panes see it
// Above the panes, the apps' panels (features/layout/panes.js's top row): whether it shows any (topShown), and each pane's chat
// minimized under what is above it.
const topShown = () => !!(panes.apps && panes.apps.some((p) => !p.held));
// Drawn with a pane's view: the work area placed again if what it shows changed (another actor shown in a pane:
// features/layout/panes.js's placeIfShown).
function topMount() {
  if (SNAPSHOT) return;
  placeIfShown();
}
// A panel opened or closed in the top row: each pane drawn again (its head put in its Chat bar, or not).
let topWas = null;
function topChanged() {
  if (SNAPSHOT) return;
  placeWork();
  markSeen();                                        // an app's panel shown: its notifications seen
  const now = topShown();
  if (now === topWas) { for (const p of allPanes()) drawPane(p); return; }
  topWas = now;
  for (const p of allPanes()) minRedraw(p);
}
// A pane MINIMIZED, each on its own (features/layout/work.ts): only its message box, right of it the conversation's last two
// lines -- the actor's avatar, small and still, on its own (features/chat/mini-history.js) -- and its ×; what is above or below it the
// rest. Offered where something of its task is above or below it; kept in its task's arrangement (the tab shown), so it is
// minimized again there; moved where nothing is, shown whole.
const MIN_TIP = "Minimize chat";
const chatMin = (p) => !SNAPSHOT && !!p && !!workPlacer && workPlacer.isMin(p.node);
const canMinimize = (p) => !SNAPSHOT && !!p && !chatMin(p) && !!workPlacer && workPlacer.canMin(p.node);
function setChatMin(p, on) {
  if (workPlacer) workPlacer.setMin(p.node, on);    // drawn so as it is placed (minChanged, features/layout/panes.js)
}
// Pane `p` minimized or shown again: drawn so at once, with what it has -- not once its feed has loaded, which a busy
// page or server can hold up for seconds, the pane placed whole meanwhile with its minimized strip in it -- then again
// once loaded: its counts are the latest turn's, from the files' feed (chatFeed) -- then, shown again, its view's own feed.
async function minRedraw(p) {
  if (chatMin(p) && p.files && chatOf(p.files.key).picked !== null) showTurn(p.files.key, null);
  topMount();
  drawPane(p);
  await loadChat(p);
  drawPane(p);
  if (!chatMin(p)) chatToEnd(p);
}
// The view a minimized pane draws in place of its own (chatCard): no conversation, the message box, and miniFoot.
const MINI_VIEW = { id: "mini", name: "Chat", feed: "files", mini: true, background: false, queued: false, greets: true,
  render: () => [], footer: (ctx) => miniFoot(ctx) };
// the way back, at a minimized terminal's left (an actor's has none: its lines, or its avatar, pressed, are)
const miniBack = (p) => el("button", { type: "button", class: "mini-back", title: "Show the terminal again", "aria-label": "Show the terminal again",
  onclick: () => setChatMin(p, false) }, strokeIcon(ICONS.restore, 14));
// its pane's × (its head, hidden while minimized, has it: features/layout/pane.ts), at its far right
const miniClose = (p) => {
  const x = p.close;
  return el("button", { type: "button", class: "mini-x", title: x.title, "aria-label": x.title, onclick: () => x.click() }, strokeIcon(ICONS.x, 16));
};
// right of the box, the conversation's last two lines (features/chat/mini-history.js), hovered: the whole of it -- pressed, the chat
// shown again -- the line between them dragged (miniGrip); none shown (no turn yet, or a pane too narrow for them:
// features/layout/top.css), the actor's avatar alone does that
const miniFoot = (ctx) => {
  const lines = miniHistory(ctx);
  return [lines, lines ? miniGrip() : null, miniMe(ctx.pane, ctx.info, miniRest(ctx)), miniClose(ctx.pane)].filter(Boolean);
};
// THE ROOM BETWEEN THE BOX AND THE LINES: the line between them dragged, the box's share of the room the two take (two parts
// in five at first; the box 150px at the least, the lines 140px) -- one for every minimized pane, kept in this browser,
// each page told when another changes it (storage); double-clicked, as it was. Each page's root holds it (--mini-box,
// --mini-hist: features/layout/top.css), in thousandths: a share under 1fr alone -- the lines', the box held at its least -- would leave
// the rest of the room empty. The grip is made again at each draw, the same each time, so the draw keeps it (patch); a drag
// is the page's, not the grip's -- followed on the page itself -- so a grip drawn again under it does not end it; every
// minimized pane's lines move with it. The apps' frames let the pointer by meanwhile: one passed over would take it.
const MINI_SPLIT_KEY = "ag-dashboard-mini-split", MINI_BOX_MIN = 150, MINI_LINES_MIN = 140;
function setMiniSplit(f) {
  const r = document.documentElement.style, n = Math.round(f * 1000);
  if (n > 0 && n < 1000) { r.setProperty("--mini-box", `${n}fr`); r.setProperty("--mini-hist", `${1000 - n}fr`); }
  else { r.removeProperty("--mini-box"); r.removeProperty("--mini-hist"); }
}
const keptMiniSplit = () => Number(prefs.text(MINI_SPLIT_KEY)) || 0;
const miniGrip = () => el("div", { class: "mini-grip", "aria-hidden": "true",
  title: "Drag to resize · double-click to reset",
  onpointerdown: miniGripDown, ondblclick: () => {
    setMiniSplit(0);
    prefs.drop(MINI_SPLIT_KEY);
  } });
function miniGripDown(ev) {
  const grip = ev.currentTarget, strip = grip.closest(".chat.mini");
  const box = strip && strip.querySelector(":scope > :is(.composer, .readonly)"), lines = strip && strip.querySelector(":scope > .mini-hist");
  if (ev.button !== 0 || !box || !lines) return;
  ev.preventDefault();
  try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* followed on the page all the same */ }
  miniCard.shut();
  const left = box.getBoundingClientRect().left, b = lines.getBoundingClientRect(), room = b.right - left, from = ev.clientX, was = b.left - left;
  // a drag on the page (its frames letting the pointer by), and the pane whose line it is (its line drawn as dragged:
  // features/layout/top.css)
  const pane = grip.closest(".pane"), root = document.documentElement;
  let f = null;
  root.dataset.miniDrag = "on";
  if (pane) pane.dataset.miniDrag = "here";
  const move = (e) => {
    if (!(e.buttons & 1)) { end(); return; }         // let go where the page did not see it
    const w = Math.max(MINI_BOX_MIN, Math.min(room - MINI_LINES_MIN, was + e.clientX - from));
    f = Math.round((w / room) * 1000) / 1000;
    setMiniSplit(f);
  };
  const end = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    delete root.dataset.miniDrag;
    if (pane) delete pane.dataset.miniDrag;
    if (f !== null) prefs.setText(MINI_SPLIT_KEY, String(f));
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
}
// The actor's avatar, small and still -- a mark at its corner while it asks the reader or stopped on an error, its turn over
// (`rest`: features/chat/mini-history.js's miniRest) a green check, as Chat's done avatar -- on its line of the history
// (features/chat/mini-history.js's meIcon, meDone), or alone right of the box (miniFoot); no avatar, the way back's icon.
const ME_MARKS = { asking: ["ask", "?"], error: ["err", "!"], failed: ["err", "!"] };
const meMark = (m) => m ? el("span", { class: "mk " + m[0], text: m[1] }) : null;
function miniMe(p, info, rest) {
  const src = bareAvatar(info), [st, word] = statusOf(info), says = `${rest ? "Done" : word}. Show the chat`;
  return el("button", { type: "button", class: "mini-me" + (rest ? " at-rest" : ""), title: says, "aria-label": says,
    style: rest ? restDelay(info, rest.row_id) : null, onclick: () => setChatMin(p, false) },
    src ? el("img", { src, alt: "", draggable: "false" }) : strokeIcon(ICONS.restore, 14),
    rest ? el("span", { class: "mk ok" }, doneCheck()) : meMark(ME_MARKS[st]));
}
// A shell's pane, minimized: what it is, and the way back.
function shellMini(p, id) {
  const sh = shellOf(id);
  return el("section", { class: "chat mini shell", "aria-label": "Terminal", "data-for": signature([id, "mini"]) }, miniBack(p),
    el("span", { class: "mini-sh" }, strokeIcon(ICONS.terminal, 13), el("span", { text: sh ? `Terminal · ${shellPath(sh)}` : "Terminal" })),
    miniClose(p));
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  setMiniSplit(keptMiniSplit());
  window.addEventListener("storage", (ev) => { if (ev.key === MINI_SPLIT_KEY || ev.key === null) setMiniSplit(keptMiniSplit()); });
}
export {
  ME_MARKS, MINI_VIEW, MIN_TIP, canMinimize, chatMin, meMark, minRedraw, setChatMin, shellMini, topChanged,
  topMount, topShown,
};
