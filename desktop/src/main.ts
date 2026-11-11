// The ag desktop app (desktop/DESIGN.md): the dashboard in a window of its own. It works exactly as the dashboard in a
// browser does -- the same page, from the same server -- but for the Browser, whose tabs are native pages placed over
// its pane (browsers.ts). It finds or starts that server, holds its window, and keeps the Browsers' pages.
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appToken, Link, Pages, type Dialog, type Stage } from "./browsers.ts";
import { connect, DEFAULT_PORT, homeOf, loginEnv } from "./dashboard.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const log = (...parts: unknown[]) => console.log(new Date().toISOString(), ...parts);

/** --home DIR and --port N, wherever they are among the arguments (Electron's own come first). */
function option(name: string): string | undefined {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1];
    if (argv[i].startsWith(name + "=")) return argv[i].slice(name.length + 1);
  }
  return undefined;
}

const home = homeOf(process.env, option("--home"));
const port = Number(option("--port")) || DEFAULT_PORT;
const RETRY = "ag-retry:";

app.setName("ag");
app.setPath("userData", path.join(home, "desktop")); // the app's own files go in the home, as the dashboard's do

let win: BrowserWindow | null = null;
let dashboard: URL | null = null;
let pages: Pages | null = null; // the Browsers' native pages, in `win`
let link: Link | null = null; // and ag's hold on them, through the dashboard
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit(); // one app per home: a second start shows the first one's window
app.on("second-instance", () => {
  if (!win) return void open();
  if (win.isMinimized()) win.restore();
  win.focus();
});

// ---- the window's place, kept between runs ------------------------------------------------------------------------

type Bounds = { x: number; y: number; width: number; height: number };
const placeFile = () => path.join(app.getPath("userData"), "window.json");

function savedPlace(): Partial<Bounds> {
  try {
    return JSON.parse(readFileSync(placeFile(), "utf8")) as Bounds;
  } catch {
    return { width: 1440, height: 900 };
  }
}

function keepPlace(w: BrowserWindow): void {
  const save = () => {
    try {
      writeFileSync(placeFile(), JSON.stringify(w.getNormalBounds()));
    } catch {
      // nowhere to keep it: the next window opens at the default place
    }
  };
  w.on("resized", save);
  w.on("moved", save);
  w.on("close", save);
}

// ---- links: the dashboard's own in the app, the rest in the user's browser -----------------------------------------

function ours(url: string): boolean {
  try {
    return dashboard !== null && new URL(url).origin === dashboard.origin;
  } catch {
    return false;
  }
}

function outside(url: string): void {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

function wire(w: BrowserWindow): void {
  w.webContents.setWindowOpenHandler(({ url }) => {
    // A dashboard page a link opens in a new tab: a window of its own, as in a browser -- with no preload, so a Browser
    // shown there streams as in a browser (only the main window holds native pages).
    if (ours(url)) return { action: "allow", overrideBrowserWindowOptions: { webPreferences: { preload: "" } } };
    outside(url);
    return { action: "deny" };
  });
  w.webContents.on("did-create-window", (child) => wire(child));
  w.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(RETRY)) {
      event.preventDefault();
      void show(w);
    } else if (!ours(url) && !url.startsWith("data:")) {
      event.preventDefault();
      outside(url);
    }
  });
}

// ---- the window ----------------------------------------------------------------------------------------------------

/** A short page of the app's own in the window: while the dashboard starts, or why it couldn't. */
function note(w: BrowserWindow, text: string, retry = false): void {
  const dark = nativeTheme.shouldUseDarkColors;
  const esc = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  const html = `<!doctype html><meta charset="utf-8"><title>ag</title><style>
    body{margin:0;height:100vh;display:grid;place-items:center;font:14px -apple-system,system-ui,sans-serif;
      background:${dark ? "#1b1b1d" : "#fafafa"};color:${dark ? "#d4d4d8" : "#3f3f46"}}
    main{max-width:640px;padding:24px} pre{white-space:pre-wrap;font:12px ui-monospace,monospace;opacity:.8}
    a{color:${dark ? "#93c5fd" : "#2563eb"}}</style>
    <main><pre>${esc}</pre>${retry ? `<p><a href="${RETRY}">Try again</a></p>` : ""}</main>`;
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function show(w: BrowserWindow): Promise<void> {
  note(w, "Starting the dashboard…");
  try {
    // Opened from the Finder or the Dock, the app has none of the user's shell's environment: a dashboard it starts
    // gets the login shell's (PATH, API keys), as one started in a terminal would.
    const url = await connect(home, port, () => (process.env.SHLVL ? process.env : loginEnv(process.env)));
    dashboard = new URL(url);
    if (!link && pages) {
      link = new Link(pages, `ws://${dashboard.host}/api/desktop`, () => appToken(home), log);
      link.start();
    }
    await w.loadURL(url);
  } catch (err) {
    note(w, `${err instanceof Error ? err.message : String(err)}\n\nHome: ${home}`, true);
  }
}

function open(): void {
  const w = (win = new BrowserWindow({
    ...savedPlace(),
    title: "ag",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b1d" : "#fafafa",
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(HERE, "preload.cjs") },
  }));
  keepPlace(w);
  wire(w);
  pages = new Pages(w, log, (target, url) => !w.isDestroyed() && w.webContents.send("ag:still", { target, url }), {
    pagePreload: path.join(HERE, "page-preload.cjs"),
    downloads: path.join(home, "dashboard", "downloads"), // (ag's own Chrome's: ag_apps/browser/core.py's downloads_dir)
    permissions: path.join(app.getPath("userData"), "permissions.json"),
  }, () => (w.isDestroyed() ? 1 : w.webContents.getZoomFactor()));
  // Closing the window is not quitting (desktop/DESIGN.md): on a Mac it is hidden, its Browsers' pages kept open (the
  // agent may be using them), until Cmd+Q; its Dock icon shows it again.
  w.on("close", (event) => {
    if (process.platform === "darwin" && !quitting) {
      event.preventDefault();
      w.hide();
    }
  });
  w.on("closed", () => {
    link?.stop();
    link = null;
    pages = null;
    win = null;
  });
  void show(w);
}

// Where the main window's Browser panes are, from its preload: each pane's page placed over it (scaled by the page's zoom:
// the page tells them in its own pixels).
ipcMain.on("ag:stages", (event, stages: Stage[]) => {
  if (win && event.sender === win.webContents) pages?.place(stages);
});
// A pane's still picture drawn by the dashboard (preload.cts): its page may now be hidden under it.
ipcMain.on("ag:still-drawn", (event, target: unknown) => {
  if (win && event.sender === win.webContents) pages?.drawn(String(target));
});
// A Browser page's alert, confirm or prompt (page-preload.cts): the page waits until ag answers it (Pages.dialog).
ipcMain.on("ag:dialog", (event, d: Dialog) => {
  if (pages) pages.dialog(event, d);
  else event.returnValue = d.type === "confirm" ? false : null;
});
// The dashboard's page asking for the keys back from a native page (a pick made: the message box next).
ipcMain.on("ag:focus", (event) => {
  if (win && event.sender === win.webContents) win.webContents.focus();
});
// The dashboard's page asking for its window in front: one of its notifications clicked (the page's own, the system's).
ipcMain.on("ag:raise", (event) => {
  if (!win || event.sender !== win.webContents) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  app.focus({ steal: true });
});

app.whenReady().then(open);
app.on("before-quit", () => (quitting = true)); // Cmd+Q: the window closes, its pages with it (the Browsers pause)
app.on("activate", () => {
  if (!win) open();
  else win.show();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
