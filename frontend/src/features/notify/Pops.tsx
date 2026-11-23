// The pop-ups in the page's corner (notify.ts pops them up): each what wants the reader, for POP_SECONDS -- longer while
// the pointer is on it -- a click opening what it is about, its × putting it away; the latest POP_MOST. In a box of
// their own on the page (#pops, made with the first), its React root.
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { Html } from "../../core/ui/PageNode";

export const POP_SECONDS = 8;
export const POP_MOST = 3;

/** A pop-up: what it is about (`want`, its token), its class (why it wants the reader), its words, its face, what its
 * click does. */
export interface Pop {
  want: string;
  cls: string;
  title: string;
  line: string;
  where: string;
  /** its open button's title */
  tip: string;
  face: Node;
  open(): void;
  /** its own, so the same thing popped up again is a new pop-up (its time started over) */
  n: number;
}

interface Pops {
  pops: Pop[];
}
export const usePops = create<Pops>()(() => ({ pops: [] }));
let made = 0;
const away = (p: Pop) => usePops.setState((s) => ({ pops: s.pops.filter((q) => q !== p) }));

function PopUp({ pop }: { pop: Pop }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const later = () => {
    stop();
    timer.current = setTimeout(() => away(pop), POP_SECONDS * 1000);
  };
  useEffect(() => {
    later();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as it pops up
  }, []);
  return (
    <div className={`pop ${pop.cls}`} data-want={pop.want} role="status" onPointerEnter={stop} onPointerLeave={later}>
      <button
        className="pop-open"
        type="button"
        title={pop.tip}
        onClick={() => {
          away(pop);
          pop.open();
        }}
      >
        <span className="pop-face">
          <Html node={pop.face} />
          <i className={`pop-dot ${pop.cls}`} aria-hidden="true" />
        </span>
        <span className="pop-tx">
          <b>{pop.title}</b>
          {pop.line ? <span className="pop-line">{pop.line}</span> : null}
          <span className="pop-where">{pop.where}</span>
        </span>
      </button>
      <button
        className="pop-x"
        type="button"
        title="Dismiss"
        aria-label={`Dismiss: ${pop.title}`}
        onClick={() => away(pop)}
      >
        {/* the circled cross of core/page/icons.ts's closeIcon */}
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="8" cy="8" r="6" />
          <line x1="5.8" y1="5.8" x2="10.2" y2="10.2" />
          <line x1="10.2" y1="5.8" x2="5.8" y2="10.2" />
        </svg>
      </button>
    </div>
  );
}

function PopsList() {
  const pops = usePops((s) => s.pops);
  return pops.map((p) => <PopUp key={p.n} pop={p} />);
}

let root: Root | null = null;
function popsRoot(): Root {
  if (!root || !document.getElementById("pops")) {
    const box = Object.assign(document.createElement("div"), { className: "pops", id: "pops" });
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Notifications");
    document.body.append(box);
    const r = createRoot(box);
    flushSync(() => r.render(<PopsList />));
    root = r;
  }
  return root;
}

/** Popped up: the one about the same thing before it put away, the oldest past POP_MOST too; drawn at once. */
export function popUp(pop: Omit<Pop, "n">): void {
  popsRoot();
  const p = { ...pop, n: ++made };
  flushSync(() =>
    usePops.setState((s) => ({ pops: [...s.pops.filter((q) => q.want !== p.want), p].slice(-POP_MOST) })),
  );
}
