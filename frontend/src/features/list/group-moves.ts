// ------------------------------------------------------------------ moves between groups
// In the home's one database (state.home.merged: `ag home merge`'s), what is dragged in the list may be dropped into
// another group -- actors, each with its task (which moves whole), or a folder with all in it -- once the reader says
// so (the Notes design "Groups: design", section 2): a dialog says who moves, from which group to which, how many
// others each has, and how many of those moving are working now, which rebuild their context at their next call
// (move-plan.ts). Then the server moves them (/api/groups, groups.py), and a pane showing one of them follows it. An app
// of a task or a folder that moves goes with it, its actors keeping it -- one with many instances (Browser, DocWriter,
// Editor). An app's own agent (one it started: features/apps/app-actors.js's appRole) and its window go together, as a
// task does (drag-rules.ts's withOwn): so a group's only one of its app (Notes, Slack, Paper news) goes too when its own
// agent does -- into a group with one of its own, it closes, and its agent works with that one -- and otherwise stays
// with its group, a drag that would take it staying in its group, as every drag did before.
import { post } from "../../core/api/client";
import { appItem } from "../../core/model/keys";
import * as prefs from "../../core/prefs";
import { appInfo, readApps } from "./apps";
import { withOwn } from "./drag-rules";
import { RULES } from "./drag";
import { actorsWithin, folderById, folderOf, showFolder, within } from "./folders";
import { ALONE_NEW } from "./Head";
import type { AloneNewInfo } from "./host";
import * as LG from "./groups";
import { L, S, inPane, snap } from "./link";
import { collapsed, COLLAPSED_KEY, CTX, renderAgents, titleOf } from "./list";
import { drawDialogs, mvClose, mvDraw, mvOpen, moveAsk } from "./manage";
import { select } from "./modes";
import * as MP from "./move-plan";
import { appFolder } from "./tree";
import { isCoordinator } from "./status";
import { actorTitle, withTasks } from "./tasks";
import type { Drag } from "./drag-rules";
import type { Gatherer } from "./types";

const named = (gname: string): Gatherer | null => S().home!.gatherers.find((x) => x.name === gname) || null;
const isAppItem = (c: string) => c.startsWith("app:");
// (CTX read when asked: the modules of the list load each other in a ring)
const WORDS: MP.Words = {
  get ctx() {
    return CTX;
  },
  label: (app) => (L.appHost.named(app) || { label: "" }).label || app,
};
/** What came of a change: the group it went to, the actors and apps that moved, the apps closed for the other group's
 * own, and what to say of it. */
interface Moved {
  to: string;
  actors: string[];
  apps: string[];
  joined?: Record<string, string>;
  said: string;
}
type Movement = { actors?: string[]; apps?: string[]; joined?: Record<string, string> };

