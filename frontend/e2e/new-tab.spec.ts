// A NEW TAB's page (07-new-tab.js): "+" on the tabs' bar, or ⌃T (⌘T in the ag app), opens a tab showing a message box
// for a new actor -- Enter starts one where its line says (a group, a folder of one, or on its own; a directory; a
// harness), what was typed its first message, in this tab -- and the apps to open in it instead. Where it goes to start
// with: the place last started in. What is typed is kept with the tab: left with something typed, the tab stays, and a
// task clicked in the list goes in a tab of its own. ⌃W closes the tab shown; the only one, emptied, is a new tab again.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";

type Agent = { channel: string; harness?: string; [k: string]: unknown };
type Group = { name: string; agents: Agent[]; [k: string]: unknown };
const STARTED = "a1012e00-0000-4000-8000-0000000000e1";
const FOLDER = { id: 7, parent: null, name: "fixes" };
const tabs = (page: Page) => page.locator(".lay-tabs:visible .lay-tab");
const page_ = (page: Page) => page.locator(".work > .lay-empty.nt:not([hidden])");
const box = (page: Page) => page_(page).getByRole("textbox", { name: "Message a new actor" });
const chip = (page: Page, which: "in" | "dir" | "on") => page_(page).locator(`.nt-chip[data-pop="nt:${which}"] .val`);
const row = (page: Page, text: string) => page.locator("#agents button.agent", { hasText: text });
const menuItem = (page: Page, text: string) =>
  page
    .locator(".row-menu[role=menu] [role=menuitem]")
    .filter({ has: page.locator(".nm", { hasText: new RegExp(`^${text}$`) }) });

// The page on a Mac (where ⌃T and ⌃W are the page's); the server's home with both harnesses running (Codex naming its
// session only at its first call), every actor in /work/demo, a folder "fixes" in demo -- on the home's one database
// (`merged`) or not. Once started, the new actor is listed: in demo, or on its own. Each request a start makes, kept.
async function newTabHome(page: Page, merged = false) {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" }));
  const state = { started: "" };
  const asked: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const demo = home.gatherers.find((x: Group) => x.name === GATHERER) as Group;
    for (const a of demo.agents) a.cwd = "/work/demo";
    home.harnesses = ["claude", "codex"];
    for (const h of home.harnesses) home.harness_info[h] = { ...home.harness_info[h], runs: true };
    home.harness_info.codex.picks_id = true;
    home.folders = {
      [GATHERER]: { folders: [FOLDER], filed: state.started === "group" ? { [STARTED]: FOLDER.id } : {} },
    };
    if (state.started) {
      const claude = demo.agents.find((a) => a.harness === "claude")!;
      const gname = state.started === "alone" ? `self:${STARTED}` : GATHERER;
      const fresh = {
        ...claude,
        channel: STARTED,
        status: "idle",
        last_user_message: null,
        name: null,
        last: null,
        chattable: true,
        session: { session_id: STARTED, gatherer: gname, status: "idle", terminal: false, cwd: "/work/demo" },
      };
      if (state.started === "alone") home.gatherers.push({ ...demo, name: gname, alone: true, agents: [fresh] });
      else demo.agents.push(fresh);
    }
    home.merged = merged;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await page.route("**/api/sessions", async (route) => {
    const body = route.request().postDataJSON();
    asked.push({ path: "sessions", body });
    state.started = body.alone ? "alone" : "group";
    const gatherer = body.alone ? `self:${STARTED}` : GATHERER;
    await route.fulfill({ json: { session_id: STARTED, gatherer, harness: body.harness, cwd: body.cwd } });
  });
  await page.route("**/api/folders", async (route) => {
    const body = route.request().postDataJSON();
    asked.push({ path: "folders", body });
    await route.fulfill({ json: { folders: { [GATHERER]: { folders: [FOLDER], filed: { [STARTED]: FOLDER.id } } } } });
  });
  await page.route("**/api/send", async (route) => {
    asked.push({ path: "send", body: route.request().postDataJSON() });
    await route.fulfill({ json: {} });
  });
  return asked;
}

