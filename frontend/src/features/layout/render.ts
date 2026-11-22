// THE RENDERER: the page made to match a plan (plan.ts) -- the layout's store first (the tab's tasks, the panes beside,
// the apps' panels, the task of apps alone, this page's own pane out of sight or not), then the page: its own pane given
// its actor (the list's select), the panes and panels opened and closed to match (renderPanes, app-panels.ts's
// renderApps), what is in focus. And THE PANES BESIDE this page's own, which follow the store's `panes.others`: what opens
// or closes one says so to the store (show.ts's openBeside, closePane, closeHere) and renderPanes makes them match --
// each wanted one opened at its place, each open one no longer wanted gone.
import { isShell } from "../../core/model/keys";
import { renderApps } from "./app-panels";
import { NARROW, drawWho, topRow, watchTop } from "./heads";
import { isAt, L, maxPanes, panes, renderAgents, snap, state } from "./link";
import * as model from "./model";
import { newPane } from "./pane";
import {
  actorPanes,
  allPanes,
  appSelected,
  backInSight,
  focusPane,
  focusedPane,
  isAway,
  markSelected,
  openNow,
  putAway,
  selectAppPane,
  setAppsOnly,
  setTaskNow,
  shownPanels,
  taskKey,
  tasksLaidOut,
} from "./open";
import { herePlan, type Plan } from "./plan";
import { rememberTask } from "./remember";
import { shadow } from "./shadow";
import { setViewHere } from "./show";
import type { OtherPane, Pane } from "./types";
import { placeWork, workClosed } from "./work-area";

/** A plan being rendered: a task of apps alone shown by it, its panels still opening, is not left (appsOnlyLeft). */
export let laying = false;
/** `plan` rendered -> this page's own pane's actor loading, if it was given another. `firstKept`: the first task's actor
 * in this page's own pane already (the page opened on it). */
export function renderLayout(plan: Plan, firstKept = false): Promise<unknown> | null {
  laying = true;
  try {
    return layOut(plan, firstKept);
  } finally {
    laying = false;
  }
}
function layOut(plan: Plan, firstKept: boolean): Promise<unknown> | null {
  plan.order.forEach((k, i) => {
    if (i || !firstKept) shadow.update(model.open, k, i > 0);
  });
  for (const k of plan.order) tasksLaidOut.add(k);
  if (plan.order.length) setTaskNow(plan.order[0]);
  const was = shadow.layout.apps || [];
  shadow.update(
    model.keptApps,
    plan.apps.map((a) => {
      const w = was.find((x) => x.instance === a.id),
        size = Number(a.size || w?.size) || 0;
      return { app: a.app, instance: a.id, g: a.g, ...(size > 0 ? { size } : {}) };
    }),
  );
  const kept = shadow.layout.panes?.others || [];
  shadow.update((l) => ({
    ...l,
    panes: {
      ...(l.panes || { here: null }),
      others: plan.others.map((o) => {
        const k0 = kept.find((x) => x.g === o.g && x.c === o.c);
        return { ...(k0 || {}), g: o.g, c: o.c, ...(o.view ? { view: o.view } : {}), size: k0?.size || 1 };
      }),
    },
  }));
  // this page's own pane out of sight, or in sight again, before anything is placed: a panel placed in sight is put in
  // its task's arrangement (work.ts)
  const h = plan.here;
  let loading: Promise<unknown> | null = null;
  if (!h && plan.away && state.selected && !isShell(state.selected[1])) putAway(state.selected);
  if (h && h.shut) putAway([h.g, h.c], true);
  else if (h && shadow.layout.away) backInSight();
  setAppsOnly(plan.appsOnly);
  if (h) {
    if (h.size) panes.here.size = h.size;
    if (!h.keep && !isAt(state.selected, h.g, h.c)) {
      if (h.view) setViewHere(h.view);
      loading = L.modes.select(h.g, h.c);
      loading.catch(() => {});
    }
  }
  renderPanes();
  renderApps();
  const f = plan.focus;
  if (f && "app" in f) selectAppPane(panes.apps.find((q) => !q.held && q.instance.id === f.app));
  else if (f)
    focusPane(
      isAt(state.selected, f.g, f.c) ? panes.here : actorPanes().find((q) => isAt([q.g, q.c], f.g, f.c)) || panes.here,
    );
  markSelected();
  placeWork();
  if (state.home) renderAgents();
  return loading;
}

