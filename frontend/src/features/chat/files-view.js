import { SNAPSHOT, state } from "../../core/page/state.js";
import {
  BESIDE_KEY, ICONS, atRest, atWork, bareAvatar, el, greeting, hueInk, key, post, selectedInfo, strokeIcon,
} from "../../core/page/helpers.js";
import { drafts, earlierTurns, fitBox, keepDraft, render, setLive } from "../page/data.js";
import { $, keepingPlace } from "../settings/panel.js";
import { MANAGER, crewFace, envelope } from "../list/list.js";
import { DETAILS_TIP, patch, renderMain, setDetails } from "../page/main-view.js";
import { answeredNote, askingNote, errorNote } from "./chat.js";
import { CHAT_FEEDS, CHAT_VIEWS, addChatView, chatView, offeredViews, setChatView } from "./views.js";
import { MIN_TIP, canMinimize, setChatMin, topShown } from "../layout/top.js";
import { appWordsOf } from "../apps/app-actors.js";
import { drawChat } from "./mount";
import { drawComposer } from "./Composer";
import { callLabelNode, callViewNode } from "./side/nodes";
import { FILE_KINDS } from "./side/marks";
import { useSide } from "./side/store";
import { useTurns } from "./store";
import { cidsOf } from "./view";
import { stampOf, turnsOf, useChatData, viewOf, viewOrNone, viewSeq } from "./data";
import { filesSeq, keptFiles, loadFiles as loadFilesOf } from "./files";
import { parse as parseKey } from "../../core/model/keys";

