// WHAT THE LAYOUT TAKES FROM THE PAGE AROUND IT: the old page's modules (plain JS: its state, its helpers, its data, the
// panes' views, Chat's) and the other features' own (the list, the apps' host, Chat's actors, the terminal), which a
// feature's TypeScript may not import (ag_dashboard/DESIGN.md's Rules). src/links/layout.ts hands them over as the page
// starts (setLayoutPage, from src/page.js, before any module starts), each a module's namespace, so a value one of them
// changes later (the list's mode, the row being dragged) is read as it is then; what the layout reads of each is typed
// here, and nothing else. It shrinks as those modules move.
import type { PaneParts } from "./pane";
import type {
  Actor,
  Actors,
  AppFrame,
  AppItem,
  AppManifest,
  Asking,
  At,
  Folder,
  FolderTree,
  Gatherer,
  Instance,
  Pane,
  Panes,
  PageState,
  Status,
} from "./types";

/** An app's panel's hooks into the page (features/apps/host.ts's PaneHooks), as the layout fills them. */
export interface AppFrameHooks {
  close: () => void;
  intent: (kind: string, data: Record<string, unknown>, from: { instance: Instance }) => Promise<void>;
  openLink: (href: string, from: { instance: Instance }) => Promise<unknown> | void;
  selection: () => { gatherer: string; channel: string } | null;
  agents: (g: string) => { channel: string; name: string }[];
  agentState: (g: string, c: string) => Record<string, unknown> | null;
  send: (g: string, c: string, text: string) => Promise<unknown>;
  answer: (g: string, c: string, call: string, choice: unknown) => Promise<unknown>;
  interrupt: (g: string, c: string) => Promise<unknown>;
  focusAgent: (g: string, c: string) => void;
  actors: () => {
    gatherers: { name: string; agents: Record<string, unknown>[] }[];
    home_dir: string;
    cwd: string;
  };
  sendActor: (g: string, c: string, text: string) => Promise<{ channel: string }>;
  startActor: (g: string, harness: string, folder: string, text: string) => Promise<{ channel: string }>;
  showActor: (g: string, c: string) => Promise<unknown> | void;
  pressed: () => void;
}

/** The apps' host (features/apps/host.ts): the apps found, their instances. */
export interface AppHostPart {
  load(gatherer?: string): Promise<unknown>;
  found(): AppManifest[];
  named(name: string): AppManifest | undefined;
  open(app: string, gatherer: string, folder: string | null, channel?: string | null): Promise<Instance>;
  instanceOf(app: string, gatherer: string, id: string): Promise<Instance | null>;
  attachedTo(gatherer: string, channel: string): Promise<Instance[]>;
  start(
    app: string,
    gatherer: string,
    cwd: string,
    harness: string,
  ): Promise<{ session: { session_id: string }; instance: Instance }>;
  handlers(kind: string, mediaType?: string): AppManifest[];
}

/** A link to something in an app, read (features/apps/links.ts). */
export interface AppLinksPart {
  readonly FILE_FORM: string;
  parseHref(
    href: string,
  ): { app: string; path: string; href: string; instance?: string | null; part?: string | null } | null;
  isAppHref(href: string): boolean;
  matchPath(forms: AppManifest["links"], path: string): { values: unknown; form: unknown } | null;
  filePath(href: string): { path: string; line: number } | null;
  joinPath(from: string, path: string): string;
  fileHref(app: string, path: string, line?: number): string;
}

/** What a minimized pane's footer is drawn from (features/chat/chat.js's card context). */
export interface MiniCtx {
  pane: Pane;
  info: Actor | null;
  running?: boolean;
}

