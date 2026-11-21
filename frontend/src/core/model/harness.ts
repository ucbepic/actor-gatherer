// Each harness as harness_kit describes it (data.py's `harness_info`, in the home), by its name: the page names none
// itself. Read here for any view from the home it is given; the old page's modules (core/page/helpers.js) with the
// page's home.
import type { HarnessInfo, Home } from "../api/types";

/** What the home says of harness `h`; null for one it does not know. */
export const harnessOf = (home: Home | null | undefined, h: string | null | undefined): HarnessInfo | null =>
  (home?.harness_info ?? {})[h ?? ""] ?? null;

/** Its name for a person. */
export const harnessLabel = (home: Home | null | undefined, h: string | null | undefined): string =>
  harnessOf(home, h)?.label || "Unknown harness";

/** Whether the dashboard runs it (harness_kit's, that says how to start it: `runs`). */
export const runsHere = (home: Home | null | undefined, h: string | null | undefined): boolean =>
  !!harnessOf(home, h)?.runs;

/** Whether an actor can be messaged here: a session the page started, or any session of a harness the dashboard runs
 * with a directory to resume it in. Its message box works while no other process has it open (data.py's `chattable`). */
export const canChat = (
  home: Home | null | undefined,
  a: { session?: unknown; harness?: string | null; cwd?: string | null } | null | undefined,
): boolean => !!a && (!!a.session || (runsHere(home, a.harness) && !!a.cwd));

/** The harnesses the dashboard runs, by their names for a person: "Claude Code, Codex or Antigravity". */
export function runnableNames(home: Home | null | undefined, join: string): string {
  const names = Object.keys(home?.harness_info ?? {})
    .filter((h) => runsHere(home, h))
    .map((h) => harnessLabel(home, h));
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} ${join} ${names[names.length - 1]}`
    : names[0] || "no harness";
}
