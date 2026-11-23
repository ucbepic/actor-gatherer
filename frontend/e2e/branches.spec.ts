// AN ACTOR ON A BRANCH (features/layout/Branches.tsx): a group's "+" menu's "Actor on a branch…" opens a drop-down of the
// group's sources, hung from the "+" (Radix's DropdownMenu: arrow keys, Esc back to the button); a source chosen opens the
// popup to start from it (Radix's Dialog, the page's <dialog> look on its backdrop): where the branch comes from and where
// its changes go, the approval asked, a start per harness; "Add a source…" opens it choosing one, a typed source added.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { GATHERER, open } from "./home";

type Source = { path: string; name: string; github?: string; head: string; branch: string };
const REPO: Source = { path: "/work/demo", name: "demo", github: "someone/demo", head: "abc1234", branch: "main" };
const OTHER: Source = { path: "/work/other", name: "other", head: "def5678", branch: "dev" };

// the server's home with a harness running here (one actor's to start the branch's on), its sources answered here, and
// each request a start or an added source makes, kept
async function branchHome(page: Page) {
  const asked: { path: string; body: Record<string, unknown> }[] = [];
  const sources = [REPO];
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    home.harnesses = ["claude"];
    home.harness_info.claude = { ...home.harness_info.claude, runs: true };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await page.route("**/api/projects?*", (route) =>
    route.fulfill({ json: { projects: sources, suggestions: [{ path: OTHER.path, name: OTHER.name }] } }),
  );
  await page.route("**/api/projects", async (route) => {
    const body = route.request().postDataJSON();
    asked.push({ path: "projects", body });
    if (body.add === OTHER.path && !sources.includes(OTHER)) sources.push(OTHER);
    await route.fulfill({ json: { projects: sources, suggestions: [] } });
  });
  await page.route("**/api/branches", async (route) => {
    asked.push({ path: "branches", body: route.request().postDataJSON() });
    await route.fulfill({ status: 400, json: { error: "no worktree here" } });
  });
  return asked;
}
async function branchMenu(page: Page) {
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover();
  const plus = row.locator("button.new-actor");
  await plus.click();
  await page.locator(".row-menu[role=menu]").getByRole("menuitem", { name: "Actor on a branch…" }).click();
  const menu = page.getByRole("menu", { name: `New actor on a branch, in ${GATHERER}` });
  await expect(menu).toBeVisible();
  return { plus, menu };
}

test("a group's sources in a drop-down under its +; one chosen, the popup to start from it", async ({ page }) => {
  const asked = await branchHome(page);
  await open(page);
  const { plus, menu } = await branchMenu(page);
  await expect(menu.locator(".hd")).toHaveText("New actor on a branch of");
  await expect(menu.getByRole("menuitem")).toHaveText(["someone/demomain/work/demo", "+ Add a source…"]);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  const [m, p] = [await menu.boundingBox(), await plus.boundingBox()];
  expect(m!.y).toBeGreaterThanOrEqual(p!.y + p!.height); // under the button it hangs from
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "New actor on a branch" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".br-src .nm")).toHaveText("someone/demo");
  await expect(dialog.locator(".route")).toHaveText(
    "A new branch off main at abc1234, merged into /work/demo on main.",
  );
  const start = dialog.getByRole("button", { name: "Claude Code" });
  await expect(start).toBeFocused();
  await dialog.getByRole("checkbox").check();
  await start.click();
  await expect(dialog.locator(".err")).toHaveText("no worktree here"); // said in it, which stays
  expect(asked).toEqual([
    { path: "branches", body: { gatherer: GATHERER, project: REPO.path, harness: "claude", approve: true } },
  ]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("'Add a source…' opens the popup choosing one: one typed is added and chosen; Esc on the drop-down, back to its button", async ({
  page,
}) => {
  const asked = await branchHome(page);
  await open(page);
  const first = await branchMenu(page);
  await page.keyboard.press("Escape");
  await expect(first.menu).toBeHidden();
  await expect(first.plus).toBeFocused();
  const { menu } = await branchMenu(page);
  await menu.getByRole("menuitem", { name: "+ Add a source…" }).click();
  const dialog = page.getByRole("dialog", { name: "New actor on a branch" });
  const where = dialog.getByRole("textbox", { name: "A folder in a git repository, or a GitHub repository" });
  await expect(where).toBeFocused();
  await expect(dialog.locator(".suggest")).toHaveText(["+ other/work/other"]);
  await where.fill(OTHER.path);
  await where.press("Enter");
  await expect(dialog.locator(".br-src .nm")).toHaveText("other");
  expect(asked.map((a) => a.body.add)).toEqual([OTHER.path]);
  await dialog.getByRole("button", { name: "Change" }).click();
  await expect(dialog.locator(".br-row")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
