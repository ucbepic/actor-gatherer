// The Slack panel, on its own backend: Slack in the browser tests' home is test_app_slack's FakeSlack (tests/web_home.py's
// outside_faked) -- a channel, #paper-deadline, with a message of Leo Park's an hour old, and a DM with Maya Chen. The
// panel connected from its setup, its conversations listed, one opened and written in, an agent's draft sent, and
// disconnected from its settings.
import type { FrameLocator } from "@playwright/test";
import { expect, test } from "./test";
import { GATHERER } from "./home";
import { alone, appPost, kitLoaded, openApp } from "./app-panels";

let opened: { panel: FrameLocator; instance: string } | null = null;
test.afterEach(async ({ page }) => {
  // left as it was, whatever the test came to: Slack disconnected (its line closed), the app opening with its agent
  if (opened) await appPost(opened.panel, opened.instance, "disconnect").catch(() => {});
  opened = null;
  await alone(page, "slack", false);
});

test("Slack: connected from its setup, a conversation opened and written in, and an agent's draft sent", async ({
  page,
}) => {
  await alone(page, "slack");
  await page.goto("/");
  const { panel, instance } = (opened = await openApp(page, "Slack", "slack"));
  await kitLoaded(panel);
  await appPost(panel, instance, "disconnect"); // (an attempt before, retried in this home, may have left it on)

  // not connected: the setup, its tokens taken; connected, the status said live (the connection told the panel
  // before the answer to its connect came, which says "connecting": the told one kept)
  await expect(panel.getByRole("heading", { name: "Connect Slack" })).toBeVisible();
  await panel.getByLabel("User OAuth Token").fill("xoxp-1");
  await panel.getByLabel("App-Level Token").fill("xapp-1");
  await panel.getByRole("button", { name: "Connect" }).click();
  await expect(panel.locator("#setup")).toBeHidden();
  await expect(panel.locator("#status")).toContainText("Live");

  // its conversations, the channel and the DM (All: Recent is Slack's search's)
  const convs = panel.locator("#convs");
  await panel.getByRole("tab", { name: "All" }).click();
  await expect(convs).toContainText("paper-deadline");
  await expect(convs).toContainText("Maya Chen");

  // one opened: its message, by its author
  await convs.getByText("paper-deadline").click();
  const log = panel.locator("#log");
  await expect(log).toContainText("Added the citations.");
  await expect(log).toContainText("Leo Park");

  // written in: posted as the user, shown in the conversation, the box emptied
  const box = panel.locator("#composer textarea, #composer [contenteditable=true]").first();
  await box.click();
  await page.keyboard.type("The camera-ready is uploaded.");
  await page.keyboard.press("Enter");
  await expect(log).toContainText("The camera-ready is uploaded.");
  await expect(box).toHaveText("");

  // an agent's draft: waiting in the conversation until the user sends it
  const got = await (
    await page.request.post("/api/apps/call", {
      data: {
        app: "slack",
        gatherer: GATHERER,
        instance,
        tool: "draft",
        args: { conversation: "#paper-deadline", text: "Thanks, Leo!" },
      },
    })
  ).json();
  expect(got.isError).toBeFalsy();
  const draft = panel.locator("#here-drafts .draft");
  await expect(draft.locator("textarea")).toHaveValue("Thanks, Leo!"); // (its words, to edit before sending)
  await draft.getByRole("button", { name: "Send", exact: true }).click();
  await expect(draft).toHaveCount(0);
  await expect(log).toContainText("Thanks, Leo!");

  // disconnected from its settings -- their button at the bar's right end, clear of the page's × over the corner
  await panel.getByRole("button", { name: "Slack settings" }).click();
  await panel.getByRole("button", { name: "Disconnect Slack" }).click();
  await expect(panel.getByRole("heading", { name: "Connect Slack" })).toBeVisible();
});
