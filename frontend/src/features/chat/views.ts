// HOW A PANE SHOWS ITS ACTOR'S HISTORY: one VIEW of several, the reader's choice (the page's own pane's kept in this
// browser, a pane beside it with the layout's panes). A view names the FEED it draws from and draws it; the pane loads that
// feed, gives the view its card (card.tsx): a frame that follows its newest, what waits to be sent, and the box to write
// the next (for an actor that can be messaged here).
//
// A view is added with agDashboard.chatView({...}) (own-views.ts): here, or from a file of its own in
// <home>/dashboard/views/*.js, which the page loads when it starts (server.py: /api/views):
//
//   agDashboard.chatView({
//     id: "bubbles",                    // unique; the reader's choice is kept by it
//     name: "Bubbles",                  // on the switch
//     icon: "M2 4h12M2 8h12M2 12h8",    // optional: its icon beside its name, an SVG path in a 16x16 box, stroked
//     more: true,                       // optional: not on the bar but with the history's other views, in Details
//     readOnly: true,                   // optional: a view to read the history by -- no message box under it, and
//                                       // what the agent waits on the user for shown, not answered there
//     description: "User and assistant messages only.",
//     feed: "history",                  // what it draws (CHAT_FEEDS): "history", the gatherer's events --
//                                       // {row_id, name (its type), text, tokens, at, clipped};
//                                       // "transcript", each event's parts as the Transcript view draws
//                                       // them -- {row_id, type, at, parts: [{kind, role, text, ...}]};
//                                       // "files", the turns and the picked turn's files (files.py);
//                                       // or "none", for a view that is not the history (the Terminal)
//     frame: "ctx",                     // the frame's class: "ctx" (the list's), "term" (the terminal's), or your own
//     background: true,                 // optional: what runs in the background (backgroundNote) under the frame;
//                                       // false to draw it itself (api.backgroundNote(ctx.info), or (.., true) as a
//                                       // terminal's status line) or not at all. By default, under any view of the
//                                       // history but a "term" one
//     asking: false,                    // optional: false to draw what the agent waits on the user for, and the call
//                                       // it stopped on, itself (api.askingNote(ctx.info), api.errorNote(ctx.info));
//                                       // by default under the frame of a view of the history
//     queued: false,                    // optional: false to draw what waits for the agent's turn to end
//                                       // (ctx.queued) itself; by default listed after the view's blocks
//     greets: true,                     // optional: to say itself that there is no conversation yet; by
//                                       // default "No messages yet" after the view's blocks
//     tools(ctx) { return [nodes] },    // optional: controls in the page's header (filters, switches)
//     render(ctx) { return node or [nodes] },
//     composer(ctx) { return node },    // optional: the box to write the next message, under the frame;
//                                       // without it, the page's own message box (Composer.tsx)
//     footer(ctx) { return node },      // optional: under the message box, at the bottom of the page
//     chat: false,                      // optional: a view that is not the conversation (the History) --
//                                       // no message box under it, and nothing it did not draw itself
//   });
//
// `ctx` (ViewCtx): {actor (its key), info (the actor), session (its row: status, cwd, ...), data: {items, pending (what
// the model answered that no call has stored yet: row_id null), earlier (older items not loaded)}, running, queued,
// noneYet (what a view says while there is nothing yet), held (why the session cannot be messaged here -- another process
// has it open -- or ""), writable (whether it can be messaged from here at all), loadEarlier(), rerender(), api
// (agDashboard: el, markdown, the page's other helpers)}, and for a composer: input(attrs), the text box to build it
// around (Enter sends, Shift+Enter a new line, what is typed kept across redraws), and send(text), which sends it, clears
// the box, and shows an error under the composer when the send fails (true when it was sent). Controls marked data-send
// are disabled while a message is being sent, and while the session is held. A view that throws is shown as having
// failed; the others still work. A view that draws its frame itself (`mount`: the views that come with the page, React's)
// returns the frame, #chat-list, the same node from draw to draw.
import * as prefs from "../../core/prefs";
import { P, type Pane } from "./link";
import type { Actor } from "./types";

