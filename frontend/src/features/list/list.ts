// THE LIST OF ACTORS (aside#agents): the reader's choices -- what is folded, hidden, named, saved, selected -- what the
// list's view-model reads of them (listView), and the list drawn by React from it (renderAgents: model.ts's buildList,
// mount.tsx's drawList, with what it calls of the page, list-host.ts's LIST_HOST). What the old page's modules import of
// the list they import from here, as they did: the list's derivations bound to the page's home (CTX), and what the
// list's other modules do.
import { post } from "../../core/api/client";
import * as prefs from "../../core/prefs";
import { readApps, gathererApps } from "./apps";
import { cardDraw, hover } from "./hover-card";
import { markDragged } from "./drag";
import { askRefocus, folderBox, folderClosing, foldersOpen, setFolderClosing } from "./folders";
import { gfMakingNow, gfFolded, gPicks } from "./gatherer-folders";
import { drawManage, manage, manageEntry } from "./manage";
import { L, S, inPane, snap, type PageHome } from "./link";
import { LIST_HOST } from "./list-host";
import { buildList } from "./model";
import { drawTotals, renderFolded } from "./modes";
import { listPlaces, slideList } from "./slide";
import { drawList } from "./mount";
import { endRename, nameBox } from "./naming";
import { drawPickBar } from "./pick-bar";
import { homeSince, homesTaken, seen } from "./seen";
import * as LG from "./groups";
import * as LS from "./status";
import type { ListView } from "./rows";
import type { Actor, Gatherer, ListCtx } from "./types";

// What the list's derivations read besides their arguments (types.ts's ListCtx): the home, and what the page knows of it
// -- each read when asked, so the same object serves every draw
export const CTX: ListCtx = {
  get home() {
    return S().home!;
  },
  get snapshot() {
    return snap();
  },
  now: () => Date.now() / 1000,
  get seenAt() {
    return seen.at;
  },
  opened: (a) => L.files.opened(a),
  apps: (gname) => gathererApps(gname),
};
const setOf = <T>(k: string) => new Set<T>((prefs.list(k) as T[] | null) || []);

// ------------------------------------------------------------------ the reader's choices
export const COLLAPSED_KEY = "ag-dashboard-collapsed-gatherers";
export const collapsed = setOf<string>(COLLAPSED_KEY); // gatherers the reader folded, kept in this browser
// Closed actors (their process gone), and those saved for later, are each folded away under a line ("N closed",
// "N saved"), unless the reader opened that gatherer's, kept in this browser. A selected one stays in view. So are the
// gatherer's shells ("N terminals", SHELLS) -- but none in view while folded, even one open in a pane.
const FOLD_KEYS = {
  Closed: "ag-dashboard-closed-shown",
  Saved: "ag-dashboard-saved-shown",
  Terminals: "ag-dashboard-terminals-shown",
} as const;
type Fold = keyof typeof FOLD_KEYS;
export const foldOpen = Object.fromEntries(
  Object.entries(FOLD_KEYS).map(([group, k]) => [group, setOf<string>(k)]),
) as Record<Fold, Set<string>>;
export function toggleFold(group: string, name: string): void {
  const open = foldOpen[group as Fold];
  if (open.has(name)) open.delete(name);
  else open.add(name);
  prefs.keep(FOLD_KEYS[group as Fold], [...open]);
  renderAgents();
}
// The coordinator agents the reader hid from the list, kept in this browser: a group's by the group's name, any other's
// by its node (crewHideKey) -- its face on its group's or folder's row (CrewButton) shows it again, and opens it.
const CREW_HIDDEN_KEY = "ag-dashboard-crew-hidden";
export const crewHidden = setOf<string>(CREW_HIDDEN_KEY);
export function setCrewHidden(name: string, hide: boolean): void {
  if (hide) crewHidden.add(name);
  else crewHidden.delete(name);
  prefs.keep(CREW_HIDDEN_KEY, [...crewHidden]);
  renderAgents();
}
// The actor shown when none is chosen: the newest not closed, else the newest.
export const firstAgent = (g: Gatherer): Actor | undefined =>
  g.agents.find((a) => a.status !== "closed") || g.agents[0];
