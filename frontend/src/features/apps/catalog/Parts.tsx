// The Apps page's small parts: an app's mark, a token count in words, a line of what is known of an app.
import { Fragment, type ReactNode } from "react";
import { aboutTokens, BIG } from "./said";
import type { CatalogApp } from "./types";

const HUES = ["#2a78d6", "#1baf7a", "#6250d6", "#c4502d", "#c98500", "#d55181", "#0a7489"];

/** An app's mark: its own (its manifest's `mark`, served by the dashboard), else its initial on a colour of its own. */
export function Mark({ app, size }: { app: CatalogApp; size: number }) {
  if (app.mark && app.origin !== "index" && app.origin !== "staged")
    return (
      <img
        className="ap-mark"
        src={`/apps/mark/${encodeURIComponent(app.name)}.svg`}
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
    );
  let h = 0;
  for (const c of app.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const style = {
    "--mark": HUES[h % HUES.length],
    width: size,
    height: size,
    fontSize: Math.round(size * 0.45),
  } as React.CSSProperties;
  return (
    <span className="ap-mark letter" aria-hidden="true" style={style}>
      {(app.label || app.name).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** About how many tokens, said: "≈8.9k tokens each", in the warning colour past BIG. */
export function Tokens({ n, tail }: { n: number; tail: string }) {
  return <span className={n > BIG ? "ap-big" : ""}>{`${aboutTokens(n)} tokens ${tail}`}</span>;
}

/** A row of what is known of an app, each part a span. */
export function Meta({ parts }: { parts: ReactNode[] }) {
  return (
    <div className="ap-meta">
      {parts
        .filter(Boolean)
        .map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <Fragment key={i}>{p}</Fragment>))}
    </div>
  );
}
