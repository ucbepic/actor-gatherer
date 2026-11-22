// What the Chat, History and Terminal links read of the old page's modules (chat-page.js hands them on), as they are: each
// part typed as far as a link uses it. A module moved to TypeScript is imported directly instead, and its part goes.
import type { Home } from "../core/api/types";
import type { Actor } from "../features/chat/types";
import type { Pane } from "../features/chat/link";
import type { ChatView } from "../features/chat/views";

/** core/page/state.js */
export declare const state: {
  readonly SNAPSHOT: { avatars?: Record<string, string> } | null;
  readonly state: {
    home: (Omit<Home, "gatherers"> & { terminals?: boolean; gatherers: { name: string; agents: Actor[] }[] }) | null;
    selected: [string, string] | null;
    paused: boolean;
    stream: { readyState: number } | null;
  };
  readonly panes: { here: Pane; others: Pane[] };
};

/** core/page/helpers.js */
export declare const helpers: {
  readonly ICONS: Readonly<Record<string, string>>;
  readonly BESIDE_KEY: string;
  readonly avatarMode: string;
  harnessName(h: string | null | undefined): string;
  harnessLogo(h: string | null | undefined): Node;
  harnessBadge(h: string | null | undefined): Node;
  hasChat(a: Actor): boolean;
  runnableNames(join: string): string;
  el(tag: string, attrs?: Record<string, unknown>, ...kids: unknown[]): HTMLElement;
  svgEl(tag: string, attrs?: Record<string, unknown>): Element;
};

/** features/page/data.js */
export declare const data: {
  readonly earlierTurns: string;
  render(now?: boolean): void;
  refresh(now?: boolean): Promise<void>;
  loadChat(p?: Pane): Promise<void>;
  fitBox(box: HTMLTextAreaElement): void;
  setLive(text: string): void;
};

/** features/page/main-view.js */
export declare const mainView: {
  readonly DETAILS_TIP: string;
  drawPane(p: Pane, end?: boolean): void;
  renderPane(p: Pane): void;
  setDetails(p: Pane, open: boolean, part?: string): void;
  dashboardCommand(text: string, p: Pane): boolean;
  callsNow(): { actor: string | null; gatherer: string; agent: unknown; snapshot: boolean };
};

/** features/page/pane-view.js */
export declare const paneView: {
  allPanes(): Pane[];
  paneKey(p: Pane | null | undefined): string | null;
  paneInfo(p: Pane | null | undefined): Actor | null;
  paneOf(g: string, c: string): Pane | null;
  paneWith(c: string): Pane | null;
  paneAt(node: Node | null): Pane | null;
  drawingPane(): Pane;
};

/** features/layout/top.js */
export declare const top: {
  readonly MIN_TIP: string;
  readonly MINI_VIEW: ChatView;
  readonly ME_MARKS: Readonly<Record<string, readonly [string, string]>>;
  chatMin(p: Pane): boolean;
  canMinimize(p: Pane): boolean;
  setChatMin(p: Pane, on: boolean): void;
  topShown(): boolean;
};

/** features/layout/panes.js */
export declare const layout: {
  savePanes(): void;
  closePane(p: Pane): void;
  closeHere(): void;
  linkClicked(uri: string, ev: MouseEvent, path: boolean, p: Pane | null): boolean;
};

/** features/settings/panel.js */
export declare const settings: { connect(): void };

/** features/apps/app-actors.js */
export declare const appActors: {
  appWordsOf(text: string): Node | null;
  actorLogo(a: Actor): Node;
};
