// A pane's card (card-model.ts, card.tsx, views.ts's choices): why an actor cannot be messaged here, which parts a view's
// card has, the views offered and picked, and the card drawn -- its parts in order, the nodes made outside it put in their
// places and kept while the same, the message box kept from draw to draw.
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { actorOf } from "../../core/api/testing";
import { cardShape, heldWhy, noneYetWords, readOnlyWhy } from "./card-model";
import { drawCard, place, NONE_PLACED, type CardParts } from "./card";
import type { Pane } from "./link";
import { offeredOf, settled, viewPicked, wrongView, type ChatView } from "./views";

const none = { items: [], pending: [], earlier: false };

describe("what the card says", () => {
  it("says why an actor cannot be messaged here: not run here, or held by another process", () => {
    expect(readOnlyWhy("Claude Code and Codex")).toBe(
      "Read only. Only Claude Code and Codex sessions with a known directory can be messaged here.",
    );
    expect(heldWhy({ chattable: false, holder: { pid: 41 } }, true)).toBe(
      "Open in another process (PID 41). Close it there to message it here.",
    );
    expect(heldWhy({ chattable: false, pid: 7 }, true)).toBe(
      "Open in another process (PID 7). Close it there to message it here.",
    );
    expect(heldWhy({ chattable: false }, true)).toBe("Open in another process. Close it there to message it here.");
    expect(heldWhy({ chattable: false, pid: 7 }, false)).toBe(""); // not run here at all: that says it
    expect(heldWhy({ chattable: true }, true)).toBe("");
  });

  it("says there is no conversation yet as the actor stands", () => {
    expect(noneYetWords(true, "running", true)).toMatch(/^A snapshot has no conversation/);
    expect(noneYetWords(false, "starting", true)).toBe("Starting the agent…");
    expect(noneYetWords(false, "stopped", true)).toBe("No messages yet. Write one below.");
    expect(noneYetWords(false, "stopped", false)).toBe("No messages yet.");
  });
});

describe("a view's card", () => {
  const view = (over: Partial<ChatView> = {}): ChatView =>
    settled({ id: "v", render: () => [], ...over }) as ChatView & typeof over;

  it("has the history's parts under a view of the history: what waits, none yet, the cards, the background, the box", () => {
    const s = cardShape(view(), { writable: true, snapshot: false, data: none, queued: ["next"] });
    expect(s).toEqual({
      frame: true,
      queuedInFrame: true,
      noneYetInFrame: false, // something waits
      cards: true,
      answerable: true,
      background: true,
      readOnlyLine: false,
      composer: true,
    });
    expect(cardShape(view(), { writable: true, snapshot: false, data: none, queued: [] }).noneYetInFrame).toBe(true);
    expect(
      cardShape(view({ greets: true }), { writable: true, snapshot: false, data: none, queued: [] }).noneYetInFrame,
    ).toBe(false);
  });

  it("has no box but the line saying so for an actor not messaged here, and neither in a snapshot or a view to read by", () => {
    const ro = cardShape(view(), { writable: false, snapshot: false, data: none, queued: [] });
    expect([ro.readOnlyLine, ro.composer]).toEqual([true, false]);
    expect(cardShape(view(), { writable: false, snapshot: true, data: none, queued: [] }).readOnlyLine).toBe(false);
    const reading = cardShape(view({ readOnly: true }), { writable: false, snapshot: false, data: none, queued: [] });
    expect([reading.readOnlyLine, reading.answerable]).toEqual([false, false]);
  });

  it("has only its frame and footer for a view that is not the conversation; no frame minimized; no cards for a terminal", () => {
    const hist = cardShape(view({ chat: false }), { writable: true, snapshot: false, data: none, queued: ["x"] });
    expect(Object.values(hist).filter(Boolean)).toEqual([true, true]); // its frame, and answerable (unused)
    expect(cardShape(view({ mini: true }), { writable: true, snapshot: false, data: none, queued: [] }).frame).toBe(
      false,
    );
    const term = cardShape(view({ feed: "none", frame: "term" }), {
      writable: true,
      snapshot: false,
      data: none,
      queued: [],
    });
    expect([term.cards, term.background, term.queuedInFrame, term.composer]).toEqual([false, false, false, true]);
  });
});

