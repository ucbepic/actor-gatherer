// Folders in the list (folders.py; features/list/list.js "FOLDERS"): made, filled, nested, renamed, deleted; an actor's
// saved and closed lines in its folder; several actors moved at once; actors started in a folder; and in the rail, a
// folder's and a gatherer's cards, with their buttons and their tree, what it shows over every gatherer, and where an
// actor's bookmark sits however deep its folder.
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { homeOf, newFolder, noFolders, treeOf } from "./folder-tree";

test("keeps actors in folders: made from the gatherer's row, filled by dragging, nested, renamed and deleted", async ({
  page,
}) => {
  await open(page);
  const g = (await homeOf(page)).gatherers.find((x) => x.name === GATHERER)!;
  const channelOf = (harness: string) => g.agents.find((a) => a.harness === harness)!.channel;
  const [claudeCh, codexCh] = [channelOf("claude"), channelOf("codex")];
  const row = (text: string) => page.locator("#agents .agent", { hasText: text });
  const line = (name: string) => page.locator("#agents .folder-line", { hasText: name });
  const gRow = page.locator("#agents .gatherer-row").first();
  const box = page.locator("#agents .folder-box");
  try {
    await expect(page.locator("#agents .folder-line")).toHaveCount(0);
    await gRow.hover();
    await gRow.locator(".act.row-more").click(); // its "⋯": a new folder, rename, hide
    await page.locator(".row-menu[role=menu]").getByRole("menuitem", { name: "New folder" }).click();
    await box.fill("  Paper   revisions ");
    await box.press("Enter");
    await expect(line("Paper revisions")).toBeVisible();
    await expect(line("Paper revisions").locator(".count")).toHaveCount(0); // nothing in it: no counts
    await expect(page.locator("#agents .f-empty")).toBeVisible(); // made open, and empty
    await expect.poll(async () => (await treeOf(page)).folders.map((f) => f.name)).toEqual(["Paper revisions"]);
    const paper = (await treeOf(page)).folders[0].id;

    await row(CLAUDE).dragTo(line("Paper revisions"));
    await expect(page.locator("#agents .f-kids .agent", { hasText: CLAUDE })).toBeVisible(); // listed in it
    await expect(line("Paper revisions").locator(".count")).toHaveText(["1"]); // its one actor idle, a grey dot
    await expect(line("Paper revisions").locator(".count.idle")).toHaveCount(1);
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [claudeCh]: paper });
    expect(Object.keys((await homeOf(page)).saved?.[GATHERER] || {})).toEqual([]); // put in a folder: not saved

    // its line's "⋯": a folder in it, renamed, deleted
    const more = async (name: string, item: string) => {
      await line(name).hover();
      await line(name).locator(".act.row-more").click();
      await page.locator(".row-menu[role=menu]").getByRole("menuitem", { name: item }).click();
    };
    await more("Paper revisions", "New folder");
    await box.fill("Figures");
    await box.press("Enter");
    await expect(page.locator("#agents .f-kids .folder-line", { hasText: "Figures" })).toBeVisible();
    await more("Paper revisions", "Rename");
    await box.fill("Drafts");
    await box.press("Enter");
    await expect(line("Drafts")).toBeVisible();
    await expect
      .poll(async () => (await treeOf(page)).folders.map((f) => f.name).sort())
      .toEqual(["Drafts", "Figures"]);

    await row(CLAUDE).dragTo(gRow); // onto its gatherer's row: at its top again
    await expect(page.locator("#agents .f-kids .agent", { hasText: CLAUDE })).toHaveCount(0);
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({});

    await more("Drafts", "Delete"); // deleted: the folder in it moves up a level
    await expect(page.locator("#agents .folder-line .fname")).toHaveText(["Figures"]);
    await expect
      .poll(async () => (await treeOf(page)).folders.map((f) => [f.name, f.parent]))
      .toEqual([["Figures", null]]);
    const figures = (await treeOf(page)).folders[0].id;
    await row(CODEX).dragTo(line("Figures"));
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [codexCh]: figures });
  } finally {
    await noFolders(page);
  }
});

