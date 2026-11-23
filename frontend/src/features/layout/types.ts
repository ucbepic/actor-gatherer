// What the layout reads of the page around it: the home (data.py's, the stream's `home`) as far as the panes, the tasks
// shown and the start boxes read it, the page's state, and the records the page keeps of its panes and the apps' panels.
// Declared here, not imported, as a feature's TypeScript may import only core/ and its own folder (ag_dashboard/
// DESIGN.md's Rules); what fills them is handed over through link.ts.
import type { AppListed, Folders, Instance } from "../../core/api/types";
import type { PageActor, PageGatherer, PageHome as Home, Pane as PagePane } from "../../core/page/types";

/** An actor's place: its gatherer and channel. */
export type At = [string, string];
/** A status as the list says it: [its class, its word] ("running", "Running"). */
export type Status = readonly [cls: string, label: string];

// What the server sends of the home, as generated from its schema (core/api/types.ts) and as the page has it
// (core/page/types.ts): a session, what an actor asks, a gatherer, a shell, folders, tasks, a branch, a project.
export type { Ask as Asking, Branch, CheckedOut, Folder, Project, Tasks } from "../../core/api/types";
export type { PageSession as Session, PageShell as Shell } from "../../core/page/types";
/** A gatherer's folders, and where each item is filed (folders.py's tree). */
export type FolderTree = Folders;

/** An actor of a gatherer, as the home has it (core/page/types.ts) -- and, read by app-hooks.ts, fields the server does
 * not send (always absent): kept so it reads them as it did. */
export type Actor = PageActor & { closed?: boolean; started_as?: string; asked_of?: unknown };

/** A gatherer, or group (data.py's), with its actors as the layout reads them. */
export type Gatherer = Omit<PageGatherer, "agents"> & { agents: Actor[] };

/** The home as the page has it (core/page/types.ts), its gatherers' actors as the layout reads them. */
export type PageHome = Omit<Home, "gatherers"> & { gatherers: Gatherer[] };

/** Actors to pick a folder from: a gatherer, or every actor of every group (the list's everyActor). */
export interface Actors {
  agents: Actor[];
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

/** An actor's pane (features/page/pane-view.ts's record, core/page/types.ts's Pane): its parts, its actor, and what it
 * shows of it -- and its head watched for its height (heads.ts). */
export interface Pane extends PagePane {
  watch?: ResizeObserver;
}
/** A pane beside this page's own: its actor always given. */
export interface OtherPane extends Pane {
  g: string;
  c: string;
}

/** An app as its manifest says (the app host's /api/apps), a path of `ag://<app>/...` links it opens, an open instance
 * of it: as generated from the server's schema (core/api/types.ts). */
export type AppManifest = AppListed;
export type AppLinkForm = AppListed["links"][number];
export type { Instance } from "../../core/api/types";

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
