// A pane MINIMIZED (features/layout/work.ts): only its message box, where something of its task is above or below it --
// with the panes side by side with it, all minimized or all whole, their row only as tall as their message boxes.
// Kept in its task's arrangement: moved where nothing is above or below it, shown whole; moved back, minimized again.
// Minimized by the bar above it too, dragged past its least (BELOW_MIN): shorter than FOLD_UNDER, minimized; longer again,
// whole -- in the same drag, or a later one; shown whole by its own button, as tall as before it was dragged. So too a
// task of one pane above or below another task in the tab: the line between them dragged. Never all of a column: nothing
// whole left to take the room, a blank under them.
import type { Locator, Page } from "@playwright/test";
import { expect, panelMenu, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";
import { addNotepad, taskHome, taskRow } from "./task-home";

const box = async (l: Locator) => (await l.boundingBox())!;
const notes = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
const other = (page: Page) => page.locator("#panes > .pane").nth(1);
const minimize = (where: Page | ReturnType<Page["frameLocator"]>) =>
  where.locator("button[aria-label='Minimize the chat']:visible").first();

test("two panes under an app: minimized together by either's button, their row only as tall as their message boxes; shown whole together", async ({
  page,
}) => {
  await taskHome(page, true); // Claude and Codex, one task, side by side
  await open(page);
  await taskRow(page).click();
  await expect(other(page)).toHaveCount(1);
  await addNotepad(page, taskRow(page)); // Notepad above both
  await expect(notes(page)).toHaveCount(1);
  const frame = other(page).frameLocator("iframe");
  const claudeMini = page.locator("#main > .chat.mini"),
    codexMini = frame.locator("#main > .chat.mini");
  const tall = (await box(notes(page))).height;
  await minimize(page).click(); // Claude's: Codex's beside it too -- no blank above either message box
  await expect(claudeMini).toHaveCount(1);
  await expect(codexMini).toHaveCount(1);
  await expect.poll(async () => (await box(notes(page))).height).toBeGreaterThan(tall + 200);
  await frame.locator("#main > .chat.mini .mini-hist .mh-row").first().click(); // Codex's shown whole: Claude's too
  await expect(codexMini).toHaveCount(0);
  await expect(claudeMini).toHaveCount(0);
  await expect.poll(async () => (await box(notes(page))).height).toBeLessThan(tall + 50);
  await minimize(frame).click(); // Codex's own button: both again
  await expect(claudeMini).toHaveCount(1);
  await expect(codexMini).toHaveCount(1);
});

test("a minimized pane moved beside its app is whole; moved back under it, minimized again", async ({ page }) => {
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  await expect(notes(page)).toHaveCount(1);
  const mini = page.locator("#main > .chat.mini");
  await minimize(page).click();
  await expect(mini).toHaveCount(1);
  const menu = async (name: string) => {
    await (await panelMenu(page, notes(page))).getByRole("menuitem", { name }).click(); // Notepad's, from its task's card
    await page.mouse.move(0, 0);
  };
  await menu("To the right"); // side by side: nothing above Claude's pane
  await expect(mini).toHaveCount(0);
  await expect(minimize(page)).toHaveCount(0); // nor offered
  await menu("To the top"); // above it again
  await expect(mini).toHaveCount(1);
});

test("a pane dragged shorter than its least is minimized; dragged longer again, whole", async ({ page }) => {
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude); // Notepad above Claude's pane
  await expect(notes(page)).toHaveCount(1);
  const pane = page.locator("#pane-here"),
    mini = page.locator("#main > .chat.mini"),
    bar = page.locator(".lay-bar.thick");
  await expect(bar).toHaveCount(1);
  const before = (await box(pane)).height,
    bottom = (await box(pane)).y + before; // (the pane's bottom stays where it is)
  // the bar pressed, then moved to where the pane would be `h` tall
  const press = async () => {
    const b = await box(bar);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    return b.x + b.width / 2;
  };
  const to = (x: number, h: number) => page.mouse.move(x, bottom - h, { steps: 4 });
  let x = await press();
  await to(x, 180); // past its least, not past the fold: held at its least
  await expect.poll(async () => Math.round((await box(pane)).height)).toBe(220);
  await expect(mini).toHaveCount(0);
  await to(x, 100); // past the fold: minimized
  await expect(mini).toHaveCount(1);
  expect((await box(pane)).height).toBeLessThan(150);
  await to(x, 320); // back up, in the same drag: whole, as tall as the pointer says
  await expect(mini).toHaveCount(0);
  await expect.poll(async () => Math.round((await box(pane)).height)).toBeGreaterThan(310);
  await to(x, 90); // down again, let go: minimized, the Notepad taking the room
  await page.mouse.up();
  await expect(mini).toHaveCount(1);
  await expect(bar).not.toHaveClass(/still/); // (its bar still dragged: to show it whole)
  await page.reload(); // kept in its task's arrangement
  await expect(mini).toHaveCount(1);
  x = await press(); // a later drag up: whole again
  await to(x, 300);
  await page.mouse.up();
  await expect(mini).toHaveCount(0);
  await expect.poll(async () => Math.round((await box(pane)).height)).toBeGreaterThan(290);
  x = await press(); // minimized by a drag, shown whole by its own button: as tall as before that drag
  const was = Math.round((await box(pane)).height);
  await to(x, 100);
  await page.mouse.up();
  await expect(mini).toHaveCount(1);
  await page.locator("#main > .chat.mini .mini-hist .mh-row").first().click(); // (its last lines, pressed)
  await expect(mini).toHaveCount(0);
  await expect.poll(async () => Math.round((await box(pane)).height)).toBe(was);
  expect(before).toBeGreaterThan(220);
});

