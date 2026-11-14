// TASKS (05-agent-list.js, tasks.py): actors and apps alike kept together as one task -- one row in the list, its actors'
// faces and its apps' marks at its right, opened as one layout (its apps above, its actors side by side), its card listing
// them, each taken out from there -- "+", on an item's row or a task's, adding to its task a new actor or an app (a task
// made of the two, for a lone one), an item dragged onto another's row put in its task, and an app in no task a row of
// its own.
import type { Page } from "@playwright/test";
import { closePanel, expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { newFolder, noFolders, treeOf } from "./folder-tree";
import { type Agent, addNotepad, cardOf, taskHome, taskRow } from "./task-home";

test("a task is one row, its actors' faces at its right; opened, its actors side by side; its card takes one out", async ({
  page,
}) => {
  await taskHome(page, true);
  await open(page);
  const row = page.locator("#agents button.agent.task");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".name")).toHaveText("Parser work");
  await expect(row.locator(".t-face")).toHaveCount(2);
  await expect(page.locator("#agents button.agent:not(.task)", { hasText: CLAUDE })).toHaveCount(0); // in it, not a row

  await row.click(); // opened: both, side by side, the task the one shown
  await expect(page.locator("#panes > .pane")).toHaveCount(2); // this page's own pane, and one beside it
  await expect(row).toHaveAttribute("aria-current", "true");

  await page.mouse.move(0, 0);
  await row.hover(); // its card: live, its two actors, each with its own "take out"
  const card = page.locator("#actor-card.live");
  await expect(card).toHaveAttribute("aria-label", "The task Parser work");
  await expect(card.locator(".c-task-row")).toHaveCount(2);
  await card.locator(".c-task-row", { hasText: CODEX }).locator(".take-out").hover();
  await card.locator(".c-task-row", { hasText: CODEX }).locator(".take-out").click(); // one left: the task gone
  await expect(page.locator("#agents button.agent.task")).toHaveCount(0);
  await expect(page.locator("#agents button.agent", { hasText: CLAUDE })).toHaveCount(1);
  await expect(page.locator("#agents button.agent", { hasText: CODEX })).toHaveCount(1);
});

test("an actor's + starts a new agent in its directory, put in a task with it, opened beside it", async ({ page }) => {
  await taskHome(page, false);
  const asked: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/sessions", async (route) => {
    asked.push({ path: "sessions", body: route.request().postDataJSON() });
    await route.fulfill({ json: { session_id: "new-1", gatherer: GATHERER, harness: "codex", cwd: "/work/demo" } });
  });
  await page.route("**/api/tasks", async (route) => {
    const body = route.request().postDataJSON();
    asked.push({ path: "tasks", body });
    await route.fulfill({
      json: { task: 3, tasks: { [GATHERER]: { tasks: [{ id: 3, name: body.name }], tasked: {} } }, attached: {} },
    });
  });
  await open(page);
  const row = page.locator("#agents button.agent", { hasText: CLAUDE });
  await row.hover();
  const add = row.locator(".task-add");
  await expect(add).toBeVisible(); // shown while hovered
  await add.click();
  await page.locator(".row-menu[role=menu] [role=menuitem] .nm", { hasText: /^Codex$/ }).click();
  await expect.poll(() => asked.map((x) => x.path)).toEqual(["sessions", "tasks"]);
  const claude = (asked[1].body as { to: string }).to;
  expect(asked[0].body).toEqual({ gatherer: GATHERER, cwd: "/work/demo", harness: "codex" });
  expect(asked[1].body).toEqual({ gatherer: GATHERER, do: "add", to: claude, items: ["new-1"] }); // named by what is in it
});

test("a task's + adds an app to it: in it, opened above its actors, every one of them attached to it", async ({
  page,
}) => {
  await taskHome(page, true);
  await open(page);
  const row = taskRow(page);
  await row.hover();
  await row.locator(".task-add").click();
  const menu = page.locator(".row-menu[role=menu]");
  await expect(menu.locator("[role=menuitem] .nm").first()).toHaveText("Claude Code"); // the agents first, then the apps
  await menu.locator("[role=menuitem] .nm", { hasText: /^Notepad$/ }).click();
  const pane = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(pane).toHaveCount(1);
  await expect(pane.frameLocator("iframe").locator("#agents")).toHaveText(/^[^,]+, [^,]+$/); // both its actors attached
  await expect(row.locator(".t-faces .t-app")).toHaveCount(1); // in it: its mark among the task's faces
  await expect(page.locator("#agents button.agent.app-row")).toHaveCount(0); // not a row of its own
  await expect(row).toHaveAttribute("aria-current", "true"); // the task's: the app, selected
});

