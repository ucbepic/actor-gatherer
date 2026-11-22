// What Chat (features/chat/, TypeScript) takes from the page around it and from the other features, which a feature's
// TypeScript may not import (ag_dashboard/DESIGN.md's Rules): filled here, at the app's level, once every module is loaded
// and before any starts (src/page.js's linkChat). What Chat reads is typed in features/chat/link.ts; the old page's
// modules it comes from, in chat-page.d.ts. Each part is read as it is when Chat asks (the page's state, a setting), not
// as it was when linked.
import { createElement } from "react";
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
import { appActors, data, helpers, layout, mainView, paneView, state, top } from "./chat-page";

/** The list reads an actor as its home has it: the same record Chat reads. */
const listed = (a: Actor) => a as unknown as ListActor;

/** What the views beside Chat draw from: the actor's events, a row each (features/details/events.ts), and each event's
 * parts, as the Transcript draws them (features/transcript/data.ts). */
const feeds: Record<string, FeedDef> = {
  history: {
    load: (p) => loadEvents(paneView.paneKey(p)),
    data: (p) => {
      const f = eventsOf(paneView.paneKey(p));
      return f ? { items: f.items, pending: f.pending, earlier: false } : null;
    },
  },
  transcript: {
    load: (p) => loadTranscript(paneView.paneKey(p)),
    loadEarlier: (p) => loadTranscript(paneView.paneKey(p), true),
    data: (p) => {
      const f = txFeedOf(paneView.paneKey(p));
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
    here: () => state.panes.here,
    panes: () => paneView.allPanes(),
    paneKey: (p) => paneView.paneKey(p),
    paneInfo: (p) => paneView.paneInfo(p),
    paneOf: (g, c) => paneView.paneOf(g, c),
    paneWith: (c) => paneView.paneWith(c),
    paneAt: (n) => paneView.paneAt(n),
    drawPane: (p, end) => mainView.drawPane(p, end),
    renderPane: (p) => mainView.renderPane(p),
    render: (now) => data.render(now),
    refresh: (now) => data.refresh(now),
    loadChat: (p) => data.loadChat(p),
    savePanes: () => layout.savePanes(),
    detailsTip: mainView.DETAILS_TIP,
    setDetails: (p, open, part) => mainView.setDetails(p, open, part),
    dashboardCommand: (text, p) => mainView.dashboardCommand(text, p),
    chatMin: (p) => top.chatMin(p),
    canMinimize: (p) => top.canMinimize(p),
    setChatMin: (p, on) => top.setChatMin(p, on),
    minTip: top.MIN_TIP,
    miniView: top.MINI_VIEW,
    topShown: () => top.topShown(),
    meMarks: top.ME_MARKS,
    fitBox: (box) => data.fitBox(box),
    say: (text) => data.setLive(text),
    earlierTurns: () => data.earlierTurns,
    avatarMode: () => helpers.avatarMode,
    icons: helpers.ICONS,
    besideKey: helpers.BESIDE_KEY,
    harnessName: (h) => helpers.harnessName(h),
    hasChat: (a) => helpers.hasChat(a),
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
        fullscreen: fullscreenFor(state.state.home, info as TermActor),
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
      el: (tag, attrs, ...kids) => helpers.el(tag, attrs, ...kids),
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
      actorLogo: (a) => appActors.actorLogo(a),
    },
    atWork: (info, t) => helpers.atWork(info, t),
    atRest: (info, turn) => helpers.atRest(info, turn),
    greeting: (info) => helpers.greeting(info),
    bareAvatar: (info) => helpers.bareAvatar(info),
    hueInk: (info) => helpers.hueInk(info),
  };
  setChatPage(page);
}
