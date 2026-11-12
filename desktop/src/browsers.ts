// The native pages of the dashboard's apps that ask for them (app_kit's `native_view`: the Browser's; desktop/DESIGN.md,
// "The app link" and "A tab in its pane"). Each page an app opens is a WebContentsView in the app's window, kept over
// the panel that shows it and hidden otherwise. The app drives them with the Chrome DevTools Protocol, over one
// WebSocket this app opens to its dashboard (`Link`), each message tagged with the app it is of ("app"): this app plays
// the browser's part for each -- its targets that app's pages, each session a page's own in-app connection
// (webContents.debugger). Each app's pages are its own: in a profile of its own (`partitionOf`: the Browser's, the
// profile its logins have always been in), seen and driven by it alone, and shown only over its own panels. This app
// opens no debugging port: Google refuses a sign-in in a browser that has one (desktop/DESIGN.md, "Rules the app keeps").
import { dialog, Menu, session, WebContentsView, type BaseWindow, type IpcMainEvent, type WebContents } from "electron";
import { editItems, spellingItems, tidy } from "./menu.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const PARTITION = "persist:browsers"; // the Browser's pages' profile, in the app's folder in the home: logins last
/** An app's pages' profile: the Browser's its own (PARTITION), any other app's one of its own. */
export const partitionOf = (app: string): string =>
  app === "browser" ? PARTITION : `persist:app-${app.replace(/[^a-z0-9_-]/g, "") || "x"}`;
const APP_BEFORE = "browser"; // the app a message names none of is (a dashboard from before apps tagged them)
const RECONNECT = [1000, 2000, 5000, 10_000]; // ms between tries to reach the dashboard again
const PICTURE_WAIT = 3000; // ms a hidden page has to give its still picture
// ms the dashboard has to draw a page's still picture before the page is hidden anyway (no frames: the window hidden)
const STILL_WAIT = 500;
// ms a page shown again keeps its still picture under it: the picture goes once the page is surely drawn over it
const STILL_KEPT = 150;

export type Stage = { x: number; y: number; w: number; h: number; key?: string; target: string; covered?: boolean; app?: string };
export type Size = { width: number; height: number };
type Log = (...parts: unknown[]) => void;
/** A page, and what ag said of it: its user's input `held` off it while the agent acts (App.hold); their Esc ag's
 * (`esc`, App.esc: to stop the agent, or end a Pick); a still picture shown in its place while something of the
 * dashboard's covers its pane (`still`), or none to be had (`bare`: the page shown as it is); the dialog it waits on
 * (`asking`: page-preload.cts). Its `size`: its pane's when last placed (or, before any was, the one ag asked for),
 * which it is always laid out at (`Pages.emulate`: `sizedAt` the size last sent, `sizing` while Chrome has yet to
 * answer it). */
type Page = {
  view: WebContentsView;
  app: string; // the dashboard's app it is of
  opener?: string;
  held?: boolean;
  esc?: boolean;
  still?: boolean;
  bare?: boolean;
  asking?: Asking;
  size: Size;
  sizedAt?: string;
  sizing?: boolean;
};
type Asking = { event: IpcMainEvent; type: string; given: string };
export type Dialog = { type: string; message: string; default: string };
/** Where the pages' files go: page-preload.cjs; the home's downloads folder (ag's own Chrome's too); the user's
 * answers to sites' permission asks, kept. */
export type Places = { pagePreload: string; downloads: string; permissions: string };

// Sites' permission asks (Electron grants every one unless told): asked of the user, once per site, as Chrome does;
// those Chrome grants unasked, granted; the rest refused.
const ASKED: Record<string, string> = {
  media: "use your camera or microphone",
  geolocation: "know your location",
  notifications: "show notifications",
  "clipboard-read": "see text and images you copy",
  "display-capture": "share your screen",
  midiSysex: "control your MIDI devices",
  "idle-detection": "know when you're using this device",
  "window-management": "manage windows on your displays",
  "storage-access": "use cookies and site data from other sites",
  "top-level-storage-access": "use cookies and site data from other sites",
  "speaker-selection": "choose your speakers",
  openExternal: "open an app on your Mac",
  fileSystem: "edit files on your Mac",
};
const GRANTED = new Set(["clipboard-sanitized-write", "pointerLock", "background-sync"]);

