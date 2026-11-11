// Several lines of a Notes page picked at once (ag_apps/notes/panel): whole lines, as Notion's block selection -- by a
// drag from one line's words into others, a box dragged beside them, Shift+click, Esc and Shift+↑↓, ⌘A twice -- then
// deleted (and brought back), indented, moved, duplicated, copied and pasted, or sent to an agent as one message.
import type { FrameLocator, Page } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, GATHERER, open } from "./home";
import { binPage, newPage, openNotes } from "./notes-home";

/** The open page's lines: what each says. */
const lines = (panel: FrameLocator) =>
  panel
    .locator("#blocks > .blk")
    .evaluateAll((ns) => ns.map((n) => (n.querySelector(".tx")?.textContent || "").replace(/\u00a0/g, " ").trim()));
/** The lines picked: what each says. */
const pickedLines = (panel: FrameLocator) =>
  panel
    .locator("#blocks > .blk.picked")
    .evaluateAll((ns) => ns.map((n) => (n.querySelector(".tx")?.textContent || "").replace(/\u00a0/g, " ").trim()));
const row = (panel: FrameLocator, text: string) =>
  panel.locator("#blocks > .blk", { has: panel.locator(".tx", { hasText: new RegExp(`^${text}$`) }) });

/** Lines typed, one after another, from the line the caret is in. */
async function type(page: Page, ...words: string[]) {
  for (const [i, w] of words.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(w);
  }
}

/** A drag with the mouse, from the middle of one line's words to another's. */
async function sweep(page: Page, panel: FrameLocator, from: string, ...to: string[]) {
  const a = (await row(panel, from).locator(".tx").boundingBox())!;
  await page.mouse.move(a.x + 4, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y + a.height / 2, { steps: 2 });
  for (const t of to) {
    const b = (await row(panel, t).locator(".tx").boundingBox())!;
    await page.mouse.move(b.x + 16, b.y + b.height / 2, { steps: 4 });
  }
  await page.mouse.up();
}

test("lines picked by a drag from one line into others are deleted together, and Undo brings them back", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Sweep");
  await type(page, "one", "two", "three", "four");

  await sweep(page, panel, "two", "three", "two"); // back into its own line: its text, no line picked
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(0);
  await expect.poll(() => panel.locator("body").evaluate(() => getSelection()!.toString())).not.toBe("");
  // that text put down first: a drag that starts on selected text moves the text (the browser's own drag and drop)
  await row(panel, "four").locator(".tx").click();
  await expect.poll(() => panel.locator("body").evaluate(() => getSelection()!.toString())).toBe("");

  await sweep(page, panel, "two", "three");
  await expect.poll(() => lines(panel)).toEqual(["one", "two", "three", "four"]); // no words moved
  await expect.poll(() => pickedLines(panel)).toEqual(["two", "three"]);
  await expect(panel.locator("#pk-bar")).toBeVisible();
  await expect(panel.locator("#pk-bar .pk-n")).toHaveText("2 lines");
  await expect(panel.locator("#blocks")).toBeFocused(); // the page's keys: no caret in a line

  await page.keyboard.press("Backspace");
  await expect.poll(() => lines(panel)).toEqual(["one", "four"]);
  await expect(panel.locator("#pk-bar")).toBeHidden();
  await expect(panel.locator("#who")).toContainText("2 lines deleted");
  await panel.locator("#who .undo").click();
  await expect.poll(() => lines(panel)).toEqual(["one", "two", "three", "four"]);
  await expect.poll(() => pickedLines(panel)).toEqual(["two", "three"]); // back, and picked
  await page.keyboard.press("Escape");
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(0);

  await page.reload(); // kept as the backend has it
  const again = page.locator("#top-row > .app-pane[data-app=notes]").frameLocator("iframe");
  await expect(again.locator("#title")).toHaveText("Sweep");
  await expect.poll(() => lines(again)).toEqual(["one", "two", "three", "four"]);
  await binPage(again, "Sweep");
});

