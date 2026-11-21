// What floats over the page and closes on a press elsewhere -- Settings, a row's drop-down -- closes on a press in a frame
// too, which the page itself never hears (features/layout/panes.js's pressedAway): in an app's panel (told by app_kit's SDK, also a
// press the panel's own code stops), in another actor's pane.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";
import { addNotepad } from "./task-home";

const beside = process.platform === "darwin" ? "Meta" : "Control";

// Claude, with a Notepad in its task: the Notepad's panel, up
async function withNotepad(page: Page) {
  await open(page);
  const claude = page.locator("#agents .agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  const pane = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(pane).toHaveCount(1);
  const panel = pane.frameLocator("iframe");
  await expect(panel.locator("body[data-ready='1']")).toHaveCount(1);
  return panel;
}
const notepadFrame = (page: Page) => page.frames().find((f) => /^http:\/\/notepad\.localhost:\d+\//.test(f.url()))!;

test("Settings closes on a press in an app's panel", async ({ page }) => {
  const panel = await withNotepad(page);
  await page.locator("#about-btn").click();
  await expect(page.locator("#about")).toBeVisible();
  await panel.locator("dl").click();
  await expect(page.locator("#about")).toBeHidden();
  await expect(page.locator("#about-btn")).toHaveAttribute("aria-expanded", "false");
});

test("Settings closes on a press the panel's own code stops, the focus staying on the page", async ({ page }) => {
  const panel = await withNotepad(page);
  await notepadFrame(page).evaluate(() => {
    for (const t of ["mousedown", "click"])
      document.addEventListener(
        t,
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        },
        true,
      );
  });
  await page.locator("#about-btn").click();
  await expect(page.locator("#about")).toBeVisible();
  await panel.locator("dl").click();
  await expect(page.locator("#about")).toBeHidden();
});

test("a row's drop-down closes on a press in an app's panel", async ({ page }) => {
  const panel = await withNotepad(page);
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover();
  await row.locator("button.new-more").click();
  const menu = page.locator(".row-menu[role=menu]");
  await expect(menu).toBeVisible();
  await panel.locator("dl").click();
  await expect(menu).toHaveCount(0);
});

test("Settings closes on a press in another actor's pane", async ({ page }) => {
  await open(page);
  await page.locator("#agents .agent", { hasText: CLAUDE }).click();
  await page.locator("#agents .agent", { hasText: CODEX }).click({ modifiers: [beside] });
  const codex = page.locator("#panes > .pane").nth(1);
  await expect(codex).toHaveCount(1);
  const chat = codex.frameLocator("iframe").locator("#main");
  await expect(chat).toBeVisible();
  await page.locator("#about-btn").click();
  await expect(page.locator("#about")).toBeVisible();
  await chat.click();
  await expect(page.locator("#about")).toBeHidden();
});
