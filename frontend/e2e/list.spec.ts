// The list of actors (page.html: "the agent list", "the list folded, or over the whole page").
import type { WebSocketRoute } from "@playwright/test";
import { expect, streamsAsRequests, test } from "./test";
import { CLAUDE, CODEX, GATHERER, NOW, masks, open, streamHome } from "./home";

test("lists the gatherer's actors, each by its name alone: hovered, a card says who it is", async ({ page }) => {
  await open(page);
  const rows = page.locator("#agents .agent");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("#agents .gatherer-row")).toContainText(GATHERER);
  const claude = rows.filter({ hasText: "Parser fixes" });
  await expect(claude).not.toContainText("/probe-greet Bob");
  await expect(claude).not.toContainText("Fixed the CSV parser's quoting");
  await expect(claude.locator(".a-main")).not.toHaveAttribute("title"); // the card, not the browser's own tooltip
  await expect(rows.filter({ hasText: "Spawn one subagent" })).toHaveCount(1); // no name: its last request in its place
  await expect(page.locator(".side")).toHaveScreenshot("list.png", { mask: masks(page) });
  await claude.hover();
  const card = page.locator("#actor-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Parser fixes");
  await expect(card).toContainText("/probe-greet Bob");
  await expect(card).toContainText("Fixed the CSV parser's quoting");
  const [box, side] = [await card.boundingBox(), await page.locator("#agents").boundingBox()];
  expect(box!.x).toBeGreaterThanOrEqual(side!.x + side!.width); // beside the list, not over it
  await claude.locator(".save-btn").hover(); // over its own buttons: none, their titles say what they do
  await expect(card).toBeHidden();
});

test("folds to a rail of avatars, and opens again", async ({ page }) => {
  await open(page);
  await page.locator("#agents .lb-fold").click();
  await expect(page.locator("#rail")).toBeVisible();
  await expect(page.locator("#agents")).toBeHidden();
  await expect(page).toHaveScreenshot("list-folded.png", { mask: masks(page) });
  await page.locator("#list-btns .lb-fold").click();
  await expect(page.locator("#agents")).toBeVisible();
});

test("the rail groups the actors by gatherer, names each, says who it is hovered, and shows one clicked", async ({
  page,
}) => {
  await open(page);
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  await expect(rail.locator(".r-gatherer")).toHaveCount(1);
  await expect(rail.locator(".r-gname")).toContainText(GATHERER);
  const actors = rail.locator(".r-actor");
  await expect(actors).toHaveCount(2); // idle ones too: every actor the list shows
  const claude = actors.filter({ hasText: "Parser fixes" });
  await expect(actors.filter({ hasText: "Spawn one subagent" })).toHaveCount(1);
  await claude.hover();
  const card = page.locator("#actor-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Parser fixes");
  await expect(card).toContainText(`${GATHERER} · Claude Code`);
  await expect(card).toContainText("/probe-greet Bob");
  await expect(card).toContainText("Fixed the CSV parser's quoting");
  await expect(page).toHaveScreenshot("rail-card.png", { mask: masks(page) });
  await page.mouse.move(700, 450);
  await expect(card).toBeHidden();
  await claude.click();
  await expect(claude.locator(".r-main")).toHaveAttribute("aria-current", "true");
  // folded from the rail as in the list: its actors go, and come back
  await rail.locator(".r-gname").click();
  await expect(rail.locator(".r-actor")).toHaveCount(1); // the one shown stays in view
  await rail.locator(".r-gname").click();
  await expect(actors).toHaveCount(2);
});

