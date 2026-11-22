// Folders of gatherers (gatherer_folders.py; features/list/gatherer-folders.ts): none at first, the list as without them; one made
// as the server makes them (the list makes none: its folder button makes a group, groups-merge.spec.ts), a gatherer dragged into it and out onto the head, folders in folders, folded (nothing of it in
// view), renamed and deleted -- no counts, no start buttons on their lines, no actor dropped in one; and
// in the rail, the same folders, folded and opened there.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { treeOf } from "./folder-tree";

type Tree = { folders: { id: number; parent: number | null; name: string }[]; filed: Record<string, number> };
const gfTree = async (page: Page) =>
  ((await (await page.request.get("/api/home")).json()).gatherer_folders || { folders: [], filed: {} }) as Tree;
const gfPost = (page: Page, data: Record<string, unknown>) => page.request.post("/api/gatherer-folders", { data });
/** No folders of gatherers: every gatherer at the list's top, as at first. */
async function noGathererFolders(page: Page) {
  for (const f of (await gfTree(page)).folders) await gfPost(page, { do: "delete", id: f.id });
  const filed = Object.keys((await gfTree(page)).filed);
  if (filed.length) await gfPost(page, { do: "file", gatherers: filed });
}

test("keeps gatherers in folders of their own: filled by dragging, nested, folded and deleted", async ({ page }) => {
  await open(page);
  const line = (name: string) => page.locator("#agents .gf-line", { hasText: name });
  const gRow = page.locator("#agents .gatherer-row", { hasText: GATHERER });
  const box = page.locator("#agents .folder-box");
  const head = page.locator("#agents .aside-head");
  try {
    await expect(page.locator("#agents .gf-line")).toHaveCount(0); // none: as without them
    await expect(gRow).not.toHaveAttribute("draggable", "true"); // nothing to drag it into
    await gfPost(page, { do: "new", name: "Work projects" }); // kept from before: the list makes none now
    await page.reload();
    await expect(line("Work projects")).toBeVisible();
    await expect(page.locator("#agents .gf-kids .f-empty")).toHaveText("Empty · drag groups here"); // made open
    await expect.poll(async () => (await gfTree(page)).folders.map((f) => f.name)).toEqual(["Work projects"]);
    const work = (await gfTree(page)).folders[0].id;
    await line("Work projects").hover(); // its buttons: a folder in it, rename, delete -- no counts, no starts
    await expect(line("Work projects").locator(".folder-act")).toHaveCount(3);
    await expect(line("Work projects").locator(":is(.count, .act.start)")).toHaveCount(0);

    await page.locator("#agents .agent", { hasText: CODEX }).dragTo(line("Work projects")); // an actor: not put in it
    await expect(gRow).toHaveAttribute("draggable", "true");
    await gRow.dragTo(line("Work projects"));
    await expect(page.locator("#agents .gf-kids .gatherer-row", { hasText: GATHERER })).toBeVisible();
    await expect(page.locator("#agents .gf-kids .agent", { hasText: CLAUDE })).toBeVisible(); // its actors with it
    await expect.poll(async () => (await gfTree(page)).filed).toEqual({ [GATHERER]: work });
    expect((await treeOf(page)).filed).toEqual({}); // the actor dragged before: still at its gatherer's top

    await page.locator("#agents .agent", { hasText: CLAUDE }).click(); // open in the pane...
    await line("Work projects").locator(".fbtn").click(); // ...folded: nothing of it in view, not even that actor
    await expect(line("Work projects").locator(".fbtn")).toHaveAttribute("aria-expanded", "false");
    await expect(gRow).toHaveCount(0);
    await expect(page.locator("#agents .gf-kids .agent")).toHaveCount(0);
    await page.reload(); // folded, kept in this browser
    await expect(line("Work projects").locator(".fbtn")).toHaveAttribute("aria-expanded", "false");
    await line("Work projects").locator(".fbtn").click();
    await expect(gRow).toBeVisible();

    await gfPost(page, { do: "new", name: "Archive", parent: work }); // a folder in it; the gatherer dragged into that
    await page.reload();
    await expect(page.locator("#agents .gf-kids .gf-line", { hasText: "Archive" })).toBeVisible();
    const archive = (await gfTree(page)).folders.find((f) => f.name === "Archive")!.id;
    await gRow.dragTo(line("Archive"));
    await expect.poll(async () => (await gfTree(page)).filed).toEqual({ [GATHERER]: archive });
    await expect(page.locator("#agents .gf-kids .gf-kids .gatherer-row", { hasText: GATHERER })).toBeVisible();
    await line("Work projects").hover();
    await line("Work projects").locator(".folder-act.rename").click();
    await box.fill("Work");
    await box.press("Enter");
    await expect(line("Work")).toBeVisible();

    await gRow.dragTo(head); // onto the list's head: at its top again
    await expect.poll(async () => (await gfTree(page)).filed).toEqual({});
    await expect(page.locator("#agents .gf-kids .gatherer-row")).toHaveCount(0);
    await line("Work").hover(); // deleted: the folder in it moves up a level
    await line("Work").locator(".folder-act.delete").click();
    await expect(page.locator("#agents .gf-line .fname")).toHaveText(["Archive"]);
    await expect
      .poll(async () => (await gfTree(page)).folders.map((f) => [f.name, f.parent]))
      .toEqual([["Archive", null]]);
  } finally {
    await noGathererFolders(page);
  }
});

