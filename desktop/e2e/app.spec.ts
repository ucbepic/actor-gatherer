// The app end to end: its window shows this home's dashboard (a running one, or one it starts and leaves running), and
// says so when the port is someone else's; links leave for the user's browser unless they are the dashboard's own.
// Playwright drives Electron through a debugging port: in tests only, never in the app (desktop/DESIGN.md, "Rules").
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.dirname(DESKTOP);
const PYTHON = process.env.AG_PYTHON || "";
test.skip(!PYTHON, "AG_PYTHON (a Python with ag's dashboard packages) is needed to run real dashboards");

// A short home path: ag's notification socket in it must fit macOS's ~104-byte limit.
let scratch = "";
let bin = "";
test.beforeAll(() => {
  scratch = mkdtempSync("/tmp/agd-");
  bin = path.join(scratch, "bin");
  mkdirSync(bin);
  const ag = path.join(bin, "ag"); // `ag`, as this checkout's
  writeFileSync(ag, `#!/bin/sh\nexec "${PYTHON}" "${path.join(REPO, "ag", "cli", "ag")}" "$@"\n`);
  chmodSync(ag, 0o755);
});
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

function newHome(): string {
  return mkdtempSync(path.join(scratch, "h"));
}

/** The environment the app and its dashboards run in: this checkout's `ag` first on the PATH, no outer ag session's. */
function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  for (const k of ["AG_ACTOR", "AG_DASHBOARD", "AG_COMMAND", "ANTHROPIC_BASE_URL"]) delete out[k];
  out.PATH = `${bin}${path.delimiter}${out.PATH}`;
  return out;
}

const answers = (port: number) =>
  new Promise<string | null>((resolve) => {
    http
      .get(`http://127.0.0.1:${port}/api/home`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve((JSON.parse(body) as { home?: string }).home ?? null));
      })
      .on("error", () => resolve(null));
  });

async function until(check: () => Promise<boolean>, ms = 90_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out");
}

function stopListener(port: number): void {
  const pids = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).split(/\s+/);
  for (const pid of pids.filter(Boolean)) process.kill(Number(pid));
}

async function launch(home: string, port: number): Promise<ElectronApplication> {
  return electron.launch({ args: [DESKTOP, "--home", home, "--port", String(port)], env: env() });
}

test("shows the home's running dashboard", async () => {
  const home = newHome();
  const port = await freePort();
  const server: ChildProcess = spawn(PYTHON, ["-m", "ag_dashboard", "--home", home, "--port", String(port)], {
    cwd: REPO,
    env: env(),
    stdio: "ignore",
  });
  try {
    await until(async () => (await answers(port)) === home);
    const app = await launch(home, port);
    const page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "+ New group" })).toBeVisible();
    await app.close();
    expect(await answers(port)).toBe(home); // the dashboard the app found isn't the app's to stop
  } finally {
    server.kill();
  }
});

test("starts the dashboard when none runs, and leaves it running when the app quits", async () => {
  const home = newHome();
  const port = await freePort();
  const app = await launch(home, port);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 120_000 });
    await expect(page.getByRole("button", { name: "+ New group" })).toBeVisible();
    await app.close();
    expect(await answers(port)).toBe(home);
  } finally {
    stopListener(port);
  }
});

test("says so when the port is another home's dashboard's", async () => {
  const other = http.createServer((_q, s) => s.end(JSON.stringify({ home: "/somewhere/else" })));
  await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
  const port = (other.address() as AddressInfo).port;
  const app = await launch(newHome(), port);
  try {
    const page = await app.firstWindow();
    await expect(page.getByText(`Port ${port} is taken by the dashboard of another home (/somewhere/else)`)).toBeVisible();
    await expect(page.getByText("Try again")).toBeVisible();
  } finally {
    await app.close();
    other.close();
  }
});

test("links: the dashboard's own open in the app, others in the user's browser", async () => {
  const home = newHome();
  const port = await freePort();
  const app = await launch(home, port);
  try {
    const page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${port}/`, { timeout: 120_000 });
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as { opened?: string[] }).opened = opened;
      shell.openExternal = async (url: string) => void opened.push(url);
    });
    await page.evaluate(() => window.open("https://example.com/elsewhere"));
    await expect.poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual([
      "https://example.com/elsewhere",
    ]);
    const second = app.waitForEvent("window");
    await page.evaluate((url) => window.open(url), `http://127.0.0.1:${port}/api/home`);
    expect((await second).url()).toBe(`http://127.0.0.1:${port}/api/home`);
  } finally {
    await app.close();
    stopListener(port);
  }
});
