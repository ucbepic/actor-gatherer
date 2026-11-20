import { PANE, PANE_URL, state } from "../../core/page/state.js";
import { ICONS, selectedInfo } from "../../core/page/helpers.js";
import { drawn, loadChat, render } from "../page/data.js";
import { keepingPlace } from "../settings/panel.js";
import { paneUrl } from "../layout/panes.js";
import { renderMain } from "../page/main-view.js";
import { backgroundNote, chatToEnd } from "./chat.js";
import { chatActor } from "./files-view.js";
import { viewOpened } from "../history/store";
import { chatMin } from "../layout/top.js";
import * as prefs from "../../core/prefs";
import { drawMessages, typeChipsNode } from "../details/mount";
import { eventsOf, loadEvents } from "../details/events";
import { drawTranscript, notesSwitchNode } from "../transcript/mount";
import { loadTranscript, txFeedOf } from "../transcript/data";

// ------------------------------------------------------------------ chat views
// How the chat shows an actor's history: one VIEW of several, the reader's choice (kept in this
// browser). A view names the FEED it draws from and draws it; the tab loads that feed, gives the view a
// frame that follows its newest, and adds what waits to be sent and the box to write the next (for an actor
// that can be messaged here).
//
// A view is added with agDashboard.chatView({...}): here, or from a file of its own in
// <home>/dashboard/views/*.js, which the page loads when it starts (server.py: /api/views):
//
//   agDashboard.chatView({
//     id: "bubbles",                    // unique; the reader's choice is kept by it
//     name: "Bubbles",                  // on the switch
//     icon: "M2 4h12M2 8h12M2 12h8",    // optional: its icon beside its name, an SVG path in a 16x16 box, stroked
//     more: true,                       // optional: not on the bar but with the history's other views, in Details
//     readOnly: true,                   // optional: a view to read the history by -- no message box under it, and
//                                       // what the agent waits on the user for shown, not answered there
//     description: "User and assistant messages only.",
//     feed: "history",                  // what it draws (CHAT_FEEDS): "history", the gatherer's events --
//                                       // {row_id, name (its type), text, tokens, at, clipped};
//                                       // "transcript", each event's parts as the Transcript view draws
//                                       // them -- {row_id, type, at, parts: [{kind, role, text, ...}]};
//                                       // "files", the turns and the picked turn's files (files.py);
//                                       // or "none", for a view that is not the history (the Terminal)
//     frame: "ctx",                     // the frame's class: "ctx" (the list's), "term" (the terminal's), or your own
//     background: true,                 // optional: what runs in the background (backgroundNote) under the frame;
//                                       // false to draw it itself (api.backgroundNote(ctx.info), or (.., true) as a
//                                       // terminal's status line) or not at all. By default, under any view of the
//                                       // history but a "term" one
//     asking: false,                    // optional: false to draw what the agent waits on the user for, and the call
//                                       // it stopped on, itself (api.askingNote(ctx.info), api.errorNote(ctx.info));
//                                       // by default under the frame of a view of the history
//     queued: false,                    // optional: false to draw what waits for the agent's turn to end
//                                       // (ctx.queued) itself; by default listed after the view's blocks
//     greets: true,                     // optional: to say itself that there is no conversation yet; by
//                                       // default "No messages yet" after the view's blocks
//     tools(ctx) { return [nodes] },    // optional: controls in the page's header (filters, switches)
//     render(ctx) { return node or [nodes] },
//     composer(ctx) { return node },    // optional: the box to write the next message, under the frame;
//                                       // without it, a text box and a Send button (defaultComposer)
//     footer(ctx) { return node },      // optional: under the message box, at the bottom of the page
//     chat: false,                      // optional: a view that is not the conversation (the History) --
//                                       // no message box under it, and nothing it did not draw itself
//   });
//
// `ctx`: {actor (its key), info (the actor), session (its row: status, cwd, ...), data: {items, pending (what the model
// answered that no call has stored yet: row_id null), earlier (older items not loaded)}, running,
// queued, noneYet (what a view says while there is nothing yet), held (why the session cannot be messaged here -- another process has it open -- or ""), writable
// (whether it can be messaged from here at all),
// loadEarlier(), rerender(), api (agDashboard: el, markdown, the page's other helpers)}, and for
// a composer: input(attrs), the text box to build it around (Enter sends, Shift+Enter a new line, what
// is typed kept across redraws), and send(text), which sends it, clears the box, and shows an error
// under the composer when the send fails (true when it was sent). Controls marked data-send are
// disabled while a message is being sent, and while the session is held. A view that throws is shown as having failed; the others
// still work.
const CHAT_VIEWS = new Map();
const CHAT_VIEW_KEY = "ag-dashboard-chat-view";
// A view with `when(info)` is offered only to the actors it says. An app's actor (features/apps/app-actors.js) is shown as any
// actor is: its app's panel is above the panes.
const offeredTo = (v, info) => !!v && (!v.when || !!v.when(info));
// The views offered to the selected actor, those for it alone (`when`) first.
const offeredViews = () => [...CHAT_VIEWS.values()].filter((v) => offeredTo(v, selectedInfo()))
  .sort((a, b) => (b.when ? 1 : 0) - (a.when ? 1 : 0));