export function toggleGatherer(name: string): void {
  if (collapsed.has(name)) collapsed.delete(name);
  else collapsed.add(name);
  prefs.keep(COLLAPSED_KEY, [...collapsed]);
  renderAgents();
}
// Hidden gatherers, kept by the server (hiding.py, `home.hiding`) so every dashboard on this home hides the same ones:
// groups.ts's isHidden.
const HIDDEN_KEY = "ag-dashboard-hidden-gatherers"; // where this browser kept them before
// The groups inactive by now: what the time changes in the list (page/data.js's listSignature)
export const staleNames = (): string[] => LG.staleNames(CTX);
export const isHidden = (g: Gatherer): boolean => LG.isHidden(CTX, g);
async function keepChoice(name: string, choice: string) {
  const home = S().home!,
    before = home.hiding;
  home.hiding = { ...(home.hiding || {}) };
  if (choice) home.hiding[name] = choice;
  else delete home.hiding[name];
  if (snap()) return; // a snapshot has no server: this page only
  const asked = homesTaken; // its answer kept unless a home came meanwhile (seen.ts's takeHome)
  try {
    const got = await post<PageHome["hiding"]>("/api/hiding", { gatherer: name, choice });
    if (!homeSince(asked)) S().home!.hiding = got;
  } catch (err) {
    undone(asked, { hiding: before });
    L.data.setLive(`Not saved: ${(err as Error).message}`);
  }
}
// A change the page made at once, as the reader asked, taken back when the server refused it -- unless a home came
// since, which has what the server keeps (the stream sends a home only when it changed: without this, the page would
// show the change till something else did)
export function undone(asked: number, was: Partial<PageHome>): void {
  if (homeSince(asked)) return;
  Object.assign(S().home!, was);
  L.data.redrawList();
}
// The reader's name for a gatherer, kept by the server (titles.py, `home.titles`) and shown in place of its own, which
// everything else -- its directory, its actors, `ag` -- still goes by (groups.ts).
export const titleOf = (g: Gatherer): string => LG.titleOf(CTX, g);
export async function keepTitle(gname: string, text: string): Promise<void> {
  const asked = homesTaken;
  try {
    const got = await post<PageHome["titles"]>("/api/title", { gatherer: gname, title: text });
    if (!homeSince(asked)) S().home!.titles = got;
  } catch (err) {
    L.data.setLive(`Not named: ${(err as Error).message}`);
  }
  renderAgents();
}
export async function setHidden(g: Gatherer, hide: boolean): Promise<void> {
  const kept = keepChoice(g.name, hide ? "hidden" : LG.stale(CTX, g) ? "shown" : "");
  renderAgents();
  await kept;
  L.data.redrawList();
}
// Actors saved for later, kept by the server (saved.py, `home.saved`: {gatherer: {channel: when}}) so every dashboard
// on this home shows the same. One saved is listed in its folder's saved line once it is closed, not with the closed
// ones; while open it is listed by its status (idle among the idle), its bookmark filled. It keeps its gatherer from
// being hidden for having had nothing for a week (status.ts's savedAs).
export const savedAs = (gname: string, a: Actor): string | null => LS.savedAs(CTX, gname, a);
export async function setSaved(gname: string, a: Actor, save: boolean): Promise<void> {
  const home = S().home!;
  const channel = savedAs(gname, a) || a.channel,
    before = home.saved;
  const kept = { ...((home.saved || {})[gname] || {}) };
  if (save) kept[channel] = new Date().toISOString();
  else delete kept[channel];
  home.saved = { ...(home.saved || {}), [gname]: kept };
  renderAgents();
  if (snap()) return; // a snapshot has no server: this page only
  const asked = homesTaken;
  try {
    const got = await post<PageHome["saved"]>("/api/saved", { gatherer: gname, channel, saved: save });
    if (!homeSince(asked)) S().home!.saved = got;
  } catch (err) {
    undone(asked, { saved: before });
    L.data.setLive(`Not saved: ${(err as Error).message}`);
  }
  L.data.redrawList();
}
// Choices this browser kept before the server did: handed to the server once, then dropped here.
export async function moveHidingToServer(): Promise<void> {
  const v = prefs.json(HIDDEN_KEY) as { hidden?: string[]; shown?: string[] } | null;
  if (snap() || !v) return;
  const had = S().home!.hiding || {};
  for (const name of v.hidden || []) if (!had[name]) await keepChoice(name, "hidden");
  for (const name of v.shown || []) if (!had[name]) await keepChoice(name, "shown");
  prefs.drop(HIDDEN_KEY);
  renderAgents();
}