// ------------------------------------------------------------------ the Files view
// The Chat view: the conversation, and beside it a turn's files and commands -- each file the agent read, searched or
// changed in it, the lines it saw at their numbers and its changes in place among them (files.py); every call it made.
// One turn at a time: the latest, followed, unless one is picked. Drawn by the new code (src/features/chat/: Chat.tsx,
// side/), into a frame of each actor's own (mount.tsx), from what this page hands it (talkFeed, CHAT_HOST); loaded here.
// The files feed: the actor's turn's files and commands (files.ts: fetched when the stream's view says its turns moved
// on, else as kept), for the turn picked (`state.files.turn`; null, the latest) -- the data drawn (`data`) changed when
// they come, as one moment's with what was drawn of them (the file picked, `sel`; the folders folded). `state.files` is
// made anew for each actor picked: the turn list's folds start over with it (chat/store.ts's forFiles).
const filesOf = (f, info) => {
  const { group: gatherer, id: channel } = parseKey(f.key);
  const turns = turnsOf(f.key, f.data), row = f.turn === null ? null : (turns[f.turn] || {}).row_id ?? null;
  return { gatherer, channel, turn: f.turn, row, cwd: (info && (info.cwd || (info.session && info.session.cwd))) || "" };
};
// The files feed loaded for the selected actor: as kept unless the turns moved on (the stream's view, its stamp) -- or,
// the page not streaming (paused), fetched each time, as nothing else says when they move on.
async function loadFiles() {
  if (!state.selected || SNAPSHOT) return;
  const [g, c] = state.selected, k = key(g, c);
  if (!state.files || state.files.key !== k) state.files = { key: k, turn: null, sel: null, data: null };
  const f = state.files, which = filesOf(f, selectedInfo()), view = viewOf(k);
  const got = await loadFilesOf(which, { fresh: !state.stream || !!state.paused, stamp: view ? stampOf(view.turns) : undefined });
  if (state.files !== f || f.turn !== which.turn) return;   // another actor or turn picked meanwhile: theirs
  f.data = got;
}
// The actor's Chat as last loaded -- its latest turn's files kept (files.ts) and the server's view (data.ts) -- made the
// one shown: true if both are kept, false (nothing changed) if not. Drawn at once when one is picked again, then each
// brought up to date as it comes; together, as one moment's: the turns are not drawn before the view of what they are at.
function showKept(g, c) {
  const k = key(g, c), info = state.home && selectedInfo();
  const f = { key: k, turn: null, sel: null, data: null }, which = filesOf(f, info), data = keptFiles(which);
  if (!data || !viewOf(k)) return false;
  state.files = { ...f, data };
  return true;
}
async function setFilesTurn(n) {
  if (!state.files || !state.files.data) return;
  const last = turnsOf(state.files.key, state.files.data).length - 1;
  state.files.turn = n === null || n >= last ? null : Math.max(0, n);
  useTurns.getState().pick(null);
  await loadFiles();
  keepingPlace(renderMain);
}
// The files and commands at the left, folded to their bar or opened (side/store.ts); folded, the latest turn's, which
// the bar counts. Drawn again by themselves.
function foldSide(fold) {
  useSide.getState().fold(fold);
  if (fold && state.files && state.files.turn !== null) return setFilesTurn(null);
}
// With a panel open above the panes (the top row), a pane's head is put in its Chat view's folded bar, at the other end
// from the numbers, as small icons -- a grip to move the pane by (dragged, or right-clicked: features/layout/panes.js's MOVE_FROM),
// which view, Details, and (panes side by side) the pane's close -- and the head itself hidden (.pane:has(.fl-acts)), its
// room the chat's.
function barActs() {
  if (SNAPSHOT || !topShown()) return null;
  const now = chatView().id;
  const act = (label, title, icon, onclick, pressed = null, cls = "") => el("button", { type: "button", class: `fl-act ${cls}`.trim(),
    title, "aria-label": label, "aria-pressed": pressed === null ? null : pressed ? "true" : "false", onclick }, icon);
  return el("div", { class: "fl-acts", role: "group", "aria-label": "This pane" },
    el("span", { class: "fl-act fl-grip", draggable: "true", title: "Drag or right-click to move",
      "aria-label": "Move this pane" }, strokeIcon(ICONS.move, 14)),
    ...offeredViews().filter((v) => !v.more || v.id === now).map((v) =>
      act(v.name, v.description || v.name, v.icon ? strokeIcon(v.icon, 14) : v.name.slice(0, 1), () => setChatView(v.id), v.id === now)),
    act("Details", DETAILS_TIP, strokeIcon(ICONS.info, 14),
      () => setDetails(!state.details), !!state.details),
    canMinimize() ? act("Minimize the chat", MIN_TIP, strokeIcon(ICONS.minimize, 14), () => setChatMin(true)) : null,
    act("Close this pane", $("pane-close").title, strokeIcon(ICONS.x, 16), () => $("pane-close").click(), null, "close"));
}
// Turns are picked in the conversation at the right; the header only offers going back to the latest.
function filesTools() {
  const d = state.files && state.files.data;
  if (!d || !turnsOf(state.files.key, d).length || state.files.turn === null) return [];
  return [el("button", { type: "button", title: "Show the latest turn", onclick: () => setFilesTurn(null) }, "Latest")];
}
// A call's line, and a call opened, as Chat shows them (side/CallView.tsx), for this page's own drawing of them (a
// minimized pane's history): the same nodes, drawn once.
const callPaths = () => ({ cwd: (selectedInfo() || {}).cwd || "", home: (state.files && state.files.data && state.files.data.home) || "" });
const callLabel = (c, n) => callLabelNode(c, n);
const callView = (call, ran = {}) => callViewNode(call, ran, callPaths());
// The Chat view's frame for the actor shown: React's (src/features/chat/mount.tsx), the same node from draw to draw.
function filesMount({ info, session, running, writable, held }) {
  // the view opened afresh (from another view, or the page's first draw): the conversation and the commands start
  // where they would for a new turn -- the commands at their end, the conversation at its end or at the turn picked
  const afresh = !document.querySelector("#main .files .fl-grid");
  const asking = errorNote(info) || askingNote(info) || answeredNote(info);
  return drawChat(talkFeed(info, session, running, writable, held, asking, afresh), CHAT_HOST);
}
const chatSends = [];                                 // {key, cid, text, at (the page's ms), ran}
// What Chat shows of an actor, as the stream sends it (the server's view, data.ts): kept by the actor; the messages sent
// from here it has now no longer shown as sent; and, the actor's turns moved on, its latest turn's files fetched again,
// then drawn (loadFiles).
function takeChatView(g, c, got) {
  const k = key(g, c), view = viewOrNone(got), has = cidsOf(view);
  useChatData.getState().take(k, view);
  for (let i = chatSends.length - 1; i >= 0; i--) if (chatSends[i].key === k && has.has(chatSends[i].cid)) chatSends.splice(i, 1);
  if (view && state.files && state.files.key === k && state.files.turn === null && state.selected && key(...state.selected) === k)
    loadFiles().then(() => render(), () => {});
}
// the view of an actor -- the selected one's; null before it has come
const chatViewOf = (a) => !!a && !!state.selected && state.selected[1] === a.channel ? viewOf(key(...state.selected)) : null;
const mySends = () => { const k = state.selected && key(...state.selected); return chatSends.filter((m) => m.key === k); };
const AT_WORK = ["opening", "working", "asking"];
// A message as the user typed it, to match what was sent with what is stored (the server gives the user's words as
// typed: harness_kit's): "!echo hi" the same as "! echo hi".
const typedAs = (text) => String(text ?? "").trim().replace(/^!\s*/, "! ");
// whether two say the same: their start, as a stored message is clipped
const sameWords = (a, b) => typedAs(a).slice(0, 200) === typedAs(b).slice(0, 200);
const sendFailed = new Map();                         // per actor (its draft's key): why its last message was not sent
// Whether the message Claude Code took back is in its input box untouched, as sessions.py's `took_back` reads it: what was
// last typed into its terminal, the dashboard's, is the key that stopped the turn, after the call before (`since`).
const takenBack = (info) => { const v = chatViewOf(info); return (v && v.taken_back) || (info && info.taken_back) || null; };
const untouched = (info) => {
  const tb = takenBack(info), s = info && info.session;
  return !!tb && !!s && !!s.stopped_at && s.stopped_at > (tb.since || 0);
};
// Claude Code put the message it was stopped on (Esc before any of its answer came: data.py's `taken_back`) back in its
// input box, out of the conversation -- as Chat shows it too, the message in no turn. Untouched there: in this message
// box too, as the actor's draft -- once, and only where nothing is written for the actor. Sent from here, Claude Code's box is emptied
// first (sessions.py's `took_back`), so the two do not go as one. Once it is no longer there untouched -- sent or changed
// in the terminal, or its process gone -- it is taken out of this box too, if it is still as it was put. What was put,
// by the actor's draft ({at, text}), is kept in the tab as drafts are, so a reload does not put back what was cleared.
const REFILLED_KEY = "ag-dashboard-refilled", refilledHere = {};
function refills() {
  try { const v = JSON.parse(sessionStorage.getItem(REFILLED_KEY)); return v && typeof v === "object" ? v : {}; }
  catch (e) { return refilledHere; }
}
function markRefill(draft, mark) {
  const m = refills();
  if (mark) m[draft] = mark; else delete m[draft];
  try { sessionStorage.setItem(REFILLED_KEY, JSON.stringify(m)); } catch (e) { if (mark) refilledHere[draft] = mark; else delete refilledHere[draft]; }
}
function refill(info, draft) {
  const tb = takenBack(info), mark = refills()[draft], box = document.getElementById("composer-text");
  const mine = box && box.dataset.draft === draft ? box : null;
  if (tb && untouched(info)) {
    if (mark && mark.at === tb.at) return;
    markRefill(draft, { at: tb.at, text: tb.text });
    if (drafts()[draft] || (mine && mine.value)) return;
    keepDraft(draft, tb.text);
    if (mine) { mine.value = tb.text; fitBox(mine); }
  } else if (mark) {
    markRefill(draft, null);
    if (drafts()[draft] !== mark.text) return;
    keepDraft(draft, "");
    if (mine && mine.value === mark.text) { mine.value = ""; fitBox(mine); }
  }
}
// Or a message sent from here into its terminal, pending: its turn under way before the dashboard has heard of it (the
// key waits for the message's Enter: sessions.py's `type`) -- not into a terminal the message opened, which may ask
// first whether to trust the folder, where Esc is "No".
const canInterrupt = (info) => !!info && !!info.session && !!info.session.terminal && info.session.status !== "starting"
  && (["running", "asking"].includes(info.status) || viewAtWork(info) || sentPending(info));   // not a build of its context, idle