test("a task opened again is as it was left: an actor's pane closed in it stays closed", async ({ page }) => {
  await taskHome(page, true);
  await open(page);
  const row = page.locator("#agents button.agent.task");
  const panes = page.locator("#panes > .pane");
  await page.locator("#agents").hover({ position: { x: 5, y: 5 } });
  await row.click(); // at first: both, side by side
  await expect(panes).toHaveCount(2);
  await panes.nth(1).frameLocator("iframe").locator("#pane-close").click(); // one of them closed
  await expect(panes).toHaveCount(1);
  await row.click(); // the task shown already: as it is
  await expect(panes).toHaveCount(1);
});

test("a task's card lists its actors and its apps; one taken out is a row of its own, closed from there", async ({
  page,
}) => {
  await taskHome(page, true);
  await open(page);
  const row = taskRow(page);
  await addNotepad(page, row);
  await expect(page.locator("#top-row > .app-pane[data-app=notepad]")).toHaveCount(1);
  await expect(row.locator(".t-faces .t-app")).toHaveCount(1); // the app's mark among its faces
  await expect(row.locator(".t-caret")).toHaveCount(0); // a group, not a folder: nothing opened in the list
  const card = await cardOf(page, row);
  await expect(card.locator(".c-task-row:not(.c-app-row)")).toHaveCount(2); // its actors
  await expect(card.locator(".c-app-row", { hasText: "Notepad" })).toHaveCount(1); // and its app
  await card.locator(".c-app-row .take-out").click(); // out of the task: an app of its own
  const own = page.locator("#agents button.agent.app-row");
  await expect(own).toHaveCount(1);
  await expect(row.locator(".t-faces .t-app")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await own.hover();
  await own.locator(".close-btn").click(); // closed: its row gone, and its panel
  await expect(own).toHaveCount(0);
  await expect(page.locator("#top-row > .app-pane[data-app=notepad]")).toHaveCount(0);
});

test("an app's panel closed in a task stays closed when the task is opened again", async ({ page }) => {
  await taskHome(page, false); // each actor a task of its own
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude); // Claude and Notepad: one task, its row Claude's
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(1);
  await expect(taskRow(page)).toHaveCount(1);
  await page.locator("#agents button.agent", { hasText: CODEX }).click(); // another task: Claude's Notepad goes with its own
  await expect(notes).toHaveCount(0);
  await claude.click(); // back: as it was left, Notepad with it
  await expect(notes).toHaveCount(1);
  await closePanel(page, notes); // closed in it
  await page.locator("#agents button.agent", { hasText: CODEX }).click();
  await claude.click(); // back again: as it was left, Notepad closed
  await expect(page.locator("#agents button.agent[aria-current=true]", { hasText: CLAUDE })).toHaveCount(1);
  await page.waitForTimeout(1500); // what the task opens comes after a read of its apps: none came
  await expect(notes).toHaveCount(0);
});

test("in the folded rail, a task is one tile: its actors' faces grouped in the room of one avatar", async ({
  page,
}) => {
  await taskHome(page, true);
  await open(page);
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  const tile = rail.locator(".r-task");
  await expect(tile).toHaveCount(1);
  await expect(tile.locator(".r-group.n2 > .logo")).toHaveCount(2);
  await expect(rail.locator(".r-actor:not(.r-task)")).toHaveCount(0); // its actors in it, not tiles of their own
  const [group, face] = [
    await tile.locator(".r-group").boundingBox(),
    await tile.locator(".r-group > .logo").first().boundingBox(),
  ];
  expect(Math.round(group!.width)).toBe(30); // the room of one avatar
  expect(face!.width).toBeLessThan(group!.width);
  await tile.click(); // opened: both side by side
  await expect(page.locator("#panes > .pane")).toHaveCount(2);
});

