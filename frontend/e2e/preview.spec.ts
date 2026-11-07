// The Preview app (ag_apps/preview/): a project's preview run and shown in its own pane, asked for by the `run` intent -- as
// the Editor's Execute asks it -- and sending a source's place back to the Editor (`open-file`). The project is one the
// test makes, a git repository with a script that draws an SVG.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, openActor } from "./home";

function project(): { repo: string; plot: string } {
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

/** An intent raised from a panel, as the Editor raises it: through the test app's SDK (tests/apps/notes). */
async function raise(page: Page, kind: string, data: Record<string, unknown>) {
  const row = page.locator("#agents .gatherer-row").first();
  if (!(await page.locator("#top-row > .app-pane[data-app=notes]").count())) {
    await row.hover();
    await row.locator("button.new-more").click();
    await page.locator(".row-menu[role=menu]").getByText("Notes", { exact: true }).click();
    await expect(
      page.locator("#top-row > .app-pane[data-app=notes]").frameLocator("iframe").locator("body[data-ready='1']"),
    ).toHaveCount(1);
  }
  const notes = page.frames().find((f) => /^http:\/\/notes\.localhost:\d+\//.test(f.url()))!;
  type Notes = { notes: { intents: { open: (k: string, d: object) => Promise<unknown> } } };
  await notes.evaluate(
    ([k, d]) => (window as unknown as Notes).notes.intents.open(k as string, d as object),
    [kind, data],
  );
}

const previewPane = (page: Page) => page.locator("#top-row > .app-pane[data-app=preview]");
const previewPanel = (page: Page) => previewPane(page).frameLocator("iframe");

test("a run asked for opens the project's Preview on its form, a guess in it, and runs what is saved", async ({
  page,
}) => {
  const { repo, plot } = project();
  await openActor(page, CLAUDE);
  await raise(page, "run", { path: plot, file: plot });
  await expect(previewPane(page)).toHaveCount(1);
  await expect(previewPane(page).locator(".app-head")).toContainText(path.basename(repo)); // one per repository
  const panel = previewPanel(page);
  await expect(panel.locator(".pv-form input[name=command]")).toHaveValue("python3 {file}"); // the guess, for a .py
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-st")).toContainText("Done");
  await expect(panel.locator(".pv-out")).toContainText("drawing");
  await expect(panel.locator(".pv-cmd")).toContainText("$ python3 {file}");
  await expect(panel.locator(".pv-cmd")).toContainText("set by you");
  // what it shows changed: the file it draws, shown in its place
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.locator(".pv-form input[name=show]").fill("out.svg");
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-result img")).toHaveAttribute("src", /\/api\/files\/[0-9a-f]+\/out\.svg\?/);
  await expect.poll(() => panel.locator(".pv-result img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(40);
});

test("a place sent back opens in the Editor, whose Execute runs the Preview again", async ({ page }) => {
  const { plot } = project();
  await openActor(page, CLAUDE);
  await raise(page, "run", { path: plot, file: plot });
  const panel = previewPanel(page);
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-st")).toContainText("Done");
  // the Preview sends a source's place back (as SyncTeX does): no app takes open-file for a .py, the Editor does
  const frame = page.frames().find((f) => /^http:\/\/preview\.localhost:\d+\//.test(f.url()))!;
  type Preview = { preview: { intents: { open: (k: string, d: object) => Promise<unknown> } } };
  await frame.evaluate(
    (p) => (window as unknown as Preview).preview.intents.open("open-file", { path: p, line: 2 }),
    plot,
  );
  await expect(page.locator("#ed-top")).toBeVisible();
  await expect(page.locator("#ed-top .ed-head")).toContainText("plot.py");
  const before = await panel.locator(".pv-st").textContent();
  await page.locator("#ed-top button.ed-exec").click();
  await expect(panel.locator(".pv-st")).toContainText("Done");
  expect(before).toContain("Done");
  await expect(panel.locator(".pv-out")).toContainText("drawing");
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
  await raise(page, "run", { path: tex, file: tex });
  const panel = previewPanel(page);
  await expect(panel.locator(".pv-form input[name=command]")).toHaveValue(/^latexmk -pdf -synctex=1 /);
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-st")).toContainText("Done", { timeout: 60_000 });
  const pdf = () => page.frames().find((f) => /\/_ag\/lib\/pdfjs\/web\/viewer\.html/.test(f.url()));
  type Viewer = { PDFViewerApplication: { pagesCount: number; page: number } };
  await expect
    .poll(async () => pdf()?.evaluate(() => (window as unknown as Viewer).PDFViewerApplication.pagesCount))
    .toBe(2);
  await raise(page, "locate", { path: tex, line: 5, column: 0 }); // the Editor's "→ PDF"
  await expect.poll(() => pdf()!.evaluate(() => (window as unknown as Viewer).PDFViewerApplication.page)).toBe(2);
  await pdf()!.evaluate(() => ((window as unknown as Viewer).PDFViewerApplication.page = 1));
  await panel.frameLocator("iframe.pdf").locator(".page[data-page-number='1'] .textLayer span").first().dblclick();
  await expect(page.locator("#ed-top .ed-head")).toContainText("paper.tex");
});
