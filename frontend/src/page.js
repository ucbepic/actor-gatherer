// The page's script, as page.html had it: its sections, modules now (core/page/, features/), loaded and then started
// in the order they ran as one script -- each module's start() what it did as it loaded (its listeners, what it set up
// and drew at once), so that happens in the same order as before, once every module is there to be called. A module
// itself only declares as it loads: the page's state (core/page/state.js) is the one that runs as it loads, first.
import "./core/page/state.js";
import "./core/page/helpers.js";
import { start as startPageCode } from "./core/page/code.js";
import { start as startPageData } from "./features/page/data.js";
import { start as startSettingsPanel } from "./features/settings/panel.js";
import { start as startListSeen } from "./features/list/seen";
import { start as startListList } from "./features/list/list";
import { start as startListDrag } from "./features/list/drag";
import { start as startListGathererFolders } from "./features/list/gatherer-folders";
import { start as startListManage } from "./features/list/manage";
import { start as startListModes } from "./features/list/modes";
import { start as startLayoutPanes } from "./features/layout/panes.js";
import { start as startLayoutNewTab } from "./features/layout/new-tab.js";
import { start as startAppsAppsPage } from "./features/apps/apps-page.js";
import { start as startNotifyNotify } from "./features/notify/notify.js";
import { start as startPageMainView } from "./features/page/main-view.js";
import { start as startChatViews } from "./features/chat/views.js";
import { start as startTerminalTerminal } from "./features/terminal/terminal.js";
import { start as startChatFilesView } from "./features/chat/files-view.js";
import { start as startHistoryHistory } from "./features/history/history.js";
import { start as startLayoutTop } from "./features/layout/top.js";
import { start as startChatOwnViews } from "./features/chat/own-views.js";
import { start as startPageStart } from "./features/page/start.js";
import { linkList } from "./list-link.js";

linkList(); // the list (TypeScript) handed the old page's modules it calls
startPageData();
startSettingsPanel();
startListSeen();
startListList();
startListDrag();
startListGathererFolders();
startListManage();
startListModes();
startLayoutPanes();
startLayoutNewTab();
startAppsAppsPage();
startNotifyNotify();
startPageMainView();
startPageCode();
startChatViews();
startTerminalTerminal();
startChatFilesView();
startHistoryHistory();
startLayoutTop();
startChatOwnViews();
startPageStart();
