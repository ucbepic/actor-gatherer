// THE LIST HIDDEN (features/list/modes.ts's setListHidden): its button puts the list out of the way at once, the panes the
// page's whole width, a thin edge at its left; the pointer on that edge, the list slides out over the panes, whole, and
// stays while the pointer is on it -- still or moving -- and goes a moment after the pointer has left it. Kept in this
// browser; the button again keeps it open. The top bar's counts (#top-totals) slide it out as the edge does.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";

const side = (page: Page) => page.locator(".side");
const row = (page: Page, text: string) => page.locator("#agents .agent", { hasText: text });

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
  await expect(row(page, CODEX).locator(".a-main")).toHaveAttribute("aria-current", "true");
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

test("the top bar's counts slide the hidden list out, and keep it while the pointer goes down to it; the rail too", async ({
  page,
}) => {
  await open(page);
  const totals = page.locator("#top-totals");
  await expect(totals.locator(".count").first()).toBeVisible();
  const hideAway = async () => {
    await page.locator(".lb-hide:visible").click();
    await page.mouse.move(700, 450);
    await expect(side(page)).toBeHidden({ timeout: 1000 });
  };
  const onCounts = async () => {
    const t = (await totals.boundingBox())!;
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 4 });
    await expect(side(page)).toBeVisible();
    await page.waitForTimeout(1200); // resting on the counts: still out
    await expect(side(page)).toBeVisible();
    return t;
  };
  await hideAway();
  const t = await onCounts();
  await page.mouse.move(t.x + t.width / 2, 300, { steps: 6 }); // straight down: onto the list
  await page.waitForTimeout(700);
  await expect(side(page)).toBeVisible();
  await row(page, CODEX).click();
  await expect(row(page, CODEX).locator(".a-main")).toHaveAttribute("aria-current", "true");
  await page.mouse.move(700, 450); // left: back out of sight
  await expect(side(page)).toBeHidden({ timeout: 1500 });

  await page.mouse.move(3, 450); // kept open again, then folded to the rail and hidden as that
  await page.locator(".lb-hide:visible").click();
  await page.locator("#agents .lb-fold").click();
  await expect(page.locator("html.list-folded")).toHaveCount(1);
  await hideAway();
  const r = await onCounts();
  await page.mouse.move(30, r.y + r.height + 160, { steps: 6 }); // down and left, onto the narrower rail
  await page.waitForTimeout(700);
  await expect(side(page)).toBeVisible();
  await page.mouse.move(700, 450);
  await expect(side(page)).toBeHidden({ timeout: 1500 });
});
