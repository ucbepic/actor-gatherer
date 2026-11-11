// Pictures in the Notes app (ag_apps/notes/): a picture pasted or dropped into a page is kept by the app and shown as an
// image block, its words its caption, its width dragged from its sides; a Figma link pasted alone on a line becomes, if
// the reader says so, the frame shown live in Figma's embed -- with a snapshot the app keeps of it, shown when Figma
// can't, and what agents see. Agents read pictures with the page (notes_read), as markdown and as the pictures.
// Figma itself is never reached: its embed and the app's asks for a snapshot are answered by the test.
import type { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { open } from "./home";
import { binPage, newPage, openNotes } from "./notes-home";
import { GATHERER } from "./home";

const FIGMA = "https://www.figma.com/design/Xk2abcdEF9/Paper-figures?node-id=12-34";

/** notes_read of a page, as an agent gets it: its words, and what follows them (the pictures, each after its line). */
async function read(page: Page, instance: string, title: string) {
  const got = await (
    await page.request.post("/api/apps/call", {
      data: { app: "notes", gatherer: GATHERER, instance, tool: "read", args: { page: title } },
    })
  ).json();
  return got.content as { type: string; text?: string; mimeType?: string; data?: string }[];
}

/** A PNG of w x h drawn in the panel, as a File: pasted into the line the caret is in, or dropped on the page at y. */
async function paste(panel: FrameLocator, w: number, h: number) {
  await panel.locator("body").evaluate(
    async (_, [w, h]) => {
      const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
      c.getContext("2d")!.fillRect(0, 0, w, h);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
      document.activeElement!.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    [w, h],
  );
}
async function drop(panel: FrameLocator, row: number) {
  await panel.locator("body").evaluate(async (_, row) => {
    const y = document.querySelectorAll("#blocks > .blk")[row].getBoundingClientRect().top + 2; // its top half: before it
    const c = Object.assign(document.createElement("canvas"), { width: 50, height: 50 });
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "dropped.png", { type: "image/png" }));
    const at = document.getElementById("scroll")!;
    for (const kind of ["dragover", "drop"])
      at.dispatchEvent(
        new DragEvent(kind, { dataTransfer: dt, clientX: 300, clientY: y, bubbles: true, cancelable: true }),
      );
  }, row);
}
const types = (panel: FrameLocator) =>
  panel.locator("#blocks > .blk").evaluateAll((ns) => ns.map((n) => (n as HTMLElement).dataset.type));

test("a picture pasted is kept and shown, captioned and sized, read by agents, and taken back by ⌘Z", async ({
  page,
}) => {
  await open(page);
  const { panel, instance } = await openNotes(page);
  await newPage(page, panel, "Figures");
  await page.keyboard.type("Results:");
  await page.keyboard.press("Enter");
  await paste(panel, 240, 120); // into the empty line: that line becomes the picture, a line to type in after it
  const pic = panel.locator(".blk[data-type=image] .pic img");
  await expect(pic).toHaveCount(1);
  await expect.poll(() => pic.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(240);
  await expect.poll(() => types(panel)).toEqual(["text", "image", "text"]);
  await expect(panel.locator("#blocks > .blk").nth(2).locator(".tx")).toBeFocused();

  // its caption: typed under it; Enter, a line below it
  await panel.locator(".blk[data-type=image] .pic-tools button", { hasText: "Caption" }).click({ force: true });
  await page.keyboard.type("Loss by step");
  await page.keyboard.press("Enter");
  await expect.poll(() => types(panel)).toEqual(["text", "image", "text", "text"]);
  await expect
    .poll(async () => (await read(page, instance, "Figures"))[0].text)
    .toMatch(/!\[Loss by step\]\(image:[a-f0-9]{16}\.png\)/);
  const got = await read(page, instance, "Figures");
  expect(got[1].text).toMatch(/^\[[a-z0-9]{8}\] the picture: Loss by step$/);
  expect([got[2].type, got[2].mimeType]).toEqual(["image", "image/png"]);

  // its side dragged in: drawn narrower, and kept so
  const fig = panel.locator(".blk[data-type=image] .pic");
  await fig.hover();
  const r = (await panel.locator(".blk[data-type=image] .hdl.r").boundingBox())!;
  await page.mouse.move(r.x + 3, r.y + 10);
  await page.mouse.down();
  await page.mouse.move(r.x - 60, r.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => fig.evaluate((n) => (n as HTMLElement).style.width)).toMatch(/^\d+%$/);
  const width = await fig.evaluate((n) => (n as HTMLElement).style.width);
  await page.reload();
  const again = await openNotes(page);
  await again.panel.locator(".pg-row", { hasText: "Figures" }).click();
  await expect
    .poll(() => again.panel.locator(".blk[data-type=image] .pic").evaluate((n) => (n as HTMLElement).style.width))
    .toBe(width);
  await binPage(again.panel, "Figures");
});

test("⌘Z takes back a picture's width, its caption, and the picture pasted", async ({ page }) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Undone");
  await page.keyboard.type("Results:");
  await page.keyboard.press("Enter");
  await paste(panel, 200, 100);
  await expect.poll(() => types(panel)).toEqual(["text", "image", "text"]);
  await panel.locator(".blk[data-type=image] .pic-tools button", { hasText: "Caption" }).click({ force: true });
  await page.keyboard.type("A plot");
  const fig = panel.locator(".blk[data-type=image] .pic");
  await fig.hover();
  const r = (await panel.locator(".blk[data-type=image] .hdl.r").boundingBox())!;
  await page.mouse.move(r.x + 3, r.y + 10);
  await page.mouse.down();
  await page.mouse.move(r.x - 60, r.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => fig.evaluate((n) => (n as HTMLElement).style.width)).toMatch(/^\d+%$/);
  await panel.locator("#blocks > .blk").nth(2).locator(".tx").click();
  await page.keyboard.press("ControlOrMeta+z"); // the width
  await expect.poll(() => fig.evaluate((n) => (n as HTMLElement).style.width)).toBe("");
  await page.keyboard.press("ControlOrMeta+z"); // the caption
  await expect(panel.locator(".blk[data-type=image] .tx.cap")).toHaveText("");
  await page.keyboard.press("ControlOrMeta+z"); // the picture
  await expect.poll(() => types(panel)).toEqual(["text", "text"]);
  await binPage(panel, "Undone");
});

