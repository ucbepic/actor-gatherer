// Moving actors in the folded rail (features/list/RailTiles.tsx railActor, railDragged; features/list/list.ts "DRAGGING"): an actor
// dragged onto a folder's name, its gatherer's, the name the rail is drilled into or a step of the path over it goes
// there; the folders the rail leaves out are shown while one is dragged; a folded one held over opens; Shift+click
// selects several, dragged together.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, open } from "./home";
import { channelOf, newFolder, noFolders, treeOf } from "./folder-tree";

const centre = async (n: Locator) => {
  const b = (await n.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
/** `from` pressed and moved a little, so the page starts its drag; then dropped on what `to` finds once it has. */
async function drag(page: Page, from: Locator, to: () => Locator, hold = 0) {
  const a = await centre(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 3, a.y + 8, { steps: 4 });
  const target = to();
  await expect(target).toBeVisible();
  const b = await centre(target);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
}

test("in the rail, an actor dragged onto a folder's name goes in it, onto its gatherer's name to its top again", async ({
  page,
}) => {
  await open(page);
  const later = await newFolder(page, "Later");
  try {
    const claudeCh = await channelOf(page, "claude");
    await page.locator("#agents .lb-fold").click();
    const rail = page.locator("#rail");
    const tile = (text: string) => rail.locator(".r-actor", { hasText: text });
    const folder = (name: string) => rail.locator(".r-fname, .r-fhead", { hasText: name });
    await expect(folder("Later")).toHaveCount(0); // nothing in it: left out, the foot's "folders" unchecked

    // pressed and moved: the folders it leaves out shown, what is dragged faded
    const a = await centre(tile(CLAUDE));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 3, a.y + 8, { steps: 4 });
    await expect(folder("Later")).toBeVisible();
    await expect(tile(CLAUDE)).toHaveClass(/dragging/);
    const b = await centre(folder("Later"));
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await expect(folder("Later")).toHaveClass(/drop-on/);
    await page.mouse.up();
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [claudeCh]: later });
    // in it now, shown open with it; nothing left faded or lit
    await expect(rail.locator(".r-fopen", { hasText: "Later" }).locator(".r-actor", { hasText: CLAUDE })).toBeVisible();
    await expect(rail.locator(".dragging, .drop-on")).toHaveCount(0);

    await drag(page, tile(CLAUDE), () => rail.locator(".r-gname").first()); // onto its gatherer's name: at its top
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({});
    await expect(folder("Later")).toHaveCount(0); // empty again: left out again

    // a drag let go of over nothing: the rail as it was, at once
    const c = await centre(tile(CLAUDE));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 3, c.y + 8, { steps: 4 });
    await expect(folder("Later")).toBeVisible();
    await page.mouse.move(c.x + 400, c.y, { steps: 6 });
    await page.mouse.up();
    await expect(folder("Later")).toHaveCount(0, { timeout: 1000 });
    expect((await treeOf(page)).filed).toEqual({});
  } finally {
    await noFolders(page);
  }
});

test("in the rail, a folded folder held over opens; drilled in, an actor goes onto its name or up the path", async ({
  page,
}) => {
  await open(page);
  const [ideas, later] = [await newFolder(page, "Ideas"), await newFolder(page, "Later")];
  try {
    const [claudeCh, codexCh] = [await channelOf(page, "claude"), await channelOf(page, "codex")];
    await page.request.post("/api/folders", {
      data: { gatherer: GATHERER, do: "file", channels: [codexCh], folder: ideas },
    });
    await page.locator("#agents .lb-fold").click();
    const rail = page.locator("#rail");
    const tile = (text: string) => rail.locator(".r-actor", { hasText: text });
    await rail.locator(".r-fhead", { hasText: "Ideas" }).click(); // folded by the reader
    await expect(rail.locator(".r-fname", { hasText: "Ideas" })).toBeVisible();
    // held over it, it opens; dropped there, the actor in it
    await drag(page, tile(CLAUDE), () => rail.locator(".r-fname", { hasText: "Ideas" }), 900);
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [codexCh]: ideas, [claudeCh]: ideas });
    await expect(rail.locator(".r-fhead", { hasText: "Ideas" })).toBeVisible();

    // drilled into Ideas: onto the gatherer's step of the path over its name, at the gatherer's top
    await rail.locator(".r-fhead", { hasText: "Ideas" }).dblclick();
    await expect(rail.locator(".r-here .r-hname .nm")).toHaveText("Ideas");
    await drag(page, tile(CODEX), () => rail.locator(".r-step").first());
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [claudeCh]: ideas });
    // the gatherer's top, drilled in: from Ideas onto its name, at its top too; then into Later, shown for the drag
    await rail.locator(".r-step").first().click();
    await expect(rail.locator(".r-here .r-hname .nm")).toHaveText(GATHERER);
    await drag(page, tile(CLAUDE), () => rail.locator(".r-here .r-hname"));
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({});
    await drag(page, tile(CODEX), () => rail.locator(".r-fname, .r-fhead", { hasText: "Later" }));
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [codexCh]: later });
  } finally {
    await noFolders(page);
  }
});

test("in the rail, Shift+click selects several actors, and one dragged moves them all", async ({ page }) => {
  await open(page);
  const later = await newFolder(page, "Later");
  try {
    const [claudeCh, codexCh] = [await channelOf(page, "claude"), await channelOf(page, "codex")];
    await page.locator("#agents .lb-fold").click();
    const rail = page.locator("#rail");
    const tile = (text: string) => rail.locator(".r-actor", { hasText: text });
    await tile(CLAUDE).click({ modifiers: ["Shift"] });
    await expect(tile(CLAUDE)).toHaveClass(/picked/);
    await expect(rail.locator(".r-actor .pick")).toHaveCount(0); // one: tinted only
    await tile(CODEX).click({ modifiers: ["Shift"] });
    await expect(rail.locator(".r-actor.picked")).toHaveCount(2);
    await expect(rail.locator(".r-actor .pick")).toHaveCount(2); // two: a check on each
    await drag(page, tile(CODEX), () => rail.locator(".r-fname", { hasText: "Later" }));
    await expect.poll(async () => (await treeOf(page)).filed).toEqual({ [claudeCh]: later, [codexCh]: later });
    await expect(rail.locator(".r-actor.picked")).toHaveCount(0); // moved: the selection cleared
  } finally {
    await noFolders(page);
  }
});
