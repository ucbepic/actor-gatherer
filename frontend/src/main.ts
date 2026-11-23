// The dashboard's page. Its modules load in the order its one script had them (page.html's, before the split into
// frontend/: ag_dashboard/DESIGN.md), so their styles cascade as they did: the Apps page's, the apps' panels' and the
// work area's first, then the page's own (styles.ts), then each feature's as its module loads. The page's state
// (core/page/state.ts) is the one module that runs as it loads. Then each feature's link is filled -- what its
// TypeScript takes of the others (src/links/) -- and each module started (its start(): its listeners, what it sets up
// and draws at once) in the order the script ran, once every module is there to be called; then ag's own settings.
import "./features/apps/catalog";
import "./features/apps/host";
import "./features/layout/work";
import { stream } from "./core/api/stream";
import { markdown } from "./core/ui/md";
import "./styles";
import "./core/page/state";
import "./core/page/helpers";
import { start as startPageCode } from "./core/page/code";
import { start as startPageData } from "./features/page/data";
import { mountAgSettings } from "./features/settings/panel";
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
import { linkList } from "./links/list";
import { linkPage } from "./links/page";
import { linkSettings } from "./links/settings";
import { linkNotify } from "./links/notify";
import { linkApps } from "./links/apps";
import { linkChat } from "./links/chat";
import { linkHistory } from "./links/history";
import { linkTerminal } from "./links/terminal";
import { linkLayout } from "./links/layout";

/** What the page's tests, and a reader at the console, reach: its stream (e2e/streams.spec.ts) and its markdown
 * (app-links, notes-links, latex). */
const agPage = Object.freeze({
  /** A stream of the dashboard's, as `new EventSource(url)`, on the page's one WebSocket (core/api/stream.ts). */
  stream,
  ui: Object.freeze({ markdown }),
});
declare global {
  interface Window {
    agPage: typeof agPage;
  }
}
window.agPage = agPage;

linkList(); // the list handed the page's core and the features it calls
linkPage(); // the page's shell (features/page/) handed the features it draws
linkSettings(); // the settings panel handed the page's shell
linkNotify(); // the notifications handed the list, the panes and the apps
linkApps(); // the Apps page handed the page around it
linkChat(); // Chat handed what it takes of the page and the other features
linkTerminal(); // and the terminal
linkHistory(); // and History
linkLayout(); // the layout handed the page around it
startPageData();
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
mountAgSettings();
