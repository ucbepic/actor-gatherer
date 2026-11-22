// The History view's panel at the right: its room kept empty until something is selected, then what can be done with
// it -- the Gatherer's model asked for a summary, a memory, a skill or an AGENTS.md, with what the reader wants of it; the
// history saved as a file -- and the RECENT records the Gatherer made last for the actor (the rest a click away), each
// to read, copy, download, select again, or save where a harness reads it (previewed first). It stays while a record
// it asked for shows, until closed.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../core/api/query";
import type { Home } from "../../core/api/types";
import { clock, compact, plural, span } from "../../core/format";
import { harnessLabel } from "../../core/model/harness";
import { Markdown } from "../../core/ui/Markdown";
import { StrokeIcon } from "../../core/ui/Icon";
import { extractsKey, type Rec } from "./data";
import { SaveTo, saversOf } from "./Save";
import {
  closePanel,
  deleteRec,
  exportRows,
  make,
  planSave,
  select,
  setAsk,
  setSaving,
  toggleAllRecs,
  useHist,
  useHistStore,
} from "./store";
import type { HNode, Outline } from "./tree";

/** Each kind of record: what asks for it (none: one made before, shown, not offered), its name, its file. */
const KINDS: Record<string, [ask: string, name: string, file: string]> = {
  summary: ["Summarize", "Summary", "summary.md"],
  memory: ["Generate memory", "Memory", "memory.md"],
  agents: ["Generate AGENTS.md", "AGENTS.md", "AGENTS.md"],
  skill: ["Generate skill", "Skill", "SKILL.md"],
  claude: ["", "CLAUDE.md", "CLAUDE.md"], // one made before AGENTS.md
};
const RECENT = 3;

/** What the panel draws with of the page: the home (each harness's ways of saving), the actor's directory, the icons,
 * when it is drawn, and the outline's nodes by id (a record selected again). */
export interface SideProps {
  h: Outline;
  home: Home | null;
  cwd: string;
  harness: string | null;
  icons: Record<string, string>;
  now: number;
  byId: ReadonlyMap<string, HNode>;
}