/** Each part of the page the layout takes, by the module it comes from. */
export interface LayoutPage {
  /** core/page/state.js: the page's state, its panes, whether it is a snapshot, how many panes fit */
  page: {
    readonly state: PageState;
    readonly panes: Panes;
    readonly SNAPSHOT: unknown;
    readonly MAX_PANES: number;
  };
  /** core/page/helpers.js: the page's marks, built as nodes */
  helpers: {
    readonly ICONS: Readonly<Record<string, string>>;
    readonly HUE_MAIN: Readonly<Record<string, string>>;
    readonly MAC: boolean;
    el(tag: string, attrs?: Record<string, unknown>, ...kids: (Node | string | null | undefined)[]): HTMLElement;
    strokeIcon(d: string, size?: number): SVGElement;
    harnessBadge(h: string | null | undefined): Node;
    harnessLogo(h: string | null | undefined): Node;
    harnessInfo(h: string | null | undefined): { mcp?: boolean } | null;
    harnessName(h: string | null | undefined): string;
    runsHere(h: string): boolean;
    runnableNames(join: string): string;
    bareAvatar(a: Actor | null): string | null;
    doneCheck(): Node;
    restDelay(a: Actor | null, turn: number): string | null;
  };
  /** features/page/data.js: the home and each pane's actor, loaded; what the page says in passing; Chat's drafts */
  data: {
    loadAgent(p: Pane): Promise<unknown>;
    loadChat(p?: Pane): Promise<unknown>;
    loadHome(): Promise<unknown>;
    setAbout(open: boolean): void;
    setLive(text: string): void;
    drafts(): Record<string, string>;
    fitBox(box: HTMLTextAreaElement): void;
    keepDraft(k: string, text: string): void;
  };
  /** features/settings/panel.js: each pane's actor on the page's stream */
  panel: { connect(): void };
  /** features/page/main-view.js and pane-view.js: a pane drawn, made, found */
  mainView: { drawPane(p: Pane, later?: boolean): void };
  paneView: {
    allPanes(): Pane[];
    makePane(
      parts: PaneParts,
      here: boolean,
      opts: { g?: string; c?: string; view?: string | null; size?: number },
    ): Pane;
    paneAt(node: EventTarget | null | undefined): Pane | null;
    paneBox(p: Pane | null): HTMLTextAreaElement | null;
    paneInfo(p: Pane | null): Actor | null;
    paneOf(g: string, c: string): Pane | null;
  };
  /** features/chat: what an actor asks, and where it is answered; a pane's views; a minimized pane's lines */
  chat: {
    askKey(ask: Asking): string;
    askWhere(a: Actor, ask: Asking): { here: boolean };
    chatToEnd(p: Pane): void;
    chatOf(actor: string): { picked: number | null };
    showTurn(actor: string, n: number | null): void;
  };
  views: {
    readonly CHAT_VIEWS: ReadonlyMap<string, unknown>;
    readonly CHAT_VIEW_KEY: string;
    chatView(p: Pane): { id: string };
    setChatView(p: Pane, id: string): Promise<unknown>;
  };
  mini: {
    readonly miniCard: { shut(): void };
    miniHistory(ctx: MiniCtx): Node | null;
    miniRest(ctx: MiniCtx): { row_id: number } | null;
  };
  /** features/terminal: the terminal a session's pane draws, if one is kept */
  terminal: {
    termOf(sid: string): { opened: boolean; host: HTMLElement; xterm: { cols: number; rows: number } } | null;
  };
  /** features/apps: an app's own agent; the Apps page; the apps' host; links to apps */
  appActors: {
    actorLogo(a: Actor): Node;
    appAsked(a: Actor, text: string): string;
    appAskedOf(text: string): unknown;
    appRole(a: Actor | undefined): { app: string; key: string } | null;
  };
  appsPage: { drawAppsPage(box: HTMLElement): void; openAppsPage(): void };
  appHost: AppHostPart;
  /** an app's panel made (host.ts's AppPane), for an app the host found */
  newPanel(app: AppManifest, instance: Instance, hooks: AppFrameHooks): AppFrame;
  appLinks: AppLinksPart;
  /** features/list: what is shown and how, its tasks and apps, folders, coordinator agents */
  list: {
    readonly APP_ITEM: string;
    readonly MANAGER: string;
    readonly listDrag: { g: string; cs: string[] | null; offered?: boolean } | null;
    readonly appsKnown: ReadonlyMap<string, { instances: { id: string }[] }>;
    readonly collapsed: { delete(name: string): unknown };
    readonly crewHidden: { has(k: string): boolean };
    readonly startIn: { g: string | null; folder: number | null };
    actorOf(g: Gatherer, c: string): Actor | null | undefined;
    actorTitle(a: Actor): string;
    actorsWithin(g: Gatherer, folder: number): Actor[];
    aimStart(gname: string, folder: number | null): void;
    appInfo(gname: string, id: string): AppItem | null;
    appItem(id: string): string;
    appMarkOf(o: AppItem): HTMLElement;
    appShown(o: AppItem): string;
    appStatusOf(gname: string, id: string): Status | null;
    appTaskOf(gname: string, id: string): number | null;
    byName(a: string, b: string): number;
    crewAt(node: string, g?: Gatherer | null): [Gatherer, Actor] | [null, null];
    crewFace(a: Actor | null | undefined, fallback?: string | null): HTMLElement;
    crewHideKey(node: string): string;
    crewPlace(node: string, g?: Gatherer | null): string;
    fileStarted(gname: string, channel: string): Promise<unknown>;
    folderById(gname: string, id: number | null | undefined): Folder | null;
    folderPost(gname: string, body: Record<string, unknown>, local: (tree: FolderTree) => void): Promise<unknown>;
    gathererApps(gname: string): AppItem[];
    groupCrew(g: Gatherer): Actor | null;
    isAppItem(k: string | null | undefined): boolean;
    isCoordinator(a: Actor): boolean;
    kidFolders(gname: string, parent: number | null): Folder[];
    openUp(tree: FolderTree, id: number | null): void;
    readApps(gname: string, now?: boolean): Promise<void>;
    renderAgents(): void;
    retask(was: string | null): void;
    savedAs(gname: string, a: Actor): string | null;
    selectApp(gname: string, o: AppItem, ev?: Record<string, never> | null): Promise<unknown>;
    setCrewHidden(name: string, hide: boolean): void;
    shellFolder(gname: string): number | null;
    shellLogo(): HTMLElement;
    showItemsTask(g: Gatherer, c: string): Promise<unknown>;
    shownClosed(g: Gatherer, f: Folder): boolean;
    taskActors(g: Gatherer, t: number): Actor[];
    taskApps(g: Gatherer, t: number): AppItem[];
    taskById(gname: string, t: number): { id: number } | null | undefined;
    taskLead(g: Gatherer, t: number): Actor | null | undefined;
    taskMembers(g: Gatherer, t: number): Actor[];
    taskName(g: Gatherer, t: { id: number }): string;
    taskOf(gname: string, a: Actor): number | null;
    titleOf(g: Gatherer): string;
    within(tree: unknown, folder: number | null, id: number): boolean;
  };
  /** the list's task `id` of `gname` opened, as a click on its row (`ev`: the click's keys -- ⌘ beside -- and whether the
   * screen tabs routed it already) opens it */
  openTask(
    gname: string,
    id: number,
    item: string | null,
    ev: { metaKey?: boolean; inTabs?: boolean },
  ): Promise<unknown>;
  seen: { markSeen(): void; statusOf(a: Actor): Status };
  gathererFolders: { readonly GF: unknown; gfOf(name: string): number | null };
  groupMoves: { readonly ALONE_NEW: string; everyActor(): Actors; aloneUnder(): Gatherer | null };
  modes: {
    readonly listMode: string;
    cardRelease(): void;
    select(g: string, c: string): Promise<void>;
    setListMode(to: string): void;
  };
  menus: { readonly PRESSED_AWAY: string };
}

