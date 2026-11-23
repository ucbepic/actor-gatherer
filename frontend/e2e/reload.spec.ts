// WHAT A PANE SAYS BEFORE ITS DATA HAS COME: after a reload, till the home has come, the pane is not known to be empty --
// it says "Loading…", never "No actors yet" (features/page/main-view.ts's renderPane); and Chat drawn before both its
// files and the server's view of the conversation have come (a reload, an actor shown for the first time) says
// "Loading…", not that its view failed (features/chat/view.ts's turnsOf: no turns yet). A pane minimized says "Loading…"
// till its last two lines have come (features/chat/files-view.ts's linesDue), not its strip drawn without them, which
// grows as they come and moves the line above it -- unless its files can't be loaded: its strip then, with none.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, open } from "./home";
import { addNotepad } from "./task-home";

const row = (page: Page, text: string) => page.locator("#agents .agent", { hasText: text });

/** Every text the work area showed from now on, each change of it seen as it is drawn (kept in the page as `__said`). */
const WATCH = () => {
  const said: string[] = ((window as unknown as { __said: string[] }).__said = []);
  const look = () => {
    const at = document.getElementById("panes");
    if (at) said.push(at.innerText);
  };
  const start = () => {
    look();
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
};
const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said.join("\n---\n"));
const held = (ms: number) => new Promise((done) => setTimeout(done, ms));

test("a reload says Loading… till the home has come, then the actor it showed -- never that there are no actors", async ({
  page,
}) => {
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /turns/.test(m.text())) failed.push(m.text());
  });
  await open(page);
  await row(page, CLAUDE).click();
  await expect(page.locator("#panes .fl-grid")).toBeVisible();
  await page.route("**/api/home*", async (route) => {
    await held(1500); // the home slow to come, as a big one is
    await route.continue();
  });
  await page.addInitScript(WATCH);
  await page.reload();
  await expect(page.locator("#main .empty")).toHaveText("Loading…");
  await expect(page.locator("#panes .fl-grid")).toBeVisible({ timeout: 10_000 }); // the actor shown again
  const all = await said(page);
  expect(all).not.toContain("No actors yet");
  expect(all).not.toContain("view failed");
  expect(failed).toEqual([]);
});

test("an actor shown for the first time says Loading… till its files have come, not that its view failed", async ({
  page,
}) => {
  await open(page); // a fresh page shows Codex by itself: its files loaded
  await expect(page.locator("#panes .fl-grid")).toBeVisible();
  await page.route("**/api/files?*", async (route) => {
    await held(1500);
    await route.continue();
  });
  await page.evaluate(WATCH);
  await row(page, CLAUDE).click(); // not shown on this page before
  await expect(page.locator("#panes .chat-frame.files")).toContainText("Loading…");
  await expect(page.locator("#panes .fl-grid")).toBeVisible({ timeout: 10_000 });
  expect(await said(page)).not.toContain("view failed");
});

const CLAUDE_CHANNEL = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";
const strip = (page: Page) => page.locator("#main > .chat.mini");
const lines = (page: Page) => strip(page).locator(".mini-hist .mh-row");

/** Claude's pane under a Notepad, minimized by its button, its two lines shown; what Claude's pane draws from -- its
 * files and its actor read, the stream's views of it -- then held while `hold.on` (each let go by `free`), or, with
 * `never`, its files refused and its views dropped for good. */
async function minimizedClaude(page: Page, never = false) {
  const hold = { on: false, held: [] as (() => void)[] };
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const name = typeof m === "string" ? m.split("\n", 2)[1] : "";
      if (!hold.on || (name !== "chat" && name !== "agent")) ws.send(m);
      else if (!never) hold.held.push(() => ws.send(m));
    });
  });
  await page.route(new RegExp(`/api/(files|agent)\\?.*channel=${CLAUDE_CHANNEL}`), async (route) => {
    if (!hold.on) return route.continue();
    if (never && route.request().url().includes("/api/files")) return route.abort();
    const got = await route.fetch();
    hold.held.push(() => void route.fulfill({ response: got }).catch(() => {}));
  });
  await open(page);
  const claude = row(page, CLAUDE);
  await claude.click();
  await addNotepad(page, claude);
  await page.locator("#pane-here button[aria-label='Minimize the chat']:visible").first().click();
  await expect(lines(page)).toHaveCount(2);
  return {
    hold,
    free: () => {
      hold.on = false;
      for (const f of hold.held.splice(0)) f();
    },
  };
}
/** Each moment the page's own pane was a minimized strip from now on, with how many of its lines (as `__strips`). */
const WATCH_STRIP = () => {
  const seen: number[] = ((window as unknown as { __strips: number[] }).__strips = []);
  const look = () => {
    const s = document.querySelector("#main > .chat.mini");
    if (s) seen.push(s.querySelectorAll(".mini-hist .mh-row").length);
  };
  const start = () => new MutationObserver(look).observe(document.body, { subtree: true, childList: true });
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
};
const strips = (page: Page) => page.evaluate(() => (window as unknown as { __strips: number[] }).__strips);

test("a pane minimized says Loading… after a reload till its last lines have come, then its strip, with them", async ({
  page,
}) => {
  const { hold, free } = await minimizedClaude(page);
  await page.addInitScript(WATCH_STRIP);
  hold.on = true;
  await page.reload();
  await expect(page.locator("#main .empty")).toHaveText("Loading…");
  await held(1500); // its files, its actor and its views slow to come
  expect(await strips(page)).toEqual([]); // no strip drawn meanwhile
  free();
  await expect(lines(page)).toHaveCount(2);
  expect(new Set(await strips(page))).toEqual(new Set([2])); // its strip drawn with its lines, never without
});

test("a pane minimized whose files can't be loaded shows its strip after a reload all the same, with no lines", async ({
  page,
}) => {
  const { hold } = await minimizedClaude(page, true);
  hold.on = true;
  await page.reload();
  await expect(strip(page)).toHaveCount(1); // its files' load failed: not left saying Loading…
  await expect(lines(page)).toHaveCount(0);
  await expect(strip(page).locator(".mini-me")).toBeVisible(); // its avatar alone, the way back to its chat
});
