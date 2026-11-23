// Each harness as harness_kit describes it (data.py's `harness_info`), by its name, read from the page's home
// (core/model/harness.ts): the page names none itself. A session that names none is the home's `harness_default`'s.
import {
  canChat,
  harnessLabel,
  harnessOf,
  runnableNames as runnableNamesIn,
  runsHere as runsHereIn,
} from "../model/harness";
import { svgEl } from "./dom";
import { state } from "./state";
import type { PageActor, PageHarness } from "./types";

type Home = Parameters<typeof harnessOf>[0];
const home = (): Home => state.home as unknown as Home;

/** What the home says of harness `h`; null for one it does not know. */
export const harnessInfo = (h: string | null | undefined): PageHarness | null =>
  harnessOf(home(), h) as PageHarness | null;
/** Its name for a person. */
export const harnessName = (h: string | null | undefined): string => harnessLabel(home(), h);

// Each harness's mark (harness_kit/marks/<name>.svg): its logo, white, on its colour, in a 24x24 circle -- as a badge
// at the corner of an actor's avatar, on what starts one, and alone for an actor with no avatar. One harness_kit has
// no mark for: a grey circle with "?".
const HARNESS_MARKS = new Map<string, SVGSVGElement | null>(); // each mark's SVG, parsed once
function harnessMark(h: string | null | undefined, cls: string): SVGSVGElement {
  const info = harnessInfo(h);
  let src = info && info.mark ? HARNESS_MARKS.get(info.mark) : null;
  if (info && info.mark && src === undefined) {
    const root = new DOMParser().parseFromString(info.mark, "image/svg+xml").documentElement;
    HARNESS_MARKS.set(info.mark, (src = root && root.nodeName === "svg" ? (root as unknown as SVGSVGElement) : null));
  }
  let svg: SVGSVGElement;
  if (src) svg = document.importNode(src, true);
  else {
    svg = svgEl("svg", { viewBox: "0 0 24 24" });
    const t = svgEl("text", {
      x: 12,
      y: 16,
      "text-anchor": "middle",
      fill: "#fff",
      "font-size": 12,
      "font-weight": 700,
      "font-family": "system-ui, sans-serif",
    });
    t.textContent = "?";
    svg.append(svgEl("circle", { cx: 12, cy: 12, r: 12, fill: "#898781" }), t);
  }
  svg.querySelectorAll("title").forEach((t) => t.remove());
  const title = svgEl("title");
  title.textContent = harnessName(h);
  svg.prepend(title);
  for (const [k, v] of Object.entries({ class: cls, role: "img", "aria-label": harnessName(h) }))
    svg.setAttribute(k, v);
  return svg;
}
/** Harness `h`'s mark alone: an actor with no avatar's. */
export const harnessLogo = (h: string | null | undefined): SVGSVGElement => harnessMark(h, "logo");
/** Harness `h`'s mark as a badge, at the corner of an avatar or on what starts one. */
export const harnessBadge = (h: string | null | undefined): SVGSVGElement => harnessMark(h, "badge");

// Whether an actor can be messaged here: a session the page started, or any session of a harness the dashboard runs
// (harness_kit's, that says how to start it: `runs`) with a directory to resume it in. Its message box works while no
// other process has it open (data.py's `chattable`).
/** Whether the dashboard runs harness `h`. */
export const runsHere = (h: string | null | undefined): boolean => runsHereIn(home(), h);
/** Whether actor `a` can be messaged here. */
export const hasChat = (a: PageActor | null | undefined): boolean => canChat(home(), a);
/** The harnesses the dashboard runs, by their names for a person: "Claude Code, Codex or Antigravity". */
export const runnableNames = (join: string): string => runnableNamesIn(home(), join);
