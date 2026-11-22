// The actor's other views (page.html: "the Terminal view", "the History view", "the Transcript view") and the Details
// panel beside the chat ("the selected agent", "the chat"'s context cards).
import type { WebSocketRoute } from "@playwright/test";
import { expect, homeAs, test } from "./test";
import { CLAUDE, CODEX, NOW, masks, open, openActor } from "./home";

const CLAUDE_CHANNEL = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";
const beside = process.platform === "darwin" ? "Meta" : "Control";

test("the Terminal view of a session with no terminal says so", async ({ page }) => {
  await openActor(page, CLAUDE);
  await page.locator("#controls").getByRole("button", { name: "Terminal" }).click();
  await expect(page.locator("#main")).toHaveScreenshot("terminal.png", { mask: masks(page) });
});

test("the History view lists the actor's history", async ({ page }) => {
  await openActor(page, CLAUDE);
  await page.locator("#controls").getByRole("button", { name: "History" }).click();
  await expect(page.locator("#main")).toContainText("probe-greet");
  await expect(page.locator("#main")).toHaveScreenshot("history.png", { mask: masks(page) });
});

test("two panes on History, side by side: each its own rows picked, its own panel", async ({ page }) => {
  await open(page);
  await page.locator("#agents button.agent", { hasText: CLAUDE }).click();
  await page.locator("#agents button.agent", { hasText: CODEX }).click({ modifiers: [beside] });
  const here = page.locator("#pane-here"),
    other = page.locator("#panes > .pane").nth(1);
  await expect(other).toHaveCount(1);
  await here.locator("#controls").getByRole("button", { name: "History" }).click();
  await other.locator(".controls").getByRole("button", { name: "History" }).click();
  const rowsOf = (pane: typeof here) => pane.locator(".hist .h-list .h-row");
  await expect(rowsOf(here).first()).toBeVisible();
  await expect(rowsOf(other).first()).toBeVisible();
  await rowsOf(here).first().locator(".h-main").click();
  await expect(rowsOf(here).first()).toHaveClass(/\bon\b/);
  await expect(here.locator(".h-side.open")).toHaveCount(1);
  await expect(other.locator(".hist .h-row.on")).toHaveCount(0); // not picked in the other's
  await expect(other.locator(".h-side.open")).toHaveCount(0);
  await rowsOf(other).first().locator(".h-main").click();
  await expect(other.locator(".h-side.open")).toHaveCount(1);
  await expect(rowsOf(here).first()).toHaveClass(/\bon\b/); // the first's kept
});

test("Details opens beside the chat, and closes", async ({ page }) => {
  await openActor(page, CLAUDE);
  const details = page.locator("#controls .details-btn").last();
  await details.click();
  await expect(page).toHaveScreenshot("details.png", { mask: masks(page) });
  await details.click();
});

test("Details is one panel: the actor, its context and the Gatherer's work, one under another", async ({ page }) => {
  // the Claude Code actor run by the dashboard, its message box open: for `/context`, below
  const homes = await homeAs(page, (home) => {
    for (const g of home.gatherers as { agents: Record<string, unknown>[] }[])
      for (const a of g.agents)
        if (a.channel === CLAUDE_CHANNEL)
          Object.assign(a, {
            session: { ...((a.session as object) || {}), session_id: CLAUDE_CHANNEL, status: "idle" },
            chattable: true,
          });
    return home;
  });
  await openActor(page, CLAUDE);
  await expect.poll(() => homes.sent()).toBe(true);
  await page.locator("#controls .details-btn").last().click();
  const drawer = page.locator(".drawer");
  await expect(drawer.locator(".drawer-head button")).toHaveCount(0); // no sides to pick, no × of its own
  await expect(drawer.locator(".drawer-part > h4")).toContainText(["Actor", "Context", "Gatherer"]);
  await expect(drawer.locator(".facts")).toBeVisible();
  await page.locator("#controls .details-btn").last().click(); // its button again closes it
  await expect(drawer).toHaveCount(0);
  // `/context` in the message box: the panel opened at its Context part
  await page.locator("#composer-text").fill("/context");
  await page.locator("#composer-text").press("Enter");
  const context = drawer.locator("#details-context");
  await expect(context).toBeInViewport();
  const top = await context.evaluate(
    (n) => n.getBoundingClientRect().top - n.closest(".drawer-body")!.getBoundingClientRect().top,
  );
  expect(Math.abs(top)).toBeLessThan(2);
});

test("an item opened in the Context panel stays open as the context grows", async ({ page }) => {
  // the actor as the stream brings it, sent again with an item more at the context's end: what ag stored since the
  // latest call (`after_read`), as each new message adds to it
  let last: [string, Record<string, unknown>] | null = null;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const [id, name, ...data] = typeof m === "string" ? m.split("\n") : [];
      if (name === "agent") last = [id, JSON.parse(data.join("\n"))];
      ws.send(m);
    });
  });
  await openActor(page, CLAUDE);
  await page.locator("#controls .details-btn").last().click();
  const items = page.locator(".drawer .ctx details.item");
  await expect(items.first()).toBeVisible();
  const before = await items.count();
  const opened = items.nth(1);
  await opened.locator("summary").click();
  await expect(opened.locator("pre")).toBeVisible();

  expect(last, "the actor's stream message").not.toBeNull();
  const [id, agent] = last!;
  const more = {
    position: null,
    group: "Stored since the latest call",
    name: "user_message",
    tokens: 3,
    row_id: 999999,
    made_id: null,
    at: NOW,
    clipped: 0,
    text: "a message stored after the latest call",
  };
  const grown = { ...agent, after_read: [...((agent.after_read as unknown[]) || []), more] };
  socket!.send(`${id}\nagent\n${JSON.stringify(grown)}`);

  await expect(items).toHaveCount(before + 1);
  await expect(items.last()).toContainText("a message stored after the latest call");
  await expect(items.nth(1)).toHaveJSProperty("open", true);
  await expect(items.nth(1).locator("pre")).toBeVisible();
});
