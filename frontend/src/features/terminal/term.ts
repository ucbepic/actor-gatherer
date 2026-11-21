// A session's terminal in the page: its interactive process, run by the dashboard in a pseudo-terminal (sessions.py's
// `terminal`), drawn by xterm.js (vendored: index.html's <!--VENDOR-->, `window.Terminal`) -- one at a time, its node kept
// across the page's draws (moved, never made again), so what it shows, its scroll and its focus stay. What the process
// prints comes on a stream of its own; what is typed goes to it in order. A shell's pane (shell.js) draws the same.
import { post } from "../../core/api/client";
import { stream, type Stream } from "../../core/api/stream";
import type { Home } from "../../core/api/types";
import { harnessOf } from "../../core/model/harness";
import { isShell } from "../../core/model/keys";

interface XTerm {
  cols: number;
  rows: number;
  options: { theme: unknown };
  open(el: HTMLElement): void;
  focus(): void;
  reset(): void;
  write(data: Uint8Array | string): void;
  dispose(): void;
  loadAddon(addon: unknown): void;
  onData(f: (d: string) => void): void;
  onResize(f: (size: { cols: number; rows: number }) => void): void;
}
interface Fit {
  fit(): void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
}
declare global {
  interface Window {
    Terminal?: new (options: object) => XTerm;
    FitAddon?: { FitAddon: new () => Fit };
    WebglAddon?: { WebglAddon: new () => { onContextLoss(f: () => void): void; dispose(): void } };
  }
}

/** The actor whose terminal it is, as far as it is read here. */
export interface TermActor {
  channel: string;
  harness?: string | null;
  session?: { session_id?: string; terminal?: unknown; harness?: string | null } | null;
}

/** What the terminal asks of the page: the actor shown, its group, its data loaded again, a link clicked in it, a shell
 * that ended. */
export interface TermHost {
  info(): TermActor | null;
  gatherer(): string | null;
  home(): Home | null;
  refresh(): unknown;
  linkClicked(uri: string, ev: MouseEvent): boolean;
  shellGone(sid: string): unknown;
}
let host: TermHost | null = null;
export const setTermHost = (h: TermHost) => {
  host = h;
};

// The terminal's colors: the page's terminal colors, and a 16-color palette for each theme made from them.
const ANSI = {
  dark: {
    black: "#3a3935",
    red: "#ff6b80",
    green: "#4eba65",
    yellow: "#e8b600",
    blue: "#7cb7ff",
    magenta: "#e58fb6",
    cyan: "#4fc1c9",
    white: "#c3c2b7",
    brightBlack: "#8f8c84",
    brightRed: "#ff8fa0",
    brightGreen: "#7fd492",
    brightYellow: "#f2cc3a",
    brightBlue: "#a6cdff",
    brightMagenta: "#f0a8c8",
    brightCyan: "#7fd8de",
    brightWhite: "#ecebe7",
    selectionBackground: "rgba(124,183,255,.28)",
  },
  light: {
    black: "#2b2a27",
    red: "#cf3a50",
    green: "#2f9a4c",
    yellow: "#a87700",
    blue: "#2468c8",
    magenta: "#b8437a",
    cyan: "#13858d",
    white: "#a09d95",
    brightBlack: "#6f6c65",
    brightRed: "#a5293d",
    brightGreen: "#1b6b34",
    brightYellow: "#8a6200",
    brightBlue: "#1a4f9c",
    brightMagenta: "#8f2f5d",
    brightCyan: "#0e6870",
    brightWhite: "#55544f",
    selectionBackground: "rgba(36,104,200,.20)",
  },
};

export function xtermTheme() {
  const css = getComputedStyle(document.documentElement),
    v = (n: string) => css.getPropertyValue(n).trim();
  const ink = v("--term-ink");
  return {
    ...ANSI[css.colorScheme === "dark" ? "dark" : "light"],
    background: v("--term-bg"),
    foreground: ink,
    cursor: ink,
    cursorAccent: v("--term-bg"),
  };
}

/** The screen a session's terminal runs in, as its harness says (harness_kit's `fullscreen`): its full screen, which
 * scrolls by sending each wheel tick to the harness, which redraws; or its classic one, inline, printed into xterm's own
 * scrollback and scrolled here. */
