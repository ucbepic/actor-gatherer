// What a minimized pane shows of its conversation (Lines.tsx, CardBody.tsx), worked out apart from drawing it: its two lines
// -- the user's last message, and what the actor does now, or how its turn ended -- whether its latest turn is over as
// Chat shows it, and a turn's steps in order for its card.
import { firstLine, plural } from "../../../core/format";
import { str } from "../../../core/model/items";
import { unplanned } from "../../../core/ui/md";
import type { CallRun, ChatView, Command, Current, FilesData, MySend, Stopped, Turn } from "../types";
import { cidsOf } from "../view";

/** The latest turn's steps shown in the card; the earlier ones a press away. */
export const MINI_STEPS = 10;
/** An earlier turn's reply longer than this: its first lines, then a press. */
export const MINI_REPLY = 420;

/** What the agent said last in a turn, readable: its last message. */
export function lastSaid(t: Turn): string | null {
  const r = (t.replies || []).filter((x) => x.kind === "text" && str(x.text).trim());
  return r.length ? r[r.length - 1].text! : null;
}

/** A message on one line: no harness's reply block, no markup's marks. */
export const plainLine = (text: unknown, n = 200): string =>
  firstLine(
    str(unplanned(str(text)))
      .replace(/`|\*\*|^#{1,6}\s+/gm, "")
      .trim(),
    n,
  );

/** How a turn stopped short, in a few words. */
export const stoppedWords = (s: Stopped): string =>
  s.kind === "interrupted" ? "Interrupted" : s.text ? `Stopped: ${firstLine(s.text, 120)}` : "Stopped";

/** A mark at the corner of the actor's avatar: its class and its sign. */
export type Mark = readonly [string, string];

/** What the lines and the card are drawn from: the actor's turns as Chat has them (the server's view's, else its files
 * feed's), the view, the latest turn's files, what was sent from here and the view does not have yet, and whether the
 * actor works (the view says so, or the list) or runs (the list); its status as the list has it, and the marks on its
 * avatar by status (asking, an error). */
export interface MiniOf {
  turns: Turn[];
  view: ChatView | null;
  files: FilesData | null;
  mine: readonly MySend[];
  /** at work as its view has it */
  viewAtWork: boolean;
  /** running, as the list has it */
  running: boolean;
  status: string;
  marks: Readonly<Record<string, Mark>>;
}

/** The mark its status puts on its avatar; none. */
const markOf = (m: MiniOf): Mark | null => m.marks[m.status] || null;

/** The latest turn, if it is over as Chat shows it -- its actor done under it (Turns.tsx's `done`) -- and the actor not
 * stopped on an error nor asking the reader (their marks instead); else null. */
export function restOf(m: MiniOf): Turn | null {
  const t = m.turns.length ? m.turns[m.turns.length - 1] : null,
    cur = m.view ? m.view.current : null;
  if (!t || m.running || m.viewAtWork || (m.view && m.view.opening) || m.mine.length || markOf(m)) return null;
  return !cur || cur.state === "done" || cur.state === "stopped" ? t : null;
}

/** What stands for the actor without an avatar: the history's icon (sent), a question, the turning glyph, a stop. */
export type Alt = "history" | "ask" | "spin" | "stop" | null;

/** A line's icon: the user's ("›"); the actor's avatar small and still -- a mark at its corner (`mark`), or what stands
 * for it without one (`alt`) -- or, the turn over, its done avatar. */
export type LineIcon = { kind: "you" } | { kind: "me"; mark: Mark | null; alt: Alt } | { kind: "done"; turn: Turn };

/** A piece of a line's words: plain, said small before them (`sub`), or a call's dot (how it went) and its line. */
export type LinePart = { sub: string } | { dot: string } | { call: CallRun } | string;

/** A line: its kind (its classes: "you", "now live", ...; the first its `data-kind`), its icon, its words, and on its
 * right how long ago (`ago`) or how long it has run (`since`). */
export interface Line {
  kind: string;
  extra: string;
  icon: LineIcon;
  text: LinePart[];
  ago?: number | null;
  since?: number | null;
}

/** What a line shows, as a key: drawn again the same, it is kept. */
export const lineSig = (l: Line): string =>
  JSON.stringify([
    l.kind,
    l.extra,
    l.icon.kind === "done" ? ["done", l.icon.turn.row_id] : l.icon,
    l.text.map((p) => (typeof p === "object" && "call" in p ? ["call", p.call.text, p.call.running, p.call.error] : p)),
    l.ago ?? null,
    l.since ?? null,
  ]);

/** The two lines; none (no turn yet, nothing sent). */
export function linesOf(m: MiniOf): Line[] | null {
  const { turns, view: v } = m,
    cur: Current | null = v ? v.current : null;
  const t = turns.length ? turns[turns.length - 1] : null;
  const atWork = m.viewAtWork || m.running;
  const opening = (v && v.opening) || (m.mine.length && !atWork ? m.mine[0] : null);
  const cids = cidsOf(v);
  const waits = [...((v && v.waiting) || []), ...(atWork ? m.mine.filter((s) => !(v && cids.has(s.cid))) : [])];
  if (!t && !opening) return null;
  const rows: Line[] = [];
  // the user's: what waits to reach the agent, else the turn's latest message (one written while it ran, else its own)
  const said = opening || (waits.length ? waits[waits.length - 1] : null);
  const more = t && (t.more || []).length ? t.more![t.more!.length - 1] : null;
  const me = (mark: Mark | null, alt: Alt): LineIcon => ({ kind: "me", mark, alt });
  if (said)
    rows.push({
      kind: "you pending",
      extra: "",
      icon: { kind: "you" },
      text: [{ sub: "Pending ·" }, plainLine(said.text)],
    });
  else
    rows.push({
      kind: "you",
      extra: "",
      icon: { kind: "you" },
      text: [...(more ? [{ sub: "While it worked ·" }] : []), plainLine(more ? more.text : t!.text)],
      ago: more ? more.at : t!.at,
    });
  // the agent's: what it does now, else how its turn ended
  const state = opening ? "opening" : cur ? cur.state : m.running ? "working" : "done";
  if (opening)
    rows.push({ kind: "now quiet", extra: "", icon: me(null, "history"), text: ["Sent · waiting for the actor"] });
  else if (state === "asking")
    rows.push({ kind: "now ask", extra: "", icon: me(m.marks.asking || null, "ask"), text: ["Waiting for you"] });
  else if (atWork || state === "working") {
    // a call under way; else thinking; else its latest call, if nothing was said since (files.py's `last`); else what it
    // said last
    const tt = t!;
    const doing = (cur && cur.doing) || tt.now,
      call = tt.last || null;
    const thinking = !(call && call.running) && !!doing && doing.kind === "thinking";
    const words = cur && cur.failing ? "Retrying…" : thinking ? "Thinking…" : null;
    const saidLast = !words && !call ? lastSaid(tt) : null;
    const text: LinePart[] = [];
    if (call && !words) text.push({ dot: call.running ? "run" : call.error ? "err" : "ok" });
    text.push(words || (call ? { call } : saidLast ? plainLine(saidLast) : "Working…"));
    rows.push({
      kind: "now live",
      extra: saidLast ? " said" : "",
      icon: me(null, "spin"),
      text,
      since: tt.began || tt.at || null,
    });
  } else {
    const tt = t!;
    const reply = lastSaid(tt),
      stopped = tt.stopped || (cur && cur.state === "stopped" ? cur.stopped : null);
    const rest = restOf(m); // done as Chat shows it: its check; else, stopped on an error, its mark
    const icon = (alt: Alt): LineIcon => (rest ? { kind: "done", turn: rest } : me(markOf(m), alt));
    if (reply && !stopped)
      rows.push({ kind: "now reply", extra: "", icon: icon(null), text: [plainLine(reply)], ago: tt.end || tt.at });
    else
      rows.push({
        kind: "now quiet",
        extra: "",
        icon: icon("stop"),
        text: [stopped ? stoppedWords(stopped) : tt.calls ? `Done · ${plural(tt.calls, "command")}` : "Done"],
        ago: tt.end || tt.at,
      });
  }
  return rows;
}

/** Where a turn's last message is among its replies, left for its reply under its steps; -1: none (or the turn at work,
 * whose last message may not be its last). */
export function finalAtOf(t: Turn, live: boolean): number {
  if (live) return -1;
  let at = -1;
  (t.replies || []).forEach((r, j) => {
    if (r.kind === "text" && str(r.text).trim()) at = j;
  });
  return at;
}

/** A step of a turn: one of its messages (its index among the replies), or one of its commands (its index). */
export type Step = { r: NonNullable<Turn["replies"]>[number]; j: number } | { c: Command; i: number };

/** A turn's steps in order: its messages among its commands, each message after as many commands as its `after` says;
 * its last message (`finalAt`) left for the reply, under them; thinking left out (the line at the end says it). */
export function stepsOf(t: Turn, cmds: readonly Command[], finalAt: number): Step[] {
  const out: Step[] = [];
  let i = 0;
  (t.replies || []).forEach((r, j) => {
    const upto = Math.min(typeof r.after === "number" ? r.after : cmds.length, cmds.length);
    while (i < upto) out.push({ c: cmds[i], i: i++ });
    if (j === finalAt || r.kind === "thinking") return;
    if ((r.kind === "text" && str(r.text).trim()) || r.kind === "report" || r.kind === "peer") out.push({ r, j });
  });
  while (i < cmds.length) out.push({ c: cmds[i], i: i++ });
  return out;
}

/** The latest turn's commands, from the files feed -- when it has that turn (its turns as many as the view's); null while
 * they have not come. */
export function latestCommands(files: FilesData | null, n: number, t: Turn): Command[] | null {
  return files && files.turns.length === n && files.turn === n - 1 ? files.commands : t.calls ? null : [];
}
