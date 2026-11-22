// What the layout reads of the page around it: the home (data.py's, the stream's `home`) as far as the panes, the tasks
// shown and the start boxes read it, the page's state, and the records the page keeps of its panes and the apps' panels.
// Declared here, not imported, as a feature's TypeScript may import only core/ and its own folder (ag_dashboard/
// DESIGN.md's Rules); what fills them is handed over through link.ts.
import type { PaneParts } from "./pane";

/** An actor's place: its gatherer and channel. */
export type At = [string, string];
/** A status as the list says it: [its class, its word] ("running", "Running"). */
export type Status = readonly [cls: string, label: string];

/** A session the page started or keeps (sessions.py's), as the layout reads it. */
export interface Session {
  session_id?: string;
  started_as?: string;
  terminal?: unknown;
  cwd?: string;
  role?: string | null;
}

/** What an actor waits on the reader for (data.py's `asking`), as far as the layout reads it (a panel is told the rest as
 * it is). */
export interface Asking {
  kind?: string;
  id?: string | null;
  call?: string | null;
  at?: number;
  /** asked as it goes on working */
  async?: boolean;
}

/** An actor of a gatherer (data.py's), as the layout reads it. */
export interface Actor {
  channel: string;
  name?: { text?: string } | null;
  last_user_message?: string | null;
  avatar?: string | null;
  avatar_hue?: string | null;
  harness?: string;
  cwd?: string | null;
  last?: number | null;
  status?: string;
  closed?: boolean;
  role?: string | null;
  over?: string | null;
  turn_over?: boolean;
  asking?: Asking | null;
  asked_of?: unknown;
  recap?: { text?: string; at?: number } | null;
  /** its model's calls failing, retried; how its last turn stopped */
  failing?: { error?: string; attempts: number; at?: number } | null;
  stopped?: { text?: string; at?: number } | null;
  started_as?: string;
  session?: Session | null;
}

/** A gatherer, or group (data.py's). */
export interface Gatherer {
  name: string;
  agents: Actor[];
  /** an actor on its own: a group of one */
  alone?: boolean;
  last?: number | null;
}

/** Actors to pick a folder from: a gatherer, or every actor of every group (the list's everyActor). */
export interface Actors {
  agents: Actor[];
}

/** A shell (sessions.py's `shell`), listed under its gatherer. */
export interface Shell {
  id: string;
  gatherer: string;
  cwd: string;
}

/** A folder of a gatherer's tree (folders.py's). */
export interface Folder {
  id: number;
  parent: number | null;
  name: string;
  closed?: string | null;
}

/** A gatherer's folders, and where each item is filed (folders.py's tree). */
export interface FolderTree {
  folders: Folder[];
  filed: Record<string, number>;
}

/** A gatherer's tasks (tasks.py's): its tasks, and the task each item is in. */
export interface Tasks {
  tasks: { id: number }[];
  tasked: Record<string, number>;
}

/** An actor's branch of its own (branches.py's), as the list shows it. */
export interface Branch {
  gatherer: string;
  channel: string;
  branch: string;
  worktree: string;
  project: string;
  started_on?: string | null;
  start?: string | null;
  onto?: CheckedOut | null;
  approve?: boolean;
  held?: Record<string, { n: number }>;
}
/** What a folder has checked out (branches.py's `checked_out`): its branch, or its commit alone. */
export interface CheckedOut {
  head?: string | null;
  branch?: string | null;
}
/** A gatherer's source to branch from (branches.py's projects), or a repository its actors work in. */
export interface Project extends CheckedOut {
  path: string;
  name?: string;
  github?: string | null;
  remote?: string | null;
}

/** The home, as the layout reads it. */
export interface PageHome {
  gatherers: Gatherer[];
  shells?: Shell[];
  home_dir?: string;
  cwd?: string;
  harnesses?: string[];
  /** false: no terminals here (the home's config) */
  terminals?: boolean;
  /** groups merged into folders: an actor can start on its own */
  merged?: boolean;
  tasks?: Record<string, Tasks>;
  branches?: Branch[];
}

