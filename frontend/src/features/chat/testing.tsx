// For the turn list's tests (Vitest, in jsdom): a page around it -- the old page's host, standing in for its stage and
// its commands' drawing and recording what the turn list calls of it -- and the turn list drawn as the page draws it
// (mount.tsx's drawChat), into #main.
import { act } from "@testing-library/react";
import { drawChat } from "./mount";
import type { Actor, ChatFeed, ChatHost, ChatView, Current, Envelope, Turn } from "./types";

/** When the turns of the tests were stored, in seconds. */
export const AT = 1790874000;

const span = (cls: string, sig: string | null, text = "") => {
  const n = document.createElement("span");
  n.className = cls;
  if (sig !== null) n.dataset.sig = sig;
  n.textContent = text;
  return n;
};

export interface TestHost extends ChatHost {
  /** what the turn list called of the page, in order: [name, ...arguments] */
  calls: unknown[][];
  /** the messages between actors it reads as such */
  envelopes: Record<string, Envelope>;
}

/** The old page's host, standing in: its stage a span telling what it shows (data-sig), its other drawing plain. */
export function testHost(): TestHost {
  const calls: unknown[][] = [];
  const said =
    (name: string, out?: unknown) =>
    (...a: unknown[]) => {
      calls.push([name, ...a]);
      return out;
    };
  const typedAs = (t: string) =>
    String(t ?? "")
      .trim()
      .replace(/^!\s*/, "! ");
  const host: TestHost = {
    calls,
    envelopes: {},
    atWork: (info, t) => span("stage-box", JSON.stringify(["work", info.avatar, t.work ?? null])),
    atRest: (info, turn) => span("done", JSON.stringify(["rest", info.avatar, turn])),
    greeting: (info) => (info.avatar ? span("stage-box", JSON.stringify(["hello", info.avatar])) : null),
    crewFace: (a, coordinator) => {
      const n = document.createElement("img");
      n.className = "crew-face";
      n.setAttribute("src", `/avatars/${a?.avatar ?? (coordinator ? "roles/manager" : "none")}.svg`);
      return n;
    },
    appWords: (text) => (text.startsWith("[app] ") ? span("tx", null, text.slice(6)) : null),
    bareAvatar: (info) => (info.avatar ? `/avatars/${info.avatar}.svg?bare=1` : null),
    hueInk: (info) => (info.avatar_hue ? "color: light-dark(#b91c1c, #f57474)" : null),
    envelope: (text) => host.envelopes[text] ?? null,
    typedAs,
    sameWords: (a, b) => typedAs(a).slice(0, 200) === typedAs(b).slice(0, 200),
    icons: { chevron: "M6 4l4 4-4 4", sidebar: "M2 3h12v10H2z" },
    beside: "⌘",
    foldSide: said("foldSide"),
    barActs: () => null,
    permissionVerb: (ask) => `use ${ask.tool}`,
    permissionView: (ask) => span("perm", null, String(ask.tool)),
    refresh: said("refresh", Promise.resolve()) as ChatHost["refresh"],
    setFilesTurn: said("setFilesTurn", Promise.resolve()) as ChatHost["setFilesTurn"],
    setChatView: said("setChatView"),
    interruptOver: said("interruptOver"),
  };
  return host;
}

/** A turn: the user's message, the agent's answer. */
export const turn = (n: number, over: Partial<Turn> = {}): Turn => ({
  n,
  row_id: 100 + n,
  at: AT + n * 60,
  end: AT + n * 60 + 5,
  text: `Ask ${n}`,
  kind: "user",
  replies: [{ kind: "text", text: `Answer ${n}` }],
  calls: 0,
  ...over,
});

/** The server's view of a conversation of `turns` (chat_view.py's): its latest turn done, unless `over` says otherwise. */
export const chatView = (turns: Turn[], over: Partial<ChatView> = {}): ChatView => ({
  turns,
  opening: null,
  current: turns.length ? { state: "done", turn: turns.length - 1 } : { state: "idle", turn: null },
  waiting: [],
  taken_back: null,
  ...over,
});

/** The latest of `turns` in `state` (and what else `over` says of it). */
export const now = (turns: Turn[], state: Current["state"], over: Partial<Current> = {}): Current => ({
  state,
  turn: turns.length ? turns.length - 1 : null,
  ...over,
});

/** A feed's turns, as the page's files feed and the server's view both have them: the latest shown. */
export const withTurns = (turns: Turn[], over: Partial<ChatView> = {}): Partial<ChatFeed> => ({
  data: { turns, turn: turns.length ? turns.length - 1 : null, files: [], commands: [], home: "/home/u" },
  view: chatView(turns, over),
});

export const ACTOR: Actor = {
  channel: "c1",
  harness: "h1",
  status: "idle",
  last: AT + 3000,
  avatar: "animal/fox",
  avatar_hue: "red",
  avatar_hello: "Hi, I'm Fox.\nReady when you are.",
  session: { status: "terminal" },
};

let actors = 0;

/** The page around the turn list, drawing it as the old page does: from `feed`, into #main, its node kept there. */
export function testPage(turns: Turn[], over: Partial<ChatFeed> = {}) {
  const main =
    document.getElementById("main") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "main" }));
  const page = {
    feed: null as unknown as ChatFeed,
    /** the actor's frame, as the page puts it in #main */
    frame: null as HTMLElement | null,
    /** the page drawn again: `over` changed in its feed; its conversation's box */
    draw: (more: Partial<ChatFeed> = {}) => {
      page.feed = { ...page.feed, ...more };
      act(() => {
        page.frame = drawChat(page.feed, host);
      });
      if (page.frame!.parentElement !== main) main.replaceChildren(page.frame!);
      return page.frame!.querySelector<HTMLElement>(".fl-talk")!;
    },
  };
  const host = testHost();
  const info = over.info ?? ACTOR;
  page.feed = {
    key: `g\u0000c${++actors}`,
    gatherer: "g",
    files: {},
    data: { turns, turn: turns.length ? turns.length - 1 : null, files: [], commands: [], home: "/home/u" },
    picked: null,
    home: { home: "/h", now: AT, gatherers: [{ name: "g", agents: [info] }], harness_info: {} },
    info,
    session: { status: "terminal" },
    view: chatView(turns),
    writable: true,
    held: "",
    mine: [],
    interrupting: false,
    canInterrupt: false,
    earlierTurns: "messages",
    terminalView: true,
    afresh: false,
    snapshot: false,
    streaming: false,
    running: false,
    details: false,
    cwd: "",
    ...over,
  };
  return { page, host, main };
}
