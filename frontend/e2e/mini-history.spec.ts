// A minimized pane's HISTORY (src/legacy/18-mini-history.js): right of its message box, the user's last message and what
// the actor said last; hovered, the whole conversation in a card over what is above the pane -- each turn's message, its
// commands with its messages among them in the order they came (files.py's reply `after`), its reply; an earlier turn
// folded to its count of commands, fetched when opened. A pane in a frame, only as tall as its strip, has its card drawn
// in the page around it. A message in the card clicked: the chat shown again at that turn.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CODEX, open } from "./home";
import { addNotepad, taskHome, taskRow } from "./task-home";

const box = async (l: Locator) => (await l.boundingBox())!;
const notes = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
const other = (page: Page) => page.locator("#panes > .pane").nth(1);
const minimize = (where: Page | ReturnType<Page["frameLocator"]>) =>
  where.locator("button[aria-label='Minimize the chat']:visible").first();
// what the card shows after the user's last message, each child as "<its class> <its first words>"
const afterLast = (card: Locator) =>
  card.locator(".mh-body").evaluate((b) => {
    const kids = [...b.children];
    const from = kids.map((k) => k.classList.contains("mh-you")).lastIndexOf(true);
    return kids.slice(from + 1).map((k) => `${k.classList[0]} ${(k.textContent || "").trim().slice(0, 14)}`);
  });

test("a minimized pane shows its last message and reply; hovered, the whole conversation; a message clicked, the chat there", async ({
  page,
}) => {
  await open(page);
  const codex = page.locator("#agents button.agent", { hasText: CODEX });
  await codex.click();
  await addNotepad(page, codex);
  await expect(notes(page)).toHaveCount(1);
  await minimize(page).click();
  const strip = page.locator("#main > .chat.mini");
  const lines = strip.locator(".mini-hist .mh-row");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText("Spawn one subagent"); // the user's last message
  await expect(lines.nth(1)).toContainText("done"); // the first line of the agent's last
  await page.mouse.move(700, 300);
  await lines.nth(1).hover();
  const card = page.locator(".mh-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".mh-sep")).toHaveCount(7); // every turn
  await expect(card.locator(".mh-head")).toContainText("Done");
  // the latest turn as it went: what it said first, its three calls, the subagent's report, its reply
  expect(await afterLast(card)).toEqual([
    "mh-said ●I’ll delegate",
    "mh-cmd Script text(AL",
    "mh-cmd Agent echo_hi",
    "mh-cmd wait_agent",
    "mh-said ●Subagent's re",
    "mh-reply done",
  ]);
  const body = card.locator(".mh-body");
  await expect.poll(() => body.evaluate((b) => b.scrollHeight - b.scrollTop - b.clientHeight)).toBeLessThan(8); // at its end
  const c = await box(card),
    s = await box(strip);
  expect(c.y + c.height).toBeLessThanOrEqual(s.y); // over what is above the pane
  await lines.nth(1).focus(); // from the keyboard: a line focused shows it too, Esc closes it
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(lines.nth(1)).toBeFocused();
  // a message clicked: the chat shown again, that turn picked
  await page.mouse.move(700, 300);
  await lines.nth(0).hover();
  await expect(card).toBeVisible();
  await card.locator(".mh-you", { hasText: "Implement the plan." }).click();
  await expect(strip).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(page.locator("#main .fl-turn.on")).toContainText("Implement the plan.");
});

test("a pane in a frame, minimized: its card over the page around it; an earlier turn opened, its commands fetched", async ({
  page,
}) => {
  await taskHome(page, true); // Codex and Claude, one task, side by side
  await open(page);
  await taskRow(page).click();
  await expect(other(page)).toHaveCount(1);
  await addNotepad(page, taskRow(page));
  await expect(notes(page)).toHaveCount(1);
  const frame = other(page).frameLocator("iframe");
  await minimize(frame).click(); // Claude's
  const lines = frame.locator("#main > .chat.mini .mini-hist .mh-row");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText("/probe-greet Bob");
  await expect(lines.nth(1)).toContainText("Ahoy, Bob!");
  await page.mouse.move(700, 300);
  await lines.nth(1).hover();
  const card = page.locator(".mh-card");
  await expect(card).toBeVisible();
  await expect(frame.locator(".mh-card")).toHaveCount(0); // not in its frame, no taller than its strip
  await expect(card.locator(".mh-sep")).toHaveCount(15);
  expect(await afterLast(card)).toEqual(["mh-cmd Load skill pro", "mh-reply Ahoy, Bob!"]);
  const c = await box(card),
    f = await box(other(page));
  expect(c.y + c.height).toBeLessThanOrEqual(f.y + 1); // above the pane, over the Notepad
  // an earlier turn: folded to its commands' count; opened, its six commands fetched
  const plan = card.locator('.mh-sum[data-turn="3"]');
  await expect(plan).toHaveText(/6 commands/);
  await plan.click();
  await expect(card.locator(".mh-cmd")).toHaveCount(7);
  // a command opened: the call and its output, as the commands list shows it
  await card.locator(".mh-cmd .line").first().click();
  await expect(card.locator(".mh-cmd.open .cv")).toHaveCount(1);
  await page.mouse.move(5, 5); // off the line and the card: closed
  await expect(card).toHaveCount(0);
});
