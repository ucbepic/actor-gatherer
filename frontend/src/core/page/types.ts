// What the page's modules share of the home and of the page itself (core/page/): the home as the stream sends it, as far
// as they read it; an actor's pane and the panes beside it; the page's state. Each field optional where an older server,
// a snapshot or an actor not yet stored leaves it out.

/** An actor's place: its gatherer (group) and channel. */
export type At = [string, string];

/** A session the page started or keeps (sessions.py's), as the page reads it. */
export interface PageSession {
  session_id?: string;
  status?: string;
  /** an app's actor: its app and instance (app_agents.py), as JSON */
  role?: string | null;
  started_as?: string;
  terminal?: unknown;
  harness?: string | null;
  cwd?: string;
}

/** What an actor's turn does now (work.py's summary): what it runs, what it ran last, how its last call ended. */
export interface Work {
  doing?: string | null;
  last?: string | null;
  ended?: { id: unknown; at?: number; ok?: boolean; kind?: string } | null;
  helpers?: number;
  failed?: number;
}

/** An actor of a gatherer (data.py's), as the page reads it. */
export interface PageActor {
  channel: string;
  key?: string;
  harness?: string | null;
  session?: PageSession | null;
  avatar?: string | null;
  avatar_hue?: string | null;
  avatar_motion?: string | null;
  avatar_hello?: unknown;
  cwd?: string | null;
  last?: number | null;
  last_user_message?: string | null;
  chattable?: boolean;
  holder?: unknown;
  status?: string;
  running?: boolean;
  /** what it waits on the reader for: a question, a plan, a permission */
  asking?: {
    kind?: string;
    call?: string;
    at?: number;
    questions?: { question?: string; header?: string }[];
  } | null;
  answer?: unknown;
  /** its model's calls failing, retried */
  failing?: { error?: string; attempts?: number; at?: number } | null;
  /** how its last turn stopped */
  stopped?: { text?: string; at?: number } | null;
  background?: { id?: string; kind?: string; label?: string }[];
  taken_back?: unknown;
}

/** An app instance's notifications, as a gatherer has them (data.py's `app_notices`). */
export interface AppNotice {
  id: string;
  title?: string;
  text?: string;
  at?: number;
  /** where the pop-up and the computer's notification go: "ag", "system" */
  show?: string[];
  /** where in the app it is about, handed to its panel when opened */
  where?: unknown;
}
export interface AppNotices {
  app?: string;
  notices?: AppNotice[];
  last?: number | null;
}

/** A gatherer, or group (data.py's). */
export interface PageGatherer {
  name: string;
  agents: PageActor[];
  alone?: boolean;
  apps?: Record<string, AppNotices>;
}

/** A shell (sessions.py's `shell`): the user's own, in a terminal, listed under its gatherer. */
export interface PageShell {
  id: string;
  gatherer?: string;
  cwd: string;
}

/** A harness, as the page reads it (data.py's harness_info, from harness_kit). */
export interface PageHarness {
  label?: string;
  runs?: boolean;
  /** its mark: an SVG */
  mark?: string;
  /** it can give an agent the apps' tools */
  mcp?: boolean;
}

/** The home (/api/home, the stream's `home`), as the page's modules read it. */
export interface PageHome {
  home?: string;
  now: number;
  home_dir?: string;
  cwd?: string;
  gatherers: PageGatherer[];
  shells?: PageShell[];
  harnesses?: string[];
  harness_info?: Record<string, PageHarness>;
  harness_default?: string;
  hook_servers?: unknown;
  hiding?: unknown;
  titles?: unknown;
  saved?: unknown;
  folders?: unknown;
  gatherer_folders?: unknown;
  places?: unknown;
  tasks?: unknown;
  seen?: unknown;
  branches?: unknown;
}

/** What ag recorded of an actor's calls (/api/agent): each read, and the rest as the server sends it. */
export interface AgentCalls {
  reads?: unknown[];
}

/** A snapshot's data (index.html's `window.AG_SNAPSHOT`): the home, each actor's calls, the avatars' pictures. */
export interface Snapshot {
  home: PageHome;
  agents: Record<string, AgentCalls | null>;
  avatars?: Record<string, string>;
}

/** A pane's parts, as the page draws into them (features/layout/pane.ts's). */
export interface PaneParts {
  node: HTMLElement;
  top: HTMLElement;
  head: HTMLElement;
  who: HTMLElement;
  controls: HTMLElement;
  close: HTMLButtonElement;
  main: HTMLElement;
}

/** An actor's pane (features/page/pane-view.ts's makePane): its parts, its actor, and what it shows of it. */
export interface Pane extends PaneParts {
  /** this page's own pane (its actor the page's selection) */
  here: boolean;
  g: string | null;
  c: string | null;
  /** its width among the panes */
  size: number;
  /** the view picked */
  view: string;
  /** Details open beside it */
  details: boolean;
  /** what ag recorded of its actor's calls, drawn again as `agentVersion` moves on */
  agent: AgentCalls | null;
  agentVersion: number;
  /** Chat's files feed */
  files: unknown;
  /** what its message box sends with: the latest draw's */
  chatSend: (...args: unknown[]) => Promise<boolean>;
  /** what was last drawn: its view's signature, its head's */
  drawn: { main: string | null; who: string | null };
}

/** An app's panel above the panes (features/layout/panes.js's), as the page's modules read it. */
export interface AppPane {
  app: { name: string };
  instance: { id: string; gatherer?: string };
  held?: boolean;
  panel: { intent(kind: string, what: unknown): void; refresh?(): void };
}

/** The panes open side by side: this page's own (`here`), the others beside it, the apps' panels above them;
 * `checked`, the panes kept in this browser opened again; `top`, the panes' heads' height. */
export interface Panes {
  here: Pane | null;
  others: Pane[];
  apps: AppPane[];
  checked: boolean;
  top: number | null;
}

/** The name being typed in the list: an actor's, a task's or an app's (`kind`), a gatherer's (c null). */
export interface Renaming {
  g: string;
  c: string | null;
  value: string;
  was: string;
  kind?: string;
  auto?: string;
}

/** What the page started, and is starting: its gatherer, harness, and (a coordinator agent) its node. */
export interface Starting {
  gatherer?: string;
  harness?: string;
  node?: string;
}

/** The page's stream (core/api/stream.ts's, as an EventSource is). */
export interface PageStream {
  readonly readyState: number;
  close(): void;
}

/** The page's own state, kept in its store (core/store/page.ts). */
export interface PageFields {
  home: PageHome | null;
  /** the actor of this page's own pane */
  selected: At | null;
  /** live updates paused */
  paused: boolean;
  stream: PageStream | null;
  /** the form open in the agent list: {gatherer: ""} a new gatherer's, {gatherer: G} a new session's in G */
  adding: { gatherer: string } | null;
  /** the actor, task, app or gatherer being named in the list */
  renaming: Renaming | null;
  /** a folder named in its line (features/list/folders.ts's startFolderEdit) */
  folderEdit: { g: string; id: number | null; parent: number | null; value: string; group: boolean } | null;
  starting: Starting | null;
}

/** The page's state as its modules read and write it: its own fields, and its own pane's actor's calls. */
export interface PageState extends PageFields {
  agent: AgentCalls | null;
  agentVersion: number;
}
