// What the specs of the apps' panels share (slack.spec.ts, paper-news.spec.ts): an app's panel opened from the gatherer's
// menu, its routes asked as the panel asks them, and the kit's colours checked loaded.
import type { FrameLocator, Page } from "@playwright/test";
import { expect } from "./test";
import { GATHERER } from "./home";

/** An app set to open with no agent of its own (the Apps page's "Opens" choice), as it opens where no harness can give
 * an agent its tools (CI's): its menu entry opens it at once, not a box starting an agent with it. Before the page
 * loads, which reads the apps then; `on` false: as it was. */
export async function alone(page: Page, name: string, on = true) {
  expect((await page.request.post("/api/apps/settings", { data: { app: name, agent: !on } })).ok()).toBe(true);
}

/** An app's panel opened from the gatherer's "⋯" menu: the panel, and its instance's id. */
export async function openApp(page: Page, label: string, name: string) {
  const row = page.locator("#agents .gatherer-row").first();
  await row.hover(); // its buttons shown while hovered
  await row.locator("button.new-more").click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  const pane = page.locator(`#top-row > .app-pane[data-app=${name}]`);
  await expect(pane).toHaveCount(1);
  const src = (await pane.locator("iframe").getAttribute("src")) || "";
  return { panel: pane.frameLocator("iframe"), instance: new URL(src).searchParams.get("instance") || "" };
}

/** A route of the app's backend asked as its panel asks it (app_kit's ag.api: on the app's own origin, with its
 * gatherer and instance): its JSON. */
export async function appPost(panel: FrameLocator, instance: string, path: string, body: object = {}) {
  const q = new URLSearchParams({ gatherer: GATHERER, instance }).toString();
  return panel.locator("body").evaluate(
    async (_, [path, q, body]) => {
      const r = await fetch(`/api/${path}?${q}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.json();
    },
    [path, q, body] as const,
  );
}

/** The kit's colours (app_kit/js/kit.css) loaded in the panel: its first stylesheet, with its rules. */
export async function kitLoaded(panel: FrameLocator) {
  const sheet = panel.locator('link[rel=stylesheet][href="/_ag/lib/kit.css"]');
  await expect(sheet).toHaveCount(1);
  await expect.poll(() => sheet.evaluate((n) => (n as HTMLLinkElement).sheet?.cssRules.length || 0)).toBeGreaterThan(1);
}
