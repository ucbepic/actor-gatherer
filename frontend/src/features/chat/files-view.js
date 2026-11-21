import { SNAPSHOT, state } from "../../core/page/state.js";
import {
  BESIDE_KEY, ICONS, atRest, atWork, bareAvatar, el, greeting, hueInk, key, selectedInfo, strokeIcon,
} from "../../core/page/helpers.js";
import { earlierTurns, fitBox, loadChat, refresh, render, setLive } from "../page/data.js";
import { $ } from "../settings/panel.js";
import { MANAGER, crewFace, envelope } from "../list/list";
import { DETAILS_TIP, dashboardCommand, setDetails } from "../page/main-view.js";
import { chatToEnd, permissionVerb, permissionView } from "./chat.js";
import { fullscreenFor, term } from "../terminal/terminal.js";
import { CHAT_FEEDS, CHAT_VIEWS, addChatView, chatView, offeredViews, setChatView } from "./views.js";
import { MIN_TIP, canMinimize, chatMin, setChatMin, topShown } from "../layout/top.js";
import { appWordsOf } from "../apps/app-actors.js";
import { drawChat } from "./mount";
import { drawComposer, ownBox } from "./Composer";
import { callLabelNode, callViewNode } from "./side/nodes";
import { FILE_KINDS } from "./side/marks";
import { useSide } from "./side/store";
import { chatOf, pickTurn, showTurn, useActors, viewAtWork as viewAtWorkOf, viewTaken } from "./actors";
import { interrupt as interruptActor } from "./esc";
import { stampOf, turnsOf, useChatData, viewOf, viewOrNone, viewSeq } from "./data";
import { filesSeq, keptFiles, loadFiles as loadFilesOf } from "./files";
import { parse as parseKey } from "../../core/model/keys";

