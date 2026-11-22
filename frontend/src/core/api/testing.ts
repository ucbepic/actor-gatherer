// The server's answers, whole, for tests: each type's fields that are always there given a plain value -- empty, none,
// at rest -- and what a test gives over them, so a test says only what it is about, and its answers keep the server's
// shape (./types.gen.ts) as it changes.
import type * as api from "./types";

export const harnessInfoOf = (more: Partial<api.HarnessInfo> = {}): api.HarnessInfo => ({
  label: "Harness",
  mark: null,
  runs: true,
  fullscreen: false,
  stopped: { lead: "⎿", interrupted: "Interrupted", error: "Error" },
  ask_says: {
    plan_verb: "approve",
    plan_choices: [],
    plan_change: { label: "Or say what to change", title: null },
    own_answer: "Or type your own answer",
  },
  asks_shown_again: true,
  reply_block: null,
  mcp: false,
  memory_folder: null,
  saves: {},
  ...more,
});

export const homeOf = (more: Partial<api.Home> = {}): api.Home => ({
  home: "/h",
  merged: false,
  now: 0,
  running_seconds: 30,
  gatherers: [],
  hook_servers: [],
  hiding: {},
  titles: {},
  saved: {},
  folders: {},
  gatherer_folders: { folders: [], filed: {} },
  places: {},
  tasks: {},
  seen: null,
  harness_info: {},
  harness_default: "h1",
  app_groups: {},
  cwd: "/",
  permission_modes: [],
  terminals: true,
  harnesses: [],
  shells: [],
  home_dir: "/home/u",
  branches: [],
  app_requests: [],
  ...more,
});

export const gathererOf = (name: string, more: Partial<api.Gatherer> = {}): api.Gatherer => ({
  name,
  policy: null,
  agents: [],
  last: null,
  created: null,
  ...more,
});

export const actorOf = (channel: string, more: Partial<api.Actor> = {}): api.Actor => ({
  channel,
  harness: null,
  name: null,
  status: "idle",
  cwd: null,
  created: null,
  last: null,
  last_event: null,
  last_read: null,
  last_user_message: null,
  recap: null,
  events: 0,
  reads: 0,
  tasks: 0,
  est_tokens: null,
  real_tokens: null,
  limit_tokens: null,
  sent_tokens: null,
  running: false,
  building: false,
  turn_over: true,
  chattable: true,
  background: [],
  avatar: null,
  avatar_hue: null,
  avatar_motion: null,
  avatar_hello: null,
  ...more,
});

export const sessionOf = (more: Partial<api.Session> = {}): api.Session => ({
  session_id: "s1",
  gatherer: "g",
  harness: "h1",
  cwd: "/w",
  permission_mode: "auto",
  created_at: "2026-10-01T00:00:00+00:00",
  turns: 0,
  status: "stopped",
  last_error: null,
  kept: 0,
  model: null,
  started_as: null,
  ended: 0,
  role: null,
  over: null,
  harness_id: null,
  queued: [],
  terminal: false,
  answer: null,
  typed: null,
  stopped_at: null,
  shown: null,
  fullscreen: false,
  pid: null,
  since: null,
  sent: [],
  ...more,
});

export const askOf = (more: Partial<api.Ask> = {}): api.Ask => ({
  id: null,
  kind: "question",
  harness: null,
  async: false,
  at: null,
  call: null,
  ...more,
});

export const questionOf = (more: Partial<api.AskQuestion> = {}): api.AskQuestion => ({
  id: null,
  header: null,
  question: null,
  multiSelect: false,
  options: [],
  ...more,
});

/** An option of a question: its label, and nothing more said of it unless given. */
export const optionOf = (label: string, description: string | null = null): api.AskOption => ({ label, description });

export const failingOf = (more: Partial<api.Failing> = {}): api.Failing => ({
  at: 0,
  first: 0,
  attempts: 1,
  status: null,
  error: null,
  retrying: false,
  ...more,
});

export const turnOf = (n: number, more: Partial<api.Turn> = {}): api.Turn => ({
  n,
  row_id: null,
  at: null,
  end: null,
  text: "",
  replies: [],
  now: null,
  more: [],
  last: null,
  stopped: null,
  calls: 0,
  kind: "user",
  work: null,
  ...more,
});

/** A reply of the agent's: what it said, after none of its turn's calls unless given. */
export const replyOf = (more: Partial<api.Reply> & { kind: string }): api.Reply => ({ after: 0, ...more });

