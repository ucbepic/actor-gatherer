// THE MONITOR (#monitor), the list over the whole page, from its view-model (monitor.ts): a column for each group that has
// actors, folded to a strip by its head, and in each a card for each actor -- who it is, its status, what it is doing
// (what it waits on the reader for, its error, what it runs now and its newest calls, what runs in the background, or
// once done, what it said last) and the files its latest turn worked on. A card is drawn again only when what it shows
// changes (its signature), so an actor at work goes on as it was -- its stage, its glyphs -- and each is watched while it
// is in view (the page reads what its turn did for those).
import { memo, useCallback, type MouseEvent } from "react";
import { compact, lasting, plural } from "../../core/format";
import { StrokeIcon } from "../../core/ui/Icon";
import { Html } from "../../core/ui/PageNode";
import { titleOf } from "./groups";
import type { PageParts } from "./host";
import { plainWords, type MonCardRow, type MonColumn, type MonData, type MonitorModel } from "./monitor-model";
import { Face, useFilled, useSpin } from "./Parts";
import { GROUP_CLS, type Group } from "./status";
import type { Actor, Gatherer, ListCtx } from "./types";

/** What the monitor calls of the page around it (features/list/modes.js's MON_HOST). */
export interface MonitorHost extends PageParts {
  ctx: ListCtx;
  /** a folder's icon path (ICONS.folder) */
  folderIcon: string;
  /** a card in view, watched (its key); and not, once it is gone */
  observe(node: Element): void;
  unobserve(node: Element, key: string): void;
  /** a column folded, or opened */
  foldSection(name: string): void;
  /** a card pressed: the monitor left, its actor shown; right-clicked (or Ctrl+click on a Mac): beside the one shown */
  show(g: Gatherer, a: Actor, ev: MouseEvent): void;
  showBeside(g: Gatherer, a: Actor, ev: MouseEvent): void;
  /** the actor at work, small, on its stage */
  atWork(a: Actor, work: unknown): Node;
  /** a permission's verb, as Chat says it ("run a command") */
  permissionVerb(asking: unknown): string;
  /** what runs in the background, by its kind */
  taskKind(kind: string | undefined): string;
  /** the kinds of files a turn worked on: [what they are called, their colour] */
  fileKinds: Readonly<Record<string, readonly [string, string]>>;
}

export function Monitor({ m, host }: { m: MonitorModel; host: MonitorHost }) {
  return (
    <>
      <div className="m-top">
        <h2>{m.head}</h2>
        {m.old ? (
          <span className="m-old" role="status">
            The dashboard&apos;s server is out of date. Restart the dashboard to see each actor&apos;s calls and
            replies.
          </span>
        ) : null}
      </div>
      <div className="m-board">
        {m.columns.map((c) => (
          <Column key={c.name} c={c} host={host} />
        ))}
      </div>
    </>
  );
}

/** Each group's mark, as the list marks its actors. */
function GroupMark({ name, host }: { name: Group; host: MonitorHost }) {
  const spin = useSpin();
  if (name === "Saved") return <Html node={host.saveIcon(true)} />;
  return (
    <span className={`status ${GROUP_CLS[name]}`} aria-hidden="true">
      <i style={spin} />
    </span>
  );
}

