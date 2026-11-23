// The actor under its turn: at work (the line under a running turn, and its stage below the turn), done (its avatar
// still, a check at its corner), and how a turn stopped short.
import type { ReactNode } from "react";
import type { Home, StoppedSays } from "../../core/api/types";
import { ago, lasting, spell } from "../../core/format";
import { AtRest, AtWork } from "../../core/ui/stage/Stage";
import { bareAvatar, type Work } from "../../core/ui/stage/model";
import { inkStyle, useChat } from "./context";
import type { Actor, Turn } from "./types";

/** The actor's avatar small, out of its circle (`none`: what stands for it without one); a line short of height shows it. */
function MiniAvatar({ none }: { none: ReactNode }) {
  const { feed } = useChat();
  const src = bareAvatar(feed.info);
  return (
    <span className="fl-mini" aria-hidden="true">
      {src ? <img src={src} alt="" draggable="false" /> : none}
    </span>
  );
}

/** The line under a running turn: when the actor last did something (`last`; its last try, `retrying`), how long the
 * turn has run (since `at`), and what it does now (`now`). Short of height (the `talk` container), all on one line,
 * behind the actor's avatar small; tall, the words are its stage's, below (Status), and these only read out. */
export function Working({
  last,
  at,
  now,
  retrying = false,
}: {
  last: number | null;
  at: number | null;
  now: string;
  retrying?: boolean;
}) {
  const { feed } = useChat();
  return (
    <div className="fl-working">
      <MiniAvatar none={<span className="spin" />} />
      <div className="fl-times" aria-hidden="true">
        {retrying ? "last try " : "last activity "}
        <span data-ago={last || ""}>{ago(last)}</span>
        {at ? " · " : null}
        {at ? <span data-lasting={at}>{lasting(at)}</span> : null}
        {at ? " so far" : null}
        {feed.canInterrupt ? " · esc to interrupt" : null}
      </div>
      <div className="now" role="status" style={inkStyle(feed.info)}>
        {now}
      </div>
    </div>
  );
}

/** The latest turn over, short of height: on one line as the actor at work is -- its avatar small, "Done", and how long
 * the turn took, from its message to its last event (`end`; from a server without it, the actor's last activity) -- in
 * place of the actor done under it (Done). Otherwise not shown. */
export function Finished({ t }: { t: Turn }) {
  const { feed } = useChat();
  return (
    <div className="fl-working fl-finished">
      <MiniAvatar none={<span>✓</span>} />
      <div className="fl-times">{t.at ? `took ${spell((t.end || feed.info.last || t.at) - t.at)}` : ""}</div>
      <div className="now" style={inkStyle(feed.info)}>
        Done
      </div>
    </div>
  );
}

/** Under the turn at work: the actor acting out its turn on its stage (core/ui/stage), and what it does now. */
export function Status({ work, now }: { work: unknown; now: string }) {
  const { feed, host } = useChat();
  return (
    <div className="fl-status" aria-hidden="true">
      <AtWork info={feed.info} work={work as Work | null} mode={host.avatarMode()} />
      <span className="now" style={inkStyle(feed.info)}>
        {now}
      </span>
    </div>
  );
}

/** Under the latest turn, over: the actor done -- its check grown in, if the page saw the turn end. */
export function Done({ t }: { t: Turn }) {
  const { feed } = useChat();
  return (
    <div className="fl-done" title={`Done · ${ago(feed.info.last)}`}>
      <AtRest info={feed.info} turn={t.row_id} />
    </div>
  );
}

const STOPPED_ANY: StoppedSays = { lead: "⎿", interrupted: "Interrupted", error: "Error" };

/** How a turn stopped short, as its harness says it there (files.py's `stopped`, in harness_kit's `stopped_says`):
 * interrupted (Esc), and what it asks then -- or the error it gave up on, or another reason it gives; red for an error or
 * a reason. Not the latest turn's error while the actor is stopped on it: its note says that in full. Null for a turn
 * that ended as turns do. */
export function stoppedLine(
  home: Home | null,
  info: Actor,
  t: Turn,
  latest: boolean,
): { cls: string; lead: string; said: string } | null {
  const s = t.stopped;
  if (!s || (s.kind === "error" && latest && info.status === "error")) return null;
  const harness = info.harness || home?.harness_default;
  const says = (harness && home?.harness_info?.[harness]?.stopped) || STOPPED_ANY;
  const reason = s.kind !== "error" && s.reason ? (says.reasons || {})[s.reason] : undefined;
  const red = s.kind === "error" || !!reason;
  const said =
    s.kind === "error"
      ? s.text || (s.status && says.error_status ? says.error_status.replace("{status}", String(s.status)) : says.error)
      : reason || says.interrupted;
  return { cls: "fl-stopped" + (red ? " error" : ""), lead: says.lead, said };
}

export function StoppedLine({ t, latest }: { t: Turn; latest: boolean }) {
  const { feed } = useChat();
  const line = stoppedLine(feed.home, feed.info, t, latest);
  if (!line) return null;
  return (
    <div className={line.cls} role="note">
      <span className="lead" aria-hidden="true">
        {line.lead}
      </span>
      <span>{line.said}</span>
    </div>
  );
}
