// WHAT THE LIST TAKES FROM THE PAGE AROUND IT: the page's core and shell and the other features' own -- the panes and
// their tasks, the page's data and its stream, Chat, the apps -- which a feature may not import
// (ag_dashboard/DESIGN.md's Rules). src/links/list.ts hands them over as the page starts (linkList, from src/main.ts),
// each a module's namespace, so a value one of them changes later (the work area, the actor being dragged's task) is
// read as it is now; what the list reads of each is typed here, and nothing else (checked there).
import type { AppPane as CoreAppPane, Pane } from "../../core/page/types";
import type { AnyEvent, StartMenu } from "./host";
import type { Actor, AppItem, AppManifest, Folder, Gatherer, ListHome, Shell } from "./types";

/** An actor's place: its gatherer and channel. */
export type At = [string, string];

/** The home as the page has it: the list's (the server's, or a snapshot's). */
export type PageHome = ListHome;

/** What the page started, and is starting: its gatherer, harness, and (a coordinator agent) its node. */
export interface Starting {
  gatherer?: string;
  harness?: string;
  node?: string;
}

/** The page's state (core/page/state.js), as far as the list reads and writes it. */
export interface PageState {
  home: PageHome | null;
  selected: At | null;
  /** the name being typed in the list (list.ts's naming): an actor's, a task's or an app's (`kind`), a gatherer's (c null) */
  renaming: { g: string; c: string | null; value: string; was: string; kind?: string; auto?: string } | null;
  /** a folder named in its line (folders.ts's startFolderEdit) */
  folderEdit: { g: string; id: number | null; parent: number | null; value: string; group: boolean } | null;
  adding: unknown;
  starting: Starting | null;
  paused?: boolean;
  readId?: unknown;
  followLatest?: boolean;
  context?: unknown;
  agent?: unknown;
  agentVersion?: number;
}

/** An actor's pane (core/page/types.ts's: a part of the page), and an app's panel above them. */
export type ActorPane = Pane;
export type AppPane = CoreAppPane & {
  g: string;
  instance: { gatherer: string };
  panel: { refresh(): void };
  node: HTMLElement;
};
/** A task's layout as it was left (the layout model's `left`). */
export interface TaskLeft {
  actors: string[];
  focus?: string | null;
  focusApp?: string | null;
  shut?: string | null;
  apps?: unknown[];
}
/** A start box's or menu's button, as the card's start buttons say it (features/layout/starts.ts's cardStart). */
export interface CardStart {
  key: string | null;
  disabled: boolean;
  busy: boolean;
  title: string;
  label: string;
  haspopup: string | null;
  expanded: boolean | null;
}

/** The layout's module (features/layout/panes.ts): the panes, the tasks shown and their tabs, the start buttons. */
export interface PanesPart {
  actorPanes(): ActorPane[];
  appClosed(id: string): void;
  appMarkImg(app: AppManifest): Node;
  appPaneTask(p: AppPane): string | null;
  appPanelMenu(gname: string, o: AppItem, ev: AnyEvent): void;
  appSelected(): string | null;
  appsAtWork(): void;
  appsOnlyKey(): string | null;
  appsSelected(): void;
  branchChip(g: Gatherer, a: Actor): Node | null;
  cardStart(which: "new" | "more", g: Gatherer, f: Folder | null): CardStart | null;
  cardStartPress(which: "new" | "more", g: Gatherer, f: Folder | null, button: HTMLElement): void;
  closeAppPane(p: AppPane): void;
  closePane(p: ActorPane): void;
  closePop(): void;
  closePops(): void;
  closedInTabs(k: string | null, item?: string | null): Promise<void>;
  cwdOf(a: Actor | Record<string, never>): string;
  /** a pane's head (none given: every pane's) */
  drawWho(p?: unknown): void;
  enterAppTask(gname: string, k: string): void;
  focusPane(p: ActorPane): void;
  focusedActor(): At | null;
  isAt(sel: At | readonly [string | null, string | null] | null | undefined, g: string, c: string | null): boolean;
  isAway(): boolean;
  moveEnd(): void;
  newForm(): Node;
  noHarness(): string;
  openActors(): At[];
  openCoordinator(g: Gatherer | null, node: string): void;
  /** a box (its form, the layout's: railNewBox's) or a menu hung from `button`, by its key (Pops.tsx draws it) */
  openPop(key: string, button: HTMLElement, what: object): void;
  openTaskBeside(gname: string, k: string, first: string): Promise<void>;
  paneNote(text: string): void;
  /** pane `p` drawn for the actor it is given now: its calls and view loaded */
  paneGiven(p: ActorPane): Promise<void>;
  /** task `k` shown as it was left, in place of what is shown (`focus`: the actor it opens first), as one plan */
  openTaskHere(k: string, focus: string | null, wait: boolean): Promise<void>;
  pick(gname: string, c: string, ev?: AnyEvent | Record<string, never>): Promise<void>;
  pickBeside(gname: string, c: string, ev: AnyEvent): void;
  placeIfShown(): void;
  popButton(): HTMLElement | null;
  railNewBox(g: Gatherer | null, hs: string[], harness: string, cwd: string, error: string, alone: boolean): object;
  rekeyTask(was: string, now: string): void;
  rememberTask(k: string): void;
  retarget(p: ActorPane, g: string, c: string): void;
  /** what is open: its button's key, and what it is (nothing: none) */
  readonly rowPop: { key: string; el: unknown };
  savePanes(): void;
  selectAppPane(p: AppPane): void;
  selectedTask(): string | null;
  show(gname: string, c: string, view?: string | null, wait?: boolean, shut?: boolean): Promise<void>;
  showActorsApp(g: string, c: string): void;
  showAppPanel(app: AppManifest, inst: unknown): AppPane;
  shownPanels(): { key: string }[];
  startCwd(g: Gatherer | { agents: Actor[] }): string;
  startMenu(g: Gatherer, f: Folder | null): StartMenu;
  startSession(
    gname: string,
    cwd: string,
    harness: string,
    join: (s: { session_id: string }) => Promise<void>,
  ): Promise<unknown>;
  startable(): string[];
  swapAppPane(p: AppPane, inst: unknown): void;
  readonly taskAppsOpening: Promise<unknown> | null;
  taskKey(gname: string, c: string): string | null;
  taskLayout(k: string): TaskLeft | null;
  /** the tasks laid out in this page (the layout model's), read and written as a set */
  readonly tasksLaidOut: { has(k: string): boolean; add(k: string): void; delete(k: string): void };
  viaTabs(
    k: string | null,
    ev: AnyEvent | Record<string, never> | null | undefined,
    item?: string | null,
  ): Promise<boolean>;
  readonly workPlacer: { tabs: { where(k: string): { n: number; here: boolean } | null; draw(): void } } | null;
}

