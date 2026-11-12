// A user's message in its bubble: a `!` command and its output, a command typed as /name, a message between actors in
// its band (folded to its first lines, its toggle), a watch's news, an app's own message, a message the actor sent.
import { act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadVendored } from "../../core/ui/testing";
import { ACTOR, AT, testPage, turn } from "./testing";
import type { Actor } from "./types";

const HELPER: Actor = { channel: "abc12345-6789", avatar: "animal/owl", name: { text: "Fixer" } };
const COORDINATOR: Actor = { channel: "zz-1", role: "coordinator", avatar: null };

beforeAll(() => loadVendored());
afterEach(() => document.body.replaceChildren());

/** The page with one turn whose message is `text`, the actors of its gatherer `agents`. */
function drawn(text: string, over: Parameters<typeof turn>[1] = {}, agents: Actor[] = [ACTOR]) {
  const t = page(text, over, agents);
  return { ...t, node: t.page.draw() };
}
function page(text: string, over: Parameters<typeof turn>[1], agents: Actor[]) {
  return testPage([turn(0, { text, ...over })], {
    home: { home: "/h", now: AT, gatherers: [{ name: "g", agents }], harness_info: {} },
  });
}

describe("Bubble", () => {
  it("draws a `!` command in a bash bubble, what it printed under it", () => {
    const { node } = drawn("! echo hi", { kind: "user_command", output: "hi\n" });
    const bash = node.querySelector(".fl-head > .fl-bash")!;
    expect(bash.firstElementChild!.className).toBe("fl-user bash");
    const words = bash.querySelector(".tx.bang")!;
    expect(words.querySelector(".bash-mark")!.textContent).toBe("!");
    expect(words.querySelector(".sh-t")!.textContent).toBe("echo hi");
    expect(bash.querySelector("pre.fl-bash-out")!.textContent).toBe("hi\n");
    expect(drawn("!true", { output: "" }).node.querySelector("pre.fl-bash-out.none")!.textContent).toBe("no output");
    // not run yet: the bubble alone
    expect(drawn("! ls").node.querySelector(".fl-bash")).toBeNull();
  });

  it("draws a command typed as /name in the terminal's type, any other message as written", () => {
    expect(drawn("/greet Bob", { kind: "user_command" }).node.querySelector(".fl-user > .tx")!.className).toBe(
      "tx bang",
    );
    const plain = drawn("<b>hi</b>").node.querySelector(".fl-user > .tx")!;
    expect(plain.className).toBe("tx");
    expect(plain.textContent).toBe("<b>hi</b>");
  });

  it("draws a message from the gatherer agent in its band, with its face and name, folded to its lines", () => {
    const text = "Message from the gatherer agent:\n\nRun the tests.";
    const t = page(text, {}, [ACTOR, COORDINATOR]);
    t.host.envelopes[text] = { from: "coordinator", id: null, name: null, text: "Run the tests." };
    const node = t.page.draw();
    const band = node.querySelector(".fl-head > .fl-crew")!;
    expect(band.className).toBe("fl-crew crew-fold");
    const bubble = band.querySelector(":scope > .fl-user")!;
    expect(bubble.className).toBe("fl-user crew");
    expect(bubble.querySelector(".crew-face")!.getAttribute("src")).toBe("/avatars/roles/manager.svg");
    expect(bubble.querySelector(".crew-from")!.textContent).toBe("Coordinator agent");
    expect(bubble.querySelector(".crew-text")!.textContent).toBe("Run the tests.");
    const more = band.querySelector<HTMLButtonElement>(":scope > .crew-more")!;
    expect(more.textContent).toBe("Show all");
    act(() => more.click());
    expect(band.className).toBe("fl-crew crew-fold long open");
    expect(more.textContent).toBe("Show less");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    // kept so across draws
    t.page.draw();
    expect(node.querySelector(".fl-crew")!.className).toBe("fl-crew crew-fold long open");
  });

  it("names a message from another actor by the actor, and a watch's news quietly", () => {
    const text = "Message from actor abc12345-6789:\n\nDone with the parser.";
    const t = page(text, {}, [ACTOR, HELPER]);
    t.host.envelopes[text] = { from: "actor", id: "abc12345-6789", name: null, text: "Done with the parser." };
    const news = "Update (watch 3): actor abc12345-6789 is done: its turn is over.";
    t.host.envelopes[news] = { from: "update", id: "abc12345-6789", name: null, how: "its turn is over", text: "" };
    t.page.feed.data.turns.push(turn(1, { text: news }));
    t.page.feed.data.turn = 1;
    const node = t.page.draw();
    const from = node.querySelector("#fl-turn-0 .fl-crew .fl-user")!;
    expect(from.querySelector(".crew-from")!.textContent).toBe("Fixer");
    expect(from.querySelector(".crew-face")!.getAttribute("src")).toBe("/avatars/animal/owl.svg");
    // news with no words after: no band, a quiet bubble
    const quiet = node.querySelector("#fl-turn-1 .fl-head > .fl-user")!;
    expect(quiet.className).toBe("fl-user crew update");
    expect(quiet.querySelector(".crew-from")!.textContent).toBe("Fixer is done · its turn is over");
    expect(quiet.querySelector(".crew-text")).toBeNull();
  });

  it("draws a message an app wrote with its block as the app draws it", () => {
    const words = drawn("[app] Click the button").node.querySelector(".fl-user > .tx")!;
    expect(words.outerHTML).toBe('<span class="tx">Click the button</span>');
  });

  it("draws what the actor sent another, with its receiver's face and name", () => {
    const sent = [
      { text: "Please review.", kind: "send", to: "abc12345-6789", to_name: null },
      { text: "Coordinate.", kind: "send", to: "x", to_name: "Coordinator agent" },
      { text: "Start here.", kind: "new", to: "ffff0000-1", to_name: null },
    ];
    const node = drawn("Ask", { sent }, [ACTOR, HELPER, COORDINATOR]).node;
    const bubbles = [...node.querySelectorAll("#fl-turn-0 > .fl-sent")];
    expect(bubbles.map((b) => b.querySelector(".crew-from")!.textContent)).toEqual([
      "To Fixer",
      "To the coordinator agent",
      "Started actor ffff0000",
    ]);
    expect(bubbles.map((b) => b.getAttribute("title"))).toEqual([
      "Sent with `ag actors send`",
      "Sent with `ag actors send`",
      "A new actor, started with this message",
    ]);
    expect(bubbles[0].className).toBe("fl-sent crew crew-fold");
    expect(bubbles[1].querySelector(".crew-face")!.getAttribute("src")).toBe("/avatars/roles/manager.svg");
    expect(bubbles[0].querySelector(".crew-body > .crew-more")!.textContent).toBe("Show all");
  });

  it("puts a message written mid-turn between actors in a band stacked on the turn's message", () => {
    const text = "Message from the gatherer agent:\n\nAlso this.";
    const t = page("Ask", { more: [{ text, kind: "mid_turn" }] }, [ACTOR]);
    t.host.envelopes[text] = { from: "coordinator", id: null, name: null, text: "Also this." };
    const band = t.page.draw().querySelector("#fl-turn-0 > .fl-crew")!;
    expect(band.className).toBe("fl-crew joined crew-fold");
    expect(band.firstElementChild!.className).toBe("fl-user crew");
  });
});
