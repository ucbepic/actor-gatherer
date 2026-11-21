// The Details panel, beside an actor's Chat: the history's other views and the actor's facts, then its calls (Actor),
// what the model was sent (Context: what `/context` in the message box opens), and what ag did for it (Gatherer) -- one
// part under another. No × of its own: the pane head's Details button (pressed while it is open) closes it, as Esc does.
import type { ReactNode } from "react";
import { ago, clock, compact, full, plural, span, usd } from "../../core/format";
import { canChat, harnessLabel, runnableNames } from "../../core/model/harness";
import { INLINE, NOT_COUNTED, uncounted } from "../../core/model/items";
import { parse } from "../../core/model/keys";
import { StrokeIcon } from "../../core/ui/Icon";
import { ContextCard, SizeCard, type CallsOf } from "./Context";
import { Decomposition } from "./Decomposition";
import { entry } from "./model";
import type { Agent, Build, DetailsFeed, DetailsHost } from "./types";

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="note">{note}</div>
    </div>
  );
}

/** The history's other views (`more`): one picked is shown in place of the chat, and the panel closed. */
function MoreViews({ feed, host }: { feed: DetailsFeed; host: DetailsHost }) {
  if (!feed.views.length) return null;
  return (
    <section className="more-views">
      <h4>Show the history as</h4>
      {feed.views.map((v) => (
        <button key={v.id} type="button" aria-pressed={v.id === feed.current} onClick={() => host.showView(v.id)}>
          {v.icon ? <StrokeIcon d={v.icon} size={16} /> : <span />}
          <span className="name">{v.name}</span>
          {v.description ? <span className="desc">{v.description}</span> : null}
        </button>
      ))}
    </section>
  );
}

/** The actor's own facts: where it runs, as what, and how the dashboard can reach it. */
function Facts({ feed }: { feed: DetailsFeed }) {
  const { info, home } = feed,
    s = info.session,
    k = parse(feed.key);
  const rows: [string, string | null | undefined][] = [
    ["Harness", harnessLabel(home, info.harness || feed.agent?.harness)],
    ["Gatherer", k.group],
    ["Channel", k.id],
    ["Directory", info.cwd || s?.cwd],
    ["Process", info.pid ? `PID ${info.pid}` : null],
    [
      "Chat",
      !canChat(home, info)
        ? `Only ${runnableNames(home, "and")} sessions with a directory can be messaged here`
        : s && s.terminal
          ? "Open in the dashboard's terminal"
          : s
            ? `Run by the dashboard · permissions ${s.permission_mode}`
            : "Started elsewhere · a message resumes it here with auto permissions",
    ],
  ];
  return (
    <dl className="facts">
      {rows.filter(([, v]) => v).flatMap(([k, v]) => [<dt key={`t${k}`}>{k}</dt>, <dd key={`d${k}`}>{v}</dd>])}
    </dl>
  );
}

/** What all calls sent, added up by kind. */
function UsageCard({ agent }: { agent: Agent }) {
  const u = agent.usage;
  if (!u || !u.entries || !u.entries.length)
    return (
      <section className="card">
        <h3>Tokens sent across all calls</h3>
        <div className="desc">No calls yet.</div>
      </section>
    );
  const real = u.real_calls
    ? ` The provider counted ${full(u.real_tokens)} over the ${full(u.real_calls)} calls it reported.`
    : "";
  // ag's messages among the history count in the recent raw history, where they sit
  const notCounted = uncounted(u.not_counted)
    ? [entry({ name: "not counted", tokens: u.not_counted! }, NOT_COUNTED, u.real_calls)]
    : [];
  return (
    <section className="card">
      <h3>Tokens sent across all calls</h3>
      <div className="desc">
        {`${full(u.tokens)} tokens sent over this actor's ${plural(u.calls, "call")}, by ag's count. ` +
          `Each message, and the harness's preamble, counts once per call it was sent in.${real}` +
          (uncounted(u.not_counted)
            ? ` ${full(u.not_counted)} of the provider's count is shown as "${NOT_COUNTED}".`
            : "")}
      </div>
      <Decomposition
        entries={[
          ...u.entries.map((e) => entry(e, INLINE.has(e.group) ? "Recent history" : e.group, e.items)),
          ...notCounted,
        ]}
        what="all calls"
      />
    </section>
  );
}

