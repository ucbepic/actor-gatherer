// ------------------------------------------------------------------ the selected agent
// The main view is the actor's conversation (chatCard): all of it, with the message box under it where
// the actor can be messaged here. What ag saw and did for it -- the Actor and Gatherer views -- is the
// details panel (detailsPanel), opened from the page's header, at the chat's right. The apps' panels are above the
// panes, in the top row (18-top.js's topMount: the chat minimized under it, or not).
function renderMain() {
  topMount();
  const main = document.getElementById("main");
  if (!state.selected) {
    document.getElementById("controls").replaceChildren();
    main.replaceChildren(el("div", { class: "empty", text: "No actors yet. Run a harness through ag and it appears here." }));
    return;
  }
  const x = document.getElementById("pane-close"), shell = isShell(state.selected[1]);
  x.title = shell ? "Close this pane: the terminal runs on, under its gatherer (Terminate ends it)" : "Close this pane";
  x.setAttribute("aria-label", x.title);
  if (shell) { patch(main, [chatMin() ? shellMini(state.selected[1]) : shellCard(state.selected[1])]); fitMini(); return; }
  const info = selectedInfo() || {};
  const kids = [chatCard(info), ...(state.details && !chatMin() ? [detailsPanel(info)] : [])];
  const open = new Set([...main.querySelectorAll("details[open][id]")].map((d) => d.id));
  for (const k of kids) for (const d of k.querySelectorAll("details[id]")) if (open.has(d.id)) d.open = true;
  patch(main, kids);
  fitMini();
  if (document.getElementById("size-chart") && state.agent && state.agent.reads) drawCharts();
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
function setDetails(open, tab) {
  state.details = open;
  if (tab) {
    state.detailsTab = tab;
    try { localStorage.setItem(DETAILS_KEY, tab); } catch (e) { /* this page only */ }
  }
  keepingPlace(renderMain);
  drawn.main = mainSignature();
  if (open) { const b = document.querySelector(".drawer-body"); if (b && tab) b.scrollTop = 0; }
}
// The dashboard's own commands, typed in a message box: done here, not sent to the agent. Any other "/" goes to the
// agent as written -- Claude Code's own commands, skills and command files -- so the dashboard takes only these; one
// that reaches the session's terminal shows the reader that terminal (the composer's send).
//   /context   ag's context for the actor -- what the model was really sent, which under ag is not what Claude Code's
//              own /context counts -- in the details panel, beside the chat
const DASHBOARD_COMMANDS = { "/context": () => setDetails(true, "context") };
function dashboardCommand(text) {
  const run = DASHBOARD_COMMANDS[String(text ?? "").trim().toLowerCase()];
  if (run) run();
  return !!run;
}
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
    || !document.getElementById("about").hidden || window.agNext.settings.fileOpen()) return;
  if (!PANE && panes.focus !== panes.here ? panes.focus.call("escape") : escapeShown()) ev.preventDefault();
}, true);
// An Esc from outside the message box, for the actor this pane shows: in Chat, its panel closed (the Esc closes that).
// While the agent asks too, as from the box: the question dismissed, as an Esc on it in its terminal -- after a click on
// one of the card's choices among them.
function escapeShown() {
  const info = selectedInfo();
  return !!state.selected && !isShell(state.selected[1]) && !state.details && chatView().id === "files"
    && !!info && interrupt(info);
}
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && state.details && !ev.defaultPrevented && !(ev.target && ev.target.id === "composer-text")
    && !(state.selected && isShell(state.selected[1]))) setDetails(false);
});
// Its Context side, what the model was sent, beside the chat: what `/context` in the message box opens (dashboardCommand).
function detailsPanel(info) {
  const a = state.agent;
  const switcher = el("div", { class: "views", role: "group", "aria-label": "Details shown" },
    ...[["actor", "Actor", "The agent's calls: its context's size now, and the tokens its calls sent"],
      ["context", "Context", "What the model was sent at the latest call, item by item, and its size over the session"],
      ["gatherer", "Gatherer", "What ag did for the agent: its builds and its own model calls"]].map(([id, name, title]) =>
      el("button", { type: "button", title, "aria-pressed": state.detailsTab === id ? "true" : "false", onclick: () => setDetails(true, id) }, name)));
  const head = el("div", { class: "drawer-head" }, switcher, el("span", { class: "grow" }),
    el("button", { type: "button", class: "close", title: "Close (Esc)", "aria-label": "Close details", onclick: () => setDetails(false) }, "×"));
  const tab = state.detailsTab;
  const body = el("div", { class: "drawer-body", "data-keep": `details-${tab === "context" ? "context" : "more"}` },
    ...(tab === "context" ? [] : [moreViews(), facts(info)]).filter(Boolean));
  if (!a || a.error || !a.reads) body.append(el("div", { class: "empty", text: (a && a.error) || (info.session
    ? "No calls yet: send the agent a message." : "No data for this actor.") }));
  else body.append(...(tab === "gatherer" ? gathererDetails(a) : tab === "context" ? contextDetails(a) : actorDetails(a)));
  return el("aside", { class: "drawer", role: "complementary", "aria-label": "Details" }, head, body);
}
// The actor's own facts: where it runs, as what, and how the dashboard can reach it.
function facts(info) {
  const s = info.session;
  const rows = [
    ["Harness", harnessName(info.harness || (state.agent && state.agent.harness))],
    ["Gatherer", state.selected[0]], ["Channel", state.selected[1]], ["Directory", info.cwd || (s && s.cwd)],
    ["Process", info.pid ? `PID ${info.pid}` : null],
    ["Chat", !hasChat(info) ? `Not from the dashboard: only ${runnableNames("and")} sessions with a directory can be messaged here`
      : s && s.terminal ? "Open in the dashboard's terminal: a message from any view is typed there"
      : s ? `Run by the dashboard, permissions ${s.permission_mode}; let go after each turn`
      : "Started elsewhere: a message resumes it here, permissions auto"],
  ].filter(([, v]) => v);
  return el("dl", { class: "facts" }, ...rows.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]));
}
function actorDetails(a) {                           // what the agent saw and did
  const reads = a.reads, last = reads[reads.length - 1] || {};
  return [
    el("div", { class: "tiles" },
      tile("Context now", compact(last.real_tokens ?? last.counted_tokens),
        last.real_tokens !== null && last.real_tokens !== undefined ? `provider's count · ag counted ${compact(last.counted_tokens)}` : "ag's count"),
      tile("Harness limit", compact(last.limit_tokens), last.limit_tokens ? "where the harness compacts" : "none stated"),
      tile("Tasks", full(a.tasks.length), "as ag has segmented the history"),
      tile("Reads", full(reads.length), last.at ? `last ${ago(last.at)}` : "")),
    usageCard(),
  ];
}
function contextDetails(a) {                         // what the model was sent, beside the chat
  return [contextCard(), sizeCard(a.reads, a.reads.some((r) => typeof r.real_tokens === "number"))];
}
function gathererDetails(a) {                        // what ag did for the agent
  const builds = a.builds || [], failed = builds.filter((b) => b.status === "failed").length;
  const llm = a.llm.total;
  return [
    el("div", { class: "tiles" },
      tile("Rebuilds", full(a.rebuilds), "reads on a new build"),
      tile("Builds", full(builds.length), failed ? `${failed} failed` : "none failed"),
      tile("New-task checks", full(a.checks.length), `${a.checks.filter((x) => x.new_task).length} said a new task`),
      tile("ag's model calls", full(llm.calls), `${usd(llm.cost)}${llm.unpriced ? ` + ${llm.unpriced} unpriced` : ""}`)),
    buildsCard(builds),
    llmCard(a),
  ];
}

