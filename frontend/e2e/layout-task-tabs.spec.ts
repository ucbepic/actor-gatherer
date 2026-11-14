// A task's TABS (features/layout/tasks.ts): a task may hold several, one shown at a time, each a set of its panels and
// how they are arranged. A panel is put in a new tab of its task from its menu, or dropped on another tab's name in the
// task's strip (⌥: copied); a tab pressed shows its panels, the task's others closed; closing a panel takes it out of
// that tab only, and a tab left with none goes; a tab is named by a double-click. Kept in this browser.
import type { Locator, Page } from "@playwright/test";
import { closePanel, expect, panelMenu, test } from "./test";
import { CLAUDE, open } from "./home";
import { addNotepad } from "./task-home";

const box = async (l: Locator) => (await l.boundingBox())!;
const notes = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
const here = (page: Page) => page.locator("#pane-here");
const chips = (page: Page) => page.locator(".lay-strip:visible .lay-ttab");

// Claude and its Notepad, one task; Notepad moved to a new tab of it from its menu (its row in the task's card)
async function notepadInItsOwnTab(page: Page) {
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  await expect(notes(page)).toHaveCount(1);
  await (await panelMenu(page, notes(page))).getByRole("menuitem", { name: "To a new tab of this task" }).click();
  await page.mouse.move(0, 0);
  await expect(chips(page)).toHaveCount(2);
}

test("a panel moved to a new tab of its task: that tab shown, holding it alone; the first, pressed, the others", async ({
  page,
}) => {
  await notepadInItsOwnTab(page);
  await expect(chips(page)).toHaveText(["Tab 1×", "Tab 2×"]);
  await expect(chips(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(1);
  await expect(here(page)).toBeHidden(); // Claude's pane not in this tab: out of sight
  const n = await box(notes(page)),
    s = await box(page.locator(".lay-strip:visible"));
  expect(n.y).toBeCloseTo(s.y + s.height, 0); // Notepad all of the task, under its strip
  await chips(page).nth(0).click();
  await expect(chips(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(0); // Tab 1: Claude's pane alone
  await expect(here(page)).toBeVisible();
  await page.reload(); // kept in this browser (the page opens on its first actor: Claude's row clicked)
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(0)).toHaveAttribute("aria-selected", "true");
});

test("a panel dropped on another tab's name goes into that tab; with ⌥, a copy, kept in this one too", async ({
  page,
}) => {
  await notepadInItsOwnTab(page);
  await chips(page).nth(0).click(); // Tab 1: Claude's pane
  await expect(here(page)).toBeVisible();
  // no panel above it here: moved by its own head. Waited for -- for a moment after the switch the chat still has Tab
  // 2's bar, the head hidden and its grip in the bar, which goes as the chat is drawn again
  const head = page.locator("#pane-here > .pane-top");
  await expect(head).toBeVisible();
  await expect(here(page).locator(".fl-grip")).toHaveCount(0);
  const drop = async (alt: boolean) => {
    const g = await box(head);
    const c = await box(chips(page).nth(1));
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 20, g.y + 20, { steps: 3 });
    if (alt) await page.keyboard.down("Alt");
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 });
    await page.mouse.up();
    if (alt) await page.keyboard.up("Alt");
  };
  await drop(true); // copied: still in Tab 1
  await expect(here(page)).toBeVisible();
  await chips(page).nth(1).click(); // Tab 2: Notepad and Claude now
  await expect(notes(page)).toHaveCount(1);
  await expect(here(page)).toBeVisible();
});

test("closing a panel takes it out of its tab only; a tab left with none goes, its task's other shown", async ({
  page,
}) => {
  await notepadInItsOwnTab(page);
  await closePanel(page, notes(page)); // Tab 2's only panel
  await expect(chips(page)).toHaveCount(0); // its tab gone: one tab left, the task as before
  await expect(here(page)).toBeVisible();
  await expect(notes(page)).toHaveCount(0);
});

test("a task's tab named by a double-click", async ({ page }) => {
  await notepadInItsOwnTab(page);
  await chips(page).nth(1).dblclick();
  await page.locator(".lay-strip .lay-naming").fill("Notes");
  await page.keyboard.press("Enter");
  await expect(chips(page).nth(1)).toHaveText("Notes×");
});
