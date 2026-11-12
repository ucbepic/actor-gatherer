// The Browser's panel (ag_apps/browser/panel/panel.js), above its actor: what the agent did on the page, said in a line
// under it (bwFeed) and outlined on it (bwOutline) -- from a Browser's stream, scripted here: the test home has no
// Browser, nor a Chrome to run one. The panel is the real one, served on the app's own origin; its requests to its
// backend are the routes here.
import type { Page } from "@playwright/test";
import { expect, test } from "./test";
import { NOW } from "./home";
import { KEY, browserActors, events, openOwn, panel } from "./browser-home";

const DELETE = [40, 60, 120, 30]; // where the agent's click was
const ROW = [30, 50, 400, 50]; // the row whose check failed
const NOW_BOX = [30, 200, 400, 50]; // where the clicked element is when hovered in the list (`where`)

type Action = { i: number; at: number; ok: boolean; text: string; box: number[] | null; detail: string };
const act = (i: number, ago: number, ok: boolean, text: string, box: number[] | null, detail = ""): Action => ({
  i,
  at: (NOW - ago) * 1000,
  ok,
  text,
  box,
  detail,
});
const OLD = act(1, 90, true, "Opened example.com/invoices", null);
const DONE = act(2, 2, true, 'Clicked "Delete" in "Invoice #4411"', DELETE);
const REFUSED = act(
  3,
  1,
  false,
  `Didn't click "Delete": its row now reads "Invoice #4413" (you clicked button "Sort by amount")`,
  ROW,
  "Not done: expect 1 is false: el.innerText.includes('#4411')",
);

test("what the agent did is said under the page and flashed on it; what it didn't, and why, in amber", async ({
  page,
}) => {
  const frame = await page.evaluate(() => {
    const c = document.createElement("canvas");
    [c.width, c.height] = [800, 600];
    const x = c.getContext("2d")!;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 800, 600);
    return c.toDataURL("image/jpeg").split(",")[1];
  });
  await browserActors(page);
  // joined with one action done before (listed, not flashed); then a click, as it is done and once done; then, joined
  // again, a click refused
  let joins = 0;
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) => {
    joins += 1;
    const states =
      joins === 1
        ? [
            { actions: [OLD] },
            { actions: [OLD], acting: { label: 'Clicking "Delete"', box: DELETE } },
            { actions: [OLD, DONE] },
          ]
        : [{ actions: [OLD, DONE, REFUSED] }];
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: events(states, frame, 1500) });
  });
  const asked: number[] = [];
  await page.route(`**/api/w/*/${KEY}/where`, async (route) => {
    asked.push(route.request().postDataJSON().i);
    await route.fulfill({ json: { box: NOW_BOX } });
  });
  await openOwn(page);

  const feed = panel(page).locator(".bw-feed"),
    line = feed.locator(".line"),
    outline = panel(page).locator(".bw-stage .acting");
  // the click: said in the past tense, the element it was on flashed where it was, then fading
  await expect(line.locator(".tx")).toHaveText(DONE.text);
  await expect(line.locator(".tm")).toHaveText("2s ago");
  // then the refusal, joined again: amber, the row whose check failed outlined, what the agent was told on hover
  await expect(line.locator(".tx")).toHaveText(REFUSED.text);
  await expect(feed).toHaveClass(/\bno\b/);
  await expect(outline).toHaveClass(/\bno\b/);
  await expect(outline).toHaveCSS("left", `${ROW[0] - 3}px`);
  await expect(line).toHaveAttribute("title", new RegExp("What the agent was told:\\nNot done: expect 1 is false"));
  // gone after its fade
  await expect(outline).toBeHidden({ timeout: 5000 });
  // the line opens to the last ones, the latest first; one hovered, outlined where its element is now
  await line.click();
  const items = feed.locator(".list li");
  await expect(items.locator(".tx")).toHaveText([REFUSED.text, DONE.text, OLD.text]);
  await expect(items.first()).toHaveClass(/\bno\b/);
  await items.nth(1).hover();
  await expect.poll(() => asked).toEqual([2]);
  await expect(outline).toBeVisible();
  await expect(outline).toHaveClass(/\bhover\b/);
  await expect(outline).toHaveCSS("top", `${NOW_BOX[1] - 3}px`);
  // the user scrolling the page: the outline is no longer where its element is
  await panel(page)
    .locator(".bw-stage")
    .hover({ position: { x: 300, y: 100 } });
  await page.mouse.wheel(0, 200);
  await expect(outline).toBeHidden();
  // Esc closes the list
  await line.focus();
  await page.keyboard.press("Escape");
  await expect(feed.locator(".list")).toBeHidden();
  await expect(line).toHaveAttribute("aria-expanded", "false");
});

