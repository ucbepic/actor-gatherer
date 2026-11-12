// Pictures in the Notes app (ag_apps/notes/): a picture pasted or dropped into a page is kept by the app and shown as an
// image block, its words its caption, its width dragged from its sides; a Figma link pasted alone on a line becomes, if
// the reader says so, the frame shown live in Figma's embed -- with a snapshot the app keeps of it, shown when Figma
// can't, and what agents see. Agents read pictures with the page (notes_read), as markdown and as the pictures.
// Figma itself is never reached: its embed and the app's asks for a snapshot are answered by the test.
import type { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./test";
import { open } from "./home";
import { binPage, call, newPage, openNotes } from "./notes-home";
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
  const caption = panel.locator(".blk[data-type=image] .tx.cap");
  await expect(caption).toBeFocused(); // typed only once there: a slow page took it into another line before
  await page.keyboard.type("A plot");
  await expect(caption).toHaveText("A plot");
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
  await expect(caption).toHaveText("");
  await page.keyboard.press("ControlOrMeta+z"); // the picture
  await expect.poll(() => types(panel)).toEqual(["text", "text"]);
  await binPage(panel, "Undone");
});

// A picture had no width before it was sized: ⌘Z takes it back to none, and the backend keeps that -- it refused the ""
// the panel used to send, the panel read the page again, and the width came back (and with it, on CI, a change in flight
// was lost, so the next ⌘Z was refused)
test("a picture's width taken back by ⌘Z stays taken back", async ({ page }) => {
  const refused: string[] = [];
  page.on("console", (m) => {
    if (m.text().startsWith("notes: a change refused")) refused.push(m.text());
  });
  await open(page);
  const { panel } = await openNotes(page);
  await newPage(page, panel, "Narrowed");
  await paste(panel, 200, 100);
  await expect.poll(() => types(panel)).toEqual(["image", "text"]);
  const fig = panel.locator(".blk[data-type=image] .pic");
  const width = () => fig.evaluate((n) => (n as HTMLElement).style.width);
  await fig.hover();
  const r = (await panel.locator(".blk[data-type=image] .hdl.r").boundingBox())!;
  await page.mouse.move(r.x + 3, r.y + 10);
  await page.mouse.down();
  await page.mouse.move(r.x - 60, r.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect.poll(width).toMatch(/^\d+%$/);
  await panel.locator("#blocks > .blk").nth(1).locator(".tx").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(width).toBe("");
  await expect(panel.locator("#saved")).toHaveText("Saved");
  expect(refused).toEqual([]);
  await page.reload();
  const again = await openNotes(page);
  await again.panel.locator(".pg-row", { hasText: "Narrowed" }).click();
  const kept = again.panel.locator(".blk[data-type=image] .pic");
  await expect(kept).toHaveCount(1);
  expect(await kept.evaluate((n) => (n as HTMLElement).style.width)).toBe("");
  await binPage(again.panel, "Narrowed");
});

// A change the backend refuses: the panel reads the page again, and a change made while that read is on its way is kept
// -- applied over the page as read, then sent -- not sent first and then lost under the older page, when the read came
// back before the change's own echo did (the next ⌘Z of it refused, "those lines have changed since"; CI's flake)
test("a change made while the page is read again after a refusal is kept", async ({ page }) => {
  await open(page);
  const { panel, instance } = await openNotes(page);
  await newPage(page, panel, "Refused");
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  await expect(panel.locator("#saved")).toHaveText("Saved");
  let refusing = () => {};
  const refusedOne = new Promise<void>((r) => (refusing = r));
  let release = () => {};
  const released = new Promise<void>((r) => (release = r));
  let reading = false;
  const ops = (u: URL) => u.pathname.endsWith("/ops");
  await page.route(ops, async (route) => {
    if ((route.request().postData() || "").includes("REFUSE")) {
      reading = true;
      refusing();
      return route.fulfill({ status: 400, json: { error: "refused by the test" } });
    }
    if (reading) {
      await released; // sent while the page is read again: reaches the backend only after that read is back
      await new Promise((r) => setTimeout(r, 300));
    }
    await route.continue();
  });
  const state = (u: URL) => u.pathname.endsWith("/state");
  await page.route(state, async (route) => {
    const asked = new URL(route.request().url()); // (on the panel's own origin, *.localhost: Node can't look it up)
    const got = await route.fetch({
      url: `${asked.protocol}//127.0.0.1:${asked.port}${asked.pathname}${asked.search}`,
      headers: { ...route.request().headers(), host: asked.host },
    }); // the page as it is now; given to the panel only once the test says so
    await released;
    await route.fulfill({ response: got });
  });
  await panel.locator("#blocks > .blk").nth(0).locator(".tx").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" REFUSE");
  await refusedOne; // sent and refused: the page being read again
  await panel.locator("#blocks > .blk").nth(1).locator(".tx").click();
  await page.keyboard.type("kept");
  await page.waitForTimeout(900); // past the panel's 450 ms: the words would be sent now
  release();
  await expect(panel.locator("#saved")).toHaveText("Saved");
  await expect.poll(async () => (await call(page, instance, "read", { page: "Refused" })).text).toMatch(/\] kept$/m);
  await page.keyboard.press("ControlOrMeta+z"); // its typing taken back: the line as the panel has it is "kept" too
  await expect.poll(async () => (await call(page, instance, "read", { page: "Refused" })).text).not.toMatch(/kept/);
  await page.unroute(state); // the rest as usual: the page binned, and deleted for good before the test ends
  await page.unroute(ops);
  await binPage(panel, "Refused");
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
