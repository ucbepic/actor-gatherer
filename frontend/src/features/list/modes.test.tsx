// The list's other shapes in React, drawn by their mount from their view-models with a host standing in for the page:
// the monitor's columns and cards (a card drawn again only when what it shows changes), the rail's tiles (the same
// elements from one draw to the next), the top bar's counts.
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMonitor } from "./monitor-model";
import type { MonitorHost } from "./Monitor";
import { drawMonitor, drawRail, drawTotals, forget } from "./modes-mount";
import { buildRail } from "./rail-model";
import type { RailHost } from "./Rail";
import { actor, ctxOf, gatherer, viewOf } from "./testing";

const span = (cls: string) => Object.assign(document.createElement("span"), { className: cls });
/** A host with every call recorded (`calls`), building plain nodes where the page builds its own. */
function hostOf<T>(more: Record<string, unknown>): T {
  const calls: Record<string, ReturnType<typeof vi.fn>> = {};
  const base: Record<string, unknown> = {
    snapshot: false,
    hovers: () => true,
    besideKey: "⌘",
    harnessName: () => "Harness",
    ago: () => "1m ago",
    avatarSrc: (name: string) => (name ? `/avatars/${name}.svg` : null),
    harnessLogo: () => span("logo"),
    appFace: () => span("logo app-face"),
    appMark: () => span("t-app"),
    icon: () => span("icon"),
    saveIcon: () => span("bookmark"),
    hideIcon: () => span("hide"),
    closeIcon: () => span("x"),
    ...more,
  };
  return new Proxy(base, {
    get: (t, k: string) => (k === "calls" ? calls : k in t ? t[k] : (calls[k] ??= vi.fn())),
  }) as T;
}
const calls = (host: unknown) => (host as { calls: Record<string, ReturnType<typeof vi.fn>> }).calls;

let box: HTMLElement;
afterEach(() => {
  forget(box);
  box.remove();
});
const boxOf = () => {
  box = document.createElement("div");
  document.body.append(box);
  return box;
};

describe("the monitor", () => {
  const a1 = actor("g", "a1", { status: "running", name: { text: "Parser" } }),
    a2 = actor("g", "a2", { status: "closed", last_user_message: "fix it" });
  const home = { gatherers: [gatherer("g", [a1, a2])] };
  const mv = { folded: new Set(["Saved", "Closed"]), got: new Map(), old: false, avatarMode: "acting" };

  it("draws a column for each group with actors, a card for each, and draws a card again only when it changed", () => {
    const host = hostOf<MonitorHost>({
      ctx: ctxOf(home),
      folderIcon: "M0 0",
      fileKinds: {},
      atWork: () => span("stage"),
    });
    drawMonitor(boxOf(), buildMonitor(ctxOf(home), viewOf(), mv), host);
    expect(box.querySelector("h2")?.textContent).toBe("2 actors");
    expect([...box.querySelectorAll(".m-col")].map((c) => [c.getAttribute("aria-label"), c.className])).toEqual([
      ["Running", "m-col"],
      ["Closed", "m-col folded"],
    ]);
    const card = box.querySelector<HTMLElement>(".m-card")!;
    expect(card.dataset.key).toBe("g\u0000a1");
    expect(card.querySelector(".c-pic.acting .stage")).not.toBeNull();
    expect(card.querySelector(".c-wait")?.textContent).toBe("…"); // nothing read yet
    expect(calls(host).observe).toHaveBeenCalledWith(card);
    // the same again: the card untouched; read since, drawn again in place
    const stage = card.querySelector(".stage");
    drawMonitor(box, buildMonitor(ctxOf(home), viewOf(), mv), host);
    expect(box.querySelector(".stage")).toBe(stage);
    const got = new Map([["g\u0000a1", { sig: "x", data: { now: { kind: "call", text: "ls" }, calls: 3 } }]]);
    drawMonitor(box, buildMonitor(ctxOf(home), viewOf(), { ...mv, got }), host);
    expect(box.querySelector(".m-card")).toBe(card);
    expect(card.querySelector(".c-now.run")?.textContent).toContain("Running:ls");
    expect(card.querySelector(".c-foot")?.textContent).toBe("3 calls");
    fireEvent.click(box.querySelector(".m-col.folded .m-head")!);
    expect(calls(host).foldSection).toHaveBeenCalledWith("Closed");
  });
});

describe("the rail", () => {
  const a1 = actor("g", "a1", { name: { text: "Parser" } }),
    a2 = actor("g", "a2", { last_user_message: "fix it", status: "running" });
  const home = { gatherers: [gatherer("g", [a1, a2])] };
  const rv = {
    show: { folders: false, saved: false, closed: false },
    busyFolded: new Set<string>(),
    at: null,
    dragging: null,
  };

  it("draws a gatherer's name over its tiles, the same tiles from one draw to the next, their corners made anew", () => {
    const host = hostOf<RailHost>({ ctx: ctxOf(home) });
    drawRail(boxOf(), buildRail(ctxOf(home), viewOf(), rv), host);
    expect(box.querySelector(".r-gname .nm")?.textContent).toBe("g");
    const tiles = [...box.querySelectorAll(".r-actor")];
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual(["Parser, in g: Idle", "fix it, in g: Running"]);
    const bookmark = tiles[0].querySelector(".save-btn");
    drawRail(box, buildRail(ctxOf(home), viewOf({ focused: ["g", "a1"] }), rv), host);
    expect(box.querySelector(".r-actor")).toBe(tiles[0]);
    expect(tiles[0].getAttribute("aria-current")).toBe("true");
    expect(tiles[0].querySelector(".save-btn")).not.toBe(bookmark);
    fireEvent.click(tiles[1], { shiftKey: true });
    expect(calls(host).togglePick).toHaveBeenCalledWith(home.gatherers[0], a2);
    fireEvent.click(box.querySelector(".r-gname")!);
    expect(calls(host).toggleGatherer).toHaveBeenCalledWith("g");
    fireEvent.click(box.querySelector('input[data-show="closed"]')!);
    expect(calls(host).setRailShow).toHaveBeenCalledWith("closed", true);
  });
});

describe("the top bar's counts", () => {
  it("draws a count for each state an actor is in, idle only when nothing else is, and names them all", () => {
    const t = { asking: 1, error: 0, notified: 0, running: 2, background: 0, finished: 0, idle: 3 };
    drawTotals(boxOf(), t);
    expect([...box.querySelectorAll(".count")].map((c) => [c.className, c.textContent])).toEqual([
      ["count asking", "1"],
      ["count running", "2"],
    ]);
    expect(box.title).toBe("1 waiting for you · 2 running · 3 idle");
    drawTotals(box, { ...t, asking: 0, running: 0 });
    expect([...box.querySelectorAll(".count")].map((c) => c.className)).toEqual(["count idle"]);
  });
});
