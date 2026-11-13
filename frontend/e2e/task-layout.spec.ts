// A task opened again is laid out as it was left (07-panes.js's rememberTask, enterTask): the chat minimized under its apps
// or not, the view each of its actors' panes showed, and how wide each pane was.
import { expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { addNotepad, taskHome, taskRow } from "./task-home";

test("a task opened again has its chat minimized under its apps as it was left, or not", async ({ page }) => {
  await taskHome(page, false); // each actor a task of its own
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  const codex = page.locator("#agents button.agent", { hasText: CODEX });
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  const mini = page.locator("#main > .chat.mini");
  await claude.click();
  await addNotepad(page, claude); // Claude and Notepad: one task
  await expect(notes).toHaveCount(1);
  await page.locator("button[aria-label='Minimize the chat']:visible").first().click();
  await expect(mini).toHaveCount(1); // only its message box, under Notepad
  await codex.click(); // another task, with no app: its chat whole
  await expect(notes).toHaveCount(0);
  await expect(mini).toHaveCount(0);
  await claude.click(); // back: as it was left, its chat minimized under Notepad
  await expect(notes).toHaveCount(1);
  await expect(mini).toHaveCount(1);
  await page.locator("#main .mini-back").click(); // its chat shown again
  await expect(mini).toHaveCount(0);
  await codex.click();
  await claude.click(); // back: as it was left, its chat whole
  await expect(notes).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(mini).toHaveCount(0);
});

test("a task opened again shows each of its actors in the view it showed, as wide as it was", async ({ page }) => {
  const lone = await page.request.post("/api/apps/open", {
    data: { app: "notepad", gatherer: GATHERER, folder: "/w/lone" },
  });
  expect(lone.ok()).toBe(true); // an app in no task: a task of its own, to go to and come back from
  await taskHome(page, true); // Claude and Codex: one task
  await open(page);
  const row = taskRow(page);
  const panes = page.locator("#panes > .pane");
  const pressed = (n: number) =>
    (n ? panes.nth(n).frameLocator("iframe") : page).locator("#controls .views button[aria-pressed=true]");
  await page.locator("#agents").hover({ position: { x: 5, y: 5 } });
  await row.click(); // at first: both, side by side, as wide
  await expect(panes).toHaveCount(2);
  await panes.nth(1).frameLocator("iframe").locator("#controls").getByRole("button", { name: "Terminal" }).click();
  await expect(pressed(1)).toHaveAttribute("aria-label", "Terminal");
  await expect(pressed(0)).toHaveAttribute("aria-label", "Chat");
  const bar = (await page.locator(".lay-bar[data-dir=row]").boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2 - 120, bar.y + bar.height / 2, { steps: 5 });
  await page.mouse.up(); // the first narrower
  const width = async (n: number) => Math.round((await panes.nth(n).boundingBox())!.width);
  const was = [await width(0), await width(1)];
  expect(was[1] - was[0]).toBeGreaterThan(150);
  await page.locator("#agents button.agent.app-row").click(); // the lone app's task: the actors' panes closed
  await expect(page.locator(".work.apps-only")).toHaveCount(1);
  await row.click(); // back: as it was left
  await expect(panes).toHaveCount(2);
  await expect(pressed(1)).toHaveAttribute("aria-label", "Terminal");
  await expect(pressed(0)).toHaveAttribute("aria-label", "Chat");
  await expect.poll(async () => Math.abs((await width(0)) - was[0])).toBeLessThan(3);
  await expect.poll(async () => Math.abs((await width(1)) - was[1])).toBeLessThan(3);
});

test("an actor of a task opened again shows the view it showed when the task was left", async ({ page }) => {
  await taskHome(page, false);
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  const codex = page.locator("#agents button.agent", { hasText: CODEX });
  const pressed = page.locator("#controls .views button[aria-pressed=true]");
  await claude.click();
  await page.locator("#controls").getByRole("button", { name: "Terminal" }).click();
  await expect(pressed).toHaveAttribute("aria-label", "Terminal");
  await codex.click(); // another task: in the view shown, never left before
  await expect(page.locator("#agents button.agent[aria-current=true]", { hasText: CODEX })).toHaveCount(1);
  await page.locator("#controls").getByRole("button", { name: "Chat" }).click();
  await expect(pressed).toHaveAttribute("aria-label", "Chat");
  await claude.click(); // back: its Terminal, as it was left
  await expect(pressed).toHaveAttribute("aria-label", "Terminal");
  await codex.click(); // and Codex's Chat
  await expect(pressed).toHaveAttribute("aria-label", "Chat");
});

test("a task opened again has its apps' row as tall as it was left", async ({ page }) => {
  const home = await (await page.request.get("/api/home")).json();
  const agents: { harness: string; channel: string }[] = home.gatherers.find(
    (x: { name: string }) => x.name === GATHERER,
  ).agents;
  const channel = agents.find((a) => a.harness === "codex")!.channel;
  const opened = await page.request.post("/api/apps/open", {
    data: { app: "notepad", gatherer: GATHERER, folder: "/w/codex", channel },
  });
  expect(opened.ok()).toBe(true); // Codex's task: a Notepad of its own (another folder's) above
  await taskHome(page, false);
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  const codex = page.locator("#agents button.agent", { hasText: CODEX });
  const row = page.locator("#top-row");
  // the row's height, the band under it included: from its panel's top to the panes' below (0: not shown)
  const tall = async () => {
    const [above, below] = [
      await row.locator("> .app-pane").first().boundingBox(),
      await page.locator("#pane-here").boundingBox(),
    ];
    return above && below ? Math.round(below.y - above.y) : 0;
  };
  // dragged down, over this page's own pane
  const drag = async (to: number) => {
    const grip = (await page.locator(".lay-bar.thick").boundingBox())!;
    const top = (await row.locator("> .app-pane").first().boundingBox())!.y;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, top + to, { steps: 5 });
    await page.mouse.up();
  };
  await claude.click();
  await addNotepad(page, claude); // Claude's task: Notepad above
  await expect(row.locator("> .app-pane")).toHaveCount(1);
  await expect.poll(tall).toBe(450); // no row dragged yet: half the column
  await drag(520);
  await expect.poll(tall).toBeGreaterThan(505);
  const claudes = await tall();
  await codex.click();
  await expect(row.locator("> .app-pane")).toHaveCount(1);
  await expect.poll(tall).toBe(claudes); // never dragged in it: as tall as the row dragged last
  await drag(650);
  await expect.poll(tall).toBeGreaterThan(635);
  const codexes = await tall();
  await claude.click(); // back: Claude's row as it was left
  await expect.poll(tall).toBe(claudes);
  await codex.click(); // and Codex's
  await expect.poll(tall).toBe(codexes);
  await page.reload(); // kept in this browser: each as it was
  await claude.click();
  await expect.poll(tall).toBe(claudes);
  await codex.click();
  await expect.poll(tall).toBe(codexes);
});
