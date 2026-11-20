// A file, call by call: each call that touched it in the turn, in order, with what it did to the file -- the lines it
// read or found, or its change, at their line numbers -- folded to its header until clicked, its exact call behind
// "command". The last call opened when it first shows (the file opened, or a call new to it), then left as the reader
// leaves it.
import { useState, type ComponentProps, type ReactNode } from "react";
import { firstLine, plural } from "../../../core/format";
import { ansiHtml, guessWeb, hlLines, hlPart, langOfPath } from "../../../core/ui/highlight";
import { CallView, str } from "./CallView";
import { Changed, FILE_KINDS, GitMark, KindMark, Stroke } from "./marks";
import type { TurnFile } from "../types";

/** A file's lines as a call saw them (files.py's blocks). */
export interface Block {
  t: string;
  lines?: string[];
  start?: number | null;
  cut?: number;
  note?: string;
  rows?: [number, string][];
  at?: number | null;
  above?: [number, string][];
  below?: [number, string][];
  old?: string[];
  new?: string[];
  created?: boolean;
  row_id?: number;
  id?: string;
  text?: string;
}

/** A call of the file (files.py's sources). */
export interface Source {
  via: string;
  kinds: string[];
  error?: boolean;
  call?: unknown;
  blocks: Block[];
  changed?: [number, number] | null;
  git?: boolean;
  checked?: boolean | null;
}

/** What the disk said of a call, where ag's hook server checked it as it ran (files.py's `checked`). */
const CHECKED: Record<string, [string, string]> = {
  true: ["checked", "Matched the file on disk after the call"],
  false: ["not as on disk", "Didn't match the file on disk after the call"],
};

/** A <details> opened or not as it is first drawn, then as the reader leaves it. */
export function Fold({ initial = false, ...props }: { initial?: boolean } & ComponentProps<"details">) {
  const [open] = useState(initial);
  return <details open={open} {...props} />;
}

export function FileView({
  f,
  path,
  id,
  gatherer,
  showGit,
  close,
  icons,
}: {
  f: TurnFile;
  path: string;
  id: string;
  gatherer: string;
  showGit: boolean;
  close: () => void;
  icons: Record<string, string>;
}) {
  const shown = (f.sources as Source[]).map((s, i) => [s, i] as const).filter(([s]) => showGit || !s.git);
  const last = `${id}-s${shown.length ? shown[shown.length - 1][1] : -1}`;
  const lang = langOfPath(f.path);
  return (
    <div className="fv">
      <div className="fv-h">
        <div className="fv-path">{path}</div>
        <button type="button" className="fv-close" title="Close the file" aria-label="Close the file" onClick={close}>
          <Stroke d={icons.x} size={16} />
        </button>
      </div>
      {shown.map(([s, i], n) => {
        const kinds = s.kinds.map((k) =>
          k === "write" ? (s.blocks.some((b) => b.created) ? "created" : "written") : (FILE_KINDS[k] || [k])[0],
        );
        const checked = s.checked === true || s.checked === false ? CHECKED[String(s.checked)] : null;
        return (
          // keyed by the call and the file's last: a call new to the file opened (as it first shows), not one before it
          <Fold
            key={`${id}-s${i}`}
            initial={`${id}-s${i}` === last}
            className={"fv-call" + (s.error ? " err" : "")}
            id={`${id}-s${i}`}
          >
            <summary>
              <span className="tw">▸</span>
              <span className="k">{`${n + 1}`}</span>
              <span className="kinds">
                {s.git ? <GitMark kinds={s.kinds} /> : null}
                {s.kinds.map((k, j) => (
                  <KindMark key={j} kind={k} size={12} />
                ))}
              </span>
              <span className="via">{firstLine(s.via, 160)}</span>
              <Changed ch={s.changed} />
              <span className="what">
                {(s.git ? "by git: " : "") + kinds.join(", ") + (s.error ? " · failed" : "")}
                {checked ? (
                  <span className={"chk" + (s.checked ? "" : " off")} title={checked[1]}>
                    {" · " + checked[0]}
                  </span>
                ) : null}
              </span>
            </summary>
            {s.call ? (
              <details className="fv-cmd" id={`${id}-s${i}-c`}>
                <summary>command</summary>
                <CallView call={s.call} />
              </details>
            ) : null}
            <div className="code">
              {s.blocks.map((b, j) => (
                <FileBlock key={j} b={b} lang={lang} gatherer={gatherer} />
              ))}
              {s.error && !s.blocks.length ? <div className="fv-note">The call failed.</div> : null}
            </div>
          </Fold>
        );
      })}
    </div>
  );
}

/** One line of a file as a call saw it: its number (null: not known), a mark (+ − ›), its text -- `html`, coloured, if
 * given. */