// What is dragged (`d`, drag.ts's listDrag), dropped into folder `id` of group `g` (null: its top): the move -- into
// that folder's group, as the default rule has it (an actor on its own: it joins; kept on its own there only from
// Manage groups). Dropped in the list (`d.ask` false), at once; else the dialog first.
export async function askMove(d: Drag, g: Gatherer, id: number | null): Promise<void> {
  const from = named(d.g);
  if (!from) return;
  const body = {
    gatherer: d.g,
    to: g.name,
    ...(d.folder !== null ? { folder: d.folder } : { channels: withOwn(RULES, from, d.cs || []) }),
  };
  if (d.ask === false) {
    void mvNow(
      async () => {
        const m = (await post<{ moved?: Movement }>("/api/groups", { ...body, do: "move", into: id })).moved || {};
        return {
          to: g.name,
          actors: m.actors || [],
          apps: m.apps || [],
          joined: m.joined || {},
          said: `Moved to the ${titleOf(g)} group`,
        };
      },
      "Not moved",
      d.g,
    );
    return;
  }
  const title = `Move to the ${titleOf(g)} group?`;
  mvOpen("Move to another group");
  mvDraw({ title, note: "Working out who moves…" });
  let plan: MP.Plan;
  try {
    plan = await post<MP.Plan>("/api/groups", { ...body, do: "plan" });
  } catch (err) {
    mvDraw({ title, note: `Can't move: ${(err as Error).message}` });
    return;
  }
  const crews = d.folder !== null ? MP.crewsWithin(CTX, from, d.folder) : [];
  const said = MP.crewsSaid(crews, false);
  const shown = {
    title: from.alone ? `Join the ${titleOf(g)} group?` : title,
    lines: [...MP.moveLines(WORDS, from, g, plan), ...(said ? [said] : [])],
    names: MP.moveNames(
      from,
      plan.actors.filter((c) => !crews.some((a) => a.channel === c)),
    ),
    goLabel: from.alone ? "Join" : "Move",
  };
  const go = mvGo(
    shown,
    "Moving…",
    "Not moved",
    async () => {
      const got = await post<{ moved?: Movement }>("/api/groups", { ...body, do: "move", into: id });
      return {
        to: g.name,
        actors: plan.actors,
        apps: (got.moved && got.moved.apps) || [],
        joined: (got.moved && got.moved.joined) || {},
        said: `Moved to the ${titleOf(g)} group`,
      };
    },
    d.g,
  );
  mvDraw({ ...shown, go });
}
// A folder dropped outside every group (`d`, drag.ts's listDrag): the dialog, then the folder made a group of its own
// (groups.py's `split`) -- the server's, named after it
export function askSplit(d: Drag): void {
  const from = named(d.g),
    f = from && folderById(d.g, d.folder);
  if (from && f) askOwn(from, f, false, d.ask !== false);
}
// Folder `f` of group `g` given a group of its own (groups.py's `own`), where it is (`here`: its line's button) -- or,
// dropped outside every group, at the list's top (`split`): the dialog, then the group, named after it -- dropped in the
// list (`ask` false), the group at once
export function askOwn(g: Gatherer, f: { id: number; name: string }, here = true, ask = true): void {
  const make = async (): Promise<Moved> => {
    type Made = { group: string; actors: string[]; apps?: string[] };
    const got = await post<{ own?: Made; split?: Made }>("/api/groups", {
      gatherer: g.name,
      do: here ? "own" : "split",
      folder: f.id,
    });
    const made = (here ? got.own : got.split)!;
    return { to: made.group, actors: made.actors, apps: made.apps || [], said: `${f.name} is a group of its own` };
  };
  if (!ask) {
    void mvNow(make, "Not made", g.name);
    return;
  }
  const inGroup = withTasks(
    CTX,
    g,
    actorsWithin(g, f.id).map((a) => a.channel),
  );
  const inside = inGroup.filter((c) => !isAppItem(c));
  const going = [
    ...new Set([
      ...inGroup.filter(isAppItem).map((c) => c.slice("app:".length)),
      ...CTX.apps(g.name)
        .filter((o) => ((x) => x !== null && within(g.name, x, f.id))(appFolder(CTX, g.name, o.id)))
        .map((o) => o.id),
    ]),
  ]
    .map((i) => appInfo(g.name, i))
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => ({ id: o.id, app: o.app.name, title: o.name || o.title }));
  const shown = {
    title: here ? `Give ${f.name} a group of its own?` : `Make ${f.name} a group of its own?`,
    lines: MP.ownLines(WORDS, g, f, here, inside, going),
    names: MP.moveNames(g, inside),
    goLabel: "Make a group",
  };
  mvOpen("A folder made a group of its own");
  const go = mvGo(shown, "Making the group…", "Not made", make, g.name);
  mvDraw({ ...shown, go });
}
// ---- a group dropped into another (groups.py's `merge`): made a folder of it, named after it, everything in it
// The group `name` dropped into folder `id` of group `g` (null: its top): the dialog, then the merge, as the default rule
// has it -- a folder of `g` takes `g`'s group (kept a group of its own there: Manage groups, `ag groups merge --keep`).
// `back`: a group inside `g`'s folder, made part of `g` again (Manage groups' switch). Dropped in the list (`ask`
// false): the merge at once.
export async function askMerge(name: string, g: Gatherer, id: number | null, back = false, ask = true): Promise<void> {
  const from = named(name);
  if (!from) return;
  const merge = async (): Promise<Moved> => {
    type Merged = { folder: number; actors: string[]; apps?: string[]; joined?: Record<string, string> };
    const got = await post<{ merged: Merged }>("/api/groups", { gatherer: name, to: g.name, into: id, do: "merge" });
    const m = got.merged;
    if (collapsed.delete(g.name)) prefs.keep(COLLAPSED_KEY, [...collapsed]); // the group it went into open, and the folder it became
    showFolder(g.name, id, true);
    showFolder(g.name, m.folder, true);
    return {
      to: g.name,
      actors: m.actors,
      apps: m.apps || [],
      joined: m.joined || {},
      said: `${titleOf(from)} is a folder of ${titleOf(g)} now`,
    };
  };
  if (!ask) {
    void mvNow(merge, "Not merged", name);
    return;
  }
  const title = back
    ? `Make ${titleOf(from)} part of ${titleOf(g)} again?`
    : `Merge ${titleOf(from)} into ${titleOf(g)}?`;
  mvOpen("A group merged into another");
  mvDraw({ title, note: "Working out what moves…" });
  let plan: { folder: string; apps: MP.PlanApp[] };
  try {
    plan = await post("/api/groups", { gatherer: name, to: g.name, into: id, do: "merge_plan" });
  } catch (err) {
    mvDraw({ title, note: `Can't merge: ${(err as Error).message}` });
    return;
  }
  const inside = id === null ? null : folderById(g.name, id);
  const actors = from.agents.filter((a) => !isCoordinator(a));
  const shown = {
    title,
    lines: MP.mergeLines(WORDS, from, g, inside, plan),
    names: MP.moveNames(
      from,
      actors.map((a) => a.channel),
    ),
    goLabel: "Merge",
  };
  const go = mvGo(shown, "Merging…", "Not merged", merge, name);
  mvDraw({ ...shown, go });
}
// What its button does: `act()` (-> {to, actors, said}), the dialog busy meanwhile; then the home read again, the panes
// that show an actor moved following it (from group `from`)
function mvGo(
  shown: { title: string; lines: string[]; names: { shown: string[]; more: number } | null; goLabel: string },
  doing: string,
  failed: string,
  act: () => Promise<Moved>,
  from: string,
): () => Promise<void> {
  const go = async () => {
    moveAsk.busy = true;
    mvDraw({ ...shown, note: doing });
    let got: Moved;
    try {
      got = await act();
    } catch (err) {
      moveAsk.busy = false;
      mvDraw({ ...shown, note: `${failed}: ${(err as Error).message}`, go });
      return;
    }
    moveAsk.busy = false;
    mvClose();
    await L.data.loadHome();
    await followMoved(from, got.to, got.actors, got.apps || [], got.joined || {});
    renderAgents();
    L.data.setLive(got.said);
  };
  return go;
}
// A change made at once, with no dialog -- a drop in the list, by the default rule: `act()` (-> as mvGo's), then the
// home read again and the panes following what moved, as mvGo does; refused, said so
async function mvNow(act: () => Promise<Moved>, failed: string, from: string): Promise<void> {
  let got: Moved;
  try {
    got = await act();
  } catch (err) {
    L.data.setLive(`${failed}: ${(err as Error).message}`);
    return;
  }
  await L.data.loadHome();
  await followMoved(from, got.to, got.actors, got.apps || [], got.joined || {});
  renderAgents();
  L.data.setLive(got.said);
}
// After a move: a pane showing an actor that moved shows it in its new group, and an app's that moved (`apps`, their
// ids) is opened again there -- its panel was opened for its old group -- and one closed for the new group's own one
// (`joined`, {its id: that one's}) shows that one
async function followMoved(
  from: string,
  to: string,
  moved: string[],
  apps: string[] = [],
  joined: Record<string, string> = {},
) {
  const gone = new Set(moved),
    P = L.panes;
  for (const p of P.actorPanes())
    if (p.g === from && gone.has(p.c)) {
      P.retarget(p, to, p.c);
      void P.paneGiven(p); // drawn for it there (its calls and view loaded again)
    }
  P.savePanes();
  L.panel.connect();
  if (apps.length || Object.keys(joined).length) {
    await Promise.all([readApps(from, true), readApps(to, true)]);
    for (const p of L.page.panes.apps.filter((q) => apps.includes(q.instance.id) && q.instance.gatherer === from))
      P.swapAppPane(p, { ...p.instance, gatherer: to });
    for (const p of L.page.panes.apps.filter((q) => q.instance.id in joined && q.instance.gatherer === from)) {
      const there = appInfo(to, joined[p.instance.id]);
      if (there && L.page.panes.apps.some((q) => q.instance.id === there.id))
        P.closeAppPane(p); // shown already
      else if (there) P.swapAppPane(p, there.inst);
    }
  }
  const sel = S().selected;
  if (sel && sel[0] === from && gone.has(sel[1])) await select(to, sel[1]);
}

