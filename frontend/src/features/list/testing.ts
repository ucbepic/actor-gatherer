// A home and the page's facts about it, for the list's tests: what each derivation reads (ListCtx), and the reader's
// choices with nothing shown (ListView).
import { actorOf, gathererOf, homeOf } from "../../core/api/testing";
import type { ListView } from "./rows";
import type { Actor, AppItem, Gatherer, ListCtx, ListHome } from "./types";

/** An actor of gatherer `g`, at rest, seen: its key set as the page sets it. */
export const actor = (g: string, channel: string, more: Partial<Actor> = {}): Actor => ({
  ...actorOf(channel, { status: "idle", last: 100, created: 100 }),
  key: `${g}\u0000${channel}`,
  ...more,
});

export const gatherer = (name: string, agents: Actor[], more: Partial<Gatherer> = {}): Gatherer => ({
  ...gathererOf(name, { last: 1000 }),
  agents,
  ...more,
});

/** The context of `home`: every actor seen as of its last activity unless `seenAt` says otherwise; no turn opened ahead
 * (`opened`), no apps unless given. */
export function ctxOf(
  home: Partial<ListHome> & { gatherers: Gatherer[] },
  more: {
    seenAt?: Record<string, number>;
    opened?: string[];
    apps?: Record<string, AppItem[]>;
    snapshot?: boolean;
  } = {},
): ListCtx {
  const seenAt: Record<string, number> = {};
  for (const g of home.gatherers) for (const a of g.agents) if (a.key && a.last) seenAt[a.key] = a.last;
  return {
    home: { ...homeOf({ home: "/home", now: 2000 }), ...home },
    snapshot: !!more.snapshot,
    now: () => 2000,
    seenAt: { ...seenAt, ...(more.seenAt || {}) },
    opened: (a) => (more.opened || []).includes(a.channel),
    apps: (gname) => (more.apps || {})[gname] || [],
  };
}

/** An app's open instance in group `g`. */
export const app = (g: string, id: string, more: Partial<AppItem> = {}): AppItem => ({
  app: {
    name: "notepad",
    label: "Notepad",
    mark: false,
    access: "task",
    on_task: "join",
    instances: "one",
    failed: null,
  },
  id,
  title: "",
  name: "",
  folder: null,
  group: g,
  inst: {},
  ...more,
});

/** Nothing folded, opened, selected or shown; `more` over it. */
export const viewOf = (more: Partial<ListView> = {}): ListView => ({
  collapsed: new Set(),
  foldOpen: { Closed: new Set(), Saved: new Set(), Terminals: new Set() },
  crewHidden: new Set(),
  foldersOpen: new Set(),
  gfFolded: new Set(),
  picks: { g: null, cs: new Set() },
  gPicks: new Set(),
  renaming: null,
  folderEdit: null,
  folderClosing: null,
  adding: null,
  gfMaking: null,
  open: [],
  focused: null,
  selected: null,
  away: false,
  appSelected: null,
  appsOnly: null,
  selectedTask: null,
  appPanels: new Set(),
  tab: () => null,
  ...more,
});