test("Shift+click and Esc with Shift+arrows pick a run, which Tab indents, ⌘⇧↑ moves and ⌘D duplicates", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Run");
  await type(page, "- a", "b", "c", "d");
  await expect.poll(() => lines(panel)).toEqual(["a", "b", "c", "d"]);

  await row(panel, "a").locator(".tx").click();
  await row(panel, "c")
    .locator(".tx")
    .click({ modifiers: ["Shift"] });
  await expect.poll(() => pickedLines(panel)).toEqual(["a", "b", "c"]);
  await page.keyboard.press("Tab");
  for (const t of ["a", "b", "c"]) await expect(row(panel, t)).toHaveAttribute("style", /--ind: ?1/);
  await expect(row(panel, "d")).toHaveAttribute("style", /--ind: ?0/);
  await page.keyboard.press("Shift+Tab");
  await expect(row(panel, "a")).toHaveAttribute("style", /--ind: ?0/);

  await row(panel, "d").locator(".tx").click(); // a click puts them down
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(0);
  await page.keyboard.press("Escape"); // the line typed in, picked
  await expect.poll(() => pickedLines(panel)).toEqual(["d"]);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => pickedLines(panel)).toEqual(["c", "d"]);
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await expect.poll(() => lines(panel)).toEqual(["a", "c", "d", "b"]);
  await expect.poll(() => pickedLines(panel)).toEqual(["c", "d"]); // still picked, moved
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(() => lines(panel)).toEqual(["a", "c", "d", "c", "d", "b"]);
  await expect(panel.locator("#blocks > .blk").nth(3)).toHaveClass(/picked/); // the copies picked
  await expect(panel.locator("#blocks > .blk").nth(1)).not.toHaveClass(/picked/);
  await page.keyboard.press("Enter"); // back to typing, at the end of the run's last line
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(0);
  await page.keyboard.type("!");
  await expect.poll(() => lines(panel)).toEqual(["a", "c", "d", "c", "d!", "b"]);
  await binPage(panel, "Run");
});

test("Shift+↑↓ from inside a line select to its end first, then pick lines; words selected across lines pick them", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Shift");
  await type(page, "- alpha", "bravo", "charlie", "delta");
  const caret = (text: string, at: number) =>
    row(panel, text)
      .locator(".tx")
      .evaluate((tx, n) => {
        (tx as HTMLElement).focus();
        const r = document.createRange();
        r.setStart(tx.firstChild!, n);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
      }, at);
  const selected = () => panel.locator("body").evaluate(() => getSelection()!.toString());

  // from inside "charlie": its start first (the browser would carry the words up into "bravo"), then the lines
  await caret("charlie", 3);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(selected).toBe("cha");
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(0);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => pickedLines(panel)).toEqual(["bravo", "charlie"]);
  await expect(panel.locator("#blocks")).toBeFocused();
  await page.keyboard.press("Tab");
  for (const t of ["bravo", "charlie"]) await expect(row(panel, t)).toHaveAttribute("style", /--ind: ?1/);
  await page.keyboard.press("Escape");

  await caret("bravo", 2); // and down: its end first
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(selected).toBe("avo");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => pickedLines(panel)).toEqual(["bravo", "charlie"]);
  await page.keyboard.press("Escape");

  // words selected from one line into another, however the browser got there: those lines, picked whole
  await panel.locator("body").evaluate(() => {
    const tx = [...document.querySelectorAll("#blocks > .blk .tx")];
    const a = tx.find((t) => t.textContent === "alpha")!,
      z = tx.find((t) => t.textContent === "charlie")!;
    getSelection()!.setBaseAndExtent(a.firstChild!, 2, z.firstChild!, 4);
  });
  await expect.poll(() => pickedLines(panel)).toEqual(["alpha", "bravo", "charlie"]);
  await expect.poll(selected).toBe("");
  await page.keyboard.press("Backspace");
  await expect.poll(() => lines(panel)).toEqual(["delta"]);
  await binPage(panel, "Shift");
});

