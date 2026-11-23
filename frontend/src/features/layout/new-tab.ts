// A NEW TAB's page (work.ts's `blank` hook; drawn by NewTab.tsx): what a tab showing nothing shows -- one made by "+" on
// the tabs' bar or the new-tab key, or the last tab closed. A message box for a new actor: Enter starts one where its line
// says -- IN a group (or a folder of one), or on its own; in a DIRECTORY; ON a harness -- with what was typed its first
// message, shown in this tab, in Chat (startSession: the tab shown showing nothing, the actor goes in it). Nothing is
// started till then: typing alone leaves no actor. Under it, the apps to open here instead (and a terminal), in that
// group. What is typed is the tab's draft (tabs.ts's setDraft): kept with it, the tab kept when left.
// Where things go to start with: the place last started in -- an actor, an app with its agent, a terminal from the list's
// "+" or a new tab, an app from a new tab -- or picked on a new tab, kept in this browser; else the group of the actor
// last shown, else the latest active group. The harness: the last one an actor was started on. The directory: the
// place's (its latest active actor's), changed from its chip.
// KEYS for the screen tabs: the new-tab key opens a new tab (its box in focus), the close key closes the tab shown
// (tabs.ts's closeShown). In the ag app, ⌘T and ⌘W (its menu: desktop/src/menu.ts); in a browser, which keeps those for
// its own tabs, ⌃T and ⌃W -- on a Mac only, where they are no one else's. Not in a terminal: there ⌃W deletes a word, and
// ⌃T is a harness's own key. A Browser panel's page keeps the app's ⌘T and ⌘W for its own tabs, as in Chrome.
import { post } from "../../core/api/client";
import { key } from "../../core/model/keys";
import * as prefs from "../../core/prefs";
import { tildePath } from "../../core/ui/highlight";
import { openApp } from "./app-hooks";
import { L, snap, state } from "./link";
import { ntFocus, ntInput, NT, ntShown, refreshNewTab } from "./NewTab";
import { noHarness, startCwd, startSession, startable } from "./starts";
import type { Actors, AppManifest, ChatSend, Gatherer } from "./types";
import { workPlacer } from "./work-area";

export { drawNewTab, refreshNewTab } from "./NewTab";
const START_PLACE_KEY = "ag-dashboard-start-place";
export const START_HARNESS_KEY = "ag-dashboard-start-harness";
/** A place things start in: a group (and a folder of it), or on its own. */
export type Place = { alone: true } | { alone?: false; g: string; folder: number | null };

export const keptValue = (k: string): unknown => prefs.json(k);
const keepValue = (k: string, v: unknown) => {
  prefs.keep(k, v);
};
export const realGroups = (): Gatherer[] => (state.home ? state.home.gatherers.filter((g) => !g.alone) : []);
export const canAlone = (): boolean => !!(state.home?.merged && startable().length && L.groupMoves.aloneUnder());
/** A place as it is now: its group still there, its folder still in it and not closed (else the group's top); on its
 * own, while an actor can be started so. null: none. */
function placeNow(p: unknown): Place | null {
  if (!p || typeof p !== "object" || !state.home) return null;
  const q = p as { alone?: boolean; g?: string; folder?: number | null };
  if (q.alone) return canAlone() ? { alone: true } : null;
  const g = realGroups().find((x) => x.name === q.g);
  if (!g) return null;
  const f = L.list.folderById(g.name, q.folder);
  return { g: g.name, folder: f && !L.list.shownClosed(g, f) ? f.id : null };
}
/** Where a new tab starts things: the place kept, else the group of the actor shown, else the latest active group. */
export function startPlace(): Place | null {
  const kept = placeNow(keptValue(START_PLACE_KEY));
  if (kept) return kept;
  const gs = realGroups(),
    shown = state.selected && gs.find((g) => g.name === state.selected![0]);
  const g = shown || [...gs].sort((x, y) => (y.last || 0) - (x.last || 0))[0];
  return g ? { g: g.name, folder: null } : null;
}
/** Something started in group `gname` -- in the folder aimed at (the list's startIn), or `folder` -- or on its own: kept,
 * where the next new tab starts things. */
export function keptStart(gname: string, alone = false, folder: number | null | undefined = undefined): void {
  const startIn = L.list.startIn;
  const fid =
    folder !== undefined
      ? folder
      : startIn.g === gname && L.list.folderById(gname, startIn.folder)
        ? startIn.folder
        : null;
  keepValue(START_PLACE_KEY, alone ? { alone: true } : { g: gname, folder: fid });
}
export const keptHarness = (h: string): void => keepValue(START_HARNESS_KEY, h);
/** The place picked on the tab's page, else where things start. */
export const ntPlace = (): Place | null => placeNow(NT.place) || startPlace();
export const ntGroup = (p: { alone?: boolean; g?: string } | null): Gatherer | null =>
  !p ? null : p.alone ? L.groupMoves.aloneUnder() : realGroups().find((g) => g.name === p.g) || null;
export function ntHarness(): string | null {
  const hs = startable(),
    last = keptValue(START_HARNESS_KEY);
  return NT.harness && hs.includes(NT.harness)
    ? NT.harness
    : typeof last === "string" && hs.includes(last)
      ? last
      : hs[0] || null;
}
export function ntCwd(p: Place | null): string {
  if (NT.cwd !== null) return NT.cwd;
  const g: Actors | null = p && (p.alone ? L.groupMoves.everyActor() : ntGroup(p));
  return tildePath((g && startCwd(g)) || state.home?.cwd || "", state.home?.home_dir);
}
export const placeName = (p: Place | null): string =>
  !p
    ? "No group yet"
    : p.alone
      ? "On its own"
      : L.list.titleOf(ntGroup(p)!) + (p.folder !== null ? ` › ${L.list.folderById(p.g, p.folder)?.name || ""}` : "");
