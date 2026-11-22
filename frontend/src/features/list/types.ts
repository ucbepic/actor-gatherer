// What the list reads of the home (data.py's, the stream's `home`: its types generated from the server's schema,
// core/api/types.ts), and what the page tells it besides: each actor's status facts, the apps open, the reader's
// choices, what is shown.
import type * as api from "../../core/api/types";

/** A status as the list says it: [its class, its word] ("running", "Running"). */
export type Status = readonly [cls: string, label: string];

/** A session the page started or keeps (sessions.py's). */
export type Session = api.Session;

/** An actor of a gatherer (data.py's), as the home has it -- and the page's key for it, its gatherer and channel
 * (seen.ts's takeHome sets it). */
export type Actor = api.Actor & { key?: string };

/** What an actor waits on the reader for (data.py's `asking`), as the monitor says it. */
export type Asking = api.Ask;

/** An app instance's notifications, as the home has them (data.py's `app_notices`). */
export type AppNotices = api.AppNotices;

/** A gatherer, or group (data.py's), with its actors as the list has them. */
export type Gatherer = Omit<api.Gatherer, "agents"> & { agents: Actor[] };

/** A folder of a gatherer's tree (folders.py's), or of the gatherers' (gatherer_folders.py's). */
export type Folder = api.Folder;

/** A tree of folders: the folders, and where each item is filed (an actor by its channel, an app by its item). */
export type Tree = api.Folders;

/** A gatherer's tasks (tasks.py's): its tasks, and the task each item is in. */
export type Task = api.Task;
export type Tasks = api.Tasks;

/** A shell (sessions.py's `shell`), listed under its gatherer. */
export type Shell = api.Shell;

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

/** The home, as the list has it: the server's, its actors keyed by the page -- or a snapshot's, without what only a
 * running dashboard sends. */
export type ListHome = Omit<api.Home, Served | "gatherers"> &
  Partial<Pick<api.Home, Served>> & { gatherers: Gatherer[] };

/** An app as its manifest says (the app host's), as the list reads it. */
export type AppManifest = Pick<
  api.AppListed,
  "name" | "label" | "mark" | "access" | "on_task" | "instances" | "failed"
>;

/** An open instance of an app, as the list has it (apps.ts's appOf). */
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
  /** when the reader last looked at each item, by its key (seen.ts's `seen.at`) */
  readonly seenAt: Readonly<Record<string, number>>;
  /** whether the actor's harness opened a turn the page shows before ag stored it (chat's `opened`) */
  opened(a: Actor): boolean;
  /** a gatherer's open app instances, as the list has them */
  apps(gname: string): AppItem[];
}