/** A file name in `dir` not taken yet: "report (1).pdf" after "report.pdf", as Chrome names a second download. */
function freshPath(dir: string, name: string): string {
  const safe = path.basename(name) || "download";
  const ext = path.extname(safe), stem = safe.slice(0, safe.length - ext.length);
  for (let n = 0; ; n++) {
    const candidate = path.join(dir, n ? `${stem} (${n})${ext}` : safe);
    if (!existsSync(candidate)) return candidate;
  }
}

/** The id Chrome gives a page: ag compares a tab's main frame id with it, so it must be Chrome's own. The page's in-app
 * DevTools connection is left attached: ag's sessions share it, and the size the page is laid out at
 * (`Pages.emulate`) lasts only while it is. */
async function targetIdOf(wc: WebContents): Promise<string> {
  if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  return ((await wc.debugger.sendCommand("Target.getTargetInfo")) as { targetInfo: { targetId: string } }).targetInfo
    .targetId;
}

function contextMenu(win: BaseWindow, wc: WebContents, find: () => void): void {
  wc.on("context-menu", (_e, p) => {
    const items = [...spellingItems(wc, p), ...editItems(p)];
    const nav = wc.navigationHistory;
    items.push(
      { type: "separator" },
      { label: "Back", enabled: nav.canGoBack(), click: () => nav.goBack() },
      { label: "Forward", enabled: nav.canGoForward(), click: () => nav.goForward() },
      { label: "Reload", click: () => wc.reload() },
      { type: "separator" },
      { label: "Find in Page…", click: find },
    );
    Menu.buildFromTemplate(tidy(items)).popup({ window: win });
  });
}

/** The pages, in `win`, each over the pane that shows it. */
export class Pages {
  private pages = new Map<string, Page>();
  private stages: Stage[] = [];
  /** The link's, while connected: what ag is told of a page made, changed, gone; the user's Esc on one, ag's. */
  hooks: {
    created?: (id: string, app: string) => void;
    changed?: (id: string, app: string) => void;
    destroyed?: (id: string, app: string) => void;
    escape?: (id: string, app: string) => void;
    findBar?: (id: string, app: string) => void;
    dialog?: (id: string, d: Dialog) => void;
    download?: (app: string, begun: Record<string, string>) => void;
    downloaded?: (app: string, done: Record<string, string>) => void;
  } = {};
  private shield: WebContentsView | null = null; // over a page whose input is held: takes the user's clicks, not ag's
  private lastSize: Size | null = null; // the last pane's a page was shown in: a new page's, if ag gives none
  private static current: Pages | null = null; // the pages the profiles' downloads and permission asks are for
  private static served = new Set<string>(); // the apps whose profile is set up (`serve`)
  private drawing = new Map<string, () => void>(); // a pane's still picture sent, until the dashboard has drawn it

  constructor(
    private win: BaseWindow,
    private log: Log,
    private still: (target: string, url: string | null) => void, // a page's still picture to the dashboard, or none
    private places: Places,
    private zoom: () => number = () => 1, // the dashboard page's zoom (⌘+ / ⌘−): its pixels to the window's
  ) {
    Pages.current = this;
  }

  /** An app's pages' profile's downloads, into the home's downloads folder, told to the app as Chrome tells them (so
   * the dashboard lists them, as for its own Chrome); and sites' permission asks, put to the user. Once per app. */
  private static serve(app: string): void {
    if (Pages.served.has(app)) return;
    Pages.served.add(app);
    const profile = session.fromPartition(partitionOf(app));
    profile.on("will-download", (_event, item, wc) => {
      const pages = Pages.current;
      if (!pages) return item.cancel();
      mkdirSync(pages.places.downloads, { recursive: true });
      const guid = randomUUID(), file = freshPath(pages.places.downloads, item.getFilename());
      item.setSavePath(file);
      pages.hooks.download?.(app, { guid, url: item.getURL(), suggestedFilename: path.basename(file), frameId: pages.idOf(wc) ?? "" });
      item.once("done", (_e, state) =>
        pages.hooks.downloaded?.(app, { guid, state: state === "completed" ? "completed" : "canceled", filePath: file }),
      );
    });
    profile.setPermissionCheckHandler((_wc, permission, origin) => GRANTED.has(permission) || Pages.current?.kept(origin, permission) === true);
    profile.setPermissionRequestHandler((wc, permission, callback, details) => {
      const pages = Pages.current;
      if (!pages || GRANTED.has(permission)) return callback(!!pages);
      if (!ASKED[permission]) return callback(false);
      void pages.ask(wc, permission, details).then(callback);
    });
  }

