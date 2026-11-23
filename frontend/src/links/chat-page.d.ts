// What the Chat, History and Terminal links read of the old page's modules still plain JS (chat-page.js hands them on),
// as they are: each part typed as far as a link uses it. A module moved to TypeScript is imported directly instead, and
// its part goes.
import type { Pane } from "../core/page/types";
import type { ChatView } from "../features/chat/views";

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
