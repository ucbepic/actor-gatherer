// A pane opened beside the actor shown -- the page again, in a frame (features/layout/panes.js's addPane) -- starts from
// the home the page around it has (features/page/data.js's loadHome): it reads none of its own, a read of every actor of
// every group, the longest the dashboard makes. Its Chat waited for that read: a task's actors beside its first were
// "Loading…" for seconds each time the task was opened.
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";

const beside = process.platform === "darwin" ? "Meta" : "Control";

test("a pane opened beside draws its Chat from the page's home, with no read of its own", async ({ page }) => {
  await open(page);
  await page.locator("#agents .agent", { hasText: CLAUDE }).click();
  await expect(page.locator("#pane-here #main")).toContainText("Ahoy, Bob!"); // the page's own actor drawn: its home read
  const asked: string[] = [];
  await page.route("**/api/home", (route) => {
    asked.push(route.request().frame().url()); // held: never answered
  });
  await page.locator("#agents .agent", { hasText: CODEX }).click({ modifiers: [beside] });
  const pane = page.locator("#panes > .pane").nth(1);
  await expect(pane).toHaveCount(1);
  await expect(pane.frameLocator("iframe").locator("#main")).toContainText(CODEX, { timeout: 5000 });
  expect(asked).toEqual([]);
});
