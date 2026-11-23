// The files and commands of the turn shown, at the left of the Chat view (files.py's `files`): its files as a tree, the
// kinds of file switched in its legend; every call it made, in order, with how it went and the files it touched; what
// runs in the background. Folded to a thin bar of what they hold until opened -- by a click on the bar, or on a message's
// button for them -- and folded again by the button in their heading or that button of the turn they show.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ago, firstLine, full, plural } from "../../../core/format";
import type { HarnessInfo } from "../../../core/api/types";
import { CallLabel, CallView } from "./CallView";
import { addChanged, Changed, FILE_KINDS, GitMark, KindMark, Stroke, TASK_KINDS } from "./marks";
import { useSide, type SideState } from "./store";
import { Tree, under } from "./Tree";
import type { Command, FilesData, TurnFile } from "../types";

/** A task the harness runs in the background (data.py's `background`). */
export interface Task {
  id: string;
  kind: string;
  label?: string | null;
  started?: number | null;
  active?: number | null;
  event?: string | null;
  event_at?: number | null;
  output?: string | null;
}

/** A file only git changed. */
export const gitOnly = (f: TurnFile) => !f.kinds.length && !!(f.git || []).length;

/** The files the tree shows, and why the others are not: the kinds switched off, git's, in temporary folders. */
export function shownFiles(all: TurnFile[], hiddenKinds: ReadonlySet<string>, showTmp: boolean, showGit: boolean) {
  const untmp = all.filter((f) => showTmp || !f.temporary);
  const kept = untmp.filter((f) => showGit || !gitOnly(f));
  const files = kept.filter((f) => !f.kinds.length || f.kinds.some((k) => !hiddenKinds.has(k)));
  return {
    files,
    kindHidden: kept.length - files.length,
    gitHidden: untmp.length - kept.length,
    tmpFiles: all.filter((f) => f.temporary).length,
    gitFiles: untmp.filter((f) => (f.git || []).length).length,
  };
}

/** How the turn's commands went: passed, failed, running (only while the actor runs). */
export function cmdCounts(commands: Command[], running: boolean) {
  const err = commands.filter((c) => c.error).length,
    run = commands.filter((c) => !c.error && c.running && running).length;
  return { ok: commands.length - err - run, err, run };
}

export interface SideProps {
  /** the actor's key, and the turn's data */
  actor: string;
  d: FilesData;
  cwd: string;
  home: string;
  running: boolean;
  /** no turn stored yet: the one opening is the one shown */
  opening: boolean;
  sel: TurnFile | null;
  folded: ReadonlySet<string>;
  /** how the panel is shown (side/store.ts), as the frame read it */
  side: Pick<SideState, "hiddenKinds" | "showTmp" | "showGit" | "bgOpen">;
  background: Task[];
  harnesses: Record<string, HarnessInfo>;
  icons: Record<string, string>;
  pick: (path: string | null) => void;
  fold: (path: string) => void;
  foldSide: (fold: boolean) => void;
}

/** Once each time a turn is shown (the latest or one picked): its commands at their end. */
let cmdsShown: string | null = null;
/** The view opened afresh: each turn's commands put at their end again as it shows. */
export const commandsAfresh = () => {
  cmdsShown = null;
};