// ---- an actor on its own from its start (groups.py's `start_alone`): the list head's "+" beside its folder button. Its
// box (features/layout/StartBoxes.tsx's railNewBox, `alone`) asks the directory it works in -- the latest active actor's to
// start with -- and the harness, any that runs here. It runs under a group of the home's (ag runs every session in
// one): the shown actor's, else the latest active -- and shares with no one. Only on the home's one database, as every
// group of one: none with a database per gatherer, as no drop outside every group.
// its pop-up's key (Head.tsx's ALONE_NEW), and what `state.starting` names while it starts: no group's (a name holds no
// ":", a group of one's ends in an id)
export { ALONE_NEW };
export const everyActor = (): { agents: Gatherer["agents"] } => ({
  agents: S().home!.gatherers.flatMap((g) => g.agents),
});
export function aloneUnder(): Gatherer | null {
  const state = S(),
    real = state.home!.gatherers.filter((g) => !g.alone);
  const shown = state.selected && real.find((g) => g.name === state.selected![0]);
  return shown || [...real].sort((x, y) => (y.last || 0) - (x.last || 0))[0] || null;
}
export function aloneNewInfo(): AloneNewInfo | null {
  const state = S();
  if (snap() || inPane() || !state.home!.merged) return null;
  const hs = L.panes.startable(),
    g = aloneUnder();
  return {
    why: !g ? "Make a group first" : !hs.length ? L.panes.noHarness() : "",
    busy: !!state.starting && state.starting.gatherer === ALONE_NEW,
    off: !!state.starting,
    open: L.panes.rowPop.key === ALONE_NEW,
  };
}
export function aloneNewPress(button: HTMLElement): void {
  const P = L.panes;
  if (P.rowPop.key === ALONE_NEW) return P.closePop();
  const hs = P.startable();
  P.openPop(ALONE_NEW, button, P.railNewBox(aloneUnder(), hs, hs[0], P.startCwd(everyActor()), "", true));
}

