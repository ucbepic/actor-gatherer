// The line under an actor's message box (.err): why nothing is sent from here -- another process has its session open --
// else why its last message was not sent (actors.ts's `failed`: for one its terminal's box could not take, the way to the
// terminal), else why its session failed. Drawn from the actor's Chat state as it changes; for the old page's chat card,
// a node of each actor's own (`drawSendError`), the line's box itself, the same from draw to draw.
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { useActorChat } from "./actors";

export interface SendErrorProps {
  actor: string;
  /** why another process holds its session ("": none) */
  held: string;
  /** its session's state, and its last error */
  session: { status?: string; last_error?: string | null } | null;
  /** the Terminal view, to send the reader to: null, none */
  toTerminal: (() => unknown) | null;
}

export function SendErrorWords({ actor, held, session, toTerminal }: SendErrorProps) {
  const failed = useActorChat(actor).failed;
  if (held) return held;
  if (failed)
    return (
      <>
        {failed.text}
        {failed.box && toTerminal ? (
          <>
            {" "}
            <button type="button" className="to-term" onClick={() => toTerminal()}>
              Open the terminal
            </button>
          </>
        ) : null}
      </>
    );
  return session?.status === "failed" && session.last_error ? session.last_error : null;
}

/** The line, in its box. */
export function SendError(props: SendErrorProps) {
  return (
    <div className="err" role="alert">
      <SendErrorWords {...props} />
    </div>
  );
}

const KEPT = 12;
const lines = new Map<string, { node: HTMLDivElement; root: Root }>();

/** The actor's line, drawn now as `props` say, in its node (.err) for the page to put under the box. */
export function drawSendError(props: SendErrorProps): HTMLDivElement {
  let kept = lines.get(props.actor);
  if (kept) lines.delete(props.actor);
  else {
    const node = document.createElement("div");
    node.className = "err";
    node.setAttribute("role", "alert");
    kept = { node, root: createRoot(node) };
  }
  lines.set(props.actor, kept);
  for (const [k, l] of lines) {
    if (lines.size <= KEPT) break;
    if (k === props.actor || l.node.isConnected) continue;
    l.root.unmount();
    lines.delete(k);
  }
  const { root } = kept;
  flushSync(() => root.render(<SendErrorWords {...props} />));
  return kept.node;
}
