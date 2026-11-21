// The conversation's box (.fl-talk): the turns, kept where the reader left it and following its end as it grows
// (Turns.tsx, react-virtuoso's list); or, before the first turn is stored, the turn a message opened, or the actor waving
// hello, in a box of its own -- kept at its end as its box changes size (follow.ts), and as what it holds grows while the
// reader is there; brought to its end as a message is sent from here.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useChat } from "./context";
import { followEnd, keepEnd, unfollow } from "./follow";
import { FirstTurns } from "./Hello";
import { Turns } from "./Turns";
import { openingOf, turnsOf } from "./view";

export function Talk({ ref, interrupting }: { ref: RefObject<HTMLDivElement | null>; interrupting: boolean }) {
  const { feed } = useChat();
  return turnsOf(feed).length ? (
    <Turns talkRef={ref} interrupting={interrupting} />
  ) : (
    <Before talkRef={ref} interrupting={interrupting} />
  );
}

/** Before the first turn is stored. */
function Before({ talkRef, interrupting }: { talkRef: RefObject<HTMLDivElement | null>; interrupting: boolean }) {
  const { feed } = useChat();
  useLayoutEffect(() => {
    const n = talkRef.current;
    if (!n) return;
    followEnd(n);
    return () => unfollow(n);
  }, [talkRef]);
  // what it holds grown (the turn opened, the line under it) as the stream says: still at its end, if it was
  useLayoutEffect(() => {
    if (talkRef.current) keepEnd(talkRef.current);
  });
  // a message sent from here: shown at the end, wherever the reader was
  const sent = feed.mine.length,
    before = useRef(sent);
  useLayoutEffect(() => {
    const n = talkRef.current;
    if (n && sent > before.current) n.scrollTop = n.scrollHeight;
    before.current = sent;
  }, [talkRef, sent]);
  return (
    <div ref={talkRef} className={openingOf(feed) ? "fl-talk" : "fl-talk hi"}>
      <FirstTurns interrupting={interrupting} />
    </div>
  );
}
