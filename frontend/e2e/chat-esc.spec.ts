// Esc in Chat (09-selected-agent.js): the agent's turn interrupted -- the key typed into the terminal the dashboard runs
// for it -- from the message box, and from anywhere else on the page that nothing else takes it. The same while the
// agent asks: the question dismissed, as an Esc on it in its terminal.
import type { Page } from "@playwright/test";
import { expect, homeAs, test } from "./test";
import { CLAUDE, openActor } from "./home";

const CLAUDE_CHANNEL = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";
const ASK = {
  kind: "question",
  call: "call-1",
  at: 1,
  questions: [{ question: "Which fruit do you prefer?", options: [{ label: "Apple" }, { label: "Pear" }] }],
};

/** The Claude Code actor, its terminal run by the dashboard and its message box open, at work (`asking`: asking you
 * ASK) -- once the page shows it so: an Esc before that is rightly not sent; the keys typed into its terminal, as sent. */
async function actorAtWork(page: Page, asking: boolean) {
  const keys: string[] = [];
  await page.route("**/api/terminal/input", async (route) => {
    keys.push(JSON.parse(route.request().postData() || "{}").data);
    await route.fulfill({ json: { ok: true } });
  });
  const homes = await homeAs(page, (home) => {
    for (const g of home.gatherers as { agents: Record<string, unknown>[] }[])
      for (const a of g.agents)
        if (a.channel === CLAUDE_CHANNEL)
          Object.assign(a, {
            session: {
              ...((a.session as object) || {}),
              session_id: CLAUDE_CHANNEL,
              terminal: true,
              status: "idle", // the terminal's session: its agent's state its own (a running session reads as Running)
            },
            running: true,
            chattable: true,
            ...(asking ? { status: "asking", asking: ASK } : { status: "running" }),
          });
    return home;
  });
  await openActor(page, CLAUDE);
  await expect.poll(() => homes.sent()).toBe(true);
  homes.again();
  const dot = page.locator("#agents button.agent", { hasText: CLAUDE }).locator(":scope > .dot");
  await expect(dot).toHaveAttribute("aria-label", asking ? "Waiting for you" : "Running");
  return keys;
}

test("Esc after a click in the chat interrupts the agent at work", async ({ page }) => {
  const keys = await actorAtWork(page, false);
  await expect(page.locator("#main .asking-note")).toHaveCount(0);
  await page.locator("#main .fl-turn.on .fl-head").click();
  await page.keyboard.press("Escape");
  await expect.poll(() => keys).toEqual(["\u001b"]);
});

test("Esc on a question's card, after a click on one of its choices, dismisses it as from the message box", async ({
  page,
}) => {
  const keys = await actorAtWork(page, true);
  const card = page.locator("#main .asking-note");
  await expect(card).toContainText("Which fruit do you prefer?");
  await card.locator(".opt", { hasText: "Pear" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => keys).toEqual(["\u001b"]);
  // and from the message box, as before (a second later: one a second)
  await page.waitForTimeout(1100);
  const box = page.locator("#composer-text");
  await expect(box).toBeEnabled();
  await box.focus();
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape");
  await expect.poll(() => keys).toEqual(["\u001b", "\u001b"]);
});
