// A minimized pane's HISTORY (src/features/chat/mini-history.js): right of its message box, the user's last message and what
// the actor said last; hovered, the whole conversation in a card over what is above the pane -- each turn's message, its
// commands with its messages among them in the order they came (files.py's reply `after`), its reply; an earlier turn
// folded to its count of commands, fetched when opened. A pane in a frame, only as tall as its strip, has its card drawn
// in the page around it. A message in the card clicked: the chat shown again at that turn. Its turn over, the actor's
// avatar on its line, and under the card's last turn, is Chat's done avatar: a green check at its corner.
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
  const codex = page.locator("#agents .agent", { hasText: CODEX });
  await codex.click();
  await addNotepad(page, codex);
  await expect(notes(page)).toHaveCount(1);
  await minimize(page).click();
  const strip = page.locator("#main > .chat.mini");
  const lines = strip.locator(".mini-hist .mh-row");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText("Spawn one subagent"); // the user's last message
  await expect(lines.nth(1)).toContainText("done"); // the first line of the agent's last
  await expect(lines.nth(1).locator(".ic.me.at-rest > img + .mk.ok > svg")).toHaveCount(1); // its turn over: done, a check
  await expect(lines.nth(1).locator(".mk:not(.ok)")).toHaveCount(0);
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
    "mh-now ", // the actor done under it, as in Chat
  ]);
  await expect(card.locator(".mh-body > .mh-now.rested > .mh-me.me.at-rest > .mk.ok")).toHaveCount(1);
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

test("a minimized pane's card, opened again for the same line, keeps its place: the pointer back on the line from the card", async ({
  page,
}) => {
  await open(page);
  const codex = page.locator("#agents .agent", { hasText: CODEX });
  await codex.click();
  await addNotepad(page, codex);
  await expect(notes(page)).toHaveCount(1);
  await minimize(page).click();
  const line = page.locator("#main > .chat.mini .mini-hist .mh-row").nth(1);
  await expect(line).toContainText("done");
  await page.mouse.move(700, 300);
  await line.hover();
  const card = page.locator(".mh-card");
  await expect(card).toBeVisible();
  const body = card.locator(".mh-body");
  const left = () => body.evaluate((b) => b.scrollHeight - b.scrollTop - b.clientHeight);
  await expect.poll(left).toBeLessThan(8); // opened at its end
  const c = await box(card);
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 }); // into the card...
  await line.hover(); // ...and back onto its line: the card opened again for it
  await page.waitForTimeout(400);
  await expect(card).toBeVisible();
  expect(await left()).toBeLessThan(8); // still at its end, not at its top
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
  expect(await afterLast(card)).toEqual(["mh-cmd Load skill pro", "mh-reply Ahoy, Bob!", "mh-now "]);
  await expect(lines.nth(1).locator(".ic.at-rest > .mk.ok")).toHaveCount(1);
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

