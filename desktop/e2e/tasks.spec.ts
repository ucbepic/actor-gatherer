// Several Browsers of one task in the app (07-panes.js's TASKS): an actor attached to two Browsers, opened, shows both
// panels above it -- each Browser's tab a native page kept over its own panel's screen, both shown at once.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.dirname(DESKTOP);
const PYTHON = process.env.AG_PYTHON || "";
test.skip(!PYTHON, "AG_PYTHON (a Python with ag's dashboard packages) is needed to run real dashboards");

let scratch = "";
let home = "";
let port = 0;
let site = "";
let agent = "";
let otherAgent = "";
const keys: string[] = [];
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
/** A request to the dashboard (`app`: to that app's own origin, as its panel makes one): its JSON answer. */
function ask(route: string, body?: unknown, app?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const host = app ? `${app}.localhost:${port}` : `127.0.0.1:${port}`;
    const req = http.request(
      { host: "127.0.0.1", port, path: route, method: data === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", origin: `http://${host}`, host } },
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
async function until(check: () => Promise<boolean>, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timed out");
}
/** The list's row of actor `c`: its task's, as the server keeps it (an actor and the Browsers it works with, one task:
 * the dashboard's task_links.py), else its own. */
async function rowOf(page: Page, c: string) {
  const tasks = ((await ask("/api/home")).tasks || {}) as Record<string, { tasked: Record<string, number> }>;
  const t = tasks.g?.tasked?.[c];
  return page.locator(t === undefined ? `#agents button.agent[data-key$="${c}"]` : `#agents button.agent.task[data-key$="/task:${t}"]`);
}
/** The app's native pages: each one's address, whether it shows, and where. */
const pagesOf = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children.map((v) => {
      const wc = (v as Electron.WebContentsView).webContents;
      return { url: wc.getURL(), visible: v.getVisible(), bounds: v.getBounds() };
    }),
  );

/** The shown native page at `url`: its own size (innerWidth x innerHeight) and its view's. */
const sizeOf = (app: ElectronApplication, url: string) =>
  app.evaluate(async ({ BrowserWindow }, url) => {
    for (const v of BrowserWindow.getAllWindows()[0].contentView.children) {
      const wc = (v as Electron.WebContentsView).webContents;
      if (!v.getVisible() || !wc || wc.getURL() !== url) continue;
      const [w, h] = (await wc.executeJavaScript("[innerWidth, innerHeight]")) as number[];
      return { page: { width: w, height: h }, view: v.getBounds() };
    }
    return null;
  }, url);
type Box = { width: number; height: number };
/** That page shown, its view as `wanted` (by default, any), laid out at its view's size: drawn over its whole pane, no
 * more, no less. */
async function fits(app: ElectronApplication, url: string, what: string, wanted = (_: Box) => true): Promise<Box> {
  let last: Awaited<ReturnType<typeof sizeOf>> = null;
  await until(async () => {
    last = await sizeOf(app, url);
    return !!last && wanted(last.view) && last.page.width === last.view.width && last.page.height === last.view.height;
  }, 10_000).catch(() => {
    throw new Error(`${what}: the page is ${JSON.stringify(last?.page)}, its view ${JSON.stringify(last?.view)}`);
  });
  return last!.view;
}
/** The app's window made `by` px narrower (its size is kept for the next run: made wider again after). */
const narrower = (app: ElectronApplication, by: number) =>
  app.evaluate(({ BrowserWindow }, by) => {
    const w = BrowserWindow.getAllWindows()[0];
    const [cw, ch] = w.getContentSize();
    w.setContentSize(cw - by, ch);
  }, by);
/** The app, its window in front (one behind others gets no new sizes until it is in front: Chromium's occlusion). */
async function launchInFront(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [DESKTOP, "--home", home, "--port", String(port)], env: env() });
  if (process.env.AG_E2E_DEBUG) app.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  const page = await app.firstWindow();
  await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
  await app.evaluate(({ app: a, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    a.focus({ steal: true });
    w.focus();
  });
  return { app, page };
}

test.beforeAll(async () => {
  scratch = mkdtempSync("/tmp/agm-");
  home = path.join(scratch, "home");
  const root = path.join(scratch, "site");
  mkdirSync(home);
  mkdirSync(root);
  execFileSync(PYTHON, ["-c", [
    "import os",
    "from ag.ag_harness.home import home",
    "h = home(); h.ensure()",
    "p = os.path.join(h.root, 'config.toml'); s = open(p).read()",
    "open(p, 'w').write(s.replace('model = \"\"', 'model = \"claude-code/haiku\"', 1) + '\\n[dashboard]\\nchat = \"headless\"\\n')",
    "home().manager('g').init('g')",
  ].join("\n")], { cwd: REPO, env: { ...env(), AG_HOME: home } });
  writeFileSync(path.join(root, "one.html"), "<!doctype html><title>One</title><h1>One</h1>");
  writeFileSync(path.join(root, "two.html"), "<!doctype html><title>Two</title><h1>Two</h1>");
  siteServer = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end((req.url || "").includes("two") ? "<!doctype html><title>Two</title><h1>Two</h1>" : "<!doctype html><title>One</title><h1>One</h1>");
  });
  await new Promise<void>((r) => siteServer!.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${(siteServer.address() as AddressInfo).port}/`;
  port = await freePort();
  const withAg = { ...env(), AG_COMMAND: `${PYTHON} ${path.join(REPO, "ag", "cli", "ag")}` };
  dashboard = spawn(PYTHON, ["-m", "ag_dashboard", "--home", home, "--port", String(port)], { cwd: REPO, env: withAg,
    stdio: process.env.AG_E2E_DEBUG ? ["ignore", "inherit", "inherit"] : "ignore" });
  await until(async () => (await ask("/api/home").catch((): Record<string, unknown> => ({}))).home === home);
  // a Browser with an agent of its own, and a second Browser attached to that agent too
  const made = await ask("/api/apps/start", { app: "browser", gatherer: "g", cwd: root, harness: "claude" });
  keys.push(String((made.instance as { id: string }).id));
  agent = String((made.session as { session_id: string }).session_id);
  const second = await ask("/api/apps/open", { app: "browser", gatherer: "g", folder: root, channel: agent });
  keys.push(String(second.id));
  expect(keys[0]).not.toBe(keys[1]);
  // another actor with a Browser of its own, on a blank tab
  const other = await ask("/api/apps/start", { app: "browser", gatherer: "g", cwd: root, harness: "claude" });
  keys.push(String((other.instance as { id: string }).id));
  otherAgent = String((other.session as { session_id: string }).session_id);
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

test("an actor with two Browsers opened: both panels above it, each one's page shown over its own", async () => {
  const app = await electron.launch({ args: [DESKTOP, "--home", home, "--port", String(port)], env: env() });
  if (process.env.AG_E2E_DEBUG) app.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  let page: Page | null = null;
  try {
    page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
    await page.locator(".agent:not(.coordinator)").first().click(); // its task: both its Browsers above it
    const panels = page.locator("#top-row .app-pane[data-app=browser]");
    await expect(panels).toHaveCount(2);
    await expect(panels.nth(0).frameLocator("iframe").locator(".bw-stage")).toBeVisible();
    await expect(panels.nth(1).frameLocator("iframe").locator(".bw-stage")).toBeVisible();
    // each its own page
    expect((await ask(`/api/w/g/${keys[0]}/nav`, { url: `${site}one` }, "browser")).done).toBe(`${site}one`);
    expect((await ask(`/api/w/g/${keys[1]}/nav`, { url: `${site}two` }, "browser")).done).toBe(`${site}two`);
    await until(async () => {
      const shown = (await pagesOf(app)).filter((p) => p.visible && p.bounds.width > 50 && p.bounds.height > 50);
      return shown.some((p) => p.url.endsWith("one")) && shown.some((p) => p.url.endsWith("two"));
    }, 30_000).catch(async (e) => {
      console.log("pages:", JSON.stringify(await pagesOf(app)));
      for (let i = 0; i < 2; i++) {
        const b = await panels.nth(i).boundingBox();
        console.log(`panel ${i}:`, JSON.stringify(b));
      }
      throw e;
    });
    const pages = (await pagesOf(app)).filter((p) => p.visible);
    const one = pages.find((p) => p.url.endsWith("one"))!.bounds, two = pages.find((p) => p.url.endsWith("two"))!.bounds;
    expect(one.x + one.width <= two.x || two.x + two.width <= one.x).toBe(true); // side by side, not over one another
  } finally {
    await app.close();
  }
});

test("an actor with two Browsers opened beside another's Browser (⌘), then on its own: its pages shown each time", async () => {
  const app = await electron.launch({ args: [DESKTOP, "--home", home, "--port", String(port)], env: env() });
  if (process.env.AG_E2E_DEBUG) app.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  const shown = async () => (await pagesOf(app)).filter((p) => p.visible && p.bounds.width > 50 && p.bounds.height > 50).map((p) => p.url);
  const both = async () => { const s = await shown(); return s.some((u) => u.endsWith("one")) && s.some((u) => u.endsWith("two")); };
  try {
    const page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
    const row = (c: string) => rowOf(page, c);
    const panels = page.locator("#top-row .app-pane[data-app=browser]");
    await (await row(otherAgent)).click(); // the other actor: its Browser alone
    await expect(panels).toHaveCount(1);
    await (await row(agent)).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] }); // beside it: its two
    await expect(panels).toHaveCount(3);
    await until(both, 30_000).catch(async (e) => { console.log("after ⌘:", JSON.stringify(await pagesOf(app))); throw e; });
    await (await row(otherAgent)).click(); // back to the other: its Browser alone
    await expect(panels).toHaveCount(1);
    await (await row(agent)).click(); // the two-Browser actor alone: its pages shown again
    await expect(panels).toHaveCount(2);
    await until(both, 30_000).catch(async (e) => { console.log("again:", JSON.stringify(await pagesOf(app))); throw e; });
  } finally {
    await app.close();
  }
});

test("its pages shown again after the page is reloaded, and after the dashboard restarts under the open app", async () => {
  const app = await electron.launch({ args: [DESKTOP, "--home", home, "--port", String(port)], env: env() });
  if (process.env.AG_E2E_DEBUG) app.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  const shown = async () => (await pagesOf(app)).filter((p) => p.visible && p.bounds.width > 50 && p.bounds.height > 50).map((p) => p.url);
  const both = async () => { const s = await shown(); return s.some((u) => u.endsWith("one")) && s.some((u) => u.endsWith("two")); };
  try {
    const page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
    const row = (c: string) => rowOf(page, c);
    const panels = page.locator("#top-row .app-pane[data-app=browser]");
    await (await row(agent)).click();
    await expect(panels).toHaveCount(2);
    await until(both, 30_000);
    await page.reload(); // ⌘R
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
    await expect(panels).toHaveCount(2);
    await until(both, 30_000).catch(async (e) => { console.log("after reload:", JSON.stringify(await pagesOf(app))); throw e; });
    await (await row(otherAgent)).click();
    await (await row(agent)).click();
    await until(both, 30_000).catch(async (e) => { console.log("after reload, switched:", JSON.stringify(await pagesOf(app))); throw e; });
    // the dashboard restarted, the app left open (it links to the new one)
    const gone = new Promise((r) => dashboard!.once("exit", r));
    dashboard!.kill();
    await gone;
    const withAg = { ...env(), AG_COMMAND: `${PYTHON} ${path.join(REPO, "ag", "cli", "ag")}` };
    dashboard = spawn(PYTHON, ["-m", "ag_dashboard", "--home", home, "--port", String(port)], { cwd: REPO, env: withAg,
      stdio: process.env.AG_E2E_DEBUG ? ["ignore", "inherit", "inherit"] : "ignore" });
    await until(async () => (await ask("/api/home").catch((): Record<string, unknown> => ({}))).home === home);
    await page.reload();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
    await (await row(otherAgent)).click();
    await (await row(agent)).click();
    await expect(panels).toHaveCount(2);
    await until(both, 30_000).catch(async (e) => { console.log("after restart:", JSON.stringify(await pagesOf(app))); throw e; });
  } finally {
    await app.close();
  }
});

// An actor's Browser shown again at another size than its pane had when it was hidden (here the window made narrower
// while another actor showed; as often the chat minimized or shown under it in another task), its actor's row clicked
// in the list -- its hover card over the pane as it comes back, so the app pictures the page meanwhile: the page then
// follows its pane's resizes, the chat minimized and shown again under it. (Chrome put back the hidden page's emulation
// once the picture was made, after the page showed: browsers.ts's `reemulate`.)
test("a Browser shown again at another size keeps up with its pane: the chat minimized and shown under it", async () => {
  const { app, page } = await launchInFront();
  const url = `${site}one`;
  let narrowed = false;
  try {
    const row = (c: string) => rowOf(page, c);
    const panels = page.locator("#top-row .app-pane[data-app=browser]");
    await (await row(otherAgent)).click();
    await expect(panels).toHaveCount(1);
    expect((await ask(`/api/w/g/${keys[2]}/nav`, { url }, "browser")).done).toBe(url);
    const first = await fits(app, url, "shown");
    await (await row(agent)).click();
    await expect(panels).toHaveCount(2);
    await narrower(app, 200);
    narrowed = true;
    await (await row(otherAgent)).click();
    await expect(panels).toHaveCount(1);
    const again = await fits(app, url, "shown again, narrower", (v) => v.width < first.width);
    await page.locator('button[aria-label="Minimize the chat"]').first().click();
    await fits(app, url, "the chat minimized", (v) => v.height > again.height + 100);
    await page.locator("button.mini-back").first().click();
    await fits(app, url, "the chat shown again", (v) => v.height === again.height);
  } finally {
    if (narrowed) await narrower(app, -200).catch(() => {});
    await app.close();
  }
});

// The same, with nothing but a card of the dashboard's over the pane as the Browser comes back at its new size, gone
// while the app is still picturing the page: the page then follows its pane's resizes.
test("a Browser shown while its still picture is being taken keeps up with its pane: the chat minimized under it", async () => {
  const { app, page } = await launchInFront();
  const url = `${site}two`;
  let narrowed = false;
  try {
    const row = (c: string) => rowOf(page, c);
    const panels = page.locator("#top-row .app-pane[data-app=browser]");
    await (await row(otherAgent)).click();
    await expect(panels).toHaveCount(1);
    expect((await ask(`/api/w/g/${keys[2]}/nav`, { url }, "browser")).done).toBe(url);
    await fits(app, url, "shown");
    const pane = (await panels.first().boundingBox())!;
    await (await row(agent)).click();
    await expect(panels).toHaveCount(2);
    await narrower(app, 200);
    narrowed = true;
    // a card over where its pane comes back (its actor's own hover card kept away): the page's picture asked for
    await page.evaluate((b) => {
      const d = document.createElement("div");
      d.id = "e2e-cover";
      Object.assign(d.style, { position: "fixed", left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`,
        height: `${b.height}px`, zIndex: "99999", background: "rgba(128,128,128,0.2)" });
      document.body.append(d);
    }, pane);
    await (await row(otherAgent)).click();
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height + 150); // (off the list: no hover card)
    await expect(panels).toHaveCount(1);
    await until(async () => (await pagesOf(app)).some((p) => p.url === url && !p.visible), 5_000); // under its picture
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => document.getElementById("e2e-cover")?.remove()); // the card gone: the page shown
    const shown = await fits(app, url, "shown after the card went", (v) => v.width < pane.width);
    await new Promise((r) => setTimeout(r, 3500)); // (its picture made by now: PICTURE_WAIT)
    await page.locator('button[aria-label="Minimize the chat"]').first().click();
    await fits(app, url, "the chat minimized", (v) => v.height > shown.height + 100);
  } finally {
    if (narrowed) await narrower(app, -200).catch(() => {});
    await app.close();
  }
});
