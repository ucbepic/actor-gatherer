// The conversation's box (.fl-talk): the turns, kept where the reader left it and following its end as it grows; or,
// before the first turn is stored, the turn a message opened, or the actor waving hello. Kept at its end as its box
// changes size (follow.ts), and as what it holds grows while the reader is there; brought to its end as a message is
// sent from here.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useChat } from "./context";
import { followEnd, keepEnd, unfollow } from "./follow";
import { FirstTurns } from "./Hello";
import { Turns } from "./Turns";
import { openingOf, turnsOf } from "./view";

export function Talk({ ref, interrupting }: { ref: RefObject<HTMLDivElement | null>; interrupting: boolean }) {
  const { feed } = useChat();
  const turns = turnsOf(feed).length;
  useLayoutEffect(() => {
    const n = ref.current;
    if (!n) return;
    followEnd(n);
    return () => unfollow(n);
  }, [ref]);
  // what it holds grown (a turn, a reply, the line under it) as the stream says: still at its end, if it was
  useLayoutEffect(() => {
    if (ref.current) keepEnd(ref.current);
  });
  // a message sent from here: shown at the end, wherever the reader was
  const sent = feed.mine.length,
    before = useRef(sent);
  useLayoutEffect(() => {
    const n = ref.current;
    if (n && sent > before.current) n.scrollTop = n.scrollHeight;
    before.current = sent;
  }, [ref, sent]);
  return (
    <div
      ref={ref}
      className={turns || openingOf(feed) ? "fl-talk" : "fl-talk hi"}
      data-keep={turns ? "files-talk" : undefined}
      data-follow={turns ? "1" : undefined}
    >
      {turns ? <Turns interrupting={interrupting} /> : <FirstTurns interrupting={interrupting} />}
    </div>
  );
}