// The line between a minimized pane's message box and its last lines, dragged: the box's share of the room the two take,
// kept in this browser for every minimized pane -- a pane in a frame told too -- and double-clicked, as it was.
test("a minimized pane's line between its box and its last lines, dragged: the room shared so, kept; double-clicked, as it was", async ({
  page,
}) => {
  await taskHome(page, true); // Codex and Claude, one task, side by side
  await open(page);
  await taskRow(page).click();
  await expect(other(page)).toHaveCount(1);
  await addNotepad(page, taskRow(page));
  await expect(notes(page)).toHaveCount(1);
  const frame = other(page).frameLocator("iframe");
  await minimize(page).click(); // this page's own pane (Codex), and the one beside it in a frame (Claude) with it
  const strip = page.locator("#main > .chat.mini"),
    fstrip = frame.locator("#main > .chat.mini");
  const widths = async (s: Locator) => [
    (await box(s.locator(":scope > .composer"))).width,
    (await box(s.locator(":scope > .mini-hist"))).width,
  ];
  await expect(strip.locator(":scope > .mini-hist")).toBeVisible();
  await expect(fstrip.locator(":scope > .mini-hist")).toBeVisible();
  const [b0, h0] = await widths(strip);
  expect(b0 / (b0 + h0)).toBeCloseTo(0.4, 1); // two parts in five at first
  const [fb0, fh0] = await widths(fstrip);
  const grip = strip.locator(":scope > .mini-grip");
  const g = await box(grip);
  expect(Math.abs(g.x + g.width / 2 - (await box(strip.locator(":scope > .mini-hist"))).x)).toBeLessThan(2); // on the line
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2, { steps: 4 });
  await expect(page.locator(".mh-card")).toHaveCount(0); // over the lines while dragging: no card
  await page.mouse.move(g.x + g.width / 2 + 100, g.y + 4, { steps: 4 });
  await page.mouse.up();
  const [b1, h1] = await widths(strip);
  expect(Math.abs(b1 - (b0 + 100))).toBeLessThan(2); // the box 100px wider, the lines as much narrower
  expect(Math.abs(b1 + h1 - (b0 + h0))).toBeLessThan(2);
  const kept = Number(await page.evaluate(() => localStorage.getItem("ag-dashboard-mini-split")));
  expect(kept).toBeCloseTo(b1 / (b1 + h1), 2);
  // the pane in a frame: told, the same share
  await expect
    .poll(async () => {
      const [b, h] = await widths(fstrip);
      return Math.round((b / (b + h)) * 100);
    })
    .toBe(Math.round(kept * 100));
  expect(Math.abs((await widths(fstrip)).reduce((a, b) => a + b) - (fb0 + fh0))).toBeLessThan(2);
  // a share too small for a pane (made in a wider one): its box held at 150px, the lines the rest -- the room still filled
  await page.evaluate(() => localStorage.setItem("ag-dashboard-mini-split", "0.2"));
  await expect.poll(async () => Math.round((await widths(fstrip))[0])).toBe(150);
  expect(Math.abs((await widths(fstrip)).reduce((a, b) => a + b) - (fb0 + fh0))).toBeLessThan(2);
  // as far left as it goes: the box 150px at the least, the lines the rest -- the two still the whole room
  const g0 = await box(grip);
  await page.mouse.move(g0.x + g0.width / 2, g0.y + g0.height / 2);
  await page.mouse.down();
  await page.mouse.move(g0.x - 2000, g0.y + g0.height / 2, { steps: 4 });
  await page.mouse.up();
  const [bl, hl] = await widths(strip);
  expect(Math.abs(bl - 150)).toBeLessThan(2);
  expect(Math.abs(bl + hl - (b0 + h0))).toBeLessThan(2);
  // as far right as it goes: the lines 140px at the least
  const g1 = await box(grip);
  await page.mouse.move(g1.x + g1.width / 2, g1.y + g1.height / 2);
  await page.mouse.down();
  await page.mouse.move(g1.x + 2000, g1.y + g1.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(Math.abs((await widths(strip))[1] - 140)).toBeLessThan(2);
  // kept: the page loaded again, the pane minimized again
  await page.reload();
  await expect(strip.locator(":scope > .mini-hist")).toBeVisible();
  expect(Math.abs((await widths(strip))[1] - 140)).toBeLessThan(2);
  // double-clicked: as it was, here and in the frame
  await strip.locator(":scope > .mini-grip").dblclick();
  const [b2, h2] = await widths(strip);
  expect(b2 / (b2 + h2)).toBeCloseTo(0.4, 1);
  expect(await page.evaluate(() => localStorage.getItem("ag-dashboard-mini-split"))).toBeNull();
  await expect
    .poll(async () => {
      const [b, h] = await widths(fstrip);
      return Math.round((b / (b + h)) * 100);
    })
    .toBe(Math.round((fb0 / (fb0 + fh0)) * 100));
  // dragged in the frame, out of it and up over the Notepad's frame, let go there: the drag over in both pages, kept
  const fg = await box(frame.locator("#main > .chat.mini > .mini-grip")),
    fp = await box(other(page));
  await page.mouse.move(fg.x + fg.width / 2, fg.y + fg.height / 2);
  await page.mouse.down();
  await page.mouse.move(fg.x + fg.width / 2 + 40, fg.y + fg.height / 2, { steps: 3 });
  await expect(frame.locator("html")).toHaveAttribute("data-mini-drag", "here");
  await expect(page.locator("html")).toHaveAttribute("data-mini-drag", "frame");
  await expect(strip.locator(":scope > .mini-x")).toHaveCSS("cursor", "col-resize"); // the page around it too
  const after = (l: Locator) => l.evaluate((n) => getComputedStyle(n, "::after").width);
  expect(await after(frame.locator("#main > .chat.mini > .mini-grip"))).toBe("3px"); // its line drawn as dragged...
  expect(await after(strip.locator(":scope > .mini-grip"))).toBe("1px"); // ...not the page's own
  await page.mouse.move(fp.x - 150, fg.y + fg.height / 2, { steps: 4 });
  await page.mouse.move(fp.x - 200, fg.y - 120, { steps: 4 }); // over the Notepad
  await page.mouse.up();
  await expect(frame.locator("html")).not.toHaveAttribute("data-mini-drag");
  await expect(page.locator("html")).not.toHaveAttribute("data-mini-drag");
  await expect(fstrip.locator(":scope > .composer")).toHaveJSProperty("offsetWidth", 150); // as far left as it goes
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ag-dashboard-mini-split"))).not.toBeNull();
  await expect.poll(async () => Math.round((await widths(strip))[0])).toBeLessThan(Math.round(b0) - 10); // the page's own told
});
