// THE MONITOR'S VIEW-MODEL (the list over the whole page): every actor of the groups not hidden, a column for each group
// of the list that has any -- those wanting the reader first, then those at work, then those at rest (MON_ORDER), Closed
// last -- and in each, a card for each actor; Saved's under a heading for each folder. What a card shows of its actor's
// turn is read from the server (monitor.py) for the cards in view, by the page (modes.js's monLoad): `got`, by key.
// Each card has a signature of all it shows, so the view draws it again only when that changes (Monitor.tsx).
import { plural } from "../../core/format";
import { key } from "../../core/model/keys";
import { isHidden, titleOf } from "./groups";
import type { ListView } from "./rows";
import { GROUPS, groupOf, isCoordinator, savedAs, statusOf, type Group } from "./status";
import { byName, folderOf, folderPath } from "./tree";
import type { Actor, Gatherer, ListCtx, Status } from "./types";

export const MON_ORDER: readonly Group[] = [
  "Waiting for you",
  "Error",
  "Running",
  "Background",
  "Finished",
  "Idle",
  "Saved",
  "Closed",
];

/** What the server read of an actor's turn (monitor.py's), as a card shows it. */
export interface MonData {
  work?: unknown;
  /** when its turn began */
  at?: number;
  /** what it does now: a call under way, or thinking */
  now?: { kind?: string; text?: string } | null;
  /** its newest calls */
  steps?: { text: string; running?: boolean; error?: boolean }[];
  calls?: number;
  said?: string;
  files?: Record<string, number>;
  turns?: number;
}
/** What the page has read for each card, by its key: `data` null where there was nothing to read, or reading failed. */
export type MonGot = ReadonlyMap<string, { sig: string; data: MonData | null }>;

export interface MonCardRow {
  kind: "card";
  key: string;
  g: Gatherer;
  a: Actor;
  status: Status;
  d: MonData | null;
  /** read, even if to no avail: no "…" */
  read: boolean;
  current: boolean;
  open: boolean;
  /** the actor's group is named on it: more than one group shown */
  many: boolean;
  /** all it shows: drawn again only when this changes */
  sig: string;
}
/** A heading over the Saved column's cards of a folder: its path (and group); "In no folder", its mark left out. */
export interface MonFolderRow {
  kind: "folder";
  key: string;
  text: string;
  inFolder: boolean;
}
export interface MonColumn {
  name: Group;
  open: boolean;
  title: string;
  /** its count, as its head says it ("3"; Saved's "1 of 4") */
  count: string;
  rows: (MonCardRow | MonFolderRow)[];
}
export interface MonitorModel {
  /** "4 actors in 2 groups" */
  head: string;
  /** the server is older than the monitor: no /api/monitor */
  old: boolean;
  columns: MonColumn[];
}
/** What the monitor reads besides the home and the list's view: the columns folded, what was read, the avatars' look. */
export interface MonitorView {
  folded: ReadonlySet<string>;
  got: MonGot;
  old: boolean;
  avatarMode: string;
}

const isAt = (sel: readonly [string, string] | null | undefined, g: string, c: string): boolean =>
  !!sel && sel[0] === g && sel[1] === c;

/** "N closed, K more open under their status" (M saved in all) */
const savedCount = (n: number, m: number): string =>
  !m ? "none" : `${n} closed` + (m > n ? `, ${m - n} more open under ${m - n === 1 ? "its" : "their"} status` : "");

