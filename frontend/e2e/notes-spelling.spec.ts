// Typos in the Notes app (ag_apps/notes/): in the desktop app, a click in a misspelled word opens its fixes under it,
// from the system's spellchecker (the app's preload, window.agApp.spelling: faked here). One picked takes the word's
// place as typing it would, and ⌘Z takes it back; "Add to dictionary" adds the word, only as the user clicks. Outside
// the app a page can't ask the spellchecker, and a click opens nothing.
import type { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { open } from "./home";
import { binPage, call, newPage, openNotes } from "./notes-home";

const FIXES: Record<string, string[]> = { teh: ["the", "tech", "ten"], wrold: ["world", "wold"], zzxq: [] };

/** The desktop app's preload, as the dashboard's page sees it: a spellchecker knowing FIXES' words misspelled, until
 * one is added to the dictionary. */
async function asInTheApp(page: Page) {
  await page.addInitScript((fixes: Record<string, string[]>) => {
    if (window.top !== window) return; // (the dashboard's page only: apps' panels get none)
    const learned: string[] = [];
    const known = (w: string) => w in fixes && !learned.includes(w);
    Object.assign(window, {
      learned,
      agApp: {
        native: true,
        place: () => {},
        onStill: () => {},
        stillDrawn: () => {},
        spelling: (w: string) => ({ misspelled: known(w), suggestions: known(w) ? fixes[w] : [] }),
        learn: (w: string) => learned.push(w),
      },
    });
  }, FIXES);
}

/** A real click, in the middle of `word` of the line holding it. */
async function clickWord(page: Page, panel: FrameLocator, word: string) {
  const at = await panel
    .locator(".blk .tx", { hasText: word })
    .first()
    .evaluate((tx, w) => {
      const walk = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT);
      let n: Text | null;
      while ((n = walk.nextNode() as Text | null) && !n.data.includes(w));
      const r = document.createRange(),
        i = n!.data.indexOf(w);
      r.setStart(n!, i + 1);
      r.setEnd(n!, i + 2);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, word);
  const frame = (await page.locator("#top-row > .app-pane[data-app=notes] iframe").boundingBox())!;
  await page.mouse.click(frame.x + at.x, frame.y + at.y);
}

const read = async (page: Page, instance: string, title: string) =>
  (await call(page, instance, "read", { page: title })).text;

test("a click in a misspelled word offers its fixes; one picked takes its place, ⌘Z takes it back", async ({
  page,
}) => {
  await asInTheApp(page);
  await open(page);
  const { panel, instance } = await openNotes(page);
  await newPage(page, panel, "Typos");
  await page.keyboard.type("I fixed teh wrold today");
  const line = panel.locator(".blk .tx").first();
  const fixes = panel.locator(".pop.spell");

  // a word spelled right: nothing
  await clickWord(page, panel, "today");
  await page.waitForTimeout(300);
  await expect(fixes).toBeHidden();

  // a misspelled one: its fixes, under it
  await clickWord(page, panel, "teh");
  await expect(fixes).toBeVisible();
  await expect(fixes.locator(".it .tt")).toHaveText(["the", "tech", "ten", "Add to dictionary"]);
  const word = await line.evaluate((tx) => {
    const n = tx.firstChild as Text,
      r = document.createRange();
    r.setStart(n, n.data.indexOf("teh"));
    r.setEnd(n, n.data.indexOf("teh") + 3);
    return r.getBoundingClientRect().bottom;
  });
  const top = await fixes.evaluate((p) => p.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(word);
  await fixes.locator(".it", { hasText: "the" }).first().click();
  await expect(fixes).toBeHidden();
  await expect(line).toHaveText("I fixed the wrold today");
  await expect(line).toBeFocused(); // the keys still in the line, after the word
  await page.keyboard.type("!");
  await expect(line).toHaveText("I fixed the! wrold today");
  await page.keyboard.press("Backspace");
  await expect.poll(() => read(page, instance, "Typos")).toMatch(/I fixed the wrold today/);
  await page.keyboard.press("ControlOrMeta+z"); // the "!" and its Backspace
  await page.keyboard.press("ControlOrMeta+z"); // the fix alone
  await expect(line).toHaveText("I fixed teh wrold today");

  // typing closes the fixes, and goes on into the line; so does Esc
  await clickWord(page, panel, "wrold");
  await expect(fixes).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fixes).toBeHidden();
  await clickWord(page, panel, "wrold");
  await expect(fixes).toBeVisible();
  await page.keyboard.type("x");
  await expect(fixes).toBeHidden();
  await expect(line).toContainText("x");
  await page.keyboard.press("Backspace");

  // in the title too
  await panel.locator("#title").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" teh");
  const title = await panel.locator("#title").evaluate((t) => {
    const n = t.firstChild as Text,
      r = document.createRange();
    r.setStart(n, n.data.indexOf("teh") + 1);
    r.setEnd(n, n.data.indexOf("teh") + 2);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const frame = (await page.locator("#top-row > .app-pane[data-app=notes] iframe").boundingBox())!;
  await page.mouse.click(frame.x + title.x, frame.y + title.y);
  await fixes.locator(".it", { hasText: "ten" }).click();
  await expect(panel.locator("#title")).toHaveText("Typos ten");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(panel.locator("#title")).toHaveText("Typos");
  await binPage(panel, "Typos");
});

test("Add to dictionary adds the word, only as the user clicks; no fixes found says so", async ({ page }) => {
  await asInTheApp(page);
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Dictionary");
  await page.keyboard.type("zzxq and wrold");
  const fixes = panel.locator(".pop.spell");

  await clickWord(page, panel, "zzxq");
  await expect(fixes.locator(".none")).toHaveText("No suggestions");
  await expect(fixes.locator(".it .tt")).toHaveText(["Add to dictionary"]);
  await page.keyboard.press("Escape");

  await clickWord(page, panel, "wrold");
  await fixes.locator(".it", { hasText: "Add to dictionary" }).click();
  await expect(fixes).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { learned: string[] }).learned)).toEqual(["wrold"]);
  await clickWord(page, panel, "wrold"); // in the dictionary now: spelled right
  await page.waitForTimeout(300);
  await expect(fixes).toBeHidden();

  // asked by the panel's code on its own, not as the user clicks (a click counts for 5 s; Playwright's evaluate is one):
  // refused
  const frame = page.frames().find((f) => f.url().includes("notes.localhost"))!;
  type Asks = {
    AgApp: { connect: () => Promise<{ spelling: { learn: (w: string) => Promise<unknown> } }> };
    refused?: string;
  };
  await frame.evaluate(() => {
    const w = window as unknown as Asks;
    setTimeout(() => {
      w.AgApp.connect()
        .then((ag) => ag.spelling.learn("zzxq"))
        .then(
          () => (w.refused = ""),
          (e: Error) => (w.refused = e.message),
        );
    }, 5_500);
  });
  await page.waitForTimeout(5_500);
  await expect
    .poll(() => frame.evaluate(() => (window as unknown as Asks).refused), { timeout: 5_000 })
    .toContain("only as the user clicks");
  expect(await page.evaluate(() => (window as unknown as { learned: string[] }).learned)).toEqual(["wrold"]);
  await binPage(panel, "Dictionary");
});

test("outside the desktop app a click in a word opens nothing", async ({ page }) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Outside");
  await page.keyboard.type("I fixed teh wrold");
  await clickWord(page, panel, "teh");
  await page.waitForTimeout(300);
  await expect(panel.locator(".pop.spell")).toBeHidden();
  await binPage(panel, "Outside");
});
