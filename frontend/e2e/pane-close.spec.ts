// An actor's pane CLOSED by its ×, as an app's panel is (features/layout/panes.js's closeHerePane): in every view of it -- its head,
// its Chat bar (a panel above it), its minimized box -- even alone. Its actor goes on; what else is shown takes its room
// (nothing: the tab's new-tab page); a click on it in the list shows it again. Its task, left and opened again (another
// tab shown and back, the page reloaded), shows its apps alone, the actor's pane still closed.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";
import { addNotepad, cardOf } from "./task-home";

const row = (page: Page, text: string) => page.locator("#agents button.agent", { hasText: text });
const notes = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]:not([hidden])"); // in sight (one kept for another tab: hidden)
const here = (page: Page) => page.locator("#pane-here");
const tabs = (page: Page) => page.locator(".lay-tabs:visible .lay-tab");
const box = async (l: Locator) => (await l.boundingBox())!;

// Claude clicked in its task's card (its task's row hovered: Claude and the Notepad, one task, named as Claude)
async function actorInCard(page: Page) {
  const card = await cardOf(page, row(page, CLAUDE));
  await card.locator(".c-task-row:not(.c-app-row)", { hasText: CLAUDE }).locator(".c-row").click();
  await page.mouse.move(700, 700);
}
// Claude shown, a Notepad added to it (one task), above its Chat
async function withNotepad(page: Page) {
  await open(page);
  await row(page, CLAUDE).click();
  await addNotepad(page, row(page, CLAUDE));
  await expect(notes(page)).toHaveCount(1);
  await page.mouse.move(700, 700); // the task's card put away
}

test("the × of an actor's Chat under an app closes its pane alone: the app takes the room; clicked, it is back", async ({
  page,
}) => {
  await withNotepad(page);
  const tall = (await box(notes(page))).height;
  const x = here(page).locator(".fl-act.close"); // the pane's head put in its Chat bar, a panel above
  await expect(x).toBeVisible();
  await x.click();
  await expect(here(page)).toBeHidden();
  await expect(notes(page)).toBeVisible();
  await expect.poll(async () => (await box(notes(page))).height).toBeGreaterThan(tall + 200);
  await expect(page.locator(".work > .lay-empty:not([hidden])")).toHaveCount(0); // the Notepad shown: no new-tab page
  await row(page, CLAUDE).click(); // its task's row, the task shown: as it is
  await expect(here(page)).toBeHidden();
  await actorInCard(page); // the actor asked for: in sight again, the Notepad kept
  await expect(here(page)).toBeVisible();
  await expect(notes(page)).toHaveCount(1);
});

test("a minimized Chat has its ×: the pane closed, the app above left", async ({ page }) => {
  await withNotepad(page);
  await here(page).locator("button[aria-label='Minimize the chat']:visible").first().click();
  const mini = page.locator("#main > .chat.mini");
  await expect(mini).toHaveCount(1);
  await mini.locator(".mini-x").click();
  await expect(here(page)).toBeHidden();
  await expect(notes(page)).toBeVisible();
});

test("an actor's pane alone has its × too: closed, the tab shows its new-tab page; clicked, it is back", async ({
  page,
}) => {
  await open(page);
  await row(page, CODEX).click();
  const x = page.locator("#pane-close");
  await expect(x).toBeVisible(); // in its head, though no other pane is beside it
  await x.click();
  await expect(here(page)).toBeHidden();
  await expect(page.locator(".work > .lay-empty:not([hidden])")).toBeVisible();
  await row(page, CODEX).click();
  await expect(here(page)).toBeVisible();
  await expect(page.locator(".work > .lay-empty:not([hidden])")).toHaveCount(0);
});

test("a task left with its actor's pane closed comes back with its app alone: another tab and back, and reloaded", async ({
  page,
}) => {
  await withNotepad(page);
  await here(page).locator(".fl-act.close").click();
  await expect(here(page)).toBeHidden();
  await row(page, CODEX).click(); // Codex, open nowhere: a tab of its own
  await expect(tabs(page)).toHaveCount(2);
  await expect(here(page)).toBeVisible();
  await expect(notes(page)).toHaveCount(0);
  await tabs(page).nth(0).click(); // back: the Notepad alone
  await expect(notes(page)).toHaveCount(1);
  await expect(here(page)).toBeHidden();
  await page.reload();
  await expect(notes(page)).toHaveCount(1);
  await expect(here(page)).toBeHidden();
  await actorInCard(page); // asked for: shown beside it again
  await expect(here(page)).toBeVisible();
  await expect(notes(page)).toHaveCount(1);
});