  private remembered(): Record<string, boolean> {
    try {
      return JSON.parse(readFileSync(this.places.permissions, "utf8")) as Record<string, boolean>;
    } catch {
      return {};
    }
  }

  private kept(origin: string, permission: string): boolean | undefined {
    return this.remembered()[`${origin} ${permission}`];
  }

  /** The user's answer to a site's ask, from the app's own dialog over the window -- kept for that site. */
  private async ask(wc: WebContents, permission: string, details: Electron.PermissionRequest): Promise<boolean> {
    let origin = "";
    try {
      origin = new URL(details.requestingUrl || wc.getURL()).origin;
    } catch {
      return false;
    }
    const kept = this.kept(origin, permission);
    if (kept !== undefined) return kept;
    const external = (details as { externalURL?: string }).externalURL;
    let what = ASKED[permission];
    if (permission === "openExternal" && external) {
      try {
        what = `open ${new URL(external).protocol.replace(/:$/, "")} links in an app on your Mac`;
      } catch {
        // (as asked)
      }
    }
    const { response } = await dialog.showMessageBox(this.win, {
      type: "question", message: `${new URL(origin).host} wants to ${what}`, buttons: ["Allow", "Block"], defaultId: 1, cancelId: 1,
    });
    const all = this.remembered();
    all[`${origin} ${permission}`] = response === 0;
    try {
      writeFileSync(this.places.permissions, JSON.stringify(all, null, 2));
    } catch {
      // not kept: asked again next time
    }
    return response === 0;
  }

  idOf(wc: WebContents): string | undefined {
    for (const [id, p] of this.pages) if (p.view.webContents === wc) return id;
    return undefined;
  }

  /** A page's alert, confirm or prompt (page-preload.cts): told to ag as Chrome's own dialog would be, the page waiting
   * until it is answered (`answer`) -- or, with no ag to tell, answered as a cancel at once. */
  dialog(event: IpcMainEvent, d: Dialog): void {
    const id = this.idOf(event.sender);
    const p = id ? this.pages.get(id) : undefined;
    if (!id || !p || p.asking || !this.hooks.dialog) {
      event.returnValue = d.type === "confirm" ? false : null;
      return;
    }
    p.asking = { event, type: d.type, given: d.default };
    this.hooks.dialog(id, d);
  }

  /** Whether the page waits on a dialog of this app's: it answers nothing else then (page-preload.cts holds it). */
  waiting(id: string): boolean {
    return !!this.pages.get(id)?.asking;
  }

  /** ag's answer (Page.handleJavaScriptDialog): false if the page waits on no dialog of this app's. */
  answer(id: string, accept: boolean, text?: string): boolean {
    const p = this.pages.get(id);
    const a = p?.asking;
    if (!p || !a) return false;
    p.asking = undefined;
    a.event.returnValue = a.type === "confirm" ? accept : a.type === "prompt" ? (accept ? (text ?? a.given) : null) : null;
    return true;
  }

  /** Chrome's own find in a page, as the Browser's find bar asks (ag_apps/browser/core.py's `find`): the first match, else
   * (`again`) the next or the one before (`back`): {count, index}. None asked: the finding ended. */
  find(id: string, q: string, back: boolean, again: boolean): Promise<{ count: number; index: number }> {
    const wc = this.contents(id);
    if (!wc || !q) {
      wc?.stopFindInPage("clearSelection");
      return Promise.resolve({ count: 0, index: -1 });
    }
    return new Promise((resolve) => {
      let asked = -1;
      const done = (r: { count: number; index: number }) => {
        clearTimeout(timer);
        wc.off("found-in-page", on);
        resolve(r);
      };
      const on = (_e: Electron.Event, r: Electron.Result) => {
        if (r.requestId === asked && r.finalUpdate) done({ count: r.matches, index: r.matches ? r.activeMatchOrdinal - 1 : -1 });
      };
      const timer = setTimeout(() => done({ count: 0, index: -1 }), 3000);
      wc.on("found-in-page", on);
      asked = wc.findInPage(q, { forward: !back, findNext: !again });
    });
  }

