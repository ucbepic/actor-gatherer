// THE PANES AND THE TASKS SHOWN, as the page's other modules reach them: what each of the layout's modules gives them,
// under the names they import (the old page's modules import this module; the list reads it through its link,
// features/list/link.ts's PanesPart), and what the layout does as the page starts. Where each part is:
// - open.ts: what is open -- the panes' actors, focus, the app selected, each panel's task, the page's own pane out of
//   sight; remember.ts, facts.ts: what each task was left with, and what the page knows of a task;
// - show.ts: an actor shown, in the pane in focus or beside it, through the screen tabs; enter.ts: a task entered, opened
//   beside, closed here, left alone, a tab's tasks shown -- each a plan (plan.ts) rendered by render.ts, which also makes
//   the panes beside match the layout's store;
// - work-area.ts: the work area placed (work.ts) and what it asks of the page; moves.ts, move-choices.ts: a panel moved;
//   heads.ts: the panes' heads;
// - app-panels.ts: the apps' panels; app-hooks.ts, app-said.ts: what a panel is given, an app opened; pane-links.ts,
//   link-rules.ts: links clicked in a pane;
// - starts.ts, start-rules.ts, crew.ts: what starts where; popups.ts, Pops.tsx: the drop-downs and boxes; StartBoxes.tsx:
//   the boxes' forms; new-form.ts: the list's form; Branches.tsx, branch-model.ts: an actor on a branch;
// - top.ts: a pane minimized; new-tab.ts, NewTab.tsx: a new tab's page;
// - link.ts, types.ts: what the layout takes from the page around it, filled by src/links/layout.ts.
import * as prefs from "../../core/prefs";
import { L, panes, snap } from "./link";
import * as model from "./model";
import { moveEnd, startMoves } from "./moves";
import { herePane } from "./pane";
import { startLinks } from "./pane-links";
import { pressedAway, popClosed } from "./popups";
import { startPops } from "./Pops";
import { shadow } from "./shadow";
import { startHeads } from "./heads";
import { appSelected, selectAppPane } from "./open";
import { workPlacer } from "./work-area";

export {
  actorPanes,
  appPaneTask,
  appSelected,
  appsOnlyKey,
  focusPane,
  focusedActor,
  focusedPane,
  isAt,
  isAway,
  openActors,
  paneSig,
  rekeyTask,
  retarget,
  selectAppPane,
  selectedTask,
  setAutoShown,
  shownPanels,
  taskKey,
  tasksLaidOut,
} from "./open";
export { rememberTask, taskLayout } from "./remember";
export { pick, pickBeside, show, startTabs, viaTabs } from "./show";
export { closedInTabs, enterAppTask, openTaskBeside, openTaskHere, taskAppsOpening } from "./enter";
export { closeHere, closeHerePane, closePane, paneGiven, restorePanes, savePanes } from "./render";
export { placeIfShown, startPlacing, workPlacer } from "./work-area";
export { appPanelMenu } from "./moves";
export { drawWho, paneNote, watchTop } from "./heads";
export {
  appClosed,
  appMarkNode as appMarkImg,
  appsAtWork,
  appsSelected,
  closeAppPane,
  restoreAppPanes,
  showAppPanel,
  swapAppPane,
} from "./app-panels";
export { openAppTab, showActorsApp } from "./app-hooks";
export { linkClicked } from "./pane-links";
export {
  cardStart,
  cardStartPress,
  cwdOf,
  noHarness,
  startCwd,
  startMenu,
  startSession,
  startWithApp,
  startable,
} from "./starts";
export { openCoordinator } from "./crew";
export { closePop, closePops, openPop, popButton, rowPop } from "./popups";
export { railNewBox } from "./StartBoxes";
export { newForm } from "./new-form";
export { branchChip } from "./Branches";
export { moveEnd };

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  panes.here = L.paneView.makePane(herePane(), true, { view: prefs.text(L.views.CHAT_VIEW_KEY) || "files" });
  startPops({ icon: (icon, size) => L.helpers.strokeIcon(L.helpers.ICONS[icon] || icon, size), closed: popClosed });
  shadow.update(model.focusOn, null, true); // (focus: this page's own pane)
  if (!snap()) {
    // the focus gone into an app's frame
    window.addEventListener("blur", () =>
      setTimeout(() => {
        if (document.activeElement && document.activeElement.localName === "iframe") pressedAway(); // (any frame's)
        const p = panes.apps.find((q) => q.frame === document.activeElement);
        if (p && appSelected() !== p.instance.id) selectAppPane(p);
      }, 0),
    );
    try {
      const app = (window as { agApp?: { onPressed?: (f: () => void) => void } }).agApp;
      if (app && app.onPressed) app.onPressed(pressedAway);
    } catch {
      /* not the app */
    }
    // ⌃Tab (⌃⇧Tab: back) in the ag app -- a browser keeps those keys for its own tabs: the next screen tab shown
    document.addEventListener(
      "keydown",
      (ev) => {
        if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.key !== "Tab") return;
        let app = false;
        try {
          app = !!(window.top as { agApp?: unknown } | null)?.agApp;
        } catch {
          /* not ours */
        }
        if (!app) return;
        ev.preventDefault();
        void workPlacer?.tabs.step(ev.shiftKey ? -1 : 1);
      },
      true,
    );
    startMoves();
  }
  startHeads();
  panes.apps = [];
  if (!snap()) startLinks();
}
