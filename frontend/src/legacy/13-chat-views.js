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
// `ctx`: {info (the actor), session (its row: status, cwd, ...), data: {items, pending (what the model
// answered that no call has stored yet: row_id null), earlier (older items not loaded)}, running,
// queued, held (why the session cannot be messaged here -- another process has it open -- or ""), writable
// (whether it can be messaged from here at all),
// loadEarlier(), rerender(), api (agDashboard: el, markdown, the page's other helpers)}, and for
// a composer: input(attrs), the text box to build it around (Enter sends, Shift+Enter a new line, what
// is typed kept across redraws), and send(text), which sends it, clears the box, and shows an error
// under the composer when the send fails (true when it was sent). Controls marked data-send are
// disabled while a message is being sent, and while the session is held. A view that throws is shown as having failed; the others
// still work.
const CHAT_VIEWS = new Map();
const CHAT_VIEW_KEY = "ag-dashboard-chat-view";
state.chatViewId = (PANE && PANE_URL.get("view")) || (() => { try { return localStorage.getItem(CHAT_VIEW_KEY) || "files"; } catch (e) { return "files"; } })();
// A Browser's actor (bwKey) opens in the Browser's view each time it is selected; another picked for it (its Terminal,
// say) lasts while it stays selected, apart from the other actors' choice. A view with `when(info)` is offered only to
// the actors it says (the Browser's, to theirs). An app's actor (19-app-actors.js) is shown as any actor is: its app's
// panel is above the panes.
const KIND_VIEWS = { browser: "browser" };
const kindViewId = { ...KIND_VIEWS };              // the view each kind's actor is shown in, while selected
const kindOf = (info) => bwKey(info) ? "browser" : null;
const offeredTo = (v, info) => !!v && (!v.when || !!v.when(info));
// The views offered to the selected actor, those for it alone (`when`) first.
const offeredViews = () => [...CHAT_VIEWS.values()].filter((v) => offeredTo(v, selectedInfo()))
  .sort((a, b) => (b.when ? 1 : 0) - (a.when ? 1 : 0));
const chatView = () => {
  const info = selectedInfo(), kind = kindOf(info);
  const v = CHAT_VIEWS.get(kind ? kindViewId[kind] : state.chatViewId);
  return offeredTo(v, info) ? v : CHAT_VIEWS.get(kind && CHAT_VIEWS.has(KIND_VIEWS[kind]) ? KIND_VIEWS[kind] : "files");
};
async function setChatView(id) {
  if (id === "history" && chatView().id !== "history") hist.askedFor = hist.group = hist.stay = null;   // opened again: built again
                                                     // if due, and at its tasks if it has them
  const kind = kindOf(selectedInfo());
  if (kind) kindViewId[kind] = id;                   // a DocWriter's, a Browser's actor: while it stays selected
  else {
    state.chatViewId = id;
    if (PANE) { paneUrl(); PANE.viewed(window, id); }  // a frame's: kept with its pane, not as every page's
    else try { localStorage.setItem(CHAT_VIEW_KEY, id); } catch (e) { /* this page only */ }
  }
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
  history: {
    load: loadChatHistory,
    data: () => state.chat && state.selected && state.chat.key === key(...state.selected)
      ? { items: state.chat.items, pending: state.chat.pending, earlier: false } : null,
  },
  transcript: {
    load: () => loadTranscript(),
    loadEarlier: () => loadTranscript(true),
    data: () => state.tx && state.selected && state.tx.key === key(...state.selected)
      ? { items: state.tx.items, pending: state.tx.pending, earlier: state.tx.earlier } : null,
  },
  none: { load: async () => {}, data: () => ({ items: [], pending: [], earlier: false }) },
};
// "agent": what ag recorded of the actor's calls -- each read (items), and the context the chart has picked
// (state.context) -- loaded with the actor already.
CHAT_FEEDS.agent = {
  load: async () => {},
  data: () => state.agent && state.agent.reads ? { items: state.agent.reads, pending: [], earlier: false } : null,
};
const chatFeed = (view = chatView()) => (chatMin() ? CHAT_FEEDS.files : CHAT_FEEDS[view.feed]) || CHAT_FEEDS.history;

// The views that come with the page.
addChatView({
  id: "messages", name: "Messages", feed: "history", frame: "ctx", icon: ICONS.list, more: true, readOnly: true,
  description: "The session's events as the gatherer has them, one row each, filtered by type.",
  tools: () => typeChips(null),
  render: ({ data }) => {
    const items = [...data.items, ...data.pending].map((i) => ({ ...i, group: "Recent history" }));
    const listed = items.filter((it) => shownTypes.has(itemType(it)[0]));
    return [columns(), el("div", { class: "run" }, el("strong", { text: "Messages" }),
      el("span", { text: tally(items.length, listed.length, items.reduce((n, i) => n + i.tokens, 0), listed.reduce((n, i) => n + i.tokens, 0), "message") })),
      ...(msgRows.begin(signature(state.selected)), listed.map((it) => it.row_id === null || it.row_id === undefined ? contextItem(it)
        : msgRows.get(it.row_id, `${it.tokens}:${it.clipped}:${it.text.length}`, () => contextItem(it))))];
  },
});
const txBlocks = blockCache(), msgRows = blockCache();
addChatView({
  id: "transcript", name: "Transcript", feed: "transcript", frame: "term", icon: ICONS.page, more: true, readOnly: true,
  description: "The conversation as its harness's terminal shows it.",
  tools: () => notesSwitch(),
  render: ({ info, data, running, loadEarlier }) => {
    state.txCwd = info.cwd || "";
    txBlocks.begin(signature([state.selected, showNotes, state.txCwd]));
    return [
      data.earlier ? el("button", { type: "button", class: "earlier", onclick: loadEarlier }, "Load earlier messages") : null,
      ...transcriptBlocks([...data.items, ...data.pending], running, txBlocks),
      running ? el("div", { class: "status-line" }, el("span", { class: "spin", "aria-hidden": "true" }),
        ...(info.failing ? ["Retrying…", agoEl("last try", info.failing.at)] : ["Working…", agoEl("last activity", info.last)])) : null,
      backgroundNote(info, true),
    ].filter(Boolean);
  },
});