/** A place picked from "In"'s drop-down: kept, where things start next. */
export function pickPlace(q: Place): void {
  NT.place = q;
  NT.cwd = null;
  keepValue(START_PLACE_KEY, q);
}

/** One of the apps opened -- in this tab, whatever is typed (tabs.ts's filling): what is typed stays with the tab. */
export async function ntRun(what: string, run: () => Promise<unknown>): Promise<void> {
  if (NT.busy || !workPlacer) return;
  NT.busy = `Opening ${what}…`;
  NT.error = "";
  refreshNewTab(true);
  workPlacer.tabs.filling(true);
  try {
    await run();
  } catch (e) {
    NT.error = `${what}: ${(e as Error).message}`;
  } finally {
    workPlacer.tabs.filling(false);
    NT.busy = "";
    refreshNewTab(true);
  }
}
/** An app opened from the page, in the place's group: a new one filed where it was started (one there already stays
 * put), shown as a click on its row shows it. */
export async function ntOpenApp(g: Gatherer, p: Place, app: AppManifest): Promise<void> {
  const folder = p.alone ? null : p.folder;
  const inst = await L.appHost.open(app.name, g.name, ntCwd(p) || null);
  const id = L.list.appItem(inst.id),
    fresh = !L.list.appInfo(g.name, inst.id);
  if (fresh && folder !== null)
    await L.list.folderPost(g.name, { do: "file", channels: [id], folder }, (tree) => {
      tree.filed[id] = folder;
      L.list.openUp(tree, folder);
    });
  keptStart(g.name, false, folder);
  await L.list.readApps(g.name, true);
  const o = L.list.appInfo(g.name, inst.id);
  if (o) await L.list.selectApp(g.name, o, {});
  else await openApp(g.name, app.name, ntCwd(p) || null);
}
/** Enter: a new actor where the line says, its first message what was typed -- shown in this tab, the message sent as
 * Chat sends one (shown at once, kept as its draft if it could not be sent). The tab's draft gone once it has started. */
export async function ntSend(): Promise<void> {
  const input = ntInput(),
    text = input ? input.value.trim() : "";
  if (!text || NT.busy || !workPlacer) return;
  const say = (t: string) => {
    NT.error = t;
    refreshNewTab(true);
  };
  const p = ntPlace(),
    g = ntGroup(p),
    h = ntHarness(),
    cwd = ntCwd(p).trim();
  if (!p || !g) return say("Make a group first with the folder button at the top of the list.");
  if (!h) return say(p.alone ? "No harness here can start an actor on its own. Pick a group under In." : noHarness());
  if (!cwd) return say("Which directory? Choose one under Directory.");
  NT.busy = "Starting…";
  NT.error = "";
  refreshNewTab(true);
  if (!p.alone) L.list.aimStart(g.name, p.folder);
  const tabs = workPlacer.tabs,
    tab = tabs.shownTab().id;
  let s: { session_id: string; gatherer: string } | null = null;
  tabs.filling(true); // the actor in this tab
  try {
    s = await startSession(g.name, cwd, h, null, !!p.alone);
    tabs.setDraft("", tab);
  } catch (e) {
    NT.error = `Not started: ${(e as Error).message}`;
  } finally {
    tabs.filling(false);
    NT.busy = "";
  }
  if (!s) {
    refreshNewTab(true);
    ntFocus();
    return;
  }
  const k = key(s.gatherer, s.session_id),
    shown = L.paneView.paneOf(s.gatherer, s.session_id);
  const send = shown?.chatSend as ChatSend | undefined; // (the latest draw's, with whose draft it is: Chat's)
  if (shown && send && send.draft === k) {
    if (await send(text)) return;
    if (!L.data.drafts()[k]) {
      L.data.keepDraft(k, text); // not sent (Chat says why): its draft, not lost
      L.mainView.drawPane(shown);
    }
    return;
  }
  L.data.keepDraft(k, text); // not in Chat here (another view): its draft, to send from there
  try {
    await post("/api/send", { session_id: s.session_id, text });
    L.data.keepDraft(k, "");
  } catch (e) {
    L.data.setLive(`Not sent: ${(e as Error).message}`);
  }
}

/** The keys: the page's, or the ag app's menu's. */
function tabKey(what: string): void {
  if (!workPlacer || snap()) return;
  if (what === "closeTab") {
    void workPlacer.tabs.closeShown();
    return;
  }
  if (what !== "newTab") return;
  if (ntShown())
    ntFocus(); // a new tab's page shown: its box
  else void workPlacer.tabs.blank();
}
/** Whether this runs on a Mac (the page's own keys, ⌃T and ⌃W, are a Mac's only). */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  if (!snap() && IS_MAC)
    document.addEventListener(
      "keydown",
      (ev) => {
        if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.defaultPrevented || ev.isComposing) return;
        const k = String(ev.key).toLowerCase();
        if (k !== "t" && k !== "w") return;
        if (ev.target instanceof Element && ev.target.closest(".xterm")) return; // the terminal's own
        ev.preventDefault();
        ev.stopPropagation();
        tabKey(k === "t" ? "newTab" : "closeTab");
      },
      true,
    );
  if (!snap()) {
    try {
      const app = (window as { agApp?: { onKey?: (f: (what: string) => void) => void } }).agApp;
      if (app && app.onKey) app.onKey(tabKey);
    } catch {
      /* not the app */
    }
  }
}
