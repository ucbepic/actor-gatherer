// The page's script, as page.html had it: its sections, modules now (core/page/, features/), loaded and then started
// in the order they ran as one script -- each module's start() what it did as it loaded (its listeners, what it set up
// and drew at once), so that happens in the same order as before, once every module is there to be called. A module
// itself only declares as it loads: the page's state (core/page/state.js) is the one that runs as it loads, first.
import "./core/page/state";
import "./core/page/helpers";
import { start as startPageCode } from "./core/page/code";
import { start as startPageData } from "./features/page/data";
import { start as startSettingsPanel } from "./features/settings/panel";
import { start as startListSeen } from "./features/list/seen";
import { start as startListList } from "./features/list/list";
import { start as startListDrag } from "./features/list/drag";
import { start as startListGathererFolders } from "./features/list/gatherer-folders";
import { start as startListManage } from "./features/list/manage";
import { start as startListModes } from "./features/list/modes";
import { start as startLayoutPanes } from "./features/layout/panes";
import { start as startLayoutNewTab } from "./features/layout/new-tab";
import { start as startAppsAppsPage } from "./features/apps/apps-page";
import { start as startNotifyNotify } from "./features/notify/notify";
import { start as startPageMainView } from "./features/page/main-view";
import { start as startChatViews } from "./features/chat/views";
import { start as startTerminalTerminal } from "./features/terminal/terminal";
import { start as startChatFilesView } from "./features/chat/files-view";
import { start as startHistoryHistory } from "./features/history/history";
import { start as startLayoutTop } from "./features/layout/top";
import { start as startChatOwnViews } from "./features/chat/own-views";
import { start as startPageStart } from "./features/page/start";
import { linkList } from "./list-link";
import { linkPage } from "./links/page";
import { linkSettings } from "./links/settings";

linkList(); // the list (TypeScript) handed the old page's modules it calls
linkPage(); // the page's shell (features/page/) handed the features it draws
linkSettings(); // the settings panel handed the page's shell
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