export const fullscreenFor = (home: Home | null, info: TermActor): boolean =>
  (harnessOf(home, info.harness || info.session?.harness) as { fullscreen?: boolean } | null)?.fullscreen !== false;

// A mouse report for the pointer moving with no button held (SGR: ESC [ < b;x;y M, motion bit 32, button 3): with
// any-motion tracking on, every move over the terminal is one, and each would share the one-at-a-time input with the
// wheel. The harness is given clicks, drags and the wheel, not the bare moves.
// eslint-disable-next-line no-control-regex -- a terminal's escape (ESC [ <), matched
const BARE_MOVE = /\x1b\[<(\d+);\d+;\d+M/g;
const dropBareMoves = (d: string) =>
  d.includes("\x1b[<") ? d.replace(BARE_MOVE, (m, b) => (+b & 32 && (+b & 3) === 3 ? "" : m)) : d;

/** The terminal shown: whose (`sid`), its xterm and node, its stream, how it went. */
export interface Term {
  sid: string | null;
  xterm: XTerm | null;
  fit: Fit | null;
  host: (HTMLElement & { agFocus?: () => void }) | null;
  es: Stream | null;
  opened: boolean;
  exited: number | null;
  unsent: string;
  sending: boolean;
  error: string;
  tried: boolean;
}

export const term: Term = {
  sid: null,
  xterm: null,
  fit: null,
  host: null,
  es: null,
  opened: false,
  exited: null,
  unsent: "",
  sending: false,
  error: "",
  tried: false,
};

// A link in the terminal clicked (one a program marks as a link): in a Browser of the actor's task, as a link in a message
// (the page's linkClicked); else as xterm would, the address asked about first.
const LINKS = {
  activate(ev: MouseEvent, uri: string) {
    if (host?.linkClicked(uri, ev)) return;
    if (!confirm(`Do you want to navigate to ${uri}?\n\nWARNING: This link could potentially be dangerous`)) return;
    const w = window.open();
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* as it is */
      }
      w.location.href = uri;
    }
  },
};

/** The terminal of `sid`: the one kept, or a new one in place of another's. */
export function termFor(sid: string): Term {
  if (term.sid === sid && term.xterm) return term;
  termDrop();
  const xterm = new window.Terminal!({
    cursorBlink: true,
    fontSize: 13,
    scrollback: 5000,
    allowProposedApi: false,
    linkHandler: LINKS,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    theme: xtermTheme(),
  });
  const fit = new window.FitAddon!.FitAddon();
  xterm.loadAddon(fit);
  const node: Term["host"] = Object.assign(document.createElement("div"), {
    className: "xterm-host",
    id: "xterm-host",
  });
  node.dataset.refocus = "1";
  node.agFocus = () => xterm.focus();
  Object.assign(term, { sid, xterm, fit, host: node, opened: false, exited: null, error: "", tried: false });
  // to the session by its id now, not the one it opened under: a session renamed since is typed to under its new one
  xterm.onData((d) => {
    d = dropBareMoves(d);
    if (d && term.xterm === xterm) termType(term.sid!, d);
  });
  xterm.onResize(({ cols, rows }) => {
    if (term.xterm === xterm && termRunning(term.sid!))
      post("/api/terminal/resize", { session_id: term.sid, cols, rows }).catch(() => {});
  });
  new ResizeObserver(() => {
    if (!node.isConnected || !node.clientWidth) return;
    try {
      fit.fit();
    } catch {
      /* not shown yet */
    }
  }).observe(node);
  return term;
}

/** Drawn with WebGL where the browser has it: far faster than the DOM when the whole screen is redrawn, as full screen
 * does on every scroll. Without it, or once its context is lost, the DOM draws. */
export function termWebgl(t: Term): void {
  if (!window.WebglAddon) return;
  try {
    const gl = new window.WebglAddon.WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    t.xterm!.loadAddon(gl);
  } catch {
    /* no WebGL here: the DOM draws */
  }
}

function termDrop() {
  term.es?.close();
  term.xterm?.dispose();
  Object.assign(term, {
    sid: null,
    xterm: null,
    fit: null,
    host: null,
    es: null,
    opened: false,
    exited: null,
    unsent: "",
    tried: false,
  });
}

