// Apps (app_kit/DESIGN.md): an app's panel in the row above the actors' panes, beside the Editor -- in a frame on the
// app's own origin, talking to the page through app_kit's SDK (app_kit/js/app.js) -- the actor it is attached to below it. The test app is Notepad (tests/apps/notepad/), which the test home
// finds (tests/web_home.py: AG_APPS_PATH). The server and its home are one for the whole run: a test leaves what it
// opened as it found it, or asserts nothing another test changes.
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { attachTo, closePanel, expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, openActor } from "./home";

const CLAUDE_CHANNEL = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";
const CODEX_CHANNEL = "019a1f2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const beside = process.platform === "darwin" ? "Meta" : "Control";

async function openNotepad(page: Page): Promise<{ pane: Locator; panel: FrameLocator; instance: string }> {
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover(); // its buttons shown while hovered
  await row.locator("button.new-more").click();
  await page.locator(".row-menu[role=menu]").getByText("Notepad", { exact: true }).click();
  const pane = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(pane).toHaveCount(1);
  const panel = pane.frameLocator("iframe");
  await expect(panel.locator("body[data-ready='1']")).toHaveCount(1);
  const src = (await pane.locator("iframe").getAttribute("src")) || "";
  return { pane, panel, instance: new URL(src).searchParams.get("instance") || "" };
}

const instanceOf = async (pane: Locator) =>
  new URL((await pane.locator("iframe").getAttribute("src")) || "").searchParams.get("instance") || "";

const notepadFrame = (page: Page) => page.frames().find((f) => /^http:\/\/notepad\.localhost:\d+\//.test(f.url()))!;

test("an app opens above the panes, with no agent attached, its panel on an origin of its own", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { pane, panel } = await openNotepad(page); // a task of its own: in a tab of its own, alone
  await expect(page.locator(".lay-tabs .lay-tab")).toHaveCount(2);
  await expect(page.locator("#pane-here")).toBeHidden();
  await expect(pane).toHaveAttribute("aria-label", "Notepad"); // no head over it; the test home's actors name no folder
  await expect(pane.locator(".app-head, .app-top")).toHaveCount(0);
  const box = (await pane.boundingBox())!;
  expect((await pane.locator("iframe").boundingBox())!.y).toBeLessThanOrEqual(box.y + 1); // its frame from its top
  expect(await pane.locator("iframe").getAttribute("src")).toMatch(/^http:\/\/notepad\.localhost:\d+\/\?/);
  // the actor in focus not attached: attaching puts the two in one task (task_links.py), and opening an app from the
  // gatherer's menu puts it in none
  await expect(panel.locator("#agents")).toHaveText("none");
  await expect(page.locator("#agents button.agent.task")).toHaveCount(0);
  await expect(panel.locator("#focus")).toHaveText(CLAUDE_CHANNEL);
  await expect(panel.locator("#theme")).toHaveText(/^(light|dark)$/);
  // the panel can't reach the dashboard's page or its routes: another origin
  const reached = await notepadFrame(page).evaluate(async () => {
    try {
      return (await fetch("http://127.0.0.1:" + new URL(location.href).port + "/api/home")).status;
    } catch {
      return "refused";
    }
  });
  expect(reached).toBe("refused");
  await closePanel(page, pane); // its row in the list right-clicked: "Close its panel"
  await expect(page.locator("#top-row > .app-pane")).toHaveCount(0);
  await expect(page.locator("#top-row")).toBeHidden(); // nothing in it: the panes have the height
});

