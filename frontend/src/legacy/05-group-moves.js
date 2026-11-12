// ------------------------------------------------------------------ moves between groups
// In the home's one database (state.home.merged: `ag home merge`'s), what is dragged in the list may be dropped into
// another group -- actors, each with its task (which moves whole), or a folder with all in it -- once the reader says
// so (the Notes design "Groups: design", section 2): a dialog says who moves, from which group to which, how many
// others each has, and how many of those moving are working now, which rebuild their context at their next call. Then
// the server moves them (/api/groups, groups.py), and a pane showing one of them follows it. An app of a task or a
// folder that moves goes with it, its actors keeping it -- one with many instances (Browser, DocWriter, Editor). An
// app's own agent (one it started: 19-app-actors.js's appRole) and its window go together, as a task does (withOwn):
// so a group's only one of its app (Notes, Slack, Paper news) goes too when its own agent does -- into a group with one
// of its own, it closes, and its agent works with that one -- and otherwise stays with its group, a drag that would
// take it staying in its group, as every drag did before.
const moveAsk = { dialog: null, busy: false };
const WORKING = new Set(["Running", "Waiting for you", "Background"]);     // groupOf's: working now

// Whether what is dragged (listDrag) may go into group `g` from another -- a group, not the list's head (GFS) --
// asked first (askMove)
function canCross(g) {
  const d = listDrag;
  if (!d || d.g === g.name || !state.home.merged || d.gs || g.alone || !state.home.gatherers.some((x) => x.name === g.name)) return false;
  const from = state.home.gatherers.find((x) => x.name === d.g);
  if (!from) return false;
  if (d.folder !== null) return folderCanMove(from, d.folder);
  const items = withOwn(from, d.cs);
  return items.length > 0 && items.every((c) => isAppItem(c) ? appCanMove(from.name, c, items) : !!actorOf(from, c) && !isCoordinator(actorOf(from, c)));
}
// What dragging `cs` (items of group `g`) takes (groups.py's `actors`): each one's task, which moves whole, and an app's
// own agent with its window, the window with its agents, as they are one task
function withOwn(g, cs) {
  let out = withTasks(g, cs);
  for (;;) {
    const more = new Set(out);
    for (const a of g.agents) {
      const r = appRole({ session: { role: a.role } });
      if (!r) continue;
      if (more.has(appItem(r.key))) more.add(a.channel);
      else if (more.has(a.channel) && appInfo(g.name, r.key)) more.add(appItem(r.key));
    }
    const grown = withTasks(g, [...more]);
    if (grown.length === out.length) return out;
    out = grown;
  }
}
// whether the app item `k` (APP_ITEM + its id) of group `gname` may go to another group with `items`: one with many
// instances, or a group's only one of its app with its own agent among them (groups.py's `apps`) -- else it stays
const appCanMove = (gname, k, items = []) => ((o) => !!o && (o.app.instances === "many" || ownAgentIn(gname, o.id, items)))(
  appInfo(gname, String(k).slice(APP_ITEM.length)));
const ownAgentIn = (gname, id, items) => ((g) => !!g && g.agents.some((a) => items.includes(a.channel)
  && ((r) => !!r && r.key === id)(appRole({ session: { role: a.role } }))))(state.home.gatherers.find((x) => x.name === gname));
