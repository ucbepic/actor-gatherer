import { PANE, SNAPSHOT, panes, state } from "../../core/page/state.js";
import { closable, gathererNamed, key, post, sessionStatus } from "../../core/page/helpers.js";
import { setLive } from "../page/data.js";
import { connect } from "../settings/panel.js";
import { actorTitle, appItem, appKey, appsFollowHome, renderAgents } from "./list.js";
import { appsAtWork, isAt, isAway, openActors } from "../layout/panes.js";
import { appsChanged } from "../apps/apps-page.js";
import { dropGone, heedHome } from "../notify/notify.js";
import { term } from "../terminal/terminal.js";
import { opened } from "../chat/files-view.js";
import { appAsked, appAskedOf } from "../apps/app-actors.js";
import { useDashboard } from "../../core/store";
import { askedByAgent } from "../apps/catalog";
import * as prefs from "../../core/prefs";

// A session made here that never started -- no process of it now, none starting, nothing of it in its gatherer (no
// events, no calls): its × discards it (sessions.py's `discard`), so it is listed nowhere and nothing of it is kept.
// The panes showing it close, as a shell's do when it ends (shownGone) -- this page's own out of sight already (its tab
// closed with it: features/list/list.js's closeActor), left so, no other actor brought into the tab in its place.
const discardable = (a) => !SNAPSHOT && !!a.session && !a.events && !a.reads && !closable(a) && a.chattable !== false
  && !["starting", "running", "idle", "terminal"].includes(a.session.status) && !(a.session.queued || []).length && !opened(a);
const statusOf = (a) => sessionStatus(a.session) || (opened(a) ? ["running", "Running"] : a.status === "asking" ? ["asking", "Waiting for you"]
  : a.status === "error" ? ["error", "Error"]
  : a.building ? ["building", "Building"]
  : (a.status ? a.status === "running" : a.running) ? ["running", "Running"]
  : a.status === "background" ? ["background", "Background"]
  : unseen(a) ? ["finished", "Finished"] : a.status === "closed" ? ["closed", "Closed"] : ["idle", "Idle"]);
