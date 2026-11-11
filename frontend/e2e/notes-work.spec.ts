// Work items in Notes (ag_apps/notes/): lines sent to an agent, or marked as one, tracked on the Work page by how each
// stands; only the reader ends one -- accepted or canceled, which changes no line (its chip says how it ended), or a
// to-do one ticked, which then folds away on its page, a fold saying where -- and the Logbook keeps it. An agent's report is faked into the notebook the panel reads (the test
// home's actors have no session to call notes_report from); what reaches an actor is the page's /api/send, held here.
import type { FrameLocator, Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, GATHERER, open } from "./home";
import { binPage, newPage, openNotes } from "./notes-home";

const row = (panel: FrameLocator, text: string) =>
  panel.locator("#blocks > .blk", { has: panel.locator(".tx", { hasText: new RegExp(`^${text}\\s*$`) }) });
const side = (panel: FrameLocator, name: string) =>
  panel.locator(".pg-row", { has: panel.locator(".nm", { hasText: new RegExp(`^${name}$`) }) });

/** Lines typed, one after another, from the line the caret is in. */
async function type(page: Page, ...words: string[]) {
  for (const [i, w] of words.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(w);
  }
}

/** Every message the page sends an actor, held and kept: what /api/send was asked. */
async function holdSends(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  return sent;
}

/** The test home's Claude actor, faked as `fake` says when set; its channel. The home read once a load, not streamed. */
async function fakeActor(page: Page) {
  const it = { channel: "", fake: null as ((a: Record<string, unknown>) => void) | null };
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const a = home.gatherers
      .find((g: { name: string }) => g.name === GATHERER)
      .agents.find((x: { harness: string }) => x.harness === "claude");
    it.channel = a.channel;
    if (it.fake) it.fake(a);
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  return it;
}

/** Reports by the actor on lines (by id), as the notebook would have them once it filed them: read on a load. */
async function fakeReports(page: Page, channel: () => string) {
  const reports: Record<string, { text: string; results?: string[] }> = {};
  await page.route("**/api/state?*", async (route) => {
    const url = new URL(route.request().url()); // (the app's own origin, *.localhost: asked of 127.0.0.1 by its name)
    const book = await (
      await route.fetch({
        url: url.href.replace(url.hostname, "127.0.0.1"),
        headers: { ...route.request().headers(), host: url.host },
      })
    ).json();
    for (const pg of book.pages || [])
      for (const b of pg.blocks || [])
        if (reports[b.id])
          b.thread = [
            ...(b.thread || []),
            { id: `rep${b.id}`, by: `agent:${channel()}`, at: Date.now() / 1000 + 60, done: true, ...reports[b.id] },
          ];
    await route.fulfill({ json: book });
  });
  return reports;
}

/** The page loaded again, Notes still open beside it, on the page titled `title`. */
async function again(page: Page, title: string): Promise<FrameLocator> {
  await open(page);
  const pane = page.locator("#top-row > .app-pane[data-app=notes]");
  const panel = (await pane.count()) ? pane.frameLocator("iframe") : (await openNotes(page)).panel;
  await expect(panel.locator("body[data-ready='1']")).toHaveCount(1);
  if (title) await expect(panel.locator("#title")).toHaveText(title);
  return panel;
}

