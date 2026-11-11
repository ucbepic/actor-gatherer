// Step 2 end to end (desktop/DESIGN.md): in the app, a Browser's tab is a native page kept over its panel's screen (the
// Browser app's: ag_apps/browser/, its panel an iframe on its own origin that says where its screen is: app_kit's
// ag.native); the agent's tools act on it through the app's link; a page's popup opens as a real one and hands its result
// back; quitting the app pauses the Browser, and opening it again brings its tabs back. A real dashboard from this
// checkout, a local test site.
import { _electron as electron, expect, test, type ElectronApplication, type FrameLocator, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.dirname(DESKTOP);
const PYTHON = process.env.AG_PYTHON || "";
test.skip(!PYTHON, "AG_PYTHON (a Python with ag's dashboard packages) is needed to run real dashboards");

const SHOP = `<!doctype html><title>Shop</title><h1>Checkout</h1>
<label for="email">Email</label><input id="email">
<button id="pay" onclick="document.getElementById('out').textContent = 'paid ' + email.value">Pay</button>
<p id="out"></p><p><a href="login.html">Log in</a></p>`;
const LOGIN = `<!doctype html><title>Login</title><h1>Login</h1>
<button onclick="window.open('popup.html', 'login', 'width=480,height=600')">Sign in with popup</button>
<p id="out">not signed in</p>
<script>addEventListener('message', (e) => { document.getElementById('out').textContent = 'got: ' + e.data; });</script>`;
const DIALOGS = `<!doctype html><title>Dialogs</title><h1>Dialogs</h1>
<button id="c" onclick="out.textContent = 'confirmed ' + confirm('Sure?')">Confirm</button>
<button id="p" onclick="out.textContent = 'prompted ' + prompt('Your name?', 'Ada')">Prompt</button>
<button id="n" onclick="Notification.requestPermission().then((r) => { out.textContent = 'notifications ' + r; })">Notify</button>
<a id="d" href="notes.txt" download>Download the notes</a><p id="out"></p>`;
const POPUP = `<!doctype html><title>Popup</title><p>Signing you in…</p>
<script>setTimeout(() => { window.opener.postMessage('signed in', '*'); setTimeout(() => window.close(), 300); }, 300);</script>`;
// red from edge to edge: drawn whole, a picture of it is red at its far corner too
const RED = `<!doctype html><title>Red</title><body style="margin:0;background:#fff">
<div style="position:fixed;inset:0;background:rgb(255,0,0)"></div><p style="position:relative">Red</p>`;

let scratch = "";
let home = "";
let port = 0;
let site = "";
let key = "";
let agent = ""; // the Browser's actor: its tools called as it calls them
let dashboard: ChildProcess | null = null;
let siteServer: http.Server | null = null;

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  for (const k of ["AG_ACTOR", "AG_DASHBOARD", "AG_COMMAND", "ANTHROPIC_BASE_URL"]) delete out[k];
  return out;
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const { port: p } = s.address() as AddressInfo;
      s.close(() => resolve(p));
    });
  });

/** A request to the dashboard, as its own page makes one: its JSON answer. `app`: to that app's own origin, as its panel
 * makes one (the Browser's routes, /api/w/<gatherer>/<instance>/...). */
