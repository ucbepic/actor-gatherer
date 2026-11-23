// What the History view fetches, kept by TanStack Query (core/api/query.ts): an actor's outline (/api/outline,
// history.py's `outline`: its events, light, a page at a time -- all at first, then each time only those after the last
// kept), what the Gatherer's model made of a gatherer's history (/api/extracts), a search's hits, an opened message's
// whole text. Opening the view on an actor asks ag to build its history into tasks (an ordinary build, which the actor
// takes up at its next user message: history.build) once it has BUILD_MESSAGES user messages since its last; while a
// build runs, the outline is looked at again every few seconds, its tasks coming in when it is done -- and what the
// model makes, every two while it is being made.
import { get, post } from "../../core/api/client";
import {
  failed,
  type Event,
  type Extract,
  type Failed,
  type History,
  type Outline as Got,
  type Search,
} from "../../core/api/types";
import { queryClient } from "../../core/api/query";
import { full } from "../../core/format";
import { str, wordless } from "../../core/model/items";
import { key, parse } from "../../core/model/keys";
import { create } from "zustand";
import type { Outline, OutlineEvent } from "./tree";

/** the pages of history.py's OUTLINE_ITEMS loaded at once */
const PAGES = 10;
/** ag builds an actor's tasks once it has this many user messages since its last build */
export const BUILD_MESSAGES = 10;

/** What the page tells the view's data of itself: whether the view is shown, and whether the page is paused. */
export interface HistHost {
  shown(): boolean;
  paused(): boolean;
}
let host: HistHost = { shown: () => false, paused: () => false };
export const setHistHost = (h: HistHost) => {
  host = h;
};

const enc = encodeURIComponent;

/** The actor the view last asked a build for, since it was opened (null: none yet); what the last ask answered. */
export const useAsked = create<{
  /** the actors whose histories were asked to be built since their view was opened */
  asked: ReadonlySet<string>;
  /** how each actor's last ask went */
  built: Readonly<Record<string, { started?: boolean; running?: boolean; failed?: string }>>;
}>()(() => ({ asked: new Set<string>(), built: {} }));
export const outlineKey = (actor: string) => ["outline", actor] as const;
export const outlineOf = (actor: string | null): Outline | null =>
  actor ? (queryClient.getQueryData<Outline>(outlineKey(actor)) ?? null) : null;
const setOutline = (h: Outline) => queryClient.setQueryData(outlineKey(h.key), h);

let loading: Promise<void> = Promise.resolve();

/** `actor`'s outline loaded: what came since the last row kept (all of it, at first). One load at a time. */
export function loadOutline(actor: string | null): Promise<void> {
  const load = () => loadNow(actor);
  loading = loading.then(load, load);
  return loading;
}

async function loadNow(actor: string | null): Promise<void> {
  if (!actor || window.AG_SNAPSHOT) return;
  const { group: g, id: c } = parse(actor);
  let h: Outline = outlineOf(actor) ?? {
    key: actor,
    gatherer: g,
    channel: c,
    events: [],
    tasks: [],
    builds: {},
    last: 0,
    more: false,
    error: "",
    loaded: false,
  };
  for (let page = 0; page < PAGES; page++) {
    let got: Got | Failed;
    try {
      got = await get<Got | Failed>(`/api/outline?gatherer=${enc(g)}&channel=${enc(c)}&after=${h.last}`);
    } catch (err) {
      got = { error: `Not loaded: ${(err as Error).message}` };
    }
    if (failed(got)) {
      h = { ...h, error: got.error };
      break;
    }
    const fresh = got.events.filter((e) => e.row_id > h.last);
    h = {
      ...h,
      error: "",
      tasks: got.tasks,
      builds: got.builds || {},
      more: got.more,
      events: fresh.length ? [...h.events, ...fresh] : h.events,
      last: fresh.length ? fresh[fresh.length - 1].row_id : h.last,
    };
    if (!got.more) break;
  }
  setOutline({ ...h, loaded: true }); // what the actor had when opened is in: tasks after it came in later
  await loadExtracts(g, false); // another page's, too
  if (host.shown() && !useAsked.getState().asked.has(actor)) {
    useAsked.setState({ asked: new Set([...useAsked.getState().asked, actor]) });
    void askBuild(actor); // not waited on: it loads the outline again itself, after this load
  }
  if (outlineOf(actor)?.builds[c]?.status === "running") pollBuild(actor);
}

