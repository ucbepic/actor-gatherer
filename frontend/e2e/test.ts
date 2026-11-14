// Playwright's `test`, with one check more on every test: the page threw no error while it ran (an error in the page's
// script would otherwise pass unseen, its view drawn as far as it got). And after each, every agent it attached to an
// app's instance detached again: an actor opened opens the apps it is attached to with it (its task's, 07-panes.js's
// openTaskApps), so one a test left attached would open above a later test's view. The instances stay.
import { expect, test as base, type Locator, type Page, type WebSocketRoute } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await use(page);
    expect(errors, "errors thrown in the page").toEqual([]);
    await page.unrouteAll({ behavior: "ignoreErrors" }); // a request a test's route still answers, as it ends: let go
    await clearApps(page);
  },
});

/** Every app a test opened closed, and every task it made undone: an app open is a row of the list, and an actor in a
 * task one of its row's, in the tests after it. */
async function clearApps(page: Page) {
  type Listed = { instances: { id: string; gatherer: string }[] };
  type Home = { gatherers: { name: string }[]; tasks?: Record<string, { tasked: Record<string, number> }> };
  const home = (await (await page.request.get("/api/home")).json()) as Home;
  for (const g of home.gatherers) {
    const got = (await (await page.request.get(`/api/apps?gatherer=${encodeURIComponent(g.name)}`)).json()) as Listed;
    for (const i of got.instances || [])
      await page.request.post("/api/apps/close", { data: { gatherer: g.name, instance: i.id } });
  }
  const left = ((await (await page.request.get("/api/home")).json()) as Home).tasks || {};
  for (const [g, t] of Object.entries(left))
    if (Object.keys(t.tasked).length)
      await page.request.post("/api/tasks", { data: { gatherer: g, do: "out", items: Object.keys(t.tasked) } });
}
export { expect };

/** An app's panel's menu (07-panes.js's appPanelMenu: where it can be moved, and "Close its panel"), opened as the reader
 * opens it -- an app's panel has no head: its row in the list right-clicked (an app in a task: its row in the task's
 * card, the task's row hovered). */
export async function panelMenu(page: Page, pane: Locator): Promise<Locator> {
  const src = (await pane.locator("iframe").getAttribute("src")) || "";
  const id = new URL(src).searchParams.get("instance") || "";
  let row = page.locator(`#agents .app-row[data-instance="${id}"]`);
  if (!(await row.count())) {
    const tasks = page.locator("#agents button.agent.task");
    for (let i = 0; i < (await tasks.count()); i++) {
      await page.mouse.move(0, 0); // the pointer come from off the list: the card shown afresh
      await tasks.nth(i).hover();
      const card = page.locator("#actor-card.live");
      await expect(card).toBeVisible();
      row = card.locator(`.c-app-row[data-instance="${id}"] .c-row`);
      if (await row.count()) break;
    }
  }
  await row.click({ button: "right" });
  const menu = page.locator(".row-menu[role=menu]");
  await expect(menu).toHaveCount(1);
  return menu;
}

/** An app's panel (`pane`) closed, the app left open: "Close its panel" picked from its menu (panelMenu). */
export async function closePanel(page: Page, pane: Locator) {
  await (await panelMenu(page, pane)).getByRole("menuitem", { name: /Close its panel/ }).click();
  await page.mouse.move(0, 0); // the task's card, if one was shown for it, put away
}

/** An agent attached to an app's instance (or detached), as attaching it to the app's task does -- what the panel's
 * head's agents menu asked, before panels had no head. */
export async function attachTo(page: Page, gatherer: string, instance: string, channel: string, on = true) {
  const r = await page.request.post(`/api/apps/${on ? "attach" : "detach"}`, { data: { gatherer, instance, channel } });
  expect(r.ok()).toBe(true);
}

/** The page's streams each its own HTTP request, as before they shared a WebSocket (src/core/api/stream.ts): the socket
 * refused, so the page opens each as an EventSource -- which `page.route` can hold back or answer, as a socket's
 * messages it cannot. */
export const streamsAsRequests = (page: Page) => page.routeWebSocket(/\/api\/ws$/, (ws) => ws.close());

/** The page's streams as the server sends them, each `chat` (what Chat shows of the actor: chat_view.py's view) passed
 * through `change` on its way; `again()` sends the latest again, changed as `change` changes it now. */
export async function chatAs(page: Page, change: (view: Record<string, unknown>) => Record<string, unknown>) {
  let last: [string, Record<string, unknown>] | null = null;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const [id, name, ...data] = typeof m === "string" ? m.split("\n") : [];
      if (name !== "chat") return ws.send(m);
      last = [id, JSON.parse(data.join("\n"))];
      ws.send(`${id}\nchat\n${JSON.stringify(change(last[1]))}`);
    });
  });
  return {
    again: () => {
      if (socket && last) socket.send(`${last[0]}\nchat\n${JSON.stringify(change(last[1]))}`);
    },
  };
}

/** The page's homes as the server sends them, each passed through `change`; `again()` sends the latest again, changed
 * as `change` changes it now -- once the stream has sent one (`sent()`): the page's first home comes from /api/home, and
 * the stream sends one only when the home changes. */
export async function homeAs(page: Page, change: (home: Record<string, unknown>) => Record<string, unknown>) {
  const last = new Map<string, Record<string, unknown>>();
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const [id, name, ...data] = typeof m === "string" ? m.split("\n") : [];
      if (name !== "home") return ws.send(m);
      last.set(id, JSON.parse(data.join("\n")));
      ws.send(`${id}\nhome\n${JSON.stringify(change(structuredClone(last.get(id)!)))}`);
    });
  });
  return {
    again: () => {
      for (const [id, h] of last) socket?.send(`${id}\nhome\n${JSON.stringify(change(structuredClone(h)))}`);
    },
    sent: () => last.size > 0,
  };
}
