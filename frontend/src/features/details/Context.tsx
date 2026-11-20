// What a model call was sent, as Details shows it: the context card (how it divides, and its items in order, a run of
// one kind at a time, filtered by type), the size card (each call's size over time, a click picking the call whose
// context to show), and the parts the Messages view lists its events with too -- an item's row, the columns' heads, the
// chips of the types shown.
import { useEffect, useRef, useState } from "react";
import { clock, full } from "../../core/format";
import {
  GATHERER,
  HISTORY,
  OTHER_TYPE,
  PREAMBLE,
  PREAMBLE_TYPE,
  TYPES,
  color,
  itemType,
  useShown,
  wordless,
} from "../../core/model/items";
import { LineChart, Legend, type Series } from "./Charts";
import { Decomposition } from "./Decomposition";
import { contextEntries, contextRows, typeCounts, withPending, type CtxRow } from "./model";
import { pickRead, pickedFor, shownRead, useContextOf, usePicked } from "./store";
import type { Agent, Item, Read } from "./types";

/** The columns' heads of a list of items (inside its `div.cols`). */
export function ColumnsBody() {
  return (
    <>
      <span />
      <span>Type</span>
      <span>Message</span>
      <span className="n" title="ag's own count">
        Tokens
      </span>
    </>
  );
}

export const Columns = () => (
  <div className="cols">
    <ColumnsBody />
  </div>
);

/** The chips' box's own attributes. */
export const FILTERS = { className: "filters", role: "group", "aria-label": "Message types shown" } as const;

/** The chips of the types the lists show (useShown), inside their box (FILTERS). With counts, only the types present,
 * counted. */
export function TypeChipsBody({ counts }: { counts: Record<string, number> | null }) {
  const shown = useShown((s) => s.types);
  const toggle = useShown((s) => s.toggle);
  return (
    <>
      <span className="label">Shows</span>
      {[TYPES[6], ...TYPES.slice(0, 6), OTHER_TYPE, PREAMBLE_TYPE]
        .filter(([type]) => (counts ? !!counts[type] : type !== OTHER_TYPE[0] && type !== PREAMBLE_TYPE[0]))
        .map(([type, name, swatch]) => (
          <button key={type} type="button" className="chip" aria-pressed={shown.has(type)} onClick={() => toggle(type)}>
            <span className="dot" style={{ background: swatch }} />
            {counts ? `${name} ${counts[type]}` : name}
          </button>
        ))}
    </>
  );
}

export const TypeChips = ({ counts }: { counts: Record<string, number> | null }) => (
  <div {...FILTERS}>
    <TypeChipsBody counts={counts} />
  </div>
);

/** An item's row, inside its `details` (the list's, or a node of its own: nodes.tsx): its type's colour, its name, the
 * start of its words, its size; the whole of its words once it is first opened. */
export function ItemBody({ it }: { it: Item }) {
  const head = useRef<HTMLElement>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const box = head.current?.parentElement as HTMLDetailsElement | null;
    if (!box || opened) return;
    const toggled = () => {
      if (box.open) setOpened(true);
    };
    box.addEventListener("toggle", toggled);
    return () => box.removeEventListener("toggle", toggled);
  }, [opened]);
  const preview = it.text.replace(/\s+/g, " ").slice(0, 220);
  const typed = (HISTORY.has(it.group) || GATHERER.has(it.group)) && it.group !== PREAMBLE;
  return (
    <>
      <summary ref={head}>
        <span className="bar-key" style={{ background: typed ? itemType(it)[2] : color(it.group) }} />
        <span className="mono kind">{it.name}</span>
        <span className={"preview" + (preview ? "" : " none")}>{preview || wordless(it)}</span>
        <span className="n">{full(it.tokens)}</span>
      </summary>
      {opened ? (
        <pre>
          {(it.text || `(${wordless(it)})`) + (it.clipped ? `\n… ${full(it.clipped)} more characters not shown` : "")}
        </pre>
      ) : null}
    </>
  );
}

export function ContextItem({ it }: { it: Item }) {
  return (
    <details className="item">
      <ItemBody it={it} />
    </details>
  );
}

/** A list's rows (model.ts's contextRows): each kept from one draw to the next while it is the same. */
export function Rows({ rows }: { rows: CtxRow[] }) {
  return rows.map((r) =>
    r.kind === "item" ? (
      <ContextItem key={r.key} it={r.item} />
    ) : r.kind === "head" ? (
      <div key={r.key} className="run">
        <span className="key-rect" style={{ background: r.swatch }} />
        <strong>{r.name}</strong>
        <span>{r.text}</span>
      </div>
    ) : (
      <div key={r.key} className="uncounted">
        {"The provider's count minus everything above: tokens ag can't see, such as " +
          "tokenizer differences, reasoning, hidden payloads and message framing."}
      </div>
    ),
  );
}

/** Which actor, and what ag recorded of its calls: what the context and size cards are drawn for. */
export interface CallsOf {
  /** the actor's key */
  actor: string;
  gatherer: string;
  agent: Agent | null;
  snapshot: boolean;
}

/** The context the size chart has picked: the latest call's, with what is pending, or an earlier one's -- inside its
 * `section.card`. */
