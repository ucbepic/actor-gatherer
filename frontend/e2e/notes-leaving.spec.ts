// The Notes panel going away -- reloaded, its iframe dropped, its tab shut -- while a change is still being sent: what
// was queued behind that change, and the words typed and waiting for their pause, are kept too, after it and each once
// (ag_apps/notes/panel/send.js's `leaving`, backend.py's named batches). The change being sent is held in the panel's
// own fetch, its answer never coming back before the page goes: it reached the backend, it never did, or it reaches it
// only after the page went (sent again then, late: taken once, not applied again over what came after it).
import type { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { open } from "./home";
import { binPage, call, newPage, openNotes } from "./notes-home";

type Held = { url: string; body: string };
type Panel = {
  AgApp: { connect(): Promise<{ api(path: string): Promise<Response> }> };
  held?: Held;
  release?: () => void;
  fetch: typeof fetch;
};

/** The notebook's version, as the backend has it (asked from within the panel, on its own origin). */
const version = (panel: FrameLocator) =>
  panel.locator("body").evaluate(async () => {
    const ag = await (window as unknown as Panel).AgApp.connect();
    return (await (await ag.api("state")).json()).version as number;
  });

const pane = (page: Page) => page.locator("#top-row > .app-pane[data-app=notes]");

/** The page shown in the panel, titled `title` (its row in the list marked so), by its id: what the test reads back --
 * not by its title, which a page an earlier attempt left has too (one that failed before binPage; a retry runs in the
 * same home), and is found first. */
const shownPage = async (panel: FrameLocator, title: string) =>
  (await panel
    .locator(".pg-row.on")
    .filter({ has: panel.locator(".nm", { hasText: new RegExp(`^${title}$`) }) })
    .getAttribute("data-id"))!;

/** The Notes pane's panel on the page, ready (the pane kept in this browser). */
async function panelOn(page: Page): Promise<FrameLocator> {
  const panel = pane(page).frameLocator("iframe");
  await expect(panel.locator("body[data-ready='1']")).toHaveCount(1);
  return panel;
}

/** The next batch the panel sends held in its own fetch, its answer not given (till `release()`d, if ever): sent on to
 * the backend (`reached`) or not. Held there, not by a route: the browser and the test's routes let a request held by a
 * route go, or fail it, as the page goes -- the panel then sees it fail and sends it again -- while one truly on its
 * way is still being sent when the page's last handlers run. */
const holdNext = (panel: FrameLocator, reached: boolean) =>
  panel.locator("body").evaluate((_, reached) => {
    const w = window as unknown as Panel,
      real = w.fetch.bind(w);
    w.fetch = (input, init) => {
      if (!w.held && String(input).includes("/api/ops")) {
        w.held = { url: String(input), body: String(init?.body) };
        const answer = reached ? real(input, init) : null;
        return new Promise<Response>((r) => (w.release = () => r(answer || real(input, init))));
      }
      return real(input, init);
    };
  }, reached);
const heldOne = (panel: FrameLocator) => panel.locator("body").evaluate(() => (window as unknown as Panel).held);

for (const [how, sent] of [
  ["reloaded", "reached the backend"],
  ["its iframe dropped", "never reached the backend"],
  ["its tab shut", "reaches the backend late"],
] as const) {
  test(`changes queued and typed behind a batch being sent are kept, each once, when the panel is ${how} (the batch ${sent})`, async ({
    page,
  }) => {
    await open(page);
    const { panel: first, instance } = await openNotes(page);
    const title = `Leaving: ${how}`;
    await newPage(page, first, title);
    const id = await shownPage(first, title);
    let where = page,
      panel = first;
    if (how === "its tab shut") {
      where = await page.context().newPage(); // a second tab on the same notebook, the page open: the one shut
      await open(where);
      panel = await panelOn(where);
      await expect(panel.locator("#title")).toHaveText(title);
      await panel.locator("#blocks > .blk").first().locator(".tx").click();
    }
    const kb = where.keyboard;
    await kb.type("first");
    await expect(panel.locator("#saved")).toHaveText("Saved");
    const before = await version(panel);

    await holdNext(panel, sent === "reached the backend");
    await kb.type(" one"); // sent after its pause, and held
    await expect.poll(() => heldOne(panel)).toBeTruthy();
    const held = (await heldOne(panel))!;
    expect(held.body).toContain("first one");
    await kb.type(" two"); // over it, in the same line: waiting for its pause
    await kb.press("Enter"); // a new line: queued behind the batch held
    await kb.type("second"); // its words: waiting for their pause
    if (how === "reloaded") await where.reload();
    else if (how === "its iframe dropped")
      await pane(where)
        .locator("iframe")
        .evaluate((f) => f.remove());
    else await where.close();

    const read = async () => (await call(page, instance, "read", { page: id })).text;
    const kept = /\] first one two\n\[[a-z0-9]+\] second$/m;
    await expect.poll(read).toMatch(kept);
    // a panel again: the pane's iframe was dropped; or this tab, left after another was shut, has one that takes no clicks
    if (how !== "reloaded") await page.reload();
    const after = await panelOn(page);
    if (sent === "reaches the backend late") {
      // the batch held, sent only now: already taken, not applied again over the words typed after it
      const status = await after
        .locator("body")
        .evaluate(
          (_, held) =>
            fetch(held.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: held.body }).then(
              (r) => r.status,
            ),
          held,
        );
      expect(status).toBe(200);
      expect(await read()).toMatch(kept);
    }
    expect(await version(after)).toBe(before + 2); // that batch, then the rest: nothing applied twice
    await binPage(after, title);
  });
}

test("a panel hidden while a batch is being sent, then shown again, sends what was behind it once, and says Saved", async ({
  page,
}) => {
  await open(page);
  const { panel, instance } = await openNotes(page);
  const title = "Hidden a while";
  await newPage(page, panel, title);
  const id = await shownPage(panel, title);
  const kb = page.keyboard;
  await kb.type("first");
  await expect(panel.locator("#saved")).toHaveText("Saved");
  const before = await version(panel);
  await holdNext(panel, true);
  await kb.type(" one");
  await expect.poll(() => heldOne(panel)).toBeTruthy();
  await kb.type(" two");
  await kb.press("Enter");
  await kb.type("second");
  const hidden = (on: boolean) =>
    panel.locator("body").evaluate((_, on) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => on });
      document.dispatchEvent(new Event("visibilitychange"));
    }, on);
  await hidden(true); // another tab shown: everything not yet taken sent at once, as if the page were going
  const read = async () => (await call(page, instance, "read", { page: id })).text;
  const kept = /\] first one two\n\[[a-z0-9]+\] second$/m;
  await expect.poll(read).toMatch(kept);
  await expect(panel.locator("#saved")).toHaveText("Saving…");
  await hidden(false);
  await panel.locator("body").evaluate(() => (window as unknown as Panel).release!()); // its answer, at last
  await expect(panel.locator("#saved")).toHaveText("Saved"); // what was behind it sent again, as usual: taken once
  expect(await read()).toMatch(kept);
  expect(await version(panel)).toBe(before + 2);
  await binPage(panel, title);
});
