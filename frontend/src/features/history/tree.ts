// The History view's model, apart from drawing it: the actor's history as a tree -- actor > task (where ag has split
// it into tasks) > turn (a user message and all that answered it) > message, each node with the rows it holds -- the
// rows the list shows of it, and what a selection holds.
import type { BuildState, OutlineEvent, OutlineTask } from "../../core/api/types";
import { itemType } from "../../core/model/items";

// An event of the outline (history.py's `outline`), a task ag found, how an actor's latest build stands: as generated
// from the server's schema (core/api/types.ts).
export type { BuildState, OutlineEvent } from "../../core/api/types";
/** A task ag found (its build's), from its first row. */
export type Task = OutlineTask;

/** The outline of an actor's history, as loaded so far. */
export interface Outline {
  key: string;
  gatherer: string;
  channel: string;
  events: OutlineEvent[];
  tasks: Task[];
  builds: Record<string, BuildState>;
  /** the last row loaded; more after it to load */
  last: number;
  more: boolean;
  error: string;
  /** what the actor had when opened is in */
  loaded: boolean;
}

export interface HNode {
  kind: "actor" | "task" | "turn" | "message";
  id: string;
  channel: string;
  children: HNode[];
  rows: number[];
  tokens: number;
  /** its first event's time */
  first: number | null;
  /** a turn's number, its request, whether it continues the turn before (a task's start), the agent's last reply */
  n?: number;
  ask?: string;
  cont?: boolean;
  reply?: string;
  /** a task's own (null: before ag's first), whether it is the build's last, still open */
  task?: Task | null;
  current?: boolean;
  whole?: boolean;
  /** a message's event */
  event?: OutlineEvent;
}

const node = (kind: HNode["kind"], id: string, extra: Partial<HNode>): HNode => ({
  kind,
  id,
  channel: "",
  children: [],
  rows: [],
  tokens: 0,
  first: null,
  ...extra,
});

const add = (n: HNode, e: OutlineEvent) => {
  n.rows.push(e.row_id);
  n.tokens += e.tokens;
  if (n.first === null) n.first = e.at;
};

/** The tree, and every node by its id. A task holds the events from its first row to the next task's; a turn, a user
 * message and all after it until the next. */
export function buildTree(h: Pick<Outline, "events" | "tasks">): { tree: HNode[]; byId: Map<string, HNode> } {
  const tasksBy = new Map<string, Task[]>();
  for (const t of h.tasks) (tasksBy.get(t.channel) || tasksBy.set(t.channel, []).get(t.channel)!).push(t);
  for (const ts of tasksBy.values()) ts.sort((a, b) => a.first_row - b.first_row);
  type Walk = { a: HNode; tasks: Task[]; ti: number; turnN: number; task: HNode | null; turn: HNode | null };
  const actors = new Map<string, Walk>(),
    byId = new Map<string, HNode>();
  for (const e of h.events) {
    let w = actors.get(e.channel);
    if (!w) {
      const a = node("actor", `a:${e.channel}`, { channel: e.channel, ask: "" });
      w = { a, tasks: tasksBy.get(e.channel) || [], ti: -2, turnN: 0, task: null, turn: null };
      if (!w.tasks.length) {
        // not split into tasks: its turns under one task of their own, never shown
        w.task = node("task", `k:${e.channel}:all`, { channel: e.channel, task: null, whole: true });
        a.children.push(w.task);
        byId.set(w.task.id, w.task);
      }
      actors.set(e.channel, w);
      byId.set(a.id, a);
    }
    if (w.tasks.length) {
      let ti = w.ti < -1 ? -1 : w.ti;
      while (ti + 1 < w.tasks.length && w.tasks[ti + 1].first_row <= e.row_id) ti++;
      if (ti !== w.ti) {
        w.ti = ti;
        w.task = node("task", `k:${e.channel}:${ti}`, {
          channel: e.channel,
          task: ti >= 0 ? w.tasks[ti] : null,
          current: ti === w.tasks.length - 1,
        });
        w.a.children.push(w.task);
        byId.set(w.task.id, w.task);
        w.turn = null;
      }
    }
    if (e.type === "user_message") {
      w.turnN++;
      w.turn = null;
    }
    if (!w.turn) {
      const asks = e.type === "user_message";
      w.turn = node("turn", `t:${e.channel}:${w.ti}:${w.turnN}`, {
        channel: e.channel,
        n: w.turnN,
        ask: asks ? e.text : "",
        cont: !asks && w.turnN > 0,
        reply: "",
      });
      w.task!.children.push(w.turn);
      byId.set(w.turn.id, w.turn);
      if (asks && !w.a.ask) w.a.ask = e.text;
      if (asks && !w.task!.ask) w.task!.ask = e.text; // the request a task opens with
    }
    if (e.type === "agent_message" && e.text) w.turn.reply = e.text;
    const m = node("message", `m:${e.row_id}`, { channel: e.channel, event: e });
    byId.set(m.id, m);
    add(m, e);
    w.turn.children.push(m);
    add(w.turn, e);
    add(w.task!, e);
    add(w.a, e);
  }
  return { tree: [...actors.values()].map((w) => w.a), byId };
}

