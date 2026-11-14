// The conversation, at the right of the Chat view: each of the user's messages a turn, and under it the agent's (Turn).
// The latest turns drawn, the earlier a few more at a time as the reader scrolls up past the top (pull.ts). The turns
// before the latest folded as the setting "Chat's earlier turns" has them -- all but the latest two the agent answered in
// (a message, a thought or a call), and any after them it has yet to answer: the one before those two folds once a newer
// turn has its first answer; never by the actor's status, nor by a message sent and not yet stored, so a turn is not
// folded and shown again as the next starts. Then the turn a message opened that is not stored yet. What each shows of
// its state -- at work, done, stopped -- is the server's view's (view.ts), one moment's for all of them.
import { useLayoutEffect } from "react";
import { plural } from "../../core/format";
import { useChat } from "./context";
import { placed } from "./follow";
import { OpenedTurn } from "./Pending";
import { drawn } from "./pull";
import { useTurns } from "./store";
import { Turn, type TurnPlace } from "./Turn";
import type { Turn as TurnData } from "./types";
import { currentOf, nowWords, openingOf, pickedOf, turnsOf } from "./view";

export function Turns({ interrupting }: { interrupting: boolean }) {
  const { feed, folds } = useChat();
  const turns = turnsOf(feed),
    last = turns.length - 1,
    cur = currentOf(feed),
    opening = openingOf(feed);
  const first = folds.first ?? 0;
  const answered = turns.filter((t) => (t.replies || []).length || t.calls).map((t) => t.n);
  const foldsAt = answered.length < 2 ? 0 : answered[answered.length - 2]; // the turns before this one fold
  const placeOf = (t: TurnData): TurnPlace => {
    const latest = t.n === last && !opening;
    const live = latest && cur?.state === "working"; // asking: what it asks shows, not the actor at work
    return {
      live,
      done: latest && (cur?.state === "done" || cur?.state === "stopped"),
      folds: foldsAt,
      opened: !!opening,
      began: live ? (t.began ?? t.at ?? undefined) : undefined,
      // a call under way is drawn above, as the turn's latest call: the line under it only says the agent works
      now: live ? nowWords(cur, t, interrupting) : "",
      failing: live ? (cur?.failing ?? null) : null,
      stopped: t.stopped || (t.n === last && cur?.state === "stopped" ? (cur.stopped ?? null) : null),
    };
  };
  const picked = pickedOf(feed, turns);
  // the turn shown brought into view, once each time one is shown: the latest at its end, one picked at its top
  useLayoutEffect(() => {
    const at = `${feed.key}:${picked}`;
    if (useTurns.getState().shown === at) return;
    requestAnimationFrame(() => {
      if (useTurns.getState().shown === at) return; // already (keepTurn: kept where the reader had it)
      const cur = document.querySelector<HTMLElement>(".fl-talk .fl-turn.on");
      if (!cur || !cur.parentElement) return;
      useTurns.getState().setShown(at);
      const talk = cur.parentElement; // .fl-talk: its offset parent
      talk.scrollTop = (drawn.feed ?? feed).picked === null ? talk.scrollHeight : cur.offsetTop;
      placed(talk);
    });
  });
  return (
    <>
      {first ? <div className="fl-earlier">{`${plural(first, "earlier turn")} · scroll up for more`}</div> : null}
      {turns.slice(first).map((t) => (
        <Turn key={t.n} t={t} place={placeOf(t)} />
      ))}
      {opening ? <OpenedTurn o={opening} interrupting={interrupting} /> : null}
    </>
  );
}
