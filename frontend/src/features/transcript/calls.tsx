// A tool call as the Transcript shows it, and the cards' permission (chat.js's permissionView): by its shape
// (harness_kit's Shape: the harness's rules read each tool's input into it, data.py's `view`) -- the argument beside its
// title, a note on the right, and what goes under it instead of its plain result. The title is its harness's
// (`view.title`), as is any argument a shape's own does not give (`view.arg`). A call no rules read: its name and inputs.
import type { ReactNode } from "react";
import { firstLine, plural } from "../../core/format";
import { str } from "../../core/model/items";
import { hlLines } from "../../core/ui/highlight";
import { nodeOf } from "../../core/ui/node";

/** A call as the history has it: its tool's name, its input, its view (the shape its harness's rules read), and the
 * calls a script made. */
export interface Call {
  name?: string | null;
  input?: unknown;
  view?: Record<string, unknown> | null;
  calls?: Call[];
}

/** a result's lines shown before "+N lines" */
const RESULT_LINES = 4;

/** A tool's output as lines, less the terminal's escape codes (colours, line clears) it may have printed. */
export const lines = (t: unknown): string[] =>
  t
    ? String(t)
        // eslint-disable-next-line no-control-regex -- a terminal's escapes (ESC [ ...), taken out
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
        .replace(/\n+$/, "")
        .split("\n")
    : [];

/** A result folded to its first lines; the rest one click away. `id` keeps it open across the page's draws. */
export function FoldedOutput({ text, id, cls = "" }: { text: unknown; id: string; cls?: string }) {
  const all = lines(text);
  if (!all.length) return <pre className={cls || undefined}>(no output)</pre>;
  if (all.length <= RESULT_LINES + 1) return <pre className={cls || undefined}>{all.join("\n")}</pre>;
  return (
    <details id={id}>
      <summary>
        <pre className={cls || undefined}>{all.slice(0, RESULT_LINES).join("\n")}</pre>
        <span className="more">{`… +${plural(all.length - RESULT_LINES, "line")} (click to expand)`}</span>
      </summary>
      <pre className={cls || undefined}>{all.slice(RESULT_LINES).join("\n")}</pre>
    </details>
  );
}

type Row = [cls: string, text: string];

/** A change as lines taken out and put in, what both share at either end left as context (two lines of it). */
export function diffRows(before: string, after: string): { rows: Row[]; added: number; removed: number } {
  const a = lines(before),
    b = lines(after);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const rows: Row[] = [
    ...a.slice(Math.max(0, s - 2), s).map((l): Row => ["ctx", "  " + l]),
    ...a.slice(s, a.length - e).map((l): Row => ["del", "- " + l]),
    ...b.slice(s, b.length - e).map((l): Row => ["add", "+ " + l]),
    ...a.slice(a.length - e, a.length - e + 2).map((l): Row => ["ctx", "  " + l]),
  ];
  return { rows, added: b.length - s - e, removed: a.length - s - e };
}

/** A patch (a unified diff) coloured by its lines' marks. */
export const patchRows = (text: string): Row[] =>
  lines(text).map((l) => [
    l.startsWith("+") && !l.startsWith("+++")
      ? "add"
      : l.startsWith("-") && !l.startsWith("---")
        ? "del"
        : l.startsWith("@@") || l.startsWith("***")
          ? "hunk"
          : "ctx",
    l,
  ]);

const Diff = ({ rows }: { rows: Row[] }) => (
  <div className="diff">
    {rows.map(([cls, text], i) => (
      <div key={i} className={cls}>
        {text}
      </div>
    ))}
  </div>
);

interface Todo {
  status?: string;
  content?: string;
  step?: string;
  activeForm?: string;
}

const Todos = ({ todos }: { todos: unknown }) => (
  <div className="todo">
    {(Array.isArray(todos) ? (todos as Todo[]) : []).map((t, i) => {
      const done = t.status === "completed",
        doing = t.status === "in_progress";
      return (
        <div key={i} className={done ? "done" : doing ? "doing" : undefined}>
          {`${done ? "☒" : "☐"} ${t.content || t.step || t.activeForm || str(t)}`}
        </div>
      );
    })}
  </div>
);

/** How a call is shown. */
export interface Summary {
  title: string;
  arg?: string;
  note?: string;
  /** what it is for, in the agent's words (a command's description) */
  doing?: string;
  /** no plain result under it: its body says it */
  quiet?: boolean;
  body?: (id: string) => ReactNode;
  result?: (text: string, id: string) => ReactNode;
}

type View = Record<string, unknown>;

