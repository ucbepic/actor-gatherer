// A task's panels moved (features/layout/): a pane or an app's panel dragged by its head (a pane's head put in its Chat
// bar: its grip) onto a side of another panel of its task -- the two then side by side, or one over the other -- or onto
// its middle, the two swapped; or moved from its head's menu. Each task's arrangement kept in this browser: as it was when
// the task is opened again, or the page loaded again. Each task shown a block of its own, its panels together.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, open } from "./home";
import { addNotepad, taskHome } from "./task-home";

const beside = process.platform === "darwin" ? "Meta" : "Control";
const box = async (l: Locator) => (await l.boundingBox())!;
// a drag from `from` (a point of it) to a point of `to` -- its left quarter, its middle -- moved in steps, so the page
// sees the drag go over it
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
const middle = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});
const leftOf = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width * 0.1,
  y: b.y + b.height / 2,
});

// Claude and a Notepad, one task: Notepad above Claude's pane -- its head put in its Chat bar (the page's stream live, its
// turns shown), the grip there
async function claudeAndNotepad(page: Page) {
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(1);
  return { claude, notes, here: page.locator("#pane-here") };
}

test("a pane dragged by its grip onto the left of its task's app: the two side by side, kept so", async ({ page }) => {
  const { claude, notes, here } = await claudeAndNotepad(page);
  const n = await box(notes);
  expect((await box(here)).y).toBeGreaterThan(n.y + n.height - 1); // at first: under it
  await drag(page, middle(await box(here.locator(".fl-grip"))), leftOf(n));
  const sideBySide = async () => {
    const [h, a] = [await box(here), await box(notes)];
    return h.x + h.width <= a.x + 1 && Math.abs(h.y - a.y) < 1 && Math.abs(h.height - a.height) < 1;
  };
  await expect.poll(sideBySide).toBe(true);
  await page.locator("#agents button.agent", { hasText: CODEX }).click(); // another task, then back: as it was left
  await expect(notes).toHaveCount(0);
  await claude.click();
  await expect(notes).toHaveCount(1);
  await expect.poll(sideBySide).toBe(true);
  await page.reload(); // kept in this browser
  await claude.click();
  await expect(notes).toHaveCount(1);
  await expect.poll(sideBySide).toBe(true);
});

test("a panel dropped on another's middle takes its place, and the other its own", async ({ page }) => {
  const { notes, here } = await claudeAndNotepad(page);
  await drag(page, { x: (await box(notes)).x + 40, y: (await box(notes)).y + 12 }, middle(await box(here))); // its head
  await expect.poll(async () => (await box(here)).y < (await box(notes)).y).toBe(true); // the chat above, Notepad under it
});

test("a panel moved from its head's menu: along a side of its task, or in another's place", async ({ page }) => {
  const { notes, here } = await claudeAndNotepad(page);
  const n = await box(notes);
  await page.mouse.click(n.x + 40, n.y + 12, { button: "right" }); // Notepad's head
  const menu = page.locator(".row-menu[role=menu][aria-label='Move this panel']");
  await expect(menu.getByRole("menuitem")).toHaveText([
    /To the left/,
    /To the right/,
    /To the top/,
    /To the bottom/,
    /^⇄Swap with Parser fixes/,
  ]);
  await menu.getByRole("menuitem", { name: "To the right" }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(async () => (await box(notes)).x > (await box(here)).x).toBe(true);
  expect(Math.abs((await box(notes)).y - (await box(here)).y)).toBeLessThan(1);
  await page.locator("#pane-here .fl-grip").click({ button: "right" }); // the chat's grip: the same menu
  await menu.getByRole("menuitem", { name: /Swap with Notepad/ }).click();
  await expect.poll(async () => (await box(notes)).x < (await box(here)).x).toBe(true);
});

test("a pane's head dragged in its frame: the pane moved over the page around it", async ({ page }) => {
  await taskHome(page, true); // the two actors one task: side by side
  await open(page);
  await page.locator("#agents button.agent.task").click();
  const panes = page.locator("#panes > .pane");
  await expect(panes).toHaveCount(2);
  const other = panes.nth(1);
  const head = await box(other.frameLocator("iframe").locator("#pane-who"));
  const here = await box(page.locator("#pane-here"));
  await drag(page, { x: head.x + 30, y: head.y + head.height / 2 }, { x: here.x + here.width / 2, y: here.y + 40 }); // its top
  await expect
    .poll(async () => {
      const [a, b] = [await box(page.locator("#pane-here")), await box(other)];
      return b.y + b.height <= a.y + 1 && Math.abs(a.x - b.x) < 1; // the frame's pane above, as wide
    })
    .toBe(true);
});

test("a task opened beside another is a block of its own: its panels together, none of its dropped into the other's", async ({
  page,
}) => {
  const { notes, here } = await claudeAndNotepad(page);
  await page.locator("#agents button.agent", { hasText: CODEX }).click({ modifiers: [beside] });
  const other = page.locator("#panes > .pane").nth(1);
  await expect(other).toHaveCount(1);
  const [n, h, o] = [await box(notes), await box(here), await box(other)];
  expect(o.x).toBeGreaterThanOrEqual(Math.max(n.x + n.width, h.x + h.width) - 1); // right of Claude's whole task
  expect(o.y).toBe(n.y); // the whole height
  expect(o.height).toBeCloseTo(h.y + h.height - n.y, 0);
  // Codex's grip right-clicked (its head in its Chat bar, an app shown): no other panel of its task shown, nowhere to go
  const grip = await box(other.frameLocator("iframe").locator(".fl-grip"));
  await page.mouse.click(grip.x + grip.width / 2, grip.y + grip.height / 2, { button: "right" });
  await expect(page.locator(".row-menu[aria-label='Move this panel']")).toHaveCount(0);
});

test("a task's arrangement, the first time it shows, is made from the widths an older page kept for it", async ({
  page,
}) => {
  await taskHome(page, true);
  const home = await (await page.request.get("/api/home")).json();
  const t = home.tasks.demo,
    id = t.tasked[Object.keys(t.tasked)[0]];
  const [a, b] = Object.keys(t.tasked);
  await page.addInitScript(
    ([key, a, b]) => {
      if (localStorage.getItem("ag-dashboard-task-trees")) return;
      const old = {
        actors: [a, b],
        focus: a,
        apps: [],
        views: {},
        sizes: { [a]: 0.5, [b]: 1.5 },
        min: false,
        topH: null,
        at: 1,
      };
      localStorage.setItem("ag-dashboard-task-layouts-2", JSON.stringify({ [key]: old }));
    },
    [`demo\u0000t${id}`, a, b],
  );
  await open(page);
  await page.locator("#agents button.agent.task").click();
  const panes = page.locator("#panes > .pane");
  await expect(panes).toHaveCount(2);
  const ratio = async () => {
    const [x, y] = [(await box(panes.nth(0))).width, (await box(panes.nth(1))).width];
    return Math.round(Math.max(x, y) / Math.min(x, y)); // one three times as wide as the other
  };
  await expect.poll(ratio).toBe(3);
});

test("the apps' panels kept in this browser all come back, the page loaded again before its home has come", async ({
  page,
}) => {
  await taskHome(page, false);
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(1);
  // the home held back: the apps known first, their panels opened again before any task is
  await page.route("**/api/home", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.reload();
  await expect(notes).toHaveCount(1);
  await expect(page.locator("#agents")).toContainText(CLAUDE);
  await expect(notes.frameLocator("iframe").locator("body[data-ready='1']")).toHaveCount(1);
});
