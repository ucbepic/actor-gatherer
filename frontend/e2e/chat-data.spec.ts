// Chat's data (features/chat/data.ts, files.ts): the turns as the stream's view has them, and a turn's files fetched
// beside them only when that view says the turns moved on -- not again at each home or agent the stream sends.
import type { Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, openActor } from "./home";

/** The page's stream as the server sends it, each `home` and `chat` kept so `again(name, change)` sends the latest
 * again, changed. */
async function streamAs(page: Page) {
  const last = new Map<string, [string, Record<string, unknown>]>();
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const [id, name, ...data] = typeof m === "string" ? m.split("\n") : [];
      if (name === "home" || name === "chat") last.set(name, [id, JSON.parse(data.join("\n"))]);
      ws.send(m);
    });
  });
  return {
    has: (name: string) => last.has(name),
    again: (name: string, change: (v: Record<string, unknown>) => Record<string, unknown>) => {
      const got = last.get(name);
      if (socket && got) socket.send(`${got[0]}\n${name}\n${JSON.stringify(change(structuredClone(got[1])))}`);
    },
  };
}

test("fetches a turn's files once, and again only when the stream's view says the turns moved on", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/files") asked.push(r.url());
  });
  const stream = await streamAs(page);
  await openActor(page, CLAUDE);
  await expect(page.locator("#main .fl-turn.on .fl-finished .now")).toHaveText("Done");
  await expect.poll(() => stream.has("home") && stream.has("chat")).toBe(true);
  await page.waitForTimeout(500); // the actor's own loads over
  const before = asked.length;
  // homes, as the stream sends one for any change anywhere: drawn, nothing fetched
  for (const n of [1, 2, 3]) stream.again("home", (h) => ({ ...h, now: (h.now as number) + n }));
  await page.waitForTimeout(1000);
  expect(asked.length).toBe(before);
  // the view the same but for its latest turn, gone on: its files fetched again, once
  stream.again("chat", (v) => {
    const turns = v.turns as { end?: number | null; calls?: number }[];
    const t = turns[turns.length - 1];
    t.end = (t.end ?? 0) + 1;
    return v;
  });
  await expect.poll(() => asked.length).toBe(before + 1);
  await page.waitForTimeout(500);
  expect(asked.length).toBe(before + 1);
});
