// Moves between groups (05-group-moves.js; groups.py): in the home's one database, an actor dragged onto another
// group asks first -- who moves, from which group to which -- and moves only once the reader says so, and a folder
// dragged outside every group asks first, then is a group of its own, and an actor dragged there is on its own; with a
// database per gatherer, a drop into another group is refused, as every one was before.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, GATHERER, open } from "./home";

const LAB = "lab";
const LAB_ACTOR = "Lab notes";

type Agent = { channel: string; harness?: string; [k: string]: unknown };
type Group = { name: string; agents: Agent[]; [k: string]: unknown };

// The server's home, with a second group, `lab`, of one actor -- on the home's one database (`merged`) or not. Once
// `moved` names a channel, it is listed in lab, as the server lists it after the move.
async function twoGroups(page: Page, merged: boolean, moved: { channel: string | null }) {
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
    if (moved.channel) {
      lab.agents.push(...demo.agents.filter((a) => a.channel === moved.channel));
      demo.agents = demo.agents.filter((a) => a.channel !== moved.channel);
    }
    home.gatherers.push(lab);
    home.merged = merged;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
}

const row = (page: Page, text: string) => page.locator("#agents button.agent", { hasText: text });
const groupRow = (page: Page, name: string) => page.locator("#agents .gatherer-row", { hasText: name });
const inGroup = (page: Page, name: string, text: string) =>
  page
    .locator("#agents .gatherer", { has: page.locator(".gatherer-row", { hasText: name }) })
    .locator("button.agent", { hasText: text });

test("in the home's one database, an actor dragged onto another group asks first, then moves", async ({ page }) => {
  const moved = { channel: null as string | null };
  await twoGroups(page, true, moved);
  const asked: Record<string, unknown>[] = [];
  let claude = "";
  await page.route("**/api/groups", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    if (body.do === "plan")
      return route.fulfill({
        json: {
          actors: body.channels,
          from: GATHERER,
          to: LAB,
          folder: null,
          before: { [GATHERER]: 2, [LAB]: 1 },
          after: { [GATHERER]: 1, [LAB]: 2 },
        },
      });
    moved.channel = claude;
    return route.fulfill({
      json: { moved: { actors: body.channels, from: GATHERER, to: LAB }, folders: {}, tasks: {} },
    });
  });
  await open(page);
  claude = (await row(page, CLAUDE).getAttribute("data-key"))!.slice(GATHERER.length + 1); // `${group}/${channel}`
  const dialog = page.locator("dialog.mv-dialog");

  await row(page, CLAUDE).dragTo(page.locator(".aside-head")); // the list's head is no group: there it goes on its own,
  await expect(dialog.locator("h3")).toHaveText("Take it out of every group?"); // asked first, nothing sent till then
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(asked).toEqual([]);

  await row(page, CLAUDE).dragTo(groupRow(page, LAB));
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("h3")).toHaveText(`Move to the ${LAB} group?`);
  await expect(dialog.locator(".mv-line").first()).toHaveText(
    `${CLAUDE} moves from the ${GATHERER} group (1 other) to the ${LAB} group (1 other).`,
  );
  await expect(dialog.locator(".mv-line").nth(1)).toContainText(`share context with the actors of ${LAB}`);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(asked.map((b) => b.do)).toEqual(["plan"]); // asked, nothing moved
  await expect(inGroup(page, GATHERER, CLAUDE)).toBeVisible();

  await row(page, CLAUDE).dragTo(groupRow(page, LAB));
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(dialog).toBeHidden();
  expect(asked.at(-1)).toEqual({ gatherer: GATHERER, to: LAB, do: "move", channels: [claude], into: null });
  await expect(inGroup(page, LAB, CLAUDE)).toBeVisible();
  await expect(inGroup(page, GATHERER, CLAUDE)).toHaveCount(0);
});

test("with a database per gatherer, a drop into another group is refused, as before", async ({ page }) => {
  await twoGroups(page, false, { channel: null });
  let asked = 0;
  await page.route("**/api/groups", (route) => {
    asked++;
    return route.abort();
  });
  await page.route("**/api/folders", (route) => {
    asked++;
    return route.abort();
  });
  await open(page);
  await row(page, CLAUDE).dragTo(groupRow(page, LAB));
  await expect(page.locator("dialog.mv-dialog")).toHaveCount(0);
  await expect(inGroup(page, GATHERER, CLAUDE)).toBeVisible();
  expect(asked).toBe(0);
});

