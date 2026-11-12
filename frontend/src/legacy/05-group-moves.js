// ------------------------------------------------------------------ moves between groups
// In the home's one database (state.home.merged: `ag home merge`'s), what is dragged in the list may be dropped into
// another group -- actors, each with its task (which moves whole), or a folder with all in it -- once the reader says
// so (the Notes design "Groups: design", section 2): a dialog says who moves, from which group to which, how many
// others each has, and how many of those moving are working now, which rebuild their context at their next call. Then
// the server moves them (/api/groups, groups.py), and a pane showing one of them follows it. An app does not move
// between groups yet: a drag holding one, or a folder with one in it, stays in its group, as every drag did before.
const moveAsk = { dialog: null, busy: false };
const WORKING = new Set(["Running", "Waiting for you", "Background"]);     // groupOf's: working now

// Whether what is dragged (listDrag) may go into group `g` from another -- a group, not the list's head (GFS) --
// asked first (askMove)
function canCross(g) {
  const d = listDrag;
  if (!d || d.g === g.name || !state.home.merged || d.gs || !state.home.gatherers.some((x) => x.name === g.name)) return false;
  const from = state.home.gatherers.find((x) => x.name === d.g);
  if (!from) return false;
  if (d.folder !== null) return !!folderById(d.g, d.folder) && !folderHasApps(d.g, d.folder);
  const items = withTasks(from, d.cs);
  return items.length > 0 && items.every((c) => !isAppItem(c) && !!actorOf(from, c) && !isCoordinator(actorOf(from, c)));
}
// whether folder `id` of `gname`, or one in it, holds an app
const folderHasApps = (gname, id) => gathererApps(gname).some((o) => ((f) => f !== null && within(gname, f, id))(appFolder(gname, o.id)));
const mvCount = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// What is dragged (`d`, listDrag's), dropped into folder `id` of group `g` (null: its top): the dialog, then the move
async function askMove(d, g, id) {
  const from = state.home.gatherers.find((x) => x.name === d.g);
  if (!from) return;
  const body = { gatherer: d.g, to: g.name, ...(d.folder !== null ? { folder: d.folder } : { channels: withTasks(from, d.cs) }) };
  if (!moveAsk.dialog) {
    moveAsk.dialog = el("dialog", { class: "br-dialog mv-dialog", "aria-label": "Move to another group" });
    moveAsk.dialog.addEventListener("click", (ev) => { if (ev.target === moveAsk.dialog && !moveAsk.busy) moveAsk.dialog.close(); });
    moveAsk.dialog.addEventListener("cancel", (ev) => { if (moveAsk.busy) ev.preventDefault(); });
    document.body.append(moveAsk.dialog);
  }
  moveAsk.busy = false;
  mvRender(g, null, "Working out who moves…");
  if (!moveAsk.dialog.open) moveAsk.dialog.showModal();
  let plan;
  try { plan = await post("/api/groups", { ...body, do: "plan" }); } catch (err) { mvRender(g, null, `Can't move: ${err.message}`); return; }
  const go = async () => {
    moveAsk.busy = true;
    mvRender(g, plan, "Moving…");
    try {
      await post("/api/groups", { ...body, do: "move", into: id });
    } catch (err) {
      moveAsk.busy = false;
      mvRender(g, plan, `Not moved: ${err.message}`, go);
      return;
    }
    moveAsk.busy = false;
    moveAsk.dialog.close();
    await loadHome();
    await followMoved(d.g, g.name, plan.actors);
    renderAgents();
    setLive(`Moved to the ${titleOf(g)} group`);
  };
  mvRender(g, plan, "", go);
}
// The dialog drawn: what moves where (`plan`: /api/groups's; null: not known yet), then `note`, then Move (`go`) and Cancel
function mvRender(g, plan, note, go = null) {
  const box = moveAsk.dialog, from = plan ? state.home.gatherers.find((x) => x.name === plan.from) : null;
  const lines = plan && from ? moveLines(from, g, plan) : [];
  const busy = moveAsk.busy ? { disabled: "" } : {};
  const form = el("form", { class: "newform", method: "dialog" },
    el("div", { class: "br-title" }, el("h3", { text: `Move to the ${titleOf(g)} group?` }),
      el("button", { type: "button", class: "x", "aria-label": "Close", ...busy, onclick: () => box.close() }, "×")),
    ...lines.map((t) => el("p", { class: "mv-line", text: t })),
    plan && from ? moveNames(from, plan) : null,
    note ? el("p", { class: "mv-note", role: "status", text: note }) : null,
    el("div", { class: "row" }, el("button", { type: "button", ...busy, onclick: () => box.close() }, "Cancel"),
      go ? el("button", { type: "submit", class: "primary", ...busy }, "Move") : null));
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
  const working = actors.filter((a) => WORKING.has(groupOf(from, a))).length;
  out.push(working ? `${mvCount(working, "of them is", "of them are")} working now, and ${working === 1 ? "rebuilds its" : "rebuild their"} `
    + "context at the next call; the others when they next run." : `${one ? "It rebuilds its" : "Each rebuilds its"} context when it next runs.`);
  return out;
}
// the actors that move, by name: those pulled along by a task marked so
function moveNames(from, plan) {
  const moving = from.agents.filter((a) => plan.actors.includes(a.channel));
  if (moving.length < 2) return null;
  const shown = moving.slice(0, 6);
  return el("ul", { class: "mv-names" }, ...shown.map((a) => el("li", { text: actorTitle(a) })),
    moving.length > shown.length ? el("li", { class: "more", text: `and ${moving.length - shown.length} more` }) : null);
}
// After a move: a pane showing an actor that moved shows it in its new group
async function followMoved(from, to, moved) {
  const gone = new Set(moved);
  for (const p of actorPanes()) if (p.g === from && gone.has(p.c)) { p.g = to; p.call("select", to, p.c, p.view); }
  savePanes(); connect();
  if (state.selected && state.selected[0] === from && gone.has(state.selected[1])) await select(to, state.selected[1]);
}