test("gatherers selected with Cmd/Ctrl+click are dragged into a folder together", async ({ page }) => {
  await gfPost(page, { do: "new", name: "Work" });
  try {
    await open(page);
    const gRow = page.locator("#agents .gatherer-row", { hasText: GATHERER });
    const name = gRow.locator("button.name");
    await gRow.locator(".gname").click({ modifiers: ["ControlOrMeta"] });
    await expect(gRow).toHaveClass(/\bpicked\b/);
    await expect(name).toHaveAttribute("aria-expanded", "true"); // selected, not folded
    await page.keyboard.press("Escape");
    await expect(gRow).not.toHaveClass(/\bpicked\b/);
    await gRow.locator(".gname").click({ modifiers: ["ControlOrMeta"] });
    await gRow.dragTo(page.locator("#agents .gf-line", { hasText: "Work" }));
    await expect(page.locator("#agents .gf-kids .gatherer-row", { hasText: GATHERER })).toBeVisible();
    await expect(page.locator("#agents .gatherer-row.picked")).toHaveCount(0); // the drop clears the selection
  } finally {
    await noGathererFolders(page);
  }
});

test("in the rail, a folder of gatherers holds its gatherers, folds and opens", async ({ page }) => {
  const work = (await (await gfPost(page, { do: "new", name: "Work" })).json()).made as number;
  await gfPost(page, { do: "file", gatherers: [GATHERER], folder: work });
  try {
    await open(page);
    await page.locator("#agents .lb-fold").click();
    const folder = page.locator("#rail .r-gf");
    await expect(folder.locator(".r-fhead")).toHaveText(/Work/);
    await expect(folder.locator(".r-kids .r-gname", { hasText: GATHERER })).toBeVisible(); // its gatherer in it
    await expect(folder.locator(".r-counts")).toHaveCount(0);
    await folder.locator(".r-fhead").click();
    await expect(folder.locator(".r-fname")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#rail .r-gname")).toHaveCount(0);
    await page.locator("#list-btns .lb-fold").click(); // the list: folded there too
    await expect(page.locator("#agents .gf-line .fbtn")).toHaveAttribute("aria-expanded", "false");
    await page.locator("#agents .gf-line .fbtn").click();
    await page.locator("#agents .lb-fold").click();
    await expect(page.locator("#rail .r-gf .r-kids .r-gname", { hasText: GATHERER })).toBeVisible();
  } finally {
    await noGathererFolders(page);
  }
});