function Column({ c, host }: { c: MonColumn; host: MonitorHost }) {
  return (
    <section className={"m-col" + (c.open ? "" : " folded")} aria-label={c.name}>
      <button
        className="m-head"
        type="button"
        aria-expanded={c.open ? "true" : "false"}
        title={c.title}
        onClick={() => host.foldSection(c.name)}
      >
        <span className="caret">▶</span>
        <GroupMark name={c.name} host={host} />
        {c.name}
        <span className="n">{c.count}</span>
      </button>
      {c.open ? (
        <div className="m-body">
          {c.rows.map((r) =>
            r.kind === "folder" ? (
              <div key={r.key} className="m-folder">
                <span
                  className="folder-mark"
                  aria-hidden="true"
                  style={r.inFolder ? undefined : { visibility: "hidden" }}
                >
                  <StrokeIcon d={host.folderIcon} size={14} />
                </span>
                <span>{r.text}</span>
              </div>
            ) : (
              <Card key={r.key} r={r} host={host} />
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

/** What the actor is doing, or waits on, in a line: its question, its error, its call under way or its thinking, what
 * runs in the background -- or, done, what it said last. None to say: null. */
interface NowLine {
  kind: string;
  lbl: string;
  text: string | null;
  since: number | null;
  /** the call it runs now (left out of its steps) */
  call?: string;
}
function nowLine(host: MonitorHost, a: Actor, cls: string, d: MonData | null): NowLine | null {
  const line = (kind: string, lbl: string, text: string | null, since: number | null | undefined = null): NowLine => ({
    kind,
    lbl,
    text,
    since: since || null,
  });
  const ask = a.asking;
  if (cls === "asking" && ask)
    return line(
      "ask",
      "Waiting for you:",
      ask.kind === "permission"
        ? `Permission to ${host.permissionVerb(ask)}: ${ask.said || ask.tool}`
        : ask.kind === "dialog"
          ? `${ask.menu ? "Before it starts" : "In its terminal"}: ${[ask.title, ask.said].filter(Boolean).join(" · ")}`
          : ask.kind === "plan"
            ? "A plan to approve"
            : (ask.questions || [])
                .map((q) => q.question)
                .filter(Boolean)
                .join(" · ") || "A question",
      ask.at,
    );
  if (cls === "error" || cls === "failed")
    return line(
      "err",
      "Error:",
      (a.failing && a.failing.error) ||
        (a.stopped && a.stopped.text) ||
        (cls === "failed" ? "The agent failed to start" : "Stopped on an error"),
      (a.failing || a.stopped || {}).at,
    );
  if (cls === "running") {
    if (a.failing)
      return line(
        "err",
        "Retrying:",
        `${a.failing.error || "the model call failed"} (${plural(a.failing.attempts, "try")})`,
        a.failing.at,
      );
    const n = d && d.now;
    if (n && n.kind === "call") return { ...line("run", "Running:", n.text || "", a.last), call: n.text };
    return line("run", n && n.kind === "thinking" ? "Thinking…" : "Working…", null, a.last);
  }
  if (cls === "background" && (a.background || []).length)
    return line(
      "bg",
      "In the background:",
      a.background!.map((t) => `${host.taskKind(t.kind)}: ${t.label || t.id}`).join(" · "),
    );
  if (d && d.said) return line("said", "Said:", plainWords(d.said));
  return null;
}

const STEPPED = ["running", "asking", "error", "background", "building"];

/** A card: drawn again only when what it shows changed (its signature). */
const Card = memo(
  function Card({ r, host }: { r: MonCardRow; host: MonitorHost }) {
    const { g, a, d, key: k } = r,
      [cls, label] = r.status,
      live = cls === "running";
    const spin = useSpin();
    const stage = useFilled<HTMLDivElement>(
      () => (live ? [host.atWork({ ...a, channel: `monitor ${a.channel}` }, { work: (d && d.work) || {} })] : []),
      [r.sig],
    );
    const seen = useCallback(
      (n: HTMLButtonElement | null) => {
        if (!n) return;
        host.observe(n);
        return () => host.unobserve(n, k);
      },
      [host, k],
    );
    const named = a.name && a.name.text,
      words = a.last_user_message;
    const size = a.real_tokens ?? a.sent_tokens;
    const now = nowLine(host, a, cls, d);
    // not what the line above says
    const steps =
      d && d.steps && STEPPED.includes(cls)
        ? d.steps.filter((s) => !(s.running && (cls === "asking" || (now && now.call && s.text === now.call))))
        : [];
    const earlier = d && steps.length ? (d.calls || 0) - d.steps!.length : 0;
    const said = d && d.said && !(now && now.kind === "said");
    const kinds = d && d.files ? Object.entries(d.files) : [];
    return (
      <button
        ref={seen}
        className={`m-card ${cls}`}
        type="button"
        aria-current={r.current ? "true" : "false"}
        data-open={r.open ? "true" : undefined}
        data-key={k}
        title={`${host.harnessName(a.harness)} · ${g.name} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}\nClick to show it${host.snapshot ? "" : ` · ${host.besideKey}+click to open side by side`}`}
        onClick={(ev) => host.show(g, a, ev)}
        onContextMenu={(ev) => host.showBeside(g, a, ev)}
      >
        <div className="c-head">
          {live ? (
            <div className="c-pic acting" aria-hidden="true" ref={stage} />
          ) : (
            <div className="c-pic">
              <Face host={host} a={a} />
            </div>
          )}
          <div className="c-who">
            {named ? <div className="c-name">{named}</div> : null}
            <div className={"c-asked" + (words ? "" : " none")}>{words || "No message yet"}</div>
            <div className="c-meta">
              <span className={`status ${cls}`}>
                <i aria-hidden="true" style={spin} />
                {label}
              </span>
              {live && d && d.at ? (
                <span title="This turn so far">
                  {"for "}
                  <span data-lasting={d.at}>{lasting(d.at)}</span>
                </span>
              ) : (
                <span data-ago={a.last || ""}>{host.ago(a.last)}</span>
              )}
              {size !== null && size !== undefined ? <span>{`${compact(size)} tokens`}</span> : null}
              {r.many ? <span className="gname">{titleOf(host.ctx, g)}</span> : null}
            </div>
          </div>
        </div>
        {now ? (
          <div className={`c-now ${now.kind}`}>
            <span className="lbl">{now.lbl}</span>
            {now.text ? <span className="tx">{now.text}</span> : null}
            {now.since ? (
              <span className="tm" aria-hidden="true" data-ago={now.since}>
                {host.ago(now.since)}
              </span>
            ) : null}
          </div>
        ) : null}
        {steps.length ? (
          <div className="c-steps">
            {earlier > 0 ? <div className="c-step more">{plural(earlier, "earlier call")}</div> : null}
            {steps.map((s, i) => {
              const [gc, word] = s.error
                ? ["err", "failed"]
                : !s.running
                  ? ["ok", "ran"]
                  : live
                    ? ["run", "running"]
                    : cls === "asking"
                      ? ["run", "waiting"]
                      : ["stop", "stopped"];
              return (
                <div key={i} className="c-step" title={`${word}: ${s.text}`}>
                  <span className={`g ${gc}`} aria-label={word}>
                    ●
                  </span>
                  <span className="t">{s.text}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        {said ? (
          <div className="c-now said">
            <span className="lbl">Said:</span>
            <span className="tx">{plainWords(d!.said)}</span>
          </div>
        ) : null}
        {a.recap && a.recap.text && !live ? (
          <div className="c-recap" title={`Recap, ${host.ago(a.recap.at)}:\n${a.recap.text}`}>
            <span className="lbl">Recap</span>
            {a.recap.text}
          </div>
        ) : null}
        {d && (kinds.length || d.calls) ? (
          <div className="c-foot">
            {kinds.map(([kind, n]) => (
              <span key={kind} className="fk">
                <i style={{ background: (host.fileKinds[kind] || [kind, "var(--muted)"])[1] }} />
                {`${n} ${(host.fileKinds[kind] || [kind])[0]}`}
              </span>
            ))}
            {d.calls ? <span>{plural(d.calls, "call")}</span> : null}
            {d.turns && d.turns > 1 ? <span>{`turn ${d.turns}`}</span> : null}
          </div>
        ) : null}
        {!d && !host.snapshot && !r.read ? (
          <div className="c-wait" aria-hidden="true">
            …
          </div>
        ) : null}
      </button>
    );
  },
  (p, n) => p.r.sig === n.r.sig && p.host === n.host,
);
