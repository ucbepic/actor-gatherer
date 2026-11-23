// What Chat (features/chat/, TypeScript) takes from the page around it and from the other features, which a feature's
// TypeScript may not import (ag_dashboard/DESIGN.md's Rules): filled here, at the app's level, once every module is loaded
// and before any starts (src/main.ts's linkChat). What Chat reads is typed in features/chat/link.ts; the page's modules
// it comes from are imported typed, so what each hands over is checked. Each part is read as it is when Chat asks (the
// page's state, a setting), not as it was when linked.
import { createElement } from "react";
import type { ChatView } from "../features/chat/views";
import type { Home } from "../core/api/types";
import { BackgroundNote } from "../features/chat/Background";
import { setChatPage, type ChatPage } from "../features/chat/link";
import type { Actor } from "../features/chat/types";
import type { ChatViewDef, FeedDef } from "../features/chat/views";
import { eventsOf, loadEvents } from "../features/details/events";
import {
  columnsNode,
  contextCardNode,
  contextItemNode,
  drawMessages,
  sizeCardNode,
  typeChipsNode,
} from "../features/details/mount";
import type { Item, Read } from "../features/details/types";
import { viewOpened } from "../features/history/store";
import { MANAGER, crewFace, envelope } from "../features/list/list";
import { statusOf, turnStatus } from "../features/list/seen";
import type { Actor as ListActor } from "../features/list/types";
import { fullscreenFor, termOf, type TermActor } from "../features/terminal/term";
import { PermissionCall, summary, type Call } from "../features/transcript/calls";
import { loadTranscript, txFeedOf } from "../features/transcript/data";
import type { TxItem } from "../features/transcript/blocks";
import { drawTranscript, foldedOutputNode, notesSwitchNode, transcriptBlockNodes } from "../features/transcript/mount";
import * as state from "../core/page/state";
import * as helpers from "../core/page/helpers";
import type { Pane as PagePane, PageActor } from "../core/page/types";
import * as appActors from "../features/apps/app-actors";
import type { Pane } from "../features/chat/link";
import * as data from "../features/page/data";
import * as mainView from "../features/page/main-view";
import * as paneView from "../features/page/pane-view";
import * as layout from "../features/layout/panes";
import * as top from "../features/layout/top";

// The page's own types are its reading of the same panes and actors (core/page/types.ts): handed over as Chat's.
const pageOf = (p: Pane | null | undefined) => p as unknown as PagePane;
const chatOf = (p: PagePane | null) => p as unknown as Pane | null;
const asPage = (a: Actor) => a as unknown as PageActor;
const asChat = (a: PageActor | null) => a as unknown as Actor | null;

/** The list reads an actor as its home has it: the same record Chat reads. */
const listed = (a: Actor) => a as unknown as ListActor;

/** What the views beside Chat draw from: the actor's events, a row each (features/details/events.ts), and each event's
 * parts, as the Transcript draws them (features/transcript/data.ts). */
const feeds: Record<string, FeedDef> = {
  history: {
    load: (p) => loadEvents(paneView.paneKey(pageOf(p))),
    data: (p) => {
      const f = eventsOf(paneView.paneKey(pageOf(p)));
      return f ? { items: f.items, pending: f.pending, earlier: false } : null;
    },
  },
  transcript: {
    load: (p) => loadTranscript(paneView.paneKey(pageOf(p))),
    loadEarlier: (p) => loadTranscript(paneView.paneKey(pageOf(p)), true),
    data: (p) => {
      const f = txFeedOf(paneView.paneKey(pageOf(p)));
      return f ? { items: f.items, pending: f.pending, earlier: f.earlier } : null;
    },
  },
};

/** The views that come with the page beside Chat: Messages (features/details/) and the Transcript
 * (features/transcript/), each drawing its frame itself, with what waits for the turn to end and that there is nothing
 * yet in it. */
const otherViews = (): ChatViewDef[] => [
  {
    id: "messages",
    name: "Messages",
    feed: "history",
    frame: "ctx",
    icon: helpers.ICONS.list,
    more: true,
    readOnly: true,
    description: "The session's events, one row each, filtered by type.",
    queued: false,
    greets: true,
    tools: () => typeChipsNode(null),
    render: () => [],
    mount: ({ actor, data: d, queued, noneYet }) =>
      drawMessages({ key: actor, items: d.items as Item[], pending: d.pending as Item[], queued, noneYet }, "Messages"),
  },
  {
    id: "transcript",
    name: "Transcript",
    feed: "transcript",
    frame: "term",
    icon: helpers.ICONS.page,
    more: true,
    readOnly: true,
    description: "The conversation as its harness's terminal shows it.",
    queued: false,
    greets: true,
    tools: () => notesSwitchNode(),
    render: () => [],
    mount: ({ actor, info, data: d, running, queued, noneYet, loadEarlier }) =>
      drawTranscript(
        {
          key: actor,
          items: d.items as TxItem[],
          pending: d.pending as TxItem[],
          earlier: !!d.earlier,
          running,
          failing: info.failing || null,
          last: info.last ?? null,
          cwd: info.cwd || "",
          background: createElement(BackgroundNote, { info, term: true }),
          queued,
          noneYet,
          loadEarlier,
        },
        "Transcript",
      ),
  },
];

