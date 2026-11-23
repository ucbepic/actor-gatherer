// A SHELL (a list's shell, `shell:<id>`) in its pane: its terminal, drawn as a session's is (term.ts), and nothing else --
// no views, no details, no message box -- but, in the pane's head, its Terminate button: the shell ended, whatever runs
// in it, as by the list's ×. Not the pane's own ×, which closes the pane alone, the shell running on under its group. Its
// button opened it (the list's startShell), so here it is only listened to. Once it ends -- exited, or terminated -- its
// pane closes, as a terminal's window does (shownGone). React's: the card one root for each pane (section.chat, the same
// node from draw to draw: the page's patch() leaves it where it is), xterm's node put first in its frame, never React's;
// the head's button a root of its own in the head.
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { StrokeIcon } from "../../core/ui/Icon";
import { T, type TermPane } from "./link";
import { termFor, termListen, termWebgl } from "./term";

function Terminate({ id, icon }: { id: string; icon: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="terminate"
      data-shell={id}
      aria-label="Terminate shell"
      title="End the shell and everything running in it"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await T().closeShell(id);
        setBusy(false);
      }}
    >
      <StrokeIcon d={icon} size={14} />
      Terminate
    </button>
  );
}

/** The shell's frame, its terminal's node put in it (another shell's taken out). */
function Frame({ host }: { host: HTMLElement }) {
  const frame = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const f = frame.current!;
    if (f.firstChild !== host || f.childNodes.length !== 1) f.replaceChildren(host);
  });
  return <div ref={frame} className="chat-frame xterm-frame" />;
}

const heads = new WeakMap<HTMLElement, { node: HTMLDivElement; root: Root }>();
const cards = new WeakMap<TermPane, { node: HTMLElement; root: Root }>();
let made = 0;

/** Pane `p`'s card for shell `id`: drawn now, its node for the page to put in the pane. */
export function shellCard(p: TermPane, id: string): HTMLElement {
  let head = heads.get(p.controls);
  if (!head) {
    const node = document.createElement("div");
    node.style.display = "contents";
    head = { node, root: createRoot(node) };
    heads.set(p.controls, head);
  }
  if (p.controls.firstChild !== head.node || p.controls.childNodes.length !== 1) p.controls.replaceChildren(head.node);
  const headRoot = head.root;
  flushSync(() => headRoot.render(<Terminate key={id} id={id} icon={T().icons.power} />));
  const t = termFor(id);
  termListen(id);
  requestAnimationFrame(() => {
    // drawn into the page: opened there once, then fitted to it
    if (!t.host.isConnected) return;
    if (!t.opened) {
      t.xterm.open(t.host);
      t.opened = true;
      termWebgl(t);
      t.xterm.focus();
    }
    try {
      t.fit.fit();
    } catch {
      /* not shown */
    }
  });
  let card = cards.get(p);
  if (!card) {
    const node = document.createElement("section");
    node.className = "chat";
    node.setAttribute("aria-label", "Terminal");
    node.dataset.sig = `shell-${++made}`; // the page's patch() keeps it while it is the node there
    card = { node, root: createRoot(node) };
    cards.set(p, card);
  }
  const root = card.root;
  flushSync(() => root.render(<Frame host={t.host} />));
  return card.node;
}

/** The shell a pane shows ended, or the actor it shows discarded (the list's discardSession): its pane closed -- the
 * page's own, the next pane's actor moved into it, or with none, its group's first actor shown, else the first group's. */
export function shownGone(sid: string): void {
  const page = T();
  for (const p of [...page.others()]) if (p.c === sid) page.closePane(p);
  const sel = page.selected();
  if (!sel || sel[1] !== sid) return;
  if (page.others().length) return page.closeHere();
  const shown = page.shownGroups();
  const g = shown.find((x) => x.name === sel[0]) || shown[0];
  const first = g && page.firstAgent(g);
  if (g && first) {
    void page.select(g.name, first.channel);
    return;
  }
  page.clearSelected();
  page.savePanes();
  page.connect();
  page.render(true);
}
