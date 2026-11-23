// WHAT THE LAYOUT IS HANDED of the page around it (features/layout/link.ts's LayoutPage), at the app's level, where a
// file may import any feature (ag_dashboard/DESIGN.md's Rules): the page's core and shell, the settings panel's stream,
// the apps' actors and the Apps page, the list's modules, the apps' host and links, Chat's (its card, views, a minimized
// pane's lines, its actors and questions), the terminal's -- each checked here against what the layout says it reads of
// them. Called once by src/page.js, before any module starts, as src/list-link.js's linkList is.
import * as avatar from "../core/page/avatar";
import * as helpers from "../core/page/helpers";
import * as pageState from "../core/page/state";
import * as askings from "../features/chat/asking/ask";
import * as chatActors from "../features/chat/actors";
import * as chat from "../features/chat/chat";
import * as mini from "../features/chat/mini-history";
import * as views from "../features/chat/views";
import * as appActors from "../features/apps/app-actors";
import * as appsPage from "../features/apps/apps-page";
import * as appHost from "../features/apps/host";
import * as appLinks from "../features/apps/links";
import * as gathererFolders from "../features/list/gatherer-folders";
import * as groupMoves from "../features/list/group-moves";
import * as list from "../features/list/list";
import * as menus from "../features/list/Menus";
import * as modes from "../features/list/modes";
import * as seen from "../features/list/seen";
import * as data from "../features/page/data";
import * as mainView from "../features/page/main-view";
import * as paneView from "../features/page/pane-view";
import * as panel from "../features/settings/panel";
import * as term from "../features/terminal/term";
import { setLayoutPage, type LayoutPage } from "../features/layout/link";
import type { Pane } from "../features/layout/types";

// Chat's own types are its reading of the same panes and actors: handed over as the layout's
type ChatPane = Parameters<typeof views.chatView>[0];
type ChatActor = Parameters<typeof chat.askWhere>[0];
type MiniCtx = Parameters<typeof mini.miniHistory>[0];
const chatPane = (p: Pane) => p as unknown as ChatPane;

export function linkLayout(): void {
  setLayoutPage({
    // the page's state and panes, as the layout reads them: the panes' and the apps' panels' records are the layout's own
    // (it makes and keeps them: more than core/page/types.ts says of them), and it reads more of the home (its tasks and
    // branches) than the page's types say
    page: pageState as unknown as LayoutPage["page"],
    helpers: { ...helpers, bareAvatar: avatar.bareAvatar, restDelay: avatar.restDelay, HUE_MAIN: avatar.HUE_MAIN },
    data,
    panel,
    mainView,
    paneView,
    chat: {
      askKey: askings.askKey,
      askWhere: (a, ask) => chat.askWhere(a as unknown as ChatActor, ask),
      chatToEnd: (p) => views.chatToEnd(chatPane(p)),
      chatOf: chatActors.chatOf,
      showTurn: chatActors.showTurn,
    },
    views: {
      CHAT_VIEWS: views.CHAT_VIEWS,
      CHAT_VIEW_KEY: views.CHAT_VIEW_KEY,
      chatView: (p) => views.chatView(chatPane(p)),
      setChatView: (p, id) => views.setChatView(chatPane(p), id),
    },
    mini: {
      miniCard: mini.miniCard,
      miniHistory: (ctx) => mini.miniHistory(ctx as unknown as MiniCtx),
      miniRest: (ctx) => mini.miniRest(ctx as unknown as MiniCtx),
    },
    terminal: term,
    appActors,
    appsPage,
    appHost,
    // (the apps the layout hands back are those the host found: named, found, handlers)
    newPanel: (app, instance, hooks) => new appHost.AppPane(app as appHost.AppInfo, instance, hooks),
    appLinks,
    list,
    // (the list's openTask reads a click's keys of whatever it is given: a click, or the layout's {metaKey, inTabs})
    openTask: (g, id, item, ev) => list.openTask(g, id, item, ev as Parameters<typeof list.openTask>[3]),
    seen,
    gathererFolders,
    groupMoves,
    modes,
    menus,
  });
}