test("the rail starts a new actor from a gatherer's card: its harness picked beside the rail, its directory asked if it fails", async ({
  page,
}) => {
  // the home as the server has it, but with two harnesses a session can be started on here, and its actors working in a
  // directory (its stream held back, so the server's own home does not replace it)
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    for (const a of home.gatherers.find((x: { name: string }) => x.name === GATHERER).agents) a.cwd = "/work/demo";
    home.harnesses = ["claude", "codex"];
    for (const h of home.harnesses) home.harness_info[h] = { ...home.harness_info[h], runs: true };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  const asked: { gatherer: string; cwd: string; harness: string }[] = [];
  await page.route("**/api/sessions", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: "no directory /gone" } });
  });
  await open(page);
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  await expect(rail.locator("button.new-actor, button.new-more")).toHaveCount(0); // none in the rail itself: in its cards
  await rail.locator(".r-gname").hover();
  const card = page.locator("#actor-card.live");
  await expect(card).toBeVisible();
  const plus = card.locator("button.new-actor");
  await expect(card.locator("button.new-more")).toHaveCount(1);
  await expect(plus).toHaveAttribute("aria-label", `New actor in ${GATHERER}`);
  await plus.click();
  const menu = page.locator(".row-menu[role=menu]");
  await expect(menu).toBeVisible();
  const z = async (n: typeof menu) => Number(await n.evaluate((e) => getComputedStyle(e).zIndex));
  expect(await z(menu)).toBeGreaterThan(await z(card)); // over the card it opened from, not hidden under it
  const [box, side] = [await menu.boundingBox(), await rail.boundingBox()];
  expect(box!.x).toBeGreaterThanOrEqual(side!.x + side!.width); // beside the rail, not over it
  await expect(menu.locator("[role=menuitem] .nm")).toHaveText(["Claude Code", "Codex"]);
  await menu.getByRole("menuitem", { name: "Codex" }).click();
  // started in the directory its newest actor works in; that failing, a box asks for one, saying why
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toEqual({ gatherer: GATHERER, cwd: "/work/demo", harness: "codex" });
  const ask = page.locator(".dw-menu[role=dialog]");
  await expect(ask).toBeVisible();
  await expect(ask).toContainText(`New actor in ${GATHERER}`);
  await expect(ask.locator(".err")).toHaveText("no directory /gone");
  await expect(ask.locator("input")).toHaveValue("/work/demo"); // the one tried
  await ask.locator("input").fill("~/elsewhere");
  await ask.getByRole("button", { name: "Claude Code" }).click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toMatchObject({ gatherer: GATHERER, cwd: "~/elsewhere", harness: "claude" });
  await expect(ask).toBeVisible(); // failed again: still open, for another try
  await plus.click(); // pressed again: closed
  await expect(ask).toBeHidden();
  await expect(plus).toHaveAttribute("aria-expanded", "false");
});

test("the rail's avatars have the list's bookmark and ×, over their corners: pressed, they save or close, not show", async ({
  page,
}) => {
  // the home as the server has it, but the Claude Code actor's process run by the dashboard, so it can be closed (its
  // stream held back, so the server's own home does not replace it)
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const claude = home.gatherers
      .find((x: { name: string }) => x.name === GATHERER)
      .agents.find((a: { harness?: string }) => a.harness === "claude");
    claude.session = { session_id: "s-claude", pid: 4242, status: "idle", cwd: "/work/demo" };
    claude.chattable = true;
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  const saved: unknown[] = [],
    stopped: unknown[] = [];
  await page.route("**/api/saved", async (route) => {
    const asked = route.request().postDataJSON();
    saved.push(asked);
    // as the server answers: every actor saved
    await route.fulfill({ json: asked.saved ? { [asked.gatherer]: { [asked.channel]: "2026-10-01T00:00:00Z" } } : {} });
  });
  await page.route("**/api/stop", async (route) => {
    stopped.push(route.request().postDataJSON());
    await route.fulfill({ json: {} });
  });
  await open(page);
  await page.locator("#agents .lb-fold").click();
  const rail = page.locator("#rail");
  const claude = rail.locator(".r-actor", { hasText: CLAUDE });
  const codex = rail.locator(".r-actor", { hasText: CODEX });
  await expect(claude.locator(".close-btn")).toHaveCount(1);
  await expect(codex.locator(".close-btn")).toHaveCount(0); // no process of it the dashboard runs: none to close
  // one under the other at the tile's left, beside the avatar -- the bookmark on top: no taller for them, and shown
  // only while hovered
  const [tile, pic, bookmark, x] = await Promise.all(
    [claude, claude.locator(".r-pic"), claude.locator(".save-btn"), claude.locator(".close-btn")].map((n) =>
      n.boundingBox(),
    ),
  );
  for (const b of [bookmark!, x!]) {
    expect(b.x + b.width).toBeLessThanOrEqual(pic!.x);
    expect(b.x).toBeGreaterThanOrEqual(tile!.x - 0.5);
    expect(b.y).toBeGreaterThanOrEqual(tile!.y);
    expect(b.y + b.height).toBeLessThanOrEqual(pic!.y + pic!.height);
  }
  expect(bookmark!.y + bookmark!.height).toBeLessThanOrEqual(x!.y);
  await expect(claude.locator(".close-btn")).toHaveCSS("opacity", "0");
  await claude.hover();
  await expect(claude.locator(".close-btn")).toHaveCSS("opacity", "1");
  await claude.locator(".save-btn").click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ gatherer: GATHERER, saved: true });
  await expect(claude.locator(".save-btn.on")).toHaveCount(1); // filled -- and, the pointer away, hidden as any's
  await page.mouse.move(700, 450);
  await expect(claude.locator(".save-btn.on")).toHaveCSS("opacity", "0");
  await claude.hover(); // its card says it is saved
  await expect(page.locator("#actor-card .c-saved")).toHaveText("Saved");
  await page.mouse.move(700, 450);
  await expect(claude.locator(".r-main")).toHaveAttribute("aria-current", "false"); // pressing it did not show the actor
  await claude.hover();
  await claude.locator(".close-btn").click();
  await expect.poll(() => stopped.length).toBe(1);
  expect(stopped[0]).toEqual({ session_id: "s-claude" });
  await expect(claude.locator(".r-main")).toHaveAttribute("aria-current", "false");
});

