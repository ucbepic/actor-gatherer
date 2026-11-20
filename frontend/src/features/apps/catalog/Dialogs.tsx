// The Apps page's dialogs, as the store has the one open (store.ts's `dialog`): Radix's Dialog, so focus stays in it
// while it is open and goes back where it was, Esc and a press outside close it, and it is announced as a dialog. Drawn
// in their own root on the page (catalog.ts's dialogRoot): an agent's request is asked even with the Apps page not shown.
import * as D from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { fromLine, kb, said } from "./said";
import { Mark, Tokens } from "./Parts";
import {
  answer,
  closeDialog,
  install,
  installBuiltin,
  stage,
  uninstall,
  update,
  useCatalog,
  type Dialog,
} from "./store";
import type { CatalogApp } from "./types";

/** The dialog open, if one is. */
export function Dialogs() {
  const dialog = useCatalog((s) => s.dialog);
  return (
    <D.Root open={!!dialog} onOpenChange={(open) => !open && closeDialog()}>
      <D.Portal>
        <D.Overlay className="ap-dim">
          {dialog ? (
            <D.Content
              className="ap-dlg"
              aria-describedby={undefined}
              onOpenAutoFocus={(ev) => {
                // its box to type in, else its main button
                const first = (ev.currentTarget as HTMLElement).querySelector<HTMLElement>(
                  "input:not([type=checkbox]), .primary, .danger",
                );
                if (first) {
                  ev.preventDefault();
                  first.focus();
                }
              }}
            >
              <Body dialog={dialog} />
            </D.Content>
          ) : null}
        </D.Overlay>
      </D.Portal>
    </D.Root>
  );
}

function Body({ dialog }: { dialog: Dialog }) {
  switch (dialog.kind) {
    case "source":
      return <FromSource dialog={dialog} />;
    case "install": {
      const st = dialog.staged;
      return (
        <>
          <Lead app={st} title={`Install ${st.label}?`} sub={fromLine(st)} />
          <p>{said.sentence(st.description)}</p>
          <ItCan app={st} />
          <p className="ap-sub">Once installed it&apos;s on in every folder.</p>
          <div className="ap-warn">Apps run on your computer with your permissions. Only install apps you trust.</div>
          <Buttons go="Install" run={() => void install(dialog)} />
        </>
      );
    }
    case "builtin": {
      const a = dialog.app;
      return (
        <>
          <Lead app={a} title={`Install ${a.label}?`} sub={fromLine(a)} />
          <p>{said.sentence(a.description)}</p>
          <ItCan app={a} />
          {a.data?.there ? (
            <p className="ap-sub">
              Its data from before is still there ({kb(a.data.bytes)}), so it starts as you left it.
            </p>
          ) : null}
          <Buttons go="Install" run={() => void installBuiltin(dialog)} />
        </>
      );
    }
    case "uninstall":
      return <Uninstall dialog={dialog} />;
    case "update":
      return <Update dialog={dialog} />;
    case "agent":
      return <AgentAsks dialog={dialog} />;
  }
}

/** Its mark, title and what is under it. */
function Lead({ app, title, sub }: { app: CatalogApp; title: string; sub: string }) {
  return (
    <div className="ap-lead">
      <Mark app={app} size={40} />
      <div>
        <D.Title asChild>
          <h2>{title}</h2>
        </D.Title>
        <div className="ap-sub">{sub}</div>
      </div>
    </div>
  );
}

/** What the dialog is doing, or why it failed; then Cancel and its own button (`go`), which waits while it works. */
function Buttons({
  go,
  run,
  kind = "primary",
  cancel = "Cancel",
  onCancel = closeDialog,
  ready = true,
}: {
  go: string;
  run: () => void;
  kind?: string;
  cancel?: string;
  onCancel?: () => void;
  ready?: boolean;
}) {
  const busy = useCatalog((s) => s.busy),
    failure = useCatalog((s) => s.failure);
  return (
    <>
      {busy ? (
        <div className="ap-busy">
          <i className="spin" aria-hidden="true" />
          {busy}
        </div>
      ) : null}
      {failure ? (
        <div className="ap-derr" role="alert">
          {failure}
        </div>
      ) : null}
      <div className="ap-btns">
        <button type="button" className="ap-btn" onClick={() => void onCancel()}>
          {cancel}
        </button>
        <button type="button" className={`ap-btn ${kind}`} disabled={!!busy || !ready} onClick={run}>
          {go}
        </button>
      </div>
    </>
  );
}

// what it may do, and what agents get of it, as the install and update dialogs say it
function ItCan({ app: a }: { app: CatalogApp }) {
  const who =
    a.access === "group"
      ? "Every agent of the group, when it next starts"
      : "Only the agents in its task, when they next start";
  return (
    <>
      <h3>It can</h3>
      <ul>
        {said.can(a).map((c) => (
          <li key={c}>{c}</li>
        ))}
        {(a.schedules || []).map((s) => (
          <li key={s}>{`Runs ${s}`}</li>
        ))}
      </ul>
      <h3>Agents get</h3>
      <ul>
        <li>
          {`${said.count((a.tools || []).length, "tool")}, `}
          <Tokens n={a.tokens || 0} tail="per agent" />
        </li>
        <li>{who}</li>
        {a.needs ? <li>{`Needs: ${a.needs}`}</li> : null}
      </ul>
    </>
  );
}

