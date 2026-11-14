// The Chat view's turns (page.html's filesTalk; features/chat/ since A5): an earlier turn's replies folded and shown, its
// earlier messages behind a +, the latest reply folded, the earlier turns pulled in as the reader scrolls up past the
// top, a turn's notes and its latest call, and the folds kept across views and started over for another actor.
import type { Page } from "@playwright/test";
import { chatAs, expect, test } from "./test";
import { CLAUDE, CODEX, masks, openActor } from "./home";

const talk = (page: Page) => page.locator("#main .fl-talk");
const turn = (page: Page, n: number) => page.locator(`#main #fl-turn-${n}`);
/** The turns drawn, by their numbers. */
const drawn = (page: Page) =>
  talk(page)
    .locator(":scope > .fl-turn")
    .evaluateAll((ns) => ns.map((n) => Number(n.id.replace("fl-turn-", ""))));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The page's clock moved on by a second: a pull counts only a while after the conversation reached its top. */
async function later(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(now + 1000));
}

/** A pull up at the conversation's top: a wheel up there, and another once the page's clock has moved on. */
async function pull(page: Page) {
  await talk(page).evaluate((n) => (n.scrollTop = 0));
  await talk(page).hover();
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(100); // the wheel heard before the clock moves
  await later(page);
  await page.mouse.wheel(0, -200);
}

/** The latest reply's summary: its dot, at its left (the message itself lies over the rest of it while open). */
const mainDot = (page: Page, n: number) =>
  turn(page, n)
    .locator("details.fl-reply.main > summary")
    .click({ position: { x: 4, y: 8 } });

test("says how many earlier turns are not drawn, and draws them as the reader scrolls up past the top", async ({
  page,
}) => {
  await openActor(page, CLAUDE);
  const earlier = page.locator("#main .fl-earlier");
  await expect(earlier).toHaveText("10 earlier turns · scroll up for more");
  expect(await drawn(page)).toEqual(range(10, 14));
  await pull(page);
  await expect(earlier).toHaveText("5 earlier turns · scroll up for more");
  expect(await drawn(page)).toEqual(range(5, 14));
  await pull(page);
  await expect(earlier).toHaveCount(0);
  expect(await drawn(page)).toEqual(range(0, 14));
});

