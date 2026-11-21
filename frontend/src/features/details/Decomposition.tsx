// How a context, or what all calls sent, divides by ag's own count: a bar of the whole by kind, and under it each kind's
// parts, each kind where it sits in the bar above -- a finer split of the whole. A segment's numbers in a tooltip under
// the pointer or the focus; its label shown only where it fits, in ink that reads on its fill.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { compact, full } from "../../core/format";
import { color, label } from "../../core/model/items";
import { divide, type Entry } from "./model";

interface Seg {
  name: string;
  short: string;
  color: string;
  tokens: number;
  items: number;
}

/** What the tooltip shows, and where (kept, hidden, once the pointer or the focus leaves). */
interface Tip {
  seg: Seg;
  on: boolean;
  left: number;
  top: number;
}

/** Each segment's label shown only where it fits, in ink that reads on its fill: once the figure is on the page. */
function ink(fig: HTMLElement) {
  for (const seg of fig.querySelectorAll<HTMLElement>(".seg")) {
    const text = seg.firstChild as HTMLElement | null;
    if (!text || text.scrollWidth > seg.clientWidth - 10) {
      if (text) text.style.visibility = "hidden";
      continue;
    }
    if (text.style.visibility) text.style.removeProperty("visibility");
    const m = getComputedStyle(seg).backgroundColor.match(/\d+/g) || ["0", "0", "0"];
    const lum = (0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2]) / 255;
    text.style.color = lum > 0.6 ? "#0b0b0b" : "#ffffff";
  }
}

export function Decomposition({ entries, what = "the context" }: { entries: Entry[]; what?: string }) {
  const fig = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  useLayoutEffect(() => {
    const f = fig.current;
    if (!f) return;
    const id = requestAnimationFrame(() => ink(f)); // laid out on the page first
    return () => cancelAnimationFrame(id);
  });
  const { total, kinds } = divide(entries);
  const pct = (v: number) => `${((v / total) * 100).toFixed(1)}%`;
  const show = (el: HTMLElement, seg: Seg, clientX?: number) => {
    const box = fig.current!.getBoundingClientRect(),
      r = el.getBoundingClientRect();
    const x = clientX !== undefined ? clientX - box.left : r.left - box.left + r.width / 2;
    setTip({ seg, on: true, left: Math.min(Math.max(0, x + 12), box.width - 200), top: r.bottom - box.top + 6 });
  };
  const hide = () => setTip((t) => (t ? { ...t, on: false } : t));
  const segment = (key: string, d: Seg, width: number) => (
    <div
      key={key}
      className="seg"
      tabIndex={0}
      role="img"
      style={{ width: `${width}%`, background: d.color }}
      aria-label={`${d.name}: ${full(d.tokens)} tokens, ${pct(d.tokens)} of ${what}, ${d.items} items`}
      onPointerMove={(ev) => show(ev.currentTarget, d, ev.clientX)}
      onFocus={(ev) => show(ev.currentTarget, d)}
      onPointerLeave={hide}
      onBlur={hide}
    >
      <span>{d.short}</span>
    </div>
  );
  const row = (name: string, bar: ReactNode, after?: ReactNode) => (
    <div className="drow">
      <div className="dlabel">
        <span>{name}</span>
        <span className="dval">{`${compact(total)} · ${pct(total)}`}</span>
      </div>
      {bar}
      {after}
    </div>
  );
  const shown = kinds.filter((g) => g.tokens > 0);
  const zero = kinds.flatMap((g) =>
    g.tokens > 0
      ? [...g.parts.values()].filter((p) => !p.tokens).map((p) => `${p.items} ${p.label.toLowerCase()}`)
      : [],
  );
  return (
    <figure ref={fig} className="decomp" aria-label={`How ${what} divides, by ag's own count`}>
      {row(
        what === "the context" ? "Whole context" : "All calls",
        <div className="dbar">
          {shown.map((g) =>
            segment(
              g.group,
              { name: label(g.group), short: label(g.group), color: color(g.group), tokens: g.tokens, items: g.items },
              (g.tokens / total) * 100,
            ),
          )}
        </div>,
      )}
      {row(
        "By part",
        <div className="dbar">
          {shown.map((g) => (
            <div key={g.group} className="dinner" style={{ width: `${(g.tokens / total) * 100}%` }}>
              {[...g.parts.entries()]
                .sort(([, x], [, y]) => y.tokens - x.tokens)
                .filter(([, p]) => p.tokens > 0)
                .map(([k, p]) =>
                  segment(
                    k,
                    {
                      name: `${label(g.group)} · ${p.label}`,
                      short: p.label,
                      color: p.color,
                      tokens: p.tokens,
                      items: p.items,
                    },
                    (p.tokens / g.tokens) * 100,
                  ),
                )}
            </div>
          ))}
        </div>,
        zero.length ? <div className="dzero">{`also ${zero.join(", ")}, at 0 tokens by ag's count`}</div> : null,
      )}
      <div
        className="tooltip"
        style={tip ? { display: tip.on ? "block" : "none", left: `${tip.left}px`, top: `${tip.top}px` } : undefined}
      >
        {tip ? (
          <>
            <div className="row">
              <b>{pct(tip.seg.tokens)}</b>
              <span>{`${full(tip.seg.tokens)} tokens`}</span>
            </div>
            <div className="t">{tip.seg.name}</div>
            <div className="t">{`${full(tip.seg.items)} item${tip.seg.items === 1 ? "" : "s"}`}</div>
          </>
        ) : null}
      </div>
    </figure>
  );
}
