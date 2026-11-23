// An actor's avatar as the page draws it beside its words: at work (the stage, or small with its one motion), done at
// its turn's end, waving hello before its first message; and the words it says, in its hue.
import { escapeHtml } from "../ui/html";
import { el, signature } from "./dom";
import { doneCheck } from "./icons";
import { HUE_MAIN, reaction, stage } from "./stage";
import { motionOf } from "./stage-model";
import { SNAPSHOT } from "./state";
import type { PageActor, Work } from "./types";

// The words an actor at work says, in its avatar's hue (avatars/README.md's hues, assets/src/avatars/kit.py's
// shades): its dark shade on a light page, halfway from its main shade to its light one on a dark page.
export const HUE_INK: Readonly<Record<string, readonly [string, string]>> = {
  red: ["#b91c1c", "#f57474"],
  orange: ["#c2410c", "#fb9645"],
  yellow: ["#b45309", "#fcd257"],
  lime: ["#4d7c0f", "#aee259"],
  green: ["#166534", "#54ca83"],
  teal: ["#0f766e", "#56d7c5"],
  sky: ["#0369a1", "#79d1fa"],
  blue: ["#1e40af", "#7095f9"],
  purple: ["#5b21b6", "#a788f9"],
  pink: ["#be185d", "#f7a0cf"],
  brown: ["#6b4226", "#c1966c"],
  gray: ["#334155", "#aab4c2"],
};
/** Actor `a`'s words' colour, as a style; null for an actor with no hue. */
export const hueInk = (a: PageActor | null | undefined): string | null => {
  const ink = a && HUE_INK[a.avatar_hue ?? ""];
  return ink ? `color: light-dark(${ink[0]}, ${ink[1]})` : null;
};
export { HUE_MAIN };

/** The actor's avatar without its circle, its character alone: where to get it (none to show: null, or in a snapshot
 * that has not its picture, nothing). */
export function bareAvatar(a: PageActor | null | undefined): string | null | undefined {
  const svg = SNAPSHOT && a && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
  return !a || !a.avatar
    ? null
    : SNAPSHOT
      ? svg && "data:image/svg+xml," + encodeURIComponent(svg.replace(/<circle cx="32" cy="32" r="32"[^>]*\/>/, ""))
      : `/avatars/${a.avatar}.svg?bare=1`;
}

/** The done avatar's grow-in, as far along as it is (--r, a negative delay): only if the page saw turn `turn` end --
 * one reaction per actor, whichever view draws it (Chat, a minimized pane: features/chat/mini-history.js), so it grows
 * once. */
export const restDelay = (a: PageActor | null | undefined, turn: unknown): string => {
  const gone = a ? reaction(`${a.channel} done`, turn, a.last) : null;
  return `--r: -${Math.round(gone === null ? 60000 : gone)}ms`;
};
/** The actor done, at its turn's end in the Chat view: its avatar small, still, a check at its corner -- grown in, if
 * the page saw the turn end. */
export function atRest(a: PageActor | null | undefined, turn: unknown): HTMLSpanElement {
  const src = bareAvatar(a);
  if (a) stage.rest(a.channel);
  return el(
    "span",
    { class: "done", style: restDelay(a, turn), "data-sig": signature([src, turn]) },
    src ? el("img", { src, alt: "", draggable: "false" }) : null,
    el("span", { class: "ok" }, doneCheck()),
  );
}

/** How an actor at work is drawn: "acting" (the stage) or "simple"; set by features/page/look.ts's setAvatarMode, kept
 * in this browser. */
export let avatarMode = "acting";
export const keepAvatarMode = (pick: string): void => {
  avatarMode = pick;
};

/** The actor at work, small: its avatar's character out of its circle, moving as it does (its avatar_motion: a move,
 * then an effect round it, if any -- the .buddy CSS), on the page's clock so a redraw does not start it over; `still`,
 * its calls failing: not moving. */
export function buddy(a: PageActor, still: boolean): HTMLSpanElement {
  const [move, fx] = motionOf(a.avatar_motion);
  return el(
    "span",
    {
      class: ["buddy", move && `m-${move}`, fx && `f-${fx}`, still && "still"].filter(Boolean).join(" "),
      style: `--t: -${Math.round(performance.now())}ms`,
      "aria-hidden": "true",
      "data-sig": signature([bareAvatar(a), move, fx, !!still]),
    },
    el("img", { src: bareAvatar(a), alt: "", draggable: "false" }),
    ...(fx ? [el("i"), el("i"), el("i")] : []),
  );
}

/** The actor at work in the Chat view: its avatar acting out its turn -- `t`, the turn, its `work` (work.py's summary)
 * -- on the stage; or, the setting "Simple" (avatarMode), buddy()'s one motion. An actor with no avatar has the turning
 * glyph. */
export function atWork(a: PageActor, t: { work?: Work | null } | null | undefined): HTMLSpanElement {
  const src = bareAvatar(a);
  if (!src) return el("span", { class: "spin", "aria-hidden": "true" });
  return avatarMode === "simple" ? buddy(a, !!a.failing) : stage(a, (t && t.work) || {}, src);
}

// The actor before its first message, in the Chat view: its avatar waving hello -- a hand in its hue, its wrist at 0, 0
// (HAND: its fingers and thumb, each a line), raised beside it on the stage; or, the setting "Simple" (avatarMode),
// buddy()'s one motion. On the page's clock, so a redraw does not start it over. Its first turn's actor then arrives on
// the stage (stage.rest). An actor with no avatar: none. What it says, under it waving: src/features/chat/Hello.tsx.
const HAND = [
  [-3.4, -8, -4.9, -14.6],
  [-1.1, -9, -1.6, -16.6],
  [1.3, -9, 1.7, -16.2],
  [3.4, -7.6, 4.8, -13.4],
  [-3.8, -4.6, -8.4, -8.2],
];
export function greeting(a: PageActor): HTMLSpanElement | null {
  const src = bareAvatar(a);
  if (!src) return null;
  stage.rest(a.channel);
  if (avatarMode === "simple") return buddy(a, false);
  const hand = (cls: string, w: number, r: number) =>
    `<g class="${cls}">${HAND.map(
      ([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`,
    ).join("")}<circle cy="-5.6" r="${r}" stroke="none"/></g>`;
  const box = el("span", { class: "stage-box", "data-sig": signature(["hello", src, a.avatar_hue]) }); // kept while the same
  box.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" class="stage s-hello" viewBox="-8 -14 102 82" aria-hidden="true" style="` +
    `--t: -${Math.round(performance.now())}ms; --dot: ${HUE_MAIN[a.avatar_hue ?? ""] || "var(--muted)"}">` +
    `<g class="me"><image href="${escapeHtml(src)}" x="0" y="0" width="64" height="64"/></g>` +
    `<g transform="translate(66 30) scale(1.25)"><g class="hand"><rect x="-9" y="-17.5" width="18" height="17.5" fill="none"/>` +
    `${hand("ho", 4.4, 6.1)}${hand("hf", 2.8, 5.3)}</g>` +
    `<path class="swish" d="M-12 -15q-2.2 3.4 -.6 7"/><path class="swish s2" d="M11.5 -15q2.2 3.4 .6 7"/></g></svg>`;
  return box;
}
