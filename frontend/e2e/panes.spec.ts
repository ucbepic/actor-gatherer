// Panes (page.html: "panes"): actors side by side, a ⌘/Ctrl+click on one in the list opening it beside.
import { expect, test } from "./test";
import { CLAUDE, CODEX, masks, openActor } from "./home";

const beside = process.platform === "darwin" ? "Meta" : "Control";

test("opens a second actor beside the first, and closes it", async ({ page }) => {
  await openActor(page, CODEX);
  await page.locator("#agents .agent", { hasText: CLAUDE }).click({ modifiers: [beside] });
  const panes = page.locator("#panes > .pane");
  await expect(panes).toHaveCount(2);
  // the pointer off the actor clicked: its hover card not drawn over the panes
  await page.mouse.move(700, 700);
  await expect(page.locator("#actor-card")).toBeHidden();
  await expect(page).toHaveScreenshot("panes-two.png", { mask: masks(page) });
  // each pane beside the first is a pane of the page too, its × in its head
  await panes.nth(1).locator(".pane-close").click();
  await expect(panes).toHaveCount(1);
  await expect(page).toHaveScreenshot("panes-one.png", { mask: masks(page) });
});
