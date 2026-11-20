// What the list reads of the home (data.py's, the stream's `home`), as far as its view-model (model.ts) reads it, and
// what the page tells it besides: each actor's status facts, the apps open, the reader's choices, what is shown.

/** A status as the list says it: [its class, its word] ("running", "Running"). */
export type Status = readonly [cls: string, label: string];

/** A session the page started or keeps (sessions.py's), as the list reads it. */
export interface Session {
  session_id?: string;
  status?: string;
  queued?: unknown[];
  started_as?: string;
  terminal?: unknown;
  pid?: number | null;
  kept?: unknown;
  turns?: number;
  since?: number;
  cwd?: string;
}

/** An actor of a gatherer (data.py's), as the list reads it. */
export interface Actor {
  channel: string;
  /** its gatherer's name and channel, as the page keys it (seen.js's takeHome sets it) */
  key?: string;
  harness?: string;
  name?: { text?: string; by?: string } | null;
  last_user_message?: string | null;
  status?: string;
  running?: boolean;
  building?: boolean;
  session?: Session | null;
  role?: string | null;
  /** a coordinator agent's node ("all", "groups:<id>", "group:<name>", "folder:<id>") */
  over?: string | null;
  avatar?: string | null;
  cwd?: string | null;
  last?: number | null;
  created?: number | null;
  events?: number;
  reads?: number;
  chattable?: boolean;
  background?: { kind?: string; label?: string; id?: string }[];
  recap?: { text?: string; at?: number } | null;
}

/** An app instance's notifications, as the home has them (data.py's `app_notices`). */
export interface AppNotices {
  app?: string;
  notices?: { title?: string; text?: string; at?: number }[];
  last?: number;
}

/** A gatherer, or group (data.py's). */
export interface Gatherer {
  name: string;
  agents: Actor[];
  /** an actor on its own: a group of one (groups.py's `alone`) */
  alone?: boolean;
  last?: number | null;
  changed?: number | null;
  policy?: string;
  error?: string;
  apps?: Record<string, AppNotices>;
}

/** A folder of a gatherer's tree (folders.py's), or of the gatherers' (gatherer_folders.py's). */
export interface Folder {
  id: number;
  parent: number | null;
  name: string;
  /** closed (folders.py's `close`): when, as an ISO time */
  closed?: string | null;
}

/** A tree of folders: the folders, and where each item is filed (an actor by its channel, an app by its item). */
export interface Tree {
  folders: Folder[];
  filed: Record<string, number>;
}

/** A gatherer's tasks (tasks.py's): its tasks, and the task each item is in. */
export interface Task {
  id: number;
  name?: string;
}
export interface Tasks {
  tasks: Task[];
  tasked: Record<string, number>;
}

/** A shell (sessions.py's `shell`), listed under its gatherer. */
export interface Shell {
  id: string;
  gatherer: string;
  folder?: number | null;
  cwd: string;
  since?: number;
}

/** The home, as the list reads it. */
export interface ListHome {
  home: string;
  now?: number;
  gatherers: Gatherer[];
  hiding?: Record<string, string>;
  titles?: Record<string, string>;
  saved?: Record<string, Record<string, string>>;
  folders?: Record<string, Tree>;
  gatherer_folders?: Tree;
  places?: Record<string, { in?: string; folder?: number | null }>;
  tasks?: Record<string, Tasks>;
  shells?: Shell[];
  merged?: boolean;
}

/** An app as its manifest says (the app host's), as the list reads it. */
export interface AppManifest {
  name: string;
  label: string;
  mark?: unknown;
  access?: string;
  on_task?: string;
  instances?: string;
  failed?: string | null;
}

/** An open instance of an app, as the list has it (list.js's appOf). */
export interface AppItem {
  app: AppManifest;
  id: string;
  title: string;
  /** the user's name for it ("": none) */
  name: string;
  folder: string | null;
  group: string;
  inst: unknown;
}

/** What the list's derivations read besides their arguments: the home, and what the page knows of it. */
export interface ListCtx {
  readonly home: ListHome;
  /** a snapshot of the page: no server, nothing to press */
  readonly snapshot: boolean;
  /** the time now, in seconds (the server's clock where the home has one: its `now`) */
  now(): number;
  /** when the reader last looked at each item, by its key (seen.js's `seen.at`) */
  readonly seenAt: Readonly<Record<string, number>>;
  /** whether the actor's harness opened a turn the page shows before ag stored it (chat's `opened`) */
  opened(a: Actor): boolean;
  /** a gatherer's open app instances, as the list has them */
  apps(gname: string): AppItem[];
}
