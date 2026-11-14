// Notifications (07-notices.js; app_kit's notices.py): an app's to the user -- a status of its own in the list (its
// row's dot, a task's, the counts), listed in its card, popped up in the page's corner -- seen once its panel is shown,
// dismissed from its card, cleared by the app; and an actor that comes to wait for the reader, or stops on an error,
// popped up the same way, unless it is in front of them or they turned actors' pop-ups off. The app is Notepad
// (tests/apps/notepad/, `notify`), sent its notifications through the route its panel's SDK calls.
import type { Locator, Page } from "@playwright/test";
import { expect, homeAs, test } from "./test";
import { CLAUDE, CODEX, GATHERER, openActor } from "./home";

const CODEX_CHANNEL = "019a1f2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b";

async function openNotepad(page: Page): Promise<{ pane: Locator; instance: string }> {
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover();
  await row.locator("button.new-more").click();
  await page.locator(".row-menu[role=menu]").getByText("Notepad", { exact: true }).click();
  const pane = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(pane.frameLocator("iframe").locator("body[data-ready='1']")).toHaveCount(1);
  const src = (await pane.locator("iframe").getAttribute("src")) || "";
  return { pane, instance: new URL(src).searchParams.get("instance") || "" };
}

/** A notification of Notepad's instance, as its panel or its backend sends one. */
async function notify(page: Page, instance: string, n: Record<string, unknown>) {
  const r = await page.request.post("/api/apps/notify", {
    data: { app: "notepad", gatherer: GATHERER, instance, ...n },
  });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { id: string }).id;
}

/** Its open notifications' titles, as the server's home has them. */
async function openOnServer(page: Page, instance: string): Promise<string[]> {
  type Home = { gatherers: { name: string; apps?: Record<string, { notices: { title: string }[] }> }[] };
  const home = (await (await page.request.get("/api/home")).json()) as Home;
  const g = home.gatherers.find((x) => x.name === GATHERER);
  return ((g && g.apps && g.apps[instance]) || { notices: [] }).notices.map((n) => n.title);
}

test("an app's notification: its row's status, counted, popped up, in its card; its panel shown, seen", async ({
  page,
}) => {
  await openActor(page, CLAUDE);
  const { pane, instance } = await openNotepad(page);
  await pane.locator(".app-close").click(); // its panel closed: the app still open, a row of its own
  const row = page.locator(`#agents button.agent.app-row[data-key="${GATHERER}/app:${instance}"]`);
  await expect(row.locator(":scope > .dot-none")).toHaveCount(1);
  await notify(page, instance, { title: "Build failed", text: "3 tests failed", where: { run: 7 } });
  await expect(row.locator(":scope > .dot.notified")).toHaveCount(1);
  await expect(page.locator("#agents .gatherer-row .count.notified")).toHaveText("1");
  const pop = page.locator("#pops .pop.notified");
  await expect(pop).toHaveCount(1);
  await expect(pop).toContainText("Build failed");
  await expect(pop).toContainText("3 tests failed");
  await expect(pop).toContainText("Notepad");
  await row.hover(); // its card: the notification, not yet seen
  await expect(page.locator("#actor-card .c-notice.new")).toContainText("Build failed");
  await page.mouse.move(900, 600);
  // the pop-up clicked: the app's panel shown, handed where the notification said -- and so seen
  await pop.locator(".pop-open").click();
  await expect(pop).toHaveCount(0);
  const panel = page.locator("#top-row > .app-pane[data-app=notepad]").frameLocator("iframe");
  await expect(panel.locator("#intent")).toHaveText('notice {"run":7}');
  await expect(row.locator(":scope > .dot.notified")).toHaveCount(0);
  await expect(page.locator("#agents .gatherer-row .count.notified")).toHaveCount(0);
  expect(await openOnServer(page, instance)).toEqual(["Build failed"]); // seen is the reader's: still open on the server
  // one sent while its panel is in front: seen at once, nothing popped up
  await notify(page, instance, { title: "While you look" });
  await expect.poll(() => openOnServer(page, instance)).toContain("While you look");
  await page.waitForTimeout(400);
  await expect(page.locator("#pops .pop")).toHaveCount(0);
  await expect(row.locator(":scope > .dot.notified")).toHaveCount(0);
});

