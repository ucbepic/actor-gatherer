import { SNAPSHOT, state } from "../../core/page/state.js";
import { ICONS, selectedInfo } from "../../core/page/helpers.js";
import { CHAT_FEEDS, addChatView, chatView } from "../chat/views.js";
import { chatActor } from "../chat/files-view.js";
import { loadOutline, outlineOf, setHistHost } from "./data";
import { drawHistory, outlineSignature } from "./mount";

// ------------------------------------------------------------------ the History view
// The selected actor's history to look through and pick from -- its turns, grouped by the tasks ag split it into when
// the reader asks, each opening to its messages -- searched (history.py). What is picked is exported, or given to the
// Gatherer's model to summarize, or to make a memory or a skill of, with what the reader asks of it; what the model made
// is listed at the right, kept by the server (<home>/dashboard/extracts/). Drawn by React (features/history/: its frame
// HistoryView.tsx, the panel Side.tsx), for the actor this page shows; its outline fetched as data.ts says.
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  // what its data asks of the page: the view shown, the page paused (no polling then)
  setHistHost({ shown: () => chatView().id === "history", paused: () => !!state.paused });
  CHAT_FEEDS.outline = {
    load: () => loadOutline(chatActor()),
    data: () => { const h = outlineOf(chatActor()); return h ? { items: h.events, pending: [], earlier: false } : null; },
    signature: () => outlineSignature(chatActor()),
  };
  if (!SNAPSHOT) addChatView({
    id: "history", name: "History", feed: "outline", frame: "hist", chat: false, icon: ICONS.history,
    description: "Search, export and summarize the history",
    render: () => [],
    mount: ({ actor }) => {
      const info = selectedInfo() || {};
      return drawHistory({ actor, home: state.home, cwd: info.cwd || "", harness: info.harness || null, icons: ICONS,
        now: Date.now() / 1000 }, "History");
    },
  });
}

// a value put in a URL's query (the list's modes.js takes it from here)
const enc = encodeURIComponent;
export { enc };
