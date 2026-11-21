// The History view's own state: how its list is shown (grouped by tasks or not, the rows opened, the search typed, how
// many rows), what is selected -- rows of the gatherer's database, so all of it starts over for another gatherer's actor
// -- and the panel at the right: what to ask the Gatherer's model, the record opened, a record being saved. Each action
// what a click or a key does.
import { create } from "zustand";
import { post } from "../../core/api/client";
import * as prefs from "../../core/prefs";
import { loadExtracts, pollExtracts, setExtracts, useAsked, type Rec } from "./data";
import { ranges, type Selection } from "./tree";

/** the rows drawn before "show more" */
export const SHOWN = 2000;
/** the time a search waits for the typing to stop */
const SEARCH_MS = 250;

const TYPES_KEY = "ag-dashboard-history-types";

/** Saving a record where a harness reads it: which harness, where to, what each file would get (history.py's plan), and
 * how it went. */
export interface Saving {
  id: string;
  harness: string;
  target: "dir" | "user";
  dir: string;
  plan: {
    version: string;
    where: string;
    note?: string;
    harness: string;
    home?: string;
    files: { path: string; action: string; text: string }[];
  } | null;
  err: string;
  done: string[] | null;
}

interface Hist {
  /** the gatherer whose rows these are */
  gatherer: string | null;
  /** the actor the view last showed */
  actor: string | null;
  /** grouped by tasks, as the reader checked it for the actor shown; null until they do (grouped when it has tasks) */
  group: boolean | null;
  /** tasks came in while the reader looked: the list kept as it was (`stay`), Group by tasks pulsing until `until` */
  stay: string | null;
  flash: string | null;
  /** the message types listed: the reader's choice, kept in this browser */
  types: ReadonlySet<string>;
  /** what is typed in the search, and what is searched (once the typing stops) */
  q: string;
  query: string;
  open: ReadonlySet<string>;
  sel: Selection;
  /** the row clicked last: a shift-click selects from it */
  last: string | null;
  limit: number;
  /** the panel at the right shown; all records listed, not only the latest */
  panel: boolean;
  allRecs: boolean;
  recOpen: string | null;
  ask: string;
  err: string;
  busy: boolean;
  saving: Saving | null;
  /** each harness's home folder, once a plan said it */
  homes: Record<string, string>;
}

const typesAtFirst = (): Set<string> => {
  const v = prefs.list(TYPES_KEY);
  return v ? new Set(v.map(String)) : new Set(["user_message", "agent_message"]);
};

export const useHist = create<Hist>()(() => ({
  gatherer: null,
  actor: null,
  group: null,
  stay: null,
  flash: null,
  types: typesAtFirst(),
  q: "",
  query: "",
  open: new Set(),
  sel: new Map(),
  last: null,
  limit: SHOWN,
  panel: false,
  allRecs: false,
  recOpen: null,
  ask: "",
  err: "",
  busy: false,
  saving: null,
  homes: {},
}));

const set = useHist.setState,
  now = useHist.getState;

/** The view opened again: built again if due, and at its tasks if it has them. */
export function viewOpened(): void {
  useAsked.setState({ askedFor: null });
  set({ group: null, stay: null });
}

/** The view drawn for `actor` of `gatherer`: another actor's grouped by its tasks if it has them; another gatherer's
 * rows none picked, opened or read yet. */
export function showing(actor: string, gatherer: string): void {
  const s = now();
  if (s.gatherer !== gatherer)
    set({ gatherer, sel: new Map(), last: null, panel: false, open: new Set(), saving: null, recOpen: null });
  if (s.actor !== actor) set({ actor, group: null, stay: null });
}

export function setGroup(on: boolean): void {
  set({ group: on, stay: null, limit: SHOWN });
}

/** Tasks came in for `key` while it was shown ungrouped by choice of none: kept so, and the box pulsing a while. */
let flashing: ReturnType<typeof setTimeout> | undefined;
export function tasksCame(key: string): void {
  set({ flash: key, ...(now().group === null ? { stay: key } : {}) });
  clearTimeout(flashing);
  flashing = setTimeout(() => set({ flash: null }), 2700);
}

export function toggleType(type: string): void {
  const types = new Set(now().types);
  if (types.has(type)) types.delete(type);
  else types.add(type);
  prefs.keep(TYPES_KEY, [...types]);
  set({ types });
}

