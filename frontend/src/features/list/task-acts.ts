// TASKS (tasks.py, `home.tasks`: {gatherer: {tasks: [{id, name}], tasked: {item: task id}}}): what the reader works with
// at once -- actors and apps alike, its ITEMS: an actor by its channel, an app's instance by "app:<its id>" -- one row in
// the list (RowViews.tsx's TaskRowView), a leaf: what is in it shown in its card (CardTask.tsx), and in its layout,
// opened by a click (openTask). An item in none is a task of its own: an actor's row, an app's. Within a task every
// agent is attached to every app (task_links.py). Its "+" adds to it a new agent (addToTask) or an app (addAppToTask);
// an item dragged onto another's row is put in its task (joinTask); the × in its card takes one out (takeOut). What is
// in a task, its lead and its state: tasks.ts. What a press on an item does -- shown, opened, closed -- is here too.
import { post } from "../../core/api/client";
import { closable } from "../../core/model/session";
import { appInfo, readApps } from "./apps";
import { cardDraw, hover } from "./hover-card";
import { fileItems, folderOf, folderPost } from "./folders";
import type { AddItem, AnyEvent } from "./host";
import { L, S, inPane, snap, type AppPane } from "./link";
import { CTX, renderAgents, setSaved } from "./list";
import { newerTasks } from "./seen";
import { isCoordinator, savedAs } from "./status";
import * as LK from "./tasks";
import { appFolder } from "./tree";
import type { Actor, AppItem, Gatherer, Shell, Tasks } from "./types";

export const APP_ITEM = "app:";
export const appItem = (id: string): string => `${APP_ITEM}${id}`;
export const isAppItem = (k: string | null | undefined): boolean => String(k || "").startsWith(APP_ITEM);
const named = (gname: string): Gatherer | null => S().home!.gatherers.find((x) => x.name === gname) || null;
const taskKeyOf = (gname: string, id: number) => `${gname}\u0000t${id}`;
// a change's answer ({tasks, now}): its tasks taken, those of every gatherer (seen.ts's newerTasks)
export const takeTasks = (got: unknown): void => {
  const g = got as { tasks?: Record<string, Tasks>; now?: number };
  S().home!.tasks = newerTasks(S().home!.tasks, g.tasks, g.now);
};

