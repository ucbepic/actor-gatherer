import { PANE, SNAPSHOT, panes, state } from "../../core/page/state.js";
import { ICONS, el, gathererNamed, post, strokeIcon } from "../../core/page/helpers.js";
import { loadHome, setAbout, setLive } from "../page/data.js";
import { connect } from "../settings/panel.js";
import {
  APP_ITEM, COLLAPSED_KEY, CTX, LIST_HOST, actorOf, actorTitle, actorsWithin, appFolder, appInfo, appItem, collapsed,
  endDrag, folderById, folderOf, gathererApps, groupCrew, groupOf, isAppItem, isCoordinator, listDrag, nameFolder,
  readApps, renderAgents, showFolder, startDrag, titleOf, withTasks, within,
} from "./list.js";
import * as LG from "./groups";
import { buildManage } from "./manage-model";
import { drawListDialogs, drawingNow } from "./modes-mount";
import { GF, GFS, nameGroup } from "./gatherer-folders.js";
import { select } from "./modes.js";
import {
  actorPanes, closeAppPane, closePop, noHarness, openPop, railNewBox, retarget, rowPop, savePanes, startCwd, startable,
  swapAppPane,
} from "../layout/panes.js";
import { appRole } from "../apps/app-actors.js";
import * as appHost from "../apps/host";
import * as prefs from "../../core/prefs";

// ------------------------------------------------------------------ moves between groups
// In the home's one database (state.home.merged: `ag home merge`'s), what is dragged in the list may be dropped into
// another group -- actors, each with its task (which moves whole), or a folder with all in it -- once the reader says
// so (the Notes design "Groups: design", section 2): a dialog says who moves, from which group to which, how many
// others each has, and how many of those moving are working now, which rebuild their context at their next call. Then
// the server moves them (/api/groups, groups.py), and a pane showing one of them follows it. An app of a task or a
// folder that moves goes with it, its actors keeping it -- one with many instances (Browser, DocWriter, Editor). An
// app's own agent (one it started: features/apps/app-actors.js's appRole) and its window go together, as a task does (withOwn):
// so a group's only one of its app (Notes, Slack, Paper news) goes too when its own agent does -- into a group with one
// of its own, it closes, and its agent works with that one -- and otherwise stays with its group, a drag that would
// take it staying in its group, as every drag did before.
const moveAsk = { open: false, label: "", busy: false, shown: null };
const WORKING = new Set(["Running", "Waiting for you", "Background"]);     // groupOf's: working now

