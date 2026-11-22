// The long lists (ag_dashboard/DESIGN.md, A5: react-virtuoso): a conversation of thousands of turns and a history of
// thousands of rows, only part of each on the page -- what is in sight and a few screens around it -- and all of it
// there to reach: the end followed as turns come, earlier turns pulled in with the reader's place kept, a turn far
// back picked and brought into view, the message box typed in as smoothly as beside a short one; History's rows all
// listed, selected across the list by a click and a shift-click, opened, Esc clearing them.
import type { Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./test";
import { AT, CLAUDE, NOW, openActor } from "./home";
import { addNotepad } from "./task-home";

const TURNS = 3000;
const ROWS = 4000;
const CLAUDE_CHANNEL = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";

/** A turn of the long conversation: its message, and the agent's answer. */
const turn = (n: number) => ({
  n,
  row_id: 100_000 + n,
  at: AT + n,
  end: AT + n + 5,
  text: `Question ${n}: what comes after ${n}?`,
  kind: "user",
  replies: [{ kind: "text", text: `${n + 1} comes after ${n}.` }],
  calls: 0,
});
const turns = (count: number) => Array.from({ length: count }, (_, n) => turn(n));

/** The page's streams as the server sends them, the Claude Code actor's conversation `count()` turns long, the actor
 * writable from here (its session the dashboard's, idle); `again()` sends the conversation again, as long as it is now. */
async function longChat(page: Page, count: () => number) {
  let last: [string, Record<string, unknown>] | null = null;
  let socket: WebSocketRoute | null = null;
  const long = (v: Record<string, unknown>) => ({
    ...v,
    turns: turns(count()),
    opening: null,
    waiting: [],
    current: { state: "done", turn: count() - 1 },
  });
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const [id, name, ...data] = typeof m === "string" ? m.split("\n") : [];
      const got = name === "chat" || name === "home" ? JSON.parse(data.join("\n")) : null;
      if (name === "chat") {
        last = [id, got];
        return ws.send(`${id}\nchat\n${JSON.stringify(long(got))}`);
      }
      if (name === "home") {
        for (const g of got.gatherers as { agents: Record<string, unknown>[] }[])
          for (const a of g.agents)
            if (a.channel === CLAUDE_CHANNEL)
              Object.assign(a, {
                session: { ...(a.session || {}), session_id: CLAUDE_CHANNEL, status: "idle" },
                chattable: true,
              });
        return ws.send(`${id}\nhome\n${JSON.stringify(got)}`);
      }
      ws.send(m);
    });
  });
  // its files feed's turns the same: the conversation as the page has it before the stream's view comes
  await page.route("**/api/files?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("channel") !== CLAUDE_CHANNEL) return route.continue();
    const got = await (await route.fetch()).json();
    const asked = url.searchParams.get("turn");
    return route.fulfill({
      json: { ...got, turns: turns(count()), turn: asked === null ? count() - 1 : Number(asked) },
    });
  });
  return {
    again: () => {
      if (socket && last) socket.send(`${last[0]}\nchat\n${JSON.stringify(long(last[1]))}`);
    },
  };
}

const talk = (page: Page) => page.locator("#main .fl-talk");
const earlier = (n: number) => `${n.toLocaleString("en-US")} earlier turns · scroll up for more`;
const onPage = (page: Page) => talk(page).locator(".fl-item > .fl-turn").count();
const fromEnd = (page: Page) => talk(page).evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight);

/** Layouts the page did in `ms`, as Chrome counts them. */
async function layoutsIn(page: Page, ms: number): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const count = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "LayoutCount")?.value ?? 0;
  const before = await count();
  await page.waitForTimeout(ms);
  return (await count()) - before;
}

/** A pull up at the conversation's top: a wheel up there, and another once the page's clock has moved on. */
async function pull(page: Page) {
  await talk(page).evaluate((n) => (n.scrollTop = 0));
  await talk(page).hover();
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(100);
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(now + 1000));
  await page.mouse.wheel(0, -200);
}