/** Its history built into tasks, if due; asked once each time the view is opened on it. */
async function askBuild(actor: string) {
  const h = outlineOf(actor),
    b = h?.builds[h.channel];
  if (!h || !b || b.status === "running" || b.since < BUILD_MESSAGES) return;
  setOutline({ ...h, builds: { ...h.builds, [h.channel]: { ...b, status: "running" } } }); // not asked again before the
  let got: { started?: boolean; running?: boolean; failed?: string }; //                          outline says how it went
  try {
    got = await post(`/api/history/build`, { gatherer: h.gatherer, channel: h.channel });
  } catch (err) {
    got = { failed: (err as Error).message };
  }
  useAsked.setState({ built: { ...useAsked.getState().built, [key(h.gatherer, h.channel)]: got } });
  if (got.started || got.running) {
    await loadOutline(actor);
    pollBuild(actor);
  }
}

let buildTimer: ReturnType<typeof setTimeout> | undefined;
function pollBuild(actor: string) {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => {
    if (!host.shown() || host.paused()) return;
    void loadOutline(actor);
  }, 3000);
}

/** What the Gatherer's model made of the gatherer's history, newest first (history.py's extracts). */
export type Rec = Extract;

export const extractsKey = (gatherer: string) => ["extracts", gatherer] as const;

let extractsTimer: ReturnType<typeof setTimeout> | undefined;

/** The gatherer's extracts loaded -- unless kept from the last 10 s (`fresh` false) -- and looked at again every 2 s while
 * one is being made. */
export async function loadExtracts(gatherer: string, fresh = true): Promise<void> {
  try {
    await queryClient.fetchQuery({
      queryKey: extractsKey(gatherer),
      queryFn: () => get<Rec[]>(`/api/extracts?gatherer=${enc(gatherer)}`),
      staleTime: fresh ? 0 : 10_000,
    });
  } catch {
    /* kept as it was */
  }
  if ((queryClient.getQueryData<Rec[]>(extractsKey(gatherer)) || []).some((r) => r.status === "running"))
    pollExtracts(gatherer);
}

/** The gatherer's extracts looked at again in 2 s (unless the page is paused). */
export function pollExtracts(gatherer: string): void {
  clearTimeout(extractsTimer);
  extractsTimer = setTimeout(() => {
    if (!host.paused()) void loadExtracts(gatherer);
  }, 2000);
}

/** The extracts kept for `gatherer` changed here (one made, one deleted), before the server says so. */
export const setExtracts = (gatherer: string, change: (list: Rec[]) => Rec[]) =>
  queryClient.setQueryData<Rec[]>(extractsKey(gatherer), (list) => change(list || []));

/** A tool call opened, as its input reads: its tool, then its command (a shell's), else its fields one by one. */
export function callInput(p: { name?: string | null; input?: unknown }): string {
  const inp = p.input;
  if (!inp || typeof inp !== "object") return [p.name, str(inp)].filter(Boolean).join("\n\n");
  const o = inp as Record<string, unknown>;
  const cmd = typeof o.command === "string" ? o.command : Array.isArray(o.command) ? o.command.join(" ") : null;
  const rest = Object.entries(o).filter(([k]) => k !== "description" && (cmd === null || k !== "command"));
  return [
    p.name,
    ...(cmd !== null ? [cmd] : []),
    ...rest.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`),
  ].join("\n\n");
}

export const fullTextKey = (gatherer: string, e: OutlineEvent) =>
  ["event-text", gatherer, e.channel, e.row_id] as const;

/** An event's whole text, as an opened message shows it: a tool call's input, else its words (cut, and said so). */
export async function fetchFullText(gatherer: string, e: OutlineEvent): Promise<string> {
  try {
    if (e.type === "tool_call") {
      const got = await get<Event | Failed>(`/api/event?gatherer=${enc(gatherer)}&row_id=${e.row_id}`);
      return (
        (failed(got) ? [] : got.parts)
          .filter((p) => p.kind === "call")
          .map(callInput)
          .join("\n\n") || "(no input)"
      );
    }
    const got = await get<History | Failed>(
      `/api/history?gatherer=${enc(gatherer)}&channel=${enc(e.channel)}&from=${e.row_id}&to=${e.row_id}`,
    );
    const it = failed(got) ? undefined : got.items[0];
    return it
      ? (it.text || `(${wordless(it)})`) + (it.clipped ? `\n… ${full(it.clipped)} more characters not shown` : "")
      : "(not found)";
  } catch (err) {
    return `Not loaded: ${(err as Error).message}`;
  }
}

/** What a search of the actor's history found: each matching row's snippet, and whether there were more. */
export interface Hits {
  hits: Map<number, string>;
  more: boolean;
}

export async function fetchHits(h: Pick<Outline, "gatherer" | "channel">, q: string): Promise<Hits> {
  let got: Search | Failed;
  try {
    got = await get(`/api/search?gatherer=${enc(h.gatherer)}&channel=${enc(h.channel)}&q=${enc(q)}`);
  } catch {
    got = { hits: [], more: false };
  }
  return failed(got)
    ? { hits: new Map(), more: false }
    : { hits: new Map(got.hits.map((x) => [x.row_id, x.snippet])), more: got.more };
}
