// What an item of an actor's history or context is, as the views that list them say it (Details' context, the Messages,
// History and Transcript views): its type -- a message's, by its event's name -- and the group of the context it sits in,
// each with its name and colour; and the type filter the lists share, the reader's choice kept in this browser. The old
// page's modules (core/page/helpers.js, state.js) hand the same on to the rest of it.
import { create } from "zustand";
import * as prefs from "../prefs";

/** The context's groups (data.py's names), as the page calls them. */
const LABELS: Record<string, string> = {
  "ag's sections": "Summarized history",
  "Recent history": "Recent raw history",
  "Other agents' requests": "Other actors' requests",
};
export const label = (group: string): string => LABELS[group] || group;
export const PREAMBLE = "Harness preamble",
  NOT_COUNTED = "Not counted by ag";
/** the provider's count beyond ag's, shown only when the gap is more than this: smaller is tokenizer noise */
const NOT_COUNTED_MIN = 50000;
export const uncounted = (n: number | null | undefined): number => (n && n > NOT_COUNTED_MIN ? n : 0);
export const GROUP_ORDER = [
  PREAMBLE,
  "Recent history",
  "ag's sections",
  "Kept from before the cut",
  "File-change notices",
  "Other agents' requests",
  "Stream messages",
  NOT_COUNTED,
];

/** A type: its id, its name, its colour. */
export type ItemType = readonly [id: string, name: string, swatch: string];

/** The agent's own events by type, as the lists colour and filter them; fixed order, fixed colours. */
export const TYPES: readonly ItemType[] = [
  ["user_message", "User", "var(--s7)"],
  ["agent_message", "Assistant", "var(--s1)"],
  ["tool_call", "Tool call", "var(--t-call)"],
  ["tool_output", "Tool output", "var(--t-output)"],
  ["agent_reasoning", "Reasoning", "var(--s5)"],
  ["system", "System / developer", "var(--s8)"],
  ["gatherer", "Gatherer messages", "var(--t-gatherer)"],
];
/** the harness's preamble is filtered like a type, though it is not among the messages */
export const PREAMBLE_TYPE: ItemType = ["preamble", PREAMBLE, "var(--s8)"];
export const OTHER_TYPE: ItemType = ["other", "Other", "var(--muted)"];
/** ag's own messages placed among the history -- shown in it, where ag put them */
export const INLINE: ReadonlySet<string> = new Set([
  "File-change notices",
  "Other agents' requests",
  "Stream messages",
]);
/** what the Gatherer wrote (its sections, and its messages among the history) is one type; the harness's own
 * system/developer messages (its `context` events: instructions, environment notes) another */
export const GATHERER: ReadonlySet<string> = new Set(["ag's sections", ...INLINE]);
/** events from outside the conversation */
const OUTSIDE: ReadonlySet<string> = new Set(["environment_update", "context_stream"]);
export const HISTORY: ReadonlySet<string> = new Set(["Recent history", "Kept from before the cut"]);

const typeOf = (name: string): ItemType => TYPES.find((t) => t[0] === name) || OTHER_TYPE;

/** An item's type: by the group it is in, else its event's name. */
export const itemType = (it: { group?: string | null; name?: string | null }): ItemType =>
  GATHERER.has(it.group ?? "") || OUTSIDE.has(it.name ?? "")
    ? typeOf("gatherer")
    : it.name === "context"
      ? typeOf("system")
      : typeOf(it.name ?? "");

const GROUP_COLORS: Record<string, string> = {
  [PREAMBLE]: "var(--s8)",
  [NOT_COUNTED]: "var(--axis)",
  "Gatherer guide": "var(--t-gatherer)",
};
/** A group's colour: one GROUP_ORDER does not name (or its first, index 0) takes --s6 -- there is no --s-1. */
export const color = (group: string): string =>
  GROUP_COLORS[group] || `var(--s${GROUP_ORDER.indexOf(group) > 0 ? GROUP_ORDER.indexOf(group) : 6})`;

/** What an item with no words is: a model's thinking can come back encrypted (its API reads it, no one else); a
 * model's text beside its tool call can be empty. */
export const wordless = (it: { name?: string | null }): string =>
  it.name === "agent_reasoning" ? "encrypted thinking" : "no text";

/** A value as text: a string as it is, nothing as "", anything else as JSON. */
export const str = (v: unknown): string =>
  typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);

// -4: system/developer messages and the preamble hidden by default
export const SHOWN_KEY = "ag-dashboard-shown-types-4";

function shownAtFirst(): Set<string> {
  const v = prefs.list(SHOWN_KEY);
  return v ? new Set(v.map(String)) : new Set(["user_message", "agent_message", "gatherer"]);
}

export interface Shown {
  /** the types the lists show: the reader's choice, kept in this browser; by default the conversation -- user and
   * assistant messages, and the Gatherer's */
  types: ReadonlySet<string>;
  toggle(type: string): void;
}

/** Which types the context's and the Messages view's lists show (the chips). */
export const useShown = create<Shown>()((set, get) => ({
  types: shownAtFirst(),
  toggle(type) {
    const types = new Set(get().types);
    if (types.has(type)) types.delete(type);
    else types.add(type);
    prefs.keep(SHOWN_KEY, [...types]);
    set({ types });
  },
}));