/** What the agent saw and did. */
function ActorPart({ agent }: { agent: Agent }) {
  const reads = agent.reads || [],
    last = reads[reads.length - 1];
  return (
    <>
      <div className="tiles">
        <Tile
          label="Context now"
          value={compact(last?.real_tokens ?? last?.counted_tokens)}
          note={
            last?.real_tokens !== null && last?.real_tokens !== undefined
              ? `provider's count · ag counted ${compact(last.counted_tokens)}`
              : "ag's count"
          }
        />
        <Tile
          label="Harness limit"
          value={compact(last?.limit_tokens)}
          note={last?.limit_tokens ? "where the harness compacts" : "none stated"}
        />
        <Tile label="Tasks" value={full(agent.tasks.length)} note="segmented by ag" />
        <Tile label="Reads" value={full(reads.length)} note={last?.at ? `last ${ago(last.at)}` : ""} />
      </div>
      <UsageCard agent={agent} />
    </>
  );
}

const BUILD_HEADS = ["#", "Started", "Reason", "Status", "Duration", ""];
const statusOf = (b: Build): [string, string] =>
  b.status === "failed"
    ? ["failed", "Failed"]
    : b.status === "running"
      ? ["building", "Running"]
      : b.status === "ready"
        ? ["running", "Ready"]
        : ["idle", b.status === "nothing" ? "Nothing to do" : b.status || "?"];