test("an action's answer, come late, does not undo a change the stream brought meanwhile", async ({ page }) => {
  // The page deletes a folder; its answer ({folders: {}}) comes after the stream brought a folder made since (CI's
  // Linux machine holds an answer ~40 ms): the folder stays. The stream sends a home only when it differs from the
  // last it sent, so an answer let undo it would have it gone till the next change.
  await open(page);
  const folder = (name: string) => page.locator("#agents .folder-line", { hasText: name });
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  try {
    await newFolder(page, "Old");
    await expect(folder("Old")).toBeVisible();
    await page.route("**/api/folders", async (route) => {
      const answer = await route.fetch(); // done by the server now; its answer held back
      await held;
      await route.fulfill({ response: answer });
    });
    await folder("Old").hover();
    await folder("Old").locator(".act.row-more").click(); // its "⋯": Delete
    await page.locator(".row-menu[role=menu]").getByRole("menuitem", { name: "Delete" }).click();
    await expect.poll(async () => (await treeOf(page)).folders.length).toBe(0);
    await newFolder(page, "Later");
    await expect(folder("Later")).toBeVisible(); // the stream's home
    const answered = page.waitForResponse("**/api/folders");
    release();
    await answered;
    await page.waitForTimeout(300); // the answer taken
    await expect(folder("Later")).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await noFolders(page);
  }
});

test("lists a closed saved actor in its folder's saved line, folded till opened", async ({ page }) => {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const g = home.gatherers.find((x: { name: string }) => x.name === GATHERER);
    const codex = g.agents.find((a: { harness?: string }) => a.harness === "codex");
    codex.status = "closed";
    home.saved = { [GATHERER]: { [codex.channel]: "2026-10-01T00:00:00Z" } };
    home.folders = {
      [GATHERER]: {
        folders: [
          { id: 2, parent: null, name: "Empty" },
          { id: 1, parent: null, name: "Paper" },
        ],
        filed: { [codex.channel]: 1 },
      },
    };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await open(page);
  const lines = page.locator("#agents .folder-line");
  await expect(lines.locator(".fname")).toHaveText(["Empty", "Paper"]);
  await expect(lines.locator(".count")).toHaveCount(0); // none open in either: no counts
  const codexRow = page.locator("#agents .f-kids .agent", { hasText: CODEX });
  const isOpen = await codexRow.count(); // the first actor is shown, so in view under its folded folder
  await lines.filter({ hasText: "Paper" }).locator(".fname").click(); // opened (its name clicked): its saved line, folded
  const saved = page.locator("#agents .f-kids .fold-line", { hasText: "saved" });
  await expect(saved).toHaveText("▸ 1 saved");
  await saved.click();
  await expect(codexRow).toBeVisible();
  await saved.click();
  await lines.filter({ hasText: "Paper" }).locator(".fname").click();
  await expect(codexRow).toHaveCount(isOpen);
});

test("moves several actors at once: Shift+click selects them, the bar under the list moves them", async ({ page }) => {
  await open(page);
  const g = (await homeOf(page)).gatherers.find((x) => x.name === GATHERER)!;
  const [claudeCh, codexCh] = ["claude", "codex"].map((h) => g.agents.find((a) => a.harness === h)!.channel);
  const row = (text: string) => page.locator("#agents .agent", { hasText: text });
  const bar = page.locator("#pick-bar");
  const batch = await newFolder(page, "Batch");
  try {
    await expect(page.locator("#agents .folder-line", { hasText: "Batch" })).toBeVisible();
    await row(CLAUDE).click({ modifiers: ["Shift"] });
    await expect(row(CLAUDE)).toHaveClass(/picked/);
    await expect(bar).toBeHidden(); // one: only tinted, no check, no bar
    await expect(page.locator("#agents .agent .pick")).toHaveCount(0);
    await row(CODEX).click({ modifiers: ["Shift"] });
    await expect(bar).toBeVisible();
    await expect(bar.locator(".n")).toHaveText("2 selected");
    await expect(page.locator("#agents .agent .pick")).toHaveCount(2);
    await bar.locator(".pb", { hasText: "Move to…" }).click();
    const menu = page.locator(".row-menu[role=menu]");
    await expect(menu.locator("[role=menuitem] .nm")).toHaveText([`Top of ${GATHERER}`, "Batch", "New folder…"]);
    await menu.getByRole("menuitem", { name: "Batch" }).click();
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [claudeCh]: batch, [codexCh]: batch });
    await expect(bar).toBeHidden(); // moved: the selection cleared
    await expect(page.locator("#agents .f-kids .agent")).toHaveCount(2); // in it, opened
    await row(CLAUDE).click({ modifiers: ["Shift"] });
    await row(CODEX).click({ modifiers: ["Shift"] });
    await expect(bar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(page.locator("#agents .agent.picked")).toHaveCount(0);
  } finally {
    await noFolders(page);
  }
});