export function Side(p: SideProps) {
  const { hiddenKinds, showTmp, showGit, bgOpen } = p.side;
  const { switchKind, setTmp, setGit, openBackground } = useSide.getState();
  const { d, cwd, home, icons } = p;
  const { files, kindHidden, gitHidden, tmpFiles, gitFiles } = shownFiles(d.files, hiddenKinds, showTmp, showGit);
  const rel = (path: string) =>
    cwd && path.startsWith(cwd + "/")
      ? path.slice(cwd.length + 1)
      : under(path, home)
        ? "~" + path.slice(home.length)
        : path;
  const counts = cmdCounts(d.commands, p.running);
  // every call of the turn, in the order made: what it did, its outcome, and the files it touched (a click opens one)
  // -- those only git changed as it ran when shown
  const cmdFiles = (c: Command) => (c.files || []).filter((f) => showGit || (c.did || {})[f] || !(c.git || {})[f]);
  const cmds = useRef<HTMLDivElement>(null);
  const shown = `${p.actor}:${d.turn}`;
  useLayoutEffect(() => {
    if (cmdsShown === shown || !cmds.current) return;
    const n = cmds.current;
    requestAnimationFrame(() => {
      if (!n.isConnected) return;
      cmdsShown = shown;
      n.scrollTop = n.scrollHeight;
    });
  });
  const turnsNow = (d.turns || []).length;
  return (
    <div className="fl-side">
      <section className="fl-sec files-sec">
        <div className="fl-h">
          <span>{files.length ? plural(files.length, "file") : "No files"}</span>
          {tmpFiles ? (
            <label className="tmp" title="Show files in temporary folders (/tmp, $TMPDIR)">
              <input type="checkbox" checked={showTmp} onChange={(ev) => setTmp(ev.currentTarget.checked)} />
              {`tmp (${tmpFiles})`}
            </label>
          ) : null}
          <button
            type="button"
            className="fold"
            title="Fold files and commands"
            aria-label="Fold files and commands"
            onClick={() => p.foldSide(true)}
          >
            <Stroke d={icons.sidebar} size={14} />
          </button>
        </div>
        {cwd ? (
          <div className="fl-wd" title={cwd}>
            <span>Working directory</span>
            <span className="p">{under(cwd, home) ? "~" + cwd.slice(home.length) : cwd}</span>
          </div>
        ) : null}
        <div className="fl-scroll" data-keep="files-list">
          <Tree
            files={files}
            cwd={cwd}
            home={home}
            sel={p.sel}
            showGit={showGit}
            folded={p.folded}
            harnesses={p.harnesses}
            pick={p.pick}
            fold={p.fold}
          />
          {files.length ? null : (
            <div className="fv-note">
              {kindHidden
                ? `Only ${plural(kindHidden, "file")} of the kinds turned off below.`
                : gitHidden
                  ? `Only ${plural(gitHidden, "file")} git changed.`
                  : tmpFiles
                    ? `Only ${plural(tmpFiles, "file")} in temporary folders.`
                    : p.opening || (p.running && d.turn === turnsNow - 1)
                      ? "No files yet in this turn."
                      : "The agent touched no files in this turn."}
            </div>
          )}
        </div>
        <div className="fl-legend fl-kinds">
          {Object.entries(FILE_KINDS).map(([k, [name]]) => {
            const on = !hiddenKinds.has(k);
            return (
              <button
                key={k}
                type="button"
                className={"kind" + (on ? "" : " off")}
                aria-pressed={on ? "true" : "false"}
                title={`${on ? "Hide" : "Show"} ${name} files`}
                onClick={() => switchKind(k)}
              >
                <KindMark kind={k} size={12} title="" />
                {name}
              </button>
            );
          })}
          {gitFiles ? (
            <button
              type="button"
              className={"kind" + (showGit ? "" : " off")}
              aria-pressed={showGit ? "true" : "false"}
              title={`${showGit ? "Hide" : "Show"} ${plural(gitFiles, "file")} changed by git (pulls, merges, checkouts)`}
              onClick={() => setGit(!showGit)}
            >
              <KindMark kind="git" size={12} title="" />
              {`by git (${full(gitFiles)})`}
            </button>
          ) : null}
        </div>
      </section>
      <section className="fl-sec cmds-sec">
        <div className="fl-h">
          {plural(d.commands.length, "command") + (counts.err ? ` · ${counts.err} failed` : "")}
        </div>
        <div className="fl-scroll" data-keep={`files-cmds-${d.turn}`} data-follow="1" ref={cmds}>
          {d.commands.map((c, i) => {
            const [cls, what] = c.error
              ? ["err", "Failed"]
              : c.running && p.running
                ? ["run", "Running"]
                : ["ok", "Passed"];
            const touched = cmdFiles(c);
            return (
              <div key={i} className="fl-cmd">
                <span className={"g " + cls} title={what}>
                  ●
                </span>
                <details id={`fl-${d.turn}-c${i}`}>
                  <summary>
                    <span className="tw" aria-hidden="true" />
                    <span className="k">{`${i + 1}`}</span>
                    <CallLabel c={c} n={140} />
                    <Changed ch={c.changed} />
                  </summary>
                  {touched.length ? (
                    <div className="fl-cmd-files">
                      {touched.map((f) => (
                        <button key={f} type="button" title={f} onClick={() => p.pick(f)}>
                          {((c.did || {})[f] || []).map((k, j) => (
                            <KindMark key={j} kind={k} size={11} />
                          ))}
                          {showGit && (c.git || {})[f] ? <GitMark kinds={c.git![f]} size={11} /> : null}
                          {rel(f).split("/").pop()}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <CallView call={c.call} ran={c} />
                </details>
              </div>
            );
          })}
          {d.commands.length ? null : <div className="fv-note">No commands in this turn.</div>}
        </div>
      </section>
      <Background tasks={p.background} open={bgOpen} openIt={openBackground} />
    </div>
  );
}

/** What runs in the background, under the commands: a section folded to its heading, opened to its tasks, each a row
 * as a command is -- its dot, what kind it is and what it is for, opened to when it started, its last sign of life and
 * the file it writes to. Nothing when none runs. */
function Background({ tasks, open, openIt }: { tasks: Task[]; open: boolean; openIt: (open: boolean) => void }) {
  if (!tasks.length) return null;
  const head = (
    <button
      type="button"
      className="fl-h"
      aria-expanded={open ? "true" : "false"}
      title={open ? "Fold the background tasks" : "Show the background tasks"}
      onClick={() => openIt(!open)}
    >
      <span className="tw" aria-hidden="true">
        {open ? "▼" : "▶"}
      </span>
      <span className="mark" aria-hidden="true" />
      <span>{`${plural(tasks.length, "background task")} running`}</span>
    </button>
  );
  if (!open) return <section className="fl-sec bg-sec">{head}</section>;
  const meta = (k: string, v: string | null | undefined, cls: string) =>
    v ? (
      <div className="fl-bg-meta">
        {`${k} `}
        <span className={cls}>{v}</span>
      </div>
    ) : null;
  return (
    <section className="fl-sec bg-sec open">
      {head}
      <div className="fl-scroll" data-keep="files-bg">
        {tasks.map((t) => (
          <div key={t.id} className="fl-cmd">
            <span className="g bg">●</span>
            <details id={`fl-bg-${t.id}`}>
              <summary>
                <span className="kind">{TASK_KINDS[t.kind] || t.kind}</span>
                {firstLine(t.label || t.id, 140)}
              </summary>
              <div className="fl-bg-meta">
                {"started "}
                <span data-ago={t.started || ""}>{ago(t.started)}</span>
                {t.active && t.active - (t.started || 0) > 2 && !t.event ? (
                  <span>
                    {" · active "}
                    <span data-ago={t.active}>{ago(t.active)}</span>
                  </span>
                ) : null}
              </div>
              {t.event ? (
                <div className="fl-bg-meta">
                  {"last event "}
                  <span data-ago={t.event_at || ""}>{ago(t.event_at)}</span>
                  {": "}
                  <span>{t.event}</span>
                </div>
              ) : null}
              {meta("writes to", t.output, "p")}
            </details>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The bar the panel folds to: the files, by kind, in the colours of the tree's (a file of two kinds counted in both; the
 * kinds switched off left out); the commands, by how they went, in the colours of the commands' dots; the tasks in the
 * background. A click on it opens the panel; on the background's, their section too. `acts`: the pane's head, put in
 * the bar with a panel open above the panes (PaneActs.tsx). */
export function SideBar({
  files,
  counts,
  background,
  hiddenKinds,
  icons,
  foldSide,
  acts,
}: {
  files: TurnFile[];
  counts: { ok: number; err: number; run: number };
  background: number;
  hiddenKinds: ReadonlySet<string>;
  icons: Record<string, string>;
  foldSide: (fold: boolean) => void;
  /** the pane's head (PaneActs); null: none */
  acts: ReactNode;
}) {
  const n = counts.ok + counts.err + counts.run;
  const kinds = Object.entries(FILE_KINDS)
    .filter(([k]) => !hiddenKinds.has(k))
    .map(([k, [name]]) => [files.filter((f) => f.kinds.includes(k)).length, k, name] as const)
    .filter(([c]) => c);
  const changed = addChanged(files.map((f) => f.changed));
  const how = (
    [
      [counts.ok, "ok", "passed"],
      [counts.err, "err", "failed"],
      [counts.run, "run", "running"],
    ] as const
  ).filter(([k]) => k);
  const said = [
    plural(files.length, "file") +
      (kinds.length ? ": " + kinds.map(([c, , w]) => `${full(c)} ${w}`).join(", ") : "") +
      (changed ? `; ${plural(changed[0], "line")} added, ${full(changed[1])} removed` : ""),
    plural(n, "command") + (how.length ? ": " + how.map(([k, , w]) => `${full(k)} ${w}`).join(", ") : ""),
    background ? plural(background, "background task") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const dot = (cls: string) => <i className={"g " + cls} aria-hidden="true" />;
  const button = (
    <button
      type="button"
      className="fl-bar"
      title={`${said}. Show the files and commands`}
      aria-label={`Show the files and commands: ${said}`}
      onClick={(ev) => {
        if ((ev.target as Element).closest(".it.bg")) useSide.getState().openBackground(true);
        foldSide(false);
      }}
    >
      <Stroke d={icons.sidebar} size={15} />
      <span className="stats">
        <span className="it">
          <Stroke d={icons.page} size={13} />
          {kinds.length ? (
            kinds.map(([c, k]) => (
              <span key={k} className="sub kd">
                <KindMark kind={k} size={10} title="" />
                {full(c)}
              </span>
            ))
          ) : (
            <span>{full(files.length)}</span>
          )}
          {changed && changed[0] ? <span className="sub chg-a">{`+${full(changed[0])}`}</span> : null}
          {changed && changed[1] ? <span className="sub chg-r">{`−${full(changed[1])}`}</span> : null}
        </span>
        <span className="it">
          <Stroke d={icons.terminal} size={13} />
          {how.length ? (
            how.map(([k, cls]) => (
              <span key={cls} className={"sub " + cls}>
                {dot(cls)}
                {full(k)}
              </span>
            ))
          ) : (
            <span>0</span>
          )}
        </span>
        {background ? (
          <span className="it bg" title={`Show ${plural(background, "background task")}`}>
            <Stroke d={icons.pulse} size={13} />
            <span className="sub bg">
              {dot("bg")}
              {full(background)}
            </span>
          </span>
        ) : null}
      </span>
    </button>
  );
  // with the pane's head: the two in a box, the head first
  return acts ? (
    <div className="fl-barbox">
      {acts}
      {button}
    </div>
  ) : (
    button
  );
}