test("the first action done is flashed: an outline drawn as the agent acts, then flashed in place", async ({
  page,
}) => {
  await browserActors(page);
  // the click under way, held there until the test lets it end
  let ended = false;
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events(
        ended
          ? [{ actions: [DONE] }]
          : [{ actions: [] }, { actions: [], acting: { label: 'Clicking "Delete"', box: DELETE } }],
        "",
      ),
    }),
  );
  await openOwn(page);
  const line = panel(page).locator(".bw-feed .line"),
    outline = panel(page).locator(".bw-stage .acting");
  await expect(line.locator(".tx")).toHaveText('Clicking "Delete"…');
  await expect(panel(page).locator(".bw-feed")).toHaveClass(/\bdoing\b/);
  await expect(outline).toHaveClass(/\bdoing\b/);
  await expect(outline).toHaveCSS("left", `${DELETE[0] - 3}px`);
  ended = true;
  await expect(line.locator(".tx")).toHaveText(DONE.text);
  await expect(outline).toHaveClass(/\bdone\b/);
  await expect(outline).toHaveCSS("left", `${DELETE[0] - 3}px`);
});

test("before the agent has acted the line says so, and does not open", async ({ page }) => {
  await browserActors(page);
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: events([{ actions: [] }], "") }),
  );
  await openOwn(page);
  const line = panel(page).locator(".bw-feed .line");
  await expect(line.locator(".tx")).toHaveText("The agent has done nothing on the page yet");
  await expect(line).toBeDisabled();
});

test("an action done while the view was away is listed when it comes back, not flashed", async ({ page }) => {
  await browserActors(page);
  let joins = 0;
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) => {
    joins += 1;
    const actions = joins === 1 ? [] : [act(4, 30, true, 'Clicked "Archive"', DELETE)];
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: events([{ actions }], "") });
  });
  await openOwn(page);
  const line = panel(page).locator(".bw-feed .line");
  await expect(line.locator(".tx")).toHaveText('Clicked "Archive"');
  await expect(line.locator(".tm")).toHaveText("30s ago");
  await expect(panel(page).locator(".bw-stage .acting")).toBeHidden({ timeout: 500 }); // a flash would last 3 s
});

test("an action shown coming: the agent's pointer moves to it, Next is said, and Esc or Stop stops it", async ({
  page,
}) => {
  await browserActors(page);
  const coming = { label: 'Clicking "Delete"', box: DELETE, tool: "click" };
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events([{ actions: [OLD] }, { actions: [OLD], next: coming, playing: true }], "", 60000),
    }),
  );
  const stops: number[] = [],
    keys: string[] = [];
  await page.route(`**/api/w/*/${KEY}/stop`, async (route) => {
    stops.push(Date.now());
    await route.fulfill({ json: {} });
  });
  await page.route(`**/api/w/*/${KEY}/input`, async (route) => {
    for (const e of route.request().postDataJSON().events || []) if (e.type === "key") keys.push(e.key);
    await route.fulfill({ json: {} });
  });
  await openOwn(page);
  const feed = panel(page).locator(".bw-feed"),
    outline = panel(page).locator(".bw-stage .acting"),
    pointer = panel(page).locator(".bw-stage .agent-pointer");
  await expect(feed.locator(".line .tx")).toHaveText('Next: Clicking "Delete"…');
  await expect(outline).toHaveClass(/\bnext\b/);
  await expect(outline).toHaveCSS("left", `${DELETE[0] - 3}px`);
  await expect(pointer.locator("svg")).toBeVisible(); // (the pointer itself: a point, of no size)
  // glided to the middle of what it is about to click
  await expect(pointer).toHaveCSS(
    "transform",
    `matrix(1, 0, 0, 1, ${DELETE[0] + DELETE[2] / 2}, ${DELETE[1] + DELETE[3] / 2})`,
  );
  const stop = feed.locator(".stop");
  await expect(stop).toBeVisible();
  // Esc on the page stops the agent, and is not the page's
  await panel(page).locator(".bw-stage").focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => stops.length).toBe(1);
  await stop.click();
  await expect.poll(() => stops.length).toBe(2);
  await page.waitForTimeout(300);
  expect(keys).toEqual([]);
});

