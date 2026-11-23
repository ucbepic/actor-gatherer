// What the Chat view's turn list draws from (the feed the old page hands it at each draw: ChatFeed) and what it calls of
// the old page (ChatHost), until those parts of the page move too (ag_dashboard/DESIGN.md, A5). What it shows of the
// conversation is the server's view of it (ChatView: chat_view.py's, the stream's `chat`, ag_dashboard/CHAT_VIEW.md) --
// the turns, the latest's state, what waits, made from one read -- and the page's own sends the view does not have yet;
// the actor is the home's (data.py's), as far as the turn list reads it.
import type { Home } from "../../core/api/types";
import type { Answer, Ask, Failing, StoppedCall } from "./asking/ask";
import type { CardsHost } from "./asking/Cards";

/** A message of the agent's in a turn (files.py's `replies`): what it said, a run of its thinking, or a note of its
 * harness's (a subagent's report handed back, another session's message). */
export interface Reply {
  kind: string;
  text?: string;
  /** thinking's runs; none readable when encrypted */
  texts?: string[];
  /** a report's task, or the session a message came from */
  name?: string | null;
  /** how many of the turn's calls came before it: where it goes among the commands (a minimized pane's card,
   * src/features/chat/mini-history.js) */
  after?: number;
}

/** A call (files.py's command): its line, the call as its harness's view reads it, and how it went. */
export interface CallRun {
  id?: string | null;
  text: string;
  call?: unknown;
  running?: boolean;
  error?: boolean;
  output?: string | null;
  exit?: number | string | null;
  took?: string | null;
}

/** How a turn stopped short (files.py's `stopped`): interrupted, an error it gave up on, or another reason. */
export interface Stopped {
  kind: string;
  text?: string | null;
  status?: number | string | null;
  reason?: string | null;
}

/** A message of the user's: a turn's first, or one written while it ran (`more`) -- with its send's id, sent from Chat. */
export interface UserMessage {
  text: string;
  kind?: string;
  at?: number;
  cid?: string | null;
}

/** A message the actor sent another (files.py's `sent`: `ag actors send`, or a new actor started with it). */
export interface SentMessage {
  text: string;
  kind?: string;
  to?: string | null;
  to_name?: string | null;
}

/** A turn (files.py's): the user's message, what the agent said and did, how it ended. */
export interface Turn {
  n: number;
  row_id?: number | null;
  at?: number | null;
  /** its last event's time */
  end?: number | null;
  text: string;
  kind?: string;
  replies?: Reply[];
  /** what the agent does now: a call, or thinking */
  now?: { kind: string; id?: string; text?: string } | null;
  more?: UserMessage[];
  /** its latest call, while nothing readable followed it */
  last?: CallRun | null;
  stopped?: Stopped | null;
  /** its calls, as many as its commands list */
  calls?: number;
  /** what the avatar acts out (work.py's summary) */
  work?: unknown;
  sent?: SentMessage[];
  /** a `!` command's output */
  output?: string | null;
  /** the send it is (sent from Chat), and when its message was sent: the server's view's (chat_view.py) */
  cid?: string | null;
  began?: number | null;
}

/** A file a turn touched (files.py's `files`): what each call did to it, by kind; the lines added and removed. */
export interface TurnFile {
  path: string;
  kinds: string[];
  created?: boolean;
  temporary?: boolean;
  changed?: [number, number] | null;
  /** what git changed of it as the turn's commands ran: its kinds */
  git?: string[];
  sources: unknown[];
}

/** A call of a turn, as its commands list it (files.py's `commands`): with the files it touched, and what it did to
 * each. */
export interface Command extends CallRun {
  files?: string[];
  did?: Record<string, string[]>;
  git?: Record<string, string[]>;
  changed?: [number, number] | null;
}

/** /api/files: the actor's turns, and the one shown (`turn`, its index) -- the latest, unless one is picked -- with its
 * files and commands. */
export interface FilesData {
  turns: Turn[];
  turn: number | null;
  files: TurnFile[];
  commands: Command[];
  home?: string;
}

