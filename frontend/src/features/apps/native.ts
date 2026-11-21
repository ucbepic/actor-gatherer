// The native pages of the apps that ask for them (app_kit's `native_view`), in the ag desktop app (desktop/DESIGN.md,
// "A tab in its pane"): each frame, where each panel asks its page kept (ag.native.show) -- the panel's place offset by
// its frame's, clipped to it -- and whether something of the dashboard's is over it (at some point of it, the frame
// isn't on top: a menu, a hover card, Settings), told the desktop app, which keeps each page there, or a still picture
// of it while it is covered (drawn by the panel: AppPane's `still`).
import type { AppPane } from "./host";

/** Where a panel asks a native page kept: in its frame's coordinates, and whether the panel covers it. */
export interface NativePlace {
  target: string;
  x: number;
  y: number;
  w: number;
  h: number;
  covered: boolean;
}
/** The ag desktop app, as its preload tells the page of it (desktop/src/preload.cts), when the page runs in it. */
interface Desktop {
  native?: boolean;
  place?: (stages: Record<string, unknown>[]) => void;
  onStill?: (cb: (still: { target: string; url: string | null }) => void) => void;
  stillDrawn?: (target: string) => void;
  focusDashboard?: () => void;
  /** The system's spellchecker on a word (the one underlining words in text boxes): null for no word. */
  spelling?: (word: string) => { misspelled: boolean; suggestions: string[] } | null;
  /** A word added to the user's dictionary, the system's. */
  learn?: (word: string) => void;
}
export const desktop = (): Desktop | null => {
  const d = (window as unknown as { agApp?: Desktop }).agApp;
  return d && d.native && typeof d.place === "function" ? d : null;
};

export const nativePanes = new Set<AppPane>();
const GRID = 5;
// What floats over the panels, class "floats" -- the hover card of the rail and the list, the hidden list slid out
// (features/list/modes.js): looked at by its box, over a page's place while it shows. elementFromPoint looks past one the
// pointer passes through (pointer-events: none, as an actor's card), and the grid's points past one over a corner of the
// place only. Its box where it comes to rest: its own slide (a translation of it) left out -- the hidden list's, out or
// back, covers the pages under where it goes from the start, and till it is gone.
const floating = typeof document === "undefined" ? null : document.getElementsByClassName("floats");
type Box = { left: number; top: number; right: number; bottom: number };
/** Where `n` rests: its box, less its own translation (computed: "matrix(a, b, c, d, e, f)" or "matrix3d(...)"). */
function restBox(n: Element): Box {
  const b = n.getBoundingClientRect();
  const m = /^matrix(3d)?\((.*)\)$/.exec(getComputedStyle(n).transform || "");
  if (!m) return b;
  const v = m[2].split(",").map(Number);
  const dx = (m[1] ? v[12] : v[4]) || 0,
    dy = (m[1] ? v[13] : v[5]) || 0;
  return { left: b.left - dx, top: b.top - dy, right: b.right - dx, bottom: b.bottom - dy };
}
const meets = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/** Whether something floating shows over the box from (x0, y0) to (x1, y1). */
function floatsOver(x0: number, y0: number, x1: number, y1: number): boolean {
  for (const n of floating || [])
    if (n.checkVisibility() && meets(restBox(n), { left: x0, top: y0, right: x1, bottom: y1 })) return true;
  return false;
}
// Each page's place, at the last look (the page's pixels); and the pages out of sight under their still pictures: each
// told covered, its picture drawn by its panel since (on which the desktop app hides the page) -- forgotten once told
// uncovered, or its picture gone.
const placed = new Map<string, Box & { covered: boolean }>();
const pictured = new Set<string>();
/** Page `target`'s still picture drawn in its panel: the desktop app told, to hide the page. */
export function stillDrawn(target: string): void {
  if (placed.get(target)?.covered) pictured.add(target);
  desktop()?.stillDrawn?.(target);
}
// frames after the last picture is drawn before the pages are surely hidden: the app hides each on its panel's word,
// a few ms after (desktop/src/browsers.ts's `stillDrawn`)
const HIDE_FRAMES = 2;
/** `then` once no native page is drawn over where `node` rests: at once if none is under it (outside the desktop app,
 * never one), else once each one under it is out of sight under its picture -- `node` must float (class "floats") for
 * them to be covered -- or after `wait` ms at the most (a page with no picture to be had stays drawn: the app's `bare`).
 * Returns a way to call it off. For what slides out over the panes (the hidden list): out over the pages, not under. */
