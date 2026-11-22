// A tab carried along the tabs' bar (bar-drag.ts): the tabs it passes slide aside once each, smoothly -- not started
// over by each of the drag's events, which come many times a second whether the pointer moves or not.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";

const row = (page: Page, text: string) => page.locator("#agents .agent", { hasText: text });
const tabs = (page: Page) => page.locator(".lay-tabs:visible .lay-tab");
const box = async (l: Locator) => (await l.boundingBox())!;

test("a tab carried along the bar: each tab it passes slides aside once, not started over by every drag event", async ({
  page,
}) => {
  await open(page);
  await row(page, CLAUDE).click();
  await row(page, CODEX).click();
  await expect(tabs(page)).toHaveCount(2);
  // the slides the tabs start (a CSS transition each), counted
  await page.evaluate(() => {
    const w = window as unknown as { slides: number };
    w.slides = 0;
    document
      .querySelector(".lay-tabs:not([hidden]) .lay-tab-list")!
      .addEventListener("transitionrun", () => w.slides++);
  });
  const slides = () => page.evaluate(() => (window as unknown as { slides: number }).slides);
  const codex = await box(tabs(page).nth(1)),
    claude = await box(tabs(page).nth(0)),
    y = codex.y + codex.height / 2;
  // Codex's tab carried a few pixels at a time to Claude's left edge, past its middle once: two slides (Claude's aside,
  // Codex's to the front), each started once however many drag events come meanwhile
  await page.mouse.move(codex.x + codex.width / 2, y);
  await page.mouse.down();
  for (let x = codex.x + codex.width / 2; x >= claude.x + 8; x -= 6) await page.mouse.move(x, y);
  await expect.poll(async () => (await box(tabs(page).nth(0))).x).toBeGreaterThan(claude.x + 20);
  expect(await slides()).toBe(2);
  // held there, the browser still sending drag events: nothing started again
  for (let i = 0; i < 20; i++) await page.mouse.move(claude.x + 8, y);
  expect(await slides()).toBe(2);
  await page.mouse.up();
  await expect(tabs(page).locator(".lay-name").nth(0)).toContainText(CODEX);
});