test("an app added to an actor on its own makes a task of the two: its card lists both, its rail tile has both", async ({
  page,
}) => {
  await taskHome(page, false);
  await open(page);
  const claude = page.locator("#agents button.agent:not(.task)", { hasText: CLAUDE });
  await claude.click();
  await addNotepad(page, claude);
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(1);
  const row = taskRow(page);
  await expect(row).toHaveCount(1);
  await expect(row.locator(".name")).toHaveText(CLAUDE); // named by its actor
  await expect(row.locator(".t-faces .t-face")).toHaveCount(1);
  await expect(row.locator(".t-faces .t-app")).toHaveCount(1);
  const card = await cardOf(page, row); // its card: Claude, and Notepad
  await expect(card.locator(".c-task-row:not(.c-app-row)", { hasText: CLAUDE })).toHaveCount(1);
  await expect(card.locator(".c-app-row", { hasText: "Notepad" })).toHaveCount(1);
  await page.mouse.move(0, 0);
  await closePanel(page, notes); // its panel closed: the app still in it
  await expect(notes).toHaveCount(0);
  await expect(row.locator(".t-faces .t-app")).toHaveCount(1);
  await (await cardOf(page, row)).locator(".c-app-row .c-row").click(); // selected from its card: its panel back
  await expect(notes).toHaveCount(1);
  await expect(notes).toHaveClass(/focused/);

  await page.locator("#agents .lb-fold").click(); // in the rail: one tile, Claude's face and the app's mark beside it
  const tile = page.locator("#rail .r-task");
  await expect(tile).toHaveCount(1);
  await expect(tile.locator(".r-apps .t-app")).toHaveCount(1);
  const [face, mark] = [
    await tile.locator(".r-pic > .logo").boundingBox(),
    await tile.locator(".r-apps .t-app").boundingBox(),
  ];
  expect(mark!.width).toBeLessThan(face!.width / 2);
  expect(mark!.x + mark!.width).toBeGreaterThan(face!.x + face!.width); // outside it, at its right
});

test("a task's card lists its apps: one selected by a click, taken out by its ×, a row of its own then", async ({
  page,
}) => {
  await taskHome(page, true);
  await open(page);
  const row = taskRow(page);
  await addNotepad(page, row);
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(1);
  await closePanel(page, notes);
  await expect(notes).toHaveCount(0);
  await page.mouse.move(0, 0);
  await row.hover();
  const card = page.locator("#actor-card.live");
  const app = card.locator(".c-app-row", { hasText: "Notepad" });
  await expect(app).toHaveCount(1);
  await expect(card.locator(".c-sub")).toHaveText(/2 actors, 1 app/);
  await app.locator(".c-row").click(); // selected: its panel back
  await expect(notes).toHaveCount(1);
  await page.mouse.move(0, 0);
  await row.hover();
  await card.locator(".c-app-row", { hasText: "Notepad" }).locator(".take-out").click(); // out of the task: gone from the card
  await expect(card.locator(".c-app-row")).toHaveCount(0);
  const own = page.locator("#agents button.agent.app-row"); // an app of its own
  await expect(own).toHaveCount(1);
  await expect(own.locator(".app-face")).toHaveAttribute("title", /^Notepad/);
  await expect(row.locator(".t-faces .t-app")).toHaveCount(0);
});

// the gatherer's apps as `instances` (Notepads, each {id, title}), the host's own left out -- as they are listed to the page
async function fakeApps(page: Page, instances: { id: string; title: string }[]) {
  await page.route("**/api/apps?gatherer=*", async (route) => {
    const got = await (await route.fetch()).json();
    got.instances = instances.map((i) => ({ ...i, app: "notepad", gatherer: GATHERER, folder: null, data: {} }));
    got.attached = {};
    await route.fulfill({ json: got });
  });
}

test("several apps' marks in a task are stacked over one another, as its faces are", async ({ page }) => {
  await taskHome(page, false);
  await fakeApps(page, [
    { id: "n1", title: "notes 1" },
    { id: "n2", title: "notes 2" },
  ]);
  const home = await (await page.request.get("/api/home")).json();
  const claude = home.gatherers[0].agents.find((a: Agent) => a.harness === "claude").channel;
  await page.request.post("/api/tasks", {
    data: { gatherer: GATHERER, do: "add", to: claude, items: ["app:n1", "app:n2"] },
  });
  await open(page);
  const marks = taskRow(page).locator(".t-faces .t-apps .t-app");
  await expect(marks).toHaveCount(2);
  const [a, b] = [(await marks.nth(0).boundingBox())!, (await marks.nth(1).boundingBox())!];
  expect(b.x).toBeLessThan(a.x + a.width); // over the first, not beside it
  expect(b.x).toBeGreaterThan(a.x);
});