test("a folder starts actors in it: its + and + ⋯ on its line, shown while hovered", async ({ page }) => {
  // the home as the server has it, but a harness a session can be started on here, and its actors' directory known
  // (its stream held back, so the server's own home does not replace it); starting one answered as the server would
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    for (const a of home.gatherers.find((x: { name: string }) => x.name === GATHERER).agents) a.cwd = "/work/demo";
    home.harnesses = ["claude", "codex"];
    for (const h of home.harnesses) home.harness_info[h] = { ...home.harness_info[h], runs: true };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  const started = "c0ffee00-0000-4000-8000-0000000000f1";
  await page.route("**/api/sessions", (route) => route.fulfill({ json: { session_id: started, gatherer: GATHERER } }));
  const ideas = await newFolder(page, "Ideas");
  try {
    await open(page);
    const line = page.locator("#agents .folder-line", { hasText: "Ideas" });
    await expect(line.locator(".f-acts")).toHaveCSS("opacity", "0"); // at rest: its name and counts alone
    await line.hover();
    await expect(line.locator(".f-acts")).toHaveCSS("opacity", "1");
    await expect(line.locator(".act.start:not(.crew)")).toHaveCount(1); // "+": all that starts there
    await expect(line.locator(".f-acts .act.crew:not(.on)")).toHaveCount(1); // and a coordinator agent started over it
    // the gatherer's row has the same two, "+" (all that starts there) and "⋯" (a folder, rename, hide -- a folder's: delete),
    // shown while hovered; a folder's line its × too; its coordinator agent's face apart, just after its name, always shown
    const order = (box: string) =>
      page
        .locator(box)
        .first()
        .evaluate((n) =>
          [...n.querySelectorAll("button:not(.crew)")].map((b) =>
            [...b.classList].find((c) => ["new-actor", "row-more", "close"].includes(c)),
          ),
        );
    expect(await order("#agents .folder-line .f-acts")).toEqual(["new-actor", "row-more", "close"]);
    expect(await order("#agents .gatherer-row .g-acts")).toEqual(["new-actor", "row-more"]);
    const gRow = page.locator("#agents .gatherer-row").first();
    await expect(gRow.locator(".g-acts")).toHaveCSS("opacity", "0");
    await expect(gRow.locator(":scope > .act.crew")).toBeVisible();
    await line.locator("button.new-actor").click();
    const menu = page.locator(".row-menu[role=menu]");
    await expect(menu.locator(".hd")).toContainText("New in Ideas"); // (its directory under it)
    await menu.getByRole("menuitem", { name: "Claude Code" }).click();
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [started]: ideas }); // filed there once started
  } finally {
    await noFolders(page);
  }
});

