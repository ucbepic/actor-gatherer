// The Editor app's lines selected, sent to an actor (ag_apps/editor/panel/editor-send.js): a button beside the
// selection, a picker of the gatherer's actors under a box for what to do, and the one picked sent the user's words with
// where the lines are and the lines themselves, as the user's message. What reaches the actor is the page's /api/send,
// held here: the test home's actors have no terminal to type into.
import { expect, test } from "./test";
import { CLAUDE, GATHERER, openActor } from "./home";
import { editorPanel, openFile, project } from "./editor-home";

test("lines selected in a file go to an actor picked, with what to do, as the user's message", async ({ page }) => {
  const sent: Record<string, unknown>[] = []; // what reaches the actor: the page's /api/send, held (no terminal here)
  await page.route("**/api/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  const { plot } = project();
  await openActor(page, CLAUDE);
  await openFile(page, plot);
  const panel = editorPanel(page);
  const button = panel.locator("button.ed-send");
  await panel.locator(".cm-line").first().click();
  await expect(button).toBeHidden(); // nothing selected
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown"); // the first line, to the second's start: that line alone
  await expect(button).toBeVisible();
  await button.click();
  const pop = panel.locator(".ed-sendpop");
  await expect(pop).toBeVisible();
  await expect(button).toBeHidden();
  await expect(pop.locator(".ed-send-hd")).toHaveText("Send line 1 of plot.py to an actor, as your message");
  await expect(pop.locator(".ed-send-it", { hasText: CLAUDE })).toHaveCount(1);
  await expect(pop.locator(".ed-send-ask")).toBeFocused(); // its box has the keys at once
  await page.keyboard.press("Enter"); // nothing asked yet: not sent
  await expect(pop.locator(".ed-send-ask")).toHaveClass(/bad/);
  await page.keyboard.type("Make it say what it draws");
  await pop.locator(".ed-send-it", { hasText: CLAUDE }).click();
  await expect(pop).toBeHidden();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ gatherer: GATHERER });
  expect(sent[0].text).toBe(`Make it say what it draws\n\nLine 1 of ${plot}:\n\n\`\`\`py\nprint('drawing')\n\`\`\``);
  await expect(panel.locator(".ed-toast")).toHaveText(`Sent to ${CLAUDE}`);
  // the keys back in the file, the lines still selected: Esc puts the picker away, nothing sent
  await expect(button).toBeVisible();
  await button.click();
  await page.keyboard.type("Never mind");
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await page.keyboard.press("ArrowRight"); // the selection gone: so is the button
  await expect(button).toBeHidden();
  expect(sent).toHaveLength(1);
});