test("an app in no task is a row of its own, its face lined up with the actors'; dragged onto an actor, in its task", async ({
  page,
}) => {
  await taskHome(page, false);
  await fakeApps(page, [{ id: "n1", title: "Shopping list" }]);
  await open(page);
  const app = page.locator("#agents button.agent.app-row");
  await expect(app).toHaveCount(1);
  await expect(app.locator(".name")).toHaveText("Shopping list");
  await expect(app.locator(".app-face")).toHaveAttribute("title", "Notepad · Shopping list"); // its kind: on its face
  const faces = page.locator("#agents button.agent .a-face > .logo");
  await expect(faces).toHaveCount(3);
  const xs = await Promise.all([0, 1, 2].map(async (n) => Math.round((await faces.nth(n).boundingBox())!.x)));
  expect(new Set(xs).size).toBe(1);
  const asked: Record<string, unknown>[] = [];
  await page.route("**/api/tasks", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.continue();
  });
  await app.dragTo(page.locator("#agents button.agent", { hasText: CODEX }));
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatchObject({ do: "add", items: ["app:n1"] });
  await expect(taskRow(page)).toHaveCount(1); // Codex and the app: one task
  await expect(taskRow(page).locator(".t-faces .t-app")).toHaveCount(1);
  await expect(app).toHaveCount(0);
});

test("a task dragged onto a folder goes in it whole: every actor in it filed there", async ({ page }) => {
  const fid = await newFolder(page, "Trips");
  try {
    await taskHome(page, true);
    await open(page);
    const line = page.locator("#agents .folder-line", { hasText: "Trips" });
    await page.locator("#agents button.agent.task").dragTo(line);
    await expect.poll(async () => Object.values((await treeOf(page)).filed)).toEqual([fid, fid]);
    await expect(page.locator("#agents .f-kids button.agent.task")).toHaveCount(1); // the task, in it
  } finally {
    await noFolders(page);
  }
});

test("⌘/Ctrl+click on a task opens it whole beside the one shown: its actor and its apps, nothing closed", async ({
  page,
}) => {
  const beside = process.platform === "darwin" ? "Meta" : "Control";
  await taskHome(page, false); // each actor a task of its own
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  const codex = page.locator("#agents button.agent", { hasText: CODEX });
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  const panes = page.locator("#panes > .pane");
  await codex.click();
  await addNotepad(page, codex);
  await expect(notes).toHaveCount(1); // Codex's app, in its task
  await claude.click({ modifiers: ["Alt"] }); // another task in its place (⌥): Codex's Notepad goes with Codex
  await expect(notes).toHaveCount(0);
  await expect(panes).toHaveCount(1);
  await codex.click({ modifiers: [beside] }); // Codex's task beside Claude's: Codex in a pane of its own, its Notepad above
  await expect(panes).toHaveCount(2);
  await expect(notes).toHaveCount(1);
  await expect(page.locator("#agents button.agent[aria-current=true]", { hasText: CODEX })).toHaveCount(1);
  await expect(claude).toHaveAttribute("data-open", "true"); // Claude's still open, beside
});

test("the actor the page opens on, given an app since, gets it once clicked, and keeps it when left and come back to", async ({
  page,
}) => {
  await taskHome(page, false);
  await open(page);
  const shown = page.locator("#agents button.agent[aria-current=true]");
  await expect(shown).toHaveCount(1); // the one the page opened on: its apps not opened with it
  const channel = ((await shown.getAttribute("data-key")) || "").split("/").pop();
  const opened = await page.request.post("/api/apps/open", {
    data: { app: "notepad", gatherer: GATHERER, folder: "/w/opened-on", channel },
  });
  expect(opened.ok()).toBe(true); // opened by the actor: in its task (its stream held back: the page not told yet)
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(notes).toHaveCount(0);
  await shown.click(); // laid out now: its app with it
  await expect(notes).toHaveCount(1);
  const other = page.locator("#agents button.agent:not(.task)[aria-current=false]").first();
  await other.click(); // another task: its app goes
  await expect(notes).toHaveCount(0);
  await taskRow(page).click(); // back: as it was left, its app with it
  await expect(notes).toHaveCount(1);
});