test("a row keeps the keyboard's focus as time passes: the list is not drawn again for its clocks", async ({
  page,
}) => {
  const homed = streamHome(page);
  await page.clock.install({ time: new Date(NOW * 1000) }); // a clock that runs (open() fixes it)
  await page.goto("/");
  await expect(page.locator("#agents")).toContainText(GATHERER);
  await homed; // the stream's first home come before the clock moves on, not to a list already 95 s on
  await page.clock.fastForward(15_000); // the list as it settles after loading, drawn again once
  const claude = page.locator("#agents .agent", { hasText: "Parser fixes" });
  await claude.locator(".a-main").focus();
  await expect(claude.locator(".a-main")).toBeFocused();
  await page.clock.fastForward(95_000); // the page's 30 s redraws, three of them
  await expect(claude.locator(".a-main")).toBeFocused();
});

test("a bookmark the server refused is taken back, with no home coming to say so", async ({ page }) => {
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort()); // no home after the first: the page's own copy shown
  await page.route("**/api/saved", (route) => route.fulfill({ status: 500, json: { error: "disk full" } }));
  await open(page);
  const claude = page.locator("#agents .agent", { hasText: "Parser fixes" });
  await claude.hover();
  await claude.locator(".save-btn").click();
  await expect(page.locator("#live")).toContainText("Not saved");
  await expect(claude.locator(".save-btn.on")).toHaveCount(0);
});

test("a rail bookmark under a resting pointer stays shown, every frame, while the rail scrolled is drawn again", async ({
  page,
}) => {
  // the home's stream passed through, its latest home kept, to be sent again with an actor moved on, as a running one's is
  const seen: { home?: [string, { gatherers: { agents: { last?: number }[] }[] }]; ws?: WebSocketRoute } = {};
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    seen.ws = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const [id, name, ...data] = typeof m === "string" ? m.split("\n") : [];
      if (name === "home") seen.home = [id, JSON.parse(data.join("\n"))];
      ws.send(m);
    });
  });
  await page.setViewportSize({ width: 1300, height: 260 }); // short, so the rail scrolls
  await open(page);
  await expect.poll(() => !!seen.home).toBe(true); // the rail drawn from the stream's home before it's scrolled
  await page.locator("#agents .lb-fold").click();
  const list = page.locator("#rail .r-actors");
  await list.evaluate((n) => (n.scrollTop = 60));
  await expect.poll(() => list.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
  const tile = page.locator('#rail .r-actor:has(> .r-main[aria-current="false"])').first(); // the one shown has its buttons anyway
  const card = await tile.getAttribute("data-card");
  await tile.locator(".save-btn").hover();
  await expect(tile.locator(".save-btn")).toHaveCSS("opacity", "1");
  // its bookmark's opacity each frame for a while, the home sent again twice meanwhile
  const frames = page.evaluate(
    (card) =>
      new Promise<{ opacities: string[]; replaced: boolean }>((done) => {
        const mark = () =>
          [...document.querySelectorAll<HTMLElement>("#rail .r-actor")]
            .find((t) => t.dataset.card === card)!
            .querySelector(".save-btn")!;
        const first = mark(),
          opacities: string[] = [],
          t0 = performance.now();
        let replaced = false;
        const tick = () => {
          const b = mark();
          replaced ||= b !== first;
          opacities.push(getComputedStyle(b).opacity);
          if (performance.now() - t0 < 900) requestAnimationFrame(tick);
          else done({ opacities, replaced });
        };
        requestAnimationFrame(tick);
      }),
    card,
  );
  for (const k of [1, 2]) {
    await page.waitForTimeout(250);
    const [id, home] = seen.home!;
    const again = structuredClone(home);
    again.gatherers[0].agents[0].last = (again.gatherers[0].agents[0].last || 0) + k;
    seen.ws!.send(`${id}\nhome\n${JSON.stringify(again)}`);
  }
  const { opacities, replaced } = await frames;
  expect(replaced).toBe(false); // the rail drawn again keeps the bookmark under the pointer, so none fades in...
  expect(opacities.filter((o) => o !== "1")).toEqual([]); // ...and it never faded out
});

