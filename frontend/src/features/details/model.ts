// What the Details panel's cards show, worked out apart from drawing it: a context as the model got it, a run of one
// kind at a time with the items the type filter lets through (contextRows); how a context or all calls divide, by kind
// and by part (entry, placed, divide); the latest context with what the next call will carry (withPending).
import { full } from "../../core/format";
import {
  GATHERER,
  GROUP_ORDER,
  HISTORY,
  INLINE,
  NOT_COUNTED,
  PREAMBLE,
  color,
  itemType,
  label,
  uncounted,
} from "../../core/model/items";
import type { Agent, Context, Item } from "./types";

/** What a run's or list's header counts: all its items and tokens, and of them what the type filters leave shown. */
export const tally = (n: number, shown: number, tokens: number, shownTokens: number, noun = "item"): string =>
  `${full(n)} ${noun}${n !== 1 ? "s" : ""}` +
  (shown < n ? ` (${full(shown)} shown)` : "") +
  ` and ${full(tokens)} tokens` +
  (shown < n ? ` (${full(shownTokens)} shown)` : "");

/** The latest context as the next call will have it: what the channel has since the latest call (data.py's
 * after_read: events stored by a call that logged no read, such as a side call, and the pending answers, which the next
 * call will carry) at its end, as its recent history. */
export function withPending(ctx: Context | null, agent: Agent | null, latest: boolean): Context | null {
  const pending = latest && ctx && ctx.items ? (agent && (agent.after_read || agent.pending)) || [] : [];
  if (!ctx || !pending.length) return ctx;
  const items = [
    ...ctx.items,
    ...pending.map((it, i) => ({ ...it, group: "Recent history", position: ctx.items.length + i })),
  ];
  return { ...ctx, items, tokens: ctx.tokens + pending.reduce((n, i) => n + i.tokens, 0) };
}

/** What an item is across draws and reads: its event's row, ag's made item, or -- a preamble part, an answer no call has
 * stored yet -- its name (and time); the same name again in one context counted on. */
export function ctxKey(it: Partial<Item>, seen: Map<string, number>): string {
  const base =
    it.row_id !== null && it.row_id !== undefined
      ? `r${it.row_id}`
      : it.made_id !== null && it.made_id !== undefined
        ? `m${it.made_id}`
        : `${it.group}:${it.name}:${it.at ?? ""}`;
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return n > 1 ? `${base}#${n}` : base;
}

/** An item's row as drawn: drawn anew (closed) when what it shows changes, kept (open, if opened) while it does not. */
export const rowKey = (k: string, it: Partial<Item>): string =>
  `${k}|${it.group}:${it.name}:${it.tokens}:${it.clipped}:${(it.text ?? "").length}`;

/** A row of a context's list: a run's heading (its colour, its name, its tally), an item, or the note under what ag
 * did not count. */
export type CtxRow =
  | { kind: "head"; key: string; swatch: string; name: string; text: string }
  | { kind: "item"; key: string; item: Item }
  | { kind: "note"; key: string };

/** A context's items, in the order the model got them: a heading for each run of one kind, and the items of it the
 * types shown let through -- its preamble's parts first, if chosen; what the provider counted beyond all of it last. */
export function contextRows(ctx: Context, shown: ReadonlySet<string>): CtxRow[] {
  const out: CtxRow[] = [];
  const seen = new Map<string, number>();
  const item = (it: Item) => {
    const k = ctxKey(it, seen);
    out.push({ kind: "item", key: rowKey(k, it), item: it });
  };
  const preamble = ctx.preamble || [];
  if (preamble.length) {
    const n = preamble.length,
      on = shown.has("preamble");
    const pre = preamble.reduce((t, p) => t + p.tokens, 0);
    out.push({
      kind: "head",
      key: "h:pre",
      swatch: color(PREAMBLE),
      name: PREAMBLE,
      text: `${tally(n, on ? n : 0, pre, on ? pre : 0, "part")} · what the harness sent besides its messages`,
    });
    if (on) for (const p of preamble) item(p);
  }
  let run: { at: number; group: string; items: number; shown: number; tokens: number; shownTokens: number } | null =
    null;
  const head = (r: NonNullable<typeof run>) => {
    out[r.at] = {
      kind: "head",
      key: `h${r.at}`,
      swatch: color(r.group),
      name: label(r.group),
      text: tally(r.items, r.shown, r.tokens, r.shownTokens),
    };
  };
  for (const it of ctx.items) {
    // ag's messages among the history belong to the run they sit in (the recent history, before any)
    const group: string = INLINE.has(it.group)
      ? run && HISTORY.has(run.group)
        ? run.group
        : "Recent history"
      : it.group;
    if (!run || run.group !== group) {
      run = { at: out.length, group, items: 0, shown: 0, tokens: 0, shownTokens: 0 };
      out.push({ kind: "note", key: "" }); // its heading's place, filled in below
    }
    run.items++;
    run.tokens += it.tokens;
    const listed = GATHERER.has(it.group) ? shown.has("gatherer") : !HISTORY.has(group) || shown.has(itemType(it)[0]);
    if (listed) {
      run.shown++;
      run.shownTokens += it.tokens;
      item(it);
    }
    head(run);
  }
  if (uncounted(ctx.not_counted)) {
    out.push({
      kind: "head",
      key: "h:nc",
      swatch: color(NOT_COUNTED),
      name: NOT_COUNTED,
      text: `${full(ctx.not_counted)} tokens`,
    });
    out.push({ kind: "note", key: "nc" });
  }
  return out;
}