// ---- an actor on its own: a group of one (groups.py's `alone`, `self:<channel>`), listed as its row alone (no head:
// its title says what it is); it has no coordinator agent. Dragged into a group, it is asked first, as any move between
// groups (askMove).
// One actor (`d`, drag.ts's listDrag) dropped outside every group: the dialog, then it on its own, with its task's apps
// and its own window if it is an app's agent (withOwn) -- dropped in the list (`d.ask` false), at once
export function askAlone(d: Pick<Drag, "g" | "cs" | "ask">, here = false): void {
  const from = named(d.g),
    items = from ? withOwn(RULES, from, d.cs || []) : [];
  const c = items.find((k) => !isAppItem(k)),
    a = c && from ? from.agents.find((x) => x.channel === c) : null;
  if (!from || !a) return;
  const going = items
    .filter(isAppItem)
    .map((k) => appInfo(d.g, k.slice("app:".length)))
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => ({ id: o.id, app: o.app.name, title: o.name || o.title }));
  const name = actorTitle(a);
  const take = async (): Promise<Moved> => {
    type Alone = { group: string; actors: string[]; apps?: string[] };
    const got = await post<{ alone: Alone }>("/api/groups", {
      gatherer: d.g,
      do: "alone",
      channel: c,
      ...(here ? { here: true } : {}),
    });
    return { to: got.alone.group, actors: got.alone.actors, apps: got.alone.apps || [], said: `${name} is on its own` };
  };
  if (d.ask === false) {
    void mvNow(take, "Not taken out", d.g); // dropped in the list: at once
    return;
  }
  const f = here ? folderById(d.g, folderOf(d.g, a)) : null,
    where = f ? f.name : `the top of ${titleOf(from)}`;
  const shown = {
    title: here ? "Put it on its own?" : "Take it out of every group?",
    lines: MP.aloneLines(WORDS, from, a, here, where, going),
    names: null,
    goLabel: here ? "On its own" : "Take it out",
  };
  mvOpen("An actor on its own");
  const go = mvGo(shown, "Taking it out…", "Not taken out", take, d.g);
  mvDraw({ ...shown, go });
}

