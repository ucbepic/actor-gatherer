// The Apps page (features/apps/apps-page.ts) linked to the page around it: the settings panel, the list, the panes and
// the work area's tabs, where a new tab starts things -- page-link.ts says what it takes. The old page's modules among
// them are plain JS, read untyped (`@ts-ignore` on their imports, which does nothing once a module is TypeScript, when
// it is checked too). Called once by page.js before any module starts.
import { setAppsPageLink } from "../features/apps/page-link";
import { setAbout } from "../features/page/look";
import { aimStart } from "../features/list/folders";
import { renderAgents } from "../features/list/list";
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore -- plain JS
import * as panes from "../features/layout/panes";
// @ts-ignore -- plain JS
import * as top from "../features/layout/top";
// @ts-ignore -- plain JS
import * as newTab from "../features/layout/new-tab";
/* eslint-enable @typescript-eslint/ban-ts-comment */

/** The Apps page handed what it takes of the page around it. */
export function linkApps(): void {
  setAppsPageLink({
    setAbout,
    renderAgents,
    aimStart,
    workPlacer: () => panes.workPlacer,
    appClosed: (id) => panes.appClosed(id),
    openAppTab: (gname, app, cwd) => panes.openAppTab(gname, app, cwd),
    startWithApp: (gname, cwd, app, harness) => panes.startWithApp(gname, cwd, app, harness),
    startable: () => panes.startable(),
    startCwd: (g) => panes.startCwd(g),
    topChanged: () => top.topChanged(),
    startPlace: () => newTab.startPlace(),
    ntGroup: (p) => newTab.ntGroup(p),
    realGroups: () => newTab.realGroups(),
    startHarness: () => newTab.keptValue(newTab.START_HARNESS_KEY),
  });
}