test("stopped: the line says the agent waits for the user's message, and Esc is the page's again", async ({ page }) => {
  await browserActors(page);
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events([{ actions: [DONE], halted: true }], "", 60000),
    }),
  );
  const keys: string[] = [];
  await page.route(`**/api/w/*/${KEY}/input`, async (route) => {
    for (const e of route.request().postDataJSON().events || []) if (e.type === "key") keys.push(e.key);
    await route.fulfill({ json: {} });
  });
  await openOwn(page);
  const feed = panel(page).locator(".bw-feed");
  await expect(feed.locator(".line .tx")).toHaveText("You stopped the agent (Esc): it waits for your next message");
  await expect(feed).toHaveClass(/\bhalted\b/);
  await expect(feed.locator(".stop")).toBeHidden();
  await panel(page).locator(".bw-stage").focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => keys).toContain("Escape");
});

test("the page says whether it shows the view: when it joins, and as its tab is hidden or shown", async ({ page }) => {
  await browserActors(page);
  const joined: string[] = [],
    watched: { page: string; visible: boolean }[] = [];
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) => {
    joined.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: events([{ actions: [] }], "", 60000) });
  });
  await page.route(`**/api/w/*/${KEY}/watch`, async (route) => {
    watched.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  await openOwn(page);
  await expect.poll(() => joined.length).toBe(1);
  const id = new URL(joined[0]).searchParams.get("page");
  expect(id).toBeTruthy();
  expect(new URL(joined[0]).searchParams.get("hidden")).toBeNull();
  const frame = page.frames().find((f) => f.url().includes("browser.localhost"))!;
  await frame.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => watched.at(-1)).toEqual({ page: id, visible: false }); // (its frame coming into sight: said too)
});

