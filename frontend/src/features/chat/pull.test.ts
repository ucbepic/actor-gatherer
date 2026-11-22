// Pulling earlier turns in: only a pull up past the top, a while after the conversation got there, and of enough; by
// the wheel, a finger, or a key with the focus in the conversation. And the turn the reader looked at, or a turn picked,
// held where it is to be as react-virtuoso draws the turns about it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  drawn,
  drawnAt,
  holdTurn,
  keepHeld,
  listenForPulls,
  PULL_PX,
  PULL_WAIT_MS,
  pullEarlier,
  reachedTop,
} from "./pull";
import { foldsOf } from "./store";

const folds = foldsOf("g\u0000a");

let talk: HTMLElement, redraws: number, unsubscribe: () => void;

beforeAll(() => listenForPulls());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  document.body.innerHTML =
    '<section class="pane"><div class="chat-frame files" data-sig="g%00a"><div class="fl-talk"><button>a turn</button><input></div></div></section>';
  talk = document.querySelector(".fl-talk")!;
  folds.getState().forFiles({});
  folds.getState().setFirst(10);
  redraws = 0; // the turns drawn again: the first one drawn changed
  unsubscribe = folds.subscribe((st, was) => {
    if (st.first !== was.first) redraws++;
  });
  pullEarlier(talk, 0); // at the top only now
});
afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
});
afterAll(() => {
  drawn.clear();
});

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("pullEarlier", () => {
  it("draws earlier turns for a pull up past the top, a while after it got there", () => {
    pullEarlier(talk, 200);
    expect(folds.getState().first).toBe(10); // too soon: what is drawn ends there
    later(PULL_WAIT_MS);
    pullEarlier(talk, PULL_PX - 1);
    expect(folds.getState().first).toBe(10); // a jolt
    pullEarlier(talk, 1);
    expect(folds.getState().first).toBe(5);
    expect(redraws).toBe(1);
    // and again: a while after the last
    pullEarlier(talk, 100);
    later(PULL_WAIT_MS);
    pullEarlier(talk, 100);
    expect(folds.getState().first).toBe(0);
  });

  it("does nothing scrolled down from the top, or with every turn drawn", () => {
    later(PULL_WAIT_MS);
    talk.scrollTop = 40;
    pullEarlier(talk, 500);
    talk.scrollTop = 0;
    pullEarlier(talk, 500); // at the top again only now
    expect(folds.getState().first).toBe(10);
    folds.getState().setFirst(0);
    redraws = 0; // every turn drawn: no pull draws more
    later(PULL_WAIT_MS);
    pullEarlier(talk, 500);
    expect(redraws).toBe(0);
  });

  it("hears the wheel, and ↑, Page Up or Home with the focus in the conversation, not in a box", () => {
    later(PULL_WAIT_MS);
    talk.dispatchEvent(new WheelEvent("wheel", { deltaY: -3, deltaMode: 1, bubbles: true })); // lines: 60px
    expect(folds.getState().first).toBe(5);
    talk.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    later(PULL_WAIT_MS);
    talk.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(folds.getState().first).toBe(5);
    talk.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    expect(folds.getState().first).toBe(0);
  });
});

describe("reachedTop", () => {
  it("counts the wait from when the conversation got to its top, as react-virtuoso tells it", () => {
    reachedTop(false);
    reachedTop(true);
    later(PULL_WAIT_MS - 1);
    pullEarlier(talk, 100);
    expect(folds.getState().first).toBe(10); // too soon
    reachedTop(true); // told again: still from when it got there
    later(1);
    pullEarlier(talk, 100);
    expect(folds.getState().first).toBe(5);
  });
});

describe("a turn held", () => {
  // jsdom lays nothing out: the box at 100px from the window's top, each turn where `at` says in what it holds
  const at = new Map<number, number>();
  const turnAt = (n: number, y: number) => {
    let t = document.getElementById(`fl-turn-${n}`);
    if (!t) {
      t = Object.assign(document.createElement("div"), { id: `fl-turn-${n}` });
      talk.append(t);
      const box = t;
      box.getBoundingClientRect = () => ({ top: 100 + at.get(n)! - talk.scrollTop }) as DOMRect;
    }
    at.set(n, y);
  };
  beforeEach(() => {
    at.clear();
    talk.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    talk.scrollTop = 0;
  });

  it("puts the turn first drawn back where it was as the turns pulled in are drawn above it, in that draw only", async () => {
    turnAt(10, 30);
    later(PULL_WAIT_MS);
    pullEarlier(talk, 100);
    expect(folds.getState().first).toBe(5);
    // Virtuoso puts them before it by the height it guesses (40px each), then draws them at theirs (60px)
    talk.scrollTop = 200;
    turnAt(10, 330);
    drawnAt(12); // one below it: nothing yet
    expect(talk.scrollTop).toBe(200);
    drawnAt(5);
    expect(talk.scrollTop).toBe(300); // turn 10 at 30px again
    turnAt(10, 305); // the count above them gone, in the same draw
    keepHeld();
    expect(talk.scrollTop).toBe(275);
    await Promise.resolve(); // the draw over: let go of
    turnAt(10, 405);
    drawnAt(4);
    keepHeld();
    expect(talk.scrollTop).toBe(275);
  });

  it("puts a turn picked at the top once it is drawn, not before; and only for a moment", async () => {
    holdTurn(talk, 40, 0);
    keepHeld(); // not on the page yet
    expect(talk.scrollTop).toBe(0);
    turnAt(40, 2400);
    talk.scrollTop = 2390; // where Virtuoso reckoned it
    drawnAt(40);
    expect(talk.scrollTop).toBe(2400);
    await Promise.resolve();
    // held again, but drawn only after the hold is over: left where it is
    holdTurn(talk, 41, 0);
    const now = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(now + 5000);
    turnAt(41, 2500);
    drawnAt(41);
    expect(talk.scrollTop).toBe(2400);
    vi.restoreAllMocks();
  });
});
