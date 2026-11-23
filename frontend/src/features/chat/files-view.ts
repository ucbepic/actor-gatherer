// THE CHAT VIEW: the conversation, and beside it a turn's files and commands -- each file the agent read, searched or
// changed in it, the lines it saw at their numbers and its changes in place among them (files.py); every call it made.
// One turn at a time: the latest, followed, unless one is picked. Drawn by React (ChatMain.tsx, side/), into a frame of
// each actor's own (mount.tsx), from what is handed to it here (talkFeed, host.ts's CHAT_HOST); loaded here, for the
// pane it is shown in (link.ts's Pane: its actor, by its key -- everything below is that actor's).
import { key, parse as parseKey } from "../../core/model/keys";
import { chatOf, pickTurn, showTurn, useActors, viewAtWork as viewAtWorkOf, viewTaken } from "./actors";
import { stampOf, turnsOf, useChatData, viewOf, viewOrNone, viewSeq } from "./data";
import { interrupt as interruptActor } from "./esc";
import { filesSeq, keptFiles, loadFiles as loadFilesOf, type FilesOf } from "./files";
import { CHAT_HOST } from "./host";
import { P, type Pane, type PaneFiles } from "./link";
import { drawChat } from "./mount";
import { FILE_KINDS } from "./side/marks";
import { useSide } from "./side/store";
import type { Actor, ChatView, MySend, PageFeed } from "./types";
import { CHAT_FEEDS, CHAT_VIEWS, addChatView, type ViewCtx } from "./views";

/** The actor a pane shows (the page's own, by default), by its key. */
export const chatActor = (p: Pane = P().here()): string | null => P().paneKey(p);

/** The files feed: the actor's turn's files and commands (files.ts: fetched when the stream's view says its turns moved
 * on, else as kept), for the turn picked (Chat's own, actors.ts's `picked`; null, the latest). A pane's `files` is made
 * anew each time it is given an actor: the turn list's folds start over with it (store.ts's forFiles), and the turn
 * picked of before is let go of. */
const filesOf = (f: PaneFiles, info: Actor | null, turn: number | null = chatOf(f.key).picked): FilesOf => {
  const { group: gatherer, id: channel } = parseKey(f.key);
  const turns = turnsOf(f.key, f.data),
    row = turn === null ? null : (turns[turn]?.row_id ?? null);
  return { gatherer, channel, turn, row, cwd: (info && (info.cwd || cwdOfSession(info))) || "" };
};
const cwdOfSession = (info: Actor) => (info.session as { cwd?: string | null } | null | undefined)?.cwd || "";
const filesFor = (k: string, data: PaneFiles["data"] = null): PaneFiles => {
  pickTurn(k, null);
  return { key: k, data };
};

/** Pane `p`'s files feed loaded for its actor -- of the turn picked, or `turn`, to be picked once they come: as kept
 * unless the turns moved on (the stream's view, its stamp) -- or, the page not streaming (paused), fetched each time, as
 * nothing else says when they move on. True once they are the feed's. */
export async function loadFiles(p: Pane, turn?: number | null): Promise<boolean> {
  const page = P(),
    k = page.paneKey(p);
  if (!k || page.snapshot) return false;
  if (!p.files || p.files.key !== k) p.files = filesFor(k);
  const f = p.files,
    at = turn === undefined ? chatOf(k).picked : turn,
    view = viewOf(k);
  let got: NonNullable<PaneFiles["data"]>;
  try {
    got = await loadFilesOf(filesOf(f, page.paneInfo(p), at), {
      fresh: !page.streaming(),
      stamp: view ? stampOf(view.turns) : undefined,
    });
  } catch (err) {
    if (p.files === f) f.failed = true; // (what waits for them waits no more: linesDue)
    throw err;
  }
  if (p.files !== f || (turn === undefined && chatOf(k).picked !== at)) return false; // another actor or turn meanwhile
  f.data = got;
  f.failed = false;
  return true;
}

/** Whether minimized pane `p`'s last lines (mini/) have yet to come: what they are drawn from -- the server's view of
 * its actor, or its files -- has not come, nor has its files' load failed. Till then the page draws no strip (its
 * "Loading…" kept: features/page/main-view.ts), which would grow as they came, moving the line above it. */
