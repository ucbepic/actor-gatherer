// What the Editor's browser tests share (ag_apps/editor/): a project to open -- a git repository the test makes, with a
// script that draws an SVG -- an intent raised from a panel, as a page's link raises it, and the Editor's pane and panel.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "./test";

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

export const editorPane = (page: Page) => page.locator("#top-row > .app-pane[data-app=editor]");
export const editorPanel = (page: Page) => editorPane(page).frameLocator("iframe");

/** The file opened in the Editor, as Chat's link to it opens it. */
export async function openFile(page: Page, file: string) {
  await raise(page, "open-file", { path: file });
  await expect(editorPane(page)).toHaveCount(1);
  await expect(editorPanel(page).locator(".ed-head .ed-path")).toContainText(path.basename(file));
  await expect(editorPanel(page).locator(".cm-content")).toHaveCount(1);
}
