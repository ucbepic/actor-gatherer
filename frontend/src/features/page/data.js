import { SNAPSHOT, panes, state } from "../../core/page/state";
import {
  avatarMode, clock, el, get, isShell, keepAvatarMode, parseKey, selectedInfo, signature,
} from "../../core/page/helpers";
import { statusOf, takeHome } from "../list/seen";
import { firstAgent, isHidden, moveHidingToServer, renderAgents, staleNames } from "../list/list";
import { drawWho, paneSig, restorePanes, setAutoShown, showActorsApp, startTabs, taskKey } from "../layout/panes";
import { drawPane } from "./main-view";
import { termsKept } from "../terminal/term";
import { chatFeed, chatView } from "../chat/views";
import { opened } from "../chat/files-view";
import { canMinimize, chatMin, topShown } from "../layout/top";
import { clearFlips } from "../chat/store";
import { allPanes, paneInfo, paneKey, paneSel } from "./pane-view";
import { drafts, keepDraft } from "../chat/drafts";
import { ownBox } from "../chat/Composer";
import { useSettings } from "../settings/store";
import * as prefs from "../../core/prefs";
import { counted } from "../details/model";
import { loadContext, pickedFor, shownRead, usePicked } from "../details/store";
import { detailsShown } from "../details/mount";
import { useEvents } from "../details/events";
import { txSignature, useTxFeed } from "../transcript/data";

// ------------------------------------------------------------------ data
let hidingMoved = false;
// The home: read once by the page (every pane draws from it), then as the stream sends it.
async function loadHome() {
  let home = SNAPSHOT ? SNAPSHOT.home : null;
  if (!home) {
    const r = await fetch("/api/home", { cache: "no-store" });
    if (!r.ok) throw new Error(`/api/home: ${r.status}`);
    home = await r.json();
  }
  takeHome(home);
  if (!hidingMoved) { hidingMoved = true; await moveHidingToServer(); }
}
// What ag recorded of the calls of pane `p`'s actor (this page's own, by default), fetched: as the pane is given it.
async function loadAgent(p = panes.here) {
  const sel = paneSel(p);
  if (!sel || isShell(sel[1])) return;
  const [g, c] = sel;
  const got = SNAPSHOT ? SNAPSHOT.agents[paneKey(p)] || null
    : await get(`/api/agent?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}`);
  if (p.g !== g || p.c !== c) return;               // another given it meanwhile: not it
  await takeAgent(got, p);
}
// Pane `p`'s actor's calls, fetched or pushed: their counts, and the context of the call Details shows (the latest's,
// unless one is picked: features/details/store.ts), fetched before the page draws it.
async function takeAgent(agent, p = panes.here) {
  p.agent = agent; p.agentVersion = (p.agentVersion || 0) + 1;
  const reads = (agent && agent.reads) || [];
  counted(reads);                                    // ag's count of all each call sent
  const actor = paneKey(p);
  if (!actor) return;
  detailsShown(allPanes().map(paneKey).filter(Boolean));
  if (reads.length) await loadContext(parseKey(actor).group, shownRead(agent, pickedFor(usePicked.getState(), actor)));
}
// What a pane's view draws from, of the transcript's feed (features/transcript/data.ts): while its view draws it.
const txSignatureNow = (p) => chatView(p).feed === "transcript" ? txSignature(useTxFeed.getState().feed) : null;
// What pane `p` shows, loaded (this page's own, by default): the feed its view draws from (chat views, below), for its
// actor -- any actor: one that cannot be messaged here is shown all the same, without the message box.
async function loadChat(p = panes.here) {
  if (!p || !p.c || SNAPSHOT || isShell(p.c)) return;
  try { await chatFeed(p).load(p); } catch (err) { /* no database yet: the gatherer is made on the first call */ }
}
// What was last drawn, so an update that brings nothing new draws nothing: no flash, and an open table, a scrolled list
// or a tooltip stays as it is -- the list's here, each pane's in its record (`drawn`: features/page/pane-view.js).
const drawn = { agents: null };
// What the list draws from: kept as `drawn.agents` by renderAgents whoever calls it -- a home, or the reader's own
// action, which draws at once -- so a home that only confirms that action draws nothing anew (a row drawn again under
// the pointer as the reader presses it to drag starts no drag). Not the clock: its "ago" texts count where they are, as
// every `data-ago` does (core/ui/clocks.ts), and a redraw for them alone would take the keyboard's
// place in the list away every 30 s -- only what the time decides, the groups hidden for being inactive (`staleNames`).
const listSignature = () => signature([state.home.gatherers, state.home.hook_servers, state.home.hiding, state.home.titles,
  state.home.saved, state.home.folders, state.home.gatherer_folders, state.home.places, state.home.tasks, state.home.seen, state.home.harnesses, state.home.shells, state.home.branches,
  paneSig(), opened(selectedInfo()), staleNames()]);