  /** The pages' ids: every page's, or `app`'s. */
  ids(app?: string): string[] {
    return [...this.pages].filter(([, p]) => app === undefined || p.app === app).map(([id]) => id);
  }

  /** The app page `id` is of (undefined: no such page). */
  appOf(id: string): string | undefined {
    return this.pages.get(id)?.app;
  }

  contents(id: string): WebContents | undefined {
    return this.pages.get(id)?.view.webContents;
  }

  /** The page as Chrome's Target domain describes one. */
  info(id: string): Record<string, unknown> {
    const p = this.pages.get(id)!;
    const wc = p.view.webContents;
    return {
      targetId: id,
      type: "page",
      title: wc.getTitle(),
      url: wc.getURL(),
      attached: wc.debugger.isAttached(),
      canAccessOpener: !!p.opener,
      ...(p.opener ? { openerId: p.opener } : {}),
      browserContextId: "app",
    };
  }

  /** A new page of `app`'s, at `url`, laid out at `size` (its panel's view's, as the app knows it) while no panel shows
   * it: its target id. */
  async make(url: string, size?: Size, app: string = APP_BEFORE): Promise<string> {
    Pages.serve(app);
    const view = new WebContentsView({
      webPreferences: { partition: partitionOf(app), sandbox: true, contextIsolation: true, backgroundThrottling: false,
        preload: this.places.pagePreload },
    });
    const id = await this.setUp(view, undefined, size, app);
    view.webContents.loadURL(url || "about:blank").catch(() => {});
    return id;
  }

  /** A page in the window, ag told of it: one ag asked for, or a popup a page opened (`opener`: that page's id). A popup
   * opens as a real one -- its opener keeps its hold on it (window.opener), as a sign-in popup ("Continue with Google")
   * needs, to hand its result back -- and ag shows it as a tab of the Browser's. Hidden until a pane shows it, laid out
   * at `size`, else its opener's, else the last pane's, else the window's. */
  private async setUp(view: WebContentsView, opener?: string, size?: Size, app?: string): Promise<string> {
    const at: Size = size ?? (opener ? this.pages.get(opener)?.size : undefined) ?? this.lastSize ?? this.windowSize();
    const of = app ?? (opener ? this.pages.get(opener)?.app : undefined) ?? APP_BEFORE; // a popup: its opener's app's
    view.setVisible(false);
    this.win.contentView.addChildView(view);
    const wc = view.webContents;
    let id = "";
    wc.setWindowOpenHandler(() => ({
      action: "allow",
      createWindow: (options) => {
        // (Electron hands the new window's WebContents in `options`, though its types don't say so)
        const opened = (options as { webContents?: WebContents }).webContents;
        const popup = new WebContentsView({ webContents: opened } as Electron.WebContentsViewConstructorOptions);
        this.setUp(popup, id).catch((err) => this.log("popup not set up:", err));
        return popup.webContents;
      },
    }));
    contextMenu(this.win, wc, () => this.hooks.findBar?.(id, of));
    // Leaving a page that asks to be stayed on ("Leave site?"): left -- the agent's navigations among them, which no
    // one would be there to answer. (Electron would stay, asking no one.)
    wc.on("will-prevent-unload", (event) => event.preventDefault());
    // The user's keys (ag's own, sent over the link, never come here): Esc to ag when it is ag's; none while held.
    wc.on("before-input-event", (event, input) => {
      const p = this.pages.get(id);
      if (!p) return;
      if (p.esc && input.type === "keyDown" && input.key === "Escape") {
        event.preventDefault();
        this.hooks.escape?.(id, of);
      } else if (p.held) event.preventDefault();
    });
    id = await targetIdOf(wc);
    const page: Page = { view, app: of, opener, size: at };
    this.pages.set(id, page);
    this.emulate(page);
    wc.on("destroyed", () => this.gone(id)); // closed by ag, or by its own page (a popup done: window.close)
    for (const ev of ["did-navigate", "did-navigate-in-page", "page-title-updated"] as const)
      wc.on(ev as "did-navigate", () => this.hooks.changed?.(id, of));
    this.hooks.created?.(id, of);
    this.place();
    return id;
  }