/** A message of the user's written while a turn ran. */
export const userMessageOf = (text: string, more: Partial<api.UserMessage> = {}): api.UserMessage => ({
  text,
  row_id: null,
  at: null,
  kind: "user",
  ...more,
});

export const callRunOf = (text: string, more: Partial<api.CallRun> = {}): api.CallRun => ({
  id: null,
  text,
  call: null,
  running: false,
  error: false,
  output: "",
  ...more,
});

export const commandOf = (text: string, more: Partial<api.Command> = {}): api.Command => ({
  text,
  call: null,
  running: false,
  error: false,
  output: "",
  files: [],
  ...more,
});

export const turnFileOf = (path: string, more: Partial<api.TurnFile> = {}): api.TurnFile => ({
  path,
  kinds: [],
  created: false,
  changed: null,
  git: [],
  sources: [],
  temporary: false,
  ...more,
});

export const sourceOf = (more: Partial<api.TurnFile["sources"][number]> = {}): api.TurnFile["sources"][number] => ({
  via: "edit",
  kind: "read",
  kinds: ["read"],
  error: false,
  call: null,
  blocks: [],
  at: null,
  changed: null,
  ...more,
});

export const currentOf = (more: Partial<api.Current> = {}): api.Current => ({
  state: "idle",
  turn: null,
  doing: null,
  failing: null,
  asking: null,
  stopped: null,
  ...more,
});

export const openingOf = (text: string, more: Partial<api.Opening> = {}): api.Opening => ({
  text,
  cid: null,
  began: 0,
  seen: false,
  unseen: false,
  ...more,
});

/** What waits for the agent's next step, sent from no send of Chat's unless given. */
export const waitsOf = (text: string, how: api.Waits["how"], cid: string | null = null): api.Waits => ({
  text,
  cid,
  how,
});

export const sentMessageOf = (text: string, more: Partial<api.SentMessage> = {}): api.SentMessage => ({
  text,
  kind: null,
  to: null,
  to_name: null,
  at: null,
  ...more,
});

export const itemOf = (more: Partial<api.Item> = {}): api.Item => ({
  position: null,
  group: "Recent history",
  name: "user_message",
  tokens: 0,
  row_id: null,
  made_id: null,
  at: null,
  clipped: 0,
  text: "",
  ...more,
});

export const historyItemOf = (more: Partial<api.HistoryItem> = {}): api.HistoryItem => ({
  row_id: null,
  name: "user_message",
  tokens: 0,
  at: null,
  clipped: 0,
  text: "",
  ...more,
});

export const readOf = (read_id: number, more: Partial<api.Read> = {}): api.Read => ({
  read_id,
  at: null,
  row_id: null,
  basis: null,
  recorded_tokens: null,
  est_tokens: null,
  real_tokens: null,
  limit_tokens: null,
  sent_tokens: null,
  preamble_tokens: null,
  tasks: 0,
  rebuild: false,
  ...more,
});

export const usageOf = (more: Partial<api.Usage> = {}): api.Usage => ({
  tokens: 0,
  entries: [],
  not_counted: 0,
  calls: 0,
  real_tokens: 0,
  real_calls: 0,
  ...more,
});

export const buildOf = (build_id: number, more: Partial<api.Build> = {}): api.Build => ({
  build_id,
  status: "done",
  started: null,
  finished: null,
  through_row: null,
  error: null,
  reason: null,
  ...more,
});

export const contextOf = (read_id: number, more: Partial<api.Context> = {}): api.Context => ({
  read_id,
  cut: null,
  at: null,
  basis: null,
  real_tokens: null,
  tokens: 0,
  preamble: [],
  not_counted: null,
  items: [],
  ...more,
});

export const outlineTaskOf = (
  channel: string,
  first_row: number,
  more: Partial<api.OutlineTask> = {},
): api.OutlineTask => ({
  channel,
  index: 0,
  name: "",
  description: null,
  first_row,
  last_row: first_row,
  tokens: null,
  ...more,
});

export const appNoticesOf = (more: Partial<api.AppNotices> = {}): api.AppNotices => ({
  app: null,
  notices: [],
  last: null,
  ...more,
});

export const noticeOf = (more: Partial<api.AppNotices["notices"][number]> = {}): api.AppNotices["notices"][number] => ({
  id: null,
  key: null,
  title: null,
  text: null,
  show: null,
  where: null,
  at: null,
  ...more,
});
