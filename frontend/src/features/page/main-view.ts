// ------------------------------------------------------------------ an actor's pane, drawn
// A pane's main view is its actor's conversation (Chat's card): all of it, with the message box under it where the actor
// can be messaged here. What it is, what ag saw and did for it -- its calls, its context, the Gatherer's work -- is the
// details panel (detailsPanel), opened from the pane's head (the ⓘ), at the chat's right. The apps' panels are above
// the panes, in the top row (features/layout/top.js's topMount: a pane's chat minimized under it, or not). Each pane is
// drawn for its own actor (pane-view.ts's record): this page's own, and each beside it.
import { SNAPSHOT, state } from "../../core/page/state";
import { isShell, parse as parseKey } from "../../core/model/keys";
import { el } from "../../core/page/dom";
import { useShown } from "../../core/model/items";
import type { PageActor, Pane } from "../../core/page/types";
import { mainSignature } from "./data";
import { link } from "./link";
import { patch } from "./patch";
import { keepingPlace } from "./place";
import { allPanes, drawingIn, drawingPane, paneAt, paneInfo, paneKey } from "./pane-view";

/** Pane `p`'s main view drawn: its actor's chat card (and Details), a shell's terminal, or no actor yet. */
export function renderPane(p: Pane): void {
  const { chat, layout } = link;
  layout.topMount();
  const main = p.main,
    c = p.c;
  if (!c) {
    // no actor in it: none yet -- or, before the home has come (a reload: the actor it showed is picked again once the
    // home says it is still there), not known yet. patch(): the page's own "Loading…" kept as it is, not drawn again.
    p.controls.replaceChildren();
    const why = state.home || SNAPSHOT ? "No actors yet. Run a harness through ag and it appears here." : "Loading…";
    patch(main, [el("div", { class: "empty", text: why })]);
    return;
  }
  const x = p.close,
    shell = isShell(c);
  x.title = shell ? "Close pane (the terminal keeps running)" : "Close pane (the actor stays open)";
  x.setAttribute("aria-label", x.title);
  drawingIn(p, () => {
    if (shell) {
      patch(main, [layout.chatMin(p) ? layout.shellMini(p, c) : link.terminal.shellCard(p, c)]);
      return;
    }
    const info = paneInfo(p) || {};
    const kids = [chat.chatCard(p, info), ...(p.details && !layout.chatMin(p) ? [detailsPanel(p, info)] : [])];
    const open = new Set([...main.querySelectorAll<HTMLDetailsElement>("details[open][id]")].map((d) => d.id));
    for (const k of kids)
      if (k instanceof Element)
        for (const d of k.querySelectorAll<HTMLDetailsElement>("details[id]")) if (open.has(d.id)) d.open = true;
    patch(main, kids);
  });
}
/** A pane drawn again, where the reader left it (keepingPlace), its view's ends followed (`end`: kept at its end if it
 * was); every pane, by drawPanes. */
export function drawPane(p: Pane, end = false): void {
  const atEnd = end && link.chat.chatAtEnd(p);
  keepingPlace(() => renderPane(p), p);
  p.drawn.main = mainSignature(p);
  if (atEnd) link.chat.chatToEnd(p);
}
export const drawPanes = (): void => {
  for (const p of allPanes()) drawPane(p);
};
/** The page's own pane, drawn (what the list's select() and the old callers draw). */
export const renderMain = (): void => renderPane(drawingPane());

/** Pane `p`'s Details opened or closed; `part` (actor, context, gatherer): opened at that part of it. */
export function setDetails(p: Pane, open: boolean, part?: string): void {
  p.details = open;
  drawPane(p);
  const body = open && part && p.main.querySelector<HTMLElement>(".drawer-body"),
    at = body && body.querySelector<HTMLElement>(`#details-${part}`);
  if (body && at) body.scrollTop = at.offsetTop - body.offsetTop;
}
// The dashboard's own commands, typed in a message box: done here, not sent to the agent. Any other "/" goes to the
// agent as written -- Claude Code's own commands, skills and command files -- so the dashboard takes only these; one
// that reaches the session's terminal shows the reader that terminal (the composer's send).
//   /context   ag's context for the actor -- what the model was really sent, which under ag is not what Claude Code's
//              own /context counts -- in the details panel, beside the chat, at its Context part
const DASHBOARD_COMMANDS: Record<string, (p: Pane) => void> = { "/context": (p) => setDetails(p, true, "context") };
/** A command of the dashboard's own, typed in pane `p`'s box: done there; whether it was one. */
export function dashboardCommand(text: unknown, p: Pane): boolean {
  const run =
    DASHBOARD_COMMANDS[
      String(text ?? "")
        .trim()
        .toLowerCase()
    ];
  if (run) run(p);
  return !!run;
}
/** An Esc from outside the message box, for the actor pane `p` shows: in Chat, its panel closed (the Esc closes that).
 * While the agent asks too, as from the box: the question dismissed, as an Esc on it in its terminal -- after a click on
 * one of the card's choices among them. */
