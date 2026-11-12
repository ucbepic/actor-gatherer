// Notes and the gatherer's actors (ag_apps/notes/, capabilities actors and message_actors): a line sent to an actor as
// the user's message (`@` typed in it, or its button), with instructions added in the picker; the block then saying who
// it went to and how it stands, its conversation beside the page; the Agents page and an `agents` block. What reaches the
// actor is the page's /api/send, held here: the test home's actors have no terminal to type into.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, GATHERER, NOW, open } from "./home";
import { binPage, newPage, openNotes } from "./notes-home";

/** Every message the page sends an actor, held and kept: what /api/send was asked. */
async function holdSends(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  return sent;
}

test("a to-do sent to an actor with @ goes as the user's message, says who it went to, and takes a reply", async ({
  page,
}) => {
  const sent = await holdSends(page);
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Ship");
  await page.keyboard.type("[] Fix the parser @");
  const pop = panel.locator(".pop.at-pop");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".it", { hasText: "Coordinator agent" })).toHaveCount(1);
  await expect(pop.locator(".it", { hasText: CLAUDE })).toHaveCount(1);
  await expect(pop.locator(".at-foot")).toHaveAttribute("aria-checked", "true"); // a report asked for, as it starts
  await page.keyboard.type("pars"); // narrowed to the actor so named
  await expect(pop.locator(".it")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(pop).toBeHidden();

  const row = panel.locator("#blocks > .blk").first();
  const id = await row.getAttribute("data-id");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ gatherer: GATHERER });
  expect(sent[0].text).toBe(
    `(From my Notes, page "Ship", block ${id}. When you're done, report back with notes_report, in one to ` +
      "three lines.)\n\nFix the parser",
  );
  await expect(row.locator(".tx")).toHaveText("Fix the parser "); // the @ and what followed it taken out
  const chip = row.locator(".sent .chip");
  await expect(chip).toHaveAttribute("aria-label", new RegExp(`^${CLAUDE}: `)); // who, on hover: its avatar and status shown
  await expect(row.locator(".sent")).not.toContainText(CLAUDE); // no name, nor a preview, on the page
  await expect(row).toHaveClass(/is-sent/);

  // on the page, one line under it -- no conversation there; the conversation opened beside the page, from that line
  await expect(row.locator(".sent .talk")).toHaveText("1");
  await expect(row.locator(".reply, .msg")).toHaveCount(0);
  const convo = panel.locator("#convo");
  await expect(convo).toBeHidden();
  await row.locator(".sent .talk").click();
  await expect(convo).toBeVisible();
  await expect(row).toHaveClass(/convo-on/);
  await expect(convo.locator(".cv-who")).toContainText(CLAUDE);
  await expect(convo.locator(".cv-about")).toContainText("Fix the parser");
  await expect(convo.locator(".msg.you .bub")).toHaveText(["Fix the parser"]); // the line as it was sent
  const box = convo.locator(".reply input");
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute("placeholder", `Message ${CLAUDE}`);
  await box.fill("Also the lexer");
  await box.press("Enter");
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].text).toBe(
    `(A reply in my Notes, page "Ship", block ${id}. Report back with notes_report when you're done.)\n\n` +
      "Also the lexer",
  );
  await expect(convo.locator(".msg.you .bub")).toHaveText(["Fix the parser", "Also the lexer"]);
  await expect(box).toHaveValue("");
  await expect(row.locator(".sent .talk")).toHaveText("2");
  await expect(row.locator(".msg")).toHaveCount(0); // still not on the page
  await box.press("Escape"); // an empty box: Esc closes the conversation
  await expect(convo).toBeHidden();
  await expect(row).not.toHaveClass(/convo-on/);
  await row.locator(".sent .chip").click(); // its chip opens it too
  await expect(convo).toBeVisible();

  // the Agents page: the actor, and the to-do it was sent -- a click on that, back on its page
  await panel.locator(".pg-row.agents-row").click();
  const agents = panel.locator("#agents-page");
  await expect(agents).toBeVisible();
  const mine = agents.locator("tr", { hasText: CLAUDE });
  await expect(mine.locator(".blk-link")).toHaveText("Fix the parser");
  await mine.locator(".blk-link").click();
  await expect(panel.locator("#title")).toHaveText("Ship");
  await expect(chip).toHaveAttribute("aria-label", new RegExp(`^${CLAUDE}: `)); // kept, read back from the notebook
  await binPage(panel, "Ship");
});

test("a line sent fails aloud and stays unsent when the page cannot send it", async ({ page }) => {
  await page.route("**/api/send", (route) =>
    route.fulfill({ status: 409, json: { error: "it waits on its question" } }),
  );
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Unsent");
  await page.keyboard.type("Try this ");
  const row = panel.locator("#blocks > .blk").first();
  await row.hover();
  await row.locator(".to-btn").click(); // its button, as @ does
  await panel.locator(".pop.at-pop .it", { hasText: CLAUDE }).click();
  await expect(panel.locator("#who")).toContainText("Not sent");
  await expect(row).not.toHaveClass(/is-sent/);
  await expect(row.locator(".sent")).toHaveCount(0);
  await binPage(panel, "Unsent");
});

test("/agents puts a table of the gatherer's actors on a page", async ({ page }) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Team");
  await page.keyboard.type("/agents");
  await page.keyboard.press("Enter");
  const table = panel.locator('#blocks > .blk[data-type="agents"] .agt-tbl');
  await expect(table).toBeVisible();
  await expect(table.locator("tr", { hasText: CLAUDE })).toHaveCount(1);
  await expect(panel.locator("#blocks > .blk").nth(1)).toHaveAttribute("data-type", "text"); // a line to type on, after
  await binPage(panel, "Team");
});

