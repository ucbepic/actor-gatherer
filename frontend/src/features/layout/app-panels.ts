// THE APPS' PANELS (app_kit/DESIGN.md): each in the top row (where it goes, the work area's arrangement: placeWork), above
// the actors' panes at first, each panel's width its share (`size`, for a phone's width). Its frame is made by the apps'
// host (features/apps/host.ts's AppPane); what its panel asks goes through it to the dashboard's /api/apps; the actor in
// focus (appsSelected) and the theme are told to it. The panels follow the layout's store's `apps` (model.ts): what opens
// or closes one says so to the store (showAppPanel, closeAppPane, appClosed, the plans) and renderApps makes the panels
// match -- each wanted one shown, its instance known (the page's apps, or the one given) at once, in the frame that asked
// for it, else once the host gives it, if it is still wanted then (a task entered meanwhile no longer wants another's);
// each shown one no longer wanted closed, held out of sight while a tab not shown holds its task (keepForTab), or while its
// agent is at work (appNeeded).
import { isShell } from "../../core/model/keys";
import { appActor, frameHooks } from "./app-hooks";
import { keptToDrop, tabHolding } from "./kept";
import { L, panes, renderAgents, snap, state, statusOf } from "./link";
import * as model from "./model";
import {
  appPaneTask,
  appsOnlyKey,
  focusedActor,
  isAway,
  keyNow,
  markSelected,
  putAway,
  setAppsOnly,
  unselectApp,
} from "./open";
import { laying, shadowGone } from "./render";
import { shadow } from "./shadow";
import { topChanged } from "./top";
import type { Actor, AppItem, AppManifest, AppPanel, Instance } from "./types";
import { placeWork, workClosed, workPlacer } from "./work-area";

/** An app's mark, as its menus and boxes show it. */
export const appMarkNode = (a: AppManifest): HTMLElement =>
  L.helpers.el("img", {
    class: "app-mark",
    src: `/apps/mark/${encodeURIComponent(a.name)}.svg`,
    alt: "",
    draggable: "false",
  });
/** An app item's instance, as the apps' host gave the list it. */
export const instOf = (o: AppItem | null | undefined): Instance | null => (o?.inst as Instance | null) || null;
const topRowEl = () => document.getElementById("top-row")!;
/** The apps' panels' widths, and the work area placed. */
export function topLayout(): void {
  for (const p of panes.apps) p.node.style.flexGrow = String(p.size);
  placeWork();
}

/** Instance `instance` of `app` in a panel of its own, put at the top row's end (`held`: out of sight). */
export function addAppPane(app: AppManifest, instance: Instance, size = 1, held = false): AppPanel {
  const p = { app, instance, g: instance.gatherer, size, held } as AppPanel;
  p.panel = L.newPanel(app, instance, {
    ...frameHooks(),
    close: () => {
      // its panel asking (ag.close)
      workClosed(p.node);
      closeAppPane(p);
    },
  });
  p.node = p.panel.node;
  p.frame = p.panel.frame;
  p.node.hidden = held;
  topRowEl().append(p.node);
  panes.apps.push(p);
  const ak = !held && state.home ? appPaneTask(p) : null;
  if (ak) shadow.update(model.open, ak, true);
  topLayout();
  void p.panel.refresh(); // its agents, as the host has them
  topChanged();
  return p;
}
/** An app's pane shown again for `inst` -- the same instance, now of another group (the list's followMoved): its panel
 * opened anew in its place, as wide, held or not as it was; selected still, if it was (by its id). */
export function swapAppPane(p: AppPanel, inst: Instance): AppPanel | null {
  const i = panes.apps.indexOf(p);
  if (i < 0) return null;
  const was = state.home && !p.held ? appPaneTask(p) : null;
  queueMicrotask(() => shadowGone(was)); // (its key in the group it left)
  instCache.set(inst.id, inst);
  shadow.update(model.swapApp, p.instance.id, { app: p.app.name, instance: inst.id, g: inst.gatherer });
  const q = addAppPane(p.app, inst, p.size, p.held); // made at the row's end: put where p was
  q.kept = p.kept || null;
  topRowEl().insertBefore(q.node, p.node);
  panes.apps.splice(panes.apps.indexOf(q), 1);
  panes.apps.splice(i, 1, q);
  p.panel.destroy();
  p.node.remove();
  markSelected();
  topLayout();
  saveAppPanes();
  topChanged();
  return q;
}
/** A panel held out of sight shown (wanted again: renderApps), or one shown held (no longer wanted while it is needed:
 * appsAtWork). */
