// A tab of a lone app (its apps alone shown, the actor the page opened on out of sight), then another's, then a click on
// that actor: the app's panel goes with its tab, the actor's task shown in a tab of its own. From one tab of apps alone to
// a second, the first's panel closing as the second's was still opening once took the second out of apps alone, so the
// click found the actor's task shown already and left the app's panel beside it (features/layout/panes.js's appsOnlyLeft,
// while a plan renders).
import { expect, test } from "./test";
import { CODEX, GATHERER, open } from "./home";

for (const n of [1, 2]) {
  test(`after ${n} lone app tab(s), a click on the actor put away leaves no app panel shown`, async ({ page }) => {
    const folders = Array.from({ length: n }, (_, i) => `r${i + 1}`);
    for (const folder of folders)
      expect(
        (
          await page.request.post("/api/apps/open", {
            data: { app: "notepad", gatherer: GATHERER, folder: `/w/${folder}` },
          })
        ).ok(),
      ).toBe(true);
    await open(page);
    for (const folder of folders) {
      await page.locator("#agents button.agent.app-row", { hasText: folder }).click();
      await expect(page.locator(`#top-row > .app-pane[aria-label="Notepad · ${folder}"]`)).toBeVisible();
    }
    await page.locator("#agents button.agent", { hasText: CODEX }).click();
    await expect(page.locator("#top-row > .app-pane:not([hidden])")).toHaveCount(0);
  });
}