export function linesDue(p: Pane): boolean {
  const k = P().paneKey(p);
  if (!k || viewOf(k)) return false;
  const f = p.files && p.files.key === k ? p.files : null;
  return !(f && (f.data || f.failed));
}

/** The actor's Chat as last loaded -- its latest turn's files kept (files.ts) and the server's view (data.ts) -- made the
 * one the page's own pane shows (the list's select()): true if both are kept, false (nothing changed) if not. Drawn at
 * once when one is picked again, then each brought up to date as it comes; together, as one moment's: the turns are not
 * drawn before the view of what they are at. */
export function showKept(g: string, c: string, p: Pane = P().here()): boolean {
  const k = key(g, c),
    info = P().home() && P().paneInfo(p);
  const data = keptFiles(filesOf({ key: k, data: null }, info || null, null));
  if (!data || !viewOf(k)) return false;
  p.files = filesFor(k, data);
  return true;
}

/** A turn picked in pane `p` (null: the latest): its files and commands loaded, then shown with it, as one moment's --
 * Chat draws them itself (actors.ts's showTurn); the pane's last pick, if another came meanwhile. */
export async function setFilesTurn(p: Pane, n: number | null): Promise<void> {
  const f = p.files;
  if (!f || !f.data) return;
  const last = turnsOf(f.key, f.data).length - 1,
    turn = n === null || n >= last ? null : Math.max(0, n);
  const mine = (p.picking = (p.picking || 0) + 1);
  if ((await loadFiles(p, turn)) && mine === p.picking && p.files === f) showTurn(f.key, turn);
}

/** Pane `p`'s files and commands at the left, folded to their bar or opened (side/store.ts); folded, the latest turn's,
 * which the bar counts. Drawn again by themselves. */
export function foldSide(p: Pane, fold: boolean): Promise<void> | undefined {
  const k = P().paneKey(p);
  if (!k) return;
  useSide.getState().fold(k, fold);
  if (fold && p.files && chatOf(p.files.key).picked !== null) return setFilesTurn(p, null);
}

/** What Chat shows of an actor, as the stream sends it (the server's view, data.ts): kept by the actor; the messages
 * sent from here it has now no longer shown as sent (actors.ts); and, the actor's turns moved on, its latest turn's
 * files fetched again, then drawn (loadFiles). */
export function takeChatView(g: string, c: string, got: unknown): void {
  const k = key(g, c),
    view = viewOrNone(got),
    p = P().paneOf(g, c);
  useChatData.getState().take(k, view);
  viewTaken(k, view);
  if (view && p && p.files && p.files.key === k && chatOf(k).picked === null)
    loadFiles(p).then(
      () => P().render(),
      () => {},
    );
}

/** The view of an actor (as the home has it: its key) -- one a pane shows; null before it has come. */
export const chatViewOf = (a: (Actor & { key?: string }) | null | undefined): ChatView | null =>
  a && a.key && P().paneWith(a.channel) ? viewOf(a.key) : null;

/** What was sent from here to the actor pane `p` shows that its view does not have yet (actors.ts). */
export const mySends = (p: Pane): readonly MySend[] => {
  const k = P().paneKey(p);
  return k ? chatOf(k).sends : [];
};

/** The actor -- one a pane shows -- at work as its view has it (actors.ts). */
export const viewAtWork = (a: (Actor & { key?: string }) | null | undefined): boolean =>
  !!chatViewOf(a) && viewAtWorkOf(a!.key!);

/** Esc for the actor pane `p` shows (esc.ts): its turn interrupted, if it would be. */
export const interrupt = (p: Pane, info: Actor | null): boolean => {
  const k = P().paneKey(p);
  return !!k && interruptActor(k, info, P().say);
};

/** A turn its session has opened that ag has not stored yet -- the harness has its message (the view's opening, `seen`):
 * the actor runs. For an actor a pane shows. */
export function opened(a: (Actor & { key?: string }) | null | undefined): boolean {
  const v = chatViewOf(a);
  return !!v && !!v.opening && !!v.opening.seen;
}