const wantedPanes = () => shadow.layout.panes?.others || [];
/** The panes beside this page's own made to match the store's: each wanted one opened at its place (its frame loaded),
 * each open one no longer wanted gone. */
export function renderPanes(): void {
  if (snap()) return;
  const want = wantedPanes();
  let changed = false;
  for (const p of [...panes.others])
    if (!want.some((o) => isAt([o.g, o.c], p.g, p.c))) {
      dropPane(p);
      changed = true;
    }
  want.forEach((o, i) => {
    if (panes.others.some((p) => isAt([p.g, p.c], o.g, o.c))) return;
    addPane(o.g, o.c, o.view || null, Math.min(i, panes.others.length), Number(o.size) || 1);
    changed = true;
  });
  if (changed) {
    layout();
    savePanes();
    L.panel.connect();
    if (state.home) renderAgents();
  }
}
/** A pane of its own for an actor (pane.ts), put at `at` among the others, and drawn: its actor's calls and view loaded
 * from the page's own (its stream: connect). Nothing else on the page is moved: an app's frame moved is a frame loaded
 * again. */
function addPane(g: string, c: string, view: string | null, at: number, size = 1): OtherPane {
  const p = L.paneView.makePane(newPane(), false, { g, c, view, size }) as OtherPane;
  p.close.addEventListener("click", () => {
    workClosed(p.node);
    closePane(p);
  });
  p.node.addEventListener("pointerdown", () => focusPane(p), true);
  p.top.draggable = true; // dragged by its head (moves.ts's MOVE_FROM)
  watchTop(p.head, p);
  document.getElementById("panes")!.insertBefore(p.node, panes.others[at] ? panes.others[at].node : null);
  panes.others.splice(at, 0, p);
  void paneGiven(p);
  return p;
}
/** Pane `p` given its actor (opened, or another actor shown in it): what it shows of the last let go of, its view drawn
 * at once ("Loading…" till what it shows has come), then its actor's calls and view loaded and drawn. */
export async function paneGiven(p: Pane): Promise<void> {
  Object.assign(p, { agent: null, agentVersion: (p.agentVersion || 0) + 1, files: null, chatSend: async () => false });
  p.drawn.who = null;
  L.mainView.drawPane(p);
  drawWho(p);
  const at = [p.g, p.c] as const;
  await Promise.all([
    L.data.loadAgent(p).catch(() => {
      p.agent = null;
    }),
    L.data.loadChat(p),
  ]);
  if (panes.others.includes(p as OtherPane) && isAt(at, p.g!, p.c)) L.mainView.drawPane(p, true);
}
/** The store told task `k` is closed here once none of its panels is left. */
export function shadowGone(k: string | null): void {
  if (k && !shownPanels().some((s) => s.key === k)) shadow.update(model.closeHere, k);
}
// its frame gone (its page, and its terminal's stream; the session stays); the focus, if it had it, to the pane before
function dropPane(p: OtherPane): void {
  const i = panes.others.indexOf(p);
  if (i < 0) return;
  queueMicrotask(() => shadowGone(state.home ? taskKey(p.g, p.c) : null));
  panes.others.splice(i, 1);
  p.node.remove();
  p.watch?.disconnect();
  topRow(p, null);
  if (focusedPane() === p) focusPane(panes.others[i - 1] || panes.here);
}
/** An actor's pane closed (its ×, its task left, a tab cleared): no longer wanted. */
export function closePane(p: OtherPane): void {
  if (!panes.others.includes(p)) return;
  shadow.update(model.unwantPanes, (o) => isAt([o.g, o.c], p.g, p.c));
  renderPanes();
}
/** This page's own pane closed: the next pane's actor -- and view -- moves into it, its frame gone (herePlan). */
export async function closeHere(): Promise<unknown> {
  if (!actorPanes().length) return;
  return renderLayout(herePlan(openNow()));
}
/** This page's own pane closed by its × -- its head's, its Chat bar's, its minimized box's -- as an app's panel's ×
 * closes it: out of its task's tab shown (workClosed); the next pane's actor moved into it, or, none, it out of sight
 * (away) and what else is shown taking its room (nothing: the tab's new-tab page) -- an app of its task selected. Its
 * actor, or terminal, goes on; a click on it in the list shows it again. Its task remembered so (rememberTask's `shut`):
 * left and opened again, its apps alone. At a phone's width, none placed, there is nothing to show instead: it stays. */
