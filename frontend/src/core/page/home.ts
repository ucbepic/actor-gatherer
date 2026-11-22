// What the page looks up in its home: a gatherer by its name, the actor of its own pane, a shell, whether a session can
// be closed.
import { tildePath } from "../ui/highlight";
import { isShell } from "../model/keys";
import { closable as closableIn } from "../model/session";
import { SNAPSHOT, state } from "./state";
import type { PageActor, PageGatherer, PageShell } from "./types";

/** Whether the dashboard runs a process for the session -- its agent, mid-turn or not, or its terminal -- or kept it,
 * idle, from a restart, or it ran and is listed open with no process now (used since it ended: an app's note to it,
 * say), and no process outside has it: it can be closed from the list (core/model/session.ts). */
export const closable = (a: Parameters<typeof closableIn>[0]): boolean => closableIn(a, !!SNAPSHOT);

/** A shell: the user's own shell in a terminal, opened from a gatherer's row (sessions.py's `shell`) and listed under
 * it -- no actor, but shown as one is, in a pane, by its id in a channel's place ("shell:…", which no channel is). */
export const shellOf = (c: unknown): PageShell | null =>
  (isShell(c) && state.home && (state.home.shells || []).find((s) => s.id === c)) || null;
/** Where a shell runs, as the page writes a path. */
export const shellPath = (s: PageShell): string => tildePath(s.cwd, state.home ? state.home.home_dir : undefined);

/** The gatherer of the home now named `name`; null for none (core/model/keys.ts keys its items by its name). */
export const gathererNamed = (name: string | null | undefined): PageGatherer | null =>
  (state.home && state.home.gatherers.find((x) => x.name === name)) || null;

/** The actor of this page's own pane, as the home has it now. */
export const selectedInfo = (): PageActor | null => {
  if (!state.selected || !state.home) return null;
  const [g, c] = state.selected;
  return (gathererNamed(g) || { agents: [] as PageActor[] }).agents.find((x) => x.channel === c) || null;
};
