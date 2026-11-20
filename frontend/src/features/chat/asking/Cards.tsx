// The cards under the conversation of an actor (ask.ts's cardOf): the model call its turn stopped on, or keeps failing on;
// else what it waits on the user for (Asking.tsx); else an answer recorded otherwise than picked. Drawn from the actor as
// the home has it, and the answers as the reader makes them (answers.ts) -- in Chat (ChatMain.tsx), and in the other
// views and the views of the reader's own (mount.tsx, for the old page). Each card is its box (`shellOf`: its classes,
// role and name) and what is in it.
import { ago } from "../../../core/format";
import type { Home } from "../../../core/api/types";
import type { Actor } from "../types";
import { cardOf, errorHint, whoAsks, type Ask, type CardKind } from "./ask";
import { dismiss, useAnswers } from "./answers";
import { AskingCard, askingWhat } from "./Asking";

/** What the cards call of the page they are on. */
export interface CardsHost {
  /** the page's icons: SVG paths in a 16x16 box */
  icons: Record<string, string>;
  setChatView(id: string): unknown;
  /** what a permission is for, after "asks to", as its harness reads the call */
  permissionVerb(ask: Ask): string;
  /** the call a permission is asked for, as Chat shows a call (the old page's node) */
  permissionView(ask: Ask, id: string): Node;
  /** the page's data loaded again: an answer sent */
  refresh(): Promise<unknown>;
}

export interface CardProps {
  info: Actor;
  home: Home | null;
  /** answered here where it can be; false: a view to read by, which shows it */
  answerable: boolean;
  /** the page is a snapshot */
  snapshot: boolean;
  /** a Terminal view to send the reader to */
  terminalView: boolean;
  host: CardsHost;
}

/** The card shown for the actor, of those `only` names (all, by default): none for none. */
export function useCard(info: Actor, only?: CardKind): CardKind | null {
  const kind = cardOf(
    info,
    useAnswers((s) => s.seen),
  );
  return kind && (!only || kind === only) ? kind : null;
}

/** A card's box: its classes, its role, and its name. */
export interface Shell {
  className: string;
  role: string;
  "aria-label"?: string;
}

export function shellOf(kind: CardKind, props: CardProps): Shell {
  const over = props.info.status === "error";
  if (kind === "error")
    return { className: "asking-note error-note" + (over ? "" : " retrying"), role: over ? "alert" : "status" };
  if (kind === "answered") return { className: "asking-note answered", role: "alert" };
  return { className: "asking-note", role: "group", "aria-label": `Waiting for you: ${askingWhat(props)}` };
}

/** What a card of `kind` holds. */
export function CardBody({ kind, ...props }: CardProps & { kind: CardKind }) {
  if (kind === "error") return <ErrorCard {...props} />;
  if (kind === "asking") return <AskingCard {...props} />;
  return <AnsweredCard {...props} />;
}

/** The card shown for the actor, in its box. */
export function Cards(props: CardProps & { only?: CardKind }) {
  const kind = useCard(props.info, props.only);
  if (!kind) return null;
  return (
    <div {...shellOf(kind, props)}>
      <CardBody kind={kind} {...props} />
    </div>
  );
}

/** The model call the agent's turn stopped on, or keeps failing on (data.py's `failing`, `stopped`): why, as ag's hook
 * server saw it and as the harness put it, and how many tries failed. While the harness tries again, that it does; once
 * it gave up, that a message tries again. */
function ErrorCard({ info, home }: CardProps) {
  const over = info.status === "error";
  const f = info.failing || null;
  const st = over ? info.stopped || null : null;
  const who = whoAsks(home, info);
  const why = f
    ? f.status
      ? `The model's endpoint returned ${f.status}: ${f.error}`
      : `No answer from the model's endpoint: ${f.error}`
    : st?.text || "The model call failed.";
  const hint = errorHint(f, st);
  const tries = f
    ? `${(f.attempts ?? 0) > 1 ? `${f.attempts} tries` : "1 try"} failed, the first ${ago(f.first)}`
    : null;
  return (
    <>
      <div className="head">
        <span className="pill">
          <i aria-hidden="true" />
          {over ? "Error" : "Retrying"}
        </span>
        <span className="what">{over ? `${who} stopped after a failed model call` : `${who}'s model call failed`}</span>
        <span className="ago">{ago(f?.at || st?.at)}</span>
      </div>
      <div className="body">
        <div className="why">{why}</div>
        {hint ? <div className="hint">{hint}</div> : null}
        {st?.text && f && !st.text.includes(f.error ?? "") ? ( // only what it adds
          <div className="pair" style={{ marginTop: "8px" }}>
            <span className="k">{`${who} said`}</span>
            <span className="v">{st.text}</span>
          </div>
        ) : null}
      </div>
      <div className="foot">
        <span className="say">
          {[
            tries,
            over
              ? `${who} stopped trying. Send a message to try again.`
              : f?.retrying
                ? "Trying again now."
                : `${who} will try again.`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </>
  );
}

/** Once a question answered here has its answer recorded: what the harness recorded, when it is not what was picked (the
 * dialog was not as it first showed, or the harness takes its keys otherwise), until dismissed. */
function AnsweredCard({ info, home }: CardProps) {
  const a = info.answer!;
  return (
    <>
      <div className="head">
        <span className="pill">
          <i aria-hidden="true" />
          Check the answer
        </span>
        <span className="what">What was recorded is not what you picked</span>
        <span className="end">
          <button type="button" onClick={() => dismiss(a.call)}>
            Dismiss
          </button>
        </span>
      </div>
      <div className="body">
        <div className="pair">
          <span className="k">You picked</span>
          <span className="v">{a.summary}</span>
          <span className="k">{`${whoAsks(home, info)} recorded`}</span>
          <span className="v">{a.result || "nothing"}</span>
        </div>
      </div>
    </>
  );
}