test("pictures dropped land between the lines where the drop line shows", async ({ page }) => {
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Dropped");
  for (const w of ["one", "two"]) {
    await page.keyboard.type(w);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("three");
  await drop(panel, 1); // over the top half of "two": before it
  await expect.poll(() => types(panel)).toEqual(["text", "image", "text", "text"]);
  await expect(panel.locator("#drop")).toBeHidden();
  await binPage(panel, "Dropped");
});

test("a Figma link pasted alone on a line becomes the frame live, or stays a link", async ({ page }) => {
  await open(page);
  const embeds: string[] = [];
  await page.route("https://embed.figma.com/**", (route) => {
    embeds.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<body style='background:#eee'>a frame</body>" });
  });
  await page.route("**/api/figma/snap?**", (route) =>
    route.fulfill({ json: { error: "the file isn't public: add a Figma token for a snapshot of it" } }),
  );
  await page.route("**/api/figma/token?**", (route) => route.fulfill({ json: { who: "sam" } }));
  const { panel, instance } = await openNotes(page);
  await newPage(page, panel, "Design");
  const pasteText = (t: string) =>
    panel.locator("body").evaluate((_, t) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      document.activeElement!.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }, t);

  await pasteText(FIGMA);
  await expect(panel.locator(".pop .hd")).toHaveText("Show it as");
  await expect(panel.locator(".pop .it.on")).toContainText("The frame, live");
  await page.keyboard.press("Enter");
  const fig = panel.locator(".blk[data-type=figma] .fig");
  await expect(fig.locator(".fg-name")).toHaveText("Paper figures");
  await expect(fig.locator(".fg-state")).toHaveText("Live");
  await expect.poll(() => embeds.length).toBeGreaterThan(0);
  expect(embeds[0]).toMatch(
    /^https:\/\/embed\.figma\.com\/design\/Xk2abcdEF9\/Paper-figures\?embed-host=ag&.*node-id=12-34/,
  );
  await expect(fig.locator(".fg-band")).toContainText("Your agents can't see this frame");
  await expect
    .poll(async () => (await read(page, instance, "Design"))[0].text)
    .toContain(`[Figma: Paper figures](${FIGMA})`);

  // the snapshot asked for: there is none, and why; a token given
  await fig.locator("[data-do=view]").click();
  await expect(fig.locator(".fg-state")).toHaveText("No snapshot");
  await expect(fig.locator("iframe")).toHaveCount(0);
  await fig.locator(".fg-band [data-do=token]").click();
  await panel.locator(".pop .fg-input").fill("figd_test");
  await page.keyboard.press("Enter");
  await expect(panel.locator("#who")).toContainText("Figma token saved (sam)");
  await expect(fig.locator(".fg-band [data-do=token]")).toHaveCount(0);

  // pasted again, kept as a link: words, not a frame
  await panel.locator("#blocks > .blk").last().locator(".tx").click();
  await pasteText(FIGMA);
  await panel.locator(".pop .it", { hasText: "A link" }).click();
  await expect(panel.locator("#blocks > .blk").last().locator(".tx a")).toHaveAttribute("href", FIGMA);
  await expect.poll(() => types(panel)).toEqual(["figma", "text"]);
  await binPage(panel, "Design");
});
