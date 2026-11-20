// What the agent said in a turn, under the user's message: a message, folded to its first line (the last whole until a
// click folds it); a run of its thinking, drawn as one with "Thought:" before its first line; its harness's own notes
// among them; and the turn's latest call, while it has said and thought nothing readable since.
import { firstLine } from "../../core/format";
import { Markdown } from "../../core/ui/Markdown";
import { unplanned } from "../../core/ui/md";
import { useChat } from "./context";
import { CallLabel, CallView } from "./side/CallView";
import { useTurns } from "./store";
import type { Reply as ReplyData, Turn } from "./types";
import { currentOf } from "./view";

/** The harness's own notes in a turn (files.py's `_note`), each a line among the messages, folded to it. */
export const NOTED: Record<string, string> = {
  report: "Subagent's report:",
  peer: "Message from another session:",
};

const noted = (kind: string) => Object.hasOwn(NOTED, kind);

/** Whether a reply is drawn: a message, a note, or thinking with something to read (encrypted thinking has nothing). */
export const drawn = (r: ReplyData): boolean =>
  r.kind === "text" || noted(r.kind) || (r.kind === "thinking" && (r.texts || []).length > 0);

/** A message, or a run of thinking; `main`, the turn's last message: shown whole until a click folds it, which is kept
 * (store.ts's `closed`). Its id keeps its place in the turn: the last, once a message follows it, starts folded. */
export function Reply({ r, i, n, main = false }: { r: ReplyData; i: number; n: number; main?: boolean }) {
  const { folds } = useChat();
  const id = `fl-${main ? "m" : "r"}-${n}-${i}`;
  if (noted(r.kind)) return <Noted r={r} id={id} />;
  const thought = r.kind !== "text",
    text = thought ? (r.texts || []).join("\n\n") : r.text || "";
  return (
    <details
      className={"fl-reply" + (main ? " main" : "") + (thought ? " thought" : "")}
      id={id}
      open={main && !folds.closed.has(id)}
      onToggle={main ? (ev) => useTurns.getState().fold(id, ev.currentTarget.open) : undefined}
    >
      <summary title={thought ? "Fold or show what it thought" : "Fold or show the whole message"}>
        <span className="dot">●</span>
        {thought ? <span className="lbl">Thought:</span> : null}
        {/* its first line, less the markdown's marks */}
        <span className="first">{firstLine(unplanned(text).replace(/`|\*\*|^#{1,6}\s+/gm, ""), 200)}</span>
      </summary>
      <Markdown text={text} />
    </details>
  );
}

/** A note: a subagent's report handed back, by its task; another session's message, by its first line, the session
 * named. Opened: the whole. (A skill the agent loaded is with the turn's commands, not here.) */
function Noted({ r, id }: { r: ReplyData; id: string }) {
  const peer = r.kind === "peer";
  return (
    <details className={`fl-reply noted ${r.kind}`} id={id}>
      <summary title={peer ? "Show or fold the message" : "Show or fold the report"}>
        <span className="dot">●</span>
        <span className="lbl">{peer && r.name ? `Message from ${r.name}:` : NOTED[r.kind]}</span>
        <span className="first">{firstLine(peer ? r.text : r.name || r.text, 200)}</span>
      </summary>
      {r.text ? <Markdown text={r.text} breaks /> : <div className="fl-none">Empty.</div>}
    </details>
  );
}

/** The turn's latest call, under its messages, above the line saying it works: running, or how it went, and what it
 * was; opened, its call and its output, as the commands at the left show it. A call with no result once the actor no
 * longer runs: waiting on the user (a question, a plan), or stopped -- interrupted, its process gone -- not run. */
export function LastCall({ t, live }: { t: Turn; live: boolean }) {
  const { feed } = useChat();
  const c = t.last!;
  const [cls, word] = c.error
    ? ["err", "Failed:"]
    : !c.running
      ? ["ok", "Ran:"]
      : live
        ? ["run", "Running:"]
        : currentOf(feed)?.state === "asking"
          ? ["wait", "Waiting for you:"]
          : ["stop", "Stopped:"];
  return (
    <details className="fl-reply call" id={`fl-c-${t.n}-${c.id || ""}`}>
      <summary title="Show or fold the call and its output">
        <span className={"dot " + cls}>●</span>
        <span className={"lbl " + cls}>{word}</span>
        <span className="first">
          <CallLabel c={c} n={200} />
        </span>
      </summary>
      <CallView call={c.call} ran={c} />
    </details>
  );
}