/** A message's type, as the History's filter has it. */
export const typeOfEvent = (e: OutlineEvent) => itemType({ name: e.type, group: "Recent history" });

/** A row the list shows: its node, how deep, and whether it is a heading. */
export interface VisibleRow {
  n: HNode;
  depth: number;
  head: boolean;
  /** its key: the node's id, "/h" after a heading */
  key: string;
}

/** The rows the list shows, in order, and the rows ⌘A selects (`tops`). Turns, always one step in from the left, each
 * opened to its messages where the reader opened it; grouped by tasks, each task's row at the left with its turns under
 * it once opened -- so grouping only adds the tasks between the turns, nothing else moves. A node is listed when it holds
 * a message of a type shown (`shown`) and, searching, one that matches (`hits`). */
export function visibleRows(
  tree: HNode[],
  grouped: boolean,
  open: ReadonlySet<string>,
  shown: (row: number) => boolean,
  hits: ReadonlyMap<number, string> | null,
): { rows: VisibleRow[]; tops: HNode[] } {
  const has = (n: HNode) => n.rows.some((r) => shown(r) && (!hits || hits.has(r)));
  const rows: VisibleRow[] = [],
    tops: HNode[] = [];
  const walk = (n: HNode, depth: number) => {
    if (!has(n)) return;
    rows.push({ n, depth, head: false, key: n.id });
    if (open.has(n.id) && n.kind !== "message") for (const c of n.children) walk(c, depth + 1);
  };
  for (const a of tree)
    for (const t of a.children) {
      if (!has(t)) continue;
      if (grouped) {
        rows.push({ n: t, depth: 0, head: false, key: t.id });
        tops.push(t);
      }
      if (!grouped || open.has(t.id))
        for (const c of t.children)
          if (has(c)) {
            if (!grouped) tops.push(c);
            walk(c, 1);
          }
    }
  return { rows, tops };
}

/** What a selection holds: each row picked, its actor and size. */
export type Selection = ReadonlyMap<number, readonly [channel: string, tokens: number]>;

/** How much of `n` is selected. */
export function selState(n: HNode, sel: Selection): "none" | "some" | "all" {
  let on = 0;
  for (const r of n.rows) if (sel.has(r)) on++;
  return on === 0 ? "none" : on === n.rows.length ? "all" : "some";
}

/** `base` with every row of `nodes`. */
export function withRows(
  nodes: HNode[],
  base: Selection,
  byId: ReadonlyMap<string, HNode>,
): Map<number, [string, number]> {
  const sel = new Map(base as Map<number, [string, number]>);
  for (const n of nodes)
    for (const r of n.rows) {
      const e = byId.get(`m:${r}`)?.event;
      sel.set(r, [e ? e.channel : n.channel, e ? e.tokens : 0]);
    }
  return sel;
}

/** The node of a row's key. */
export const nodeOfKey = (byId: ReadonlyMap<string, HNode>, k: string) => byId.get(String(k).replace(/\/h$/, ""));

/** The nodes of the rows from `a` to `b`, as listed (`flat`: the rows' keys, in order); `b` alone if either is not. */
export function rangeOf(flat: string[], a: string, b: string, byId: ReadonlyMap<string, HNode>): HNode[] {
  const i = flat.indexOf(a),
    j = flat.indexOf(b);
  const keys = i < 0 || j < 0 ? [b] : flat.slice(Math.min(i, j), Math.max(i, j) + 1);
  return keys.map((k) => nodeOfKey(byId, k)).filter((n): n is HNode => !!n);
}

/** The rows picked, as [first, last] runs: what the server takes. */
export function ranges(rows: Iterable<number>): [number, number][] {
  const out: [number, number][] = [];
  for (const r of [...rows].sort((x, y) => x - y))
    if (out.length && r === out[out.length - 1][1] + 1) out[out.length - 1][1] = r;
    else out.push([r, r]);
  return out;
}

/** `text` cut where `q` matches (any case): the pieces, each match marked. */
export function marked(text: string, q: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  const low = text.toLowerCase(),
    ql = (q || "").toLowerCase();
  let i = 0;
  if (ql)
    for (let j = low.indexOf(ql); j >= 0; j = low.indexOf(ql, i)) {
      out.push({ text: text.slice(i, j), hit: false }, { text: text.slice(j, j + ql.length), hit: true });
      i = j + ql.length;
    }
  out.push({ text: text.slice(i), hit: false });
  return out;
}
