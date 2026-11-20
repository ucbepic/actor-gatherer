import { PANE, SNAPSHOT, panes, state } from "../../core/page/state.js";
import {
  ICONS, bareAvatar, doneCheck, el, restDelay, shellOf, shellPath, signature, strokeIcon,
} from "../../core/page/helpers.js";
import { drawn, loadChat, mainSignature } from "../page/data.js";
import { keepingPlace } from "../settings/panel.js";
import { markSeen, statusOf } from "../list/seen.js";
import { paneOf, placeIfShown, placeWork, workPlacer } from "./panes.js";
import { renderMain } from "../page/main-view.js";
import { chatToEnd } from "../chat/chat.js";
import { miniCard, miniHistory, miniRest } from "../chat/mini-history.js";
import { chatOf, showTurn } from "../chat/actors";
import * as prefs from "../../core/prefs";

// ------------------------------------------------------------------ the top row, as the actors' panes see it
// Above the panes, the apps' panels (features/layout/panes.js's top row): whether it shows any (topShown), and each pane's chat
// minimized under what is above it. A pane's frame asks this page (window.agTop).
const topShown = () => PANE ? !!(window.parent.agTop && window.parent.agTop.shown())
  : !!(panes.apps && panes.apps.some((p) => !p.held));
// Drawn with the main view: the work area placed again if what it shows changed (another actor shown in this page's own
// pane: features/layout/panes.js's placeIfShown).
function topMount() {
  if (PANE || SNAPSHOT) return;
  placeIfShown();
}
// A panel opened or closed in the top row: each pane's frame told (its head put in its Chat bar, or not).
let topWas = null;
function topChanged() {
  if (PANE || SNAPSHOT) return;
  placeWork();
  markSeen();                                        // an app's panel shown: its notifications seen
  const now = topShown();
  for (const p of panes.others) p.call("toprow", now);
  if (now === topWas) { keepingPlace(renderMain); drawn.main = mainSignature(); return; }
  topWas = now;
  minRedraw();
}
// A pane's frame asks: what is above, and its own chat minimized, or able to be
const paneNode = (win) => { const p = paneOf(win); return p ? p.node : null; };
// A PANE MINIMIZED, each on its own (features/layout/work.ts): only its message box, right of it the conversation's last two
// lines -- the actor's avatar, small and still, on its own (features/chat/mini-history.js) -- and its ×; what is above or below it the
// rest. Offered where something of its task is above or below it; kept in its task's arrangement (the tab shown), so it is
// minimized again there; moved where nothing is, shown whole.
const MIN_TIP = "Minimize chat";
const chatMin = () => !SNAPSHOT && (PANE ? !!(window.parent.agTop && window.parent.agTop.min(window))
  : !!workPlacer && workPlacer.isMin(panes.here.node));
const canMinimize = () => !SNAPSHOT && !chatMin() && (PANE ? !!(window.parent.agTop && window.parent.agTop.canMin(window))
  : !!workPlacer && workPlacer.canMin(panes.here.node));
function setChatMin(on) {
  if (PANE) { if (window.parent.agTop) window.parent.agTop.setMin(on, window); return; }
  if (workPlacer) workPlacer.setMin(panes.here.node, on);   // drawn so as it is placed (minChanged, features/layout/panes.js)
}
// This page's pane minimized or shown again: its counts are the latest turn's, from the files' feed (chatFeed) -- then, shown
// again, its view's own feed.
async function minRedraw() {
  if (chatMin() && state.files && chatOf(state.files.key).picked !== null) showTurn(state.files.key, null);
  topMount();
  await loadChat();
  keepingPlace(renderMain);
  drawn.main = mainSignature();
  if (!chatMin()) chatToEnd();
}
// The view a minimized pane draws in place of its own (chatCard): no conversation, the message box, and miniFoot.
const MINI_VIEW = { id: "mini", name: "Chat", feed: "files", mini: true, background: false, queued: false, greets: true,
  render: () => [], footer: (ctx) => miniFoot(ctx) };
// the way back, at a minimized terminal's left (an actor's has none: its lines, or its avatar, pressed, are)
const miniBack = () => el("button", { type: "button", class: "mini-back", title: "Show the terminal again", "aria-label": "Show the terminal again",
  onclick: () => setChatMin(false) }, strokeIcon(ICONS.restore, 14));