/** The shapes' own ways, a path shown from `cwd` when it is under it. */
function shapes(cwd: string): Record<string, (v: View) => Omit<Summary, "title">> {
  const dir = cwd.replace(/\/$/, "");
  const shortPath = (p: unknown) => {
    const s = str(p);
    return dir && s.startsWith(dir + "/") ? s.slice(dir.length + 1) : s;
  };
  const found = (verb: string, unit: string) => (text: string, id: string) => (
    <details id={id}>
      <summary>{`${verb} ${plural(lines(text).length, unit)}`}</summary>
      <pre>{text}</pre>
    </details>
  );
  return {
    shell: (v) => ({
      arg: firstLine(str(v.command), 200),
      note: v.description as string,
      doing: v.description as string,
    }),
    script: (v) => ({ arg: firstLine(str(v.code).trim(), 200) }), // a script that calls no tool (one that does: its calls)
    read: (v) => ({
      arg: shortPath(v.path) + (v.offset ? ` (from line ${v.offset})` : ""),
      result: found("Read", "line"),
    }),
    write: (v) => ({
      arg: shortPath(v.path),
      quiet: true,
      body: (id) => (
        <details id={id + "-w"}>
          <summary>{`Wrote ${plural(lines(v.content).length, "line")}`}</summary>
          <Diff rows={diffRows("", str(v.content)).rows} />
        </details>
      ),
    }),
    edit: (v) => {
      const ds = ((v.edits as { old?: unknown; new?: unknown }[]) || []).map((e) => diffRows(str(e.old), str(e.new)));
      const added = ds.reduce((n, d) => n + d.added, 0),
        removed = ds.reduce((n, d) => n + d.removed, 0);
      return {
        arg: shortPath(v.path),
        quiet: true,
        body: () => (
          <div>
            <div>{`${plural(added, "addition")}, ${plural(removed, "removal")}${v.all ? " (all)" : ""}`}</div>
            {ds.map((d, i) => (
              <Diff key={i} rows={d.rows} />
            ))}
          </div>
        ),
      };
    },
    patch: (v) => ({
      arg: (str(v.patch).match(/\*\*\* (?:Update|Add|Delete) File: (.+)/) || [undefined, ""])[1],
      body: () => <Diff rows={patchRows(str(v.patch))} />,
      quiet: true,
    }),
    search: (v) => ({
      arg: `pattern: "${str(v.pattern)}"${v.path ? `, path: "${shortPath(v.path)}"` : ""}${v.glob ? `, glob: "${v.glob}"` : ""}`,
      result: found("Found", v.finds === "files" ? "file" : "line"),
    }),
    web: (v) => ({ arg: v.url ? str(v.url) : `"${str(v.query)}"` }),
    agent: () => ({}),
    todo: (v) => ({ body: () => <Todos todos={v.items} />, quiet: true }),
    skill: (v) => ({ arg: str(v.name) }),
    ask: () => ({}),
  };
}

/** Whether a call's shape is one the page shows its own way. */
export const hasShape = (shape: unknown): boolean => typeof shape === "string" && shape in shapes("");

/** How `call` is shown, its paths from `cwd`. A script (a code mode's), as the calls it makes. */
export function summary(call: Call, cwd = ""): Summary {
  const inner = (call.calls || []).filter((c) => c.input !== null && c.input !== undefined);
  if (inner.length) {
    const first = summary(inner[0], cwd),
      more = call.calls!.length - 1;
    return more
      ? {
          ...first,
          arg: `${first.arg || ""}${first.arg ? " " : ""}+ ${plural(more, "more call")}`,
          body: undefined,
          quiet: false,
        }
      : first;
  }
  const v = (call.view || {}) as View,
    shaped = typeof v.shape === "string" ? shapes(cwd)[v.shape] : undefined;
  if (shaped) {
    try {
      const s = shaped(v);
      return { ...s, title: (v.title as string) || call.name || "", arg: (v.arg as string | undefined) ?? s.arg };
    } catch {
      /* shown as any other */
    }
  }
  const input = call.input && typeof call.input === "object" ? (call.input as View) : { input: call.input };
  const args =
    v.arg ??
    (typeof call.input === "string"
      ? call.input
      : Object.entries(input)
          .map(([k, x]) => `${k}: ${firstLine(str(x), 60)}`)
          .join(", "));
  return {
    title: (v.title as string) || String(call.name || "tool").replace(/^mcp__([^_]+(?:_[^_]+)*)__/, "$1 · "),
    arg: firstLine(str(args), 200),
  };
}

/** A tool call as one line, in the agent's words: its description where it gave one (a command's), else its title and
 * argument ("Read y.py"). */
export const callLine = (s: Summary): string => firstLine(s.doing || (s.arg ? `${s.title} ${s.arg}` : s.title), 160);

/** A permission's ask, as far as its card shows its call. */
export interface PermissionAsk {
  tool?: string;
  input?: unknown;
  view?: View | null;
  said?: string | null;
}

/** The call a permission is asked for, as a call is shown: what it is for, then its command in full, or the change it
 * would make, or (a shape not known) its input -- inside its `div.perm`. */
function PermissionBody({ ask, id }: { ask: PermissionAsk; id: string }) {
  const v = ask.view || {},
    call: Call = { name: ask.tool, input: ask.input || {}, view: v };
  const s = summary(call);
  const shown = [v.command, v.path, v.url, v.query, v.pattern].map((x) => (x == null ? "" : str(x)));
  return (
    <>
      {ask.said && !shown.includes(ask.said) ? (
        <div className="qline">
          <span className="text">{ask.said}</span>
        </div>
      ) : null}
      <div className="perm-call">
        <b>{s.title}</b>
        {s.arg && v.shape !== "shell" ? <span className="arg">{s.arg}</span> : null}
      </div>
      {v.shape === "shell" && v.command ? (
        <pre className="perm-cmd">
          <span className="sh-t" dangerouslySetInnerHTML={{ __html: hlLines(str(v.command), "shell").join("\n") }} />
        </pre>
      ) : s.body ? (
        s.body(id)
      ) : !hasShape(v.shape) && Object.keys(call.input as object).length ? (
        <pre className="perm-input">{JSON.stringify(call.input, null, 2)}</pre>
      ) : null}
    </>
  );
}

/** The permission's call, as a node (the cards draw it: the page's host's permissionView). */
export const permissionNode = (ask: PermissionAsk, id: string): HTMLDivElement =>
  nodeOf("div", { class: "perm" }, <PermissionBody ask={ask} id={id} />);
