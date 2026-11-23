// The LaTeX editor's text folded away (ag_apps/latex/panel/latex.js, edFoldText), as its files fold away: offered while its
// preview is shown, a thin bar in the text's place, the preview taking the width; kept as the panel is made anew (its
// task left and come back to, the page reloaded), and shown again by the bar, another file opened, the preview hidden,
// a place in its file asked for (a double-click in the PDF). The first test's preview runs a script (no LaTeX needed):
// the project the Editor's tests make (editor-home.ts).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./test";
import { CLAUDE, CODEX, openActor } from "./home";
import { editorPane, editorPanel, endEditor, inPdf, openFile, project, startEditor } from "./editor-home";

test("the LaTeX editor's text folds away beside its preview, the preview taking the width, until it is shown again", async ({
  page,
  request,
}) => {
  const { repo } = project();
  fs.writeFileSync(path.join(repo, "notes.tex"), "% notes\n");
  const { actor, sid, src } = await startEditor(page, repo, "latex");
  const task = page.locator(`#agents .agent[data-key="${await actor.getAttribute("data-key")}"]`); // the LaTeX editor's task
  const panel = editorPanel(page, "latex");
  const hide = panel.getByRole("button", { name: "Hide the text" });
  const bar = panel.getByRole("button", { name: "Show the text" });
  const text = panel.locator(".ed-body");
  // the widths in the panel: the preview's, and what is left of the file's row for it beside the text's bar
  const widths = () =>
    panel.locator(".ed-work").evaluate((w) => {
      const of = (q: string) => w.querySelector(q)!.getBoundingClientRect().width;
      return { pv: Math.round(of(".ed-pv")), room: Math.abs(of(".ed-pv") - (w.clientWidth - of(".ed-text-fold"))) };
    });
  const folded = async (file: string) => {
    await expect(text).toBeHidden();
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(file); // the file's name down the bar
    await expect(hide).toHaveCount(0); // the bar shows it again, not the header
    await expect(panel.locator(".ed-pv-grip")).toBeHidden(); // no width to give the preview: it has it all
    expect((await widths()).room).toBeLessThan(1); // all the row's width but the bar's
  };
  await panel.locator(".ed-row", { hasText: "plot.py" }).first().click();
  await expect(panel.locator(".ed-head .ed-path")).toContainText("plot.py");
  await expect(panel.locator(".cm-content")).toHaveCount(1);
  await expect(hide).toHaveCount(0); // no preview shown: the text is all there is, never folded
  await panel.locator("button.ed-exec").click();
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-st")).toContainText("Done");
  const own = (await widths()).pv; // the preview's own width, beside the text
  // offered first in the header; pressed, the keys go to the bar that undoes it
  await expect(panel.locator(".ed-head > :first-child")).toHaveAccessibleName("Hide the text");
  await hide.click();
  await folded("plot.py");
  await expect(bar).toBeFocused();
  await expect(panel.locator(".ed-tree")).toBeVisible(); // the files stay
  // the files fold away too, and back, the text staying folded
  await panel.getByRole("button", { name: "Hide files" }).click();
  await expect(panel.locator(".ed-tree")).toBeHidden();
  await folded("plot.py");
  await panel.getByRole("button", { name: "Show the files" }).click();
  await expect(panel.locator(".ed-tree")).toBeVisible();
  await folded("plot.py");
  // kept: the panel made anew, its task left and come back to, then the page reloaded
  await page.locator("#agents .agent", { hasText: CODEX }).click({ modifiers: ["Alt"] }); // another task in its place (⌥)
  await expect(editorPane(page, "latex")).toHaveCount(0);
  await task.click();
  await expect(editorPane(page, "latex")).toHaveCount(1);
  await expect(panel.locator(".ed-pv")).toBeVisible();
  await folded("plot.py");
  await page.reload();
  await expect(editorPane(page, "latex")).toHaveCount(1);
  await expect(panel.locator(".ed-pv")).toBeVisible();
  await folded("plot.py");
  // the bar pressed: the text back, the preview at its own width again, the keys to the button that folds it
  await bar.click();
  await expect(text).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(hide).toBeFocused();
  await expect(panel.locator(".ed-pv-grip")).toBeVisible();
  expect((await widths()).pv).toBe(own);
  // another file opened: the text shown again, to show it
  await hide.click();
  await folded("plot.py");
  await panel.locator(".ed-row", { hasText: "notes.tex" }).first().click();
  await expect(panel.locator(".ed-head .ed-path")).toContainText("notes.tex");
  await expect(text).toBeVisible();
  await expect(bar).toBeHidden();
  // the preview hidden: the text shown again, and no fold offered without it
  await hide.click();
  await folded("notes.tex");
  await panel.locator(".pv-x").click();
  await expect(panel.locator(".ed-pv")).toBeHidden();
  await expect(text).toBeVisible();
  await expect(bar).toBeHidden();
  await expect(hide).toHaveCount(0);
  await endEditor(page, request, sid, src, "latex");
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

test("a double-click in the PDF beside the folded text shows the text again, at the line it came from", async ({
  page,
}) => {
  test.skip(!hasLatex, "no latexmk and synctex here");
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ag-preview-")));
  const tex = path.join(repo, "paper.tex");
  fs.writeFileSync(tex, "\\documentclass{article}\n\\begin{document}\nFirst page.\n\\end{document}\n");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  await openActor(page, CLAUDE);
  await openFile(page, tex);
  const panel = editorPanel(page, "latex");
  await panel.locator("button.ed-exec").click();
  await panel.getByRole("button", { name: "Save and run" }).click();
  await expect(panel.locator(".pv-st")).toContainText("Done", { timeout: 60_000 });
  await expect.poll(inPdf(page, "app.pagesCount")).toBe(1);
  await panel.getByRole("button", { name: "Hide the text" }).click();
  await expect(panel.locator(".ed-body")).toBeHidden();
  // the file folded is the one it goes back to: shown again all the same, there
  await panel.frameLocator("iframe.pdf").locator(".page[data-page-number='1'] .textLayer span").first().dblclick();
  await expect(panel.locator(".ed-body")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Show the text" })).toBeHidden();
  await expect(panel.locator(".cm-activeLine")).toContainText("First page.");
});
