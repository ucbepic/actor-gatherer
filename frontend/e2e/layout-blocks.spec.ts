// The tasks shown, moved (features/layout/blocks.ts): each task a block of its panels, a task of two panels or more under
// a strip with its name while other tasks are shown. A strip dragged onto a side of another task puts the task there
// (side by side, or one over the other), onto its middle swaps the two -- the head of a task's only panel does as its
// strip would -- or from its menu; a task's row dragged from the list onto the work area opens it on that side. Kept in
// this browser.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, open, settledBox } from "./home";
import { addNotepad } from "./task-home";

const beside = process.platform === "darwin" ? "Meta" : "Control";
const box = async (l: Locator) => (await l.boundingBox())!;
type Box = { x: number; y: number; width: number; height: number };
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
const middle = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// Claude and a Notepad, one task (two panels: under a strip), and Codex beside it (⌘+click: a task of one pane)
async function twoTasks(page: Page) {
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(1);
  await page.locator("#agents button.agent", { hasText: CODEX }).click({ modifiers: [beside] });
  const codex = page.locator("#panes > .pane").nth(1);
  await expect(codex).toHaveCount(1);
  return { notes, codex, here: page.locator("#pane-here"), strip: page.locator(".lay-strip:visible") };
}

test("with other tasks shown, a task of two panels or more is under a strip with its name; one of one panel, none", async ({
  page,
}) => {
  const { notes, here, strip } = await twoTasks(page);
  await expect(strip).toHaveCount(1); // Claude's task's; Codex's pane its own head
  await expect(strip.locator(".lay-sname")).toHaveText(CLAUDE);
  await expect(strip.locator(".lay-sabout")).toHaveText("1 actor · Notepad");
  const [s, n, h] = [await box(strip), await box(notes), await box(here)];
  expect(s.y + s.height).toBeLessThanOrEqual(n.y + 1); // over both its panels, as wide
  expect(s.width).toBeCloseTo(n.width, 0);
  expect(h.x).toBeCloseTo(s.x, 0);
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click({ modifiers: ["Alt"] }); // Claude's task alone: no strip
  await expect(strip).toHaveCount(0);
});

test("a task's card head's × closes the task here, its agents going on; the last one closed, the tab says it is empty", async ({
  page,
}) => {
  const { notes, codex, strip } = await twoTasks(page);
  await strip.locator(".lay-sclose").click(); // Claude's task: its Notepad and its pane closed, Codex left
  await expect(notes).toHaveCount(0);
  await expect(codex).toHaveCount(0); // (Codex now in this page's own pane)
  await expect(page.locator("#agents button.agent", { hasText: CODEX })).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#agents button.agent", { hasText: CLAUDE }).locator(".tab-no")).toHaveCount(0); // open nowhere
  await expect(page.locator("#agents button.agent", { hasText: CLAUDE })).toHaveCount(1); // still listed, as it was
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click({ modifiers: [beside] }); // beside again
  await expect(notes).toHaveCount(1); // as it was left: its Notepad back
  await strip.locator(".lay-sclose").click();
  await expect(notes).toHaveCount(0);
  await expect(page.locator(".lay-empty")).toBeHidden(); // Codex still shown
});

test("a task's strip dragged onto the bottom of another task: the two one over the other, kept so", async ({
  page,
}) => {
  const { codex, strip } = await twoTasks(page);
  const c = await box(codex);
  await drag(page, middle(await box(strip)), { x: c.x + c.width / 2, y: c.y + c.height * 0.9 });
  const under = async () => {
    const [s, o] = [await box(strip), await box(codex)];
    return s.y >= o.y + o.height - 1 && Math.abs(s.x - o.x) < 1; // Claude's task under Codex's, as wide
  };
  await expect.poll(under).toBe(true);
  await page.reload(); // kept in this browser
  await expect(page.locator("#top-row > .app-pane[data-app=notepad]")).toHaveCount(1);
  await expect.poll(under).toBe(true);
});

test("a task of one panel moved by its head's menu: in the other task's place", async ({ page }) => {
  const { codex, strip } = await twoTasks(page);
  expect((await box(codex)).x).toBeGreaterThan((await box(strip)).x); // Codex at the right
  const grip = await box(codex.frameLocator("iframe").locator(".fl-grip")); // its head, in its Chat bar (an app shown)
  await page.mouse.click(grip.x + grip.width / 2, grip.y + grip.height / 2, { button: "right" });
  const menu = page.locator(".row-menu[role=menu][aria-label='Move this task']");
  await expect(menu.getByRole("menuitem").nth(-2)).toHaveText(`⇄Swap with ${CLAUDE}`);
  await expect(menu.getByRole("menuitem").last()).toHaveText("+To a new tab"); // (layout-tabs.spec.ts)
  await menu.getByRole("menuitem", { name: `Swap with ${CLAUDE}` }).click();
  await expect.poll(async () => (await box(codex)).x < (await box(strip)).x).toBe(true); // Codex at the left now
});

test("a task's row dragged from the list onto the top of the work area: opened there, over the task shown", async ({
  page,
}) => {
  await open(page);
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  const here = page.locator("#pane-here");
  const h = await box(here);
  const codexRow = page.locator("#agents button.agent", { hasText: CODEX });
  await expect(codexRow).toBeVisible(); // (the list drawn again as Claude is shown)
  const row = await settledBox(codexRow);
  await drag(page, middle(row), { x: h.x + h.width / 2, y: h.y + h.height * 0.1 });
  const codex = page.locator("#panes > .pane").nth(1);
  await expect(codex).toHaveCount(1);
  await expect
    .poll(async () => {
      const [a, o] = [await box(here), await box(codex)];
      return o.y + o.height <= a.y + 1 && Math.abs(a.x - o.x) < 1 && Math.abs(a.width - o.width) < 1; // above, as wide
    })
    .toBe(true);
});
