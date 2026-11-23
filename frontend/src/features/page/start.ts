// ------------------------------------------------------------------ start
// The page started, last of its modules: its Pause, its own pane's ×, the home and the actor loaded and drawn, the
// stream connected, the work area placed, the apps read and their panels opened again, the "ago" texts redrawn.
import { AGO_MS, SNAPSHOT, panes, state } from "../../core/page/state";
import { refresh, render } from "./data";
import { link } from "./link";
import { connect } from "./stream";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  const { layout } = link;
  $("pause").addEventListener("click", async (ev) => {
    state.paused = !state.paused;
    const b = ev.currentTarget as HTMLButtonElement;
    b.textContent = state.paused ? "Resume" : "Pause";
    b.title = state.paused ? "Resume live updates" : "Pause live updates (agents keep running)";
    if (!state.paused) await refresh(true);
    connect();
    if (state.paused) render();
  });
  if (SNAPSHOT) $("pause").style.display = "none";
  $("pane-close").addEventListener("click", () => layout.closeHerePane());
  if (SNAPSHOT) $("pane-close").hidden = true; // (a page kept as it was: nothing else placed to show)
  $("pane-here").addEventListener("pointerdown", () => layout.focusPane(panes.here), true);
  layout.watchTop($("pane-head"), "here");
  refresh(true)
    .then(connect)
    .then(() => link.chat.loadOwnViews());
  if (!SNAPSHOT) {
    layout.startPlacing(); // the work area placed from now on (features/layout/panes.js's placeWork)
    link.apps
      .load()
      .then(() => layout.restoreAppPanes())
      .then(() => {
        if (state.selected) layout.showActorsApp(...state.selected); // an app's actor selected before the apps were known
        if (state.home) link.list.renderAgents();
        layout.topChanged(); // the panes' buttons for the apps now known, the row as restored
      });
  }
  if (!SNAPSHOT)
    setInterval(() => {
      if (!state.paused) render();
    }, AGO_MS);
}