/** A file to save, handed to the browser. */
function saveFile(name: string, text: string, type = "text/markdown") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** The records of `gatherer`, as kept (data.ts's loadExtracts fetches them). */
export const useRecs = (gatherer: string): Rec[] =>
  useQuery({ queryKey: extractsKey(gatherer), queryFn: () => [] as Rec[], enabled: false }, queryClient).data || [];

function Actions({ h, icons }: Pick<SideProps, "h" | "icons">) {
  const st = useHistStore();
  const sel = useHist((s) => s.sel),
    ask = useHist((s) => s.ask),
    busy = useHist((s) => s.busy),
    err = useHist((s) => s.err);
  const rows = [...sel.values()],
    n = rows.length;
  const tokens = rows.reduce((t, [, k]) => t + k, 0),
    actors = new Set(rows.map(([c]) => c)).size;
  return (
    <div className="h-act">
      <div className="row">
        <span className="h-picked">
          {n ? (
            <>
              <b>{plural(n, "message")}</b>
              {` · about ${compact(tokens)} tokens` + (actors > 1 ? ` · ${actors} actors` : "")}
            </>
          ) : (
            "Nothing selected"
          )}
        </span>
        <button type="button" className="h-x" title="Close" aria-label="Close" onClick={() => closePanel(st)}>
          <StrokeIcon d={icons.x} size={16} />
        </button>
      </div>
      <textarea
        id="hist-ask"
        rows={2}
        data-sig="hist-ask"
        aria-label="Instructions"
        placeholder="Instructions (optional)"
        value={ask}
        onChange={(ev) => setAsk(st, ev.currentTarget.value)}
      />
      <div className="kinds">
        {Object.entries(KINDS)
          .filter(([, [label]]) => label)
          .map(([k, [label]]) => (
            <button
              key={k}
              type="button"
              disabled={!n || busy}
              title={`${label} with the Gatherer's model`}
              onClick={() => make(st, h.gatherer, k)}
            >
              {label}
            </button>
          ))}
      </div>
      <div className="row">
        <span className="h-picked">Export</span>
        <button
          type="button"
          disabled={!n}
          title="Save the selected history as a Markdown transcript"
          onClick={() => exportRows(st, h.gatherer, "md", saveFile)}
        >
          .md
        </button>
        <button
          type="button"
          disabled={!n}
          title="Save the selected events as JSON"
          onClick={() => exportRows(st, h.gatherer, "json", saveFile)}
        >
          .json
        </button>
      </div>
      <div className="err" role="alert">
        {err}
      </div>
    </div>
  );
}

/** What the model made, as it reads: a skill's front matter apart, the rest as Markdown; memories one by one. */
function Content({ r }: { r: Rec }) {
  if (r.kind === "memory")
    return (r.memories || []).length ? (
      r.memories!.map((m, i) => (
        <div key={i} className="h-mem">
          <div className="t">
            {m.title}
            <span>{m.type}</span>
          </div>
          <div className="d">{m.description}</div>
          <Markdown text={m.body} />
        </div>
      ))
    ) : (
      <div className="h-note">The model found nothing worth remembering.</div>
    );
  const m = r.kind === "skill" && /^---\n([\s\S]*?)\n---\n?/.exec(r.output);
  return m ? (
    <>
      <pre className="front">{m[1]}</pre>
      <Markdown text={r.output.slice(m[0].length)} />
    </>
  ) : (
    <Markdown text={r.output} />
  );
}

/** A record as one file to copy or download: memories as their MEMORY.md lines, then each file. */
const recText = (r: Rec) =>
  r.kind !== "memory"
    ? r.output
    : (r.memories || []).length
      ? [
          "# MEMORY.md",
          ...r.memories!.map((m) => `- [${m.title}](${m.name}.md) — ${m.description}`),
          ...r.memories!.flatMap((m) => [
            "",
            `# ${m.name}.md`,
            "---",
            `name: ${JSON.stringify(m.name)}`,
            `description: ${JSON.stringify(m.description)}`,
            "metadata:",
            `  type: ${m.type}`,
            "---",
            "",
            m.body,
          ]),
        ].join("\n") + "\n"
      : "";

function Copy({ text }: { text: string }) {
  const [said, setSaid] = useState("Copy");
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setSaid("Copied");
        } catch {
          setSaid("Not copied");
        }
        setTimeout(() => setSaid("Copy"), 1500);
      }}
    >
      {said}
    </button>
  );
}

const Status = ({ cls, children }: { cls: string; children: ReactNode }) => (
  <span className={"status " + cls}>
    <i aria-hidden="true" />
    {children}
  </span>
);

