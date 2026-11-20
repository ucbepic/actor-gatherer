// Groups inside another group's folder, and the two settings (the Notes design "Groups: folders, defaults and Manage
// groups"; features/list/group-moves.js's placeOf, askOwn, askAbove, askAloneHere, askJoin; groups.py's `place`, `own`, `above`):
// a folder takes its parent's group or has its own, an actor has its folder's group or is on its own. The list says
// nothing of groups: a group placed in a folder is drawn there as a folder is, an actor on its own there as any actor,
// with no switch of theirs; a drop follows the default rule (into a folder: its group). Manage groups has the switches,
// each asking first.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, GATHERER, open } from "./home";
import { closeManage, manage, mgRow, panel } from "./manage";

const LAB = "lab";
const LAB_ACTOR = "Lab notes: read every paper on the reading list, sum each one up, and file the summaries by topic";
const ALONE_ACTOR = "Reads alone";
const WORK = 51; // demo's folder
const ALONE = "self:a1000000-0000-4000-8000-0000000000a2";

type Agent = { channel: string; harness?: string; [k: string]: unknown };
type Group = { name: string; agents: Agent[]; [k: string]: unknown };

// The home on its one database: demo, with a folder Work holding its Claude actor; lab, of one actor; an actor on its
// own. `places`: where lab and the actor on its own are placed, as the server says.
async function home(page: Page, places: Record<string, { in: string; folder: number | null }>) {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const codex = demo.agents.find((a) => a.harness === "codex")!;
    const claude = demo.agents.find((a) => a.harness !== "codex")!;
    const one = (channel: string, said: string) => ({
      ...codex,
      channel,
      session: null,
      status: "idle",
      last_user_message: said,
      name: null,
    });
    home.gatherers.push({ ...demo, name: LAB, agents: [one("1ab00000-0000-4000-8000-0000000000a1", LAB_ACTOR)] });
    home.gatherers.push({ ...demo, name: ALONE, alone: true, agents: [one(ALONE.slice(5), ALONE_ACTOR)] });
    home.folders = {
      ...home.folders,
      [GATHERER]: {
        folders: [{ id: WORK, parent: null, name: "Work", closed: null }],
        filed: { [claude.channel]: WORK },
      },
    };
    home.places = places;
    home.merged = true;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
}

const groupRow = (page: Page, name: string) => page.locator("#agents .gatherer-row", { hasText: name });
const workLine = (page: Page) => page.locator("#agents .folder-line", { hasText: "Work" });
const demoBox = (page: Page) =>
  page.locator("#agents > .gatherer", { has: page.locator(":scope > .gatherer-row", { hasText: GATHERER }) });

async function answering(page: Page, json: (body: Record<string, unknown>) => Record<string, unknown>) {
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/groups", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    await route.fulfill({ json: json(body) });
  });
  return asked;
}

test("a group and an actor on its own placed in a folder are drawn there, unmarked, with no group buttons", async ({
  page,
}) => {
  await home(page, { [LAB]: { in: GATHERER, folder: WORK }, [ALONE]: { in: GATHERER, folder: WORK } });
  await open(page);
  await workLine(page).locator(".fname").click(); // folded at first: opened, to show what is in it
  const work = demoBox(page).locator(".f-kids").first();
  await expect(work.locator(".gatherer.nested .gatherer-row", { hasText: LAB })).toBeVisible();
  await expect(work.locator("button.agent", { hasText: LAB_ACTOR })).toBeVisible();
  await expect(work.locator("button.agent", { hasText: ALONE_ACTOR })).toBeVisible();
  await expect(work.locator("button.agent", { hasText: CLAUDE })).toBeVisible(); // demo's own, beside them
  await expect(page.locator("#agents > .gatherer > .gatherer-row", { hasText: LAB })).toHaveCount(0); // not at the top too
  await expect(page.locator("#agents button.agent", { hasText: ALONE_ACTOR })).toHaveCount(1);
  // nothing of groups in the list: no marks, no switches on a folder, a nested group or an actor
  await expect(page.locator("#agents :is(.g-mark, .alone-mark, .group-btn, .act.own, .act.above)")).toHaveCount(0);
  await workLine(page).hover();
  await expect(workLine(page).locator(".f-acts button[aria-label*='group of its own']")).toHaveCount(0);
});

