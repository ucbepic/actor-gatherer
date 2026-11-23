// What the page's modules share of the home and of the page itself (core/page/): the home as the stream sends it -- its
// types generated from the server's schema (core/api/types.ts), with what the page adds to them --; an actor's pane and
// the panes beside it; the page's state.
import type * as api from "../api/types";

/** An actor's place: its gatherer (group) and channel. */
export type At = [string, string];

/** A session the page started or keeps (sessions.py's). */
export type PageSession = api.Session;

/** What an actor's turn does now (work.py's summary): what it runs, what it ran last, how its last call ended. */
export type Work = api.Work;

/** An actor of a gatherer (data.py's), as the home has it -- and the page's key for it, its gatherer and channel
 * (features/list/seen.ts's takeHome sets it). */
export type PageActor = api.Actor & { key?: string };

/** An app instance's notifications, as a gatherer has them (data.py's `app_notices`), and one of them. */
export type AppNotices = api.AppNotices;
export type AppNotice = AppNotices["notices"][number];

/** A gatherer, or group (data.py's), with its actors as the page has them. */
export type PageGatherer = Omit<api.Gatherer, "agents"> & { agents: PageActor[] };

/** A shell (sessions.py's `shell`): the user's own, in a terminal, listed under its gatherer. */
export type PageShell = api.Shell;

/** A harness, as the dashboard describes it (data.py's harness_info, from harness_kit). */
export type PageHarness = api.HarnessInfo;

/** What of the home only a running dashboard sends (server.py's `read_home`): a snapshot's home has none of it. */
type Served =
  | "app_groups"
  | "cwd"
  | "permission_modes"
  | "terminals"
  | "harnesses"
  | "shells"
  | "home_dir"
  | "branches"
  | "app_requests";

/** The home as the page has it: the server's (/api/home, the stream's `home`), its actors keyed by the page -- or a
 * snapshot's, without what only a running dashboard sends. */
export type PageHome = Omit<api.Home, Served | "gatherers"> &
  Partial<Pick<api.Home, Served>> & { gatherers: PageGatherer[] };

/** What ag recorded of an actor's calls (/api/agent, the stream's `agent`), or why there is none ({error}). */
export type AgentCalls = api.Agent | api.Failed;

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

/** An app's panel above the panes (the layout's, features/layout/types.ts's AppPanel), as the page's modules read it:
 * its group (`g`) and node too. */
export interface AppPane {
  app: { name: string };
  g: string;
  node: HTMLElement;
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
