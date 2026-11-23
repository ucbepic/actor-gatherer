// Before the actor's first turn is stored: the turn a message opened, in full with the actor at work under it; or none
// yet -- the actor waving hello (core/ui/stage's Greeting), saying its line (or that there is none yet), under the first
// message while it waits to reach the agent.
import { Fragment } from "react";
import { Greeting } from "../../core/ui/stage/Stage";
import { useChat } from "./context";
import { OpenedTurn, Pending, waiting } from "./Pending";
import { openingOf } from "./view";

export function FirstTurns({ interrupting }: { interrupting: boolean }) {
  const { feed } = useChat();
  const opening = openingOf(feed);
  if (!opening) return <Hello />;
  return <OpenedTurn o={opening} interrupting={interrupting} />;
}

function Hello() {
  const { feed, host } = useChat();
  const { info, session, writable, held } = feed;
  const w = waiting(feed);
  // its line (avatar_hello: one of its avatar's in avatars/hello.toml, the same for it always -- avatars.py's), a
  // haiku's lines each on its own
  const says = writable && !held && session.status !== "starting" && info.avatar ? info.avatar_hello : null;
  const parts = says ? String(says).split("\n") : [];
  return (
    <>
      {w ? (
        <div className="fl-turn">
          <Pending w={w} />
        </div>
      ) : null}
      <div className="fl-hello">
        <Greeting info={info} mode={host.avatarMode()} />
        {w ? null : says ? (
          <div className={"fl-say" + (parts.length > 1 ? " verse" : "")}>
            {parts.map((part, k) => (
              <Fragment key={k}>
                {k ? <br /> : null}
                {part}
              </Fragment>
            ))}
          </div>
        ) : (
          <div>
            {session.status === "starting"
              ? "Starting the agent…"
              : writable && !held
                ? "No messages yet. Write one below."
                : "No messages yet."}
          </div>
        )}
      </div>
    </>
  );
}
