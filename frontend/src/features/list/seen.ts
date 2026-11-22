// WHAT THE READER HAS SEEN, and each home as it is taken: an actor's status as the list says it, the looks kept by the
// server, the tasks taken from whichever answer is newest.
import { post } from "../../core/api/client";
import { appItem, key } from "../../core/model/keys";
import { sessionStatus } from "../../core/model/session";
import * as prefs from "../../core/prefs";
import { useDashboard } from "../../core/store";
import { appsFollowHome } from "./apps";
import { L, S, inPane, snap, type PageHome } from "./link";
import { CTX, renderAgents } from "./list";
import { everySeen, newerTasks as newerOf, type TasksRead } from "./seen-model";
import * as LS from "./status";
import { actorTitle } from "./tasks";
import type { Actor, Status, Tasks } from "./types";

// A session made here that never started -- no process of it now, none starting, nothing of it in its gatherer (no
// events, no calls): its × discards it (sessions.py's `discard`), so it is listed nowhere and nothing of it is kept.
// The panes showing it close, as a shell's do when it ends (shownGone) -- this page's own out of sight already (its tab
// closed with it: task-acts.ts's closeActor), left so, no other actor brought into the tab in its place.
// An actor's status (status.ts's statusOf): what the page started says first, then a turn its harness opened before ag
// stored it (chat's `opened`), then what data.py decided -- finished, done since the reader last looked.
export const discardable = (a: Actor): boolean => LS.discardable(CTX, a);
export const statusOf = (a: Actor): Status => LS.statusOf(CTX, a);
// Its status as its conversation shows it: statusOf's, but a build of its context that runs once its turn is over -- a
// check that found a new task, its message then taken back (Esc) -- is ag's work, not its turn's: the status under it.
export const turnStatus = (a: Actor): Status => {
  const st = statusOf(a);
  return st[0] === "building" && a.building && a.status !== "running" && !sessionStatus(a.session) && !L.files.opened(a)
    ? statusOf({ ...a, building: false })
    : st;
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
const SEEN_KEY = "ag-dashboard-seen"; // where this browser kept them before
/** here: kept in this browser */
export const seen = { at: {} as Record<string, number>, here: false, handing: false, dropped: false };
function keptHere(): Record<string, number> {
  const v = prefs.json(SEEN_KEY);
  return v && typeof v === "object" ? (v as Record<string, number>) : {};
}
const dropHere = () => prefs.drop(SEEN_KEY);
function takeSeen(home: PageHome) {
  if (home.seen === undefined) {
    // a server from before `seen`
    if (!seen.here) {
      seen.here = true;
      seen.at = everySeen(home, keptHere());
    }
    return;
  }
  seen.here = false; // (one restarted since, the page kept open: handed over)
  for (const [g, chs] of Object.entries(home.seen || {}))
    for (const [c, last] of Object.entries(chs)) {
      const k = key(g, c);
      if (!(seen.at[k] >= last)) seen.at[k] = last;
    }
  if (home.seen === null && !seen.handing) {
    // none kept on the home yet
    seen.at = everySeen(home, { ...keptHere(), ...seen.at });
    const all = home.gatherers.flatMap((g) =>
      g.agents.filter((a) => seen.at[a.key!]).map((a) => [g.name, a.channel, seen.at[a.key!]] as const),
    );
    seen.handing = true;
    void tellSeen(all).then((kept) => {
      if (kept) dropHere();
      else seen.handing = false;
    });
  } else if (home.seen && !seen.dropped && !snap() && !inPane()) {
    seen.dropped = true;
    dropHere();
  }
}
type Look = readonly [string, string, number];
// Looks kept: by the server, or in this browser for a server from before `seen`. Whether they were.
async function tellSeen(looked: Look[]): Promise<boolean> {
  if (snap() || inPane() || !looked.length) return false;
  if (seen.here) return prefs.keep(SEEN_KEY, seen.at);
  try {
    await post("/api/seen", { seen: looked });
    return true;
  } catch (err) {
    L.data.setLive(`Not saved: ${(err as Error).message}`);
    return false;
  }
}
// Homes taken so far: the first, then each the stream sends. What an action of the reader's changes in the home -- a
// gatherer hidden or named, an actor saved, a folder -- shows at once, then the server's answer (every choice of its
// kind, as kept after it) takes its place; but not where a home came while it was asked (`homeSince(asked)`, `asked`:
// `homesTaken` as it was sent). That home was read after the action's change, so has it, and maybe another made since
// (by the gatherer agent, another page) that the answer, read before, would undo till something else changed -- the
// stream sends a home only when it differs from the last it sent; or before it, and the stream sends the next once
// the change is rung.
export let homesTaken = 0;
export const homeSince = (asked: number): boolean => homesTaken !== asked;
// THE TASKS of each gatherer (task-acts.ts's) come in a home, in the apps' list and in a change's answer, each read on the
// server at its `now`: those of a gatherer read before the ones the page has (`tasksRead`, the server's clock) not
// taken -- a home read before a change can come after the change's own answer (seen-model.ts's newerTasks)
const tasksRead: TasksRead = new Map();
export const newerTasks = (
  had: Record<string, Tasks> | undefined,
  got: Record<string, Tasks> | undefined,
  at: number | undefined,
  only: string | null = null,
): Record<string, Tasks> => newerOf(tasksRead, had, got, at, only);
// Each actor's key, and what the reader has seen of a new home: what the server kept (everything, before
// it kept any); the selected actor, while the page is visible.
export function takeHome(home: PageHome): void {
  const state = S();
  homesTaken++;
  appsFollowHome(home); // an app moved with its task: in its new group, as its task is --
  //                       before anything draws the list for this home
  if (state.home) home.tasks = newerTasks(state.home.tasks, home.tasks, home.now);
  else newerTasks({}, home.tasks, home.now);
  useDashboard.getState().setHome(home as Parameters<ReturnType<typeof useDashboard.getState>["setHome"]>[0]); // the new code's store has it too (core/store)
  for (const g of home.gatherers)
    for (const a of g.agents) {
      a.key = key(g.name, a.channel);
      if (a.last_user_message) {
        // an app's words: the user's -- and what in the app they are about
        (a as Actor & { asked_of?: unknown }).asked_of = L.appActors.appAskedOf(a.last_user_message);
        a.last_user_message = L.appActors.appAsked(a, a.last_user_message);
      }
    }
  if (state.selected) {
    // a codex session renamed to its thread (one from before `ag --channel`): followed there
    const [sg, sc] = state.selected;
    const g = home.gatherers.find((x) => x.name === sg);
    const moved =
      g && !g.agents.some((a) => a.channel === sc) && g.agents.find((a) => a.session && a.session.started_as === sc);
    if (moved) {
      const term = L.terminal.term;
      if (term.sid === sc) {
        term.sid = moved.channel; // listened to again, under its new id
        if (term.es) {
          term.es.close();
          term.es = null;
        }
      }
      state.selected = [g.name, moved.channel];
      setTimeout(() => L.panel.connect());
    }
  }
  takeSeen(home);
  L.notify.dropGone(home); // apps' notifications dismissed here, not yet by the server
  state.home = home;
  markSeen();
  L.panes.appsAtWork(); // apps' panels told their agents' states; held while they work
  L.notify.heedHome(); // what came to want the reader since: popped up (features/notify/notify.js)
  askedByAgents(); // an agent's asking to install an app: the reader's to approve
}
// An agent's asking to install, update or uninstall an app (app_requests.py; home's `app_requests`): the first not yet
// shown here put to the reader in the Apps page's dialog -- the apps read again once they answer
function askedByAgents() {
  const home = S().home!;
  if (snap() || inPane() || !(home.app_requests || []).length) return;
  const who = (c: string) => {
    for (const g of home.gatherers) {
      const a = g.agents.find((x) => x.channel === c || (x.session && x.session.started_as === c));
      if (a) return `${actorTitle(a)} (${g.name})`;
    }
    return `Agent ${c.slice(0, 8)}`;
  };
  L.catalog.askedByAgent(home.app_requests!, who, () => void L.appsPage.appsChanged());
}
// An actor is looked at while it is open in a pane -- not this page's own, out of sight while a screen tab without it
// shows (features/layout/panes.js's isAway). An app is looked at as an actor is: its panel shown (not held out of sight)
// -- while the page is in FRONT of the reader, not only visible, as what it notified them of is said on the computer
// until then (features/notify/notify.js) -- its newest notification then seen (status.ts's appStatusOf), kept as the
// item "app:<its id>"; the list drawn again for it.
export function markSeen(): void {
  const state = S();
  if (snap() || inPane() || !state.home || document.visibilityState !== "visible") return;
  const looked: Look[] = [],
    away = L.panes.isAway(); // this page's own actor, out of sight while a tab without it shows
  for (const [gname, c] of L.panes.openActors()) {
    if (away && L.panes.isAt(state.selected, gname, c)) continue;
    const g = state.home.gatherers.find((x) => x.name === gname);
    const a = g && g.agents.find((x) => x.channel === c);
    if (!a || !a.last || (seen.at[a.key!] || 0) >= a.last) continue;
    seen.at[a.key!] = a.last;
    looked.push([gname, c, a.last]);
  }
  let apps = false;
  for (const p of document.hasFocus() ? L.page.panes.apps : []) {
    const g = !p.held && state.home.gatherers.find((x) => x.name === p.instance.gatherer),
      got = g && (g.apps || {})[p.instance.id];
    if (!g || !got || !got.last) continue;
    const k = LS.appKey(g.name, p.instance.id);
    if ((seen.at[k] || 0) >= got.last) continue;
    seen.at[k] = got.last;
    looked.push([g.name, appItem(p.instance.id), got.last]);
    apps = true;
  }
  void tellSeen(looked);
  if (apps) renderAgents();
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start(): void {
  document.addEventListener("visibilitychange", () => {
    if (S().home && document.visibilityState === "visible") {
      markSeen();
      renderAgents();
    }
  });
}