/** Where an item goes in a figure of how a context divides: its run's group, and its part -- a type for the history, a
 * name for the rest. */
export interface Entry {
  group: string;
  part: string;
  label: string;
  color: string;
  tokens: number;
  items: number;
}

export function entry(it: { name: string; tokens: number; group?: string }, group: string, items = 1): Entry {
  if (group === PREAMBLE || group === NOT_COUNTED)
    return { group, part: it.name, label: it.name, color: color(group), tokens: it.tokens, items };
  const history = HISTORY.has(group);
  const t = itemType(it);
  return {
    group,
    part: history ? t[0] : it.name,
    label: history ? t[1] : it.name,
    color: history ? t[2] : color(group),
    tokens: it.tokens,
    items,
  };
}

/** One context's items, in order: ag's messages among the history in the history they sit in, as the list shows them. */
export function placed(items: Item[]): Entry[] {
  let current: string | null = null;
  return items.map((it) => {
    const group = INLINE.has(it.group) ? current || "Recent history" : it.group;
    if (HISTORY.has(it.group)) current = it.group;
    return entry(it, group);
  });
}

/** How a context divides by kind and by part, by ag's own count: its preamble, its items, what ag did not count. */
export function contextEntries(ctx: Context): Entry[] {
  return [
    ...(ctx.preamble || []).map((p) => entry(p, PREAMBLE)),
    ...(uncounted(ctx.not_counted) ? [entry({ name: "not counted", tokens: ctx.not_counted! }, NOT_COUNTED)] : []),
    ...placed(ctx.items),
  ];
}

/** A kind's parts, added up. */
export interface Part {
  label: string;
  color: string;
  tokens: number;
  items: number;
}

export interface Kind {
  group: string;
  tokens: number;
  items: number;
  parts: Map<string, Part>;
}

/** The entries added up by kind and part, the kinds in their order; and all of them (1 for none, to divide by). */
export function divide(entries: Entry[]): { total: number; kinds: Kind[] } {
  const total = entries.reduce((n, e) => n + e.tokens, 0) || 1;
  const groups = new Map<string, Kind>();
  for (const p of entries) {
    const g = groups.get(p.group) || { group: p.group, tokens: 0, items: 0, parts: new Map<string, Part>() };
    g.tokens += p.tokens;
    g.items += p.items;
    const part = g.parts.get(p.part) || { label: p.label, color: p.color, tokens: 0, items: 0 };
    part.tokens += p.tokens;
    part.items += p.items;
    g.parts.set(p.part, part);
    groups.set(p.group, g);
  }
  const kinds = [...groups.values()].sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group));
  return { total, kinds };
}

/** Which of a context's items to list, by type: their counts, for the chips; null when it has nothing to choose. */
export function typeCounts(ctx: Context): Record<string, number> | null {
  const history = ctx.items.filter((i) => HISTORY.has(i.group) || GATHERER.has(i.group));
  if (!history.length && !(ctx.preamble || []).length) return null;
  const counts: Record<string, number> = { preamble: (ctx.preamble || []).length };
  for (const i of history) {
    const t = itemType(i)[0];
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

/** The reads' sizes, ag's count of each made from what was recorded of it: as it counted it then, else as stored now (its
 * messages, the preamble where recorded). */
export function counted<
  R extends {
    recorded_tokens?: number | null;
    sent_tokens?: number | null;
    preamble_tokens?: number | null;
    counted_tokens?: number | null;
  },
>(reads: R[]): void {
  for (const r of reads)
    r.counted_tokens =
      r.recorded_tokens ??
      (r.sent_tokens === null || r.sent_tokens === undefined ? null : r.sent_tokens + (r.preamble_tokens || 0));
}