test("+ opens a new tab: Enter starts an actor where its line says, what was typed its first message, in this tab", async ({
  page,
}) => {
  const asked = await newTabHome(page);
  await open(page);
  await row(page, CLAUDE).click();
  await page.locator(".lay-tab-add").click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(box(page)).toBeFocused();
  await expect(chip(page, "in")).toHaveText(GATHERER); // the actor last shown's group, nothing started yet
  await expect(chip(page, "dir")).toHaveText("/work/demo"); // its latest active actor's
  await expect(chip(page, "on")).toHaveText("Claude Code");
  await expect(page_(page).locator(".nt-app", { hasText: "Notepad" })).toBeVisible();
  await page_(page).locator('.nt-chip[data-pop="nt:in"]').click();
  await expect(menuItem(page, "On its own")).toHaveCount(0); // a database per gatherer: no actor on its own
  await menuItem(page, "fixes").click(); // a folder of demo
  await expect(chip(page, "in")).toHaveText(`${GATHERER} › fixes`);
  await page_(page).locator('.nt-chip[data-pop="nt:on"]').click();
  await menuItem(page, "Codex").click();
  await expect(chip(page, "on")).toHaveText("Codex");
  await box(page).fill("Look at the parser");
  await box(page).press("Enter");
  await expect.poll(() => asked.map((x) => x.path)).toEqual(["sessions", "folders", "send"]);
  expect(asked[0].body).toEqual({ gatherer: GATHERER, cwd: "/work/demo", harness: "codex" });
  expect(asked[1].body).toMatchObject({ gatherer: GATHERER, do: "file", channels: [STARTED], folder: FOLDER.id });
  expect(asked[2].body).toMatchObject({ text: "Look at the parser" });
  expect(asked[2].body.session_id ?? asked[2].body.channel).toBe(STARTED);
  await expect(page_(page)).toHaveCount(0); // the tab shows the actor now
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.locator(".lay-tab-add").click(); // the next new tab: where the last one started, on its harness
  await expect(chip(page, "in")).toHaveText(`${GATHERER} › fixes`);
  await expect(chip(page, "on")).toHaveText("Codex");
});

test("on the home's one database, a new tab starts an actor on its own, on a harness that can be", async ({ page }) => {
  const asked = await newTabHome(page, true);
  await open(page);
  await row(page, CLAUDE).click();
  await page.locator(".lay-tab-add").click();
  await page_(page).locator('.nt-chip[data-pop="nt:in"]').click();
  await menuItem(page, "On its own").click();
  await expect(chip(page, "in")).toHaveText("On its own");
  await expect(chip(page, "on")).toHaveText("Claude Code");
  await expect(page_(page).locator('.nt-chip[data-pop="nt:on"]')).toBeDisabled(); // Codex can't: the only one
  await expect(page_(page).locator(".nt-app").first()).toBeDisabled(); // apps open in a group
  await box(page).fill("Something of its own");
  await box(page).press("Enter");
  await expect.poll(() => asked.map((x) => x.path)).toEqual(["sessions", "send"]); // filed in no folder
  expect(asked[0].body).toEqual({ gatherer: GATHERER, cwd: "/work/demo", harness: "claude", alone: true });
  await expect(page.locator("#agents .gatherer.alone button.agent")).toHaveCount(1);
});

test("⌃T opens a new tab, its box in focus; ⌃W closes the tab shown -- the only one emptied, a new tab", async ({
  page,
}) => {
  await newTabHome(page);
  await open(page);
  await row(page, CLAUDE).click();
  await expect(tabs(page)).toHaveCount(1);
  await page.keyboard.press("Control+t");
  await expect(tabs(page)).toHaveCount(2);
  await expect(box(page)).toBeFocused();
  await page.keyboard.press("Control+t"); // a new tab's page shown already: its box, no other
  await expect(tabs(page)).toHaveCount(2);
  await page.keyboard.press("Control+w"); // from its box: the tab closed, Claude's shown
  await expect(tabs(page)).toHaveCount(1);
  await expect(row(page, CLAUDE)).toHaveAttribute("aria-current", "true");
  await expect(page_(page)).toHaveCount(0);
  await page.keyboard.press("Control+w"); // the only tab: emptied, Claude kept as it was (open nowhere now)
  await expect(tabs(page)).toHaveCount(1);
  await expect(page_(page)).toHaveCount(1);
  await expect(box(page)).toBeFocused();
  await row(page, CLAUDE).click(); // into the tab showing nothing
  await expect(tabs(page)).toHaveCount(1);
  await expect(page_(page)).toHaveCount(0);
});

test("what a new tab's box holds is kept with it: a task clicked goes in a tab of its own, and the tab stays", async ({
  page,
}) => {
  await newTabHome(page);
  await open(page);
  await row(page, CLAUDE).click();
  await page.locator(".lay-tab-add").click();
  await box(page).fill("half a thought");
  await row(page, CODEX).click(); // open nowhere: a tab of its own, not this one
  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(tabs(page).nth(1)).toContainText("New tab");
  await tabs(page).nth(1).click();
  await expect(box(page)).toHaveValue("half a thought");
  await page.reload(); // kept in this browser, with the tabs
  await expect(page.locator("#agents")).toContainText(GATHERER);
  await expect(box(page)).toHaveValue("half a thought");
});

test("a new tab's app opens in it, in the group its line says", async ({ page }) => {
  await newTabHome(page);
  await open(page);
  await row(page, CLAUDE).click();
  await page.locator(".lay-tab-add").click();
  await page_(page).locator(".nt-app", { hasText: "Notepad" }).click();
  const pane = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(pane).toHaveCount(1);
  await expect(page_(page)).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(2); // in this tab
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
});
