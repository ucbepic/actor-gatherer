// A user's message in a chat bubble, as the server gives it -- the user's words as their harness's rules read them (a
// command run with `!` as "! ls", a /name as "/greet Bob", a message sent mid-turn unwrapped): a command (its `kind`
// "user_command") in the terminal's type, as is one typed in this page's box ("!ls"), which the harness runs as one. A
// `!` command's bubble is a bash bubble: its `!` in bash mode's colour, and under it, once run, what it printed.
//
// A message between the actors of a gatherer (coordination.py's `envelope`, read by the host), drawn with its sender's
// avatar and name -- the gatherer agent's, the manager -- or the news of a watch, as a quiet line with the avatar of the
// actor it is about; long as they mostly are, folded to their first lines (.crew-fold; news, two) with a toggle to show
// the rest. A message an app wrote with its own block (a Browser's), as the app draws it (the host's appWords).
import { createContext, useContext, useLayoutEffect, useReducer, useRef, type MouseEvent, type ReactNode } from "react";
import { hlLines, outputHtml } from "../../core/ui/highlight";
import { useChat } from "./context";
import { Html } from "./Hosted";
import type { Actor, ChatFeed, ChatHost, Envelope, SentMessage, Turn } from "./types";

export const isBash = (text: string | null | undefined): boolean => !!text && /^\s*!/.test(text);

/** A bubble's classes after "fl-user": a bash bubble's, or a message between actors' (news: quieter). */
export function bubbleClass(host: ChatHost, text: string): string {
  if (isBash(text)) return " bash";
  const env = host.envelope(text);
  return !env ? "" : env.from === "update" ? " crew update" : " crew";
}

/** A command, coloured as the shell reads it (the old page's shellSpan). */
const ShellSpan = ({ text }: { text: string }) => (
  <span className="sh-t" dangerouslySetInnerHTML={{ __html: hlLines(text, "shell").join("\n") }} />
);

/** A message's words, in its bubble. */
export function UserWords({ text, kind }: { text: string; kind?: string }) {
  const { host } = useChat();
  if (isBash(text))
    return (
      <span className="tx bang">
        <span className="bash-mark" aria-hidden="true">
          !
        </span>{" "}
        <ShellSpan text={String(text).trim().replace(/^!\s*/, "")} />
      </span>
    );
  const env = host.envelope(text);
  if (env) return <CrewWords env={env} />;
  const app = host.appWords(text);
  if (app) return <Html node={app} />;
  return <span className={"tx" + (kind === "user_command" ? " bang" : "")}>{text}</span>;
}

const COORDINATOR_NAME = "Coordinator agent";
const isCoordinator = (a: Actor) => a.role === "coordinator";

/** The actor of the gatherer shown that a message names: the gatherer agent, or the one whose id starts with `id`. */
function crewActor(feed: ChatFeed, coordinator: boolean, id: string | null): Actor | null {
  const g = feed.home?.gatherers.find((x) => x.name === feed.gatherer);
  const agents = (g?.agents ?? []) as Actor[];
  if (!g) return null;
  if (coordinator) return agents.find(isCoordinator) ?? null;
  return agents.find((a) => id && (a.channel.startsWith(id) || (a.session?.started_as ?? "").startsWith(id))) ?? null;
}
/** An actor's id as a label shows it: its first characters (messages name ids whole, for the actors to answer by). */
const crewId = (id: string | null | undefined) => String(id || "").slice(0, 8);
const crewName = (coordinator: boolean, a: Actor | null, env: Envelope) =>
  coordinator ? COORDINATOR_NAME : a?.name?.text || env.name || `Actor ${crewId(env.id)}`;

function CrewWords({ env }: { env: Envelope }) {
  const { feed, host } = useChat();
  const coordinator = env.from === "coordinator",
    a = crewActor(feed, coordinator, env.id);
  if (env.from === "update")
    return (
      <span className="tx crew">
        <Html node={host.crewFace(a, false)} />
        <span className="crew-body">
          <span className="crew-from">
            {`${crewName(false, a, env)} is done`}
            <span className="crew-how">{` · ${env.how}`}</span>
          </span>
          {env.text ? <CrewText text={env.text} /> : null}
        </span>
      </span>
    );
  return (
    <span className="tx crew">
      <Html node={host.crewFace(a, coordinator)} />
      <span className="crew-body">
        <span className="crew-from">{crewName(coordinator, a, env)}</span>
        <CrewText text={env.text} />
      </span>
    </span>
  );
}

// A message between actors opened by its toggle, kept so by the actor shown and the message's words -- across draws, and
// once ag stores a message sent from its pending bubble; and whether its words run past its first lines, as measured
// where it is drawn and again when its width changes, so a draw has the toggle (.long) only then.
const crewOpen = new Set<string>(),
  crewLong = new Map<string, boolean>();
const crewKey = (feed: ChatFeed, text: string) => `${feed.key}\u0000${text.length}\u0000${text.slice(0, 200)}`;

/** A folded message's box (a band, or a sent message): its classes, its toggle, and what its words' size says. */
function useCrewFold(k: string) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const open = crewOpen.has(k);
  return {
    cls: " crew-fold" + (crewLong.get(k) || open ? " long" : "") + (open ? " open" : ""),
    open,
    toggle: () => {
      if (crewOpen.has(k)) crewOpen.delete(k);
      else crewOpen.add(k);
      redraw();
    },
    measured: (long: boolean) => {
      if (crewLong.get(k) === long) return;
      if (crewLong.size > 500) crewLong.clear();
      crewLong.set(k, long);
      redraw();
    },
  };
}

