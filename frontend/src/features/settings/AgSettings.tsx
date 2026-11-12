// ag's settings, at the top of the dashboard's panel: the Gatherer's model, a new gatherer's defaults, the harnesses
// ag runs, and config.toml itself in a dialog over the page (a Browser's logins: its panel's own menu). The markup and its classes are the page's
// before (frontend/index.html's #cfg, src/legacy/css/00-base.css), so it looks as it did.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Settings } from "../../core/api/types";
import { unset, useSettings } from "./store";

const MODELS = [
  "claude-code/sonnet",
  "claude-code/haiku",
  "claude-code/opus",
  "codex/gpt-5-mini",
  "gemini/gemini-3.8-flash",
];
const NO_MODEL =
  "No model set: every Gatherer call fails until one is. A coding agent on its own login (claude-code/…, codex/…), or any LiteLLM provider/model.";

type Note = { text: string; kind?: "bad" | "err" };
const noteClass = (n: Note) => "cfg-note" + (n.kind ? " " + n.kind : "");

/** A form's submit: its button off while it saves, "Saving…" in its note, an error said there. */
function useSubmit(setNote: (n: Note) => void) {
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent, run: () => Promise<void>) => {
    ev.preventDefault();
    setBusy(true);
    setNote({ text: "Saving…" });
    try {
      await run();
    } catch (e) {
      setNote({ text: (e as Error).message, kind: "err" });
    } finally {
      setBusy(false);
    }
  };
  return [busy, submit] as const;
}

export interface AgSettingsProps {
  /** Close the dashboard's panel (the page's setAbout(false)): once the model is set. */
  closePanel: () => void;
}

export function AgSettings({ closePanel }: AgSettingsProps) {
  const s = useSettings((x) => x.settings);
  const rev = useSettings((x) => x.rev); // the forms start over each time the settings are read
  if (!s) return null;
  return (
    <>
      <h3>ag</h3>
      <ModelForm key={`m${rev}`} s={s} closePanel={closePanel} />
      <DefaultsForm key={`d${rev}`} s={s} />
      <div>
        <h4>Harnesses</h4>
        <Harnesses s={s} />
      </div>
      <div className="row">
        <span className="cfg-path" id="cfg-path" title={s.path}>
          {s.path}
        </span>
        <button type="button" id="cfg-edit" onClick={() => void useSettings.getState().openFile()}>
          Edit config.toml…
        </button>
      </div>
      <h3>This page</h3>
      {createPortal(<ConfigFile />, document.body)}
    </>
  );
}

/** The model's box, its suggestions drawn in the page under it: a <datalist>'s popup is the browser's own, and
 * embedded browsers (VS Code's, Electron) draw it far from the box. */