export async function closeSession(a: Actor): Promise<void> {
  try {
    await post("/api/stop", { session_id: a.session!.session_id });
  } catch (err) {
    L.data.setLive(`Not closed: ${(err as Error).message}`);
  }
}
export async function discardSession(g: Gatherer, a: Actor): Promise<void> {
  try {
    await post("/api/discard", { session_id: a.session!.session_id });
  } catch (err) {
    return L.data.setLive(`Not closed: ${(err as Error).message}`);
  }
  await L.data.loadHome();
  for (const p of [...L.page.panes.others]) if (L.panes.isAt([p.g, p.c], g.name, a.channel)) L.panes.closePane(p);
  if (L.panes.isAt(S().selected, g.name, a.channel) && !L.panes.isAway()) return L.shell.shownGone(a.channel);
  renderAgents();
}
// An actor closed from the list (`how`: its process closed, or it discarded): closed in the screen tabs first, as its
// tab's × or its pane's would (features/layout/panes.js's closedInTabs: alone, its tab closed if it held nothing else)
export async function closeActor(g: Gatherer, a: Actor, how: (a: Actor) => Promise<void>): Promise<void> {
  await L.panes.closedInTabs(L.panes.taskKey(g.name, a.channel), a.channel);
  await how(a);
}
// A shell's row: its close button closes its terminal, as a window's does.
export async function closeShell(s: Shell): Promise<void> {
  try {
    await post("/api/shells/close", { id: s.id });
  } catch (err) {
    L.data.setLive(`Not closed: ${(err as Error).message}`);
  }
}
// A task SAVED: every actor in it saved for later, as an actor's bookmark saves it -- the bookmark filled once every one
// is; closed, the task is then listed in its folder's saved line, not its closed one (where its first actor comes)
export async function saveTask(gname: string, id: number, save: boolean): Promise<void> {
  const g = named(gname);
  for (const a of g ? LK.taskMembers(CTX, g, id) : [])
    if (!!savedAs(CTX, gname, a) !== save) await setSaved(gname, a, save);
}
// A task CLOSED (its ×, while an actor of it runs): closed in the screen tabs first, as its tab's × would
// (features/layout/panes.js's closedInTabs: kept as it is now, its tab closed if it held nothing else), its actors'
// processes closed, as an actor's × does, and its apps put to sleep -- kept, in the task, with nothing running for them (a
// Browser's tabs closed, their pages kept: app_host.py's `sleep_instance`) -- their panels here closed first. Clicked
// again later, it opens as it was: its apps above (a Browser's tabs opened again), its actors as closed ones are,
// started again by a message.
export async function closeTask(gname: string, id: number): Promise<void> {
  const g = named(gname);
  if (!g) return;
  const k = taskKeyOf(gname, id),
    apps = LK.taskApps(CTX, g, id);
  await L.panes.closedInTabs(k);
  if (L.panes.tasksLaidOut.has(k) && L.panes.selectedTask() === k) L.panes.rememberTask(k); // shown: opened again as it is now
  L.panes.tasksLaidOut.delete(k); // its row clicked next, even while shown: laid out again, its apps back
  for (const p of [...L.page.panes.apps]) if (apps.some((o) => o.id === p.instance.id)) L.panes.closeAppPane(p);
  await Promise.all(
    LK.taskMembers(CTX, g, id)
      .filter((a) => closable(a, snap()))
      .map(closeSession),
  );
  await Promise.all(
    apps.map((o) =>
      post("/api/apps/sleep", { gatherer: gname, instance: o.id }).catch((e: Error) =>
        L.panes.paneNote(`${o.app.label}: ${e.message}`),
      ),
    ),
  );
  await L.data.loadHome();
  renderAgents();
}
type Ev = AnyEvent | Record<string, never> | null;
const besideKey = (ev: Ev) => {
  const e = ev as { ctrlKey?: boolean; metaKey?: boolean } | null;
  return !!e && !!(e.ctrlKey || e.metaKey);
};
// An app SELECTED, as an actor is (features/layout/panes.js's selectAppPane): its task entered first, if another is
// shown -- as a click on that task would; one of apps only, its apps alone shown (enterAppTask) -- its panel shown
// (opened, if it was not) and selected. ⌘/Ctrl: no task entered, its panel added beside the ones shown.
export async function selectApp(gname: string, o: AppItem, ev: Ev = null): Promise<void> {
  if (!S().home!.gatherers.some((x) => x.name === gname)) return;
  const P = L.panes;
  const there = await P.viaTabs(P.taskKey(gname, appItem(o.id)), ev, appItem(o.id)); // where its task is open
  const g = named(gname);
  if (!g) return;
  if (there || !(besideKey(ev) && !snap())) {
    const k = P.taskKey(gname, appItem(o.id))!;
    if (P.selectedTask() !== k) {
      const id = LK.appTaskOf(CTX, gname, o.id),
        lead = id === null ? null : LK.taskLead(CTX, g, id);
      if (lead) await openTask(gname, id!);
      else P.enterAppTask(gname, k);
      await P.taskAppsOpening;
    }
  }
  let p: AppPane | undefined = L.page.panes.apps.find((q) => q.instance.id === o.id);
  if (p)
    p = P.showAppPanel(o.app, p.instance); // (one held out of sight: shown)
  else {
    const inst = await L.appHost.instanceOf(o.app.name, gname, o.id).catch(() => null);
    if (!inst) {
      P.paneNote(`${o.app.label}: closed`);
      void readApps(gname, true);
      return;
    }
    p = P.showAppPanel(o.app, inst);
  }
  P.selectAppPane(p);
}
// an app closed: closed in the screen tabs first (features/layout/panes.js's closedInTabs: one in no task, its tab closed
// if it held nothing else), its instance closed (its agents detached, out of its task), its panel gone
export async function closeApp(gname: string, o: AppItem): Promise<void> {
  await L.panes.closedInTabs(L.panes.taskKey(gname, appItem(o.id)), appItem(o.id));
  try {
    await post("/api/apps/close", { gatherer: gname, instance: o.id });
  } catch (e) {
    L.panes.paneNote(`Close ${o.app.label}: ${(e as Error).message}`);
    return;
  }
  L.panes.appClosed(o.id);
  await L.data.loadHome();
  void readApps(gname, true);
  renderAgents();
}
// A task opened: shown as it was left (features/layout/panes.js's enterTask and rememberTask) -- `focus`, else the one in
// focus then, else its lead, in the pane in focus -- or, never left, its actors not closed side by side, its apps above.
// The task shown already: as it is (an actor's pane closed in it stays closed) -- but one shown by chance, never laid out
// in this page (as the page opened on one of its actors), laid out as at first; one whose actor is out of sight in this
// page's pane with nothing else of it shown (its pane and panels closed), laid out again as it was left. One of apps
// only: its apps alone (enterAppTask); one left with its actor's pane closed by the reader (panes.js's closeHerePane),
// its apps alone, that actor out of sight in this page's pane (`shut`) till it is asked for. ⌘/Ctrl: the whole task
// beside the one shown (panes.js's openTaskBeside).
export async function openTask(gname: string, id: number, focus: string | null = null, ev: Ev = null): Promise<void> {
  if (!S().home!.gatherers.some((x) => x.name === gname)) return;
  const P = L.panes;
  const there = await P.viaTabs(taskKeyOf(gname, id), ev); // where it is open
  const g = named(gname);
  if (!g) return;
  const k = taskKeyOf(gname, id),
    sel = P.focusedActor(),
    was = P.taskLayout(k);
  const wait = !(ev && (ev as { inTabs?: boolean }).inTabs); // a tab being shown (panes.js's enterTasks): its actor's Chat not waited on
  const ok = (c: string | null | undefined) => !!c && LK.taskActors(CTX, g, id).some((a) => a.channel === c);
  const mine = !P.appsOnlyKey() && !!sel && P.taskKey(sel[0], sel[1]) === k; // its actor in the pane in focus
  const blank = mine && P.isAway() && !P.shownPanels().some((s) => s.key === k); // ... out of sight, nothing else of it shown
  if (blank) P.tasksLaidOut.delete(k); // laid out again, as it was left (enterTask)
  const laid = mine && !blank && P.tasksLaidOut.has(k); // shown already, laid out: as it is
  const shut =
    !focus && !blank && !laid && was && ok(was.shut) && !was.actors.some(ok) && (was.apps || []).length
      ? was.shut!
      : null;
  // as it was left: its panes in their order (the first in this page's own), the one in focus then in focus again
  const first =
    shut ||
    focus ||
    (was && ok(was.actors[0]) ? was.actors[0] : null) ||
    (was && ok(was.focus) ? was.focus! : null) ||
    (LK.taskLead(CTX, g, id) || ({} as Partial<Actor>)).channel;
  if (!first) {
    // apps only
    if (P.selectedTask() === k) return;
    P.enterAppTask(gname, k);
    await P.taskAppsOpening;
    const apps = L.page.panes.apps;
    const p =
      apps.find((q) => !q.held && q.instance.id === (was && was.focusApp)) ||
      apps.find((q) => !q.held && P.appPaneTask(q) === k);
    if (p) P.selectAppPane(p);
    return;
  }
  if (!there && besideKey(ev) && !snap()) return P.openTaskBeside(gname, k, first); // the whole task, beside
  if (mine && !blank && (focus || laid)) {
    // shown already, laid out: as it is -- `focus`, if asked for, shown in the pane in focus
    if (focus) await P.show(gname, focus, null, wait);
    return;
  }
  // as it was left, in place of what is shown -- or, shown by chance (as the page opened on it), laid out now: one plan
  // (panes.js's openTaskHere), the actor in focus then in focus again
  await P.openTaskHere(k, focus, wait);
  if (!focus && was && (was.focusApp || shut)) {
    // an app selected in it when it was left: selected again (its actor's pane closed: one of its apps)
    await P.taskAppsOpening;
    const apps = L.page.panes.apps;
    const p =
      apps.find((q) => q.instance.id === was.focusApp && !q.held) ||
      (shut ? apps.find((q) => !q.held && P.appPaneTask(q) === k) : null);
    if (p) P.selectAppPane(p);
  }
}
// "+" on an item's row, a task's (on its first item), and in a task's card: something added to the item's task -- a new
// agent on a harness picked (addToTask), or an app, as adding it does (onTask): put in the task (addAppToTask), or opened
// at the item's directory beside it (openAppAt) -- from its menu. addInfo: its menu's key and title, none (null) where
// nothing can be added; addItems: its menu.
function addWhat(g: Gatherer, k: string) {
  const a = isAppItem(k) ? null : LK.actorOf(g, k),
    o = a ? null : appInfo(g.name, k.slice(APP_ITEM.length));
  if ((!a && !o) || (a && isCoordinator(a)) || (o && LK.groupApp(o.app))) return null;
  const hs = snap() ? [] : L.panes.startable();
  const apps = snap() || inPane() ? [] : L.appHost.found().filter((app) => LK.onTask(app) !== "no" && !app.failed);
  return hs.length || apps.length ? { a, o, hs, apps } : null;
}
// its menu's key: its own, apart from the list's "+" for the same item, which the menu would hang from otherwise
const addKey = (g: Gatherer, k: string, label: string | null) => `${label ? "card-" : ""}task-add:${g.name}/${k}`;
export function addInfo(g: Gatherer, k: string, label: string | null = null): { key: string; title: string } | null {
  const w = addWhat(g, k);
  return (
    w && {
      key: addKey(g, k, label),
      title: `Add ${[w.hs.length ? "an agent" : null, w.apps.length ? "an app" : null].filter(Boolean).join(" or ")} to this task`,
    }
  );
}
// what its menu says: where it adds to, and its items -- drawn by RowViews.tsx's AddMenu in the list, CardTask.tsx's
// AddAct in a task's card
export function addItems(g: Gatherer, k: string): { where: string; items: AddItem[] } | null {
  const w = addWhat(g, k);
  if (!w) return null;
  const { a, o, hs, apps } = w,
    id = LK.itemTaskOf(CTX, g, k);
  const where =
    id !== null ? LK.taskName(CTX, g, LK.taskById(CTX, g.name, id)!) : a ? LK.actorTitle(a) : LK.appTitle(o!);
  const h = L.helpers;
  return {
    where,
    items: [
      ...hs.map((hn) => ({
        mark: h.harnessBadge(hn),
        text: h.harnessName(hn),
        note: "a new agent in the same directory",
        run: () => void addToTask(g.name, k, hn),
      })),
      ...apps.map((app) =>
        LK.onTask(app) === "folder"
          ? {
              icon: "app",
              mark: app.mark ? L.panes.appMarkImg(app) : null,
              text: app.label,
              note: "opened at its directory, beside the task",
              run: () => void openAppAt(g.name, k, app.name),
            }
          : {
              icon: "app",
              mark: app.mark ? L.panes.appMarkImg(app) : null,
              text: app.label,
              note: "an app the task's agents can use",
              run: () => void addAppToTask(g.name, k, app.name),
            },
      ),
    ],
  };
}
// the task of item `k` shown, if another is: entered as a click on it would -- where it is open, else in a tab of its own
export async function showItemsTask(g: Gatherer, k: string): Promise<void> {
  if (L.panes.selectedTask() === L.panes.taskKey(g.name, k)) return;
  const id = LK.itemTaskOf(CTX, g, k),
    a = isAppItem(k) ? null : LK.actorOf(g, k);
  if (a) await (id === null ? L.panes.pick(g.name, a.channel, {}) : openTask(g.name, id, null, {}));
  else {
    const o = appInfo(g.name, k.slice(APP_ITEM.length));
    if (o) await selectApp(g.name, o, {});
  }
}
// The task shown, its key changed by a change of the tasks (a lone item made one with others, or one joined): laid out
// still, and still the one entered, under its new key
export function retask(was: string | null): void {
  const now = L.panes.selectedTask();
  if (!was || !now || was === now) return;
  if (L.panes.tasksLaidOut.has(was)) L.panes.tasksLaidOut.add(now);
  L.panes.rekeyTask(was, now);
}
const itemOf = (gname: string, k: string) => {
  const g = named(gname);
  const a = g && !isAppItem(k) ? LK.actorOf(g, k) : null,
    o = g && !a ? appInfo(gname, k.slice(APP_ITEM.length)) : null;
  return { g, a, o };
};
async function addToTask(gname: string, k: string, harness: string): Promise<void> {
  const { g, a, o } = itemOf(gname, k);
  if (!g || (!a && !o)) return;
  const cwd = (a ? L.panes.cwdOf(a) : o!.folder) || L.panes.startCwd(g);
  if (!cwd) return L.panes.paneNote("Can't add an agent: no directory to start it in");
  const fid = a ? folderOf(gname, a) : appFolder(CTX, gname, o!.id),
    to = LK.keptAs(CTX, g, k);
  await showItemsTask(g, k);
  const was = L.panes.selectedTask();
  try {
    // started as any actor is (startSession): listed, shown in Chat -- beside the one it is added to -- its task joined
    // and its folder taken first
    await L.panes.startSession(gname, cwd, harness, async (s) => {
      takeTasks(await post("/api/tasks", { gatherer: gname, do: "add", to, items: [s.session_id] }));
      if (fid !== null)
        await folderPost(gname, { do: "file", channels: [s.session_id], folder: fid }, (tree) => {
          tree.filed[s.session_id] = fid;
        });
      retask(was);
      void readApps(gname, true);
    });
  } catch (e) {
    L.panes.paneNote(`Add an agent: ${(e as Error).message}`);
  }
}
// An app added to an item's task: an instance of it (for the directory it works in, where the app has one per folder),
// put in the task -- every agent of it attached to it (task_links.py) -- its panel above them, selected; the task shown
// first, if another is. Agents attached so are given the app's tools the next time they start (tool_gateway.py: at
// launch).
async function addAppToTask(gname: string, k: string, name: string): Promise<void> {
  const { g, a, o } = itemOf(gname, k);
  const app = a || o ? L.appHost.named(name) : null;
  if (!g || !app) return;
  await showItemsTask(g, k);
  const was = L.panes.selectedTask();
  try {
    const inst = await L.appHost.open(name, gname, (a ? L.panes.cwdOf(a) : o!.folder) || null);
    if (!o || inst.id !== o.id)
      takeTasks(
        await post("/api/tasks", { gatherer: gname, do: "add", to: LK.keptAs(CTX, g, k), items: [appItem(inst.id)] }),
      );
    await readApps(gname, true);
    const had = L.page.panes.apps.some((p) => p.instance.id === inst.id);
    const there = L.panes.showAppPanel(app, inst);
    if (had) there.panel.refresh();
    retask(was);
    L.panes.selectAppPane(there); // added: selected, as an actor started is shown
  } catch (e) {
    L.panes.paneNote(`${app.label}: ${(e as Error).message}`);
  }
  renderAgents();
}
// An app added to an item that it doesn't join (onTask "folder": the Files app's): opened at the item's directory -- an
// actor's working directory, an app's folder -- the one open there already, if the app has any number (`reuse`), its
// panel shown above and selected; put in no task, no agent attached to it. The item's task shown first, if another is.
// Not kept with the task's layout yet: the task left and entered again, it is not opened with it.
async function openAppAt(gname: string, k: string, name: string): Promise<void> {
  const { g, a, o } = itemOf(gname, k);
  const app = a || o ? L.appHost.named(name) : null;
  if (!g || !app) return;
  const folder = (a ? L.panes.cwdOf(a) : o!.folder) || L.panes.startCwd(g);
  if (!folder) return L.panes.paneNote(`${app.label}: no directory to open it at`);
  await showItemsTask(g, k);
  try {
    const inst = await L.appHost.open(name, gname, folder, null, true);
    await readApps(gname, true);
    L.panes.selectAppPane(L.panes.showAppPanel(app, inst)); // (through the layout model, as addAppToTask's)
  } catch (e) {
    L.panes.paneNote(`${app.label}: ${(e as Error).message}`);
  }
  renderAgents();
}
// An item taken out of its task: a task of its own again (the task gone, if one item is left in it) -- detached from the
// task's others (task_links.py)
export async function takeOut(gname: string, k: string): Promise<void> {
  const g = named(gname);
  if (!g || LK.itemTaskOf(CTX, g, k) === null) return;
  try {
    takeTasks(await post("/api/tasks", { gatherer: gname, do: "out", items: [LK.keptAs(CTX, g, k)] }));
  } catch (e) {
    L.panes.paneNote(`Take it out of the task: ${(e as Error).message}`);
  }
  void readApps(gname, true);
  renderAgents();
  if (hover.node && !hover.node.hidden) cardDraw();
}
// Items put in item `k`'s task (dropped on its row): each out of its own, the task made if `k` is in none; filed where
// `k` is
export async function joinTask(gname: string, k: string, items: string[]): Promise<void> {
  const g = named(gname);
  if (!g) return;
  const was = L.panes.selectedTask(),
    a = isAppItem(k) ? null : LK.actorOf(g, k);
  const fid = a ? folderOf(gname, a) : appFolder(CTX, gname, k.slice(APP_ITEM.length));
  try {
    takeTasks(
      await post("/api/tasks", {
        gatherer: gname,
        do: "add",
        to: LK.keptAs(CTX, g, k),
        items: items.map((c) => LK.keptAs(CTX, g, c)),
      }),
    );
  } catch (e) {
    L.panes.paneNote(`Put in the task: ${(e as Error).message}`);
    return;
  }
  const away = items.filter(
    (c) =>
      (isAppItem(c)
        ? appFolder(CTX, gname, c.slice(APP_ITEM.length))
        : ((m) => (m ? folderOf(gname, m) : fid))(LK.actorOf(g, c))) !== fid,
  );
  if (away.length) await fileItems(gname, away, fid);
  retask(was);
  void readApps(gname, true);
  renderAgents();
}