export function holdAppPane(p: AppPanel, held: boolean): void {
  p.held = held;
  if (!held) p.kept = null;
  if (held) unselectApp(p.instance.id);
  p.node.hidden = held;
  topLayout();
  saveAppPanes();
  topChanged();
}

/** The instances the page knows (to open a panel for at once), and those being asked of the host. */
export const instCache = new Map<string, Instance>();
const fetching = new Set<string>();
const wanted = (id: string) => (shadow.layout.apps || []).some((w) => w.instance === id);
/** The panels made to match the store's `apps`. */
export function renderApps(): void {
  if (snap()) return;
  let changed = false;
  for (const p of [...panes.apps])
    if (!p.held && !wanted(p.instance.id)) {
      dropAppPanel(p);
      changed = true;
    }
  for (const w of shadow.layout.apps || []) {
    const p = panes.apps.find((q) => q.instance.id === w.instance);
    if (p) {
      if (p.held) {
        holdAppPane(p, false);
        changed = true;
      }
      continue;
    }
    const app = L.appHost.named(w.app);
    if (!app) continue;
    const inst = instCache.get(w.instance) || instOf(L.list.appInfo(w.g, w.instance));
    if (inst) {
      addAppPane(app, inst, Number(w.size) > 0 ? Number(w.size) : 1);
      changed = true;
      continue;
    }
    if (fetching.has(w.instance)) continue;
    fetching.add(w.instance);
    void L.appHost
      .instanceOf(w.app, w.g, w.instance)
      .catch(() => null)
      .then((got) => {
        fetching.delete(w.instance);
        if (!got) {
          // closed since
          shadow.update(model.unwantApps, (x) => x.instance === w.instance);
          saveAppPanes();
          return;
        }
        instCache.set(got.id, got);
        if (wanted(got.id)) renderApps();
      });
  }
  if (changed) {
    appsOnlyLeft();
    markSelected();
    topLayout();
    saveAppPanes();
    if (state.home) renderAgents();
    topChanged();
  }
}
// its panel gone from the page (its instance stays open): held out of sight instead while a tab not shown holds its task
// (keepForTab), or while its agent is at work
function dropAppPanel(p: AppPanel): void {
  if (panes.apps.indexOf(p) < 0) return;
  const gk = state.home ? appPaneTask(p) : null;
  queueMicrotask(() => shadowGone(gk));
  if (keepForTab(p)) return; // its tab left: shown as it is when that tab is shown again
  if (appNeeded(p)) return holdAppPane(p, true); // its agent at work: its page answers its tools, out of sight
  destroyAppPanel(p);
}
function destroyAppPanel(p: AppPanel): void {
  const i = panes.apps.indexOf(p);
  if (i < 0) return;
  panes.apps.splice(i, 1);
  unselectApp(p.instance.id);
  p.panel.destroy(); // its streams go; the instance stays open
  p.node.remove();
}