// Whether what is dragged (listDrag) may go into group `g` from another -- a group, not the list's head (GFS) --
// asked first (askMove)
function canCross(g) {
  const d = listDrag;
  if (!d || d.g === g.name || !state.home.merged || d.gs || g.alone || !state.home.gatherers.some((x) => x.name === g.name)) return false;
  const from = gathererNamed(d.g);
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
  && ((r) => !!r && r.key === id)(appRole({ session: { role: a.role } }))))(gathererNamed(gname));
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
  const label = (x) => ((a) => (a && a.label) || x.app)(appHost.named(x.app));
  const named = (x) => label(x) + (x.title && x.title !== label(x) ? ` (${x.title})` : "");
  const going = apps.filter((x) => !x.joins), joining = apps.filter((x) => x.joins);
  const list = going.map(named), out = [];
  if (list.length) out.push(`The ${list.length === 1 ? "app" : "apps"} ${list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`} `
    + `${list.length === 1 ? "goes" : "go"} with ${many ? "them" : "it"}.`);
  for (const x of joining) out.push(`${many ? "Their" : "Its"} ${named(x)} closes because the ${to ? titleOf(to) : "other"} group has its own. `
    + `${many ? "They" : "It"} will use that one.`);
  return out.join(" ");
}
const mvCount = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
// the coordinator agents of `from` over folder `fid` or a folder in it: they go where it goes (groups.py's `_crews`)
const crewsWithin = (from, fid) => from.agents.filter((a) => isCoordinator(a) && String(a.over || "").startsWith("folder:")
  && within(from.name, +a.over.slice("folder:".length), fid));
const crewsSaid = (crews, made) => !crews.length ? null : crews.length === 1
  ? `Its coordinator agent ${made ? "becomes the new group's" : "goes with it"}.`
  : `The ${crews.length} coordinator agents over it and its folders go with it${made ? ", and the one over it becomes the new group's" : ""}.`;

// What is dragged (`d`, listDrag's), dropped into folder `id` of group `g` (null: its top): the move -- into that
// folder's group, as the default rule has it (an actor on its own: it joins; kept on its own there only from Manage
// groups). Dropped in the list (`d.ask` false), at once; else the dialog first.
async function askMove(d, g, id) {
  const from = gathererNamed(d.g);
  if (!from) return;
  const body = { gatherer: d.g, to: g.name, ...(d.folder !== null ? { folder: d.folder } : { channels: withOwn(from, d.cs) }) };
  if (d.ask === false) {
    mvNow(async () => {
      const m = (await post("/api/groups", { ...body, do: "move", into: id })).moved || {};
      return { to: g.name, actors: m.actors || [], apps: m.apps || [], joined: m.joined || {}, said: `Moved to the ${titleOf(g)} group` };
    }, "Not moved", d.g);
    return;
  }
  const title = `Move to the ${titleOf(g)} group?`;
  mvOpen("Move to another group");
  mvDraw({ title, note: "Working out who moves…" });
  let plan;
  try { plan = await post("/api/groups", { ...body, do: "plan" }); } catch (err) { mvDraw({ title, note: `Can't move: ${err.message}` }); return; }
  const crews = d.folder !== null ? crewsWithin(from, d.folder) : [];
  const said = crewsSaid(crews, false);
  const shown = { title: from.alone ? `Join the ${titleOf(g)} group?` : title, lines: [...moveLines(from, g, plan), ...(said ? [said] : [])],
    names: moveNames(from, plan.actors.filter((c) => !crews.some((a) => a.channel === c))), goLabel: from.alone ? "Join" : "Move" };
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
  const from = gathererNamed(d.g), f = from && folderById(d.g, d.folder);
  if (f) askOwn(from, f, false, d.ask !== false);
}
// Folder `f` of group `g` given a group of its own (groups.py's `own`), where it is (`here`: its line's button) -- or,
// dropped outside every group, at the list's top (`split`): the dialog, then the group, named after it -- dropped in the
// list (`ask` false), the group at once
function askOwn(g, f, here = true, ask = true) {
  const make = async () => {
    const got = await post("/api/groups", { gatherer: g.name, do: here ? "own" : "split", folder: f.id });
    const made = here ? got.own : got.split;
    return { to: made.group, actors: made.actors, apps: made.apps || [], said: `${f.name} is a group of its own` };
  };
  if (!ask) { mvNow(make, "Not made", g.name); return; }
  const inside = withTasks(g, actorsWithin(g, f.id).map((a) => a.channel)).filter((c) => !isAppItem(c));
  const going = [...new Set([...withTasks(g, actorsWithin(g, f.id).map((a) => a.channel)).filter(isAppItem)
    .map((c) => c.slice(APP_ITEM.length)), ...gathererApps(g.name).filter((o) => ((x) => x !== null && within(g.name, x, f.id))(appFolder(g.name, o.id))).map((o) => o.id)])]
    .map((i) => appInfo(g.name, i)).filter(Boolean).map((o) => ({ id: o.id, app: o.app.name, title: o.name || o.title }));
  const actors = g.agents.filter((a) => inside.includes(a.channel)), n = actors.length;
  const others = g.agents.filter((a) => !isCoordinator(a) && !inside.includes(a.channel)).length;
  const lines = [(here ? `${f.name} becomes a group of its own, in place, with the settings of ${titleOf(g)}.`
    : `The folder ${f.name} becomes a group of its own, with its contents at the top.`)
    + (n ? ` ${n === 1 ? "Its actor leaves" : `Its ${n} actors leave`} the ${titleOf(g)} group (${mvCount(others, "other")}) for it.`
      : here ? " It has no actors yet. Actors started there will share context only with each other." : ` It leaves the ${titleOf(g)} group.`)];
  if (n) lines.push(`${n === 1 ? "It" : "They"} will no longer share context with the actors of ${titleOf(g)}`
    + `${n === 1 ? "" : ", only with each other"}.`, rebuildLine(g, actors));
  const appsSaid = appsLine(going, n > 1), crewSaid = crewsSaid(crewsWithin(g, f.id), true);
  if (appsSaid) lines.push(appsSaid);
  if (crewSaid) lines.push(crewSaid);
  const shown = { title: here ? `Give ${f.name} a group of its own?` : `Make ${f.name} a group of its own?`, lines,
    names: moveNames(g, inside), goLabel: "Make a group" };
  mvOpen("A folder made a group of its own");
  const go = mvGo(shown, "Making the group…", "Not made", make, g.name);
  mvDraw({ ...shown, go });
}
// ---- a group dropped into another (groups.py's `merge`): made a folder of it, named after it, everything in it
// Whether the group dragged (listDrag's `gs`: one) may go into group `g`: in the home's one database, neither on its own,
// and not into itself
function canMerge(g, id = null) {
  const d = listDrag;
  if (!d || !d.gs || d.gs.length !== 1 || !state.home.merged || g.name === GF || g.alone || d.gs[0] === g.name) return false;
  const from = gathererNamed(d.gs[0]), p = from && placeOf(from.name);
  return !!from && !from.alone && state.home.gatherers.some((x) => x.name === g.name) && !insideOf(g.name, from.name)
    && !(p && p.in === g.name && p.folder === id);
}
// The group `name` dropped into folder `id` of group `g` (null: its top): the dialog, then the merge, as the default rule
// has it -- a folder of `g` takes `g`'s group (kept a group of its own there: Manage groups, `ag groups merge --keep`).
// `back`: a group inside `g`'s folder, made part of `g` again (Manage groups' switch). Dropped in the list (`ask`
// false): the merge at once.
async function askMerge(name, g, id, back = false, ask = true) {
  const from = gathererNamed(name);
  if (!from) return;
  const merge = async () => {
    const got = await post("/api/groups", { gatherer: name, to: g.name, into: id, do: "merge" });
    const m = got.merged;
    if (collapsed.delete(g.name)) {                  // the group it went into open, and the folder it became
      prefs.keep(COLLAPSED_KEY, [...collapsed]);
    }
    showFolder(g.name, id, true);
    showFolder(g.name, m.folder, true);
    return { to: g.name, actors: m.actors, apps: m.apps || [], joined: m.joined || {}, said: `${titleOf(from)} is a folder of ${titleOf(g)} now` };
  };
  if (!ask) { mvNow(merge, "Not merged", name); return; }
  const title = back ? `Make ${titleOf(from)} part of ${titleOf(g)} again?` : `Merge ${titleOf(from)} into ${titleOf(g)}?`;
  mvOpen("A group merged into another");
  mvDraw({ title, note: "Working out what moves…" });
  let plan;
  try { plan = await post("/api/groups", { gatherer: name, to: g.name, into: id, do: "merge_plan" }); } catch (err) {
    mvDraw({ title, note: `Can't merge: ${err.message}` });
    return;
  }
  const actors = from.agents.filter((a) => !isCoordinator(a)), n = actors.length;
  const others = g.agents.filter((a) => !isCoordinator(a)).length, inside = id === null ? null : folderById(g.name, id);
  const lines = [`${titleOf(from)} becomes a folder of ${titleOf(g)}, named ${plan.folder}${inside ? `, in ${inside.name}` : ""}, `
    + "with everything in it."];
  if (n) lines.push(`Its ${mvCount(n, "actor")} and the ${mvCount(others, "actor")} of ${titleOf(g)} will share context with each other.`,
    rebuildLine(from, actors));
  const apps = appsLine(plan.apps.filter((x) => x.app !== "notes"), true, g);
  if (apps) lines.push(apps);
  if (plan.apps.some((x) => x.app === "notes")) lines.push(`Its notes go under a page named ${titleOf(from)} in the notes of ${titleOf(g)}.`);
  if (groupCrew(from)) lines.push("Its coordinator agent becomes the one over the new folder.");
  const shown = { title, lines, names: moveNames(from, actors.map((a) => a.channel)), goLabel: "Merge" };
  const go = mvGo(shown, "Merging…", "Not merged", merge, name);
  mvDraw({ ...shown, go });
}
// The dialog opened (features/list/ManageGroups.tsx's Move)
function mvOpen(label) {
  Object.assign(moveAsk, { open: true, label, busy: false, shown: null });
  drawDialogs();
}
function mvClose() {
  if (moveAsk.busy) return;
  Object.assign(moveAsk, { open: false, shown: null });
  drawDialogs();
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
    mvClose();
    await loadHome();
    await followMoved(from, got.to, got.actors, got.apps || [], got.joined || {});
    renderAgents();
    setLive(got.said);
  };
  return go;
}
// A change made at once, with no dialog -- a drop in the list, by the default rule: `act()` (-> as mvGo's), then the
// home read again and the panes following what moved, as mvGo does; refused, said so
async function mvNow(act, failed, from) {
  let got;
  try { got = await act(); } catch (err) { setLive(`${failed}: ${err.message}`); return; }
  await loadHome();
  await followMoved(from, got.to, got.actors, got.apps || [], got.joined || {});
  renderAgents();
  setLive(got.said);
}
// The dialog drawn: its title, `lines`, the actors `names`, `note`, then Cancel and `goLabel` (`go`; none: not yet) --
// its button in focus, once there is one to press
function mvDraw({ title, lines = [], names = null, note = "", go = null, goLabel = "" }) {
  if (!moveAsk.open) return;
  moveAsk.shown = { title, lines, names, note, go, goLabel };
  drawDialogs();
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
  if (!working) return `${one ? "It rebuilds its" : "Each rebuilds its"} context when it next runs.`;
  if (one) return "It is working now and will rebuild its context at its next call.";
  return `${mvCount(working, "of them is", "of them are")} working now and will rebuild ${working === 1 ? "its" : "their"} context at the next call.`
    + (working < actors.length ? " The others rebuild when they next run." : "");
}
// the actors that move (by their channels), by name, when more than one
function moveNames(from, channels) {
  const moving = from.agents.filter((a) => channels.includes(a.channel));
  if (moving.length < 2) return null;
  const shown = moving.slice(0, 6);
  return { shown: shown.map(actorTitle), more: moving.length - shown.length };
}
// After a move: a pane showing an actor that moved shows it in its new group, and an app's that moved (`apps`, their
// ids) is opened again there -- its panel was opened for its old group -- and one closed for the new group's own one
// (`joined`, {its id: that one's}) shows that one
async function followMoved(from, to, moved, apps = [], joined = {}) {
  const gone = new Set(moved);
  for (const p of actorPanes()) if (p.g === from && gone.has(p.c)) { retarget(p, to, p.c); p.call("select", to, p.c, p.view); }
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
  if (!d || !state.home.merged) return false;
  if (d.gs) return d.gs.length === 1 && !!placeOf(d.gs[0]);   // a group inside a folder: back at the top, its own group kept
  const from = gathererNamed(d.g);
  if (!from) return false;
  if (from.alone) return d.folder === null && !!placeOf(from.name);   // on its own in a folder: back at the top
  if (d.folder !== null) return folderCanMove(from, d.folder);
  const items = withOwn(from, d.cs || []), actors = items.filter((c) => !isAppItem(c));
  const a = actors.length === 1 ? actorOf(from, actors[0]) : null;
  return !!a && !isCoordinator(a) && items.every((c) => !isAppItem(c) || appCanMove(from.name, c, items));
}
// The place shown, while what is dragged may go there (startDrag's), saying what it does
function showOutside() {
  const can = canOutside();
  document.body.classList.toggle("drag-out", can);
  if (can) for (const n of document.querySelectorAll(".outside-drop")) {   // the list's, and Manage groups' when it is open
    n.textContent = listDrag.folder !== null || listDrag.gs ? "Outside every group: a group of its own" : "Outside every group: on its own";
  }
}
// The place to drop it, over the list's head: shown while such a drag goes on (body.drag-out)
function outsideDrop() {
  if (SNAPSHOT || !state.home.merged) return null;
  const n = el("div", { class: "outside-drop", text: "Outside every group: a group of its own" });   // (Manage groups has one too)
  n.addEventListener("dragenter", (ev) => { if (canOutside()) { ev.preventDefault(); n.classList.add("drop-on"); } });
  n.addEventListener("dragover", (ev) => { if (canOutside()) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; } });
  n.addEventListener("dragleave", (ev) => { if (!n.contains(ev.relatedTarget)) n.classList.remove("drop-on"); });
  n.addEventListener("drop", (ev) => {
    if (!canOutside()) return;
    ev.preventDefault();
    ev.stopPropagation();                            // the list's head it is over: not dropped there too
    outsideDropped();
  });
  return n;
}
// What is dragged dropped there (the list's, or Manage groups': features/list/ManageGroups.tsx's OutsideDrop)
function outsideDropped() {
  const d = listDrag;
  endDrag();
  if (d.gs) placeGroup(d.gs[0], "", null);          // nothing anyone shares changes: no question
  else if (d.folder !== null) askSplit(d);
  else if (isAloneName(d.g)) placeGroup(d.g, "", null);
  else askAlone(d);
}

