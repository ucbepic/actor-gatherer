// Moves between groups (features/list/group-moves.js; groups.py): in the home's one database, an actor dragged onto another
// group asks first -- who moves, from which group to which -- and moves only once the reader says so, and a folder
// dragged outside every group asks first, then is a group of its own, and an actor dragged there is on its own; an
// app in a folder that moves goes with it, its pane opened again in its new group, unless it is its group's only one
// (an app's own agent takes that along: groups-app-agents.spec.ts);
// with a database per gatherer, a drop into another group is refused, as every one was before.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, GATHERER, open } from "./home";
import { closeManage, dragOutside, manage, mgRow, panel } from "./manage";

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

const row = (page: Page, text: string) => page.locator("#agents .agent", { hasText: text });
const groupRow = (page: Page, name: string) => page.locator("#agents .gatherer-row", { hasText: name });
const inGroup = (page: Page, name: string, text: string) =>
  page
    .locator("#agents .gatherer", { has: page.locator(".gatherer-row", { hasText: name }) })
    .locator(".agent", { hasText: text });

test("in the home's one database, an actor dragged onto another group moves at once in the list, asked first in Manage groups", async ({
  page,
}) => {
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

  await manage(page); // in Manage groups: asked first, saying who starts and stops sharing
  await mgRow(page, CLAUDE).dragTo(mgRow(page, LAB));
  await expect(dialog.locator("h3")).toHaveText(`Move to the ${LAB} group?`);
  await expect(dialog.locator(".mv-line").first()).toHaveText(
    `${CLAUDE} moves from the ${GATHERER} group (1 other) to the ${LAB} group (1 other).`,
  );
  await expect(dialog.locator(".mv-line").nth(1)).toContainText(`share context with the actors of ${LAB}`);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(asked.map((b) => b.do)).toEqual(["plan"]); // asked, nothing moved
  await closeManage(page);
  await expect(inGroup(page, GATHERER, CLAUDE)).toBeVisible();

  await row(page, CLAUDE).dragTo(groupRow(page, LAB)); // in the list: by the default rule, at once
  await expect
    .poll(() => asked.at(-1))
    .toEqual({ gatherer: GATHERER, to: LAB, do: "move", channels: [claude], into: null });
  expect(asked.map((b) => b.do)).toEqual(["plan", "move"]);
  await expect(dialog).toBeHidden();
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

test("in the home's one database, a folder dragged outside every group is a group of its own: at once in the list, asked first in Manage groups", async ({
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
  const outside = page.locator("#agents .outside-drop");
  await expect(outside).toBeHidden(); // shown only while a folder is dragged
  const dialog = page.locator("dialog.mv-dialog");
  await manage(page); // in Manage groups: asked first
  await dragOutside(page, mgRow(page, "Work"), panel(page), "Outside every group: a group of its own");
  await expect(dialog.locator("h3")).toHaveText("Make Work a group of its own?");
  await expect(dialog.locator(".mv-line").first()).toHaveText(
    "The folder Work becomes a group of its own, with its contents at the top. " +
      `Its actor leaves the ${GATHERER} group (1 other) for it.`,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(asked).toEqual([]);
  await closeManage(page);
  // in the list: at once
  await dragOutside(
    page,
    page.locator("#agents .folder-line", { hasText: "Work" }),
    page.locator("#agents"),
    "Outside every group: a group of its own",
  );
  await expect.poll(() => asked).toEqual([{ gatherer: GATHERER, do: "split", folder: 7 }]);
  await expect(dialog).toBeHidden();
  await expect(inGroup(page, "Work", CLAUDE)).toBeVisible();
  await expect(outside).toBeHidden();
});

test("in the home's one database, an actor dragged outside every group is on its own: at once in the list, asked first in Manage groups", async ({
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
  const dialog = page.locator("dialog.mv-dialog");
  await manage(page); // in Manage groups: asked first
  await dragOutside(page, mgRow(page, CLAUDE), panel(page), "Outside every group: on its own");
  await expect(dialog.locator("h3")).toHaveText("Take it out of every group?");
  await expect(dialog.locator(".mv-line").first()).toContainText(
    `${CLAUDE} leaves the ${GATHERER} group (1 other) and works on its own`,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(asked).toEqual([]);
  await closeManage(page);
  // in the list: at once
  await dragOutside(page, row(page, CLAUDE), page.locator("#agents"), "Outside every group: on its own");
  await expect.poll(() => asked).toEqual([{ gatherer: GATHERER, do: "alone", channel: state.claude }]);
  await expect(dialog).toBeHidden();
  const lone = page.locator("#agents .gatherer.alone");
  await expect(lone.locator(".alone-head")).toHaveCount(0); // no "own context" head
  await expect(lone.locator(".agent", { hasText: CLAUDE })).toBeVisible();
  await expect(inGroup(page, GATHERER, CLAUDE)).toHaveCount(0);

  await lone.locator(".agent", { hasText: CLAUDE }).dragTo(groupRow(page, GATHERER)); // back into a group: it joins
  await expect
    .poll(() => asked.at(-1))
    .toEqual({ gatherer: `self:${state.claude}`, to: GATHERER, do: "move", channels: [state.claude], into: null });
  await expect(dialog).toBeHidden();
});

// An actor on its own from its start (features/list/group-moves.js's aloneNew): the list head's "+" beside its folder button opens a
// box -- the directory the latest active actor works in, each harness that runs here (Codex too: its session is kept
// under the dashboard's id from its start) -- and starts one on its own, run under the shown actor's group,
// listed as its own row; with a database per gatherer there is none
async function startingAlone(page: Page, merged: boolean, started: string) {
  const state = { started: false };
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    for (const a of demo.agents) a.cwd = "/work/demo";
    home.harnesses = ["claude", "codex"];
    for (const h of home.harnesses) home.harness_info[h] = { ...home.harness_info[h], runs: true };
    if (state.started) {
      const claude = demo.agents.find((a) => a.harness === "claude")!;
      const fresh = { ...claude, channel: started, status: "idle", last_user_message: null, name: null, last: null };
      home.gatherers.push({ ...demo, name: `self:${started}`, alone: true, agents: [fresh] });
    }
    home.merged = merged;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/sessions", async (route) => {
    asked.push(route.request().postDataJSON());
    state.started = true;
    await route.fulfill({ json: { session_id: started, gatherer: `self:${started}`, harness: "claude" } });
  });
  return asked;
}

test("in the home's one database, the list head's + starts an actor on its own", async ({ page }) => {
  const started = "a1012e00-0000-4000-8000-0000000000f1";
  const asked = await startingAlone(page, true, started);
  await open(page);
  await expect(page.locator("#agents .gatherer.alone")).toHaveCount(0);
  const plus = page.locator(".aside-head button.alone-new");
  await expect(plus).toHaveAttribute("title", "New actor on its own · shares context with no group");
  await plus.click();
  const box = page.locator(".dw-menu.alone-box");
  await expect(box.locator(".head")).toHaveText("New actor on its own");
  await expect(box.getByRole("textbox", { name: "Working directory" })).toHaveValue("/work/demo");
  await expect(box.locator("button.go")).toHaveCount(2); // each harness that runs here
  await expect(box.locator("button.go").nth(0)).toContainText("Claude Code");
  await expect(box.locator("button.go").nth(1)).toContainText("Codex");
  await expect(box.locator(".note")).toHaveText(["Shares context with no group."]);
  await box.locator("button.go", { hasText: "Claude Code" }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toEqual({ gatherer: GATHERER, cwd: "/work/demo", harness: "claude", alone: true });
  await expect(box).toBeHidden();
  await expect(page.locator("#agents .gatherer.alone .agent")).toHaveCount(1);
});

test("with a database per gatherer, the list head has no + for an actor on its own", async ({ page }) => {
  await startingAlone(page, false, "a1012e00-0000-4000-8000-0000000000f2");
  await open(page);
  await expect(page.locator(".aside-head button.gf-new")).toBeVisible();
  await expect(page.locator(".aside-head button.alone-new")).toHaveCount(0);
});

// An actor on its own (features/list/group-moves.js's aloneShut): open, its row at the top with its ×; closed, it leaves the top for
// a line at the list's end, "1 closed", folded till opened (kept in this browser) -- never "hidden" as a
// group is; in the rail, that line only once its foot shows the closed ones
test("an actor on its own, closed, goes from the top of the list into a closed line at its end", async ({ page }) => {
  const state = { closed: false, claude: "" };
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const claude = demo.agents.find((a) => a.harness === "claude")!;
    state.claude = claude.channel;
    const name = `self:${claude.channel}`;
    const lone = state.closed
      ? { ...claude, status: "closed", running: false, session: null, last: 0 } // seen since: not "Finished"
      : {
          ...claude,
          status: "idle",
          running: false,
          chattable: true,
          session: { session_id: claude.channel, gatherer: name, status: "idle", pid: 4242, terminal: false, kept: 0 },
        };
    // a week and more since it did anything: a group so old is hidden, an actor on its own never
    home.gatherers.push({ ...demo, name, alone: true, agents: [lone], last: home.now - 30 * 86400 });
    demo.agents = demo.agents.filter((a) => a.channel !== claude.channel);
    home.merged = true;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  const stopped: string[] = [];
  await page.route("**/api/stop", async (route) => {
    stopped.push(route.request().postDataJSON().session_id);
    state.closed = true;
    await route.fulfill({ json: { stopped: true } });
  });
  await open(page);
  const top = page.locator("#agents .gatherer.alone:not(.shut)");
  const shut = page.locator("#agents .gatherer.alone.shut");
  await expect(top.locator(".agent", { hasText: CLAUDE })).toBeVisible();
  await expect(top).not.toContainText("own context");
  await expect(shut).toHaveCount(0);
  await top.locator(".agent", { hasText: CLAUDE }).hover();
  await top.locator(".close-btn").click();
  expect(stopped).toEqual([state.claude]);

  await page.reload();
  await expect(page.locator("#agents")).toContainText(GATHERER);
  await expect(top).toHaveCount(0);
  await expect(page.locator("#hidden-gatherers")).toHaveCount(0);
  const line = shut.locator(".fold-line");
  await expect(line).toHaveText("▸ 1 closed");
  await expect(shut.locator(".agent")).toHaveCount(0);
  await line.click();
  await expect(line).toHaveText("▾ 1 closed");
  await expect(shut.locator(".agent", { hasText: CLAUDE })).toBeVisible();
  const order = await page
    .locator("#agents")
    .evaluate((n) =>
      [...n.querySelectorAll(".gatherer")].map((g) => (g.classList.contains("shut") ? "shut" : "group")),
    );
  expect(order.at(-1)).toBe("shut"); // at the list's end
  await page.reload();
  await expect(shut.locator(".agent", { hasText: CLAUDE })).toBeVisible(); // kept open in this browser

  // the rail: nothing of it till the foot shows the closed ones; then its line, open as the list's is
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  await expect(rail.locator(".r-alone")).toHaveCount(0);
  await expect(rail.locator(".r-actor", { hasText: CLAUDE })).toHaveCount(0);
  await rail.locator(".r-show-hd").hover();
  await rail.locator(".r-check", { hasText: "closed" }).click();
  await expect(rail.locator(".r-alone.shut .r-fold")).toHaveText("▾ 1 closed");
  await expect(rail.locator(".r-alone.shut .r-fold")).toHaveAttribute("title", "1 closed: hide it");
  await expect(rail.locator(".r-alone.shut .r-actor", { hasText: CLAUDE })).toBeVisible();
});

// The home of twoGroups, merged, with a folder Work in demo holding Claude Code and a Notepad, "Shopping list" (n1),
// listed as an app of `mode` instances; once `state.moved`, Work's actor and app are lab's
async function appInFolder(page: Page, mode: string, state: { moved: boolean; claude: string }) {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    const claude = demo.agents.find((a) => a.harness === "claude")!;
    state.claude = claude.channel;
    const lab: Group = { ...demo, name: LAB, agents: [] };
    if (state.moved) {
      lab.agents = [claude];
      demo.agents = demo.agents.filter((a) => a.channel !== claude.channel);
    } else
      home.folders = {
        [GATHERER]: { folders: [{ id: 7, parent: null, name: "Work" }], filed: { [claude.channel]: 7, "app:n1": 7 } },
      };
    home.gatherers.push(lab);
    home.merged = true;
    await route.fulfill({ json: home });
  });
  await page.route(/\/api\/apps(\?gatherer=[^&]*)?$/, async (route) => {
    const got = await (await route.fetch()).json();
    const g = new URL(route.request().url()).searchParams.get("gatherer");
    got.apps = (got.apps || []).map((a: { name: string }) => (a.name === "notepad" ? { ...a, instances: mode } : a));
    const at = state.moved ? LAB : GATHERER;
    got.instances =
      g === at ? [{ id: "n1", app: "notepad", gatherer: at, folder: null, title: "Shopping list", data: {} }] : [];
    got.attached = g === at ? { n1: [state.claude] } : {};
    await route.fulfill({ json: got });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
}

// the folder Work opened, from the keyboard: its line's buttons, shown on hover, lie over its name
async function openWork(page: Page) {
  await page.locator("#agents .folder-line .fbtn", { hasText: "Work" }).focus();
  await page.keyboard.press("Enter");
}

test("in the home's one database, an app in a folder that moves goes with it, its pane opened again there: asked in Manage groups, at once in the list", async ({
  page,
}) => {
  const state = { moved: false, claude: "" };
  await appInFolder(page, "many", state);
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/groups", async (route) => {
    const body = route.request().postDataJSON();
    asked.push(body);
    if (body.do === "plan")
      return route.fulfill({
        json: {
          actors: [state.claude],
          apps: [{ id: "n1", app: "notepad", title: "Shopping list" }],
          from: GATHERER,
          to: LAB,
          folder: 7,
          before: {},
          after: {},
        },
      });
    state.moved = true;
    return route.fulfill({
      json: { moved: { actors: [state.claude], apps: ["n1"], from: GATHERER, to: LAB }, folders: {}, tasks: {} },
    });
  });
  await open(page);
  await openWork(page); // what is in it shown
  await page.locator("#agents .agent.app-row", { hasText: "Shopping list" }).click(); // its pane open
  const frame = page.locator(".app-frame");
  await expect(frame).toHaveAttribute("src", new RegExp(`gatherer=${GATHERER}&instance=n1`));
  const dialog = page.locator("dialog.mv-dialog");
  await manage(page);
  await mgRow(page, "Work").dragTo(mgRow(page, LAB));
  await expect(dialog.locator("h3")).toHaveText(`Move to the ${LAB} group?`);
  await expect(dialog.locator(".mv-line").last()).toHaveText("The app Notepad (Shopping list) goes with them.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await closeManage(page);
  await page.locator("#agents .folder-line", { hasText: "Work" }).dragTo(groupRow(page, LAB)); // in the list: at once
  await expect.poll(() => asked.map((b) => b.do)).toEqual(["plan", "move"]);
  await expect(dialog).toBeHidden();
  await expect(frame).toHaveCount(1); // the same pane, its panel opened again for lab
  await expect(frame).toHaveAttribute("src", new RegExp(`gatherer=${LAB}&instance=n1`));
});

test("in the home's one database, a folder holding its group's only one of an app stays in its group", async ({
  page,
}) => {
  const state = { moved: false, claude: "" };
  await appInFolder(page, "one", state);
  const asked: unknown[] = [];
  await page.route("**/api/groups", (route) => {
    asked.push(route.request().postDataJSON());
    return route.abort();
  });
  await open(page);
  await openWork(page);
  await expect(page.locator("#agents .agent.app-row", { hasText: "Shopping list" })).toBeVisible();
  await page.locator("#agents .folder-line", { hasText: "Work" }).dragTo(groupRow(page, LAB));
  await expect(page.locator("dialog.mv-dialog")).toHaveCount(0);
  expect(asked).toEqual([]);
});
