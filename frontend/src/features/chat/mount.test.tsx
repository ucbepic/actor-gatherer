// The conversations kept drawn (mount.tsx): the actors shown lately, an older one unmounted once it is off the page.
import { describe, expect, it } from "vitest";
import { KEPT_TALKS, talksKept } from "./mount";
import { testPage, turn } from "./testing";

describe("conversations kept drawn", () => {
  it("keeps the latest few, letting go of older ones off the page", () => {
    const first = testPage([turn(0)]).page;
    first.draw();
    const node = first.frame!;
    expect(node.textContent).not.toBe("");
    for (let i = 0; i < KEPT_TALKS + 3; i++) testPage([turn(0)]).page.draw(); // each another actor, shown in its place
    expect(talksKept()).toBe(KEPT_TALKS);
    expect(node.isConnected).toBe(false);
    expect(node.textContent).toBe(""); // its root unmounted
  });

  it("keeps the one on the page however many come after", () => {
    const shown = testPage([turn(0)]);
    shown.page.draw();
    const node = shown.page.frame!;
    const aside = document.body.appendChild(document.createElement("div"));
    aside.append(node); // still on the page, moved out of #main
    for (let i = 0; i < KEPT_TALKS + 2; i++) testPage([turn(0)]).page.draw();
    expect(node.textContent).not.toBe("");
    aside.remove();
  });
});
