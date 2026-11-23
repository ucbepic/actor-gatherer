// A minimized pane's card: the whole conversation, over what is above the pane (card.ts places and opens it) -- each
// turn, the user's message, then what the agent did, in order: its messages among its commands (each reply's `after`:
// how many of the turn's calls came before it, files.py's) -- an earlier turn folded to a line, its commands fetched when
// opened; the latest its last few steps; and each turn's reply. Then the actor now: asking, at work, or done under it.
import { ago, full, plural } from "../../../core/format";
import { str } from "../../../core/model/items";
import { Markdown } from "../../../core/ui/Markdown";
import { Buddy, DoneIcon } from "../../../core/ui/stage/Stage";
import { bareAvatar } from "../../../core/ui/stage/model";
import type { ChatView, Command, Current, FilesData, Turn } from "../types";
import {
  finalAtOf,
  lastSaid,
  latestCommands,
  MINI_REPLY,
  MINI_STEPS,
  plainLine,
  restOf,
  stepsOf,
  stoppedWords,
  type MiniOf,
  type Step,
} from "./model";
import { CallLine, CallOpened, Since, type KeyedActor } from "./parts";

/** What the card is drawn from, and what it does: a turn, a command or a message opened or folded (`toggle`), an earlier
 * turn's commands fetched, the chat shown again at a turn (null: its end; `side`, its files and commands too). */
export interface CardData {
  /** the actor's key: what the reader opened in the card is its */
  actor: string;
  info: KeyedActor;
  mini: MiniOf;
  harnessName: string;
  opened: ReadonlySet<string>;
  /** an earlier turn's commands, by "<actor> <n>": the list, or their fetch under way */
  fetched: ReadonlyMap<string, readonly Command[] | Promise<unknown>>;
  paths: { cwd: string; home: string };
  toggle(key: string, on: boolean): void;
  fetchTurn(t: Turn): void;
  openAt(n: number | null, side: boolean): void;
}

const liveOf = (cur: Current | null, info: KeyedActor) =>
  (!!cur && cur.state === "working") || (!cur && !!info.running);

function HeadState({ t, cur, live }: { t: Turn | undefined; cur: Current | null; live: boolean }) {
  if (!t) return <span className="x">No turn yet</span>;
  if (cur && cur.state === "asking") return <span className="w">Waiting for you</span>;
  if (live)
    return (
      <>
        <span className="w">{cur && cur.failing ? "Retrying" : "Working"}</span> <Since t={(t.began || t.at)!} />
      </>
    );
  const stopped = t.stopped || (cur && cur.state === "stopped" ? cur.stopped : null);
  return (
    <>
      <span className={stopped ? "x" : "d"}>{stopped ? stoppedWords(stopped) : "Done"}</span>{" "}
      <span data-ago={t.end || t.at || undefined}>{ago(t.end || t.at)}</span>
    </>
  );
}

function StepView({ s, t, current, d }: { s: Step; t: Turn; current: boolean; d: CardData }) {
  if ("r" in s) {
    const r = s.r,
      k = `m${t.n}-${s.j}`,
      open = d.opened.has(k);
    const label =
      r.kind === "report"
        ? "Subagent's report:"
        : r.kind === "peer"
          ? `Message from ${r.name || "another session"}:`
          : null;
    return (
      <div
        className={"mh-said" + (open ? " open" : "")}
        title={open ? "Fold the message" : "Show the whole message"}
        onClick={() => d.toggle(k, !open)}
      >
        <span className="dot">●</span>
        {label ? <span className="lbl">{label}</span> : null}
        {open ? <Markdown text={str(r.text)} /> : <span className="first">{plainLine(r.text)}</span>}
      </div>
    );
  }
  const c = s.c,
    k = `c${t.n}-${s.i}`,
    open = d.opened.has(k);
  const cls = c.running && current ? "run" : c.error ? "err" : c.running ? "stop" : "ok";
  return (
    <div className={"mh-cmd" + (open ? " open" : "")}>
      <button
        type="button"
        className="line"
        title={open ? "Fold the call" : "Show the call and its output"}
        onClick={() => d.toggle(k, !open)}
      >
        <i className={"dotc " + cls} />
        <span className="tx">
          <CallLine c={c} n={200} />
        </span>
        {c.changed && (c.changed[0] || c.changed[1]) ? (
          <span className="chg">
            {c.changed[0] ? <span className="chg-a">{`+${full(c.changed[0])}`}</span> : null}
            {c.changed[1] ? <span className="chg-r">{`−${full(c.changed[1])}`}</span> : null}
          </span>
        ) : cls === "err" ? (
          <span className="mh-side">failed</span>
        ) : cls === "run" ? (
          <span className="mh-side">running</span>
        ) : null}
      </button>
      {open ? <CallOpened call={c.call} ran={c} paths={d.paths} /> : null}
    </div>
  );
}