// ------------------------------------------------------------------ the Files view
// The Chat view: the conversation, and beside it a turn's files and commands -- each file the agent read, searched or
// changed in it, the lines it saw at their numbers and its changes in place among them (files.py); every call it made.
// One turn at a time: the latest, followed, unless one is picked. Drawn by the new code (src/features/chat/: Chat.tsx,
// side/), into a frame of each actor's own (mount.tsx), from what this page hands it (talkFeed, CHAT_HOST); loaded here.
// The actor this page shows: the one place where the page's selection (`state.selected`) becomes the actor Chat is drawn
// for, by its key -- everything below is that actor's.
const chatActor = () => (state.selected ? key(...state.selected) : null);
// The files feed: the actor's turn's files and commands (files.ts: fetched when the stream's view says its turns moved
// on, else as kept), for the turn picked (Chat's own, actors.ts's `picked`; null, the latest) -- the data drawn (`data`)
// changed when they come. `state.files` is made anew for each actor picked: the turn list's folds start over with it
// (chat/store.ts's forFiles), and the turn picked of before is let go of.
const filesOf = (f, info, turn = chatOf(f.key).picked) => {
  const { group: gatherer, id: channel } = parseKey(f.key);
  const turns = turnsOf(f.key, f.data), row = turn === null ? null : (turns[turn] || {}).row_id ?? null;
  return { gatherer, channel, turn, row, cwd: (info && (info.cwd || (info.session && info.session.cwd))) || "" };
};
const filesFor = (k, data = null) => { pickTurn(k, null); return { key: k, data }; };
// The files feed loaded for the selected actor -- of the turn picked, or `turn`, to be picked once they come: as kept
// unless the turns moved on (the stream's view, its stamp) -- or, the page not streaming (paused), fetched each time, as
// nothing else says when they move on. True once they are the feed's.
async function loadFiles(turn) {
  const k = chatActor();
  if (!k || SNAPSHOT) return false;
  if (!state.files || state.files.key !== k) state.files = filesFor(k);
  const f = state.files, at = turn === undefined ? chatOf(k).picked : turn, view = viewOf(k);
  const got = await loadFilesOf(filesOf(f, selectedInfo(), at),
    { fresh: !state.stream || !!state.paused, stamp: view ? stampOf(view.turns) : undefined });
  if (state.files !== f || (turn === undefined && chatOf(k).picked !== at)) return false;   // another actor or turn picked meanwhile
  f.data = got;
  return true;
}
// The actor's Chat as last loaded -- its latest turn's files kept (files.ts) and the server's view (data.ts) -- made the
// one shown: true if both are kept, false (nothing changed) if not. Drawn at once when one is picked again, then each
// brought up to date as it comes; together, as one moment's: the turns are not drawn before the view of what they are at.
function showKept(g, c) {
  const k = key(g, c), info = state.home && selectedInfo();
  const which = filesOf({ key: k, data: null }, info, null), data = keptFiles(which);
  if (!data || !viewOf(k)) return false;
  state.files = filesFor(k, data);
  return true;
}
// A turn picked (null: the latest): its files and commands loaded, then shown with it, as one moment's -- Chat draws
// them itself (actors.ts's showTurn); the last pick, if another came meanwhile.
let picking = 0;
async function setFilesTurn(n) {
  const f = state.files;
  if (!f || !f.data) return;
  const last = turnsOf(f.key, f.data).length - 1, turn = n === null || n >= last ? null : Math.max(0, n), mine = ++picking;
  if (await loadFiles(turn) && mine === picking && state.files === f) showTurn(f.key, turn);
}
// The files and commands at the left, folded to their bar or opened (side/store.ts); folded, the latest turn's, which
// the bar counts. Drawn again by themselves.
function foldSide(fold) {
  useSide.getState().fold(fold);
  if (fold && state.files && chatOf(state.files.key).picked !== null) return setFilesTurn(null);
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
// A call's line, and a call opened, as Chat shows them (side/CallView.tsx), for this page's own drawing of them (a
// minimized pane's history): the same nodes, drawn once.
const callPaths = () => ({ cwd: (selectedInfo() || {}).cwd || "", home: (state.files && state.files.data && state.files.data.home) || "" });
const callLabel = (c, n) => callLabelNode(c, n);
const callView = (call, ran = {}) => callViewNode(call, ran, callPaths());
// The Chat view's frame for the actor shown: React's (src/features/chat/mount.tsx), the same node from draw to draw.
function filesMount({ actor, info, session, running, writable, held }) {
  // the view opened afresh (from another view, or the page's first draw): the conversation and the commands start
  // where they would for a new turn -- the commands at their end, the conversation at its end or at the turn picked
  const afresh = !document.querySelector("#main .files .fl-grid");
  return drawChat(talkFeed(actor, info, session, running, writable, held, afresh), CHAT_HOST);
}
// What Chat shows of an actor, as the stream sends it (the server's view, data.ts): kept by the actor; the messages sent
// from here it has now no longer shown as sent (actors.ts); and, the actor's turns moved on, its latest turn's files
// fetched again, then drawn (loadFiles).
function takeChatView(g, c, got) {
  const k = key(g, c), view = viewOrNone(got);
  useChatData.getState().take(k, view);
  viewTaken(k, view);
  if (view && state.files && state.files.key === k && chatOf(k).picked === null && chatActor() === k)
    loadFiles().then(() => render(), () => {});
}
// the view of an actor -- the selected one's; null before it has come
const chatViewOf = (a) => !!a && !!state.selected && state.selected[1] === a.channel ? viewOf(chatActor()) : null;
// what was sent from here to the actor shown that its view does not have yet (actors.ts)
const mySends = () => { const k = chatActor(); return k ? chatOf(k).sends : []; };
// A message as the user typed it, to match what was sent with what is stored (the server gives the user's words as
// typed: harness_kit's): "!echo hi" the same as "! echo hi".
const typedAs = (text) => String(text ?? "").trim().replace(/^!\s*/, "! ");
// whether two say the same: their start, as a stored message is clipped
const sameWords = (a, b) => typedAs(a).slice(0, 200) === typedAs(b).slice(0, 200);
// The actor -- the selected one -- at work as its view has it (actors.ts).
const viewAtWork = (a) => !!chatViewOf(a) && viewAtWorkOf(chatActor());
// Esc for the actor shown (esc.ts): its turn interrupted, if it would be.
const interrupt = (info) => { const k = chatActor(); return !!k && interruptActor(k, info, setLive); };
// A turn its session has opened that ag has not stored yet -- the harness has its message (the view's opening, `seen`):
// the actor runs. For an actor, the selected one's.
function opened(a) {
  const v = chatViewOf(a);
  return !!v && !!v.opening && !!v.opening.seen;
}
// The page's own message boxes for `actor` (not React's, which show its draft as it is kept) showing `text`.
const boxedFor = (actor) => (text) => {
  for (const box of document.querySelectorAll("#composer-text"))
    if (box.dataset.draft === actor && !ownBox(box)) { box.value = text; fitBox(box); }
};
// What a send from this page needs of it (features/chat/send.ts): the actor and its session as now, the dashboard's own
// commands, the size of a terminal the message opens, the page's data loaded again once sent, the Terminal view, the
// page's own message boxes, and the controls of a view's own that send (data-send), off while a message is on its way.
const sendFrom = (actor, info, held) => ({
  info, held: !!held,
  command: (t) => dashboardCommand(t),
  // a terminal the message opens (sessions.py's `send`): the Terminal view's screen, at its size if it was drawn
  opens: () => ({ fullscreen: fullscreenFor(info), ...(term.sid === info.channel && term.opened ? { cols: term.xterm.cols, rows: term.xterm.rows } : {}) }),
  sent: async () => { if (state.paused || !state.stream) await refresh(); else { await loadChat(); render(); } chatToEnd(); },
  toTerminal: CHAT_VIEWS.has("terminal") ? () => setChatView("terminal") : null,
  boxed: boxedFor(actor),
  sending: (on) => { for (const n of document.querySelectorAll("[data-send]")) n.disabled = on || !!held; },
});
// What the conversation is drawn from for `actor` (src/features/chat/types.ts's PageFeed): the server's view of it, its
// turn's files, and how this page shows it now. What Chat keeps of the actor itself -- what was sent from here, the turn
// picked, the Esc sent -- it reads itself (actors.ts).
function talkFeed(actor, info, session, running, writable, held, afresh) {
  const f = state.files && state.files.key === actor ? state.files : null;
  return { key: actor, gatherer: parseKey(actor).group, files: f || {}, data: f && f.data, home: state.home,
    info, session, view: viewOf(actor), writable, held, earlierTurns, terminalView: CHAT_VIEWS.has("terminal"),
    afresh, snapshot: !!SNAPSHOT, streaming: !!state.stream && !state.paused && !SNAPSHOT, running, details: !!state.details,
    cwd: (info.cwd || (info.session && info.session.cwd)) || "" };
}
// What the conversation calls of this page (src/features/chat/types.ts's ChatHost), until those parts move too: the actor's
// stage, a call as the commands show it, an actor's face, a Browser's message, a message's words as matched, the icons;
// a permission's call as the cards show it (asking/Cards.tsx); and this page's data loaded again, its files and commands,
// its views, its Esc.
const CHAT_HOST = Object.freeze({
  atWork, atRest, greeting, bareAvatar, hueInk, envelope, typedAs, sameWords, icons: ICONS, beside: BESIDE_KEY,
  crewFace: (a, coordinator) => crewFace(a, coordinator ? MANAGER : null),
  appWords: (text) => appWordsOf(text),
  // a turn picked, the files and commands folded or shown: this page's actor's (its files feed's)
  foldSide: (actor, fold) => (actor === chatActor() ? foldSide(fold) : undefined),
  setFilesTurn: (actor, n) => (actor === chatActor() ? setFilesTurn(n) : Promise.resolve()),
  setChatView, barActs, permissionVerb, permissionView, refresh: () => refresh(),
});
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  CHAT_FEEDS.files = {
    load: () => loadFiles(),
    data: () => state.files && state.files.key === chatActor() && state.files.data
      ? { items: turnsOf(state.files.key, state.files.data), pending: [], earlier: false } : null,
    // what it draws from, by which it is -- the files by when they were fetched, the view by which was taken -- not by
    // what they hold, written out at every draw; and, minimized, the sends from here its lines show (mini-history.js):
    // whole, Chat draws them itself
    signature: () => state.files ? [state.files.key, chatOf(state.files.key).picked, filesSeq(state.files.data),
      viewSeq(state.files.key), chatMin() ? chatOf(state.files.key).sends.length : null] : null,
  };
  // what Chat keeps of the actor changed: drawn again if the page draws from it (a minimized pane's lines)
  useActors.subscribe(() => { if (chatMin()) render(); });
  // The conversation, at the right: src/features/chat/ (ag_dashboard/DESIGN.md, A5), drawn from what talkFeed hands it,
  // calling what CHAT_HOST gives it of this page. What it shows is the server's view of the conversation
  // (ag_dashboard/CHAT_VIEW.md: the stream's `chat`, chat_view.py's), made from one read -- the turns, the latest's state,
  // what waits, the message Esc took back -- by the actor's key (data.ts); and the messages sent from this page's
  // box, each by its id (`cid`), until the view has it, a moment later: the dashboard keeps each from the moment it is sent.
  state.chatSend = async () => false;                    // the message box's send, as the latest draw made it (chatCard)
  addChatView({
    // "files": named so once, and kept as its id, with the readers' choices of it
    id: "files", name: "Chat", feed: "files", frame: "files", icon: ICONS.bubble,
    background: false,                                 // drawn under its commands
    greets: true,                                      // says itself that there is no conversation yet
    asking: false,                                     // drawn under its conversation, at the right
    queued: false,                                     // what waits for the turn to end: at its conversation's end, pending
    description: "The conversation, with each turn's files and commands beside it.",
    chatTools: true,                                   // its tools in the header Chat's own (Controls.tsx: "Latest")
    render: () => [],
    mount: filesMount,                                 // its frame its own (chatCard): React's
    // its message box React's too (features/chat/Composer.tsx): what is typed the actor's draft, kept as it is typed
    composer: (ctx) => [drawComposer({ actor: ctx.actor, held: !!ctx.held, send: ctx.send, fit: fitBox, say: setLive })],
  });
}

export {
  CHAT_HOST, FILE_KINDS, boxedFor, callLabel, callView, chatActor, chatViewOf, foldSide, interrupt, mySends, opened,
  sendFrom, setFilesTurn, showKept, takeChatView, viewAtWork,
};