test("keeps what the reader looks at in place as earlier turns come in above it", async ({ page }) => {
  await openActor(page, CLAUDE);
  // its turns drawn: the actor shown before it, made smaller too, is kept at its end as well
  await expect(page.locator("#main .fl-earlier")).toHaveText("10 earlier turns · scroll up for more");
  await page.setViewportSize({ width: 1300, height: 440 }); // the conversation longer than its box
  await expect.poll(() => talk(page).evaluate((n) => n.scrollTop)).toBeGreaterThan(0); // kept at its end, smaller
  await talk(page).evaluate((n) => (n.scrollTop = 0));
  await page.waitForTimeout(100); // its scroll heard: at the top now
  const before = (await turn(page, 10).boundingBox())!.y;
  // wheels the page makes: they pull, without scrolling as a real one goes on to
  await turn(page, 10).dispatchEvent("wheel", { deltaY: -200 });
  await later(page);
  await turn(page, 10).dispatchEvent("wheel", { deltaY: -200 });
  await expect(page.locator("#main .fl-earlier")).toHaveText("5 earlier turns · scroll up for more");
  expect((await turn(page, 10).boundingBox())!.y).toBe(before);
  expect(await talk(page).evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
});

test("pulls earlier turns in by a key too, the focus in the conversation", async ({ page }) => {
  await openActor(page, CLAUDE);
  await turn(page, 10).locator(".fl-user").focus();
  await page.keyboard.press("Home");
  await later(page);
  await page.keyboard.press("Home");
  await expect(page.locator("#main .fl-earlier")).toHaveText("5 earlier turns · scroll up for more");
});

test("shows an earlier turn's replies on a click on its message, and folds them again", async ({ page }) => {
  await openActor(page, CLAUDE);
  const t = turn(page, 12),
    message = t.locator(".fl-head .fl-user");
  await expect(t).toHaveClass("fl-turn folded");
  await expect(message).toHaveAttribute("aria-expanded", "false");
  await expect(t.locator(".fl-reply")).toHaveCount(0);
  await message.click();
  await expect(t).toHaveClass("fl-turn shown");
  await expect(message).toHaveAttribute("aria-expanded", "true");
  await expect(t.locator("details.fl-reply.main > .md")).toHaveText("ok");
  await message.click();
  await expect(t).toHaveClass("fl-turn folded");
  await expect(t.locator(".fl-reply")).toHaveCount(0);
});

test("shows a turn's earlier messages behind its +, and folds them again by its −", async ({ page }) => {
  await openActor(page, CLAUDE);
  await pull(page);
  await expect(page.locator("#main .fl-earlier")).toHaveText("5 earlier turns · scroll up for more");
  const t = turn(page, 7);
  await t.locator(".fl-head .fl-user").click();
  const more = t.locator("button.fl-more");
  await expect(more).toHaveText("+2 earlier messages");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(t.locator(".fl-minor > details.fl-reply")).toHaveCount(2);
  await more.click();
  await expect(more).toHaveText("−2 earlier messages");
  await expect(t.locator(".fl-minor > details.fl-reply")).toHaveCount(4);
  await expect(t.locator("#fl-r-7-0 > summary .first")).toHaveText("watching");
  await expect(page.locator("#main")).toHaveScreenshot("turns-more.png", { mask: masks(page) });
  await more.click();
  await expect(more).toHaveText("+2 earlier messages");
  await expect(t.locator(".fl-minor > details.fl-reply")).toHaveCount(2);
});

test("folds the latest reply to its first line, and keeps it so across views; another actor's pick starts over", async ({
  page,
}) => {
  await openActor(page, CLAUDE);
  const reply = turn(page, 14).locator("details.fl-reply.main");
  await expect(reply).toHaveAttribute("open", "");
  await mainDot(page, 14);
  await expect(reply).not.toHaveAttribute("open");
  await expect(reply.locator("summary .first")).toHaveText("Ahoy, Bob!");
  await expect(reply.locator("summary .first")).toBeVisible();
  // another view and back: still folded
  await page.locator("#controls").getByRole("button", { name: "Terminal" }).click();
  await expect(page.locator("#main .fl-talk")).toHaveCount(0);
  await page.locator("#controls").getByRole("button", { name: "Chat" }).click();
  await expect(reply).not.toHaveAttribute("open");
  // opened again by a click
  await mainDot(page, 14);
  await expect(reply).toHaveAttribute("open", "");
  await mainDot(page, 14);
  // another actor, then this one again: as at first
  await page.locator("#agents button.agent", { hasText: CODEX }).click();
  await expect(turn(page, 6)).toContainText("Spawn one subagent");
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  await expect(turn(page, 14)).toContainText("probe-greet");
  await expect(reply).toHaveAttribute("open", "");
});

test("shows a subagent's report among a turn's messages, folded to its line; thinking with nothing to read is not drawn", async ({
  page,
}) => {
  await openActor(page, CODEX);
  const report = turn(page, 6).locator("details.fl-reply.noted.report");
  await expect(report.locator("summary .lbl")).toHaveText("Subagent's report:");
  await expect(report.locator("summary .first")).toHaveText("echo_hi");
  await expect(report).not.toHaveAttribute("open");
  await report.locator("summary").click();
  await expect(report).toHaveAttribute("open", "");
  await expect(report.locator(".md")).toHaveText("echo hi output: hi");
  // the Codex session's thinking is all encrypted: none of it shown, not even its "Thought:"
  await expect(talk(page).locator(".fl-reply.thought")).toHaveCount(0);
  await expect(talk(page)).not.toContainText("Thought:");
  // an earlier turn's report, named by its task
  await openActor(page, CLAUDE);
  await pull(page);
  await turn(page, 6).locator(".fl-head .fl-user").click();
  const named = turn(page, 6).locator("details.fl-reply.noted.report");
  await expect(named.locator("summary .first")).toHaveText("sleepy helper");
  await named.locator("summary").click();
  await expect(named.locator(".md")).toHaveText("done");
});

test("shows an interrupted turn's latest call and how it stopped; the call opens to what it ran and printed", async ({
  page,
}) => {
  await openActor(page, CODEX);
  const t = turn(page, 5),
    call = t.locator("details.fl-reply.call");
  await expect(call.locator("summary")).toHaveText("●Ran:sleep 40");
  await expect(t.locator(".fl-stopped")).toHaveText("■Conversation interrupted");
  await call.locator("summary").click();
  await expect(call.locator(".cv pre.out")).toHaveText("aborted by user after 0.6s");
  await expect(page.locator("#main")).toHaveScreenshot("turns-call.png", { mask: masks(page) });
  // a call its harness rejected, in an earlier turn: failed, and the turn interrupted
  await openActor(page, CLAUDE);
  await pull(page);
  await pull(page);
  await expect(page.locator("#main .fl-earlier")).toHaveCount(0);
  const asked = turn(page, 2);
  await asked.locator(".fl-head .fl-user").click();
  await expect(asked.locator("details.fl-reply.call > summary")).toHaveText("●Failed:Ask: Tea or coffee?");
  await expect(asked.locator(".fl-stopped")).toHaveText("⎿Interrupted · What should Claude do instead?");
});

test("joins what was written mid-turn under the turn's message", async ({ page }) => {
  await openActor(page, CODEX);
  await expect(turn(page, 4).locator("button.fl-user.joined")).toHaveText("Number you like → Two");
  await openActor(page, CLAUDE);
  await pull(page);
  await expect(turn(page, 8).locator(".fl-user.joined")).toHaveText("Also tell me what 6 times 7 is.");
});

test("shows the latest turn over: the actor done under it", async ({ page }) => {
  await openActor(page, CLAUDE);
  await expect(talk(page).locator(":scope > .fl-done .done img")).toHaveCount(1);
  await expect(talk(page).locator(".fl-turn.on .fl-finished .now")).toHaveText("Done");
  await expect(talk(page).locator(".fl-turn.on .fl-stopped")).toHaveCount(0);
});

test("shows the actor at work once the stream says so, while its conversation's load is held up", async ({ page }) => {
  // the page's loads held up (a browser's connections all taken by streams: here, never answered); the stream, open
  // already, says the actor works -- in the view it sends (chat_view.py's), which needs no load to be drawn
  let held = false;
  await page.route("**/api/files?*", (route) => (held ? undefined : route.continue()));
  const chat = await chatAs(page, (v) =>
    held ? { ...v, current: { ...(v.current as object), state: "working" } } : v,
  );
  await openActor(page, CLAUDE);
  await expect(talk(page).locator(".fl-turn.on .fl-finished .now")).toHaveText("Done");
  await page.waitForTimeout(300); // the actor's own loads over: their draw is not what shows it at work
  held = true;
  chat.again();
  await expect(talk(page).locator(".fl-working:not(.fl-finished) .now")).toHaveText("Working…", { timeout: 10_000 });
  await expect(talk(page).locator(":scope > .fl-done")).toHaveCount(0);
});

test("draws the actor's first turn once stored, where the actor waved hello", async ({ page }) => {
  // the actor's files, and what Chat shows of it (the stream's view), with no turn stored yet, until `stored`
  let stored = false;
  await page.route("**/api/files?*", (route) =>
    stored ? route.continue() : route.fulfill({ json: { turns: [], turn: null, files: [], commands: [], home: "" } }),
  );
  const chat = await chatAs(page, (v) =>
    stored ? v : { ...v, turns: [], opening: null, current: { state: "idle", turn: null }, waiting: [] },
  );
  // what the page says of its updates, each time it says it: a draw that failed says "Not updated", until the next
  const said: string[] = [];
  await page.exposeFunction("agSaid", (text: string) => said.push(text));
  await page.addInitScript(() =>
    new MutationObserver(() => {
      const live = document.getElementById("live");
      if (live?.textContent) (window as unknown as { agSaid: (t: string) => void }).agSaid(live.textContent);
    }).observe(document, { subtree: true, childList: true, characterData: true }),
  );
  await openActor(page, CLAUDE);
  await expect(talk(page)).toHaveClass("fl-talk hi");
  const hello = page.locator("#main .fl-hello");
  await expect(hello.locator(":scope > .stage-box > svg.stage.s-hello")).toHaveCount(1);
  await expect(hello).toHaveText("No messages yet."); // read only here: no line of its own to say
  // the page drawn again (Details opened and closed): the same actor waving, its endless animations running on -- once
  // the stream has drawn it, live
  await expect(page.locator("#live")).toContainText("Live");
  await page.waitForTimeout(500);
  const stage = hello.locator(":scope > .stage-box");
  await stage.evaluate((n) => {
    const endless = n.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations === Infinity);
    Object.assign(window, { agStage: n, agAnims: endless });
  });
  const details = page.locator("#controls .details-btn").last();
  await details.click();
  await page.waitForTimeout(300);
  await details.click();
  await page.waitForTimeout(300);
  const kept = await stage.evaluate((n) => {
    const w = window as unknown as { agStage: Element; agAnims: Animation[] };
    const endless = n.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations === Infinity);
    return [n === w.agStage, w.agAnims.length > 0 && endless.every((a, i) => a === w.agAnims[i])];
  });
  expect(kept).toEqual([true, true]);
  // stored: Chat picked again loads it, and draws it in place of the hello
  stored = true;
  chat.again();
  await page.locator("#controls").getByRole("button", { name: "Chat" }).click();
  await expect(page.locator("#main .fl-grid .fl-talk .fl-turn.on")).toContainText("probe-greet");
  expect(await drawn(page)).toEqual(range(10, 14));
  expect(said.filter((t) => t.startsWith("Not updated"))).toEqual([]);
});