const chatView = () => {
  const info = selectedInfo(), v = CHAT_VIEWS.get(state.chatViewId);
  return offeredTo(v, info) ? v : CHAT_VIEWS.get("files");
};
async function setChatView(id) {
  if (id === "history" && chatView().id !== "history") viewOpened();   // opened again: built again
                                                     // if due, and at its tasks if it has them
  state.chatViewId = id;
  if (PANE) { paneUrl(); PANE.viewed(window, id); }  // a frame's: kept with its pane, not as every page's
  else prefs.setText(CHAT_VIEW_KEY, id);
  await loadChat();
  keepingPlace(renderMain);
  chatToEnd();
}
function addChatView(view) {
  if (!view || typeof view.id !== "string" || typeof view.render !== "function")
    throw new Error("a chat view needs an id and a render(ctx)");
  if (!CHAT_FEEDS[view.feed || "history"]) throw new Error(`no feed ${view.feed}: one of ${Object.keys(CHAT_FEEDS).join(", ")}`);
  CHAT_VIEWS.set(view.id, { name: view.id, feed: "history", background: view.feed !== "none" && view.frame !== "term", ...view });
  if (state.home) { drawn.main = null; loadChat().then(() => render()); }
}
// What a view can draw from: each loads its data for the selected session, and says what it has.
const CHAT_FEEDS = {
  // the actor's events, a row each (features/details/events.ts)
  history: {
    load: () => loadEvents(chatActor()),
    data: () => { const f = eventsOf(chatActor()); return f ? { items: f.items, pending: f.pending, earlier: false } : null; },
  },
  // each event's parts, as the Transcript draws them (features/transcript/data.ts)
  transcript: {
    load: () => loadTranscript(chatActor()),
    loadEarlier: () => loadTranscript(chatActor(), true),
    data: () => { const f = txFeedOf(chatActor()); return f ? { items: f.items, pending: f.pending, earlier: f.earlier } : null; },
  },
  none: { load: async () => {}, data: () => ({ items: [], pending: [], earlier: false }) },
};
const chatFeed = (view = chatView()) => (chatMin() ? CHAT_FEEDS.files : CHAT_FEEDS[view.feed]) || CHAT_FEEDS.history;
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  state.chatViewId = (PANE && PANE_URL.get("view")) || prefs.text(CHAT_VIEW_KEY) || "files";
  // "agent": what ag recorded of the actor's calls -- each read (items) -- loaded with the actor already.
  CHAT_FEEDS.agent = {
    load: async () => {},
    data: () => state.agent && state.agent.reads ? { items: state.agent.reads, pending: [], earlier: false } : null,
  };

  // The views that come with the page: each draws its frame itself, React's (`mount`), with what waits for the turn to
  // end and that there is nothing yet in it.
  addChatView({
    id: "messages", name: "Messages", feed: "history", frame: "ctx", icon: ICONS.list, more: true, readOnly: true,
    description: "The session's events, one row each, filtered by type.", queued: false, greets: true,
    tools: () => typeChipsNode(null),
    render: () => [],
    mount: ({ actor, data, queued, noneYet }) => drawMessages({ key: actor, items: data.items, pending: data.pending,
      queued, noneYet }, "Messages"),
  });
  addChatView({
    id: "transcript", name: "Transcript", feed: "transcript", frame: "term", icon: ICONS.page, more: true, readOnly: true,
    description: "The conversation as its harness's terminal shows it.", queued: false, greets: true,
    tools: () => notesSwitchNode(),
    render: () => [],
    mount: ({ actor, info, data, running, queued, noneYet, loadEarlier }) => drawTranscript({ key: actor, items: data.items,
      pending: data.pending, earlier: !!data.earlier, running, failing: info.failing || null, last: info.last ?? null,
      cwd: info.cwd || "", background: backgroundNote(info, true), queued, noneYet, loadEarlier }, "Transcript"),
  });
}

export { CHAT_FEEDS, CHAT_VIEWS, CHAT_VIEW_KEY, addChatView, chatFeed, chatView, offeredViews, setChatView };