// ---- an actor on its own from its start (groups.py's `start_alone`): the list head's "+" beside its folder button. Its box
// (features/layout/panes.js's railNewBox, `alone`) asks the directory it works in -- the latest active actor's to start with -- and the
// harness, any that runs here. It runs under a group of the home's (ag runs every session in one): the shown actor's, else the
// latest active -- and shares with no one. Only on the home's one database, as every group of one: none with a database
// per gatherer, as no drop outside every group (outsideDrop).
// its pop-up's key, and what `state.starting` names while it starts: no group's (a name holds no ":", a group of one's
// ends in an id)
const ALONE_NEW = "self:new";
const everyActor = () => ({ agents: state.home.gatherers.flatMap((g) => g.agents) });
function aloneUnder() {
  const real = state.home.gatherers.filter((g) => !g.alone);
  const shown = state.selected && real.find((g) => g.name === state.selected[0]);
  return shown || [...real].sort((x, y) => (y.last || 0) - (x.last || 0))[0] || null;
}
function aloneNew() {
  if (SNAPSHOT || PANE || !state.home.merged) return null;
  const hs = startable(), g = aloneUnder();
  const why = !g ? "Make a group first" : !hs.length ? noHarness() : "";
  const busy = state.starting && state.starting.gatherer === ALONE_NEW;
  return el("button", { class: "alone-new" + (busy ? " busy" : ""), type: "button", "data-pop": ALONE_NEW,
    ...(why || state.starting ? { disabled: "" } : {}), title: why || "New actor on its own · shares context with no group",
    "aria-label": "New actor on its own", "aria-haspopup": "dialog", "aria-expanded": String(rowPop.key === ALONE_NEW),
    onclick: (ev) => {
      if (rowPop.key === ALONE_NEW) return closePop();
      openPop(ALONE_NEW, ev.currentTarget, railNewBox(g, hs, hs[0], startCwd(everyActor()), "", true));
    } },
    el("span", { class: "plus", "aria-hidden": "true", text: "+" }), strokeIcon(ICONS.agent, 15));
}

