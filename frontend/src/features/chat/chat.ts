// THE CHAT CARD: the actor's history, as the pane's view draws it (views.ts), in a frame that follows its newest and takes
// all the height there is; then what was sent and waits for the turn to end; then the box to write the next. A session
// not started here is resumed by the dashboard on its first message (in the directory its calls named); while another
// process has it open -- a terminal -- the box is off (`ctx.held`). An actor that cannot be messaged from here at all (a
// harness the dashboard does not run, or no directory; or a snapshot) has its history and no box; so has every actor in a
// view to read it by (`readOnly`: the ones in Details). What the card holds is worked out in card-model.ts and drawn by
// React in card.tsx; here the pane's view makes its part of it, as the page draws the pane (features/page/main-view.js's
// renderPane).
import { parse as parseKey } from "../../core/model/keys";
import { chatOf } from "./actors";
import { askKey } from "./asking/ask";
import { backgroundNote } from "./Background";
import { drawCard, type CardParts } from "./card";
import { cardShape, heldWhy, noneYetWords, readOnlyWhy as readOnlyWords } from "./card-model";
import { drawControls } from "./Controls";
import { refill } from "./esc";
import { setFilesTurn } from "./files-view";
import { permissionVerb } from "./host";
import { boxedFor, pageBox } from "./input";
import { P, type Pane } from "./link";
import { answeredNote, askingNote, askWhere, cardsOf, errorNote } from "./notes";
import { agDashboard } from "./own-views";
import { send, type SendFrom } from "./send";
import { TASK_KINDS } from "./side/marks";
import type { Actor } from "./types";
import {
  CHAT_VIEWS,
  chatAtEnd,
  chatFeed,
  chatToEnd,
  chatView,
  offeredViews,
  setChatView,
  type CardSession,
  type ChatView,
  type Made,
  type ViewCtx,
} from "./views";

/** Why an actor cannot be messaged from here at all, said the same in every view. */
export const readOnlyWhy = (): string => readOnlyWords(P().runnableNames("and"));

/** What a view made, as nodes. */
const nodesOf = (m: Made): Node[] =>
  (m ? (Array.isArray(m) ? [...m] : [m as Node]) : []).filter((n) => n instanceof Node);

const div = (cls: string, text: string): HTMLDivElement => {
  const n = document.createElement("div");
  n.className = cls;
  n.textContent = text;
  return n;
};

/** The frame the card makes for a view that does not draw its own (a view of the reader's own), one for each view of
 * each pane: its blocks put in it as the page's patch() put them, a node the same as the one there left there. */
const ownFrames = new WeakMap<Pane, Map<string, HTMLDivElement>>();
function ownFrame(p: Pane, view: ChatView): HTMLDivElement {
  const mine = ownFrames.get(p) || new Map<string, HTMLDivElement>();
  ownFrames.set(p, mine);
  let n = mine.get(view.id);
  if (!n) mine.set(view.id, (n = document.createElement("div")));
  const attrs: Record<string, string> = {
    class: `chat-frame ${view.frame ?? "ctx"}`,
    id: "chat-list",
    "data-keep": "chat-list",
    "data-follow": "1",
    role: "log",
    "aria-label": `Chat history, ${view.name}`,
  };
  for (const [k, v] of Object.entries(attrs)) if (n.getAttribute(k) !== v) n.setAttribute(k, v);
  return n;
}
export function patchKids(parent: Element, kids: readonly Node[]): void {
  const old = [...parent.childNodes];
  const final = kids.map((n, i) => (old[i] && old[i] !== n && old[i].isEqualNode(n) ? old[i] : n));
  if (final.some((n, i) => n !== old[i] && old.includes(n as ChildNode))) {
    parent.replaceChildren(...final); // moved: put in whole
    return;
  }
  final.forEach((n, i) => {
    if (i >= old.length) parent.append(n);
    else if (n !== old[i]) parent.replaceChild(n, old[i]);
  });
  for (const o of old.slice(final.length)) o.remove();
}

/** What a send from pane `p` needs of the page (send.ts): the actor and its session as now, the dashboard's own commands,
 * how a terminal the message opens is opened, the page's data loaded again once sent, the Terminal view, the boxes built
 * outside React, and the controls of a view's own that send (data-send), off while a message is on its way. */
const sendFrom = (p: Pane, actor: string, info: Actor, held: string): SendFrom => ({
  info,
  held: !!held,
  command: (t) => P().dashboardCommand(t, p),
  opens: () => P().terminalOpens(info),
  sent: async () => {
    const page = P();
    if (!page.streaming()) await page.refresh();
    else {
      await page.loadChat(p);
      page.render();
    }
    chatToEnd(p);
  },
  toTerminal: CHAT_VIEWS.has("terminal") ? () => setChatView(p, "terminal") : null,
  boxed: boxedFor(actor, P().fitBox),
  sending: (on) => {
    for (const n of p.main.querySelectorAll<HTMLButtonElement>("[data-send]")) n.disabled = on || !!held;
  },
});

