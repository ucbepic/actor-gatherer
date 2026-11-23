// The Transcript view: the conversation as a terminal running the harness shows it -- what was asked, what the agent
// said (markdown), each tool call with its result under it, its thinking folded away (blocks.ts says which blocks, in
// order) -- and, under it, the line of a turn at work, what runs in the background, what waits for the turn to end.
import type { ReactNode } from "react";
import { create } from "zustand";
import { ago, firstLine } from "../../core/format";
import * as prefs from "../../core/prefs";
import { Markdown } from "../../core/ui/Markdown";
import { FoldedOutput, callLine, summary } from "./calls";
import { transcriptBlocks, type Line, type Part, type TxBlock, type TxItem } from "./blocks";

const NOTES_KEY = "ag-dashboard-transcript-notes";

/** Whether the transcript shows the harness's system messages and ag's notes: the reader's choice, kept in this browser. */
export const useNotes = create<{ on: boolean; set(on: boolean): void }>()((set) => ({
  on: prefs.flag(NOTES_KEY),
  set(on) {
    prefs.setFlag(NOTES_KEY, on);
    set({ on });
  },
}));

/** The switch for the harness's system messages and ag's notes (inside its `label`). */
export function NotesSwitchBody() {
  const on = useNotes((s) => s.on);
  return (
    <>
      <input type="checkbox" checked={on} onChange={(ev) => useNotes.getState().set(ev.currentTarget.checked)} />
      Show system and ag notes
    </>
  );
}

export const NOTES_TITLE = "The harness's system messages and ag's notices";

/** One tool call and, under it, its result: running while there is none and the agent is. */
function CallBlock({
  part,
  result,
  id,
  running,
  cwd,
}: {
  part: Part;
  result: Part | null;
  id: string;
  running: boolean;
  cwd: string;
}) {
  const s = summary(part, cwd);
  const glyph = result ? (result.error ? "dot-err" : "dot-ok") : running ? "dot-run" : "dot-ok";
  const under: ReactNode[] = [];
  if (s.body) under.push(s.body(id));
  if (result && result.error) under.push(<FoldedOutput text={result.text ?? ""} id={id + "-r"} cls="err" />);
  else if (result && s.result) under.push(s.result(result.text ?? "", id + "-r"));
  else if (result && !s.quiet) under.push(<FoldedOutput text={result.text ?? ""} id={id + "-r"} />);
  else if (!result && !running) under.push(<pre>(no result recorded)</pre>);
  else if (!result) under.push(<pre>Running…</pre>);
  return (
    <div className="blk">
      <span className={"g " + glyph}>●</span>
      <div className="head">
        <b>{s.title}</b>
        {s.arg !== undefined && s.arg !== "" ? <span className="arg">{`(${s.arg})`}</span> : null}
        {s.note ? <span className="note">{s.note}</span> : null}
      </div>
      {under.map((u, i) => (
        <div key={i} className="res">
          <span className="g">⎿</span>
          {u}
        </div>
      ))}
    </div>
  );
}

/** A block's outside: its box's class. */
export const blockClass = (b: TxBlock): string =>
  b.kind === "user"
    ? "user"
    : b.kind === "notes"
      ? "blk notes"
      : b.kind === "think"
        ? "blk think-blk"
        : b.kind === "call"
          ? "blk call-line"
          : b.kind === "more"
            ? "blk more"
            : "blk";

