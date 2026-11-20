// A turn's files as one tree of their folders, from / -- the home folder shown as ~, the session's directory marked, a
// harness's memory of a directory marked -- a folder with one child folder and no files shown as one
// ("ag_dashboard/vendor/"), each folder opened unless folded by a click. A path not absolute (the session's directory
// not known) goes under a folder of its own. A file clicked opens it beside the conversation; again, closes it.
import type { ReactNode } from "react";
import type { HarnessInfo } from "../../../core/api/types";
import { Changed, GitMark, KindMark } from "./marks";
import type { TurnFile } from "../types";

const UNKNOWN = "\0";

interface Dir {
  dirs: Map<string, Dir>;
  files: [TurnFile, string][];
  path: string;
}

/** Whether `p` is `dir` or under it. */
export const under = (p: string | null, dir: string) => !!dir && p !== null && (p === dir || p.startsWith(dir + "/"));

const count = (x: Dir): number => x.files.length + [...x.dirs.values()].reduce((a, y) => a + count(y), 0);

export interface TreeProps {
  files: TurnFile[];
  cwd: string;
  home: string;
  sel: TurnFile | null;
  showGit: boolean;
  /** the folders folded by a click, by their paths */
  folded: ReadonlySet<string>;
  harnesses: Record<string, HarnessInfo>;
  pick: (path: string | null) => void;
  fold: (path: string) => void;
}

export function Tree({ files, cwd, home, sel, showGit, folded, harnesses, pick, fold }: TreeProps): ReactNode[] {
  const root: Dir = { dirs: new Map(), files: [], path: "" };
  for (const f of files) {
    const parts = ((f.path.startsWith("/") ? "" : UNKNOWN + "/") + f.path).split("/"),
      name = parts.pop()!;
    let node = root;
    parts.forEach((p, i) => {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [], path: parts.slice(0, i + 1).join("/") });
      node = node.dirs.get(p)!;
    });
    node.files.push([f, name]);
  }
  // a harness's memory of a directory (harness_kit's `memory_folder`), the long name it gives the directory cut
  const memory = Object.entries(harnesses)
    .filter(([, h]) => h.memory_folder)
    .map(([n, h]) => [new RegExp(`${h.memory_folder}$`), n] as const);
  const memoryKey = memory.length ? new RegExp(memory.map(([re]) => re.source).join("|")) : /(?!)/;
  // a folder's row: its path from the row above it ("" the root, /); from above the home folder into it, as ~
  const label = (above: string | null, path: string) =>
    path === UNKNOWN
      ? "relative to an unknown folder"
      : (under(path, home) && !under(above, home)
          ? "~" + path.slice(home.length)
          : above === null
            ? path
            : path.slice(above.length + 1)
        ).replace(memoryKey, (m: string, ...g: unknown[]) =>
          m.replace((g.slice(0, memory.length).find((k) => k !== undefined) as string | undefined) ?? "", "…"),
        ) + "/";
  const out: ReactNode[] = [];
  const grow = (node: Dir, into: ReactNode[], depth: number, above: string | null) => {
    const dirs = [...node.dirs].sort(
      (x, y) => Number(x[0] === UNKNOWN) - Number(y[0] === UNKNOWN) || x[0].localeCompare(y[0]),
    );
    for (const [, sub] of dirs) {
      let dir = sub;
      while (!dir.files.length && dir.dirs.size === 1 && !(cwd && dir.path === cwd) && dir.path !== UNKNOWN)
        dir = [...dir.dirs.values()][0]; // a chain of single folders: one row
      const open = !folded.has(dir.path);
      const mem = memory.find(([re]) => re.test(dir.path));
      into.push(
        <button
          key={`d:${dir.path}`}
          type="button"
          className="fl-dir"
          title={dir.path.startsWith(UNKNOWN) ? dir.path.slice(2) : dir.path || "/"}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          aria-expanded={open ? "true" : "false"}
          onClick={() => fold(dir.path)}
        >
          <span className="tw">{open ? "▾" : "▸"}</span>
          <span className="name">{label(above, dir.path)}</span>
          {cwd && dir.path === cwd ? (
            <span className="wd" title="The session's working directory">
              cwd
            </span>
          ) : null}
          {mem ? (
            <span className="wd" title={`${harnesses[mem[1]]?.label || "Unknown harness"}'s memory folder`}>
              memory
            </span>
          ) : null}
          {open ? null : <span className="n">{`${count(dir)}`}</span>}
        </button>,
      );
      if (!open) continue;
      const kids: ReactNode[] = [];
      grow(dir, kids, depth + 1, dir.path);
      into.push(
        // under its caret's middle
        <div key={`k:${dir.path}`} className="fl-kids" style={{ "--guide": `${17 + depth * 14}px` } as object}>
          {kids}
        </div>,
      );
    }
    for (const [f, name] of node.files.sort((x, y) => x[1].localeCompare(y[1])))
      into.push(
        <button
          key={`f:${f.path}`}
          type="button"
          className={"fl-file" + (f === sel ? " on" : "")}
          title={f.path}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          aria-pressed={f === sel ? "true" : "false"}
          onClick={() => pick(f === sel ? null : f.path)} // again: closed
        >
          <span className="name">{name}</span>
          <Changed ch={f.changed} />
          <span className="badges">
            {f.kinds.map((k, i) => (
              <KindMark key={i} kind={k} size={12} title={k === "write" && f.created ? "created" : undefined} />
            ))}
            {showGit && (f.git || []).length ? <GitMark kinds={f.git!} /> : null}
          </span>
        </button>,
      );
  };
  grow(root, out, 0, null);
  return out;
}
