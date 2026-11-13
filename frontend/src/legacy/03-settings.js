// ------------------------------------------------------------------ ag's settings
// ag's config.toml (settings.py): drawn by the new code now (src/features/settings/), at the top of the panel. What it
// calls of this page, handed to it (src/bridge.ts's AgLegacy).
const $ = (id) => document.getElementById(id);
window.agLegacy = Object.freeze({ setAbout, snapshot: !!SNAPSHOT, pane: !!PANE });
// Redraw the main view where the reader left it: the same tables open, the same lists scrolled.
const atEnd = (n) => n.scrollHeight - n.scrollTop - n.clientHeight < 40;
function keepingPlace(draw) {
  const main = document.getElementById("main");
  const open = [...main.querySelectorAll("details[open][id]")].map((d) => d.id);
  const scrolled = [...main.querySelectorAll("[data-keep]")].map((n) => [n.dataset.keep, n.scrollTop, n.scrollLeft]);
  // a list that follows its end (data-follow), read to its end: kept at its end as it grows
  const following = [...main.querySelectorAll("[data-follow]")].filter(atEnd).map((n) => n.dataset.keep);
  const pageY = window.scrollY;
  const box = document.getElementById("composer-text"), focused = box && document.activeElement === box;
  const typed = box ? [box.dataset.draft, box.value, box.selectionStart, box.selectionEnd] : null;
  // what keeps its own node across draws (a terminal, data-refocus) and had the focus: given it back
  const refocus = document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-refocus]");
  draw();
  if (refocus && refocus.isConnected && refocus.agFocus) refocus.agFocus();
  // the box drawn anew for the same actor: as it was, caret and all (another actor's starts with its own draft)
  const again = document.getElementById("composer-text");
  if (again && typed && again !== box && again.dataset.draft === typed[0]) {
    again.value = typed[1]; fitBox(again);
    if (focused) { again.focus(); again.setSelectionRange(typed[2], typed[3]); }
  }
  for (const id of open) { const d = document.getElementById(id); if (d) d.open = true; }
  for (const [k, top, left] of scrolled) {
    const n = main.querySelector(`[data-keep="${k}"]`);
    if (n) { n.scrollTop = top; n.scrollLeft = left; }
  }
  for (const k of following) { const n = main.querySelector(`[data-keep="${k}"]`); if (n) n.scrollTop = n.scrollHeight; }
  window.scrollTo(0, pageY);
}
// The server's stream for the selected agent: `home`, `agent` and `chat` (what Chat shows of it) at once, then each time one changes
// (the server is woken by ag's notifications). It reconnects by itself, as an EventSource does, and a new stream
// starts with both again, so nothing is missed while it was down. Reopened when the selection
// changes; closed while paused. A message for an agent no longer selected is dropped.
// It goes on the page's one WebSocket with its other streams (src/core/api/stream.ts), not on one of the six
// connections a browser keeps open to a server. The other panes' actors come on it too (`also`, each an `actor`),
// handed to their frames: a frame has no stream of its own, so the server reads the home once for the page.
function connect() {
  if (PANE) { state.stream = PANE.stream; paneUrl(); PANE.shows(window, state.selected); return; }
  if (state.stream) { state.stream.close(); state.stream = null; }
  if (SNAPSHOT || state.paused) return;
  const sel = state.selected, also = actorPanes().filter((p) => !isShell(p.c));   // a shell: nothing to stream but its terminal
  const q = [...(sel && !isShell(sel[1]) ? [`gatherer=${encodeURIComponent(sel[0])}`, `channel=${encodeURIComponent(sel[1])}`] : []),
    ...(also.length ? [`also=${encodeURIComponent(JSON.stringify(also.map((p) => [p.g, p.c])))}`] : [])];
  const es = window.agNext.stream("/api/stream" + (q.length ? "?" + q.join("&") : ""));
  state.stream = es;
  panes.actors.clear();
  const mine = () => state.stream === es;
  es.addEventListener("home", (ev) => { if (mine()) { panesTake("home", ev.data); streamTake("home", ev.data, mine); } });
  es.addEventListener("agent", (ev) => { if (mine()) streamTake("agent", ev.data, mine, sel); });
  es.addEventListener("chat", (ev) => { if (mine()) streamTake("chat", ev.data, mine, sel); });
  es.addEventListener("actor", (ev) => { if (mine()) panesTake("actor", ev.data); });
  es.addEventListener("open", () => { if (mine()) render(); });
  es.addEventListener("error", () => { if (mine() && !state.paused) setLive("Reconnecting…"); });
}

