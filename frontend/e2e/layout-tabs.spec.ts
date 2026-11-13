// SCREEN TABS (features/layout/tabs.ts): several screens of tasks, one shown at a time; a task in one at most, OPEN where
// any of its items is shown. A plain click in the list on a task: open in the tab shown, its panel in focus; open in
// another tab, that tab brought forward; open nowhere, a tab of its own (the tab shown, if it shows nothing -- or only the
// actor the page opened on by itself). ⌥+click: the tab shown made the task's alone. ⌘+click: a task of another tab, that
// tab brought forward; else beside. The tabs' bar, over the work area always: each tab shown by a press, named by a
// double-click, closed by its × (its actors go on); "+", a new tab, empty. The list numbers each row open by its tab.
// Kept in this browser.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { addNotepad } from "./task-home";

const beside = process.platform === "darwin" ? "Meta" : "Control";
const row = (page: Page, text: string) => page.locator("#agents button.agent", { hasText: text });
const mark = (page: Page, text: string) => row(page, text).locator(".tab-no");
const tabs = (page: Page) => page.locator(".lay-tabs:visible .lay-tab");
const notes = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
const frame = (page: Page) => page.locator("#panes > .pane").nth(1);
const lone = (page: Page) => page.locator("#agents button.agent.app-row");
const box = async (l: Locator) => (await l.boundingBox())!;

// Claude (the page's first click: in place of the actor it opened on) with a Notepad, one task, in tab 1; Codex, open
// nowhere, clicked: in tab 2
async function twoTabs(page: Page) {
  await open(page);
  await row(page, CLAUDE).click();
  await expect(tabs(page)).toHaveCount(1);
  await addNotepad(page, row(page, CLAUDE));
  await expect(notes(page)).toHaveCount(1);
  await row(page, CODEX).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
}

test("a click on a task open nowhere opens it in a tab of its own; on one in another tab, brings that tab forward", async ({
  page,
}) => {
  await twoTabs(page);
  await expect(notes(page)).toHaveCount(0); // Codex's tab: Claude's task not in it
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(mark(page, CLAUDE)).toHaveText("1"); // open in tab 1, not shown
  await expect(mark(page, CLAUDE)).not.toHaveClass(/here/);
  await expect(mark(page, CODEX)).toHaveText("2");
  await expect(mark(page, CODEX)).toHaveClass(/here/);
  await row(page, CLAUDE).click(); // in tab 1: that tab shown, as it was left
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(1);
  await expect(row(page, CLAUDE)).toHaveAttribute("aria-current", "true");
  await expect(tabs(page)).toHaveCount(2); // no third
  await tabs(page).nth(1).click(); // pressed: shown
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
});

test("a click on a task open in the tab shown puts it in focus; ⌥+click leaves the tab with that task alone", async ({
  page,
}) => {
  await open(page);
  await row(page, CLAUDE).click();
  await row(page, CODEX).click({ modifiers: [beside] }); // beside, in the tab shown
  await expect(frame(page)).toHaveCount(1);
  await row(page, CLAUDE).click(); // open here: in focus, nothing opened or closed
  await expect(row(page, CLAUDE)).toHaveAttribute("aria-current", "true");
  await expect(frame(page)).toHaveCount(1);
  await expect(tabs(page)).toHaveCount(1);
  await row(page, CODEX).click({ modifiers: ["Alt"] }); // the tab shown: Codex's alone, Claude's pane closed
  await expect(frame(page)).toHaveCount(0);
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(tabs(page)).toHaveCount(1); // no new tab, none lost
  await expect(mark(page, CLAUDE)).toHaveCount(0); // open nowhere now
  await row(page, CLAUDE).click(); // so: a tab of its own
  await expect(tabs(page)).toHaveCount(2);
});