  private gone(id: string): void {
    const p = this.pages.get(id);
    if (!p) return;
    this.pages.delete(id);
    try {
      this.win.contentView.removeChildView(p.view);
    } catch {
      // the window is gone
    }
    this.hooks.destroyed?.(id, p.app);
    this.place();
  }

  close(id: string): boolean {
    const p = this.pages.get(id);
    if (!p) return false;
    p.view.webContents.close(); // its "destroyed" takes it out
    return true;
  }

  /** Every page closed: the link is gone, so its Browsers are paused (ag opens them again when it is back). */
  closeAll(): void {
    for (const id of this.ids()) {
      this.answer(id, false); // (a page waiting on a dialog: let go first)
      this.close(id);
    }
  }

  /** Each pane's page over it, the others hidden -- or, while something of the dashboard's covers the pane, a still
   * picture of the page in its place (the page hidden once the picture is there). `stages`: where the panes are now, in
   * the dashboard page's pixels -- the window's are those times the page's zoom, as it is when they are placed. */
  place(stages?: Stage[]): void {
    if (stages) this.stages = stages;
    const z = this.zoom();
    const zoom = Number.isFinite(z) && z > 0 ? z : 1;
    const shown = new Set<string>();
    let shielded: Electron.Rectangle | null = null;
    for (const s of this.stages) {
      const p = this.pages.get(s.target);
      if (!p || shown.has(s.target) || (s.app !== undefined && s.app !== p.app)) continue;   // (only an app's own panel)
      shown.add(s.target);
      const x = Math.round(s.x * zoom), y = Math.round(s.y * zoom); // (edges rounded, so a pane's are its page's)
      const bounds = { x, y, width: Math.max(1, Math.round((s.x + s.w) * zoom) - x), height: Math.max(1, Math.round((s.y + s.h) * zoom) - y) };
      p.size = this.lastSize = { width: bounds.width, height: bounds.height };
      p.view.setBounds(bounds);
      this.emulate(p); // (laid out at its pane's size: its picture too, if covered)
      if (s.covered && !p.bare) {
        if (!p.still) {
          p.still = true;
          this.picture(p)
            .then((url) => {
              if (!p.still) return;
              if (!url) {
                // no picture to be had: the page itself, over what covers its pane, rather than a blank
                p.still = false;
                p.bare = true;
                this.place();
                return;
              }
              // hidden only once its picture is drawn in its place: hidden before, the pane is blank meanwhile
              const target = s.target;
              return this.stillDrawn(target, url).then(() => {
                if (p.still && this.pages.get(target) === p) this.hide(p);
              });
            })
            .catch(() => {});
        }
        continue;
      }
      if (!s.covered) p.bare = false;
      const pictured = p.still;
      p.still = false;
      p.view.setVisible(true);
      if (pictured) {
        // the page over its pane first, then its picture gone from under it (unless covered again meanwhile)
        this.drawing.get(s.target)?.();
        const target = s.target;
        setTimeout(() => {
          if (!p.still && this.pages.get(target) === p) this.still(target, null);
        }, STILL_KEPT);
      }
      if (p.held) shielded = bounds;
    }
    for (const [id, p] of this.pages)
      if (!shown.has(id)) {
        p.still = p.bare = false; // (its picture, if any, no more its pane's: taken again if it is shown covered)
        this.hide(p);
      }
    if (shielded) {
      if (!this.shield) {
        this.shield = new WebContentsView();
        this.shield.setBackgroundColor("#00000000");
      }
      this.win.contentView.addChildView(this.shield); // (again: on top)
      this.shield.setBounds(shielded);
      this.shield.setVisible(true);
    } else this.shield?.setVisible(false);
  }

