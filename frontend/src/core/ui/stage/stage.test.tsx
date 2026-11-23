// The actor's stage (model.ts, Stage.tsx): its picture, its words' ink, a reaction seen once, its action winding down; what
// it shows as a call runs, ends and its tool is put away; and its elements kept on the page while they show the same.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { failingOf } from "../../api/testing";
import { AtRest, AtWork, Buddy, Greeting } from "./Stage";
import {
  bareAvatar,
  helloOf,
  inkOf,
  reaction,
  REACT_MS,
  restDelay,
  stageOf,
  stageRest,
  windDown,
  wound,
} from "./model";

afterEach(cleanup);

const fox = { channel: "c-fox", avatar: "animal/fox", avatar_hue: "red", avatar_motion: "bob sparkle" };

describe("the actor's look", () => {
  it("has its picture without its circle, from the server, or from a snapshot's", () => {
    expect(bareAvatar(fox)).toBe("/avatars/animal/fox.svg?bare=1");
    expect(bareAvatar({ avatar: null })).toBeNull();
    const w = window as unknown as { AG_SNAPSHOT?: unknown };
    w.AG_SNAPSHOT = { avatars: { "animal/fox": '<svg><circle cx="32" cy="32" r="32" fill="#fdd"/><path/></svg>' } };
    try {
      expect(decodeURIComponent(bareAvatar(fox)!)).toBe("data:image/svg+xml,<svg><path/></svg>");
      expect(bareAvatar({ avatar: "animal/owl" })).toBeNull(); // not in it: none
    } finally {
      delete w.AG_SNAPSHOT;
    }
  });

  it("says its words in its hue's ink", () => {
    expect(inkOf(fox)).toBe("light-dark(#b91c1c, #f57474)");
    expect(inkOf({ avatar_hue: "nope" })).toBeNull();
  });
});

describe("what the stage reacts to", () => {
  it("reacts once to a change it saw, from when it saw it; to one seen late only if it was lately", () => {
    const t = 1000;
    expect(reaction("w call", "c1", Date.now() / 1000 - 100, t)).toBeNull(); // long ago, first seen: no show
    expect(reaction("x call", null, 0, t)).toBeNull(); // nothing ended
    expect(reaction("x call", "c2", 0, t)).toBe(0); // seen to change: from now
    expect(reaction("x call", "c2", 0, t + 500)).toBe(500);
    expect(reaction("x call", "c2", 0, t + REACT_MS)).toBeNull(); // over
    expect(reaction("y call", "c1", Date.now() / 1000 - 2, t)).toBeGreaterThanOrEqual(1990); // two seconds ago
    expect(restDelay(null, 1)).toBe("-60000ms"); // none: grown long ago
  });

  it("winds its action down evenly to a stop", () => {
    expect(wound(100, 100)).toBe(100);
    expect(wound(100, 800)).toBe(100 + 700 - (700 * 700) / 2800);
    expect(wound(100, 100 + 5000)).toBe(100 + 1400 - 700); // stopped
  });

  it("plays its action from the start where the page has no Web Animations API (jsdom has none)", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.append(svg);
    expect("getAnimations" in svg).toBe(false);
    expect(() => windDown(svg, 0, 0)).not.toThrow();
    svg.remove();
  });
});

describe("what the stage shows", () => {
  it("acts out the call under way, puts its tool away once it ends, and thinks", () => {
    const a = { ...fox, channel: "c-act" };
    stageRest(a.channel); // a new turn: it arrives
    const reading = stageOf(a, { doing: "read" }, "/f.svg", 10_000);
    expect(reading.html).toContain('class="stage s-read arriving"');
    expect(reading.html).toContain('<g class="me m-bob"><image href="/f.svg"');
    expect(reading.html).toContain('<span class="buddy f-sparkle"'); // its effect round it
    expect(JSON.parse(reading.sig)).toEqual(["stage s-read", "read", "/f.svg", "sparkle", "red"]);
    expect(stageOf(a, { doing: "read" }, "/f.svg", 10_100).sig).toBe(reading.sig); // the same: kept
    // the call over: its tool put away a moment after, the action winding down meanwhile
    const after = stageOf(a, { doing: null, last: "read" }, "/f.svg", 11_000);
    expect(after.html).toContain('class="stage s-read musing putting"');
    expect([after.musing, after.left]).toEqual([true, 900 + 650]);
    const thinking = stageOf(a, { doing: null, last: "read" }, "/f.svg", 13_000);
    expect(JSON.parse(thinking.sig)[0]).toBe("stage s-think musing");
  });

  it("waves hello, its hand in its hue, on the page's clock", () => {
    const h = helloOf(fox, "/f.svg", 1234.4);
    expect(h.html).toContain('class="stage s-hello"');
    expect(h.html).toContain("--t: -1234ms; --dot: #ef4444");
    expect(JSON.parse(h.sig)).toEqual(["hello", "/f.svg", "red"]);
  });
});

describe("the stage drawn", () => {
  it("keeps the done avatar while it shows the same turn, and makes it anew for the next", () => {
    const { container, rerender } = render(<AtRest info={fox} turn={7} />);
    const done = container.querySelector(".done")!;
    expect(done.getAttribute("data-sig")).toBe('["/avatars/animal/fox.svg?bare=1",7]');
    expect(done.querySelector(".ok svg path")!.getAttribute("d")).toBe("M2.2 5.2L4.2 7.1L7.9 3.1");
    rerender(<AtRest info={fox} turn={7} />);
    expect(container.querySelector(".done")).toBe(done);
    rerender(<AtRest info={fox} turn={8} />);
    expect(container.querySelector(".done")).not.toBe(done);
  });

  it("keeps the stage's element while it shows the same; no avatar, the turning glyph; simple, its one motion", () => {
    const a = { ...fox, channel: "c-drawn" };
    const { container, rerender } = render(<AtWork info={a} work={{ doing: "edit" }} mode="acting" />);
    const box = container.querySelector(".stage-box")!;
    expect(box.querySelector("svg.stage.s-edit")).not.toBeNull();
    act(() => rerender(<AtWork info={a} work={{ doing: "edit" }} mode="acting" />));
    expect(container.querySelector(".stage-box")).toBe(box);
    act(() => rerender(<AtWork info={a} work={{ doing: "search" }} mode="acting" />));
    expect(container.querySelector(".stage-box")).not.toBe(box);
    rerender(<AtWork info={{ channel: "c-none" }} work={null} mode="acting" />);
    expect(container.innerHTML).toBe('<span class="spin" aria-hidden="true"></span>');
    rerender(<AtWork info={{ ...a, failing: failingOf({ at: 1 }) }} work={null} mode="simple" />);
    expect(container.querySelector(".buddy")!.className).toBe("buddy m-bob f-sparkle still");
  });

  it("waves hello with an avatar, or nothing without one", () => {
    const { container, rerender } = render(<Greeting info={fox} mode="acting" />);
    expect(container.querySelector(".stage-box > svg.s-hello")).not.toBeNull();
    rerender(<Greeting info={{ channel: "c-none" }} mode="acting" />);
    expect(container.innerHTML).toBe("");
    rerender(<Buddy info={fox} />);
    expect(container.querySelectorAll(".buddy > i").length).toBe(3);
  });
});
