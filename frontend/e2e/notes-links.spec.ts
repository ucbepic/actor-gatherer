// Links to pages in the Notes app (ag_apps/notes/): "[[" in a line, or "Link to a page" in the / menu, puts a link to
// another page there -- one found by its title, or a new one made inside this page. The link shows the page as it is
// now (renamed, in the trash, gone), opens it when clicked, and agents read and write it as
// [its title](ag://notes/page/<id>) -- the link to the page (app_kit/links.py) that opens it from Chat too.
import type { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, GATHERER, open, openActor } from "./home";
import { binPage, call, newPage, openNotes } from "./notes-home";

const read = async (page: Page, instance: string, title: string) =>
  (await call(page, instance, "read", { page: title })).text;
const row = (panel: FrameLocator, title: string) => panel.locator(".pg-row", { hasText: title });

test("[[ links a line to another page, shown as that page is now, and a click opens it", async ({ page }) => {
  await open(page);
  const { panel, instance } = await openNotes(page);
  const made = await call(page, instance, "add", { title: "Target", markdown: "inside" });
  const target = /\(page ([a-z0-9]{8})\)/.exec(made.text)![1];
  await newPage(page, panel, "Index");
  const kb = page.keyboard;
  await kb.type("See [[");
  await expect(panel.locator(".pop .hd")).toHaveText("Link to a page");
  await kb.type("targ");
  await expect(panel.locator(".pop .it.on")).toContainText("Target");
  await kb.press("Enter");
  const link = panel.locator(".blk[data-type=text] a.pg");
  await expect(link).toHaveText("Target");
  await expect(link).toHaveAttribute("contenteditable", "false"); // kept whole: not typed into
  await kb.type("later"); // the caret after the link, and the space put after it
  await expect
    .poll(() => read(page, instance, "Index"))
    .toMatch(new RegExp(`\\] See \\[Target\\]\\(ag://notes/page/${target}\\) later`));
  await expect(panel.locator(".pop")).toBeHidden();

  // renamed (here by an agent): the link says its new title
  await call(page, instance, "change", { page: "Target", title: "Target page" });
  await expect(link).toHaveText("Target page");
  // an agent's link drawn as one too; at the line's end, the caret goes after it, and Backspace takes it out whole
  await call(page, instance, "add", { page: "Index", markdown: `- back to [x](page:${target})` });
  const theirs = panel.locator(".blk[data-type=bullet] a.pg");
  await expect(theirs).toHaveText("Target page");
  const box = (await theirs.boundingBox())!;
  await page.mouse.click(box.x + box.width + 30, box.y + box.height / 2);
  await kb.type("!");
  await expect
    .poll(() => read(page, instance, "Index"))
    .toMatch(new RegExp(`- back to \\[Target page\\]\\(ag://notes/page/${target}\\)!$`));
  await kb.press("Backspace");
  await kb.press("Backspace");
  await expect(panel.locator(".blk[data-type=bullet] .tx")).toHaveText("back to ");
  await expect.poll(() => read(page, instance, "Index")).toMatch(/- back to ?$/);

  // clicked: that page opened
  await link.click();
  await expect(panel.locator("#title")).toHaveText("Target page");
  await row(panel, "Index").click();

  // in the trash: struck, and still opens; gone for good: struck, the words it was linked with
  await call(page, instance, "change", { page: "Target page", delete: true });
  await expect(link).toHaveClass(/\bbinned\b/);
  await panel.locator("#trash-btn").click();
  await panel.locator(".trash-row", { hasText: "Target page" }).locator("button[title='Delete for good']").click();
  await panel.locator("#trash-btn").click();
  await expect(link).toHaveClass(/\bgone\b/);
  await expect(link).toHaveText("Target");
  await link.click();
  await expect(panel.locator("#title")).toHaveText("Index");
  await binPage(panel, "Index");
});