export async function closeHerePane(): Promise<unknown> {
  if (!state.selected || isAway()) return;
  const hk = taskKey(...state.selected);
  queueMicrotask(() => shadowGone(hk));
  if (actorPanes().length) {
    workClosed(panes.here.node);
    return closeHere();
  }
  if (NARROW.matches) return;
  workClosed(panes.here.node);
  const k = taskKey(...state.selected);
  void renderLayout(herePlan(openNow())); // out of sight, closed by the reader; an app of its task selected
  if (k && tasksLaidOut.has(k)) rememberTask(k);
}
/** The panes' widths (each its share, `size`), which is in focus, and whether the page is split at all: split, each
 * pane's head says whose it is, and has its ×. Placed so (placeWork). */
export function layout(): void {
  const split = panes.others.length > 0;
  document.getElementById("panes")!.classList.toggle("split", split);
  for (const p of allPanes()) {
    p.node.style.flexGrow = split ? String(p.size) : "";
    p.node.classList.toggle("focused", p === focusedPane() && !appSelected());
  }
  placeWork();
  for (const p of allPanes()) {
    p.drawn.who = null;
    drawWho(p);
  }
}
/** Which panes are open, their views and widths, and the one in focus, kept in this browser (the store's `panes`). */
export function savePanes(): void {
  if (snap()) return;
  shadow.update(
    model.panesNoted,
    state.selected,
    panes.here.size,
    panes.others.indexOf(focusedPane() as OtherPane),
    (o) => {
      const p = panes.others.find((q) => isAt([q.g, q.c], o.g, o.c));
      return p ? { view: p.view || undefined, size: p.size } : null;
    },
  );
  shadow.persist();
}
/** The panes kept, opened again once the home is known: those whose actors are still in it. */
export function restorePanes(): void {
  panes.checked = true;
  if (snap() || !state.home) return;
  const kept = shadow.now().panes;
  if (!kept || !Array.isArray(kept.others) || !kept.others.length) return; // none beside: the tab's tasks say (tabs.ts's
  // start), its own pane closed staying so
  const home = state.home;
  const exists = (g: string, c: string) =>
    isShell(c)
      ? (home.shells || []).some((s) => s.id === c && s.gatherer === g)
      : home.gatherers.some((x) => x.name === g && x.agents.some((a) => a.channel === c));
  if (!state.selected && Array.isArray(kept.here) && exists(...kept.here)) state.selected = kept.here;
  if (!state.selected) return;
  panes.here.size = Number(kept.size) || 1;
  let room = maxPanes() - 1; // those still in the home, not this page's own, as many as fit
  shadow.update(model.unwantPanes, (o) => !o || !exists(o.g, o.c) || isAt(state.selected, o.g, o.c) || room-- <= 0);
  renderPanes();
  focusPane(panes.others[kept.focus ?? -1] || panes.here);
  layout();
}