// ---- an actor on its own: a group of one (groups.py's `alone`, `self:<channel>`), listed as its row alone (no head: its
// title says what it is);
// it has no coordinator agent. Dragged into a group, it is asked first, as any move between groups (askMove).
const aloneActor = LG.aloneActor;
// One actor (`d`, listDrag's) dropped outside every group: the dialog, then it on its own, with its task's apps and
// its own window if it is an app's agent (withOwn) -- dropped in the list (`d.ask` false), at once
function askAlone(d, here = false) {
  const from = gathererNamed(d.g), items = from ? withOwn(from, d.cs || []) : [];
  const c = items.find((k) => !isAppItem(k)), a = c && actorOf(from, c);
  if (!a) return;
  const name = actorTitle(a), others = from.agents.filter((x) => !isCoordinator(x) && x.channel !== c).length;
  const going = items.filter(isAppItem).map((k) => appInfo(d.g, k.slice(APP_ITEM.length))).filter(Boolean)
    .map((o) => ({ id: o.id, app: o.app.name, title: o.name || o.title }));
  const take = async () => {
    const got = await post("/api/groups", { gatherer: d.g, do: "alone", channel: c, ...(here ? { here: true } : {}) });
    return { to: got.alone.group, actors: got.alone.actors, apps: got.alone.apps || [], said: `${name} is on its own` };
  };
  if (d.ask === false) { mvNow(take, "Not taken out", d.g); return; }   // dropped in the list: at once
  const f = here ? folderById(d.g, folderOf(d.g, a)) : null, where = f ? f.name : `the top of ${titleOf(from)}`;
  const lines = [`${name} leaves the ${titleOf(from)} group (${mvCount(others, "other")}) and works on its own`
    + (here ? `, staying in ${where}` : "") + ". It won't share context with any other actor.",
  appsLine(going, false), here ? `It has no coordinator agent. Use Manage groups to bring it back into ${titleOf(from)}.`
    : "It has no coordinator agent. Drag it into a group to bring it back.",
  rebuildLine(from, [a])].filter(Boolean);
  const shown = { title: here ? "Put it on its own?" : "Take it out of every group?", lines, goLabel: here ? "On its own" : "Take it out" };
  mvOpen("An actor on its own");
  const go = mvGo(shown, "Taking it out…", "Not taken out", take, d.g);
  mvDraw({ ...shown, go });
}

