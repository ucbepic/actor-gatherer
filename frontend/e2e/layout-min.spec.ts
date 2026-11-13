// A pane MINIMIZED on its own (features/layout/work.ts): only its message box, where something of its task is above or
// below it -- the others left whole; panes side by side all minimized, their row only as tall as their message boxes.
// Kept in its task's arrangement: moved where nothing is above or below it, shown whole; moved back, minimized again.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, open } from "./home";
import { addNotepad, taskHome, taskRow } from "./task-home";

const box = async (l: Locator) => (await l.boundingBox())!;
const notes = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
const other = (page: Page) => page.locator("#panes > .pane").nth(1);
const minimize = (where: Page | ReturnType<Page["frameLocator"]>) =>
  where.locator("button[aria-label='Minimize the chat']:visible").first();

test("two panes under an app: one minimized, the other whole; both, their row only as tall as their message boxes", async ({
  page,
}) => {
  await taskHome(page, true); // Claude and Codex, one task, side by side
  await open(page);
  await taskRow(page).click();
  await expect(other(page)).toHaveCount(1);
  await addNotepad(page, taskRow(page)); // Notepad above both
  await expect(notes(page)).toHaveCount(1);
  const frame = other(page).frameLocator("iframe");
  await minimize(page).click(); // Claude's
  await expect(page.locator("#main > .chat.mini")).toHaveCount(1);
  await expect(frame.locator("#main > .chat.mini")).toHaveCount(0); // Codex's whole
  await expect.poll(async () => (await box(page.locator("#pane-here"))).height).toBeLessThan(150);
  expect((await box(other(page))).height).toBeGreaterThan(300);
  const tall = (await box(notes(page))).height;
  await minimize(frame).click(); // Codex's too: the row of the two only as tall as their message boxes
  await expect(frame.locator("#main > .chat.mini")).toHaveCount(1);
  await expect.poll(async () => (await box(notes(page))).height).toBeGreaterThan(tall + 200);
});

test("a minimized pane moved beside its app is whole; moved back under it, minimized again", async ({ page }) => {
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  await expect(notes(page)).toHaveCount(1);
  const mini = page.locator("#main > .chat.mini");
  await minimize(page).click();
  await expect(mini).toHaveCount(1);
  const menu = async (name: string) => {
    const n = await box(notes(page));
    await page.mouse.click(n.x + 40, n.y + 12, { button: "right" }); // Notepad's head
    await page.locator(".row-menu[aria-label='Move this panel']").getByRole("menuitem", { name }).click();
  };
  await menu("To the right"); // side by side: nothing above Claude's pane
  await expect(mini).toHaveCount(0);
  await expect(minimize(page)).toHaveCount(0); // nor offered
  await menu("To the top"); // above it again
  await expect(mini).toHaveCount(1);
});
