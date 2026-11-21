// COORDINATOR AGENTS OVER FOLDERS (coordinators.py; features/layout/panes.js's crewButton and openCoordinator, features/list/list.js's
// crewRow): none until the reader starts one, over any folder -- a folder in a group, a group, a folder of groups, or
// everything (the list's head) -- from its owl. One over a folder is listed at the top of its folder, its face on the
// folder's line; one above groups, in a group of one of its own as the server lists it, at its node: the one over
// everything at the list's top, never as an actor on its own.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";

type Agent = { channel: string; harness?: string; [k: string]: unknown };
type Group = { name: string; agents: Agent[]; [k: string]: unknown };
const EDITOR = 7;
const OVER_ALL = "c0000000-0000-4000-8000-0000000000a1";
const crewOf = (a: Agent, over: string) =>
  Object.assign(a, { role: "coordinator", over, avatar: "roles/manager", last_user_message: null, name: null });

// The server's home, merged, with Claude Code in the folder Editor of demo -- and, as asked, the Codex actor the
// coordinator agent over Editor, and one over everything in its group of one
async function withEditor(page: Page, crews: { folder?: boolean; all?: boolean }) {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const claude = demo.agents.find((a) => a.harness === "claude")!;
    const codex = demo.agents.find((a) => a.harness === "codex")!;
    home.folders = {
      [GATHERER]: {
        folders: [{ id: EDITOR, parent: null, name: "Editor", closed: null }],
        filed: { [claude.channel]: EDITOR },
      },
    };
    if (crews.folder) crewOf(codex, `folder:${EDITOR}`);
    if (crews.all)
      home.gatherers.push({
        ...demo,
        name: `self:${OVER_ALL}`,
        alone: true,
        agents: [crewOf({ ...codex, channel: OVER_ALL, session: null }, "all")],
      });
    home.merged = true;
    home.harnesses = ["claude", "codex"]; // harnesses a coordinator agent can start on, as on a machine that has them
    for (const h of home.harnesses) home.harness_info[h] = { ...home.harness_info[h], runs: true };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
}

const folderLine = (page: Page) => page.locator("#agents .folder-line", { hasText: "Editor" });
const crews = (page: Page) => page.locator("#agents .agent.coordinator");

test("a folder's coordinator agent is listed at the top of its folder, its face on the folder's line", async ({
  page,
}) => {
  await withEditor(page, { folder: true });
  await open(page);
  await expect(folderLine(page).locator(".act.crew.on")).toBeVisible(); // its face, the folder folded
  await expect(page.locator("#agents .gatherer-row .act.crew.on")).toHaveCount(0); // the group has none of its own
  await folderLine(page).locator(".fbtn").click();
  const kids = page.locator("#agents .folder-line + .f-kids");
  await expect(kids.locator(".agent").first()).toHaveClass(/coordinator/); // first in its folder
  await expect(kids.locator(".agent", { hasText: CLAUDE })).toBeVisible();
  await expect(crews(page)).toHaveCount(1); // not at its group's top as well
});

test("a folder with none starts one over itself from its owl", async ({ page }) => {
  await withEditor(page, {});
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/coordinator", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: "not in this test" } });
  });
  await open(page);
  await expect(crews(page)).toHaveCount(0);
  await folderLine(page).hover();
  await folderLine(page).locator(".f-acts .act.crew").click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0].over).toBe(`folder:${EDITOR}`);
});

test("one over everything is listed at the list's top, not as an actor on its own", async ({ page }) => {
  await withEditor(page, { all: true });
  await open(page);
  await expect(page.locator("#agents .crew-top .agent.coordinator")).toBeVisible();
  await expect(page.locator("#agents .gatherer.alone")).toHaveCount(0);
  await expect(page.locator("#agents .aside-head .act.crew.on")).toBeVisible(); // the head's owl: it has one
  await expect(page.locator("#agents .agent", { hasText: CODEX })).toBeVisible(); // the group's own actors as ever
});