/** "Install from a folder or git URL…": where it is, checked (staged) before anything is installed. */
function FromSource({ dialog }: { dialog: Dialog & { kind: "source" } }) {
  const [source, setSource] = useState(dialog.source);
  return (
    <>
      <D.Title asChild>
        <h2>Install an app</h2>
      </D.Title>
      <p className="ap-sub">A folder on this computer or a git URL.</p>
      <input
        className="ap-field"
        value={source}
        placeholder="~/apps/pager, or https://github.com/someone/ag-pager"
        aria-label="Folder or git URL"
        spellCheck={false}
        onChange={(ev) => setSource(ev.target.value)}
        onKeyDown={(ev) => ev.key === "Enter" && void stage(dialog, source)}
      />
      <Buttons go="Check" run={() => void stage(dialog, source)} />
    </>
  );
}

/** Uninstall: what follows said first; its data kept unless ticked. */
function Uninstall({ dialog }: { dialog: Dialog & { kind: "uninstall" } }) {
  const [data, setData] = useState(false);
  const a = dialog.app,
    broken = dialog.broken;
  const per = Object.entries(a.open || {}).filter(([, n]) => n),
    n = per.reduce((x, [, k]) => x + k, 0);
  return (
    <>
      <Lead app={a} title={`Uninstall ${a.label}?`} sub={broken ? "it couldn't load" : fromLine(a)} />
      <ul>
        {broken ? (
          <li>It never loaded, so nothing is open and no agent has its tools.</li>
        ) : (
          <li>
            {n
              ? `Its ${n} open window${n > 1 ? "s" : ""} close (${per.map(([g, k]) => `${g} ${k}`).join(", ")}).`
              : "Nothing is open."}
          </li>
        )}
        {broken ? null : <li>Agents lose its tools when they next start. Calls before then are refused.</li>}
        {broken ? null : <li>What it put in your history stays.</li>}
        {a.origin === "builtin" ? <li>It comes with ag. Reinstall it from Available to install.</li> : null}
      </ul>
      <label className="ap-tick" htmlFor="ap-del-data">
        <input type="checkbox" id="ap-del-data" checked={data} onChange={(ev) => setData(ev.target.checked)} />
        {"Also delete its data "}
        <span className="mono ap-quiet">
          {a.data ? `${a.data.path}${a.data.there ? ` · ${kb(a.data.bytes)}` : ""}` : ""}
        </span>
      </label>
      <Buttons go="Uninstall" kind="danger" run={() => void uninstall(dialog, data)} />
    </>
  );
}

/** Update: fetched and checked first, then only what changes is said. */
function Update({ dialog }: { dialog: Dialog & { kind: "update" } }) {
  const a = dialog.app,
    st = dialog.staged;
  if (!st)
    return (
      <>
        <Lead app={a} title={`Update ${a.label}`} sub={fromLine(a)} />
        <Buttons go="Update" ready={false} run={() => {}} />
      </>
    );
  const ch = st.changes;
  const lines = [
    ...(ch?.tools_added || []).map((t) => `New tool: ${t}`),
    ...(ch?.tools_gone || []).map((t) => `Removed tool: ${t}`),
    ...(ch?.can_added || []).map((c) => `New permission: ${c}`),
    ...(ch?.own_process ? ["Now runs its own process on this computer"] : []),
  ];
  const v = ch ? ch.version.join(" → ") : st.version || "";
  return (
    <>
      <Lead
        app={st}
        title={`Update ${a.label} to ${st.version}?`}
        sub={`${v}${st.commit ? ` · ${st.commit.slice(0, 7)}` : ""}`}
      />
      <h3>What changes</h3>
      <ul>
        {(lines.length ? lines : ["Only its code changes."]).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p className="ap-sub">The app restarts and its windows reload. Agents get new tools when they next start.</p>
      <Buttons go="Update" run={() => void update(dialog)} />
    </>
  );
}

/** An agent's asking to install, update or uninstall an app: approved or declined here. */
function AgentAsks({ dialog }: { dialog: Dialog & { kind: "agent" } }) {
  const r = dialog.request;
  const a = r.about || ({ name: "?", label: "an app", origin: "", description: "" } as CatalogApp);
  const verb = { install: "install", update: "update", uninstall: "uninstall" }[r.op] || r.op;
  const title = `${dialog.who} asks to ${verb} ${a.label}`;
  const warn: ReactNode =
    r.op === "uninstall" ? (
      <p>{`Its windows close, and agents lose its tools when their terminal next starts.${r.args?.data ? " Its data is deleted too." : ""}`}</p>
    ) : (
      <div className="ap-warn">Apps run on your computer with your permissions. Only approve apps you trust.</div>
    );
  return (
    <>
      <Lead app={a} title={title} sub={fromLine(a)} />
      <p>{said.sentence(a.description || "")}</p>
      {r.op === "uninstall" ? null : <ItCan app={a} />}
      {warn}
      <Buttons
        go={verb[0].toUpperCase() + verb.slice(1)}
        kind={r.op === "uninstall" ? "danger" : "primary"}
        run={() => void answer(dialog, true)}
        cancel="Decline"
        onCancel={() => void answer(dialog, false)}
      />
    </>
  );
}
