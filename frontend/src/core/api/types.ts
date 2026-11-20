// What the dashboard's routes answer, as far as the new code reads it. Written by hand until they are generated from
// the server's schema (ag_dashboard/DESIGN.md, B2).

/** /api/home, and the stream's `home`: the gatherers and their actors, and what this dashboard runs. */
export interface Home {
  home: string;
  now: number;
  gatherers: { name: string; agents: unknown[] }[];
  /** Browsers can be started here; `browser_profile` "mine": they run in the user's own Chrome. */
  browser?: boolean;
  browser_profile?: string;
  /** What the dashboard knows of each harness (data.py's harness_info, from harness_kit), as far as the new code reads it. */
  harness_info?: Record<string, HarnessInfo>;
  /** The harness taken for an actor recorded before ag recorded its harness (harness_kit's DEFAULT). */
  harness_default?: string;
  /** The group each open app is in, by its instance's id (app_host.py's `groups`): the list puts it there. */
  app_groups?: Record<string, string>;
}

/** A harness, as the dashboard reads it (harness_kit's fields). */
export interface HarnessInfo {
  /** Its name, as the page says it. */
  label?: string;
  /** Where it keeps its memory of a directory (a pattern its folders end with): the files' tree marks it. */
  memory_folder?: string;
  /** A block its model writes in a reply that its terminal draws apart (codex's proposed plan): core/ui/md.ts. */
  reply_block?: { open: string; close: string; title: string } | null;
  /** How its terminal says a turn stopped short (harness_kit's `stopped_says`): features/chat's stopped line. */
  stopped?: StoppedSays;
}

/** A harness's words for a turn stopped short: the mark before them, an interruption, an error (with its HTTP status,
 * `{status}`, when known), and other reasons it gives, by their names in the record. */
export interface StoppedSays {
  lead: string;
  interrupted: string;
  error: string;
  error_status?: string;
  reasons?: Record<string, string>;
}

/** /api/settings (settings.py's `read`): ag's config.toml as the panel shows it. */
export interface Settings {
  path: string;
  exists: boolean;
  error?: string | null;
  version: string;
  text: string;
  llm: { model: string; api_base: string; key_env: string };
  env?: Record<string, string>;
  policies: { available: string[]; default: string };
  pollers: { available: string[]; default: string[] };
  cli: { gatherer: string; harnesses: Record<string, { command?: string[]; port?: number; upstream?: string }> };
  /** After setting the model: what it runs on, in words. */
  said?: string;
}
