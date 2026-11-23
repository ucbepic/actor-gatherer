// Links to things in apps (app_kit/DESIGN.md, "5d. Links"): an agent's `[words](ag://<app>/<path>)`, drawn as Chat draws
// a message (core/ui/md.ts) with its app's mark, and opened by a click in the app's panel above the actor (features/layout/panes.js's
// openAppLink), which is handed the link (the SDK's ag.links.onOpen). The test app is Notepad (tests/apps/notepad/),
// whose [[links]] take `note/<n>`. Its instance is left open, as apps.spec.ts leaves it; its panel closed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { closePanel, expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, openActor } from "./home";
import { editorPane, editorPanel, project } from "./editor-home";

const CLAUDE_CHANNEL = "5f0c2a2e-8d1b-4c7e-9a3f-1b2c3d4e5f60";
const CODEX_CHANNEL = "019a1f2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b";
const beside = process.platform === "darwin" ? "Meta" : "Control";
const notepad = (page: Page) => page.locator("#top-row > .app-pane[data-app=notepad]");
const notepadFrame = (page: Page) => page.frames().find((f) => /^http:\/\/notepad\.localhost:\d+\//.test(f.url()))!;

/** A message's words in the actor's pane, drawn as Chat draws them (core/ui/md.ts): its link. */
async function says(page: Page, id: string, md: string) {
  await page.locator("#pane-here").evaluate(
    (here, [id, text]) => {
      const ag = (window as unknown as { agPage: { ui: { markdown: (t: string) => HTMLElement } } }).agPage;
      const box = ag.ui.markdown(text);
      box.id = id;
      Object.assign(box.style, { position: "absolute", left: "40px", top: "60px", zIndex: "50" });
      here.append(box);
    },
    [id, md],
  );
  return page.locator(`#${id} a`);
}

test("a link to something in an app opens its panel above the actor, handed the link", async ({ page }) => {
  await openActor(page, CLAUDE);
  const link = await says(page, "said-1", "Kept as [note 3](ag://notepad/note/3#line%202).");
  await expect(link).toHaveClass(/ag-link/);
  await expect(link).toHaveAttribute("data-app", "notepad");
  expect(await link.evaluate((a) => getComputedStyle(a, "::before").backgroundImage)).toContain(
    "/apps/mark/notepad.svg",
  );
  await link.click();
  await expect(notepad(page)).toHaveCount(1);
  const panel = notepad(page).frameLocator("iframe");
  await expect(panel.locator("#intent")).toHaveText('link note/<n> {"n":"3"} line 2');
  await expect(panel.locator("#agents")).toHaveText("none"); // a click attaches no agent
  await expect(page.locator("#pane-here")).toBeVisible(); // the actor still below it
  // another app's link, opened by the panel (ag.links.open), as a click on it would: here, its own
  await notepadFrame(page).evaluate(() =>
    (window as unknown as { notes: { links: { open: (h: string) => Promise<unknown> } } }).notes.links.open(
      "ag://notepad/note/7",
    ),
  );
  await expect(panel.locator("#intent")).toHaveText('link note/<n> {"n":"7"}');
  await closePanel(page, notepad(page));
  await expect(notepad(page)).toHaveCount(0);
});

test("a link to an app is never the browser's to open, whatever key is held", async ({ page }) => {
  await openActor(page, CLAUDE);
  const link = await says(page, "said-2", "See [note 4](ag://notepad/note/4).");
  const pages = page.context().pages().length;
  await link.click({ modifiers: [beside] });
  await expect(notepad(page).frameLocator("iframe").locator("#intent")).toHaveText('link note/<n> {"n":"4"}');
  expect(page.context().pages().length).toBe(pages);
  await closePanel(page, notepad(page));
});

test("a link to no place an app lists, or to no app, opens nothing and says why", async ({ page }) => {
  await openActor(page, CLAUDE);
  await (await says(page, "said-3", "[x](ag://notepad/nothing/3)")).click();
  await expect(page.locator(".pane-note")).toHaveText("Notepad: no such place to open (nothing/3)");
  await (await says(page, "said-4", "[y](ag://nowhere/a)")).click();
  await expect(page.locator(".pane-note").last()).toHaveText("No app called nowhere here, to open ag://nowhere/a");
  await expect(notepad(page)).toHaveCount(0);
  expect(page.url()).not.toContain("ag:");
});

test("a link to a file in the LaTeX editor opens it in the agent's own, at its line", async ({ page }) => {
  const { repo } = project();
  const other = path.join(repo, "notes.txt");
  fs.writeFileSync(other, "one\ntwo\nthree\n");
  // a LaTeX editor of the actor's, on the project (the test home's actors have no folder to open one on)
  const opened = await page.request.post("/api/apps/open", {
    data: { app: "latex", gatherer: GATHERER, folder: repo, channel: CLAUDE_CHANNEL },
  });
  const editor = ((await opened.json()) as { id: string }).id;
  await openActor(page, CLAUDE);
  // its absolute path after file/, as the LaTeX editor's [[links]] say
  await (await says(page, "said-5", `See [line 2](ag://latex/file${other}#L2).`)).click();
  const shown = editorPane(page, "latex").filter({ visible: true });
  await expect(shown).toHaveCount(1);
  await expect(editorPane(page, "latex")).toHaveCount(1); // and no other, out of sight
  expect(new URL((await shown.locator("iframe").getAttribute("src")) || "").searchParams.get("instance")).toBe(editor);
  await expect(editorPanel(page, "latex").locator(".ed-head .ed-path")).toContainText("notes.txt");
  await expect(editorPanel(page, "latex").locator(".cm-activeLine")).toHaveText("two");
  await page.request.post("/api/apps/close", { data: { gatherer: GATHERER, instance: editor } });
});

/** The gatherer's open instances of `app`, as the server has them. */
async function instances(page: Page, app: string): Promise<string[]> {
  const got = await page.request.get(`/api/apps?gatherer=${GATHERER}`);
  return ((await got.json()) as { instances: { id: string; app: string }[] }).instances
    .filter((i) => i.app === app)
    .map((i) => i.id);
}

test("a file's path an agent writes opens in the Files app open in the group, at its line: no other made", async ({
  page,
}) => {
  const { repo } = project();
  const file = path.join(repo, "paths.txt");
  fs.writeFileSync(file, "one\ntwo\nthree\n");
  // a Files app, as one opened from the menu is (the group's: in no task); and a LaTeX editor of the actor's, which a
  // plain path does not go to -- the Files app's FILE_FORM says `paths`
  const opened = await page.request.post("/api/apps/open", {
    data: { app: "files", gatherer: GATHERER, folder: repo },
  });
  const editor = ((await opened.json()) as { id: string }).id;
  const latex = await page.request.post("/api/apps/open", {
    data: { app: "latex", gatherer: GATHERER, folder: repo, channel: CLAUDE_CHANNEL },
  });
  const theirs = ((await latex.json()) as { id: string }).id;
  await openActor(page, CLAUDE);
  const link = await says(page, "said-6", `In [paths.txt](${file}#L2).`);
  await expect(link).toHaveAttribute("data-path", "");
  await expect(link).not.toHaveAttribute("target", /./); // not the browser's: no tab of this dashboard's address
  const pages = page.context().pages().length;
  await link.click();
  const shown = editorPane(page).filter({ visible: true });
  await expect(shown).toHaveCount(1);
  expect(new URL((await shown.locator("iframe").getAttribute("src")) || "").searchParams.get("instance")).toBe(editor);
  await expect(editorPanel(page).locator(".ed-head .ed-path")).toContainText("paths.txt");
  await expect(editorPanel(page).locator(".cm-activeLine")).toHaveText("two");
  expect(page.context().pages().length).toBe(pages);
  // file:// and a line after a colon, as a terminal's link has it: the same Editor
  await (await says(page, "said-7", `[it](file://${file}:3)`)).click();
  await expect(editorPanel(page).locator(".cm-activeLine")).toHaveText("three");
  expect(await instances(page, "files")).toEqual([editor]);
  await expect(editorPanel(page, "latex").locator(".ed-head .ed-path")).toHaveCount(0); // its LaTeX editor: no file shown
  await expect(page.locator("#pane-here")).toBeVisible(); // the actor still below it
  await page.request.post("/api/apps/close", { data: { gatherer: GATHERER, instance: editor } });
  await page.request.post("/api/apps/close", { data: { gatherer: GATHERER, instance: theirs } });
});

test("a link to a folder, or a path to one, shows it opened in the Files app's tree, the file open left open", async ({
  page,
}) => {
  const { repo } = project();
  const notes = path.join(repo, "docs", "notes"),
    lib = path.join(repo, "lib"),
    keep = path.join(repo, "keep.txt");
  for (const dir of [notes, lib]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(notes, "a.md"), "a\n");
  fs.writeFileSync(path.join(lib, "b.py"), "b = 1\n");
  fs.writeFileSync(keep, "keep\n");
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ag-folder-link-")));
  fs.mkdirSync(path.join(outside, "inner"));
  fs.writeFileSync(path.join(outside, "inner", "c.txt"), "c\n");
  const opened = await page.request.post("/api/apps/open", {
    data: { app: "files", gatherer: GATHERER, folder: repo },
  });
  const files = ((await opened.json()) as { id: string }).id;
  await openActor(page, CLAUDE);
  await (await says(page, "said-f1", `[keep.txt](${keep})`)).click();
  const panel = editorPanel(page),
    row = (p: string) => panel.locator(`.ed-row[data-path="${p}"]`);
  await expect(panel.locator(".ed-head .ed-path")).toContainText("keep.txt");
  // the folder form: the folders down to it opened, its row flashed, what is in it listed
  await (await says(page, "said-f2", `[notes](ag://files/folder${notes})`)).click();
  await expect(row(path.join(repo, "docs"))).toHaveAttribute("aria-expanded", "true");
  await expect(row(notes)).toHaveAttribute("aria-expanded", "true");
  await expect(row(notes)).toHaveClass(/flash/);
  await expect(row(path.join(notes, "a.md"))).toBeVisible();
  await expect(panel.locator(".ed-head .ed-path")).toContainText("keep.txt"); // the file still open
  // a path an agent wrote, to a folder: the same, not opened as a file
  await (await says(page, "said-f3", `In [lib/](${lib}/).`)).click();
  await expect(row(lib)).toHaveAttribute("aria-expanded", "true");
  await expect(row(path.join(lib, "b.py"))).toBeVisible();
  await expect(panel.locator(".ed-head .ed-path")).toContainText("keep.txt");
  await expect(panel.locator(".ed-head")).not.toContainText("is not a file");
  // a folder outside the one shown: the tree moved to the folder holding it, it opened there
  await (await says(page, "said-f4", `[inner](ag://files/folder${path.join(outside, "inner")})`)).click();
  await expect(row(path.join(outside, "inner"))).toHaveAttribute("aria-expanded", "true");
  await expect(row(path.join(outside, "inner", "c.txt"))).toBeVisible();
  await expect(row(lib)).toHaveCount(0);
  expect(await instances(page, "files")).toEqual([files]); // no other Files app made
  await page.request.post("/api/apps/close", { data: { gatherer: GATHERER, instance: files } });
});

test("a relative path from an actor with no folder opens nothing and says why", async ({ page }) => {
  await openActor(page, CLAUDE);
  await (await says(page, "said-8", "[a](src/a.py#L3)")).click();
  await expect(page.locator(".pane-note")).toHaveText("src/a.py: from which folder isn't known");
  await expect(editorPane(page)).toHaveCount(0);
  expect(page.url()).not.toContain("src/a.py");
});

test("a link to an app another task holds shows that task, as the app's row would", async ({ page }) => {
  const opened = await page.request.post("/api/apps/open", {
    data: { app: "notepad", gatherer: GATHERER, folder: "/w/codex", channel: CODEX_CHANNEL },
  });
  const pad = ((await opened.json()) as { id: string }).id;
  await openActor(page, CLAUDE);
  await expect(notepad(page)).toHaveCount(0); // Codex's, not Claude's
  await (await says(page, "said-9", "In [note 2](ag://notepad/note/2).")).click();
  await expect(page.locator("#agents .agent:has(> .a-main[aria-current=true])", { hasText: CODEX })).toHaveCount(1);
  await expect(page.locator("#agents .agent:has(> .a-main[aria-current=true])", { hasText: CLAUDE })).toHaveCount(0);
  const panel = notepad(page).filter({ visible: true });
  await expect(panel).toHaveCount(1);
  expect(new URL((await panel.locator("iframe").getAttribute("src")) || "").searchParams.get("instance")).toBe(pad);
  await expect(panel.frameLocator("iframe").locator("#intent")).toHaveText('link note/<n> {"n":"2"}');
  await expect(panel.frameLocator("iframe").locator("#agents")).toContainText(CODEX_CHANNEL); // Claude not attached
  expect(await instances(page, "notepad")).toEqual([pad]);
});
