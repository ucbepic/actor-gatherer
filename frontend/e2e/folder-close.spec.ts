// A folder closed (folders.py's `close`; features/list/list.ts "CLOSING a folder"): its × asks first while something in it is
// open or saved, then it goes into its parent's closed line, with its actors, till reopened; its bin deletes it, what was
// in it moved up. In the list, and in the rail and a folder's card there.
import type { Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CODEX, GATHERER, open } from "./home";
import { channelOf, homeOf, newFolder, noFolders, treeOf } from "./folder-tree";

/** The test home with folder Paper, the Codex actor in it (saved, if `save`), the page opened on it -- each actor's
 * status the page sees `statuses()`'s for it (by harness; else idle), the streams held back, so the server's own home
 * (whose actors read closed or idle, by the system it runs on) does not replace it. */
async function withPaper(page: Page, save: boolean, statuses: () => Record<string, string> = () => ({})) {
  const paper = await newFolder(page, "Paper");
  const codex = await channelOf(page, "codex");
  await page.request.post("/api/folders", {
    data: { gatherer: GATHERER, do: "file", channels: [codex], folder: paper },
  });
  if (save) await page.request.post("/api/saved", { data: { gatherer: GATHERER, channel: codex, saved: true } });
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    for (const a of home.gatherers.find((x: { name: string }) => x.name === GATHERER).agents)
      a.status = statuses()[a.harness] || "idle";
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await open(page);
  return codex;
}
const closedMarks = async (page: Page) => (await treeOf(page)).folders.map((f) => !!(f as { closed?: string }).closed);

test("a folder's × asks first, closes it into its gatherer's closed line, its bookmarks off; reopened, it is back; its bin deletes it", async ({
  page,
}) => {
  const status: Record<string, string> = {};
  const codex = await withPaper(page, true, () => status);
  try {
    const line = page.locator("#agents .folder-line:not(.closed)", { hasText: "Paper" });
    const shut = page.locator("#agents .folder-line.closed", { hasText: "Paper" });
    const ask = page.locator("#agents .f-ask");
    const closedLine = page.locator("#agents .fold-line", { hasText: "closed" });
    await line.hover();
    // "+", "⋯" (a new folder, rename, delete) and its ×
    await expect(line.locator(".f-acts .act:not(.crew)")).toHaveClass([/new-actor/, /row-more/, /close/]);
    await line.locator(".act.row-more").click();
    await expect(page.locator(".row-menu[role=menu] [role=menuitem] .nm")).toHaveText([
      "New folder",
      "Rename",
      "Delete",
    ]);
    await page.keyboard.press("Escape");

    // the Codex actor in it idle and saved: asked first, Cancel in focus; Esc takes it back, nothing done
    await line.locator(".folder-act.close").click();
    await expect(ask.locator("p")).toHaveText(
      "Close Paper? This closes 1 actor and removes 1 bookmark. The folder moves to demo's closed line.",
    );
    await expect(ask.locator('[data-ask="cancel"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(ask).toHaveCount(0);
    expect(await closedMarks(page)).toEqual([false]);

    // closed: in the gatherer's closed line, which counts the actor in it; its bookmark off
    await line.hover();
    await line.locator(".folder-act.close").click();
    await ask.getByRole("button", { name: "Close folder" }).click();
    await expect(line).toHaveCount(0);
    await expect(closedLine).toHaveText("▸ 1 closed");
    await expect.poll(() => closedMarks(page)).toEqual([true]);
    await expect.poll(async () => Object.keys((await homeOf(page)).saved?.[GATHERER] || {})).toEqual([]);
    expect(Object.keys((await homeOf(page)).saved?.[GATHERER] || {})).not.toContain(codex);

    // the closed line opened: the folder greyed, how many it holds; its buttons rename, delete, reopen -- no starts
    await closedLine.click();
    await expect(shut).toBeVisible();
    await expect(shut.locator(".count.closed")).toHaveText("1");
    await shut.hover();
    await expect(shut.locator(".folder-act")).toHaveClass([/rename/, /delete/, /reopen/]);
    await expect(shut.locator(".act.start")).toHaveCount(0);
    await shut.locator(".fname").click(); // opened: its actors, under no line of their own
    await expect(page.locator("#agents .f-kids .agent", { hasText: CODEX })).toBeVisible();
    await expect(page.locator("#agents .f-kids .fold-line")).toHaveCount(0);

    // reopened: with the open folders again, the closed line gone
    await shut.hover();
    await shut.locator(".folder-act.reopen").click();
    await expect(line).toBeVisible();
    await expect(closedLine).toHaveCount(0);
    await expect.poll(() => closedMarks(page)).toEqual([false]);

    // all in it closed and none saved: closed at once, nothing asked
    status.codex = "closed";
    await page.reload();
    await line.hover();
    await line.locator(".folder-act.close").click();
    await expect(ask).toHaveCount(0);
    await expect(closedLine).toHaveText("▾ 1 closed"); // opened before: kept so in this browser
    await expect.poll(() => closedMarks(page)).toEqual([true]);

    // deleted from the closed line: gone, its actor at the gatherer's top
    await shut.hover();
    await shut.locator(".folder-act.delete").click();
    await expect.poll(async () => (await treeOf(page)).folders.length).toBe(0);
    expect((await treeOf(page)).filed).toEqual({});
  } finally {
    await noFolders(page);
    await page.request.post("/api/saved", { data: { gatherer: GATHERER, channel: codex, saved: false } });
  }
});

test("in the rail, a folder's card asks before closing it; closed, it is in the rail's closed line, and its card reopens it", async ({
  page,
}) => {
  await withPaper(page, false);
  try {
    await page.locator("#agents .lb-fold").click();
    const rail = page.locator("#rail");
    const card = page.locator("#actor-card");
    const name = rail.locator(":is(.r-fname, .r-fhead)", { hasText: "Paper" });
    await name.hover(); // its actor idle: shown, open
    await expect(card.locator(".c-acts .act.close")).toBeVisible();
    await card.locator(".c-acts .act.close").click();
    await expect(card.locator(".f-ask p")).toHaveText(
      "Close Paper? This closes 1 actor. The folder moves to demo's closed line.",
    );
    await expect(card.locator('[data-ask="cancel"]')).toBeFocused();
    await card.getByRole("button", { name: "Close folder" }).click();
    await expect(card).toBeHidden();
    await expect.poll(() => closedMarks(page)).toEqual([true]);

    // the closed line, once checked: the folder in it, greyed; its card's buttons rename, delete, reopen
    await rail.locator(".r-show-hd").hover();
    await rail.locator(".r-check", { hasText: "closed" }).click();
    await expect(rail.locator(".r-fold")).toHaveText(["▸ 1 closed"]);
    await rail.locator(".r-fold").click();
    const shut = rail.locator(":is(.r-ffold, .r-fopen).closed :is(.r-fname, .r-fhead)", { hasText: "Paper" });
    await expect(shut).toBeVisible();
    await shut.hover();
    await expect(card.locator(".c-acts .act")).toHaveClass([/rename/, /delete/, /reopen/]);
    await card.locator(".c-acts .act.reopen").click();
    await expect.poll(() => closedMarks(page)).toEqual([false]);
    await expect(rail.locator(".r-fold")).toHaveCount(0);
    await expect(rail.locator(".r-fhead", { hasText: "Paper" })).toBeVisible();
  } finally {
    await noFolders(page);
  }
});
