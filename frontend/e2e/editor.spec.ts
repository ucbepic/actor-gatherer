// The Editor app (ag_apps/editor/), set up as the Browser and DocWriter are: started from a gatherer's "+ ⋯" menu on a
// folder, with an actor of its own below it; its panel in the top row under the head the dashboard draws over every
// app's; opened on a file by the `open-file` intent too, the file edited there and saved to disk; and beside the file
// the project's preview, run by Execute and shown in a column of its own, a source's place sent back to the file; and
// its actor's change, made with its tools, as the Editor's mode says (Review: a proposal there, accepted). The project
// is one the test makes, a git repository with a script that draws an SVG.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { closePanel, expect, streamsAsRequests, test } from "./test";
import { CLAUDE, CODEX, GATHERER, NOW, openActor } from "./home";
import { editorPane, editorPanel, openFile, project, raise } from "./editor-home";

/** An Editor started from the menu on `repo`, with its actor (as DocWriter's test: Claude Code set up here, the page's
 * stream held back; the actor's session is only made, never run): the actor's row, and how to put the home back. */
async function startEditor(page: Page, repo: string) {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    home.harnesses = ["claude"];
    home.harness_info.claude = { ...home.harness_info.claude, runs: true };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await openActor(page, CLAUDE);
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover();
  await row.locator("button.new-more").click();
  await page.locator(".row-menu[role=menu]").getByText("Editor…", { exact: true }).click();
  const box = page.locator(".dw-menu[role=dialog]", { hasText: "New Editor" });
  await box.locator("input").fill(repo);
  await box.locator("button.go").first().click();
  await expect(editorPane(page)).toHaveCount(1);
  // the Editor and its actor, one task (the dashboard's task_links.py): the task's row shown, the Editor's mark among its
  // faces; its actor, the one attached to the Editor's instance
  const actor = page.locator("#agents button.agent.task[aria-current=true]");
  await expect(actor.locator(".t-faces img.t-app")).toHaveAttribute("src", "/apps/mark/editor.svg");
  await expect(actor.locator(".t-faces .t-face")).toHaveCount(1);
  const src = new URL((await editorPane(page).locator("iframe").getAttribute("src")) || "");
  const listed = await (await page.request.get(`/api/apps?gatherer=${src.searchParams.get("gatherer")}`)).json();
  const sid: string = (listed.attached[src.searchParams.get("instance") || ""] || [])[0] || "";
  expect(sid).toMatch(/^[0-9a-f-]{36}$/);
  return { actor, sid, src };
}

/** The home as it was, for the tests after: the Editor closed, its actor (never started) forgotten. */
async function endEditor(page: Page, request: APIRequestContext, sid: string, src: URL) {
  await closePanel(page, editorPane(page));
  await expect(editorPane(page)).toHaveCount(0);
  const closed = await request.post("/api/apps/close", {
    data: { gatherer: src.searchParams.get("gatherer"), instance: src.searchParams.get("instance") },
  });
  expect(closed.ok()).toBe(true);
  const discarded = await request.post("/api/discard", { data: { session_id: sid } });
  expect(discarded.ok(), await discarded.text()).toBe(true);
}

test("an Editor started from the menu: its panel above on the folder, its actor below with its mark", async ({
  page,
  request,
}) => {
  const { repo } = project();
  const { sid, src } = await startEditor(page, repo);
  await expect(page.locator("#controls button[aria-label=Editor]")).toHaveCount(0); // no button of its own on an actor
  await expect(editorPane(page)).toHaveAttribute("aria-label", new RegExp(` · ${path.basename(repo)}$`));
  await expect(editorPanel(page).locator(".ed-folder .nm")).toHaveText(path.basename(repo)); // the folder it was started on
  await endEditor(page, request, sid, src);
});

