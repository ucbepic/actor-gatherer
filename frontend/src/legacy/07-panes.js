// ------------------------------------------------------------------ panes
// Actors side by side. A click in the list shows its actor in the pane in focus; Ctrl+click (⌘+click on a
// Mac, where Ctrl+click is a right click) opens it in a new pane at that one's right, up to MAX_PANES. An actor
// open in a pane already is not opened twice: its pane is focused. A click in a pane focuses it; its × closes
// it; the bar between two resizes them (a double click: all even). The first pane is this page's own view
// (state.selected, panes.here); each other is this page again in a frame (PANE), showing one actor in its own
// view, its controls in its pane's head, its updates handed to it from this page's one stream (connect). Kept
// in this browser while there is more than one; with one, the page is as it always was.
const MAC = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");
const BESIDE_KEY = MAC ? "⌘" : "Ctrl";
panes.here = { node: document.getElementById("pane-here"), size: 1 };
panes.focus = panes.here;
function isAt(sel, g, c) { return !!sel && sel[0] === g && sel[1] === c; }
function allPanes() { return [panes.here, ...panes.others]; }
const actorPanes = () => panes.others;           // every pane is an actor's: apps' panels are in the top row (below)
// The actors open in this page's panes, this page's own first; the one in the pane in focus.
function openActors() { return PANE ? [] : [...(state.selected ? [state.selected] : []), ...actorPanes().map((p) => [p.g, p.c])]; }
function focusedActor() {
  const p = panes.focus;
  return p === panes.here || !panes.others.includes(p) ? state.selected : [p.g, p.c];
}
function paneSig() { return [state.selected, panes.others.map((p) => [p.g, p.c]), allPanes().indexOf(panes.focus)]; }
function paneOf(win) { return panes.others.find((p) => p.frame.contentWindow === win) || null; }
// A row of the list clicked: shown in the pane in focus, or (Ctrl/⌘) beside it.
function pick(g, c, ev) { return ev && (ev.ctrlKey || ev.metaKey) && !SNAPSHOT ? openBeside(g, c) : show(g, c); }
function pickBeside(g, c, ev) {
  if (!MAC || !ev.ctrlKey || SNAPSHOT || ev.target.closest(".close-btn, .save-btn")) return;   // a Mac's Ctrl+click: a right click, no click after it
  ev.preventDefault();
  openBeside(g, c);
}
// The actor in the pane in focus -- in `view`, if given; one open already, its pane focused instead.
async function show(g, c, view = null) {
  const there = actorPanes().find((p) => isAt([p.g, p.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null);
  const p = there || panes.focus;
  if (p !== panes.here) {
    focusPane(p);
    if (!there) { Object.assign(p, { g, c, view: view || p.view }); savePanes(); connect(); renderAgents(); p.call("select", g, c, view); }
    else if (view) p.call("view", view);
    return;
  }
  focusPane(panes.here);
  if (there) { if (view) await setChatView(view); return; }
  if (view) setViewHere(view);
  await select(g, c);
}
function setViewHere(id) {
  state.chatViewId = id;
  try { localStorage.setItem(CHAT_VIEW_KEY, id); } catch (e) { /* this page only */ }
}
function openBeside(g, c) {
  if (PANE || SNAPSHOT || !state.selected) return show(g, c);
  const there = actorPanes().find((p) => isAt([p.g, p.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null);
  if (there) return focusPane(there);
  if (allPanes().length >= MAX_PANES) return paneNote(`At most ${MAX_PANES} actors side by side: close one (its ×) to open another.`);
  const from = panes.focus, at = from === panes.here ? 0 : panes.others.indexOf(from) + 1;
  const p = addPane(g, c, from === panes.here ? chatView().id : from.view, at);
  focusPane(p);
  layout(); savePanes(); connect();
}
// A pane of its own for an actor, its frame put at `at` among the others. Nothing else on the page is moved:
// a frame moved is a frame loaded again.
function addPane(g, c, view, at, size = 1) {
  const p = { g, c, view: view || null, size, ready: false };
  const q = new URLSearchParams({ pane: "1", gatherer: g, channel: c, ...(view ? { view } : {}) });
  p.frame = el("iframe", { src: `/?${q}`, title: isShell(c) ? `Terminal in ${g}` : `Actor ${c} of ${g}` });
  p.node = el("section", { class: "pane" }, p.frame);
  p.gutter = gutterFor(p);
  p.call = (what, ...args) => {                      // what the frame's page does when asked (agPane, its paneReady)
    let api = null;
    try { api = p.ready && p.frame.contentWindow && p.frame.contentWindow.agPane; } catch (e) { /* gone */ }
    return api && api[what] ? api[what](...args) : undefined;
  };
  const before = panes.others[at] ? panes.others[at].gutter : null;
  document.getElementById("panes").insertBefore(p.gutter, before);
  document.getElementById("panes").insertBefore(p.node, before);
  panes.others.splice(at, 0, p);
  return p;
}
function closePane(p) {
  const i = panes.others.indexOf(p);
  if (i < 0) return;
  panes.others.splice(i, 1);
  p.gutter.remove(); p.node.remove();                // its page goes, and its terminal's stream; the session stays
  topRow(p, null);
  if (panes.focus === p) focusPane(panes.others[i - 1] || panes.here);
  layout(); savePanes(); connect(); renderAgents();
}
// This page's own pane closed: the next pane's actor (and view) moves into it, its frame gone.
async function closeHere() {
  const next = actorPanes()[0];
  if (!next) return;
  panes.others.splice(panes.others.indexOf(next), 1);
  next.gutter.remove(); next.node.remove();
  topRow(next, null);
  panes.here.size = next.size;
  if (next.view) setViewHere(next.view);
  focusPane(panes.here);
  layout();
  await select(next.g, next.c);
}
function focusPane(p) {
  if (!p || panes.focus === p) return;
  panes.focus = p;
  for (const q of allPanes()) q.node.classList.toggle("focused", q === p);
  for (const q of panes.others) q.call("focused", q === p);
  savePanes();
  appsSelected();
  if (state.home) renderAgents();
}
// The panes' widths (each its share, `size`), which is in focus, and whether the page is split at all: split,
// each pane's head says whose it is, and has its ×.
function layout() {
  const split = panes.others.length > 0;
  document.getElementById("panes").classList.toggle("split", split);
  for (const p of allPanes()) { p.node.style.flexGrow = split ? String(p.size) : ""; p.node.classList.toggle("focused", p === panes.focus); }
  drawn.who = null; drawWho();
}
// The page's top row -- the page's name at the left, each pane's head -- as tall as the tallest of them, so the
// rule under it runs straight across the page: each says how tall it is by itself (`tops`: the name's, this
// page's head's, each frame's), and all are given the tallest (--top-h). Not where the page is a phone's, its
// panes one under the other. A frame tells the page around it, and is told. A head put in its Chat view's bar (the
// Editor open: barActs) is hidden, of no height.
const tops = new Map(), NARROW = matchMedia("(max-width: 760px)");
function topRow(who, height) {
  if (height === null) tops.delete(who); else tops.set(who, height);
  if (PANE) return PANE.top(window, height);
  const tallest = NARROW.matches ? 0 : Math.ceil(Math.max(0, ...tops.values())) + 1;   // and the rule under it
  if (tallest === panes.top) return;
  panes.top = tallest;
  setTopRow(tallest);
  for (const p of panes.others) p.call("top", tallest);
}
const setTopRow = (h) => document.documentElement.style.setProperty("--top-h", `${h}px`);
function watchTop(node, who) {
  new ResizeObserver(() => topRow(who, node.getBoundingClientRect().height)).observe(node);
}
if (!PANE) NARROW.addEventListener("change", () => { panes.top = null; topRow("brand", tops.get("brand") || 0); });
// The pane's head: whose it is, as the list has the actor -- its avatar, its name or what it was last asked.
function drawWho() {
  if (!PANE && !panes.others.length) return;
  const sh = state.selected && isShell(state.selected[1]) ? shellOf(state.selected[1]) : null;
  if (sh) {
    const sig = signature([state.selected, sh, state.home.home_dir]);
    if (sig === drawn.who) return;
    drawn.who = sig;
    const who = document.getElementById("pane-who");
    who.replaceChildren(shellLogo(), el("span", { class: "tx", text: shellPath(sh) }));
    who.title = `Terminal · ${sh.gatherer}\n${sh.cwd}`;
    return;
  }
  const info = selectedInfo();
  const sig = signature([state.selected, info && [info.avatar, info.harness, info.last_user_message, info.name && info.name.text]]);
  if (sig === drawn.who) return;
  drawn.who = sig;
  const who = document.getElementById("pane-who");
  const named = info && info.name && info.name.text;
  who.replaceChildren(...(info ? [actorLogo(info), el("span", { class: "tx", text: named || info.last_user_message || info.channel })] : []));
  who.title = info ? [named, info.last_user_message, `${harnessName(info.harness)} · ${state.selected[0]} · ${info.channel}`]
    .filter(Boolean).join("\n") : "";
}
// The bar at a pane's left: dragged, it gives the two panes beside it their widths, each at least MIN_PANE.
function gutterFor(p) {
  const bar = el("div", { class: "pane-gutter", role: "separator", "aria-orientation": "vertical", title: "Drag to resize · double-click: all the same width" });
  bar.addEventListener("pointerdown", (ev) => {
    const all = allPanes(), left = all[all.indexOf(p) - 1];
    if (!left || ev.button !== 0) return;
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId);
    const wl = left.node.getBoundingClientRect().width, wr = p.node.getBoundingClientRect().width, share = left.size + p.size, x0 = ev.clientX;
    const box = document.getElementById("panes");
    box.classList.add("resizing");                   // the frames let the pointer by while it drags
    const move = (e) => {
      const w = Math.min(Math.max(wl + e.clientX - x0, Math.min(MIN_PANE, wl)), wl + wr - Math.min(MIN_PANE, wr));
      left.size = share * w / (wl + wr); p.size = share - left.size;
      left.node.style.flexGrow = String(left.size); p.node.style.flexGrow = String(p.size);
    };
    const up = () => { bar.removeEventListener("pointermove", move); box.classList.remove("resizing"); savePanes(); };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up, { once: true });
    bar.addEventListener("pointercancel", up, { once: true });
  });
  bar.addEventListener("dblclick", () => { for (const q of allPanes()) q.size = 1; layout(); savePanes(); });
  return bar;
}
// A line over the panes for a moment: why nothing opened.
function paneNote(text) {
  const n = el("div", { class: "pane-note", role: "status", text });
  document.getElementById("panes").append(n);
  setTimeout(() => n.remove(), 3500);
}
function savePanes() {
  if (PANE || SNAPSHOT) return;
  try {
    if (!panes.others.length) localStorage.removeItem(PANES_KEY);
    else localStorage.setItem(PANES_KEY, JSON.stringify({ here: state.selected, size: panes.here.size, focus: panes.others.indexOf(panes.focus),
      others: panes.others.map((p) => ({ g: p.g, c: p.c, view: p.view, size: p.size })) }));
  } catch (e) { /* this page only */ }
}
// The panes kept, opened again once the home is known: those whose actors are still in it.
function restorePanes() {
  panes.checked = true;
  if (PANE || SNAPSHOT) return;
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(PANES_KEY)); } catch (e) { /* none kept */ }
  if (!kept || !Array.isArray(kept.others)) return;
  const exists = (g, c) => isShell(c) ? (state.home.shells || []).some((s) => s.id === c && s.gatherer === g)
    : state.home.gatherers.some((x) => x.name === g && x.agents.some((a) => a.channel === c));
  if (!state.selected && Array.isArray(kept.here) && exists(...kept.here)) state.selected = kept.here;
  if (!state.selected) return;
  panes.here.size = +kept.size || 1;
  for (const o of kept.others) {
    if (!o || allPanes().length >= MAX_PANES || !exists(o.g, o.c) || openActors().some((sel) => isAt(sel, o.g, o.c))) continue;
    addPane(o.g, o.c, o.view, panes.others.length, +o.size || 1);
  }
  focusPane(panes.others[kept.focus] || panes.here);
  layout();
}
// What this page's stream says for the frames: the home for each, an actor for its pane's; kept, for a frame not
// ready yet (or one shown a new actor).
function panesTake(name, data) {
  let to = null;
  if (name === "home") panes.home = data;
  else { const got = JSON.parse(data); to = [got.gatherer, got.channel]; panes.actors.set(key(...to), data); }
  for (const p of actorPanes()) if (!to || isAt(to, p.g, p.c)) p.call("take", name, data);
}
// ------------------------------------------------------------------ apps' panels
// An app's panel (app_kit/DESIGN.md) is in the top row, above the actors' panes, beside the Editor: the row as tall
// as the Editor's (its grip, 21-start.js), each panel's width its share (`size`, a gutter before it to drag). Opening
// one opens the actor it is attached to below it, in the pane in focus (one open already: its pane focused). Its head
// and its iframe are made by features/apps/host.ts (window.agNext.apps); what its panel asks goes through it to the
// dashboard's /api/apps; the actor in focus (appsSelected) and the theme are told to it. The panels open are kept in
// this browser (TOP_APPS_KEY), opened again once the apps are known (restoreAppPanes).
const TOP_APPS_KEY = "ag-dashboard-top-apps";
panes.apps = [];
const topRowEl = () => document.getElementById("top-row");
function topLayout() {
  const ed = document.getElementById("ed-top");
  if (ed) ed.style.flexGrow = String(panes.edSize || 1);
  for (const p of panes.apps) p.node.style.flexGrow = String(p.size);
}
// The bar before an app's panel, dragged: it and the panel before it (the Editor, shown, or another app's) resized.
function topGutter(p) {
  const bar = el("div", { class: "top-gutter", role: "separator", "aria-orientation": "vertical", title: "Drag to resize · double-click: all the same width" });
  bar.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const shown = [...topRowEl().children].filter((n) => n.matches("section:not([hidden])"));
    const leftNode = shown[shown.indexOf(p.node) - 1];
    if (!leftNode) return;
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId);
    const left = panes.apps.find((q) => q.node === leftNode) || null;      // null: the Editor
    const lSize = () => left ? left.size : (panes.edSize || 1);
    const wl = leftNode.getBoundingClientRect().width, wr = p.node.getBoundingClientRect().width, share = lSize() + p.size, x0 = ev.clientX;
    topRowEl().classList.add("resizing");             // the frames let the pointer by while it drags
    const move = (e) => {
      const w = Math.min(Math.max(wl + e.clientX - x0, Math.min(MIN_PANE, wl)), wl + wr - Math.min(MIN_PANE, wr));
      const l = share * w / (wl + wr);
      if (left) left.size = l; else panes.edSize = l;
      p.size = share - l;
      topLayout();
    };
    const up = () => { bar.removeEventListener("pointermove", move); topRowEl().classList.remove("resizing"); saveAppPanes(); };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up, { once: true });
    bar.addEventListener("pointercancel", up, { once: true });
  });
  bar.addEventListener("dblclick", () => { panes.edSize = 1; for (const q of panes.apps) q.size = 1; topLayout(); saveAppPanes(); });
  return bar;
}
// An actor of the home (its gatherer, its channel), as the page has it now; a codex actor's thread it was renamed to.
const appActor = (g, c) => {
  const gg = state.home && state.home.gatherers.find((x) => x.name === g);
  return (gg && gg.agents.find((a) => a.channel === c || a.started_as === c)) || null;
};
// What a panel is told of an attached agent (the SDK's agents.state), as DocWriter's page was told its actor's.
function appAgentState(g, c) {
  const a = appActor(g, c);
  return a && { channel: a.channel, status: statusOf(a)[0], turn_over: a.turn_over, asking: a.asking || null,
    failing: a.failing || null, stopped: a.stopped || null, name: (a.name && a.name.text) || null,
    session: a.session ? { session_id: a.session.session_id, terminal: !!a.session.terminal } : null };
}
// A message to an attached agent, its question answered, its turn stopped -- as Chat sends, answers and stops (Esc).
const appSessionOf = (g, c) => { const a = appActor(g, c); return a && a.session ? a.session.session_id : null; };
function appSend(g, c, text) {
  const sid = appSessionOf(g, c);
  return post("/api/send", sid ? { session_id: sid, text } : { gatherer: g, channel: c, text });
}
function appAnswer(g, c, call, choice) {
  return post("/api/answer", { session_id: appSessionOf(g, c) || c, call, choice });
}
function appInterrupt(g, c) {
  const sid = appSessionOf(g, c);
  return sid ? post("/api/terminal/input", { session_id: sid, data: "\u001b" }) : Promise.resolve(null);
}
function addAppPane(app, instance, size = 1, held = false) {
  const p = { app, instance, g: instance.gatherer, size, held };
  p.panel = window.agNext.apps.pane(app, instance, {
    close: () => closeAppPane(p),
    focus: () => {},
    intent: (kind, data, from) => appIntent(kind, data, from.instance.gatherer),
    selection: () => appsSelection(),
    agents: (g) => ((state.home && state.home.gatherers.find((x) => x.name === g)) || { agents: [] }).agents
      .filter((a) => !a.closed).map((a) => ({ channel: a.channel, name: (a.name && a.name.text) || a.last_user_message || a.channel })),
    agentState: appAgentState, send: appSend, answer: appAnswer, interrupt: appInterrupt,
  });
  p.node = p.panel.node; p.frame = p.panel.frame;
  p.gutter = topGutter(p);
  p.node.hidden = p.gutter.hidden = held;
  topRowEl().append(p.gutter, p.node);
  panes.apps.push(p);
  watchTop(p.node.querySelector(".app-head"), p);
  topLayout();
  p.panel.refresh();                                 // its agents, as the host has them
  return p;
}
// A panel held out of sight shown (opened by the reader), or one shown held (closed while it is needed: appsAtWork).
function holdAppPane(p, held) {
  p.held = held;
  p.node.hidden = p.gutter.hidden = held;
  if (held) topRow(p, null);
  topLayout(); saveAppPanes();
}
function closeAppPane(p) {
  const i = panes.apps.indexOf(p);
  if (i < 0) return;
  if (appNeeded(p)) return holdAppPane(p, true);     // its agent at work: its page answers its tools, out of sight
  panes.apps.splice(i, 1);
  p.panel.destroy();                                 // its streams go; the instance stays open
  p.gutter.remove(); p.node.remove();
  topRow(p, null);
  saveAppPanes(); renderAgents();
}
// An app whose panel answers tools of its own (DocWriter's documents' tools) runs while an agent attached to it is at
// work, out of sight if the reader has not opened it: the agent's calls are answered at once, as they were when the
// app was its actor's view. `appsAtWork`, on each change of the home, holds one for each such agent; one held whose
// agents are done goes.
const panelTools = (app) => (app.tools || []).some((t) => t.handled_by === "panel");
const agentAtWork = (a) => !!a && ["running", "asking"].includes(statusOf(a)[0]);
function appNeeded(p) {
  if (!panelTools(p.app)) return false;
  return (p.panel.agents ? p.panel.agents() : []).some((c) => agentAtWork(appActor(p.instance.gatherer, c)));
}
let appsWorking = "";
async function appsAtWork() {
  if (PANE || SNAPSHOT || !state.home || !window.agNext) return;
  for (const p of panes.apps) p.panel.agentsChanged();
  const working = [];
  for (const g of state.home.gatherers) for (const a of g.agents) if (agentAtWork(a)) working.push([g.name, a.channel]);
  const sig = JSON.stringify(working);
  if (sig !== appsWorking) {
    appsWorking = sig;
    for (const [g, c] of working) {
      let held;
      try { held = await window.agNext.apps.attachedTo(g, c); } catch (e) { continue; }
      for (const inst of held) {
        const app = window.agNext.apps.named(inst.app);
        if (!app || !panelTools(app) || panes.apps.some((p) => p.instance.id === inst.id)) continue;
        addAppPane(app, inst, 1, true);
      }
    }
  }
  for (const p of [...panes.apps]) if (p.held && !appNeeded(p)) {     // its agents done: it goes
    panes.apps.splice(panes.apps.indexOf(p), 1);
    p.panel.destroy(); p.gutter.remove(); p.node.remove();
  }
}
function saveAppPanes() {
  if (PANE || SNAPSHOT) return;
  try {
    if (!panes.apps.some((p) => !p.held)) localStorage.removeItem(TOP_APPS_KEY);
    else localStorage.setItem(TOP_APPS_KEY, JSON.stringify({ ed: panes.edSize || 1,
      apps: panes.apps.filter((p) => !p.held).map((p) => ({ app: p.app.name, instance: p.instance.id, g: p.instance.gatherer, size: p.size })) }));
  } catch (e) { /* this page only */ }
}
// The actor an app's instance is attached to, shown below it: in the pane in focus, unless one of them is open in a
// pane already (that pane focused). None attached: the panes as they are.
async function showAttached(p) {
  const chans = await p.panel.refresh();
  if (!chans.length) return;
  const g = p.instance.gatherer;
  const there = chans.map((c) => actorPanes().find((q) => isAt([q.g, q.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null)).find(Boolean);
  if (there) return focusPane(there);
  const agents = ((state.home && state.home.gatherers.find((x) => x.name === g)) || { agents: [] }).agents;
  const c = chans.find((ch) => agents.some((a) => a.channel === ch && !a.closed)) || chans.find((ch) => agents.some((a) => a.channel === ch));
  if (c) await show(g, c);
}
// The app's instance for gatherer `g` (in `folder`: the one there, for an app with one per folder) in the top row --
// its panel there already, if it is open -- and the actor it is attached to below it. The actor in focus attached
// first, if it is `g`'s and `attach`.
async function openApp(g, name, folder, attach = true) {
  const app = window.agNext.apps.named(name);
  if (!app || PANE || SNAPSHOT) return null;
  const sel = focusedActor();
  const channel = attach && sel && sel[0] === g && !isShell(sel[1]) ? sel[1] : null;
  let instance;
  try { instance = await window.agNext.apps.open(name, g, folder || null, channel); }
  catch (e) { paneNote(`${app.label}: ${e.message}`); return null; }
  const there = panes.apps.find((q) => q.instance.id === instance.id);
  const p = there || addAppPane(app, instance);
  if (p.held) holdAppPane(p, false);                 // held out of sight while its agent worked: shown now
  saveAppPanes(); renderAgents();
  await showAttached(p);
  return p;
}
// An intent (app_kit's INTENTS) raised by a panel or a view: the app that takes it opened (in `g`) and told it.
async function appIntent(kind, data, g) {
  const ext = kind === "open-file" && data && data.path ? String(data.path).split(".").pop().toLowerCase() : "";
  const type = { md: "text/markdown", txt: "text/plain", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg",
    jpeg: "image/jpeg", svg: "image/svg+xml", html: "text/html", json: "application/json" }[ext] || (ext ? "text/plain" : undefined);
  const app = window.agNext.apps.handler(kind, type);
  if (!app && kind === "open-file" && data && data.path) return edShowFile(String(data.path), Number(data.line) || 0);   // the Editor's
  if (!app) throw new Error(`no app here takes ${kind}`);
  const folder = data && data.path ? String(data.path).replace(/\/[^/]*$/, "") : null;
  const into = g || (focusedActor() || [])[0] || ((state.home && state.home.gatherers[0]) || {}).name;   // the Editor's: no actor
  const p = await openApp(into, app.name, folder, false);
  if (!p) throw new Error(`${app.label} could not be opened`);
  p.panel.intent(kind, data || {});
}
// An actor an app started, selected: its app's panel in the top row -- shown, if held out of sight -- as a DocWriter's
// actor showed DocWriter when it was its view. Any other actor: nothing opened.
async function showActorsApp(g, c) {
  if (PANE || SNAPSHOT || !window.agNext) return;
  const gg = state.home && state.home.gatherers.find((x) => x.name === g);
  const r = appRole(gg && gg.agents.find((a) => a.channel === c));
  const app = r && window.agNext.apps.named(r.app);
  if (!app) return;
  const there = panes.apps.find((p) => p.instance.id === r.key);
  if (there) { if (there.held) holdAppPane(there, false); return; }
  const inst = await window.agNext.apps.instanceOf(app.name, g, r.key).catch(() => null);
  if (!inst || panes.apps.some((p) => p.instance.id === inst.id) || !isAt(state.selected, g, c)) return;
  addAppPane(app, inst);
  saveAppPanes();
}
// The agent in focus, as the apps' panels are told it: the actor of the pane in focus.
function appsSelection() {
  const sel = focusedActor();
  return sel && !isShell(sel[1]) ? { gatherer: sel[0], channel: sel[1] } : null;
}
function appsSelected() {
  const sel = appsSelection();
  for (const p of panes.apps) p.panel.selection(sel);
}
// The apps' panels kept, opened again once the apps are known: those whose instance is still open; the actors below
// as the panes kept them (restorePanes), not opened again for them.
async function restoreAppPanes() {
  if (PANE || SNAPSHOT) return;
  let kept = null;
  try { kept = JSON.parse(localStorage.getItem(TOP_APPS_KEY)); } catch (e) { /* none kept */ }
  if (!kept || !Array.isArray(kept.apps)) return;
  panes.edSize = +kept.ed || 1;
  for (const o of kept.apps) {
    const app = o && window.agNext.apps.named(o.app);
    if (!app || panes.apps.some((p) => p.instance.id === o.instance)) continue;
    const inst = await window.agNext.apps.instanceOf(o.app, o.g, o.instance);
    if (inst) addAppPane(app, inst, +o.size || 1);
  }
  topLayout(); saveAppPanes();
}
// What a frame's page asks of this one (its PANE).
if (!PANE && !SNAPSHOT) window.agPanes = Object.freeze({
  get stream() { return state.stream; },
  ready(win, sel) {                                  // its page is up: given what the stream has said so far
    const p = paneOf(win);
    if (!p) return;
    p.ready = true;
    p.call("focused", panes.focus === p);
    if (panes.top) p.call("top", panes.top);
    if (!isAt(sel, p.g, p.c)) return p.call("select", p.g, p.c, p.view);   // shown another actor while it loaded
    if (panes.home) p.call("take", "home", panes.home);
    const a = panes.actors.get(key(p.g, p.c));
    if (a) p.call("take", "actor", a);
  },
  shows(win, sel) {                                  // its actor, chosen or renamed (a codex thread)
    const p = paneOf(win);
    if (!p || !p.ready || !sel) return;              // not up yet: its pane's actor is the one it is given (ready)
    if (!isAt(sel, p.g, p.c)) { [p.g, p.c] = sel; savePanes(); connect(); renderAgents(); return; }
    const a = panes.actors.get(key(p.g, p.c));
    if (a) p.call("take", "actor", a);
  },
  viewed(win, id) { const p = paneOf(win); if (p) { p.view = id; savePanes(); } },
  top(win, height) { const p = paneOf(win); if (p) topRow(p, height); },
  focus(win) { if (state.renaming) endRename(true); const p = paneOf(win); if (p) focusPane(p); },   // a press in its frame
  close(win) { const p = paneOf(win); if (p) closePane(p); },
});
// In a frame: its URL says what it shows -- its actor and view -- so that loaded again it shows them still.
function paneUrl() {
  const [g, c] = state.selected || [];
  try { history.replaceState(null, "", "/?" + new URLSearchParams({ pane: "1", gatherer: g || "", channel: c || "", view: state.chatViewId })); }
  catch (e) { /* stays as it was */ }
}
// In a frame: what the page around it can ask of it, and its word that it is up.
function paneReady() {
  window.agPane = Object.freeze({
    take: (name, data) => streamTake(name, data),
    select: (g, c, view) => { if (view) state.chatViewId = view; select(g, c); },
    view: (id) => setChatView(id),
    theme: (pick) => setTheme(pick, false),
    avatar: (pick) => setAvatarMode(pick, false),
    earlier: (pick) => setEarlierTurns(pick, false),
    focused: (on) => document.documentElement.classList.toggle("pane-focused", !!on),
    top: (h) => setTopRow(h),
    editor: () => minRedraw(),                       // the Editor opened or closed above the panes: its head, in the bar or not
    minimized: () => minRedraw(),                    // the chat minimized under the Editor, or shown again (setChatMin)
    escape: () => escapeShown(),                     // an Esc on the page outside the frame, this pane in focus
  });
  PANE.ready(window, state.selected);
  watchTop(document.getElementById("pane-head"), "here");
}
// The forms in the agent list: a new gatherer's ("+ New gatherer", gatherer ""), a new session's in a gatherer (its "+").
function openForm(gatherer) {
  state.adding = state.adding && state.adding.gatherer === gatherer ? null : { gatherer };
  renderAgents();
  const first = document.querySelector(".newform input, .newform select");
  if (first) first.focus();
}
function gathererForm() {
  const name = el("input", { name: "name", required: "", placeholder: "letters, digits, . _ -", pattern: "[A-Za-z0-9._\\-]+",
    spellcheck: "false", autocomplete: "off" });
  const err = el("div", { class: "err", role: "alert" });
  const make = el("button", { type: "submit", class: "primary" }, "Create");
  const form = el("form", { class: "newform", "aria-label": "New gatherer" },
    el("label", {}, "Gatherer name", name),
    el("div", { class: "desc", text: "Made with ag's default policy and pollers. Agents in it share context with each other." }),
    err,
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => { state.adding = null; renderAgents(); } }, "Cancel"), make));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    make.disabled = true; err.textContent = "";
    try {
      const g = await post("/api/gatherers", { name: name.value.trim() });
      collapsed.delete(g.name);
      await loadHome();
      state.adding = null;
      addSession(state.home.gatherers.find((x) => x.name === g.name) || { name: g.name, agents: [] });   // next: its first session
    } catch (e) { err.textContent = e.message; make.disabled = false; }
  });
  return form;
}
// A gatherer's start buttons, one for each harness a new session can run on here (the server's `harnesses`:
// in ag's config.toml, and installed): a click starts one, on the harness's default model, in the directory of
// the gatherer's most recently active actor -- or, when no actor has one (or starting there failed), the form
// asks for the directory first, its buttons the same.
const startable = () => (state.home.harnesses || []).filter(runsHere);
const noHarness = () => `None of ${runnableNames("or")} is set up here: install one, or set its command in config.toml ([cli.harnesses])`;
// Last, its terminal button: a shell (isShell), in that same directory -- or, with none, the form asks for it too.
const SHELL_START = "shell";                       // the terminal button's, where a harness's name goes
const APP_START = "app:";                          // an app's with an agent of its own ([agent] start): app:<name>:<harness>
const BW_START = "browser:";                       // a Browser's, where a harness's name goes: its actor's harness after it
const startAny = (gatherer, cwd, harness) => harness === SHELL_START ? startShell(gatherer, cwd)
  : harness.startsWith(APP_START) ? startWithApp(gatherer, cwd, ...appStart(harness))
  : harness.startsWith(BW_START) ? startBrowser(gatherer, cwd, harness.slice(BW_START.length))
  : startSession(gatherer, cwd, harness);