export function ModelInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(-1);
  const q = value.trim().toLowerCase();
  const shown = MODELS.filter((m) => m !== value && m.toLowerCase().includes(q));
  const list = shown.length ? shown : MODELS.filter((m) => m !== value);
  const pick = (m: string) => {
    onChange(m);
    setOpen(false);
    setAt(-1);
  };
  return (
    <div className="cfg-combo">
      <input
        id="cfg-model-name"
        placeholder="claude-code/sonnet"
        spellCheck={false}
        autoComplete="off"
        aria-label="Gatherer model"
        role="combobox"
        aria-expanded={open}
        aria-controls="cfg-models"
        aria-autocomplete="list"
        aria-activedescendant={open && at >= 0 ? `cfg-model-${at}` : undefined}
        value={value}
        onChange={(ev) => {
          onChange(ev.target.value);
          setOpen(true);
          setAt(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(ev) => {
          if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
            ev.preventDefault();
            const n = list.length;
            setOpen(true);
            setAt((i) => (ev.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
          } else if (ev.key === "Enter" && open && at >= 0) {
            ev.preventDefault(); // pick, not submit
            pick(list[at]);
          } else if (ev.key === "Escape" && open) {
            ev.stopPropagation(); // close the list, not the panel
            setOpen(false);
          }
        }}
      />
      {open && list.length > 0 && (
        <ul className="cfg-combo-list" id="cfg-models" role="listbox" aria-label="Suggested models">
          {list.map((m, i) => (
            <li
              key={m}
              id={`cfg-model-${i}`}
              role="option"
              aria-selected={i === at}
              onMouseDown={(ev) => {
                ev.preventDefault(); // keep the box's focus, so its blur does not close the list first
                pick(m);
              }}
              onMouseEnter={() => setAt(i)}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModelForm({ s, closePanel }: { s: Settings; closePanel: () => void }) {
  const said = useSettings((x) => x.said);
  const [model, setModel] = useState(s.llm.model);
  const [apiBase, setApiBase] = useState(s.llm.api_base);
  const [keyEnv, setKeyEnv] = useState(s.llm.key_env);
  const [note, setNote] = useState<Note | null>(null);
  const [busy, submit] = useSubmit(setNote);
  const notes = Object.entries(s.env || {}).map(
    ([k, v]) => `${k}=${v} is set for this dashboard and overrides the file here.`,
  );
  const shown: Note =
    note ??
    (said
      ? { text: [said, ...notes].join("\n") }
      : unset(s)
        ? { text: NO_MODEL, kind: "bad" }
        : { text: notes.join("\n") });
  return (
    <form
      id="cfg-model"
      onSubmit={(ev) =>
        submit(ev, async () => {
          await useSettings.getState().setModel(model, apiBase, keyEnv);
          closePanel();
        })
      }
    >
      <h4>Gatherer model</h4>
      <div className="row">
        <ModelInput value={model} onChange={setModel} />
        <button className="primary" type="submit" disabled={busy}>
          Set
        </button>
      </div>
      <details className="cfg-more" open={!!(s.llm.api_base || s.llm.key_env) || undefined}>
        <summary>API base and key (LiteLLM models only)</summary>
        <label>
          API base
          <input
            id="cfg-api-base"
            placeholder="the provider's own API"
            spellCheck={false}
            value={apiBase}
            onChange={(ev) => setApiBase(ev.target.value)}
          />
        </label>
        <label>
          Key variable
          <input
            id="cfg-key-env"
            placeholder="the provider's own, e.g. GEMINI_API_KEY"
            spellCheck={false}
            value={keyEnv}
            onChange={(ev) => setKeyEnv(ev.target.value)}
          />
        </label>
      </details>
      <div className={noteClass(shown)} id="cfg-model-note">
        {shown.text}
      </div>
    </form>
  );
}

function DefaultsForm({ s }: { s: Settings }) {
  const [policy, setPolicy] = useState(s.policies.default);
  const [pollers, setPollers] = useState(s.pollers.default);
  const [gatherer, setGatherer] = useState(s.cli.gatherer);
  const [note, setNote] = useState<Note | null>(null);
  const saved = useSettings((x) => x.savedDefaults);
  const [busy, submit] = useSubmit(setNote);
  const shown: Note =
    note ??
    (saved
      ? { text: saved }
      : !s.exists
        ? { text: "ag makes config.toml once the model is set, or on its first run." }
        : s.error
          ? { text: "config.toml does not parse: " + s.error, kind: "err" }
          : { text: "" });
  return (
    <form
      id="cfg-defaults"
      onSubmit={(ev) =>
        submit(ev, async () => {
          await useSettings.getState().setDefaults(policy || null, pollers, gatherer); // its note: savedDefaults
        })
      }
    >
      <h4>Group defaults</h4>
      <label>
        Policy
        <select id="cfg-policy" value={policy} onChange={(ev) => setPolicy(ev.target.value)}>
          {s.policies.available.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <div className="cfg-label">
        Pollers
        <span className="cfg-checks" id="cfg-pollers">
          {s.pollers.available.length ? (
            s.pollers.available.map((p) => (
              <label key={p}>
                <input
                  type="checkbox"
                  value={p}
                  checked={pollers.includes(p)}
                  onChange={(ev) => setPollers(ev.target.checked ? [...pollers, p] : pollers.filter((x) => x !== p))}
                />
                {p}
              </label>
            ))
          ) : (
            <span className="cfg-note">none available</span>
          )}
        </span>
      </div>
      <label title='[cli] gatherer: where `ag claude` files a run that names no --gatherer (".": one per session)'>
        <span>
          Gatherer for <code>ag &lt;harness&gt;</code> runs
        </span>
        <input
          id="cfg-gatherer"
          spellCheck={false}
          placeholder="default"
          value={gatherer}
          onChange={(ev) => setGatherer(ev.target.value)}
        />
      </label>
      <div className="row">
        <span className={noteClass(shown)} id="cfg-defaults-note">
          {shown.text}
        </span>
        <button type="submit" disabled={busy || !s.exists}>
          Save
        </button>
      </div>
    </form>
  );
}

function Harnesses({ s }: { s: Settings }) {
  const hs = Object.entries(s.cli.harnesses);
  return (
    <div className="cfg-harnesses" id="cfg-harnesses">
      {hs.length ? (
        hs.map(([name, h]) => (
          <div key={name}>
            <code>{name}</code> runs <code>{(Array.isArray(h.command) ? h.command : [name]).join(" ")}</code>
            {h.port ? ` · hook port ${h.port}` : ""}
            {h.upstream ? ` · upstream ${h.upstream}` : ""}
          </div>
        ))
      ) : (
        <span className="cfg-note">ag writes them here the first time it runs a harness.</span>
      )}
    </div>
  );
}

/** config.toml, edited over the whole page. Its `hidden` says whether it is open, which the page's Esc reads. */
function ConfigFile() {
  const s = useSettings((x) => x.settings);
  const file = useSettings((x) => x.file);
  const close = () => useSettings.getState().closeFile();
  return (
    <div
      className="cfg-file"
      id="cfg-file"
      hidden={!file.open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cfg-file-title"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) close();
      }}
    >
      <FileForm
        key={file.rev}
        text={s?.text ?? ""}
        path={s?.path ?? ""}
        error={file.error}
        open={file.open}
        close={close}
      />
    </div>
  );
}

/** The file's text as it was read when the dialog opened, edited here until saved or the dialog is closed. */
function FileForm(props: { text: string; path: string; error: string; open: boolean; close: () => void }) {
  const [text, setText] = useState(props.text);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const b = box.current;
    if (!props.open || !b) return;
    b.focus();
    b.setSelectionRange(0, 0);
    b.scrollTop = 0;
  }, [props.open]);
  return (
    <form
      className="cfg-file-box"
      id="cfg-file-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        void useSettings.getState().saveFile(text);
      }}
    >
      <div className="row">
        <h3 id="cfg-file-title">config.toml</h3>
        <span className="cfg-path" id="cfg-file-path">
          {props.path}
        </span>
      </div>
      <textarea
        ref={box}
        id="cfg-file-text"
        spellCheck={false}
        aria-label="config.toml"
        value={text}
        onChange={(ev) => setText(ev.target.value)}
      />
      <div className="row">
        <span className="err" id="cfg-file-err">
          {props.error}
        </span>
        <span>
          <button type="button" id="cfg-file-cancel" onClick={props.close}>
            Cancel
          </button>{" "}
          <button className="primary" type="submit">
            Save
          </button>
        </span>
      </div>
    </form>
  );
}
