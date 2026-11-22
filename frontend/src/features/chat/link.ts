// WHAT CHAT TAKES FROM THE PAGE AROUND IT: the panes and how they are drawn, the page's state, the layout's minimized
// panes, the list's faces and words, the other features' views and nodes -- which a feature's TypeScript may not import
// (ag_dashboard/DESIGN.md's Rules). src/links/chat.ts fills it once every module is loaded and before any starts
// (src/page.js); what Chat reads of the page is typed here, and nothing else. It shrinks as those parts move.
import type { ComponentType } from "react";
import type { Home } from "../../core/api/types";
import type { Ask } from "./asking/ask";
import type { Actor, Envelope, FilesData } from "./types";
import type { ChatView, ChatViewDef, FeedDef } from "./views";

/** A send from a pane's message box: true once sent; `draft`, whose box it is (a new tab's first message is sent by it). */
export type SendFn = ((text: string) => Promise<boolean>) & { draft?: string };

/** A pane's files feed (files-view.ts): its actor's key, and the turn's files and commands once they came. */
export interface PaneFiles {
  key: string;
  data: FilesData | null;
}

/** An actor's pane, as the page keeps its record (features/page/pane-view.js's makePane): its actor, what it shows of
 * it, its parts. The page's own pane's actor is the page's selection. */
export interface Pane {
  readonly g: string | null;
  readonly c: string | null;
  readonly here: boolean;
  /** the view picked for it */
  view: string;
  /** Details open beside its view */
  details: boolean;
  /** what ag recorded of the actor's calls */
  agent: { harness?: string | null; reads?: unknown[] } | null;
  files: PaneFiles | null;
  /** its message box's send: the latest draw's */
  chatSend: SendFn;
  /** the turns picked in it, counted: the last pick wins */
  picking?: number;
  /** what was last drawn in it (its view's signature: none, drawn again at the page's next draw) */
  drawn: { main: unknown };
  readonly main: HTMLElement;
  readonly controls: HTMLElement;
  readonly close: HTMLButtonElement;
  readonly node: HTMLElement;
}

/** An actor's state as the list words it: its status and the word for it. */
export type Status = readonly [string, string];

/** What a view of the reader's own draws with, of the page's and the other features' (agDashboard, own-views.ts). */
export interface ReaderParts {
  el(tag: string, attrs?: Record<string, unknown>, ...kids: unknown[]): HTMLElement;
  svgEl(tag: string, attrs?: Record<string, unknown>): Element;
  contextItem(it: unknown): Node;
  columns(): Node;
  typeChips(counts: Record<string, number> | null): Node;
  transcriptBlocks(items: unknown[], running: boolean): Node[];
  foldedOutput(text: unknown, id: string, cls?: string): Node;
  notesSwitch(): Node;
  sizeCard(reads: unknown[], hasReal: boolean): Node;
  contextCard(): Node;
  statusOf(a: Actor): Status;
  harnessName(h: string | null | undefined): string;
  harnessLogo(h: string | null | undefined): Node;
  harnessBadge(h: string | null | undefined): Node;
  actorLogo(a: Actor): Node;
}

/** Each part of the page Chat takes. */
export interface ChatPage {
  /** the page is a snapshot: its data inside it, no server */
  readonly snapshot: boolean;
  /** the home as the page has it now (null before it is loaded) */
  home(): Home | null;
  /** the page's stream open and not paused */
  streaming(): boolean;

  // the panes (features/page/pane-view.js): the page's own, every pane (the page's own first), and finding them
  here(): Pane;
  panes(): Pane[];
  paneKey(p: Pane | null | undefined): string | null;
  paneInfo(p: Pane | null | undefined): Actor | null;
  paneOf(g: string, c: string): Pane | null;
  paneWith(c: string): Pane | null;
  paneAt(node: Node | null): Pane | null;

