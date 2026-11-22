import { SNAPSHOT, state } from "../../core/page/state.js";
import { el, isShell, parseKey } from "../../core/page/helpers.js";
import { mainSignature } from "./data.js";
import { keepingPlace } from "../settings/panel.js";
import { chatAtEnd, chatCard, chatToEnd } from "../chat/chat.js";
import { CHAT_VIEWS, chatView, setChatView } from "../chat/views.js";
import { shellCard } from "../terminal/shell.js";
import { interrupt } from "../chat/files-view.js";
import { chatMin, shellMini, topMount } from "../layout/top.js";
import { focusedPane } from "../layout/panes.js";
import { allPanes, drawingIn, drawingPane, paneAt, paneInfo, paneKey } from "./pane-view.js";
import { useSettings } from "../settings/store";
import { useShown } from "../../core/model/items";
import { drawDetails } from "../details/mount";
import { useNotes } from "../transcript/TranscriptView";

// ------------------------------------------------------------------ an actor's pane, drawn
// A pane's main view is its actor's conversation (chatCard): all of it, with the message box under it where the actor
// can be messaged here. What it is, what ag saw and did for it -- its calls, its context, the Gatherer's work -- is the
// details panel (detailsPanel), opened from the pane's head (the ⓘ), at the chat's right. The apps' panels are above
// the panes, in the top row (features/layout/top.js's topMount: a pane's chat minimized under it, or not). Each pane is
// drawn for its own actor (features/page/pane-view.js's record): this page's own, and each beside it.
function renderPane(p) {
  topMount();
  const main = p.main, c = p.c;
  if (!c) {
    p.controls.replaceChildren();
    main.replaceChildren(el("div", { class: "empty", text: "No actors yet. Run a harness through ag and it appears here." }));
    return;
  }
  const x = p.close, shell = isShell(c);
  x.title = shell ? "Close pane (the terminal keeps running)" : "Close pane (the actor stays open)";
  x.setAttribute("aria-label", x.title);
  drawingIn(p, () => {
    if (shell) { patch(main, [chatMin(p) ? shellMini(p, c) : shellCard(p, c)]); return; }
    const info = paneInfo(p) || {};
    const kids = [chatCard(p, info), ...(p.details && !chatMin(p) ? [detailsPanel(p, info)] : [])];
    const open = new Set([...main.querySelectorAll("details[open][id]")].map((d) => d.id));
    for (const k of kids) for (const d of k.querySelectorAll("details[id]")) if (open.has(d.id)) d.open = true;
    patch(main, kids);
  });
}
// A pane drawn again, where the reader left it (keepingPlace), its view's ends followed (`end`: kept at its end if it
// was); every pane, by drawPanes.
function drawPane(p, end = false) {
  const atEnd = end && chatAtEnd(p);
  keepingPlace(() => renderPane(p), p);
  p.drawn.main = mainSignature(p);
  if (atEnd) chatToEnd(p);
}
const drawPanes = () => { for (const p of allPanes()) drawPane(p); };
// The page's own pane, drawn (what the list's select() and the old callers draw).
const renderMain = () => renderPane(drawingPane());
// Put `kids` in `parent`, keeping each node already there that is the same as its new one: the browser
// lays out again only what changed (a long transcript takes it a third of a second), and a kept node
// keeps its focus, its typed text and its scroll. Matched by position, as the chat grows at its end.
// A node marked data-morph with the same attributes is patched inside the same way; one marked data-sig
// (a message box) is kept while its data-sig is unchanged, whatever was typed in it.
// A node built with its children held apart (`kids`, the chat frame's) gets them here: it is one marked
// data-morph, or in one.
const fill = (n) => {
  if (n.nodeType !== 1) return n;
  if (n.kids) { n.append(...n.kids); n.kids = null; }
  for (const c of n.children) if ("morph" in c.dataset) fill(c);
  return n;
};
function patch(parent, kids) {
  const old = [...parent.childNodes];
  const same = (o, n) => o.attributes.length === n.attributes.length && [...o.attributes].every((a) => n.getAttribute(a.name) === a.value);
  const final = kids.map((n, i) => {
    const o = old[i];
    if (!o || o === n) return n;
    if (o.nodeType !== 1 || n.nodeType !== 1) return o.isEqualNode(n) ? o : n;
    if ("sig" in o.dataset || "sig" in n.dataset) return o.dataset.sig === n.dataset.sig && o.tagName === n.tagName ? o : n;
    if ("morph" in o.dataset && o.tagName === n.tagName && same(o, n)) { patch(o, n.kids || [...n.childNodes]); return o; }
    return o.isEqualNode(fill(n)) ? o : n;
  });
  const was = new Set(old);
  for (const n of final) if (!was.has(n)) fill(n);
  if (final.some((n, i) => n !== old[i] && was.has(n))) { parent.replaceChildren(...final); return; }   // moved: drawn whole
  final.forEach((n, i) => { if (i >= old.length) parent.append(n); else if (n !== old[i]) parent.replaceChild(n, old[i]); });
  for (const o of old.slice(final.length)) o.remove();
}
// Pane `p`'s opened or closed; `part` (actor, context, gatherer): opened at that part of it.
function setDetails(p, open, part) {
  p.details = open;
  drawPane(p);
  const body = open && part && p.main.querySelector(".drawer-body"), at = body && body.querySelector(`#details-${part}`);
  if (at) body.scrollTop = at.offsetTop - body.offsetTop;
}
// The dashboard's own commands, typed in a message box: done here, not sent to the agent. Any other "/" goes to the
// agent as written -- Claude Code's own commands, skills and command files -- so the dashboard takes only these; one
// that reaches the session's terminal shows the reader that terminal (the composer's send).
//   /context   ag's context for the actor -- what the model was really sent, which under ag is not what Claude Code's
//              own /context counts -- in the details panel, beside the chat, at its Context part
const DASHBOARD_COMMANDS = { "/context": (p) => setDetails(p, true, "context") };
// (typed in pane `p`'s box: done there)
function dashboardCommand(text, p) {
  const run = DASHBOARD_COMMANDS[String(text ?? "").trim().toLowerCase()];
  if (run) run(p);
  return !!run;
}
// An Esc from outside the message box, for the actor pane `p` shows: in Chat, its panel closed (the Esc closes that).
// While the agent asks too, as from the box: the question dismissed, as an Esc on it in its terminal -- after a click on
// one of the card's choices among them.
function escapeShown(p) {
  const info = paneInfo(p);
  return !!p && !!p.c && !isShell(p.c) && !p.details && chatView(p).id === "files" && !!info && interrupt(p, info);
}
const DETAILS_TIP = "Details";
// All of it in one panel, one part under another (features/details/: React's, the same node from draw to draw): the
// history's other views and the actor's facts, then its calls (Actor), what the model was sent (Context: what `/context`
// in the message box opens, dashboardCommand), and what ag did for it (Gatherer). For the actor this page shows (the key
// pane's actor, by its key): the actor as the home has it, and what ag recorded of its calls.
const detailsHost = (p) => ({ showView: (id) => { setDetails(p, false); setChatView(p, id); } });
function detailsPanel(p, info) {
  const views = [...CHAT_VIEWS.values()].filter((v) => v.more)
    .map(({ id, name, description, icon }) => ({ id, name, description, icon }));
  return drawDetails({ key: paneKey(p), info, agent: p.agent, home: state.home, snapshot: !!SNAPSHOT, views,
    current: chatView(p).id, now: Date.now() / 1000 }, detailsHost(p));
}
// What the context's and size cards are drawn for, as nodes (the reader's own views: agDashboard's contextCard, sizeCard):
// the actor of the pane being drawn, and what ag recorded of its calls.
const callsNow = () => {
  const p = drawingPane(), actor = paneKey(p);
  return { actor, gatherer: actor ? parseKey(actor).group : "", agent: p.agent, snapshot: !!SNAPSHOT };
};
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  // the types the lists show, picked (features/details/'s chips): this page's own views of them, and the reader's, drawn
  // again -- React's draw themselves
  useShown.subscribe((now, was) => { if (now.types !== was.types) drawPanes(); });
  useNotes.subscribe((now, was) => { if (now.on !== was.on) drawPanes(); });   // the Transcript's notes shown
  // Esc closes the panel -- unless it is the message box's: there it interrupts the agent's turn (interrupt), as in its
  // terminal (and dismisses what the agent asks, as there). So does it from anywhere else on the page that nothing else
  // takes it (escapeShown), for the actor of the pane in focus -- else an Esc after a click on the actor in the list, a
  // turn or a button did nothing at all, the focus out of the box. Not typed in another
  // box, the Editor or a terminal, and nothing open that the Esc is for: a menu, a dialog (DocWriter's pop-up among them), the settings. Before the rest
  // (capture), so it knows whether the settings were open before their own Esc closes them.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || ev.defaultPrevented || ev.isComposing) return;
    const n = ev.target;
    if (n && n.id === "composer-text") {
      const p = paneAt(n);
      if (p && p.c && !isShell(p.c) && interrupt(p, paneInfo(p))) ev.preventDefault();
      return;
    }
    if ((n && n.closest && n.closest("input, textarea, select, [contenteditable], .xterm, .top-row"))
      || document.querySelector("[role=menu]:not([hidden]), [role=dialog]:not([hidden]), dialog[open]")
      || !document.getElementById("about").hidden || useSettings.getState().file.open) return;
    if (escapeShown(focusedPane())) ev.preventDefault();
  }, true);
  // and Details: the pane's where the Esc is, else the pane in focus's
  document.addEventListener("keydown", (ev) => {
    const p = paneAt(ev.target) || focusedPane();
    if (ev.key === "Escape" && p && p.details && !ev.defaultPrevented && !(ev.target && ev.target.id === "composer-text")
      && !(p.c && isShell(p.c))) setDetails(p, false);
  });
}

export { DETAILS_TIP, callsNow, dashboardCommand, drawPane, drawPanes, escapeShown, patch, renderMain, renderPane, setDetails };
