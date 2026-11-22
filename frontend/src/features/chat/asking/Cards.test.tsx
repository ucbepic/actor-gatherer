// The cards under the conversation (Cards.tsx, Asking.tsx): which shows, what each says, and what an answer sends --
// questions one at a time with a click advancing to the next, a permission allowed or denied, a plan's choices, a dialog's
// option; the error the turn stopped on; an answer recorded otherwise, dismissed. And the old page's node of them
// (mount.tsx): one node by what it is for, the card's box itself.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actorOf,
  askOf,
  failingOf,
  harnessInfoOf,
  homeOf,
  optionOf,
  questionOf,
  sessionOf,
} from "../../../core/api/testing";
import type { Home } from "../../../core/api/types";
import type { Actor } from "../types";
import type { Ask } from "./ask";
import { useAnswers } from "./answers";
import { Cards, type CardsHost } from "./Cards";
import { drawCards } from "./mount";

const AT = 1790874000;
const home: Home = homeOf({
  now: AT,
  harness_info: {
    h1: harnessInfoOf({
      label: "Harness One",
      ask_says: {
        plan_verb: "review",
        plan_choices: [
          { id: "yes", label: "Yes, go", title: null, primary: true },
          { id: "no", label: "No", title: null, primary: false },
        ],
        plan_change: { label: "Or say what to change", title: null },
        own_answer: "Or type your own answer",
      },
    }),
  },
});

