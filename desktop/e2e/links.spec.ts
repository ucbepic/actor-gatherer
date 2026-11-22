// A link clicked in an actor's pane, in the app (features/layout/panes.js's openLink): opened in a Browser of the actor's task -- a
// new Browser put in the task of an actor that has none, then new tabs of it -- each page a native one over the
// Browser's panel, never the user's own browser; a click with ⌘/Ctrl held goes there, as before (main.ts's `outside`).
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
/** A request to the dashboard, as its page makes one: its JSON answer. */
function ask(route: string, body?: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const host = `127.0.0.1:${port}`;
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
/** The app's native pages: each one's address, whether it shows, and where. */
const pagesOf = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].contentView.children.map((v) => {
      const wc = (v as Electron.WebContentsView).webContents;
      return { url: wc.getURL(), visible: v.getVisible(), bounds: v.getBounds() };
    }),
  );
const shown = async (app: ElectronApplication) =>
  (await pagesOf(app)).filter((p) => p.visible && p.bounds.width > 50 && p.bounds.height > 50);
/** A link in the actor's pane, where a message's is -- as messages draw them (frontend core/ui/md.ts). */
async function addLink(page: Page, id: string, href: string) {
  await page.locator("#pane-here").evaluate(
    (pane, [i, h]) => {
      const a = Object.assign(document.createElement("a"), { id: i, href: h, target: "_blank", rel: "noopener noreferrer" });
      a.textContent = i;
      Object.assign(a.style, { position: "absolute", left: "40px", top: "60px", zIndex: "50", background: "yellow" });
      pane.append(a);
    },
    [id, href],
  );
  return page.locator(`#${id}`);
}

test.beforeAll(async () => {
  scratch = mkdtempSync("/tmp/agl-");
  home = path.join(scratch, "home");
  const root = path.join(scratch, "work");
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
  siteServer = http.createServer((req, res) => {
    const name = (req.url || "/").replace(/\W/g, "") || "index";
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>${name}</title><h1>${name}</h1>`);
  });
  await new Promise<void>((r) => siteServer!.listen(0, "127.0.0.1", r));
  site = `http://127.0.0.1:${(siteServer.address() as AddressInfo).port}/`;
  port = await freePort();
  const withAg = { ...env(), AG_COMMAND: `${PYTHON} ${path.join(REPO, "ag", "cli", "ag")}` };
  dashboard = spawn(PYTHON, ["-m", "ag_dashboard", "--home", home, "--port", String(port)], { cwd: REPO, env: withAg,
    stdio: process.env.AG_E2E_DEBUG ? ["ignore", "inherit", "inherit"] : "ignore" });
  await until(async () => (await ask("/api/home").catch((): Record<string, unknown> => ({}))).home === home);
  // an actor with no Browser (its agent not started: the home's chat is headless)
  agent = String((await ask("/api/sessions", { gatherer: "g", cwd: root, harness: "claude" })).session_id);
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

test("a link opens a Browser in the actor's task, then new tabs of it, each a native page over its panel", async () => {
  const app = await electron.launch({ args: [DESKTOP, "--home", home, "--port", String(port)], env: env() });
  if (process.env.AG_E2E_DEBUG) app.process().stdout?.on("data", (d) => process.stdout.write(`[app] ${d}`));
  try {
    // what goes to the user's own browser, kept here instead
    await app.evaluate(({ shell }) => {
      const sent: string[] = [];
      (globalThis as { sent?: string[] }).sent = sent;
      shell.openExternal = async (url: string) => void sent.push(url);
    });
    const sent = () => app.evaluate(() => (globalThis as { sent?: string[] }).sent || []);
    const page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
    await page.locator(`#agents .agent[data-key$="${agent}"]`).click();
    const panels = page.locator("#top-row .app-pane[data-app=browser]");
    await expect(panels).toHaveCount(0);

    // the first link: a new Browser, in the actor's task, its page native over the panel's screen
    await (await addLink(page, "l1", `${site}one`)).click();
    await expect(panels).toHaveCount(1);
    await until(async () => (await shown(app)).some((p) => p.url === `${site}one`), 30_000).catch(async (e) => {
      console.log("pages:", JSON.stringify(await pagesOf(app)));
      throw e;
    });
    const stage = await panels.first().frameLocator("iframe").locator(".bw-stage").boundingBox();
    const one = (await shown(app)).find((p) => p.url === `${site}one`)!.bounds;
    expect(Math.abs(one.x - stage!.x)).toBeLessThan(2); // (Playwright's boxes are the window's, frames' too)
    expect(Math.abs(one.y - stage!.y)).toBeLessThan(2);
    expect(Math.abs(one.width - stage!.width)).toBeLessThan(2);
    const listed = (await ask("/api/apps?gatherer=g")) as {
      instances: { id: string; app: string }[];
      attached: Record<string, string[]>;
      tasks: { tasked: Record<string, number> };
    };
    const browsers = listed.instances.filter((i) => i.app === "browser");
    expect(browsers).toHaveLength(1);
    expect(listed.attached[browsers[0].id]).toEqual([agent]);
    expect(listed.tasks.tasked[`app:${browsers[0].id}`]).toBe(listed.tasks.tasked[agent]); // one task
    expect(listed.tasks.tasked[agent]).toBeDefined();

    // a second link: a new tab of the same Browser, its page the one shown
    await (await addLink(page, "l2", `${site}two`)).click();
    await until(async () => {
      const s = await shown(app);
      return s.some((p) => p.url === `${site}two`) && !s.some((p) => p.url === `${site}one`);
    }, 30_000).catch(async (e) => {
      console.log("pages:", JSON.stringify(await pagesOf(app)));
      throw e;
    });
    expect((await pagesOf(app)).map((p) => p.url).sort()).toEqual([`${site}one`, `${site}two`]); // two tabs, one Browser
    expect((await ask("/api/apps?gatherer=g") as { instances: { app: string }[] }).instances.filter((i) => i.app === "browser")).toHaveLength(1);
    expect(await sent()).toEqual([]);

    // ⌘/Ctrl held: to the user's own browser, as before
    await (await addLink(page, "l3", `${site}three`)).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    await until(async () => (await sent()).includes(`${site}three`), 10_000);
    expect((await pagesOf(app)).some((p) => p.url === `${site}three`)).toBe(false);
  } finally {
    await app.close();
  }
});
