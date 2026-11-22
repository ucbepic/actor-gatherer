// THE WORK AREA PLACED: the panels shown, as the work area arranges them (work.ts): each task shown a block of its own,
// side by side, laid out as the reader arranged it (kept per task in this browser) -- at first its apps' panels side by
// side above its actors' panes side by side -- the chat minimized under the apps only as tall as their message boxes; a
// task of apps only shown, its apps alone. A pane's head (or its Chat bar's grip, the head put there) or an app's
// panel's head dragged moves it beside another panel of its task, or into its place; right-clicked, a menu does
// (moves.ts). None placed at a phone's width: the stylesheet lays them out, one under another. And what the work area
// asks of the page: what a block is called, its faces and what is in it, a task's states for its screen tab, a task
// dropped from the list.
import { plural } from "../../core/format";
import { isShell, parse as parseKey, taskNumber } from "../../core/model/keys";
import { sweepKept } from "./app-panels";
import { CREW_GROUP } from "./crew";
import { clearWork, closeTaskHere, enterTasks, openTaskBeside, openTaskHereBeside, showTaskItems } from "./enter";
import { NARROW } from "./heads";
import { gathererNamed, L, renderAgents, snap, state, statusOf } from "./link";
import * as model from "./model";
import { drawNewTab } from "./new-tab";
import { isAway, keyNow, selectedTask, shownPanels, taskKey, tasksLaidOut } from "./open";
import { rememberTask, taskLayout } from "./remember";
import { shadow } from "./shadow";
import { paneMinimized } from "./top";
import type { Actor, AppItem } from "./types";
import { work as workLayout, type Old, type Work } from "./work";

/** The work area's placer (work.ts), once the page has started placing (startPlacing). */
export let workPlacer: Work | null = null;
let placedFor = "";
const shownSig = () => JSON.stringify([isAway(), shownPanels().map((s) => [s.key, s.item])]);
/** The work area placed (a failure placing it breaks nothing that called it -- a panel being opened, the panels kept being
 * restored: thrown again on its own). */
export function placeWork(): void {
  if (!workPlacer) return;
  try {
    placedFor = shownSig();
    workPlacer.place();
  } catch (e) {
    setTimeout(() => {
      throw e;
    }, 0);
  }
  noteOpen();
}
// the items open as placed, by task, kept in the store (model.ts's noteOpen): what a task held, read after it changes
// (remember.ts's keysNow)
function noteOpen(): void {
  if (!state.home) return;
  const byTask: Record<string, string[]> = {},
    shown = shownPanels();
  for (const s of shown) if (s.key) (byTask[s.key] = byTask[s.key] || []).push(s.item);
  shadow.update(
    model.noteOpen,
    byTask,
    shown.map((s) => s.item),
  );
}
/** Placed again only if what it shows changed since (an actor shown in this page's own pane, one put in a task): each
 * draw. */
export function placeIfShown(): void {
  if (workPlacer && shownSig() !== placedFor) placeWork();
}
/** The work area placed from now on, once, as the page starts. */
export function startPlacing(): void {
  if (snap() || workPlacer) return;
  const work = document.querySelector<HTMLElement>(".work")!;
  workPlacer = workLayout(work, {
    shown: shownPanels,
    narrow: () => NARROW.matches,
    old: (k) => taskLayout(k) as Old | null,
    known: () => !!state.home,
    label: blockName,
    open: openDropped,
    minChanged: paneMinimized,
    focus: selectedTask,
    enter: enterTasks,
    status: taskStates,
    showItems: showTaskItems,
    lead: taskLeadOf,
    canon: keyNow,
    clear: clearWork,
    remember: (keys) => {
      for (const k of keys) if (tasksLaidOut.has(k)) rememberTask(k);
    },
    faces: blockFaces,
    about: blockAbout,
    look: cellLook,
    closeTask: closeTaskHere,
    openBeside: openTaskHereBeside,
    listed: () => {
      sweepKept();
      if (state.home) renderAgents();
    },
    blank: drawNewTab, // a tab showing nothing: its new-tab page (new-tab.ts)
  });
  NARROW.addEventListener("change", placeWork);
  // a task's row dragged from the list over the work area (the list's listDrag): one open in no tab, opened beside the
  // tasks shown, on the side of the one it is dropped on
  work.addEventListener("dragenter", () => {
    const drag = L.list.listDrag;
    const k = drag && !drag.offered ? draggedTask() : null;
    if (k && drag && workPlacer!.offer(k)) drag.offered = true;
  });
  placeWork();
}
/** A panel closed by the reader (its ×): out of its task's tab shown, if the task has tabs. */
export function workClosed(node: HTMLElement | null | undefined): void {
  if (workPlacer && node) workPlacer.closed(node);
}

