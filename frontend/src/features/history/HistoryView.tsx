// The History view: the actor's history to look through and pick from -- its turns (a user message and all that
// answered it), grouped by the tasks ag split it into when the reader asks, each opening to its messages -- searched and
// filtered by type (the bar). What is picked is exported, or given to the Gatherer's model (the panel at the right:
// Side.tsx). Selecting is as text is selected: a click on a row selects it -- all it holds -- and a drag, the rows from
// where it began to where it is; with ⌘ (Ctrl) they are added to what is selected already (a click on a selected row
// takes it out), with shift, from the row last clicked. A row's twisty, or a double click, opens it; Esc, or a click
// below the rows, clears it; ⌘A selects every row listed. Each row is drawn by its key, so a selection, a row opened and
// the scroll stay as the history grows.
import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../core/api/query";
import { ago, clock, compact, full, plural } from "../../core/format";
import { TYPES, wordless } from "../../core/model/items";
import { key } from "../../core/model/keys";
import { BUILD_MESSAGES, fetchFullText, fetchHits, fullTextKey, useAsked } from "./data";
import { Side, useRecs, type SideProps } from "./Side";
import { SHOWN, search, setGroup, showMore, tasksCame, toggleOpen, toggleType, useHist } from "./store";
import {
  buildTree,
  marked,
  selState,
  typeOfEvent,
  visibleRows,
  type HNode,
  type Outline,
  type VisibleRow,
} from "./tree";
import { useSelecting } from "./select";
import type { Home } from "../../core/api/types";

/** What the page hands the view for the actor it shows (`h.key`). */
export interface HistFeed {
  h: Outline;
  home: Home | null;
  cwd: string;
  harness: string | null;
  icons: Record<string, string>;
  now: number;
}

function Hit({ text, q }: { text: string; q: string }) {
  return <div className="h-hit">{marked(text, q).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}</div>;
}

function Label({ n, hit, q }: { n: HNode; hit: string | null; q: string }) {
  const found = hit ? <Hit text={hit} q={q} /> : null;
  if (n.kind === "task") {
    const t = n.task;
    if (t && n.current)
      // the build's last task, still open, and all since: as it is
      return (
        <>
          <div className="h-label">
            <span className="h-kind">Running task</span>
          </div>
          <div className="h-sub dim">In progress · not summarized yet</div>
          {found}
        </>
      );
    return (
      <>
        <div className={"h-label" + (t ? "" : " dim")}>{t ? t.name : "Before ag's first task"}</div>
        {t && t.description ? <div className="h-sub">{t.description}</div> : null}
        {found}
      </>
    );
  }
  if (n.kind === "turn")
    return (
      <>
        <div className={"h-label" + (n.n && n.ask ? "" : " dim")}>
          {!n.n
            ? "Harness setup: system text, tools, environment"
            : n.ask || (n.cont ? "Continued from the previous task" : "(no text)")}
        </div>
        {found}
      </>
    );
  const e = n.event!;
  return (
    <>
      <div className={"h-label" + (e.text ? "" : " dim")} title={typeOfEvent(e)[1]}>
        {e.text || wordless({ name: e.type })}
      </div>
      {found}
    </>
  );
}

/** A message's whole text, once its row is opened: fetched once. */
function Full({ gatherer, n }: { gatherer: string; n: HNode }) {
  const got = useQuery(
    { queryKey: fullTextKey(gatherer, n.event!), queryFn: () => fetchFullText(gatherer, n.event!) },
    queryClient,
  );
  return <pre className="h-full">{got.data ?? "Loading…"}</pre>;
}

interface RowProps {
  row: VisibleRow;
  st: "none" | "some" | "all";
  open: boolean;
  hits: number;
  hit: string | null;
  q: string;
  gatherer: string;
}

const meta = (n: HNode, hits: number) =>
  [
    hits && n.kind !== "message" ? `${full(hits)} match${hits === 1 ? "" : "es"}` : null,
    n.kind === "task" ? plural(n.children.length, "turn") : null,
    `${compact(n.tokens)} tok`,
    n.first ? ago(n.first) : null,
  ]
    .filter(Boolean)
    .join(" · ");