export function escapeShown(p: Pane | null): boolean {
  const info = paneInfo(p);
  return (
    !!p &&
    !!p.c &&
    !isShell(p.c) &&
    !p.details &&
    link.chat.chatView(p).id === "files" &&
    !!info &&
    link.chat.interrupt(p, info)
  );
}
export const DETAILS_TIP = "Details";
// All of it in one panel, one part under another (features/details/: React's, the same node from draw to draw): the
// history's other views and the actor's facts, then its calls (Actor), what the model was sent (Context: what `/context`
// in the message box opens, dashboardCommand), and what ag did for it (Gatherer). For the actor this page shows (the key
// pane's actor, by its key): the actor as the home has it, and what ag recorded of its calls.
const detailsHost = (p: Pane) => ({
  showView: (id: string) => {
    setDetails(p, false);
    link.chat.setChatView(p, id);
  },
});
function detailsPanel(p: Pane, info: PageActor | Record<string, never>): HTMLElement {
  const views = [...link.chat.CHAT_VIEWS.values()]
    .filter((v) => v.more)
    .map(({ id, name, description, icon }) => ({ id, name, description, icon }));
  return link.details.drawDetails(
    {
      key: paneKey(p),
      info,
      agent: p.agent,
      home: state.home,
      snapshot: !!SNAPSHOT,
      views,
      current: link.chat.chatView(p).id,
      now: Date.now() / 1000,
    },
    detailsHost(p),
  );
}
/** What the context's and size cards are drawn for, as nodes (the reader's own views: agDashboard's contextCard,
 * sizeCard): the actor of the pane being drawn, and what ag recorded of its calls. */
export const callsNow = () => {
  const p = drawingPane(),
    actor = paneKey(p);
  return { actor, gatherer: actor ? parseKey(actor).group : "", agent: p.agent, snapshot: !!SNAPSHOT };
};

/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  // the types the lists show, picked (features/details/'s chips): this page's own views of them, and the reader's, drawn
  // again -- React's draw themselves
  useShown.subscribe((now, was) => {
    if (now.types !== was.types) drawPanes();
  });
  link.details.notes.subscribe((now, was) => {
    if (now.on !== was.on) drawPanes(); // the Transcript's notes shown
  });
  // Esc closes the panel -- unless it is the message box's: there it interrupts the agent's turn (interrupt), as in its
  // terminal (and dismisses what the agent asks, as there). So does it from anywhere else on the page that nothing else
  // takes it (escapeShown), for the actor of the pane in focus -- else an Esc after a click on the actor in the list, a
  // turn or a button did nothing at all, the focus out of the box. Not typed in another box, the Editor or a terminal,
  // and nothing open that the Esc is for: a menu, a dialog (DocWriter's pop-up among them), the settings. Before the rest
  // (capture), so it knows whether the settings were open before their own Esc closes them.
  document.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key !== "Escape" || ev.defaultPrevented || ev.isComposing) return;
      const n = ev.target as HTMLElement | null;
      if (n && n.id === "composer-text") {
        const p = paneAt(n);
        if (p && p.c && !isShell(p.c) && link.chat.interrupt(p, paneInfo(p))) ev.preventDefault();
        return;
      }
      if (
        (n && n.closest && n.closest("input, textarea, select, [contenteditable], .xterm, .top-row")) ||
        document.querySelector("[role=menu]:not([hidden]), [role=dialog]:not([hidden]), dialog[open]") ||
        !(document.getElementById("about") as HTMLElement).hidden ||
        link.settings.fileOpen()
      )
        return;
      if (escapeShown(link.layout.focusedPane())) ev.preventDefault();
    },
    true,
  );
  // and Details: the pane's where the Esc is, else the pane in focus's
  document.addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement | null;
    const p = paneAt(t) || link.layout.focusedPane();
    if (
      ev.key === "Escape" &&
      p &&
      p.details &&
      !ev.defaultPrevented &&
      !(t && t.id === "composer-text") &&
      !(p.c && isShell(p.c))
    )
      setDetails(p, false);
  });
}

export { patch };