// Its status as its conversation shows it: statusOf's, but a build of its context that runs once its turn is over -- a
// check that found a new task, its message then taken back (Esc) -- is ag's work, not its turn's: the status under it.
const turnStatus = (a) => {
  const st = statusOf(a);
  return st[0] === "building" && a.building && a.status !== "running" && !sessionStatus(a.session) && !opened(a)
    ? statusOf({ ...a, building: false }) : st;
};
// ------------------------------------------------------------------ finished, not yet looked at
// When the reader last looked at each actor: its `last` (data.py: its latest activity, in the server's
// clock) at that moment. An actor that has stopped with activity after that is FINISHED: done, and not yet
// seen. Looking means having it open in a pane while the page is visible. Kept by the server (seen.py,
// `home.seen`: {gatherer: {channel: last}}) so every dashboard on this home shows the same: at either address
// (localhost, 127.0.0.1 -- each a browser storage of its own), in any browser, after a restart. The page's
// copy takes the larger of the server's and its own looks, so a home read before a look was kept does not
// undo it. Before any dashboard on the home kept a look (`home.seen` null), every actor there is taken as
// seen -- as of this browser's own look, where it kept one before -- and handed to the server. A server from
// before `seen` (none in its home): kept in this browser, as it was.
const SEEN_KEY = "ag-dashboard-seen";                // where this browser kept them before
const seen = { at: {}, here: false, handing: false, dropped: false };   // here: kept in this browser
const unseen = (a) => !!a.key && !!a.last && a.last > (seen.at[a.key] || 0);
function keptHere() {
  const v = prefs.json(SEEN_KEY);
  return v && typeof v === "object" ? v : {};
}
function dropHere() { prefs.drop(SEEN_KEY); }
// Every actor of `home` taken as seen: as of `had`, where it has one; else as it is.
function everySeen(home, had) {
  const at = { ...had };
  for (const g of home.gatherers) for (const a of g.agents) if (a.last && !at[a.key]) at[a.key] = a.last;
  return at;
}
function takeSeen(home) {
  if (home.seen === undefined) {                     // a server from before `seen`
    if (!seen.here) { seen.here = true; seen.at = everySeen(home, keptHere()); }
    return;
  }
  seen.here = false;                                 // (one restarted since, the page kept open: handed over)
  for (const [g, chs] of Object.entries(home.seen || {}))
    for (const [c, last] of Object.entries(chs)) { const k = key(g, c); if (!(seen.at[k] >= last)) seen.at[k] = last; }
  if (home.seen === null && !seen.handing) {         // none kept on the home yet
    seen.at = everySeen(home, { ...keptHere(), ...seen.at });
    const all = home.gatherers.flatMap((g) => g.agents.filter((a) => seen.at[a.key]).map((a) => [g.name, a.channel, seen.at[a.key]]));
    seen.handing = true;
    tellSeen(all).then((kept) => { if (kept) dropHere(); else seen.handing = false; });
  } else if (home.seen && !seen.dropped && !SNAPSHOT && !PANE) { seen.dropped = true; dropHere(); }
}
// Looks kept: by the server, or in this browser for a server from before `seen`. Whether they were.
async function tellSeen(looked) {
  if (SNAPSHOT || PANE || !looked.length) return false;
  if (seen.here) return prefs.keep(SEEN_KEY, seen.at);
  try { await post("/api/seen", { seen: looked }); return true; }
  catch (err) { setLive(`Not saved: ${err.message}`); return false; }
}
// Homes taken so far: the first, then each the stream sends. What an action of the reader's changes in the home -- a
// gatherer hidden or named, an actor saved, a folder -- shows at once, then the server's answer (every choice of its
// kind, as kept after it) takes its place; but not where a home came while it was asked (`homeSince(asked)`, `asked`:
// `homesTaken` as it was sent). That home was read after the action's change, so has it, and maybe another made since
// (by the gatherer agent, another page) that the answer, read before, would undo till something else changed -- the
// stream sends a home only when it differs from the last it sent; or before it, and the stream sends the next once
// the change is rung.
let homesTaken = 0;
const homeSince = (asked) => homesTaken !== asked;
// THE TASKS of each gatherer (features/list/list.js's TASKS) come in a home, in the apps' list and in a change's answer, each
// read on the server at its `now`: those of a gatherer read before the ones the page has (`tasksRead`, the server's
// clock) not taken -- a home read before a change can come after the change's own answer
const tasksRead = new Map();
function newerTasks(had, got, at, only = null) {
  const next = { ...(had || {}) };
  for (const g of only ? [only] : new Set([...Object.keys(next), ...Object.keys(got || {})])) {
    if ((at || 0) < (tasksRead.get(g) || 0)) continue;
    tasksRead.set(g, at || 0);
    if (got && got[g]) next[g] = got[g]; else delete next[g];
  }
  return next;
}
// Each actor's key, and what the reader has seen of a new home: what the server kept (everything, before
// it kept any); the selected actor, while the page is visible.
function takeHome(home) {
  homesTaken++;
  appsFollowHome(home);                              // an app moved with its task: in its new group, as its task is --
  //                                                    before anything draws the list for this home
  if (state.home) home.tasks = newerTasks(state.home.tasks, home.tasks, home.now);
  else newerTasks({}, home.tasks, home.now);
  useDashboard.getState().setHome(home);           // the new code's store has it too (core/store)
  for (const g of home.gatherers) for (const a of g.agents) {
    a.key = key(g.name, a.channel);
    if (a.last_user_message) {                     // an app's words: the user's -- and what in the app they are about
      a.asked_of = appAskedOf(a.last_user_message);
      a.last_user_message = appAsked(a, a.last_user_message);
    }
  }
  if (state.selected) {          // a codex session renamed to its thread (one from before `ag --channel`): followed there
    const g = home.gatherers.find((x) => x.name === state.selected[0]);
    const moved = g && !g.agents.some((a) => a.channel === state.selected[1])
      && g.agents.find((a) => a.session && a.session.started_as === state.selected[1]);
    if (moved) {
      if (term.sid === state.selected[1]) { term.sid = moved.channel; if (term.es) { term.es.close(); term.es = null; } }   // listened to again, under its new id
      state.selected = [g.name, moved.channel];
      setTimeout(connect);
    }
  }
  takeSeen(home);
  dropGone(home);                                    // apps' notifications dismissed here, not yet by the server
  state.home = home;
  markSeen();
  appsAtWork();                                      // apps' panels told their agents' states; held while they work
  heedHome();                                        // what came to want the reader since: popped up (features/notify/notify.js)
  askedByAgents();                                   // an agent's asking to install an app: the reader's to approve
}
// An agent's asking to install, update or uninstall an app (app_requests.py; home's `app_requests`): the first not yet
// shown here put to the reader in the Apps page's dialog -- the apps read again once they answer
function askedByAgents() {
  if (SNAPSHOT || PANE || !(state.home.app_requests || []).length) return;
  const who = (c) => {
    for (const g of state.home.gatherers) {
      const a = g.agents.find((x) => x.channel === c || (x.session && x.session.started_as === c));
      if (a) return `${actorTitle(a)} (${g.name})`;
    }
    return `Agent ${c.slice(0, 8)}`;
  };
  askedByAgent(state.home.app_requests, who, () => void appsChanged());
}
// An actor is looked at while it is open in a pane -- not this page's own, out of sight while a screen tab without it
// shows (features/layout/panes.js's isAway). An app is looked at as an actor is: its panel shown (not held out of sight) -- while
// the page is in FRONT of the reader, not only visible, as what it notified them of is said on the computer until then
// (features/notify/notify.js) -- its newest notification then seen (features/list/list.js's appStatusOf), kept as the item
// "app:<its id>"; the list drawn again for it.
function markSeen() {
  if (SNAPSHOT || PANE || !state.home || document.visibilityState !== "visible") return;
  const looked = [], away = isAway();               // this page's own actor, out of sight while a tab without it shows
  for (const [gname, c] of openActors()) {
    if (away && isAt(state.selected, gname, c)) continue;
    const g = gathererNamed(gname);
    const a = g && g.agents.find((x) => x.channel === c);
    if (!a || !a.last || (seen.at[a.key] || 0) >= a.last) continue;
    seen.at[a.key] = a.last; looked.push([gname, c, a.last]);
  }
  let apps = false;
  for (const p of document.hasFocus() ? panes.apps : []) {
    const g = !p.held && gathererNamed(p.instance.gatherer), got = g && (g.apps || {})[p.instance.id];
    const k = got && appKey(g.name, p.instance.id);
    if (!got || !got.last || (seen.at[k] || 0) >= got.last) continue;
    seen.at[k] = got.last; looked.push([g.name, appItem(p.instance.id), got.last]); apps = true;
  }
  tellSeen(looked);
  if (apps) renderAgents();
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  document.addEventListener("visibilitychange", () => { if (state.home && document.visibilityState === "visible") { markSeen(); renderAgents(); } });
}

export { discardable, homeSince, homesTaken, markSeen, newerTasks, seen, statusOf, takeHome, turnStatus };