const appStart = (v) => { const [name, ...h] = v.slice(APP_START.length).split(":"); return [name, h.join(":")]; };
// The apps found whose menu entry starts an agent of their own (DocWriter, say): those a new actor is started with.
const startingApps = () => (PANE || SNAPSHOT || !window.agNext ? [] : window.agNext.apps.found())
  .filter((a) => a.agent && a.agent.start && !a.failed);
const cwdOf = (a) => a.cwd || (a.session && a.session.cwd) || "";    // a session started here: its own, before any call names one
const startCwd = (g) => cwdOf(g.agents.filter(cwdOf).sort((x, y) => (y.last || 0) - (x.last || 0))[0] || {});
// Its gatherer agent's button, first (CREW_START): the agent shown, started for the gatherer if it has none -- on the
// first harness a session can run on here, in the directory a new session would start in (coordination.py's `ensure`).
const CREW_START = "crew", CREW_GROUP = "Gatherer agent";
async function openCoordinator(g) {
  if (crewHidden.has(g.name)) setCrewHidden(g.name, false);
  const there = g.agents.find(isCoordinator);
  const view = CHAT_VIEWS.has("files") ? "files" : null;
  if (there) return show(g.name, there.channel, view);
  state.starting = { gatherer: g.name, harness: CREW_START };
  renderAgents();
  try {
    const s = await post("/api/coordinator", { gatherer: g.name, cwd: startCwd(g), harness: startable()[0] || "" });
    collapsed.delete(s.gatherer);
    await show(s.gatherer, s.session_id, view);
  } catch (e) { state.adding = { gatherer: g.name, cwd: startCwd(g), harness: null, error: e.message }; }
  finally { state.starting = null; renderAgents(); }
  const box = panes.focus !== panes.here ? null : document.getElementById("composer-text");
  if (box) box.focus();
}
// A gatherer's gatherer agent, its face just after the gatherer's name in its row: a click shows it (started if it has
// none), and, hidden from the list, its status at the face's corner.
function crewButton(g) {
  const hs = startable(), crew = g.agents.find(isCoordinator), hidden = !!crew && crewHidden.has(g.name);
  if (!hs.length && !crew) return null;
  const [cls, label] = hidden ? statusOf(crew) : [null, null];      // hidden from the list: its status here
  const busy = state.starting && state.starting.gatherer === g.name && state.starting.harness === CREW_START;
  return el("button", { class: "act start crew" + (busy ? " busy" : "") + (crew ? " on" : ""), type: "button",
    ...(state.starting ? { disabled: "" } : {}),
    title: hidden ? `The gatherer agent (${label.toLowerCase()}), hidden from the list: click to show it and open it`
      : crew ? "The gatherer agent: it coordinates this gatherer's actors -- tell it what to arrange"
      : "Start the gatherer agent: it coordinates this gatherer's actors, settles their conflicts, and arranges their work for you",
    "aria-label": crew ? `The gatherer agent of ${g.name}` : `Start the gatherer agent of ${g.name}`, onclick: () => openCoordinator(g) },
    crewFace(crew, MANAGER), hidden ? el("i", { class: `crew-dot ${cls}`, "aria-hidden": "true" }) : null);
}
// A gatherer row's start buttons -- and a folder's line's (`folder`: what they start goes in it, folders.py), shown, on
// each, while it is hovered: "+ actor" -- a drop-down of the harnesses a new actor may run on, or, with one, that one at
// once -- and "+ more", a drop-down of the other things started there: an actor on a branch of its own, a DocWriter, a
// Browser, a terminal. Each, pressed, aims what is started next at its folder, or its gatherer's top (aimStart): the
// actor filed there once started (fileStarted).
function startButtons(g, folder = null, prefix = "") {
  const hs = startable(), cwd = startCwd(g), where = cwd ? tildePath(cwd, state.home.home_dir) : null;
  const fid = folder ? folder.id : null, place = folder ? folder.name : g.name, at = folder ? `:${fid}` : "";
  const ours = state.starting && state.starting.gatherer === g.name;
  const starting = ours && startIn.g === g.name && startIn.folder === fid ? String(state.starting.harness) : "";
  const off = state.starting ? { disabled: "" } : {};
  const plus = () => el("span", { class: "plus", "aria-hidden": "true", text: "+" });
  const actorKey = `${prefix}actor:${g.name}${at}`, moreKey = `${prefix}more:${g.name}${at}`;   // a card's: its own (prefix)
  const actor = !hs.length ? el("button", { class: "act add", type: "button", disabled: "", title: noHarness(), "aria-label": noHarness() }, "+")
    : el("button", { class: "act start new-actor" + (hs.includes(starting) ? " busy" : ""), type: "button", ...off, "data-pop": actorKey,
      title: `New actor in ${place}${where ? `, in ${where}` : ""}: ${hs.map(harnessName).join(" or ")}`,
      "aria-label": `New actor in ${place}`, ...(hs.length > 1 ? { "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === actorKey) } : {}),
      onclick: (ev) => {
        aimStart(g.name, fid);
        if (hs.length > 1) openActorMenu(g, hs, ev.currentTarget, actorKey, undefined, folder ? place : null); else addSession(g, hs[0]);
      } },
      plus(), strokeIcon(ICONS.agent, 16));
  const others = moreStarts(g, hs, where, moreKey);
  const more = others.length ? el("button", { class: "act start new-more" + (starting === SHELL_START || starting === BRANCH_START
      || starting.startsWith(APP_START) || starting.startsWith(BW_START) ? " busy" : ""), type: "button", ...off, "data-pop": moreKey,
    title: `More to start in ${place}: ${others.map((o) => o.text.replace("…", "").toLowerCase()).join(", ")}`,
    "aria-label": `More to start in ${place}`, "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === moreKey),
    onclick: (ev) => { aimStart(g.name, fid); openMoreMenu(g, hs, ev.currentTarget, moreKey, place); } }, plus(), strokeIcon(ICONS.more, 16)) : null;
  return [actor, more].filter(Boolean);
}
// The "+ more" drop-down's starts: what each is, said under it, and what choosing it does. `key`: its button's data-pop.
function moreStarts(g, hs, where, key = `more:${g.name}`) {
  const there = where ? `in ${where}` : "in a directory you choose";
  const tooled = hs.filter((h) => (harnessInfo(h) || {}).mcp);    // an app's and a Browser's agent: given their tools
  return [
    hs.length ? { icon: ICONS.branch, text: "Actor on a branch…", note: "in a worktree of a project: its changes merged into the project",
      run: (button) => openBranchMenu(g, button) } : null,
    ...(tooled.length ? startingApps() : []).map((a) => ({ icon: ICONS.app, mark: a.mark ? appMarkImg(a) : null,
      text: `${a.label}…`, note: a.description || "an app, with an agent of its own",
      run: (button) => openPop(key, button, appStartBox(g, tooled, a)) })),
    tooled.length && state.home.browser ? { icon: ICONS.globe, text: "Browser…", note: "a browser you and an agent use together: point it at what you mean",
      run: (button) => tooled.length > 1 ? openPop(key, button, popMenu("New Browser, its agent on",
        tooled.map((h) => ({ mark: harnessBadge(h), text: harnessName(h), run: () => addSession(g, BW_START + h) }))))
        : addSession(g, BW_START + tooled[0]) } : null,
    state.home.terminals !== false ? { icon: ICONS.terminal, text: "Terminal", note: there, run: () => addSession(g, SHELL_START) } : null,
    ...(PANE || SNAPSHOT ? [] : window.agNext.apps.found()).filter((a) => !(a.agent && a.agent.start)).map((a) => ({ icon: ICONS.app,
      text: a.label, note: a.description || "an app", run: () => openApp(g.name, a.name, startCwd(g)) })),
  ].filter(Boolean);
}
// `key`: the button's data-pop (the list's "+ actor", or the rail's "+"); `start`: what a harness chosen does; `place`: the
// folder it starts in, named in its heading (else the directory's).
function openActorMenu(g, hs, button, key = `actor:${g.name}`, start = (h) => addSession(g, h), place = null) {
  const cwd = startCwd(g);
  const where = cwd ? tildePath(cwd, state.home.home_dir) : "";
  openPop(key, button, popMenu(place ? `New actor in ${place}` : where ? `New actor in ${where.replace(/\/+$/, "").split("/").pop() || where}` : `New actor in ${g.name}`,
    hs.map((h) => ({ mark: harnessBadge(h), text: harnessName(h), run: () => start(h) })), where));
}
// The "+ actor" of a gatherer's or a folder's card in the rail (gathererCard, folderCard; `f` null: the gatherer's top): a
// new actor there, as the list's "+ actor" starts one -- on the one harness at once, or on the one picked from a drop-down
// -- in the directory of its gatherer's most recently active actor. With none (or starting there failed), a box under it
// asks for the directory first (railNewBox): the list's form, under its gatherer's row, is out of sight with the list
// folded. Pressed again, what it opened closes. `cls`: its classes.
const railKey = (g, f = null) => `rail:${g.name}${f ? `:${f.id}` : ""}`;
function railNew(g, f = null, cls = "r-new") {
  const hs = startable(), key = railKey(g, f), plus = el("span", { class: "plus", "aria-hidden": "true", text: "+" });
  const fid = f ? f.id : null, place = f ? f.name : titleOf(g);
  if (!hs.length) return el("button", { class: cls, type: "button", disabled: "", title: noHarness(), "aria-label": noHarness() },
    plus, strokeIcon(ICONS.agent, 14));
  const cwd = startCwd(g), where = cwd ? tildePath(cwd, state.home.home_dir) : null;
  const busy = state.starting && state.starting.gatherer === g.name && startIn.folder === fid && hs.includes(String(state.starting.harness));
  const pops = hs.length > 1 || !cwd;
  return el("button", { class: cls + (busy ? " busy" : ""), type: "button", "data-pop": key, ...(state.starting ? { disabled: "" } : {}),
    title: `New actor in ${place}${where ? `, in ${where}` : ""}: ${hs.map(harnessName).join(" or ")}`,
    "aria-label": `New actor in ${place}`,
    ...(pops ? { "aria-haspopup": cwd ? "menu" : "dialog", "aria-expanded": String(rowPop.key === key) } : {}),
    onclick: (ev) => {
      const button = ev.currentTarget;
      if (rowPop.key === key) return closePop();
      aimStart(g.name, fid);
      if (!cwd) openPop(key, button, railNewBox(g, hs));
      else if (hs.length > 1) openActorMenu(g, hs, button, key, (h) => railStart(g, h, key), f ? place : null);
      else railStart(g, hs[0], key);
    } },
    plus, strokeIcon(ICONS.agent, 14));
}
// A card's "+ ⋯" in the rail: the list's "+ more" drop-down, under it
function railMore(g, f = null, cls = "r-new r-more") {
  const hs = startable(), key = `railmore:${g.name}${f ? `:${f.id}` : ""}`, place = f ? f.name : titleOf(g);
  const others = moreStarts(g, hs, null, key);
  if (!others.length) return null;
  return el("button", { class: cls, type: "button", "data-pop": key, ...(state.starting ? { disabled: "" } : {}),
    title: `More to start in ${place}: ${others.map((o) => o.text.replace("…", "").toLowerCase()).join(", ")}`,
    "aria-label": `More to start in ${place}`, "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === key),
    onclick: (ev) => { aimStart(g.name, f ? f.id : null); openMoreMenu(g, hs, ev.currentTarget, key, place); } },
    el("span", { class: "plus", "aria-hidden": "true", text: "+" }), strokeIcon(ICONS.more, 14));
}
async function railStart(g, harness, key = railKey(g)) {
  const cwd = startCwd(g);
  try { await startSession(g.name, cwd, harness); }
  catch (e) {
    const button = document.querySelector(`[data-pop="${CSS.escape(key)}"]`);
    if (button) openPop(key, button, railNewBox(g, startable(), harness, cwd, e.message));
    else setLive(`Not started: ${e.message}`);
  }
}
// The rail's box for a new actor: the directory it works in (the one tried, if starting there failed; else the dashboard's
// own), the folders the gatherer's actors work in a click away, and a button for each harness: a click on one starts it
// there, Enter the one tried (or the first). The box closes once it has started; why not, if it cannot, is said in it.
function railNewBox(g, hs, harness = hs[0], cwd = "", error = "") {
  const dir = tildePath(cwd || state.home.cwd || "", state.home.home_dir);
  const err = el("div", { class: "err", role: "alert", text: error });
  const input = el("input", { type: "text", value: dir, spellcheck: "false", "aria-label": "Working directory", placeholder: "~/projects/my-project",
    oninput: () => { err.textContent = ""; },
    onkeydown: (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(harness); } } });
  const go = async (h) => {
    const at = input.value.trim();
    if (!at) { err.textContent = "Which directory?"; input.focus(); return; }
    const buttons = [...box.querySelectorAll("button.go")];
    for (const b of buttons) b.disabled = true;
    try {
      await startSession(g.name, at, h);
      if (rowPop.el === box) closePop();
    } catch (e) {
      if (box.isConnected) { err.textContent = e.message; placePop(); } else setLive(`Not started: ${e.message}`);
    } finally { for (const b of buttons) b.disabled = false; }
  };
  const box = el("div", { class: "dw-menu", role: "dialog", "aria-label": `New actor in ${titleOf(g)}` },
    el("div", { class: "head", text: `New actor in ${titleOf(g)}` }),
    el("label", {}, "Working directory", input),
    folderPicks(g, dir, input, err),
    el("div", { text: "Run it on" }),
    el("div", { class: "on" }, ...hs.map((h) => el("button", { type: "button", class: "go", onclick: () => go(h) }, harnessBadge(h), harnessName(h)))),
    err);
  return box;
}
function openMoreMenu(g, hs, button, key = `more:${g.name}`, place = g.name) {
  if (brPick.menu && brPick.menu.g === g.name) return brMenuClose();     // the branch drop-down it opened: pressed again
  openPop(key, button, popMenu(`New in ${place}`, moreStarts(g, hs, startCwd(g) && tildePath(startCwd(g), state.home.home_dir), key)));
}
// A drop-down's box: its heading, then an item for each choice -- its mark, what it is, and a note under it.
function popMenu(head, items, title) {
  return el("div", { class: "br-menu row-menu", role: "menu", "aria-label": head }, el("div", { class: "hd", text: head, ...(title ? { title } : {}) }),
    ...items.map((it) => el("button", { type: "button", role: "menuitem", ...(it.depth ? { style: `padding-left: ${10 + it.depth * 14}px` } : {}), onclick: (ev) => {
      ev.stopPropagation();
      const button = popButton();
      closePop();
      it.run(button);
    } }, it.mark || strokeIcon(it.icon, 16), el("span", { class: "nm", text: it.text }), it.note ? el("span", { class: "at", text: it.note }) : null)));
}
// A gatherer row's pop-up ("+ actor"'s drop-down, "+ more"'s, the DocWriter box one of those opens): outside the list,
// fixed under the button it hangs from -- `key`, that button's data-pop, so found again after the list is drawn again --
// so it may reach past the list's edge without the list scrolling, and the list's redraws leave it be. Closed by its
// button pressed again, a press elsewhere, Esc, or the page scrolling (but in it) or resizing.
const rowPop = { key: "", el: null, off: null };
const popButton = () => rowPop.key && document.querySelector(`[data-pop="${CSS.escape(rowPop.key)}"]`) || null;
function closePop() {
  if (!rowPop.el) return;
  const button = popButton();
  rowPop.el.remove();
  rowPop.off();
  Object.assign(rowPop, { key: "", el: null, off: null });
  if (button) button.setAttribute("aria-expanded", "false");
  cardRelease();                                     // a card it hung from: let go, unless the pointer is on it
}
function placePop() {
  const box = rowPop.el, button = popButton();
  if (!box || !button) return;
  const r = button.getBoundingClientRect(), h = box.offsetHeight;
  const rail = button.closest("#rail"), side = rail && rail.getBoundingClientRect();
  if (side && side.height > side.width) {           // from the rail down the page's side: beside it, level with its button
    box.style.left = `${Math.round(side.right + 6)}px`;
    box.style.top = `${Math.round(Math.max(8, Math.min(r.top, window.innerHeight - h - 8)))}px`;
    return;
  }
  const below = r.bottom + 4 + h <= window.innerHeight - 8 || r.top - 4 - h < 8;   // above it only where there is room above
  box.style.top = `${Math.round(below ? r.bottom + 4 : r.top - 4 - h)}px`;
  box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)))}px`;
}
function openPop(key, button, box) {
  const again = rowPop.key === key && box.getAttribute("role") === "menu";
  closePop();
  brMenuClose();
  if (again) return;
  const away = (ev) => {
    const b = ev.target.closest && ev.target.closest("[data-pop]");
    if (!box.contains(ev.target) && !(b && b.dataset.pop === key)) closePop();
  };
  const keys = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault(); ev.stopPropagation();
      const b = popButton();
      closePop();
      if (b) b.focus();
    } else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && box.contains(document.activeElement) && box.getAttribute("role") === "menu") {
      ev.preventDefault();
      const items = [...box.querySelectorAll("[role=menuitem]")], at = items.indexOf(document.activeElement);
      items[(at + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    }
  };
  const scrolled = (ev) => { if (!box.contains(ev.target)) closePop(); };
  document.addEventListener("pointerdown", away, true);
  document.addEventListener("keydown", keys, true);
  window.addEventListener("resize", closePop);
  window.addEventListener("scroll", scrolled, true);
  Object.assign(rowPop, { key, el: box, off: () => {
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", keys, true);
    window.removeEventListener("resize", closePop);
    window.removeEventListener("scroll", scrolled, true);
  } });
  document.body.append(box);
  button.setAttribute("aria-expanded", "true");
  placePop();
  const first = box.querySelector("input, [role=menuitem]");
  if (!first) return;
  first.focus({ preventScroll: true });
  if (first.select) { first.setSelectionRange(first.value.length, first.value.length); first.scrollLeft = first.scrollWidth; }   // a folder's end
}
// The folders a gatherer's actors work in, newest first, under a box's folder `input` (its `dir` to start with): another
// a click away. null: none other than `dir`.
function folderPicks(g, dir, input, err) {
  const seen = new Set(), folders = [];
  for (const a of [...g.agents].sort((x, y) => (y.last || 0) - (x.last || 0))) {
    const d = cwdOf(a);
    if (d && !seen.has(d)) { seen.add(d); folders.push(tildePath(d, state.home.home_dir)); }
  }
  return folders.length > 1 || (folders.length === 1 && folders[0] !== dir) ? el("div", { class: "folders" },
    el("div", { class: "lbl", text: "Where its actors work" }),
    ...folders.slice(0, 5).map((d) => el("button", { type: "button", title: d,
      onclick: () => { input.value = d; err.textContent = ""; input.focus(); input.setSelectionRange(d.length, d.length); } },
      el("span", { class: "nm", text: d.replace(/\/+$/, "").split("/").pop() || d }), el("span", { class: "at", text: d })))) : null;
}
const appMarkImg = (a) => el("img", { class: "app-mark", src: `/apps/mark/${encodeURIComponent(a.name)}.svg`, alt: "", draggable: "false" });
// A new one of an app with an agent of its own (DocWriter, say) -- and its actor -- in a folder of the reader's choice:
// its box asks which (the gatherer's current one to start with, the folders its actors work in a click away) and the
// harness its actor runs on: a click on one starts it.
function appStartBox(g, hs, app) {
  const cwd = startCwd(g), dir = cwd ? tildePath(cwd, state.home.home_dir) : "";
  const err = el("div", { class: "err", role: "alert" });
  const input = el("input", { type: "text", value: dir, spellcheck: "false", "aria-label": "Folder", placeholder: "~/writing/my-paper",
    oninput: () => { err.textContent = ""; },
    onkeydown: (ev) => { if (ev.key === "Enter") { ev.preventDefault(); appGo(g, hs[0], box, app); } } });
  const box = el("div", { class: "dw-menu", role: "dialog", "aria-label": `New ${app.label}` },
    el("div", { class: "head", text: `New ${app.label}` }),
    el("label", {}, "Folder", input),
    folderPicks(g, dir, input, err),
    el("div", { text: "Its agent on" }),
    el("div", { class: "on" }, ...hs.map((h) => el("button", { type: "button", class: "go", onclick: () => appGo(g, h, box, app) },
      harnessBadge(h), harnessName(h)))),
    err);
  return box;
}
// One started from its box, in the folder typed there: the box closed once it is, and why not, if it cannot be,
// said in it.
async function appGo(g, harness, box, app) {
  const input = box.querySelector("input"), err = box.querySelector(".err"), cwd = input.value.trim();
  if (!cwd) { err.textContent = "Which folder?"; input.focus(); return; }
  const go = [...box.querySelectorAll("button.go")];
  for (const b of go) b.disabled = true;
  try {
    await startWithApp(g.name, cwd, app.name, harness);
    if (rowPop.el === box) closePop();
  } catch (e) {
    if (box.isConnected) { err.textContent = e.message; placePop(); } else setLive(`Not started: ${e.message}`);
  } finally { for (const b of go) b.disabled = false; }
}
async function addSession(g, harness) {
  const cwd = startCwd(g);
  if (harness && cwd) {
    try { return await startAny(g.name, cwd, harness); }
    catch (e) { state.adding = { gatherer: g.name, cwd, harness, error: e.message }; }
  } else state.adding = { gatherer: g.name, cwd, harness };
  if (listMode === "folded") setListMode("list");     // its form is the list's: in sight
  renderAgents();
  const first = document.querySelector(".newform input");
  if (first) first.focus();
}
// The new session shown in Chat, its message box ready: its agent starts with its first message. Listed before it is
// shown: drawn at once, the box there to take the focus.
async function startSession(gatherer, cwd, harness) {
  state.starting = { gatherer, harness };
  renderAgents();
  try {
    const s = await post("/api/sessions", { gatherer, cwd, harness });
    await fileStarted(gatherer, s.session_id);
    state.adding = null;
    collapsed.delete(s.gatherer);
    await loadHome();
    await show(s.gatherer, s.session_id, "files");
  } finally { state.starting = null; renderAgents(); }
  const box = panes.focus !== panes.here ? null : document.getElementById("composer-text");
  if (box) box.focus();
}
// One of an app with an agent of its own started (app_agents.py's `start`): its actor listed and shown, its panel above.
async function startWithApp(gatherer, cwd, name, harness) {
  state.starting = { gatherer, harness: `${APP_START}${name}:${harness}` };
  renderAgents();
  try {
    const got = await window.agNext.apps.start(name, gatherer, cwd, harness);
    await fileStarted(gatherer, got.session.session_id);
    state.adding = null;
    collapsed.delete(gatherer);
    await loadHome();
    await show(gatherer, got.session.session_id, "files");
    const app = window.agNext.apps.named(name);
    if (app) {
      const there = panes.apps.find((q) => q.instance.id === got.instance.id);
      if (there) { if (there.held) holdAppPane(there, false); }
      else addAppPane(app, got.instance);
      saveAppPanes();
    }
  } finally { state.starting = null; renderAgents(); }
}
// A Browser started (browser.py's `create`): its actor listed, then shown in the Browser's view.
async function startBrowser(gatherer, cwd, harness) {
  state.starting = { gatherer, harness: BW_START + harness };
  renderAgents();
  try {
    const cfg = await post("/api/browser", { gatherer, cwd, harness });
    await fileStarted(gatherer, cfg.channel);
    state.adding = null;
    collapsed.delete(gatherer);
    await loadHome();
    kindViewId.browser = "browser";
    await show(gatherer, cfg.channel);
  } finally { state.starting = null; renderAgents(); }
}
// A shell started: shown in the pane in focus, its terminal opened at once (sessions.py's `shell`), at the size of the
// terminal this page draws now, if it draws one (fitted to its pane once drawn there).
async function startShell(gatherer, cwd) {
  state.starting = { gatherer, harness: SHELL_START };
  renderAgents();
  try {
    const size = term.opened && term.host && term.host.isConnected ? { cols: term.xterm.cols, rows: term.xterm.rows } : {};
    const folder = shellFolder(gatherer);            // opened in the folder aimed at, listed there
    const s = await post("/api/shells", { gatherer, cwd, ...size, ...(folder !== null ? { folder } : {}) });
    state.adding = null;
    collapsed.delete(gatherer);
    await loadHome();                                // listed before it is shown: its pane's head says where it is
    await show(gatherer, s.id);
  } finally { state.starting = null; renderAgents(); }
}
// An actor on a branch of its own (branches.py): made from one of the gatherer's PROJECTS -- the git repositories set for
// it, each a clone here -- in a worktree beside it, on a new branch from its last commit; what it changes there merged
// into the project's folder (the one the Editor shows) as it changes it, but for the lines being edited in the Editor
// (its conflict zone) and those the project changed too, which wait for the reader -- and, with "auto-merge with
// approval", every change waits (kept in this browser, as the last choice). Its button opens a drop-down of the gatherer's
// sources (its projects) and "Add a source…"; either opens a popup to start it from.
const BRANCH_START = "branch", BRANCH_APPROVE_KEY = "ag-branch-approve";
const branchOf = (g, a) => ((state.home && state.home.branches) || []).find((b) => b.gatherer === g && b.channel === a.channel) || null;
const branchWaiting = (b) => Object.values(b.held || {}).reduce((n, v) => n + v.n, 0);
// What a folder has checked out (branches.py's `checked_out`): its branch, or its commit alone.
const checkedOut = (o) => !o || !o.head ? "?" : o.branch || `${o.head} (no branch)`;
// Where an actor's branch came from, and where its changes go: said whole, for a title.
const branchRoute = (b) => `From: its own branch, ${b.branch}, in ${tildePath(b.worktree, state.home.home_dir)}, `
  + `started from ${b.started_on || "a commit"} at ${(b.start || "").slice(0, 7)}.\n`
  + `Into: ${tildePath(b.project, state.home.home_dir)}, on ${checkedOut(b.onto)} now: its changes merged there`
  + `${b.approve ? " once you approve each" : ", but for lines you are editing, and lines you changed too"}.`;
function branchChip(g, a) {
  const b = branchOf(g.name, a);
  if (!b) return null;
  const n = branchWaiting(b);
  return el("div", { class: "branchline", title: branchRoute(b) + (n ? `\n${plural(n, "change")} wait for you in the Editor` : "") },
    strokeIcon(ICONS.branch, 11), el("span", { class: "rt", text: `${b.branch} → ${checkedOut(b.onto)}` }),
    n ? el("span", { class: "wait", text: `${n} to approve` }) : null);
}
// The directories the gatherer's actors work in, the latest first: where its sources are suggested from.
const actorDirs = (g) => [...new Set([...g.agents].sort((x, y) => (y.last || 0) - (x.last || 0)).map(cwdOf).filter(Boolean)
  .concat(state.home.cwd ? [state.home.cwd] : []))];
const projectName = (p) => p.github || p.name;
// The branch button's drop-down: the gatherer's sources so far (its projects), each opening the popup with it chosen, and
// "Add a source…", opening it at the choice of one. Closed by a press elsewhere, Esc, or the page scrolling or resizing.
// Outside the list, so the list's redraws leave it be.
const brPick = { g: "", menu: null, dialog: null, projects: [], suggestions: [], dirs: [], project: "", choosing: false,
  where: "", error: "", busy: false, approve: false };
async function brLoad(g) {
  brPick.dirs = actorDirs(g);
  const got = await get(`/api/projects?${new URLSearchParams({ gatherer: g.name, dirs: JSON.stringify(brPick.dirs) })}`);
  Object.assign(brPick, { projects: got.projects, suggestions: got.suggestions });
}
function brMenuClose() {
  const m = brPick.menu;
  if (!m) return;
  brPick.menu = null;
  m.el.remove();
  document.removeEventListener("pointerdown", m.away, true);
  document.removeEventListener("keydown", m.esc, true);
  window.removeEventListener("resize", brMenuClose);
  window.removeEventListener("scroll", brMenuClose, true);
  m.button.setAttribute("aria-expanded", "false");
}
async function openBranchMenu(g, button) {
  if (brPick.menu && brPick.menu.g === g.name) return brMenuClose();
  brMenuClose();
  const box = el("div", { class: "br-menu", role: "menu", "aria-label": `New actor on a branch, in ${g.name}` },
    el("div", { class: "hd", text: "Reading its sources…" }));
  const m = brPick.menu = { g: g.name, el: box, button,
    away: (ev) => { if (!box.contains(ev.target) && !button.contains(ev.target)) brMenuClose(); },
    esc: (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); brMenuClose(); button.focus(); } } };
  document.body.append(box);
  const r = button.getBoundingClientRect();
  box.style.top = `${Math.round(r.bottom + 4)}px`;
  box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)))}px`;
  button.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", m.away, true);
  document.addEventListener("keydown", m.esc, true);
  window.addEventListener("resize", brMenuClose);
  window.addEventListener("scroll", brMenuClose, true);
  let error = "";
  try { await brLoad(g); } catch (e) { error = e.message; }
  if (brPick.menu !== m) return;
  const pick = (p) => () => { brMenuClose(); openBranchDialog(g, p ? p.path : null); };
  box.replaceChildren(
    el("div", { class: "hd", text: error || (brPick.projects.length ? "New actor on a branch of" : "No source yet") }),
    ...brPick.projects.map((p) => el("button", { type: "button", role: "menuitem", title: `${p.path}${p.remote ? "\n" + p.remote : ""}`,
      onclick: pick(p) },
      el("span", { class: "nm", text: projectName(p) }), el("span", { class: "on", text: checkedOut(p) }),
      el("span", { class: "at", text: tildePath(p.path, state.home.home_dir) }))),
    brPick.projects.length ? el("div", { class: "sep" }) : null,
    el("button", { type: "button", role: "menuitem", class: "add", onclick: pick(null) }, "+ Add a source…"));
  box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)))}px`;
  const first = box.querySelector("button");
  if (first) first.focus();
}
// The popup: the source (chosen in the drop-down, or here -- among the gatherer's, the repositories its actors work in,
// or a folder or GitHub repository typed), where the branch comes from and where its changes go, whether each change
// waits for approval (the last choice, kept in this browser), and the harness that starts it.
async function openBranchDialog(g, project) {
  try { brPick.approve = localStorage.getItem(BRANCH_APPROVE_KEY) === "1"; } catch (e) { brPick.approve = false; }
  Object.assign(brPick, { g: g.name, project: project || "", choosing: !project, where: "", error: "", busy: false });
  if (!brPick.dialog) {
    brPick.dialog = el("dialog", { class: "br-dialog", "aria-label": "New actor on a branch" });
    brPick.dialog.addEventListener("close", () => { brPick.g = ""; });
    brPick.dialog.addEventListener("click", (ev) => { if (ev.target === brPick.dialog) brPick.dialog.close(); });   // the backdrop
    document.body.append(brPick.dialog);
  }
  brRender();
  if (!brPick.dialog.open) brPick.dialog.showModal();
  const first = brPick.dialog.querySelector(brPick.choosing ? ".br-add input" : "button[type=submit]");
  if (first) first.focus();
}
async function brSources(body) {
  brPick.busy = true; brPick.error = ""; brRender();
  try {
    const had = new Set(brPick.projects.map((p) => p.path));
    const got = await post("/api/projects", { gatherer: brPick.g, dirs: brPick.dirs, ...body });
    Object.assign(brPick, { projects: got.projects, suggestions: got.suggestions });
    const added = got.projects.find((p) => !had.has(p.path));
    if (added) Object.assign(brPick, { project: added.path, where: "", choosing: false });
    if (!got.projects.some((p) => p.path === brPick.project)) Object.assign(brPick, { project: "", choosing: true });
  } catch (e) { brPick.error = e.message; }
  brPick.busy = false;
  brRender();
}
function brRender() {
  const d = brPick.dialog, g = brPick.g, hs = startable(), home = state.home.home_dir;
  if (!d) return;
  const chosen = brPick.projects.find((p) => p.path === brPick.project);
  const busy = brPick.busy ? { disabled: "" } : {};
  const form = el("form", { class: "newform", method: "dialog" });
  let source;
  if (brPick.choosing || !chosen) {
    const where = el("input", { value: brPick.where, placeholder: "a folder in a git repository, or owner/repo", spellcheck: "false",
      "aria-label": "A folder in a git repository, or a GitHub repository", oninput: (ev) => { brPick.where = ev.target.value; },
      onkeydown: (ev) => { if (ev.key === "Enter") { ev.preventDefault(); if (brPick.where.trim()) brSources({ add: brPick.where.trim() }); } } });
    source = [
      brPick.projects.length ? el("div", { class: "projects" }, el("div", { class: "lbl", text: `${g}'s sources` }),
        ...brPick.projects.map((p) => el("div", { class: "br-row" + (p.path === brPick.project ? " on" : "") },
          el("button", { type: "button", class: "use", title: p.path, ...busy,
            onclick: () => { Object.assign(brPick, { project: p.path, choosing: false, error: "" }); brRender(); } },
            el("span", { class: "nm", text: projectName(p) }), el("span", { class: "at", text: tildePath(p.path, home) }),
            el("span", { class: "on", text: checkedOut(p) })),
          el("button", { type: "button", class: "rm", title: `No longer one of ${g}'s sources (its actors' branches are left as they are)`,
            "aria-label": `Remove ${projectName(p)}`, ...busy, onclick: () => brSources({ remove: p.path }) }, "×")))) : null,
      brPick.suggestions.length ? el("div", { class: "projects" }, el("div", { class: "lbl", text: "Where its actors work" }),
        ...brPick.suggestions.map((p) => el("button", { type: "button", class: "suggest", title: `${p.path}${p.remote ? "\n" + p.remote : ""}`,
          ...busy, onclick: () => brSources({ add: p.path }) },
          el("span", { text: `+ ${projectName(p)}` }), el("span", { class: "at", text: tildePath(p.path, home) })))) : null,
      el("div", { class: "projects br-add" }, el("div", { class: "lbl", text: "Another source" }),
        el("div", { class: "addrow" }, where, el("button", { type: "button", ...busy,
          onclick: () => { if (brPick.where.trim()) brSources({ add: brPick.where.trim() }); } }, brPick.busy ? "Adding…" : "Add")),
        el("div", { class: "desc", text: "A GitHub repository with no clone here is cloned under ag's home." })),
    ];
  } else {
    source = [el("div", { class: "br-src" },
      el("div", { class: "top" }, el("span", { class: "nm", text: projectName(chosen) }),
        el("span", { class: "at", title: chosen.path, text: tildePath(chosen.path, home) }),
        el("button", { type: "button", class: "link", onclick: () => { brPick.choosing = true; brRender(); } }, "Change")),
      el("div", { class: "desc route" }, "From: a new branch, off ", el("code", { text: checkedOut(chosen) }),
        ` at ${chosen.head || "?"}. Into: `, el("code", { text: tildePath(chosen.path, home) }), ", on ",
        el("code", { text: checkedOut(chosen) }), "."))];
  }
  const approve = el("input", { type: "checkbox", checked: brPick.approve ? "" : null, onchange: (ev) => {
    brPick.approve = ev.target.checked;
    try { localStorage.setItem(BRANCH_APPROVE_KEY, brPick.approve ? "1" : "0"); } catch (e) { /* this page only */ }
  } });
  const ready = chosen && !brPick.choosing && !brPick.busy && !state.starting;
  const starts = hs.map((h) => el("button", { type: "submit", value: h, ...(ready ? {} : { disabled: "" }) },
    harnessBadge(h), harnessName(h)));
  form.append(...[
    el("div", { class: "br-title" }, el("h3", {}, strokeIcon(ICONS.branch, 15), "New actor on a branch"),
      el("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => d.close() }, "×")),
    el("div", { class: "desc", text: `In ${g}. It works in a worktree of its source, on a new branch from the source's last commit; what it changes is merged into the source's folder as it changes it.` }),
    el("div", { class: "lbl", text: "Source" }),
    ...source,
    el("label", { class: "check", title: "Without it, its changes are merged in as they come, but for lines you are editing in the Editor, and lines you changed too, which wait for you" },
      approve, el("span", {}, el("b", { text: "Auto-merge with approval" }), ": each change waits in the Editor for you to accept or reject it")),
    el("div", { class: "err", role: "alert", text: brPick.error || (hs.length ? "" : noHarness()) }),
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => d.close() }, "Cancel"), ...starts),
  ].filter(Boolean));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!chosen || brPick.choosing) return;
    const harness = ev.submitter ? ev.submitter.value : hs[0];
    brPick.busy = true; brRender();
    try { await startBranch(g, chosen.path, harness, brPick.approve); d.close(); }
    catch (e) { brPick.error = e.message; brPick.busy = false; brRender(); }
  });
  d.replaceChildren(form);
}
async function startBranch(gatherer, project, harness, approve) {
  state.starting = { gatherer, harness: BRANCH_START };
  renderAgents();
  try {
    const s = await post("/api/branches", { gatherer, project, harness, approve });
    await fileStarted(gatherer, s.session_id);
    state.adding = null;
    collapsed.delete(s.gatherer);
    await loadHome();
    await show(s.gatherer, s.session_id, "files");
  } finally { state.starting = null; renderAgents(); }
  const box = panes.focus !== panes.here ? null : document.getElementById("composer-text");
  if (box) box.focus();
}
function newForm() {
  const adding = state.adding, fixed = adding.gatherer, hs = startable(), shell = adding.harness === SHELL_START;
  const cwd = el("input", { name: "cwd", value: adding.cwd || state.home.cwd || "", spellcheck: "false" });
  const err = el("div", { class: "err", role: "alert", text: adding.error || (hs.length || shell ? "" : noHarness()) });
  const starts = hs.map((h) => el("button", { type: "submit", value: h, class: h === adding.harness ? "primary" : "",
    ...(state.starting ? { disabled: "" } : {}) }, harnessBadge(h), harnessName(h)));
  const tooled = hs.filter((h) => (harnessInfo(h) || {}).mcp);
  for (const a of tooled.length ? startingApps() : []) for (const h of tooled) starts.push(el("button", { type: "submit",
    value: `${APP_START}${a.name}:${h}`, class: adding.harness === `${APP_START}${a.name}:${h}` ? "primary" : "",
    title: `${a.label}, its agent on ${harnessName(h)}`, ...(state.starting ? { disabled: "" } : {}) },
    a.mark ? appMarkImg(a) : strokeIcon(ICONS.app, 14), a.label, harnessBadge(h)));
  if (state.home.browser) for (const h of hs) starts.push(el("button", { type: "submit", value: BW_START + h,
    class: adding.harness === BW_START + h ? "primary" : "", title: `Browser, its agent on ${harnessName(h)}`,
    ...(state.starting ? { disabled: "" } : {}) }, strokeIcon(ICONS.globe, 14), "Browser", harnessBadge(h)));
  if (state.home.terminals !== false) starts.push(el("button", { type: "submit", value: SHELL_START, class: shell ? "primary" : "",
    ...(state.starting ? { disabled: "" } : {}) }, strokeIcon(ICONS.terminal, 14), "Terminal"));
  const appAt = String(adding.harness || "").startsWith(APP_START) ? window.agNext.apps.named(appStart(adding.harness)[0]) : null;
  const bwing = String(adding.harness || "").startsWith(BW_START);
  const form = el("form", { class: "newform", "aria-label": "New session" },
    el("div", { class: "desc", text: shell ? `A new terminal, listed under ${fixed}` : appAt ? `A new ${appAt.label} in ${fixed}`
      : bwing ? `A new Browser in ${fixed}` : `A new session in ${fixed}` }),
    el("label", {}, "Working directory", cwd),
    err,
    el("div", { class: "row" }, el("button", { type: "button", onclick: () => { state.adding = null; renderAgents(); } }, "Cancel"), ...starts));
  // Enter starts the harness last chosen (the primary), not the first of the buttons; with none chosen (a new
  // gatherer's first session), no harness is marked, and Enter waits for a click
  cwd.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const chosen = starts.find((b) => b.classList.contains("primary"));
    if (chosen) form.requestSubmit(chosen);
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const harness = ev.submitter ? ev.submitter.value : adding.harness;
    Object.assign(adding, { cwd: cwd.value.trim(), harness, error: "" });
    try { await startAny(fixed, adding.cwd, harness); }
    catch (e) { adding.error = e.message; renderAgents(); }
  });
  return form;
}