/** What the conversation is drawn from for `actor` (types.ts's PageFeed): the server's view of it, its turn's files, and
 * how the page shows it now. What Chat keeps of the actor itself -- what was sent from here, the turn picked, the Esc
 * sent -- it reads itself (actors.ts). */
function talkFeed(p: Pane, ctx: ViewCtx, afresh: boolean): PageFeed {
  const page = P(),
    { actor, info } = ctx;
  const f = p.files && p.files.key === actor ? p.files : null;
  return {
    key: actor,
    gatherer: parseKey(actor).group,
    files: f || {},
    data: (f && f.data) as PageFeed["data"], // none yet: Chat says "Loading…"
    home: page.home(),
    info,
    session: ctx.session,
    view: viewOf(actor),
    writable: ctx.writable,
    held: ctx.held,
    earlierTurns: page.earlierTurns(),
    terminalView: CHAT_VIEWS.has("terminal"),
    afresh,
    snapshot: page.snapshot,
    streaming: page.streaming() && !page.snapshot,
    running: ctx.running,
    details: !!p.details,
    cwd: info.cwd || cwdOfSession(info) || "",
  };
}

/** The Chat view's frame for the actor a pane shows: React's (mount.tsx), the same node from draw to draw. */
function filesMount(ctx: ViewCtx): HTMLDivElement {
  const p = ctx.pane;
  // the view opened afresh (from another view, or the page's first draw): the conversation and the commands start
  // where they would for a new turn -- the commands at their end, the conversation at its end or at the turn picked
  const afresh = !p.main.querySelector(".files .fl-grid");
  return drawChat(talkFeed(p, ctx, afresh), CHAT_HOST);
}

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  const page = P();
  CHAT_FEEDS.files = {
    load: (p) => loadFiles(p),
    data: (p) =>
      p.files && p.files.key === page.paneKey(p) && p.files.data
        ? { items: turnsOf(p.files.key, p.files.data), pending: [], earlier: false }
        : null,
    // what it draws from, by which it is -- the files by when they were fetched, the view by which was taken -- not by
    // what they hold, written out at every draw; and, minimized, the sends from here its lines show (mini/): whole, Chat
    // draws them itself
    signature: (p) =>
      p.files
        ? [
            p.files.key,
            chatOf(p.files.key).picked,
            filesSeq(p.files.data),
            viewSeq(p.files.key),
            page.chatMin(p) ? chatOf(p.files.key).sends.length : null,
            !!p.files.failed, // (a minimized pane's strip, held for its lines, drawn without them: linesDue)
          ]
        : null,
  };
  // what Chat keeps of the actor changed: drawn again if the page draws from it (a minimized pane's lines)
  useActors.subscribe(() => {
    if (page.panes().some((p) => page.chatMin(p))) page.render();
  });
  // The conversation, at the right: drawn from what talkFeed hands it, calling what CHAT_HOST gives it of the page. What
  // it shows is the server's view of the conversation (ag_dashboard/CHAT_VIEW.md: the stream's `chat`, chat_view.py's),
  // made from one read -- the turns, the latest's state, what waits, the message Esc took back -- by the actor's key
  // (data.ts); and the messages sent from the page's box, each by its id (`cid`), until the view has it, a moment later:
  // the dashboard keeps each from the moment it is sent.
  addChatView({
    // "files": named so once, and kept as its id, with the readers' choices of it
    id: "files",
    name: "Chat",
    feed: "files",
    frame: "files",
    icon: page.icons.bubble,
    background: false, // drawn under its commands
    greets: true, // says itself that there is no conversation yet
    asking: false, // drawn under its conversation, at the right
    queued: false, // what waits for the turn to end: at its conversation's end, pending
    description: "The conversation, with each turn's files and commands beside it.",
    chatTools: true, // its tools in the header Chat's own (Controls.tsx: "Latest")
    render: () => [],
    mount: filesMount, // its frame its own: React's
    // its message box the page's own (Composer.tsx): what is typed the actor's draft, kept as it is typed
  });
}

export { CHAT_HOST, FILE_KINDS };
