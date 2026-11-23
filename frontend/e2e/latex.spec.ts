// LaTeX in a message (core/ui/tex.ts), in the built page: drawn as Chat draws a message (core/ui/md.ts), its math shown
// as written until KaTeX -- a part of the build of its own -- has loaded, then typeset with KaTeX's own fonts and styles.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { CLAUDE, openActor } from "./home";

/** A message's words drawn in the actor's pane as Chat draws them: their box. */
async function says(page: Page, id: string, md: string) {
  await page.locator("#pane-here").evaluate(
    (here, [id, text]) => {
      const ag = (window as unknown as { agPage: { ui: { markdown: (t: string) => HTMLElement } } }).agPage;
      const box = ag.ui.markdown(text);
      box.id = id;
      Object.assign(box.style, { position: "absolute", left: "40px", top: "60px", zIndex: "50", width: "600px" });
      here.append(box);
    },
    [id, md],
  );
  return page.locator(`#${id}`);
}

test("math in a message is typeset by KaTeX, loaded once a message has some, with its own fonts", async ({ page }) => {
  await openActor(page, CLAUDE);
  const katex = page.waitForResponse((r) => /\/assets\/katex-[\w-]+\.js$/.test(r.url()));
  const box = await says(
    page,
    "said-1",
    "Euler: $e^{i\\pi} + 1 = 0$, and\n\n$$\n\\sum_{k=1}^n k = \\frac{n(n+1)}{2}\n$$",
  );
  expect((await katex).ok()).toBe(true);
  await expect(box.locator(".katex")).toHaveCount(2);
  await expect(box.locator(".md-tex-display .katex-display")).toHaveCount(1);
  // KaTeX's styles: what it writes for a screen reader hidden, the fraction drawn in its own fonts
  expect(
    await box
      .locator(".katex-mathml")
      .first()
      .evaluate((n) => getComputedStyle(n).position),
  ).toBe("absolute");
  expect(
    await box
      .locator(".katex .mfrac")
      .first()
      .evaluate((n) => getComputedStyle(n).fontFamily),
  ).toContain("KaTeX");
  await expect.poll(() => page.evaluate(() => document.fonts.check("1em KaTeX_Main"))).toBe(true);
  // a price is not math, and a formula KaTeX can't read is left as written
  const words = await says(page, "said-2", "It costs $5 and $10. See $\\nosuch{x}$.");
  await expect(words.locator(".katex")).toHaveCount(0);
  await expect(words).toHaveText("It costs $5 and $10. See $\\nosuch{x}$.");
  await expect(words.locator(".md-tex-error")).toHaveAttribute("title", /Undefined control sequence/);
});