test("what is added in the picker goes with the line -- from its button, or Tab after @ -- and shows with it", async ({
  page,
}) => {
  const sent = await holdSends(page);
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Added");
  await page.keyboard.type("[] Ship the parser");
  const row = panel.locator("#blocks > .blk").first();
  const id = await row.getAttribute("data-id");
  await row.hover();
  await row.locator(".to-btn").click();
  const extra = panel.locator(".pop.at-pop .at-extra");
  await expect(extra).toBeFocused(); // opened by its button: the box has the keys
  await page.keyboard.type("Use the v2 API.");
  await page.keyboard.press("Shift+Enter"); // a new line in the box, not sent
  await page.keyboard.type("No new deps");
  await expect(panel.locator(".pop.at-pop")).toBeVisible();
  await panel.locator(".pop.at-pop .it", { hasText: CLAUDE }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].text).toBe(
    `(From my Notes, page "Added", block ${id}. When you're done, report back with notes_report, in one to ` +
      "three lines.)\n\nShip the parser\n\nUse the v2 API.\nNo new deps",
  );
  await row.locator(".sent .talk").click(); // the conversation: the line as sent, with what was added
  const first = panel.locator("#convo .msg.you .bub").first();
  await expect(first).toContainText("Ship the parser");
  await expect(first).toContainText("No new deps");
  await expect(row.locator(".tx")).toHaveText("Ship the parser"); // the line itself unchanged

  await page.keyboard.press("Escape");
  await row.locator(".tx").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Then the lexer @pars");
  await page.keyboard.press("Tab"); // from the @ into the box
  await expect(extra).toBeFocused();
  await page.keyboard.type("Same rules");
  await page.keyboard.press("Enter"); // sent to the agent the @ narrowed to
  await expect.poll(() => sent.length).toBe(2);
  const second = panel.locator("#blocks > .blk").nth(1);
  expect(sent[1].text).toBe(
    `(From my Notes, page "Added", block ${await second.getAttribute("data-id")}. When you're done, report back ` +
      "with notes_report, in one to three lines.)\n\nThen the lexer\n\nSame rules",
  );
  await expect(second.locator(".tx")).toHaveText("Then the lexer "); // the @ and what followed it taken out
  await binPage(panel, "Added");
});

test("one actor on two lines: the line it is on now works and asks, the other is queued; the question answered beside the page", async ({
  page,
}) => {
  let channel = "";
  let fake: ((a: Record<string, unknown>) => void) | null = null;
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const a = home.gatherers
      .find((g: { name: string }) => g.name === GATHERER)
      .agents.find((x: { harness: string }) => x.harness === "claude");
    channel = a.channel;
    if (fake) fake(a);
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort()); // the home as faked, not changed after
  const answers: Record<string, unknown>[] = [];
  await page.route("**/api/answer", async (route) => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  const sent = await holdSends(page);
  await open(page);
  let { panel } = await openNotes(page);
  await newPage(page, panel, "Two");
  await page.keyboard.type("[] First @pars");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second @pars");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.length).toBe(2);
  const first = panel.locator("#blocks > .blk").first(),
    second = panel.locator("#blocks > .blk").nth(1);
  const one = await first.getAttribute("data-id");
  await expect(second.locator(".sent .chip")).toHaveAttribute("aria-label", new RegExp(`^${CLAUDE}: `));

  // it works on the first: its latest message is the first line's
  const on = { last_user_message: String(sent[0].text), session: { session_id: channel, terminal: true } };
  fake = (a) => Object.assign(a, on, { status: "running", running: true });
  const again = async () => {
    await open(page);
    const pane = page.locator("#top-row > .app-pane[data-app=notes]");
    panel = (await pane.count()) ? pane.frameLocator("iframe") : (await openNotes(page)).panel;
    await expect(panel.locator("#title")).toHaveText("Two");
  };
  await again();
  await expect(first.locator(".sent .chip")).toContainText("Working");
  await expect(second.locator(".sent .chip")).toContainText("Queued");
  await expect(second.locator(".sent .chip")).toHaveAttribute("aria-label", `${CLAUDE}: Queued\nAfter “First”`);

  // it asks, about the first: the question on the first line only
  fake = (a) =>
    Object.assign(a, on, {
      status: "asking",
      asking: {
        id: "call-1",
        call: "call-1",
        kind: "question",
        harness: "claude",
        async: false,
        at: NOW - 60,
        questions: [
          {
            header: "Keys",
            question: "Keep the old keys?",
            multiSelect: false,
            options: [{ label: "Keep them" }, { label: "Drop them" }],
          },
        ],
      },
    });
  await again();
  await expect(first.locator(".sent .chip")).toContainText("Needs you");
  await expect(first.locator(".sent .chip")).toHaveAttribute(
    "aria-label",
    `${CLAUDE}: Needs you\nAsks: Keep the old keys?`,
  );
  await expect(second.locator(".sent .chip")).toContainText("Queued");
  await expect(second.locator(".sent .talk.answer")).toHaveCount(0);
  await second.locator(".sent .talk").click();
  await expect(panel.locator("#convo .ask-card")).toHaveCount(0); // not in the second's conversation
  await first.locator(".sent .talk.answer").click();
  const card = panel.locator("#convo .ask-card");
  await expect(card).toContainText("Keep the old keys?");
  await card.getByRole("button", { name: "Drop them" }).click();
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]).toEqual({ session_id: channel, call: "call-1", choice: { answers: [{ options: [1] }] } });
  expect(one).toBeTruthy();
  await binPage(panel, "Two");
});
