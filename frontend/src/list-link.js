// What the list (features/list/, TypeScript) takes from the old page's modules and from other features, which a
// feature's TypeScript may not import (ag_dashboard/DESIGN.md's Rules): each module's namespace, handed over once every
// module is loaded and before any starts (page.js), so a value one of them changes later is read as it is then. What
// the list reads of each is typed in features/list/link.ts. This shrinks as those modules move.
import * as state from "./core/page/state";
import * as helpers from "./core/page/helpers";
import * as code from "./core/page/code";
import * as data from "./features/page/data";
import * as panes from "./features/layout/panes";
import * as newTab from "./features/layout/new-tab";
import * as chat from "./features/chat/chat";
import * as files from "./features/chat/files-view";
import * as shell from "./features/terminal/shell";
import * as terminal from "./features/terminal/terminal";
import * as panel from "./features/settings/panel";
import * as settings from "./features/settings/store";
import * as notify from "./features/notify/notify";
import * as history from "./features/history/history";
import * as appActors from "./features/apps/app-actors";
import * as appsPage from "./features/apps/apps-page";
import * as appHost from "./features/apps/host";
import * as catalog from "./features/apps/catalog";
import * as native from "./features/apps/native";
import { setListPage } from "./features/list/link";

export function linkList() {
  setListPage({
    page: state,
    helpers,
    code,
    data,
    panes,
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