/** What the page is starting: its gatherer, harness, and (a coordinator agent) its node. */
export interface Starting {
  gatherer: string;
  harness: string;
  node?: string;
}
/** The list's form for a new actor (newForm): its gatherer, directory, harness, and why it did not start. */
export interface Adding {
  gatherer: string;
  cwd?: string;
  harness?: string | null;
  error?: string;
}

/** The page's state (core/page/state.js), as far as the layout reads and writes it. */
export interface PageState {
  home: PageHome | null;
  selected: At | null;
  starting: Starting | null;
  adding: Adding | null;
}

/** What a pane's message box sends (Chat's), and whose draft it is. */
export type ChatSend = ((text: string) => Promise<boolean>) & { draft?: string };

/** An actor's pane (features/page/pane-view.js's record): its parts, its actor, and what it shows of it. */
export interface Pane extends PaneParts {
  /** this page's own pane (its actor the page's selection) */
  here: boolean;
  g: string | null;
  c: string | null;
  size: number;
  view: string | null;
  details: boolean;
  agent: unknown;
  agentVersion: number;
  /** Chat's files feed: the actor it is for */
  files: { key: string } | null;
  chatSend: ChatSend;
  drawn: { main: unknown; who: string | null };
  /** its head watched for its height (heads.ts) */
  watch?: ResizeObserver;
}
/** A pane beside this page's own: its actor always given. */
export interface OtherPane extends Pane {
  g: string;
  c: string;
}

/** An app as its manifest says (the app host's), as the layout reads it. */
export interface AppManifest {
  name: string;
  label: string;
  description?: string;
  mark?: unknown;
  instances?: string;
  agent?: { offered: boolean } | null;
  opens_with_agent?: boolean;
  tools?: { handled_by: string }[];
  links?: AppLinkForm[];
  failed?: string | null;
}
/** A path of `ag://<app>/...` links an app opens (app_kit/links.py's). */
export interface AppLinkForm {
  form: string;
  paths?: boolean;
}
/** An open instance of an app (the app host's). */
export interface Instance {
  id: string;
  app: string;
  gatherer: string;
  folder: string | null;
  title: string;
  name?: string;
  data: Record<string, unknown>;
}
/** An app's panel's bridge to its frame (features/apps/host.ts's AppPane), as the layout calls it. */
export interface AppFrame {
  readonly node: HTMLElement;
  readonly frame: HTMLIFrameElement;
  refresh(): Promise<string[]>;
  destroy(): void;
  intent(kind: string, data: Record<string, unknown>): void;
  selection(sel: { gatherer: string; channel: string } | null): void;
  agents(): string[];
  agentsChanged(): void;
  actorsChanged(): void;
}
/** An app's panel (the page's record of it, panes.apps): its app and instance, its width, held out of sight or not (and
 * the tab it is kept for), its frame. */
export interface AppPanel {
  app: AppManifest;
  instance: Instance;
  g: string;
  size: number;
  held: boolean;
  kept?: string | null;
  panel: AppFrame;
  node: HTMLElement;
  frame: HTMLIFrameElement;
}

/** The page's panes (core/page/state.js's `panes`): its own (made as the layout starts), the others beside it, the apps'
 * panels, whether those kept were opened again, and the panes' heads' height. */
export interface Panes {
  here: Pane;
  others: OtherPane[];
  apps: AppPanel[];
  checked: boolean;
  top: number | null;
}

/** An open instance of an app, as the list has it (its apps read). */
export interface AppItem {
  app: AppManifest;
  id: string;
  title: string;
  name: string;
  folder: string | null;
  /** its instance, as the apps' host gave it (app-panels.ts's instOf) */
  inst: unknown;
}