test("in the rail, a folder's and a gatherer's cards stay to be used: their buttons, and their actors to show", async ({
  page,
}) => {
  await open(page);
  const ideas = await newFolder(page, "Ideas");
  try {
    const g = (await homeOf(page)).gatherers.find((x) => x.name === GATHERER)!;
    const codexCh = g.agents.find((a) => a.harness === "codex")!.channel;
    await page.request.post("/api/folders", {
      data: { gatherer: GATHERER, do: "file", channels: [codexCh], folder: ideas },
    });
    await page.locator("#agents .lb-fold").click();
    const rail = page.locator("#rail");
    const name = rail.locator(".r-fname, .r-fhead", { hasText: "Ideas" }); // an actor in it not closed: shown, open
    await expect(name).toBeVisible();
    await name.hover();
    const card = page.locator("#actor-card.live");
    await expect(card).toBeVisible();
    await expect(card.locator(".c-acts .act.new, .c-acts .act.rename, .c-acts .act.delete")).toHaveCount(3);
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 12, { steps: 6 }); // onto it: it stays
    await page.waitForTimeout(500);
    await expect(card).toBeVisible();
    await card.locator(".act.new").click(); // a folder in it, named in the card
    await card.locator(".c-box").fill("Drafts");
    await card.locator(".c-box").press("Enter");
    await expect
      .poll(async () => (await treeOf(page)).folders.map((f) => [f.name, f.parent]))
      .toContainEqual(["Drafts", ideas]);
    // its tree, its first level shown: Drafts a folder's row, opened in place, what is in it under it
    const drafts = (await treeOf(page)).folders.find((f) => f.name === "Drafts")!.id;
    const claudeCh = g.agents.find((a) => a.harness === "claude")!.channel;
    await page.request.post("/api/folders", {
      data: { gatherer: GATHERER, do: "file", channels: [claudeCh], folder: drafts },
    });
    const draftsRow = card.locator("button.c-frow", { hasText: "Drafts" });
    await expect(draftsRow).toHaveAttribute("aria-expanded", "false");
    await expect(card.locator("button.c-row", { hasText: CLAUDE })).toHaveCount(0); // in Drafts: not shown, it folded
    await draftsRow.click();
    await expect(draftsRow).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator("button.c-row", { hasText: CLAUDE })).toBeVisible();
    await card.locator("button.c-row", { hasText: CODEX }).click(); // shown, from the folder's card
    await expect(card).toBeHidden();
    await expect(rail.locator('.r-main[aria-current="true"] .r-name')).toContainText(CODEX);
    await rail.locator(".r-gname").first().hover(); // the gatherer's own card, its buttons
    await expect(card).toBeVisible();
    await expect(card.locator(".c-acts .act.newfolder, .c-acts .act.rename, .c-acts .act.hide")).toHaveCount(3);
  } finally {
    await noFolders(page);
  }
});

test("the rail shows only a folder on a double-click, Up and Root go out again, and its edge drags it wider", async ({
  page,
}) => {
  await open(page);
  const ideas = await newFolder(page, "Ideas");
  try {
    const g = (await homeOf(page)).gatherers.find((x) => x.name === GATHERER)!;
    const codexCh = g.agents.find((a) => a.harness === "codex")!.channel;
    await page.request.post("/api/folders", {
      data: { gatherer: GATHERER, do: "file", channels: [codexCh], folder: ideas },
    });
    await page.locator("#agents .lb-fold").click();
    const rail = page.locator("#rail");
    await expect(rail.locator(".r-actor .r-name", { hasText: CLAUDE })).toBeVisible(); // every gatherer: its actors
    const ideasName = rail.locator(".r-fname, .r-fhead", { hasText: "Ideas" }); // an actor in it not closed: shown, open
    await ideasName.dblclick();
    await expect(rail.locator(".r-here")).toContainText("Ideas");
    await expect(rail.locator(".r-gname")).toHaveCount(0);
    await expect(rail.locator(".r-actor .r-name")).toHaveCount(1); // only what is in it
    await expect(rail.locator(".r-actor .r-name")).toContainText(CODEX);
    await rail.locator(".r-navb.up").click(); // up: the gatherer's top, Ideas in it
    await expect(rail.locator(".r-here")).toHaveCount(1);
    await expect(rail.locator(".r-gname")).toHaveCount(0);
    await expect(ideasName).toBeVisible();
    await rail.locator(".r-navb.up").click(); // up again: every gatherer
    await expect(rail.locator(".r-here")).toHaveCount(0);
    await expect(rail.locator(".r-gname")).toHaveCount(1);
    // the gatherer's, then a folder in it; Root from there: every gatherer
    await rail.locator(".r-gname").first().dblclick();
    await ideasName.dblclick();
    await expect(rail.locator(".r-here .r-hname .nm")).toHaveText("Ideas");
    // its name a button, as a folder's in the tree: a click folds what is in it, another opens it again
    const heading = rail.locator(".r-here .r-hname");
    await expect(heading).toHaveCSS("cursor", "pointer");
    await expect(heading).toHaveAttribute("aria-expanded", "true");
    await heading.click();
    await expect(heading).toHaveAttribute("aria-expanded", "false");
    await heading.click();
    await expect(heading).toHaveAttribute("aria-expanded", "true");
    // the path over its name: a step for its gatherer, a click there showing the gatherer's top
    await expect(rail.locator(".r-step")).toHaveCount(1);
    await rail.locator(".r-step").click();
    await expect(rail.locator(".r-step")).toHaveCount(0);
    await expect(ideasName).toBeVisible();
    await rail.locator(".r-navb.root").click();
    await expect(rail.locator(".r-gname")).toHaveCount(1);
    // in the top bar, what every actor does: a dot and a number each, the open ones all counted; none over the rail
    const open = await rail.locator(".r-actor").count();
    const totals = await page.locator("#top-totals .count").allInnerTexts();
    await expect(rail.locator(".r-totals")).toHaveCount(0);
    expect(totals.reduce((n, k) => n + Number(k), 0)).toBeGreaterThanOrEqual(open - 1); // its gatherer agent left out
    // an idle actor has no dot
    await expect(rail.locator(".r-actor .rd.idle").first()).toBeHidden();
    // its right edge dragged: wider, kept; a double-click: as narrow as it was
    const grip = page.locator(".rail-grip");
    const at = (await grip.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + 300);
    await page.mouse.down();
    await page.mouse.move(at.x + 100, at.y + 300, { steps: 5 });
    await page.mouse.up();
    expect((await rail.boundingBox())!.width).toBeGreaterThan(150);
    await page.reload();
    await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(150);
    await grip.dblclick();
    await expect.poll(async () => (await rail.boundingBox())!.width).toBeLessThan(80);
  } finally {
    await noFolders(page);
  }
});