test("in Review its actor's edit is a proposal in place, the file unchanged on disk until it is accepted", async ({
  page,
  request,
}) => {
  const { repo, plot } = project();
  const { sid, src } = await startEditor(page, repo);
  const panel = editorPanel(page);
  await panel.locator(".ed-row", { hasText: "plot.py" }).first().click();
  await expect(panel.locator(".cm-content")).toContainText("print('drawing')");
  await panel.locator(".ed-mode-pick select").selectOption("review");
  await expect(panel.locator(".ed-mode-pick select")).toHaveValue("review");
  const was = fs.readFileSync(plot, "utf8");
  // its actor's editor_edit, as Claude Code calls it: through the apps' MCP server
  const called = await request.post(`/mcp/${sid}`, {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "editor_edit",
        arguments: { path: plot, old_string: "print('drawing')", new_string: "print('drawing, reviewed')" },
      },
    },
  });
  const answer = await called.json();
  expect(answer.result.content[0].text, JSON.stringify(answer)).toContain("Proposed");
  const box = panel.locator(".ed-cf", { hasText: "proposes to change these lines" });
  await expect(box).toHaveCount(1);
  await expect(box.locator(".ed-cf-theirs")).toContainText("reviewed");
  await expect(panel.locator(".ed-head .ed-status")).toHaveText("1 change to review");
  expect(fs.readFileSync(plot, "utf8")).toBe(was); // until it is accepted
  // its actor detached first: told what the user chose, a never-started actor would stay listed, with that message
  const detached = await request.post("/api/apps/detach", {
    data: { gatherer: src.searchParams.get("gatherer"), instance: src.searchParams.get("instance"), channel: sid },
  });
  expect(detached.ok(), await detached.text()).toBe(true);
  await box.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(box).toHaveCount(0);
  await expect(panel.locator(".cm-content")).toContainText("print('drawing, reviewed')");
  await expect.poll(() => fs.readFileSync(plot, "utf8").split("\n")[0]).toBe("print('drawing, reviewed')");
  await endEditor(page, request, sid, src);
});

