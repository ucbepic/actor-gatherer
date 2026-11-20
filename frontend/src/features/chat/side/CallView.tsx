// A call opened: its command as a terminal would show it (shellHtml); a script, or a file's new text, coloured in its
// language; a change as its lines out and in; any other call its inputs one by one, each whole. Under it what it
// printed (outputHtml), its exit code and run time beside. Copy takes the call as written (the document's codeClick,
// by data-copy). And a call's line, as the commands list it and a turn's latest call shows it.
import { createContext, useContext } from "react";
import { firstLine } from "../../../core/format";
import { guessWeb, hlLines, hlPart, langOfPath, outputHtml, shellHtml, tildePath } from "../../../core/ui/highlight";
import type { CallRun } from "../types";

/** Where the actor's paths are read from: its session's directory (a path in it shown from there), and the home folder
 * (one under it shown from ~). */
export const Paths = createContext<{ cwd: string; home: string }>({ cwd: "", home: "" });

interface CallViewOf {
  shape?: string;
  command?: unknown;
  description?: unknown;
  cwd?: unknown;
  background?: unknown;
  code?: unknown;
  lang?: string;
  patch?: unknown;
  path?: unknown;
  content?: unknown;
  edits?: { old?: unknown; new?: unknown }[];
}
interface Call {
  input?: unknown;
  view?: CallViewOf;
}

export const str = (v: unknown): string =>
  typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);

/** A shell call's command, as its harness's rules read it (its view's); null for any other call. */
export const shellCommand = (call: unknown): string | null => {
  const v = (call as Call | null)?.view;
  return v && v.shape === "shell" ? str(v.command) : null;
};

const html = (__html: string) => ({ __html });

/** A call's line (files.py's `_label`): a shell command it is (no description given: codex's) in the terminal's type,
 * coloured. */
export function CallLabel({ c, n }: { c: CallRun; n: number }) {
  const text = firstLine(c.text, n);
  if (shellCommand(c.call) === null || (c.call as Call).view!.description) return text;
  return (
    <span className="cmdline">
      <span className="sh-t" dangerouslySetInnerHTML={html(hlLines(text, "shell").join("\n"))} />
    </span>
  );
}

function Code({ cls, src, copy }: { cls: string; src: string; copy?: string }) {
  return (
    <div className={"cv-in " + cls}>
      <div className="cv-src" dangerouslySetInnerHTML={html(src)} />
      {copy === undefined ? null : (
        <button type="button" className="code-copy" title="Copy as written" data-copy={copy}>
          Copy
        </button>
      )}
    </div>
  );
}

const lined = (hs: string[], cls: string, mark: string) =>
  hs
    .map((h) => `<div class="cl ${cls}"><span class="mk">${mark}</span><span class="tx">${h || "&#8203;"}</span></div>`)
    .join("");

export function CallView({ call, ran = {} }: { call: unknown; ran?: Partial<CallRun> }) {
  const { cwd: dir, home } = useContext(Paths);
  const c = call as Call | null;
  if (!c) return <div className={"cv" + (ran.error ? " err" : "")} />;
  const input = c.input && typeof c.input === "object" ? (c.input as Record<string, unknown>) : {},
    v = c.view || {};
  const cwd = dir.replace(/\/$/, ""); // a path from the session's directory, else from ~
  const path = (p: unknown) => (
    <div className="cv-path" title={str(p)}>
      {cwd && str(p).startsWith(cwd + "/") ? str(p).slice(cwd.length + 1) : tildePath(str(p), home)}
    </div>
  );
  const cmd = shellCommand(c);
  let body;
  if (cmd !== null) {
    const tags = [v.cwd ? `in ${tildePath(str(v.cwd), home)}` : null, v.background ? "in the background" : null];
    body = (
      <>
        <Code cls="sh" src={shellHtml(cmd, home)} copy={cmd} />
        {tags.some(Boolean) ? (
          <div className="cv-tags">{tags.map((t, i) => (t ? <span key={i}>{t}</span> : null))}</div>
        ) : null}
      </>
    );
  } else if (v.shape === "script") {
    // a script (codex's code mode), in its language
    body = <Code cls="src" src={hlLines(str(v.code), v.lang || "js").join("\n")} copy={str(v.code)} />;
  } else if (v.shape === "patch") {
    const p = str(v.patch);
    body = <Code cls="src" src={hlLines(p, "diff").join("\n")} copy={p} />;
  } else if (v.shape === "edit" || v.shape === "write") {
    const p = v.path,
      lang = v.lang || langOfPath(str(p));
    const edits = v.shape === "edit" ? v.edits || [] : [];
    // a change's two sides read from inside a comment or a string they begin in; a whole file from its top
    const whole = str(v.content);
    const src = edits.length
      ? edits
          .map((e) => {
            const [was, now] = hlPart(lang, str(e.old), str(e.new));
            return lined(was, "del", "−") + lined(now, "add", "+");
          })
          .join('<div class="cv-sep"></div>')
      : lined(hlLines(whole, lang === "html" ? guessWeb(whole) : lang), "", "");
    body = (
      <>
        {path(p)}
        <Code cls="diff" src={src} />
      </>
    );
  } else {
    const args: [string, unknown][] =
      typeof c.input === "string" || !c.input ? [["", str(c.input)]] : Object.entries(input);
    body = (
      <div className="cv-args">
        {args.map(([k, a], i) => [
          <span key={`k${i}`} className="k">
            {k}
          </span>,
          typeof a === "string" ? (
            <span key={`v${i}`} className="v">
              {a}
            </span>
          ) : (
            <span
              key={`v${i}`}
              className="v json"
              dangerouslySetInnerHTML={html(hlLines(JSON.stringify(a, null, 1), "json").join("\n"))}
            />
          ),
        ])}
      </div>
    );
  }
  // what it printed, its harness's lines about the run taken off (files.py's `output`), and what they said: its exit
  // code, how long it ran
  const printed = ran.output !== undefined && ran.output !== null && (ran.output !== "" || ran.exit != null);
  const text = printed ? str(ran.output).replace(/\n+$/, "") : "";
  return (
    <div className={"cv" + (ran.error ? " err" : "")}>
      {body}
      {printed && (ran.exit != null || ran.took) ? (
        <div className="cv-tags">
          {ran.exit != null ? (
            <span className={String(ran.exit) === "0" ? "ok" : "bad"}>{`exit ${ran.exit}`}</span>
          ) : null}
          {ran.took ? <span>{ran.took}</span> : null}
        </div>
      ) : null}
      {printed ? (
        <pre
          className="out"
          dangerouslySetInnerHTML={html(text ? outputHtml(text, cmd) : '<span class="a-dim">no output</span>')}
        />
      ) : null}
    </div>
  );
}