// ---- groups inside another group's folder (groups.py's `place`, `own`, `above`; home.places: {group: {in, folder}}),
// the Notes design "Groups: folders, defaults and Manage groups": a folder takes its parent's group or has its own, an
// actor has its folder's group or is on its own. The list says nothing of groups: a group of its own inside another's
// folder is drawn there (boxRows' placedRows), its row set in as a folder's line is; an actor on its own there, as any
// actor. Who shares with whom is set in Manage groups alone (below): its own group (askOwn), back in the group around it
// (askAbove, askJoin), on its own where it is (askAloneHere). A drag follows the default rule -- what is dropped into a
// folder takes its group, after the question (askMerge, askMove) -- and one within the group it is in just moves
// (placeGroup), as a folder does.
const isAloneName = LG.isAloneName;
// where the group `name` is drawn: {in, folder}, or null at the list's top (features/list/groups.ts's placeOf)
const placeOf = (name) => LG.placeOf(CTX, name);
const insideOf = (name, outer) => LG.insideOf(CTX, name, outer);
const nestedIn = (g) => LG.nestedIn(CTX, g);
// the group `gname` open, and its folder `id` with the folders it is in
function openWhere(gname, id) {
  if (collapsed.delete(gname)) {
    prefs.keep(COLLAPSED_KEY, [...collapsed]);
  }
  for (let f = id; f !== null && f !== undefined; f = (folderById(gname, f) || {}).parent ?? null) showFolder(gname, f, true);
}
// The group `name` put in folder `id` of group `to` ("": at the list's top), keeping its own group: nothing anyone shares
// changes, so no question -- moved within the group it is in, or an actor on its own taken back to the top
async function placeGroup(name, to, id) {
  try { await post("/api/groups", { gatherer: name, to, into: id, do: "place" }); } catch (err) { setLive(`Not moved: ${err.message}`); return; }
  if (to) openWhere(to, id);
  await loadHome();
  renderAgents();
}
// A nested group's way back: made part of the group it is in again, a folder of it where it is (the merge's dialog)
function askAbove(g) {
  const p = placeOf(g.name), outer = nestedIn(g);
  if (outer) askMerge(g.name, outer, p.folder, true);
}
// An actor on its own in a folder, back in that folder's group (the move's dialog, without "Stay on its own")
function askJoin(x) {
  const p = placeOf(x.name), g = nestedIn(x), a = aloneActor(x);
  if (g && a) askMove({ g: x.name, cs: [a.channel], folder: null }, g, p.folder);
}
// An actor of group `g` on its own, staying in its folder
const askAloneHere = (g, a) => askAlone({ g: g.name, cs: [a.channel] }, true);