/** An actor, as the home has it (data.py), as far as the turn list reads it. */
export interface Actor {
  channel: string;
  /** its directory, as its calls named it */
  cwd?: string | null;
  /** what its harness runs in the background (data.py's `background`) */
  background?: unknown[];
  harness?: string | null;
  status?: string;
  role?: string;
  /** a coordinator agent's node (coordinators.py): "all", "groups:<id>", "folder:<id>"; none, its group's */
  over?: string | null;
  /** its last activity */
  last?: number | null;
  /** its calls failing, retried: since when, how often, why */
  failing?: Failing | null;
  /** the model call its turn stopped on */
  stopped?: StoppedCall | null;
  /** what it waits on the user for; the answer sent from here */
  asking?: Ask | null;
  answer?: Answer | null;
  avatar?: string | null;
  avatar_hue?: string | null;
  /** what it says before its first message */
  avatar_hello?: string | null;
  /** the message its harness took back on an Esc (data.py's `taken_back`) */
  taken_back?: ChatView["taken_back"];
  name?: { text?: string | null } | null;
  session?: {
    session_id?: string;
    status?: string;
    terminal?: unknown;
    started_as?: string | null;
    queued?: string[];
    /** when a key was last typed into its terminal (the dashboard's), and since when that terminal runs */
    typed?: number | null;
    since?: number | null;
    /** when the key that stopped its turn was typed into its terminal */
    stopped_at?: number | null;
  } | null;
}

/** A turn sent and not stored yet (chat_view.py's `opening`): its message, the send it is (sent from Chat), when it was
 * sent (seconds), whether the session has it (`seen`), not had for long (`unseen`), and stopped by a key typed into its
 * terminal before the harness recorded anything of it (`stopped`). */
export interface Opening {
  text: string;
  cid?: string | null;
  began: number;
  seen?: boolean;
  unseen?: boolean;
  stopped?: Stopped | null;
}

/** The latest turn's state (chat_view.py's `current`): a turn opening, at work, asking the user, done, stopped short
 * (`stopped`: how), or no turn yet; the turn it is ("opening": the opening); what it does, and its calls failing. */
export interface Current {
  state: "opening" | "working" | "asking" | "done" | "stopped" | "idle";
  turn: number | "opening" | null;
  doing?: { kind: string; id?: string; text?: string } | null;
  failing?: { at: number } | null;
  asking?: unknown;
  stopped?: Stopped | null;
}

/** What waits for the agent's next step (chat_view.py's `waiting`): held by its harness for its turn's end ("queued"),
 * sent from Chat while it worked ("chat"), or in the dashboard's own queue for it ("dashboard"). */
export interface Waits {
  text: string;
  cid?: string | null;
  how: "queued" | "chat" | "dashboard";
}

/** What Chat shows of the actor's conversation, as the server made it from one read (chat_view.py's `view`). */
export interface ChatView {
  turns: Turn[];
  opening: Opening | null;
  current: Current;
  waiting: Waits[];
  /** the message Esc took back, before any of its answer came */
  taken_back: { text: string; at?: number | null; cid?: string | null; since?: number | null } | null;
  version?: unknown;
}

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
  /** the actor's stage (core/page/helpers.js): at work, done, waving hello */
  atWork(info: Actor, t: { work?: unknown }): Node;
  atRest(info: Actor, turn: number | null | undefined): Node;
  greeting(info: Actor): Node | null;
  /** an actor's face, small (features/list/list.js's crewFace); the gatherer agent's picture for one with none */
  crewFace(a: Actor | null, coordinator: boolean): Node;
  /** a message an app wrote with its own block (a Browser's), as the app draws it; null for any other */
  appWords(text: string): Node | null;
  /** the actor's avatar without its circle: where to get it */
  bareAvatar(info: Actor): string | null;
  /** the words in the actor's hue: a style ("color: ...") */
  hueInk(info: Actor): string | null;
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
  barActs(actor: string): Node | null;
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
