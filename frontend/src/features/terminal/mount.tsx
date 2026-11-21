// The Terminal view (ag_dashboard/DESIGN.md, A5) in its frame (core/ui/frame.tsx), for the actor the page hands it:
// xterm's node first in the frame -- the same node from draw to draw, never React's: xterm.js draws in it -- and React's
// cover after it.
import { viewFrame } from "../../core/ui/frame";
import { Cover, type TermFrame } from "./TerminalView";

/** The view's frame, drawn now, `host` (the terminal's node; none: no terminal) first in it: its node, for the page to
 * put where it goes. */
export function drawTerminal(f: TermFrame, host: HTMLElement | null, name: string): HTMLDivElement {
  const node = viewFrame("terminal", "xterm-frame", name, <Cover key={f.key} f={f} />);
  // another session's terminal, dropped since (term.ts's termFor), out; this one's first, before the cover
  for (const n of [...node.querySelectorAll(":scope > .xterm-host")]) if (n !== host) n.remove();
  if (host && node.firstChild !== host) node.insertBefore(host, node.firstChild);
  return node;
}