/** An app's manifest as the apps' host has it (features/apps/host.ts), and an instance it opens. */
export interface AppHostPart {
  found(): AppManifest[];
  named(name: string): AppManifest | undefined;
  instanceOf(app: string, gname: string, id: string): Promise<unknown>;
  open(
    app: string,
    gname: string,
    folder: string | null,
    key?: string | null,
    reuse?: boolean,
  ): Promise<{ id: string }>;
}

/** Each part of the page the list takes, by the module it comes from. */
export interface ListPage {
  /** core/page/state.js */
  page: {
    readonly state: PageState;
    readonly panes: { others: ActorPane[]; apps: AppPane[] };
    readonly SNAPSHOT: { avatars?: Record<string, string> } | null;
    readonly PANE: unknown;
  };
  /** core/page/helpers.js: the page's marks and words */
  helpers: {
    readonly BESIDE_KEY: string;
    readonly MAC: boolean;
    readonly ICONS: Readonly<Record<string, string>>;
    readonly avatarMode: string;
    closeIcon(): Node;
    saveIcon(on: boolean): Node;
    hideIcon(): Node;
    strokeIcon(d: string, size?: number): SVGElement;
    harnessBadge(h: string): Node;
    harnessLogo(h: string | null | undefined): Node;
    harnessInfo(h: string | null | undefined): unknown;
    harnessName(h: string | null | undefined): string;
    shellPath(s: Shell): string;
  };
  /** core/page/code.js */
  code: { tildePath(path: string, home?: string): string };
  /** features/page/data.js: the home and the actor shown, loaded and drawn */
  data: {
    readonly drawn: { agents?: unknown };
    listSignature(): unknown;
    loadHome(): Promise<void>;
    redrawList(): void;
    setLive(text: string): void;
    setAbout(open: boolean): void;
    loadChat(p?: unknown): Promise<void>;
    refresh(now?: boolean): Promise<void>;
    render(now?: boolean): void;
  };
  panes: PanesPart;
  /** features/layout/new-tab.ts */
  newTab: { refreshNewTab(): void };
  /** features/chat/chat.js and files-view.js */
  chat: {
    readonly TASK_KINDS: Readonly<Record<string, string>>;
    chatAtEnd(): boolean;
    chatToEnd(): void;
    permissionVerb(asking: unknown): string;
  };
  files: {
    readonly FILE_KINDS: Readonly<Record<string, readonly [string, string]>>;
    opened(a: Actor): boolean;
    showKept(g: string, c: string): boolean;
  };
  /** features/terminal/shell.js and terminal.js */
  shell: { shownGone(c: string): void };
  terminal: { readonly term: { sid: string | null; es: { close(): void } | null } };
  /** features/settings/panel.js, and its store */
  panel: { connect(): void };
  settings: { useSettings: { getState(): { file: { open: boolean } } } };
  /** features/notify/notify.js */
  notify: {
    openNotice(gname: string, id: string, n: unknown): void;
    dismissNotice(gname: string, id: string, n: unknown): void;
    dropGone(home: PageHome): void;
    heedHome(): void;
  };
  /** features/history/history.js */
  history: { enc(s: string): string };
  /** features/apps: an app's own agent, the Apps page, the apps' host, an agent's request to install one */
  appActors: {
    appRole(s: { session?: { role?: string | null } | null }): { key: string } | null;
    actorLogo(a: Actor): Node;
    appAsked(a: Actor, text: string | null | undefined): string | null | undefined;
    appAskedOf(text: string): unknown;
  };
  appsPage: { appsChanged(): Promise<void> | void };
  /** features/apps/native.ts: what floats over a desktop Browser's page, once that page is out of sight */
  native: { onceUncovered(node: Element, wait: number, then: () => void): () => void };
  appHost: AppHostPart;
  catalog: { askedByAgent(requests: unknown[], who: (c: string) => string, done: () => void): void };
}

/** The page's parts, once linkList has handed them over (before any module of the list starts). */
export let L: ListPage = null as unknown as ListPage;
export function setListPage(link: ListPage): void {
  L = link;
}

/** The page's state; its home (there once the page has loaded it); whether it is a snapshot (no server), or a pane's
 * frame (no list of its own). */
export const S = (): PageState => L.page.state;
export const home = (): PageHome => L.page.state.home!;
export const snap = (): boolean => !!L.page.SNAPSHOT;
export const inPane = (): boolean => !!L.page.PANE;