// whether folder `id` of group `g` may go: it is there, and every app in it, or in its actors' tasks, may go too
function folderCanMove(g, id) {
  if (!folderById(g.name, id)) return false;
  const filed = gathererApps(g.name).filter((o) => ((f) => f !== null && within(g.name, f, id))(appFolder(g.name, o.id)));
  const items = withOwn(g, [...actorsWithin(g, id).map((a) => a.channel), ...filed.map((o) => appItem(o.id))]);
  return items.every((c) => !isAppItem(c) || appCanMove(g.name, c, items));
}
// the apps a move takes (the server's plan: [{id, app, title, joins?}]), said: "The app Browser goes with it." -- and
// one that closes for the group `to`'s own of its app (`joins`): "Its Paper news closes: it works with the lab group's."
function appsLine(apps, many, to = null) {
  if (!apps || !apps.length) return null;
  const label = (x) => ((a) => (a && a.label) || x.app)(window.agNext && window.agNext.apps.named(x.app));
  const named = (x) => label(x) + (x.title && x.title !== label(x) ? ` (${x.title})` : "");
  const going = apps.filter((x) => !x.joins), joining = apps.filter((x) => x.joins);
  const list = going.map(named), out = [];
  if (list.length) out.push(`The ${list.length === 1 ? "app" : "apps"} ${list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`} `
    + `${list.length === 1 ? "goes" : "go"} with ${many ? "them" : "it"}.`);
  for (const x of joining) out.push(`${many ? "Their" : "Its"} ${named(x)} closes, as the ${to ? titleOf(to) : "other"} group has its own: `
    + `${many ? "they" : "it"} will work with that one.`);
  return out.join(" ");
}
const mvCount = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// What is dragged (`d`, listDrag's), dropped into folder `id` of group `g` (null: its top): the dialog, then the move
async function askMove(d, g, id) {
  const from = state.home.gatherers.find((x) => x.name === d.g);
  if (!from) return;
  const body = { gatherer: d.g, to: g.name, ...(d.folder !== null ? { folder: d.folder } : { channels: withOwn(from, d.cs) }) };
  const title = `Move to the ${titleOf(g)} group?`;
  mvOpen("Move to another group");
  mvDraw({ title, note: "Working out who moves…" });
  let plan;
  try { plan = await post("/api/groups", { ...body, do: "plan" }); } catch (err) { mvDraw({ title, note: `Can't move: ${err.message}` }); return; }
  const shown = { title, lines: moveLines(from, g, plan), names: moveNames(from, plan.actors), goLabel: "Move" };
  const go = mvGo(shown, "Moving…", "Not moved", async () => {
    const got = await post("/api/groups", { ...body, do: "move", into: id });
    return { to: g.name, actors: plan.actors, apps: (got.moved && got.moved.apps) || [], joined: (got.moved && got.moved.joined) || {},
      said: `Moved to the ${titleOf(g)} group` };
  }, d.g);
  mvDraw({ ...shown, go });
}
// A folder dropped outside every group (`d`, listDrag's): the dialog, then the folder made a group of its own (groups.py's
// `split`) -- the server's, named after it
function askSplit(d) {
  const from = state.home.gatherers.find((x) => x.name === d.g), f = from && folderById(d.g, d.folder);
  if (!f) return;
  const inside = withTasks(from, actorsWithin(from, d.folder).map((a) => a.channel)).filter((c) => !isAppItem(c));
  const going = [...new Set([...withTasks(from, actorsWithin(from, d.folder).map((a) => a.channel)).filter(isAppItem)
    .map((c) => c.slice(APP_ITEM.length)), ...gathererApps(d.g).filter((o) => ((x) => x !== null && within(d.g, x, d.folder))(appFolder(d.g, o.id))).map((o) => o.id)])]
    .map((i) => appInfo(d.g, i)).filter(Boolean).map((o) => ({ id: o.id, app: o.app.name, title: o.name || o.title }));
  const actors = from.agents.filter((a) => inside.includes(a.channel)), n = actors.length;
  const others = from.agents.filter((a) => !isCoordinator(a) && !inside.includes(a.channel)).length;
  const lines = [`The folder ${f.name} becomes a group of its own, ${f.name}, and what is in it goes to the new group's top.`
    + (n ? ` ${n === 1 ? "Its actor leaves" : `Its ${n} actors leave`} the ${titleOf(from)} group (${mvCount(others, "other")}) for it.`
      : ` It leaves the ${titleOf(from)} group.`)];
  if (n) lines.push(`${n === 1 ? "It" : "They"} will no longer share context with the actors of ${titleOf(from)}`
    + `${n === 1 ? "" : ", only with each other"}.`, rebuildLine(from, actors));
  const appsSaid = appsLine(going, n > 1);
  if (appsSaid) lines.push(appsSaid);
  const shown = { title: `Make ${f.name} a group of its own?`, lines, names: moveNames(from, inside), goLabel: "Make a group" };
  mvOpen("A folder made a group of its own");
  const go = mvGo(shown, "Making the group…", "Not made", async () => {
    const got = await post("/api/groups", { gatherer: d.g, do: "split", folder: d.folder });
    return { to: got.split.group, actors: got.split.actors, apps: got.split.apps || [], said: `${f.name} is a group of its own` };
  }, d.g);
  mvDraw({ ...shown, go });
}
// The dialog, made once, opened
function mvOpen(label) {
  if (!moveAsk.dialog) {
    moveAsk.dialog = el("dialog", { class: "br-dialog mv-dialog" });
    moveAsk.dialog.addEventListener("click", (ev) => { if (ev.target === moveAsk.dialog && !moveAsk.busy) moveAsk.dialog.close(); });
    moveAsk.dialog.addEventListener("cancel", (ev) => { if (moveAsk.busy) ev.preventDefault(); });
    document.body.append(moveAsk.dialog);
  }
  moveAsk.dialog.setAttribute("aria-label", label);
  moveAsk.busy = false;
  if (!moveAsk.dialog.open) moveAsk.dialog.showModal();
}
// What its button does: `act()` (-> {to, actors, said}), the dialog busy meanwhile; then the home read again, the panes
// that show an actor moved following it (from group `from`)
function mvGo(shown, doing, failed, act, from) {
  const go = async () => {
    moveAsk.busy = true;
    mvDraw({ ...shown, note: doing });
    let got;
    try { got = await act(); } catch (err) {
      moveAsk.busy = false;
      mvDraw({ ...shown, note: `${failed}: ${err.message}`, go });
      return;
    }
    moveAsk.busy = false;
    moveAsk.dialog.close();
    await loadHome();
    await followMoved(from, got.to, got.actors, got.apps || [], got.joined || {});
    renderAgents();
    setLive(got.said);
  };
  return go;
}
// The dialog drawn: its title, `lines`, the actors `names`, `note`, then Cancel and `goLabel` (`go`; none: not yet)
function mvDraw({ title, lines = [], names = null, note = "", go = null, goLabel = "" }) {
  const box = moveAsk.dialog, busy = moveAsk.busy ? { disabled: "" } : {};
  const form = el("form", { class: "newform", method: "dialog" },
    el("div", { class: "br-title" }, el("h3", { text: title }),
      el("button", { type: "button", class: "x", "aria-label": "Close", ...busy, onclick: () => box.close() }, "×")),
    ...lines.map((t) => el("p", { class: "mv-line", text: t })),
    names,
    note ? el("p", { class: "mv-note", role: "status", text: note }) : null,
    el("div", { class: "row" }, el("button", { type: "button", ...busy, onclick: () => box.close() }, "Cancel"),
      go ? el("button", { type: "submit", class: "primary", ...busy }, goLabel) : null));
  form.addEventListener("submit", (ev) => { ev.preventDefault(); if (go && !moveAsk.busy) go(); });
  box.replaceChildren(form);
  const submit = box.querySelector("button[type=submit]");
  if (submit && !moveAsk.busy) submit.focus();
}
// What the dialog says of a move (`plan`) from group `from` into `g`: the page's own counts, as the list has them
function moveLines(from, g, plan) {
  const moving = new Set(plan.actors), actors = from.agents.filter((a) => moving.has(a.channel));
  const others = (x) => x.agents.filter((a) => !isCoordinator(a) && !moving.has(a.channel)).length;
  const f = plan.folder !== undefined && plan.folder !== null ? folderById(from.name, plan.folder) : null;
  const n = actors.length, one = !f && n === 1;
  const what = f ? (n ? `The folder ${f.name} and its ${mvCount(n, "actor")}` : `The folder ${f.name}`) : one ? actorTitle(actors[0]) : `${n} actors`;
  const out = [`${what} ${one ? "moves" : "move"} from the ${titleOf(from)} group (${mvCount(others(from), "other")}) `
    + `to the ${titleOf(g)} group (${mvCount(others(g), "other")}).`];
  if (!n) return out;
  out.push(`${one ? "It" : "They"} will share context with the actors of ${titleOf(g)}, and no longer with those of ${titleOf(from)}.`);
  out.push(rebuildLine(from, actors));
  const apps = appsLine(plan.apps, !one, g);
  if (apps) out.push(apps);
  return out;
}
// how many of `actors` (of group `from`) rebuild their context at their next call, working now
function rebuildLine(from, actors) {
  const working = actors.filter((a) => WORKING.has(groupOf(from, a))).length, one = actors.length === 1;
  return working ? `${mvCount(working, "of them is", "of them are")} working now, and ${working === 1 ? "rebuilds its" : "rebuild their"} `
    + "context at the next call; the others when they next run." : `${one ? "It rebuilds its" : "Each rebuilds its"} context when it next runs.`;
}
// the actors that move (by their channels), by name, when more than one
function moveNames(from, channels) {
  const moving = from.agents.filter((a) => channels.includes(a.channel));
  if (moving.length < 2) return null;
  const shown = moving.slice(0, 6);
  return el("ul", { class: "mv-names" }, ...shown.map((a) => el("li", { text: actorTitle(a) })),
    moving.length > shown.length ? el("li", { class: "more", text: `and ${moving.length - shown.length} more` }) : null);
}
// After a move: a pane showing an actor that moved shows it in its new group, and an app's that moved (`apps`, their
// ids) is opened again there -- its panel was opened for its old group -- and one closed for the new group's own one
// (`joined`, {its id: that one's}) shows that one
async function followMoved(from, to, moved, apps = [], joined = {}) {
  const gone = new Set(moved);
  for (const p of actorPanes()) if (p.g === from && gone.has(p.c)) { p.g = to; p.call("select", to, p.c, p.view); }
  savePanes(); connect();
  if (apps.length || Object.keys(joined).length) {
    await Promise.all([readApps(from, true), readApps(to, true)]);
    for (const p of panes.apps.filter((q) => apps.includes(q.instance.id) && q.instance.gatherer === from)) swapAppPane(p, { ...p.instance, gatherer: to });
    for (const p of panes.apps.filter((q) => q.instance.id in joined && q.instance.gatherer === from)) {
      const there = appInfo(to, joined[p.instance.id]);
      if (there && panes.apps.some((q) => q.instance.id === there.id)) closeAppPane(p);   // shown already
      else if (there) swapAppPane(p, there.inst);
    }
  }
  if (state.selected && state.selected[0] === from && gone.has(state.selected[1])) await select(to, state.selected[1]);
}