const termRunning = (sid: string): boolean => {
  if (isShell(sid)) return term.sid === sid && term.exited === null;
  const info = host?.info();
  return !!(info && info.channel === sid && info.session && info.session.terminal);
};

/** What is typed, to the process, in order: one request at a time (two at once could arrive swapped), and what is typed
 * while one is on its way goes together in the next -- fast typing is a few requests, not a queue. */
function termType(sid: string, data: string) {
  if (!termRunning(sid)) return;
  term.unsent += data;
  if (!term.sending) void termSend();
}

async function termSend() {
  term.sending = true;
  while (term.unsent && term.sid) {
    // each batch to the terminal shown when it goes
    const data = term.unsent,
      sid = term.sid;
    term.unsent = "";
    try {
      await post("/api/terminal/input", { session_id: sid, data });
    } catch {
      /* the terminal is gone: its end shows */
    }
  }
  term.sending = false;
}

/** What the process prints: everything kept at first (a page that comes back sees the screen), then as it comes. */
export function termListen(sid: string): void {
  if (term.es || window.AG_SNAPSHOT) return;
  const es = stream(`/api/terminal?session_id=${encodeURIComponent(sid)}`);
  term.es = es;
  if (term.opened)
    // one opened elsewhere (a message sent): at the size drawn here
    post("/api/terminal/resize", { session_id: sid, cols: term.xterm!.cols, rows: term.xterm!.rows }).catch(() => {});
  const mine = () => term.es === es && term.sid === sid;
  es.addEventListener("out", (ev) => {
    if (!mine()) return;
    const got = JSON.parse((ev as MessageEvent).data);
    if (got.reset) term.xterm!.reset();
    term.xterm!.write(Uint8Array.from(atob(got.data), (c) => c.charCodeAt(0)));
  });
  const ended = (ev: Event) => {
    if (!mine()) return;
    es.close();
    term.es = null;
    if (isShell(sid)) {
      term.exited = ev.type === "exit" ? JSON.parse((ev as MessageEvent).data).code : -1;
      return host?.shellGone(sid);
    }
    if (ev.type === "exit") {
      term.exited = JSON.parse((ev as MessageEvent).data).code;
      term.xterm!.write("\r\n\x1b[2m[the session's process ended]\x1b[0m\r\n");
    } else if (term.exited === null) term.exited = -1; // gone before it was listened to: ended all the same
    host?.refresh();
  };
  es.addEventListener("exit", ended);
  es.addEventListener("none", ended);
}

/** The session's terminal opened, at the size its node was just fitted to. */
export async function termOpen(info: TermActor): Promise<void> {
  const t = termFor(info.channel),
    xterm = t.xterm!;
  t.tried = true;
  const dims = t.fit?.proposeDimensions() || { cols: 120, rows: 32 };
  t.error = "";
  t.exited = null;
  try {
    await post("/api/terminal", {
      ...(info.session
        ? { session_id: info.session.session_id }
        : { gatherer: host?.gatherer(), channel: info.channel }),
      cols: dims.cols,
      rows: dims.rows,
      fullscreen: fullscreenFor(host?.home() ?? null, info),
    });
    xterm.reset();
    // listened to at once, not once the list says it runs: one that ends straight away (its harness refusing to start)
    // shows what it printed and its end, with "Open again", rather than "Opening the terminal…" for good
    if (term.xterm === xterm) termListen(info.channel);
  } catch (err) {
    t.error = (err as Error).message;
  }
  await host?.refresh();
  if (termRunning(info.channel) && (xterm.cols !== dims.cols || xterm.rows !== dims.rows))
    // fitted again meanwhile
    post("/api/terminal/resize", { session_id: info.channel, cols: xterm.cols, rows: xterm.rows }).catch(() => {});
  xterm.focus();
}

/** Once its node is on the page (after the page's draw): opened there the first time, then fitted to it. */
export function termPlaced(t: Term, then?: () => void): void {
  requestAnimationFrame(() => {
    if (!t.host?.isConnected) return;
    if (!t.opened) {
      t.xterm!.open(t.host);
      t.opened = true;
      termWebgl(t);
    }
    try {
      t.fit!.fit();
    } catch {
      /* not shown */
    }
    then?.();
  });
}