export function onceUncovered(node: Element, wait: number, then: () => void): () => void {
  const under = () => [...placed].filter(([, b]) => meets(b, restBox(node))).map(([t]) => t);
  if (!desktop() || under().every((t) => pictured.has(t))) {
    then();
    return () => {};
  }
  let frames = HIDE_FRAMES,
    ask = 0;
  const done = () => {
    cancelAnimationFrame(ask);
    clearTimeout(timer);
    then();
  };
  const look = () => {
    if (under().every((t) => pictured.has(t)) && --frames <= 0) return done();
    ask = requestAnimationFrame(look);
  };
  const timer = setTimeout(done, wait);
  nativeSoon();
  ask = requestAnimationFrame(look);
  return () => {
    cancelAnimationFrame(ask);
    clearTimeout(timer);
  };
}
let nativeTold = "";
let nativeLoop = 0; // the frame the next look is asked for: one at a time
export function nativeSoon(): void {
  if (!nativeLoop && desktop()) nativeLoop = requestAnimationFrame(nativeFrame);
}
function nativeFrame(): void {
  // a look not in a frame (the interval's) takes the place of the frame's: each look asks for the next, so one left
  // waiting would be a second loop of looks every frame -- the interval's every 250 ms added one, all kept until the
  // panes were gone, hundreds of looks a frame after a minute
  if (nativeLoop) cancelAnimationFrame(nativeLoop);
  nativeLoop = 0;
  const d = desktop();
  if (!d) return;
  const stages: Record<string, unknown>[] = [];
  placed.clear();
  for (const pane of nativePanes) {
    const p = pane.native,
      f = pane.frame;
    if (!p || !f.isConnected || !f.checkVisibility()) continue;
    const r = f.getBoundingClientRect();
    const fx = r.left + f.clientLeft,
      fy = r.top + f.clientTop;
    const x0 = Math.max(fx, fx + p.x),
      y0 = Math.max(fy, fy + p.y);
    const x1 = Math.min(fx + f.clientWidth, fx + p.x + p.w),
      y1 = Math.min(fy + f.clientHeight, fy + p.y + p.h);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    let covered = p.covered || floatsOver(x0, y0, x1, y1);
    for (let i = 0; i < GRID && !covered; i++)
      for (let j = 0; j < GRID && !covered; j++) {
        const hit = document.elementFromPoint(x0 + ((x1 - x0) * (i + 0.5)) / GRID, y0 + ((y1 - y0) * (j + 0.5)) / GRID);
        if (hit && hit !== f) covered = true;
      }
    placed.set(p.target, { left: x0, top: y0, right: x1, bottom: y1, covered });
    if (!covered) pictured.delete(p.target); // (shown again by the app at once)
    stages.push({
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      target: p.target,
      covered,
      app: pane.app.name,
      key: pane.instance.id,
    });
  }
  const now = JSON.stringify(stages);
  if (now !== nativeTold) {
    nativeTold = now;
    d.place?.(stages);
  }
  if (nativePanes.size) nativeLoop = requestAnimationFrame(nativeFrame);
}
if (typeof window !== "undefined") {
  setInterval(() => nativePanes.size && nativeFrame(), 250); // (frames stop while the window is hidden or covered)
  const d = desktop();
  d?.onStill?.((still) => {
    if (!still.url) pictured.delete(still.target);
    for (const pane of nativePanes) if (pane.native?.target === still.target) pane.still(still.target, still.url);
  });
}
