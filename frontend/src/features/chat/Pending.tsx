// What the user wrote that the turns do not hold yet, as the server's view has it (view.ts): what waits for the agent's
// next step, at the latest turn's end, faded and marked pending; and the turn a message opened that is not stored yet,
// drawn in full the moment it is sent -- the actor at work under it, or, the session not having had it for long, the way
// to its terminal.
import { useState, type CSSProperties } from "react";
import { useChat } from "./context";
import { Bubble } from "./Bubble";
import { turnsSeen } from "./store";
import { currentOf, waitsOf } from "./view";
import { Status, StoppedLine, Working } from "./Working";
import type { ChatFeed, Opening } from "./types";

/** A turn that opens grows in (fl-in, features/chat/files-view.css) this long; the stored turn after it goes on from where it is. */
export const GROW_MS = 320;

/** The key a turn opening is known by on this page, from its first draw on: the actor and its send (its message's words,
 * for one with no id: sent in its terminal). */
export const seenKey = (feed: ChatFeed, cid: string | null | undefined, text: string) =>
  feed.key + "\u0000" + (cid || text.trim().slice(0, 200));

/** A turn opening first drawn now (by `seenKey`): from now on it grows in. */
export function seeing(key: string, now = Date.now()): void {
  const seen = turnsSeen.get(key);
  if (seen !== undefined && now - seen <= 60000) return;
  if (turnsSeen.size > 50) turnsSeen.clear();
  turnsSeen.set(key, now);
}

/** How far into growing in (fl-in) a turn is when its box is first drawn: the time since this page first drew the turn
 * opening (`seeing`), as a CSS delay, kept for the box's life -- so the stored turn drawn in the opening's place goes on
 * from there, and a redraw does not move it. Null for a turn grown, or never seen opening. */
export function useGrowing(key: string): CSSProperties | null {
  const [age] = useState(() => growingFor(key));
  return age === null ? null : ({ "--in": `-${Math.round(age)}ms` } as CSSProperties);
}

function growingFor(key: string, now = Date.now()): number | null {
  const seen = key ? turnsSeen.get(key) : undefined;
  const age = seen === undefined ? Infinity : now - seen;
  return age < GROW_MS ? age : null;
}

export interface Waiting {
  texts: string[];
}

/** What waits for the agent's next step (view.ts's waitsOf): null for nothing. */
export function waiting(feed: ChatFeed): Waiting | null {
  const texts = waitsOf(feed).map((w) => w.text);
  return texts.length ? { texts } : null;
}

export function Pending({ w }: { w: Waiting }) {
  return (
    <div className="fl-pending">
      {w.texts.map((text, i) => (
        <Bubble key={i} text={text} title="Waiting for the agent's next step" />
      ))}
      <span className="lbl">Pending</span>
    </div>
  );
}

/** The turn a message opened, not stored yet (view.ts's openingOf): its message in full, as the terminal shows it; the
 * actor at work under it, from when it was sent -- or, the session not having had it for long (`unseen`), that, and the
 * way to its terminal, which may be asking something first; or how it stopped, Esc stopping it before the harness
 * recorded anything of it (`stopped`); or, its terminal showing a menu as it starts (an update, a folder to trust: the
 * state "asking"), that it goes once that is answered, in the card below; what waits after it. Replaced by the stored
 * turn, which counts from the same moment. */
export function OpenedTurn({ o, interrupting }: { o: Opening; interrupting: boolean }) {
  const { feed, host } = useChat();
  const now = interrupting ? "Interrupting…" : "Working…";
  const w = waiting(feed);
  const asks = !!o.unseen && !!feed.info.session?.terminal && feed.terminalView;
  const held = currentOf(feed)?.state === "asking";
  const key = seenKey(feed, o.cid, o.text);
  seeing(key);
  const grow = useGrowing(key);
  const cls = "fl-turn opened" + (grow ? " fl-in" : "");
  if (o.stopped)
    return (
      <div className={cls} style={grow ?? undefined}>
        <Bubble text={o.text} title="Stopped in the terminal before the agent received it" />
        <StoppedLine t={{ n: -1, text: o.text, stopped: o.stopped }} latest={true} />
        {w ? <Pending w={w} /> : null}
      </div>
    );
  return (
    <>
      <div className={cls} style={grow ?? undefined}>
        <Bubble text={o.text} title="Sent to the agent" />
        {held ? (
          <div className="fl-pending">
            <span className="lbl">Not sent yet. Answer the question below first.</span>
          </div>
        ) : o.unseen ? (
          <div className="fl-pending">
            <span className="lbl">
              Not received by the session yet
              {asks ? ". Its terminal may be asking something first. " : null}
              {asks ? (
                <button
                  type="button"
                  className="to-term"
                  onClick={() => host.setChatView("terminal", feed.info.channel)}
                >
                  Open the terminal
                </button>
              ) : null}
            </span>
          </div>
        ) : (
          <Working last={Math.max(o.began, feed.info.last || 0)} at={o.began} now={now} />
        )}
        {w ? <Pending w={w} /> : null}
      </div>
      {o.unseen || held ? null : <Status work={{}} now={now} />}
    </>
  );
}
