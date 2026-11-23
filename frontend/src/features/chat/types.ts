// What the Chat view's turn list draws from (the feed the old page hands it at each draw: ChatFeed) and what it calls of
// the old page (ChatHost), until those parts of the page move too (ag_dashboard/DESIGN.md, A5). What it shows of the
// conversation is the server's view of it (ChatView: chat_view.py's, the stream's `chat`, ag_dashboard/CHAT_VIEW.md) --
// the turns, the latest's state, what waits, made from one read -- and the page's own sends the view does not have yet;
// the actor is the home's (data.py's), as far as the turn list reads it.
import type { Actor, ChatView, Files, Home } from "../../core/api/types";
import type { CardsHost } from "./asking/Cards";
import type { PaneActsProps } from "./side/PaneActs";

// What the server sends of the conversation, as generated from its schema (core/api/types.ts): a turn and its parts,
// its files and commands (/api/files), the actor (the home's), Chat's view (the stream's `chat`).
export type {
  Actor,
  CallRun,
  ChatView,
  Command,
  Current,
  Opening,
  Reply,
  SentMessage,
  Stopped,
  Turn,
  TurnFile,
  UserMessage,
  Waits,
} from "../../core/api/types";

/** /api/files: the actor's turns, and the one shown (`turn`, its index) -- the latest, unless one is picked -- with its
 * files and commands. */
export type FilesData = Files;

/** A message sent from this page's box (features/chat/chat.js's send), by its id: shown until the view has it. */
export interface MySend {
  cid: string;
  text: string;
  /** when it was sent, in the page's milliseconds */
  at: number;
}

/** What the turn list draws from: what the page hands it at each draw for the actor given (`PageFeed`:
 * features/chat/files-view.js's talkFeed), with what Chat keeps of the actor itself (actors.ts: what was sent from here,
 * the turn picked, the Esc sent), as ChatMain.tsx reads it. */
export interface ChatFeed {
  /** the actor's key (its gatherer and channel) and its gatherer */
  key: string;
  gatherer: string;
  /** the pane's files feed for the actor (its record's `files`): the turn list's folds start over with a new one */
  files: object;
  /** the files of the turn shown (files.ts), as the page has them; null before they have come */
  data: FilesData | null;
  /** the turn picked, or null: the latest, followed */
  picked: number | null;
  home: Home | null;
  info: Actor;
  session: { status?: string };
  /** the server's view of the conversation (the stream's `chat`); null until it has come for this actor */
  view: ChatView | null;
  writable: boolean;
  held: string;
  /** sent from here, and not in the view yet */
  mine: MySend[];
  /** Esc sent for this actor lately */
  interrupting: boolean;
  /** Esc would interrupt it */
  canInterrupt: boolean;
  /** the page is a snapshot (no files); the page streams (Chat waits for the stream's view) */
  snapshot: boolean;
  streaming: boolean;
  /** the actor runs, as the list has it (its commands under way drawn running) */
  running: boolean;
  /** the Details panel open beside the conversation: the files' panel has less room */
  details: boolean;
  /** the actor's directory, its files' paths read from there */
  cwd: string;
  /** the setting "Chat's earlier turns": messages only, or whole */
  earlierTurns: string;
  /** a Terminal view to send the reader to */
  terminalView: boolean;
  /** the view opened afresh: the turn shown brought into view again */
  afresh: boolean;
}

/** What the page hands Chat for an actor at each draw: all it draws from but what Chat keeps of the actor itself. */
export type PageFeed = Omit<ChatFeed, "mine" | "picked" | "interrupting" | "canInterrupt">;

/** What the turn list calls of the old page, until those parts move too; and the cards under it (asking/Cards.tsx). */
export interface ChatHost extends CardsHost {
  /** how the actor at work is drawn: "acting" (its stage) or "simple" (the setting) */
  avatarMode(): string;
  /** an actor's face, small (features/list/list.js's crewFace); the gatherer agent's picture for one with none */
  crewFace(a: Actor | null, coordinator: boolean): Node;
  /** a message an app wrote with its own block (a Browser's), as the app draws it; null for any other */
  appWords(text: string): Node | null;
  /** a message between actors (coordination.py's envelope) */
  envelope(text: string): Envelope | null;
  /** a message's words as matched with one stored, and whether two say the same */
  typedAs(text: string): string;
  sameWords(a: string, b: string): boolean;
  /** the key that opens beside: ⌘ or Ctrl */
  beside: string;
  /** the files and commands folded to their bar, or shown (folded: the latest turn's, which the bar counts) */
  foldSide(actor: string, fold: boolean): unknown;
  /** the head of the pane showing `actor`, put in the files' folded bar with a panel open above the panes; null: none */
  paneActs(actor: string): PaneActsProps | null;
  /** a turn's files and commands shown: null, the latest's */
  setFilesTurn(actor: string, n: number | null): Promise<unknown>;
}

/** A message between actors, or a watch's news (coordination.py's `envelope`, `update`). */
export interface Envelope {
  from: "coordinator" | "actor" | "update";
  id: string | null;
  name: string | null;
  /** a coordinator agent's: the node it is over, as its messages name it ("everything", "making_ag/Editor") */
  over?: string | null;
  text: string;
  how?: string;
  watch?: number;
}