// SELECTING several actors of one gatherer, to move them at once (or save, or close them): Shift+click adds an actor to
// the selection, or takes it out (⌘/Ctrl+click opens one beside the one shown). One selected is only tinted; from two,
// each has a check on its avatar, and a bar under the list (pick-bar.tsx) offers Move to…, Save, Close. Dragging a
// selected actor drags them all. A selection is of one gatherer, as actors never leave theirs; Esc, or ✕, clears it.
export const picks = { g: null as string | null, cs: new Set<string>() };
export const picked = (g: Gatherer, a: Actor): boolean => picks.g === g.name && picks.cs.has(a.channel);
export function togglePick(g: Gatherer, a: Actor): void {
  if (picks.g !== g.name) {
    picks.g = g.name;
    picks.cs = new Set();
  }
  if (picks.cs.has(a.channel)) picks.cs.delete(a.channel);
  else picks.cs.add(a.channel);
  if (!picks.cs.size) picks.g = null;
  renderAgents();
}
export function clearPicks(draw = true): void {
  if (!picks.g) return;
  picks.g = null;
  picks.cs = new Set();
  if (draw) renderAgents();
}
// [its gatherer, the actors selected] as the home has them now (one gone since: left out)
export function pickedActors(): [Gatherer | null, Actor[]] {
  const g = picks.g ? S().home!.gatherers.find((x) => x.name === picks.g) : null;
  return g ? [g, g.agents.filter((a) => picks.cs.has(a.channel) && !LS.isCoordinator(a))] : [null, []];
}
// The reader's choices, and what is shown, as the list's view-model reads them (rows.ts's ListView)
export function listView(): ListView {
  const state = S();
  return {
    collapsed,
    foldOpen,
    crewHidden,
    foldersOpen,
    gfFolded,
    picks,
    gPicks,
    renaming: (state.renaming as ListView["renaming"]) || null,
    folderEdit: (state.folderEdit as ListView["folderEdit"]) || null,
    folderClosing,
    adding: (state.adding as ListView["adding"]) || null,
    gfMaking: gfMakingNow(),
    open: L.panes.openActors(),
    focused: L.panes.focusedActor() || null,
    selected: state.selected || null,
    away: L.panes.isAway(),
    appSelected: L.panes.appSelected(),
    appsOnly: L.panes.appsOnlyKey(),
    selectedTask: L.panes.selectedTask(),
    appPanels: new Set(L.page.panes.apps.filter((p) => !p.held).map((p) => p.instance.id)),
    tab: tabAt,
  };
}
// Where a row's task is OPEN (features/layout/show.ts's screen tabs): its tab's number, for a screen reader only
// (list.css) -- a boxed number by a face read as an unread count, and the row's bar already says it is open; the hover
// card says which tab (CardParts.tsx's TabLine). None, open nowhere: a click opens it in a tab of its own, and it can be
// dragged onto the work area.
export const tabAt = (k: string | null): { n: number; here: boolean } | null =>
  k && L.panes.workPlacer && !snap() ? L.panes.workPlacer.tabs.where(k) : null;