function Line({
  n,
  cls,
  mark,
  text,
  html,
}: {
  n?: number | null;
  cls: string;
  mark: string;
  text: string;
  html?: string;
}) {
  return (
    <div className={"ln " + cls}>
      <span className="no">{n === null || n === undefined ? "" : String(n)}</span>
      <span className="mk">{mark}</span>
      {html === undefined ? (
        <span className="tx">{text}</span>
      ) : (
        <span className="tx" dangerouslySetInnerHTML={{ __html: html || "&#8203;" }} />
      )}
    </div>
  );
}

const Gap = ({ text }: { text: string }) => <div className="gap">{text}</div>;

/** A block of the file's lines (`lang` the file's language), each run of them coloured together -- from inside a
 * comment or a string it begins in, unless it starts at the file's top (hlPart); what a command printed (an "output"
 * block) as it printed it. */
function FileBlock({ b, lang, gatherer }: { b: Block; lang: string | null; gatherer: string }) {
  const hl = (ls: string[], top = false) => {
    const t = ls.join("\n");
    return top ? hlLines(t, lang === "html" ? guessWeb(t) : lang) : hlPart(lang, t)[0];
  };
  const cut = b.cut ? <Gap text={`+${plural(b.cut, "more line")} not shown`} /> : null;
  const lines = b.lines || [];
  if (b.t === "lines") {
    const h = hl(lines, b.start === 1);
    return (
      <>
        {b.start === null ? <Gap text="position in the file unknown" /> : null}
        {lines.map((t, i) => (
          <Line
            key={i}
            n={b.start === null || b.start === undefined ? null : b.start + i}
            cls="read"
            mark=""
            text={t}
            html={h[i]}
          />
        ))}
        {cut}
      </>
    );
  }
  if (b.t === "output") {
    // the file's lines are somewhere in it: which, not known
    const h = ansiHtml(lines.join("\n")).split("\n");
    return (
      <>
        <Gap text={str(b.note)} />
        {lines.map((t, i) => (
          <Line key={i} n={null} cls="read" mark="" text={t} html={h[i] ?? ""} />
        ))}
        {cut}
      </>
    );
  }
  if (b.t === "hits") {
    const out: ReactNode[] = [];
    let prev: number | null = null,
      run: [number, string][] = [];
    const flush = () => {
      const h = hl(run.map((r) => r[1]));
      run.forEach(([n, t], i) => out.push(<Line key={out.length} n={n} cls="hit" mark="›" text={t} html={h[i]} />));
      run = [];
    };
    for (const r of b.rows || []) {
      if (prev !== null && r[0] > prev + 1) {
        flush();
        out.push(<Gap key={out.length} text="⋯" />);
      }
      run.push(r);
      prev = r[0];
    }
    flush();
    return (
      <>
        {out}
        {cut}
      </>
    );
  }
  if (b.t === "diff") {
    const above = b.above || [],
      below = b.below || [],
      old = b.old || [],
      now = b.new || [],
      ctx = (rows: [number, string][]) => rows.map((r) => r[1]);
    // the lines before and after, coloured once with the old lines between them and once with the new, both from
    // inside what the lines above begin in
    const [was, is] = hlPart(
      lang,
      [...ctx(above), ...old, ...ctx(below)].join("\n"),
      [...ctx(above), ...now, ...ctx(below)].join("\n"),
    );
    const at = (i: number) => (b.at === null || b.at === undefined ? null : b.at + i);
    return (
      <>
        {b.at === null ? <Gap text="position in the file unknown" /> : null}
        {above.map(([n, t], i) => (
          <Line key={`a${i}`} n={n} cls="ctx" mark="" text={t} html={was[i]} />
        ))}
        {old.map((t, i) => (
          <Line key={`o${i}`} n={at(i)} cls="del" mark="−" text={t} html={was[above.length + i]} />
        ))}
        {now.map((t, i) => (
          <Line key={`n${i}`} n={at(i)} cls="add" mark="+" text={t} html={is[above.length + i]} />
        ))}
        {below.map(([n, t], i) => (
          <Line key={`b${i}`} n={n} cls="ctx" mark="" text={t} html={is[above.length + now.length + i]} />
        ))}
        <div className="sep" />
      </>
    );
  }
  if (b.t === "write" || b.t === "append") {
    const h = hl(lines, true);
    return (
      <>
        {b.t === "append" ? <Gap text="added at the end of the file" /> : null}
        {lines.map((t, i) => (
          <Line key={i} n={b.t === "write" ? i + 1 : null} cls="add" mark="+" text={t} html={h[i]} />
        ))}
        {cut}
      </>
    );
  }
  if (b.t === "image") {
    const src = `/api/image?gatherer=${encodeURIComponent(gatherer)}&row_id=${b.row_id}&id=${encodeURIComponent(str(b.id))}`;
    return (
      <a className="fv-img" target="_blank" rel="noopener" href={src}>
        <img alt="Image the agent viewed" loading="lazy" src={src} />
      </a>
    );
  }
  if (b.t === "note") return <div className="fv-note">{b.text}</div>;
  return null;
}
