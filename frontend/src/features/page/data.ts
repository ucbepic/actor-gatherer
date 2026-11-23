// ------------------------------------------------------------------ data
// The page's data and its draws: the home (read once, then as the stream sends it: stream.ts), each pane's actor's calls
// and the feed its view draws from, loaded; and the page drawn from them -- the list and each pane, only where what it
// draws from changed (render), and the page's state said in the settings panel (setLive). What it draws is the features'
// (link.ts: the list, the panes, Chat and its views, Details, the terminals).
import { SNAPSHOT, panes, state } from "../../core/page/state";
import { get } from "../../core/api/client";
import { failed } from "../../core/api/types";
import { clock } from "../../core/format";
import { isShell, parse as parseKey } from "../../core/model/keys";
import { signature } from "../../core/page/dom";
import { selectedInfo } from "../../core/page/home";
import type { AgentCalls, PageHome, Pane } from "../../core/page/types";
import { fitBox } from "./box";
import { link } from "./link";
import { startLook } from "./look";
import { drawPane } from "./main-view";
import { allPanes, paneInfo, paneKey, paneSel } from "./pane-view";

let hidingMoved = false;
/** The home: read once by the page (every pane draws from it), then as the stream sends it. */
export async function loadHome(): Promise<void> {
  let home = SNAPSHOT ? SNAPSHOT.home : null;
  if (!home) {
    const r = await fetch("/api/home", { cache: "no-store" });
    if (!r.ok) throw new Error(`/api/home: ${r.status}`);
    home = (await r.json()) as PageHome;
  }
  link.list.takeHome(home);
  if (!hidingMoved) {
    hidingMoved = true;
    await link.list.moveHidingToServer();
  }
}
/** What ag recorded of the calls of pane `p`'s actor (this page's own, by default), fetched: as the pane is given it. */
export async function loadAgent(p: Pane = panes.here as Pane): Promise<void> {
  const sel = paneSel(p);
  if (!sel || isShell(sel[1])) return;
  const [g, c] = sel;
  const got = SNAPSHOT
    ? SNAPSHOT.agents[paneKey(p) as string] || null
    : await get<AgentCalls>(`/api/agent?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}`);
  if (p.g !== g || p.c !== c) return; // another given it meanwhile: not it
  await takeAgent(got, p);
}
/** Pane `p`'s actor's calls, fetched or pushed: their counts, and the context of the call Details shows (the latest's,
 * unless one is picked: features/details/store.ts), fetched before the page draws it. */
export async function takeAgent(agent: AgentCalls | null, p: Pane = panes.here as Pane): Promise<void> {
  p.agent = agent;
  p.agentVersion = (p.agentVersion || 0) + 1;
  const calls = agent && !failed(agent) ? agent : null; // ({error}: no calls)
  const reads = (calls && calls.reads) || [];
  link.details.counted(reads); // ag's count of all each call sent
  const actor = paneKey(p);
  if (!actor) return;
  link.details.detailsShown(allPanes().map(paneKey).filter(Boolean) as string[]);
  if (reads.length) await link.details.loadContext(parseKey(actor).group, link.details.shownRead(calls, actor));
}
/** What pane `p` shows, loaded (this page's own, by default): the feed its view draws from (features/chat/views.js),
 * for its actor -- any actor: one that cannot be messaged here is shown all the same, without the message box. */
export async function loadChat(p: Pane | null = panes.here): Promise<void> {
  if (!p || !p.c || SNAPSHOT || isShell(p.c)) return;
  try {
    await link.chat.chatFeed(p).load(p);
  } catch {
    /* no database yet: the gatherer is made on the first call */
  }
}
/** What was last drawn, so an update that brings nothing new draws nothing: no flash, and an open table, a scrolled list
 * or a tooltip stays as it is -- the list's here, each pane's in its record (`drawn`: pane-view.ts). */
export const drawn: { agents: string | null } = { agents: null };
/** What the list draws from: kept as `drawn.agents` by renderAgents whoever calls it -- a home, or the reader's own
 * action, which draws at once -- so a home that only confirms that action draws nothing anew (a row drawn again under
 * the pointer as the reader presses it to drag starts no drag). Not the clock: its "ago" texts count where they are, as
 * every `data-ago` does (core/ui/clocks.ts), and a redraw for them alone would take the keyboard's place in the list
 * away every 30 s -- only what the time decides, the groups hidden for being inactive (`staleNames`). */
export const listSignature = (): string => {
  const h = state.home as PageHome;
  return signature([
    h.gatherers,
    h.hook_servers,
    h.hiding,
    h.titles,
    h.saved,
    h.folders,
    h.gatherer_folders,
    h.places,
    h.tasks,
    h.seen,
    h.harnesses,
    h.shells,
    h.branches,
    link.layout.paneSig(),
    link.chat.opened(selectedInfo()),
    link.list.staleNames(),
  ]);
};
/** The list drawn again only if what it draws from changed since: after an action's answer, which mostly says what the
 * page guessed and drew already -- a list drawn anew for nothing, as a drag begins, loses its row. */
export const redrawList = (): void => {
  if (listSignature() !== drawn.agents) link.list.renderAgents();
};
/** The home and the page's own pane's actor loaded again, and drawn (`userAction`: dimmed while it loads, and drawn
 * whole). */