/** The monitor, from the home, what is shown and what was read. */
export function buildMonitor(ctx: ListCtx, view: ListView, mv: MonitorView): MonitorModel {
  const shown = ctx.home.gatherers.filter((g) => !isHidden(ctx, g)),
    many = shown.length > 1;
  const by = new Map<Group, [Gatherer, Actor][]>(GROUPS.map((n) => [n, []]));
  for (const g of shown) for (const a of g.agents) by.get(groupOf(ctx, g, a))!.push([g, a]);
  by.get("Closed")!.sort(([, x], [, y]) => (y.last || 0) - (x.last || 0));
  const total = shown.reduce((n, g) => n + g.agents.length, 0);
  const columns: MonColumn[] = [];
  for (const n of MON_ORDER) {
    const list = by.get(n)!;
    if (!list.length) continue;
    const open = !mv.folded.has(n);
    const savedAll =
      n === "Saved"
        ? shown.reduce((k, g) => k + g.agents.filter((a) => !isCoordinator(a) && savedAs(ctx, g.name, a)).length, 0)
        : 0;
    columns.push({
      name: n,
      open,
      title:
        (open ? `Fold ${n.toLowerCase()}` : `Show ${n.toLowerCase()}`) +
        (n === "Saved" ? ` · ${savedCount(list.length, savedAll)}` : ""),
      count: n === "Saved" ? `${list.length} of ${savedAll}` : String(list.length),
      rows: open
        ? rowsOf(ctx, n, list, many).map((r) => (r.kind === "folder" ? r : cardOf(ctx, view, mv, r, many)))
        : [],
    });
  }
  return {
    head: `${plural(total, "actor")}${many ? ` in ${plural(shown.length, "group")}` : ""}`,
    old: mv.old,
    columns,
  };
}

/** A column's cards in order, Saved's under a heading for each folder (its gatherer's, by path), those in none last. */
function rowsOf(
  ctx: ListCtx,
  n: Group,
  list: [Gatherer, Actor][],
  many: boolean,
): (MonFolderRow | { kind: "actor"; g: Gatherer; a: Actor })[] {
  if (n !== "Saved") return list.map(([g, a]) => ({ kind: "actor", g, a }));
  const at = new Map(ctx.home.gatherers.map((g, i) => [g.name, i]));
  const of = list.map(([g, a]): [Gatherer, Actor, string | null] => {
    const fid = folderOf(ctx, g.name, a);
    return [g, a, fid === null ? null : folderPath(ctx, g.name, fid)];
  });
  of.sort(
    ([g, , f], [h, , e]) =>
      at.get(g.name)! - at.get(h.name)! || Number(!f) - Number(!e) || byName(String(f || ""), String(e || "")),
  );
  const out: (MonFolderRow | { kind: "actor"; g: Gatherer; a: Actor })[] = [];
  let last: string | null = null;
  for (const [g, a, f] of of) {
    const k = f ? `${g.name}\u0000${f}` : `${g.name}\u0000`;
    // "In no folder" only after some folder
    if (k !== last && (f || of.some(([h, , e]) => h === g && e)))
      out.push({
        kind: "folder",
        key: k,
        text: `${f || "In no folder"}${many ? ` · ${titleOf(ctx, g)}` : ""}`,
        inFolder: !!f,
      });
    last = k;
    out.push({ kind: "actor", g, a });
  }
  return out;
}

function cardOf(
  ctx: ListCtx,
  view: ListView,
  mv: MonitorView,
  { g, a }: { g: Gatherer; a: Actor },
  many: boolean,
): MonCardRow {
  const k = key(g.name, a.channel),
    got = mv.got.get(k),
    d = got ? got.data : null;
  const current = isAt(view.focused, g.name, a.channel),
    open = !current && view.open.some((sel) => isAt(sel, g.name, a.channel));
  const saved = savedAs(ctx, g.name, a);
  return {
    kind: "card",
    key: k,
    g,
    a,
    status: statusOf(ctx, a),
    d,
    read: got !== undefined,
    current,
    open,
    many,
    sig: JSON.stringify([a, d, got !== undefined, many, current, open, mv.avatarMode, saved]),
  };
}

/** A reply's words in a line: its code blocks, marks and headings out. */
export const plainWords = (t: unknown): string =>
  String(t || "")
    .replace(/```[\s\S]*?```/g, " … ")
    .replace(/`|\*\*|^#{1,6}\s+|^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
