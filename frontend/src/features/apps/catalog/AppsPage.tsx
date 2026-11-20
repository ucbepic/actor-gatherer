// THE APPS PAGE (app_kit/DESIGN.md, "Apps from outside"; ag_dashboard/app_catalog.py): a screen tab's page, in place of
// its new-tab page (layout/tabs.ts's `page`). Every app installed -- each on in every group, there being no turning one
// off in a group -- with what it gives agents and costs them, where it came from and its windows open; the apps that can
// be installed (ag's index, and those that come with ag, uninstalled); the folders that couldn't load. A row clicked
// shows its details beside the list; its ⋯ opens it, updates it (one from git) or uninstalls it, each asked in a dialog
// first (Dialogs.tsx). Its state is the store's (store.ts).
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { GlyphIcon } from "../../../core/ui/Icon";
import { Meta, Mark, Tokens } from "./Parts";
import { kb, said, whoGets, windows } from "./said";
import {
  chooseOnTask,
  chooseOpens,
  confirmBuiltin,
  confirmUninstall,
  fromSource,
  openApp,
  select,
  stageUpdate,
  useCatalog,
} from "./store";
import type { Broken, CatalogApp, OnTask } from "./types";

export function AppsPage() {
  const s = useCatalog();
  const sel = s.sel ? s.got?.installed.find((a) => a.name === s.sel) || null : null;
  return (
    <div className="ap-page">
      <div className="ap-main">
        <Head />
        <Body />
      </div>
      {sel ? <Details app={sel} /> : null}
    </div>
  );
}

