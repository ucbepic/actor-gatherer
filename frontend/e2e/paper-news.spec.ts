// The Paper news panel, on its own backend: arXiv in the browser tests' home is a feed made up in its real shape
// (tests/web_home.py's outside_faked) -- the day the tests run, Thursday 1 October 2026, with two new papers and one
// cross-listed. The panel opened for the first time fetches it and shows the day; a paper found, saved and listed as
// saved.
import type { FrameLocator } from "@playwright/test";
import { expect, test } from "./test";
import { appPost, kitLoaded, openApp } from "./app-panels";

let opened: { panel: FrameLocator; instance: string } | null = null;
test.afterEach(async () => {
  // left as it was, whatever the test came to: no paper saved
  if (opened) await appPost(opened.panel, opened.instance, "save", { id: "2610.00103", saved: false }).catch(() => {});
  opened = null;
});

test("Paper news: the day fetched as the panel first opens, a paper found and saved", async ({ page }) => {
  await page.goto("/");
  const { panel } = (opened = await openApp(page, "Paper news", "paper_news"));
  await kitLoaded(panel);

  // no interests told yet: it opens on them, the day fetched listed beside, with its count of papers
  await expect(panel.locator("#head")).toHaveText("Your interests");
  const day = panel.locator("#days").getByText("Thu, Oct 1");
  await expect(day).toBeVisible();

  // the day opened on its picks (none: no interests yet); all its papers a tab away, in arXiv's order -- the new ones,
  // then the cross-listed
  const list = panel.locator("#list");
  await day.click();
  await expect(panel.locator("#head")).toContainText("October 1");
  await panel
    .locator("#tabs")
    .getByRole("tab", { name: /^All papers/ })
    .click();
  await expect(list).toContainText("Learned Indexes for Joins");
  await expect(list).toContainText("Agents That Plan & Query");
  await expect(list).toContainText("Vision for Tables");
  const text = (await list.innerText()).replace(/\s+/g, " ");
  expect(text.indexOf("Learned Indexes")).toBeLessThan(text.indexOf("Vision for Tables"));

  // found by a word of its title
  await panel.locator("#find").fill("tables");
  await expect(list).not.toContainText("Learned Indexes for Joins");
  await expect(list).toContainText("Vision for Tables");

  // saved, then listed with the saved ones
  await list.getByRole("button", { name: "Save", exact: true }).click();
  await expect(list.getByRole("button", { name: "Unsave", exact: true })).toHaveCount(1);
  await panel.locator("#days").getByText("Saved", { exact: true }).click();
  await expect(panel.locator("#head")).toHaveText("Saved papers");
  await expect(list).toContainText("Vision for Tables");
  await expect(list).not.toContainText("Agents That Plan & Query");
});
