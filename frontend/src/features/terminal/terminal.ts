// THE TERMINAL VIEW: the session in its harness's own UI, its interactive process run by the dashboard in a
// pseudo-terminal, drawn by xterm.js (term.ts), in a frame of React's with what covers it while it does not run
// (mount.tsx, TerminalView.tsx). Showing a session in the view opens its terminal, once each time the session is chosen:
// one that exits or fails to open is not opened again until asked (a button). Once open it has the session -- the Chat
// view's message box types into it -- until it is closed (the list's close button) or exits. A message sent while none
// is open opens it too (unless the home's config says `[dashboard] chat = "headless"`), the message its first.
import { T } from "./link";
import { drawTerminal } from "./mount";
import {
  eachTerm,
  fullscreenFor as fullscreenIn,
  term,
  termFor,
  termListen,
  termOf,
  termOpen,
  termPlaced,
  termWebgl,
  xtermTheme,
  type TermActor,
} from "./term";

/** Whether a terminal the dashboard opens for `info` takes the whole screen (its harness's). */
export const fullscreenFor = (info: TermActor): boolean => fullscreenIn(T().home(), info);

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  const page = T();
  window.addEventListener("ag-theme", () => {
    for (const t of eachTerm()) t.xterm.options.theme = xtermTheme();
  });
  if (page.snapshot || !window.Terminal || !window.FitAddon) return;
  page.addView({
    id: "terminal",
    name: "Terminal",
    feed: "none",
    frame: "xterm-frame",
    icon: page.icons.terminal,
    description: "The harness's own interface, in a terminal.",
    render: () => [],
    mount: ({ actor, info, held }) => {
      const home = page.home(),
        none = !!home && home.terminals === false;
      const t = none ? null : termFor(info.channel),
        running = !!(info.session && info.session.terminal);
      if (t) {
        if (running) {
          termListen(info.channel); // seen open: once it ends (closed), not opened again here
          t.tried = true;
        }
        const open = !running && !held && !t.tried && page.hasChat(info);
        if (open) t.tried = true;
        termPlaced(t, open ? () => termOpen(info) : undefined); // drawn into the page: opened there once, then fitted
      }
      return drawTerminal(
        {
          key: actor,
          none,
          running,
          held: held || "",
          readOnly: page.hasChat(info) ? "" : page.readOnlyWhy(),
          exited: t ? t.exited : null,
          error: t ? t.error : "",
          open: () => termOpen(info),
        },
        t && t.host,
        "Terminal",
      );
    },
    composer: () => [],
  });
}

export { term, termFor, termListen, termOf, termWebgl };
