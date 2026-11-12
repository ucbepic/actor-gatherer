// The Notes app (ag_apps/notes/): a notebook per gatherer -- pages of blocks -- written in its panel, read and changed by
// agents through its tools; what one side changes shown on the other at once. The home is the whole run's: each test
// makes pages of its own and puts them out of the notebook, for good, before it ends.
import type { FrameLocator } from "@playwright/test";
import { expect, test } from "./test";
import { open } from "./home";
import { binPage, call, newPage, openNotes } from "./notes-home";

/** The open page's blocks: each its type and what it says (a list's number included). */
const blocks = (panel: FrameLocator) =>
  panel
    .locator("#blocks > .blk")
    .evaluateAll((ns) =>
      ns.map((n) => [(n as HTMLElement).dataset.type, (n.textContent || "").replace(/\u00a0/g, " ").trim()]),
    );

test("a page typed in Notes -- markdown at a block's start making headings, to-dos and lists -- is kept", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Trip");
  const kb = page.keyboard;
  await kb.type("## Before");
  await kb.press("Enter");
  await kb.type("[] Pack");
  await kb.press("Enter"); // the next to-do
  await kb.type("Book");
  await kb.press("Enter");
  await kb.press("Enter"); // an empty to-do: out of the list
  await kb.type("- tent");
  await kb.press("Enter");
  await kb.press("Tab");
  await kb.type("pegs");
  const typed = [
    ["h2", "Before"],
    ["todo", "Pack"],
    ["todo", "Book"],
    ["bullet", "tent"],
    ["bullet", "pegs"],
  ];
  await expect.poll(() => blocks(panel)).toEqual(typed);
  await expect(panel.locator(".blk", { hasText: "pegs" })).toHaveAttribute("style", /--ind: ?1/);
  await panel.locator(".blk", { hasText: "Pack" }).locator(".chk").click();
  await expect(panel.locator(".pg-row", { hasText: "Trip" }).locator(".count")).toHaveText("1"); // to-dos left
  await expect(panel.locator("#saved")).toHaveText("Saved");
  await page.reload(); // the pane kept in this browser, the page open in it again, as the backend keeps it
  const again = page.locator("#top-row > .app-pane[data-app=notes]").frameLocator("iframe");
  await expect(again.locator("body[data-ready='1']")).toHaveCount(1);
  await expect(again.locator("#title")).toHaveText("Trip");
  await expect.poll(() => blocks(again)).toEqual(typed);
  await expect(again.locator(".blk", { hasText: "Pack" }).locator(".chk")).toHaveAttribute("aria-checked", "true");
  await binPage(again, "Trip");
});