  /** The dashboard told to draw `target`'s still picture: done once it says it is drawn (ag:still-drawn, drawn), or
   * after STILL_WAIT, or a newer one sent, or the page shown again. */
  private stillDrawn(target: string, url: string): Promise<void> {
    this.drawing.get(target)?.();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (this.drawing.get(target) === done) this.drawing.delete(target);
        resolve();
      };
      const timer = setTimeout(done, STILL_WAIT);
      this.drawing.set(target, done);
      this.still(target, url);
    });
  }

  /** The dashboard's word that `target`'s still picture is drawn in its pane. */
  drawn(target: string): void {
    this.drawing.get(target)?.();
  }

  /** `p` out of sight, laid out at its size still (`emulate`). */
  private hide(p: Page): void {
    p.view.setVisible(false);
    this.emulate(p);
  }

  /** `p` laid out at its pane's size (`size`), shown or hidden, by the DevTools emulation -- never left to Chrome:
   * - a page hidden in the window has no size of its own: a tab the agent opened while its pane showed something else
   *   would be laid out at 0 x 0, its tools working on a page the user never sees, and Chrome would leave a
   *   screenshot's scale on it (ag's are at 1/dpr), drawing it at half size once shown;
   * - a page shown again after its pane changed size while it was hidden (the chat minimized or shown, another task's
   *   layout, the window resized) can be left at its size from before -- drawn short of its pane, or past it -- and
   *   Electron has no call that sends a page its view's size again; nor would clearing an emulation once shown.
   * One size at a time, each sent once Chrome has answered the last (answers can come out of order, an older size
   * then winning), the latest sent after if the pane has moved on meanwhile. */
  private emulate(p: Page): void {
    const at = `${p.size.width}x${p.size.height}`;
    const wc = p.view.webContents;
    if (p.sizing || p.sizedAt === at || wc.isDestroyed() || !wc.debugger.isAttached()) return;
    p.sizedAt = at;
    p.sizing = true;
    wc.debugger
      .sendCommand("Emulation.setDeviceMetricsOverride", { ...p.size, deviceScaleFactor: 0, mobile: false })
      .then(
        () => {
          p.sizing = false;
          this.emulate(p); // (the pane's size now, if not the one just sent)
        },
        () => {
          p.sizing = false;
          p.sizedAt = undefined; // (sent again when it is next placed)
        },
      );
  }

  /** Page `id`'s size sent again, after a screenshot of it (Page.captureScreenshot): the app's picture of a hidden
   * page, or the agent's. Chrome puts back the emulation a page had when its screenshot began once the screenshot is
   * made -- and a hidden page's is made only once it is shown, perhaps at another size by then: put back, it would
   * hold the page at its old size. */
  reemulate(id: string): void {
    const p = this.pages.get(id);
    if (!p) return;
    p.sizedAt = undefined;
    this.emulate(p);
  }

  /** A still picture of `p` as it is now, as a data URL, or null if none could be had: a page shown, what the window
   * draws of it; a hidden one, drawn for the picture by Chrome (what the window last drew of it may be old, or nothing:
   * a tab opened out of sight). A page held still by its dialog may never answer: PICTURE_WAIT. */
  private async picture(p: Page): Promise<string | null> {
    const wc = p.view.webContents;
    if (p.view.getVisible()) {
      const img = await wc.capturePage();
      if (!img.isEmpty()) return img.toDataURL();
    }
    if (wc.isDestroyed() || !wc.debugger.isAttached()) return null;
    const shot = wc.debugger.sendCommand("Page.captureScreenshot", { format: "png" });
    const id = this.idOf(wc);
    if (id) shot.then(() => this.reemulate(id), () => {}); // (whenever it is made: after PICTURE_WAIT too)
    const got = (await Promise.race([
      shot,
      new Promise((resolve) => setTimeout(() => resolve({}), PICTURE_WAIT)),
    ])) as { data?: string };
    return got.data ? `data:image/png;base64,${got.data}` : null;
  }

  private windowSize(): Size {
    const b = this.win.getContentBounds();
    return { width: b.width, height: b.height };
  }

  /** ag's word on a page (App.hold, App.esc). */
  mark(id: string, what: "held" | "esc", on: boolean): void {
    const p = this.pages.get(id);
    if (!p) return;
    p[what] = on;
    if (what === "held") this.place();
  }
}

