// The charts of the Details panel: a line chart of the actor's calls over time (the size card's), each read a point --
// a cross line and its numbers under the pointer, a click picking that read -- and a chart's legend. The SVG is as
// wide as its box (`host`), measured as it is put on the page and again as the box changes size.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { axisTime, clock, compact, full } from "../../core/format";
import type { Read } from "./types";

export interface Series {
  field: keyof Read;
  color: string;
  label: string;
}

export interface LegendItem {
  label: string;
  color?: string;
  kind?: "line" | "rect" | "rule";
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <span
            className={i.kind === "rule" ? "key-rule" : i.kind === "rect" ? "key-rect" : "key-line"}
            style={i.color ? { background: i.color } : undefined}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const f of [1, 2, 2.5, 5, 10]) if (raw <= f * p) return f * p;
  return 10 * p;
}

/** The width `host` has on the page: read as it is put there (a layout's, before it is painted) and as it changes. */
function useWidth(host: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const n = host.current;
    if (!n || typeof ResizeObserver === "undefined") return;
    // told once it is laid out on the page (the page puts the panel it is in there after it is drawn), and as it is
    // resized: drawn again at once, before the page is painted
    const seen = new ResizeObserver(() => {
      const w = n.isConnected ? n.clientWidth : 0;
      if (w) flushSync(() => setWidth(w));
    });
    seen.observe(n);
    return () => seen.disconnect();
  }, [host]);
  return width;
}

/** The read under the pointer: its cross line, and the tooltip's place (kept, hidden, once the pointer leaves). */
interface Hover {
  read: Read;
  left: number;
  on: boolean;
}

export interface LineChartProps {
  reads: Read[];
  series: Series[];
  height?: number;
  /** each rebuild's read a rule across */
  rebuilds?: boolean;
  onPick?: (readId: number) => unknown;
  /** the read picked: a rule at it */
  picked?: number | null;
}

/** The chart, in `host`'s box (its `id` the page's: `size-chart`). */
export function LineChart({ id, ...props }: LineChartProps & { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const width = useWidth(host);
  return (
    <div id={id} ref={host}>
      <Chart W={Math.max(320, width || 640)} {...props} />
    </div>
  );
}

function Chart({ W, reads, series, height = 220, rebuilds = true, onPick, picked }: LineChartProps & { W: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const H = height,
    m = { l: 48, r: 12, t: 12, b: 26 };
  const xs = reads.map((r) => r.at).filter((t): t is number => !!t);
  if (!xs.length)
    return (
      <div className="chart">
        <div className="desc">No reads yet.</div>
      </div>
    );
  let x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  if (x1 === x0) {
    x0 -= 30;
    x1 += 30;
  }
  const vals = series.flatMap((s) => reads.map((r) => r[s.field]).filter((v): v is number => typeof v === "number"));
  let ymax = Math.max(1, ...vals);
  const stepY = Math.max(1, niceStep(ymax / 4));
  ymax = Math.ceil(ymax / stepY) * stepY;
  const X = (t: number) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r),
    Y = (v: number) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const days = x1 - x0 > 86400;
  const ticks = Math.max(2, Math.min(6, Math.floor((W - m.l - m.r) / 110)));
  const grid: number[] = [];
  for (let v = 0; v <= ymax + 1e-9; v += stepY) grid.push(v);
  const nearest = (clientX: number) => {
    const rect = svg.current!.getBoundingClientRect();
    const px = ((clientX - rect.left) * W) / rect.width;
    const t = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
    let best: Read | null = null;
    for (const r of reads) if (r.at && (!best || Math.abs(r.at - t) < Math.abs(best.at! - t))) best = r;
    return { best, rect };
  };
  const pickedRead = picked ? reads.find((q) => q.read_id === picked) : null;
  const shown = hover?.read;
  return (
    <div className="chart">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} height={H} role="img">
        {grid.map((v) => [
          <line
            key={`l${v}`}
            x1={m.l}
            x2={W - m.r}
            y1={Y(v)}
            y2={Y(v)}
            stroke={v === 0 ? "var(--axis)" : "var(--grid)"}
            strokeWidth={1}
          />,
          <text key={`t${v}`} x={m.l - 6} y={Y(v) + 4} textAnchor="end">
            {compact(v)}
          </text>,
        ])}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const t = x0 + ((x1 - x0) * i) / ticks;
          return (
            <text key={`x${i}`} x={X(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === ticks ? "end" : "middle"}>
              {axisTime(t, days, x1 - x0 < 600)}
            </text>
          );
        })}
        {rebuilds
          ? reads
              .filter((r) => r.rebuild && r.at)
              .map((r) => (
                <line
                  key={`r${r.read_id}`}
                  x1={X(r.at!)}
                  x2={X(r.at!)}
                  y1={m.t}
                  y2={H - m.b}
                  stroke="var(--muted)"
                  strokeWidth={1}
                  opacity={0.7}
                />
              ))
          : null}
        {series.map((s) => {
          const pts = reads.filter((r) => typeof r[s.field] === "number" && r.at);
          if (!pts.length) return null;
          let d = "";
          pts.forEach((r, i) => {
            const x = X(r.at!),
              y = Y(r[s.field] as number);
            d += i === 0 ? `M${x},${y}` : `L${x},${y}`;
          });
          const last = pts[pts.length - 1];
          return [
            <path
              key={`p${s.field}`}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />,
            <circle
              key={`c${s.field}`}
              cx={X(last.at!)}
              cy={Y(last[s.field] as number)}
              r={4}
              fill={s.color}
              stroke="var(--surface)"
              strokeWidth={2}
            />,
          ];
        })}
        {pickedRead && pickedRead.at ? (
          <line x1={X(pickedRead.at)} x2={X(pickedRead.at)} y1={m.t} y2={H - m.b} stroke="var(--s1)" strokeWidth={1} />
        ) : null}
        <line
          y1={m.t}
          y2={H - m.b}
          stroke="var(--axis)"
          strokeWidth={1}
          visibility={hover?.on ? "visible" : "hidden"}
          {...(hover ? { x1: X(hover.read.at!), x2: X(hover.read.at!) } : {})}
        />
        <rect
          x={m.l}
          y={m.t}
          width={W - m.l - m.r}
          height={H - m.t - m.b}
          fill="transparent"
          style={onPick ? { cursor: "pointer" } : undefined}
          onPointerMove={(ev) => {
            const { best, rect } = nearest(ev.clientX);
            if (!best) return;
            const left = (X(best.at!) / W) * rect.width;
            setHover({ read: best, left: Math.min(Math.max(0, left + 12), rect.width - 190), on: true });
          }}
          onPointerLeave={() => setHover((h) => (h ? { ...h, on: false } : h))}
          onClick={(ev) => {
            const { best } = nearest(ev.clientX);
            if (best && onPick) onPick(best.read_id);
          }}
        />
      </svg>
      <div
        className="tooltip"
        style={
          hover
            ? {
                display: hover.on ? "block" : "none",
                left: `${hover.left}px`,
                top: "8px",
              }
            : undefined
        }
      >
        {shown ? (
          <>
            <div className="t">{`${clock(shown.at, days)} · read ${shown.read_id}${shown.rebuild ? " · rebuild" : ""}`}</div>
            {series.map((s) => (
              <div key={s.label} className="row">
                <span className="key-line" style={{ background: s.color }} />
                <b>{full(shown[s.field] as number)}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
