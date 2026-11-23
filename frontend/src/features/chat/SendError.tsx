// The line under an actor's message box (.err): why nothing is sent from here -- another process has its session open --
// else why its last message was not sent (actors.ts's `failed`: for one its terminal's box could not take, the way to the
// terminal), else why its session failed. Drawn from the actor's Chat state as it changes, under the box in the pane's
// card (card.tsx).
import type { Ref } from "react";
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

/** The line, in its box (`ref`: the box, which a view's own message box is put before). */
export function SendError({ ref, ...props }: SendErrorProps & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="err" role="alert">
      <SendErrorWords {...props} />
    </div>
  );
}
