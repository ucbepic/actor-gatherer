// CLOSED FROM THE LIST, CLOSED IN THE SCREEN TABS (features/layout/panes.js's closedInTabs, tabs.ts's `closed`): an actor's, a task's,
// an app's × in the list closes it in the tabs too, as there a tab's × would -- its tab closed if it held nothing else (the
// tab shown: the next shown; the only one, emptied: a new tab), else it out of that tab, the tab's other tasks as they
// are. One actor of a task closed from the task's card: its pane closed, as its pane's × does.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";
import { cardOf, taskHome, taskRow } from "./task-home";

const beside = process.platform === "darwin" ? "Meta" : "Control";
const row = (page: Page, text: string) => page.locator("#agents .agent", { hasText: text });
const mark = (page: Page, text: string) => row(page, text).locator(".tab-no");
const tabs = (page: Page) => page.locator(".lay-tabs:visible .lay-tab");
const panes = (page: Page) => page.locator("#panes > .pane:not(.lay-away)");
const newTab = (page: Page) => page.locator(".work > .lay-empty.nt:not([hidden])");

// each actor's process closed (/api/stop), answered here: the session ids asked for
async function stops(page: Page) {
  const asked: string[] = [];
  await page.route("**/api/stop", async (route) => {
    asked.push(route.request().postDataJSON().session_id);
    await route.fulfill({ json: {} });
  });
  return asked;
}
async function closeRow(page: Page, text: string) {
  await page.mouse.move(0, 0);
  await row(page, text).hover();
  await row(page, text).locator(".a-acts .close-btn").click();
}
// Claude in tab 1, Codex (open nowhere, clicked) in tab 2, shown -- each a task of its own, each closable
async function twoTabs(page: Page) {
  await taskHome(page, false, true);
  const asked = await stops(page);
  await open(page);
  await row(page, CLAUDE).click();
  await row(page, CODEX).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  return asked;
}

test("an actor closed in the list: its tab, shown, holding nothing else, closed -- the next shown; the only one emptied", async ({
  page,
}) => {
  const asked = await twoTabs(page);
  await closeRow(page, CODEX); // Codex's tab closed, Claude's shown
  await expect.poll(() => asked.length).toBe(1);
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(row(page, CLAUDE).locator(".a-main")).toHaveAttribute("aria-current", "true");
  await expect(mark(page, CODEX)).toHaveCount(0); // open in no tab
  await closeRow(page, CLAUDE); // the only tab: emptied, a new tab's page
  await expect.poll(() => asked.length).toBe(2);
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toContainText("New tab");
  await expect(newTab(page)).toBeVisible();
  await expect(panes(page)).toHaveCount(0);
  await expect(mark(page, CLAUDE)).toHaveCount(0);
});

test("an actor closed in the list, open in another tab: that tab closed, the tab shown as it is", async ({ page }) => {
  const asked = await twoTabs(page);
  await closeRow(page, CLAUDE); // in tab 1, not shown
  await expect.poll(() => asked.length).toBe(1);
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(row(page, CODEX).locator(".a-main")).toHaveAttribute("aria-current", "true");
  await expect(mark(page, CLAUDE)).toHaveCount(0);
});

test("an actor closed in the list, beside another in the tab shown: its pane closed, the tab kept with the other", async ({
  page,
}) => {
  await taskHome(page, false, true);
  const asked = await stops(page);
  await open(page);
  await row(page, CLAUDE).click();
  await row(page, CODEX).click({ modifiers: [beside] }); // beside, in the tab shown
  await expect(panes(page)).toHaveCount(2);
  await expect(tabs(page)).toHaveCount(1);
  await closeRow(page, CODEX);
  await expect.poll(() => asked.length).toBe(1);
  await expect(panes(page)).toHaveCount(1);
  await expect(tabs(page)).toHaveCount(1);
  await expect(row(page, CLAUDE).locator(".a-main")).toHaveAttribute("aria-current", "true");
  await expect(mark(page, CLAUDE)).toHaveText("1");
  await expect(mark(page, CODEX)).toHaveCount(0);
});

test("one actor of a task closed from the task's card: its pane closed, the task kept in its tab", async ({ page }) => {
  await taskHome(page, true, true);
  const asked = await stops(page);
  await open(page);
  await taskRow(page).click(); // its two actors side by side
  await expect(panes(page)).toHaveCount(2);
  const card = await cardOf(page, taskRow(page));
  await card.locator(".c-task-row:not(.c-app-row)").nth(1).locator(".close-btn").click();
  await expect.poll(() => asked.length).toBe(1);
  await expect(panes(page)).toHaveCount(1);
  await expect(tabs(page)).toHaveCount(1);
  await expect(taskRow(page).locator(".tab-no")).toHaveText("1"); // the task still open in it
});
