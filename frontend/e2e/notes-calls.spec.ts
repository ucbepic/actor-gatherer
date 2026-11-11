// Notes: a line sent to more than one agent, and taken back from one (ag_apps/notes/, a block's `calls`). Each agent the
// line is with shows its own chip; its conversation beside the page is one tab an agent; a reply goes to the agent of
// the tab it is written in; "Remove from this line" (in the conversation, or the line's menu) takes it back, telling an
// agent still to start on it to leave it. What reaches the actors is the page's /api/send, held here.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, open } from "./home";
import { binPage, newPage, openNotes } from "./notes-home";

const CLAUDE_CH = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";
const CODEX_CH = "019a1f2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const CODEX = "Actor 019a1f2b"; // (the Codex actor has no name)

async function holdSends(page: Page): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  return sent;
}

test("a line goes to a second agent from its + button: a chip each, a tab each, and a reply goes to the tab's agent", async ({
  page,
}) => {
  const sent = await holdSends(page);
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Two agents");
  await page.keyboard.type("[] Fix the parser @pars");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ channel: CLAUDE_CH });
  const row = panel.locator("#blocks > .blk").first();
  const id = await row.getAttribute("data-id");
  await expect(row.locator(".sent .chip")).toHaveCount(1);

  // its + button (on hover): the picker leaves out the agent it is with already
  await expect(row.locator(".to-btn")).toBeHidden();
  await row.hover();
  await row.locator(".sent .add-agent").click();
  const pop = panel.locator(".pop.at-pop");
  await expect(pop.locator(".hd.lead")).toHaveText("Send it to another agent too, as your message");
  await expect(pop.locator(".it", { hasText: CLAUDE })).toHaveCount(0);
  await page.keyboard.type("Review it when done.");
  await pop.locator(".it", { hasText: CODEX }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ channel: CODEX_CH });
  expect(sent[1].text).toBe(
    `(From my Notes, page "Two agents", block ${id}. I sent this line to actor 5f0c2a2e too; this message is for ` +
      "you. When you're done, report back with notes_report, in one to three lines.)\n\nFix the parser\n\n" +
      "Review it when done.", // (the note says it went to another: else the second takes it for the first's)
  );
  const chips = row.locator(".sent .chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toHaveAttribute("aria-label", new RegExp(`^${CLAUDE}: `));
  await expect(chips.nth(1)).toHaveAttribute("aria-label", new RegExp(`^${CODEX}: `));
  await expect(row.locator(".sent .talk")).toHaveText("2"); // the line, as sent to each

  // the second's chip opens its conversation: a tab each, its own tab on
  await chips.nth(1).click();
  const convo = panel.locator("#convo");
  await expect(convo).toBeVisible();
  const tabs = convo.locator(".cv-tab");
  await expect(tabs).toHaveCount(2);
  await expect(convo.locator(".cv-tab.on")).toContainText(CODEX);
  await expect(convo.locator(".msg.you .bub")).toHaveText(["Fix the parser Review it when done."]);
  const box = convo.locator(".reply input");
  await expect(box).toHaveAttribute("placeholder", `Message ${CODEX}`);
  await box.fill("Check the lexer too");
  await box.press("Enter");
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toMatchObject({ channel: CODEX_CH });
  await expect(convo.locator(".msg.you .bub")).toHaveText([
    "Fix the parser Review it when done.",
    "Check the lexer too",
  ]);

  // the other tab: its own conversation, without that reply; a reply there goes to it
  await tabs.nth(0).click();
  await expect(convo.locator(".cv-tab.on")).toContainText(CLAUDE);
  await expect(convo.locator(".msg.you .bub")).toHaveText(["Fix the parser"]);
  await expect(box).toHaveAttribute("placeholder", `Message ${CLAUDE}`);
  await box.fill("Thanks");
  await box.press("Enter");
  await expect.poll(() => sent.length).toBe(4);
  expect(sent[3]).toMatchObject({ channel: CLAUDE_CH });
  await expect(row.locator(".sent .talk")).toHaveText("4");
  await binPage(panel, "Two agents");
});

test("an agent taken off a line is told to leave it, keeps its tab, and the line is sent to no one once both are gone", async ({
  page,
}) => {
  const sent = await holdSends(page);
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Taken back");
  await page.keyboard.type("Rename the flag @pars");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.length).toBe(1);
  const row = panel.locator("#blocks > .blk").first();
  const id = await row.getAttribute("data-id");
  await row.hover();
  await row.locator(".sent .add-agent").click();
  await panel.locator(".pop.at-pop .it", { hasText: CODEX }).click();
  await expect.poll(() => sent.length).toBe(2);
  await expect(row.locator(".sent .chip")).toHaveCount(2);

  // from its conversation: the agent, yet to take it up, told to leave it; its chip gone, its tab kept
  await row.locator(".sent .chip").nth(1).click();
  const convo = panel.locator("#convo");
  await convo.locator(".cv-drop").click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toMatchObject({ channel: CODEX_CH });
  expect(sent[2].text).toBe(
    `(From my Notes, page "Taken back", block ${id}. The user took this line back from you: stop any work on it, ` +
      "and don't report on it.)\n\nTaken back: Rename the flag",
  );
  await expect(row.locator(".sent .chip")).toHaveCount(1);
  await expect(row.locator(".sent .chip")).toHaveAttribute("aria-label", new RegExp(`^${CLAUDE}: `));
  await expect(convo.locator(".cv-tab")).toHaveCount(2);
  await expect(convo.locator(".cv-tab.on")).toContainText("Removed");
  await expect(convo.locator(".reply")).toHaveCount(0);
  await expect(convo.locator(".cv-none")).toHaveText(
    `Removed from this line: send it to ${CODEX} again to talk about it.`,
  );
  await expect(convo.locator(".cv-drop")).toHaveCount(0);

  // the other, from the line's menu: no agent left -- a work item sent to no one, its conversations kept
  await convo.locator(".cv-x").click();
  await row.hover();
  await row.locator(".gut .grip").click();
  await panel.locator(".pop .it", { hasText: `Remove ${CLAUDE}` }).click();
  await expect.poll(() => sent.length).toBe(4);
  expect(sent[3]).toMatchObject({ channel: CLAUDE_CH });
  await expect(row.locator(".sent .chip")).toHaveText("Not started");
  await expect(row).not.toHaveClass(/is-sent/);
  await expect(row.locator(".sent .talk")).toHaveText("2");

  // sent to one of them again: its call is its own again, the picker offering it
  await row.hover();
  await row.locator(".to-btn").click();
  await panel.locator(".pop.at-pop .it", { hasText: CODEX }).click();
  await expect.poll(() => sent.length).toBe(5);
  await expect(row.locator(".sent .chip")).toHaveCount(1);
  await expect(row.locator(".sent .chip")).toHaveAttribute("aria-label", new RegExp(`^${CODEX}: Sent`));
  await row.locator(".sent .chip").click();
  await expect(convo.locator(".cv-tab.on")).toContainText(CODEX);
  await expect(convo.locator(".reply input")).toHaveAttribute("placeholder", `Message ${CODEX}`);
  await binPage(panel, "Taken back");
});
