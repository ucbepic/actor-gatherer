// The Apps page's state (catalog/AppsPage.tsx draws it): the apps read, what the reader searched and picked, a note at
// the top, and the dialog open, if one is -- each step that installs, updates or uninstalls an app asked first in one.
// An app from a folder or git URL is staged first (copied aside and checked by the server), then shown as it is; one
// staged and not installed is discarded when its dialog closes.
import { create } from "zustand";
import { get, post } from "../../../core/api/client";
import type { AgentRequest, Catalog, CatalogApp, OnTask, PageHooks, Staged } from "./types";

/** The dialog open: which, and what it is about. */
export type Dialog =
  | { kind: "source"; source: string }
  | { kind: "install"; staged: Staged }
  | { kind: "builtin"; app: CatalogApp }
  | { kind: "uninstall"; app: CatalogApp; broken: boolean }
  | { kind: "update"; app: CatalogApp; staged: Staged | null }
  | { kind: "agent"; request: AgentRequest; who: string; done: () => void };

interface CatalogState {
  hooks: PageHooks | null;
  got: Catalog | null;
  error: string;
  /** said at the top, after an install, an update or a failure */
  note: string;
  /** the installed app whose details show beside the list */
  sel: string | null;
  q: string;
  allTools: boolean;
  /** the apps from git with a newer commit (`/api/apps/updates`) */
  updates: Record<string, string>;
  /** the app just installed or updated: its row flashed once */
  flash: string;
  dialog: Dialog | null;
  /** the dialog's work under way ("Installing…"), or why it failed */
  busy: string;
  failure: string;
}

export const useCatalog = create<CatalogState>()(() => ({
  hooks: null,
  got: null,
  error: "",
  note: "",
  sel: null,
  q: "",
  allTools: false,
  updates: {},
  flash: "",
  dialog: null,
  busy: "",
  failure: "",
}));
const set = useCatalog.setState,
  state = useCatalog.getState;

/** The apps read again (`updates`: each app from git asked whether it has a newer commit, once read). */
export async function reload(updates = false): Promise<void> {
  try {
    const got = await get<Catalog>("/api/apps/catalog"); // (the server reads the app folders again for it)
    set({ got, error: "" });
    const f = got.found;
    if (f && f.added.length + f.gone.length + f.changed.length) await state().hooks?.changed(); // the page's own list too
  } catch (e) {
    set({ error: `Couldn't load apps: ${(e as Error).message}` });
  }
  if (updates && state().got?.installed.some((a) => a.kind === "git"))
    void get<{ updates: Record<string, string> }>("/api/apps/updates")
      .then((u) => set({ updates: u.updates || {} }))
      .catch(() => {});
}

/** After an install, update or uninstall: the page around told, the apps read again, `note` said at the top. */
async function done(note: string, sel: string | null): Promise<void> {
  const updates = { ...state().updates };
  if (sel) delete updates[sel]; // (updated: asked again below)
  set({ note, sel, flash: sel || "", updates });
  await state().hooks?.changed();
  await reload(true);
}

/** An app's details shown beside the list, or hidden (`keep`: shown, even if it was). */
export function select(name: string | null, keep = false): void {
  set((s) => ({ sel: keep || s.sel !== name ? name : null, allTools: false }));
}

/** The app opened, the way chosen (`withAgent`), where things start. */
export function openApp(a: CatalogApp, withAgent = false): void {
  const hooks = state().hooks;
  if (!hooks) return;
  set({ note: withAgent ? `Opening ${a.label} with an agent…` : `Opening ${a.label}…` });
  hooks
    .open(a, withAgent)
    .then(() => set({ note: "" }))
    .catch((e: Error) => set({ note: `${a.label} couldn't be opened: ${e.message}` }));
}

// one of an installed app's choices kept (app_settings.py): `change` made of the server's answer, the page around told
async function setting(
  a: CatalogApp,
  body: Record<string, unknown>,
  changed: (got: Partial<CatalogApp>) => Partial<CatalogApp>,
): Promise<void> {
  try {
    const change = changed(await post<Partial<CatalogApp>>("/api/apps/settings", { app: a.name, ...body }));
    set((s) => {
      const got = s.got && {
        ...s.got,
        installed: s.got.installed.map((x) => (x.name === a.name ? { ...x, ...change } : x)),
      };
      return { got, note: "" };
    });
    await state().hooks?.changed(); // (its menus read the apps again)
  } catch (e) {
    set({ note: `${a.label}: ${(e as Error).message}` });
  }
}
/** How it opens: with an agent of its own, or on its own. */
export const chooseOpens = (a: CatalogApp, agent: boolean): Promise<void> =>
  !!a.opens_with_agent === agent ? Promise.resolve() : setting(a, { agent }, () => ({ opens_with_agent: agent }));
/** What "+" on an actor or a task does with it. */
export const chooseOnTask = (a: CatalogApp, v: OnTask): Promise<void> =>
  v === a.on_task ? Promise.resolve() : setting(a, { on_task: v }, (got) => ({ on_task: got.on_task || v }));

// -- the dialogs

/** A dialog opened in place of the one open, if any. */
function show(dialog: Dialog): void {
  set({ dialog, busy: "", failure: "" });
}
const discard = (id: string): void => void post("/api/apps/discard", { id }).catch(() => {});
const staged = (d: Dialog | null): string =>
  d?.kind === "install" ? d.staged.id : d?.kind === "update" && d.staged ? d.staged.id : "";

