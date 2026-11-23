// The page's shell (features/page/) linked to the features it draws: what link.ts says it takes, filled from each
// feature's modules. An app-level file (ag_dashboard/DESIGN.md's Rules): it may import any feature, and is type-checked,
// so what it hands over is checked against what the shell says it takes -- but for the old page's modules still plain
// JS, read as untyped (`@ts-ignore` on their imports, which does nothing once a module is TypeScript, when it is checked
// too). Called once by page.js before any module starts; each part reads its module's namespace when called, so a value
// the module changes later is read as it is then.
import { setPageLink } from "../features/page/link";
import * as seen from "../features/list/seen";
import * as list from "../features/list/list";
import * as chatStore from "../features/chat/store";
import * as drafts from "../features/chat/drafts";
import { ownBox } from "../features/chat/Composer";
import { termsKept } from "../features/terminal/term";
import { counted } from "../features/details/model";
import { loadContext, pickedFor, shownRead, usePicked } from "../features/details/store";
import { detailsShown, drawDetails } from "../features/details/mount";
import { useEvents } from "../features/details/events";
import { txSignature, useTxFeed } from "../features/transcript/data";
import { useNotes } from "../features/transcript/TranscriptView";
import { useSettings } from "../features/settings/store";
import * as appHost from "../features/apps/host";
import * as panes from "../features/layout/panes";
import * as top from "../features/layout/top";
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore -- plain JS
import * as views from "../features/chat/views";
// @ts-ignore -- plain JS
import * as chat from "../features/chat/chat";
// @ts-ignore -- plain JS
import * as files from "../features/chat/files-view";
// @ts-ignore -- plain JS
import * as ownViews from "../features/chat/own-views";
// @ts-ignore -- plain JS
import * as shell from "../features/terminal/shell";
/* eslint-enable @typescript-eslint/ban-ts-comment */
import type { ChatPart, DetailsPart, LayoutPart, ListPart } from "../features/page/link";
import type { PageActor, PageGatherer, PageHome } from "../core/page/types";

// The list's own types are its reading of the same home: handed over as the page's.
type ListActor = Parameters<typeof seen.statusOf>[0];
type ListGatherer = Parameters<typeof list.isHidden>[0];
type ListHome = Parameters<typeof seen.takeHome>[0];

const listPart: ListPart = {
  takeHome: (home: PageHome) => seen.takeHome(home as unknown as ListHome),
  statusOf: (a: PageActor) => seen.statusOf(a as unknown as ListActor),
  firstAgent: (g: PageGatherer) => list.firstAgent(g as unknown as ListGatherer) as PageActor | undefined,
  isHidden: (g: PageGatherer) => list.isHidden(g as unknown as ListGatherer),
  staleNames: () => list.staleNames(),
  moveHidingToServer: () => list.moveHidingToServer(),
  renderAgents: () => list.renderAgents(),
};

const layoutPart: LayoutPart = {
  drawWho: (p) => panes.drawWho(p),
  paneSig: () => panes.paneSig(),
  restorePanes: () => panes.restorePanes(),
  setAutoShown: (k) => panes.setAutoShown(k),
  showActorsApp: (g, c) => panes.showActorsApp(g, c),
  startTabs: () => panes.startTabs(),
  taskKey: (g, c) => panes.taskKey(g, c),
  actorPanes: () => panes.actorPanes(),
  isAt: (sel, g, c) => panes.isAt(sel, g, c),
  focusedPane: () => panes.focusedPane(),
  focusPane: (p) => panes.focusPane(p),
  closeHerePane: () => panes.closeHerePane(),
  startPlacing: () => panes.startPlacing(),
  watchTop: (node, who) => panes.watchTop(node, who),
  restoreAppPanes: () => panes.restoreAppPanes(),
  topChanged: () => top.topChanged(),
  topMount: () => top.topMount(),
  topShown: () => top.topShown(),
  chatMin: (p) => top.chatMin(p),
  canMinimize: (p) => top.canMinimize(p),
  shellMini: (p, id) => top.shellMini(p, id),
};

const chatPart: ChatPart = {
  get CHAT_VIEWS() {
    return views.CHAT_VIEWS;
  },
  chatView: (p) => views.chatView(p),
  setChatView: (p, id) => views.setChatView(p, id),
  chatFeed: (p) => views.chatFeed(p),
  chatCard: (p, info) => chat.chatCard(p, info),
  chatAtEnd: (p) => chat.chatAtEnd(p),
  chatToEnd: (p) => chat.chatToEnd(p),
  interrupt: (p, info) => files.interrupt(p, info),
  takeChatView: (g, c, got) => files.takeChatView(g, c, got),
  opened: (a) => files.opened(a),
  clearFlips: () => chatStore.clearFlips(),
  drafts: () => drafts.drafts(),
  keepDraft: (actor, text) => drafts.keepDraft(actor, text),
  ownBox,
  loadOwnViews: () => ownViews.loadOwnViews(),
};

type DetailsFeed = Parameters<typeof drawDetails>[0];
type Agent = Parameters<typeof shownRead>[0];
const detailsPart: DetailsPart = {
  counted: (reads) => counted(reads as Parameters<typeof counted>[0]),
  detailsShown,
  shownRead: (agent, actor) => shownRead(agent as Agent, pickedFor(usePicked.getState(), actor)),
  loadContext,
  drawDetails: (feed, host) => drawDetails(feed as unknown as DetailsFeed, host),
  events: () => useEvents.getState().feed,
  txSignature: () => txSignature(useTxFeed.getState().feed),
  notes: useNotes,
};

/** The page's shell handed what it takes of the features: page.js, before any module starts. */
export function linkPage(): void {
  setPageLink({
    list: listPart,
    layout: layoutPart,
    chat: chatPart,
    terminal: { termsKept, shellCard: (p, id) => shell.shellCard(p, id) },
    details: detailsPart,
    settings: {
      fileOpen: () => useSettings.getState().file.open,
      closeFile: () => useSettings.getState().closeFile(),
      load: () => useSettings.getState().load(),
    },
    apps: { load: () => appHost.load() },
  });
}
