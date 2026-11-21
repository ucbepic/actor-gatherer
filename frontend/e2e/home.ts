// What the tests share: the test home's actors (tests/web_home.py) and the page opened on them at its fixed clock.
import { expect, type Locator, type Page } from "@playwright/test";

/** When the test home's sessions were stored (web_home.py's AT), in seconds. */
export const AT = 1790874000;
/** When the tests run, as the page's clock and the served dashboard's say (web_home.py's NOW). */
export const NOW = AT + 3600;
export const GATHERER = "demo";
/** The actors' rows in the list, by what each shows: the Claude Code actor's name, the Codex actor's last request. */
export const CLAUDE = "Parser fixes";
export const CODEX = "Spawn one subagent";

/** The page at `url`, an hour after the sessions, the list loaded. Each test has a browser of its own, so nothing the
 * page keeps in it (the panes, the list's mode, the theme) carries over from another test. */
export async function open(page: Page, url = "/") {
  await page.clock.setFixedTime(new Date(NOW * 1000));
  await page.goto(url);
  await expect(page.locator("#agents")).toContainText(GATHERER);
}

/** Once the page's stream has sent its first home: the page settled on what the server says, not only on its first
 * /api/home. The page opens its stream only once its first loads are done, so a test that moves the clock on before then
 * has that home come to a list already moved on. Called before the page is opened. */
export function streamHome(page: Page): Promise<void> {
  return new Promise((done) =>
    page.on("websocket", (ws) => {
      if (!/\/api\/ws$/.test(ws.url())) return;
      ws.on("framereceived", (f) => {
        if (typeof f.payload === "string" && f.payload.split("\n", 2)[1] === "home") done();
      });
    }),
  );
}

/** The page with the actor whose row shows `text` picked in the list. */
export async function openActor(page: Page, text: string) {
  await open(page);
  await page.locator("#agents .agent", { hasText: text }).click();
}

/** What a screenshot covers: the home's path (a temporary folder, other on each run). */
export const masks = (page: Page) => [page.locator("#home"), page.locator(".cfg-path")];

/** `l`'s box once it has one. A row of the list is drawn again as what is shown changes (tab numbers, the task shown),
 * and one measured just as it is replaced has no box: measured again, on the row drawn now. */
export async function settledBox(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let b: Awaited<ReturnType<Locator["boundingBox"]>> = null;
  await expect.poll(async () => (b = await l.boundingBox()) !== null).toBe(true);
  return b!;
}
