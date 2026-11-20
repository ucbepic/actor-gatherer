// Saving a record of the Gatherer's model where a harness reads it (harness_kit's `saves`: those that have a place for
// its kind): which harness, where to (this directory's sessions, or every session), then what each file would get --
// written only once the reader has seen it (history.py's plan and save).
import type { Home } from "../../core/api/types";
import { plural } from "../../core/format";
import { harnessLabel, harnessOf } from "../../core/model/harness";
import type { Rec } from "./data";
import { planSave, setSaving, useHist, writeSave, type Saving } from "./store";

/** "claude": one made as a CLAUDE.md, before */
const saveKind = (r: Rec) => (r.kind === "claude" ? "agents" : r.kind);
type Saves = Record<string, { user?: boolean; where?: string }>;
/** The harnesses with a place for a record's kind (harness_kit's `saves`). */
export const saversOf = (home: Home | null, r: Rec) =>
  Object.entries(home?.harness_info ?? {})
    .filter(([, h]) => (h as { saves?: Saves }).saves?.[saveKind(r)])
    .map(([n]) => n);

function Switch({
  label,
  pairs,
  current,
  pick,
}: {
  label: string;
  pairs: [string, string][];
  current: string;
  pick(id: string): void;
}) {
  return (
    <div className="views" role="group" aria-label={label}>
      {pairs.map(([id, name]) => (
        <button key={id} type="button" aria-pressed={id === current} title="" onClick={() => pick(id)}>
          {name}
        </button>
      ))}
    </div>
  );
}

/** Saving a record where a harness reads it: which harness, where to (this directory's sessions, or every session), then
 * what each file would get -- written only once the reader has seen it (history.py's plan and save). */
export function SaveTo({ r, sv, home, cwd }: { r: Rec; sv: Saving; home: Home | null; cwd: string }) {
  const homes = useHist((s) => s.homes);
  const hs = saversOf(home, r);
  const harness = hs.includes(sv.harness) ? sv.harness : hs[0];
  const says = ((harnessOf(home, harness) as { saves?: Saves } | null)?.saves || {})[saveKind(r)] || {};
  const dirs = [...new Set([...(r.dirs || []), cwd].filter(Boolean))];
  const targets: [string, string][] = [
    ["dir", "A directory"],
    ...(says.user === true ? [["user", "All my projects"] as [string, string]] : []),
  ];
  const where = says.where || "";
  const p = sv.plan;
  const change = (patch: Partial<Saving>, plan = true) => {
    setSaving({ ...sv, harness, ...patch, plan: null, err: "" });
    if (plan) void planSave(r);
  };
  return (
    <div className="h-save">
      {hs.length > 1 ? (
        <div className="row">
          <Switch
            label="For"
            pairs={hs.map((x) => [x, harnessLabel(home, x)])}
            current={harness}
            pick={(x) => change({ harness: x })}
          />
        </div>
      ) : null}
      <div className="row">
        <Switch
          label="Save to"
          pairs={targets}
          current={sv.target}
          pick={(t) => change({ target: t as Saving["target"] })}
        />
        <span className="where">
          {sv.target !== "user"
            ? where
            : `${homes[harness] ? `${homes[harness]}: ` : ""}${where.replace(" there", "")}`}
        </span>
      </div>
      {sv.target === "dir" ? (
        <div className="row">
          <input
            type="text"
            value={sv.dir}
            list={`dirs-${r.id}`}
            spellCheck="false"
            aria-label="Directory"
            onChange={(ev) => change({ dir: ev.currentTarget.value }, false)}
            onKeyDown={(ev) => {
              if (ev.key !== "Enter") return;
              ev.preventDefault();
              void planSave(r);
            }}
          />
          <datalist id={`dirs-${r.id}`}>
            {dirs.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <button type="button" onClick={() => planSave(r)}>
            Preview
          </button>
        </div>
      ) : null}
      {p ? (
        <>
          <div className="where">{`For ${p.where}. ${plural(p.files.length, "file")} below. Nothing is written until you press Write.`}</div>
          {p.note ? <div className="warnline">{p.note}</div> : null}
          {p.files.map((f, i) => (
            <details key={i} className="file" id={`save-${r.id}-${i}`}>
              <summary>
                <span className={`a ${f.action}`}>{f.action === "append" ? "add to end" : f.action}</span>
                <span className="p">{f.path}</span>
              </summary>
              <pre>{f.text}</pre>
            </details>
          ))}
        </>
      ) : null}
      {sv.err ? (
        <div className="err" role="alert">
          {sv.err}
        </div>
      ) : null}
      {sv.done ? <div className="ok">{`Saved: ${sv.done.join(", ")}`}</div> : null}
      <div className="row">
        {p && !sv.done ? (
          <button type="button" className="primary" onClick={() => writeSave(r)}>
            {p.files.some((f) => f.action === "replace")
              ? "Replace and write"
              : `Write ${plural(p.files.length, "file")}`}
          </button>
        ) : null}
        <button type="button" onClick={() => setSaving(null)}>
          {sv.done ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