// THE LIST, drawn by React (AgentList.tsx) from its view-model: each node where the model puts it, by its key, so a row
// stays the same element from one draw to the next -- a row in focus, hovered or dragged stays so as the list is drawn
// again. What a press on it does, and what of it the page still builds (its start buttons and menus, its branch), it
// asks of the page (list-host.ts's LIST_HOST).
export function renderAgents(): void {
  if (inPane()) return; // a frame has no list: the page around it has
  const state = S();
  L.data.drawn.agents = L.data.listSignature(); // what render() compares a home's with
  const model = buildList(CTX, listView());
  for (const g of model.visible) void readApps(g.name); // the apps its actors are attached to
  renderFolded();
  drawTotals(model.totals); // in the top bar, whatever shape the list is in
  const aside = document.getElementById("agents")!;
  const was = listPlaces(aside);
  const homeLine = document.getElementById("home")!;
  homeLine.textContent = homeLine.title = model.home;
  manageEntry(); // Manage groups, in the settings panel (manage.ts)
  drawList(aside, model, LIST_HOST); // (mount.tsx: drawn by now)
  slideList(aside, was);
  if (manage.open) drawManage(); // the groups as they are now (manage.ts)
  if (hover.from === "agents") cardDraw(); // its card, said again from the new data
  nameBox.dropIfGone(); // its row folded away
  folderBox.dropIfGone(); // folded away
  if (folderClosing && folderClosing.from === "list" && !document.querySelector("#agents .f-ask"))
    setFolderClosing(null); // folded away
  askRefocus();
  markDragged(); // drawn again mid-drag: what is dragged, still shown as it
  drawPickBar();
  L.panes.placeIfShown(); // an actor or an app put in a task, or taken out: its block now
  if (L.panes.workPlacer) L.panes.workPlacer.tabs.draw(); // what each screen tab's actors do
  L.newTab.refreshNewTab(); // a new tab's page: its groups, folders, harnesses as they are now
  const servers = state.home!.hook_servers || []; // in the dashboard's panel (the header's button)
  document.getElementById("servers")!.textContent = servers.length
    ? servers.map((s) => `:${s.port} → ${s.upstream}`).join("\n")
    : "None running.";
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start(): void {
  document.addEventListener("keydown", (ev) => {
    const t = ev.target as Element | null;
    if (ev.key !== "Escape" || !picks.g || L.panes.rowPop.el || ev.defaultPrevented) return;
    if (t && t.closest && t.closest("input, textarea, [contenteditable], .xterm")) return;
    clearPicks();
  });
  document.addEventListener(
    "pointerdown",
    (ev) => {
      // a press anywhere but in the name's box: named as typed
      if (S().renaming && ev.target !== nameBox.input) void endRename(true);
    },
    true,
  );
}

// What the old page's modules import of the list: its derivations bound to the page's home, and the other modules' own
export { MANAGER, appFace, appMarkOf, crewFace, plainFace, shellLogo } from "./faces";
export { envelope } from "./envelope";
export { appInfo, appsKnown, gathererApps, readApps } from "./apps";
export { listDrag } from "./drag";
export {
  actorsWithin,
  aimStart,
  byName,
  fileStarted,
  folderById,
  folderPost,
  kidFolders,
  openUp,
  shellFolder,
  shownClosed,
  startIn,
  within,
} from "./folders";
export { endRename } from "./naming";
export { APP_ITEM, appItem, closeShell, isAppItem, openTask, retask, selectApp, showItemsTask } from "./task-acts";
export { actorTitle, actorOf, appShown, appTitle } from "./tasks";
export { appKey, isCoordinator } from "./status";
export { groupCrew, crewHideKey } from "./groups";
export const crewAt = (node: string, g: Gatherer | null = null) => LG.crewAt(CTX, node, g);
export const crewPlace = (node: string, g: Gatherer | null = null): string => LG.crewPlace(CTX, node, g);
export {
  taskActors,
  taskApps,
  taskById,
  taskLead,
  taskMembers,
  taskName,
  taskOf,
  appTaskOf,
  appStatusOf,
} from "./bound";