test("a note the user adds in the panel is stored, comes back as an event, and is told to the agents", async ({
  page,
  request,
}) => {
  await openActor(page, CLAUDE);
  const { panel, instance } = await openNotepad(page);
  await attachTo(page, GATHERER, instance, CLAUDE_CHANNEL);
  await expect(panel.locator("#agents")).toHaveText(CLAUDE_CHANNEL);
  await panel.locator("#text").fill("buy milk");
  await panel.locator("#add button").click();
  await expect(panel.locator("#notes li", { hasText: "buy milk" })).toContainText("you");
  await expect(async () => {
    const got = await (
      await request.get(`/api/apps/events?app=notepad&gatherer=${GATHERER}&instance=${instance}&types=context_stream`)
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
  const { panel, instance } = await openNotepad(page);
  const got = await (
    await request.post("/api/apps/call", {
      data: { app: "notepad", gatherer: GATHERER, instance, tool: "add", args: { text: "from a tool" } },
    })
  ).json();
  expect(got).toEqual({ content: [{ type: "text", text: "kept: from a tool" }], isError: false });
  await expect(panel.locator("#said")).toHaveText("kept: from a tool");
  await expect(panel.locator("#notes li", { hasText: "from a tool" })).toHaveCount(1);
  // its backend's own routes, on its own origin
  const count = await notepadFrame(page).evaluate(() =>
    (window as unknown as { notes: { api: (p: string) => Promise<Response> } }).notes
      .api("count")
      .then((r) => r.json()),
  );
  expect(count.notes).toBeGreaterThan(0);
});

test("an intent opens the app that takes it and tells its panel; one no app takes is refused", async ({ page }) => {
  await openActor(page, CLAUDE);
  await openNotepad(page);
  type Notes = { notes: { intents: { open: (k: string, d: object) => Promise<unknown> } } };
  await notepadFrame(page).evaluate(() =>
    (window as unknown as Notes).notes.intents.open("open-file", { path: "/w/demo/plan.md" }),
  );
  // Notepad has an instance per folder: the file's folder's opened beside it, and told
  await expect(page.locator("#top-row > .app-pane")).toHaveCount(2);
  const there = page.locator("#top-row > .app-pane[aria-label='Notepad · demo']");
  await expect(there.frameLocator("iframe").locator("#intent")).toHaveText("open-file /w/demo/plan.md");
  const refused = await notepadFrame(page).evaluate(() =>
    (window as unknown as Notes).notes.intents.open("explain-answer", { channel: "c", turn: 1 }).then(
      () => "opened",
      (e: Error) => e.message,
    ),
  );
  expect(refused).toContain("no app here takes explain-answer");
});

test("the panel follows the actor in focus, and the agents attached to it", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { panel, instance } = await openNotepad(page); // in a tab of its own, Claude's left in the first
  await page.locator("#agents button.agent", { hasText: CODEX }).click({ modifiers: [beside] });
  await expect(page.locator("#pane-here")).toBeVisible(); // Codex under it, in this page's own pane
  await expect(page.locator("#panes > .pane")).toHaveCount(1);
  await expect(panel.locator("#focus")).toHaveText(CODEX_CHANNEL); // the actor's pane in focus now
  await attachTo(page, GATHERER, instance, CODEX_CHANNEL);
  await expect(panel.locator("#agents")).toContainText(CODEX_CHANNEL);
  await attachTo(page, GATHERER, instance, CODEX_CHANNEL, false); // detached again: as the other tests expect
  await expect(panel.locator("#agents")).not.toContainText(CODEX_CHANNEL);
});

test("an app's panel closed by the × over its top right corner: the app left open, its row in the list", async ({
  page,
}) => {
  await openActor(page, CLAUDE);
  const { pane, panel, instance } = await openNotepad(page);
  const x = pane.locator(".app-x");
  await expect(x).toBeVisible(); // always shown, over its frame's corner
  const [p, b] = [(await pane.boundingBox())!, (await x.boundingBox())!];
  expect(p.x + p.width - (b.x + b.width)).toBeLessThan(10);
  expect(b.y - p.y).toBeLessThan(10);
  // the panel told to keep that corner clear (app_kit/js/app.js)
  await expect
    .poll(() =>
      notepadFrame(page).evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ag-corner")),
    )
    .toBe("34px");
  await expect(panel.locator("body[data-ready='1']")).toHaveCount(1);
  await x.click();
  await expect(page.locator("#top-row > .app-pane")).toHaveCount(0);
  await expect(page.locator(`#agents .app-row[data-instance="${instance}"]`)).toHaveCount(1); // the app still open
});

test("an app's panel is kept in this browser", async ({ page }) => {
  await openActor(page, CLAUDE);
  await openNotepad(page);
  await page.reload();
  await expect(page.locator("#top-row > .app-pane[data-app=notepad]")).toHaveCount(1);
  await expect(page.locator("#top-row > .app-pane").frameLocator("iframe").locator("body[data-ready='1']")).toHaveCount(
    1,
  );
});

test("an app opened shows the actor it is attached to below it", async ({ page }) => {
  await openActor(page, CLAUDE);
  const { panel, instance } = await openNotepad(page);
  await attachTo(page, GATHERER, instance, CLAUDE_CHANNEL); // in Claude's task
  await expect(panel.locator("#agents")).toHaveText(CLAUDE_CHANNEL);
  type Notes = { notes: { intents: { open: (k: string, d: object) => Promise<unknown> } } };
  const raise = () =>
    notepadFrame(page).evaluate(() =>
      (window as unknown as Notes).notes.intents.open("open-file", { path: "/w/attached/a.md" }),
    );
  await raise(); // its own instance, no agent attached: the panes as they were
  const there = page.locator("#top-row > .app-pane[aria-label='Notepad · attached']");
  await expect(there).toHaveCount(1);
  await expect(page.locator("#agents button.agent[aria-current=true]", { hasText: CLAUDE })).toHaveCount(1);
  const theirs = await instanceOf(there);
  await attachTo(page, GATHERER, theirs, CODEX_CHANNEL); // Codex attached to it
  await expect(there.frameLocator("iframe").locator("#agents")).toHaveText(CODEX_CHANNEL);
  await closePanel(page, there);
  // opened again: its agent shown below, in the pane in focus -- another task than Claude's, so Claude's Notes, whose
  // panel asked, goes with that task (07-panes.js's enterTask), its frame gone before the answer
  await raise().catch(() => null);
  await expect(there).toHaveCount(1);
  await expect(page.locator("#agents button.agent[aria-current=true]", { hasText: CODEX })).toHaveCount(1);
  await expect(page.locator("#top-row > .app-pane")).toHaveCount(1);
  await attachTo(page, GATHERER, theirs, CODEX_CHANNEL, false); // detached again
  await expect(there.frameLocator("iframe").locator("#agents")).toHaveText("none");
});

test("a menu from a row stays open while a Chat's history scrolls by itself; the list it hangs from scrolled, it closes", async ({
  page,
}) => {
  await openActor(page, CLAUDE);
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover();
  await row.locator("button.new-more").click();
  const menu = page.locator(".row-menu[role=menu]");
  await expect(menu).toHaveCount(1);
  // a Chat keeps its history at its end as its pane is resized: that scroll is no reason to close the menu
  await page
    .locator(".fl-talk")
    .first()
    .evaluate((e) => e.dispatchEvent(new Event("scroll")));
  await expect(menu).toHaveCount(1);
  await page.locator("#agents").evaluate((e) => e.dispatchEvent(new Event("scroll"))); // its button moved: closed
  await expect(menu).toHaveCount(0);
});