test("in the home's one database, a folder dragged outside every group asks first, then is a group of its own", async ({
  page,
}) => {
  const state = { split: false, claude: "" };
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const claude = demo.agents.find((a) => a.harness === "claude")!;
    state.claude = claude.channel;
    if (state.split) {
      home.gatherers.push({ ...demo, name: "Work", agents: [claude] });
      demo.agents = demo.agents.filter((a) => a.channel !== claude.channel);
    } else
      home.folders = {
        [GATHERER]: { folders: [{ id: 7, parent: null, name: "Work" }], filed: { [claude.channel]: 7 } },
      };
    home.merged = true;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/groups", async (route) => {
    asked.push(route.request().postDataJSON());
    state.split = true;
    await route.fulfill({
      json: { split: { group: "Work", actors: [state.claude], from: GATHERER }, folders: {}, tasks: {}, titles: {} },
    });
  });
  await open(page);
  const outside = page.locator(".outside-drop");
  await expect(outside).toBeHidden(); // shown only while a folder is dragged
  const work = page.locator("#agents .folder-line", { hasText: "Work" }); // by hand: the place shows once a drag starts
  await work.hover();
  await page.mouse.down();
  const at = (await work.boundingBox())!;
  await page.mouse.move(at.x + 20, at.y + at.height + 12, { steps: 4 });
  await expect(outside).toBeVisible();
  await outside.hover();
  await page.mouse.up();
  const dialog = page.locator("dialog.mv-dialog");
  await expect(dialog.locator("h3")).toHaveText("Make Work a group of its own?");
  await expect(dialog.locator(".mv-line").first()).toHaveText(
    "The folder Work becomes a group of its own, Work, and what is in it goes to the new group's top. " +
      `Its actor leaves the ${GATHERER} group (1 other) for it.`,
  );
  await dialog.getByRole("button", { name: "Make a group" }).click();
  await expect(dialog).toBeHidden();
  expect(asked).toEqual([{ gatherer: GATHERER, do: "split", folder: 7 }]);
  await expect(inGroup(page, "Work", CLAUDE)).toBeVisible();
  await expect(outside).toBeHidden();
});

test("in the home's one database, an actor dragged outside every group asks first, then is on its own", async ({
  page,
}) => {
  const state = { alone: false, claude: "" };
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const claude = demo.agents.find((a) => a.harness === "claude")!;
    state.claude = claude.channel;
    if (state.alone) {
      home.gatherers.push({ ...demo, name: `self:${claude.channel}`, alone: true, agents: [claude] });
      demo.agents = demo.agents.filter((a) => a.channel !== claude.channel);
    }
    home.merged = true;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/groups", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    if (body.do === "alone") {
      state.alone = true;
      return route.fulfill({
        json: {
          alone: { group: `self:${state.claude}`, actors: [state.claude], from: GATHERER },
          folders: {},
          tasks: {},
        },
      });
    }
    return route.fulfill({
      json: { actors: body.channels, from: body.gatherer, to: body.to, folder: null, before: {}, after: {} },
    });
  });
  await open(page);
  const outside = page.locator(".outside-drop");
  const claudeRow = row(page, CLAUDE);
  await claudeRow.hover(); // by hand: the place shows once a drag starts
  await page.mouse.down();
  const at = (await claudeRow.boundingBox())!;
  await page.mouse.move(at.x + 20, at.y + at.height + 12, { steps: 4 });
  await expect(outside).toHaveText("Outside every group: on its own");
  await outside.hover();
  await page.mouse.up();
  const dialog = page.locator("dialog.mv-dialog");
  await expect(dialog.locator("h3")).toHaveText("Take it out of every group?");
  await expect(dialog.locator(".mv-line").first()).toContainText(
    `${CLAUDE} leaves the ${GATHERER} group (1 other) and works on its own`,
  );
  await dialog.getByRole("button", { name: "Take it out" }).click();
  await expect(dialog).toBeHidden();
  expect(asked).toEqual([{ gatherer: GATHERER, do: "alone", channel: state.claude }]);
  const lone = page.locator("#agents .gatherer.alone");
  await expect(lone.locator(".alone-head")).toHaveText("own context");
  await expect(lone.locator("button.agent", { hasText: CLAUDE })).toBeVisible();
  await expect(inGroup(page, GATHERER, CLAUDE)).toHaveCount(0);

  await lone.locator("button.agent", { hasText: CLAUDE }).dragTo(groupRow(page, GATHERER)); // back into a group: asked first
  await expect(dialog.locator("h3")).toHaveText(`Move to the ${GATHERER} group?`);
  expect(asked.at(-1)).toEqual({
    gatherer: `self:${state.claude}`,
    to: GATHERER,
    do: "plan",
    channels: [state.claude],
  });
});