// Each message's words, watched for their size while drawn: a folded one's longer than its lines or not.
const said = new WeakMap<Element, (long: boolean) => void>();
let sizes: ResizeObserver | null = null;
function watchSize(t: Element, measured: (long: boolean) => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  sizes ??= new ResizeObserver((seen) => {
    for (const { target } of seen) {
      const box = target.isConnected && target.closest(".crew-fold");
      if (!box || box.classList.contains("open")) continue;
      said.get(target)?.(target.scrollHeight > target.clientHeight + 1);
    }
  });
  said.set(t, measured);
  sizes.observe(t);
  return () => {
    sizes?.unobserve(t);
    said.delete(t);
  };
}

/** What a folded message's box makes of its words' size (useCrewFold's `measured`), for the words in it. */
const Measured = createContext<((long: boolean) => void) | null>(null);

function CrewText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const measured = useContext(Measured),
    latest = useRef(measured);
  useLayoutEffect(() => {
    latest.current = measured;
  });
  useLayoutEffect(() => (ref.current ? watchSize(ref.current, (long) => latest.current?.(long)) : undefined), []);
  return (
    <span ref={ref} className="crew-text">
      {text}
    </span>
  );
}

function CrewMore({ open, toggle }: { open: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      className="crew-more"
      aria-expanded={open ? "true" : "false"}
      title={open ? "Fold the message to its first lines" : "Show the whole message"}
      onClick={toggle}
    >
      {open ? "Show less" : "Show all"}
    </button>
  );
}

export interface BubbleProps {
  text: string;
  kind?: string;
  /** written while the turn worked, and given to the agent in it: stacked on the turn's message */
  joined?: boolean;
  title: string;
  /** a button (a turn's message before the latest: a click shows or folds its replies), its state; else a div */
  button?: boolean;
  expanded?: boolean;
  onClick?: (ev: MouseEvent) => void;
  /** after the words: the turn's count and chevron */
  end?: ReactNode;
  /** the bubble put in what goes round it: a bash bubble's output */
  wrap?: (bubble: ReactNode) => ReactNode;
}

/** A message in its bubble; a message between actors, or a watch's news, in a band with its toggle under the bubble,
 * which a button (a turn's message) cannot hold. */
export function Bubble({
  text,
  kind,
  joined = false,
  title,
  button = false,
  expanded,
  onClick,
  end,
  wrap,
}: BubbleProps) {
  const { feed, host } = useChat();
  const env = host.envelope(text);
  const banded = !!env && !!env.text;
  const cls = "fl-user" + (joined && !banded ? " joined" : "") + bubbleClass(host, text);
  const words = (
    <>
      <UserWords text={text} kind={kind} />
      {end}
    </>
  );
  const bubble = button ? (
    <button type="button" className={cls} aria-expanded={expanded ? "true" : "false"} title={title} onClick={onClick}>
      {words}
    </button>
  ) : (
    <div className={cls} title={title} onClick={onClick}>
      {words}
    </div>
  );
  const inner = wrap ? wrap(bubble) : bubble;
  if (!banded) return inner;
  return (
    <CrewBand k={crewKey(feed, env.text)} update={env.from === "update"} joined={joined}>
      {inner}
    </CrewBand>
  );
}

function CrewBand({
  k,
  update,
  joined,
  children,
}: {
  k: string;
  update: boolean;
  joined: boolean;
  children: ReactNode;
}) {
  const fold = useCrewFold(k);
  return (
    <div className={"fl-crew" + (update ? " update" : "") + (joined ? " joined" : "") + fold.cls}>
      <Measured value={fold.measured}>{children}</Measured>
      <CrewMore open={fold.open} toggle={fold.toggle} />
    </div>
  );
}

/** A turn's first bubble; a command the user ran with `!` in a bash bubble: the command at its top, and under a rule
 * what it printed (files.py's `output`: stdout, then stderr) -- "no output" for none. */
export function bashOutput(t: Turn) {
  if (!isBash(t.text) || t.output === undefined || t.output === null) return undefined;
  const output = t.output;
  const html = output ? outputHtml(output, String(t.text).replace(/^\s*!\s*/, "")) : "no output";
  return function BashBubble(bubble: ReactNode) {
    return (
      <div className="fl-bash">
        {bubble}
        <pre
          className={"fl-bash-out" + (output ? "" : " none")}
          title="What it printed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  };
}

/** A message the actor sent another (files.py's `sent`: `ag actors send`, or a new actor started with it), in its
 * turn: with its receiver's avatar and name. */
export function SentBubble({ m }: { m: SentMessage }) {
  const { feed, host } = useChat();
  const coordinator = m.to_name === COORDINATOR_NAME,
    to = crewActor(feed, coordinator, String(m.to || ""));
  const who = coordinator ? "the coordinator agent" : to?.name?.text || m.to_name || `actor ${crewId(m.to)}`;
  const fold = useCrewFold(crewKey(feed, m.text));
  return (
    <div
      className={"fl-sent crew" + fold.cls}
      title={m.kind === "new" ? "A new actor, started with this message" : "Sent with `ag actors send`"}
    >
      <Html node={host.crewFace(to, coordinator)} />
      <span className="crew-body">
        <span className="crew-from">{m.kind === "new" ? `Started ${who}` : `To ${who}`}</span>
        <Measured value={fold.measured}>
          <CrewText text={m.text} />
        </Measured>
        <CrewMore open={fold.open} toggle={fold.toggle} />
      </span>
    </div>
  );
}