test("the list's head makes a folder, with no Folder only switch: at the top, a group by the default rule", async ({
  page,
}) => {
  await home(page, {});
  await open(page);
  const button = page.locator("#agents .aside-head .gf-new");
  await expect(button).toHaveAttribute("title", "New folder");
  await button.click();
  await expect(page.locator("#agents .folder-box")).toHaveAttribute("placeholder", "Folder name");
  await expect(page.locator("#agents .gf-kind")).toHaveCount(0);
});

test("a group dropped on another's folder in the list merges at once: it takes that folder's group", async ({
  page,
}) => {
  await home(page, {});
  const asked = await answering(page, () => ({
    merged: { group: GATHERER, folder: 60, name: LAB, actors: [], apps: [], joined: {}, from: LAB },
    folders: {},
    tasks: {},
  }));
  await open(page);
  await groupRow(page, LAB).dragTo(workLine(page));
  await expect.poll(() => asked).toEqual([{ gatherer: LAB, to: GATHERER, into: WORK, do: "merge" }]); // no plan, no question
  await expect(page.locator("dialog.mv-dialog")).toHaveCount(0);
});

test("Manage groups shows each group's folders and actors with their switches", async ({ page }) => {
  await home(page, { [LAB]: { in: GATHERER, folder: WORK }, [ALONE]: { in: GATHERER, folder: WORK } });
  await open(page);
  await manage(page);
  await expect(mgRow(page, GATHERER).locator(".mg-opt")).toHaveText(["Own group"]); // at the top: its own, the only option
  await expect(mgRow(page, GATHERER).locator(".mg-opt.on")).toHaveText("Own group");
  await expect(mgRow(page, "Work").locator(".mg-opt")).toHaveText([GATHERER, "Own group"]); // the group it is in, by name
  await expect(mgRow(page, "Work").locator(".mg-opt.on")).toHaveText(GATHERER);
  await expect(mgRow(page, LAB).locator(".mg-opt")).toHaveText([GATHERER, "Own group"]);
  await expect(mgRow(page, LAB).locator(".mg-opt.on")).toHaveText("Own group"); // inside Work: its own
  await expect(mgRow(page, ALONE_ACTOR).locator(".mg-opt")).toHaveText([GATHERER, "On its own"]);
  await expect(mgRow(page, ALONE_ACTOR).locator(".mg-opt.on")).toHaveText("On its own");
  await expect(mgRow(page, CLAUDE).locator(".mg-opt.on")).toHaveText(GATHERER);
  await expect(mgRow(page, LAB_ACTOR).locator(".mg-opt.on")).toHaveText(LAB); // in lab: lab's group, not demo's
  // highlighted: each row that starts a group of its own -- a group, at the top or inside a folder, an actor on its own
  for (const text of [GATHERER, LAB, ALONE_ACTOR]) await expect(mgRow(page, text)).toHaveClass(/\bdefines\b/);
  for (const text of ["Work", CLAUDE, LAB_ACTOR]) await expect(mgRow(page, text)).not.toHaveClass(/\bdefines\b/);
  // every switch inside the panel, whatever the length of the names beside it: none pushed past its edge
  const edge = (await panel(page).boundingBox())!;
  for (const b of await panel(page).locator(".mg-switch").all()) {
    const box = (await b.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(edge.x + edge.width);
  }
});

test("Manage groups: a folder given a group of its own where it is, asked first", async ({ page }) => {
  await home(page, {});
  const asked = await answering(page, () => ({
    own: { group: "Work", actors: [], apps: [], from: GATHERER, in: GATHERER, folder: null },
  }));
  await open(page);
  await manage(page);
  await expect(mgRow(page, ALONE_ACTOR).locator(".mg-opt")).toHaveText(["On its own"]); // at the top: no group around it
  await mgRow(page, "Work").getByRole("button", { name: "Own group" }).click();
  const dialog = page.locator("dialog.mv-dialog");
  await expect(dialog.locator("h3")).toHaveText("Give Work a group of its own?");
  await expect(dialog.locator(".mv-line").first()).toContainText(
    `Work becomes a group of its own, in place, with the settings of ${GATHERER}.`,
  );
  await expect(dialog.locator(".mv-line").first()).toContainText(
    `Its actor leaves the ${GATHERER} group (1 other) for it.`,
  );
  await dialog.getByRole("button", { name: "Make a group" }).click();
  await expect(dialog).toBeHidden();
  expect(asked).toEqual([{ gatherer: GATHERER, do: "own", folder: WORK }]);
  await expect(panel(page)).toBeVisible(); // over the panel, which stays
});

test("Manage groups: a group inside a folder back in the group around it", async ({ page }) => {
  await home(page, { [LAB]: { in: GATHERER, folder: WORK } });
  const asked = await answering(page, (body) =>
    body.do === "merge_plan"
      ? { from: LAB, to: GATHERER, into: WORK, folder: LAB, actors: 1, before: {}, apps: [] }
      : {
          merged: { group: GATHERER, folder: 60, name: LAB, actors: [], apps: [], joined: {}, from: LAB },
          folders: {},
          tasks: {},
        },
  );
  await open(page);
  await manage(page);
  await mgRow(page, LAB).getByRole("button", { name: GATHERER, exact: true }).click();
  const dialog = page.locator("dialog.mv-dialog");
  await expect(dialog.locator("h3")).toHaveText(`Make ${LAB} part of ${GATHERER} again?`);
  await dialog.getByRole("button", { name: "Merge" }).click();
  await expect(dialog).toBeHidden();
  expect(asked.at(-1)).toEqual({ gatherer: LAB, to: GATHERER, into: WORK, do: "merge" });
});

test("Manage groups: an actor on its own, staying in its folder, and back in its folder's group", async ({ page }) => {
  await home(page, { [ALONE]: { in: GATHERER, folder: WORK } });
  const asked = await answering(page, (body) =>
    body.do === "plan"
      ? { actors: [ALONE.slice(5)], from: ALONE, to: GATHERER, before: {}, after: {} }
      : {
          alone: { group: "x", actors: [], apps: [] },
          moved: { actors: [], apps: [], joined: {} },
          folders: {},
          tasks: {},
        },
  );
  await open(page);
  await manage(page);
  const dialog = page.locator("dialog.mv-dialog");
  await mgRow(page, CLAUDE).getByRole("button", { name: "On its own" }).click();
  await expect(dialog.locator("h3")).toHaveText("Put it on its own?");
  await expect(dialog.locator(".mv-line").first()).toContainText("staying in Work");
  await dialog.getByRole("button", { name: "On its own" }).click();
  await expect(dialog).toBeHidden();
  expect(asked.at(-1)).toEqual({ gatherer: GATHERER, do: "alone", channel: expect.any(String), here: true });

  await mgRow(page, ALONE_ACTOR).getByRole("button", { name: GATHERER, exact: true }).click();
  await expect(dialog.locator("h3")).toHaveText(`Join the ${GATHERER} group?`);
  await expect(dialog.getByRole("button", { name: "Stay on its own" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Join" }).click();
  await expect(dialog).toBeHidden();
  expect(asked.at(-1)).toEqual({ gatherer: ALONE, to: GATHERER, channels: [ALONE.slice(5)], do: "move", into: WORK });
});

test("Manage groups folds what is under a group or a folder, and keeps it folded", async ({ page }) => {
  await home(page, { [LAB]: { in: GATHERER, folder: WORK } });
  await open(page);
  await manage(page);
  await expect(mgRow(page, CLAUDE)).toBeVisible();
  await mgRow(page, "Work").locator("button.mg-fold").click();
  await expect(mgRow(page, "Work")).toBeVisible();
  await expect(mgRow(page, CLAUDE)).toHaveCount(0);
  await expect(mgRow(page, LAB)).toHaveCount(0); // a group inside it, folded with it
  await closeManage(page);
  await manage(page);
  await expect(mgRow(page, LAB)).toHaveCount(0); // still folded, opened again
  await mgRow(page, "Work").locator(".mg-name").click(); // its name opens it too
  await expect(mgRow(page, LAB)).toBeVisible();
  await expect(mgRow(page, "Work").locator("button.mg-fold")).toHaveAttribute("aria-expanded", "true");
  await mgRow(page, GATHERER).locator("button.mg-fold").click(); // a group: all of it
  await expect(mgRow(page, "Work")).toHaveCount(0);
  await expect(mgRow(page, GATHERER)).toBeVisible();
});

test("Manage groups: rows dragged and dropped as in the list, asking the same questions", async ({ page }) => {
  await home(page, { [LAB]: { in: GATHERER, folder: WORK } });
  const asked = await answering(page, (body) =>
    body.do === "plan"
      ? { actors: body.channels, from: GATHERER, to: LAB, folder: null, before: {}, after: {} }
      : { placed: true },
  );
  await open(page);
  await manage(page);
  // an actor onto another group's row: the list's question
  await mgRow(page, CLAUDE).dragTo(mgRow(page, LAB));
  const dialog = page.locator("dialog.mv-dialog");
  await expect(dialog.locator("h3")).toHaveText(`Move to the ${LAB} group?`);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  // a group inside a folder onto its group's row: moved to its top, its own group kept, nothing asked
  await mgRow(page, LAB).dragTo(mgRow(page, GATHERER));
  await expect.poll(() => asked.at(-1)).toEqual({ gatherer: LAB, to: GATHERER, into: null, do: "place" });
  await expect(dialog).toBeHidden();
  // onto the outside area, over the panel's top line while it is dragged: at the list's top
  const outside = panel(page).locator(".mg-top .outside-drop");
  await expect(outside).toBeHidden();
  const lab = mgRow(page, LAB);
  await lab.hover(); // by hand: the area shows once a drag starts
  await page.mouse.down();
  const at = (await lab.boundingBox())!;
  await page.mouse.move(at.x + 20, at.y + at.height + 12, { steps: 4 });
  await expect(outside).toHaveText("Outside every group: a group of its own");
  await outside.hover();
  await page.mouse.up();
  await expect.poll(() => asked.at(-1)).toEqual({ gatherer: LAB, to: "", into: null, do: "place" });
  await expect(outside).toBeHidden();
});

test("a group whose actors are long idle stays in view once something is moved into it", async ({ page }) => {
  let moved = false;
  // the home as given here only: the stream's own, without the long-idle group, held back (as home() does)
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const codex = demo.agents.find((a) => a.harness === "codex")!;
    const idle = home.now - 30 * 86400; // its actors' last work: a month ago
    home.gatherers.push({
      ...demo,
      name: LAB,
      last: idle,
      ...(moved ? { changed: home.now - 60 } : {}), // an actor, or a folder, moved in a minute ago (data.py's `changed`)
      agents: [{ ...codex, channel: "1ab00000-0000-4000-8000-0000000000a1", last: idle, status: "idle" }],
    });
    home.merged = true;
    await route.fulfill({ json: home });
  });
  await open(page);
  await expect(groupRow(page, LAB)).toHaveCount(0); // nothing for a month: hidden
  await expect(page.locator("#agents")).toContainText("1 hidden group");
  moved = true;
  await page.reload();
  await expect(groupRow(page, LAB)).toBeVisible(); // just changed: in view
});

test("Manage groups opens from the settings panel, and makes folders: at the top a group, in a group or folder from its row", async ({
  page,
}) => {
  await home(page, {});
  const made: Record<string, unknown>[] = [];
  await page.route("**/api/folders", async (route) => {
    made.push(route.request().postDataJSON());
    await route.fulfill({ json: { made: 90, folders: {} } });
  });
  const asked = await answering(page, (body) => ({ made: { group: String(body.name), title: String(body.name) } }));
  await open(page);
  await expect(page.locator("#agents .aside-head .manage-groups")).toHaveCount(0); // not in the list's head
  await manage(page); // from the settings panel
  await expect(page.locator("#about")).toBeHidden(); // closed as the panel opens

  await mgRow(page, "Work").hover();
  await mgRow(page, "Work").getByRole("button", { name: "New folder in Work" }).click();
  const box = panel(page).locator(".mg-input");
  await expect(box).toBeFocused();
  await expect(box).toHaveAttribute("placeholder", "Folder name");
  await box.press("Escape"); // the box closed, not the panel
  await expect(box).toHaveCount(0);
  await expect(panel(page)).toBeVisible();

  await mgRow(page, "Work").hover();
  await mgRow(page, "Work").getByRole("button", { name: "New folder in Work" }).click();
  await box.fill("Drafts");
  await box.press("Enter");
  await expect.poll(() => made).toEqual([{ gatherer: GATHERER, do: "new", name: "Drafts", parent: WORK }]);
  await expect(box).toHaveCount(0);

  await panel(page).getByRole("button", { name: "New folder", exact: true }).click(); // at the top: a group of its own
  await expect(box).toHaveAttribute("placeholder", "Folder name (a new group)");
  await box.fill("Ideas");
  await box.press("Enter");
  await expect.poll(() => asked).toEqual([{ do: "new", name: "Ideas", folder: null }]);
});
