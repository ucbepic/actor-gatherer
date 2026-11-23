// WHAT THE APPS PAGE TAKES FROM THE PAGE AROUND IT (apps-page.ts): the panel closed, the list, the panes and the work
// area's tabs, where a new tab starts things -- which a feature's TypeScript may not import (ag_dashboard/DESIGN.md's
// Rules). src/links/apps.ts hands them over as the page starts, before any module starts.
import type { PageGatherer } from "../../core/page/types";

/** Where things start from a new tab (features/layout/new-tab.js's start place): a group and its folder, or on its own. */
export interface StartPlace {
  alone?: boolean;
  g?: string;
  folder?: number | null;
}

export interface AppsPageLink {
  /** the dashboard's panel opened or closed (features/page/look.ts) */
  setAbout(open: boolean): void;
  /** the list drawn again; a start aimed at a gatherer's folder (features/list/) */
  renderAgents(): void;
  aimStart(gname: string, folder: number | null): void;
  /** the work area's tabs: a tab opened on a page of its own (features/layout/panes.js's) */
  workPlacer(): { tabs: { openPage(page: string): unknown } } | null;
  /** an app's instance closed; an app opened in a tab of its own; one started with an agent of its own */
  appClosed(id: string): void;
  openAppTab(gname: string, app: string, cwd: string | null): Promise<void>;
  startWithApp(gname: string, cwd: string | null, app: string, harness: string): Promise<void>;
  /** the harnesses that can be started here, and where a gatherer's actors work */
  startable(): string[];
  startCwd(g: PageGatherer): string;
  /** the panes' buttons and the top row, as the apps known now say (features/layout/top.js) */
  topChanged(): void;
  /** where a new tab starts things, its group, the real groups, the harness last started with (new-tab.js's) */
  startPlace(): StartPlace | null;
  ntGroup(p: StartPlace): PageGatherer | null;
  realGroups(): PageGatherer[];
  startHarness(): unknown;
}

export let link: AppsPageLink = null as unknown as AppsPageLink;
export function setAppsPageLink(l: AppsPageLink): void {
  link = l;
}