/** What a block of the work area is called on its strip (shown while there are others): its task's name, an actor's (the
 * coordinator agent's, unnamed: what it is), an app's; a terminal's (no task). */
function blockName(k: string): string {
  const { group: g, id } = parseKey(k),
    gg = gathererNamed(g);
  if (k.startsWith("\u0002")) return isShell(k.slice(1)) ? "Terminal" : "";
  if (!gg || id === undefined) return "";
  const n = taskNumber(id);
  if (n !== null) {
    const t = L.list.taskById(g, n);
    return t ? L.list.taskName(gg, t) : "A task";
  }
  if (L.list.isAppItem(id)) {
    const o = L.list.appInfo(g, id.slice(L.list.APP_ITEM.length));
    return o ? L.list.appShown(o) : "An app";
  }
  const a = gg.agents.find((x) => x.channel === id);
  if (!a) return id;
  if (L.list.isCoordinator(a) && !a.name?.text)
    return a.over ? `${L.list.crewPlace(a.over, gg)} coordinator` : CREW_GROUP;
  return L.list.actorTitle(a);
}
/** A block's faces, on its card's head: its task's actors' (three at most) and its apps' marks -- an actor's, an app's,
 * alone. */
function blockFaces(k: string): HTMLElement[] {
  const { group: g, id } = parseKey(k),
    gg = gathererNamed(g),
    el = L.helpers.el;
  if (!gg || id === undefined) return [];
  const face = (a: Actor) => {
    const src = a.avatar && !snap() ? `/avatars/${a.avatar}.svg` : null;
    return src
      ? el("img", { class: "lay-face", src, alt: "", draggable: "false" })
      : el("span", { class: "lay-face" }, L.helpers.harnessLogo(a.harness));
  };
  const mark = (o: AppItem) => el("span", { class: "lay-face app" }, L.list.appMarkOf(o));
  const n = taskNumber(id);
  if (n !== null) {
    const actors = L.list.taskActors(gg, n);
    return [...actors.slice(0, 3).map(face), ...(actors.length ? [] : L.list.taskApps(gg, n).slice(0, 1).map(mark))];
  }
  if (L.list.isAppItem(id)) {
    const o = L.list.appInfo(g, id.slice(L.list.APP_ITEM.length));
    return o ? [mark(o)] : [];
  }
  const a = gg.agents.find((x) => x.channel === id);
  return a ? [face(a)] : [];
}
/** What a panel's box shows in its screen tab's map (tab-map.ts): an actor's, its avatar's hue and face; an app's, its
 * mark on grey. A task's key for its item (a tab with no map kept of it): its lead's, else its first app's. */
