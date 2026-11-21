// A folder made outside every group is a group of its own, and a group dropped into another is a folder of it
// (features/list/gatherer-folders.ts's nameGroup; features/list/group-moves.ts's askMerge; groups.py's `make` and `merge`): the list head's
// folder button names a new group in place -- a folder at the list's top is a group, by the default rule -- and a group's row dragged onto another group asks first, then is merged into it.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { closeManage, manage, mgRow } from "./manage";

const LAB = "lab";
const LAB_ACTOR = "Lab notes";
const MADE = 41; // the folder the merged group becomes, in lab

type Agent = { channel: string; harness?: string; [k: string]: unknown };
type Group = { name: string; agents: Agent[]; [k: string]: unknown };

// The server's home on its one database, with a second group, `lab`, of one actor; `made` lists a new group, as the
// server does once it is made; `merged`, demo as a folder of lab.
async function home(page: Page, state: { made: string | null; merged: boolean }) {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const codex = demo.agents.find((a) => a.harness === "codex")!;
    const lab: Group = {
      ...demo,
      name: LAB,
      agents: [
        {
          ...codex,
          channel: "1ab00000-0000-4000-8000-0000000000a1",
          session: null,
          status: "idle",
          last_user_message: LAB_ACTOR,
          name: null,
        },
      ],
    };
    if (state.merged) {
      lab.agents.push(...demo.agents);
      home.gatherers = home.gatherers.filter((x: Group) => x.name !== GATHERER);
      home.folders = {
        ...home.folders,
        [LAB]: {
          folders: [{ id: MADE, parent: null, name: GATHERER, closed: null }],
          filed: Object.fromEntries(demo.agents.map((a) => [a.channel, MADE])),
        },
      };
    }
    home.gatherers.push(lab);
    if (state.made) home.gatherers.push({ ...lab, name: "Paper_figures", agents: [] });
    if (state.made) home.titles = { ...home.titles, Paper_figures: state.made };
    home.merged = true;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
}

const groupRow = (page: Page, name: string) => page.locator("#agents .gatherer-row", { hasText: name });

test("a folder made at the list's top is a group of its own, named as typed", async ({ page }) => {
  const state = { made: null as string | null, merged: false };
  await home(page, state);
  const asked: Record<string, unknown>[] = [];
  let answer = () => {};
  await page.route("**/api/groups", async (route) => {
    asked.push(route.request().postDataJSON());
    await new Promise<void>((done) => (answer = done)); // held: the group's line shows meanwhile
    state.made = "Paper figures";
    await route.fulfill({
      json: { made: { group: "Paper_figures", title: "Paper figures" }, titles: {}, gatherer_folders: {} },
    });
  });
  await open(page);
  const button = page.locator("#agents .aside-head .gf-new");
  await expect(button).toHaveAttribute("title", "New folder");
  await expect(page.locator(".aside-head").getByRole("button", { name: "+ New group" })).toHaveCount(0); // the button is it
  await button.click();
  const box = page.locator("#agents .folder-box");
  await expect(box).toHaveAttribute("placeholder", "Folder name");
  await expect(page.locator("#agents .gf-kind")).toHaveCount(0); // no "Folder only" switch: the list says nothing of groups
  await box.fill(GATHERER.toUpperCase()); // a group beside it has that name: refused, nothing asked
  await box.press("Enter");
  await expect(box).toHaveCount(0);
  await expect(page.locator("#agents .gf-line.making")).toHaveCount(0);
  await button.click();
  await box.fill("  Paper   figures ");
  await box.press("Enter");
  await expect(page.locator("#agents .gf-line.making")).toContainText("Paper figures");
  answer();
  await expect(groupRow(page, "Paper figures")).toBeVisible();
  await expect(page.locator("#agents .gf-line.making")).toHaveCount(0);
  expect(asked).toEqual([{ do: "new", name: "Paper figures", folder: null }]);
  await expect(page.locator("#agents .gf-line")).toHaveCount(0); // no folder of groups made
});

test("a group dragged onto another is a folder of it with all its actors: asked in Manage groups, at once in the list", async ({
  page,
}) => {
  const state = { made: null as string | null, merged: false };
  await home(page, state);
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/groups", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    if (body.do === "merge_plan")
      return route.fulfill({
        json: {
          from: GATHERER,
          to: LAB,
          into: null,
          folder: GATHERER,
          actors: 2,
          before: { [GATHERER]: 2, [LAB]: 1 },
          apps: [],
        },
      });
    state.merged = true;
    return route.fulfill({
      json: {
        merged: { group: LAB, folder: MADE, name: GATHERER, actors: [], apps: [], joined: {}, from: GATHERER },
        folders: {},
        tasks: {},
      },
    });
  });
  await open(page);
  const dialog = page.locator("dialog.mv-dialog");
  await expect(groupRow(page, GATHERER)).toHaveAttribute("draggable", "true");
  await manage(page); // in Manage groups: asked first
  await mgRow(page, GATHERER).dragTo(mgRow(page, LAB));
  await expect(dialog.locator("h3")).toHaveText(`Merge ${GATHERER} into ${LAB}?`);
  await expect(dialog.locator(".mv-line").first()).toHaveText(
    `${GATHERER} becomes a folder of ${LAB}, named ${GATHERER}, with everything in it.`,
  );
  await expect(dialog.locator(".mv-line").nth(1)).toHaveText(
    `Its 2 actors and the 1 actor of ${LAB} will share context with each other.`,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(asked.map((b) => b.do)).toEqual(["merge_plan"]); // asked, nothing merged
  await closeManage(page);
  await expect(groupRow(page, GATHERER)).toBeVisible();

  await groupRow(page, GATHERER).dragTo(groupRow(page, LAB)); // in the list: at once
  await expect.poll(() => asked.at(-1)).toEqual({ gatherer: GATHERER, to: LAB, into: null, do: "merge" });
  expect(asked.map((b) => b.do)).toEqual(["merge_plan", "merge"]);
  await expect(dialog).toBeHidden();
  await expect(groupRow(page, GATHERER)).toHaveCount(0);
  const lab = page.locator("#agents .gatherer", { has: page.locator(".gatherer-row", { hasText: LAB }) });
  const folder = lab.locator(".folder-line", { hasText: GATHERER });
  await expect(folder.locator(".fbtn")).toHaveAttribute("aria-expanded", "true"); // opened, to show where it went
  for (const actor of [CLAUDE, CODEX]) await expect(lab.locator(".f-kids .agent", { hasText: actor })).toBeVisible();
});

test("a group is not merged into itself, nor dragged at all with a database per gatherer", async ({ page }) => {
  const state = { made: null as string | null, merged: false };
  await home(page, state);
  let asked = 0;
  await page.route("**/api/groups", (route) => {
    asked++;
    return route.abort();
  });
  await open(page);
  await groupRow(page, GATHERER).dragTo(page.locator("#agents .agent", { hasText: CLAUDE })); // its own actor
  await expect(page.locator("dialog.mv-dialog")).toHaveCount(0);
  expect(asked).toBe(0);
  await page.unroute("**/api/home");
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    home.merged = false;
    await route.fulfill({ json: home });
  });
  await page.reload();
  await expect(groupRow(page, GATHERER)).not.toHaveAttribute("draggable", "true");
});