/** The page's parts, once setLayoutPage has handed them over (before any module of the page starts). */
export let L: LayoutPage = null as unknown as LayoutPage;
/** The page's state and its panes: core/page/state.js's objects, the same from start to end. */
export let state: PageState = null as unknown as PageState;
export let panes: Panes = null as unknown as Panes;

export function setLayoutPage(link: LayoutPage): void {
  L = link;
  state = link.page.state;
  panes = link.page.panes;
}

/** Whether the page is a snapshot (its data inside it, no server), and how many actors' panes fit side by side. */
export const snap = (): boolean => !!L.page.SNAPSHOT;
export const maxPanes = (): number => L.page.MAX_PANES;
/** The list drawn again: its marks, the tasks open, the actor in focus. */
export const renderAgents = (): void => L.list.renderAgents();
/** A gatherer of the home now, by its name. */
export const gathererNamed = (name: string): Gatherer | null =>
  state.home?.gatherers.find((x) => x.name === name) ?? null;
/** An actor's status, as the list says it. */
export const statusOf = (a: Actor): Status => L.seen.statusOf(a);
/** Whether `sel` is actor `c` of `g`. */
export const isAt = (
  sel: At | readonly [string | null, string | null] | null | undefined,
  g: string,
  c: string | null,
) => !!sel && sel[0] === g && sel[1] === c;
