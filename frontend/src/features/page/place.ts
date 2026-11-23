// A pane's main view drawn again where the reader left it: the same tables open, the same lists scrolled, a list that
// follows its end kept at its end, the message box as it was (caret and all), the focus given back to what keeps its own
// node across draws (a terminal), the page's scroll.
import { panes } from "../../core/page/state";
import type { Pane } from "../../core/page/types";
import { fitBox } from "./box";

const atEnd = (n: Element) => n.scrollHeight - n.scrollTop - n.clientHeight < 40;

/** `draw` run for pane `p` (this page's own, by default), the reader's place in it kept. */
export function keepingPlace(draw: () => void, p: Pane = panes.here as Pane): void {
  const main = p.main;
  const open = [...main.querySelectorAll<HTMLDetailsElement>("details[open][id]")].map((d) => d.id);
  const scrolled = [...main.querySelectorAll<HTMLElement>("[data-keep]")].map(
    (n) => [n.dataset.keep, n.scrollTop, n.scrollLeft] as const,
  );
  // a list that follows its end (data-follow), read to its end: kept at its end as it grows
  const following = [...main.querySelectorAll<HTMLElement>("[data-follow]")].filter(atEnd).map((n) => n.dataset.keep);
  const pageY = window.scrollY;
  const box = main.querySelector<HTMLTextAreaElement>("#composer-text"),
    focused = box && document.activeElement === box;
  const typed = box ? ([box.dataset.draft, box.value, box.selectionStart, box.selectionEnd] as const) : null;
  // what keeps its own node across draws (a terminal, data-refocus) and had the focus: given it back
  const active = document.activeElement;
  const refocus = (active && active.closest && active.closest("[data-refocus]")) as
    (HTMLElement & { agFocus?: () => void }) | null;
  draw();
  if (refocus && refocus.isConnected && refocus.agFocus) refocus.agFocus();
  // the box drawn anew for the same actor: as it was, caret and all (another actor's starts with its own draft)
  const again = main.querySelector<HTMLTextAreaElement>("#composer-text");
  if (again && typed && again !== box && again.dataset.draft === typed[0]) {
    again.value = typed[1];
    fitBox(again);
    if (focused) {
      again.focus();
      again.setSelectionRange(typed[2], typed[3]);
    }
  }
  for (const id of open) {
    const d = main.querySelector<HTMLDetailsElement>(`#${CSS.escape(id)}`);
    if (d) d.open = true;
  }
  for (const [k, top, left] of scrolled) {
    const n = main.querySelector(`[data-keep="${k}"]`);
    if (n) {
      n.scrollTop = top;
      n.scrollLeft = left;
    }
  }
  for (const k of following) {
    const n = main.querySelector(`[data-keep="${k}"]`);
    if (n) n.scrollTop = n.scrollHeight;
  }
  window.scrollTo(0, pageY);
}