/** The dialog open closed (an app staged for it discarded): whether one was. */
export function closeDialog(): boolean {
  const d = state().dialog;
  if (!d) return false;
  const id = staged(d);
  if (id) discard(id);
  set({ dialog: null, busy: "", failure: "" });
  return true;
}
// the dialog `d` still the one open (not closed or replaced meanwhile)
const still = (d: Dialog): boolean => state().dialog === d;

/** A step of a dialog: `busy` said while `run` runs; its failure said in it, its buttons let go again. */
async function step(d: Dialog, busy: string, run: () => Promise<void>, fail = (m: string) => m): Promise<void> {
  set({ busy, failure: "" });
  try {
    await run();
  } catch (e) {
    if (still(d)) set({ busy: "", failure: fail((e as Error).message) });
  }
}

/** "Install from a folder or git URL…": where it is asked (`source` filled in). `go`: staged at once (an entry of
 * ag's index). */
export function fromSource(source = "", go = false): void {
  const d: Dialog = { kind: "source", source };
  show(d);
  if (go && source) void stage(d, source);
}

/** The app at `source` staged, and shown as it is to be installed. */
export async function stage(d: Dialog, source: string): Promise<void> {
  const src = source.trim();
  if (!src) return set({ failure: "Enter a folder or a git URL." });
  await step(
    d,
    "Checking the app…",
    async () => {
      const st = await post<Staged>("/api/apps/stage", { source: src });
      if (!still(d)) return discard(st.id); // closed meanwhile
      if (st.installed) {
        discard(st.id);
        return set({ busy: "", failure: `${st.label} is already installed. Update it from its details.` });
      }
      show({ kind: "install", staged: st });
    },
    (m) => `Can't install it. ${m}`,
  );
}

/** A staged app installed. */
export const install = (d: Dialog & { kind: "install" }): Promise<void> =>
  step(d, "Installing…", async () => {
    await post("/api/apps/install", { id: d.staged.id });
    set({ dialog: null, busy: "" }); // (installed: nothing to discard)
    await done(`Installed ${d.staged.label}. Agents get its tools when they next start.`, d.staged.name);
  });

/** An app that comes with ag, uninstalled: asked to be installed again. */
export const confirmBuiltin = (app: CatalogApp): void => show({ kind: "builtin", app });
export const installBuiltin = (d: Dialog & { kind: "builtin" }): Promise<void> =>
  step(d, "Installing…", async () => {
    await post("/api/apps/install", { builtin: d.app.name });
    closeDialog();
    await done(`Installed ${d.app.label} again.`, d.app.name);
  });

/** Uninstall asked: what follows said first; its data kept unless ticked. `broken`: a folder that couldn't load. */
export const confirmUninstall = (app: CatalogApp, broken = false): void => show({ kind: "uninstall", app, broken });
export const uninstall = (d: Dialog & { kind: "uninstall" }, data: boolean): Promise<void> =>
  step(d, "Uninstalling…", async () => {
    await post("/api/apps/uninstall", { name: d.app.name, data });
    closeDialog();
    const kept = data ? "Its data was deleted." : `Its data is kept in ${d.app.data?.path || "its folder"}.`;
    await done(`Uninstalled ${d.app.label}. ${kept}`, null);
  });

/** Update (an app from git with a newer commit): fetched and checked first, then what changes said. */
export async function stageUpdate(app: CatalogApp): Promise<void> {
  const d: Dialog = { kind: "update", app, staged: null };
  show(d);
  set({ busy: "Fetching the latest commit…" });
  let st: Staged;
  try {
    st = await post<Staged>("/api/apps/stage", { source: app.source });
  } catch (e) {
    if (still(d)) set({ busy: "", failure: `Can't update it. ${(e as Error).message}` });
    return;
  }
  if (!still(d)) return discard(st.id);
  show({ kind: "update", app, staged: st });
}
export const update = (d: Dialog & { kind: "update" }): Promise<void> =>
  step(d, "Updating…", async () => {
    const st = d.staged!;
    await post("/api/apps/install", { id: st.id, update: true });
    set({ dialog: null, busy: "" }); // (installed: nothing to discard)
    await done(`Updated ${d.app.label} to ${st.version}.`, d.app.name);
  });

const answered = new Set<string>();
/** The first request waiting that this page hasn't shown yet, shown -- unless a dialog is open: the next one then, once
 * it is closed (the page calls this as its home is read again). `who`: how the page names an actor. `done`: told after
 * an answer. */
export function askedByAgent(requests: AgentRequest[], who: (actor: string) => string, done: () => void): void {
  if (state().dialog) return;
  const r = (requests || []).find((x) => !answered.has(x.id));
  if (!r) return;
  answered.add(r.id);
  show({ kind: "agent", request: r, who: who(r.actor), done });
}
export const answer = (d: Dialog & { kind: "agent" }, approve: boolean): Promise<void> => {
  const doing = { install: "Installing…", update: "Updating…", uninstall: "Uninstalling…" }[d.request.op] || "…";
  return step(d, approve ? doing : "Declining…", async () => {
    await post(`/api/apps/requests/${encodeURIComponent(d.request.id)}`, { approve });
    closeDialog();
    d.done();
  });
};
