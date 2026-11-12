// ------------------------------------------------------------------ the top row, as the actors' panes see it
// Above the panes, the apps' panels (07-panes.js's top row): whether it shows any (topShown), and the chat minimized
// under the row. A pane's frame asks this page (window.agTop).
const ED_HEIGHT_KEY = "ag-dashboard-editor-height";
const topShown = () => PANE ? !!(window.parent.agTop && window.parent.agTop.shown())
  : !!(panes.apps && panes.apps.some((p) => !p.held));
// Drawn with the main view: the column's chat minimized, or not.
function topMount() {
  if (PANE || SNAPSHOT) return;
  const work = document.querySelector(".work"), min = chatMin();
  if (work.classList.contains("chat-min") === min) return;
  work.classList.toggle("chat-min", min);
  placeWork();                                       // the panes below as tall as their message boxes, or as before
}
// A panel opened or closed in the top row: the chat minimized under it shown again once the row is empty -- here and in
// each pane's frame.
let topWas = null;
function topChanged() {
  if (PANE || SNAPSHOT) return;
  placeWork();
  markSeen();                                        // an app's panel shown: its notifications seen
  const now = topShown();
  if (!now && state.chatMin) keepMin(false);
  for (const p of panes.others) p.call("toprow", now);
  if (now === topWas) { keepingPlace(renderMain); drawn.main = mainSignature(); return; }
  topWas = now;
  minRedraw();
}
if (!PANE && !SNAPSHOT) window.agTop = Object.freeze({ shown: () => topShown(), min: () => !!state.chatMin, setMin: setChatMin });
// The chat minimized under the top row: each pane only its message box, the actor's status at its right -- its avatar,
// moving while it works, done with a check, a mark while it waits on the reader or stopped on an error -- and under it the
// latest turn's commands and the lines its changes added and removed; the top row the rest of the column. One choice for
// every pane (they share the row under it), kept in this browser while the row shows a panel; closed, the chat comes back.
const MIN_KEY = "ag-dashboard-chat-min";
const MIN_TIP = "Minimize the chat: only its message box and the actor's status, under the panels above";
state.chatMin = !PANE && !SNAPSHOT && (() => { try { return localStorage.getItem(MIN_KEY) === "1"; } catch (e) { return false; } })();
const chatMin = () => !SNAPSHOT && topShown()
  && (PANE ? !!(window.parent.agTop && window.parent.agTop.min()) : !!state.chatMin);
function keepMin(on) {
  state.chatMin = on;
  try { localStorage.setItem(MIN_KEY, on ? "1" : ""); } catch (e) { /* this page only */ }
}
function setChatMin(on) {
  if (PANE) { if (window.parent.agTop) window.parent.agTop.setMin(on); return; }
  keepMin(on);
  for (const p of panes.others) p.call("minimized", on);
  minRedraw();
}
// This page's pane minimized or shown again: its counts are the latest turn's, from the files' feed (chatFeed) -- then, shown
// again, its view's own feed.
async function minRedraw() {
  if (chatMin() && state.files && state.files.turn !== null) { state.files.turn = null; state.files.sel = null; }
  topMount();
  await loadChat();
  keepingPlace(renderMain);
  drawn.main = mainSignature();
  if (!chatMin()) chatToEnd();
}
// The view a minimized pane draws in place of its own (chatCard): no history, the message box, and miniFoot.
const MINI_VIEW = { id: "mini", name: "Chat", feed: "files", mini: true, background: false, queued: false, greets: true,
  render: () => [], footer: (ctx) => miniFoot(ctx) };
const miniBack = () => el("button", { type: "button", class: "mini-back", title: "Show the chat again", "aria-label": "Show the chat again",
  onclick: () => setChatMin(false) }, strokeIcon(ICONS.restore, 14));
