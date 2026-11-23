// What the agent waits on the user for (data.py's `asking`): the questions it asked, each with its options, or the plan
// it asks them to approve. Where the dashboard runs the session's terminal, answered here: what is picked is typed into
// the terminal's dialog (answers.ts's answer: POST /api/answer, sessions.py's `answer`), and the terminal shows it
// answered as if it had been picked there; elsewhere it is answered in the terminal that runs the session. Not
// `answerable` (a view to read by): shown, and answered in Chat or the terminal. Codex's questions asked as it goes on
// working (`async`) show while it runs; its plan, once its turn proposed one and its terminal (the dashboard's) asks
// whether to implement it. A permission it asks before a tool runs (`kind` "permission", as its hook reported it): the
// call as its harness shows it, allowed or denied ({allow, text}). A dialog only its terminal's screen shows (`kind`
// "dialog": a menu its harness shows as it starts -- an update, a folder to trust -- or a permission no hook reported):
// an option picked ({pick}), as if picked there (sessions.py's `_pick`).
import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "../../../core/api/types";
import { ago, plural } from "../../../core/format";
import { StrokeIcon } from "../../../core/ui/Icon";
import { Markdown } from "../../../core/ui/Markdown";
import { askKey, askOf, askSays, askWhere, harnessName, isLate, lateAt, whoAsks, type Answer } from "./ask";
import { answer, answered, choiceOf, draftOf, nextOpen, show, tabOf, typeChange, useAnswers } from "./answers";
import { DialogView, Own, Question } from "./Options";
import type { CardProps } from "./Cards";

const CHECK = "M3.5 8.5l3 3 6-7";

/** Whether an answer sent counts as lost by now: drawn again the moment it would. */
function useLate(sent: Answer | null): boolean {
  const [, tick] = useState(0);
  const late = !!sent && isLate(sent);
  const at = sent && !late ? lateAt(sent) : null;
  useEffect(() => {
    if (at === null) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, at - Date.now()) + 200);
    return () => clearTimeout(t);
  }, [at]);
  return late;
}

/** What the agent asks for, in words: the card's name. */
export function askingWhat({ info, home, host }: CardProps): string {
  const ask = askOf(info)!;
  const who = whoAsks(home, info),
    qs = ask.questions || [];
  if (ask.kind === "dialog")
    return ask.menu ? `${who} asks something before it starts` : `${who} is asking you in its terminal`;
  if (ask.kind === "permission")
    return `${who} asks to ${host.permissionVerb(ask)}${ask.agent ? " (from a subagent)" : ""}`;
  if (ask.kind === "plan") return `${who} has a plan for you to ${askSays(home, ask).plan_verb}`;
  return `${who} asked you ${qs.length > 1 ? plural(qs.length, "question") : "a question"}${ask.async ? " as it works" : ""}`;
}

