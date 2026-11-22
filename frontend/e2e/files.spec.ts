// The Files app (ag_apps/files/: app_kit.fileedit's panel, edited plain, plain.js) and what both apps show of the actors'
// changes (recent.js): a file typed in and saved whole, a change on disk read again when nothing is unsaved and asked
// about when something is (Reload / Keep mine); the lines an actor changed in the window, marked with its avatar, which
// opens it; the window picked over the tree; the Changes list; and an actor started from the tree's menu.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { closePanel, expect, test } from "./test";
import { CLAUDE, CODEX, GATHERER, NOW, openActor } from "./home";
import { claudeRuns, editorPane, editorPanel, openFile, project } from "./editor-home";

type Agent = { channel: string; name?: { text?: string } | null; last_user_message?: string };
type Home = { gatherers: { name: string; agents: Agent[] }[] };
async function codex(page: Page): Promise<Agent> {
  const home = (await (await page.request.get("/api/home")).json()) as Home;
  return home.gatherers
    .find((g) => g.name === GATHERER)!
    .agents.find((a) => (a.last_user_message || "").startsWith(CODEX))!;
}

test("a file in the Files app: typed and saved whole; changed on disk, read again, or asked about over unsaved edits", async ({
  page,
}) => {
  const { plot } = project();
  await openActor(page, CLAUDE);
  await openFile(page, plot);
  const panel = editorPanel(page);
  const status = panel.locator(".ed-head .ed-status").first();
  await panel.locator(".cm-line").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("  # mine");
  await expect(status).toHaveText("Saved"); // Auto-save
  await expect.poll(() => fs.readFileSync(plot, "utf8").split("\n")[0]).toBe("print('drawing')  # mine");
  // changed on disk, nothing unsaved here: read again, the cursor kept
  fs.writeFileSync(plot, fs.readFileSync(plot, "utf8") + "print('an actor was here')\n");
  await expect(panel.locator(".cm-content")).toContainText("an actor was here", { timeout: 10_000 });
  await expect(status).toHaveText("Saved");
  // Auto-save off, typed, then changed on disk: the reader asked; Keep mine saves theirs over it
  await panel.locator(".ed-auto input").uncheck();
  await panel.locator(".cm-line").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" again");
  await expect(status).toHaveText("Unsaved");
  fs.writeFileSync(plot, "print('rewritten by an actor')\n");
  await expect(status).toHaveText("Changed on disk since you opened it", { timeout: 10_000 });
  expect(fs.readFileSync(plot, "utf8")).toBe("print('rewritten by an actor')\n"); // nothing saved over it meanwhile
  await panel.getByRole("button", { name: "Keep mine" }).click();
  await expect(status).toHaveText("Saved");
  expect(fs.readFileSync(plot, "utf8").split("\n")[0]).toBe("print('drawing')  # mine again");
  // again, and Reload: the file as it is on disk, the reader's edits dropped
  await panel.locator(".cm-line").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(status).toHaveText("Unsaved");
  fs.writeFileSync(plot, "print('theirs')\n");
  await expect(status).toHaveText("Changed on disk since you opened it", { timeout: 10_000 });
  await panel.getByRole("button", { name: "Reload" }).click();
  await expect(panel.locator(".cm-content")).toHaveText("print('theirs')");
  await expect(status).toHaveText("Saved");
  await closePanel(page, editorPane(page));
});

