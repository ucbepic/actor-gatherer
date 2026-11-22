// What the browser tests of the Files app and the LaTeX editor share (ag_apps/files/, ag_apps/latex/: app_kit.fileedit's
// panel, each): a project to open -- a git repository the test makes, with a script that draws an SVG -- an intent
// raised from a panel, as a page's link raises it, the app's pane and panel, and one started from the menu on a folder
// with its actor, and closed again; and what a LaTeX preview's PDF viewer says.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { atEnd, closePanel, expect, streamsAsRequests } from "./test";
import { CLAUDE, openActor } from "./home";

export function project(): { repo: string; plot: string } {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ag-preview-")));
  const plot = path.join(repo, "plot.py");
  fs.writeFileSync(
    plot,
    'print(\'drawing\')\nopen(\'out.svg\', \'w\').write(\'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#3a7"/></svg>\')\n',
  );
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  execFileSync("git", ["init", "-q"], { cwd: repo, env });
  execFileSync("git", ["add", "."], { cwd: repo, env });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: repo, env });
  return { repo, plot };
}

/** An intent raised from a panel, as a page's link raises it: through the test app's SDK (tests/apps/notepad). */
export async function raise(page: Page, kind: string, data: Record<string, unknown>) {
  const row = page.locator("#agents .gatherer-row").first();
  if (!(await page.locator("#top-row > .app-pane[data-app=notepad]").count())) {
    await row.hover();
    await row.locator("button.new-more").click();
    await page.locator(".row-menu[role=menu]").getByText("Notepad", { exact: true }).click();
    await expect(
      page.locator("#top-row > .app-pane[data-app=notepad]").frameLocator("iframe").locator("body[data-ready='1']"),
    ).toHaveCount(1);
  }
  const notes = page.frames().find((f) => /^http:\/\/notepad\.localhost:\d+\//.test(f.url()))!;
  type Notes = { notes: { intents: { open: (k: string, d: object) => Promise<unknown> } } };
  await notes.evaluate(
    ([k, d]) => (window as unknown as Notes).notes.intents.open(k as string, d as object),
    [kind, data],
  );
}

/** The apps built on app_kit.fileedit; the one a file opens in, as the page sends a link to it: a LaTeX source or a
 * bibliography, the LaTeX editor; any other, the Files app. */
export type FileApp = "files" | "latex";
const LABEL: Record<FileApp, string> = { files: "Files", latex: "LaTeX Editor" };
export const appOf = (file: string): FileApp => (/\.(tex|ltx|sty|cls|bib)$/i.test(file) ? "latex" : "files");
export const editorPane = (page: Page, app: FileApp = "files") => page.locator(`#top-row > .app-pane[data-app=${app}]`);
export const editorPanel = (page: Page, app: FileApp = "files") => editorPane(page, app).frameLocator("iframe");

/** For expect.poll: what pdf.js's viewer in a preview says of its PDF -- `expr`, of its PDFViewerApplication `app` -- or
 * null while there is no viewer, or none with its PDF loaded yet. A viewer's frame is there before pdf.js has run in it
 * (no PDFViewerApplication yet), and expect.poll does not call again after a call that throws. */
export const inPdf = (page: Page, expr: string) => async () => {
  const viewer = page.frames().find((f) => /\/_ag\/lib\/pdfjs\/web\/viewer\.html/.test(f.url()));
  if (!viewer) return null;
  return viewer
    .evaluate(`(app => (app && app.pdfDocument ? ${expr} : null))(globalThis.PDFViewerApplication)`)
    .catch((e: Error) => `not read: ${e.message}`); // its frame gone meanwhile (a PDF built again): read again
};

/** Claude Code set up here, and only it -- whatever the machine has (CI: none) -- so what starts an actor is offered:
 * the home read by requests, which this route answers, its stream held back. Before the page opens. */
export async function claudeRuns(page: Page) {
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    home.harnesses = ["claude"];
    home.harness_info.claude = { ...home.harness_info.claude, runs: true };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
}

/** The file opened in its app (`app`, else the one it opens in), as Chat's link to it opens it. */
export async function openFile(page: Page, file: string, app: FileApp = appOf(file)) {
  await raise(page, "open-file", { path: file });
  await expect(editorPane(page, app)).toHaveCount(1);
  await expect(editorPanel(page, app).locator(".ed-head .ed-path")).toContainText(path.basename(file));
  await expect(editorPanel(page, app).locator(".cm-content")).toHaveCount(1);
}

const started = new Set<string>(); // the actors of the apps started, not yet forgotten

/** The app started from the menu on `repo`, with its actor (as DocWriter's test: Claude Code set up here, the page's
 * stream held back; the actor's session is only made, never run): the actor's row, and how to put the home back. */
export async function startEditor(page: Page, repo: string, app: FileApp = "files") {
  await claudeRuns(page);
  await openActor(page, CLAUDE);
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover();
  await row.locator("button.new-more").click();
  await page.locator(".row-menu[role=menu]").getByText(`${LABEL[app]}…`, { exact: true }).click();
  const box = page.locator(".dw-menu[role=dialog]", { hasText: `New ${LABEL[app]}` });
  await box.locator("input").fill(repo);
  await box.locator("button.go").first().click();
  await expect(editorPane(page, app)).toHaveCount(1);
  // the app and its actor, one task (the dashboard's task_links.py): the task's row shown, the app's mark among its
  // faces; its actor, the one attached to the app's instance
  const actor = page.locator("#agents .agent.task:has(> .a-main[aria-current=true])");
  await expect(actor.locator(".t-faces img.t-app")).toHaveAttribute("src", `/apps/mark/${app}.svg`);
  await expect(actor.locator(".t-faces .t-face")).toHaveCount(1);
  const src = new URL((await editorPane(page, app).locator("iframe").getAttribute("src")) || "");
  const listed = await (await page.request.get(`/api/apps?gatherer=${src.searchParams.get("gatherer")}`)).json();
  const sid: string = (listed.attached[src.searchParams.get("instance") || ""] || [])[0] || "";
  expect(sid).toMatch(/^[0-9a-f-]{36}$/);
  started.add(sid);
  atEnd(async (p) => {
    // the test failed before its endEditor: the actor forgotten all the same (the app closed with every app)
    if (started.delete(sid)) await p.request.post("/api/discard", { data: { session_id: sid } });
  });
  return { actor, sid, src };
}

/** The home as it was, for the tests after: the app closed, its actor (never started) forgotten. */
export async function endEditor(page: Page, request: APIRequestContext, sid: string, src: URL, app: FileApp = "files") {
  await closePanel(page, editorPane(page, app));
  await expect(editorPane(page, app)).toHaveCount(0);
  const closed = await request.post("/api/apps/close", {
    data: { gatherer: src.searchParams.get("gatherer"), instance: src.searchParams.get("instance") },
  });
  expect(closed.ok()).toBe(true);
  const discarded = await request.post("/api/discard", { data: { session_id: sid } });
  expect(discarded.ok(), await discarded.text()).toBe(true);
  started.delete(sid);
}
