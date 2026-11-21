// THE TOP BAR'S COUNTS OF A COORDINATOR AGENT (features/list/modes.ts's drawTotals): counted by what it does -- waiting for the
// reader, stopped on an error, at work, finished and not yet seen -- as any actor is, but not idle: every group has one,
// at rest most of the time.
import { expect, homeAs, test } from "./test";
import { CLAUDE, CODEX, GATHERER, NOW, open } from "./home";

type Agent = { channel: string; harness?: string; [k: string]: unknown };
type Group = { name: string; agents: Agent[]; [k: string]: unknown };

test("a coordinator agent counted in the top bar waiting, failed, at work and finished, not idle", async ({ page }) => {
  let codex: Record<string, unknown> = {};
  const change = (home: Record<string, unknown>) => {
    const demo = (home.gatherers as Group[]).find((x) => x.name === GATHERER)!;
    Object.assign(
      demo.agents.find((a) => a.harness === "codex")!,
      codex,
    );
    return home;
  };
  await page.route("**/api/home", async (route) => route.fulfill({ json: change(await (await route.fetch()).json()) }));
  const homes = await homeAs(page, change);
  const totals = page.locator("#top-totals");
  // a state's number, 0 with no chip (read without waiting: the chips are drawn again on every change)
  const count = async (cls: string) => Number((await totals.locator(`.count.${cls}`).allInnerTexts())[0] ?? 0);
  // idle: named in the counts' tooltip, a chip only while nothing else is counted
  const idleOf = async () => Number(((await totals.getAttribute("title")) ?? "").match(/(\d+) idle/)?.[1] ?? 0);
  const show = async (to: Record<string, unknown>) => {
    codex = to;
    homes.again();
    await expect(page.locator("#agents .agent", { hasText: CODEX })).toHaveClass(
      to.role ? /coordinator/ : /^(?!.*coordinator)/,
    );
  };
  await open(page);
  await expect.poll(homes.sent).toBe(true);
  // idle, an actor as any other: counted; its group's coordinator agent: not
  await show({ status: "idle", last: 0 });
  await expect.poll(() => idleOf()).toBeGreaterThan(0);
  const idle = await idleOf();
  await show({ status: "idle", last: 0, role: "coordinator", avatar: "roles/manager" });
  await expect.poll(() => idleOf()).toBe(idle - 1);
  // what it does otherwise: counted, as any actor's
  for (const [status, cls, said] of [
    ["asking", "asking", "waiting for you"],
    ["error", "error", "stopped on an error"],
    ["running", "running", "running"],
  ] as const) {
    const before = await count(cls);
    await show({ status, last: 0, role: "coordinator", avatar: "roles/manager" });
    await expect.poll(() => count(cls)).toBe(before + 1);
    await expect(totals).toHaveAttribute("aria-label", new RegExp(said));
    await show({ status: "idle", last: 0, role: "coordinator", avatar: "roles/manager" });
    await expect.poll(() => count(cls)).toBe(before);
  }
  // done since the reader looked at it, out of sight (the other actor shown): finished, counted
  const claude = page.locator("#agents .agent", { hasText: CLAUDE });
  await claude.click();
  await expect(claude.locator(".a-main")).toHaveAttribute("aria-current", "true");
  const finished = await count("finished");
  await show({ status: "idle", last: NOW + 60, role: "coordinator", avatar: "roles/manager" });
  await expect.poll(() => count("finished")).toBe(finished + 1);
  await expect.poll(() => idleOf()).toBe(idle - 1);
  await expect(totals.locator(".count.idle")).toHaveCount(0); // something else counted: no idle chip
});
