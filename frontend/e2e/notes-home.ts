// What the Notes tests share: the Notes panel opened from the gatherer's menu, a page made and binned in it, and its
// tools called as an agent calls them.
import type { FrameLocator, Page } from "@playwright/test";
import { expect } from "./test";
import { GATHERER } from "./home";

export async function openNotes(page: Page): Promise<{ panel: FrameLocator; instance: string }> {
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover(); // its buttons shown while hovered
  await row.locator("button.new-more").click();
  const entry = page.locator(".row-menu[role=menu] button", { has: page.getByText("Notes", { exact: true }) });
  await expect(entry.locator("img.app-mark")).toHaveCount(1); // the app's own mark in the menu
  await entry.click();
  const pane = page.locator("#top-row > .app-pane[data-app=notes]");
  await expect(pane).toHaveCount(1);
  const panel = pane.frameLocator("iframe");
  await expect(panel.locator("body[data-ready='1']")).toHaveCount(1);
  const src = (await pane.locator("iframe").getAttribute("src")) || "";
  return { panel, instance: new URL(src).searchParams.get("instance") || "" };
}

/** A tool of the app's called as an agent calls it: its text, and whether it is an error. */
export async function call(page: Page, instance: string, tool: string, args: Record<string, unknown>) {
  const got = await (
    await page.request.post("/api/apps/call", { data: { app: "notes", gatherer: GATHERER, instance, tool, args } })
  ).json();
  return { text: got.content[0].text as string, error: got.isError as boolean };
}

export async function newPage(page: Page, panel: FrameLocator, title: string) {
  await panel.locator("#new-page").click();
  await expect(panel.locator("#title")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
}

/** The page, put in the trash from its row's menu, then deleted for good from the trash. By its title exactly: "Undo"
 * is not "Undone", a page another test left. */
export async function binPage(panel: FrameLocator, title: string) {
  const exact = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = panel.locator(".pg-row").filter({ has: panel.locator(".nm", { hasText: new RegExp(`^${exact}$`) }) });
  const binned = panel
    .locator(".trash-row")
    .filter({ has: panel.locator(".nm", { hasText: new RegExp(`(^|\\s)${exact}$`) }) });
  const row = rows.first();
  await row.hover();
  await row.locator(".acts button[title=More]").click();
  await panel.locator(".pop .it", { hasText: "Move to trash" }).click();
  await expect(rows).toHaveCount(0);
  await panel.locator("#trash-btn").click();
  await binned.locator("button[title='Delete for good']").click();
  await expect(binned).toHaveCount(0);
  await panel.locator("#trash-btn").click();
}