test("shows every actor over the whole page", async ({ page }) => {
  await open(page);
  await expect(page.locator(".side .lb-full")).toHaveCount(0); // not the list's: the top bar's, by the logo
  const full = page.locator("#top-full .lb-full");
  await full.click();
  const monitor = page.locator("#monitor");
  await expect(monitor).toBeVisible();
  await expect(monitor).toContainText("Parser fixes");
  await expect(monitor).toContainText("Spawn one subagent");
  await expect(full).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveScreenshot("list-over-page.png", { mask: masks(page) });
  await full.click(); // pressed again: the list as it was
  await expect(monitor).toBeHidden();
  await expect(page.locator("#agents")).toBeVisible();
  await expect(full).toHaveAttribute("aria-pressed", "false");
});

test("lists a saved actor with the open ones while open, and in its saved line once closed", async ({ page }) => {
  // the home as the server has it, but both actors saved for later and the Codex one closed (its stream held back, so
  // the server's own home, with neither, does not replace it)
  let codexChannel = "";
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const g = home.gatherers.find((x: { name: string }) => x.name === GATHERER);
    const codex = g.agents.find((a: { harness?: string }) => a.harness === "codex");
    codex.status = "closed";
    codexChannel = codex.channel;
    home.saved = {
      [GATHERER]: Object.fromEntries(g.agents.map((a: { channel: string }) => [a.channel, "2026-10-01T00:00:00Z"])),
    };
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await open(page);
  const claude = page.locator("#agents .agent", { hasText: CLAUDE });
  await expect(claude).toBeVisible();
  await expect(claude.locator(".save-btn.on")).toHaveCount(1); // still saved: its bookmark filled
  // the open one listed with the open ones; the closed one in the saved line, under them, apart from the closed
  const saved = page.locator("#agents .fold-line", { hasText: "saved" });
  await expect(saved).toHaveText("▸ 1 saved");
  await expect(page.locator("#agents .fold-line", { hasText: "closed" })).toHaveCount(0);
  const order = await page
    .locator("#agents .gatherer")
    .first()
    .evaluate((box) =>
      [...box.querySelectorAll(".agent, .fold-line")].map((n) =>
        n.matches(".fold-line") ? `[${n.textContent}]` : n.getAttribute("data-key") || "",
      ),
    );
  const claudeKey = await claude.getAttribute("data-key");
  expect(order.indexOf(claudeKey || "?"), order.join(" | ")).toBeLessThan(order.indexOf("[▸ 1 saved]"));
  expect(codexChannel).not.toBe("");
  await saved.click();
  await expect(saved).toHaveText("▾ 1 saved");
  await expect(page.locator(`#agents .agent[data-key="${GATHERER}/${codexChannel}"]`)).toBeVisible();
});

test("keeps each actor in its place whatever its status: the newest first, under no heading", async ({ page }) => {
  // the home as the server has it, but its older actor at work (its stream held back, so the server's own home does
  // not replace it): it stays under the newer one, as it would at rest
  let order: string[] = [];
  await page.route("**/api/home", async (route) => {
    const home = await (await route.fetch()).json();
    const g = home.gatherers.find((x: { name: string }) => x.name === GATHERER);
    const agents = [...g.agents].sort(
      (x: { created?: number }, y: { created?: number }) => (y.created || 0) - (x.created || 0),
    );
    agents[agents.length - 1].status = "running";
    order = agents.map((a: { channel: string }) => `${GATHERER}/${a.channel}`);
    await route.fulfill({ json: home });
  });
  await streamsAsRequests(page);
  await page.route("**/api/stream*", (route) => route.abort());
  await open(page);
  await expect(page.locator("#agents .agent .dot.running")).toHaveCount(1);
  const shown = await page.locator("#agents .agent").evaluateAll((ns) => ns.map((n) => n.getAttribute("data-key")));
  expect(shown).toEqual(order);
  await expect(page.locator("#agents .agent-group")).toHaveCount(0); // no "Running", no "Idle"
});
