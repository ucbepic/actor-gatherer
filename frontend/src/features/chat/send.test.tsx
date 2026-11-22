// Sending from a message box (send.ts): the message shown as sent at once and the box emptied; on a failure the words
// back as the actor's draft and why kept for the line under the box (SendError.tsx); the dashboard's own commands done,
// not sent; a harness's "/" command not shown pending, its terminal shown; nothing sent while another process holds it
// or a message is on its way. And the line under the box (SendError.tsx), the header's controls (Controls.tsx).
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatOf, useActors, viewTaken } from "./actors";
import { drawControls, type ControlsProps } from "./Controls";
import { drafts, keepDraft } from "./drafts";
import { send, type SendFrom } from "./send";
import { SendError, type SendErrorProps } from "./SendError";
import { chatView } from "./testing";
import type { Actor } from "./types";

const A = "g\u0000c";
/** The line under the box, drawn: its box. */
const errLine = (props: SendErrorProps): HTMLElement =>
  render(<SendError {...props} />).container.firstElementChild as HTMLElement;
let answer: { status: number; body: Record<string, unknown> };
let posted: [string, Record<string, unknown>][];
let calls: string[];

const from = (
  over: Partial<SendFrom> = {},
  info: Actor = { channel: "c", session: { session_id: "s1" } },
): SendFrom => ({
  info,
  held: false,
  command: (t) => t === "/context",
  opens: () => ({ fullscreen: false }),
  sent: async () => calls.push("sent"),
  toTerminal: async () => calls.push("terminal"),
  boxed: (t) => calls.push(`boxed:${t}`),
  sending: (on) => calls.push(`sending:${on}`),
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
  keepDraft(A, "");
  useActors.setState({ all: new Map() });
  answer = { status: 200, body: {} };
  posted = [];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      posted.push([url, JSON.parse(String(init.body))]);
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});

describe("a send", () => {
  it("shows the message as sent at once, empties the box, and is shown as the view has it once it does", async () => {
    keepDraft(A, "hello");
    const going = send(A, " hello ", from());
    expect(chatOf(A).sends.map((m) => m.text)).toEqual(["hello"]);
    expect(chatOf(A).sending).toBe(true);
    expect(drafts()[A]).toBeUndefined();
    expect(await going).toBe(true);
    const [[url, body]] = posted;
    expect([url, body.session_id, body.text, body.fullscreen]).toEqual(["/api/send", "s1", "hello", false]);
    expect(body.cid).toBe(chatOf(A).sends[0].cid);
    expect(calls).toEqual(["sending:true", "boxed:", "sent", "sending:false"]);
    viewTaken(A, chatView([], { waiting: [{ text: "hello", cid: String(body.cid), how: "chat" }] }));
    expect(chatOf(A).sends).toEqual([]);
  });

  it("starts an actor with no session by its gatherer and channel", async () => {
    await send(A, "hi", from({}, { channel: "c" }));
    expect(posted[0][1]).toMatchObject({ gatherer: "g", channel: "c", text: "hi" });
  });

  it("puts the words back on a failure, unless something new was typed, and says why", async () => {
    keepDraft(A, "try this");
    answer = { status: 409, body: { error: "not at its box", box: true } };
    expect(await send(A, "try this", from())).toBe(false);
    expect(chatOf(A).sends).toEqual([]);
    expect(drafts()[A]).toBe("try this");
    expect(calls).toContain("boxed:try this");
    expect(chatOf(A).failed).toEqual({ text: "not at its box", box: true });
    const line = errLine({ actor: A, held: "", session: null, toTerminal: () => calls.push("to terminal") });
    expect(line.className).toBe("err");
    expect(line.textContent).toBe("not at its box Open the terminal");
    act(() => line.querySelector("button")!.click());
    expect(calls).toContain("to terminal");
    // the next send clears it
    answer = { status: 200, body: {} };
    act(() => {
      void send(A, "again", from());
    });
    expect(chatOf(A).failed).toBeNull();
    expect(line.textContent).toBe("");
  });

  it("does the dashboard's own commands here, and shows a harness's '/' command's terminal", async () => {
    keepDraft(A, "/context");
    expect(await send(A, "/context", from())).toBe(true);
    expect(posted).toEqual([]);
    expect(drafts()[A]).toBeUndefined();
    answer = { status: 200, body: { terminal: true } };
    expect(await send(A, "/compact", from())).toBe(true);
    expect(chatOf(A).sends).toEqual([]); // not shown pending
    expect(calls).toContain("terminal");
    expect(calls).not.toContain("sent");
  });

  it("sends nothing while held by another process, or while a message is on its way", async () => {
    expect(await send(A, "hi", from({ held: true }))).toBe(false);
    const first = send(A, "one", from());
    expect(await send(A, "two", from())).toBe(false);
    await first;
    expect(posted.map(([, b]) => b.text)).toEqual(["one"]);
  });

  it("says why nothing is sent from here, before why the last one was not", () => {
    const line = errLine({ actor: A, held: "Open in another process.", session: null, toTerminal: null });
    expect(line.textContent).toBe("Open in another process.");
    const failed = errLine({
      actor: "g\u0000x",
      held: "",
      session: { status: "failed", last_error: "no directory" },
      toTerminal: null,
    });
    expect(failed.textContent).toBe("no directory");
  });
});

