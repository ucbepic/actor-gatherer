// What the Notes tests share: the Notes panel opened from the gatherer's menu, a page made and binned in it, and its
// tools called as an agent calls them.
import type { FrameLocator, Locator, Page } from "@playwright/test";
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

/** Whether the caret is in this line's words (`.tx`, a caption's too): the page's lines are one editor (its root,
 * #blocks, has the focus whichever line the caret is in), its selection in the line, and the editor taking keys. */
export const caretIn = (words: Locator) =>
  words.evaluate((tx) => {
    const root = tx.closest("#blocks") as HTMLElement | null,
      s = getSelection();
    return (
      !!root &&
      document.activeElement === root &&
      root.isContentEditable &&
      !!s?.anchorNode &&
      tx.contains(s.anchorNode)
    );
  });

export async function newPage(page: Page, panel: FrameLocator, title: string) {
  await panel.locator("#new-page").click();
  await expect(panel.locator("#title")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
}

/** The page, put in the trash from its row's menu, then deleted for good from the trash, and saved. By its title
 * exactly: "Undo" is not "Undone", a page another test left. Every page of that title goes: an attempt of the same
 * test that failed earlier in this home (a retry) may have left its own. */
export async function binPage(panel: FrameLocator, title: string) {
  const exact = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = panel.locator(".pg-row").filter({ has: panel.locator(".nm", { hasText: new RegExp(`^${exact}$`) }) });
  const binned = panel
    .locator(".trash-row")
    .filter({ has: panel.locator(".nm", { hasText: new RegExp(`(^|\\s)${exact}$`) }) });
  await expect(rows).not.toHaveCount(0);
  for (let n = await rows.count(); n > 0; n--) {
    const row = rows.first();
    await row.hover();
    await row.locator(".acts button[title=More]").click();
    await panel.locator(".pop .it", { hasText: "Move to trash" }).click();
    await expect(rows).toHaveCount(n - 1);
  }
  await panel.locator("#trash-btn").click();
  await expect(binned).not.toHaveCount(0);
  for (let n = await binned.count(); n > 0; n--) {
    await binned.first().locator("button[title='Delete for good']").click();
    await expect(binned).toHaveCount(n - 1);
  }
  await panel.locator("#trash-btn").click();
  // sent before the test goes on, or ends: a change made while one is still being sent waits for it, and one sent as the
  // page closes may land after the next test of that title has looked in the trash
  await expect(panel.locator("#saved")).toHaveText("Saved");
}