test("an agent's change shows in the panel at once, and its tools read the page as markdown", async ({ page }) => {
  await open(page);
  const { panel, instance } = await openNotes(page);
  const made = await call(page, instance, "add", { title: "Groceries", markdown: "- [ ] milk\n- [ ] eggs" });
  expect(made.error).toBe(false);
  expect(made.text).toMatch(/^# Groceries {3}\(page [a-z0-9]{8}\)/);
  await expect(panel.locator(".pg-row", { hasText: "Groceries" })).toHaveCount(1);
  await panel.locator(".pg-row", { hasText: "Groceries" }).click();
  await expect
    .poll(() => blocks(panel))
    .toEqual([
      ["todo", "milk"],
      ["todo", "eggs"],
    ]);
  const eggs = /\[([a-z0-9]{8})\] - \[ \] eggs/.exec(
    (await call(page, instance, "read", { page: "Groceries" })).text,
  )![1];
  await call(page, instance, "change", { page: "Groceries", block: eggs, checked: true });
  await expect(panel.locator(".blk", { hasText: "eggs" }).locator(".chk")).toHaveAttribute("aria-checked", "true");
  await call(page, instance, "add", { page: "Groceries", markdown: "- [ ] bread", after: "start" });
  await expect
    .poll(() => blocks(panel))
    .toEqual([
      ["todo", "bread"],
      ["todo", "milk"],
      ["todo", "eggs"],
    ]);
  // and what the user ticks, the agent reads
  await panel.locator(".blk", { hasText: "milk" }).locator(".chk").click();
  await expect
    .poll(async () => (await call(page, instance, "read", { page: "Groceries" })).text)
    .toMatch(/- \[ \] bread\n\[[a-z0-9]{8}\] - \[x\] milk\n\[[a-z0-9]{8}\] - \[x\] eggs/);
  await binPage(panel, "Groceries");
});

test("Enter splits a block at the caret, Backspace at its start joins it back, and / makes a block another", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Edits");
  const kb = page.keyboard;
  await kb.type("Hello world");
  for (let i = 0; i < 5; i++) await kb.press("ArrowLeft");
  await kb.press("Enter");
  await expect
    .poll(() => blocks(panel))
    .toEqual([
      ["text", "Hello"],
      ["text", "world"],
    ]);
  await kb.press("Backspace");
  await expect.poll(() => blocks(panel)).toEqual([["text", "Hello world"]]);
  await kb.press("End");
  await kb.press("Enter");
  await kb.type("/num");
  await expect(panel.locator(".pop .it.on")).toContainText("Numbered list");
  await kb.press("Enter");
  await kb.type("first");
  await kb.press("Enter");
  await kb.type("second");
  await expect
    .poll(() => blocks(panel))
    .toEqual([
      ["text", "Hello world"],
      ["number", "1.first"],
      ["number", "2.second"],
    ]);
  await binPage(panel, "Edits");
});

test("a block dragged by its grip moves, and what one window types shows in another", async ({ page }) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Order");
  const kb = page.keyboard;
  for (const t of ["one", "two", "three"]) {
    await kb.type(t);
    if (t !== "three") await kb.press("Enter");
  }
  const three = panel.locator(".blk", { hasText: "three" });
  await three.hover();
  const grip = (await three.locator(".grip").boundingBox())!;
  const top = (await panel.locator(".blk", { hasText: "one" }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 4, top.y + 3, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => blocks(panel))
    .toEqual([
      ["text", "three"],
      ["text", "one"],
      ["text", "two"],
    ]);
  // a second window on the same notebook
  const other = await page.context().newPage();
  await open(other);
  const there = other.locator("#top-row > .app-pane[data-app=notes]").frameLocator("iframe");
  await expect(there.locator("body[data-ready='1']")).toHaveCount(1); // the pane kept in this browser
  await expect(there.locator("#title")).toHaveText("Order");
  await panel.locator(".blk", { hasText: "two" }).locator(".tx").click();
  await kb.press("End");
  await kb.type(" and a half");
  await expect
    .poll(() => blocks(there))
    .toEqual([
      ["text", "three"],
      ["text", "one"],
      ["text", "two and a half"],
    ]);
  await other.close();
  await binPage(panel, "Order");
});

test("the pages' list hides and shows again, and its edge dragged sets its width, kept after a reload", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  const side = panel.locator("#side");
  await expect(side).toBeVisible();
  await expect(panel.locator("#side-toggle")).toBeHidden(); // the bar's button only while the list is hidden
  await panel.locator("#side-hide").click();
  await expect(side).toBeHidden();
  await panel.locator("#side-toggle").click();
  await expect(side).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(side).toBeHidden();
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(side).toBeVisible();
  const width = async () => (await side.boundingBox())!.width;
  const before = await width();
  const grip = (await panel.locator("#side-grip").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 90, grip.y + 200, { steps: 6 });
  await page.mouse.up();
  const after = await width();
  expect(after).toBeGreaterThan(before + 60);
  await page.reload();
  const again = page.locator("#top-row > .app-pane[data-app=notes]").frameLocator("iframe");
  await expect(again.locator("body[data-ready='1']")).toHaveCount(1);
  await expect
    .poll(async () => Math.round((await again.locator("#side").boundingBox())!.width))
    .toBe(Math.round(after));
  await again.locator("#side-grip").dblclick(); // the usual width again
  await expect
    .poll(async () => Math.round((await again.locator("#side").boundingBox())!.width))
    .toBe(Math.round(before));
});