test("a line marked as a work item is tracked until it is ticked, and goes when it is no longer one", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Plan");
  await type(page, "Intro", "[] Write the release notes", "After");

  // marked from its menu: not started, on the line and on the Work page
  const line = row(panel, "Write the release notes");
  await line.hover();
  await line.locator(".gut .grip").click();
  await panel.locator(".pop .it", { hasText: "Mark as a work item" }).click();
  await expect(line.locator(".sent .chip")).toHaveText("Not started");
  await expect(line.locator(".sent .talk")).toHaveCount(0); // no conversation: sent to no one
  await expect(line.locator(".sent")).toHaveText("Not started"); // and nothing else beside it
  await side(panel, "Work").click();
  const work = panel.locator("#work-page");
  await expect(work).toBeVisible();
  await expect(work.locator(".wk-group.new .wk-row")).toContainText("Write the release notes");
  await expect(work.locator(".wk-group.new .wk-row .wk-btn")).toHaveText(["Remove", "Cancel", "Done", "Assign"]);

  // ticked: done, so folded away on its page -- a fold where it was, the keys passing over it
  await work.locator(".wk-group.new .wk-text").click();
  await expect(panel.locator("#title")).toHaveText("Plan");
  await line.locator(".chk").click();
  await expect(line).toHaveCount(0);
  await expect(row(panel, "Intro").locator(".fold button")).toHaveText("1 done");
  await expect(panel.locator("#done-btn")).toHaveText("Show done (1)");
  await row(panel, "Intro").locator(".tx").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await expect(row(panel, "After").locator(".tx")).toBeFocused();

  // shown again, struck, Done; unticked: open again
  await panel.locator("#done-btn").click();
  await expect(panel.locator("#done-btn")).toHaveAttribute("aria-pressed", "true");
  await expect(line).toHaveClass(/ended/);
  await expect(line.locator(".sent .chip")).toHaveText("Done");
  await expect(panel.locator(".fold")).toHaveCount(0);
  await line.locator(".chk").click();
  await expect(line.locator(".sent .chip")).toHaveText("Not started");
  await expect(panel.locator("#done-btn")).toBeHidden();

  // done without an agent, from the Work page: into the Logbook as no agent's; reopened there. Canceled so too.
  const mine = (sel: string) => panel.locator(sel, { hasText: "Write the release notes" });
  for (const [button, logged] of [
    ["Done", "accepted"],
    ["Cancel", "canceled"],
  ]) {
    await side(panel, "Work").click();
    await mine("#work-page .wk-group.new .wk-row").locator(".wk-btn", { hasText: button }).click();
    await expect(mine("#work-page .wk-group.new .wk-row")).toHaveCount(0);
    await side(panel, "Logbook").click();
    await expect(mine("#work-page .lg-row").locator(".wk-meta")).toContainText(`No agent · Plan · ${logged}`);
    await mine("#work-page .lg-row").locator(".wk-btn", { hasText: "Reopen" }).click();
    await expect(mine("#work-page .lg-row")).toHaveCount(0);
  }
  await side(panel, "Plan").click();
  await expect(line.locator(".sent .chip")).toHaveText("Not started");

  // removed from the Work page: no longer one, the line itself kept
  await side(panel, "Work").click();
  await work.locator(".wk-group.new .wk-btn", { hasText: "Remove" }).click();
  await expect(work.locator(".wk-row", { hasText: "Write the release notes" })).toHaveCount(0);
  await side(panel, "Plan").click();
  await expect(line).toHaveCount(1);
  await expect(line.locator(".sent")).toHaveCount(0);
  await binPage(panel, "Plan");
});

test("a line its agent reported on is the reader's to accept: the line stays as written, and the Logbook keeps it", async ({
  page,
}) => {
  const actor = await fakeActor(page);
  const reports = await fakeReports(page, () => actor.channel);
  const sent = await holdSends(page);
  await open(page);
  let { panel } = await openNotes(page);
  await newPage(page, panel, "Review");
  await type(page, "Intro", "[] Fix the parser @pars");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  await page.keyboard.press("End");
  await type(page, "", "After");
  const line = row(panel, "Fix the parser");
  const id = (await line.getAttribute("data-id")) || "";
  await expect(line.locator(".sent .chip")).toHaveAttribute("aria-label", new RegExp(`^${CLAUDE}: Sent`));

  // reported on, saying what it made: to review -- the line's Accept, the Work page's, a count for the reader
  reports[id] = { text: "Fixed the parser", results: ["fix-parser", "https://example.com/pull/4"] };
  panel = await again(page, "Review");
  await expect(line.locator(".sent .chip")).toHaveText("To review");
  await expect(line.locator(".sent .accept")).toHaveText("Accept");
  await expect(side(panel, "Work").locator(".needs")).toHaveText("1 for you");
  await side(panel, "Work").click();
  const review = panel.locator("#work-page .wk-group.review .wk-row");
  await expect(review).toContainText("Fix the parser");
  await expect(review.locator(".wk-said")).toHaveText("Fixed the parser");
  await expect(review.locator(".res > *")).toHaveText(["fix-parser", "example.com/pull/4"]);
  await expect(review.locator(".res a")).toHaveAttribute("href", "https://example.com/pull/4");

  // accepted: done -- in the Work page's Done (folded), no longer for the reader; on its page, Done beside it, the to-do
  // not ticked (the reader's to tick), nothing folded
  await review.locator(".wk-btn.accept").click();
  await expect(panel.locator("#work-page .wk-group.review")).toHaveCount(0);
  await expect(panel.locator("#work-page .wk-group.done .wk-fold")).toHaveText("Show");
  await expect(side(panel, "Work").locator(".needs")).toHaveCount(0);
  await side(panel, "Review").click();
  await expect(line.locator(".sent .chip")).toHaveText("Done");
  await expect(line).not.toHaveClass(/\b(done|ended)\b/);
  await expect(panel.locator(".fold")).toHaveCount(0);

  // the Logbook keeps it; reopened from there, it is to review again
  await side(panel, "Logbook").click();
  const logged = panel.locator("#work-page .lg-row", { hasText: "Fix the parser" });
  await expect(logged).toHaveCount(1);
  await expect(logged.locator(".wk-meta")).toContainText("accepted");
  await expect(logged.locator(".res > *")).toHaveText(["fix-parser", "example.com/pull/4"]);
  await logged.locator(".wk-btn", { hasText: "Reopen" }).click();
  await expect(logged).toHaveCount(0);
  await side(panel, "Review").click();
  await expect(line.locator(".sent .chip")).toHaveText("To review");

  // accepted from its conversation this time
  await line.locator(".sent .talk").click();
  const convo = panel.locator("#convo");
  await expect(convo.locator(".cv-q")).toHaveText("Is it done?");
  await expect(convo.locator(".reply input")).toHaveAttribute("placeholder", `Send it back to ${CLAUDE}: what's left`);
  await convo.locator(".accept.big").click();
  await expect(convo.locator(".cv-ended")).toContainText("Accepted as done");
  await expect(line.locator(".sent .chip")).toHaveText("Done");
  await expect(line).not.toHaveClass(/\b(done|ended)\b/);
  await binPage(panel, "Review");
});

