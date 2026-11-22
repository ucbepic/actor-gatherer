// What History (features/history/, TypeScript) takes from the page around it: its view and its outline's feed added among
// the panes' views (Chat's registry), the pane's actor, the page's home and whether it is paused. Filled here, at the
// app's level, before any module starts (src/page.js's linkHistory).
import type { Pane } from "../features/chat/link";
import { addChatView, CHAT_FEEDS, chatView } from "../features/chat/views";
import { setHistoryPage } from "../features/history/history";
import { helpers, paneView, state } from "./chat-page";

export function linkHistory(): void {
  setHistoryPage<Pane>({
    snapshot: !!state.SNAPSHOT,
    icons: helpers.ICONS,
    home: () => state.state.home,
    paused: () => !!state.state.paused,
    shown: () => paneView.allPanes().some((p) => chatView(p).id === "history"),
    paneKey: (p) => paneView.paneKey(p),
    addFeed: (name, feed) => {
      CHAT_FEEDS[name] = feed;
    },
    addView: (view) => addChatView(view),
  });
}
