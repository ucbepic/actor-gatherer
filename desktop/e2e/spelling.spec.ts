// Typos in the app: the dashboard's page asks the system's spellchecker (the one underlining words) through the preload
// (app_kit's ag.spelling), so a click in a misspelled word of a Notes line offers its fixes; and a right-click in one,
// even in an app's panel (another site's frame), has them first in the window's menu. "Add to Dictionary" is never
// clicked here: it writes to the user's own dictionary, the system's.
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
test.skip(process.platform !== "darwin", "the words misspelled and their fixes are macOS's spellchecker's");

let scratch = "";
let home = "";
let port = 0;
let dashboard: ChildProcess | null = null;

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
const homeOf = () =>
  new Promise<string | null>((resolve) => {
    http
      .get(`http://127.0.0.1:${port}/api/home`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve((JSON.parse(body) as { home?: string }).home ?? null));
      })
      .on("error", () => resolve(null));
  });
async function until(check: () => Promise<boolean>, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timed out");
}

test.beforeAll(async () => {
  scratch = mkdtempSync("/tmp/agw-");
  home = path.join(scratch, "home");
  mkdirSync(home);
  execFileSync(PYTHON, ["-c", [
    "import os",
    "from ag.ag_harness.home import home",
    "h = home(); h.ensure()",
    "p = os.path.join(h.root, 'config.toml'); s = open(p).read()",
    "open(p, 'w').write(s.replace('model = \"\"', 'model = \"claude-code/haiku\"', 1))",
    "home().manager('g').init('g')",
  ].join("\n")], { cwd: REPO, env: { ...env(), AG_HOME: home } });
  port = await freePort();
  dashboard = spawn(PYTHON, ["-m", "ag_dashboard", "--home", home, "--port", String(port)], {
    cwd: REPO, env: { ...env(), PYTHONPATH: REPO, AG_COMMAND: `${PYTHON} ${path.join(REPO, "ag", "cli", "ag")}` },
    stdio: process.env.AG_E2E_DEBUG ? ["ignore", "inherit", "inherit"] : "ignore",
  });
  await until(async () => (await homeOf()) === home);
});

test.afterAll(async () => {
  if (dashboard && dashboard.exitCode === null) {
    const gone = new Promise((r) => dashboard!.once("exit", r));
    dashboard.kill();
    await gone;
  }
  rmSync(scratch, { recursive: true, force: true });
});

/** A word's middle, in the window's coordinates: the word in the Notes panel's line holding it. */
async function wordAt(page: Page, word: string): Promise<{ x: number; y: number }> {
  const frame = page.locator("#top-row > .app-pane[data-app=notes] iframe");
  const at = await frame
    .contentFrame()
    .locator(".blk .tx", { hasText: word })
    .first()
    .evaluate((tx, w) => {
      const n = tx.firstChild as Text, r = document.createRange(), i = n.data.indexOf(w);
      r.setStart(n, i + 1);
      r.setEnd(n, i + 2);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, word);
  const box = (await frame.boundingBox())!;
  return { x: box.x + at.x, y: box.y + at.y };
}

test("a misspelled word in a Notes line: its fixes on a click, and first in the right-click menu", async () => {
  const app: ElectronApplication = await electron.launch({ args: [DESKTOP, "--home", home, "--port", String(port)], env: env() });
  try {
    const page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 60_000 });
    await app.evaluate(({ app: a, BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.show();
      a.focus({ steal: true });
      w.focus();
    });

    // the system's spellchecker, asked through the preload
    const asked = await page.evaluate(() => {
      const s = (window as unknown as { agApp: { spelling: (w: string) => unknown } }).agApp.spelling;
      return { wrong: s("wrold"), right: s("world"), none: s("two words") };
    });
    expect(asked.wrong).toMatchObject({ misspelled: true });
    expect((asked.wrong as { suggestions: string[] }).suggestions).toContain("world");
    expect(asked.right).toEqual({ misspelled: false, suggestions: [] });
    expect(asked.none).toBeNull();

    // Notes, a page, a line with two typos
    const row = page.locator("#agents .gatherer-row").first();
    await row.hover();
    await row.locator("button.new-more").click();
    await page.locator(".row-menu[role=menu] button", { has: page.getByText("Notes", { exact: true }) }).click();
    const panel = page.locator("#top-row > .app-pane[data-app=notes]").frameLocator("iframe");
    await expect(panel.locator("body[data-ready='1']")).toHaveCount(1);
    await panel.locator("#new-page").click();
    await expect(panel.locator("#title")).toBeFocused();
    await page.keyboard.type("Typos");
    await page.keyboard.press("Enter");
    await page.keyboard.type("I will recieve the wrold today");
    const line = panel.locator(".blk .tx").first();

    // a click: the fixes under it, the system's; one picked
    const recieve = await wordAt(page, "recieve");
    await page.mouse.click(recieve.x, recieve.y);
    const fixes = panel.locator(".pop.spell");
    await expect(fixes).toBeVisible();
    await expect(fixes.locator(".it .tt").first()).toHaveText("receive");
    await expect(fixes.locator(".it .tt").last()).toHaveText("Add to dictionary");
    await fixes.locator(".it", { hasText: /^receive$/ }).click();
    await expect(line).toHaveText("I will receive the wrold today");

    // a right-click in the Notes panel (another site's frame): the window's menu (the menu kept, not shown)
    await app.evaluate(({ Menu }) => {
      const g = globalThis as unknown as { menus: Electron.Menu[] };
      g.menus = [];
      Menu.prototype.popup = function (this: Electron.Menu) {
        g.menus.push(this);
      };
    });
    const labels = (n: number) =>
      app.evaluate(
        (_e, n) => (globalThis as unknown as { menus: Electron.Menu[] }).menus[n].items.map((i) => (i.type === "separator" ? "-" : i.label)),
        n,
      );
    const wrold = await wordAt(page, "wrold");
    await page.mouse.click(wrold.x, wrold.y, { button: "right" });
    await until(() => app.evaluate(() => (globalThis as unknown as { menus: unknown[] }).menus.length > 0), 10_000);
    expect((await labels(0)).slice(-4)).toEqual(["Cut", "Copy", "Paste", "Select All"]);
    // in a misspelled word, its fixes first: as Electron tells of one (Chrome marks misspelled words only while the
    // window is in front, which a test's isn't always)
    await app.evaluate(({ BrowserWindow }) => {
      const p = { isEditable: true, misspelledWord: "wrold", dictionarySuggestions: ["world", "wold"], linkURL: "", selectionText: "" };
      BrowserWindow.getAllWindows()[0].webContents.emit("context-menu", { preventDefault() {} }, p);
    });
    expect(await labels(1)).toEqual(["world", "wold", "-", "Add to Dictionary", "-", "Cut", "Copy", "Paste", "Select All"]);
  } finally {
    await app.close();
  }
});