test("a line that is not a to-do stays as written once its work is accepted too: not struck through, not folded away", async ({
  page,
}) => {
  const actor = await fakeActor(page);
  const reports = await fakeReports(page, () => actor.channel);
  const sent = await holdSends(page);
  await open(page);
  let { panel } = await openNotes(page);
  await newPage(page, panel, "Ideas");
  await type(page, "Intro", "Summarize the parser design @pars");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  const line = row(panel, "Summarize the parser design");
  const id = (await line.getAttribute("data-id")) || "";
  reports[id] = { text: "Wrote the summary" };
  panel = await again(page, "Ideas");
  await expect(line.locator(".sent .chip")).toHaveText("To review");

  // accepted: Done beside it, the line itself as it was -- not struck, nothing folded, nothing to show
  await line.locator(".sent .accept").click();
  await expect(line.locator(".sent .chip")).toHaveText("Done");
  await expect(line).not.toHaveClass(/ended/);
  await expect(line.locator(".tx")).toHaveCSS("text-decoration-line", "none");
  await expect(panel.locator(".fold")).toHaveCount(0);
  await expect(panel.locator("#done-btn")).toBeHidden();

  // a work item done all the same: in the Logbook
  await side(panel, "Logbook").click();
  const logged = panel.locator("#work-page .lg-row", { hasText: "Summarize the parser design" });
  await expect(logged.locator(".wk-meta")).toContainText("accepted");
  await binPage(panel, "Ideas");
});

test("canceling a line its agent is on tells the agent to stop, and the Logbook keeps it as canceled", async ({
  page,
}) => {
  const actor = await fakeActor(page);
  const sent = await holdSends(page);
  await open(page);
  let { panel } = await openNotes(page);
  await newPage(page, panel, "Stop");
  await type(page, "[] Long job @pars");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  const line = row(panel, "Long job");
  const id = await line.getAttribute("data-id");

  // at work on it
  actor.fake = (a) =>
    Object.assign(a, {
      last_user_message: String(sent[0].text),
      session: { session_id: actor.channel, terminal: true },
      status: "running",
      running: true,
    });
  panel = await again(page, "Stop");
  await expect(line.locator(".sent .chip")).toContainText("Working");
  await side(panel, "Work").click();
  await expect(panel.locator("#work-page .wk-group.run .wk-row")).toContainText("Long job");
  await side(panel, "Stop").click();

  // canceled from its conversation: ended so, and the agent told, in a message of the user's
  await line.locator(".sent .talk").click();
  await panel.locator("#convo .cv-acts.quiet button", { hasText: "Cancel it" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ session_id: actor.channel });
  expect(sent[1].text).toBe(
    `(From my Notes, page "Stop", block ${id}. The user canceled this line: stop any work on it, and don't report ` +
      "on it.)\n\nCanceled: Long job",
  );
  await expect(line.locator(".sent .chip")).toHaveText("Canceled"); // the line as it was, not struck or folded
  await expect(line).not.toHaveClass(/\b(done|ended)\b/);
  await expect(panel.locator(".fold")).toHaveCount(0);
  await side(panel, "Logbook").click();
  await expect(panel.locator("#work-page .lg-row.canceled")).toContainText("Long job");
  await binPage(panel, "Stop");
});