// A SCREEN TAB'S APP PANELS KEPT READY (kept.ts). An app's panel no longer wanted in the tab shown whose task a tab not
// shown holds -- the tab just left, kept as it was (tabs.ts), or the tab the task was moved to -- is held out of sight,
// its frame as it is (the Browser's page, its picture, its stream; in the ag app, its native page placed again once its
// panel shows: features/apps/native.ts), not closed: that tab shown, the panel is wanted again and shown as it is
// (renderApps), with no frame to load. `p.kept`: the tab it is kept for. The panels of the KEPT_TABS tabs left latest are
// kept so, those of a tab left before them closed; a panel whose task no tab not shown holds any longer (its task closed,
// its tab closed or emptied, the task shown and not wanted) closed, unless its agent is at work.
const KEPT_TABS = 3;
const tabsLeft = new Map<string, number>(); // a tab's id -> the order its panels were last kept in (1, 2, ...)
let keptCount = 0;
const tabKeeping = (p: AppPanel): string | null => {
  if (!state.home) return null;
  const l = shadow.now();
  return tabHolding(l.tabs, l.current, appPaneTask(p), keyNow);
};
function keepForTab(p: AppPanel): boolean {
  if (snap() || !workPlacer) return false;
  const tab = tabKeeping(p);
  if (!tab) return false;
  p.kept = tab;
  tabsLeft.set(tab, ++keptCount);
  p.held = true; // (holdAppPane's, but the row laid out once: renderApps, after)
  unselectApp(p.instance.id);
  p.node.hidden = true;
  queueMicrotask(sweepKept); // (the cap: a tab left before the latest ones, its panels closed)
  return true;
}
/** On each change of the screen tabs (a tab shown, closed, a task moved or closed in one) and each panel kept -- not while
 * a tab is being shown: its kept panels are shown again only once its plan is rendered. */
export function sweepKept(): void {
  const kept = panes.apps.filter((p) => p.kept);
  if (!kept.length || !workPlacer || workPlacer.tabs.busy()) return; // (a tab being shown: swept once it is, tabs.ts)
  for (const p of kept) p.kept = tabKeeping(p) || null; // (moved to another tab meanwhile: kept for that one)
  const drop = new Set(
    keptToDrop(
      kept.map((p) => ({ id: p.instance.id, tab: p.kept ?? null })),
      tabsLeft,
      KEPT_TABS,
    ),
  );
  let gone = false;
  for (const p of kept) {
    if (!drop.has(p.instance.id)) continue;
    p.kept = null;
    if (!appNeeded(p)) {
      destroyAppPanel(p);
      gone = true;
    } // (its agent at work: held for it, as before)
  }
  const tabs = new Set(shadow.now().tabs.map((t) => t.id));
  for (const id of [...tabsLeft.keys()]) if (!tabs.has(id)) tabsLeft.delete(id);
  if (gone) {
    topLayout();
    topChanged();
  }
}

/** Instance `inst` of `app` shown above the panes (as wide as `size`, if given) -> its panel. */
export function showAppPanel(app: AppManifest, inst: Instance, size = 0): AppPanel | null {
  instCache.set(inst.id, inst);
  shadow.update(model.wantApp, { app: app.name, instance: inst.id, g: inst.gatherer, ...(size > 0 ? { size } : {}) });
  renderApps();
  return panes.apps.find((q) => q.instance.id === inst.id) || null;
}
/** One of a task's apps to show ({app, id, size?, inst?}: openTaskApps), wanted. */
export function wantTaskApp(k: { app: string; id: string; size?: number; inst?: Instance | null }, g: string): void {
  if (k.inst) instCache.set(k.id, k.inst);
  shadow.update(model.wantApp, {
    app: k.app,
    instance: k.id,
    g,
    ...(Number(k.size) > 0 ? { size: Number(k.size) } : {}),
  });
}
/** Instances closed since a task's apps were wanted: no longer wanted. */
export function appClosedSince(gone: string[]): void {
  if (gone.length) shadow.update(model.unwantApps, (w) => gone.includes(w.instance));
}
/** An app's panel closed by the reader (its × or menu, a task's tab, a group move): no longer wanted. */
export function closeAppPane(p: AppPanel): void {
  if (!panes.apps.includes(p)) return;
  shadow.update(model.unwantApps, (w) => w.instance === p.instance.id);
  if (p.held) {
    if (!appNeeded(p)) dropAppPanel(p);
  } else renderApps();
  saveAppPanes();
  if (state.home) renderAgents();
  topChanged();
}
/** Instance `id` closed, or its app gone: its panel gone, held or not. */
export function appClosed(id: string): void {
  shadow.update(model.unwantApps, (w) => w.instance === id);
  unselectApp(id);
  for (const p of panes.apps.filter((q) => q.instance.id === id)) {
    panes.apps.splice(panes.apps.indexOf(p), 1);
    p.panel.destroy();
    p.node.remove();
  }
  appsOnlyLeft();
  topLayout();
  saveAppPanes();
}
/** A task of apps only shown, its last panel gone: out of apps only -- under screen tabs the tab is left showing nothing
 * (its new-tab page), this page's own actor not brought back into it: that actor's task was left when the apps were
 * entered (it is another tab's, or ⌥ replaced it), and one task is never in two tabs. (Not while a plan is rendered: the
 * task of apps alone it shows is its own, its panels still opening.) */
