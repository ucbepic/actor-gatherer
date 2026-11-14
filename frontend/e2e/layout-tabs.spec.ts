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

test("a click while a tab is still being opened goes where it would once it is", async ({ page }) => {
  await twoTabs(page); // Codex's tab shown
  await page.route("**/api/apps?*", async (route) => {
    await new Promise((r) => setTimeout(r, 1500)); // the apps read slowly: Claude's tab a while opening
    await route.continue();
  });
  await tabs(page).nth(0).click(); // Claude's tab, still opening its Notepad...
  await row(page, CODEX).click(); // ...as Codex is clicked: its tab, once Claude's is open
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(notes(page)).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(2);
  await expect(mark(page, CLAUDE)).toHaveText("1");
});

test("a click is not held up by a tab still loading what its actor shows: it goes on at once", async ({ page }) => {
  await twoTabs(page); // Codex's tab shown
  await page.route("**/api/files?*", async (route) => {
    await new Promise((r) => setTimeout(r, 6000)); // an actor's Chat slow to load: Claude's tab a long while opening
    await route.continue();
  });
  await tabs(page).nth(0).click();
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await row(page, CODEX).click(); // well before Claude's Chat has loaded
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true", { timeout: 3000 });
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true", { timeout: 3000 });
  await page.waitForTimeout(6500); // Claude's tab done loading meanwhile: nothing of it opened here, nothing lost
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(2);
  await row(page, CLAUDE).click(); // and Claude's tab, shown again, has its task whole
  await expect(notes(page)).toHaveCount(1);
});

test("reloaded, the page shows the tab shown's actor again, whichever of its first answers comes first", async ({
  page,
}) => {
  await twoTabs(page);
  await tabs(page).nth(0).click(); // Claude's tab: not the actor the page opens on by itself
  await expect(row(page, CLAUDE)).toHaveAttribute("aria-current", "true");
  await page.route("**/api/home", async (route) => {
    await new Promise((r) => setTimeout(r, 1500)); // the stream's home first
    await route.continue();
  });
  await page.reload();
  await expect(row(page, CLAUDE)).toHaveAttribute("aria-current", "true");
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(1);
  await expect(mark(page, CODEX)).toHaveText("2");
});

