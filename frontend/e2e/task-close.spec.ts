// A TASK SAVED AND CLOSED (05-agent-list.js's taskSaveButton, taskCloseButton): its bookmark saves every actor in it; its
// × closes them and puts its apps to sleep (kept, in the task: app_host.py's `sleep_instance`), opened again as it was --
// from its row in the list, or its tile in the folded rail; in its card, each actor's and each app's own close (an app's
// closing it for good: closeApp), and "take out" a mark of its own. An app on its own: closed from its card or its tile.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { GATHERER, open } from "./home";
import { addNotepad, cardOf, taskHome, taskRow } from "./task-home";

const notepad = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
// the apps open in the test gatherer, as the server has them
const instances = async (page: Page) =>
  ((await (await page.request.get(`/api/apps?gatherer=${GATHERER}`)).json()).instances as unknown[]).length;

// the requests closing a task makes, answered here: each actor's process closed (/api/stop), each app put to sleep
async function closings(page: Page) {
  const asked: string[] = [];
  await page.route("**/api/stop", async (route) => {
    asked.push(`stop ${route.request().postDataJSON().session_id}`);
    await route.fulfill({ json: {} });
  });
  await page.route("**/api/apps/sleep", async (route) => {
    asked.push("sleep");
    await route.continue();
  });
  return asked;
}

test("a task's bookmark saves every actor in it; its × closes them and puts its apps to sleep, their panels closed", async ({
  page,
}) => {
  await taskHome(page, true, true);
  const asked = await closings(page);
  await open(page);
  const row = taskRow(page);
  await addNotepad(page, row);
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(1);
  const home = await (await page.request.get("/api/home")).json();
  const channels: string[] = Object.keys(home.tasks[GATHERER].tasked).filter((k) => !k.startsWith("app:"));
  expect(channels).toHaveLength(2);
  try {
    await page.mouse.move(0, 0);
    await row.hover();
    const save = row.locator(".a-acts .save-btn");
    await save.click(); // every actor in it saved
    await expect(save).toHaveClass(/\bon\b/);
    await expect
      .poll(async () =>
        Object.keys((await (await page.request.get("/api/home")).json()).saved?.[GATHERER] || {}).sort(),
      )
      .toEqual([...channels].sort());
    await row.locator(".a-acts .close-btn").click(); // closed: its actors' processes, its app asleep, its panel gone
    await expect.poll(() => [...asked].sort()).toEqual(["sleep", ...channels.map((c) => `stop ${c}`)].sort());
    await expect(notes).toHaveCount(0);
    await page.mouse.move(0, 0);
    await row.click(); // opened again: as it was left, its app's panel back
    await expect(notes).toHaveCount(1);
  } finally {
    for (const channel of channels)
      await page.request.post("/api/saved", { data: { gatherer: GATHERER, channel, saved: false } });
  }
});

test("in a task's card each actor has its own bookmark and close, and a mark of its own to take it out", async ({
  page,
}) => {
  await taskHome(page, true, true);
  const asked = await closings(page);
  await open(page);
  const card = await cardOf(page, taskRow(page));
  const actors = card.locator(".c-task-row:not(.c-app-row)");
  await expect(actors).toHaveCount(2);
  for (const r of await actors.all()) {
    await expect(r.locator(".save-btn")).toHaveCount(1);
    await expect(r.locator(".close-btn")).toHaveCount(1);
    await expect(r.locator(".take-out circle")).toHaveCount(0); // not a close's circled ×
  }
  const first = actors.first(),
    channel = await first.locator(".nm").textContent();
  await first.locator(".close-btn").click(); // that actor alone closed
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatch(/^stop /);
  expect(channel).toBeTruthy();
});

