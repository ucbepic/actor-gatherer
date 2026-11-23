// What History (features/history/, TypeScript) takes from the page around it: its view and its outline's feed added among
// the panes' views (Chat's registry), the pane's actor, the page's home and whether it is paused. Filled here, at the
// app's level, before any module starts (src/page.js's linkHistory).
import * as state from "../core/page/state";
import * as helpers from "../core/page/helpers";
import type { Home } from "../core/api/types";
import type { Pane } from "../core/page/types";
import type { Pane as ChatPane } from "../features/chat/link";
import { addChatView, CHAT_FEEDS, chatView, type FeedDef } from "../features/chat/views";
import { setHistoryPage } from "../features/history/history";
import * as paneView from "../features/page/pane-view";

// The page's own pane is its reading of the same pane Chat's views draw for: handed over as Chat's.
const asChat = (p: Pane) => p as unknown as ChatPane;

export function linkHistory(): void {
  setHistoryPage<Pane>({
    snapshot: !!state.SNAPSHOT,
    icons: helpers.ICONS,
    home: () => state.state.home as Home | null,
    paused: () => !!state.state.paused,
    shown: () => paneView.allPanes().some((p) => chatView(asChat(p)).id === "history"),
    paneKey: (p) => paneView.paneKey(p),
    addFeed: (name, feed) => {
      CHAT_FEEDS[name] = feed as unknown as FeedDef; // (its pane the page's: the same as Chat's)
    },
    addView: (view) => addChatView(view),
  });
}