/** Each analysis of the history: why it started, how long it took, how it ended. */
function BuildsCard({ builds, now }: { builds: Build[]; now: number }) {
  const longest = Math.max(1, ...builds.map((b) => (b.finished || now) - (b.started || 0)));
  return (
    <section className="card">
      <h3>{`Builds · ${builds.length}`}</h3>
      <div className="desc">Each analysis of the history: why it started, how long it took, how it ended.</div>
      {!builds.length ? (
        <div className="desc">None yet.</div>
      ) : (
        <div className="scroll tall" data-keep="builds">
          <table>
            <thead>
              <tr>
                {BUILD_HEADS.map((h, i) => (
                  <th key={i} className={i === 0 ? "n" : ""}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...builds].reverse().flatMap((b) => {
                const dur = (b.finished || now) - (b.started || 0),
                  [cls, said] = statusOf(b);
                return [
                  <tr key={b.build_id} title={b.error || ""}>
                    <td className="n">{b.build_id}</td>
                    <td>{clock(b.started, true)}</td>
                    <td>{b.reason || "–"}</td>
                    <td>
                      <span className={"status " + cls}>
                        <i aria-hidden="true" />
                        {said}
                      </span>
                    </td>
                    <td className="n">{span(b.started, b.finished || (b.status === "running" ? now : null))}</td>
                    <td style={{ width: "35%" }}>
                      <span className="bar" style={{ width: `${Math.max(2, (dur / longest) * 100)}%` }} />
                    </td>
                  </tr>,
                  b.error ? (
                    <tr key={`${b.build_id}e`}>
                      <td />
                      <td colSpan={5} className="desc-cell">
                        {b.error}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const LLM_HEADS = ["Purpose", "Calls", "Tokens in", "Tokens out", "Time", "Errors", "Cost"];

/** The Gatherer's calls for this actor: new-task checks, segmentation, summaries, ranking. */
function LlmCard({ agent }: { agent: Agent }) {
  const rows = agent.llm.by_purpose,
    t = agent.llm.total;
  return (
    <section className="card">
      <h3>ag&apos;s own model calls</h3>
      <div className="desc">
        The Gatherer&apos;s calls for this actor: new-task checks, segmentation, summaries, ranking.
      </div>
      {!rows.length ? (
        <div className="desc">None found in the call log.</div>
      ) : (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  {LLM_HEADS.map((h, i) => (
                    <th key={h} className={i ? "n" : ""}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.purpose} title={p.models.join(", ")}>
                    <td>{p.purpose}</td>
                    <td className="n">{full(p.calls)}</td>
                    <td className="n">{compact(p.tokens_in)}</td>
                    <td className="n">{compact(p.tokens_out)}</td>
                    <td className="n">{`${p.seconds}s`}</td>
                    <td className="n">{full(p.errors)}</td>
                    <td className="n">{usd(p.cost) + (p.unpriced ? "*" : "")}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Total</td>
                  <td className="n">{full(t.calls)}</td>
                  <td className="n">{compact(t.tokens_in)}</td>
                  <td className="n">{compact(t.tokens_out)}</td>
                  <td />
                  <td className="n">{full(t.errors)}</td>
                  <td className="n">{usd(t.cost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {t.unpriced ? (
            <div className="warn">{`* Excludes ${t.unpriced} calls to models LiteLLM has no price for.`}</div>
          ) : null}
          {agent.llm_attributed_by_time ? (
            <div className="warn">{`${agent.llm_attributed_by_time} calls predate job tags and were matched to this actor by time.`}</div>
          ) : null}
        </>
      )}
    </section>
  );
}

/** What ag did for the agent. */
function GathererPart({ agent, now }: { agent: Agent; now: number }) {
  const builds = agent.builds || [],
    failed = builds.filter((b) => b.status === "failed").length;
  const llm = agent.llm.total;
  return (
    <>
      <div className="tiles">
        <Tile label="Rebuilds" value={full(agent.rebuilds)} note="reads on a new build" />
        <Tile label="Builds" value={full(builds.length)} note={failed ? `${failed} failed` : "none failed"} />
        <Tile
          label="New-task checks"
          value={full(agent.checks.length)}
          note={`${agent.checks.filter((x) => x.new_task).length} found a new task`}
        />
        <Tile
          label="ag's model calls"
          value={full(llm.calls)}
          note={`${usd(llm.cost)}${llm.unpriced ? ` + ${llm.unpriced} unpriced` : ""}`}
        />
      </div>
      <BuildsCard builds={builds} now={now} />
      <LlmCard agent={agent} />
    </>
  );
}

function Part({ id, name, what, children }: { id: string; name: string; what: string; children: ReactNode }) {
  return (
    <section className="drawer-part" id={`details-${id}`} aria-label={name}>
      <h4>
        {name}
        <span>{what}</span>
      </h4>
      {children}
    </section>
  );
}

/** The panel's head and body, for the actor `feed.key` (in its `aside`: mount.tsx). */
export function DetailsPanel({ feed, host }: { feed: DetailsFeed; host: DetailsHost }) {
  const a = feed.agent;
  const calls: CallsOf = { actor: feed.key, gatherer: parse(feed.key).group, agent: a, snapshot: feed.snapshot };
  const reads = a?.reads || [];
  return (
    <>
      <div className="drawer-head">
        <h2>Details</h2>
      </div>
      <div className="drawer-body" data-keep="details">
        <MoreViews feed={feed} host={host} />
        <Facts feed={feed} />
        {!a || a.error || !a.reads ? (
          <div className="empty">
            {(a && a.error) ||
              (feed.info.session ? "No calls yet. Send the agent a message." : "No data for this actor.")}
          </div>
        ) : (
          <>
            <Part id="actor" name="Actor" what="calls and tokens sent">
              <ActorPart agent={a} />
            </Part>
            <Part id="context" name="Context" what="what the model was sent">
              <ContextCard {...calls} />
              <SizeCard {...calls} reads={reads} hasReal={reads.some((r) => typeof r.real_tokens === "number")} />
            </Part>
            <Part id="gatherer" name="Gatherer" what="ag's builds and model calls">
              <GathererPart agent={a} now={feed.now} />
            </Part>
          </>
        )}
      </div>
    </>
  );
}