// Each action that acts outside the page, held coming: what the view points at
const CUES: { name: string; next: object; check: (page: Page) => Promise<void> }[] = [
  {
    name: "opening a page fills the address bar with the address, lit",
    next: { label: "Opening ballotpedia.org", box: null, tool: "navigate", cue: { url: "https://ballotpedia.org/" } },
    check: async (page) => {
      const addr = panel(page).locator(".bw-bar input[aria-label=Address]");
      await expect(addr).toHaveClass(/\bcoming\b/);
      await expect(addr).toHaveValue("https://ballotpedia.org/");
    },
  },
  {
    name: "going back lights Back",
    next: { label: "Going back", box: null, tool: "back", cue: {} },
    check: async (page) => {
      await expect(panel(page).locator(".bw-bar button[aria-label=Back]")).toHaveClass(/\bcoming\b/);
      await expect(panel(page).locator(".bw-bar button[aria-label=Reload]")).not.toHaveClass(/\bcoming\b/);
    },
  },
  {
    name: "a key pressed on the page as a whole shows as a key cap",
    next: { label: "Pressing Enter", box: null, tool: "press", cue: { key: "Enter" } },
    check: async (page) => {
      await expect(panel(page).locator(".bw-stage .keycap")).toBeVisible();
      await expect(panel(page).locator(".bw-stage .keycap")).toHaveText("Enter");
    },
  },
  {
    name: "a scroll of the whole page shows an arrow its way",
    next: { label: "Scrolling up", box: null, tool: "scroll", cue: { direction: "up" } },
    check: async (page) => {
      await expect(panel(page).locator(".bw-stage .scroll-cue")).toBeVisible();
      await expect(panel(page).locator(".bw-stage .scroll-cue")).toHaveAttribute("data-dir", "up");
    },
  },
];
for (const c of CUES)
  test(`shown coming: ${c.name}`, async ({ page }) => {
    await browserActors(page);
    await page.route(`**/api/w/*/${KEY}/stream*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: events([{ actions: [OLD], next: c.next }], "", 60000),
      }),
    );
    await openOwn(page);
    await expect(panel(page).locator(".bw-feed .line .tx")).toHaveText(`Next: ${(c.next as { label: string }).label}…`);
    await c.check(page);
  });

test("the agent looking at the page is said in the line, a moment, however quick", async ({ page }) => {
  await browserActors(page);
  let joins = 0;
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) => {
    joins += 1;
    const states =
      joins === 1
        ? [
            { actions: [OLD], reading: "Looking at the page" },
            { actions: [OLD], reading: "" },
          ]
        : [{ actions: [OLD] }];
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: events(states, "", 60000) });
  });
  await openOwn(page);
  const tx = panel(page).locator(".bw-feed .line .tx");
  await expect(tx).toHaveText("Looking at the page…");
  await expect(panel(page).locator(".bw-feed")).toHaveClass(/\breading\b/);
  await expect(tx).toHaveText(OLD.text); // then the latest action again
});

test("in the desktop app the page's own native page is placed over the panel's screen, a still picture while covered", async ({
  page,
}) => {
  // the desktop app's preload, played here (desktop/src/preload.cts): where the page asks its pages placed, its stills
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__placed = [];
    w.__drawn = [];
    w.agApp = {
      native: true,
      place: (stages: unknown) => (w.__placed as unknown[]).push(stages),
      onStill: (cb: unknown) => (w.__still = cb),
      stillDrawn: (t: string) => (w.__drawn as string[]).push(t),
      focusDashboard: () => {},
    };
  });
  await browserActors(page);
  const tab = { title: "Invoices", url: "https://example.com/invoices", loading: false, target: "T1" };
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: events([{ actions: [], tabs: [tab] }], "", 60000),
    }),
  );
  await openOwn(page);
  const stage = panel(page).locator(".bw-stage");
  await expect(stage).toBeVisible();
  type Placed = {
    target: string;
    app: string;
    key: string;
    x: number;
    y: number;
    w: number;
    h: number;
    covered: boolean;
  };
  const last = () =>
    page.evaluate(() => ((window as unknown as { __placed: Placed[][] }).__placed.at(-1) || [])[0] || null);
  await expect.poll(async () => (await last())?.target).toBe("T1");
  const box = (await stage.boundingBox())!;
  const placed = (await last())!;
  expect([placed.app, placed.key, placed.covered]).toEqual(["browser", KEY, false]);
  expect([placed.x, placed.y, placed.w, placed.h].map(Math.round)).toEqual(
    [box.x, box.y, box.width, box.height].map(Math.round),
  );
  // something of the dashboard's over it: covered, and the still picture the app sends drawn in the panel's screen
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "over";
    d.style.cssText = "position:fixed;inset:0;z-index:99999";
    document.body.append(d);
  });
  await expect.poll(async () => (await last())?.covered).toBe(true);
  const url = await page.evaluate(() => {
    const c = document.createElement("canvas");
    [c.width, c.height] = [4, 4];
    return c.toDataURL("image/png");
  });
  await page.evaluate(
    (u) => (window as unknown as { __still: (s: object) => void }).__still({ target: "T1", url: u }),
    url,
  );
  await expect(stage.locator(":scope > img")).toHaveAttribute("src", url);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __drawn: string[] }).__drawn)).toEqual(["T1"]);
  await page.evaluate(() => document.getElementById("over")!.remove());
  await expect.poll(async () => (await last())?.covered).toBe(false);
});

test("the address bar suggests pages opened before: Down to one puts it in the box, Enter or a click opens it, x or Shift+Delete forgets it", async ({
  page,
}) => {
  await browserActors(page);
  await page.route(`**/api/w/*/${KEY}/stream*`, (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: events([{}], "", 60_000) }),
  );
  const PAGES = [
    { url: "https://github.com/", title: "GitHub" },
    { url: "https://github.com/acme/widgets/pulls", title: "Pull requests" },
    { url: "https://gitlab.com/", title: "" },
  ];
  const asked: string[] = [],
    forgot: string[] = [],
    opened: string[] = [];
  await page.route("**/api/visited*", async (route) => {
    if (route.request().method() === "POST") {
      forgot.push(route.request().postDataJSON().forget);
      return route.fulfill({ json: {} });
    }
    asked.push(new URL(route.request().url()).searchParams.get("q") || "");
    await route.fulfill({ json: { pages: PAGES.filter((p) => !forgot.includes(p.url)) } });
  });
  await page.route(`**/api/w/*/${KEY}/nav`, async (route) => {
    opened.push(route.request().postDataJSON().url);
    await route.fulfill({ json: { done: "" } });
  });
  await openOwn(page);
  const p = panel(page),
    addr = p.getByRole("combobox", { name: "Address" }),
    list = p.locator(".bw-menu.hist"),
    rows = list.locator(".row");
  await expect(addr).toHaveValue("https://example.com/invoices");
  await addr.click();
  await addr.press("ControlOrMeta+a");
  await addr.pressSequentially("git");
  await expect.poll(() => asked.at(-1)).toBe("git");
  // each its address as typed (no scheme, "www." or end slash), then its title, dimmer
  await expect(rows.locator(".u")).toHaveText(["github.com", "github.com/acme/widgets/pulls", "gitlab.com"]);
  await expect(rows.locator(".tt")).toHaveText(["GitHub", "Pull requests"]);
  await expect(addr).toHaveAttribute("aria-expanded", "true");
  // Down to one: the box has its address; Up past the first: what was typed again
  await addr.press("ArrowDown");
  await addr.press("ArrowDown");
  await expect(rows.nth(1)).toHaveClass(/\bon\b/);
  await expect(addr).toHaveValue(PAGES[1].url);
  await expect(addr).toHaveAttribute("aria-activedescendant", "bw-hist-1");
  await addr.press("ArrowUp");
  await addr.press("ArrowUp");
  await expect(addr).toHaveValue("git");
  // Esc closes them, what was typed kept; Down opens them again
  await addr.press("ArrowDown");
  await addr.press("Escape");
  await expect(list).toBeHidden();
  await expect(addr).toHaveValue("git");
  await addr.press("ArrowDown");
  await expect(rows).toHaveCount(3);
  // Shift+Delete on the one picked forgets it: the next takes its place, in the box too
  await addr.press("ArrowDown");
  await addr.press("Shift+Delete");
  await expect.poll(() => forgot).toEqual([PAGES[0].url]);
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveClass(/\bon\b/);
  await expect(addr).toHaveValue(PAGES[1].url);
  // its x forgets one too, the box keeping the focus
  await rows.nth(1).hover();
  await rows.nth(1).locator(".x").click();
  await expect.poll(() => forgot).toEqual([PAGES[0].url, PAGES[2].url]);
  await expect(rows).toHaveCount(1);
  await expect(addr).toBeFocused();
  // Enter opens the one picked, and closes them
  await addr.press("Enter");
  await expect.poll(() => opened).toEqual([PAGES[1].url]);
  await expect(list).toBeHidden();
  // a click on one opens it
  await addr.click();
  await addr.fill("wid");
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect.poll(() => opened).toEqual([PAGES[1].url, PAGES[1].url]);
  await expect(list).toBeHidden();
  // lines pasted run together with a space, as in Chrome's address bar (a text box drops the breaks); Enter sends
  // them as typed, for the Browser to search for
  await addr.fill("");
  await addr.evaluate((box) => {
    const d = new DataTransfer();
    d.setData("text/plain", "  τ²-Bench: Evaluating\r\nConversational Agents\n");
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true }));
  });
  await expect(addr).toHaveValue("τ²-Bench: Evaluating Conversational Agents");
  await addr.press("Enter");
  await expect.poll(() => opened.at(-1)).toBe("τ²-Bench: Evaluating Conversational Agents");
});