test("the file open in an Editor stays open, at its place, when the reader goes to another task and back", async ({
  page,
  request,
}) => {
  const { repo } = project();
  fs.writeFileSync(
    path.join(repo, "long.py"),
    Array.from({ length: 300 }, (_, i) => `x${i + 1} = ${i + 1}\n`).join(""),
  );
  const { actor, sid, src } = await startEditor(page, repo);
  const task = page.locator(`#agents button.agent[data-key="${await actor.getAttribute("data-key")}"]`); // the Editor's task
  const panel = editorPanel(page);
  await panel.locator(".ed-row", { hasText: "long.py" }).first().click();
  await expect(panel.locator(".cm-content")).toContainText("x1 = 1");
  const frame = () => page.frames().find((f) => /^http:\/\/editor\.localhost:\d+\//.test(f.url()))!;
  // the cursor on line 250, scrolled to it (`ed`: the panel's state, a const of its scripts, so reached by an expression)
  await frame().evaluate(
    "(v => v.dispatch({ selection: { anchor: v.state.doc.line(250).from + 3 }, scrollIntoView: true }))(ed.s.view)",
  );
  await expect(panel.locator(".cm-line", { hasText: "x250 = 250" })).toBeVisible();
  await page.waitForTimeout(500); // its place kept (a moment after it moves)
  await page.locator("#agents button.agent", { hasText: CODEX }).click(); // another task: the Editor's panel goes
  await expect(editorPane(page)).toHaveCount(0);
  await task.click(); // back
  await expect(editorPane(page)).toHaveCount(1);
  await expect(panel.locator(".ed-head .ed-path")).toContainText("long.py"); // the file still open
  await expect(panel.locator(".cm-line", { hasText: "x250 = 250" })).toBeVisible(); // where it was left
  const at = await frame().evaluate(
    "(st => [st.doc.lineAt(st.selection.main.head).number, st.selection.main.head - st.doc.line(250).from])(ed.s.view.state)",
  );
  expect(at).toEqual([250, 3]);
  await page.locator("#agents button.agent", { hasText: CODEX }).click(); // away again, and the file deleted meanwhile
  await expect(editorPane(page)).toHaveCount(0);
  fs.rmSync(path.join(repo, "long.py"));
  await task.click(); // back: its folder alone, no error
  await expect(editorPane(page)).toHaveCount(1);
  await expect(panel.locator(".ed-head .ed-hint")).toContainText("Pick a file");
  await expect(panel.locator(".ed-head .ed-path")).toHaveCount(0);
  await endEditor(page, request, sid, src);
});

test("left while typing in an Editor's file, the cursor is back where it was, typing going on there", async ({
  page,
  request,
}) => {
  const { repo } = project();
  fs.writeFileSync(
    path.join(repo, "long.py"),
    Array.from({ length: 300 }, (_, i) => `x${i + 1} = ${i + 1}\n`).join(""),
  );
  const { actor, sid, src } = await startEditor(page, repo);
  const task = page.locator(`#agents button.agent[data-key="${await actor.getAttribute("data-key")}"]`); // the Editor's task
  const panel = editorPanel(page);
  const frame = () => page.frames().find((f) => /^http:\/\/editor\.localhost:\d+\//.test(f.url()))!;
  const line250 = () => frame().evaluate("ed.s.view.state.doc.line(250).text");
  const away = async () => {
    await page.locator("#agents button.agent", { hasText: CODEX }).click(); // another task: the Editor's panel goes
    await expect(editorPane(page)).toHaveCount(0);
    await task.click(); // back
    await expect(editorPane(page)).toHaveCount(1);
    await expect(panel.locator(".cm-line", { hasText: "x250 = 250" })).toBeVisible(); // scrolled where it was
  };
  await panel.locator(".ed-row", { hasText: "long.py" }).first().click();
  await expect(panel.locator(".cm-content")).toContainText("x1 = 1");
  await frame().evaluate(
    "(v => v.dispatch({ effects: ed.s.A.EditorView.scrollIntoView(v.state.doc.line(250).from, { y: 'center' }) }))(ed.s.view)",
  );
  await panel.locator(".cm-line", { hasText: "x250 = 250" }).click(); // typing in it, as the reader does
  await page.keyboard.press("End");
  await page.keyboard.type(" #here");
  await away(); // at once: its place as it goes
  await expect(panel.locator(".cm-cursor-primary")).toBeVisible(); // the keys back, the cursor shown
  await page.keyboard.type("!");
  await expect.poll(line250).toBe("x250 = 250 #here!"); // typing goes on where it was
  // left from the actor's message box: the cursor kept, the keys not taken back
  await page.locator("#composer-text").click();
  await page.waitForTimeout(1200);
  await away();
  expect(await frame().evaluate("ed.s.view.hasFocus")).toBe(false);
  expect(
    await frame().evaluate(
      "(st => [st.doc.lineAt(st.selection.main.head).number, st.selection.main.head - st.doc.line(250).from])(ed.s.view.state)",
    ),
  ).toEqual([250, 17]);
  await page.keyboard.type("?");
  await page.waitForTimeout(300);
  expect(await line250()).toBe("x250 = 250 #here!"); // nothing typed into the file
  await expect // and all of it saved on disk, the keys typed just before the panel went too
    .poll(() => fs.readFileSync(path.join(repo, "long.py"), "utf8").split("\n")[249])
    .toBe("x250 = 250 #here!");
  await endEditor(page, request, sid, src);
});

test("the preview comes back as it was left: its tab, its output's scroll, its PDF's page, a rebuilt PDF's too", async ({
  page,
  request,
}) => {
  test.skip(!hasLatex, "no latexmk and synctex here");
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ag-preview-")));
  const tex = (n: number) =>
    `\\documentclass{article}\n\\begin{document}\n${Array.from({ length: n }, (_, i) => `Page ${i + 1}.`).join("\n\\newpage\n")}\n\\end{document}\n`;
  fs.writeFileSync(path.join(repo, "paper.tex"), tex(5));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const { actor, sid, src } = await startEditor(page, repo);
  const task = page.locator(`#agents button.agent[data-key="${await actor.getAttribute("data-key")}"]`); // the Editor's task
  const panel = editorPanel(page);
  const away = async (meanwhile = () => {}) => {
    await page.locator("#agents button.agent", { hasText: CODEX }).click(); // another task: the Editor's panel goes
    await expect(editorPane(page)).toHaveCount(0);
    meanwhile();
    await task.click(); // back
    await expect(editorPane(page)).toHaveCount(1);
    await expect(panel.locator(".ed-pv")).toBeVisible(); // the preview open again
  };
  await panel.locator(".ed-row", { hasText: "paper.tex" }).first().click();
  await panel.locator("button.ed-exec").click();
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-st")).toContainText("Done", { timeout: 60_000 });
  const pdf = () => page.frames().find((f) => /\/_ag\/lib\/pdfjs\/web\/viewer\.html/.test(f.url()));
  const place = () => pdf()?.evaluate("[PDFViewerApplication.page, PDFViewerApplication.pdfViewer.currentScaleValue]");
  await expect.poll(async () => pdf()?.evaluate("PDFViewerApplication.pagesCount")).toBe(5);
  await pdf()!.evaluate("PDFViewerApplication.pdfViewer.currentScaleValue = '1.5'; PDFViewerApplication.page = 3");
  await expect.poll(place).toEqual([3, "1.5"]);
  // the output picked, scrolled up from its end
  await panel.locator(".pv-edge").hover(); // over a result, its head is tucked away above it until the pointer comes
  await panel.locator(".pv-tabs button", { hasText: "Output" }).click();
  await panel.locator(".pv-out").evaluate((o) => (o.scrollTop = 40));
  await page.waitForTimeout(500); // kept a moment after it moves
  await away();
  await expect(panel.locator(".pv-tabs button", { hasText: "Output" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => panel.locator(".pv-out").evaluate((o) => o.scrollTop)).toBe(40);
  await panel.locator(".pv-tabs button", { hasText: "Result" }).click();
  await expect.poll(place).toEqual([3, "1.5"]);
  // built again while the panel was gone (as an actor's run would): a new PDF, still opened where the reader was
  await page.waitForTimeout(500);
  await away(() => {
    fs.writeFileSync(path.join(repo, "paper.tex"), tex(6));
    execFileSync("latexmk", ["-pdf", "-interaction=nonstopmode", "paper.tex"], { cwd: repo, stdio: "ignore" });
  });
  await expect.poll(async () => pdf()?.evaluate("PDFViewerApplication.pagesCount")).toBe(6);
  await expect.poll(place).toEqual([3, "1.5"]);
  await endEditor(page, request, sid, src);
});

test("a file asked for opens in an Editor's panel, and what is typed is saved", async ({ page }) => {
  const { plot } = project();
  await openActor(page, CLAUDE);
  await openFile(page, plot);
  const panel = editorPanel(page);
  await expect(panel.locator(".ed-row[aria-selected=true], .ed-row.on").first()).toContainText("plot.py");
  await panel.locator(".cm-line").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("  # typed");
  await expect(panel.locator(".ed-status")).toContainText("Saved"); // Auto-save
  await expect.poll(() => fs.readFileSync(plot, "utf8").split("\n")[0]).toBe("print('drawing')  # typed");
  await raise(page, "open-file", { path: path.join(path.dirname(plot), "out.svg") }); // the Editor open takes it
  await expect(editorPane(page)).toHaveCount(1);
  await closePanel(page, editorPane(page));
  await expect(editorPane(page)).toHaveCount(0);
});

test("the tree shows a closed actor that changed a file only while a change of its there waits for the reader", async ({
  page,
}) => {
  const { plot } = project();
  type Agent = { channel: string; name?: { text?: string } | null; last_user_message?: string };
  type Home = { gatherers: { name: string; agents: Agent[] }[] };
  const agents = ((await (await page.request.get("/api/home")).json()) as Home).gatherers.find(
    (g) => g.name === GATHERER,
  )!.agents;
  const open = agents.find((a) => a.name?.text === CLAUDE)!;
  const closed = agents.find((a) => (a.last_user_message || "").startsWith(CODEX))!;
  // the Codex actor closed (seen since: not "Finished"); the home read by requests, which the route answers
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await page.route("**/api/home", async (route) => {
    const home = (await (await route.fetch()).json()) as Home;
    for (const a of home.gatherers.find((g) => g.name === GATHERER)!.agents)
      if (a.channel === closed.channel) Object.assign(a, { status: "closed", last: 0, session: null });
    await route.fulfill({ json: home });
  });
  // both changed plot.py lately (ag's hook's `file_touched`), as the listing says; what waits from them, as the test says
  let waiting: { gatherer: string; channel: string }[] = [];
  await page.route("**/api/edit/list*", async (route) => {
    const u = new URL(route.request().url()); // the app's origin, editor.localhost: a name only the browser resolves
    const host = u.host;
    u.hostname = "127.0.0.1";
    const got = (await (
      await route.fetch({ url: u.href, headers: { ...route.request().headers(), host } })
    ).json()) as {
      entries: Record<string, unknown>[];
    };
    for (const e of got.entries)
      if (e.name === "plot.py") {
        e.writers = [open, closed].map((a, i) => ({
          gatherer: GATHERER,
          channel: a.channel,
          at: NOW - 60 * (i + 1),
          how: "modified",
        }));
        e.waiting = waiting;
      }
    await route.fulfill({ json: got });
  });
  await openActor(page, CLAUDE);
  await openFile(page, plot);
  const avatars = editorPanel(page).locator(".ed-row", { hasText: "plot.py" }).locator(".ed-avs");
  await expect(avatars.locator(":scope > img, :scope > .ed-noav")).toHaveCount(1); // the open actor's only
  await expect(avatars).not.toHaveClass(/many/);
  await expect(avatars).not.toHaveAttribute("title", /closed/);
  waiting = [{ gatherer: GATHERER, channel: closed.channel }]; // a change of the closed one's waits: it is shown too
  await expect(avatars.locator(":scope > img, :scope > .ed-noav")).toHaveCount(2);
  await expect(avatars).toHaveClass(/many/);
  await expect(avatars).toHaveAttribute("title", /\(closed: its change waits for you\)/);
  await closePanel(page, editorPane(page));
  await expect(editorPane(page)).toHaveCount(0);
});

test("Execute opens the project's preview beside the file on its form, a guess in it, and runs what is saved", async ({
  page,
}) => {
  const { repo, plot } = project();
  await openActor(page, CLAUDE);
  await openFile(page, plot);
  const panel = editorPanel(page);
  await panel.locator("button.ed-exec").click();
  await expect(panel.locator(".ed-pv")).toBeVisible();
  await expect(panel.locator(".pv-h .nm")).toContainText(path.basename(repo)); // the project, by its repository
  await expect(panel.locator(".pv-form input[name=command]")).toHaveValue("python3 {file}"); // the guess, for a .py
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-st")).toContainText("Done");
  await expect(panel.locator(".pv-out")).toContainText("drawing");
  await expect(panel.locator(".pv-cmd")).toContainText("$ python3 {file}");
  await expect(panel.locator(".pv-cmd")).toContainText("set by you");
  // what it shows changed: the file it draws, shown in its place
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  await panel.locator(".pv-form input[name=show]").fill("out.svg");
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-result img")).toHaveAttribute("src", /\/api\/preview\/files\/[0-9a-f]+\/out\.svg\?/);
  await expect.poll(() => panel.locator(".pv-result img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(40);
  // Ctrl+Enter (⌘↵ on a Mac) in the file: Execute again; the preview's × hides it, Execute shows it again
  await panel.locator(".pv-edge").hover(); // over a result, its head is tucked away above it until the pointer comes
  await panel.locator(".pv-x").click();
  await expect(panel.locator(".ed-pv")).toBeHidden();
  await panel.locator(".cm-content").click();
  await page.keyboard.press("Control+Enter"); // Ctrl+Enter: the test's browser says it is on Windows (Desktop Chrome)
  await expect(panel.locator(".ed-pv")).toBeVisible();
  await expect(panel.locator(".pv-st")).toContainText("Done");
});

const hasLatex = (() => {
  try {
    execFileSync("which", ["latexmk"]);
    execFileSync("which", ["synctex"]);
    return true;
  } catch {
    return false;
  }
})();

test("a LaTeX build shows in pdf.js, a source line to its place in the PDF and a double-click back", async ({
  page,
}) => {
  test.skip(!hasLatex, "no latexmk and synctex here");
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ag-preview-")));
  const tex = path.join(repo, "paper.tex");
  fs.writeFileSync(
    tex,
    "\\documentclass{article}\n\\begin{document}\nFirst page.\n\\newpage\nSecond page, its own line.\n\\end{document}\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: repo });
  await openActor(page, CLAUDE);
  await openFile(page, tex);
  const panel = editorPanel(page);
  await panel.locator("button.ed-exec").click();
  await expect(panel.locator(".pv-form input[name=command]")).toHaveValue(/^latexmk -pdf -synctex=1 /);
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-st")).toContainText("Done", { timeout: 60_000 });
  const pdf = () => page.frames().find((f) => /\/_ag\/lib\/pdfjs\/web\/viewer\.html/.test(f.url()));
  type Viewer = { PDFViewerApplication: { pagesCount: number; page: number } };
  await expect
    .poll(async () => pdf()?.evaluate(() => (window as unknown as Viewer).PDFViewerApplication.pagesCount))
    .toBe(2);
  await panel.locator(".cm-line").nth(4).click(); // "Second page", line 5: "→ PDF" shows its page
  await panel.locator("button.ed-topdf").click();
  await expect.poll(() => pdf()!.evaluate(() => (window as unknown as Viewer).PDFViewerApplication.page)).toBe(2);
  await pdf()!.evaluate(() => ((window as unknown as Viewer).PDFViewerApplication.page = 1));
  await panel.frameLocator("iframe.pdf").locator(".page[data-page-number='1'] .textLayer span").first().dblclick();
  await expect(panel.locator(".cm-activeLine")).toContainText("First page."); // its source line, selected in the file
});

test("a broken LaTeX build lists its problems, each opening its file at its line, marked there", async ({
  page,
  request,
}) => {
  test.skip(!hasLatex, "no latexmk and synctex here");
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ag-preview-")));
  const main = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
  fs.mkdirSync(path.join(repo, "sec"));
  fs.writeFileSync(path.join(repo, "main.tex"), main("Hello \\cite{nobody}.\n\\input{sec/one}\n\\badmacro"));
  fs.writeFileSync(path.join(repo, "sec", "one.tex"), "\\section{One}\nSome text, then \\alsobad here.\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const { actor, sid, src } = await startEditor(page, repo);
  const task = page.locator(`#agents button.agent[data-key="${await actor.getAttribute("data-key")}"]`); // the Editor's task
  const panel = editorPanel(page);
  await panel.locator(".ed-row", { hasText: "main.tex" }).first().click();
  await expect(panel.locator(".cm-content")).toHaveCount(1);
  await panel.locator("button.ed-exec").click();
  await expect(panel.locator(".pv-form input[name=command]")).toHaveValue(/ -file-line-error /);
  await panel.getByRole("button", { name: "Save and run" }).click();
  // it failed: its problems shown, not its output -- errors first, each at its file and line
  await expect(panel.locator(".pv-st")).toContainText("Failed", { timeout: 60_000 });
  const tab = panel.locator(".pv-tabs button", { hasText: "Problems" });
  await expect(tab).toHaveAttribute("aria-pressed", "true");
  await expect(tab.locator(".n.error")).toHaveText("2");
  await expect(tab.locator(".n.warning")).toHaveText("2"); // the citation, and "There were undefined citations"
  const rows = panel.locator(".pv-pr");
  await expect(rows.nth(0)).toContainText("Undefined control sequence \\alsobad");
  await expect(rows.nth(0).locator(".at")).toHaveText("sec/one.tex:2");
  await expect(rows.nth(1).locator(".at")).toHaveText("main.tex:5");
  await expect(panel.locator(".pv-pr.warning").first()).toContainText("Citation `nobody' on page 1 undefined");
  // the main file's own lines marked: its error's in the gutter, underlined, tinted; its warning's
  await expect(panel.locator(".cm-gutter-lint .cm-lint-marker-error")).toHaveCount(1);
  await expect(panel.locator(".cm-line.ed-prob.error")).toHaveText("\\badmacro");
  await expect(panel.locator(".cm-line.ed-prob.warning")).toContainText("\\cite{nobody}");
  // ▸: its lines of the log
  await rows.nth(0).locator("button.more").click();
  await expect(panel.locator(".pv-pr-log")).toContainText("l.2 Some text, then \\alsobad");
  // a click: the \input file opened at its line, the macro underlined there
  await rows.nth(0).click();
  await expect(panel.locator(".ed-head .ed-path")).toContainText("one.tex");
  await expect(panel.locator(".cm-activeLine")).toContainText("\\alsobad here.");
  await expect(panel.locator(".cm-lintRange-error")).toHaveText("\\alsobad");
  // the PDF it still made, one click away
  await panel.locator(".pv-tabs button", { hasText: "Result" }).click();
  await expect(panel.locator(".pv-result iframe.pdf")).toHaveCount(1);
  // the errors fixed and built again: done, its result shown, only its warnings left -- the error's marks gone
  fs.writeFileSync(path.join(repo, "main.tex"), main("Hello \\cite{nobody}.\n\\input{sec/one}"));
  fs.writeFileSync(path.join(repo, "sec", "one.tex"), "\\section{One}\nSome text here.\n");
  await expect(panel.locator(".cm-content")).toContainText("Some text here."); // the file open, as it is on disk now
  await panel.locator("button.ed-exec").click();
  await expect(panel.locator(".pv-st")).toContainText("Done", { timeout: 60_000 });
  await expect(panel.locator(".pv-tabs button", { hasText: "Result" })).toHaveAttribute("aria-pressed", "true");
  await expect(tab.locator(".n.error")).toHaveCount(0);
  await expect(tab.locator(".n.warning")).toHaveText("2");
  await expect(panel.locator(".cm-lintRange-error, .cm-line.ed-prob")).toHaveCount(0);
  // Problems picked, the task left and come back to: Problems still shown
  await panel.locator(".pv-edge").hover(); // over a result, its head is tucked away above it until the pointer comes
  await tab.click();
  await page.waitForTimeout(500); // kept a moment after it moves
  await page.locator("#agents button.agent", { hasText: CODEX }).click(); // another task: the Editor's panel goes
  await expect(editorPane(page)).toHaveCount(0);
  await task.click();
  await expect(panel.locator(".ed-pv")).toBeVisible();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator(".pv-pr.warning").first()).toContainText("Citation `nobody' on page 1 undefined");
  await endEditor(page, request, sid, src);
});