// ---- groups inside another group's folder (groups.py's `place`, `own`, `above`; home.places: {group: {in, folder}}),
// the Notes design "Groups: folders, defaults and Manage groups": a folder takes its parent's group or has its own, an
// actor has its folder's group or is on its own. The list says nothing of groups: a group of its own inside another's
// folder is drawn there (model.ts's placed rows), its row set in as a folder's line is; an actor on its own there, as
// any actor. Who shares with whom is set in Manage groups alone (manage.ts): its own group (askOwn), back in the group
// around it (askAbove, askJoin), on its own where it is (askAloneHere). A drag follows the default rule -- what is
// dropped into a folder takes its group, after the question (askMerge, askMove) -- and one within the group it is in
// just moves (placeGroup), as a folder does.
// the group `gname` open, and its folder `id` with the folders it is in
function openWhere(gname: string, id: number | null) {
  if (collapsed.delete(gname)) prefs.keep(COLLAPSED_KEY, [...collapsed]);
  for (let f = id; f !== null && f !== undefined; f = (folderById(gname, f) || { parent: null }).parent ?? null)
    showFolder(gname, f, true);
}
// The group `name` put in folder `id` of group `to` ("": at the list's top), keeping its own group: nothing anyone
// shares changes, so no question -- moved within the group it is in, or an actor on its own taken back to the top
export async function placeGroup(name: string, to: string, id: number | null): Promise<void> {
  try {
    await post("/api/groups", { gatherer: name, to, into: id, do: "place" });
  } catch (err) {
    L.data.setLive(`Not moved: ${(err as Error).message}`);
    return;
  }
  if (to) openWhere(to, id);
  await L.data.loadHome();
  renderAgents();
}
// A nested group's way back: made part of the group it is in again, a folder of it where it is (the merge's dialog)
export function askAbove(g: Gatherer): void {
  const p = LG.placeOf(CTX, g.name),
    outer = LG.nestedIn(CTX, g);
  if (outer && p) void askMerge(g.name, outer, p.folder, true);
}
// An actor on its own in a folder, back in that folder's group (the move's dialog, without "Stay on its own")
export function askJoin(x: Gatherer): void {
  const p = LG.placeOf(CTX, x.name),
    g = LG.nestedIn(CTX, x),
    a = LG.aloneActor(x);
  if (g && a && p) void askMove({ g: x.name, cs: [a.channel], gs: null, folder: null, ask: true }, g, p.folder);
}
// An actor of group `g` on its own, staying in its folder
export const askAloneHere = (g: Gatherer, a: { channel: string }): void =>
  askAlone({ g: g.name, cs: [a.channel], ask: true }, true);
// (the dialogs drawn again: Manage groups and the move's question, manage.ts's)
export { drawDialogs, appItem };
