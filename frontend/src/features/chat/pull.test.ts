// Pulling earlier turns in: only a pull up past the top, a while after the conversation got there, and of enough; by
// the wheel, a finger, or a key with the focus in the conversation.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drawn, listenForPulls, PULL_PX, PULL_WAIT_MS, pullEarlier } from "./pull";
import { useTurns } from "./store";

let talk: HTMLElement, redraws: number, unsubscribe: () => void;

beforeAll(() => listenForPulls());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  document.body.innerHTML = '<div id="main"><div class="fl-talk"><button>a turn</button><input></div></div>';
  talk = document.querySelector(".fl-talk")!;
  useTurns.getState().forFiles({});
  useTurns.getState().setFirst(10);
  redraws = 0; // the turns drawn again: the first one drawn changed
  unsubscribe = useTurns.subscribe((st, was) => {
    if (st.first !== was.first) redraws++;
  });
  pullEarlier(talk, 0); // at the top only now
});
afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
});
afterAll(() => {
  drawn.feed = null;
});

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("pullEarlier", () => {
  it("draws earlier turns for a pull up past the top, a while after it got there", () => {
    pullEarlier(talk, 200);
    expect(useTurns.getState().first).toBe(10); // too soon: what is drawn ends there
    later(PULL_WAIT_MS);
    pullEarlier(talk, PULL_PX - 1);
    expect(useTurns.getState().first).toBe(10); // a jolt
    pullEarlier(talk, 1);
    expect(useTurns.getState().first).toBe(5);
    expect(redraws).toBe(1);
    // and again: a while after the last
    pullEarlier(talk, 100);
    later(PULL_WAIT_MS);
    pullEarlier(talk, 100);
    expect(useTurns.getState().first).toBe(0);
  });

  it("does nothing scrolled down from the top, or with every turn drawn", () => {
    later(PULL_WAIT_MS);
    talk.scrollTop = 40;
    pullEarlier(talk, 500);
    talk.scrollTop = 0;
    pullEarlier(talk, 500); // at the top again only now
    expect(useTurns.getState().first).toBe(10);
    useTurns.getState().setFirst(0);
    redraws = 0; // every turn drawn: no pull draws more
    later(PULL_WAIT_MS);
    pullEarlier(talk, 500);
    expect(redraws).toBe(0);
  });

  it("hears the wheel, and ↑, Page Up or Home with the focus in the conversation, not in a box", () => {
    later(PULL_WAIT_MS);
    talk.dispatchEvent(new WheelEvent("wheel", { deltaY: -3, deltaMode: 1, bubbles: true })); // lines: 60px
    expect(useTurns.getState().first).toBe(5);
    talk.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    later(PULL_WAIT_MS);
    talk.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(useTurns.getState().first).toBe(5);
    talk.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    expect(useTurns.getState().first).toBe(0);
  });
});
