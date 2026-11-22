// THE START BOXES, each a form in a Radix Popover hung from its button (Pops.tsx, popups.ts's openPop): the directory a
// new actor works in and the harness it runs on (railNewBox: the rail's "+", the list head's actor on its own), an app's
// folder and the harness its agent runs on (appStartBox), the new-tab page's directory (DirBox). Each with the folders
// its group's actors work in a click away; a click on a harness starts it there, Enter the one tried (or the first). The
// box closes once it has started; why not, if it cannot, is said in it.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { tildePath } from "../../core/ui/highlight";
import { Html } from "../../core/ui/PageNode";
import { L, state } from "./link";
import { closePopIf } from "./popups";
import { usePop } from "./Pops";
import { folderPicks, foldersOf, lastPart, startCwd } from "./start-rules";
import { startSession, startWithApp } from "./starts";
import type { Actors, AppManifest, Gatherer } from "./types";

const home = () => state.home?.home_dir;
/** A box's folder box (`input`), its folders a click away, its error: what is typed, and what a pick or a failure says. */
function useFolder(input: RefObject<HTMLInputElement | null>, start: string, error = "") {
  const [value, setValue] = useState(start);
  const [err, setErr] = useState(error);
  // whether the box is still on the page (a start that failed after it closed: said in the page's line instead)
  const here = useRef(true);
  useEffect(
    () => () => {
      here.current = false;
    },
    [],
  );
  const pick = (d: string) => {
    flushSync(() => {
      setValue(d);
      setErr("");
    });
    input.current?.focus();
    input.current?.setSelectionRange(d.length, d.length);
  };
  const failed = (e: unknown) => {
    const m = (e as Error).message;
    if (here.current) setErr(m);
    else L.data.setLive(`Not started: ${m}`);
  };
  const asked = (what: string) => {
    setErr(what);
    input.current?.focus();
  };
  return { value, setValue, err, setErr, pick, failed, asked };
}
const onEnter = (go: () => void) => (ev: KeyboardEvent) => {
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  go();
};

/** The folders `g`'s actors work in, newest first, under a box's folder box (holding `dir` to start with): another a
 * click away. None: nothing. */
export function FolderPicks(props: { g: Actors; dir: string; label?: string; onPick: (d: string) => void }) {
  const folders = folderPicks(foldersOf(props.g, home()), props.dir);
  if (!folders.length) return null;
  return (
    <div className="folders">
      <div className="lbl">{props.label || "Where its actors work"}</div>
      {folders.map((d) => (
        <button key={d} type="button" title={d} onClick={() => props.onPick(d)}>
          <span className="nm">{lastPart(d)}</span>
          <span className="at">{d}</span>
        </button>
      ))}
    </div>
  );
}
function Harnesses({ hs, busy, go }: { hs: string[]; busy: boolean; go: (h: string) => void }) {
  return (
    <div className="on">
      {hs.map((h) => (
        <button key={h} type="button" className="go" disabled={busy} onClick={() => go(h)}>
          <Html node={L.helpers.harnessBadge(h)} />
          {L.helpers.harnessName(h)}
        </button>
      ))}
    </div>
  );
}

/** The rail's box for a new actor: the directory it works in (the one tried, if starting there failed; else the
 * dashboard's own), the folders the gatherer's actors work in a click away, and a button for each harness. `alone`: the
 * list head's box for an actor on its own, run under `g` (the list's aloneNew) -- the folders any actor works in a click
 * away. */
function RailNewBox(props: {
  g: Gatherer | null;
  hs: string[];
  harness: string;
  cwd: string;
  error: string;
  alone: boolean;
}) {
  const { g, hs, alone } = props;
  const pop = usePop();
  const dir = tildePath(props.cwd || state.home?.cwd || "", home());
  const input = useRef<HTMLInputElement>(null);
  const f = useFolder(input, dir, props.error);
  const [busy, setBusy] = useState(false);
  const go = async (h: string) => {
    const at = f.value.trim();
    if (!at) return f.asked("Which directory?");
    setBusy(true);
    try {
      await startSession(g?.name || "", at, h, null, alone);
      closePopIf(pop);
    } catch (e) {
      f.failed(e);
    } finally {
      setBusy(false);
    }
  };
  const title = alone || !g ? "New actor on its own" : `New actor in ${L.list.titleOf(g)}`;
  return (
    <div
      className={"dw-menu" + (alone ? " alone-box" : "")}
      role="dialog"
      aria-label={title}
      style={{ position: "relative" }}
    >
      <div className="head">{title}</div>
      {alone ? <div className="note">Shares context with no group.</div> : null}
      <label>
        Working directory
        <input
          ref={input}
          type="text"
          value={f.value}
          spellCheck={false}
          aria-label="Working directory"
          placeholder="~/projects/my-project"
          onChange={(ev) => {
            f.setValue(ev.target.value);
            f.setErr("");
          }}
          onKeyDown={onEnter(() => void go(props.harness))}
        />
      </label>
      <FolderPicks
        g={alone || !g ? L.groupMoves.everyActor() : g}
        dir={dir}
        label={alone ? "Where actors work" : undefined}
        onPick={f.pick}
      />
      <div>Run on</div>
      <Harnesses hs={hs} busy={busy} go={(h) => void go(h)} />
      <div className="err" role="alert">
        {f.err}
      </div>
    </div>
  );
}
/** The rail's box for a new actor of `g` (in the directory tried, `cwd`, and why it failed, `error`), as a pop-up holds
 * it; `alone`: the list head's, for an actor on its own. */
