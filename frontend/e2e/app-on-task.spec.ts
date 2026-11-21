// WHAT "+" DOES WITH AN APP (features/list/list.js's onTask; ag_dashboard/app_policy.py): as its manifest says, or as the
// user chose it on the Apps page -- "join", put in the task (tasks.spec.ts); "folder", opened at the actor's directory
// and shown above the task, in no task, no agent attached (the Files app's); "no", not offered at all.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { GATHERER, open } from "./home";
import { taskHome, taskRow } from "./task-home";

// the apps as the server lists them, Notepad (the test app) said to do `onTask` when added to an actor or a task
async function notepadDoes(page: Page, onTask: string) {
  await page.route(
    (url) => url.pathname === "/api/apps",
    async (route) => {
      const got = await (await route.fetch()).json();
      for (const a of got.apps) if (a.name === "notepad") a.on_task = onTask;
      await route.fulfill({ json: got });
    },
  );
}

test('an app that opens at the agent\'s directory: "+" opens it there, above the task, in no task', async ({
  page,
}) => {
  await taskHome(page, true);
  await notepadDoes(page, "folder");
  const asked: { path: string; body: Record<string, unknown> }[] = [];
  for (const path of ["/api/apps/open", "/api/tasks"])
    await page.route(
      (url) => url.pathname === path,
      async (route) => {
        asked.push({ path, body: route.request().postDataJSON() });
        await route.continue();
      },
    );
  await open(page);
  const row = taskRow(page);
  await row.hover();
  await row.locator(".task-add").click();
  const item = page.locator(".row-menu[role=menu] [role=menuitem]", { hasText: "Notepad" });
  await expect(item).toContainText("opened at its directory, beside the task");
  await item.click();
  await expect(page.locator("#top-row > .app-pane[data-app=notepad]")).toHaveCount(1); // shown above the task
  expect(asked).toEqual([
    { path: "/api/apps/open", body: { app: "notepad", gatherer: GATHERER, folder: "/work/demo", reuse: true } },
  ]); // at the actor's directory, the one there if open; no agent attached, nothing put in the task
  await expect(row.locator(".t-faces .t-app")).toHaveCount(0); // not among the task's
});

test('an app not offered: "+" lists the agents, not it', async ({ page }) => {
  await taskHome(page, false);
  await notepadDoes(page, "no");
  await open(page);
  const row = page.locator("#agents .agent").first();
  await row.hover();
  await row.locator(".task-add").click();
  const menu = page.locator(".row-menu[role=menu]");
  await expect(menu.locator("[role=menuitem] .nm").first()).toHaveText("Claude Code");
  await expect(menu.locator("[role=menuitem]", { hasText: "Notepad" })).toHaveCount(0);
});
