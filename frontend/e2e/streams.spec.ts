// The page's streams on one WebSocket (src/core/api/stream.ts, ag_dashboard/api/ws.py): none of them holds one of the
// six connections a browser keeps open to the dashboard, so a second tab, or a page with many streams open, still
// gets its requests answered -- where streams of their own would have held every connection.
import { expect, test } from "./test";
import { CLAUDE, open, openActor } from "./home";

/** Whether a request from the page is answered within `ms`, or held back in the browser. */
const answered = (ms: number) =>
  Promise.race([
    fetch("/api/home", { cache: "no-store" }).then((r) => (r.ok ? "answered" : `failed ${r.status}`)),
    new Promise((ok) => setTimeout(() => ok("held"), ms)),
  ]);

test("the home and its actor come on the page's one socket", async ({ page }) => {
  const socket = page.waitForEvent("websocket", (ws) => new URL(ws.url()).pathname === "/api/ws");
  const said: string[] = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => said.push(String(f.payload).split("\n", 2).join(" "))));
  await openActor(page, CLAUDE);
  await socket;
  await expect.poll(() => said[0]).toBe("0 hello");
  // the actor's stream (opened again when it was picked: its own number), its home and its agent on it
  await expect
    .poll(() => said.filter((m) => /^\d+ (home|agent)$/.test(m)).map((m) => m.split(" ")[1]))
    .toEqual(expect.arrayContaining(["home", "agent"]));
  await expect(page.locator("#live")).toContainText("Live");
});

test("streams many at once leave the browser's connections free for its requests", async ({ page }) => {
  await open(page);
  // the browser's six held by streams of their own, as before: a request waits
  const held = await page.evaluate(async (fn) => {
    const answeredIn = new Function(`return (${fn})`)() as (ms: number) => Promise<string>;
    const own = Array.from({ length: 6 }, () => new EventSource("/api/stream"));
    await Promise.all(own.map((es) => new Promise((ok) => es.addEventListener("open", ok, { once: true }))));
    const got = await answeredIn(1500);
    own.forEach((es) => es.close());
    return got;
  }, answered.toString());
  expect(held).toBe("held");
  // as many and more on the page's socket: answered at once
  const free = await page.evaluate(async (fn) => {
    const answeredIn = new Function(`return (${fn})`)() as (ms: number) => Promise<string>;
    const on = Array.from({ length: 10 }, () => window.agPage.stream("/api/stream"));
    await Promise.all(on.map((s) => new Promise((ok) => s.addEventListener("home", ok, { once: true }))));
    const got = await answeredIn(5000);
    on.forEach((s) => s.close());
    return got;
  }, answered.toString());
  expect(free).toBe("answered");
});

test("a second tab gets its requests answered while the first stays open", async ({ page, context }) => {
  await openActor(page, CLAUDE);
  const second = await context.newPage();
  await openActor(second, CLAUDE);
  await expect(second.locator("#live")).toContainText("Live");
  expect(
    await second.evaluate(
      (fn) => (new Function(`return (${fn})`)() as (ms: number) => Promise<string>)(5000),
      answered.toString(),
    ),
  ).toBe("answered");
  await second.close();
});