function Head() {
  const q = useCatalog((s) => s.q),
    note = useCatalog((s) => s.note),
    error = useCatalog((s) => s.error);
  return (
    <>
      <div className="ap-head">
        <h1>Apps</h1>
        <input
          className="ap-search"
          type="search"
          placeholder="Search apps and their tools"
          aria-label="Search apps"
          value={q}
          onChange={(ev) => useCatalog.setState({ q: ev.target.value })}
        />
        <button type="button" className="ap-btn" onClick={() => fromSource()}>
          + Install from a folder or git URL…
        </button>
      </div>
      <p className="ap-lede">Installed apps are on in every folder. Agents get new tools when they next start.</p>
      {note ? (
        <div className="ap-note" role="status">
          {note}
        </div>
      ) : null}
      {error ? (
        <div className="ap-error" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

const matches = (q: string, a: { name: string; label?: string; description?: string; tools?: string[] }): boolean =>
  !q || [a.name, a.label, a.description, ...(a.tools || [])].join(" ").toLowerCase().includes(q.toLowerCase());

function Body() {
  const got = useCatalog((s) => s.got),
    q = useCatalog((s) => s.q),
    error = useCatalog((s) => s.error);
  if (!got) return error ? null : <p className="ap-quiet">Loading apps…</p>;
  const inst = got.installed.filter((a) => matches(q, a)),
    av = got.available.filter((a) => matches(q, a)),
    br = got.broken.filter((b) => matches(q, b));
  if (q && !inst.length && !av.length && !br.length) return <p className="ap-quiet">{`No app matches “${q}”.`}</p>;
  return (
    <>
      {inst.length || !q ? (
        <Section title="Installed" n={inst.length} none="No app is installed." hint="on in every folder">
          {inst.map((a) => (
            <InstalledRow key={a.name} app={a} />
          ))}
        </Section>
      ) : null}
      {av.length || !q ? (
        <Section title="Available to install" n={av.length} none="Nothing else to install yet.">
          {av.map((a) => (
            <AvailableRow key={a.name} app={a} />
          ))}
        </Section>
      ) : null}
      {br.length ? (
        <Section title="Couldn't load" n={br.length} none="">
          {br.map((b) => (
            <BrokenRow key={b.folder} broken={b} />
          ))}
        </Section>
      ) : null}
    </>
  );
}

function Section({
  title,
  n,
  none,
  hint,
  children,
}: {
  title: string;
  n: number;
  none: string;
  hint?: string;
  children: ReactNode[];
}) {
  return (
    <>
      <div className="ap-sec">
        <span>{title}</span>
        <span className="n">{String(n)}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      <div className="ap-rows">{children.length ? children : <div className="ap-none">{none}</div>}</div>
    </>
  );
}

function Badges({ app: a }: { app: CatalogApp }) {
  const update = useCatalog((s) => !!s.updates[a.name]),
    n = windows(a);
  return (
    <>
      <span className={`ap-badge ${a.origin === "home" && a.kind === "git" ? "git" : ""}`}>{said.where(a)}</span>
      {n ? <span className="ap-badge open">{`${n} open`}</span> : null}
      {update ? <span className="ap-badge upd">update</span> : null}
      {a.failed ? <span className="ap-badge bad">failed to start</span> : null}
    </>
  );
}

function InstalledRow({ app: a }: { app: CatalogApp }) {
  const picked = useCatalog((s) => s.sel === a.name),
    flash = useCatalog((s) => s.flash === a.name);
  const ref = useRef<HTMLDivElement>(null);
  const key = (ev: KeyboardEvent) => {
    if (ev.target === ref.current && (ev.key === "Enter" || ev.key === " ")) {
      ev.preventDefault();
      select(a.name);
    }
  };
  return (
    <div
      ref={ref}
      className={`ap-row${picked ? " sel" : ""}${flash ? " flash" : ""}`}
      tabIndex={0}
      data-app={a.name}
      onClick={() => select(a.name)}
      onKeyDown={key}
      onAnimationEnd={() => flash && useCatalog.setState({ flash: "" })} // (flashed once)
    >
      <Mark app={a} size={30} />
      <div className="ap-txt">
        <div className="ap-t1">
          <span className="ap-name">{a.label}</span>
          <Badges app={a} />
        </div>
        <div className="ap-desc">{a.description}</div>
        <Meta
          parts={[
            whoGets(a),
            said.count((a.tools || []).length, "tool"),
            <Tokens n={a.tokens || 0} tail="per agent" />,
            (a.schedules || []).length ? "runs on a schedule" : null,
          ]}
        />
      </div>
      <More app={a} />
    </div>
  );
}

function AvailableRow({ app: a }: { app: CatalogApp }) {
  const install = (): void => (a.origin === "builtin" ? confirmBuiltin(a) : fromSource(a.source || "", true));
  return (
    <div className="ap-row" data-app={a.name} onClick={install}>
      <Mark app={a} size={30} />
      <div className="ap-txt">
        <div className="ap-t1">
          <span className="ap-name">{a.label}</span>
          <span className="ap-badge">{said.where(a)}</span>
        </div>
        <div className="ap-desc">{a.description}</div>
        <Meta
          parts={[
            a.origin === "builtin" ? "comes with ag" : "ag's index",
            a.tools ? said.count(a.tools.length, "tool") : null,
            a.tokens ? <Tokens n={a.tokens} tail="per agent" /> : null,
            a.needs || null,
          ]}
        />
      </div>
      <button
        type="button"
        className="ap-btn"
        data-install={a.name}
        onClick={(ev) => {
          ev.stopPropagation();
          install();
        }}
      >
        Install
      </button>
    </div>
  );
}

function BrokenRow({ broken: b }: { broken: Broken }) {
  const reveal = useCatalog((s) => s.hooks?.reveal);
  const gone: CatalogApp = {
    name: b.name,
    label: b.name,
    description: "",
    origin: b.origin,
    data: { path: b.folder, bytes: 0, there: false },
  };
  return (
    <div className="ap-row broken">
      <span className="ap-mark bad" aria-hidden="true">
        !
      </span>
      <div className="ap-txt">
        <div className="ap-t1">
          <span className="ap-name">{b.name}</span>
        </div>
        <div className="ap-desc err">{b.error}</div>
        <Meta parts={[<span className="mono">{b.folder}</span>]} />
      </div>
      {reveal ? (
        <button type="button" className="ap-btn ghost" onClick={() => reveal(b.folder)}>
          Show folder
        </button>
      ) : null}
      {b.origin === "home" ? (
        <button type="button" className="ap-btn ghost" onClick={() => confirmUninstall(gone, true)}>
          Uninstall…
        </button>
      ) : null}
    </div>
  );
}

// its ⋯: Open (the way chosen in its details: with an agent of its own, or on its own), Details, Update (one from git
// with a newer commit), Uninstall
function More({ app: a }: { app: CatalogApp }) {
  const update = useCatalog((s) => !!s.updates[a.name]);
  const items: [string, () => void][] = [
    ["Open", () => openApp(a, !!a.opens_with_agent)],
    ["Details", () => select(a.name, true)],
    ...(update ? ([["Update…", () => void stageUpdate(a)]] as [string, () => void][]) : []),
    ["Uninstall…", () => confirmUninstall(a)],
  ];
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="ap-more"
          aria-label={`More for ${a.label}`}
          onClick={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => ev.stopPropagation()}
        >
          ⋯
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="ap-menu" align="end" sideOffset={4} onClick={(ev) => ev.stopPropagation()}>
          {items.map(([label, run]) => (
            <Menu.Item key={label} className="ap-it" onSelect={run}>
              {label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A choice of a row of buttons, the one chosen pressed. */
function Choice<V extends string | boolean>({
  label,
  group,
  value,
  options,
  pick,
  className = "",
  note,
}: {
  label: string;
  group: string;
  value: V;
  options: [V, string, string?][];
  pick: (v: V) => void;
  className?: string;
  note?: string;
}) {
  return (
    <div className={`ap-opens${className}`}>
      <span className="ap-opens-l">{label}</span>
      <div className="ap-seg" role="group" aria-label={group}>
        {options.map(([v, words, title]) => (
          <button
            key={String(v)}
            type="button"
            className="ap-seg-b"
            aria-pressed={v === value}
            title={title}
            onClick={() => pick(v)}
          >
            {words}
          </button>
        ))}
      </div>
      {note ? <span className="ap-opens-note">{note}</span> : null}
    </div>
  );
}

// what "+" on an actor or a task does with it (ag_dashboard/app_policy.py): its words, and what it does
const ON_TASK: Record<OnTask, [string, string]> = {
  join: ["Joins it", "Put in the task: its agents are attached to it and get its tools."],
  folder: ["At the agent's folder", "Opened at the agent's directory, shown with the task, not part of it."],
  no: ["Not offered", "Left out of the + menu, and not put in a task by dragging."],
};

// ITS DETAILS, beside the list: how it opens, what "+" does with it, what agents get, what it may do, when it works on
// its own, its windows, its data
function Details({ app: a }: { app: CatalogApp }) {
  const allTools = useCatalog((s) => s.allTools),
    update = useCatalog((s) => !!s.updates[a.name]);
  const tools = allTools ? a.tools || [] : (a.tools || []).slice(0, 5),
    more = (a.tools || []).length - 5;
  const art = /^[aeiou]/i.test(a.label) ? "an" : "a";
  const openNow = Object.entries(a.open || {}).filter(([, n]) => n);
  const can = a.on_task_can || [];
  return (
    <aside className="ap-side" aria-label={`${a.label}'s details`}>
      <div className="ap-dtop">
        <Mark app={a} size={38} />
        <div>
          <h2>{a.label}</h2>
          <div className="ap-sub">{said.from(a)}</div>
        </div>
        <button type="button" className="ap-close" aria-label="Close details" onClick={() => select(null)}>
          <GlyphIcon name="x" size={16} />
        </button>
      </div>
      <p>{said.sentence(a.description)}</p>
      {a.failed ? <p className="err">{`Backend failed to start: ${a.failed}`}</p> : null}
      <div className="ap-acts">
        <button type="button" className="ap-btn primary" onClick={() => openApp(a, !!a.opens_with_agent)}>
          {a.instances === "one" ? `Open ${a.label}` : `Open ${art} ${a.label}`}
        </button>
      </div>
      {a.with_agent ? (
        <Choice
          label="Opens"
          group={`How ${a.label} opens`}
          value={!!a.opens_with_agent}
          options={[
            [true, "With its own agent"],
            [false, "On its own"],
          ]}
          pick={(agent) => void chooseOpens(a, agent)}
        />
      ) : null}
      {a.on_task && can.length >= 2 ? (
        <Choice
          label="Added to a task"
          className=" ap-on-task"
          group={`What + on an actor or a task does with ${a.label}`}
          value={a.on_task}
          options={can.map((v) => [
            v,
            ON_TASK[v][0],
            v === a.on_task_own ? `${ON_TASK[v][1]} (its default)` : ON_TASK[v][1],
          ])}
          pick={(v) => void chooseOnTask(a, v)}
          note={ON_TASK[a.on_task][1] + (a.on_task === a.on_task_own ? " Its default." : "")}
        />
      ) : null}
      <h3>What agents get</h3>
      <div className="ap-kv">
        <span>Who</span>
        <span>{a.access === "group" ? "every agent of the group" : "only the agents in its task"}</span>
        <span>Tools</span>
        <span>
          {`${(a.tools || []).length}, `}
          <Tokens n={a.tokens || 0} tail="per agent" />
        </span>
      </div>
      <div className="ap-tools">
        {tools.map((t) => (
          <code key={t}>{t}</code>
        ))}
        {more > 0 ? (
          <button type="button" onClick={() => useCatalog.setState({ allTools: !allTools })}>
            {allTools ? "fewer" : `+${more}`}
          </button>
        ) : null}
      </div>
      <h3>What it can do</h3>
      <ul>
        {said.can(a).map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {(a.schedules || []).length ? (
        <>
          <h3>Schedule</h3>
          <ul>
            {(a.schedules || []).map((s) => (
              <li key={s}>{said.sentence(s)}</li>
            ))}
          </ul>
        </>
      ) : null}
      <h3>Open now</h3>
      {openNow.length ? (
        <div className="ap-kv">
          {openNow.flatMap(([g, n]) => [<span key={`${g}-g`}>{g}</span>, <span key={`${g}-n`}>{`${n} open`}</span>])}
        </div>
      ) : (
        <p className="ap-quiet">Nothing open.</p>
      )}
      <h3>Data</h3>
      <div className="mono">
        {a.data ? `${a.data.path}${a.data.there ? ` · ${kb(a.data.bytes)}` : " (none yet)"}` : "—"}
      </div>
      <div className="ap-foot">
        {update ? (
          <button type="button" className="ap-btn primary" onClick={() => void stageUpdate(a)}>
            Update…
          </button>
        ) : (
          <span className="ap-quiet">{said.upToDate(a)}</span>
        )}
        <button type="button" className="ap-btn" onClick={() => confirmUninstall(a)}>
          Uninstall…
        </button>
      </div>
    </aside>
  );
}