function ask(route: string, body?: unknown, app?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const host = app ? `${app}.localhost:${port}` : `127.0.0.1:${port}`;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: route,
        method: data === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", origin: `http://${host}`, host },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(text) as Record<string, unknown>);
          } catch {
            reject(new Error(`${route}: ${res.statusCode} ${text.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

/** One of the agent's tools, as its harness calls it (the tool gateway's browser_<tool>): the tool's text. */
async function tool(name: string, args: Record<string, unknown>): Promise<{ text: string; error: boolean }> {
  const got = (await ask("/api/apps/agent/call", { actor: agent, tool: `browser_${name}`, args: { ...args, instance: key } })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  return { text: got.content.map((c) => c.text ?? "").join("\n"), error: !!got.isError };
}

/** A request of the Browser's panel to its backend (its routes, on the app's own origin). */
const browserAsk = (what: string, body: unknown = {}) => ask(`/api/w/g/${key}/${what}`, body, "browser");

/** The Browser's panel, above its actor: its frame. */
const panel = (page: Page): FrameLocator => page.frameLocator("#top-row .app-pane[data-app=browser] iframe");
/** The panel's frame itself, to run a script in. */
const panelFrame = (page: Page) => page.frames().find((f) => f.url().startsWith(`http://browser.localhost:${port}/`))!;
/** The Browser's panel closed (its × in the top row: the Browser stays open), and opened again: its actor shown, and --
 * a panel closed in a task staying closed (frontend's 07-panes.js, TASKS) -- the Browser selected from its task's card. */
const closePanel = (page: Page) => page.locator("#top-row .app-pane[data-app=browser] .app-close").click();
const openPanel = async (page: Page) => {
  const row = page.locator(".agent:not(.coordinator)").first();
  await row.click();
  if (!(await panel(page).locator(".bw-stage").isVisible())) {
    await page.mouse.move(0, 0);
    await row.hover();
    await page.locator("#actor-card.live .c-app-row .c-row").first().click();
    await page.mouse.move(0, 0);
  }
  await expect(panel(page).locator(".bw-stage")).toBeVisible();
};

const ref = (snapshot: string, starts: string) => {
  const line = snapshot.split("\n").find((l) => l.trim().startsWith(`- ${starts}`));
  if (!line) throw new Error(`no ${starts} in:\n${snapshot}`);
  return line.split("[")[1].split("]")[0];
};

/** The page's snapshot once it shows `starts` (a page just navigated to may not be drawn yet): its ref. */
async function refOnce(starts: string): Promise<string> {
  let snap = "";
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    snap = (await tool("snapshot", {})).text;
    if (snap.split("\n").some((l) => l.trim().startsWith(`- ${starts}`))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return ref(snap, starts);
}

/** The app's native pages: each one's address, whether it shows, and where. */
const pagesOf = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children.map((v) => {
      const wc = (v as Electron.WebContentsView).webContents;
      return { url: wc.getURL(), visible: v.getVisible(), bounds: v.getBounds() };
    }),
  );

/** What a native page's document says, by its address. */
const pageText = (app: ElectronApplication, url: string, selector: string) =>
  app.evaluate(
    ({ BrowserWindow }, [u, s]) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => (c as Electron.WebContentsView).webContents.getURL() === u);
      return v ? (v as Electron.WebContentsView).webContents.executeJavaScript(`document.querySelector(${JSON.stringify(s)})?.textContent`) : null;
    },
    [url, selector],
  );

async function until(check: () => Promise<boolean>, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (process.env.AG_E2E_DEBUG) console.log("timed out: the Browser's tabs:", (await tool("tabs", {})).text);
  throw new Error("timed out");
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [DESKTOP, "--home", home, "--port", String(port)], env: env() });
  if (process.env.AG_E2E_DEBUG) app.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  const page = await app.firstWindow();
  await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
  await page.locator(".agent:not(.coordinator)").first().click(); // the Browser's actor: its Browser opens above it
  await expect(panel(page).locator(".bw-stage")).toBeVisible();
  return { app, page };
}

