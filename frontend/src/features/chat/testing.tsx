// For the turn list's tests (Vitest, in jsdom): a page around it -- the old page's host, standing in for its stage and
// its commands' drawing and recording what the turn list calls of it -- and the turn list drawn as the page draws it
// (mount.tsx's drawChat), into #main.
import { act } from "@testing-library/react";
import { change } from "./actors";
import { drawChat } from "./mount";
import { actorOf, currentOf, gathererOf, homeOf, replyOf, sessionOf, turnOf } from "../../core/api/testing";
import { sizesForTests } from "../../core/ui/lists";
import type { Actor, ChatFeed, ChatHost, ChatView, Current, Envelope, PageFeed, Turn } from "./types";

// jsdom lays nothing out: the turn list (react-virtuoso) takes its box as tall as a few hundred turns, each 40px, and
// puts every turn of the tests on the page
sizesForTests.now = { viewportHeight: 20_000, itemHeight: 40 };

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
  };
  return host;
}

/** A turn: the user's message, the agent's answer. */
export const turn = (n: number, over: Partial<Turn> = {}): Turn =>
  turnOf(n, {
    row_id: 100 + n,
    at: AT + n * 60,
    end: AT + n * 60 + 5,
    text: `Ask ${n}`,
    replies: [replyOf({ kind: "text", text: `Answer ${n}` })],
    ...over,
  });

/** The server's view of a conversation of `turns` (chat_view.py's): its latest turn done, unless `over` says otherwise. */
export const chatView = (turns: Turn[], over: Partial<ChatView> = {}): ChatView => ({
  turns,
  opening: null,
  current: turns.length ? currentOf({ state: "done", turn: turns.length - 1 }) : currentOf(),
  waiting: [],
  taken_back: null,
  version: [],
  ...over,
});

/** The latest of `turns` in `state` (and what else `over` says of it). */
export const now = (turns: Turn[], state: Current["state"], over: Partial<Current> = {}): Current =>
  currentOf({ state, turn: turns.length ? turns.length - 1 : null, ...over });

/** A feed's turns, as the page's files feed and the server's view both have them: the latest shown. */
export const withTurns = (turns: Turn[], over: Partial<ChatView> = {}): Partial<ChatFeed> => ({
  data: { turns, turn: turns.length ? turns.length - 1 : null, files: [], commands: [], home: "/home/u" },
  view: chatView(turns, over),
});

export const ACTOR: Actor = actorOf("c1", {
  harness: "h1",
  status: "idle",
  last: AT + 3000,
  avatar: "animal/fox",
  avatar_hue: "red",
  avatar_hello: "Hi, I'm Fox.\nReady when you are.",
  session: sessionOf({ status: "terminal" }),
});

let actors = 0;

/** What a test says Chat keeps of the actor itself (actors.ts), as the page's feed said it: kept there for the actor. */
type Own = Partial<Pick<ChatFeed, "mine" | "picked" | "interrupting" | "canInterrupt">>;

/** The page around the turn list, drawing it as the old page does: from `feed`, into a pane's #main, its node kept there -- what
 * Chat keeps of the actor itself (what was sent from here, the turn picked, the Esc sent) put in its store as a page's
 * send, pick or Esc would. `canInterrupt`: the actor's session a terminal of the dashboard's, an Esc typed into it. */
export function testPage(turns: Turn[], over: PageFeedOver = {}) {
  const main =
    document.getElementById("main") ??
    document.body
      .appendChild(Object.assign(document.createElement("section"), { className: "pane" }))
      .appendChild(Object.assign(document.createElement("main"), { id: "main" }));
  const own = (o: Own) => {
    if (o.mine) change(page.feed.key, () => ({ sends: o.mine!.map((m) => ({ ...m, ran: false })) }));
    if (o.picked !== undefined) change(page.feed.key, () => ({ picked: o.picked! }));
    if (o.interrupting !== undefined)
      change(page.feed.key, () => ({ interrupting: o.interrupting ? Date.now() : null }));
  };
  const page = {
    feed: null as unknown as PageFeed,
    /** the actor's frame, as the page puts it in #main */
    frame: null as HTMLElement | null,
    /** the page drawn again: `over` changed in its feed; its conversation's box */
    draw: (more: PageFeedOver = {}) => {
      const { mine, picked, interrupting, canInterrupt, ...rest } = more;
      page.feed = { ...page.feed, ...rest, ...(canInterrupt ? { info: terminalOf(rest.info ?? page.feed.info) } : {}) };
      own({ mine, picked, interrupting });
      act(() => {
        page.frame = drawChat(page.feed, host);
      });
      if (page.frame!.parentElement !== main) main.replaceChildren(page.frame!);
      return page.frame!.querySelector<HTMLElement>(".fl-talk")!;
    },
  };
  const host = testHost();
  const { mine, picked, interrupting, canInterrupt, ...rest } = over;
  const info = canInterrupt ? terminalOf(rest.info ?? ACTOR) : (rest.info ?? ACTOR);
  page.feed = {
    key: `g\u0000c${++actors}`,
    gatherer: "g",
    files: {},
    data: { turns, turn: turns.length ? turns.length - 1 : null, files: [], commands: [], home: "/home/u" },
    home: homeOf({ now: AT, gatherers: [gathererOf("g", { agents: [info] })] }),
    session: { status: "terminal" },
    view: chatView(turns),
    writable: true,
    held: "",
    earlierTurns: "messages",
    terminalView: true,
    afresh: false,
    snapshot: false,
    streaming: false,
    running: false,
    details: false,
    cwd: "",
    ...rest,
    info,
  };
  own({ mine, picked, interrupting });
  return { page, host, main };
}

/** What a test changes in the page's feed, and what it says Chat keeps of the actor. */
type PageFeedOver = Partial<PageFeed> & Own;

/** The actor at work in a terminal of the dashboard's: an Esc would interrupt it. */
const terminalOf = (info: Actor): Actor => ({
  ...info,
  status: "running",
  session: sessionOf({ ...info.session, session_id: "s", terminal: true }),
});