// ---- outside every group: a folder dropped there is made a group of its own (askSplit), an actor is on its own (askAlone)
// Whether what is dragged may go outside every group: in the home's one database, from a group, a folder whose apps
// may go with it (folderCanMove), or one actor -- not the coordinator agent, and not one of a task with other actors (a
// task moves whole) -- with the apps of its task, and its window if it is an app's own agent, that may go (withOwn)
function canOutside() {
  const d = listDrag;
  if (!d || !state.home.merged || d.gs) return false;
  const from = state.home.gatherers.find((x) => x.name === d.g);
  if (!from || from.alone) return false;
  if (d.folder !== null) return folderCanMove(from, d.folder);
  const items = withOwn(from, d.cs || []), actors = items.filter((c) => !isAppItem(c));
  const a = actors.length === 1 ? actorOf(from, actors[0]) : null;
  return !!a && !isCoordinator(a) && items.every((c) => !isAppItem(c) || appCanMove(from.name, c, items));
}
// The place shown, while what is dragged may go there (startDrag's), saying what it does
function showOutside() {
  const can = canOutside(), n = document.querySelector(".outside-drop");
  document.body.classList.toggle("drag-out", can);
  if (n && can) n.textContent = listDrag.folder !== null ? "Outside every group: a group of its own" : "Outside every group: on its own";
}
// The place to drop it, over the list's head: shown while such a drag goes on (body.drag-out)
function outsideDrop() {
  if (SNAPSHOT || !state.home.merged) return null;
  const n = el("div", { class: "outside-drop", text: "Outside every group: a group of its own" });
  n.addEventListener("dragenter", (ev) => { if (canOutside()) { ev.preventDefault(); n.classList.add("drop-on"); } });
  n.addEventListener("dragover", (ev) => { if (canOutside()) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; } });
  n.addEventListener("dragleave", (ev) => { if (!n.contains(ev.relatedTarget)) n.classList.remove("drop-on"); });
  n.addEventListener("drop", (ev) => {
    if (!canOutside()) return;
    ev.preventDefault();
    ev.stopPropagation();                            // the list's head it is over: not dropped there too
    const d = listDrag;
    d.later = false;
    endDrag();
    if (d.folder !== null) askSplit(d); else askAlone(d);
  });
  return n;
}

