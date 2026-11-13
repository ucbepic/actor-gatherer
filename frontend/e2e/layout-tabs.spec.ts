// SCREEN TABS (features/layout/tabs.ts): several screens of tasks, one shown at a time. ⌥+click in the list opens a task in
// a new tab; a click on a task of another tab brings that tab forward; a click on a task in none, while the tab shown is
// kept (two tasks or more, or named), opens it in a new tab. Their strip over the work area: each tab shown by a press,
// named by a double-click, closed by its × (its actors go on). Kept in this browser.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { addNotepad } from "./task-home";

const beside = process.platform === "darwin" ? "Meta" : "Control";
const row = (page: Page, text: string) => page.locator("#agents button.agent", { hasText: text });
const tabs = (page: Page) => page.locator(".lay-tabs:visible .lay-tab");
const notes = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
const frame = (page: Page) => page.locator("#panes > .pane").nth(1);

// Claude and its Notepad, one task, in the tab shown; Codex, ⌥+clicked, in a tab of its own
async function twoTabs(page: Page) {
  await open(page);
  await row(page, CLAUDE).click();
  await addNotepad(page, row(page, CLAUDE));
  await expect(notes(page)).toHaveCount(1);
  await expect(tabs(page)).toHaveCount(0); // one tab: no strip
  await row(page, CODEX).click({ modifiers: ["Alt"] });
  await expect(tabs(page)).toHaveCount(2);
}

test("⌥+click opens a task in a new tab; the first tab, pressed, shows its task again as it was left", async ({
  page,
}) => {
  await twoTabs(page);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(0); // Codex's tab: Claude's task not in it
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(tabs(page).nth(0)).toContainText(CLAUDE);
  await tabs(page).nth(0).click();
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(1); // its Notepad again, over its pane
  await expect(row(page, CLAUDE)).toHaveAttribute("aria-current", "true");
});

test("a click in the list on a task of another tab brings that tab forward", async ({ page }) => {
  await twoTabs(page);
  await tabs(page).nth(0).click();
  await expect(notes(page)).toHaveCount(1);
  await row(page, CODEX).click();
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(2); // no third
});

test("the tab shown holding two tasks is kept: a click on a task in no tab opens it in a new tab", async ({ page }) => {
  const lone = await page.request.post("/api/apps/open", {
    data: { app: "notepad", gatherer: GATHERER, folder: "/w/lone" },
  });
  expect(lone.ok()).toBe(true);
  await open(page);
  await row(page, CLAUDE).click();
  await row(page, CODEX).click({ modifiers: [beside] }); // two tasks in the tab shown
  await expect(frame(page)).toHaveCount(1);
  await page.locator("#agents button.agent.app-row").click(); // the lone Notepad: in no tab
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(1);
  await tabs(page).nth(0).click(); // the two tasks again, side by side
  await expect(frame(page)).toHaveCount(1);
  await expect(notes(page)).toHaveCount(0);
});

test("a tab named by a double-click keeps its name; × closes a tab, its actors go on; kept after a reload", async ({
  page,
}) => {
  await twoTabs(page);
  await tabs(page).nth(1).locator(".lay-name").dblclick();
  await page.locator(".lay-naming").fill("Review");
  await page.keyboard.press("Enter");
  await expect(tabs(page).nth(1)).toContainText("Review");
  await page.reload();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toContainText("Review");
  await tabs(page).nth(0).locator(".lay-close").click(); // Claude's tab closed: Codex's shown, alone, no strip
  await expect(tabs(page)).toHaveCount(0);
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(row(page, CLAUDE)).toHaveCount(1); // still in the list, as it was
});