// The list drawn again only if what it draws from changed since: after an action's answer, which mostly says what the
// page guessed and drew already -- a list drawn anew for nothing, as a drag begins, loses its row.
const redrawList = () => { if (listSignature() !== drawn.agents) renderAgents(); };
async function refresh(userAction = false) {
  const main = document.getElementById("main");
  if (userAction) main.classList.add("stale");     // dimmed only while what the reader asked for loads
  try {
    await loadHome();
    if (!panes.checked) restorePanes();
    if (!state.selected) {
      const first = state.home.gatherers.find((g) => g.agents.length && !isHidden(g)) || state.home.gatherers.find((g) => g.agents.length);
      if (first) {
        state.selected = [first.name, firstAgent(first).channel];
        setAutoShown(taskKey(...state.selected));   // shown by itself: the tab's as if empty (features/layout/panes.js's viaTabs)
      }
    }
    if (state.selected) showActorsApp(...state.selected);   // an app's actor (features/apps/app-actors.js): its panel above
    startTabs();                                     // the tab shown as it was left (features/layout/panes.js)
    await loadAgent().catch(() => { state.agent = null; });   // a session started here may have no database yet
    await loadChat();
    render(userAction);
  } catch (err) {
    setLive(`Not updated: ${err.message}`);
  } finally {
    main.classList.remove("stale");
  }
}
// Draw what changed since the last draw (everything, for what the reader asked for).
let lastKey = 0, heldDraw = null;
// The message box as tall as what is typed in it: a line, up to its CSS's most (then scrolling). Measured on a copy of it
// kept out of the page's layout (`boxSizer`), and its height set only when that changes -- in most keys, never. Set at
// every key (to "auto", to measure, then to its height), the whole Chat was laid out twice a key, the conversation a
// moment taller between: in Chrome 155 at a zoom of 110%, the chat and the page's top row flickered at every key.
const BOX_COPIED = ["font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "word-spacing",
  "text-transform", "tab-size", "white-space", "overflow-wrap", "word-break", "box-sizing", "padding-top", "padding-right",
  "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width"];