test.beforeAll(async () => {
  scratch = mkdtempSync("/tmp/agd-"); // short: ag's notification socket in the home must fit macOS's limit
  home = path.join(scratch, "home");
  const root = path.join(scratch, "site");
  mkdirSync(home);
  mkdirSync(root);
  // ag's own config for a new home, with: no harness started by a view (headless chat); a model set, so no Settings
  // panel opens over a fresh home's page. And gatherer g's database, as its first agent's first call makes it: what
  // the Browser tells its agent is kept there (a gatherer with none holds it until it has one).
  execFileSync(PYTHON, ["-c", [
    "import os",
    "from ag.ag_harness.home import home",
    "h = home(); h.ensure()",
    "p = os.path.join(h.root, 'config.toml'); s = open(p).read()",
    "open(p, 'w').write(s.replace('model = \"\"', 'model = \"claude-code/haiku\"', 1) + '\\n[dashboard]\\nchat = \"headless\"\\n')",
    "home().manager('g').init('g')",
  ].join("\n")], { cwd: REPO, env: { ...env(), AG_HOME: home } });
  for (const [name, text] of [["index.html", SHOP], ["login.html", LOGIN], ["popup.html", POPUP], ["dialogs.html", DIALOGS],
    ["red.html", RED], ["notes.txt", "the notes\n"]])
    writeFileSync(path.join(root, name), text);
  siteServer = http.createServer((req, res) => {
    const name = (req.url || "/").split("?")[0].replace(/^\/$/, "/index.html").slice(1);
    try {
      res.setHeader("content-type", "text/html");
      res.end(readFileSync(path.join(root, path.basename(name))));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => siteServer!.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${(siteServer.address() as AddressInfo).port}/`;
  port = await freePort();
  // ag run from this checkout (as the dashboard's own tests run it: tests/web_home.py), not one installed: the app's
  // events are written with it
  const withAg = { ...env(), AG_COMMAND: `${PYTHON} ${path.join(REPO, "ag", "cli", "ag")}` };
  dashboard = spawn(PYTHON, ["-m", "ag_dashboard", "--home", home, "--port", String(port)], { cwd: REPO, env: withAg,
    stdio: process.env.AG_E2E_DEBUG ? ["ignore", "inherit", "inherit"] : "ignore" });
  await until(async () => (await ask("/api/home").catch((): Record<string, unknown> => ({}))).home === home);
  const made = await ask("/api/apps/start", { app: "browser", gatherer: "g", cwd: root, harness: "claude" });
  key = String((made.instance as { id: string }).id);
  agent = String((made.session as { session_id: string }).session_id);
});

test.afterAll(async () => {
  if (dashboard && dashboard.exitCode === null) {
    const gone = new Promise((r) => dashboard!.once("exit", r));
    dashboard.kill();
    await gone;
  }
  siteServer?.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("a Browser's tab is a native page over its pane, and the agent's tools act on it", async () => {
  const { app, page } = await launch();
  try {
    expect((await browserAsk("nav", { url: site })).done).toBe(site);
    await until(async () => (await pagesOf(app)).some((p) => p.url === site && p.visible));
    const stage = await panel(page).locator(".bw-stage").boundingBox();
    const shown = (await pagesOf(app)).find((p) => p.url === site && p.visible)!;
    expect(Math.abs(shown.bounds.x - stage!.x)).toBeLessThan(2);
    expect(Math.abs(shown.bounds.y - stage!.y)).toBeLessThan(2);
    expect(Math.abs(shown.bounds.width - stage!.width)).toBeLessThan(2);

    // the dashboard zoomed out (⌘−, kept per host): the page still over its pane, not over what is below and right of it
    // -- the pane's place, in the page's pixels, times the zoom
    const zoomTo = (level: number) =>
      app.evaluate(({ BrowserWindow }, l) => BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(l), level);
    await zoomTo(-0.5);
    try {
      const inWindow = async () => {
        const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
        const f = await page.locator("#top-row .app-pane[data-app=browser] iframe").evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left + el.clientLeft, y: r.top + el.clientTop };
        });
        const s = await panel(page).locator(".bw-stage").evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        });
        return { zoom, x: (f.x + s.x) * zoom, y: (f.y + s.y) * zoom, w: s.w * zoom, h: s.h * zoom };
      };
      let want = await inWindow();
      expect(want.zoom).toBeLessThan(0.95);
      await until(async () => {
        want = await inWindow();
        const b = (await pagesOf(app)).find((p) => p.url === site && p.visible)?.bounds;
        return !!b && Math.abs(b.x - want.x) < 2 && Math.abs(b.y - want.y) < 2 &&
          Math.abs(b.width - want.w) < 2 && Math.abs(b.height - want.h) < 2;
      }, 10_000).catch(async (e) => {
        console.log("want:", JSON.stringify(want), "pages:", JSON.stringify(await pagesOf(app)));
        throw e;
      });
    } finally {
      await zoomTo(0);
    }
    await until(async () => {
      const b = (await pagesOf(app)).find((p) => p.url === site && p.visible)?.bounds;
      return !!b && Math.abs(b.width - stage!.width) < 2;
    }, 10_000);

    const email = await refOnce('textbox "Email"');
    const pay = await refOnce('button "Pay"');
    const still = [{ js: "document.title === 'Shop'", why: "still the shop" }];
    expect((await tool("type", { ref: email, text: "app@example.com", expect: still })).error).toBe(false);
    expect((await tool("click", { ref: pay, expect: still })).error).toBe(false);
    await until(async () => (await pageText(app, site, "#out")) === "paid app@example.com");

    await closePanel(page); // its panel closed: the page hidden, kept
    await until(async () => (await pagesOf(app)).every((p) => !p.visible));
  } finally {
    await app.close();
  }
});

test("a page's popup opens as a real one and hands its result back", async () => {
  const { app } = await launch();
  try {
    await until(async () => (await pagesOf(app)).some((p) => p.url === site)); // its tab back, from before
    expect((await browserAsk("nav", { url: `${site}login.html` })).done).toBe(`${site}login.html`);
    const signIn = await refOnce('button "Sign in with popup"');
    const still = [{ js: "document.title === 'Login'", why: "the login page" }];
    expect((await tool("click", { ref: signIn, expect: still })).error).toBe(false);
    await until(async () => (await pageText(app, `${site}login.html`, "#out")) === "got: signed in");
    await until(async () => !(await pagesOf(app)).some((p) => p.url.endsWith("popup.html"))); // it closed itself
  } finally {
    await app.close();
  }
});

test("quitting the app pauses the Browser; the agent is told to ask for the app", async () => {
  const { app } = await launch();
  expect((await browserAsk("nav", { url: `${site}login.html` })).done).toBe(`${site}login.html`);
  await refOnce('button "Sign in with popup"'); // loaded: its address is the tab's now
  await app.close();
  let said = "";
  await until(async () => (said = (await tool("snapshot", {})).text).includes("paused while the ag app is closed")).catch((e) => {
    throw new Error(`${e}: the agent was told: ${said}`);
  });
  const again = await launch(); // its tabs come back where they were
  try {
    await until(async () => (await pagesOf(again.app)).some((p) => p.url === `${site}login.html` && p.visible));
  } finally {
    await again.app.close();
  }
});

// ---- step 3: what the dashboard draws over the screen elsewhere, and the user's own input, in the native page ----

/** The Browser's state, as a page showing it gets it first. */
function stateOf(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: `/api/w/g/${key}/stream?native=1&page=e2e`,
      headers: { host: `browser.localhost:${port}` } }, (res) => {
      let text = "";
      res.on("data", (c) => {
        text += c;
        const m = /event: state\ndata: (.*)\n/.exec(text);
        if (m) {
          req.destroy();
          resolve(JSON.parse(m[1]) as Record<string, unknown>);
        }
      });
    });
    req.on("error", (e) => (String(e).includes("socket hang up") ? undefined : reject(e)));
  });
}

/** The user's own input to a native page (as the Mac gives it to the app): by its address. */
const native = (app: ElectronApplication, url: string, events: Electron.InputEvent[]) =>
  app.evaluate(
    async ({ BrowserWindow }, [u, evs]) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => (c as Electron.WebContentsView).webContents.getURL() === u);
      const wc = (v as Electron.WebContentsView).webContents;
      for (const e of evs as Electron.InputEvent[]) {
        wc.sendInputEvent(e as Electron.MouseInputEvent);
        await new Promise((r) => setTimeout(r, 30));
      }
    },
    [url, events] as const,
  );

/** The middle of an element of a native page, in the page's own coordinates. */
const middleOf = (app: ElectronApplication, url: string, selector: string) =>
  app.evaluate(
    ({ BrowserWindow }, [u, s]) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find((c) => (c as Electron.WebContentsView).webContents.getURL() === u);
      return (v as Electron.WebContentsView).webContents.executeJavaScript(
        `(() => { const r = document.querySelector(${JSON.stringify(s)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
      ) as Promise<[number, number]>;
    },
    [url, selector],
  );

const click = (x: number, y: number): Electron.InputEvent[] => [
  { type: "mouseDown", x, y, button: "left", clickCount: 1 } as Electron.MouseInputEvent,
  { type: "mouseUp", x, y, button: "left", clickCount: 1 } as Electron.MouseInputEvent,
];

test("over the page: the agent's cues, Pick and Area, the user's click told, Esc, a menu over the pane", async () => {
  const { app, page } = await launch();
  try {
    expect((await browserAsk("nav", { url: site })).done).toBe(site);
    const email = await refOnce('textbox "Email"');
    const shop = [{ js: "document.title === 'Shop'", why: "the shop" }];

    // the agent's cues: drawn in the page itself, as it acts
    expect((await tool("click", { ref: email, expect: shop })).error).toBe(false);
    expect(await pageText(app, site, "ag-cues")).not.toBeNull();     // (its marks in a closed shadow root)

    // Pick, in Chrome's inspector: a click on the page picks, not clicks
    const picks = () => stateOf().then((s) => (s.picks as { label: string }[]).map((p) => p.label));
    const before = (await picks()).length;
    await panel(page).getByRole("button", { name: /Pick an element/ }).click();
    await until(async () => (await stateOf()).picking === "pick");
    const [px, py] = await middleOf(app, site, "#pay");
    await native(app, site, [{ type: "mouseMove", x: px, y: py } as Electron.MouseInputEvent, ...click(px, py)]);
    await until(async () => (await picks()).length === before + 1);
    expect((await picks()).at(-1)).toContain("Pay");
    expect(await pageText(app, site, "#out")).toBe("");            // the page got no click
    expect((await stateOf()).picking).toBe(null);

    // Area: a box dragged over the page
    await panel(page).getByRole("button", { name: /Pick an area/ }).click();
    await until(async () => (await stateOf()).picking === "area");
    await new Promise((r) => setTimeout(r, 300));                    // (its catcher drawn in the page)
    await native(app, site, [
      { type: "mouseDown", x: 20, y: 20, button: "left", clickCount: 1 } as Electron.MouseInputEvent,
      { type: "mouseMove", x: 120, y: 90, button: "left" } as Electron.MouseInputEvent,
      { type: "mouseMove", x: 220, y: 140, button: "left" } as Electron.MouseInputEvent,
      { type: "mouseUp", x: 220, y: 140, button: "left", clickCount: 1 } as Electron.MouseInputEvent,
    ]);
    await until(async () => (await picks()).length === before + 2);
    expect((await picks()).at(-1)).toMatch(/an area 200×120/);

    // the user's own click in the page, told to the agent with its next action
    const pay = await refOnce('button "Pay"');
    const [bx, by] = await middleOf(app, site, "#pay");
    await native(app, site, click(bx, by));
    await until(async () => (await pageText(app, site, "#out"))?.startsWith("paid") ?? false);
    await new Promise((r) => setTimeout(r, 1500));                   // (past the agent's own last action)
    // told the agent: with its next action, or, if it came after a while, as the Browser's message in its channel
    const result = (await tool("click", { ref: pay, expect: shop })).text;
    if (!result.includes('Meanwhile, the user: clicked button "Pay"')) {
      const told = (await ask(`/api/apps/events?app=browser&gatherer=g&instance=${key}&types=context_stream&channel=${agent}`)) as {
        events: { payload: { stream: string; text: string } }[];
      };
      expect(told.events.map((e) => [e.payload.stream, e.payload.text.includes('the user: clicked button "Pay"')])).toContainEqual(
        ["Browser", true],
      );
    }

    // a menu of the dashboard's over the pane: a still picture of the page in its place, the page back after
    await panel(page).locator(".bw-feed .line").click();
    await until(async () => (await pagesOf(app)).every((p) => !p.visible));
    expect(await panel(page).locator(".bw-stage > img").getAttribute("src")).toMatch(/^data:image\/png/);
    await page.keyboard.press("Escape");
    await panel(page).locator(".bw-bar input[aria-label=Address]").click();   // (anywhere outside it closes it too)
    await until(async () => (await pagesOf(app)).some((p) => p.url === site && p.visible));
  } finally {
    await app.close();
  }
});

// Something of the dashboard's over the pane -- a card the size of a folder's hover card -- and gone again: the page
// swapped for its still picture and back with no blank between. Timed on both sides: in the app, when the page is
// hidden and shown (polled every millisecond); in the dashboard, each frame, whether the still picture is drawn (shown
// and decoded). (A card, not a hovered one: the app hiding or showing a page moves the window's real pointer, which in
// a test is not where Playwright's is.)
test("a card over the pane: the page hidden only once its picture is drawn, shown before the picture goes", async () => {
  const { app, page } = await launch();
  try {
    expect((await browserAsk("nav", { url: site })).done).toBe(site);
    await refOnce('button "Pay"');
    await until(async () => (await pagesOf(app)).some((p) => p.url === site && p.visible));

    await app.evaluate(({ BrowserWindow }, u) => {
      const g = globalThis as unknown as { agShown: [number, boolean | null][]; agPoll: NodeJS.Timeout };
      g.agShown = [];
      let last: boolean | null | undefined;
      g.agPoll = setInterval(() => {
        const v = BrowserWindow.getAllWindows()[0]?.contentView.children.find((c) => (c as Electron.WebContentsView).webContents.getURL() === u);
        const now = v ? v.getVisible() : null;
        if (now !== last) g.agShown.push([Date.now(), now]);
        last = now;
      }, 1);
    }, site);
    await panelFrame(page).evaluate(() => {
      const w = window as unknown as { agDrawn: [number, boolean][] };
      w.agDrawn = [];
      const frame = () => {
        const img = document.querySelector<HTMLImageElement>(".bw-stage > img");
        const drawn = !!img && !img.hidden && img.complete && img.naturalWidth > 0 && img.src.startsWith("data:");
        if (w.agDrawn.at(-1)?.[1] !== drawn) w.agDrawn.push([Date.now(), drawn]);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    const stage = (await panel(page).locator(".bw-stage").boundingBox())!;
    for (let round = 0; round < 3; round++) {
      await page.evaluate(([x, y]) => {
        const d = document.createElement("div");
        d.id = "e2e-card";
        Object.assign(d.style, { position: "fixed", left: `${x}px`, top: `${y}px`, width: "300px", height: "160px", background: "#444",
          borderRadius: "9px", zIndex: "70" });
        document.body.append(d);
      }, [stage.x - 40, stage.y + 20]);
      const why = async (what: string) => `${what}: ${JSON.stringify(await pagesOf(app))}`;
      await until(async () => (await pagesOf(app)).every((p) => !p.visible), 10_000).catch(async () => {
        throw new Error(await why(`round ${round}, covered: the page still shown`));
      });
      await new Promise((r) => setTimeout(r, 300));
      await page.evaluate(() => document.getElementById("e2e-card")?.remove());
      await until(async () => (await pagesOf(app)).some((p) => p.url === site && p.visible), 10_000).catch(async () => {
        throw new Error(await why(`round ${round}, uncovered: the page not back`));
      });
      await new Promise((r) => setTimeout(r, 400));
    }

    const shown = await app.evaluate(() => {
      const g = globalThis as unknown as { agShown: [number, boolean | null][]; agPoll: NodeJS.Timeout };
      clearInterval(g.agPoll);
      return g.agShown;
    });
    const drawn = await panelFrame(page).evaluate(() => (window as unknown as { agDrawn: [number, boolean][] }).agDrawn);
    const drawnAt = (t: number) => drawn.filter(([at]) => at <= t).at(-1)?.[1] ?? false;
    const gaps: string[] = [];
    for (let i = 0; i < shown.length; i++) {
      const [at, visible] = shown[i];
      if (visible !== false) continue;
      const back = shown[i + 1]?.[0] ?? Date.now();
      // hidden: its picture drawn by then, and through to when the page is back
      if (!drawnAt(at)) gaps.push(`hidden ${(drawn.find(([t, d]) => t > at && d)?.[0] ?? back) - at} ms before its picture was drawn`);
      for (const [t, d] of drawn) if (t > at && t < back && !d) gaps.push(`its picture gone ${back - t} ms before the page was back`);
    }
    expect(shown.filter(([, v]) => v === false).length).toBe(3);
    expect(gaps).toEqual([]);
  } finally {
    await app.close();
  }
});

// ---- step 4: what Electron leaves to the app ----

test("a page's dialogs, find, downloads and permission asks", async () => {
  const { app, page } = await launch();
  try {
    const url = `${site}dialogs.html`;
    expect((await browserAsk("nav", { url })).done).toBe(url);
    const here = [{ js: "document.title === 'Dialogs'", why: "the dialogs page" }];

    // a confirm the agent's click opens, which it answers itself
    expect((await tool("click", { ref: await refOnce('button "Confirm"'), expect: here })).text).toContain("Sure?");
    expect(((await stateOf()).dialog as { type: string }).type).toBe("confirm");
    expect((await tool("dialog", { accept: true })).error).toBe(false);
    await until(async () => (await pageText(app, url, "#out")) === "confirmed true");

    // a prompt the user answers, in the dashboard's dialog over the page's still picture
    void tool("click", { ref: await refOnce('button "Prompt"'), expect: here });
    const card = panel(page).locator(".bw-stage > .dialog:not(.chooser)");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await until(async () => (await pagesOf(app)).every((p) => !p.visible));   // (the page under it, as a picture)
    await card.locator("input").fill("Grace");
    await card.getByRole("button", { name: "OK" }).click();
    await until(async () => (await pageText(app, url, "#out")) === "prompted Grace");
    await until(async () => (await pagesOf(app)).some((p) => p.url === url && p.visible));

    // Cmd+F in the page: the dashboard's find bar, finding in the page as Chrome does
    await native(app, url, [
      { type: "keyDown", keyCode: "F", modifiers: ["meta"] } as Electron.KeyboardInputEvent,
      { type: "keyUp", keyCode: "F", modifiers: ["meta"] } as Electron.KeyboardInputEvent,
    ]);
    const bar = panel(page).locator(".bw-find");
    await expect(bar).toBeVisible();
    await bar.locator("input").fill("Dialogs");
    await expect(bar.locator(".n")).toHaveText("1 of 1");
    await bar.locator("input").press("Escape");
    await expect(bar).toBeHidden();

    // a download: into the home's downloads folder, listed for the Browser
    const [lx, ly] = await middleOf(app, url, "#d");
    await native(app, url, click(lx, ly));
    await until(async () => ((await stateOf()).downloads as { name: string }[]).some((d) => d.name === "notes.txt"));
    expect(readFileSync(path.join(home, "dashboard", "downloads", "notes.txt"), "utf8")).toBe("the notes\n");

    // a site's permission ask: put to the user by the app, their answer kept for the site
    await app.evaluate(({ dialog }) => {
      const asked: string[] = [];
      (globalThis as { asked?: string[] }).asked = asked;
      dialog.showMessageBox = (async (_w: unknown, o: Electron.MessageBoxOptions) => {
        asked.push(o.message);
        return { response: 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    });
    const [nx, ny] = await middleOf(app, url, "#n");
    await native(app, url, click(nx, ny));
    await until(async () => (await pageText(app, url, "#out")) === "notifications granted");
    expect(await app.evaluate(() => (globalThis as { asked?: string[] }).asked)).toEqual([`${new URL(site).host} wants to show notifications`]);
    expect(JSON.parse(readFileSync(path.join(home, "desktop", "permissions.json"), "utf8"))).toEqual({
      [`${new URL(site).origin} notifications`]: true,
    });
  } finally {
    await app.close();
  }
});

// ---- a page no pane shows ----

/** The color at (fx, fy) of the shown page `url`, as the window draws it. */
const colorOf = (app: ElectronApplication, url: string, fx: number, fy: number) =>
  app.evaluate(
    async ({ BrowserWindow }, [u, x, y]) => {
      const v = BrowserWindow.getAllWindows()[0].contentView.children.find(
        (c) => c.getVisible() && (c as Electron.WebContentsView).webContents.getURL() === u,
      );
      if (!v) return null;
      const img = await (v as Electron.WebContentsView).webContents.capturePage();
      const { width, height } = img.getSize(), bmp = img.toBitmap();
      const i = (Math.floor(height * (y as number)) * width + Math.floor(width * (x as number))) * 4;
      return [bmp[i + 2], bmp[i + 1], bmp[i]]; // (BGRA)
    },
    [url, fx, fy] as const,
  );

test("a tab the agent opens while its pane shows something else: at the pane's size, drawn whole, pictured", async () => {
  const { app, page } = await launch();
  try {
    expect((await browserAsk("nav", { url: site })).done).toBe(site);
    await refOnce('button "Pay"');
    const pane = (await panel(page).locator(".bw-stage").boundingBox())!;
    await closePanel(page);
    await until(async () => (await pagesOf(app)).every((p) => !p.visible));

    const red = `${site}red.html`;
    expect((await tool("tabs", { action: "new", url: red, expect: [{ js: "document.title === 'Shop'", why: "the shop" }] })).error)
      .toBe(false);
    const here = [{ js: "document.title === 'Red'", why: "the red page" }];
    // laid out at the pane's size, not 0 x 0 (a page hidden in the window has none)
    const [w, h] = JSON.parse((await tool("evaluate", { expression: "[innerWidth, innerHeight]", says: "its size", expect: here })).text);
    expect(w).toBe(Math.floor(pane.width));
    expect(Math.abs(h - pane.height)).toBeLessThan(60);
    // the agent's screenshot of it, at half scale for a 2x screen, leaves it drawn at its own
    expect((await tool("screenshot", {})).error).toBe(false);

    // shown while a menu of the dashboard's covers the pane: a picture of the page, not a blank
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.id = "e2e-cover";
      Object.assign(d.style, { position: "fixed", left: "0", right: "0", bottom: "0", height: "40%", background: "#333", zIndex: "50" });
      document.body.append(d);
    });
    await openPanel(page);
    const still = panel(page).locator(".bw-stage > img");
    await until(async () => ((await still.getAttribute("src")) || "").length > 1000);
    const pixel = await still.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return [...g.getImageData(Math.floor(c.width * 0.9), Math.floor(c.height * 0.9), 1, 1).data.slice(0, 3)];
    });
    expect(pixel).toEqual([255, 0, 0]);

    // uncovered: the page itself over the pane, red to its far corner
    await page.evaluate(() => document.getElementById("e2e-cover")?.remove());
    await until(async () => (await pagesOf(app)).some((p) => p.url === red && p.visible));
    await until(async () => JSON.stringify(await colorOf(app, red, 0.95, 0.95)) === "[255,0,0]", 10_000);

    // (its tab closed: the next test's Browser has one tab, as before)
    expect((await tool("tabs", { action: "close", index: 2, expect: [{ tab: 2, js: "document.title === 'Red'", why: "the red tab" }] })).error)
      .toBe(false);
  } finally {
    await app.close();
  }
});

// Last: an Esc keeps the agent stopped until the user's next message, which these tests never send.
test("Esc on the page stops the agent", async () => {
  const { app } = await launch();
  try {
    expect((await browserAsk("nav", { url: site })).done).toBe(site);
    const pay = await refOnce('button "Pay"');
    const shop = [{ js: "document.title === 'Shop'", why: "the shop" }];
    // its steps, shown coming one by one, stop
    const going = tool("steps", { steps: [
      { tool: "click", ref: pay, expect: shop }, { tool: "click", ref: pay, expect: shop },
      { tool: "click", ref: pay, expect: shop }, { tool: "click", ref: pay, expect: shop } ] });
    await until(async () => !!(await stateOf()).playing, 10_000);
    await native(app, site, [{ type: "keyDown", keyCode: "Escape" } as Electron.KeyboardInputEvent, { type: "keyUp", keyCode: "Escape" } as Electron.KeyboardInputEvent]);
    expect((await going).text).toContain("the user pressed Esc to stop you");

  } finally {
    await app.close();
  }
});