export async function refresh(userAction = false): Promise<void> {
  const main = document.getElementById("main") as HTMLElement;
  if (userAction) main.classList.add("stale"); // dimmed only while what the reader asked for loads
  try {
    await loadHome();
    const home = state.home as PageHome;
    if (!panes.checked) link.layout.restorePanes();
    if (!state.selected) {
      const first =
        home.gatherers.find((g) => g.agents.length && !link.list.isHidden(g)) ||
        home.gatherers.find((g) => g.agents.length);
      if (first) {
        state.selected = [first.name, link.list.firstAgent(first)!.channel];
        link.layout.setAutoShown(link.layout.taskKey(...state.selected)); // shown by itself: the tab's as if empty (features/layout/panes.js's viaTabs)
      }
    }
    if (state.selected) link.layout.showActorsApp(...state.selected); // an app's actor (features/apps/app-actors.ts): its panel above
    link.layout.startTabs(); // the tab shown as it was left (features/layout/panes.js)
    await loadAgent().catch(() => {
      state.agent = null; // a session started here may have no database yet
    });
    await loadChat();
    render(userAction);
  } catch (err) {
    setLive(`Not updated: ${(err as Error).message}`);
  } finally {
    main.classList.remove("stale");
  }
}
// Draw what changed since the last draw (everything, for what the reader asked for). An update that comes while the
// reader types in a box of the old page's waits TYPING_MS after a key; the Chat view's own box (features/chat/
// Composer.tsx) keeps its draft itself, and nothing waits for it.
const TYPING_MS = 300;
let lastKey = 0,
  heldDraw: ReturnType<typeof setTimeout> | null = null;
export function render(userAction = false): void {
  if (!state.home) return;
  const since = performance.now() - lastKey;
  if (!userAction && since < TYPING_MS) {
    if (!heldDraw)
      heldDraw = setTimeout(
        () => {
          heldDraw = null;
          render();
        },
        TYPING_MS - since + 10,
      );
    return;
  }
  // not while a form in the list is open, which a redraw would empty
  if ((userAction || listSignature() !== drawn.agents) && !((state.adding || state.renaming) && !userAction))
    link.list.renderAgents();
  for (const p of allPanes()) {
    // each pane, drawn again if what it shows changed
    if (userAction || mainSignature(p) !== p.drawn.main) drawPane(p, true);
    link.layout.drawWho(p);
  }
  link.terminal.termsKept(
    allPanes()
      .map((p) => p.c)
      .filter(Boolean) as string[],
  ); // the terminals of the sessions no pane shows let go of
  setLive(
    SNAPSHOT
      ? `Snapshot · ${clock(state.home.now, true)}`
      : state.paused
        ? "Paused"
        : !state.stream
          ? "Connecting…"
          : state.stream.readyState === EventSource.OPEN
            ? `Live · updated ${clock(Date.now() / 1000)}`
            : "Reconnecting…",
  );
}
// What a pane's view draws from, of the transcript's feed (features/transcript/data.ts): while its view draws it.
const txSignatureNow = (p: Pane) => (link.chat.chatView(p).feed === "transcript" ? link.details.txSignature() : null);
/** What a pane's view draws from: drawn again only when it changed. Its actor's state among it -- its status, what it
 * waits on, why it stopped, what runs in the background (which, not how lately): a turn's end may change only that (its
 * answer's end comes after its last words, which the actor's data already had), and its "Working…" would stay. */
export const mainSignature = (p: Pane): string => {
  const info = paneInfo(p),
    events = link.details.events(),
    feed = link.chat.chatFeed(p);
  const { layout } = link;
  return signature([
    paneSel(p),
    p.agentVersion,
    info && info.session,
    info && [info.chattable, info.holder],
    info && [
      link.list.statusOf(info)[0],
      info.failing,
      info.stopped,
      info.asking,
      info.answer,
      (info.background || []).map((t) => t.id),
      info.taken_back,
    ],
    info && info.avatar_hello,
    events && [events.key, events.last_row, events.pending],
    txSignatureNow(p),
    link.chat.chatView(p).id,
    feed.signature ? feed.signature(p) : null,
    p.details,
    layout.topShown(),
    layout.chatMin(p),
    layout.canMinimize(p),
  ]);
};
/** The page's state, in the settings panel: its dot green while live, amber paused, red on an error; the logo's title
 * says it. */
export const setLive = (text: string): void => {
  (document.getElementById("live") as HTMLElement).textContent = text;
  const st = /^Live/.test(text) ? "live" : text === "Paused" ? "paused" : /^Not /.test(text) ? "error" : "";
  for (const n of document.querySelectorAll<HTMLElement>(".state-dot")) n.dataset.state = st; // the settings panel's
  (document.getElementById("about-btn") as HTMLElement).title = `Settings · ${text}`;
};
/** What was typed in an actor's message box and not sent, by actor (key()), kept in this browser tab: its box, drawn
 * again once the reader comes back from another actor or view, or reloads, starts with it (features/chat/drafts.ts). */
export const drafts = (): Record<string, string> => link.chat.drafts();
export const keepDraft = (actor: string | null | undefined, text: string): void => link.chat.keepDraft(actor, text);

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  document.addEventListener(
    "input",
    (ev) => {
      // a box of the old page's: kept and fitted here, and the page's draws held while it is typed in (render); the Chat
      // view's own (features/chat/Composer.tsx) keeps its draft itself, and nothing waits for it
      const box = ev.target as HTMLTextAreaElement | null;
      if (box && box.id === "composer-text" && !link.chat.ownBox(box)) {
        lastKey = performance.now();
        fitBox(box);
        keepDraft(box.dataset.draft, box.value);
      }
    },
    true,
  );
  startLook(); // the page's look, as kept, and the settings panel's buttons
}

export { fitBox };
export { earlierTurns, setAbout, setAvatarMode, setEarlierTurns, setTheme } from "./look";