const Row = memo(
  function Row({ row: { n, depth, key: k }, st, open, hits, hit, q, gatherer }: RowProps) {
    const what = n.kind === "message" ? (open ? "Hide full text" : "Show full text") : open ? "Fold" : "Open";
    const said = meta(n, hits);
    return (
      <div
        className={
          `h-row ${n.kind}${depth ? " nested" : ""}${n.current ? " current" : ""}` +
          `${st === "all" ? " on" : st === "some" ? " some" : ""}${open ? " open" : ""}`
        }
        style={{ "--depth": depth } as CSSProperties}
        data-key={k}
        title={said}
      >
        <button
          type="button"
          className="h-tw"
          title={what}
          aria-label={what}
          aria-expanded={open}
          onClick={() => toggleOpen(n.id)}
        >
          {open ? "▾" : "▸"}
        </button>
        <div
          className={"h-main" + (n.kind === "message" ? " keyed" : "")}
          style={n.kind === "message" ? ({ "--key": typeOfEvent(n.event!)[2] } as CSSProperties) : undefined}
        >
          <Label n={n} hit={hit} q={q} />
        </div>
        <div className="h-meta" aria-hidden="true">
          {said}
        </div>
        {n.kind === "message" && open ? <Full gatherer={gatherer} n={n} /> : null}
      </div>
    );
  },
  // drawn again only when what it shows changed: the history grown elsewhere leaves it be
  (a, b) =>
    a.st === b.st &&
    a.open === b.open &&
    a.hits === b.hits &&
    a.hit === b.hit &&
    a.q === b.q &&
    a.row.depth === b.row.depth &&
    a.row.n.rows.length === b.row.n.rows.length &&
    a.row.n.tokens === b.row.n.tokens &&
    a.row.n.reply === b.row.n.reply &&
    a.row.n.ask === b.row.n.ask &&
    a.row.n.current === b.row.n.current &&
    a.row.n.task?.name === b.row.n.task?.name &&
    a.row.n.task?.description === b.row.n.task?.description &&
    a.row.n.first === b.row.n.first,
);

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={13}
      height={13}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <circle cx={7} cy={7} r={4.75} />
      <line x1={10.5} y1={10.5} x2={14} y2={14} />
    </svg>
  );
}

const SHORT: Record<string, string> = { gatherer: "Gatherer", system: "System" };

/** Which message types the list shows: one button, its menu of the types (Radix's: the arrow keys move in it, a pick
 * keeps it open, Esc or a press elsewhere closes it). */
