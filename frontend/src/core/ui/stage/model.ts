// THE STAGE: any avatar's character (its picture, 64 units square at 0, 0) acting out what its turn does with the same
// tool whatever the character, so a tool always means one thing -- a book (read), a magnifying glass (search), a pencil
// and sheet (edit), a checklist (test), gears (run), a parcel sent off (ship), an hourglass (wait), little copies of it
// (team); as a call ends, slowing to a stop and putting the tool away to think (a thought by its head, its dots in the
// avatar's hue, the character moving as it does: its avatar_motion's move, and its effect round it), until the next; and
// reacting to how a call ended, what shows on its head and at the stage's corner. What it shows is worked out by step.ts,
// made here into SVG markup and its signature (drawn again the same, the one on the page is kept), and drawn by
// Stage.tsx: the one stage of the page, in Chat, a minimized pane and the list's monitor. On the page's clock
// (performance.now), so a redraw does not start an animation over.
import type * as api from "../../api/types";
import { escapeHtml } from "../html";
import { OVER, hand, propsOf } from "./props";
import {
  REACT_MS,
  WIND_MS,
  reactOf,
  reactionIn,
  splitMotion,
  stageClass,
  stageLeft,
  stageStep,
  wound,
  type Reactions,
  type Rested,
  type Shown,
} from "./step";

/** An actor, as far as the stage reads it: the home's (core/api/types.ts). */
export type StageActor = Pick<api.Actor, "channel"> &
  Partial<Pick<api.Actor, "avatar" | "avatar_hue" | "avatar_motion" | "failing" | "last">>;

/** What its turn does (work.py's summary, core/api/types.ts): the call under way (its kind), the one before, the last
 * that ended (its kind, whether it went well, when), the calls failed in a row, how many helpers it runs -- as much of it
 * as the stage is given (a turn not drawn yet: none). */
export type Work = Partial<api.Work>;

/** The words an actor at work says, in its avatar's hue (avatars/README.md's hues, assets/src/avatars/kit.py's shades):
 * its dark shade on a light page, halfway from its main shade to its light one on a dark page. */