test("⌥+click on a task of another tab moves it into the tab shown, in place of its tasks; its tab, left empty, goes", async ({
  page,
}) => {
  await twoTabs(page);
  await tabs(page).nth(0).click(); // Claude's tab
  await expect(notes(page)).toHaveCount(1);
  await row(page, CODEX).click({ modifiers: ["Alt"] });
  await expect(tabs(page)).toHaveCount(1);
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(notes(page)).toHaveCount(0);
  await expect(mark(page, CLAUDE)).toHaveCount(0);
});

test("⌘+click on a task of another tab brings that tab forward, nothing opened beside", async ({ page }) => {
  await twoTabs(page);
  await tabs(page).nth(0).click();
  await expect(notes(page)).toHaveCount(1);
  await row(page, CODEX).click({ modifiers: [beside] });
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(frame(page)).toHaveCount(0);
  await expect(notes(page)).toHaveCount(0);
});

test("an actor stays in its tab though an app beside it was selected as the tab was left", async ({ page }) => {
  const made = await page.request.post("/api/apps/open", {
    data: { app: "notepad", gatherer: GATHERER, folder: "/w/lone" },
  });
  expect(made.ok()).toBe(true);
  await open(page);
  await row(page, CLAUDE).click();
  await lone(page).click({ modifiers: [beside] }); // the lone Notepad beside Claude, selected
  await expect(notes(page)).toHaveCount(1);
  await expect(lone(page)).toHaveAttribute("aria-current", "true");
  await row(page, CODEX).click(); // tab 2
  await expect(tabs(page)).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await tabs(page).nth(0).click(); // back: Claude and the Notepad, both, the Notepad selected
    await expect(notes(page)).toHaveCount(1);
    await expect(page.locator("#pane-here")).toBeVisible();
    await expect(lone(page)).toHaveAttribute("aria-current", "true");
    await expect(mark(page, CLAUDE)).toHaveClass(/here/);
    await tabs(page).nth(1).click();
    await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  }
  await expect(mark(page, CLAUDE)).toHaveText("1"); // still kept in tab 1
});

test('"+" opens a new tab, empty, the next task clicked shown in it; left empty, it goes', async ({ page }) => {
  await open(page);
  await row(page, CLAUDE).click();
  await page.locator(".lay-tab-add").click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.locator(".lay-empty")).toContainText("Nothing open in this tab");
  await expect(row(page, CLAUDE)).not.toHaveAttribute("aria-current", "true");
  await expect(mark(page, CLAUDE)).toHaveText("1");
  await row(page, CODEX).click(); // open nowhere: shown in the empty tab, not a third
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.locator(".lay-empty")).toBeHidden();
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.locator(".lay-tab-add").click();
  await expect(tabs(page)).toHaveCount(3);
  await tabs(page).nth(0).click(); // the empty one left: gone
  await expect(tabs(page)).toHaveCount(2);
  await expect(row(page, CLAUDE)).toHaveAttribute("aria-current", "true");
});

test("a task's row open in a tab is not dropped onto the work area", async ({ page }) => {
  await twoTabs(page); // Claude's task in tab 1, Codex in tab 2 (shown)
  const area = await box(page.locator("#pane-here"));
  const r = await box(row(page, CLAUDE));
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 + 10, r.y + r.height / 2 + 10, { steps: 3 });
  await page.mouse.move(area.x + area.width / 2, area.y + area.height * 0.1, { steps: 8 });
  await expect(page.locator(".lay-cover")).toHaveCount(0); // no place to put it: it is open in tab 1
  await page.mouse.up();
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(0);
  await expect(mark(page, CLAUDE)).toHaveText("1");
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
  await tabs(page).nth(0).locator(".lay-close").click(); // Claude's tab closed: Codex's shown, alone, no ×
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).locator(".lay-close")).toHaveCount(0);
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(row(page, CLAUDE)).toHaveCount(1); // still in the list, as it was
  await expect(mark(page, CLAUDE)).toHaveCount(0);
});
