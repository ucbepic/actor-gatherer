// DocWriter as an app (ag_apps/docwriter/): started from a gatherer's "+ ⋯" menu with an agent of its own -- its panel
// (DocWriter's page, on the app's own origin) in the row above the panes, its new actor below it, marked with the app's
// mark -- and its page talking to its backend through the panel SDK. The folder it writes in is one the test makes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./test";
import { CLAUDE, openActor } from "./home";

test("a DocWriter started from the menu: its page above, its actor below with its mark", async ({ page, request }) => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ag-docwriter-")));
  fs.writeFileSync(path.join(folder, "draft.md"), "# A draft\n\nIts first line.\n");
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
  await expect(panel.locator(".app-head")).toContainText(path.basename(folder));
  await expect(panel.locator(".app-agents")).toHaveText("1 agent");
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
  // its actor below: the new one, shown, marked as DocWriter's
  const actor = page.locator("#agents button.agent[aria-current=true]");
  await expect(actor.locator("img.dw-badge")).toHaveAttribute("src", "/apps/mark/docwriter.svg");
  await expect(page.locator("#panes > .pane")).toHaveCount(1);
  const below = (await page.locator("#panes").boundingBox())!,
    above = (await panel.boundingBox())!;
  expect(above.y + above.height).toBeLessThanOrEqual(below.y);

  // the home as it was, for the tests after: its DocWriter closed, its actor (never started) forgotten
  const src = new URL((await panel.locator("iframe").getAttribute("src")) || "");
  const actorKey = (await actor.getAttribute("data-key")) || "";
  await panel.locator(".app-close").click();
  expect(
    (
      await request.post("/api/apps/close", {
        data: { gatherer: src.searchParams.get("gatherer"), instance: src.searchParams.get("instance") },
      })
    ).ok(),
  ).toBe(true);
  const discarded = await request.post("/api/discard", { data: { session_id: actorKey.split("/").pop() } });
  expect(discarded.ok(), await discarded.text()).toBe(true);
  await expect(page.locator(`#agents button.agent[data-key="${actorKey}"]`)).toHaveCount(0);
});
