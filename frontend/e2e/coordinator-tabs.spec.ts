// THE COORDINATOR AGENT IN THE SCREEN TABS (features/layout/tabs.ts): an actor on its own, as any other (features/layout/panes.js's
// taskKey). Its button on its group's row, or its row, opens it where it is open, else in a tab of its own, named for
// what it is; a tab showing it is kept when left, a new tab opened or another shown, and shows it again when shown.
import type { Page } from "@playwright/test";
import { expect, homeAs, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";

type Agent = { channel: string; harness?: string; [k: string]: unknown };
type Group = { name: string; agents: Agent[]; [k: string]: unknown };
const beside = process.platform === "darwin" ? "Meta" : "Control";
const row = (page: Page, text: string) => page.locator("#agents .agent", { hasText: text });
const crew = (page: Page) => page.locator("#agents .gatherer-row .act.crew");
const tabs = (page: Page) => page.locator(".lay-tabs:visible .lay-tab");
const panes = (page: Page) => page.locator("#panes > .pane:not(.lay-away)");

// The test home with its Codex actor its group's coordinator agent: as /api/home answers, and as the stream sends it
async function withCoordinator(page: Page) {
  const change = (home: Record<string, unknown>) => {
    const demo = (home.gatherers as Group[]).find((x) => x.name === GATHERER)!;
    const codex = demo.agents.find((a) => a.harness === "codex")!;
    Object.assign(codex, { role: "coordinator", avatar: "roles/manager" });
    return home;
  };
  await page.route("**/api/home", async (route) => route.fulfill({ json: change(await (await route.fetch()).json()) }));
  await homeAs(page, change);
  await open(page);
  await expect(row(page, CODEX)).toHaveClass(/coordinator/);
}

test("the coordinator agent opens in a tab of its own, kept when a new tab is opened, shown again with it", async ({
  page,
}) => {
  await withCoordinator(page);
  await row(page, CLAUDE).click();
  await expect(tabs(page)).toHaveCount(1);
  await crew(page).click(); // open nowhere: a tab of its own
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs(page).nth(1)).toContainText("Coordinator agent");
  await expect(row(page, CODEX).locator(".a-main")).toHaveAttribute("aria-current", "true");
  await expect(row(page, CODEX).locator(".tab-no")).toHaveText("2");
  await page.locator(".lay-tab-add").click(); // a new tab: the coordinator's kept
  await expect(tabs(page)).toHaveCount(3);
  await tabs(page).nth(1).click(); // (the new tab, left with nothing in it, closed)
  await expect(tabs(page)).toHaveCount(2);
  await expect(row(page, CODEX).locator(".a-main")).toHaveAttribute("aria-current", "true");
  await expect(panes(page)).toHaveCount(1);
  await crew(page).click(); // open in the tab shown: no other
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page).nth(0).click();
  await expect(row(page, CLAUDE).locator(".a-main")).toHaveAttribute("aria-current", "true");
  await crew(page).click(); // open in another tab: that tab brought forward
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, CODEX).locator(".a-main")).toHaveAttribute("aria-current", "true");
});

test("the coordinator agent opened beside a task is kept in that tab: shown again with it", async ({ page }) => {
  await withCoordinator(page);
  await row(page, CLAUDE).click();
  await row(page, CODEX).click({ modifiers: [beside] }); // beside Claude, in the same tab
  await expect(panes(page)).toHaveCount(2);
  await expect(tabs(page)).toHaveCount(1);
  await page.locator(".lay-tab-add").click();
  await expect(tabs(page)).toHaveCount(2);
  await tabs(page).nth(0).click();
  await expect(panes(page)).toHaveCount(2);
  await expect(page.locator("#panes > .pane").nth(1)).toBeVisible();
  await expect(row(page, CODEX).locator(".tab-no")).toHaveText("1");
});
