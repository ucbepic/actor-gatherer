import { PANE, SNAPSHOT, panes, state } from "../../core/page/state.js";
import { el, isShell, parseKey, selectedInfo } from "../../core/page/helpers.js";
import { drawn, mainSignature } from "./data.js";
import { keepingPlace } from "../settings/panel.js";
import { chatCard } from "../chat/chat.js";
import { CHAT_VIEWS, chatView, setChatView } from "../chat/views.js";
import { shellCard } from "../terminal/shell.js";
import { chatActor, interrupt } from "../chat/files-view.js";
import { chatMin, fitMini, shellMini, topMount } from "../layout/top.js";
import { focusedPane } from "../layout/panes.js";
import { useSettings } from "../settings/store";
import { useShown } from "../../core/model/items";
import { drawDetails } from "../details/mount";
import { useNotes } from "../transcript/TranscriptView";

// ------------------------------------------------------------------ the selected agent
// The main view is the actor's conversation (chatCard): all of it, with the message box under it where
// the actor can be messaged here. What it is, what ag saw and did for it -- its calls, its context, the Gatherer's work --
// is the details panel (detailsPanel), opened from the page's header (the ⓘ), at the chat's right. The apps' panels are above the
// panes, in the top row (features/layout/top.js's topMount: the chat minimized under it, or not).
function renderMain() {
  topMount();
  const main = document.getElementById("main");
  if (!state.selected) {
    document.getElementById("controls").replaceChildren();
    main.replaceChildren(el("div", { class: "empty", text: "No actors yet. Run a harness through ag and it appears here." }));
    return;
  }
  const x = document.getElementById("pane-close"), shell = isShell(state.selected[1]);
  x.title = shell ? "Close pane (the terminal keeps running)" : "Close pane (the actor stays open)";
  x.setAttribute("aria-label", x.title);
  if (shell) { patch(main, [chatMin() ? shellMini(state.selected[1]) : shellCard(state.selected[1])]); fitMini(); return; }
  const info = selectedInfo() || {};
  const kids = [chatCard(info), ...(state.details && !chatMin() ? [detailsPanel(info)] : [])];
  const open = new Set([...main.querySelectorAll("details[open][id]")].map((d) => d.id));
  for (const k of kids) for (const d of k.querySelectorAll("details[id]")) if (open.has(d.id)) d.open = true;
  patch(main, kids);
  fitMini();
}
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
// Open or close it; `part` (actor, context, gatherer): opened at that part of it.
function setDetails(open, part) {
  state.details = open;
  keepingPlace(renderMain);
  drawn.main = mainSignature();
  const body = open && part && document.querySelector(".drawer-body"), at = body && document.getElementById(`details-${part}`);
  if (at) body.scrollTop = at.offsetTop - body.offsetTop;
}
// The dashboard's own commands, typed in a message box: done here, not sent to the agent. Any other "/" goes to the
// agent as written -- Claude Code's own commands, skills and command files -- so the dashboard takes only these; one
// that reaches the session's terminal shows the reader that terminal (the composer's send).
//   /context   ag's context for the actor -- what the model was really sent, which under ag is not what Claude Code's
//              own /context counts -- in the details panel, beside the chat, at its Context part
const DASHBOARD_COMMANDS = { "/context": () => setDetails(true, "context") };
function dashboardCommand(text) {
  const run = DASHBOARD_COMMANDS[String(text ?? "").trim().toLowerCase()];
  if (run) run();
  return !!run;
}
// An Esc from outside the message box, for the actor this pane shows: in Chat, its panel closed (the Esc closes that).
// While the agent asks too, as from the box: the question dismissed, as an Esc on it in its terminal -- after a click on
// one of the card's choices among them.
function escapeShown() {
  const info = selectedInfo();
  return !!state.selected && !isShell(state.selected[1]) && !state.details && chatView().id === "files"
    && !!info && interrupt(info);
}
const DETAILS_TIP = "Details";
// All of it in one panel, one part under another (features/details/: React's, the same node from draw to draw): the
// history's other views and the actor's facts, then its calls (Actor), what the model was sent (Context: what `/context`
// in the message box opens, dashboardCommand), and what ag did for it (Gatherer). For the actor this page shows (the key
// files-view.js's chatActor makes of it): the actor as the home has it, and what ag recorded of its calls.
const DETAILS_HOST = Object.freeze({ showView: (id) => { setDetails(false); setChatView(id); } });
function detailsPanel(info) {
  const views = [...CHAT_VIEWS.values()].filter((v) => v.more)
    .map(({ id, name, description, icon }) => ({ id, name, description, icon }));
  return drawDetails({ key: chatActor(), info, agent: state.agent, home: state.home, snapshot: !!SNAPSHOT, views,
    current: chatView().id, now: Date.now() / 1000 }, DETAILS_HOST);
}
// What the context's and size cards are drawn for, as nodes (the reader's own views: agDashboard's contextCard, sizeCard):
// the actor this page shows, and what ag recorded of its calls.
const callsNow = () => {
  const actor = chatActor();
  return { actor, gatherer: parseKey(actor).group, agent: state.agent, snapshot: !!SNAPSHOT };
};
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  // the types the lists show, picked (features/details/'s chips): this page's own views of them, and the reader's, drawn
  // again -- React's draw themselves
  useShown.subscribe((now, was) => { if (now.types !== was.types) keepingPlace(renderMain); });
  useNotes.subscribe((now, was) => { if (now.on !== was.on) keepingPlace(renderMain); });   // the Transcript's notes shown
  // Esc closes the panel -- unless it is the message box's: there it interrupts the agent's turn (interrupt), as in its
  // terminal (and dismisses what the agent asks, as there). So does it from anywhere else on the page that nothing else
  // takes it (escapeShown), for the actor of the pane in focus (another pane's: its agPane.escape) -- else an Esc after a
  // click on the actor in the list, a turn or a button did nothing at all, the focus out of the box. Not typed in another
  // box, the Editor or a terminal, and nothing open that the Esc is for: a menu, a dialog (DocWriter's pop-up among them), the settings. Before the rest
  // (capture), so it knows whether the settings were open before their own Esc closes them.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape" || ev.defaultPrevented || ev.isComposing) return;
    const n = ev.target;
    if (n && n.id === "composer-text") {
      if (state.selected && !isShell(state.selected[1]) && interrupt(selectedInfo())) ev.preventDefault();
      return;
    }
    if ((n && n.closest && n.closest("input, textarea, select, [contenteditable], .xterm, .top-row"))
      || document.querySelector("[role=menu]:not([hidden]), [role=dialog]:not([hidden]), dialog[open]")
      || !document.getElementById("about").hidden || useSettings.getState().file.open) return;
    if (!PANE && focusedPane() !== panes.here ? focusedPane().call("escape") : escapeShown()) ev.preventDefault();
  }, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && state.details && !ev.defaultPrevented && !(ev.target && ev.target.id === "composer-text")
      && !(state.selected && isShell(state.selected[1]))) setDetails(false);
  });
}

export { DETAILS_TIP, callsNow, dashboardCommand, escapeShown, patch, renderMain, setDetails };