export function appsOnlyLeft(): void {
  if (laying || !appsOnlyKey() || panes.apps.some((q) => !q.held)) return;
  setAppsOnly(null);
  if (workPlacer && state.selected && !isShell(state.selected[1]) && !isAway()) putAway(state.selected);
}

// An app whose panel answers tools of its own (DocWriter's documents' tools) runs while an agent attached to it is at
// work, out of sight if the reader has not opened it: the agent's calls are answered at once, as they were when the app
// was its actor's view. `appsAtWork`, on each change of the home, holds one for each such agent; one held whose agents
// are done goes.
const panelTools = (app: AppManifest) => (app.tools || []).some((t) => t.handled_by === "panel");
const agentAtWork = (a: Actor | null | undefined) => !!a && ["running", "asking"].includes(statusOf(a)[0]);
function appNeeded(p: AppPanel): boolean {
  if (!panelTools(p.app)) return false;
  return (p.panel.agents ? p.panel.agents() : []).some((c) => agentAtWork(appActor(p.instance.gatherer, c)));
}
let appsWorking = "";
/** The apps' panels told the home changed, and one held for each agent at work whose app answers tools in its panel. */
export async function appsAtWork(): Promise<void> {
  if (snap() || !state.home) return;
  for (const p of panes.apps) {
    p.panel.agentsChanged();
    p.panel.actorsChanged();
  }
  const working: [string, string][] = [];
  for (const g of state.home.gatherers) for (const a of g.agents) if (agentAtWork(a)) working.push([g.name, a.channel]);
  const sig = JSON.stringify(working);
  if (sig !== appsWorking) {
    appsWorking = sig;
    for (const [g, c] of working) {
      let held: Instance[];
      try {
        held = await L.appHost.attachedTo(g, c);
      } catch {
        continue;
      }
      for (const inst of held) {
        const app = L.appHost.named(inst.app);
        if (!app || !panelTools(app) || panes.apps.some((p) => p.instance.id === inst.id)) continue;
        addAppPane(app, inst, 1, true);
      }
    }
  }
  for (const p of [...panes.apps])
    if (p.held && !p.kept && !appNeeded(p)) {
      // its agents done: it goes (one kept for a tab: sweepKept's)
      panes.apps.splice(panes.apps.indexOf(p), 1);
      p.panel.destroy();
      p.node.remove();
    }
}
/** The panels' widths kept (the panels: the store's already). */
export function saveAppPanes(): void {
  if (snap()) return;
  for (const p of panes.apps)
    if (!p.held && wanted(p.instance.id))
      shadow.update(model.wantApp, { app: p.app.name, instance: p.instance.id, g: p.instance.gatherer, size: p.size });
  shadow.persist();
}
/** The apps' panels kept, opened again once the apps are known: those whose instance is still open; the actors below as
 * the panes kept them (restorePanes), not opened again for them. */
export function restoreAppPanes(): void {
  if (snap()) return;
  renderApps(); // the store's, as kept
  topLayout();
}
/** The agent in focus, as the apps' panels are told it: the actor of the pane in focus. */
export function appsSelection(): { gatherer: string; channel: string } | null {
  const sel = focusedActor();
  return sel && !isShell(sel[1]) ? { gatherer: sel[0], channel: sel[1] } : null;
}
export function appsSelected(): void {
  const sel = appsSelection();
  for (const p of panes.apps) p.panel.selection(sel);
}