export function toggleOpen(id: string): void {
  const open = new Set(now().open);
  if (open.has(id)) open.delete(id);
  else open.add(id);
  set({ open });
}

let searching: ReturnType<typeof setTimeout> | undefined;
export function search(q: string): void {
  set({ q });
  clearTimeout(searching);
  searching = setTimeout(() => set({ query: q.trim(), limit: SHOWN }), SEARCH_MS);
}

export const showMore = () => set({ limit: now().limit + SHOWN });

/** What is selected now; the panel shown while anything is, and while a record it asked for is being made or opened. */
export function select(sel: Selection, making = false, last?: string | null): void {
  const s = now();
  set({
    sel,
    ...(last !== undefined ? { last } : {}),
    panel: sel.size ? true : s.recOpen || making ? s.panel : false,
  });
}

/** The panel closed, and all it showed. */
export function closePanel(): void {
  set({ panel: false, recOpen: null, saving: null, sel: new Map() });
}

export const setAsk = (ask: string) => set({ ask });
export const setSaving = (saving: Saving | null) => set({ saving });
export const toggleAllRecs = () => set({ allRecs: !now().allRecs });

/** The selected rows given to the Gatherer's model, as a record of `kind` -- or a record's own again (`again`). */
export async function make(gatherer: string, kind: string, again: Rec | null = null): Promise<void> {
  const s = now();
  if (s.busy || (!again && !s.sel.size)) return;
  set({ busy: true, err: "" });
  try {
    const rec = await post<Rec>(
      "/api/history/extract",
      again
        ? { gatherer: again.gatherer, kind: again.kind, rows: again.rows, ask: again.ask }
        : { gatherer, kind, rows: ranges(s.sel.keys()), ask: s.ask.trim() },
    );
    setExtracts(rec.gatherer, (list) => [rec, ...list]);
    set({ recOpen: rec.id, panel: true });
    pollExtracts(rec.gatherer);
  } catch (err) {
    set({ err: (err as Error).message });
  } finally {
    set({ busy: false });
  }
}

/** The selected rows saved as a file of `fmt`. */
export async function exportRows(
  gatherer: string,
  fmt: "md" | "json",
  save: (name: string, text: string, type: string) => void,
) {
  const s = now();
  if (!s.sel.size) return;
  try {
    const got = await post<{ name: string; text: string }>("/api/history/export", {
      gatherer,
      rows: ranges(s.sel.keys()),
      format: fmt,
    });
    save(got.name, got.text, fmt === "json" ? "application/json" : "text/markdown");
    set({ err: "" });
  } catch (err) {
    set({ err: `Not exported: ${(err as Error).message}` });
  }
}

export async function deleteRec(r: Rec): Promise<void> {
  try {
    await post("/api/history/delete", { id: r.id });
  } catch {
    /* gone already */
  }
  setExtracts(r.gatherer, (list) => list.filter((x) => x.id !== r.id));
}

/** Where a record would be saved, and what each file would get: nothing written yet. */
export async function planSave(r: Rec): Promise<void> {
  const sv = now().saving;
  if (!sv || sv.id !== r.id) return;
  let next: Saving = { ...sv, err: "", done: null };
  try {
    next = {
      ...next,
      plan: await post("/api/history/save", { id: r.id, target: sv.target, dir: sv.dir, harness: sv.harness }),
    };
  } catch (err) {
    next = { ...next, plan: null, err: (err as Error).message };
  }
  if (now().saving?.id !== r.id) return;
  set({
    saving: next,
    ...(next.plan?.home ? { homes: { ...now().homes, [next.plan.harness]: next.plan.home } } : {}),
  });
}

/** The plan seen written. */
export async function writeSave(r: Rec): Promise<void> {
  const sv = now().saving;
  if (!sv || !sv.plan) return;
  try {
    const got = await post<{ saved: string[] }>("/api/history/save", {
      id: r.id,
      target: sv.target,
      dir: sv.dir,
      harness: sv.harness,
      version: sv.plan.version,
    });
    set({ saving: { ...sv, done: got.saved, err: "" } });
    await loadExtracts(r.gatherer);
  } catch (err) {
    const msg = (err as Error).message;
    set({ saving: { ...sv, err: msg, plan: /changed since/.test(msg) ? null : sv.plan } });
  }
}