describe("the header's controls", () => {
  const props = (over: Partial<ControlsProps> = {}): ControlsProps => ({
    actor: A,
    chat: true,
    tools: null,
    views: [
      { id: "files", name: "Chat", icon: "M1 1h2" },
      { id: "terminal", name: "Terminal", description: "Its terminal" },
    ],
    current: "files",
    details: false,
    minimize: { title: "Minimize chat" },
    detailsTitle: "Details",
    icons: { minimize: "M1 1h1", info: "M2 2h2" },
    show: (id) => calls.push(`show:${id}`),
    toggleDetails: () => calls.push("details"),
    doMinimize: () => calls.push("minimize"),
    latest: () => calls.push("latest"),
    ...over,
  });

  it("are the view's tools, the switch and Minimize and Details, in a box kept in the head", () => {
    const head = document.createElement("div");
    act(() => drawControls(head, props()));
    const box = head.firstElementChild as HTMLElement;
    expect(box.style.display).toBe("contents");
    expect([...box.children].map((c) => c.className)).toEqual(["views", "side-btns"]);
    const pressed = box.querySelector(".views button[aria-pressed=true]")!;
    expect(pressed.getAttribute("aria-label")).toBe("Chat");
    act(() => (box.querySelector("button[aria-label=Terminal]") as HTMLElement).click());
    act(() => (box.querySelector("button[aria-label='Minimize the chat']") as HTMLElement).click());
    act(() => (box.querySelector("button[aria-label=Details]") as HTMLElement).click());
    expect(calls).toEqual(["show:terminal", "minimize", "details"]);
    // a turn picked: Chat's "Latest"
    act(() => useActors.setState({ all: new Map([[A, { ...chatOf(A), picked: 2 }]]) }));
    expect(box.querySelector(".chat-tools button")!.textContent).toBe("Latest");
    // another view's own tools, as it made them; the box put back where the page put something else
    const chip = document.createElement("button");
    chip.textContent = "Notes";
    head.replaceChildren(document.createElement("span"));
    act(() => drawControls(head, props({ chat: false, tools: [chip], details: true, minimize: null })));
    expect(head.firstElementChild).toBe(box);
    expect(head.childNodes.length).toBe(1);
    expect(box.querySelector(".chat-tools")!.firstChild).toBe(chip);
    expect(box.querySelector("button[aria-label=Details]")!.getAttribute("aria-expanded")).toBe("true");
    expect(box.querySelector("button[aria-label='Minimize the chat']")).toBeNull();
  });
});
