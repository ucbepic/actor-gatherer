// What the list (features/list/) takes from the page's core and from other features, which a feature may not import
// (ag_dashboard/DESIGN.md's Rules): each module's namespace, handed over once every module is loaded and before any
// starts (main.ts), so a value one of them changes later is read as it is then. What the list reads of each is typed
// in features/list/link.ts, and checked here.
import * as state from "../core/page/state";
import * as helpers from "../core/page/helpers";
import * as code from "../core/page/code";
import * as data from "../features/page/data";
import * as panes from "../features/layout/panes";
import * as newTab from "../features/layout/new-tab";
import * as chat from "../features/chat/chat";
import * as files from "../features/chat/files-view";
import * as shell from "../features/terminal/shell";
import * as terminal from "../features/terminal/terminal";
import * as panel from "../features/settings/panel";
import * as settings from "../features/settings/store";
import * as notify from "../features/notify/notify";
import * as history from "../features/history/history";
import * as appActors from "../features/apps/app-actors";
import * as appsPage from "../features/apps/apps-page";
import * as appHost from "../features/apps/host";
import * as catalog from "../features/apps/catalog";
import * as native from "../features/apps/native";
import { setListPage, type ListPage, type PanesPart } from "../features/list/link";

export function linkList(): void {
  setListPage({
    // An app's panel is the layout's (features/layout/types.ts's AppPanel) in `panes.apps` and in what the panes'
    // module takes; the page's core declares only what it reads of one (core/page/types.ts's AppPane), the list what it
    // reads and hands back (its link's AppPane), and core may not name the layout's (Rule 1): the same objects, three
    // views.
    page: state as ListPage["page"],
    helpers,
    code,
    data,
    panes: panes as PanesPart,
    newTab,
    chat,
    files,
    shell,
    terminal,
    panel,
    settings,
    notify,
    history,
    appActors,
    appsPage,
    appHost,
    catalog,
    native,
  });
}
