// What an actor's stage shows (model.ts makes its markup, Stage.tsx draws it), worked out apart from the page: what it
// reacts to and for how long, what it does and holds, how it moves from one tool to the next, how its action winds down
// as a call ends -- each from the actor's work, what the stage showed before and the time, given, so the same moment
// always draws the same.
import type { Work } from "../../api/types";

/** How long the stage reacts to a call's end or a turn's; one that ended longer ago than REACT_LATE seconds before the
 * page first saw it is not reacted to. */
export const REACT_MS = 3200;
export const REACT_LATE = 6;

/** What a stage reacted to last, by "<channel> <what>": which (`id`) and when it began (the page's clock). */
export type Reactions = Map<string, { id: unknown; start: number }>;

/** What an actor's stage reacts to, once: a call that ended, its turn over (`id`: which; null, none) -- started when the
 * page sees it change, or, seen on first drawing the actor, from when it happened (`at`, the server's seconds) if that
 * was lately. How long it has reacted (ms), or null once over or for none. `now`: the page's clock; `wall`: the time in
 * seconds. */
export function reactionIn(
  reacted: Reactions,
  k: string,
  id: unknown,
  at: number | null | undefined,
  now: number,
  wall: number,
): number | null {
  id = id === undefined ? null : id;
  let r = reacted.get(k);
  if (!r || r.id !== id) {
    const late = Math.max(0, wall - (at || 0));
    r = { id, start: r ? now : late < REACT_LATE ? now - late * 1000 : -Infinity };
    reacted.set(k, r);
  }
  const gone = now - r.start;
  return id !== null && gone < REACT_MS ? gone : null;
}

/** How a call that just ended went, as the stage shows it: a test passed or failed, a commit shipped, another failure;
 * null for none to show (`gone` null: no reaction now). */
export type React = "pass" | "tfail" | "ship" | "fail";
export function reactOf(ended: Work["ended"] | undefined, gone: number | null): React | null {
  if (gone === null || !ended) return null;
  if (!ended.ok) return ended.kind === "test" ? "tfail" : "fail";
  return ended.kind === "test" ? "pass" : ended.kind === "ship" ? "ship" : null;
}

/** An avatar's motion (its avatar_motion, the words): its move, and an effect round it -- each a CSS name, or "". */
export const splitMotion = (m: string | null | undefined): [string, string] => {
  const [move = "", fx = ""] = (m || "").split(/\s+/).map((w) => (/^[a-z0-9-]+$/.test(w) ? w : ""));
  return [move, fx];
};

/** A move from one tool to the next takes MOVE_MS; a call's action slows to a stop over WIND_MS. */
export const MOVE_MS = 600;
export const WIND_MS = 1400;
/** A call over: its tool put away PUT_AFTER ms after, taking PUT_MS. */
export const PUT_AFTER = 900;
export const PUT_MS = 650;

/** Where the action's animations are, by the page's clock, at `now`, a call having ended at `since`: slowing evenly to a
 * stop over WIND_MS. */
export const wound = (since: number, now: number): number => {
  const e = Math.min(WIND_MS, Math.max(0, now - since));
  return since + e - (e * e) / (2 * WIND_MS);
};

/** What a call's end shows on its own tool (a test's checklist, a commit's parcel), not on what the actor does now. */
const ENDS: Partial<Record<React, string>> = { pass: "test", tfail: "test", ship: "ship" };

/** What an actor's stage last showed: its look (`at`: when it changed; `was`, the look before), whether it was thinking
 * (`musing`, `musedAt`: when that changed), when its tool is put away (`putAt`; null: none to), when its thought grows in
 * (`bubbleAt`, `popBubble`), its turn over (`done`), when it arrived (`arrivedAt`). */
export interface Shown {
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
/** A turn over, before its stage was ever shown: the next turn's actor arrives. */
export type Rested = { done: true };

/** One draw of a stage: what it does (`doing`, its class), its look (`look`: the tool, a team's size), whether it is
 * thinking, putting its tool away, moving from one to the next; since when its action winds down. */
export interface Step {
  sh: Shown;
  doing: string;
  look: string;
  musing: boolean;
  putting: boolean;
  moving: boolean;
  since: number;
}

/** The stage at `t0`, from what it showed before (`was`: none, first seen; a turn over, it arrives) and the actor's work
 * `w` and reaction `react`: what it shows now, and what it showed made so (`sh`, the same object when there was one). */
export function stageStep(was: Shown | Rested | undefined, w: Partial<Work>, react: React | null, t0: number): Step {
  const musing = !w.doing;
  let sh = was as Shown | undefined;
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
      arrivedAt: was ? t0 : -Infinity,
    };
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
  // what it showed, put away already, has nothing left to take off
  else if (sh.look !== look) Object.assign(sh, { was: wasPut && sh.look !== "think" ? null : sh.look, look, at: t0 });
  const moving = sh.was !== null && t0 - sh.at < MOVE_MS;
  return { sh, doing, look, musing, putting, moving, since: Math.max(sh.musedAt, t0 - 60000) };
}

/** The stage's classes at `t0`: what it does, thinking or putting away, its thought popping in, arriving, its reaction,
 * a streak of failures, its model's calls retried (`failing`). */
export function stageClass(
  s: Step,
  react: React | null,
  failed: number | undefined,
  failing: boolean,
  t0: number,
): string {
  const { sh, doing, musing, putting } = s;
  return [
    "stage",
    `s-${doing}`,
    musing && "musing",
    putting && "putting",
    !musing && sh.popBubble && t0 - sh.musedAt < 400 && "popping",
    t0 - sh.arrivedAt < MOVE_MS && "arriving",
    react && `r-${react}`,
    (!react || react === "fail") && (failed as number) >= 3 && "streak",
    failing && "retry",
  ]
    .filter(Boolean)
    .join(" ");
}

/** How long until the stage shows something else of itself (ms): its reaction over, its move done, its tool put away;
 * 0 for nothing due. */
export const stageLeft = (s: Step, gone: number | null, t0: number): number =>
  Math.max(
    gone === null ? 0 : REACT_MS - gone,
    s.moving ? MOVE_MS - (t0 - s.sh.at) : 0,
    s.putting ? (s.sh.putAt as number) + PUT_MS - t0 : 0,
  );