// ---- an actor on its own: a group of one (groups.py's `alone`, `self:<channel>`), listed as its row alone (no head: its
// title says what it is);
// it has no coordinator agent. Dragged into a group, it is asked first, as any move between groups (askMove).
const ALONE_SAYS = "On its own: it shares context with no other actor, and no other actor with it. Drag it into a group to bring it back.";
const aloneActor = (g) => g.agents.find((x) => !isCoordinator(x));
function aloneBox(g) {
  const a = aloneActor(g);
  return el("div", { class: "gatherer alone", title: ALONE_SAYS },
    ...(a ? rowsOf(g, a, groupOf(g, a)) : []), ...appRowsIn(g, null));   // its task, with its apps; its apps in none
}
function railAlone(g) {
  const a = aloneActor(g);
  return el("section", { class: "r-gatherer r-alone", "aria-label": "On its own", title: ALONE_SAYS },
    ...(a ? railRowsOf(g, a) : []), ...railAppsIn(g, null));
}
// Once closed (groupOf's Closed; saved too, Saved), an actor on its own leaves the top of the list, as a group's closed
// actors go into its closed line: every such one is in a line at the list's end -- "▸ N closed", and "▸ N saved" --
// opened again from there as any closed actor is (a message starts it, and it is back at
// the top). Open or not kept in this browser (foldOpen, by ALONE_KEY); folded, those open in a pane in view under it. Never
// hidden as a group is (isHidden): closed, it is in its line. The rail likewise (railAloneShut), its lines shown as its
// foot says for its boxes' saved and closed lines (railShow), "▸ N closed" (the rest in its title: the rail is narrow).
const ALONE_KEY = "\u0000alone";
function aloneShut(g) {
  const a = g.alone && aloneActor(g);
  return !!a && ["Saved", "Closed"].includes(groupOf(g, a));
}
// [Saved | Closed, those of `gs` (each aloneShut) in it, the latest first], each with any
function aloneFolds(gs) {
  const latest = (x, y) => (aloneActor(y).last || 0) - (aloneActor(x).last || 0);
  return ["Saved", "Closed"].map((name) => [name, gs.filter((g) => groupOf(g, aloneActor(g)) === name).sort(latest)])
    .filter(([, list]) => list.length);
}
const aloneSays = (name, n) => `${n} ${name.toLowerCase()}`;
const aloneInPane = (list) => list.filter((g) => inPane(g, aloneActor(g)));
function aloneShutRows(gs) {
  const out = [];
  for (const [name, list] of aloneFolds(gs)) {
    const shown = foldOpen[name].has(ALONE_KEY);
    out.push(el("button", { class: "agent-group fold-line", type: "button", "aria-expanded": shown ? "true" : "false",
      "data-key": `${ALONE_KEY}/${name}`, onclick: () => toggleFold(name, ALONE_KEY),
      title: `${shown ? "Hide" : "Show"} the ${name === "Saved" ? "saved " : ""}actors on their own that are closed` },
    `${shown ? "▾" : "▸"} `, aloneSays(name, list.length)));
    if (shown) out.push(...list.flatMap((g) => rowsOf(g, aloneActor(g), name)));
    else out.push(...aloneInPane(list).map((g) => agentRow(g, aloneActor(g), name)));
  }
  return out.length ? [el("div", { class: "gatherer alone shut" }, ...out)] : [];
}
function railAloneShut(gs) {
  const out = [];
  for (const [name, list] of aloneFolds(gs)) {
    const what = name.toLowerCase(), unfolded = foldOpen[name].has(ALONE_KEY);
    const peek = () => aloneInPane(list).map((g) => railActor(g, aloneActor(g)));
    if (!railShow[what]) { out.push(...peek()); continue; }   // its line not shown: those open in a pane, in view
    out.push(el("button", { class: "r-fold", type: "button", "aria-expanded": unfolded ? "true" : "false",
      title: `${aloneSays(name, list.length)}: ${unfolded ? "hide" : "show"} ${list.length === 1 ? "it" : "them"}`,   // its words: too wide here
      onclick: () => toggleFold(name, ALONE_KEY) }, `${unfolded ? "▾" : "▸"} ${list.length} ${what}`));
    out.push(...(unfolded ? list.flatMap((g) => railRowsOf(g, aloneActor(g))) : peek()));
  }
  return out.length ? [el("section", { class: "r-gatherer r-alone shut", "aria-label": "Closed, on their own" }, ...out)] : [];
}
// One actor (`d`, listDrag's) dropped outside every group: the dialog, then it on its own, with its task's apps and
// its own window if it is an app's agent (withOwn)
function askAlone(d) {
  const from = state.home.gatherers.find((x) => x.name === d.g), items = from ? withOwn(from, d.cs || []) : [];
  const c = items.find((k) => !isAppItem(k)), a = c && actorOf(from, c);
  if (!a) return;
  const name = actorTitle(a), others = from.agents.filter((x) => !isCoordinator(x) && x.channel !== c).length;
  const going = items.filter(isAppItem).map((k) => appInfo(d.g, k.slice(APP_ITEM.length))).filter(Boolean)
    .map((o) => ({ id: o.id, app: o.app.name, title: o.name || o.title }));
  const lines = [`${name} leaves the ${titleOf(from)} group (${mvCount(others, "other")}) and works on its own: it will share context `
    + "with no other actor, and no other actor with it.", appsLine(going, false), "It has no coordinator agent. Drag it into a group to bring it back.",
  rebuildLine(from, [a])].filter(Boolean);
  const shown = { title: "Take it out of every group?", lines, goLabel: "Take it out" };
  mvOpen("An actor on its own");
  const go = mvGo(shown, "Taking it out…", "Not taken out", async () => {
    const got = await post("/api/groups", { gatherer: d.g, do: "alone", channel: c });
    return { to: got.alone.group, actors: got.alone.actors, apps: got.alone.apps || [], said: `${name} is on its own` };
  }, d.g);
  mvDraw({ ...shown, go });
}
