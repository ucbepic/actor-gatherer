// The test home as the TASKS tests (tasks.spec.ts, task-close.spec.ts) use it: its actors made one task, or each a task
// of its own, and the ways those tests reach a task -- its row, its card, its "+".
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests } from "./test";
import { GATHERER } from "./home";

export type Agent = {
  harness?: string;
  channel: string;
  cwd?: string;
  session?: Record<string, unknown>;
  chattable?: boolean;
};

// the home as the server has it -- its two actors made one task ("Parser work") on the server first if `together` --
// with two harnesses a session can be started on here and its actors working in a directory (its stream held back, so the
// server's own home does not replace it)
export async function taskHome(page: Page, together: boolean, running = false) {
  if (together) {
    const home = await (await page.request.get("/api/home")).json();
    const agents: Agent[] = home.gatherers.find((x: { name: string }) => x.name === GATHERER).agents;
    const [a, b] = agents.filter((x) => x.harness === "claude" || x.harness === "codex").map((x) => x.channel);
    const made = await page.request.post("/api/tasks", {
      data: { gatherer: GATHERER, do: "add", to: a, items: [b], name: "Parser work" },
    });
    expect(made.ok()).toBe(true);
  }
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const agents: Agent[] = home.gatherers.find((x: { name: string }) => x.name === GATHERER).agents;
    for (const a of agents) a.cwd = "/work/demo";
    if (running)
      for (const a of agents) {
        a.session = { ...(a.session || {}), session_id: a.channel, terminal: true }; // closable: the dashboard runs it
        a.chattable = true;
      }
    home.harnesses = ["claude", "codex"];
    for (const h of home.harnesses) home.harness_info[h] = { ...home.harness_info[h], runs: true };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
}
// Notepad (the test app, tests/apps/notepad) added from the "+" of `row` (an item's or a task's): its menu's Notepad picked
export async function addNotepad(page: Page, row: ReturnType<Page["locator"]>) {
  await row.hover();
  await row.locator(".task-add").first().click();
  await page.locator(".row-menu[role=menu] [role=menuitem] .nm", { hasText: /^Notepad$/ }).click();
}
export const taskRow = (page: Page) => page.locator("#agents .agent.task");
// a task's card -- what is in it, listed (a group: not in the list) -- its row hovered, the pointer come from off the list
export async function cardOf(page: Page, row: ReturnType<Page["locator"]>) {
  await page.mouse.move(0, 0);
  await row.hover();
  const card = page.locator("#actor-card.live");
  await expect(card).toBeVisible();
  return card;
}
