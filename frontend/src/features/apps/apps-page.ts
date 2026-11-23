// THE APPS PAGE (features/apps/catalog.ts): what a tab showing nothing shows in place of its new-tab page when it is the
// Apps page's (layout/tabs.ts's `page`) -- opened from the settings panel's "Manage apps", under Groups (openAppsPage),
// and from a new tab's "Apps…". What that page asks of this one: an app opened where things start (features/layout/
// new-tab.js's start place: in its group, in a tab of its own, as from a group's menu), and -- the apps installed having
// changed -- them read again: the panels of those gone closed, the list drawn again (an uninstalled app's rows go with
// it: appOf finds no app for them). What it takes of the page around it: page-link.ts.
import { SNAPSHOT, panes, state } from "../../core/page/state";
import { harnessInfo } from "../../core/page/harness";
import { draw as drawCatalog, type CatalogApp } from "./catalog";
import * as appHost from "./host";
import { link } from "./page-link";

/** The Apps page opened, in a tab of its own (the settings panel closed). */
export function openAppsPage(): void {
  const placer = link.workPlacer();
  if (SNAPSHOT || !placer) return;
  link.setAbout(false);
  void placer.tabs.openPage("apps");
}
/** The Apps page drawn into a tab's box. */
export function drawAppsPage(box: HTMLElement): void {
  box.classList.remove("nt");
  drawCatalog(box, { open: appsPageOpen, changed: appsChanged });
}
/** An app opened from the page: the way the reader chose there (`withAgent`), as a group's "+ ⋯" menu opens it
 * (features/layout/panes.js's opensWithAgent) -- on its own when no harness here can give an agent its tools. */
async function appsPageOpen(a: Pick<CatalogApp, "name">, withAgent = false): Promise<void> {
  const app = appHost.named(a.name);
  if (!app) throw new Error("it isn't loaded yet. Reload the page.");
  const p = link.startPlace(),
    g = p && !p.alone ? link.ntGroup(p) : link.realGroups()[0];
  if (!g) throw new Error("make a group first");
  const cwd = link.startCwd(g) || (state.home && state.home.cwd) || null,
    folder = p && !p.alone ? (p.folder as number | null) : null;
  const tooled = link.startable().filter((h) => (harnessInfo(h) || {}).mcp); // can give an agent its tools
  if (withAgent && app.agent && app.agent.offered && tooled.length) {
    // with an agent of its own: started with it
    const kept = link.startHarness();
    link.aimStart(g.name, folder);
    return link.startWithApp(g.name, cwd, app.name, tooled.includes(kept as string) ? (kept as string) : tooled[0]);
  }
  return link.openAppTab(g.name, app.name, cwd);
}
/** The apps installed read again: the panels of those gone closed (even held), the panes' buttons and the list drawn
 * again. */
export async function appsChanged(): Promise<void> {
  await appHost.load();
  for (const p of panes.apps.filter((q) => !appHost.named(q.app.name))) link.appClosed(p.instance.id);
  link.topChanged();
  link.renderAgents();
}
/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  if (!SNAPSHOT) {
    (document.getElementById("apps-cfg") as HTMLElement).hidden = false;
    (document.getElementById("manage-apps") as HTMLElement).addEventListener("click", openAppsPage);
  }
}
