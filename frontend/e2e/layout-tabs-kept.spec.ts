// A SCREEN TAB'S APP PANELS KEPT READY (features/layout/kept.ts, panes.js's keepForTab): left, a tab's apps' panels are
// held out of sight, not closed -- their frames as they are -- and shown as they were when it is shown again; at most
// three tabs' panels kept so, those of the tab left first closed; a panel whose task no tab holds any longer closed.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { addNotepad } from "./task-home";

const row = (page: Page, text: string) => page.locator("#agents button.agent", { hasText: text });
const tabs = (page: Page) => page.locator(".lay-tabs:visible .lay-tab");
// every Notepad's panel on the page (one kept out of sight too), and those in sight
const notepads = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
const shownNotepads = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]:not([hidden])");
// a Notepad's panel by its folder's name ("Notepad · <folder>"), in sight or not
const notepadAt = (page: Page, folder: string) =>
  page.locator(`#top-row > .app-pane[aria-label="Notepad · ${folder}"]`);

test("a tab left keeps its app's panel out of sight, its frame as it is; shown again, the same frame shows", async ({
  page,
}) => {
  await open(page);
  await row(page, CLAUDE).click();
  await addNotepad(page, row(page, CLAUDE));
  await expect(shownNotepads(page)).toHaveCount(1);
  const frame = notepads(page).locator("iframe").contentFrame();
  await frame.locator("body").evaluate(() => ((window as unknown as { kept: number }).kept = 7)); // this frame's mark
  await row(page, CODEX).click(); // tab 2
  await expect(tabs(page)).toHaveCount(2);
  await expect(notepads(page)).toHaveCount(1); // kept...
  await expect(notepads(page)).toBeHidden(); // ...out of sight: not drawn over Codex's Chat
  await expect(shownNotepads(page)).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await tabs(page).nth(0).click(); // back: the same frame, not loaded again
    await expect(shownNotepads(page)).toHaveCount(1);
    await expect(notepads(page)).toBeVisible();
    expect(await frame.locator("body").evaluate(() => (window as unknown as { kept?: number }).kept)).toBe(7);
    await tabs(page).nth(1).click();
    await expect(shownNotepads(page)).toHaveCount(0);
  }
  await expect(notepads(page)).toHaveCount(1);
});

test("a kept panel goes with its tab: the tab closed, its task is in no tab; opened again, its panel is made anew", async ({
  page,
}) => {
  await open(page);
  await row(page, CLAUDE).click();
  await addNotepad(page, row(page, CLAUDE));
  await expect(shownNotepads(page)).toHaveCount(1);
  await row(page, CODEX).click(); // tab 2: tab 1's Notepad kept
  await expect(tabs(page)).toHaveCount(2);
  await expect(notepads(page)).toHaveCount(1);
  await tabs(page).nth(0).hover();
  await tabs(page).nth(0).locator(".lay-close").click(); // tab 1 closed: its task in no tab
  await expect(tabs(page)).toHaveCount(1);
  await expect(notepads(page)).toHaveCount(0);
  await row(page, CLAUDE).click(); // opened again: a new tab, its Notepad's panel made anew
  await expect(tabs(page)).toHaveCount(2);
  await expect(shownNotepads(page)).toHaveCount(1);
});

test("the panels of the three tabs left latest are kept; those of a tab left before them go", async ({ page }) => {
  const folders = ["k1", "k2", "k3", "k4"];
  for (const folder of folders) {
    const r = await page.request.post("/api/apps/open", {
      data: { app: "notepad", gatherer: GATHERER, folder: `/w/${folder}` },
    });
    expect(r.ok()).toBe(true);
  }
  await open(page);
  const lone = (folder: string) => page.locator("#agents button.agent.app-row", { hasText: folder });
  for (const folder of folders) {
    await lone(folder).click(); // each a tab of its own
    await expect(notepadAt(page, folder)).toBeVisible();
  }
  await expect(tabs(page)).toHaveCount(folders.length);
  await expect(notepads(page)).toHaveCount(4); // k1..k3 kept, k4 shown
  await page.locator(".lay-tab-add").click(); // a fifth tab ("+"): k1's tab, left first, loses its panel
  await expect(tabs(page)).toHaveCount(5);
  await expect(shownNotepads(page)).toHaveCount(0);
  await expect(notepadAt(page, "k1")).toHaveCount(0);
  for (const folder of ["k2", "k3", "k4"]) await expect(notepadAt(page, folder)).toHaveCount(1);
  await tabs(page).nth(0).click(); // k1's tab shown again: its panel made anew
  await expect(notepadAt(page, "k1")).toBeVisible();
});
