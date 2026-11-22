// The actor drawn with its avatar (model.ts): at work on its stage (AtWork), or small with its one motion (Buddy: the
// setting "Simple"); done, still, a check at its corner (AtRest, DoneCheck); waving hello before its first message
// (Greeting). Each element kept on the page while it shows the same -- its markup made once for what it shows, so its
// animations run on through every draw -- and made anew when that changes (keyed by it), so they start then. The stage
// draws itself again for its next moment, on its own clock.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  bareAvatar,
  helloOf,
  motionOf,
  restDelay,
  stageOf,
  stageRest,
  windDown,
  type StageActor,
  type Work,
} from "./model";

/** `make()` once for each `sig`: what was made for it while it stays the same (state derived from the props, made
 * again as they change). */
function useKept<T>(sig: string, make: () => T): T {
  const [kept, setKept] = useState(() => ({ sig, value: make() }));
  if (kept.sig === sig) return kept.value;
  const next = { sig, value: make() };
  setKept(next);
  return next.value;
}

/** The white check at a done avatar's corner. */
export function DoneCheck() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2.2 5.2L4.2 7.1L7.9 3.1"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The actor at work, small: its avatar's character out of its circle, moving as it does (its avatar_motion: a move, then
 * an effect round it, if any -- the .buddy CSS), on the page's clock; `still`, its calls failing: not moving. */
export function Buddy({ info, still = false }: { info: StageActor; still?: boolean }) {
  const src = bareAvatar(info),
    [move, fx] = motionOf(info);
  const sig = JSON.stringify([src, move, fx, !!still]);
  const t = useKept(sig, () => `-${Math.round(performance.now())}ms`);
  return (
    <span
      key={sig}
      className={["buddy", move && `m-${move}`, fx && `f-${fx}`, still && "still"].filter(Boolean).join(" ")}
      style={{ "--t": t } as CSSProperties}
      aria-hidden="true"
      data-sig={sig}
    >
      <img src={src || undefined} alt="" draggable="false" />
      {fx ? (
        <>
          <i />
          <i />
          <i />
        </>
      ) : null}
    </span>
  );
}

/** The stage itself: drawn again for its next moment when that is due, its action wound down once on the page. */
function Stage({ info, work, src }: { info: StageActor; work: Work; src: string }) {
  const [, tick] = useState(0);
  const now = stageOf(info, work, src);
  const shown = useKept(now.sig, () => now);
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const svg = box.current?.firstElementChild;
    if (!shown.musing || !svg) return;
    const f = requestAnimationFrame(() => windDown(svg, shown.since, shown.from)); // once drawn: its animations exist
    return () => cancelAnimationFrame(f);
  }, [shown]);
  useEffect(() => {
    if (!now.left) return;
    const t = setTimeout(() => tick((n) => n + 1), now.left + 30);
    return () => clearTimeout(t);
  });
  return (
    <span
      ref={box}
      key={shown.sig}
      className="stage-box"
      data-sig={shown.sig}
      dangerouslySetInnerHTML={{ __html: shown.html }}
    />
  );
}

/** The actor at work in the Chat view: its avatar acting out its turn (`work`, work.py's summary) on the stage; or, the
 * setting "Simple" (`mode`), its one motion. An actor with no avatar has the turning glyph. */
export function AtWork({ info, work, mode }: { info: StageActor; work: Work | null | undefined; mode: string }) {
  const src = bareAvatar(info);
  if (!src) return <span className="spin" aria-hidden="true" />;
  if (mode === "simple") return <Buddy info={info} still={!!info.failing} />;
  return <Stage info={info} work={work || {}} src={src} />;
}

/** The actor done, at its turn's end (`turn`: which): its avatar small, still, a check at its corner -- grown in, if the
 * page saw the turn end. */
export function AtRest({ info, turn }: { info: StageActor; turn: number | null | undefined }) {
  const src = bareAvatar(info);
  stageRest(info.channel);
  const sig = JSON.stringify([src, turn]);
  const r = useKept(sig, () => restDelay(info, turn));
  return (
    <span key={sig} className="done" style={{ "--r": r } as CSSProperties} data-sig={sig}>
      {src ? <img src={src} alt="" draggable="false" /> : null}
      <span className="ok">
        <DoneCheck />
      </span>
    </span>
  );
}

/** The actor before its first message: its avatar waving hello, on the stage; or, the setting "Simple", its one motion.
 * Its first turn's actor then arrives on the stage. An actor with no avatar: none. */
export function Greeting({ info, mode }: { info: StageActor; mode: string }) {
  const src = bareAvatar(info);
  if (src) stageRest(info.channel);
  const hello = useKept(JSON.stringify(["hello", src, info.avatar_hue, mode]), () =>
    src && mode !== "simple" ? helloOf(info, src) : null,
  );
  if (!src) return null;
  if (mode === "simple") return <Buddy info={info} />;
  return (
    <span
      key={hello!.sig}
      className="stage-box"
      data-sig={hello!.sig}
      dangerouslySetInnerHTML={{ __html: hello!.html }}
    />
  );
}