export function ContextCardBody({ actor, gatherer, agent, snapshot }: CallsOf) {
  const picked = usePicked((s) => pickedFor(s, actor));
  const shown = useShown((s) => s.types);
  const readId = shownRead(agent, picked);
  const latest = picked === null;
  const ctx = withPending(useContextOf(gatherer, readId), agent, latest);
  const title = (
    <div className="card-title">
      <h3>{latest ? "Context right now" : `Context at read ${readId}`}</h3>
      {latest ? null : (
        <button type="button" onClick={() => pickRead(actor, gatherer, agent, null)}>
          Back to the latest
        </button>
      )}
    </div>
  );
  if (!ctx || !ctx.items)
    return (
      <>
        {title}
        <div className="desc">
          {snapshot && !latest
            ? "A snapshot keeps only each actor's latest context. Run `ag dashboard` live to see older ones."
            : "No context sent yet."}
        </div>
      </>
    );
  const real = typeof ctx.real_tokens === "number" ? `, ${full(ctx.real_tokens)} by the provider's` : "";
  const pre = (ctx.preamble || []).reduce((n, p) => n + p.tokens, 0);
  const counts = typeCounts(ctx);
  return (
    <>
      {title}
      <div className="desc">
        {`What ${latest ? "the latest call" : "this call"} sent (read ${ctx.read_id}, ${clock(ctx.at, true)}), in order: ` +
          (pre ? `the harness's preamble (${full(pre)} tokens), then ` : "") +
          `${full(ctx.items.length)} items, ${full(ctx.tokens)} tokens by ag's count${real}.` +
          (ctx.cut
            ? ` From build ${ctx.basis}, which cut the history at row ${ctx.cut}.`
            : " No build yet, so the whole history is sent as is.") +
          (latest ? " Click the size chart to see an earlier call." : "")}
      </div>
      <Decomposition entries={contextEntries(ctx)} />
      {counts ? <TypeChips counts={counts} /> : null}
      <div className="ctx tall" data-keep="context">
        <Columns />
        <Rows rows={contextRows(ctx, shown)} />
      </div>
    </>
  );
}

export const ContextCard = (p: CallsOf) => (
  <section className="card">
    <ContextCardBody {...p} />
  </section>
);

const SIZES = [
  "Read",
  "Time",
  "Provider's count",
  "ag's count",
  "Preamble",
  "ag's budgeted size",
  "Limit",
  "Tasks",
  "Build",
];

export type SizeProps = CallsOf & { reads: Read[]; hasReal: boolean };

/** Each model call's context size, as the provider and ag counted it: a chart of the actor's calls -- a click on it
 * picks the call whose context the context card shows -- and `reads` as a table (`hasReal`: with the provider's count);
 * inside its `section.card`. */
export function SizeCardBody({ actor, gatherer, agent, reads, hasReal }: SizeProps) {
  const picked = usePicked((s) => pickedFor(s, actor));
  const all = agent?.reads || [];
  const series: Series[] = [
    ...(all.some((r) => typeof r.real_tokens === "number")
      ? [{ field: "real_tokens" as const, color: "var(--s1)", label: "provider's count" }]
      : []),
    { field: "counted_tokens", color: "var(--s2)", label: "ag's own count" },
  ];
  return (
    <>
      <h3>Context size</h3>
      <div className="desc">
        {(hasReal
          ? "Each model call's context in tokens, as counted by the provider and by ag."
          : "Each model call's context in tokens, as counted by ag. These reads have no provider count.") +
          " Click the chart to see a call's context."}
      </div>
      <Legend
        items={[
          ...(hasReal ? [{ label: "Provider's count", color: "var(--s1)" }] : []),
          { label: "ag's own count", color: "var(--s2)" },
          { label: "Rebuild", kind: "rule" as const },
        ]}
      />
      <LineChart
        id="size-chart"
        reads={all}
        series={series}
        picked={shownRead(agent, picked)}
        onPick={(id) => pickRead(actor, gatherer, agent, id)}
      />
      <details id="size-table">
        <summary>Show as a table</summary>
        <div className="scroll tall" data-keep="size-table">
          <table>
            <thead>
              <tr>
                {SIZES.map((h, i) => (
                  <th key={h} className={i >= 2 && i <= 7 ? "n" : ""}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...reads].reverse().map((r) => (
                <tr key={r.read_id}>
                  <td className="n">{r.read_id}</td>
                  <td>{clock(r.at, true)}</td>
                  <td className="n">{full(r.real_tokens)}</td>
                  <td className="n">{full(r.counted_tokens ?? r.sent_tokens)}</td>
                  <td className="n">
                    {r.preamble_tokens === null || r.preamble_tokens === undefined
                      ? "not recorded"
                      : full(r.preamble_tokens)}
                  </td>
                  <td className="n">{full(r.est_tokens)}</td>
                  <td className="n">{full(r.limit_tokens)}</td>
                  <td className="n">{r.tasks}</td>
                  <td>{(r.basis ?? "none") + (r.rebuild ? " (rebuild)" : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export const SizeCard = (p: SizeProps) => (
  <section className="card">
    <SizeCardBody {...p} />
  </section>
);