test("an app's quiet notification (show []): listed, counted and in its card, never popped up", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { pane, instance } = await openNotepad(page);
  await pane.locator(".app-close").click();
  const row = page.locator(`#agents button.agent.app-row[data-key="${GATHERER}/app:${instance}"]`);
  await notify(page, instance, { title: "3 new messages in #design", text: "Leo: done", show: [] });
  await expect(row.locator(":scope > .dot.notified")).toHaveCount(1);
  await expect(page.locator("#agents .gatherer-row .count.notified")).toHaveText("1");
  await page.waitForTimeout(400);
  await expect(page.locator("#pops .pop")).toHaveCount(0);
  await row.hover();
  await expect(page.locator("#actor-card .c-notice.new")).toContainText("3 new messages in #design");
  // one that asks for the pop-up, after it: popped up
  await page.mouse.move(900, 600);
  await notify(page, instance, { title: "Maya Chen, direct message", show: ["ag"] });
  await expect(page.locator("#pops .pop.notified")).toContainText("Maya Chen, direct message");
});

test("an app's backend notifies, its panel closed meanwhile; clicked on, the panel is handed where", async ({
  page,
}) => {
  await openActor(page, CLAUDE);
  const { pane, instance } = await openNotepad(page);
  const frame = page.frames().find((f) => /^http:\/\/notepad\.localhost:\d+\//.test(f.url()))!;
  await frame.evaluate(() => {
    const ag = (window as unknown as { notes: { api: (p: string, i: RequestInit) => Promise<Response> } }).notes;
    return ag.api("remind?after=0.5&text=water%20the%20plants", { method: "POST" }).then((r) => r.status);
  });
  await pane.locator(".app-close").click();
  const row = page.locator(`#agents button.agent.app-row[data-key="${GATHERER}/app:${instance}"]`);
  await expect(row.locator(":scope > .dot.notified")).toHaveCount(1);
  const pop = page.locator("#pops .pop.notified");
  await expect(pop).toContainText("A reminder from your notepad");
  await expect(pop).toContainText("water the plants");
  await pop.locator(".pop-open").click();
  const panel = page.locator("#top-row > .app-pane[data-app=notepad]").frameLocator("iframe");
  await expect(panel.locator("#intent")).toHaveText('notice {"note":"water the plants"}');
});

test("in the folded rail: its tile's corner, the rail's totals", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { pane, instance } = await openNotepad(page);
  await pane.locator(".app-close").click();
  await notify(page, instance, { title: "Seen in the rail" });
  await expect(page.locator("#agents .gatherer-row .count.notified")).toHaveText("1");
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  await expect(rail.locator(".r-app .rd.notified")).toHaveCount(1);
  await expect(rail.locator(".r-totals .count.notified")).toHaveText("1");
  await rail.locator(".r-app").hover(); // its card, from the rail too
  await expect(page.locator("#actor-card .c-notice")).toContainText("Seen in the rail");
});

test("dismissed from its card, cleared by its app, its key's newer one in its place", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { pane, instance } = await openNotepad(page);
  await pane.locator(".app-close").click();
  const row = page.locator(`#agents button.agent.app-row[data-key="${GATHERER}/app:${instance}"]`);
  await notify(page, instance, { title: "Old build", key: "build" });
  await notify(page, instance, { title: "New build", key: "build" }); // the same key: in the first one's place
  await notify(page, instance, { title: "Dismiss me" });
  await expect(row.locator(":scope > .dot.notified")).toHaveCount(1);
  await row.hover();
  const card = page.locator("#actor-card");
  await expect(card.locator(".c-notice")).toHaveCount(2);
  await expect(card.locator(".c-notice").first()).toContainText("Dismiss me"); // the newest first
  await card.locator(".c-notice", { hasText: "Dismiss me" }).locator(".take-out").click();
  await expect(card.locator(".c-notice")).toHaveCount(1);
  await expect.poll(() => openOnServer(page, instance)).toEqual(["New build"]);
  // cleared by the app, by its key (its panel's ag.notices.clear, its backend's Host.clear_notice)
  const r = await page.request.post("/api/apps/notices/settle", {
    data: { app: "notepad", gatherer: GATHERER, instance, which: "build", by: "app" },
  });
  expect(r.status()).toBe(200);
  await expect.poll(() => openOnServer(page, instance)).toEqual([]);
  await expect(row.locator(":scope > .dot.notified")).toHaveCount(0);
  await expect(card.locator(".c-st")).toHaveText("No notifications");
});

