// ------------------------------------------------------------------ data
let hidingMoved = false;
async function loadHome() {
  takeHome(SNAPSHOT ? SNAPSHOT.home : await get("/api/home"));
  if (!hidingMoved && !PANE) { hidingMoved = true; await moveHidingToServer(); }
}
async function loadAgent() {
  if (!state.selected || isShell(state.selected[1])) return;
  const [g, c] = state.selected;
  await takeAgent(SNAPSHOT ? SNAPSHOT.agents[key(g, c)] || null
    : await get(`/api/agent?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}`));
}
// The selected agent, fetched or pushed: its calls' counts, and the context of the call shown.
async function takeAgent(agent) {
  state.agent = agent; state.agentVersion = (state.agentVersion || 0) + 1;
  const reads = (state.agent && state.agent.reads) || [];
  for (const r of reads)                             // ag's count of all a call sent, as it counted it then (else as stored now:
    r.counted_tokens = r.recorded_tokens ?? (r.sent_tokens === null || r.sent_tokens === undefined ? null   // its messages,
      : r.sent_tokens + (r.preamble_tokens || 0));                                                          // the preamble where recorded)
  if (!reads.length) { state.readId = null; state.context = null; return; }
  const followLatest = state.readId === null || state.followLatest;
  const want = followLatest ? reads[reads.length - 1].read_id : state.readId;
  state.readId = want;
  state.followLatest = followLatest;
  await loadContext(want);
}
// The transcript feed's events: the newest TRANSCRIPT_ITEMS at first, then each time only those
// after the last one kept, so an event is never listed twice; the pending ones replaced each time.
// One load at a time: a stream message and the reader's own action can ask at once.
let txLoading = Promise.resolve();
function loadTranscript(earlier = false) {
  txLoading = txLoading.then(() => loadTranscriptNow(earlier), () => loadTranscriptNow(earlier));
  return txLoading;
}
async function loadTranscriptNow(earlier) {
  if (!state.selected || SNAPSHOT) return;
  const [g, c] = state.selected, k = key(g, c);
  const url = (q) => `/api/transcript?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}${q}`;
  const take = (got) => {
    const stored = got.items.filter((i) => i.row_id !== null);
    if (got.newest) state.tx.pending = got.items.filter((i) => i.row_id === null);
    return stored;
  };
  if (!state.tx || state.tx.key !== k) {
    const got = await get(url(""));
    if (got.error) { state.tx = null; return; }
    state.tx = { key: k, items: [], pending: [], first_row: null, last_row: 0, earlier: got.earlier };
    state.tx.items = take(got);
  } else if (earlier) {
    if (!state.tx.first_row) return;
    const got = await get(url(`&before=${state.tx.first_row}`));
    if (got.error || state.tx.key !== k) return;
    state.tx.items = [...got.items.filter((i) => i.row_id !== null && i.row_id < state.tx.first_row), ...state.tx.items];
    state.tx.earlier = got.earlier;
  } else {
    for (;;) {                                       // all that came since, a page at a time
      const got = await get(url(`&after=${state.tx.last_row}`));
      if (got.error || state.tx.key !== k) return;
      const stored = take(got).filter((i) => i.row_id > state.tx.last_row);
      state.tx.items.push(...stored);
      if (stored.length) state.tx.last_row = stored[stored.length - 1].row_id;
      if (got.newest || !stored.length) break;
    }
  }
  const items = state.tx.items;
  if (items.length) { state.tx.first_row = items[0].row_id; state.tx.last_row = Math.max(state.tx.last_row, items[items.length - 1].row_id); }
}
const txSignature = () => chatView().feed === "transcript" && state.tx
  ? [state.tx.key, state.tx.items.length, state.tx.last_row, state.tx.first_row, signature(state.tx.pending)] : null;