test("an app is selected as an actor is: one thing selected, the panes below left as they are, ⌘ beside", async ({
  page,
}) => {
  const beside = process.platform === "darwin" ? "Meta" : "Control";
  await taskHome(page, false); // each actor a task of its own
  await open(page);
  const claude = page.locator("#agents button.agent", { hasText: CLAUDE });
  const codex = page.locator("#agents button.agent", { hasText: CODEX });
  const notes = page.locator("#top-row > .app-pane[data-app=notepad]");
  const panes = page.locator("#panes > .pane");
  await claude.click();
  await addNotepad(page, claude);
  await expect(notes).toHaveClass(/focused/); // added: selected
  const task = taskRow(page);
  const app = async () => (await cardOf(page, task)).locator(".c-app-row .c-row");
  await expect(task).toHaveAttribute("aria-current", "true"); // its task's row
  await expect(panes.and(page.locator(".focused"))).toHaveCount(0); // the actor's pane not, while it is
  await (await cardOf(page, task)).locator(".c-task-row:not(.c-app-row) .c-row").click(); // the actor: selected again
  await expect(panes.and(page.locator(".focused"))).toHaveCount(1);
  await expect(notes).not.toHaveClass(/focused/);
  await (await app()).click(); // the app: selected, its panel marked, the pane below as it was
  await expect(notes).toHaveClass(/focused/);
  await expect(panes).toHaveCount(1);
  await page.mouse.move(0, 0);
  await codex.click(); // another task: Claude's Notepad goes
  await expect(notes).toHaveCount(0);
  await (await app()).click(); // Claude's app selected from Codex's task: Claude's task entered, it selected
  await expect(notes).toHaveCount(1);
  await expect(notes).toHaveClass(/focused/);
  await expect(task).toHaveAttribute("aria-current", "true");
  await page.mouse.move(0, 0);
  await codex.click({ modifiers: ["Alt"] }); // Codex in Claude's task's place (⌥): Claude's open in no tab
  await expect(notes).toHaveCount(0);
  await (await app()).click({ modifiers: [beside] }); // ⌘: beside, no task entered
  await expect(notes).toHaveCount(1);
  await expect(notes).toHaveClass(/focused/);
  await expect(page.locator("#agents button.agent[data-open=true]", { hasText: CODEX })).toHaveCount(1); // Codex still below
});

test("a row's buttons show over its face while it is hovered, its face alone at rest", async ({ page }) => {
  await taskHome(page, false);
  await open(page);
  const row = page.locator("#agents button.agent:not(.task)", { hasText: CLAUDE });
  const acts = row.locator(".a-acts"),
    face = row.locator(".a-face");
  await page.mouse.move(0, 0);
  await expect(acts).toHaveCSS("opacity", "0"); // at rest: its face alone
  await expect(face).toHaveCSS("visibility", "visible");
  await row.hover();
  await expect(acts).toHaveCSS("opacity", "1"); // hovered: its buttons, where its face was
  await expect(face).toHaveCSS("visibility", "hidden");
  const [a, f] = [(await acts.boundingBox())!, (await face.boundingBox())!];
  expect(Math.abs(a.x + a.width - (f.x + f.width))).toBeLessThan(2); // over it, at the row's right edge
  expect(a.y).toBeLessThan(f.y + f.height);
  await expect(acts.locator(".task-add")).toBeVisible();
  await expect(acts.locator(".save-btn")).toBeVisible();
});

test("a row is one line; a click on the actor shown shows it, a double-click on its name names it", async ({
  page,
}) => {
  await taskHome(page, false);
  await open(page);
  const row = page.locator("#agents button.agent:not(.task)", { hasText: CLAUDE });
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(row.locator(".meta")).toHaveCount(0); // one line: its state, its name, its face
  expect((await row.boundingBox())!.height).toBeLessThan(44);
  await row.click(); // the one shown, clicked again: shown, not named
  await expect(page.locator("#agents input.name-box")).toHaveCount(0);
  await row.locator(".name").dblclick(); // its name double-clicked: a box to name it in
  const box = page.locator("#agents input.name-box");
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape"); // left as it was
  await expect(box).toHaveCount(0);
});