/** What a feed has for a pane's actor: its items, what the model answered that no call has stored yet, and whether
 * older ones are not loaded. */
export interface FeedData {
  items: unknown[];
  pending: unknown[];
  earlier: boolean;
}

/** What a view can draw from: it loads its data for the actor of the pane given, and says what it has (and, for the
 * page's change check, what it draws from: `signature`). */
export interface FeedDef {
  load(p: Pane): Promise<unknown>;
  loadEarlier?(p: Pane): Promise<unknown>;
  data(p: Pane): FeedData | null;
  signature?(p: Pane): unknown;
}

/** The actor's session, as the card reads it (data.py's): none yet, one stopped in its directory. */
export interface CardSession {
  cwd?: string | null;
  permission_mode?: string;
  queued?: string[];
  status?: string;
  last_error?: string | null;
  terminal?: unknown;
  session_id?: string;
}

/** What a view draws with (see above). */
export interface ViewCtx {
  actor: string;
  info: Actor;
  session: CardSession;
  data: FeedData;
  noneYet: string;
  running: boolean;
  queued: string[];
  held: string;
  writable: boolean;
  pane: Pane;
  loadEarlier(): Promise<void>;
  rerender(): void;
  api: unknown;
  /** for a view's own composer, the actor writable: what is typed sent, and the box to build it around */
  send?: (text: string) => Promise<boolean>;
  input?: (attrs?: Record<string, string>) => HTMLTextAreaElement;
}

/** What a view makes: a node, some, or none. */
export type Made = Node | readonly Node[] | null | undefined | void;

/** A view, as it is added (see above). */
export interface ChatViewDef {
  id: string;
  name?: string;
  feed?: string;
  frame?: string;
  icon?: string;
  more?: boolean;
  readOnly?: boolean;
  description?: string;
  background?: boolean;
  asking?: boolean;
  queued?: boolean;
  greets?: boolean;
  chat?: boolean;
  /** its tools in the head Chat's own (Controls.tsx: "Latest") */
  chatTools?: boolean;
  /** a minimized pane's: no frame, its lines and avatar its footer */
  mini?: boolean;
  /** offered only to the actors it says */
  when?(info: Actor | null): unknown;
  tools?(ctx: ViewCtx): Made;
  render(ctx: ViewCtx): Made;
  mount?(ctx: ViewCtx): Made;
  composer?(ctx: ViewCtx): Made;
  footer?(ctx: ViewCtx): Made;
}

/** A view as it is kept: its name, feed and whether what runs in the background goes under it, settled. */
export type ChatView = ChatViewDef & { name: string; feed: string; background: boolean };

export const CHAT_VIEWS = new Map<string, ChatView>();
export const CHAT_VIEW_KEY = "ag-dashboard-chat-view";

/** What a view can draw from: the views that come with the page add theirs as the page starts (and a view of the reader's
 * own may name any of them). */
export const CHAT_FEEDS: Record<string, FeedDef> = {
  none: { load: async () => {}, data: () => ({ items: [], pending: [], earlier: false }) },
};

/** Whether a view is offered to an actor: one with `when(info)` only to those it says. An app's actor is shown as any
 * actor is: its app's panel is above the panes. */
export const offeredTo = (v: ChatViewDef | undefined, info: Actor | null): v is ChatView =>
  !!v && (!v.when || !!v.when(info));

/** The views of `views` offered to `info`, those for it alone (`when`) first. */
export const offeredOf = (views: Iterable<ChatView>, info: Actor | null): ChatView[] =>
  [...views].filter((v) => offeredTo(v, info)).sort((a, b) => (b.when ? 1 : 0) - (a.when ? 1 : 0));

/** The views offered to pane `p`'s actor. */
export const offeredViews = (p: Pane): ChatView[] => offeredOf(CHAT_VIEWS.values(), P().paneInfo(p));