const miniFoot = (ctx) => [miniBack(), actorStatus(ctx, () => setChatMin(false))];
// The actor's status, small, at the right of a message box with no conversation over it -- a minimized pane's (miniFoot), a
// Browser's: its avatar moving while it works, or while a message sent from here waits to open its turn, ✓ when the turn is
// done, ?/! when it asks or failed; under it the latest turn's commands and lines changed (from the files' feed). Pressed:
// `show`, the chat.
function actorStatus({ info, running }, show) {
  const d = state.files && state.selected && state.files.key === key(...state.selected) ? state.files.data : null;
  const [st0, word0] = statusOf(info);
  // working: its turn, or a message sent from here that has yet to open one -- for a while: not seen for long, its terminal
  // may be asking something first (pendingTalk), and the status says so
  const v = chatViewOf(info), mine = mySends(), unseen = !running && !!(v && v.opening && v.opening.unseen);
  if (v && v.opening && !mine.length) mine.push(v.opening);   // a message on its way to open the next turn
  // the latest turn, as loaded -- none while a message sent from here waits to open the next: its numbers are not that one's
  const t = d && d.turns.length && d.turn === d.turns.length - 1 && !(mine.length && !running) ? d.turns[d.turn] : null;
  const live = running || (mine.length > 0 && !unseen);
  const [st, word] = unseen ? ["asking", "Pending · not seen by the session yet; its terminal may be asking something first"] : [st0, word0];
  const cmds = t ? d.commands : [], failed = cmds.filter((c) => c.error).length;
  const lines = t ? addChanged(d.files.filter((f) => (showTmp || !f.temporary) && (showGit || !gitOnly(f))).map((f) => f.changed)) : null;
  const src = bareAvatar(info);
  const mark = { asking: ["ask", "?"], error: ["err", "!"], failed: ["err", "!"], background: ["bg", ""] }[st];
  const pic = live ? (src ? buddy(info, !!info.failing) : el("span", { class: "spin", "aria-hidden": "true" }))
    : t && ["idle", "finished", "closed"].includes(st) ? atRest(info, t.row_id)
    : src ? el("span", { class: "still", "data-sig": signature([src, st]) }, el("img", { src, alt: "", draggable: "false" }),
      mark ? el("span", { class: "mk " + mark[0], text: mark[1] }) : null)
    : null;
  const said = [live ? (info.failing ? "Retrying" : "Working") : word,
    t ? plural(cmds.length, "command") + (failed ? `, ${full(failed)} failed` : "") : null,
    lines ? `${plural(lines[0], "line")} added, ${full(lines[1])} removed` : null].filter(Boolean).join(" · ");
  return el("button", { type: "button", class: "mini-st" + (live ? " live" : ""), "data-morph": "",
    title: `${said}. Show the chat`, "aria-label": `${said}. Show the chat`, onclick: show },
    el("span", { class: "pic", "data-morph": "" }, pic),
    el("span", { class: "n" }, t ? el("span", { class: "c" + (failed ? " err" : "") }, strokeIcon(ICONS.terminal, 11), full(cmds.length)) : null,
      lines && lines[0] ? el("span", { class: "chg-a", text: `+${full(lines[0])}` }) : null,
      lines && lines[1] ? el("span", { class: "chg-r", text: `−${full(lines[1])}` }) : null));
}
// A shell's pane, minimized: what it is, and the way back.
function shellMini(id) {
  const sh = shellOf(id);
  return el("section", { class: "chat mini shell", "aria-label": "Terminal", "data-for": signature([id, "mini"]) }, miniBack(),
    el("span", { class: "mini-sh" }, strokeIcon(ICONS.terminal, 13), el("span", { text: sh ? `Terminal · ${shellPath(sh)}` : "Terminal" })));
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
// The top row's height, as dragged (null: never, half the column); set again (a task entered as it was left: 07-panes.js's
// taskLooks; 0: as never dragged), no taller than the column leaves the panes below their room, and kept as dragged
function topHeight() {
  const h = topRowEl() ? parseFloat(topRowEl().style.getPropertyValue("--ed-h")) : NaN;
  return h > 0 ? h : null;
}
function setTopHeight(h) {
  const top = topRowEl();
  if (!top || !(h >= 0) || (h || null) === topHeight()) return;
  if (!h) {
    top.style.removeProperty("--ed-h");
    try { localStorage.removeItem(ED_HEIGHT_KEY); } catch (e) { /* this page only */ }
    placeWork();
    return;
  }
  const room = top.parentElement ? top.parentElement.getBoundingClientRect().height : 0;
  const to = Math.round(room > 360 ? Math.max(140, Math.min(h, room - 220)) : h);
  top.style.setProperty("--ed-h", `${to}px`);
  try { localStorage.setItem(ED_HEIGHT_KEY, String(to)); } catch (e) { /* this page only */ }
  placeWork();
}
// The top row's height as it was dragged, kept in this browser: set as the page opens
function keepTopHeight(top) {
  try { const h = Number(localStorage.getItem(ED_HEIGHT_KEY)); if (h > 0) top.style.setProperty("--ed-h", `${h}px`); } catch (e) { /* this page only */ }
}
// The band under the top row dragged (07-panes.js's workResized): the row as tall as it puts it, kept once let go
function dragTopHeight(h, done) {
  topRowEl().style.setProperty("--ed-h", `${h}px`);
  if (done) try { localStorage.setItem(ED_HEIGHT_KEY, String(h)); } catch (e) { /* this page only */ }
  placeWork();
}
