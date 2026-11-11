// Undo in Notes (ag_apps/notes/panel): ⌘Z takes back the reader's own changes to the page open, one step at a time --
// a line moved by its grip or ⌘⇧↑, indented, split, typed in, cut and pasted -- and ⌘⇧Z does them again; never the
// browser's own undo, which knew nothing of these and took letters out of another line. A line an agent changed since
// is left as it is.
import type { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { open } from "./home";
import { binPage, call, newPage, openNotes } from "./notes-home";

/** The open page's lines: each its indent and what it says. */
const lines = (panel: FrameLocator) =>
  panel
    .locator("#blocks > .blk")
    .evaluateAll((ns) =>
      ns.map(
        (n) =>
          `${getComputedStyle(n).getPropertyValue("--ind").trim()}:${(n.querySelector(".tx")?.textContent || "").replace(/\s+/g, " ").trim()}`,
      ),
    );
const row = (panel: FrameLocator, text: string) =>
  panel.locator("#blocks > .blk", { has: panel.locator(".tx", { hasText: new RegExp(`^${text}$`) }) });

async function type(page: Page, ...words: string[]) {
  for (const [i, w] of words.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(w);
  }
}
const undo = (page: Page) => page.keyboard.press("ControlOrMeta+z");
const redo = (page: Page) => page.keyboard.press("ControlOrMeta+Shift+z");

test("⌘Z takes back a move by the grip, ⌘⇧↑, Tab and typing, one at a time, and ⌘⇧Z does them again", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Undo");
  await type(page, "one", "two", "three");

  // moved by hand: by its grip
  const three = row(panel, "three");
  await three.hover();
  const grip = (await three.locator(".grip").boundingBox())!;
  const top = (await row(panel, "one").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 4, top.y + 3, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => lines(panel)).toEqual(["0:three", "0:one", "0:two"]);
  await undo(page);
  await expect.poll(() => lines(panel)).toEqual(["0:one", "0:two", "0:three"]); // the words typed before, untouched
  await redo(page);
  await expect.poll(() => lines(panel)).toEqual(["0:three", "0:one", "0:two"]);
  await undo(page);

  // and with ⌘⇧↑, and Tab
  await row(panel, "three").locator(".tx").click();
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await expect.poll(() => lines(panel)).toEqual(["0:one", "0:three", "0:two"]);
  await page.keyboard.press("Tab");
  await expect.poll(() => lines(panel)).toEqual(["0:one", "1:three", "0:two"]);
  await undo(page);
  await expect.poll(() => lines(panel)).toEqual(["0:one", "0:three", "0:two"]);
  await undo(page);
  await expect.poll(() => lines(panel)).toEqual(["0:one", "0:two", "0:three"]);
  await redo(page);
  await redo(page);
  await expect.poll(() => lines(panel)).toEqual(["0:one", "1:three", "0:two"]);
  await undo(page);
  await undo(page);

  // typing, and the caret back where the words were
  await row(panel, "two").locator(".tx").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  await expect.poll(() => lines(panel)).toEqual(["0:one", "0:two more", "0:three"]);
  await undo(page);
  await expect.poll(() => lines(panel)).toEqual(["0:one", "0:two", "0:three"]);
  await page.keyboard.type("!");
  await expect.poll(() => lines(panel)).toEqual(["0:one", "0:two!", "0:three"]);

  await page.reload(); // as the backend has it
  const again = page.locator("#top-row > .app-pane[data-app=notes]").frameLocator("iframe");
  await expect(again.locator("#title")).toHaveText("Undo");
  await expect.poll(() => lines(again)).toEqual(["0:one", "0:two!", "0:three"]);
  await binPage(again, "Undo");
});

test("lines cut and pasted elsewhere: ⌘Z takes back the paste, then the cut", async ({ page }) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Cut");
  await type(page, "a", "b", "c", "d");
  await row(panel, "b").locator(".tx").click();
  await row(panel, "c")
    .locator(".tx")
    .click({ modifiers: ["Shift"] });
  const [text, ours] = await panel.locator("body").evaluate(() => {
    const dt = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent("cut", { clipboardData: dt, bubbles: true, cancelable: true }));
    return [dt.getData("text/plain"), dt.getData("application/x-ag-notes-blocks")];
  });
  await expect.poll(() => lines(panel)).toEqual(["0:a", "0:d"]);
  await row(panel, "d").locator(".tx").click();
  await page.keyboard.press("End");
  await panel.locator("body").evaluate(
    (_, [t, o]) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      dt.setData("application/x-ag-notes-blocks", o);
      document.activeElement!.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    [text, ours],
  );
  await expect.poll(() => lines(panel)).toEqual(["0:a", "0:d", "0:b", "0:c"]);
  await undo(page);
  await expect.poll(() => lines(panel)).toEqual(["0:a", "0:d"]);
  await undo(page);
  await expect.poll(() => lines(panel)).toEqual(["0:a", "0:b", "0:c", "0:d"]);
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(2); // back, and picked as they were
  await binPage(panel, "Cut");
});

test("a line an agent changed since is left as it is, and the reader told", async ({ page }) => {
  await open(page);
  const { panel, instance } = await openNotes(page);
  await newPage(page, panel, "Theirs");
  await type(page, "mine", "next");
  await row(panel, "next").locator(".tx").click();
  await page.keyboard.press("Tab");
  await expect.poll(() => lines(panel)).toEqual(["0:mine", "1:next"]);
  await row(panel, "mine").locator(".tx").click(); // (a line typed in isn't drawn again under the reader's caret)
  const id = /\[([a-z0-9]{8})\]\s+next/.exec((await call(page, instance, "read", { page: "Theirs" })).text)![1];
  await call(page, instance, "change", { page: "Theirs", block: id, markdown: "next, as the agent has it" });
  const after = ["0:mine", expect.stringMatching(/^\d:next, as the agent has it$/)];
  await expect.poll(() => lines(panel)).toEqual(after);
  const now = await lines(panel);
  await undo(page); // the Tab: its line the agent's now
  await expect(panel.locator("#who")).toContainText("Not undone");
  await expect.poll(() => lines(panel)).toEqual(now);
  await binPage(panel, "Theirs");
});
