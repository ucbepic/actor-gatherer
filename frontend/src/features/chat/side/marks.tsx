// Each kind of file by a mark, in its colour, the same wherever a file shows -- in the tree, its legend, the folded bar,
// a call of the file, a command's files: a book read, a glass searched, a pencil edited, a page with a plus written
// whole, a bin deleted; and what git changed as a command ran, a branch. And the lines a change added and removed.
import type { CSSProperties } from "react";
import { full, plural } from "../../../core/format";

/** Each kind of file (files.py's kinds): its name, and its colour. */
export const FILE_KINDS: Record<string, [string, string]> = {
  read: ["read", "var(--s1)"],
  hit: ["search hit", "var(--s4)"],
  edit: ["edited", "var(--s2)"],
  write: ["written", "var(--s3)"],
  delete: ["deleted", "var(--critical)"],
};

const MARKS: Record<string, string> = {
  read: "M8 4.25C6.6 3.2 4.6 2.9 2 3.1v9.2c2.6-.2 4.6.1 6 1.15 1.4-1.05 3.4-1.35 6-1.15V3.1c-2.6-.2-4.6.1-6 1.15zM8 4.25v9.2",
  hit: "M6.75 2.5a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 0 0 0-8.5zM9.9 9.9l3.6 3.6",
  edit: "M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8",
  write:
    "M4.25 1.75h5l3 3v9a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5zM9 1.75v3.25h3.25M8 7.25v4.5M5.75 9.5h4.5",
  delete:
    "M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.65 9.1a.75.75 0 0 0 .75.65h4.7a.75.75 0 0 0 .75-.65l.65-9.1M6.75 6.75v4.5M9.25 6.75v4.5",
  git: "M5 5v6M11 7c0 2.6-6 1.4-6 4M5 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM5 11a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM11 3.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z",
};

/** What the harness still runs in the background, by kind (data.py's `background`). */
export const TASK_KINDS: Record<string, string> = {
  command: "Command",
  agent: "Agent",
  monitor: "Monitor",
  workflow: "Workflow",
};

/** An icon of the page's: an SVG path in a 16x16 box, stroked (core/ui/Icon.tsx's StrokeIcon), in `style`'s colour. */
export function Stroke({ d, size = 15, style }: { d: string; size?: number; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={d} />
    </svg>
  );
}

/** A kind of file's mark, `title` said on hover (its name unless given). */
export function KindMark({ kind, size = 12, title }: { kind: string; size?: number; title?: string }) {
  const [name, color] = FILE_KINDS[kind] || [kind, "var(--muted)"];
  return (
    <span className="km" title={title === undefined ? name : title}>
      {MARKS[kind] ? (
        <Stroke d={MARKS[kind]} size={size} style={{ color }} />
      ) : (
        <i className="fb" style={{ background: color, color }} />
      )}
    </span>
  );
}

/** What git changed of a file (files.py's `git`: its kinds), by git's mark. */
export const GitMark = ({ kinds, size = 12 }: { kinds: string[]; size?: number }) => (
  <KindMark kind="git" size={size} title={"by git: " + kinds.map((k) => (FILE_KINDS[k] || [k])[0]).join(", ")} />
);

/** The lines a change added and removed, as a diff's +N −M (files.py's `changed`); nothing for none. */
export function Changed({ ch }: { ch?: [number, number] | null }) {
  if (!ch || !(ch[0] || ch[1])) return null;
  return (
    <span className="chg" title={`${plural(ch[0], "line")} added, ${plural(ch[1], "line")} removed`}>
      {ch[0] ? <span className="a">{`+${full(ch[0])}`}</span> : null}
      {ch[1] ? <span className="r">{`−${full(ch[1])}`}</span> : null}
    </span>
  );
}

/** Lines added and removed, all together; null for none. */
export const addChanged = (all: (readonly [number, number] | null | undefined)[]): [number, number] | null =>
  all.reduce<[number, number] | null>((a, x) => (!x ? a : !a ? [x[0], x[1]] : [a[0] + x[0], a[1] + x[1]]), null);