export const HUE_INK: Record<string, [string, string]> = {
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
/** The main shade of each avatar hue (assets/src/avatars/kit.py's), for its thought's dots. */
export const HUE_MAIN: Record<string, string> = {
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

/** The actor's words in its hue: a CSS colour (light-dark), or null. */
export const inkOf = (a: { avatar_hue?: string | null } | null | undefined): string | null => {
  const ink = a && a.avatar_hue ? HUE_INK[a.avatar_hue] : null;
  return ink ? `light-dark(${ink[0]}, ${ink[1]})` : null;
};

/** The pictures a snapshot carries (its data, index.html's AG_SNAPSHOT); none on a live page. */
const snapshotAvatars = (): Record<string, string> | null => {
  const snap = (window as unknown as { AG_SNAPSHOT?: { avatars?: Record<string, string> } | null }).AG_SNAPSHOT;
  return snap ? snap.avatars || {} : null;
};

/** The actor's avatar without its circle, its character alone: where to get it (null: none to show). */
export function bareAvatar(a: { avatar?: string | null } | null | undefined): string | null {
  if (!a || !a.avatar) return null;
  const snap = snapshotAvatars();
  if (!snap) return `/avatars/${a.avatar}.svg?bare=1`;
  const svg = snap[a.avatar];
  return svg
    ? "data:image/svg+xml," + encodeURIComponent(svg.replace(/<circle cx="32" cy="32" r="32"[^>]*\/>/, ""))
    : null;
}

// What an actor's stage reacts to, once (step.ts's reactionIn), on the page's clock: one record for the whole page, so an
// actor's call that ended, or its turn over, is reacted to once whichever view draws it.
export { REACT_MS, wound };
const reacted: Reactions = new Map(); // "<channel> <what>"
export const reaction = (
  k: string,
  id: unknown,
  at: number | null | undefined,
  now = performance.now(),
): number | null => reactionIn(reacted, k, id, at, now, Date.now() / 1000);

/** The done avatar's grow-in, as far along as it is (--r, a negative delay): only if the page saw turn `turn` end -- one
 * reaction per actor, whichever view draws it (Chat, a minimized pane), so it grows once. */
export const restDelay = (a: StageActor | null | undefined, turn: unknown): string => {
  const gone = a ? reaction(`${a.channel} done`, turn, a.last) : null;
  return `-${Math.round(gone === null ? 60000 : gone)}ms`;
};

/** The character's move and the effect round it (its avatar_motion), each a CSS name or none. */
export const motionOf = (a: StageActor): [string, string] => splitMotion(a.avatar_motion);

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

/** The action's animations held where `wound` says, frame by frame until stopped: drawn already where it starts them
 * (--a). Where the page has no Web Animations API (jsdom, in the unit tests), the action plays from its start. */
export function windDown(svg: Element, since: number, from: number): void {
  if (typeof svg.getAnimations !== "function") return;
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
}

// what each actor's stage last showed (step.ts's Shown), or its turn over before it was ever shown
const shown = new Map<string, Shown | Rested>();

/** Its turn over (the done avatar, the hello): the next turn's actor arrives on the stage. */
export function stageRest(channel: string): void {
  const sh = shown.get(channel);
  if (sh) sh.done = true;
  else shown.set(channel, { done: true });
}

/** The stage now: its markup, what it shows (`sig`), how long until it is drawn again for its next moment (`left`), and,
 * musing, from when its action winds down. */
export interface StageNow {
  html: string;
  sig: string;
  left: number;
  musing: boolean;
  since: number;
  from: number;
}

/** The actor's stage at `t0` (the page's clock), acting out `w` with its picture `src`. */
export function stageOf(a: StageActor, w: Work, src: string, t0 = performance.now()): StageNow {
  const ch = a.channel;
  const e = w.ended,
    gone = reaction(`${ch} call`, e ? e.id : null, e && e.at, t0);
  const react = reactOf(e, gone);
  const s = stageStep(shown.get(ch), w, react, t0);
  shown.set(ch, s.sh);
  const { sh, look, musing, moving, since } = s;
  const href = escapeHtml(src),
    p = propsOf(look, href),
    q = moving ? propsOf(sh.was!, href) : null;
  const [move, fx] = motionOf(a);
  const cls = stageClass(s, react, w.failed, !!a.failing, t0);
  const ms = (v: number) => Math.round(v);
  const html =
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="-8 -14 102 82" aria-hidden="true" style="` +
    `--t: -${ms(t0)}ms; --r: -${ms(gone || 0)}ms; --dot: ${(a.avatar_hue && HUE_MAIN[a.avatar_hue]) || "var(--muted)"}; ` +
    `--x: -${ms(Math.min(60000, t0 - sh.at))}ms; --y: -${ms(Math.min(60000, t0 - sh.musedAt))}ms; ` +
    `--z: -${ms(Math.min(60000, t0 - sh.arrivedAt))}ms; --a: -${ms(musing ? wound(since, t0) : t0)}ms; ` +
    `--p: ${ms(Math.max(-60000, (sh.putAt ?? t0 - 60000) - t0))}ms; --b: ${ms(Math.max(-60000, sh.bubbleAt - t0))}ms">` +
    `${q && q.back ? `<g class="leave">${q.back}</g>` : ""}${p.back ? `<g class="enter">${p.back}</g>` : ""}` +
    `<g class="me${move ? ` m-${move}` : ""}"><image href="${href}" x="0" y="0" width="64" height="64"/></g>` +
    `${q && q.front ? `<g class="leave">${q.front}</g>` : ""}${p.front ? `<g class="enter">${p.front}</g>` : ""}${OVER}</svg>` +
    (fx ? `<span class="buddy f-${fx}" style="--t: -${ms(t0)}ms"><i></i><i></i><i></i></span>` : "");
  // what it shows, not when it was drawn (its clock's --t, --a): drawn again the same, the one on the page is kept --
  // also once a moment is over, its one-time animation done (popping, arriving; the tool put away faded out, `was`)
  const shows = cls
    .split(" ")
    .filter((c) => c !== "popping" && c !== "arriving")
    .join(" ");
  return {
    html,
    sig: JSON.stringify([shows, look, href, fx, a.avatar_hue]),
    left: stageLeft(s, gone, t0),
    musing,
    since,
    from: wound(since, t0),
  };
}

/** The actor before its first message: its avatar waving hello -- a hand in its hue raised beside it on the stage -- on
 * the page's clock, so a redraw does not start it over. */
export function helloOf(a: StageActor, src: string, t0 = performance.now()): { html: string; sig: string } {
  const html =
    `<svg xmlns="http://www.w3.org/2000/svg" class="stage s-hello" viewBox="-8 -14 102 82" aria-hidden="true" style="` +
    `--t: -${Math.round(t0)}ms; --dot: ${(a.avatar_hue && HUE_MAIN[a.avatar_hue]) || "var(--muted)"}">` +
    `<g class="me"><image href="${escapeHtml(src)}" x="0" y="0" width="64" height="64"/></g>` +
    `<g transform="translate(66 30) scale(1.25)"><g class="hand"><rect x="-9" y="-17.5" width="18" height="17.5" fill="none"/>` +
    `${hand("ho", 4.4, 6.1)}${hand("hf", 2.8, 5.3)}</g>` +
    `<path class="swish" d="M-12 -15q-2.2 3.4 -.6 7"/><path class="swish s2" d="M11.5 -15q2.2 3.4 .6 7"/></g></svg>`;
  return { html, sig: JSON.stringify(["hello", src, a.avatar_hue]) };
}