  // drawing (features/page/main-view.js, data.js): a pane drawn where the reader left it (its ends followed), drawn as it
  // is, the page drawn (only what changed; `now`, everything), its data fetched again, what a pane's view draws from loaded
  drawPane(p: Pane, end?: boolean): void;
  renderPane(p: Pane): void;
  render(now?: boolean): void;
  refresh(now?: boolean): Promise<void>;
  loadChat(p?: Pane): Promise<void>;
  /** the panes' arrangement kept (features/layout/panes.js) */
  savePanes(): void;

  // Details (main-view.js)
  readonly detailsTip: string;
  setDetails(p: Pane, open: boolean, part?: string): void;
  /** one of the dashboard's own commands typed in pane `p`'s box (`/context`): done there, true */
  dashboardCommand(text: string, p: Pane): boolean;

  // a pane minimized (features/layout/top.js): whether it is, can be, made so; the view it draws then (its message box,
  // its lines and avatar: the footer); whether a panel is open above the panes; the marks on the actor's avatar
  chatMin(p: Pane): boolean;
  canMinimize(p: Pane): boolean;
  setChatMin(p: Pane, on: boolean): void;
  readonly minTip: string;
  readonly miniView: ChatView;
  topShown(): boolean;
  readonly meMarks: Readonly<Record<string, readonly [string, string]>>;

  // the message box (data.js): fitted to what is typed in it, a word on the page's state line, the setting "Chat's
  // earlier turns", the setting for the actor at work ("acting" or "simple")
  fitBox(box: HTMLTextAreaElement): void;
  say(text: string): void;
  earlierTurns(): string;
  avatarMode(): string;

  // the page's icons and harnesses' words (core/page/helpers.js)
  readonly icons: Readonly<Record<string, string>>;
  readonly besideKey: string;
  harnessName(h: string | null | undefined): string;
  /** the actor can be messaged from here at all (a harness the dashboard runs, a known directory) */
  hasChat(a: Actor): boolean;
  /** the harnesses the dashboard runs, named (`join`: "and", "or") */
  runnableNames(join: string): string;

  // the list (features/list/): an actor's state, its turn's, its face, a message between actors
  statusOf(a: Actor): Status;
  turnStatus(a: Actor): Status;
  crewFace(a: Actor | null, coordinator: boolean): Node;
  envelope(text: string): Envelope | null;
  /** a message an app wrote with its own block, as the app draws it (features/apps/); null for any other */
  appWords(text: string): Node | null;

  // the other features
  /** the History view opened again for the actor (features/history/): built again if due */
  historyOpened(actor: string | null): void;
  /** what a terminal a message opens is opened with: full screen or not, the Terminal view's size (features/terminal/) */
  terminalOpens(info: Actor): Record<string, unknown>;
  /** the call a permission is asked for, as a call is shown (features/transcript/), in its box (.perm) */
  readonly PermissionCall: ComponentType<{ ask: Ask; id: string }>;
  /** a call's title, as a call is shown: what a permission is for, of a shape not known */
  callTitle(ask: Ask): string;
  /** what the views the page comes with draw from (features/details/, features/transcript/) */
  readonly feeds: Readonly<Record<string, FeedDef>>;
  /** the views that come with the page beside Chat, in order (Messages, Transcript) */
  otherViews(): ChatViewDef[];
  /** what a view of the reader's own draws with */
  readonly reader: ReaderParts;

  // the actor's stage (core/page/helpers.js), until it moves
  atWork(info: Actor, t: { work?: unknown }): Node;
  atRest(info: Actor, turn: number | null | undefined): Node;
  greeting(info: Actor): Node | null;
  bareAvatar(info: Actor): string | null;
  hueInk(info: Actor): string | null;
}

let page: ChatPage | null = null;

/** The page's parts, handed over by src/links/chat.ts before any module starts. */
export function setChatPage(link: ChatPage): void {
  page = link;
}

/** The page's parts (there once the page has linked Chat). */
export function P(): ChatPage {
  if (!page) throw new Error("Chat is linked to the page before it starts (src/links/chat.ts)");
  return page;
}