const viewAtWork = (a) => { const v = chatViewOf(a); return !!v && AT_WORK.includes(v.current.state) && !(v.opening && v.opening.unseen); };
const sentPending = (info) => !!state.selected && state.selected[1] === info.channel && mySends().some((m) => m.ran);
function interrupt(info) {
  const k = state.selected && key(...state.selected);
  if (!canInterrupt(info) || (state.interrupting && state.interrupting.key === k && Date.now() - state.interrupting.at < 1000)) return false;
  state.interrupting = { key: k, at: Date.now() };
  post("/api/terminal/input", { session_id: info.session.session_id, data: "\u001b" })
    .catch((err) => { state.interrupting = null; setLive(`Not interrupted: ${err.message}`); });
  keepingPlace(renderMain);
  return true;
}
const INTERRUPTING_MS = 10000;                      // "Interrupting…" shown at most this long, if the turn goes on
const isInterrupting = () => !!state.interrupting && !!state.selected && state.interrupting.key === key(...state.selected)
  && Date.now() - state.interrupting.at < INTERRUPTING_MS;
// A turn its session has opened that ag has not stored yet -- the harness has its message (the view's opening, `seen`):
// the actor runs. For an actor, the selected one's.
function opened(a) {
  const v = chatViewOf(a);
  return !!v && !!v.opening && !!v.opening.seen;
}
const talkToEnd = () => { const n = document.querySelector("#main .fl-talk"); if (n) n.scrollTop = n.scrollHeight; };
// What the conversation is drawn from (src/features/chat/types.ts's ChatFeed): the server's view of it, the messages sent
// from here it does not have yet, and how this page shows it now.
function talkFeed(info, session, running, writable, held, asking, afresh) {
  const k = key(...state.selected), f = state.files && state.files.key === k ? state.files : null;
  return { key: k, gatherer: state.selected[0], files: f || {}, data: f && f.data, picked: f ? f.turn : null, home: state.home,
    info, session, view: chatViewOf(info), writable, held, canInterrupt: canInterrupt(info), interrupting: isInterrupting(),
    mine: mySends().map(({ cid, text, at }) => ({ cid, text, at })), earlierTurns, terminalView: CHAT_VIEWS.has("terminal"),
    afresh, snapshot: !!SNAPSHOT, streaming: !!state.stream && !state.paused && !SNAPSHOT, running, details: !!state.details,
    cwd: (info.cwd || (info.session && info.session.cwd)) || "", asking };
}
// What the conversation calls of this page (src/features/chat/types.ts's ChatHost), until those parts move too: the actor's
// stage, a call as the commands show it, an actor's face, a Browser's message, a message's words as matched, the icons;
// and this page's redraw, its files and commands, its views, its Esc.
const CHAT_HOST = Object.freeze({
  atWork, atRest, greeting, bareAvatar, hueInk, envelope, typedAs, sameWords, icons: ICONS, beside: BESIDE_KEY,
  crewFace: (a, coordinator) => crewFace(a, coordinator ? MANAGER : null),
  appWords: (text) => appWordsOf(text),
  foldSide, setFilesTurn, setChatView, barActs, patch,
  interruptOver: () => { state.interrupting = null; },
});
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  CHAT_FEEDS.files = {
    load: loadFiles,
    data: () => state.files && state.selected && state.files.key === key(...state.selected) && state.files.data
      ? { items: turnsOf(state.files.key, state.files.data), pending: [], earlier: false } : null,
    // what it draws from, by which it is -- the files by when they were fetched, the view by which was taken -- not by
    // what they hold, written out at every draw
    signature: () => state.files ? [state.files.key, state.files.turn, filesSeq(state.files.data),
      viewSeq(state.files.key), chatSends.length] : null,
  };
  // The conversation, at the right: src/features/chat/ (ag_dashboard/DESIGN.md, A5), drawn from what talkFeed hands it,
  // calling what CHAT_HOST gives it of this page. What it shows is the server's view of the conversation
  // (ag_dashboard/CHAT_VIEW.md: the stream's `chat`, chat_view.py's), made from one read -- the turns, the latest's state,
  // what waits, the message Esc took back -- by the actor's key (data.ts); and the messages sent from this page's
  // box, each by its id (`cid`), until the view has it, a moment later: the dashboard keeps each from the moment it is sent.
  state.chatSend = async () => false;                    // the message box's send, as the latest draw made it (chatCard)
  // Esc, as in the harness's own terminal: the agent's turn interrupted -- the key typed into the session's terminal, which
  // the dashboard runs. Only while it works or asks (an idle Claude Code takes Esc twice for its rewind; one starting, for
  // "No" to trusting its folder), and once a second. `state.interrupting`: the actor it was sent for, and when.
  state.interrupting = null;
  addChatView({
    // "files": named so once, and kept as its id, with the readers' choices of it
    id: "files", name: "Chat", feed: "files", frame: "files", icon: ICONS.bubble,
    background: false,                                 // drawn under its commands
    greets: true,                                      // says itself that there is no conversation yet
    asking: false,                                     // drawn under its conversation, at the right
    queued: false,                                     // what waits for the turn to end: at its conversation's end, pending
    description: "The conversation, with each turn's files and commands beside it.",
    tools: filesTools,
    render: () => [],
    mount: filesMount,                                 // its frame its own (chatCard): React's
    // its message box React's too (features/chat/Composer.tsx): what is typed the actor's draft, kept as it is typed
    composer: (ctx) => [drawComposer({ actor: key(...state.selected), held: !!ctx.held, send: ctx.send, fit: fitBox, say: setLive })],
  });
}

export {
  FILE_KINDS, callLabel, callView, chatSends, chatViewOf, foldSide, interrupt, mySends, opened, refill, sendFailed,
  setFilesTurn, showKept, takeChatView, talkToEnd, viewAtWork,
};