/** Pane `p`'s card, for its actor (`info`, as the home has it): drawn now, its node for the page to put in the pane. */
export function chatCard(p: Pane, info: Actor): HTMLElement {
  const page = P();
  const actor = page.paneKey(p)!; // the actor pane `p` shows, by its key: all below is its
  const s: CardSession = (info.session as CardSession | null) || {
    cwd: info.cwd,
    permission_mode: "auto",
    queued: [],
    status: "stopped",
  };
  const view: ChatView = page.chatMin(p) ? page.miniView : chatView(p),
    feed = chatFeed(p, view);
  const writable = page.hasChat(info) && !page.snapshot && !view.readOnly;
  const held = heldWhy(info as Parameters<typeof heldWhy>[0], page.hasChat(info));
  const data = feed.data(p) || { items: [], pending: [], earlier: false };
  const queued = s.queued || [];
  const ctx: ViewCtx = {
    actor,
    info,
    session: s,
    data,
    noneYet: noneYetWords(page.snapshot, s.status, writable),
    running: ["running", "building"].includes(page.turnStatus(info)[0]),
    queued,
    held,
    writable,
    pane: p,
    loadEarlier: async () => {
      // the view's "earlier" control: kept where the reader was
      if (!feed.loadEarlier) return;
      const n = p.main.querySelector("#chat-list"),
        from = n ? n.scrollHeight - n.scrollTop : 0;
      await feed.loadEarlier(p);
      page.renderPane(p);
      const m = p.main.querySelector("#chat-list");
      if (m) m.scrollTop = m.scrollHeight - from;
    },
    rerender: () => page.drawPane(p),
    api: agDashboard,
  };
  const safely = (what: () => Made, fallback = false): Node[] => {
    try {
      return nodesOf(what());
    } catch (err) {
      console.error(err);
      return fallback ? [div("warn", `The ${view.name} view failed: ${(err as Error).message}`)] : [];
    }
  };
  const shape = cardShape(view, { writable, snapshot: page.snapshot, data, queued });
  // its controls go in the pane's head (Controls.tsx): the view's own (tools: Chat's its own), which view, and the
  // details panel. Minimized: the head hidden, kept as it was.
  const tools = view.chatTools ? [] : safely(() => view.tools && view.tools(ctx));
  if (!view.mini)
    drawControls(p.controls, {
      actor,
      chat: !!view.chatTools,
      tools: tools.length ? tools : null,
      views: offeredViews(p)
        .filter((v) => !v.more || v.id === view.id)
        .map(({ id, name, description, icon }) => ({ id, name, description, icon })),
      current: view.id,
      details: !!p.details,
      minimize: page.canMinimize(p) ? { title: page.minTip } : null,
      detailsTitle: page.detailsTip,
      icons: page.icons as Record<string, string>,
      show: (id) => setChatView(p, id),
      toggleDetails: () => page.setDetails(p, !p.details),
      doMinimize: () => page.setChatMin(p, true),
      latest: () => setFilesTurn(p, null),
    });
  // its frame: a view's own (the views that come with the page: React's, the same node from draw to draw), else one the
  // card makes, its blocks and what waits and that there is nothing yet in it
  let frame: Node | null = null;
  if (shape.frame) {
    const mounted = view.mount ? safely(() => view.mount!(ctx), true) : null;
    const own = mounted && mounted[0] instanceof HTMLElement && mounted[0].id === "chat-list" ? mounted[0] : null;
    if (own) frame = own;
    else {
      const blocks = mounted || safely(() => view.render(ctx), true);
      if (shape.queuedInFrame) for (const q of queued) blocks.push(div("queued", `Waiting for the turn to end: ${q}`));
      if (shape.noneYetInFrame) blocks.push(div("desc", ctx.noneYet));
      patchKids((frame = ownFrame(p, view)), blocks);
    }
  }
  const parts: CardParts = {
    mini: !!view.mini,
    label: `${page.harnessName(info.harness || (p.agent && p.agent.harness))} · ${parseKey(actor).group}`,
    frame,
    cards: shape.cards ? cardsOf(info, shape.answerable) : null,
    background: shape.background ? info : null,
    readOnly: shape.readOnlyLine ? readOnlyWhy() : null, // one line, even in a narrow pane: the whole reason its tooltip
    composer: null,
    ownComposer: null,
    err: null,
    footer: [],
    off: { held: false, sending: false },
  };
  if (shape.composer) {
    // Sending, for every view's message box (send.ts): what it sends, the error it gets (SendError.tsx) and the message
    // the harness took back (esc.ts's refill) the actor's. A message box kept from an earlier draw still calls the send
    // it was drawn with: each send goes to the latest draw's (the pane's chatSend), which knows the session as it is now.
    refill(actor, info, boxedFor(actor, page.fitBox));
    const sendNow = (t: string) => p.chatSend(t);
    ctx.send = sendNow;
    p.chatSend = Object.assign((t: string) => send(actor, t, sendFrom(p, actor, info, held)), { draft: actor });
    ctx.input = (attrs) => pageBox({ actor, held, send: sendNow, fit: page.fitBox, say: page.say }, attrs);
    if (view.composer) parts.ownComposer = safely(() => view.composer!(ctx), true);
    else parts.composer = { actor, held: !!held, send: sendNow, fit: page.fitBox, say: page.say };
    parts.err = {
      actor,
      held,
      session: s,
      toTerminal: CHAT_VIEWS.has("terminal") ? () => setChatView(p, "terminal") : null,
    };
    parts.off = { held: !!held, sending: chatOf(actor).sending };
  }
  parts.footer = safely(() => view.footer && view.footer(ctx));
  return drawCard(p, parts);
}

export {
  TASK_KINDS,
  answeredNote,
  askKey,
  askWhere,
  askingNote,
  backgroundNote,
  chatAtEnd,
  chatToEnd,
  errorNote,
  permissionVerb,
};
