// THE LIST HIDDEN (06-list-modes.js's setListHidden): its button puts the list out of the way at once, the panes the
// page's whole width, a thin edge at its left; the pointer on that edge, the list slides out over the panes, whole, and
// stays while the pointer is on it -- still or moving -- and goes a moment after the pointer has left it. Kept in this
// browser; the button again keeps it open.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";

const side = (page: Page) => page.locator(".side");
const row = (page: Page, text: string) => page.locator("#agents button.agent", { hasText: text });

test("hidden at once by its button; out at the page's left edge, staying under a still pointer; back once left", async ({
  page,
}) => {
  await open(page);
  await row(page, CLAUDE).click();
  const before = (await page.locator("#pane-here").boundingBox())!;
  await page.locator(".lb-hide:visible").click(); // the pointer left on the button: hidden all the same
  await expect(side(page)).toBeHidden({ timeout: 1000 });
  await expect.poll(async () => (await page.locator("#pane-here").boundingBox())!.x).toBeLessThan(before.x - 200);
  await page.mouse.move(700, 450);
  await page.mouse.move(3, 300, { steps: 4 }); // the edge, then still: out, whole, and staying
  await expect(side(page)).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(side(page)).toBeVisible();
  await expect(row(page, CODEX)).toBeInViewport();
  await row(page, CODEX).click(); // usable as ever
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await page.mouse.move(700, 450); // left: back out of sight
  await expect(side(page)).toBeHidden({ timeout: 1500 });
  await page.reload();
  await expect(page.locator("html.list-hidden")).toHaveCount(1);
  await page.mouse.move(3, 450);
  await expect(side(page)).toBeVisible();
  await page.locator(".lb-hide:visible").click(); // kept open again
  await page.mouse.move(700, 450);
  await page.waitForTimeout(700);
  await expect(side(page)).toBeVisible();
  await expect(page.locator("html.list-hidden")).toHaveCount(0);
});
