// DocWriter as an app (ag_apps/docwriter/): started from a gatherer's "+ ⋯" menu (its one entry, "DocWriter…") with an agent of its own -- its panel
// (DocWriter's page, on the app's own origin) in the row above the panes, its new actor below it, the two one task, the
// app's mark among its faces -- and its page talking to its backend through the panel SDK. The folder it writes in is
// one the test makes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closePanel, expect, homeAs, streamsAsRequests, test } from "./test";
import { CLAUDE, openActor } from "./home";

test("a DocWriter started from the menu: its page above, its actor below, one task", async ({ page, request }) => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ag-docwriter-")));
  fs.writeFileSync(path.join(folder, "draft.md"), "# A draft\n\nIts first line.\n");
  // the home as the server has it, but with Claude Code set up here, whether or not it is on this machine (CI has
  // neither harness: the menu then offers no DocWriter, which needs one for its agent); its stream held back, so the
  // server's own home does not replace it. The actor's session is only made: no harness runs.
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    home.harnesses = ["claude"];
    home.harness_info.claude = { ...home.harness_info.claude, runs: true };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort()); // nor its fallback (the apps' own, /api/apps/stream, stays)
  await openActor(page, CLAUDE);
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover();
  await row.locator("button.new-more").click();
  await page.locator(".row-menu[role=menu]").getByText("DocWriter…", { exact: true }).click();
  const box = page.locator(".dw-menu[role=dialog]", { hasText: "New DocWriter" });
  await box.locator("input").fill(folder);
  await box.locator("button.go").first().click();

  const panel = page.locator("#top-row > .app-pane[data-app=docwriter]");
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute("aria-label", new RegExp(` · ${path.basename(folder)}$`)); // named by its folder
  expect(await panel.locator("iframe").getAttribute("src")).toMatch(/^http:\/\/docwriter\.localhost:\d+\/\?/);
  // DocWriter's own page, up: its settings read from its backend, through the path its instance names
  const frame = () => page.frames().find((f) => /^http:\/\/docwriter\.localhost:\d+\//.test(f.url()));
  await expect
    .poll(() => frame()?.evaluate(() => (globalThis as unknown as { __dwBase?: string }).__dwBase ?? ""))
    .toMatch(/^\/api\/w\/[^/]+\/[0-9a-f]{16}$/);
  const cfg = await frame()!.evaluate(async () => {
    const base = (globalThis as unknown as { __dwBase: string }).__dwBase;
    return (await fetch(`${base}/dw`)).json();
  });
  expect(cfg.root).toBe(folder);
  expect(cfg.channel).toMatch(/^[0-9a-f-]{36}$/);
  // its actor below: the new one, shown, in a task with its DocWriter -- the task's row, the app's mark among its faces
  const task = page.locator("#agents .agent.task:has(> .a-main[aria-current=true])");
  await expect(task.locator(".t-faces img.t-app")).toHaveAttribute("src", "/apps/mark/docwriter.svg");
  await expect(task.locator(".t-faces .t-face")).toHaveCount(1);
  await expect(page.locator("#panes > .pane")).toHaveCount(1);
  const below = (await page.locator("#panes > .pane").boundingBox())!,
    above = (await panel.boundingBox())!;
  expect(above.y + above.height).toBeLessThanOrEqual(below.y);

  // the home as it was, for the tests after: its DocWriter closed, its actor (never started) forgotten
  const src = new URL((await panel.locator("iframe").getAttribute("src")) || "");
  await closePanel(page, panel);
  expect(
    (
      await request.post("/api/apps/close", {
        data: { gatherer: src.searchParams.get("gatherer"), instance: src.searchParams.get("instance") },
      })
    ).ok(),
  ).toBe(true);
  const sid = cfg.channel; // its actor's, as DocWriter has it
  const discarded = await request.post("/api/discard", { data: { session_id: sid } });
  expect(discarded.ok(), await discarded.text()).toBe(true);
  const home = await (await request.get("/api/home")).json(); // the server's (the page's stream is held back)
  const all = home.gatherers.flatMap((g: { agents: { channel: string }[] }) => g.agents);
  expect(all.some((a: { channel: string }) => a.channel === sid)).toBe(false);
});

test("an app set on the Apps page to open on its own: its one menu entry opens it alone, with no box", async ({
  page,
  request,
}) => {
  // Claude Code set up here, whether or not it is on this machine (CI has no harness: no app could then open with an
  // agent of its own) -- in the home read by request and in each the stream sends, which would otherwise replace it
  const claudeHere = (home: Record<string, unknown>) => {
    const info = home.harness_info as Record<string, Record<string, unknown>>;
    return { ...home, harnesses: ["claude"], harness_info: { ...info, claude: { ...info.claude, runs: true } } };
  };
  await page.route("**/api/home", async (route) =>
    route.fulfill({ json: claudeHere(await (await route.fetch()).json()) }),
  );
  await homeAs(page, claudeHere);
  expect((await request.post("/api/apps/settings", { data: { app: "docwriter", agent: false } })).ok()).toBe(true);
  try {
    await openActor(page, CLAUDE);
    const row = page.locator("#agents .gatherer-row").first();
    await row.hover();
    await row.locator("button.new-more").click();
    const menu = page.locator(".row-menu[role=menu]");
    await expect(menu.getByText("DocWriter", { exact: true })).toHaveCount(1); // once, alone: no box to fill in
    await expect(menu.getByText("DocWriter…", { exact: true })).toHaveCount(0);
    await expect(menu.getByText("LaTeX Editor…", { exact: true })).toHaveCount(1); // the others as they were
    await page.keyboard.press("Escape");
    // an app with no agent of its own to open with can't be set so
    expect((await request.post("/api/apps/settings", { data: { app: "files", agent: true } })).status()).toBe(400);
  } finally {
    await request.post("/api/apps/settings", { data: { app: "docwriter", agent: true } }); // the home as it was
  }
});
