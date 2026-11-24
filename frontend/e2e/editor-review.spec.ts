// The LaTeX editor in Review covers every file of its folder, open or not: its actor's change to a file the reader does
// not have open is a proposal too -- the file on disk as it was until it is accepted -- counted on the file's row in the
// tree and in the header ("1 proposal in other files"), which opens the next such file at it.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./test";
import { editorPanel, endEditor, project, startEditor } from "./editor-home";

test("in Review its actor's edit to a file not open is a proposal too, counted in the tree and opened from the header", async ({
  page,
  request,
}) => {
  const { repo } = project();
  const notes = path.join(repo, "notes.txt");
  fs.writeFileSync(notes, "first line\nsecond line\n");
  const { sid, src } = await startEditor(page, repo, "latex");
  const panel = editorPanel(page, "latex");
  const saved = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/mode" && r.request().method() === "POST",
  );
  await panel.locator(".ed-mode-pick select").selectOption("review"); // no file open
  expect((await saved).ok()).toBe(true); // the mode the backend has, before its actor's call
  const called = await request.post(`/mcp/${sid}`, {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "latex_edit",
        arguments: { path: notes, old_string: "second line", new_string: "second line, proposed" },
      },
    },
  });
  const answer = await called.json();
  expect(answer.result.content[0].text, JSON.stringify(answer)).toContain("in the folder of the user's LaTeX editor");
  expect(fs.readFileSync(notes, "utf8")).toBe("first line\nsecond line\n"); // the file on disk: as it was
  // counted on its row, and in the header, for a file not open
  await expect(panel.locator(".ed-row", { hasText: "notes.txt" }).locator(".mk.pr")).toHaveText("1");
  const chip = panel.locator(".ed-head .ed-pr-next");
  await expect(chip).toHaveText("1 proposal in other files");
  await chip.click(); // the next file with one, opened at it
  const box = panel.locator(".ed-cf", { hasText: "proposes to change these lines" });
  await expect(box).toHaveCount(1);
  await expect(box.locator(".ed-cf-theirs")).toContainText("second line, proposed");
  await expect(panel.locator(".ed-head .ed-pr-next")).toHaveCount(0); // none waits elsewhere now
  // its actor detached first, as above: told what the user chose, a never-started actor would stay listed
  const detached = await request.post("/api/apps/detach", {
    data: { gatherer: src.searchParams.get("gatherer"), instance: src.searchParams.get("instance"), channel: sid },
  });
  expect(detached.ok(), await detached.text()).toBe(true);
  await box.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => fs.readFileSync(notes, "utf8")).toBe("first line\nsecond line, proposed\n");
  await expect(panel.locator(".ed-row", { hasText: "notes.txt" }).locator(".mk.pr")).toHaveCount(0);
  await endEditor(page, request, sid, src, "latex");
});
