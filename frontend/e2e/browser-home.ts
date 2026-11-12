// The Browser's panel in the e2e tests (browser.spec.ts): its actor and its instance in the test home, its panel and
// its stream, scripted -- the test home has no Browser, nor a Chrome to run one.
import type { FrameLocator, Page } from "@playwright/test";
import { streamsAsRequests } from "./test";
import { CLAUDE, GATHERER, openActor } from "./home";

export const KEY = "0123456789abcdef";

/** The test home's Claude Code actor (CLAUDE) as a Browser's (its session's `role`), the Browser an instance of the
 * app attached to it, the two one task (as the server keeps an app and the agent it started: task_links.py); the home's
 * own stream held back, so it does not replace this one. Every request of its panel's to its backend answered {} unless
 * a test says otherwise (routes added later are tried first). */
export async function browserActors(page: Page) {
  let channel = "";
  const task = () => ({ tasks: [{ id: 99, name: "" }], tasked: { [channel]: 99, [`app:${KEY}`]: 99 } });
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    for (const a of home.gatherers.find((g: { name: string }) => g.name === GATHERER).agents)
      if (a.harness === "claude") {
        a.session = { ...(a.session || {}), role: JSON.stringify({ app: "browser", key: KEY }) };
        channel = a.channel;
      }
    home.tasks = { ...(home.tasks || {}), [GATHERER]: task() };
    await route.fulfill({ json: home });
  });
  await page.route("**/api/apps?gatherer=*", async (route) => {
    const got = await (await route.fetch()).json();
    got.instances.push({ id: KEY, app: "browser", gatherer: GATHERER, folder: "/work", title: "work", data: {} });
    got.attached[KEY] = [channel];
    got.tasks = task();
    await route.fulfill({ json: got });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await page.route(`**/api/w/*/${KEY}/**`, (route) => route.fulfill({ json: {} }));
}
/** The Browser's actor shown -- its row a task's, with its Browser -- the pointer then off the list, so the task's card
 * (live while hovered) does not lie over the panel. */
export async function openOwn(page: Page) {
  await openActor(page, CLAUDE);
  await page.mouse.move(0, 0);
}
/** The Browser's panel: its frame, on the app's own origin, above the actor. */
export const panel = (page: Page): FrameLocator => page.frameLocator("#top-row .app-pane[data-app=browser] iframe");

/** The Browser's stream: its state as ag_apps/browser/core.py's `state` sends it, as server-sent events; joined again `retry` ms
 * after it ends. */
export const events = (states: object[], frame: string, retry = 150) =>
  `retry: ${retry}\n\nevent: frame\ndata: ${JSON.stringify({ data: frame, w: 800, h: 600 })}\n\n` +
  states
    .map(
      (s) =>
        `event: state\ndata: ${JSON.stringify({
          tabs: [{ title: "Invoices", url: "https://example.com/invoices", loading: false }],
          active: 0,
          picks: [],
          acting: null,
          dialog: null,
          error: "",
          running: true,
          viewport: [800, 600],
          chrome: "own",
          allow: false,
          video: false,
          video_off: "",
          cursor: "",
          tip: null,
          popup: null,
          chooser: null,
          downloads: [],
          ...s,
        })}\n\n`,
    )
    .join("");