test("an app selected while the actor shown just before still loads its Chat stays selected once it has", async ({
  page,
}) => {
  const made = await page.request.post("/api/apps/open", {
    data: { app: "notepad", gatherer: GATHERER, folder: "/w/lone" },
  });
  expect(made.ok()).toBe(true);
  await open(page);
  await page.route("**/api/files?*", async (route) => {
    await new Promise((r) => setTimeout(r, 2000)); // an actor's Chat slow to load (one at a time: Claude's after Codex's)
    await route.continue();
  });
  await row(page, CLAUDE).click(); // its Chat loading...
  await lone(page).click({ modifiers: [beside] }); // ...as the lone Notepad is opened beside it, selected
  await expect(notes(page)).toHaveCount(1);
  await expect(lone(page)).toHaveAttribute("aria-current", "true");
  await page.waitForTimeout(5500); // Claude's Chat loaded meanwhile: the Notepad still the one selected
  await expect(lone(page)).toHaveAttribute("aria-current", "true");
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

test("a tab dragged onto the work area opens its tasks there, on the side it is let go, and goes from the bar", async ({
  page,
}) => {
  await twoTabs(page); // Codex's tab shown; Claude's task (with its Notepad) in tab 1
  const chip = await box(tabs(page).nth(0)),
    area = await box(page.locator("#pane-here"));
  await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
  await page.mouse.down();
  await page.mouse.move(chip.x + chip.width / 2 + 10, chip.y + chip.height / 2 + 10, { steps: 3 });
  await page.mouse.move(area.x + area.width * 0.1, area.y + area.height / 2, { steps: 8 }); // Codex's left side
  await expect(page.locator(".lay-to")).toBeVisible();
  await page.mouse.up();
  await expect(tabs(page)).toHaveCount(1); // tab 1 gone: its task in this one
  await expect(notes(page)).toHaveCount(1);
  await expect(mark(page, CLAUDE)).toHaveClass(/here/);
  await expect(mark(page, CODEX)).toHaveClass(/here/);
  await expect
    .poll(async () => (await box(frame(page))).x < (await box(page.locator("#pane-here"))).x) // Claude's, left of Codex's
    .toBe(true);
});

// Claude and a Notepad, one task (under its card head), and Codex beside it (⌘+click), both in the one tab
async function twoTasks(page: Page) {
  await open(page);
  await row(page, CLAUDE).click();
  await addNotepad(page, row(page, CLAUDE));
  await expect(notes(page)).toHaveCount(1);
  await row(page, CODEX).click({ modifiers: [beside] });
  await expect(frame(page)).toHaveCount(1);
  await expect(tabs(page)).toHaveCount(1);
}

test("a task dragged by its card head onto the tab bar goes to a new tab; the tab shown stays, with the others", async ({
  page,
}) => {
  await twoTasks(page);
  const head = await box(page.locator(".lay-strip:visible .lay-sname")),
    bar = await box(page.locator(".lay-tabs:visible"));
  const ghost = page.locator(".lay-tab-ghost");
  await expect(ghost).toBeHidden();
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + head.width / 2 + 10, head.y + head.height / 2 + 10, { steps: 3 });
  await expect(ghost).toBeVisible(); // "New tab", in the bar
  await page.mouse.move(bar.x + bar.width - 80, bar.y + bar.height / 2, { steps: 8 }); // the bar, past its tabs
  await expect(ghost).toHaveClass(/lay-into/);
  await page.mouse.up();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true"); // the tab shown stays shown
  await expect(notes(page)).toHaveCount(0); // without Claude's task
  await expect(row(page, CODEX)).toHaveAttribute("aria-current", "true");
  await expect(mark(page, CODEX)).toHaveText("1");
  await expect(mark(page, CLAUDE)).toHaveText("2");
  await expect(mark(page, CLAUDE)).not.toHaveClass(/here/);
  await expect(ghost).toBeHidden();
  await tabs(page).nth(1).click(); // its tab shown: the task as it was, its Notepad with it
  await expect(notes(page)).toHaveCount(1);
  await expect(row(page, CLAUDE)).toHaveAttribute("aria-current", "true");
  await expect(mark(page, CODEX)).toHaveText("1");
});

test("a task moved from its card head's menu: to a new tab; or, its only panel's head, into another tab", async ({
  page,
}) => {
  const made = await page.request.post("/api/apps/open", {
    data: { app: "notepad", gatherer: GATHERER, folder: "/w/lone" },
  });
  expect(made.ok()).toBe(true);
  await twoTasks(page);
  const menu = page.locator(".row-menu[role=menu][aria-label='Move this task']");
  await page.locator(".lay-strip:visible .lay-sname").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "To a new tab" }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(notes(page)).toHaveCount(0);
  await expect(mark(page, CLAUDE)).toHaveText("2");
  await lone(page).click({ modifiers: [beside] }); // the lone Notepad beside Codex, in tab 1
  await expect(notes(page)).toHaveCount(1);
  await page.locator("#pane-here .fl-grip").click({ button: "right" }); // Codex's grip: its task (its only panel)
  await menu.getByRole("menuitem", { name: `To tab 2 · ${CLAUDE}` }).click();
  await expect(mark(page, CODEX)).toHaveText("2");
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true"); // the lone Notepad's, still shown
  await expect(lone(page)).toHaveAttribute("aria-current", "true");
  await tabs(page).nth(1).click(); // Claude's task and Codex, side by side
  await expect(notes(page)).toHaveCount(1);
  await expect(frame(page)).toHaveCount(1);
  await expect(mark(page, CLAUDE)).toHaveClass(/here/);
  await expect(mark(page, CODEX)).toHaveClass(/here/);
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
