// WHAT THE PAGE'S SHELL TAKES FROM THE FEATURES IT DRAWS: the list, the panes and their tasks, Chat and its views, the
// terminal, Details, the Transcript, ag's settings and the apps -- which a feature's TypeScript may not import
// (ag_dashboard/DESIGN.md's Rules). src/links/page.ts hands them over as the page starts (linkPage, before any module
// starts), each part typed here by what the page reads of it, and nothing else. The old page's modules among them are
// read through their namespaces, so a value one of them changes later is read as it is then.
import type { At, PageActor, PageGatherer, PageHome, Pane } from "../../core/page/types";

/** A view a pane can show (features/chat/views.js's), as the page reads it. */
export interface ChatViewDef {
  id: string;
  name: string;
  feed: string;
  description?: string;
  icon?: string;
  /** listed in Details, beside the head's views */
  more?: boolean;
}
/** What a view draws from (views.js's feeds): loaded for a pane's actor, and what of it is drawn, as one value. */
export interface ChatFeed {
  load(p: Pane): Promise<unknown>;
  signature?(p: Pane): unknown;
}
/** A store the page follows: each change, with what it was. */
export interface Followed<T> {
  getState(): T;
  subscribe(listener: (now: T, was: T) => void): () => void;
}

/** The list (features/list/). */
export interface ListPart {
  /** the home the stream sent, taken: the list's state and the page's (seen.ts) */
  takeHome(home: PageHome): void;
  /** an actor's status: [its class, its word] */
  statusOf(a: PageActor): readonly [string, string];
  /** the actor a gatherer opens on */
  firstAgent(g: PageGatherer): PageActor | undefined;
  isHidden(g: PageGatherer): boolean;
  /** the groups hidden for being inactive, by name */
  staleNames(): unknown;
  /** hiding kept in this browser from before, moved to the server once */
  moveHidingToServer(): Promise<void>;
  renderAgents(): void;
}

/** The panes, their tasks and the work area (features/layout/). */
export interface LayoutPart {
  /** a pane's head (none given: every pane's) */
  drawWho(p?: Pane): void;
  /** what of the panes the list draws from */
  paneSig(): unknown;
  /** the panes kept in this browser opened again */
  restorePanes(): void;
  /** the task the page opened on by itself */
  setAutoShown(k: string | null): void;
  /** an app's actor: its app's panel above */
  showActorsApp(g: string, c: string): unknown;
  /** the tab shown as it was left */
  startTabs(): unknown;
  taskKey(g: string, c: string): string | null;
  actorPanes(): Pane[];
  isAt(sel: At | null | undefined, g: string, c: string): boolean;
  focusedPane(): Pane | null;
  focusPane(p: Pane | null): void;
  closeHerePane(): unknown;
  /** the work area placed from now on */
  startPlacing(): void;
  /** a pane's head watched for its height (the top row's) */
  watchTop(node: HTMLElement, who: string): void;
  /** the apps' panels kept in this browser opened again */
  restoreAppPanes(): unknown;
  /** the panes' buttons and the top row, as the apps known now say */
  topChanged(): void;
  /** the apps' panels' row put where it goes */
  topMount(): void;
  /** an app's panel shown above the panes */
  topShown(): boolean;
  /** a pane's chat minimized, and whether it can be */
  chatMin(p: Pane): boolean;
  canMinimize(p: Pane): boolean;
  /** a shell's pane, minimized */
  shellMini(p: Pane, id: string): Node;
}

/** Chat and the views of a pane (features/chat/). */
export interface ChatPart {
  /** every view, by its id */
  readonly CHAT_VIEWS: Map<string, ChatViewDef>;
  chatView(p: Pane): ChatViewDef;
  setChatView(p: Pane, id: string): unknown;
  chatFeed(p: Pane): ChatFeed;
  /** a pane's chat card: its view, frame and message box */
  chatCard(p: Pane, info: PageActor | Record<string, never>): Node;
  chatAtEnd(p: Pane): boolean;
  chatToEnd(p: Pane): void;
  /** whether a minimized pane's last lines have yet to come (what they are drawn from, not come nor failed): its strip
   * not drawn till then */
  linesDue(p: Pane): boolean;
  /** Esc for a pane's actor: its turn interrupted, or what it asks dismissed; whether it was taken */
  interrupt(p: Pane, info: PageActor | null): boolean;
  /** what Chat shows of an actor, as the stream sent it */
  takeChatView(g: string, c: string, got: unknown): void;
  /** whether the actor's harness opened a turn the page shows before ag stored it */
  opened(a: PageActor | null): boolean;
  /** the turns flipped against the setting "Chat's earlier turns", started over */
  clearFlips(): void;
  /** what was typed in each actor's box and not sent, and one kept */
  drafts(): Record<string, string>;
  keepDraft(actor: string | null | undefined, text: string): void;
  /** the Chat view's own message box (React's), which keeps its draft itself */
  ownBox(n: EventTarget | null): boolean;
  /** the reader's own views, from <home>/dashboard/views/ */
  loadOwnViews(): unknown;
}

/** The terminals (features/terminal/). */
export interface TerminalPart {
  /** the terminals of the sessions no pane shows let go of */
  termsKept(sids: Iterable<string>): void;
  /** a shell's pane: its terminal */
  shellCard(p: Pane, id: string): Node;
}

/** Details, and the feeds of the views beside Chat (features/details/, features/transcript/). */
export interface DetailsPart {
  /** ag's count of all each call sent */
  counted(reads: unknown[]): void;
  /** the actors whose Details are shown (a read picked on another's let go of) */
  detailsShown(keys: string[]): void;
  /** the read Details shows of an actor's calls: the one picked, else the latest */
  shownRead(agent: { reads?: unknown[] } | null, actor: string): number | null;
  /** that read's context, fetched */
  loadContext(gatherer: string, readId: number | null): Promise<void>;
  /** the panel, for a pane's actor: the same node from draw to draw */
  drawDetails(
    feed: {
      key: string | null;
      info: PageActor | Record<string, never>;
      agent: unknown;
      home: PageHome | null;
      snapshot: boolean;
      views: Pick<ChatViewDef, "id" | "name" | "description" | "icon">[];
      current: string;
      now: number;
    },
    host: { showView(id: string): void },
  ): HTMLElement;
  /** the history's feed (the Messages view's) as it is now */
  events(): { key?: unknown; last_row?: unknown; pending?: unknown } | null;
  /** what the Transcript's feed draws from now */
  txSignature(): unknown;
  /** the Transcript's notes shown */
  readonly notes: Followed<{ on: boolean }>;
}

/** ag's settings (features/settings/): its config.toml's dialog, and the panel's loading. */
export interface SettingsPart {
  fileOpen(): boolean;
  closeFile(): void;
  load(): Promise<unknown>;
}

/** Each part of the page the shell takes, by the feature it comes from. */
export interface PageLink {
  list: ListPart;
  layout: LayoutPart;
  chat: ChatPart;
  terminal: TerminalPart;
  details: DetailsPart;
  settings: SettingsPart;
  /** the apps installed, read (features/apps/host.ts) */
  apps: { load(): Promise<unknown> };
}

/** The page's parts, once linkPage has handed them over (before any module starts). */
export let link: PageLink = null as unknown as PageLink;
export function setPageLink(l: PageLink): void {
  link = l;
}