describe("the views", () => {
  const a = settled({ id: "files", name: "Chat", feed: "files", render: () => [] });
  const b = settled({ id: "mine", render: () => [], when: (info) => info?.harness === "x" });
  const views = new Map([
    ["files", a],
    ["mine", b],
  ]);

  it("offers a view to the actors it says, those for them alone first; picks Chat for one not offered", () => {
    expect(offeredOf(views.values(), actorOf("c", { harness: "x" })).map((v) => v.id)).toEqual(["mine", "files"]);
    expect(offeredOf(views.values(), actorOf("c", { harness: "y" })).map((v) => v.id)).toEqual(["files"]);
    expect(viewPicked(views, "mine", actorOf("c", { harness: "y" })).id).toBe("files");
    expect(viewPicked(views, "mine", actorOf("c", { harness: "x" })).id).toBe("mine");
    expect(viewPicked(views, "gone", null).id).toBe("files");
  });

  it("takes a view with an id, a render and a feed there is; names it and settles what runs in the background", () => {
    const feeds = { history: { load: async () => {}, data: () => null } };
    expect(wrongView({ id: "x" }, feeds)).toBe("a chat view needs an id and a render(ctx)");
    expect(wrongView({ id: "x", render: () => [], feed: "nope" }, feeds)).toBe("no feed nope: one of history");
    expect(wrongView({ id: "x", render: () => [] }, feeds)).toBeNull();
    const v = settled({ id: "x", render: () => [] });
    expect([v.name, v.feed, v.background]).toEqual(["x", "history", true]);
    expect(settled({ id: "t", frame: "term", render: () => [] }).background).toBe(false);
    expect(settled({ id: "n", feed: "none", render: () => [] }).background).toBe(false);
  });
});

describe("the card drawn", () => {
  const div = (cls: string, text = "") =>
    Object.assign(document.createElement("div"), { className: cls, textContent: text });
  const parts = (over: Partial<CardParts> = {}): CardParts => ({
    mini: false,
    label: "Claude Code · g",
    frame: null,
    cards: null,
    background: null,
    readOnly: null,
    composer: null,
    ownComposer: null,
    err: null,
    footer: [],
    off: { held: false, sending: false },
    ...over,
  });
  const pane = () => ({}) as Pane;

  it("puts the frame first, a view's own box before the line under it, the footer last; keeps what did not change", () => {
    const s = document.createElement("section");
    const mid = div("err");
    s.append(div("cards"), mid);
    const frame = div("chat-frame"),
      box = div("composer", "mine"),
      foot = div("foot", "f");
    let was = place(s, parts({ frame, ownComposer: [box], footer: [foot] }), mid, NONE_PLACED);
    expect([...s.children].map((n) => n.className)).toEqual(["chat-frame", "cards", "composer", "err", "foot"]);
    // drawn again: a box and a footer the same as those there kept, the reader's text and all
    const box2 = div("composer", "mine"),
      foot2 = div("foot", "f");
    was = place(s, parts({ frame, ownComposer: [box2], footer: [foot2] }), mid, was);
    expect(s.querySelector(".composer")).toBe(box);
    expect(s.querySelector(".foot")).toBe(foot);
    // another footer, no box, no frame (minimized): those taken out
    const foot3 = div("foot", "other");
    place(s, parts({ footer: [foot3] }), mid, was);
    expect([...s.children].map((n) => n.textContent)).toEqual(["", "", "other"]);
  });

  it("draws the parts in order in the pane's one section, its message box the same node from draw to draw", () => {
    const p = pane();
    const composer = { actor: "g\0c", held: false, send: () => true, fit: () => {}, say: () => {} };
    const info = actorOf("c", {
      background: [{ id: "t1", kind: "command", label: "npm test", started: 1, active: null }],
    });
    let node!: HTMLElement;
    act(() => {
      node = drawCard(
        p,
        parts({
          frame: div("chat-frame"),
          background: info,
          composer,
          err: { actor: "g\0c", held: "", session: null, toTerminal: null },
          footer: [div("foot")],
        }),
      );
    });
    expect(node.matches("section.chat[data-sig]")).toBe(true);
    expect(node.getAttribute("aria-label")).toBe("Claude Code · g");
    expect([...node.children].map((n) => n.className)).toEqual(["chat-frame", "bg-tasks", "composer", "err", "foot"]);
    const box = node.querySelector("textarea");
    act(() => {
      expect(drawCard(p, parts({ mini: true, composer, readOnly: null, footer: [div("foot")] }))).toBe(node);
    });
    expect(node.className).toBe("chat mini");
    expect(node.querySelector("textarea")).toBe(box); // minimized: the same box, its caret kept
    act(() => {
      drawCard(p, parts({ readOnly: "Read only. Only Claude Code sessions …" }));
    });
    expect(node.querySelector(".readonly")!.getAttribute("title")).toBe("Read only. Only Claude Code sessions …");
    expect(node.querySelector("textarea")).toBeNull();
  });

  it("puts off what a view drew that sends while held or sending", () => {
    const p = pane();
    const send = Object.assign(document.createElement("button"), { type: "button" });
    send.dataset.send = "";
    act(() => {
      drawCard(
        p,
        parts({
          ownComposer: [send],
          err: { actor: "a", held: "", session: null, toTerminal: null },
          off: { held: false, sending: true },
        }),
      );
    });
    expect(send.disabled).toBe(true);
  });
});
