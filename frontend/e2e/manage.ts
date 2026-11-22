// Manage groups (features/list/group-moves.ts), as the specs drive it: opened from the settings panel (the logo); its rows found
// by their names -- not their switches, which name groups too -- and dragged as the list's are, a change of group
// asked first there (in the list, done at once by the default rule).
import type { Locator, Page } from "@playwright/test";
import { expect } from "./test";

export const panel = (page: Page) => page.locator("dialog.mg-dialog");
export const mgRow = (page: Page, text: string) =>
  panel(page)
    .locator(".mg-row")
    .filter({ has: page.locator(".mg-name", { hasText: text }) })
    .first();
export async function manage(page: Page) {
  await page.locator("#about-btn").click();
  await page.locator("#manage-groups").click();
  await expect(panel(page).locator("h3")).toHaveText("Manage groups");
}
export const closeManage = (page: Page) => panel(page).getByRole("button", { name: "Close", exact: true }).click();
// `row` dragged by hand onto the "Outside every group" area of `where` (the panel, or the list's head), shown only once
// a drag has started; `says`, what it says then
export async function dragOutside(page: Page, row: Locator, where: Locator, says: string) {
  await row.hover();
  await page.mouse.down();
  const at = (await row.boundingBox())!;
  await page.mouse.move(at.x + 20, at.y + at.height + 12, { steps: 4 });
  const outside = where.locator(".outside-drop");
  await expect(outside).toHaveText(says);
  await outside.hover();
  await page.mouse.up();
}