// ---- MANAGE GROUPS: who shares context with whom, at a glance, and the switches (the Notes design's section 4): a
// dialog from the settings panel (manageEntry), drawn by features/list/ManageGroups.tsx from manage-model.ts's rows --
// each group at its place, its folders and open actors under it, each with its switch. A switch asks first, as in the
// list (askOwn, askAbove, askAloneHere, askJoin), then the dialog is drawn again from the new home (renderAgents calls
// drawManage while it is open). The CLI's `ag groups` has the same. A group's or folder's row folds what is under it
// (mgFolded, kept in this browser). Rows are dragged and dropped as the list's are -- the same rules, but asked first
// (listDrag's `ask`; in the list, done at once) -- and its "Outside every group" area is over the panel's top line while
// one is dragged. New folders are made here too: at the top (a group of its own) from its head, in a group or a folder
// from its row's button, named in a box in place (manage.naming). In the home's one database only.
const manage = { open: false, naming: null };
let namings = 0;
// the settings panel's entry: shown in the home's one database only; a click there closes the panel, opens this
function manageEntry() {
  const n = document.getElementById("groups-cfg");
  if (n) n.hidden = SNAPSHOT || !state.home.merged;
}
function openManage() {
  manage.open = true;
  drawManage();
}
function closeManage() {
  Object.assign(manage, { open: false, naming: null });
  drawManage();
}
// What the panel has folded: "g:<group>", "f:<group>:<folder id>", "alone" (those on their own at the top)
const MG_FOLDED_KEY = "ag-dashboard-manage-groups-folded";
const mgFolded = new Set(prefs.list(MG_FOLDED_KEY) || []);
// `key` folded or opened (`open`; flipped, left out), and the panel drawn so
function mgToggle(key, open) {
  const fold = open === undefined ? !mgFolded.has(key) : !open;
  if (fold === mgFolded.has(key)) return;
  if (fold) mgFolded.add(key); else mgFolded.delete(key);
  prefs.keep(MG_FOLDED_KEY, [...mgFolded]);
  drawManage();
}
// A new folder named in place: in folder `parent` of group `g` (g null: at the top, a group of its own by the default
// rule), the row it is in opened (`key`), its box drawn first under it; Enter makes it, Esc or an empty box leaves it, a
// click elsewhere makes it as typed -- as the list's own box does (nameFolder, nameGroup)
function mgStartNaming(g, parent, key) {
  manage.naming = { g: g ? g.name : null, parent, value: "", n: ++namings };
  if (key) mgFolded.delete(key);
  drawManage();
}
function mgEndNaming(keep) {
  const n = manage.naming;
  if (!n) return;
  manage.naming = null;
  if (keep && n.value.trim()) { if (n.g === null) nameGroup(null, n.value); else nameFolder(n.g, null, n.parent, n.value); }
  drawManage();
}
// An actor of group `g` in a task with other actors: its switch can't be had (tasks move as a whole)
const inTaskWithOthers = (g, a) => withOwn(g, [a.channel]).filter((c) => !isAppItem(c)).length > 1;
// what Manage groups and the move's question call of the page (features/list/ManageGroups.tsx's DialogsHost)
let dialogHost = null;
const DIALOG_HOST = () => dialogHost ??= { ...LIST_HOST, ctx: CTX, close: closeManage, toggle: mgToggle,
  startNaming: mgStartNaming, endNaming: mgEndNaming, namingTyped: (v) => { if (manage.naming) manage.naming.value = v; },
  namingBlur: () => { if (!drawingNow() && manage.naming && document.hasFocus()) mgEndNaming(true); },
  askOwn: (g, f) => askOwn(g, f), askAbove, askJoin, askAloneHere,
  dragGroup: (ev, g) => startDrag(ev, GFS, { gs: [g.name] }), outsideCan: canOutside, outsideDrop: outsideDropped,
  moveClose: mvClose };
// Manage groups and the move's question drawn as they are now: the groups as the home has them (renderAgents calls this)
function drawDialogs() {
  drawListDialogs({
    manage: manage.open ? { rows: buildManage(CTX, { folded: mgFolded, naming: manage.naming, inTask: inTaskWithOthers }),
      naming: manage.naming && { n: manage.naming.n, value: manage.naming.value } } : null,
    move: moveAsk.open ? { label: moveAsk.label, busy: moveAsk.busy,
      ...(moveAsk.shown || { title: "", lines: [], names: null, note: "", go: null, goLabel: "" }) } : null,
  }, DIALOG_HOST());
}
const drawManage = drawDialogs;
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  document.getElementById("manage-groups")?.addEventListener("click", () => { setAbout(false); openManage(); });
}
export {
  ALONE_NEW, aloneNew, aloneUnder, askMerge, askMove, canCross, canMerge, drawManage, everyActor, isAloneName, manage,
  manageEntry, outsideDrop, placeGroup, placeOf, showOutside,
};