test("Link to a page in the / menu makes a new page inside this one, linked", async ({ page }) => {
  await open(page);
  const { panel, instance } = await openNotes(page);
  await newPage(page, panel, "Parent");
  const kb = page.keyboard;
  await kb.type("/link");
  await panel.locator(".pop .it", { hasText: "Link to a page" }).click(); // (a click on the / menu, as Enter)
  await expect(panel.locator(".pop .hd")).toHaveText("Link to a page");
  await kb.type("Child notes");
  const make = panel.locator(".pop .it", { hasText: "New page “Child notes”" });
  await expect(make).toContainText("Inside Parent");
  await make.click();
  await expect(panel.locator(".blk a.pg")).toHaveText("Child notes");
  await expect(row(panel, "Child notes")).toHaveAttribute("style", /--d: ?1/); // under Parent in the sidebar, shown
  await expect
    .poll(() => read(page, instance, "Parent"))
    .toMatch(/\] \[Child notes\]\(ag:\/\/notes\/page\/[a-z0-9]{8}\) ?\n\nSubpages: Child notes \([a-z0-9]{8}\)$/);
  await panel.locator(".blk a.pg").click();
  await expect(panel.locator("#title")).toHaveText("Child notes");
  await expect(panel.locator("#crumbs")).toHaveText("Parent/Child notes");
  await binPage(panel, "Parent");
});

test("/page makes a new page inside this one, links it where it was typed, and opens it to be named", async ({
  page,
}) => {
  await open(page);
  const { panel, instance } = await openNotes(page);
  await newPage(page, panel, "Project");
  const kb = page.keyboard;
  await kb.type("Plan: /page");
  await expect(panel.locator(".pop .it.on")).toContainText("Page");
  await expect(panel.locator(".pop .it.on")).toContainText("A new page inside this one");
  await kb.press("Enter");
  await expect(panel.locator("#title")).toBeFocused(); // the new page, open, its title to type
  await expect(panel.locator("#crumbs")).toHaveText("Project/Untitled");
  await kb.type("Milestones");
  await kb.press("Enter");
  await expect(row(panel, "Milestones")).toHaveAttribute("style", /--d: ?1/); // under Project in the sidebar
  await panel.locator("#crumbs button", { hasText: "Project" }).click();
  await expect(panel.locator(".blk a.pg")).toHaveText("Milestones"); // the link, with the name given since
  await expect(panel.locator(".blk .tx").first()).toContainText("Plan: "); // what was typed before it, kept
  await expect
    .poll(() => read(page, instance, "Project"))
    .toMatch(/\] Plan: \[Milestones\]\(ag:\/\/notes\/page\/[a-z0-9]{8}\) ?\n\nSubpages: Milestones \([a-z0-9]{8}\)$/);
  await binPage(panel, "Project");
});

test("a link to a page, clicked in an actor's Chat, opens Notes at that page and line", async ({ page }) => {
  await openActor(page, CLAUDE);
  const opened = await page.request.post("/api/apps/open", {
    data: { app: "notes", gatherer: GATHERER, folder: null },
  });
  const instance = ((await opened.json()) as { id: string }).id;
  const made = (await call(page, instance, "add", { title: "Linked from Chat", markdown: "first\nsecond\nthird" }))
    .text;
  const id = /\(page ([a-z0-9]{8})\)/.exec(made)![1];
  const line = /\[([a-z0-9]{8})\] second/.exec(made)![1];
  // the agent's reply, as Chat draws it (core/ui/md.ts)
  await page.locator("#pane-here").evaluate((here, md) => {
    const ag = (window as unknown as { agPage: { ui: { markdown: (t: string) => HTMLElement } } }).agPage;
    const box = ag.ui.markdown(md);
    box.id = "said-notes";
    Object.assign(box.style, { position: "absolute", left: "40px", top: "60px", zIndex: "50" });
    here.append(box);
  }, `Added it to [the page](ag://notes/page/${id}#${line}).`);
  await page.locator("#said-notes a.ag-link").click();
  const panel = page.locator("#top-row > .app-pane[data-app=notes]").frameLocator("iframe");
  await expect(panel.locator("#title")).toHaveText("Linked from Chat");
  await expect(panel.locator(`.blk[data-id="${line}"]`)).toHaveClass(/\bflash\b/);
  await expect(page.locator("#pane-here")).toBeVisible(); // above the actor's Chat
  await binPage(panel, "Linked from Chat");
});