function cellLook(k: string, item: string) {
  const { group: g, id } = parseKey(k),
    gg = gathererNamed(g);
  if (!gg || id === undefined) return null;
  const n = taskNumber(id);
  if (item === k && n !== null) {
    const o = L.list.taskApps(gg, n)[0];
    item = o ? L.list.APP_ITEM + o.id : "";
  } else if (item === k) item = id;
  if (L.list.isAppItem(item)) {
    const o = L.list.appInfo(g, item.slice(L.list.APP_ITEM.length));
    return { app: true, src: o && o.app.mark && !snap() ? `/apps/mark/${encodeURIComponent(o.app.name)}.svg` : null };
  }
  const a = gg.agents.find((x) => x.channel === item);
  return a
    ? {
        hue: (a.avatar_hue && L.helpers.HUE_MAIN[a.avatar_hue]) || null,
        src: a.avatar && !snap() ? `/avatars/${a.avatar}.svg` : null,
      }
    : null;
}
/** What is in a block, in words, on its card's head: its actors, how many; its apps, by name. */
function blockAbout(k: string): string {
  const { group: g, id } = parseKey(k),
    gg = gathererNamed(g),
    t = taskNumber(id);
  if (!gg || t === null) return "";
  const n = L.list.taskActors(gg, t).length,
    apps = L.list.taskApps(gg, t).map((o) => o.app.label);
  return [n ? plural(n, "actor") : null, apps.length ? [...new Set(apps)].join(", ") : null]
    .filter(Boolean)
    .join(" · ");
}
/** A TASK'S STATES, for its face in its screen tab (tabs.ts marks the most pressing): each of its actors' (statusOf), its
 * lead's first, and its apps' notifications not seen -- each as a mark (tabs.ts's MARKS: a turn, a build, a start all
 * "working"; idle, closed none) and its word as the list says it. */
export const TAB_MARK: Readonly<Record<string, string>> = {
  asking: "asking",
  error: "error",
  failed: "error",
  notified: "notified",
  finished: "finished",
  running: "working",
  building: "working",
  background: "background",
};
function taskStates(k: string): { mark: string; said: string }[] {
  const { group: g, id } = parseKey(k),
    gg = gathererNamed(g);
  if (!gg || id === undefined || isShell(id)) return [];
  const t = taskNumber(id);
  const one = L.list.isAppItem(id) ? L.list.appInfo(g, id.slice(L.list.APP_ITEM.length)) : null;
  const lead = t !== null ? L.list.taskLead(gg, t) : null;
  const actors =
    t !== null
      ? [lead, ...L.list.taskMembers(gg, t).filter((a) => a !== lead)].filter((a): a is Actor => !!a)
      : one
        ? []
        : gg.agents.filter((a) => a.channel === id);
  const apps = t !== null ? L.list.taskApps(gg, t) : one ? [one] : [];
  return [...actors.map(statusOf), ...apps.map((o) => L.list.appStatusOf(g, o.id)).filter((s) => !!s)].map(
    ([cls, said]) => ({ mark: TAB_MARK[cls] || "", said }),
  );
}
/** A task's lead actor (a new tab of the task holds it). */
function taskLeadOf(k: string): string | null {
  const { group: g, id } = parseKey(k),
    gg = gathererNamed(g);
  if (!gg || id === undefined || L.list.isAppItem(id) || isShell(id)) return null;
  const n = taskNumber(id);
  if (n === null) return id;
  return L.list.taskLead(gg, n)?.channel || null;
}
// the task whose row (or a row of it) is dragged from the list: one task's items only; one not shown with an actor to
// open beside (a task of apps alone opens alone)
function draggedTask(): string | null {
  const drag = L.list.listDrag;
  if (!drag) return null;
  const cs = drag.cs || [],
    keys = [...new Set(cs.map((c) => taskKey(drag.g, c)))];
  if (keys.length !== 1 || !keys[0]) return null;
  const k = keys[0];
  return !workPlacer!.tabs.where(k) && cs.some((c) => !L.list.isAppItem(c)) ? k : null; // open in a tab: not dropped
}
/** A task dropped on the work area from the list, not shown: opened beside the tasks shown (as ⌘+click on its row). */
function openDropped(k: string): void {
  const { group: g, id } = parseKey(k),
    n = taskNumber(id);
  if (n !== null) void L.openTask(g, n, null, { metaKey: true });
  else if (!L.list.isAppItem(id)) void openTaskBeside(g, k, id);
}