let posted: [string, unknown][];
let host: CardsHost & { views: string[] };
beforeEach(() => {
  posted = [];
  useAnswers.setState({ drafts: new Map(), seen: new Set() });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      posted.push([url, JSON.parse(String(init.body))]);
      return new Response("{}", { status: 200 });
    }),
  );
  const views: string[] = [];
  host = {
    views,
    icons: { terminal: "M1 1h14" },
    setChatView: (id) => views.push(id),
    permissionVerb: () => "run a command",
    permissionView: (ask) =>
      Object.assign(document.createElement("div"), { className: "perm", textContent: `${ask.tool}` }),
    refresh: async () => {},
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const actor = (over: Partial<Actor>): Actor =>
  actorOf("c1", {
    harness: "h1",
    status: "asking",
    session: sessionOf({ session_id: "s1", terminal: true, status: "terminal" }),
    ...over,
  });
const asking = (ask: Partial<Ask>, over: Partial<Actor> = {}) =>
  actor({ asking: askOf({ at: AT, harness: "h1", ...ask }), ...over });
const show = (info: Actor, answerable = true) =>
  render(<Cards info={info} home={home} answerable={answerable} snapshot={false} terminalView host={host} />);
const settle = () => act(async () => {});

const FRUIT = questionOf({ question: "Which fruit?", header: "Fruit", options: [optionOf("Apple"), optionOf("Pear")] });
const COLOURS = questionOf({
  question: "Which colours?",
  multiSelect: true,
  options: [optionOf("Red"), optionOf("Green")],
});

describe("a question", () => {
  it("is answered here, one option picked or words of the reader's own, and sent as the server takes it", async () => {
    const { container } = show(asking({ kind: "question", call: "q1", questions: [FRUIT] }));
    const card = container.querySelector(".asking-note")!;
    expect(card.getAttribute("role")).toBe("group");
    expect(card.getAttribute("aria-label")).toBe("Waiting for you: Harness One asked you a question");
    expect(screen.getByRole("radiogroup", { name: "Which fruit?" })).toBeTruthy();
    const answer = screen.getByRole("button", { name: "Answer" }) as HTMLButtonElement;
    expect(answer.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Pear" }));
    expect(screen.getByRole("radio", { name: "Pear" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByRole("textbox", { name: "Or type your own answer" }), { target: { value: "Mango" } });
    expect(screen.getByRole("radio", { name: "Pear" }).getAttribute("aria-checked")).toBe("false"); // words in its place
    fireEvent.click(answer);
    await settle();
    expect(posted).toEqual([
      ["/api/answer", { session_id: "s1", id: "q1", call: "q1", choice: { answers: [{ text: "Mango" }] } }],
    ]);
  });

  it("asks several one at a time, a click moving to the next not answered, and counts them", async () => {
    show(asking({ kind: "question", call: "q2", questions: [FRUIT, COLOURS] }));
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    fireEvent.click(screen.getByRole("radio", { name: "Apple" }));
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(screen.getByText("1 of 2 answered")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Red" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Green" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Red" })); // picked again: put back
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    await settle();
    expect(posted[0][1]).toMatchObject({ choice: { answers: [{ options: [0] }, { options: [1] }] } });
  });

  it("says where it is answered when not here: a view to read by, or no terminal of the dashboard's", () => {
    const { unmount } = show(asking({ kind: "question", call: "q3", questions: [FRUIT] }), false);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Answer it in Chat or in the terminal.");
    unmount();
    show(asking({ kind: "question", call: "q3", questions: [FRUIT] }, { session: sessionOf({ terminal: false }) }));
    expect(screen.getByRole("status").textContent).toBe("Answer it in the terminal that runs the session.");
  });

  it("says an answer on its way, then lost once it has not come through for a while", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
    vi.setSystemTime(AT * 1000 + 5000);
    show(
      asking(
        { kind: "question", call: "q4", questions: [FRUIT] },
        { answer: { call: "q4", at: AT, summary: "Pear", result: null, recorded: null } },
      ),
    );
    expect(screen.getByRole("status").textContent).toBe("Typing your answer into the terminal: Pear");
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Your answer (Pear) hasn't reached Harness One. Answer it in the terminal.",
    );
    vi.useRealTimers();
  });

  it("sends the reader to the terminal", () => {
    show(asking({ kind: "question", call: "q5", questions: [FRUIT] }));
    fireEvent.click(screen.getByRole("button", { name: "Open the terminal" }));
    expect(host.views).toEqual(["terminal"]);
  });
});

describe("a permission, a plan, a dialog", () => {
  it("allows a call, or denies it with what to do instead", async () => {
    const ask: Partial<Ask> = { kind: "permission", id: "p1", call: "c9", tool: "Bash" };
    show(asking(ask));
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe(
      "Waiting for you: Harness One asks to run a command",
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "use ls" } });
    fireEvent.click(screen.getByRole("button", { name: "Deny with this" }));
    await settle();
    expect(posted[0][1]).toEqual({ session_id: "s1", id: "p1", call: "c9", choice: { allow: false, text: "use ls" } });
  });

  it("offers a plan's choices as its harness has them", async () => {
    show(asking({ kind: "plan", call: "pl", plan: "1. a" }));
    expect(screen.getByText("Harness One has a plan for you to review")).toBeTruthy();
    expect(screen.getByText("The plan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, go" }));
    await settle();
    expect(posted[0][1]).toMatchObject({ choice: { plan: "yes" } });
  });

  it("picks a dialog's option in its terminal", async () => {
    show(asking({ kind: "dialog", call: "d1", options: ["Yes", "No"], restarts: [0], cursor: 1, said: "Update?" }));
    expect(screen.getByText("Harness One closes to update, then starts again with your message")).toBeTruthy();
    expect(screen.getByText("Selected in its terminal")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Pick “No” in its terminal"));
    await settle();
    expect(posted[0][1]).toMatchObject({ choice: { pick: 1 } });
  });
});

describe("the call the turn stopped on, and an answer recorded otherwise", () => {
  it("says why the model call failed, what it likely means, and what comes next", () => {
    const { container, rerender } = show(
      actor({ status: "running", failing: failingOf({ at: AT, first: AT, attempts: 1, error: "Connection refused" }) }),
    );
    const card = container.querySelector(".asking-note")!;
    expect(card.className).toBe("asking-note error-note retrying");
    expect(card.textContent).toContain("No answer from the model's endpoint: Connection refused");
    expect(card.textContent).toContain("Nothing is listening at the endpoint's address.");
    expect(card.textContent).toContain("Harness One will try again.");
    rerender(
      <Cards
        info={actor({ status: "error", stopped: { kind: "error", at: AT, text: "gave up" } })}
        home={home}
        answerable
        snapshot={false}
        terminalView
        host={host}
      />,
    );
    expect(container.querySelector(".asking-note")!.getAttribute("role")).toBe("alert");
    expect(container.textContent).toContain("Harness One stopped trying. Send a message to try again.");
  });

  it("shows an answer recorded otherwise than picked until dismissed", () => {
    const info = actor({
      status: "idle",
      answer: { call: "x", at: AT, summary: "Pear", recorded: false, result: "Apple" },
    });
    const { container } = show(info);
    expect(container.textContent).toContain("Harness One recorded");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(container.querySelector(".asking-note")).toBeNull();
  });
});

describe("the old page's node", () => {
  it("is the card's box, the same node from draw to draw, none while there is no card", () => {
    const props = { home, answerable: true, snapshot: false, terminalView: true, host };
    const info = actor({ status: "idle", answer: { call: "y", at: AT, summary: "A", recorded: false, result: "B" } });
    const node = drawCards("c1", { ...props, info })!;
    expect(node.className).toBe("asking-note answered");
    expect(node.firstElementChild!.className).toBe("head");
    expect(drawCards("c1", { ...props, info })).toBe(node);
    expect(drawCards("c1", { ...props, info }, "error")).toBeNull();
    act(() => {
      fireEvent.click(node.querySelector("button")!);
    });
    expect(node.hidden).toBe(true); // dismissed between the page's draws: its box hidden
    expect(drawCards("c1", { ...props, info })).toBeNull();
  });
});