test("in the folded rail, a task's tile has its row's bookmark and ×, left of its faces", async ({ page }) => {
  await taskHome(page, true, true);
  const asked = await closings(page);
  await open(page);
  await addNotepad(page, taskRow(page));
  await expect(notepad(page)).toHaveCount(1);
  const home = await (await page.request.get("/api/home")).json();
  const channels: string[] = Object.keys(home.tasks[GATHERER].tasked).filter((k) => !k.startsWith("app:"));
  await page.locator("#agents .lb-fold").click();
  const tile = page.locator("#rail .r-task");
  await expect(tile).toHaveCount(1);
  try {
    await page.mouse.move(0, 0);
    await tile.hover();
    const save = tile.locator(".save-btn"),
      close = tile.locator(".close-btn");
    await expect(save).toHaveCSS("opacity", "1");
    await expect(close).toHaveCSS("opacity", "1");
    const [faces, s, c] = [
      await tile.locator(".r-group").boundingBox(),
      await save.boundingBox(),
      await close.boundingBox(),
    ];
    expect(s!.x + s!.width).toBeLessThanOrEqual(faces!.x); // left of its faces, the bookmark over the ×
    expect(c!.x + c!.width).toBeLessThanOrEqual(faces!.x);
    expect(s!.y).toBeLessThan(c!.y);
    await save.click(); // every actor in it saved
    await expect(save).toHaveClass(/\bon\b/);
    await expect
      .poll(async () =>
        Object.keys((await (await page.request.get("/api/home")).json()).saved?.[GATHERER] || {}).sort(),
      )
      .toEqual([...channels].sort());
    await close.click(); // closed: its actors' processes, its app asleep, its panel gone
    await expect.poll(() => [...asked].sort()).toEqual(["sleep", ...channels.map((c) => `stop ${c}`)].sort());
    await expect(notepad(page)).toHaveCount(0);
    expect(await instances(page)).toBe(1); // asleep, not closed: still in the task
  } finally {
    for (const channel of channels)
      await page.request.post("/api/saved", { data: { gatherer: GATHERER, channel, saved: false } });
  }
});

test("in a task's card an app has its own close: the app closed for good, out of the task and its card", async ({
  page,
}) => {
  await taskHome(page, true);
  await open(page);
  const row = taskRow(page);
  await addNotepad(page, row);
  await expect(notepad(page)).toHaveCount(1);
  const card = await cardOf(page, row);
  const app = card.locator(".c-app-row", { hasText: "Notepad" });
  await expect(app.locator(".close-btn")).toHaveCount(1);
  await expect(app.locator(".take-out")).toHaveCount(1); // taking it out still there, a mark of its own
  await app.locator(".close-btn").click();
  await expect(notepad(page)).toHaveCount(0);
  await expect.poll(() => instances(page)).toBe(0);
  await expect(card.locator(".c-app-row")).toHaveCount(0);
  await expect(page.locator("#agents button.agent.app-row")).toHaveCount(0); // closed: not a row of its own either
  await expect(row.locator(".t-faces .t-app")).toHaveCount(0);
});

test("an app on its own is closed from its card's × or its tile's × in the folded rail", async ({ page }) => {
  await taskHome(page, false);
  await open(page);
  const notepadAlone = async () => {
    const gatherer = page.locator("#agents .gatherer-row").first(); // a Notepad with no agent: a row of its own
    await gatherer.hover();
    await gatherer.locator("button.new-more").click();
    await page.locator(".row-menu[role=menu]").getByText("Notepad", { exact: true }).click();
    await expect(notepad(page)).toHaveCount(1);
  };
  await notepadAlone();
  const row = page.locator("#agents button.agent.app-row");
  await expect(row).toHaveCount(1);
  await (await cardOf(page, row)).locator(".c-acts .act.close").click();
  await expect(row).toHaveCount(0);
  await expect(notepad(page)).toHaveCount(0);
  await expect.poll(() => instances(page)).toBe(0);

  await notepadAlone();
  await page.mouse.move(0, 0);
  await page.locator("#agents .lb-fold").click();
  const tile = page.locator("#rail .r-app");
  await expect(tile).toHaveCount(1);
  await tile.hover();
  const close = tile.locator(".close-btn");
  await expect(close).toHaveCSS("opacity", "1");
  await close.click();
  await expect(tile).toHaveCount(0);
  await expect(notepad(page)).toHaveCount(0);
  await expect.poll(() => instances(page)).toBe(0);
});