let sizerBox = null;
function boxSizer(box) {
  if (!sizerBox || !sizerBox.isConnected) {
    sizerBox = el("textarea", { rows: "1", tabindex: "-1", "aria-hidden": "true",
      style: "position: fixed; left: -10000px; top: 0; visibility: hidden; pointer-events: none; contain: layout paint style; "
        + "height: auto; min-height: 0; max-height: none; overflow: hidden; border-style: solid; resize: none" });
    document.body.append(sizerBox);
  }
  const cs = getComputedStyle(box);
  for (const k of BOX_COPIED) sizerBox.style.setProperty(k, cs.getPropertyValue(k));
  sizerBox.style.width = `${box.offsetWidth}px`;
  return sizerBox;
}
function fitBox(box) {
  if (!box || !box.isConnected) return;
  const sizer = boxSizer(box);
  sizer.value = box.value;
  const want = `${sizer.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  if (box.style.height !== want) box.style.height = want;
}
// What was typed in an actor's message box and not sent, by actor (key()), kept in this browser tab: its box, drawn
// again once the reader comes back from another actor or view, or reloads, starts with it (ctx.input). Read and
// written whole each time.
const TYPING_MS = 300;                               // an update that comes while the reader types waits this long after a key
function render(userAction = false) {
  if (!state.home) return;
  const since = performance.now() - lastKey;
  if (!userAction && since < TYPING_MS) {
    if (!heldDraw) heldDraw = setTimeout(() => { heldDraw = null; render(); }, TYPING_MS - since + 10);
    return;
  }
  // not while a form in the list is open, which a redraw would empty
  if ((userAction || listSignature() !== drawn.agents) && !((state.adding || state.renaming) && !userAction)) renderAgents();
  for (const p of allPanes()) {                      // each pane, drawn again if what it shows changed
    if (userAction || mainSignature(p) !== p.drawn.main) drawPane(p, true);
    drawWho(p);
  }
  termsKept(allPanes().map((p) => p.c).filter(Boolean));   // the terminals of the sessions no pane shows let go of
  setLive(SNAPSHOT ? `Snapshot · ${clock(state.home.now, true)}` : state.paused ? "Paused"
    : !state.stream ? "Connecting…" : state.stream.readyState === EventSource.OPEN ? `Live · updated ${clock(Date.now() / 1000)}` : "Reconnecting…");
}
// What a pane's view draws from: drawn again only when it changed. Its actor's state among it -- its status, what it
// waits on, why it stopped, what runs in the background (which, not how lately): a turn's end may change only that (its
// answer's end comes after its last words, which the actor's data already had), and its "Working…" would stay.
const mainSignature = (p) => {
  const info = paneInfo(p), events = useEvents.getState().feed, feed = chatFeed(p);
  return signature([paneSel(p), p.agentVersion, info && info.session,
    info && [info.chattable, info.holder],
    info && [statusOf(info)[0], info.failing, info.stopped, info.asking, info.answer, (info.background || []).map((t) => t.id),
      info.taken_back],
    info && info.avatar_hello,
    events && [events.key, events.last_row, events.pending], txSignatureNow(p), chatView(p).id,
    feed.signature ? feed.signature(p) : null,
    p.details, topShown(), chatMin(p), canMinimize(p)]);
};
// The page's state, in the settings panel: its dot green while live, amber paused, red on an error; the logo's title says it.
const setLive = (text) => {
  document.getElementById("live").textContent = text;
  const st = /^Live/.test(text) ? "live" : text === "Paused" ? "paused" : /^Not /.test(text) ? "error" : "";
  for (const n of document.querySelectorAll(".state-dot")) n.dataset.state = st;   // the settings panel's
  document.getElementById("about-btn").title = `Settings · ${text}`;
};
// The dashboard's panel: opened by its button, closed by it again, by a click elsewhere, by Esc, or once a
// theme is picked or the Gatherer's model set.
function setAbout(open) {
  document.getElementById("about").hidden = !open;
  document.getElementById("about-btn").setAttribute("aria-expanded", open ? "true" : "false");
}
// Light, dark, or the system's: kept in this browser, the page is dark until one is picked.
const THEME_KEY = "ag-dashboard-theme";
// "system": the system's look, followed as it changes (start()'s listener). The page always says which it shows
// (data-theme), so its stylesheet has the dark palette once (core/page/base.css).
let themePick = "system";
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
function setTheme(pick, keep) {
  if (pick !== "light" && pick !== "dark") pick = "system";
  themePick = pick;
  document.documentElement.dataset.theme = pick === "system" ? (systemDark() ? "dark" : "light") : pick;
  for (const b of document.querySelectorAll("[data-theme-pick]")) b.setAttribute("aria-pressed", b.dataset.themePick === pick ? "true" : "false");
  if (keep) { prefs.setText(THEME_KEY, pick); }
  window.dispatchEvent(new Event("ag-theme"));
}
// The actor at work in the Chat view: acting out what it does (the stage), or small with its one motion ("simple"); kept in
// this browser, acting until one is picked.
const AVATAR_KEY = "ag-dashboard-avatar";
function setAvatarMode(pick, keep, draw = true) {
  keepAvatarMode(pick === "simple" ? "simple" : "acting");
  for (const b of document.querySelectorAll("[data-avatar-pick]")) b.setAttribute("aria-pressed", b.dataset.avatarPick === avatarMode ? "true" : "false");
  if (keep) { prefs.setText(AVATAR_KEY, avatarMode); }
  if (draw) for (const p of allPanes()) if (chatView(p).id === "files") drawPane(p);
}
// The Chat's turns before the latest, at first: the user's messages only, a click on one showing the rest ("messages",
// filesTalk) -- all but the latest two the agent answered, the one before them folded once a newer turn has its first
// answer; or each whole, a click on its message folding it. Kept in this browser, messages only until one is picked; a
// pick starts every turn over as it has them.
const EARLIER_KEY = "ag-dashboard-chat-earlier";
let earlierTurns = "messages";
function setEarlierTurns(pick, keep, draw = true) {
  earlierTurns = pick === "whole" ? "whole" : "messages";
  clearFlips();                                       // the turns' clicks: Chat's turns (src/features/chat/store.ts)
  for (const b of document.querySelectorAll("[data-earlier-pick]")) b.setAttribute("aria-pressed", b.dataset.earlierPick === earlierTurns ? "true" : "false");
  if (keep) { prefs.setText(EARLIER_KEY, earlierTurns); }
  if (draw) for (const p of allPanes()) if (chatView(p).id === "files") drawPane(p);
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  document.addEventListener("input", (ev) => {
    // a box of the old page's: kept and fitted here, and the page's draws held while it is typed in (render); the Chat
    // view's own (features/chat/Composer.tsx) keeps its draft itself, and nothing waits for it
    if (ev.target && ev.target.id === "composer-text" && !ownBox(ev.target)) { lastKey = performance.now(); fitBox(ev.target); keepDraft(ev.target.dataset.draft, ev.target.value); }
  }, true);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themePick === "system") setTheme("system", false); else window.dispatchEvent(new Event("ag-theme"));
  });
  setAvatarMode(prefs.text(AVATAR_KEY), false, false);
  document.getElementById("avatar-mode").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-avatar-pick]");
    if (b) setAvatarMode(b.dataset.avatarPick, true);
  });
  setEarlierTurns(prefs.text(EARLIER_KEY), false, false);
  document.getElementById("chat-earlier").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-earlier-pick]");
    if (b) setEarlierTurns(b.dataset.earlierPick, true);
  });
  setTheme(prefs.text(THEME_KEY) || "dark", false);
  document.getElementById("theme").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-theme-pick]");
    if (b) { setTheme(b.dataset.themePick, true); setAbout(false); }
  });
  document.getElementById("about-btn").addEventListener("click", () => {
    const open = document.getElementById("about").hidden;
    setAbout(open);
    if (open) useSettings.getState().load().catch(() => {});
  });
  document.getElementById("about-x").addEventListener("click", () => setAbout(false));   // its own ×, as Esc
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".about-wrap, .cfg-file")) setAbout(false); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (useSettings.getState().file.open) { useSettings.getState().closeFile(); return; }
    setAbout(false);
  });
}

export {
  drafts, drawn, earlierTurns, fitBox, keepDraft, listSignature, loadAgent, loadChat,
  loadHome, mainSignature, redrawList, refresh, render, setAbout, setAvatarMode, setEarlierTurns,
  setLive, setTheme, takeAgent,
};