test("an actor's lines marked in the file with its avatar, which opens it; the window picked; its changes listed", async ({
  page,
}) => {
  const { plot } = project();
  const writer = await codex(page);
  const lists: URL[] = [];
  await page.route("**/api/edit/list*", async (route) => {
    const u = new URL(route.request().url()); // the app's origin, files.localhost: a name only the browser resolves
    lists.push(new URL(u.href));
    const host = u.host;
    u.hostname = "127.0.0.1";
    const got = (await (
      await route.fetch({ url: u.href, headers: { ...route.request().headers(), host } })
    ).json()) as {
      entries: Record<string, unknown>[];
    };
    for (const e of got.entries)
      if (e.name === "plot.py" && Number(u.searchParams.get("since")) <= NOW - 60)
        e.writers = [{ gatherer: GATHERER, channel: writer.channel, at: NOW - 60, how: "modified" }];
    await route.fulfill({ json: got });
  });
  await page.route("**/api/files/changes*", (route) =>
    route.fulfill({
      json: {
        path: plot,
        home: "",
        changes: [
          {
            via: "Edit plot.py",
            kinds: ["edited"],
            error: false,
            changed: [1, 1],
            at: NOW - 60,
            asked: "Make it say drawing",
            blocks: [{ t: "diff", at: 1, old: ["print('draw')"], new: ["print('drawing')"], above: [], below: [] }],
          },
        ],
      },
    }),
  );
  await openActor(page, CLAUDE);
  await openFile(page, plot);
  const panel = editorPanel(page);
  // its line: a bar in its hue, its avatar after it; the file's row and header, its avatar too
  await expect(panel.locator(".cm-line.ed-recent")).toHaveCount(1);
  await expect(panel.locator(".cm-line.ed-recent")).toContainText("print('drawing')");
  await expect(panel.locator(".cm-line.ed-recent")).toHaveAttribute("title", /^Changed by /);
  await expect(panel.locator(".ed-recent-av")).toHaveCount(1);
  await expect(panel.locator(".ed-row", { hasText: "plot.py" }).locator(".ed-tree-av")).toHaveCount(1);
  await expect(panel.locator(".ed-head .ed-writers .ed-av")).toHaveCount(1);
  // its changes, beside the file: what it was asked, Show selecting its lines
  await panel.locator(".ed-head button.ed-chs").click();
  const side = panel.locator(".ed-changes");
  await expect(side.locator(".fv-call")).toHaveCount(1);
  await expect(side.locator(".asked")).toContainText("Make it say drawing");
  await expect(side.locator(".ed-ch-av")).toHaveCount(1);
  await panel.locator(".ed-head button.ed-chs").click();
  await expect(side).toBeHidden();
  // the window: the last 10 min asked of the listing from then on; its change, 1 min old, still shown
  const before = lists.length;
  await panel.locator(".ed-window select").selectOption("600");
  await expect
    .poll(() => lists.slice(before).some((u) => u.searchParams.get("since") === String(NOW - 600)))
    .toBe(true);
  await expect(panel.locator(".cm-line.ed-recent")).toHaveCount(1);
  // its avatar pressed, last: that actor opened, as its row in the list opens it (its task, the panel gone with it)
  await panel.locator(".ed-recent-av").click();
  await expect(page.locator("#agents .agent:has(> .a-main[aria-current=true])", { hasText: CODEX })).toHaveCount(1);
});

test("an actor started from the tree's menu, on a folder or a file, in that folder with what the reader wrote", async ({
  page,
}) => {
  const { repo, plot } = project();
  await claudeRuns(page);
  const started: { sessions: Record<string, unknown>[]; sent: Record<string, unknown>[] } = { sessions: [], sent: [] };
  await page.route("**/api/sessions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    started.sessions.push(route.request().postDataJSON());
    return route.fulfill({ json: { session_id: "0123abcd-0000-4000-8000-000000000001", gatherer: GATHERER } });
  });
  await page.route("**/api/send", (route) => {
    started.sent.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await openActor(page, CLAUDE);
  await openFile(page, plot);
  const panel = editorPanel(page);
  // a file: the box has its path first; started in its folder
  await panel.locator(".ed-row", { hasText: "plot.py" }).first().click({ button: "right" });
  await panel.getByRole("menuitem", { name: "Start an actor on this file…" }).click();
  const box = panel.locator(".ed-startpop");
  await expect(box.locator(".ed-send-hd")).toContainText("Start an actor in");
  await expect(box.locator(".ed-start-h")).toHaveText(["Claude Code"]); // each harness that runs here, the first picked
  await expect(box.locator(".ed-start-h.on")).toHaveText("Claude Code");
  await expect(box.locator("textarea")).toHaveValue(`${plot}\n\n`);
  await box.locator("textarea").press("End");
  await box.locator("textarea").pressSequentially("Add a title to the plot");
  await box.locator("textarea").press("Enter");
  await expect(box).toHaveCount(0);
  await expect.poll(() => started.sent.length).toBe(1);
  expect(started.sessions[0]).toMatchObject({ gatherer: GATHERER, cwd: repo, harness: "claude" });
  expect(started.sent[0].text).toBe(`${plot}\n\nAdd a title to the plot`);
  // the folder shown (no row): started there, the box empty
  const nav = panel.locator("#ed-files"); // its empty space, under the rows
  const at = (await nav.boundingBox())!;
  await nav.click({ button: "right", position: { x: 40, y: at.height - 16 } });
  await panel.getByRole("menuitem", { name: "Start an actor here…" }).click();
  await expect(box.locator("textarea")).toHaveValue("");
  await box.locator("textarea").press("Enter"); // nothing written: not started, said in the box
  await expect(box.locator("textarea")).toHaveAttribute("placeholder", "Say what it should do first.");
  await box.locator("textarea").fill("Look around");
  await box.locator("textarea").press("Enter");
  await expect.poll(() => started.sent.length).toBe(2);
  expect(started.sessions[1]).toMatchObject({ cwd: repo });
  await closePanel(page, editorPane(page));
});