/** What the context's and size cards are drawn for, as nodes: the actor of the pane being drawn. */
const callsNow = () => mainView.callsNow() as Parameters<typeof contextCardNode>[0];

export function linkChat(): void {
  const page: ChatPage = {
    snapshot: !!state.SNAPSHOT,
    home: () => state.state.home as Home | null,
    streaming: () => !!state.state.stream && !state.state.paused,
    here: () => chatOf(state.panes.here)!,
    panes: () => paneView.allPanes() as unknown as Pane[],
    paneKey: (p) => paneView.paneKey(pageOf(p)),
    paneInfo: (p) => asChat(paneView.paneInfo(pageOf(p))),
    paneOf: (g, c) => chatOf(paneView.paneOf(g, c)),
    paneWith: (c) => chatOf(paneView.paneWith(c)),
    paneAt: (n) => chatOf(paneView.paneAt(n)),
    drawPane: (p, end) => mainView.drawPane(pageOf(p), end),
    renderPane: (p) => mainView.renderPane(pageOf(p)),
    render: (now) => data.render(now),
    refresh: (now) => data.refresh(now),
    loadChat: (p) => data.loadChat(p ? pageOf(p) : undefined),
    savePanes: () => layout.savePanes(),
    detailsTip: mainView.DETAILS_TIP,
    setDetails: (p, open, part) => mainView.setDetails(pageOf(p), open, part),
    dashboardCommand: (text, p) => mainView.dashboardCommand(text, pageOf(p)),
    chatMin: (p) => top.chatMin(pageOf(p)),
    canMinimize: (p) => top.canMinimize(pageOf(p)),
    setChatMin: (p, on) => top.setChatMin(pageOf(p), on),
    minTip: top.MIN_TIP,
    miniView: top.MINI_VIEW as unknown as ChatView, // (its footer reads a pane and an actor as the layout does)
    topShown: () => top.topShown(),
    meMarks: top.ME_MARKS,
    fitBox: (box) => data.fitBox(box),
    say: (text) => data.setLive(text),
    earlierTurns: () => data.earlierTurns,
    avatarMode: () => helpers.avatarMode,
    icons: helpers.ICONS,
    besideKey: helpers.BESIDE_KEY,
    harnessName: (h) => helpers.harnessName(h),
    hasChat: (a) => helpers.hasChat(asPage(a)),
    runnableNames: (join) => helpers.runnableNames(join),
    statusOf: (a) => statusOf(listed(a)),
    turnStatus: (a) => turnStatus(listed(a)),
    crewFace: (a, coordinator) => crewFace(a && listed(a), coordinator ? MANAGER : null),
    envelope: (text) => envelope(text),
    appWords: (text) => appActors.appWordsOf(text),
    historyOpened: (actor) => viewOpened(actor),
    terminalOpens: (info) => {
      const t = termOf(info.channel);
      return {
        fullscreen: fullscreenFor(state.state.home as Home | null, info as TermActor),
        ...(t && t.opened ? { cols: t.xterm.cols, rows: t.xterm.rows } : {}),
      };
    },
    // (a permission's tool named, or not: the call's shape says the rest)
    PermissionCall: ({ ask, id }) =>
      createElement(PermissionCall, { ask: { ...ask, tool: ask.tool ?? undefined }, id }),
    callTitle: (ask) => summary({ name: ask.tool, input: ask.input, view: ask.view } as Call).title,
    feeds,
    otherViews,
    reader: {
      el: (tag, attrs, ...kids) => helpers.el(tag, attrs as Parameters<typeof helpers.el>[1], ...(kids as never[])),
      svgEl: (tag, attrs) => helpers.svgEl(tag, attrs),
      contextItem: (it) => contextItemNode(it as Item),
      columns: () => columnsNode(),
      typeChips: (counts) => typeChipsNode(counts),
      // a view of the reader's own draws for the pane being drawn: its paths read from its actor's directory
      transcriptBlocks: (items, running) =>
        transcriptBlockNodes(items as TxItem[], running, paneView.paneInfo(paneView.drawingPane())?.cwd || ""),
      foldedOutput: (text, id, cls) => foldedOutputNode(text, id, cls),
      notesSwitch: () => notesSwitchNode(),
      sizeCard: (reads, hasReal) => sizeCardNode(callsNow(), reads as Read[], hasReal),
      contextCard: () => contextCardNode(callsNow()),
      statusOf: (a) => statusOf(listed(a)),
      harnessName: (h) => helpers.harnessName(h),
      harnessLogo: (h) => helpers.harnessLogo(h),
      harnessBadge: (h) => helpers.harnessBadge(h),
      actorLogo: (a) => appActors.actorLogo(asPage(a)),
    },
  };
  setChatPage(page);
}
