// WHAT A PANE SAYS BEFORE ITS DATA HAS COME: after a reload, till the home has come, the pane is not known to be empty --
// it says "Loading…", never "No actors yet" (features/page/main-view.ts's renderPane); and Chat drawn before both its
// files and the server's view of the conversation have come (a reload, an actor shown for the first time) says
// "Loading…", not that its view failed (features/chat/view.ts's turnsOf: no turns yet).
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, open } from "./home";

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