test("⌘A twice picks every line; copied, they are markdown, and paste back as the lines they were", async ({
  page,
}) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Copy");
  await type(page, "[] milk", "eggs");
  await row(panel, "eggs").locator(".chk").click();
  await row(panel, "eggs").locator(".tx").click();
  await page.keyboard.press("ControlOrMeta+a"); // the line's text
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+a"); // then every line
  await expect.poll(() => pickedLines(panel)).toEqual(["milk", "eggs"]);

  const [text, ours] = await panel.locator("body").evaluate(() => {
    const dt = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }));
    return [dt.getData("text/plain"), dt.getData("application/x-ag-notes-blocks")];
  });
  expect(text).toBe("- [ ] milk\n- [x] eggs");
  expect(JSON.parse(ours)).toEqual([
    { type: "todo", text: "milk", checked: false, indent: 0 },
    { type: "todo", text: "eggs", checked: true, indent: 0 },
  ]);

  await panel.locator("#below").click(); // a new line to type in, the lines put down
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(0);
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
  await expect.poll(() => lines(panel)).toEqual(["milk", "eggs", "milk", "eggs"]);
  await expect(panel.locator("#blocks > .blk[data-type=todo]")).toHaveCount(4);
  await expect(panel.locator("#blocks > .blk").nth(3).locator(".chk")).toHaveAttribute("aria-checked", "true");
  await binPage(panel, "Copy");
});

