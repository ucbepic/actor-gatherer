// THE STAGE: any avatar's character (its picture, 64 units square at 0, 0) acting out what its turn does with the same
// tool whatever the character, so a tool always means one thing -- a book (read), a magnifying glass (search), a pencil
// and sheet (edit), a checklist (test), gears (run), a parcel sent off (ship), an hourglass (wait), little copies of it
// (team); as a call ends, slowing to a stop and putting the tool away to think (a thought by its head, its dots in the
// avatar's hue, the character moving as it does: its avatar_motion's move, and its effect round it), until the next; and
// reacting to how a call ended, what shows on its head and at the stage's corner. Worked out here as SVG markup and what
// it shows (its signature: drawn again the same, the one on the page is kept); drawn by Stage.tsx. On the page's clock
// (performance.now), so a redraw does not start an animation over.
import { escapeHtml } from "../html";
import { OVER, hand, propsOf } from "./props";

/** An actor, as far as the stage reads it. */
export interface StageActor {
  channel: string;
  avatar?: string | null;
  avatar_hue?: string | null;
  avatar_motion?: string | null;
  failing?: unknown;
  last?: number | null;
}

/** What its turn does (work.py's summary): the call under way (its kind), the one before, the last that ended (its kind,
 * whether it went well, when), the calls failed in a row, how many helpers it runs. */
export interface Work {
  doing?: string | null;
  last?: string | null;
  ended?: { id: string; kind?: string; ok?: boolean; at?: number } | null;
  failed?: number;
  helpers?: number;
}

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

// What an actor's stage reacts to, once: a call that ended, its turn over (`id`: which; null, none). Started when the page
// sees it change -- or, seen on first drawing the actor, from when it happened, if that was lately; null once over.
export const REACT_MS = 3200;
const REACT_LATE = 6;
const reacted = new Map<string, { id: unknown; start: number }>(); // "<channel> <what>"
export function reaction(
  k: string,
  id: unknown,
  at: number | null | undefined,
  now = performance.now(),
): number | null {
  id = id === undefined ? null : id;
  let r = reacted.get(k);
  if (!r || r.id !== id) {
    const late = Math.max(0, Date.now() / 1000 - (at || 0));
    r = { id, start: r ? now : late < REACT_LATE ? now - late * 1000 : -Infinity };
    reacted.set(k, r);
  }
  const gone = now - r.start;
  return id !== null && gone < REACT_MS ? gone : null;
}

/** The done avatar's grow-in, as far along as it is (--r, a negative delay): only if the page saw turn `turn` end -- one
 * reaction per actor, whichever view draws it (Chat, a minimized pane), so it grows once. */
export const restDelay = (a: StageActor | null | undefined, turn: unknown): string => {
  const gone = a ? reaction(`${a.channel} done`, turn, a.last) : null;
  return `-${Math.round(gone === null ? 60000 : gone)}ms`;
};

/** The character's move and the effect round it (its avatar_motion), each a CSS name or none. */
export const motionOf = (a: StageActor): [string, string] => {
  const [move = "", fx = ""] = (a.avatar_motion || "").split(/\s+/).map((w) => (/^[a-z0-9-]+$/.test(w) ? w : ""));
  return [move, fx];
};

// what came of a call: on its own tool (a test's checklist, a commit's parcel) or on whatever it does now
const ENDS: Record<string, string> = { pass: "test", tfail: "test", ship: "ship" };
const MOVE_MS = 600,
  WIND_MS = 1400;
const PUT_AFTER = 900,
  PUT_MS = 650; // a call over: its tool put away this long after, taking this long

/** Where the action's animations are, by the page's clock, `now` after a call ended at `since`: slowing evenly to a stop
 * over WIND_MS. */
export const wound = (since: number, now: number): number => {
  const e = Math.min(WIND_MS, Math.max(0, now - since));
  return since + e - (e * e) / (2 * WIND_MS);
};
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
 * (--a). */
export function windDown(svg: Element, since: number, from: number): void {
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

/** What each actor's stage last showed: its look, when it changed and the look before; whether it muses (no call under
 * way) and since when; when its tool is put away (null: none to); when its thought grows in; its turn over; when it
 * arrived. */
interface Shown {
  look: string | null;
  at: number;
  was: string | null;
  musing: boolean;
  musedAt: number;
  putAt: number | null;
  bubbleAt: number;
  popBubble: boolean;
  done: boolean;
  arrivedAt: number;
}
const shown = new Map<string, Partial<Shown>>();

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
  const react =
    gone === null || !e
      ? null
      : !e.ok
        ? e.kind === "test"
          ? "tfail"
          : "fail"
        : e.kind === "test"
          ? "pass"
          : e.kind === "ship"
            ? "ship"
            : null;
  const musing = !w.doing;
  let sh = shown.get(ch) as Shown | undefined;
  if (!sh || sh.done) {
    // first seen (no change to show), or a new turn after its last: it arrives
    sh = {
      look: null,
      at: -Infinity,
      was: null,
      musing,
      musedAt: -Infinity,
      putAt: null,
      bubbleAt: -Infinity,
      popBubble: false,
      done: false,
      arrivedAt: sh ? t0 : -Infinity,
    };
    shown.set(ch, sh);
  }
  const wasPut = sh.putAt !== null && t0 >= sh.putAt; // what it showed is being put away, or is
  if (sh.musing !== musing) {
    // a call over (the model at work), or one begun
    const acting = sh.look !== null && sh.look !== "think";
    const putAt = musing && acting ? t0 + (react ? REACT_MS - 300 : PUT_AFTER) : null;
    Object.assign(sh, {
      musing,
      musedAt: t0,
      putAt,
      popBubble: !musing && sh.bubbleAt <= t0,
      bubbleAt: !musing ? sh.bubbleAt : putAt === null ? t0 : putAt + 350,
    });
  }
  // a call running; else, the call it made last, until it is put away (and while nothing readable was said since); else
  // thinking
  const putting = musing && sh.putAt !== null && t0 < sh.putAt + PUT_MS;
  const doing = (react && ENDS[react]) || w.doing || (putting && w.last) || "think";
  const look = doing === "team" ? `team${Math.min(3, Math.max(1, w.helpers || 0))}` : doing;
  if (sh.look === null)
    sh.look = look; // first seen: as it is
  else if (sh.look !== look)
    // what it showed, put away already, has nothing left to take off
    Object.assign(sh, { was: wasPut && sh.look !== "think" ? null : sh.look, look, at: t0 });
  const moving = sh.was !== null && t0 - sh.at < MOVE_MS;
  const href = escapeHtml(src),
    p = propsOf(look, href),
    q = moving ? propsOf(sh.was!, href) : null;
  const since = Math.max(sh.musedAt, t0 - 60000);
  const [move, fx] = motionOf(a);
  const cls = [
    "stage",
    `s-${doing}`,
    musing && "musing",
    putting && "putting",
    !musing && sh.popBubble && t0 - sh.musedAt < 400 && "popping",
    t0 - sh.arrivedAt < MOVE_MS && "arriving",
    react && `r-${react}`,
    (!react || react === "fail") && (w.failed ?? 0) >= 3 && "streak",
    a.failing && "retry",
  ]
    .filter(Boolean)
    .join(" ");
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
  const left = Math.max(
    gone === null ? 0 : REACT_MS - gone,
    moving ? MOVE_MS - (t0 - sh.at) : 0,
    putting ? sh.putAt! + PUT_MS - t0 : 0, // put away: drawn thinking
  );
  return {
    html,
    sig: JSON.stringify([shows, look, href, fx, a.avatar_hue]),
    left,
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