/** The home's token for the app's link (ag_dashboard/desktop.py's `app_token`): read, or made if neither side has yet. */
export function appToken(home: string): string {
  const file = path.join(home, "dashboard", "desktop-token");
  try {
    const token = readFileSync(file, "utf8").trim();
    if (token) return token;
  } catch {
    // not made yet
  }
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    writeFileSync(file, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 });
  } catch {
    // the dashboard made it meanwhile
  }
  return readFileSync(file, "utf8").trim();
}

type Message = { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; app?: string };

/** This app's link to its dashboard (ag_dashboard/api/apps.py's /api/desktop): the token first, then the protocol both
 * ways, each message an app's (its "app"). While it is down the pages are closed (their apps paused) and it tries
 * again, as the dashboard may be restarting. */
export class Link {
  private ws: WebSocket | null = null;
  private tries = 0;
  private stopped = false;

  constructor(
    private pages: Pages,
    private url: string,
    private token: () => string,
    private log: Log,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = (this.ws = new WebSocket(this.url));
    let open = false;
    // session id -> the page it is of, and the app it is the session of
    const sessions = new Map<string, { wc: WebContents; app: string }>();
    const wired = new WeakSet<WebContents>();
    // the apps told of their pages as they come and go, as Chrome does once asked (the Browser asks only some Chromes)
    const quiet = new Set<string>();
    const discover = (app: string) => !quiet.has(app);
    // a message to `app` (its name on it: the dashboard hands it to that app)
    const send = (m: object, app: string) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ ...m, app }));

    ws.addEventListener("open", () => {
      open = true;
      this.tries = 0;
      ws.send(this.token());
      this.pages.hooks = {
        created: (id, app) => discover(app) && send({ method: "Target.targetCreated", params: { targetInfo: this.pages.info(id) } }, app),
        changed: (id, app) => discover(app) && send({ method: "Target.targetInfoChanged", params: { targetInfo: this.pages.info(id) } }, app),
        destroyed: (id, app) => discover(app) && send({ method: "Target.targetDestroyed", params: { targetId: id } }, app),
        escape: (id, app) => send({ method: "App.escape", params: { targetId: id } }, app),
        findBar: (id, app) => send({ method: "App.findBar", params: { targetId: id } }, app),
        // a page's dialog, to each session of its as Chrome's own would be told; downloads, as Chrome tells them
        dialog: (id, d) => {
          const wc = this.pages.contents(id);
          for (const [sid, x] of sessions)
            if (x.wc === wc)
              send({ method: "Page.javascriptDialogOpening", sessionId: sid,
                params: { url: wc?.getURL() ?? "", message: d.message, type: d.type, hasBrowserHandler: true, defaultPrompt: d.default } }, x.app);
        },
        download: (app, begun) => send({ method: "Browser.downloadWillBegin", params: begun }, app),
        downloaded: (app, done) => send({ method: "Browser.downloadProgress", params: done }, app),
      };
      this.log("linked to the dashboard");
    });

    const wire = (wc: WebContents) => {
      if (wired.has(wc)) return;
      wired.add(wc);
      wc.debugger.on("message", (_e, method, params) => {
        for (const [sid, x] of sessions) if (x.wc === wc) send({ method, params, sessionId: sid }, x.app);
      });
      wc.debugger.on("detach", () => {
        for (const [sid, x] of sessions) if (x.wc === wc) sessions.delete(sid);
      });
    };

    ws.addEventListener("message", async (ev) => {
      const m = JSON.parse(String(ev.data)) as Message;
      const p = m.params || {};
      const app = typeof m.app === "string" && m.app ? m.app : APP_BEFORE; // the app it is from
      const mine = (id: string) => this.pages.appOf(id) === app; // a page of that app's: the only ones it may touch
      if (m.id === undefined) {
        // the app's own word, not the protocol's (the Browser's AppCdp.notify)
        if ((m.method === "App.hold" || m.method === "App.esc") && mine(String(p.targetId)))
          this.pages.mark(String(p.targetId), m.method === "App.hold" ? "held" : "esc", !!p.on);
        return;
      }
      const answer = (r: object) => send({ id: m.id, ...(m.sessionId ? { sessionId: m.sessionId } : {}), ...r }, app);
      const fail = (e: unknown) => answer({ error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
      try {
        if (m.sessionId) {
          const x = sessions.get(m.sessionId);
          const wc = x && x.app === app ? x.wc : undefined;
          if (!wc || wc.isDestroyed()) return fail("No session with given id");
          const id = this.pages.idOf(wc);
          // A page waiting on its dialog is held still by it, its own scripts and Chrome's look into it alike (a
          // browser's own dialog would let the look in): anything but the answer refused at once, not left waiting.
          if (id && this.pages.waiting(id) && m.method !== "Page.handleJavaScriptDialog")
            return fail("the page waits on its dialog: answer it first");
          if (m.method === "Page.handleJavaScriptDialog" && id && this.pages.answer(id, !!p.accept, p.promptText as string | undefined)) {
            answer({ result: {} });
            for (const [sid, x] of sessions)
              if (x.wc === wc) send({ method: "Page.javascriptDialogClosed", sessionId: sid, params: { result: !!p.accept, userInput: String(p.promptText ?? "") } }, x.app);
            return;
          }
          const result = await wc.debugger.sendCommand(m.method || "", p);
          if (id && m.method === "Page.captureScreenshot") this.pages.reemulate(id); // (its emulation as the app has it)
          return answer({ result });
        }
        switch (m.method) {
          case "Target.setDiscoverTargets":
            if (p.discover) quiet.delete(app);
            else quiet.add(app);
            answer({ result: {} });
            if (p.discover) for (const id of this.pages.ids(app)) this.pages.hooks.created?.(id, app);
            return;
          case "Target.createTarget": {
            // laid out at the size ag gives (its Browser's view's: Chrome's own width/height, for a new window)
            const w = Number(p.width), h = Number(p.height);
            const size = w > 0 && h > 0 ? { width: Math.round(w), height: Math.round(h) } : undefined;
            return answer({ result: { targetId: await this.pages.make(String(p.url || "about:blank"), size, app) } });
          }
          case "Target.attachToTarget": {
            const wc = mine(String(p.targetId)) ? this.pages.contents(String(p.targetId)) : undefined;
            if (!wc) return fail("No target with given id found");
            if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
            wire(wc);
            const sid = randomUUID().replace(/-/g, "").toUpperCase();
            sessions.set(sid, { wc, app });
            return answer({ result: { sessionId: sid } });
          }
          case "Target.detachFromTarget":
            if (sessions.get(String(p.sessionId))?.app === app) sessions.delete(String(p.sessionId));
            return answer({ result: {} });
          case "Target.closeTarget":
            return answer({ result: { success: mine(String(p.targetId)) && this.pages.close(String(p.targetId)) } });
          case "Target.getTargetInfo":
            return mine(String(p.targetId))
              ? answer({ result: { targetInfo: this.pages.info(String(p.targetId)) } })
              : fail("No target with given id found");
          case "Target.getTargets":
            return answer({ result: { targetInfos: this.pages.ids(app).map((id) => this.pages.info(id)) } });
          case "App.find":
            if (!mine(String(p.targetId))) return fail("No target with given id found");
            return answer({ result: await this.pages.find(String(p.targetId), String(p.q || ""), !!p.back, !!p.again) });
          case "Browser.getVersion":
            return answer({
              result: { protocolVersion: "1.3", product: `Chrome/${process.versions.chrome}`, revision: "", userAgent: "", jsVersion: process.versions.v8 },
            });
          default:
            if (m.method?.startsWith("Target.") || m.method?.startsWith("Browser.")) return answer({ result: {} });
            return fail(`'${m.method}' wasn't found`);
        }
      } catch (e) {
        fail(e);
      }
    });

    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
      this.pages.hooks = {};
      for (const wc of new Set([...sessions.values()].map((x) => x.wc))) {
        try {
          wc.debugger.detach();
        } catch {
          // closed already
        }
      }
      sessions.clear();
      this.pages.closeAll(); // paused: ag opens them again once the link is back
      if (open) this.log("link to the dashboard closed");
      if (this.stopped) return;
      const wait = RECONNECT[Math.min(this.tries++, RECONNECT.length - 1)];
      setTimeout(() => this.connect(), wait);
    });
    ws.addEventListener("error", () => {
      // (a close follows)
    });
  }
}