/** The card's contents (Cards.tsx draws its box). */
export function AskingCard({ info, home, answerable, snapshot, terminalView, host }: CardProps) {
  const ask = askOf(info)!;
  const d = draftOf(
    useAnswers((s) => s.drafts),
    ask,
  );
  const says = askSays(home, ask);
  const qs = ask.questions || [];
  const s: Partial<Session> = info.session || {};
  const { touched, reopened, here: answersHere } = askWhere(info, ask, home, snapshot);
  const here = answerable && answersHere;
  const key = askKey(ask),
    perm = ask.kind === "permission",
    dialog = ask.kind === "dialog";
  const sent = info.answer && info.answer.call === key ? info.answer : null;
  const who = whoAsks(home, info);
  const late = useLate(sent);
  const send = (choice: unknown) => answer(ask, s.session_id, choice, host.refresh);
  const busy = d.sending || !!sent;
  const done = (i: number) => answered(d, i);
  const ready = qs.length > 0 && qs.every((_, i) => done(i));
  const tab = tabOf(d, qs.length);
  const n = nextOpen(d, qs.length, tab);
  const question = (i: number) => (
    <Question
      key={i}
      ask={ask}
      i={i}
      d={d}
      here={here}
      busy={busy}
      own={ask.async ? "Or type your own answer" : says.own_answer}
      onEnter={() => {
        if (n >= 0) show(ask, n);
        else if (ready && !busy) send(choiceOf(d));
      }}
    />
  );
  // the foot's line: how the answer sent goes, or why it is not answered here
  const said = (full = false) => {
    const [cls, text] =
      dialog && !here
        ? [
            "",
            touched
              ? "Something was typed in the terminal since this appeared. Answer it there."
              : "Answer it in the terminal.",
          ]
        : sent
          ? [
              late ? "err" : "sent",
              late
                ? `Your answer (${sent.summary}) hasn't reached ${who}. Answer it in the terminal.`
                : `Typing your answer into the terminal: ${sent.summary}`,
            ]
          : d.error
            ? ["err", d.error]
            : !here
              ? [
                  "",
                  touched
                    ? "Something was typed in the terminal since the question appeared. Answer it there."
                    : reopened
                      ? "The terminal was reopened and no longer shows this question. Answer in a message."
                      : snapshot
                        ? "Answered in the terminal that runs the session."
                        : !answerable && s.terminal
                          ? "Answer it in Chat or in the terminal."
                          : "Answer it in the terminal that runs the session.",
                ]
              : [null, null];
    return text ? (
      <span
        className={["say", cls, full ? "full" : ""].filter(Boolean).join(" ")}
        role={cls === "err" ? "alert" : "status"}
      >
        {text}
      </span>
    ) : null;
  };
  const change = (placeholder: string, then: () => unknown, button: ReactNode) => (
    <div className="change">
      <Own value={d.change} placeholder={placeholder} busy={busy} onType={(t) => typeChange(ask, t)} onEnter={then} />
      {button}
    </div>
  );
  let foot: ReactNode = null;
  if (here && perm) {
    // allowed, denied, or denied with what to do instead
    const deny = (text: string | null) => send({ allow: false, text: text || null });
    const instead = () => d.change.trim() && deny(d.change.trim());
    foot = (
      <div className="foot">
        {said(true)}
        {change(
          "Or say what to do instead",
          instead,
          <button
            type="button"
            disabled={busy || !d.change.trim()}
            onClick={instead}
            title="Deny and send this to the agent"
          >
            Deny with this
          </button>,
        )}
        <div className="acts">
          <button type="button" disabled={busy} onClick={() => deny(null)} title="Deny it">
            Deny
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => send({ allow: true })}
            title="Allow once"
          >
            {d.sending ? "Answering…" : "Allow"}
          </button>
        </div>
      </div>
    );
  } else if (here && ask.kind === "plan") {
    const asked = () => d.change.trim() && send({ plan: "change", text: d.change.trim() });
    foot = (
      <div className="foot">
        {said(true)}
        {change(
          says.plan_change.label,
          asked,
          <button
            type="button"
            disabled={busy || !d.change.trim()}
            onClick={asked}
            title={says.plan_change.title || undefined}
          >
            Ask for changes
          </button>,
        )}
        <div className="acts">
          {says.plan_choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.primary ? "primary" : ""}
              disabled={busy}
              onClick={() => send({ plan: c.id })}
              title={c.title || undefined}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  } else if (here && qs.length) {
    foot = (
      <div className="foot">
        {said()}
        <div className="acts">
          {qs.length > 1 ? (
            <span className="count">{`${qs.filter((_, i) => done(i)).length} of ${qs.length} answered`}</span>
          ) : null}
          {qs.length > 1 && done(tab) && n >= 0 ? (
            <button type="button" disabled={busy} onClick={() => show(ask, n)}>
              Next
            </button>
          ) : null}
          <button type="button" className="primary" disabled={!ready || busy} onClick={() => send(choiceOf(d))}>
            {d.sending ? "Answering…" : "Answer"}
          </button>
        </div>
      </div>
    );
  } else if (said()) foot = <div className="foot">{said()}</div>;
  return (
    <>
      <div className="head">
        <span className="pill">
          <i aria-hidden="true" />
          Waiting for you
        </span>
        <span className="what">{askingWhat({ info, home, answerable, snapshot, terminalView, host })}</span>
        <span className="ago">{ago(ask.at)}</span>
        {s.terminal && terminalView ? (
          <span className="end">
            <button
              type="button"
              className="to-term"
              title="Open the terminal"
              onClick={() => host.setChatView("terminal", info.channel)}
            >
              <StrokeIcon d={host.icons.terminal} size={14} />
              <span className="lbl">Open the terminal</span>
            </button>
          </span>
        ) : null}
      </div>
      {/* answered here, several questions: one at a time, as the terminal asks them, a tab each */}
      {here && qs.length > 1 ? (
        <div className="qtabs" role="tablist" aria-label="Questions">
          {qs.map((q, i) => (
            <button
              key={i}
              type="button"
              className="qtab"
              role="tab"
              aria-selected={i === tab}
              onClick={() => show(ask, i)}
            >
              <span className={"n" + (done(i) ? " done" : "")}>
                {done(i) ? <StrokeIcon d={CHECK} size={11} /> : String(i + 1)}
              </span>
              <span>{q.header || `Question ${i + 1}`}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="body" data-keep="asking-note">
        {dialog ? (
          <DialogView
            ask={ask}
            who={ask.harness ? harnessName(home, ask.harness) : "It"}
            onPick={here ? (j) => send({ pick: j }) : null}
            busy={busy}
          />
        ) : perm ? (
          <host.PermissionCall ask={ask} id={`perm-${key}`} />
        ) : here && qs.length > 1 ? (
          question(tab)
        ) : (
          qs.map((_, i) => question(i))
        )}
        {ask.kind === "plan" && ask.plan ? (
          <details id="asking-plan" className="plan" open>
            <summary>The plan</summary>
            <Markdown text={ask.plan} />
          </details>
        ) : null}
      </div>
      {foot}
    </>
  );
}
