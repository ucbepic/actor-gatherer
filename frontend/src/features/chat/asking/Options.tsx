// The parts of what the agent asks (Asking.tsx): a question with its options -- one of a single choice a radio of Radix's
// RadioGroup, the arrow keys moving between them -- and the box for words of the reader's own; a dialog its terminal's
// screen shows, as it shows it.
import * as RadioGroup from "@radix-ui/react-radio-group";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Ask, AskOption } from "./ask";
import { pick, type, type Draft } from "./answers";

/** A box for words of the reader's own (an answer, a change, what to do instead): Enter does `onEnter`. */
export function Own({
  value,
  placeholder,
  busy,
  onType,
  onEnter,
}: {
  value: string;
  placeholder: string;
  busy: boolean;
  onType: (text: string) => void;
  onEnter: () => unknown;
}) {
  return (
    <input
      className="own"
      type="text"
      placeholder={placeholder}
      value={value}
      disabled={busy}
      aria-label={placeholder}
      onChange={(ev) => onType(ev.currentTarget.value)}
      onKeyDown={(ev: KeyboardEvent) => {
        if (ev.key === "Enter" && !ev.nativeEvent.isComposing) {
          ev.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

/** An option's words: its label, and what it means where that says more. */
const optionBody = (o: AskOption) => (
  <>
    <span className="lbl">{o.label || ""}</span>
    {o.description && o.description !== o.label ? <span className="odesc">{o.description}</span> : null}
  </>
);

interface QuestionProps {
  ask: Ask;
  i: number;
  d: Draft;
  here: boolean;
  busy: boolean;
  /** the question's own box's placeholder; Enter there (the next question, or the answer sent) */
  own: string;
  onEnter: () => unknown;
}

/** A question: its options to pick, and a box for an answer of the reader's own -- or, not answered here, listed. One
 * option of a single choice is a radio (Radix's RadioGroup: the arrow keys move between them); picked by a click, the
 * next question not answered yet is shown, as the terminal's dialog does -- not as the arrow keys go. */
export function Question({ ask, i, d, here, busy, own, onEnter }: QuestionProps) {
  const qs = ask.questions || [];
  const q = qs[i];
  const arrows = useRef(false);
  const multi = !!q.multiSelect;
  const opts = q.options || [];
  const picked = d.answers[i]?.options ?? [];
  const cls = "opts" + (multi ? " multi" : "");
  const box = <span className="box" aria-hidden="true" />;
  let list: ReactNode;
  if (!here)
    list = (
      <ol className={cls} aria-label={q.question || undefined}>
        {opts.map((o, j) => (
          <li key={j} className="opt ro">
            <span className="box" aria-hidden="true">
              {String(j + 1)}
            </span>
            {optionBody(o)}
          </li>
        ))}
      </ol>
    );
  else if (multi)
    list = (
      <div className={cls} role="group" aria-label={q.question || undefined}>
        {opts.map((o, j) => (
          <button
            key={j}
            type="button"
            className="opt"
            role="checkbox"
            aria-checked={picked.includes(j)}
            disabled={busy}
            onClick={() => pick(ask, i, j, true)}
          >
            {box}
            {optionBody(o)}
          </button>
        ))}
      </div>
    );
  else
    list = (
      <RadioGroup.Root
        className={cls}
        aria-label={q.question || undefined}
        value={picked.length ? String(picked[0]) : ""}
        onKeyDownCapture={(ev) => {
          arrows.current = ev.key.startsWith("Arrow");
        }}
        onKeyUpCapture={() => {
          arrows.current = false;
        }}
      >
        {opts.map((o, j) => (
          <RadioGroup.Item
            key={j}
            value={String(j)}
            className="opt"
            disabled={busy}
            onClick={() => pick(ask, i, j, false, !arrows.current)}
          >
            {box}
            {optionBody(o)}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    );
  return (
    <div className="q" data-q={String(i)}>
      {q.header && (!here || qs.length < 2) ? <div className="eyebrow">{q.header}</div> : null}
      <div className="qline">
        <span className="text">{q.question || ""}</span>
        {multi ? <span className="hint">Pick any</span> : null}
      </div>
      {list}
      {here && !multi ? (
        <Own
          value={d.answers[i]?.text ?? ""}
          placeholder={own}
          busy={busy}
          onType={(t) => type(ask, i, t)}
          onEnter={onEnter}
        />
      ) : null}
    </div>
  );
}

/** A dialog the actor's terminal shows that no hook reported (data.py's `shown_ask`), as its screen has it: its head,
 * what it shows (a menu's, as paragraphs; a permission's, as its terminal lays it out), its question and its options.
 * Where it is answered here (`onPick`): each option a button that picks it in the terminal, the one its cursor is on said
 * so, one its harness ends after to update itself said so too; else its options as it lists them. */
export function DialogView({
  ask,
  who,
  onPick,
  busy,
}: {
  ask: Ask;
  who: string;
  onPick: ((j: number) => unknown) | null;
  busy: boolean;
}) {
  const opts = ask.options || [],
    restarts = ask.restarts || [],
    lines = ask.lines || [];
  return (
    <div className={"perm" + (ask.menu ? " menu" : "")}>
      {ask.title && ask.title !== ask.said ? (
        <div className="perm-call">
          <b>{ask.title}</b>
        </div>
      ) : null}
      {lines.length ? (
        ask.menu ? (
          lines.map((x, i) => (
            <p key={i} className="menu-line">
              {x}
            </p>
          ))
        ) : (
          <pre className="perm-input">{lines.join("\n")}</pre>
        )
      ) : null}
      {ask.said ? (
        <div className="qline">
          <span className="text">{ask.said}</span>
        </div>
      ) : null}
      {onPick ? (
        <div className="opts" role="group" aria-label={ask.said || ask.title || "Options"}>
          {opts.map((o, j) => (
            <button
              key={j}
              type="button"
              className="opt pick"
              disabled={busy}
              onClick={() => onPick(j)}
              title={`Pick “${o}” in its terminal`}
            >
              <span className="box" aria-hidden="true">
                {String(j + 1)}
              </span>
              <span className="lbl">{o}</span>
              {restarts.includes(j) ? (
                <span className="odesc">{`${who} closes to update, then starts again with your message`}</span>
              ) : j === ask.cursor ? (
                <span className="odesc">Selected in its terminal</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <ol className="shown-opts">
          {opts.map((o, j) => (
            <li key={j}>{o}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