export function railNewBox(
  g: Gatherer | null,
  hs: string[],
  harness = hs[0],
  cwd = "",
  error = "",
  alone = false,
): { box: ReactNode } {
  return { box: <RailNewBox g={g} hs={hs} harness={harness} cwd={cwd} error={error} alone={alone} /> };
}

/** A new one of an app with an agent of its own (DocWriter, say) -- and its actor -- in a folder of the reader's choice:
 * its box asks which (the gatherer's current one to start with, the folders its actors work in a click away) and the
 * harness its actor runs on: a click on one starts it. */
function AppStartBox({ g, hs, app }: { g: Gatherer; hs: string[]; app: AppManifest }) {
  const pop = usePop();
  const cwd = startCwd(g),
    dir = cwd ? tildePath(cwd, home()) : "";
  const input = useRef<HTMLInputElement>(null);
  const f = useFolder(input, dir);
  const [busy, setBusy] = useState(false);
  const go = async (harness: string) => {
    const at = f.value.trim();
    if (!at) return f.asked("Which folder?");
    setBusy(true);
    try {
      await startWithApp(g.name, at, app.name, harness);
      closePopIf(pop);
    } catch (e) {
      f.failed(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dw-menu" role="dialog" aria-label={`New ${app.label}`} style={{ position: "relative" }}>
      <div className="head">{`New ${app.label}`}</div>
      <label>
        Folder
        <input
          ref={input}
          type="text"
          value={f.value}
          spellCheck={false}
          aria-label="Folder"
          placeholder="~/writing/my-paper"
          onChange={(ev) => {
            f.setValue(ev.target.value);
            f.setErr("");
          }}
          onKeyDown={onEnter(() => void go(hs[0]))}
        />
      </label>
      <FolderPicks g={g} dir={dir} onPick={f.pick} />
      <div>Run its agent on</div>
      <Harnesses hs={hs} busy={busy} go={(h) => void go(h)} />
      <div className="err" role="alert">
        {f.err}
      </div>
    </div>
  );
}
export const appStartBox = (g: Gatherer, hs: string[], app: AppManifest): { box: ReactNode } => ({
  box: <AppStartBox g={g} hs={hs} app={app} />,
});

/** The new-tab page's "Directory" box: the directory typed (`dir` to start with), the ones the place's actors (`g`) work
 * in a click away; Use, or Enter, takes it. */
export function DirBox(props: { dir: string; g: Actors | null; alone: boolean; onUse: (dir: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const f = useFolder(input, props.dir);
  const use = () => {
    const v = f.value.trim();
    if (!v) return f.asked("Which directory?");
    props.onUse(v);
  };
  return (
    <div className="dw-menu" role="dialog" aria-label="Working directory" style={{ position: "relative" }}>
      <div className="head">Where the new actor works</div>
      <label>
        Working directory
        <input
          ref={input}
          type="text"
          value={f.value}
          spellCheck={false}
          aria-label="Working directory"
          placeholder="~/projects/my-project"
          onChange={(ev) => {
            f.setValue(ev.target.value);
            f.setErr("");
          }}
          onKeyDown={onEnter(use)}
        />
      </label>
      {props.g ? (
        <FolderPicks
          g={props.g}
          dir={props.dir}
          label={props.alone ? "Where actors work" : "Where its actors work"}
          onPick={f.pick}
        />
      ) : null}
      <div className="on">
        <button type="button" className="go" onClick={use}>
          Use
        </button>
      </div>
      <div className="err" role="alert">
        {f.err}
      </div>
    </div>
  );
}
