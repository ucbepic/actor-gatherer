// THE LIST'S OTHER SHAPES, as the page around them draws them (features/list/modes.js): the top bar's counts, the rail,
// the monitor over the whole page -- each drawn into its box at once, from its view-model, so what the page does next (its
// place measured, its cards watched) finds it drawn.
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Card, type CardHost, type CardModel } from "./Card";
import type { Totals } from "./groups";
import type { MonitorModel } from "./monitor-model";
import { Monitor, type MonitorHost } from "./Monitor";
import { Rail, type RailHost } from "./Rail";
import type { RailModel } from "./rail-model";
import { TotalsChips, totalsSaid } from "./Totals";

const roots = new Map<HTMLElement, Root>();
function rootOf(box: HTMLElement): Root {
  let r = roots.get(box);
  if (!r) {
    box.replaceChildren();
    r = createRoot(box);
    roots.set(box, r);
  }
  return r;
}

/** The top bar's counts drawn into `box`, its title naming every count. */
export function drawTotals(box: HTMLElement, t: Totals): void {
  flushSync(() => rootOf(box).render(<TotalsChips t={t} />));
  const said = totalsSaid(t).map(([k, , what]) => `${k} ${what}`);
  if (said.length) {
    box.title = said.join(" · ");
    box.setAttribute("aria-label", `Every group's actors: ${said.join(", ")}`);
  } else {
    box.removeAttribute("title");
    box.removeAttribute("aria-label");
  }
}

/** The monitor drawn into `box`, by now. */
export function drawMonitor(box: HTMLElement, m: MonitorModel, host: MonitorHost): void {
  flushSync(() => rootOf(box).render(<Monitor m={m} host={host} />));
}

/** The rail drawn into `box`, by now. */
let railDraws = 0;
export function drawRail(box: HTMLElement, m: RailModel, host: RailHost): void {
  flushSync(() => rootOf(box).render(<Rail m={m} host={host} draw={++railDraws} />));
}

/** The hover card's contents drawn into `box` (#actor-card), by now: the page places it next, by its size. */
export function drawCard(box: HTMLElement, m: CardModel, host: CardHost): void {
  flushSync(() => rootOf(box).render(<Card m={m} host={host} />));
}

/** What is drawn in `box` gone: left, nothing of it kept but what the page read. */
export function forget(box: HTMLElement): void {
  roots.get(box)?.unmount();
  roots.delete(box);
  box.replaceChildren();
}
