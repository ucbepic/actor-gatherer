// WHAT THE LAYOUT IS HANDED of the page around it (features/layout/link.ts's LayoutPage), at the app's level, where a
// file may import any feature (ag_dashboard/DESIGN.md's Rules): the other features' modules -- the list's, the apps'
// host and links, Chat's actors and questions, the terminal's -- each checked here against what the layout says it reads
// of them; and the old page's plain-JS modules (plain.js), which have no types to check, read as the link says. Called
// once by src/page.js, before any module starts, as src/list-link.js's linkList is.
import * as askings from "../features/chat/asking/ask";
import * as chatActors from "../features/chat/actors";
import * as appHost from "../features/apps/host";
import * as appLinks from "../features/apps/links";
import * as gathererFolders from "../features/list/gatherer-folders";
import * as groupMoves from "../features/list/group-moves";
import * as list from "../features/list/list";
import * as menus from "../features/list/Menus";
import * as modes from "../features/list/modes";
import * as seen from "../features/list/seen";
import * as term from "../features/terminal/term";
import { setLayoutPage, type LayoutPage } from "../features/layout/link";
import * as plain from "./plain";

type Chat = LayoutPage["chat"];

export function linkLayout(): void {
  const oldChat = plain.chat as Pick<Chat, "askWhere" | "chatToEnd">;
  setLayoutPage({
    page: plain.state as LayoutPage["page"],
    helpers: plain.helpers as LayoutPage["helpers"],
    data: plain.data as LayoutPage["data"],
    panel: plain.panel as LayoutPage["panel"],
    mainView: plain.mainView as LayoutPage["mainView"],
    paneView: plain.paneView as LayoutPage["paneView"],
    chat: {
      askKey: askings.askKey,
      askWhere: (a, ask) => oldChat.askWhere(a, ask),
      chatToEnd: (p) => oldChat.chatToEnd(p),
      chatOf: chatActors.chatOf,
      showTurn: chatActors.showTurn,
    },
    views: plain.views as LayoutPage["views"],
    mini: plain.mini as LayoutPage["mini"],
    terminal: term,
    appActors: plain.appActors as LayoutPage["appActors"],
    appsPage: plain.appsPage as LayoutPage["appsPage"],
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
