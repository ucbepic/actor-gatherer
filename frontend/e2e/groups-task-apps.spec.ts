// A task moved to another group with its app (05-group-moves.js; groups.py): the list never shows it in both. The list
// knows each group's apps from /api/apps, read apart from the home -- so after a move, the home has the task in its new
// group while the old group's apps, as last read, still hold its app: drawn there on its own, a second row, until that
// group's apps are read again. The home says which group each open app is in now (`app_groups`), and the list takes
// that over what it read before.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, GATHERER, open } from "./home";

const LAB = "lab";
const APP = "Shopping list";

type Agent = { channel: string; harness?: string; [k: string]: unknown };
type Group = { name: string; agents: Agent[]; [k: string]: unknown };

const inGroup = (page: Page, name: string) =>
  page.locator("#agents .gatherer", { has: page.locator(".gatherer-row", { hasText: name }) });

// The server's home, merged, with a second group, lab: in demo, Claude Code and a Notepad ("Shopping list", n1, of many
// instances) one task -- until `state.moved`, then lab's. Each group's apps read as the server has them then: demo's,
// after the move, held back until `state.held` is settled.
async function taskWithApp(page: Page, state: { moved: boolean; claude: string; held: Promise<void> }) {
  const task = () => ({ tasks: [{ id: 1, name: "" }], tasked: { [state.claude]: 1, "app:n1": 1 } });
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const claude = demo.agents.find((a) => a.harness === "claude")!;
    state.claude = claude.channel;
    const lab: Group = { ...demo, name: LAB, agents: [] };
    if (state.moved) {
      lab.agents = [claude];
      demo.agents = demo.agents.filter((a) => a.channel !== claude.channel);
    }
    home.gatherers.push(lab);
    home.merged = true;
    home.tasks = { [state.moved ? LAB : GATHERER]: task() };
    home.app_groups = { n1: state.moved ? LAB : GATHERER };
    await route.fulfill({ json: home });
  });
  await page.route(/\/api\/apps(\?gatherer=[^&]*)?$/, async (route) => {
    const g = new URL(route.request().url()).searchParams.get("gatherer");
    if (g === GATHERER && state.moved) await state.held; // the old group's, slow to come
    const got = await (await route.fetch()).json();
    got.apps = (got.apps || []).map((a: { name: string }) => (a.name === "notepad" ? { ...a, instances: "many" } : a));
    const at = state.moved ? LAB : GATHERER;
    got.instances = g === at ? [{ id: "n1", app: "notepad", gatherer: at, folder: null, title: APP, data: {} }] : [];
    got.attached = g === at ? { n1: [state.claude] } : {};
    got.tasks = g === at ? task() : { tasks: [], tasked: {} };
    await route.fulfill({ json: got });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
}

test("in the home's one database, a task moved with its app is never listed in both groups", async ({ page }) => {
  let release = () => {};
  const state = { moved: false, claude: "", held: new Promise<void>((done) => (release = done)) };
  await taskWithApp(page, state);
  await page.route("**/api/groups", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ do: "move", gatherer: GATHERER, to: LAB });
    state.moved = true;
    return route.fulfill({
      json: { moved: { actors: [state.claude], apps: ["n1"], from: GATHERER, to: LAB }, folders: {}, tasks: {} },
    });
  });
  await open(page);
  const demoTask = inGroup(page, GATHERER).locator(".agent.task", { hasText: CLAUDE });
  await expect(demoTask.locator(".t-app")).toHaveCount(1); // the Notepad in it
  const rows = page.locator("#agents .agent", { hasText: new RegExp(`${CLAUDE}|${APP}`) });
  await expect(rows).toHaveCount(1);

  const labRead = page.waitForResponse((r) => r.url().endsWith(`/api/apps?gatherer=${LAB}`) && state.moved);
  await demoTask.dragTo(page.locator("#agents .gatherer-row", { hasText: LAB })); // in the list: at once
  await labRead; // lab's apps read since the move, demo's not yet: the list drawn for it
  await page.waitForTimeout(200);
  expect(await rows.count()).toBe(1); // not its task in lab and its app alone in demo

  release();
  const labTask = inGroup(page, LAB).locator(".agent.task", { hasText: CLAUDE });
  await expect(labTask.locator(".t-app")).toHaveCount(1); // its app with it
  await expect(inGroup(page, GATHERER).locator(".agent", { hasText: new RegExp(`${CLAUDE}|${APP}`) })).toHaveCount(0);
  expect(await rows.count()).toBe(1);
});