test("starts every turn over as the setting has them, once it is picked", async ({ page }) => {
  await openActor(page, CLAUDE);
  const t = turn(page, 12);
  await t.locator(".fl-head .fl-user").click();
  await expect(t).toHaveClass("fl-turn shown");
  const pick = async (which: string) => {
    await page.locator("#about-btn").click();
    await page.locator(`[data-earlier-pick=${which}]`).click();
    await page.keyboard.press("Escape");
  };
  await pick("whole");
  await expect(t).toHaveClass("fl-turn");
  await expect(turn(page, 10)).toHaveClass("fl-turn");
  await pick("messages");
  await expect(t).toHaveClass("fl-turn folded");
});

test("an actor shown before is drawn at once when picked again, while its loads are held up", async ({ page }) => {
  // once each actor was shown, the loads held up: the actor's files never answered, and what Chat shows of it (the
  // stream's view) not passed on -- an actor not shown before waits on them ("Loading…"), one shown before is drawn as
  // it was last loaded
  let held = false;
  await page.route("**/api/files?*", (route) => (held ? undefined : route.continue()));
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      if (held && typeof m === "string" && m.split("\n")[1] === "chat") return;
      ws.send(m);
    });
  });
  const latest = talk(page).locator(".fl-turn.on");
  await openActor(page, CLAUDE);
  await expect(latest.locator(".fl-finished .now")).toHaveText("Done");
  const claude = await latest.textContent();
  await page.locator("#agents button.agent", { hasText: CODEX }).click();
  await expect(latest).not.toHaveText(claude!);
  await expect(page.locator("#main")).not.toContainText("Loading…");
  held = true;
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  await expect(latest).toHaveText(claude!, { timeout: 1000 });
  await expect(page.locator("#main")).not.toContainText("Loading…");
});
