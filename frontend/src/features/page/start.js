import { AGO_MS, PANE, SNAPSHOT, panes, state } from "../../core/page/state.js";
import { refresh, render } from "./data.js";
import { $, connect } from "../settings/panel.js";
import { renderAgents } from "../list/list.js";
import {
  closeHerePane, focusPane, paneReady, restoreAppPanes, showActorsApp, startPlacing, watchTop,
} from "../layout/panes.js";
import { topChanged } from "../layout/top.js";
import { loadOwnViews } from "../chat/own-views.js";
import * as appHost from "../apps/host";

// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  // ------------------------------------------------------------------ start
  document.getElementById("pause").addEventListener("click", async (ev) => {
    state.paused = !state.paused;
    const b = ev.currentTarget;
    b.textContent = state.paused ? "Resume" : "Pause";
    b.title = state.paused ? "Resume live updates" : "Pause live updates (agents keep running)";
    if (!state.paused) await refresh(true);
    connect();
    if (state.paused) render();
  });
  if (SNAPSHOT) document.getElementById("pause").style.display = "none";
  $("pane-close").addEventListener("click", () => (PANE ? PANE.close(window) : closeHerePane()));
  if (SNAPSHOT) $("pane-close").hidden = true;            // (a page kept as it was: nothing else placed to show)
  if (PANE) document.addEventListener("pointerdown", () => PANE.focus(window), true);
  else {
    $("pane-here").addEventListener("pointerdown", () => focusPane(panes.here), true);
    watchTop(document.getElementById("pane-head"), "here");
  }
  refresh(true).then(connect).then(() => { if (PANE) paneReady(); }).then(loadOwnViews);
  if (!PANE && !SNAPSHOT) {
    startPlacing();                                    // the work area placed from now on (features/layout/panes.js's placeWork)
    appHost.load().then(() => restoreAppPanes()).then(() => {
      if (state.selected) showActorsApp(...state.selected);   // an app's actor selected before the apps were known
      if (state.home) renderAgents();
      topChanged();                                    // the panes' buttons for the apps now known, the row as restored
    });
  }
  if (!SNAPSHOT) setInterval(() => { if (!state.paused) render(); }, AGO_MS);
}