test("a task shows its app's notification as its state, where it ranks first", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { pane, instance } = await openNotepad(page);
  await pane.locator(".app-agents").click(); // the actor attached: the two one task
  await pane.locator(".app-menu-item", { hasText: CLAUDE }).click();
  const task = page.locator("#agents button.agent.task");
  await expect(task).toHaveCount(1);
  await page.locator("#agents button.agent", { hasText: CODEX }).click(); // another task shown: its panel put away
  await expect(page.locator("#top-row > .app-pane[data-app=notepad]")).toHaveCount(0);
  await expect(task.locator(":scope > .dot.notified")).toHaveCount(0);
  await notify(page, instance, { title: "Your turn" });
  await expect(task.locator(":scope > .dot.notified")).toHaveCount(1);
  await expect(page.locator("#pops .pop.notified")).toContainText("Your turn");
  await task.hover(); // its card: its app's notifications
  await expect(page.locator("#actor-card .c-notice")).toContainText("Your turn");
});

test("an actor that comes to wait for you, or stops on an error, pops up -- unless in front of you, or turned off", async ({
  page,
}) => {
  let codex: Record<string, unknown> = {};
  const homes = await homeAs(page, (home) => {
    for (const g of home.gatherers as { agents: { channel: string }[] }[])
      for (const a of g.agents) if (a.channel === CODEX_CHANNEL) Object.assign(a, codex);
    return home;
  });
  await openActor(page, CLAUDE);
  const ask = { kind: "question", call: "call-1", at: 1, questions: [{ question: "Which fruit do you prefer?" }] };
  codex = { status: "asking", asking: ask };
  homes.again();
  const pop = page.locator("#pops .pop.asking");
  await expect(pop).toContainText(`Waiting for you: ${CODEX}`);
  await expect(pop).toContainText("Which fruit do you prefer?");
  homes.again(); // the same question again: not popped up again
  await page.waitForTimeout(300);
  await expect(page.locator("#pops .pop")).toHaveCount(1);
  await pop.locator(".pop-open").click(); // shows the actor
  await expect(page.locator("#agents button.agent[aria-current=true]")).toContainText(CODEX);
  // now in front of the reader: its error is not popped up
  codex = { status: "error", stopped: { kind: "error", at: 2, text: "Overloaded" } };
  homes.again();
  await page.waitForTimeout(400);
  await expect(page.locator("#pops .pop.error")).toHaveCount(0);
  // another shown, and actors' pop-ups turned off: nothing more
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  await page.locator("#about-btn").click();
  await page.locator('[data-heed="actors:off"]').click();
  await expect(page.locator('[data-heed="actors:off"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#about-btn").click();
  codex = { status: "error", stopped: { kind: "error", at: 3, text: "Overloaded again" } };
  homes.again();
  await page.waitForTimeout(400);
  await expect(page.locator("#pops .pop")).toHaveCount(0);
  // turned on again: the next one pops up
  await page.locator("#about-btn").click();
  await page.locator('[data-heed="actors:on"]').click();
  await page.locator("#about-btn").click();
  codex = { status: "error", stopped: { kind: "error", at: 4, text: "Overloaded once more" } };
  homes.again();
  await expect(page.locator("#pops .pop.error")).toContainText(`Stopped on an error: ${CODEX}`);
  await expect(page.locator("#pops .pop.error")).toContainText("Overloaded once more");
});