// What the stream says, one message at a time, in order: the home, and the agent of `sel` -- or, in a frame,
// the `actor` its page around it hands it (the stream's, for this pane's actor). In a frame, after its first load.
let streamQueue = Promise.resolve();
function streamTake(name, data, mine = () => true, sel = null) {
  streamQueue = streamQueue.then(async () => {
    if (!mine() || state.paused) return;
    try {
      const got = JSON.parse(data);
      if (name === "home") {
        takeHome(got);
        await loadedSoon(loadChat());                // a session's state: its messages may have moved on too
        if (!panes.checked && !PANE) restorePanes(); // (come before refresh's answer: what the page kept, first)
        if (!state.selected && !PANE) {              // the first agent to appear: shown, and watched
          const first = got.gatherers.find((g) => g.agents.length);
          if (first) {
            state.selected = [first.name, firstAgent(first).channel];
            autoShown = taskKey(...state.selected);   // shown by itself: the tab's as if empty (07-panes.js's viaTabs)
            showActorsApp(...state.selected);        // an app's actor: its panel above (19-app-actors.js)
            await loadAgent(); render(true); connect();
          }
        }
        if (!PANE) startTabs();                      // the tab shown as it was left (07-panes.js)
      } else if (name === "chat") {                   // what Chat shows of the actor: drawn as it comes, nothing to load
        if (!sel || !isAt(state.selected, ...sel)) return;
        takeChatView(sel[0], sel[1], got);
      } else {
        const [g, c, agent] = name === "actor" ? [got.gatherer, got.channel, got.agent] : [...(sel || []), got];
        if (!isAt(state.selected, g, c)) return;     // for an actor no longer shown
        if (name === "actor" && got.chat) takeChatView(g, c, got.chat);
        await loadedSoon(Promise.all([takeAgent(agent), loadChat()]));   // takeAgent keeps the agent at once
      }
      render();
    } catch (err) { setLive(`Not updated: ${err.message}`); }
  });
}
// What a stream message loads besides what it says -- the conversation (loadChat), the context of the agent's newest
// call (takeAgent) -- waited on at most LOAD_WAIT_MS before what it says is drawn, then drawn again once it is loaded.
// A load held up never holds back the actor's status, which the stream brings itself: a browser keeps six
// connections to a server, and the page's streams (its own, a terminal's, the Editor's, its preview's) may hold
// them all, so a fetch waits for one to close -- Chat showed a turn done while its terminal, already streaming,
// worked on, until some stream closed. Messages after it are taken meanwhile, not waiting on loads of their own while
// one is held up (`held`): theirs would be too. A load finishes in its own time, and what it brought is drawn then.
const LOAD_WAIT_MS = 400;
let held = 0;                                        // loads still under way past their wait
function loadedSoon(work) {
  let now = "waiting";                               // then "done" in time, or "late"
  const late = () => { if (now === "waiting") { now = "late"; held++; } };
  const done = work.then(() => {}, () => {}).then(() => {
    if (now === "late") { held--; render(); }
    now = "done";
  });
  if (held) { late(); return Promise.resolve(); }
  return Promise.race([done, new Promise((r) => setTimeout(() => { late(); r(); }, LOAD_WAIT_MS))]);
}