function Types() {
  const types = useHist((s) => s.types);
  const all = [TYPES[6], ...TYPES.slice(0, 6)];
  const on = all.filter(([t]) => types.has(t)).map(([t, name]) => SHORT[t] || name);
  const said = on.length === all.length ? "All" : on.length > 3 ? `${on.length} types` : on.join(", ") || "None";
  return (
    <Menu.Root modal={false}>
      <div className="h-types" id="hist-types">
        <Menu.Trigger asChild>
          <button type="button" className="h-types-btn" title="Message types shown">
            <span className="lbl">Show</span>
            {said}
            <span className="lbl">▾</span>
          </button>
        </Menu.Trigger>
      </div>
      <Menu.Portal>
        <Menu.Content className="menu h-types-menu" align="start" sideOffset={4} aria-label="Message types shown">
          {all.map(([type, name, swatch]) => (
            <Menu.CheckboxItem
              key={type}
              className="h-type"
              checked={types.has(type)}
              onCheckedChange={() => toggleType(type)}
              onSelect={(ev) => ev.preventDefault()}
            >
              <input type="checkbox" checked={types.has(type)} readOnly tabIndex={-1} aria-hidden="true" />
              <i style={{ background: swatch }} />
              {name}
            </Menu.CheckboxItem>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The selected actor's tasks, as of its latest build: being made, how far behind they are, or why not. */
function BuildNote({ h }: { h: Outline }) {
  const built = useAsked((s) => s.built);
  const b = h.builds[h.channel];
  if (!b) return null;
  const since = `${plural(b.since, "user message")} since`;
  const asked = built && built.for === key(h.gatherer, h.channel) ? built : null;
  if (b.status === "running" && !h.tasks.length) return null; // the checkbox says so
  const [cls, text, title] =
    b.status === "running"
      ? ["run", "Updating tasks…", "ag is splitting this actor's history into tasks again"]
      : asked && asked.failed
        ? ["bad", "Build not started", asked.failed]
        : b.status === "failed"
          ? ["bad", `Last build failed · ${since}`, b.error || ""]
          : !b.build_id
            ? [
                "",
                `No tasks yet · ${plural(b.since, "user message")}`,
                `ag builds tasks once an actor has ${BUILD_MESSAGES} user messages`,
              ]
            : [
                "",
                `Tasks as of ${clock(b.finished || b.started, true)} · ${since}`,
                b.since < BUILD_MESSAGES
                  ? `Rebuilt after ${BUILD_MESSAGES} new user messages. Until then, new messages are in the running task.`
                  : "",
              ];
  return (
    <span className={"h-build " + cls} title={title}>
      {cls === "run" ? <span className="spin" aria-hidden="true" /> : null}
      {text}
    </span>
  );
}

function Bar({
  h,
  grouped,
  hasTasks,
  hits,
}: {
  h: Outline;
  grouped: boolean;
  hasTasks: boolean;
  hits: { size: number; more: boolean } | null;
}) {
  const q = useHist((s) => s.q),
    flash = useHist((s) => s.flash);
  const building = h.builds[h.channel]?.status === "running";
  const flashing = flash === h.key;
  const qt = q.trim();
  return (
    <div className="h-bar">
      <div className="h-controls">
        <label className="h-search" data-sig={`search:${h.key}`}>
          <SearchIcon />
          <input
            type="search"
            placeholder="Search this actor's history"
            aria-label="Search the history"
            spellCheck="false"
            value={q}
            onChange={(ev) => search(ev.currentTarget.value)}
            onKeyDown={(ev) => {
              if (ev.key !== "Escape" || !ev.currentTarget.value) return;
              ev.stopPropagation();
              search("");
            }}
          />
        </label>
        <label
          className={"h-group" + (hasTasks ? "" : " off") + (flashing ? " flash" : "")}
          title={
            hasTasks
              ? "Group turns by the tasks ag found"
              : building
                ? "ag is splitting this actor's history into tasks"
                : `ag splits an actor's history into tasks once it has ${BUILD_MESSAGES} user messages`
          }
        >
          <input
            type="checkbox"
            checked={grouped}
            disabled={!hasTasks}
            onChange={(ev) => setGroup(ev.currentTarget.checked)}
          />
          {building && !hasTasks ? (
            <>
              <span className="spin" aria-hidden="true" />
              Building tasks…
            </>
          ) : (
            "Group by tasks"
          )}
        </label>
        <Types />
        <div className="h-status">
          {qt ? (
            <span className="h-found">
              {!hits
                ? "Searching…"
                : `${full(hits.size)}${hits.more ? "+" : ""} matching message${hits.size === 1 ? "" : "s"}`}
            </span>
          ) : null}
          <BuildNote h={h} />
        </div>
      </div>
    </div>
  );
}

/** The view, for the actor `feed.h.key` (in its frame: mount.tsx). */
export function History({ feed, more }: { feed: HistFeed; more(): unknown }) {
  const { h } = feed;
  const s = useHist();
  const { tree, byId } = useMemo(() => buildTree(h), [h]);
  useTasksCame(h);
  const hasTasks = h.tasks.length > 0;
  const grouped = hasTasks && (s.group ?? s.stay !== h.key);
  const found = useQuery(
    {
      queryKey: ["search", h.gatherer, h.channel, s.query],
      queryFn: () => fetchHits(h, s.query),
      enabled: !!s.query,
      placeholderData: keepPreviousData,
    },
    queryClient,
  );
  const hits = s.query ? (found.data?.hits ?? null) : null;
  const shown = (r: number) => {
    const m = byId.get(`m:${r}`);
    return !m || s.types.has(typeOfEvent(m.event!)[0]);
  };
  const { rows, tops } = h.error ? { rows: [], tops: [] } : visibleRows(tree, grouped, s.open, shown, hits);
  const flat = rows.map((r) => r.key);
  const running = useRecs(h.gatherer).some((r) => r.status === "running");
  const list = useRef<HTMLDivElement>(null);
  const press = useSelecting({ list, flat, byId, tops, making: running });
  const q = s.q.trim();
  const limited = rows.slice(0, s.limit);
  const side: SideProps = {
    h,
    home: feed.home,
    cwd: feed.cwd,
    harness: feed.harness,
    icons: feed.icons,
    now: feed.now,
    byId,
  };
  return (
    <div className="h-grid">
      <div className="h-left">
        <Bar h={h} grouped={grouped} hasTasks={hasTasks} hits={hits && { size: hits.size, more: !!found.data?.more }} />
        <div ref={list} className="h-list" data-keep={`hist-list:${h.key}`} {...press}>
          {h.error ? (
            <div className="h-note">{h.error}</div>
          ) : !h.events.length ? (
            <div className="h-note">No history yet.</div>
          ) : hits && !rows.length ? (
            <div className="h-note">{`Nothing in this history matches “${q}”.`}</div>
          ) : (
            <>
              {limited.map((row) => {
                const hitRows = hits ? row.n.rows.filter((r) => hits.has(r)) : [];
                return (
                  <Row
                    key={row.key}
                    row={row}
                    st={selState(row.n, s.sel)}
                    open={s.open.has(row.n.id)}
                    hits={hitRows.length}
                    hit={hitRows.length ? (hits!.get(hitRows[0]) ?? null) : null}
                    q={q}
                    gatherer={h.gatherer}
                  />
                );
              })}
              {rows.length > limited.length ? (
                <button type="button" className="h-more" onClick={showMore}>
                  {`Show ${full(Math.min(SHOWN, rows.length - limited.length))} more of ${full(rows.length - limited.length)}`}
                </button>
              ) : null}
              {h.more ? (
                <button type="button" className="h-more" onClick={() => more()}>
                  Load more
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      <Side {...side} />
    </div>
  );
}

/** Tasks come in while the reader looks: the list stays as it is, and Group by tasks pulses a few times. */
function useTasksCame(h: Outline) {
  const had = useRef<{ key: string; had: boolean } | null>(null);
  const hasTasks = h.tasks.length > 0;
  useEffect(() => {
    const was = had.current;
    had.current = { key: h.key, had: hasTasks };
    if (was && was.key === h.key && !was.had && hasTasks) tasksCame(h.key);
  }, [h.key, hasTasks]);
}