test("over every gatherer, the rail shows the folders with an actor not closed in them, opened, and the rest and the saved and closed lines, at the top, once checked", async ({
  page,
}) => {
  const [ideas] = [await newFolder(page, "Ideas"), await newFolder(page, "Later")];
  try {
    const g = (await homeOf(page)).gatherers.find((x) => x.name === GATHERER)!;
    const codexCh = g.agents.find((a) => a.harness === "codex")!.channel;
    await page.request.post("/api/folders", {
      data: { gatherer: GATHERER, do: "file", channels: [codexCh], folder: ideas },
    });
    // the home as the server has it, but the Codex actor (in Ideas) idle and the Claude Code one (at the gatherer's top;
    // Later empty) closed -- the streams held back, so the server's own home does not replace it
    await page.route("**/api/home", async (route) => {
      const home = await (await route.fetch()).json();
      const agents: { harness?: string; status?: string }[] = home.gatherers.find(
        (x: { name: string }) => x.name === GATHERER,
      ).agents;
      agents.find((a) => a.harness === "codex")!.status = "idle";
      agents.find((a) => a.harness === "claude")!.status = "closed";
      await route.fulfill({ json: home });
    });
    await streamsAsRequests(page);
    await page.route("**/api/stream*", (route) => route.abort());
    await open(page);
    await page.locator("#agents .lb-fold").click();
    const rail = page.locator("#rail");
    const folder = (name: string) => rail.locator(".r-fname, .r-fhead", { hasText: name });
    const box = (what: string) => rail.locator(".r-check", { hasText: what });
    const check = async (what: string) => {
      await rail.locator(".r-show-hd").hover(); // its boxes open while it is hovered
      await box(what).click();
    };
    // its foot "Show…", its boxes folded till it is hovered
    await expect(rail.locator(".r-show-hd")).toHaveText("Show…");
    await expect(box("folders")).toBeHidden();
    await rail.locator(".r-show-hd").hover();
    await expect(box("folders")).toBeVisible();
    // at first: none checked; Ideas, an idle actor in it, shown and open; Later, none in it, left out; no lines
    await expect(rail.locator(".r-show input")).toHaveCount(3);
    await expect(rail.locator(".r-show input:checked")).toHaveCount(0);
    await expect(rail.locator(".r-fhead", { hasText: "Ideas" })).toBeVisible();
    await expect(folder("Later")).toHaveCount(0);
    await expect(rail.locator(".r-fold")).toHaveCount(0);
    await rail.locator(".r-fhead", { hasText: "Ideas" }).click(); // folded by the reader, still shown
    await expect(rail.locator(".r-fname", { hasText: "Ideas" })).toBeVisible();
    await rail.locator(".r-fname", { hasText: "Ideas" }).click();
    // every folder: Later too; the closed line once "closed" is checked, at the top, over the folders
    await check("folders");
    await expect(rail.locator(".r-fname", { hasText: "Later" })).toBeVisible();
    await expect(rail.locator(".r-fold")).toHaveCount(0);
    await check("closed");
    await expect(rail.locator(".r-fold")).toHaveText(["▸ 1 closed"]);
    const order = await rail
      .locator(".r-gatherer > .r-kids")
      .first()
      .evaluate((n) => [...n.children].map((c) => c.className.split(" ")[0]));
    expect(order.indexOf("r-fold"), order.join(" ")).toBeLessThan(order.indexOf("r-fopen"));
    expect(order.indexOf("r-fold"), order.join(" ")).toBeLessThan(order.indexOf("r-ffold"));
    await check("closed");
    await expect(rail.locator(".r-fold")).toHaveCount(0);
    // kept in this browser
    await page.reload();
    await expect(box("folders").locator("input")).toBeChecked();
    await expect(box("closed").locator("input")).not.toBeChecked();
    // drilled into the gatherer: the same boxes, the same rule
    await check("folders");
    await expect(folder("Later")).toHaveCount(0);
    await rail.locator(".r-gname").first().dblclick();
    await expect(rail.locator(".r-here")).toHaveCount(1);
    await expect(folder("Later")).toHaveCount(0);
    await expect(rail.locator(".r-fold")).toHaveCount(0);
    await check("folders");
    await expect(folder("Later")).toBeVisible();
    await check("closed");
    await expect(rail.locator(".r-fold")).toHaveText(["▸ 1 closed"]);
  } finally {
    await noFolders(page);
  }
});

