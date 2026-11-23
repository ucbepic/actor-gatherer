// The stage: any avatar's character (its picture, 64 units square at 0, 0) acting out what its turn does with the same
// tool whatever the character, so a tool always means one thing (stage-props.ts); as a call ends, slowing to a stop and
// putting the tool away to think (a thought by its head, its dots in the avatar's hue, the character moving as it does:
// its avatar_motion's move, and its effect round it), until the next; and reacting to how a call ended, what shows on
// its head and at the stage's corner. What it shows is worked out by stage-model.ts; drawn here.
import { escapeHtml } from "../ui/html";
import { el, signature } from "./dom";
import { OVER, props } from "./stage-props";
import {
  REACT_MS,
  WIND_MS,
  motionOf,
  reactOf,
  reactionIn,
  stageClass,
  stageLeft,
  stageStep,
  wound,
  type Reactions,
  type Rested,
  type Shown,
} from "./stage-model";
import type { PageActor, Work } from "./types";

export { REACT_MS };

const reacted: Reactions = new Map(); // "<channel> <what>" -> {id, start (performance.now())}
/** What an actor's stage reacts to, once (stage-model.ts's reactionIn), on the page's clock. */
export const reaction = (k: string, id: unknown, at: number | null | undefined): number | null =>
  reactionIn(reacted, k, id, at, performance.now(), Date.now() / 1000);

/** The main shade of each avatar hue (assets/src/avatars/kit.py's), for its thought's dots. */
export const HUE_MAIN: Readonly<Record<string, string>> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#fbbf24",
  lime: "#84cc16",
  green: "#22a55a",
  teal: "#14b8a6",
  sky: "#38bdf8",
  blue: "#3b6cf6",
  purple: "#8b5cf6",
  pink: "#f472b6",
  brown: "#a0683a",
  gray: "#64748b",
};

// the action's animations, held where `wound` says as a call ends
const WINDS = new Set([
  "w-read",
  "w-flip",
  "w-search",
  "w-sweep",
  "w-glint",
  "w-edit",
  "w-l1",
  "w-l2",
  "w-l3",
  "w-pen",
  "w-test",
  "w-tk0",
  "w-tk1",
  "w-tk2",
  "w-run",
  "w-gear",
  "w-ship",
  "w-parcel",
  "w-arrow",
  "w-wait",
  "w-stream",
  "w-hg",
  "w-st",
  "w-sb",
  "w-team",
  "w-scurry",
]);
// the action's animations held where `wound` says, frame by frame until stopped: drawn already where it starts them (--a)
const windDown = (svg: Element, since: number, from: number) => {
  const anims = svg
    .getAnimations({ subtree: true })
    .filter((x) => WINDS.has((x as CSSAnimation).animationName)) as CSSAnimation[];
  for (const x of anims) x.pause();
  const step = () => {
    if (!svg.isConnected) return;
    const now = performance.now();
    for (const x of anims) x.currentTime = wound(since, now) - from;
    if (now - since < WIND_MS) requestAnimationFrame(step);
  };
  step();
};

/** A stage's box, and how long until it shows something else of itself (ms; 0: nothing due). */
type StageBox = HTMLSpanElement & { agLeft?: number };

// what each actor's stage last showed (stage-model.ts's Shown), or its turn over before it was ever shown
const shown = new Map<string, Shown | Rested>();

/** Actor `a` at work, `w` its turn's work (work.py's summary), `src` its bare picture: its stage, drawn now. */
function drawStage(a: PageActor, w: Partial<Work>, src: string): StageBox {
  const ch = a.channel;
  const e = w.ended,
    gone = reaction(`${ch} call`, e ? e.id : null, e && e.at);
  const react = reactOf(e, gone);
  const t0 = performance.now();
  const s = stageStep(shown.get(ch), w, react, t0);
  shown.set(ch, s.sh);
  const { sh, look, musing, moving, since } = s;
  const href = escapeHtml(src),
    p = props(look, href),
    q = moving ? props(sh.was as string, href) : null;
  const [move, fx] = motionOf(a.avatar_motion);
  const cls = stageClass(s, react, w.failed, !!a.failing, t0);
  const box: StageBox = el("span", { class: "stage-box" });
  box.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="-8 -14 102 82" aria-hidden="true" style="` +
    `--t: -${Math.round(t0)}ms; --r: -${Math.round(gone || 0)}ms; --dot: ${HUE_MAIN[a.avatar_hue ?? ""] || "var(--muted)"}; ` +
    `--x: -${Math.round(Math.min(60000, t0 - sh.at))}ms; --y: -${Math.round(Math.min(60000, t0 - sh.musedAt))}ms; ` +
    `--z: -${Math.round(Math.min(60000, t0 - sh.arrivedAt))}ms; --a: -${Math.round(musing ? wound(since, t0) : t0)}ms; ` +
    `--p: ${Math.round(Math.max(-60000, (sh.putAt ?? t0 - 60000) - t0))}ms; --b: ${Math.round(Math.max(-60000, sh.bubbleAt - t0))}ms">` +
    `${q && q.back ? `<g class="leave">${q.back}</g>` : ""}${p.back ? `<g class="enter">${p.back}</g>` : ""}` +
    `<g class="me${move ? ` m-${move}` : ""}"><image href="${href}" x="0" y="0" width="64" height="64"/></g>` +
    `${q && q.front ? `<g class="leave">${q.front}</g>` : ""}${p.front ? `<g class="enter">${p.front}</g>` : ""}${OVER}</svg>`;
  if (fx)
    box.append(el("span", { class: `buddy f-${fx}`, style: `--t: -${Math.round(t0)}ms` }, el("i"), el("i"), el("i")));
  // what it shows, not when it was drawn (its clock's --t, --a): drawn again the same, the one on the page is kept --
  // also once a moment is over, its one-time animation done (popping, arriving; the tool put away faded out, `was`):
  // the one kept looks the same
  const shows = cls
    .split(" ")
    .filter((c) => c !== "popping" && c !== "arriving")
    .join(" ");
  box.dataset.sig = signature([shows, look, href, fx, a.avatar_hue]);
  const svg = box.firstElementChild as Element;
  if (musing) requestAnimationFrame(() => windDown(svg, since, wound(since, t0))); // once drawn: its animations exist
  const left = stageLeft(s, gone, t0); // put away: drawn thinking
  // over: drawn as it is now -- the one shown kept if it shows the same, to look again when what is next is due
  box.agLeft = left;
  const again = () => {
    if (!box.isConnected) return;
    const next = drawStage(a, w, src);
    if (next.dataset.sig !== box.dataset.sig) box.replaceWith(next);
    else if (next.agLeft) setTimeout(again, next.agLeft + 30);
  };
  if (left) setTimeout(again, left + 30);
  return box;
}

/** Actor `a`'s stage, acting out its turn's work `w` (its bare picture `src`); `stage.rest(channel)`: its turn over
 * (atRest), the next turn's actor arrives. */
export const stage = Object.assign(drawStage, {
  rest: (ch: string) => {
    const sh = shown.get(ch);
    if (sh) sh.done = true;
    else shown.set(ch, { done: true });
  },
});
