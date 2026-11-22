import { SNAPSHOT, panes, state } from "../../core/page/state.js";
import { harnessInfo } from "../../core/page/helpers.js";
import { setAbout } from "../page/data.js";
import { aimStart, renderAgents } from "../list/list";
import {
  appClosed, openAppTab, startable, startCwd, startWithApp, workPlacer,
} from "../layout/panes.js";
import { START_HARNESS_KEY, keptValue, ntGroup, realGroups, startPlace } from "../layout/new-tab.js";
import { topChanged } from "../layout/top.js";
import { draw as drawCatalog } from "./catalog";
import * as appHost from "./host";

// THE APPS PAGE (features/apps/catalog.ts): what a tab showing nothing shows in place of its new-tab page when it is the
// Apps page's (layout/tabs.ts's `page`) -- opened from the settings panel's "Manage apps", under Groups (openAppsPage),
// and from a new tab's "Apps…". What that page asks of this one: an app opened where things start (features/layout/new-tab.js's start place: in its group,
// in a tab of its own, as from a group's menu), and -- the apps installed having changed -- them read again: the panels
// of those gone closed, the list drawn again (an uninstalled app's rows go with it: appOf finds no app for them).
function openAppsPage() {
  if (SNAPSHOT || !workPlacer) return;
  setAbout(false);
  void workPlacer.tabs.openPage("apps");
}
function drawAppsPage(box) {
  box.classList.remove("nt");
  drawCatalog(box, { open: appsPageOpen, changed: appsChanged });
}
// An app opened from the page: the way the reader chose there (`withAgent`), as a group's "+ ⋯" menu opens it
// (features/layout/panes.js's opensWithAgent) -- on its own when no harness here can give an agent its tools.
async function appsPageOpen(a, withAgent = false) {
  const app = appHost.named(a.name);
  if (!app) throw new Error("it isn't loaded yet. Reload the page.");
  const p = startPlace(), g = p && !p.alone ? ntGroup(p) : realGroups()[0];
  if (!g) throw new Error("make a group first");
  const cwd = startCwd(g) || state.home.cwd || null, folder = p && !p.alone ? p.folder : null;
  const tooled = startable().filter((h) => (harnessInfo(h) || {}).mcp);   // can give an agent its tools
  if (withAgent && app.agent && app.agent.offered && tooled.length) {   // with an agent of its own: started with it
    const kept = keptValue(START_HARNESS_KEY);
    aimStart(g.name, folder);
    return startWithApp(g.name, cwd, app.name, tooled.includes(kept) ? kept : tooled[0]);
  }
  return openAppTab(g.name, app.name, cwd);
}
async function appsChanged() {
  await appHost.load();
  for (const p of panes.apps.filter((q) => !appHost.named(q.app.name))) appClosed(p.instance.id);   // its app
  topChanged(); renderAgents();                                                       // uninstalled: gone, even held
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  if (!SNAPSHOT) {
    document.getElementById("apps-cfg").hidden = false;
    document.getElementById("manage-apps").addEventListener("click", openAppsPage);
  }
}
export { appsChanged, drawAppsPage, openAppsPage };
