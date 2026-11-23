// What the minimized pane's lines and its card draw alike: what they are drawn from for a pane (`miniOf`), the actor's
// icon on a line, a line's words and how long ago, a call's line and a call opened -- and the chat shown again from them.
import { ago, lasting } from "../../../core/format";
import { StrokeIcon } from "../../../core/ui/Icon";
import { DoneIcon } from "../../../core/ui/stage/Stage";
import { bareAvatar } from "../../../core/ui/stage/model";
import { chatViewOf, foldSide, mySends, setFilesTurn, viewAtWork } from "../files-view";
import { P, type Pane } from "../link";
import { CallLabel, CallView, Paths, shellCommand } from "../side/CallView";
import { firstLine } from "../../../core/format";
import type { Actor, CallRun, FilesData } from "../types";
import type { LineIcon, LinePart, Mark, MiniOf } from "./model";

/** An actor as the home has it, with its key (a pane's actor). */
export type KeyedActor = Actor & { key?: string; running?: boolean };

/** The files feed's data, for pane `p`'s actor: its turns, and the latest turn's commands (minimized: the latest is
 * loaded). */
export const miniData = (p: Pane): FilesData | null =>
  p.files && p.files.key === P().paneKey(p) ? p.files.data : null;

/** What pane `p`'s lines and card are drawn from, for its actor `info` (`running`: as the list has it). */
export function miniOf(p: Pane, info: KeyedActor, running: boolean): MiniOf {
  const v = chatViewOf(info),
    d = miniData(p);
  return {
    turns: (v && v.turns) || (d && d.turns) || [],
    view: v,
    files: d,
    mine: mySends(p),
    viewAtWork: viewAtWork(info),
    running,
    status: P().statusOf(info)[0],
    marks: P().meMarks,
  };
}

/** Pane `p`'s chat shown again -- at turn `n` (null: at its end); `side`, its files and commands too. */
export function openAt(p: Pane, n: number | null, side: boolean): void {
  P().setChatMin(p, false);
  setTimeout(() => {
    if (side) foldSide(p, false);
    if (n !== null) setFilesTurn(p, n);
    else if (side) P().drawPane(p);
  }, 60);
}

const MarkOn = ({ mark }: { mark: Mark | null }) => (mark ? <span className={"mk " + mark[0]}>{mark[1]}</span> : null);

/** A line's icon (model.ts's LineIcon). */
export function Icon({ icon, info }: { icon: LineIcon; info: Actor }) {
  if (icon.kind === "you") return <span className="ic">›</span>;
  if (icon.kind === "done") return <DoneIcon info={info} turn={icon.turn.row_id} className="ic" />;
  const src = bareAvatar(info);
  const alt =
    icon.alt === "history" ? (
      <StrokeIcon d={P().icons.history} size={12} />
    ) : icon.alt === "ask" ? (
      <span className="mk ask">?</span>
    ) : icon.alt === "spin" ? (
      <span className="spin" aria-hidden="true" />
    ) : icon.alt === "stop" ? (
      "■"
    ) : null;
  return (
    <span className={"ic" + (src ? " me" : "")}>
      {src ? <img src={src} alt="" draggable="false" /> : alt}
      {src ? <MarkOn mark={icon.mark} /> : null}
    </span>
  );
}

/** A call's line: its words, or (a shell command) its command coloured. */
export const CallLine = ({ c, n }: { c: CallRun; n: number }) =>
  shellCommand(c.call) === null || (c.call as { view: { description?: unknown } }).view.description ? (
    firstLine(c.text, n)
  ) : (
    <CallLabel c={c} n={n} />
  );

/** A call opened, and what it printed; paths read from the actor's directory and home. */
export const CallOpened = ({
  call,
  ran,
  paths,
}: {
  call: unknown;
  ran: Partial<CallRun>;
  paths: { cwd: string; home: string };
}) => (
  <Paths value={paths}>
    <CallView call={call} ran={ran} />
  </Paths>
);

/** A line's words (model.ts's LinePart). */
export const Part = ({ part }: { part: LinePart }) =>
  typeof part === "string" ? (
    part
  ) : "sub" in part ? (
    <span className="sub">{part.sub}</span>
  ) : "dot" in part ? (
    <i className={"dotc " + part.dot} />
  ) : (
    <CallLine c={part.call} n={160} />
  );

/** How long ago `t` was, counted on where it is (core/ui/clocks.ts). */
export const Ago = ({ t }: { t: number | null | undefined }) => (t ? <span data-ago={t}>{ago(t)}</span> : null);

/** How long since `t`, counted on where it is. */
export const Since = ({ t, className }: { t: number; className?: string }) => (
  <span className={className} data-since={t}>
    {lasting(t)}
  </span>
);