test("in the rail, an actor's bookmark sits as far from its avatar in a folder in a folder as at the gatherer's top", async ({
  page,
}) => {
  const outer = await newFolder(page, "Outer");
  const inner = await newFolder(page, "Inner", outer);
  try {
    const g = (await homeOf(page)).gatherers.find((x) => x.name === GATHERER)!;
    const codexCh = g.agents.find((a) => a.harness === "codex")!.channel;
    await page.request.post("/api/folders", {
      data: { gatherer: GATHERER, do: "file", channels: [codexCh], folder: inner },
    });
    // both actors idle, so Outer and Inner are shown open (the streams held back, so the server's home stays out)
    await page.route("**/api/home", async (route) => {
      const home = await (await route.fetch()).json();
      for (const a of home.gatherers.find((x: { name: string }) => x.name === GATHERER).agents) a.status = "idle";
      await route.fulfill({ json: home });
    });
    await streamsAsRequests(page);
    await page.route("**/api/stream*", (route) => route.abort());
    await open(page);
    await page.locator("#agents .lb-fold").click();
    const rail = page.locator("#rail");
    await expect(rail.locator(".r-fopen .r-fopen .r-actor", { hasText: CODEX })).toBeVisible();
    // the tile, how far its bookmark is from its avatar, and whether its bookmark is over its × and both left of it
    const gap = (name: string) =>
      rail.locator(".r-actor", { hasText: name }).evaluate((t) => {
        const r = (s: string) => t.querySelector(s)!.getBoundingClientRect();
        const pic = r(".r-pic > .logo"),
          mark = r(".save-btn");
        return { tile: t.getBoundingClientRect().width, gap: pic.left - mark.right };
      });
    const top = await gap(CLAUDE),
      deep = await gap(CODEX);
    expect(deep.tile).toBeLessThan(top.tile); // the tile in Inner narrower...
    expect(Math.abs(deep.gap - top.gap)).toBeLessThan(0.5); // ...its bookmark as far from its avatar
    expect(deep.gap).toBeGreaterThanOrEqual(0); // and not over it
  } finally {
    await noFolders(page);
  }
});