function Record({ r, side }: { r: Rec; side: SideProps }) {
  const st = useHistStore();
  const box = useRef<HTMLDetailsElement>(null);
  const sv = useHist((s) => (s.saving && s.saving.id === r.id ? s.saving : null));
  const opened = useHist((s) => s.recOpen) === r.id;
  // opened when it is drawn, if it is the one asked for: as the reader leaves it after
  useLayoutEffect(() => {
    if (opened && box.current) box.current.open = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const running = r.status === "running",
    done = r.status === "done";
  const [, name, file] = KINDS[r.kind] || ["", r.kind, "extract.md"];
  const savers = saversOf(side.home, r);
  const savable = done && savers.length > 0 && !(r.kind === "memory" && !(r.memories || []).length);
  const what = [
    plural(r.messages, "message"),
    plural(r.turns, "turn"),
    r.channels.length > 1 ? `${r.channels.length} actors` : null,
    r.model && !running ? r.model : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const again = () => {
    const sel = new Map<number, [string, number]>();
    for (const [a, b] of r.rows)
      for (let x = a; x <= b; x++) {
        const e = side.byId.get(`m:${x}`)?.event;
        sel.set(x, e ? [e.channel, e.tokens] : [r.channels[0], 0]);
      }
    setAsk(st, r.ask || "");
    select(st, sel);
  };
  return (
    <details ref={box} className="h-rec" id={`rec-${r.id}`}>
      <summary>
        <div className="top">
          <span className={`chip-k ${r.kind}`}>{name}</span>
          {running ? (
            <Status cls="building">Working</Status>
          ) : r.status === "failed" ? (
            <Status cls="failed">Failed</Status>
          ) : null}
          <span className="when">{clock(r.created, true)}</span>
        </div>
        <div className="what">{what}</div>
        {r.ask ? <div className="ask">{`“${r.ask}”`}</div> : null}
      </summary>
      <div className="body">
        {running ? (
          <div className="working">
            <span className="spin" aria-hidden="true" />
            {`Asking ${r.model || "the Gatherer's model"}…`}
            <span className="ticking" data-since={r.created}>
              {span(r.created, side.now)}
            </span>
          </div>
        ) : r.status === "failed" ? (
          <div className="fail">{r.error || "The call failed."}</div>
        ) : (
          <Content r={r} />
        )}
      </div>
      <div className="acts">
        {savable ? (
          <button
            type="button"
            className={sv ? undefined : "primary"}
            title={`Save where ${savers.map((x) => harnessLabel(side.home, x)).join(" or ")} reads it. You'll preview each file first.`}
            onClick={() => {
              if (sv) return setSaving(st, null);
              setSaving(st, {
                id: r.id,
                harness: side.harness && savers.includes(side.harness) ? side.harness : savers[0],
                target: "dir",
                dir: (r.dirs || [])[0] || side.cwd || "",
                plan: null,
                err: "",
                done: null,
              });
              setTimeout(() => planSave(st, r));
            }}
          >
            Save to…
          </button>
        ) : null}
        {done ? <Copy text={recText(r)} /> : null}
        {done ? (
          <button type="button" title={`Download as ${file}`} onClick={() => saveFile(file, recText(r))}>
            Download
          </button>
        ) : null}
        <button type="button" title="Reselect the history it was made from" onClick={again}>
          Select again
        </button>
        {r.status === "failed" ? (
          <button type="button" onClick={() => make(st, r.gatherer, r.kind, r)}>
            Try again
          </button>
        ) : null}
        <button type="button" title={running ? "Stop and remove" : "Remove"} onClick={() => deleteRec(r)}>
          {running ? "Stop" : "Delete"}
        </button>
      </div>
      {sv ? <SaveTo r={r} sv={sv} home={side.home} cwd={side.cwd} /> : null}
      {(r.saved || []).map((x, i) => (
        <div key={i} className="saved">
          <b>Saved </b>
          {`${clock(x.at, true)} · ${x.paths.join(", ")}`}
        </div>
      ))}
    </details>
  );
}

export function Side(props: SideProps) {
  const st = useHistStore();
  const { h } = props;
  const panel = useHist((s) => s.panel),
    all = useHist((s) => s.allRecs),
    recOpen = useHist((s) => s.recOpen);
  const box = useRef<HTMLDivElement>(null);
  const list = useRecs(h.gatherer).filter((r) => (r.channels || []).includes(h.channel)); // this actor's
  // a record just asked for: at the top, in sight
  useLayoutEffect(() => {
    if (recOpen && box.current) box.current.scrollTop = 0;
  }, [recOpen]);
  if (!panel) return <div className="h-side closed" aria-hidden="true" />;
  const shown = all ? list : list.slice(0, RECENT);
  return (
    <div ref={box} className="h-side open" data-keep="hist-side" role="complementary" aria-label="Selected history">
      <Actions h={h} icons={props.icons} />
      {list.length ? <div className="h-side-h">Recent artifacts</div> : null}
      {shown.map((r) => (
        <Record key={r.id} r={r} side={props} />
      ))}
      {list.length > RECENT ? (
        <button type="button" className="h-older" onClick={() => toggleAllRecs(st)}>
          {all ? "Show fewer" : `Show ${list.length - RECENT} older`}
        </button>
      ) : null}
    </div>
  );
}
