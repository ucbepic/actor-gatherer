// The look at where the native pages go (native.ts): one loop of looks, however it is asked for -- each frame, and
// the 250 ms interval that keeps it going while frames stop -- and what covers a page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppPane } from "./host";

let waiting: Map<number, FrameRequestCallback>;
let next: number;
let looks: number;
let placed: unknown[];

/** Every frame asked for so far, run once. */
function frame(): void {
  const due = [...waiting.values()];
  waiting.clear();
  for (const cb of due) cb(0);
}

/** A panel's frame, all of it showing, with a native page asked kept over all of it. */
function pane(): AppPane {
  const f = {
    isConnected: true,
    checkVisibility: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    clientLeft: 0,
    clientTop: 0,
    clientWidth: 400,
    clientHeight: 300,
  };
  return {
    native: { target: "t1", x: 0, y: 0, w: 400, h: 300, covered: false },
    frame: f,
    app: { name: "browser" },
    instance: { id: "i1" },
    still: () => {},
  } as unknown as AppPane;
}

describe("native pages' look", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    vi.resetModules();
    waiting = new Map();
    next = 0;
    looks = 0;
    placed = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      waiting.set(++next, cb);
      return next;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => waiting.delete(id));
    (window as unknown as { agApp: unknown }).agApp = { native: true, place: (s: unknown) => placed.push(s) };
    document.elementFromPoint = () => {
      looks++;
      return null;
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as unknown as { agApp?: unknown }).agApp;
  });

  it("keeps one frame asked for, however long the interval runs beside the frames", async () => {
    const { nativePanes, nativeSoon } = await import("./native");
    nativePanes.add(pane());
    nativeSoon();
    for (let i = 0; i < 40; i++) {
      // ten seconds: the interval every 250 ms, a frame between
      vi.advanceTimersByTime(250);
      frame();
      expect(waiting.size).toBe(1);
    }
    looks = 0;
    frame();
    expect(looks).toBe(25); // one look: its 5 x 5 points, once
    expect(placed.length).toBe(1); // told the app once: nothing moved since
  });

  it("goes on by the interval alone while no frame comes, still one frame asked for", async () => {
    const { nativePanes, nativeSoon } = await import("./native");
    nativePanes.add(pane());
    nativeSoon();
    looks = 0;
    vi.advanceTimersByTime(250 * 8); // the window hidden: no frames, the interval's looks only
    expect(looks).toBe(8 * 25);
    expect(waiting.size).toBe(1);
  });

  it("stops once no pane has a native page", async () => {
    const { nativePanes, nativeSoon } = await import("./native");
    nativePanes.add(pane());
    nativeSoon();
    vi.advanceTimersByTime(1000);
    nativePanes.clear();
    frame();
    expect(waiting.size).toBe(0);
  });

  it("covers a page with a card floating over it, which no point's look finds: the pointer passing through it", async () => {
    const { nativePanes, nativeSoon } = await import("./native");
    const card = Object.assign(document.createElement("div"), { className: "floats" });
    let showing = true;
    card.checkVisibility = () => showing;
    // over the page's corner only, between the grid's points (elementFromPoint finds nothing anywhere here)
    card.getBoundingClientRect = () => ({ left: 380, top: 280, right: 680, bottom: 400 }) as DOMRect;
    document.body.append(card);
    const covered = () => (placed.at(-1) as { covered: boolean }[])[0].covered;
    try {
      nativePanes.add(pane());
      nativeSoon();
      frame();
      expect(covered()).toBe(true);
      showing = false; // the card put away
      frame();
      expect(covered()).toBe(false);
    } finally {
      card.remove();
    }
  });
});