/** A turn: where it began, the user's message(s), what it did, its reply. */
function TurnView({ t, i, latest, live, d }: { t: Turn; i: number; latest: boolean; live: boolean; d: CardData }) {
  const turns = d.mini.turns,
    view: ChatView | null = d.mini.view;
  const k = `${d.actor} ${t.n}`,
    reply = lastSaid(t),
    finalAt = finalAtOf(t, live);
  const folded = !latest && !d.opened.has(`t${t.n}`);
  const cmds = folded
    ? null
    : latest
      ? latestCommands(d.mini.files as FilesData | null, turns.length, t)
      : d.fetched.get(k);
  const steps = folded ? [] : stepsOf(t, Array.isArray(cmds) ? cmds : [], finalAt);
  const cut = latest && steps.length > MINI_STEPS && !d.opened.has(`t${t.n}`) ? steps.length - MINI_STEPS : 0;
  const long = !latest && str(reply).length > MINI_REPLY && !d.opened.has(`r${t.n}`);
  const asking = latest && view && view.current.state === "asking";
  const sum = (open: boolean) => (
    <button
      type="button"
      className={"mh-sum" + (open ? " open" : "")}
      data-turn={t.n}
      onClick={() => {
        d.toggle(`t${t.n}`, !open);
        if (!open) d.fetchTurn(t);
      }}
    >
      <span className="car">▸</span>
      {plural(t.calls!, "command")}
    </button>
  );
  return (
    <>
      <div className="mh-sep">
        <b>{`Turn ${i + 1}`}</b>
        <span data-ago={t.at ?? undefined}>{ago(t.at)}</span>
      </div>
      <div
        className="mh-you"
        tabIndex={0}
        title="Open the chat at this turn · ⌘-click to show its commands too"
        onClick={(ev) => d.openAt(latest ? null : t.n, ev.metaKey || ev.ctrlKey)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") ev.currentTarget.click();
        }}
      >
        <span className="lbl">You</span>
        <div className="tx">{str(t.text)}</div>
        {(t.more || []).map((m, j) => (
          <div key={j} className="tx more">
            <span className="lbl">While it worked</span>
            {str(m.text)}
          </div>
        ))}
      </div>
      {folded ? (
        t.calls ? (
          sum(false)
        ) : null
      ) : (
        <>
          {!latest && t.calls ? sum(true) : null}
          {!Array.isArray(cmds) && t.calls ? <div className="mh-wait">Loading its commands…</div> : null}
          {cut ? (
            <button type="button" className="mh-more" onClick={() => d.toggle(`t${t.n}`, true)}>
              {plural(cut, "earlier step")}
            </button>
          ) : null}
          {steps.slice(cut).map((s, j) => (
            <StepView
              key={"r" in s ? `m${s.j}` : `c${s.i}`}
              s={s}
              t={t}
              current={live && cut + j === steps.length - 1}
              d={d}
            />
          ))}
        </>
      )}
      {finalAt >= 0 ? (
        <>
          <div className={"mh-reply" + (long ? " clamp" : "")}>
            <Markdown text={str(reply)} />
          </div>
          {long ? (
            <button type="button" className="mh-more" onClick={() => d.toggle(`r${t.n}`, true)}>
              Show full reply
            </button>
          ) : null}
        </>
      ) : !live && !asking && t.stopped ? (
        <div className="mh-quiet">{stoppedWords(t.stopped)}</div>
      ) : null}
    </>
  );
}

/** The card's contents: its head, the conversation, and how to use it. */
export function CardBody({ d }: { d: CardData }) {
  const a = d.info,
    turns = d.mini.turns,
    cur = d.mini.view ? d.mini.view.current : null,
    last = turns.length - 1;
  const live = liveOf(cur, a);
  const src = bareAvatar(a),
    t = turns[last];
  const rest = !live && !(cur && cur.state === "asking") ? restOf({ ...d.mini, running: false }) : null;
  return (
    <>
      <div className="mh-head">
        {src ? <img src={src} alt="" draggable="false" /> : null}
        <span className="who">{a.name && a.name.text ? a.name.text : d.harnessName}</span>
        <span className="st">
          <HeadState t={t} cur={cur} live={live} />
          {` · ${plural(turns.length, "turn")}`}
        </span>
      </div>
      <div className="mh-body">
        {turns.map((tt, i) => (
          <TurnView key={tt.n} t={tt} i={i} latest={i === last} live={live && i === last} d={d} />
        ))}
        {cur && cur.state === "asking" ? (
          <div className="mh-now ask">
            <span className="mk ask">?</span>Waiting for you · the question is above the message box
          </div>
        ) : live ? (
          <div className="mh-now">
            {src ? <Buddy info={a} still={!!a.failing} /> : <span className="spin" />}
            {cur && cur.failing
              ? "Retrying…"
              : ((cur && cur.doing) || (t && t.now) || { kind: "" }).kind === "thinking"
                ? "Thinking…"
                : "Working…"}
          </div>
        ) : rest ? (
          <div className="mh-now rested" title={`Done · ${ago(rest.end || rest.at)}`}>
            <DoneIcon info={a} turn={rest.row_id} className="mh-me" />
          </div>
        ) : null}
      </div>
      <div className="mh-foot">
        <span>
          <kbd>Click</kbd> a message to open it in the chat
        </span>
        <span>
          <kbd>⌘</kbd> to show its commands too
        </span>
        <span>
          <kbd>Esc</kbd> to close
        </span>
      </div>
    </>
  );
}