test("an app under a pane is never minimized by its bar: it stops at its least, as before", async ({ page }) => {
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  await expect(notes(page)).toHaveCount(1);
  const b = await box(page.locator(".lay-bar.thick")),
    top = (await box(notes(page))).y;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, top + 40, { steps: 5 }); // the Notepad's row dragged far under its least
  await page.mouse.up();
  await expect(page.locator("#main > .chat.mini")).toHaveCount(0);
  await expect(notes(page)).toBeVisible();
  expect(Math.round((await box(notes(page))).height)).toBeGreaterThanOrEqual(130);
});

test("a bar dragged keeps the layout in the browser once, when it is let go, not at each move", async ({ page }) => {
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  await expect(notes(page)).toHaveCount(1);
  await page.evaluate(() => {
    const w = window as unknown as { __writes: number };
    w.__writes = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === "ag-dashboard-layout") w.__writes++;
      return set.call(this, k, v);
    };
  });
  const writes = () => page.evaluate(() => (window as unknown as { __writes: number }).__writes);
  const b = await box(page.locator(".lay-bar.thick")),
    x = b.x + b.width / 2;
  await page.mouse.move(x, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, b.y + 60, { steps: 12 });
  expect(await writes()).toBe(0); // held: none yet
  await page.mouse.up();
  await expect.poll(writes).toBe(1);
});

test("a task of one pane under another task in the tab: minimized by the line between them, dragged", async ({
  page,
}) => {
  await open(page);
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  const beside = process.platform === "darwin" ? "Meta" : "Control";
  await page.locator("#agents button.agent", { hasText: CODEX }).click({ modifiers: [beside] }); // a task of its own
  await expect(other(page)).toHaveCount(1);
  await page.locator("#pane-here > .pane-top").click({ button: "right" }); // Claude's task under Codex's
  await page
    .locator(".row-menu[role=menu][aria-label='Move this task']")
    .getByRole("menuitem", { name: "To the bottom" })
    .click();
  const pane = page.locator("#pane-here"),
    mini = page.locator("#main > .chat.mini"),
    bar = page.locator(".lay-bar[data-dir=col]");
  await expect.poll(async () => (await box(pane)).y > (await box(other(page))).y + 100).toBe(true);
  await expect(bar).toHaveCount(1);
  await expect(minimize(page)).toHaveCount(1); // (its own button offered too: something above it)
  const codex = other(page).frameLocator("iframe");
  await expect(minimize(codex)).toHaveCount(1); // (and Codex's, above it)
  const bottom = (await box(pane)).y + (await box(pane)).height,
    b = await box(bar),
    x = b.x + b.width / 2;
  await page.mouse.move(x, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, bottom - 180, { steps: 4 }); // held at its least
  await expect.poll(async () => Math.round((await box(pane)).height)).toBeGreaterThanOrEqual(219);
  await expect(mini).toHaveCount(0);
  await page.mouse.move(x, bottom - 100, { steps: 4 }); // minimized, Codex's task taking the room
  await page.mouse.up();
  await expect(mini).toHaveCount(1);
  expect((await box(pane)).height).toBeLessThan(150);
  await expect.poll(async () => (await box(other(page))).height).toBeGreaterThan(500);
  await expect(minimize(codex)).toHaveCount(0); // Codex's not offered now: nothing whole left to take the room
  await page.reload(); // kept
  await expect(mini).toHaveCount(1);
  const b2 = await box(bar); // dragged back up: whole
  await page.mouse.move(x, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, bottom - 320, { steps: 4 });
  await page.mouse.up();
  await expect(mini).toHaveCount(0);
  await expect.poll(async () => Math.round((await box(pane)).height)).toBeGreaterThan(300);
});

test("two panes of a task one above the other: either minimized, the other then not offered; shown whole again, both are", async ({
  page,
}) => {
  await taskHome(page, true); // Claude and Codex, one task, side by side
  await open(page);
  await taskRow(page).click();
  await expect(other(page)).toHaveCount(1);
  await page.locator("#pane-here > .pane-top").click({ button: "right" }); // Claude's pane under Codex's
  await page.locator(".row-menu[role=menu]").getByRole("menuitem", { name: "To the bottom" }).click();
  const pane = page.locator("#pane-here"),
    mini = page.locator("#main > .chat.mini"),
    codex = other(page).frameLocator("iframe");
  await expect.poll(async () => (await box(pane)).y > (await box(other(page))).y + 100).toBe(true);
  await expect(minimize(codex)).toHaveCount(1);
  await minimize(page).click(); // Claude's: Codex's taking the room
  await expect(mini).toHaveCount(1);
  await expect.poll(async () => (await box(other(page))).height).toBeGreaterThan(500);
  await expect(minimize(codex)).toHaveCount(0); // nothing whole left under or over Codex's to take it: not offered
  await page.locator("#main > .chat.mini .mini-hist .mh-row, #main > .chat.mini button.mini-me").first().click();
  await expect(mini).toHaveCount(0);
  await expect(minimize(codex)).toHaveCount(1); // offered again
});
