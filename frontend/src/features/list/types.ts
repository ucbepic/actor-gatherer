// What the list reads of the home (data.py's, the stream's `home`: its types generated from the server's schema,
// core/api/types.ts), and what the page tells it besides: each actor's status facts, the apps open, the reader's
// choices, what is shown.
import type * as api from "../../core/api/types";
import type { PageActor as Actor, PageHome as ListHome } from "../../core/page/types";

/** A status as the list says it: [its class, its word] ("running", "Running"). */
export type Status = readonly [cls: string, label: string];

/** A session the page started or keeps, an actor (the home's, keyed by the page), a gatherer or group with its actors, a
 * shell, an app instance's notifications, and the home itself as the page has it -- the server's, or a snapshot's
 * (core/page/types.ts). */
export type {
  AppNotices,
  PageActor as Actor,
  PageGatherer as Gatherer,
  PageHome as ListHome,
  PageSession as Session,
  PageShell as Shell,
} from "../../core/page/types";

/** What an actor waits on the reader for (data.py's `asking`), as the monitor says it. */
export type Asking = api.Ask;

/** A folder of a gatherer's tree (folders.py's), or of the gatherers' (gatherer_folders.py's). */
export type Folder = api.Folder;

/** A tree of folders: the folders, and where each item is filed (an actor by its channel, an app by its item). */
export type Tree = api.Folders;

/** A gatherer's tasks (tasks.py's): its tasks, and the task each item is in. */
export type Task = api.Task;
export type Tasks = api.Tasks;

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