test("lines picked with a box go to an agent as one message naming each; they show it once, at the last of them", async ({
  page,
}) => {
  let channel = "";
  let fake: ((a: Record<string, unknown>) => void) | null = null;
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const a = home.gatherers
      .find((g: { name: string }) => g.name === GATHERER)
      .agents.find((x: { harness: string }) => x.harness === "claude");
    channel = a.channel;
    if (fake) fake(a);
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort()); // the home as faked, not changed after
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  // the agent's reports, as the notebook would have them once it filed them: on the lines named, read on a reload
  let reports: Record<string, string> = {};
  await page.route("**/api/state?*", async (route) => {
    const url = new URL(route.request().url()); // (the app's own origin, *.localhost: asked of 127.0.0.1 by its name)
    const book = await (
      await route.fetch({
        url: url.href.replace(url.hostname, "127.0.0.1"),
        headers: { ...route.request().headers(), host: url.host },
      })
    ).json();
    for (const pg of book.pages || [])
      for (const b of pg.blocks || [])
        if (reports[b.id])
          b.thread = [
            ...(b.thread || []),
            { id: `rep${b.id}`, by: `agent:${channel}`, text: reports[b.id], at: Date.now() / 1000 + 60, done: true },
          ];
    await route.fulfill({ json: book });
  });
  await open(page);
  let { panel } = await openNotes(page);
  await newPage(page, panel, "Group");
  await type(page, "[] Fix the parser", "Add CSV export", "", "Not this");

  // a box dragged from under the lines up into the second: it and the one after it
  const below = (await panel.locator("#below").boundingBox())!;
  const mid = (await row(panel, "Add CSV export").boundingBox())!;
  await page.mouse.move(mid.x + 40, below.y + 30);
  await page.mouse.down();
  await page.mouse.move(mid.x + 200, mid.y + mid.height / 2, { steps: 6 });
  await expect(panel.locator("#band")).toBeVisible();
  await page.mouse.up();
  await expect(panel.locator("#band")).toBeHidden();
  await expect.poll(() => pickedLines(panel)).toEqual(["Add CSV export", "Not this"]);
  await page.keyboard.press("Escape");

  // then two others (as many: the bar not drawn again), and those are the ones sent
  await row(panel, "Fix the parser").locator(".tx").click();
  await row(panel, "Add CSV export")
    .locator(".tx")
    .click({ modifiers: ["Shift"] });
  await expect.poll(() => pickedLines(panel)).toEqual(["Fix the parser", "Add CSV export"]);

  await panel.locator("#pk-bar .pk-send").click();
  const pop = panel.locator(".pop.at-pop");
  await expect(pop.locator(".hd.lead")).toHaveText("Send 2 lines to an agent, as one message of yours");
  await expect(pop.locator(".at-extra")).toBeFocused();
  await page.keyboard.type("One branch for both");
  await pop.locator(".it", { hasText: CLAUDE }).click();
  await expect.poll(() => sent.length).toBe(1);
  const [one, two] = await panel
    .locator("#blocks > .blk")
    .evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.id || ""));
  expect(sent[0].text).toBe(
    `(From my Notes, page "Group", blocks ${one}, ${two}: the lines below, in that order. When you're done, report ` +
      "back on each with notes_report, in one to three lines.)\n\n- [ ] Fix the parser\n- [ ] Add CSV export\n\n" +
      "One branch for both",
  );
  const nth = (i: number) => panel.locator("#blocks > .blk").nth(i);
  await expect(nth(0)).toHaveClass(/is-sent/);
  await expect(nth(1)).toHaveClass(/is-sent/);
  await expect(nth(0).locator(".sent")).toHaveCount(0); // the agent shown once, at the last of them
  await expect(nth(1).locator(".sent .chip")).toHaveAttribute(
    "aria-label",
    new RegExp(`^${CLAUDE}: Sent \\(2 lines sent together\\)`),
  );
  await expect(panel.locator("#blocks > .blk.picked")).toHaveCount(0); // sent: put down

  /** The page read again, as the home and the notebook now are. */
  const again = async () => {
    await open(page);
    const pane = page.locator("#top-row > .app-pane[data-app=notes]");
    panel = (await pane.count()) ? pane.frameLocator("iframe") : (await openNotes(page)).panel;
    await expect(panel.locator("#title")).toHaveText("Group");
  };
  // at work on that message: its one status, Working
  fake = (a) =>
    Object.assign(a, {
      last_user_message: String(sent[0].text),
      session: { session_id: channel, terminal: true },
      status: "running",
      running: true,
    });
  await again();
  await expect(nth(1).locator(".sent .chip")).toContainText("Working");
  await expect(nth(0).locator(".sent")).toHaveCount(0);

  // done with it, reported on one line: 1 of 2 to review; on both: to review, the reader's to accept
  fake = null;
  reports = { [one]: "Fixed the parser" };
  await again();
  await expect(nth(1).locator(".sent .chip")).toContainText("1 of 2 to review");
  await expect(nth(1).locator(".sent .accept")).toHaveCount(0);
  reports = { [one]: "Fixed the parser", [two]: "CSV export added" };
  await again();
  await expect(nth(1).locator(".sent .chip")).toContainText("To review");
  await expect(nth(1).locator(".sent .accept")).toHaveCount(1);
  await expect(nth(1).locator(".sent .talk")).toHaveText("3"); // the message, and a report on each line

  // one conversation for both: the lines as sent, then a report on each, saying which line
  await nth(1).locator(".sent .talk").click();
  await expect(nth(0)).toHaveClass(/convo-on/);
  await expect(nth(1)).toHaveClass(/convo-on/);
  const convo = panel.locator("#convo");
  await expect(convo.locator(".cv-about")).toContainText("2 lines: Fix the parser · Add CSV export");
  const mine = convo.locator(".msg.you").first();
  await expect(mine.locator(".bub")).toContainText("Fix the parser");
  await expect(mine.locator(".bub")).toContainText("Add CSV export");
  await expect(mine.locator(".bub")).toContainText("One branch for both");
  await expect(mine.locator(".mm")).toContainText("2 lines, as one message");
  await expect(convo.locator(".msg:not(.you) .mm")).toHaveText([
    new RegExp(`reported on “Fix the parser”, says it's done`),
    new RegExp(`reported on “Add CSV export”, says it's done`),
  ]);
  await expect(convo.locator(".cv-q")).toHaveText("Are these 2 done?");
  await binPage(panel, "Group");
});
