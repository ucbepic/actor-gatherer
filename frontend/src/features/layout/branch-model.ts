// AN ACTOR ON A BRANCH of its own (branches.py), worked out apart from the page (pure; Vitest: branch-model.test.ts):
// what a folder has checked out, where an actor's branch came from and where its changes go, how many of its changes
// wait for the reader, a source's name, the directories its group's actors work in.
import { tildePath } from "../../core/ui/highlight";
import { cwdOf } from "./start-rules";
import type { Actors, Branch, CheckedOut, Project } from "./types";

/** An actor's branch, if it has one. */
export const branchOf = (branches: Branch[] | undefined, g: string, c: string): Branch | null =>
  (branches || []).find((b) => b.gatherer === g && b.channel === c) || null;
/** Its changes waiting for the reader's approval. */
export const branchWaiting = (b: Branch): number => Object.values(b.held || {}).reduce((n, v) => n + v.n, 0);
/** What a folder has checked out (branches.py's `checked_out`): its branch, or its commit alone. */
export const checkedOut = (o: CheckedOut | null | undefined): string =>
  !o || !o.head ? "?" : o.branch || `${o.head} (no branch)`;
/** Where an actor's branch came from, and where its changes go: said whole, for a title. */
export const branchRoute = (b: Branch, home: string | undefined): string =>
  `Branch ${b.branch} in ${tildePath(b.worktree, home)}, ` +
  `from ${b.started_on || "a commit"} at ${(b.start || "").slice(0, 7)}.\n` +
  `Merges into ${tildePath(b.project, home)} (on ${checkedOut(b.onto)})` +
  `${b.approve ? " after you approve each change" : ". Lines you're editing or also changed wait for you"}.`;
/** A source's name: its GitHub repository's, else its folder's. */
export const projectName = (p: Project): string => p.github || p.name || p.path;
/** The directories a group's actors work in, the latest first, then the dashboard's own (`cwd`): where its sources are
 * suggested from. */
export const actorDirs = (g: Actors, cwd: string | undefined): string[] => [
  ...new Set(
    [...g.agents]
      .sort((x, y) => (y.last || 0) - (x.last || 0))
      .map(cwdOf)
      .filter(Boolean)
      .concat(cwd ? [cwd] : []),
  ),
];
