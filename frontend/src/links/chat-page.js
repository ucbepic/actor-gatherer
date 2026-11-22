// The old page's modules (plain JS) that the Chat, History and Terminal links read (chat.ts, history.ts, terminal.ts):
// handed on as they are, typed in chat-page.d.ts -- TypeScript does not read plain JS. Each line goes as its module moves
// to TypeScript, and its link imports it directly.
export * as state from "../core/page/state";
export * as helpers from "../core/page/helpers";
export * as data from "../features/page/data";
export * as mainView from "../features/page/main-view";
export * as paneView from "../features/page/pane-view";
export * as top from "../features/layout/top";
export * as layout from "../features/layout/panes";
export * as settings from "../features/settings/panel";
export * as appActors from "../features/apps/app-actors";