/** The view of `views` picked (`id`), if `info` is offered it; else Chat. */
export const viewPicked = (views: ReadonlyMap<string, ChatView>, id: string, info: Actor | null): ChatView => {
  const v = views.get(id);
  return offeredTo(v, info) ? v : views.get("files")!;
};

/** The view pane `p` shows: the one picked for it, if its actor is offered it; else Chat. */
export const chatView = (p: Pane): ChatView => viewPicked(CHAT_VIEWS, p.view, P().paneInfo(p));

/** Why `view` cannot be added with the feeds there are: null, it can. */
export function wrongView(view: unknown, feeds: Readonly<Record<string, FeedDef>>): string | null {
  const v = view as Partial<ChatViewDef> | null;
  if (!v || typeof v.id !== "string" || typeof v.render !== "function")
    return "a chat view needs an id and a render(ctx)";
  if (!feeds[v.feed || "history"]) return `no feed ${v.feed}: one of ${Object.keys(feeds).join(", ")}`;
  return null;
}

/** A view as kept: named by its id unless it has a name, drawing the history unless it says, and what runs in the
 * background under any view of the history but a terminal's. */
export const settled = (view: ChatViewDef): ChatView => ({
  name: view.id,
  feed: "history",
  background: view.feed !== "none" && view.frame !== "term",
  ...view,
});

/** A view added (agDashboard.chatView): every pane drawn again with it once the page has its home. */
export function addChatView(view: ChatViewDef): void {
  const wrong = wrongView(view, CHAT_FEEDS);
  if (wrong) throw new Error(wrong);
  CHAT_VIEWS.set(view.id, settled(view));
  const page = P();
  if (page.home())
    for (const p of page.panes()) {
      p.drawn.main = null;
      page.loadChat(p).then(() => page.render());
    }
}

/** The feed pane `p`'s view draws from (minimized: Chat's files, for its lines). */
export const chatFeed = (p: Pane, view: ChatView = chatView(p)): FeedDef =>
  (P().chatMin(p) ? CHAT_FEEDS.files : CHAT_FEEDS[view.feed]) || CHAT_FEEDS.history;

/** A pane's view's frame (the page's own, by default): at its end, or put there. */
const chatList = (p: Pane): HTMLElement | null => p.main.querySelector("#chat-list");
export const chatAtEnd = (p: Pane = P().here()): boolean => {
  const n = chatList(p);
  return !!n && n.scrollHeight - n.scrollTop - n.clientHeight < 40;
};
export const chatToEnd = (p: Pane = P().here()): void => {
  const n = chatList(p);
  if (n) n.scrollTop = n.scrollHeight;
};

/** Pane `p` showing view `id`: the page's own kept as the page's choice (every page opens on it), a pane beside it with
 * the pane (the layout's). Its feed loaded, then its card drawn with it (card.tsx: the same node, its view's frame put in
 * it in place of the last) and the pane around it, the new view at its end. */
export async function setChatView(p: Pane, id: string): Promise<void> {
  const page = P();
  if (id === "history" && chatView(p).id !== "history") page.historyOpened(page.paneKey(p)); // opened again: built again
  // if due, and at its tasks if it has them
  p.view = id;
  if (p.here) prefs.setText(CHAT_VIEW_KEY, id);
  else page.savePanes();
  await page.loadChat(p);
  page.drawPane(p);
  chatToEnd(p);
}

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  const page = P();
  Object.assign(CHAT_FEEDS, page.feeds);
  // "agent": what ag recorded of the actor's calls -- each read (items) -- loaded with the actor already
  CHAT_FEEDS.agent = {
    load: async () => {},
    data: (p) => (p.agent && p.agent.reads ? { items: p.agent.reads, pending: [], earlier: false } : null),
  };
  // the views that come with the page beside Chat: each draws its frame itself, React's (`mount`), with what waits for
  // the turn to end and that there is nothing yet in it
  for (const v of page.otherViews()) addChatView(v);
}
