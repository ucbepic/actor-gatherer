// Apps (app_kit/DESIGN.md): an app's pane beside the actors' -- its panel in a frame on the app's own origin, talking to
// the page through app_kit's SDK (app_kit/js/app.js). The test app is Notes (tests/apps/notes/), which the test home
// finds (tests/web_home.py: AG_APPS_PATH). The server and its home are one for the whole run: a test leaves what it
// opened as it found it, or asserts nothing another test changes.
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, openActor } from "./home";

const CLAUDE_CHANNEL = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";
const CODEX_CHANNEL = "019a1f2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const beside = process.platform === "darwin" ? "Meta" : "Control";

async function openNotes(page: Page): Promise<{ pane: Locator; panel: FrameLocator; instance: string }> {
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover(); // its buttons shown while hovered
  await row.locator("button.new-more").click();
  await page.locator(".row-menu[role=menu]").getByText("Notes", { exact: true }).click();
  const pane = page.locator("#panes > .app-pane[data-app=notes]");
  await expect(pane).toHaveCount(1);
  const panel = pane.frameLocator("iframe");
  await expect(panel.locator("body[data-ready='1']")).toHaveCount(1);
  const src = (await pane.locator("iframe").getAttribute("src")) || "";
  return { pane, panel, instance: new URL(src).searchParams.get("instance") || "" };
}

const notesFrame = (page: Page) => page.frames().find((f) => /^http:\/\/notes\.localhost:\d+\//.test(f.url()))!;

test("an app opens beside the actor in focus, attached to it, its panel on an origin of its own", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { pane, panel } = await openNotes(page);
  await expect(page.locator("#panes > .pane")).toHaveCount(2);
  await expect(pane.locator(".app-head")).toContainText("Notes"); // the test home's actors name no folder: its one
  expect(await pane.locator("iframe").getAttribute("src")).toMatch(/^http:\/\/notes\.localhost:\d+\/\?/);
  await expect(panel.locator("#agents")).toContainText(CLAUDE_CHANNEL); // the actor in focus, attached
  await expect(panel.locator("#focus")).toHaveText(CLAUDE_CHANNEL);
  await expect(panel.locator("#theme")).toHaveText(/^(light|dark)$/);
  // the panel can't reach the dashboard's page or its routes: another origin
  const reached = await notesFrame(page).evaluate(async () => {
    try {
      return (await fetch("http://127.0.0.1:" + new URL(location.href).port + "/api/home")).status;
    } catch {
      return "refused";
    }
  });
  expect(reached).toBe("refused");
  await pane.locator(".app-close").click();
  await expect(page.locator("#panes > .app-pane")).toHaveCount(0);
});

test("a note the user adds in the panel is stored, comes back as an event, and is told to the agents", async ({
  page,
  request,
}) => {
  await openActor(page, CLAUDE);
  const { panel, instance } = await openNotes(page);
  await panel.locator("#text").fill("buy milk");
  await panel.locator("#add button").click();
  await expect(panel.locator("#notes li", { hasText: "buy milk" })).toContainText("you");
  await expect(async () => {
    const got = await (
      await request.get(`/api/apps/events?app=notes&gatherer=${GATHERER}&instance=${instance}&types=context_stream`)
    ).json();
    const said = got.events.map((e: { payload: { text: string }; properties: { channel: string } }) => [
      e.properties.channel,
      e.payload.text,
    ]);
    expect(said).toContainEqual([CLAUDE_CHANNEL, "added a note: buy milk"]);
  }).toPass();
});

test("a tool its backend answers reaches the panel as an event and the backend's message", async ({
  page,
  request,
}) => {
  await openActor(page, CLAUDE);
  const { panel, instance } = await openNotes(page);
  const got = await (
    await request.post("/api/apps/call", {
      data: { app: "notes", gatherer: GATHERER, instance, tool: "add", args: { text: "from a tool" } },
    })
  ).json();
  expect(got).toEqual({ content: [{ type: "text", text: "kept: from a tool" }], isError: false });
  await expect(panel.locator("#said")).toHaveText("kept: from a tool");
  await expect(panel.locator("#notes li", { hasText: "from a tool" })).toHaveCount(1);
  // its backend's own routes, on its own origin
  const count = await notesFrame(page).evaluate(() =>
    (window as unknown as { notes: { api: (p: string) => Promise<Response> } }).notes
      .api("count")
      .then((r) => r.json()),
  );
  expect(count.notes).toBeGreaterThan(0);
});

test("an intent opens the app that takes it and tells its panel; one no app takes is refused", async ({ page }) => {
  await openActor(page, CLAUDE);
  await openNotes(page);
  type Notes = { notes: { intents: { open: (k: string, d: object) => Promise<unknown> } } };
  await notesFrame(page).evaluate(() =>
    (window as unknown as Notes).notes.intents.open("open-file", { path: "/w/demo/plan.md" }),
  );
  // Notes has an instance per folder: the file's folder's opened beside, and told
  await expect(page.locator("#panes > .app-pane")).toHaveCount(2);
  const there = page.locator("#panes > .app-pane", { hasText: "demo" });
  await expect(there.frameLocator("iframe").locator("#intent")).toHaveText("open-file /w/demo/plan.md");
  const refused = await notesFrame(page).evaluate(() =>
    (window as unknown as Notes).notes.intents.open("open-url", { url: "https://example.com" }).then(
      () => "opened",
      (e: Error) => e.message,
    ),
  );
  expect(refused).toContain("no app here takes open-url");
});

test("the panel follows the actor in focus, and the agents attached from its head", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { pane, panel } = await openNotes(page);
  await page.locator("#agents button.agent", { hasText: CODEX }).click({ modifiers: [beside] });
  await expect(page.locator("#panes > .pane")).toHaveCount(3);
  await expect(panel.locator("#focus")).toHaveText(CODEX_CHANNEL); // the actor's pane in focus now
  await pane.locator(".app-agents").click();
  await pane.locator(".app-menu-item", { hasText: CODEX }).click();
  await expect(panel.locator("#agents")).toContainText(CODEX_CHANNEL);
  await expect(pane.locator(".app-agents")).toHaveText(/2 agents/);
  await pane.locator(".app-agents").click();
  await pane.locator(".app-menu-item", { hasText: CODEX }).click(); // detached again: as the other tests expect
  await expect(panel.locator("#agents")).not.toContainText(CODEX_CHANNEL);
});

test("an app's pane is kept with the page's panes", async ({ page }) => {
  await openActor(page, CLAUDE);
  await openNotes(page);
  await page.reload();
  await expect(page.locator("#panes > .app-pane[data-app=notes]")).toHaveCount(1);
  await expect(page.locator("#panes > .app-pane").frameLocator("iframe").locator("body[data-ready='1']")).toHaveCount(
    1,
  );
});
