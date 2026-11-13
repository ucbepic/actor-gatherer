// ------------------------------------------------------------------ start
document.getElementById("pause").addEventListener("click", async (ev) => {
  state.paused = !state.paused;
  const b = ev.currentTarget;
  b.textContent = state.paused ? "Resume" : "Pause";
  b.title = state.paused ? "Update this page again" : "Stop updating this page; the agents and the server go on";
  if (!state.paused) await refresh(true);
  connect();
  if (state.paused) render();
});
if (SNAPSHOT) document.getElementById("pause").style.display = "none";
let resizeTimer = null;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => document.getElementById("size-chart") && state.agent && state.agent.reads && drawCharts(), 150); });
$("pane-close").addEventListener("click", () => PANE ? PANE.close(window) : closeHere());
if (PANE) document.addEventListener("pointerdown", () => PANE.focus(window), true);
else {
  $("pane-here").addEventListener("pointerdown", () => focusPane(panes.here), true);
  watchTop(document.querySelector("header .brand"), "brand");
  watchTop(document.getElementById("pane-head"), "here");
}
refresh(true).then(connect).then(() => { if (PANE) paneReady(); }).then(loadOwnViews);
if (!PANE && !SNAPSHOT) {
  startPlacing();                                    // the work area placed from now on (07-panes.js's placeWork)
  window.agNext.apps.load().then(() => restoreAppPanes()).then(() => {
    if (state.selected) showActorsApp(...state.selected);   // an app's actor selected before the apps were known
    if (state.home) renderAgents();
    topChanged();                                    // the panes' buttons for the apps now known, the row as restored
  });
}
if (!SNAPSHOT) setInterval(() => { if (!state.paused) render(); }, AGO_MS);
