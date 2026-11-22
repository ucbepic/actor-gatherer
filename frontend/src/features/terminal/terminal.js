import { SNAPSHOT, state } from "../../core/page/state";
import { ICONS, hasChat } from "../../core/page/helpers";
import { refresh } from "../page/data";
import { linkClicked } from "../layout/panes";
import { paneInfo, paneWith } from "../page/pane-view";
import { readOnlyWhy } from "../chat/chat";
import { addChatView } from "../chat/views";
import { shownGone } from "./shell";
import {
  eachTerm, fullscreenFor as fullscreenIn, setTermHost, term, termFor, termListen, termOf, termOpen, termPlaced, termWebgl,
  xtermTheme,
} from "./term";
import { drawTerminal } from "./mount";

// ------------------------------------------------------------------ the Terminal view
// The session in its harness's own UI: its interactive process, run by the dashboard in a pseudo-terminal, drawn by
// xterm.js (features/terminal/term.ts), in a frame of React's with what covers it while it does not run (mount.tsx,
// TerminalView.tsx). Showing a session in the view opens its terminal, once each time the session is chosen: one that
// exits or fails to open is not opened again until asked (a button). Once open it has the session -- the Chat view's
// message box types into it -- until it is closed (the list's close button) or exits. A message sent while none is open
// opens it too (unless the home's config says `[dashboard] chat = "headless"`), the message its first.
const fullscreenFor = (info) => fullscreenIn(state.home, info);
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  // each terminal's session, as the pane showing it has it
  setTermHost({ info: (sid) => paneInfo(paneWith(sid)), gatherer: (sid) => (paneWith(sid) || {}).g || null,
    home: () => state.home, refresh: () => refresh(),
    linkClicked: (uri, ev, sid) => linkClicked(uri, ev, false, paneWith(sid)), shellGone: shownGone,
    here: () => (state.selected ? state.selected[1] : null) });
  window.addEventListener("ag-theme", () => { for (const t of eachTerm()) t.xterm.options.theme = xtermTheme(); });
  if (!SNAPSHOT && window.Terminal && window.FitAddon) addChatView({
    id: "terminal", name: "Terminal", feed: "none", frame: "xterm-frame", icon: ICONS.terminal,
    description: "The harness's own interface, in a terminal.",
    render: () => [],
    mount: ({ actor, info, held }) => {
      const none = !!state.home && state.home.terminals === false;
      const t = none ? null : termFor(info.channel), running = !!(info.session && info.session.terminal);
      if (t) {
        if (running) { termListen(info.channel); t.tried = true; }   // seen open: once it ends (closed), not opened again here
        const open = !running && !held && !t.tried && hasChat(info);
        if (open) t.tried = true;
        termPlaced(t, open ? () => termOpen(info) : undefined);   // drawn into the page: opened there once, then fitted to it
      }
      return drawTerminal({ key: actor, none, running, held: held || "", readOnly: hasChat(info) ? "" : readOnlyWhy(),
        exited: t ? t.exited : null, error: t ? t.error : "", open: () => termOpen(info) }, t && t.host, "Terminal");
    },
    composer: () => [],
  });
}

export { fullscreenFor, term, termFor, termListen, termOf, termWebgl };