test("a conversation of thousands of turns: part of it on the page, the end followed, earlier turns pulled in, a turn far back brought into view", async ({
  page,
}, info) => {
  let count = TURNS;
  const chat = await longChat(page, () => count);
  const started = Date.now();
  await openActor(page, CLAUDE);
  const latest = page.locator(`#main #fl-turn-${TURNS - 1}`);
  await expect(latest).toBeInViewport();
  const opened = Date.now() - started;
  await expect(page.locator("#main .fl-earlier")).toHaveText(earlier(TURNS - 5));
  expect(await onPage(page)).toBe(5);
  await expect.poll(() => fromEnd(page)).toBeLessThan(1);
  await page.waitForTimeout(1500); // what the click started settles
  const idle = await layoutsIn(page, 3000);
  expect(idle).toBeLessThanOrEqual(1);

  // a turn comes, and an answer grows: followed at the end
  count = TURNS + 1;
  chat.again();
  await expect(page.locator(`#main #fl-turn-${TURNS}`)).toBeInViewport();
  await expect.poll(() => fromEnd(page)).toBeLessThan(1);

  // earlier turns pulled in: what the reader looks at kept in place (the conversation longer than its box)
  await page.setViewportSize({ width: 1300, height: 440 });
  await expect.poll(() => talk(page).evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
  await talk(page).evaluate((n) => (n.scrollTop = 0));
  await page.waitForTimeout(100);
  const kept = page.locator(`#main #fl-turn-${TURNS - 5}`); // the first drawn
  const y = (await kept.boundingBox())!.y;
  await pull(page);
  await expect(page.locator("#main .fl-earlier")).toHaveText(earlier(TURNS - 10));
  expect(await onPage(page)).toBe(11);
  expect((await kept.boundingBox())!.y).toBe(y);
  await page.setViewportSize({ width: 1300, height: 900 });

  // the first turn picked, from the minimized pane's card: every turn from it on in the list, only part on the page
  const row = page.locator("#agents button.agent", { hasText: CLAUDE });
  await addNotepad(page, row);
  await page.locator("button[aria-label='Minimize the chat']:visible").first().click();
  const line = page.locator("#main > .chat.mini .mini-hist .mh-row").first();
  await page.mouse.move(700, 300);
  await line.hover();
  const card = page.locator(".mh-card");
  await expect(card).toBeVisible();
  await card.locator(".mh-you").first().click();
  const first = page.locator("#main #fl-turn-0");
  await expect(first).toHaveClass(/\bon\b/);
  await expect(first).toBeInViewport();
  const top = await talk(page).evaluate((n) => {
    const t = document.getElementById("fl-turn-0")!;
    return t.getBoundingClientRect().top - n.getBoundingClientRect().top;
  });
  expect(Math.abs(top)).toBeLessThan(1); // at the top
  await expect(page.locator("#main .fl-earlier")).toHaveCount(0);
  const drawn = await onPage(page);
  expect(drawn).toBeGreaterThan(20);
  expect(drawn).toBeLessThan(400);

  // the latest again (the Notepad's panel closed, the pane's head shown: its "Latest"): brought to the end, though it
  // was not on the page
  await page.getByRole("button", { name: "Close Notepad panel (app stays open)" }).click();
  await page.locator("#controls").getByRole("button", { name: "Latest" }).click();
  await expect(page.locator(`#main #fl-turn-${TURNS}`)).toBeInViewport();
  await expect.poll(() => fromEnd(page)).toBeLessThan(1);
  expect(await onPage(page)).toBeLessThan(400);
  await expect(first).toHaveCount(0);

  // typing in the message box: each key handled within a frame or two, the conversation laid out only where it shows
  const box = page.locator("#composer-text");
  await box.click();
  await page.evaluate(() => {
    const w = window as unknown as { agKeys: number[] };
    w.agKeys = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === "keydown") w.agKeys.push(e.duration);
    }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });
  const typing = Date.now();
  await page.keyboard.type("A long message, typed in the box beside a conversation of thousands of turns. ".repeat(3));
  const typed = Date.now() - typing;
  await page.waitForTimeout(300);
  const slow = await page.evaluate(() => (window as unknown as { agKeys: number[] }).agKeys);
  expect(Math.max(0, ...slow)).toBeLessThan(100);
  await info.attach("measured", {
    body: JSON.stringify({ opened, idle, drawnAtFirstTurn: drawn, typedMs: typed, slowKeys: slow }),
    contentType: "application/json",
  });
  console.log(`long conversation: ${JSON.stringify({ opened, idle, drawn, typed, slow })}`);
});

/** History's outline of the Claude Code actor: `ROWS` turns, each a message and its answer. */
async function longOutline(page: Page) {
  await page.route("**/api/history/build", (route) => route.fulfill({ json: { started: false } }));
  await page.route("**/api/outline?*", (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get("after"));
    const events = after
      ? []
      : Array.from({ length: ROWS * 2 }, (_, i) => ({
          row_id: i + 1,
          channel: CLAUDE_CHANNEL,
          type: i % 2 ? "agent_message" : "user_message",
          text: i % 2 ? `answer ${(i - 1) / 2}` : `ask ${i / 2}`,
          tokens: 10,
          at: NOW - ROWS * 2 + i,
        }));
    return route.fulfill({ json: { events, tasks: [], builds: {}, more: false } });
  });
}

test("a history of thousands of rows: all listed, part on the page, selected across it, opened, cleared", async ({
  page,
}) => {
  await longOutline(page);
  await openActor(page, CLAUDE);
  await page.locator("#controls").getByRole("button", { name: "History" }).click();
  const list = page.locator("#main .h-list");
  const rows = list.locator(".h-row");
  await expect(rows.first()).toContainText("ask 0");
  const drawn = await rows.count();
  expect(drawn).toBeGreaterThan(20);
  expect(drawn).toBeLessThan(400);
  // the first row clicked, then -- at the end, past where 2,000 rows were drawn -- the last shift-clicked: all between
  await rows.first().locator(".h-main").click();
  await expect(rows.first()).toHaveClass(/\bon\b/);
  await list.evaluate((n) => (n.scrollTop = n.scrollHeight));
  const last = list.locator(".h-row.last");
  await expect(last).toContainText(`ask ${ROWS - 1}`);
  await last.locator(".h-main").click({ modifiers: ["Shift"] });
  await expect(last).toHaveClass(/\bon\b/);
  await expect(page.locator("#main .h-side.open .h-picked").first()).toContainText(
    `${(ROWS * 2).toLocaleString("en-US")} messages`,
  );
  expect(await rows.count()).toBeLessThan(400);
  // a row opened to its messages, by a double click
  await last.locator(".h-main").dblclick();
  await expect(list.locator(".h-row.message").last()).toContainText(`answer ${ROWS - 1}`);
  // Esc clears the selection
  await page.keyboard.press("Escape");
  await expect(list.locator(".h-row.on")).toHaveCount(0);
  // the list's timeline begins at the first row: back at the top
  await list.evaluate((n) => (n.scrollTop = 0));
  await expect(list.locator(".h-row.first")).toContainText("ask 0");
});
