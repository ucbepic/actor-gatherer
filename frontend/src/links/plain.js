// The old page's plain-JS modules the layout takes (src/links/layout.ts), each a module's namespace, as they are: plain JS
// has no types for the layout's link to be checked against, so their shapes are what features/layout/link.ts says the
// layout reads of them (plain.d.ts). Each goes from here as its module becomes TypeScript, imported by layout.ts itself,
// its part of the link then checked.
export * as state from "../core/page/state";
export * as helpers from "../core/page/helpers";
export * as data from "../features/page/data";
export * as mainView from "../features/page/main-view";
export * as paneView from "../features/page/pane-view";
export * as panel from "../features/settings/panel";
export * as chat from "../features/chat/chat";
export * as views from "../features/chat/views";
export * as mini from "../features/chat/mini-history";
export * as appActors from "../features/apps/app-actors";
export * as appsPage from "../features/apps/apps-page";
