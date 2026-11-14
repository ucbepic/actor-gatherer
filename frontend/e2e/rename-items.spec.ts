// A TASK or an APP NAMED by the user, as an actor is (05-agent-list.js's startItemRename): its name in its row
// double-clicked (or F2 on its row), or its card's pencil -- a box with its name in it; Enter keeps what is typed, Esc
// leaves it, nothing typed takes the name back. A task's name kept by the dashboard (POST /api/tasks rename), an app's
// with its instance (POST /api/apps/rename), which its panel's head shows too and is named in by a double-click
// (features/apps/naming.ts).
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, GATHERER, open } from "./home";
import { cardOf, taskHome, taskRow } from "./task-home";

const tasksNamed = async (page: Page) =>
  ((await (await page.request.get("/api/home")).json()).tasks[GATHERER].tasks as { name: string }[]).map((t) => t.name);

test("a task named from its row and from its card; nothing typed: named by what is in it again", async ({ page }) => {
  await taskHome(page, true);
  await open(page);
  const row = taskRow(page);
  await expect(row.locator(".name")).toHaveText("Parser work");
  await row.locator(".name").dblclick(); // its name double-clicked: a box with its name in it
  const box = page.locator("#agents .agent.task input.name-box");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("Parser work");
  await page.keyboard.press("Escape"); // left as it was
  await expect(box).toHaveCount(0);
  await expect(row.locator(".name")).toHaveText("Parser work");

  await row.focus();
  await page.keyboard.press("F2"); // or F2 on its row
  await expect(box).toBeFocused();
  await box.fill("  Trip   plans ");
  await page.keyboard.press("Enter");
  await expect(row.locator(".name")).toHaveText("Trip plans");
  await expect.poll(() => tasksNamed(page)).toEqual(["Trip plans"]); // kept by the dashboard

  const card = await cardOf(page, row); // its card's pencil: the box in the card
  await card.locator(".act.rename").click();
  const cardBox = card.locator("input.c-box");
  await expect(cardBox).toBeFocused();
  await expect(cardBox).toHaveValue("Trip plans");
  await cardBox.fill("");
  await page.keyboard.press("Enter"); // nothing typed: named by its lead actor again
  await expect.poll(() => tasksNamed(page)).toEqual([""]);
  await expect(row.locator(".name")).not.toHaveText("Trip plans");
  await expect(row.locator(".name")).not.toHaveText("");
});

test("an app named from its row and its card, its panel told; nothing typed: its own title again", async ({ page }) => {
  await taskHome(page, false);
  await open(page);
  const gatherer = page.locator("#agents .gatherer-row").first(); // a Notepad with no agent: a row of its own
  await gatherer.hover();
  await gatherer.locator("button.new-more").click();
  await page.locator(".row-menu[role=menu]").getByText("Notepad", { exact: true }).click();
  const pane = page.locator("#top-row > .app-pane[data-app=notepad]");
  await expect(pane).toHaveCount(1);
  const row = page.locator("#agents button.agent.app-row");
  await expect(row).toHaveCount(1);
  const title = (await row.locator(".name").textContent()) || "";
  const named = async () =>
    ((await (await page.request.get(`/api/apps?gatherer=${GATHERER}`)).json()).instances as { name: string }[])[0].name;

  await row.locator(".name").dblclick(); // its name in the list
  const box = page.locator("#agents .agent.app-row input.name-box");
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(title);
  await box.fill("Groceries");
  await page.keyboard.press("Enter");
  await expect(row.locator(".name")).toHaveText("Groceries");
  await expect.poll(named).toBe("Groceries"); // kept with its instance
  await expect(pane).toHaveAttribute("aria-label", "Notepad · Groceries"); // its panel told

  await page.mouse.move(0, 0);
  await row.hover(); // its card's pencil
  const card = page.locator("#actor-card.live");
  await expect(card.locator(".c-nm")).toHaveText("Groceries");
  await card.locator(".act.rename").click();
  await card.locator("input.c-box").fill("");
  await page.keyboard.press("Enter"); // nothing typed: its own title again
  await expect.poll(named).toBe("");
  await expect(row.locator(".name")).toHaveText(title);
  await expect(pane).not.toHaveAttribute("aria-label", /Groceries/);
  await expect(page.locator("#agents button.agent", { hasText: CLAUDE })).toHaveCount(1); // the actors as they were
});
