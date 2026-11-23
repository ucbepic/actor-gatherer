// The server's stream for the selected agent: `home`, `agent` and `chat` (what Chat shows of it) at once, then each time
// one changes (the server is woken by ag's notifications). It reconnects by itself, as an EventSource does, and a new
// stream starts with both again, so nothing is missed while it was down. Reopened when the selection changes; closed
// while paused. A message for an agent no longer selected is dropped. It goes on the page's one WebSocket with its other
// streams (src/core/api/stream.ts), not on one of the six connections a browser keeps open to a server. The other
// panes' actors come on it too (`also`, each an `actor`: its calls and what Chat shows of it), each for the pane showing
// it: one stream for the page, the home read once.
import { stream } from "../../core/api/stream";
import { isShell } from "../../core/model/keys";
import { SNAPSHOT, panes, state } from "../../core/page/state";
import type { At, PageHome, Pane } from "../../core/page/types";
import { loadAgent, loadChat, render, setLive, takeAgent } from "./data";
import { link } from "./link";
import { allPanes } from "./pane-view";

/** The page's stream opened again: for the actor of its own pane and the other panes' (none while paused). */
export function connect(): void {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  if (SNAPSHOT || state.paused) return;
  const sel = state.selected,
    also = link.layout.actorPanes().filter((p) => !isShell(p.c)); // a shell: nothing to stream but its terminal
  const q = [
    ...(sel && !isShell(sel[1])
      ? [`gatherer=${encodeURIComponent(sel[0])}`, `channel=${encodeURIComponent(sel[1])}`]
      : []),
    ...(also.length ? [`also=${encodeURIComponent(JSON.stringify(also.map((p) => [p.g, p.c])))}`] : []),
  ];
  const es = stream("/api/stream" + (q.length ? "?" + q.join("&") : ""));
  state.stream = es;
  const mine = () => state.stream === es;
  const data = (ev: Event) => (ev as MessageEvent<string>).data;
  es.addEventListener("home", (ev) => {
    if (mine()) streamTake("home", data(ev), mine);
  });
  es.addEventListener("agent", (ev) => {
    if (mine()) streamTake("agent", data(ev), mine, sel);
  });
  es.addEventListener("chat", (ev) => {
    if (mine()) streamTake("chat", data(ev), mine, sel);
  });
  es.addEventListener("actor", (ev) => {
    if (mine()) streamTake("actor", data(ev), mine);
  });
  es.addEventListener("open", () => {
    if (mine()) render();
  });
  es.addEventListener("error", () => {
    if (mine() && !state.paused) setLive("Reconnecting…");
  });
}

// What the stream says, one message at a time, in order: the home, the agent of `sel` (this page's own pane's actor), and
// each other pane's actor (`actor`: its calls, and what Chat shows of it).
let streamQueue = Promise.resolve();
export function streamTake(name: string, data: string, mine: () => boolean = () => true, sel: At | null = null): void {
  streamQueue = streamQueue.then(async () => {
    if (!mine() || state.paused) return;
    try {
      const got = JSON.parse(data);
      if (name === "home") {
        const home = got as PageHome;
        link.list.takeHome(home);
        await loadedSoon(Promise.all(allPanes().map((p) => loadChat(p)))); // a session's state: its messages may have moved on too
        if (!panes.checked) link.layout.restorePanes(); // (come before refresh's answer: what the page kept, first)
        if (!state.selected) {
          // the first agent to appear: shown, and watched
          const first = home.gatherers.find((g) => g.agents.length);
          if (first) {
            state.selected = [first.name, link.list.firstAgent(first)!.channel];
            link.layout.setAutoShown(link.layout.taskKey(...state.selected)); // shown by itself: the tab's as if empty (features/layout/panes.js's viaTabs)
            link.layout.showActorsApp(...state.selected); // an app's actor: its panel above (features/apps/app-actors.ts)
            await loadAgent();
            render(true);
            connect();
          }
        }
        link.layout.startTabs(); // the tab shown as it was left (features/layout/panes.js)
      } else if (name === "chat") {
        // what Chat shows of the actor: drawn as it comes, nothing to load
        if (!sel || !link.layout.isAt(state.selected, ...sel)) return;
        link.chat.takeChatView(sel[0], sel[1], got);
      } else {
        const [g, c, agent] = name === "actor" ? [got.gatherer, got.channel, got.agent] : [...(sel || []), got];
        const ps: Pane[] =
          name === "actor"
            ? link.layout.actorPanes().filter((p) => link.layout.isAt([p.g as string, p.c as string], g, c))
            : link.layout.isAt(state.selected, g, c)
              ? [panes.here as Pane]
              : [];
        if (!ps.length) return; // for an actor no longer shown
        if (name === "actor" && got.chat) link.chat.takeChatView(g, c, got.chat);
        await loadedSoon(Promise.all(ps.flatMap((p) => [takeAgent(agent, p), loadChat(p)]))); // takeAgent keeps the agent at once
      }
      render();
    } catch (err) {
      setLive(`Not updated: ${(err as Error).message}`);
    }
  });
}

// What a stream message loads besides what it says -- the conversation (loadChat), the context of the agent's newest call
// (takeAgent) -- waited on at most LOAD_WAIT_MS before what it says is drawn, then drawn again once it is loaded. A load
// held up never holds back the actor's status, which the stream brings itself: a browser keeps six connections to a
// server, and the page's streams (its own, a terminal's, the Editor's, its preview's) may hold them all, so a fetch waits
// for one to close -- Chat showed a turn done while its terminal, already streaming, worked on, until some stream closed.
// Messages after it are taken meanwhile, not waiting on loads of their own while one is held up (`held`): theirs would
// be too. A load finishes in its own time, and what it brought is drawn then.
const LOAD_WAIT_MS = 400;
let held = 0; // loads still under way past their wait
function loadedSoon(work: Promise<unknown>): Promise<void> {
  let now = "waiting"; // then "done" in time, or "late"
  const late = () => {
    if (now === "waiting") {
      now = "late";
      held++;
    }
  };
  const done = work
    .then(
      () => {},
      () => {},
    )
    .then(() => {
      if (now === "late") {
        held--;
        render();
      }
      now = "done";
    });
  if (held) {
    late();
    return Promise.resolve();
  }
  return Promise.race([
    done,
    new Promise<void>((r) =>
      setTimeout(() => {
        late();
        r();
      }, LOAD_WAIT_MS),
    ),
  ]);
}