/** A block's insides (in its box: blockClass). */
export function BlockBody({ b, cwd }: { b: TxBlock; cwd: string }) {
  switch (b.kind) {
    case "user":
      return (
        <>
          <span className="g">❯</span>
          <div className="body">{b.text}</div>
        </>
      );
    case "text":
      return (
        <>
          <span className="g text">●</span>
          <Markdown text={b.text} />
        </>
      );
    case "result":
      return (
        <>
          <span className="g"> </span>
          <div className="res">
            <span className="g">⎿</span>
            <FoldedOutput text={b.text} id={b.id} cls={b.error ? "err" : ""} />
          </div>
        </>
      );
    case "notes":
      return (
        <>
          <span className="g">※</span>
          <details id={b.id}>
            <summary>
              {b.notes.length === 1
                ? `${b.notes[0].name}: ${firstLine(b.notes[0].text, 120)}`
                : `${b.notes.length} notes: ${[...new Set(b.notes.map((n) => n.name))].join(", ")}`}
            </summary>
            {b.notes.map((n) => (
              <pre key={n.id}>{`${n.name}\n${n.text}`}</pre>
            ))}
          </details>
        </>
      );
    case "think":
      return (
        <>
          <span className="g think">✻</span>
          <details id={b.id}>
            <summary>Thinking…</summary>
            <div className="body">{b.text}</div>
          </details>
        </>
      );
    case "call": {
      const s = summary(b.part, cwd);
      return (
        <>
          <span
            className={"g " + (b.result ? (b.result.error ? "dot-err" : "dot-ok") : b.running ? "dot-run" : "dot-ok")}
          >
            ●
          </span>
          <details id={b.id + "-l"}>
            <summary className={b.result && b.result.error ? "bad" : undefined}>{callLine(s)}</summary>
            <div className="calls">
              <CallBlock part={b.part} result={b.result} id={b.id} running={b.running} cwd={cwd} />
            </div>
          </details>
        </>
      );
    }
    case "more":
      return (
        <>
          <span className="g"> </span>
          <details id={b.id}>
            <summary>{`+${b.lines.length} more`}</summary>
            {b.lines.map((l: Line) => (
              <Block key={l.key} b={l} cwd={cwd} />
            ))}
          </details>
        </>
      );
  }
}

export function Block({ b, cwd }: { b: TxBlock; cwd: string }) {
  return (
    <div className={blockClass(b)}>
      <BlockBody b={b} cwd={cwd} />
    </div>
  );
}

/** What the page hands the view for the actor it shows. */
export interface TxFrame {
  /** the actor's */
  key: string;
  items: TxItem[];
  pending: TxItem[];
  /** earlier events not loaded: a button loads them */
  earlier: boolean;
  /** its turn at work, or its calls retried (`failing`): the line under it, since when */
  running: boolean;
  failing: { at: number } | null;
  last: number | null;
  /** its paths shown from here */
  cwd: string;
  /** what runs in the background, as Chat draws it (its BackgroundNote, as a terminal's status line) */
  background: ReactNode;
  /** what waits for the turn to end */
  queued: string[];
  /** said when there is nothing, nothing pending and nothing waiting */
  noneYet: string;
  loadEarlier(): unknown;
}

/** The view's blocks and the lines under them, in its frame (`div.chat-frame.term`: mount.tsx). */
export function Transcript({ f }: { f: TxFrame }) {
  const notes = useNotes((s) => s.on);
  const all = [...f.items, ...f.pending];
  return (
    <>
      {f.earlier ? (
        <button type="button" className="earlier" onClick={() => f.loadEarlier()}>
          Load earlier messages
        </button>
      ) : null}
      {transcriptBlocks(all, f.running, notes).map((b) => (
        <Block key={b.key} b={b} cwd={f.cwd} />
      ))}
      {f.running ? (
        <div className="status-line">
          <span className="spin" aria-hidden="true" />
          {f.failing ? "Retrying…" : "Working…"}
          <Since what={f.failing ? "last try" : "last activity"} at={f.failing ? f.failing.at : f.last} />
        </div>
      ) : null}
      {f.background}
      {f.queued.map((q, i) => (
        <div key={`q${i}`} className="queued">{`Waiting for the turn to end: ${q}`}</div>
      ))}
      {!all.length && !f.queued.length ? <div className="desc">{f.noneYet}</div> : null}
    </>
  );
}

/** " (… <what> Ns ago)", counting (core/ui/clocks.ts sets each `data-ago` every second); hidden from screen readers, so
 * the line is not read out again each second. */
export function Since({ what, at }: { what: string; at: number | null | undefined }) {
  return (
    <span aria-hidden="true">
      {` (${what} `}
      <span data-ago={at || ""}>{ago(at)}</span>)
    </span>
  );
}
