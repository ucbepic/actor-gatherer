// What wants the reader, worked out apart (want.ts), and the pop-ups that say it (Pops.tsx).
import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageHome } from "../../core/page/types";
import { POP_MOST, POP_SECONDS, popUp, usePops } from "./Pops";
import { dropGoneIn, freshOf, saidOf, saidWhere, wanting, type Words } from "./want";

const home = (): PageHome => ({
  now: 100,
  gatherers: [
    {
      name: "g",
      agents: [
        { channel: "c1", status: "asking", asking: { call: "x1", questions: [{ question: "Which fruit?" }] } },
        { channel: "c2", status: "error", stopped: { text: "Overloaded", at: 50 } },
        { channel: "c3", status: "idle" },
      ],
      apps: {
        i1: {
          app: "notepad",
          notices: [
            { id: "n1", title: "Build failed", text: "3 tests", at: 10, show: ["ag"] },
            { id: "n2", title: "Old", at: 2 },
          ],
          last: 10,
        },
      },
    },
  ],
});
const status = (a: { status?: string }) => a.status || "idle";
const appKey = (g: string, id: string) => `${g}/${id}`;

describe("what wants the reader", () => {
  it("an actor asking or stopped, an app's notification not yet seen -- each by its token", () => {
    const w = wanting(home(), status, { "g/i1": 5 }, appKey);
    expect([...w.keys()].map((k) => k.split("\u0000"))).toEqual([
      ["ask", "g", "c1", "x1"],
      ["error", "g", "c2", "50"],
      ["notice", "g", "i1", "n1"], // n2 is older than the reader's last look
    ]);
  });

  it("is new only after the first home, and not in front of the reader, nor an actor's with actors' pop-ups off", () => {
    const now = wanting(home(), status, {}, appKey);
    expect(freshOf(now, null, true, () => false)).toEqual([]);
    const ask = [...now.keys()][0];
    expect(freshOf(now, new Set([ask]), true, () => false).map(([, w]) => w.why || w.id)).toEqual([
      "error",
      "i1",
      "i1",
    ]);
    expect(freshOf(now, new Set(), false, () => false).every(([, w]) => !w.a)).toBe(true);
    expect(freshOf(now, new Set(), true, (w) => !!w.a)).toHaveLength(2);
  });

  it("is said where it asks: an actor's always, an app's where its `show` says", () => {
    const [ask, , n1, n2] = [...wanting(home(), status, {}, appKey).values()];
    expect([saidWhere(ask, "system"), saidWhere(n1, "ag"), saidWhere(n1, "system"), saidWhere(n2, "ag")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("in its words: who, what, where", () => {
    const words: Words = {
      appInfo: (_g, id) => (id === "i1" ? { app: { label: "Notepad" }, name: "", title: "Notepad" } : null),
      named: () => ({ label: "Notepad app" }),
      appTitle: (o) => `${o.app.label}!`,
      titleOf: (g) => `Group ${g.name}`,
      actorTitle: (a) => `Actor ${a.channel}`,
    };
    const [ask, err, n1] = [...wanting(home(), status, {}, appKey).values()];
    expect(saidOf(ask, words)).toEqual(["Waiting for you: Actor c1", "Which fruit?", "Group g"]);
    expect(saidOf(err, words)).toEqual(["Stopped on an error: Actor c2", "Overloaded", "Group g"]);
    expect(saidOf(n1, words)).toEqual(["Build failed", "3 tests", "Notepad · Group g"]);
    expect(saidOf({ ...n1, id: "gone" }, words)[2]).toBe("Notepad app · Group g"); // its instance closed: the app's
  });

  it("leaves out what was dismissed here, and forgets it once the server has it so", () => {
    const h = home(),
      gone = new Set(["n1", "zz"]);
    dropGoneIn(h, gone);
    expect(h.gatherers[0].apps!.i1.notices!.map((n) => n.id)).toEqual(["n2"]);
    expect(h.gatherers[0].apps!.i1.last).toBe(2);
    expect([...gone]).toEqual(["n1"]);
    gone.add("n2");
    dropGoneIn(h, gone);
    expect(h.gatherers[0].apps).toEqual({});
  });
});

describe("the pop-ups", () => {
  afterEach(() => {
    act(() => usePops.setState({ pops: [] }));
    vi.useRealTimers();
  });
  const pop = (want: string, opened = () => {}) => ({
    want,
    cls: "asking",
    title: `Waiting: ${want}`,
    line: "",
    where: "g",
    tip: "Show this actor",
    face: Object.assign(document.createElement("span"), { className: "logo" }),
    open: opened,
  });

  it("pops up in the corner, the same thing once, the latest few; a click opens it", () => {
    let opened = 0;
    popUp(pop("a", () => opened++));
    const box = document.getElementById("pops")!;
    expect(box.getAttribute("role")).toBe("region");
    expect(box.querySelector(".pop.asking[data-want=a] .pop-face > .logo + i.pop-dot")).not.toBeNull();
    expect(box.querySelector(".pop-line")).toBeNull(); // no line: none drawn
    popUp(pop("a"));
    expect(box.querySelectorAll(".pop")).toHaveLength(1);
    for (const k of ["b", "c", "d"]) popUp(pop(k));
    expect([...box.querySelectorAll<HTMLElement>(".pop")].map((n) => n.dataset.want)).toEqual(["b", "c", "d"]);
    expect(POP_MOST).toBe(3);
    act(() => (box.querySelector(".pop[data-want=b] .pop-x") as HTMLElement).click());
    expect(box.querySelectorAll(".pop")).toHaveLength(2);
    popUp(pop("e", () => opened++));
    act(() => (box.querySelector(".pop[data-want=e] .pop-open") as HTMLElement).click());
    expect(opened).toBe(1);
    expect(box.querySelector(".pop[data-want=e]")).toBeNull();
  });

  it("goes after POP_SECONDS, not while the pointer is on it", () => {
    vi.useFakeTimers();
    popUp(pop("t"));
    const box = document.getElementById("pops")!;
    const p = box.querySelector(".pop[data-want=t]") as HTMLElement;
    fireEvent.pointerEnter(p);
    act(() => vi.advanceTimersByTime(POP_SECONDS * 1000 + 10));
    expect(box.querySelector(".pop[data-want=t]")).not.toBeNull();
    fireEvent.pointerLeave(p);
    act(() => vi.advanceTimersByTime(POP_SECONDS * 1000 + 10));
    expect(box.querySelector(".pop[data-want=t]")).toBeNull();
  });
});