// its pane's × (its head, hidden while minimized, has it: features/page/start.js), at its far right
const miniClose = () => {
  const x = document.getElementById("pane-close");
  return el("button", { type: "button", class: "mini-x", title: x.title, "aria-label": x.title, onclick: () => x.click() }, strokeIcon(ICONS.x, 16));
};
// right of the box, the conversation's last two lines (features/chat/mini-history.js), hovered: the whole of it -- pressed, the chat
// shown again -- the line between them dragged (miniGrip); none shown (no turn yet, or a pane too narrow for them:
// features/layout/top.css), the actor's avatar alone does that
const miniFoot = (ctx) => {
  const lines = miniHistory(ctx);
  return [lines, lines ? miniGrip() : null, miniMe(ctx.info, miniRest(ctx)), miniClose()].filter(Boolean);
};
// THE ROOM BETWEEN THE BOX AND THE LINES: the line between them dragged, the box's share of the room the two take (two parts
// in five at first; the box 150px at the least, the lines 140px) -- one for every minimized pane, kept in this browser,
// each page told when another changes it (storage); double-clicked, as it was. Each page's root holds it (--mini-box,
// --mini-hist: features/layout/top.css), in thousandths: a share under 1fr alone -- the lines', the box held at its least -- would leave
// the rest of the room empty. The grip is made again at each draw, the same each time, so the draw keeps it (patch); a drag
// is the page's, not the grip's -- followed on the page itself -- so a grip drawn again under it does not end it. A pane's
// frame follows it in the page around it too, every frame there letting the pointer by meanwhile: a frame's pointer,
// held, may still go to another frame it passes over (an app's), its release with it.
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
  const frame = PANE && window.frameElement, docs = frame ? [document, window.parent.document] : [document];
  // where the pointer is, in this page's terms: in the page around its frame, less where the frame is in it
  const xOf = (e) => e.currentTarget === document ? e.clientX : e.clientX - frame.getBoundingClientRect().left - frame.clientLeft;
  let f = null;
  // the frames let the pointer by meanwhile, this page's line drawn as dragged (features/layout/top.css): "here" this page, "frame" the
  // page around its frame
  for (const d of docs) d.documentElement.dataset.miniDrag = d === document ? "here" : "frame";
  const move = (e) => {
    if (!(e.buttons & 1)) { end(); return; }         // let go where the page did not see it
    const w = Math.max(MINI_BOX_MIN, Math.min(room - MINI_LINES_MIN, was + xOf(e) - from));
    f = Math.round((w / room) * 1000) / 1000;
    setMiniSplit(f);
  };
  const end = () => {
    for (const d of docs) {
      d.removeEventListener("pointermove", move);
      d.removeEventListener("pointerup", end);
      d.removeEventListener("pointercancel", end);
      delete d.documentElement.dataset.miniDrag;
    }
    if (f !== null) prefs.setText(MINI_SPLIT_KEY, String(f));
  };
  for (const d of docs) {
    d.addEventListener("pointermove", move);
    d.addEventListener("pointerup", end);
    d.addEventListener("pointercancel", end);
  }
}
// The actor's avatar, small and still -- a mark at its corner while it asks the reader or stopped on an error, its turn over
// (`rest`: features/chat/mini-history.js's miniRest) a green check, as Chat's done avatar -- on its line of the history
// (features/chat/mini-history.js's meIcon, meDone), or alone right of the box (miniFoot); no avatar, the way back's icon.
const ME_MARKS = { asking: ["ask", "?"], error: ["err", "!"], failed: ["err", "!"] };
const meMark = (m) => m ? el("span", { class: "mk " + m[0], text: m[1] }) : null;
function miniMe(info, rest) {
  const src = bareAvatar(info), [st, word] = statusOf(info), says = `${rest ? "Done" : word}. Show the chat`;
  return el("button", { type: "button", class: "mini-me" + (rest ? " at-rest" : ""), title: says, "aria-label": says,
    style: rest ? restDelay(info, rest.row_id) : null, onclick: () => setChatMin(false) },
    src ? el("img", { src, alt: "", draggable: "false" }) : strokeIcon(ICONS.restore, 14),
    rest ? el("span", { class: "mk ok" }, doneCheck()) : meMark(ME_MARKS[st]));
}
// A shell's pane, minimized: what it is, and the way back.
function shellMini(id) {
  const sh = shellOf(id);
  return el("section", { class: "chat mini shell", "aria-label": "Terminal", "data-for": signature([id, "mini"]) }, miniBack(),
    el("span", { class: "mini-sh" }, strokeIcon(ICONS.terminal, 13), el("span", { text: sh ? `Terminal · ${shellPath(sh)}` : "Terminal" })),
    miniClose());
}
// In a frame: as tall as its minimized pane -- the row under the top row as tall as its tallest -- else as its pane is laid out.
let miniFit = null;
function fitMini() {
  const f = PANE && window.frameElement;
  if (!f) return;
  const card = document.querySelector("#main > .chat.mini");
  if (miniFit && miniFit.card === card) return;
  if (miniFit) miniFit.obs.disconnect();
  miniFit = null;
  if (!card) { f.style.height = ""; return; }
  const obs = new ResizeObserver(() => { f.style.height = `${Math.ceil(card.getBoundingClientRect().height)}px`; });
  obs.observe(card);
  miniFit = { card, obs };
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  if (!PANE && !SNAPSHOT) window.agTop = Object.freeze({ shown: () => topShown(),
    min: (win) => !!workPlacer && !!paneNode(win) && workPlacer.isMin(paneNode(win)),
    canMin: (win) => !!workPlacer && !!paneNode(win) && workPlacer.canMin(paneNode(win)),
    setMin: (on, win) => { if (workPlacer && paneNode(win)) workPlacer.setMin(paneNode(win), on); } });
  setMiniSplit(keptMiniSplit());
  window.addEventListener("storage", (ev) => { if (ev.key === MINI_SPLIT_KEY || ev.key === null) setMiniSplit(keptMiniSplit()); });
}
export {
  ME_MARKS, MINI_VIEW, MIN_TIP, canMinimize, chatMin, fitMini, meMark, minRedraw, setChatMin, shellMini, topChanged,
  topMount, topShown,
};