// The history feed's messages, append-only: the stored ones since the last loaded, then what is pending.
// One load at a time (a stream message and the reader's own action can ask at once), and only rows
// past the last one kept are added: a message is never listed twice.
let chatLoading = Promise.resolve();
function loadChatHistory() {
  chatLoading = chatLoading.then(loadChatHistoryNow, loadChatHistoryNow);
  return chatLoading;
}
// What the chat shows, loaded: the feed its view draws from (chat views, below), for the selected actor --
// any actor: one that cannot be messaged here is shown all the same, without the message box.
async function loadChat() {
  if (!state.selected || SNAPSHOT || isShell(state.selected[1])) return;
  try { await chatFeed().load(); } catch (err) { /* no database yet: the gatherer is made on the first call */ }
}
async function loadChatHistoryNow() {
  if (!state.selected) return;
  const [g, c] = state.selected, k = key(g, c);
  if (!state.chat || state.chat.key !== k) state.chat = { key: k, items: [], pending: [], last_row: 0 };
  let got;
  try { got = await get(`/api/history?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}&from=${state.chat.last_row + 1}`); }
  catch (err) { return; }                           // no database yet: the gatherer is made on the first call
  if (!got || got.error || state.chat.key !== k) return;
  const stored = got.items.filter((i) => i.row_id !== undefined && i.row_id !== null && i.row_id > state.chat.last_row);
  state.chat.items.push(...stored);
  if (stored.length) state.chat.last_row = stored[stored.length - 1].row_id;
  state.chat.pending = got.items.filter((i) => i.row_id === undefined || i.row_id === null);
}
async function loadContext(readId) {
  const [g] = state.selected;
  if (state.context && state.context.read_id === readId && state.context.gatherer === g) return;   // unchanged
  const got = SNAPSHOT ? SNAPSHOT.contexts && SNAPSHOT.contexts[key(g, readId)]
    : await get(`/api/context?gatherer=${encodeURIComponent(g)}&read_id=${readId}`);
  if (state.readId !== readId || !state.selected || state.selected[0] !== g) return;   // another wanted since: a load
  state.context = got ? { ...got, gatherer: g } : null;                                  // that came late is not it
}
// What was last drawn, so an update that brings nothing new draws nothing: no flash, and an open
// table, a scrolled list or a tooltip stays as it is.
const drawn = { agents: null, main: null, who: null };
const signature = (value) => JSON.stringify(value);
// What the list draws from: kept as `drawn.agents` by renderAgents whoever calls it -- a home, or the reader's own
// action, which draws at once -- so a home that only confirms that action draws nothing anew (a row drawn again under
// the pointer as the reader presses it to drag starts no drag). "ago" texts: every 30 s.
const listSignature = () => signature([state.home.gatherers, state.home.hook_servers, state.home.hiding, state.home.titles,
  state.home.saved, state.home.folders, state.home.gatherer_folders, state.home.tasks, state.home.seen, state.home.harnesses, state.home.shells, state.home.branches,
  paneSig(), opened(selectedInfo()), Math.floor(Date.now() / AGO_MS)]);
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
      if (first) state.selected = [first.name, firstAgent(first).channel];
    }
    if (state.selected && !PANE) showActorsApp(...state.selected);   // an app's actor (19-app-actors.js): its panel above
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
document.addEventListener("input", (ev) => {
  if (ev.target && ev.target.id === "composer-text") { lastKey = performance.now(); fitBox(ev.target); keepDraft(ev.target.dataset.draft, ev.target.value); }
}, true);
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
// written whole each time, as the panes' frames share it.
const DRAFTS_KEY = "ag-dashboard-drafts", draftsHere = {};
function drafts() {
  try { const v = JSON.parse(sessionStorage.getItem(DRAFTS_KEY)); return v && typeof v === "object" ? v : {}; }
  catch (e) { return draftsHere; }
}
function keepDraft(k, text) {
  if (!k) return;
  const d = drafts();
  if (text) d[k] = text; else delete d[k];
  try { sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(d)); } catch (e) { /* this page only: draftsHere */ }
}
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
  const view = mainSignature();
  if (userAction || view !== drawn.main) { const end = chatAtEnd(); keepingPlace(renderMain); drawn.main = view; if (end) chatToEnd(); }
  drawWho();
  setLive(SNAPSHOT ? `Snapshot · ${clock(state.home.now, true)}` : state.paused ? "Paused"
    : !state.stream ? "Connecting…" : state.stream.readyState === EventSource.OPEN ? `Live · updated ${clock(Date.now() / 1000)}` : "Reconnecting…");
}
// What the main view draws from: drawn again only when it changed. The selected actor's state among it -- its status, what
// it waits on, why it stopped, what runs in the background (which, not how lately): a turn's end may change only that (its
// answer's end comes after its last words, which the actor's data already had), and its "Working…" would stay.
const mainSignature = () => {
  const info = selectedInfo();
  return signature([state.selected, state.agentVersion, state.readId, state.context && state.context.read_id, info && info.session,
    info && [info.chattable, info.holder],
    info && [statusOf(info)[0], info.failing, info.stopped, info.asking, info.answer, (info.background || []).map((t) => t.id),
      info.taken_back],
    info && info.avatar_hello,
    state.chat && [state.chat.key, state.chat.last_row, state.chat.pending], txSignature(), chatView().id,
    chatFeed().signature ? chatFeed().signature() : null,
    state.details && state.detailsTab, topShown(), chatMin(), canMinimize()]);
};
// The page's state, small under its name: its dot green while live, amber paused, red on an error.
const setLive = (text) => {
  document.getElementById("live").textContent = text;
  const st = /^Live/.test(text) ? "live" : text === "Paused" ? "paused" : /^Not /.test(text) ? "error" : "";
  for (const n of document.querySelectorAll(".state-dot")) n.dataset.state = st;   // the header's, the panel's, the rail's
  document.getElementById("about-btn").title = `${text}. Settings: ag's, and this page's`;
};
// The dashboard's panel: opened by its button, closed by it again, by a click elsewhere, by Esc, or once a
// theme is picked or the Gatherer's model set.
function setAbout(open) {
  document.getElementById("about").hidden = !open;
  document.getElementById("about-btn").setAttribute("aria-expanded", open ? "true" : "false");
}
// Light, dark, or the system's: kept in this browser, the page is dark until one is picked.
const THEME_KEY = "ag-dashboard-theme";
function setTheme(pick, keep) {
  if (pick !== "light" && pick !== "dark") pick = "system";
  if (pick === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = pick;
  for (const b of document.querySelectorAll("[data-theme-pick]")) b.setAttribute("aria-pressed", b.dataset.themePick === pick ? "true" : "false");
  if (keep) { try { localStorage.setItem(THEME_KEY, pick); } catch (e) { /* this page only */ } }
  for (const p of panes.others) p.call("theme", pick);
  window.dispatchEvent(new Event("ag-theme"));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => window.dispatchEvent(new Event("ag-theme")));
// The page's theme as shown, light or dark: the one picked, else the system's. The Editor and the apps' panels (their
// SDK's theme: features/apps/host.ts) take it on.
const shownTheme = () => document.documentElement.dataset.theme
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
// The actor at work in the Chat view: acting out what it does (the stage), or small with its one motion ("simple"); kept in
// this browser, acting until one is picked.
const AVATAR_KEY = "ag-dashboard-avatar";
let avatarMode = "acting";
function setAvatarMode(pick, keep, draw = true) {
  avatarMode = pick === "simple" ? "simple" : "acting";
  for (const b of document.querySelectorAll("[data-avatar-pick]")) b.setAttribute("aria-pressed", b.dataset.avatarPick === avatarMode ? "true" : "false");
  if (keep) { try { localStorage.setItem(AVATAR_KEY, avatarMode); } catch (e) { /* this page only */ } }
  for (const p of panes.others) p.call("avatar", avatarMode);
  if (draw && chatView().id === "files") keepingPlace(renderMain);
}
setAvatarMode((() => { try { return localStorage.getItem(AVATAR_KEY); } catch (e) { return null; } })(), false, false);
document.getElementById("avatar-mode").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-avatar-pick]");
  if (b) setAvatarMode(b.dataset.avatarPick, true);
});
// The Chat's turns before the latest, at first: the user's messages only, a click on one showing the rest ("messages",
// filesTalk) -- all but the latest two the agent answered, the one before them folded once a newer turn has its first
// answer; or each whole, a click on its message folding it. Kept in this browser, messages only until one is picked; a
// pick starts every turn over as it has them.
const EARLIER_KEY = "ag-dashboard-chat-earlier";
let earlierTurns = "messages";
function setEarlierTurns(pick, keep, draw = true) {
  earlierTurns = pick === "whole" ? "whole" : "messages";
  window.agNext.chat.clearFlips();                   // the turns' clicks: Chat's turns (src/features/chat/store.ts)
  for (const b of document.querySelectorAll("[data-earlier-pick]")) b.setAttribute("aria-pressed", b.dataset.earlierPick === earlierTurns ? "true" : "false");
  if (keep) { try { localStorage.setItem(EARLIER_KEY, earlierTurns); } catch (e) { /* this page only */ } }
  for (const p of panes.others) p.call("earlier", earlierTurns);
  if (draw && chatView().id === "files") keepingPlace(renderMain);
}
setEarlierTurns((() => { try { return localStorage.getItem(EARLIER_KEY); } catch (e) { return null; } })(), false, false);
document.getElementById("chat-earlier").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-earlier-pick]");
  if (b) setEarlierTurns(b.dataset.earlierPick, true);
});
setTheme((() => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } })() || "dark", false);
document.getElementById("theme").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-theme-pick]");
  if (b) { setTheme(b.dataset.themePick, true); setAbout(false); }
});
document.getElementById("about-btn").addEventListener("click", () => {
  const open = document.getElementById("about").hidden;
  setAbout(open);
  if (open) window.agNext.settings.load().catch(() => {});
});
document.addEventListener("click", (ev) => { if (!ev.target.closest(".about-wrap, .cfg-file")) setAbout(false); });
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (window.agNext.settings.fileOpen()) { window.agNext.settings.closeFile(); return; }
  setAbout(false);
});

