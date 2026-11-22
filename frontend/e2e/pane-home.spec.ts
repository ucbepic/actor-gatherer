// A pane opened beside the actor shown (features/layout/panes.js's addPane) draws from the home the page has
// (features/page/data.js's loadHome): it reads none of its own, a read of every actor of every group, the longest the
// dashboard makes -- nor loads the page again. Its Chat waited for that read when panes were frames: a task's actors
// beside its first were "Loading…" for seconds each time the task was opened.
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";

const beside = process.platform === "darwin" ? "Meta" : "Control";

test("a pane opened beside draws its Chat from the page's home, with no read of its own", async ({ page }) => {
  await open(page);
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  await expect(page.locator("#pane-here #main")).toContainText("Ahoy, Bob!"); // the page's own actor drawn: its home read
  const asked: string[] = [];
  await page.route("**/api/home", (route) => {
    asked.push(route.request().frame().url()); // held: never answered
  });
  await page.locator("#agents button.agent", { hasText: CODEX }).click({ modifiers: [beside] });
  const pane = page.locator("#panes > .pane").nth(1);
  await expect(pane).toHaveCount(1);
  await expect(pane.locator("main")).toContainText(CODEX, { timeout: 5000 });
  expect(asked).toEqual([]);
});

test("a pane opened beside is a part of the page: no frame, no second load of the page", async ({ page }) => {
  await open(page);
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  await expect(page.locator("#pane-here #main")).toContainText("Ahoy, Bob!");
  const documents: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents.push(r.url());
  });
  await page.locator("#agents button.agent", { hasText: CODEX }).click({ modifiers: [beside] });
  const pane = page.locator("#panes > .pane").nth(1);
  await expect(pane.locator("main")).toContainText(CODEX, { timeout: 5000 });
  await expect(pane.locator("iframe")).toHaveCount(0);
  await expect(page.locator("#panes iframe")).toHaveCount(0);
  expect(page.frames()).toHaveLength(1); // the page alone: no frame of its own for the pane
  expect(documents).toEqual([]);
});
