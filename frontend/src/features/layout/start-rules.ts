// What starts where, worked out apart from the page (pure; Vitest: start-rules.test.ts): the directory a new actor starts
// in, the folders a box offers a click away, what a start button's value names, which apps open with an agent of their
// own.
import { tildePath } from "../../core/ui/highlight";
import type { Actor, Actors, AppManifest } from "./types";

/** The terminal button's value, where a harness's name goes. */
export const SHELL_START = "shell";
/** An app's with an agent of its own ([agent] offered): app:<name>:<harness>. */
export const APP_START = "app:";
/** The branch button's (an actor on a branch of its own). */
export const BRANCH_START = "branch";

/** An actor's directory: its own, else (a session started here, before any call names one) its session's. */
export const cwdOf = (a: Actor): string => a.cwd || a.session?.cwd || "";
/** Where a gatherer's new actor starts: the directory of its most recently active actor that has one ("": none). */
export const startCwd = (g: Actors): string => {
  const a = g.agents.filter(cwdOf).sort((x, y) => (y.last || 0) - (x.last || 0))[0];
  return a ? cwdOf(a) : "";
};
/** The directories `g`'s actors work in, newest first, each once, from the home folder `home`. */
export function foldersOf(g: Actors, home: string | undefined): string[] {
  const seen = new Set<string>(),
    out: string[] = [];
  for (const a of [...g.agents].sort((x, y) => (y.last || 0) - (x.last || 0))) {
    const d = cwdOf(a);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(tildePath(d, home));
    }
  }
  return out;
}
/** The folders a box offers a click away under its folder box (holding `dir` to start with): up to five, none if `dir`
 * is the only one. */
export const folderPicks = (folders: string[], dir: string): string[] =>
  folders.length > 1 || (folders.length === 1 && folders[0] !== dir) ? folders.slice(0, 5) : [];
/** A folder's last part, for its line in the picks (the whole under it). */
export const lastPart = (d: string): string => d.replace(/\/+$/, "").split("/").pop() || d;

/** What a start button's value names: a terminal, an app with its agent on a harness, or an actor on a harness. */
export type StartKind =
  { kind: "shell" } | { kind: "app"; app: string; harness: string } | { kind: "actor"; harness: string };
export function startKind(value: string): StartKind {
  if (value === SHELL_START) return { kind: "shell" };
  if (value.startsWith(APP_START)) {
    const [app, ...h] = value.slice(APP_START.length).split(":");
    return { kind: "app", app, harness: h.join(":") };
  }
  return { kind: "actor", harness: value };
}

// THE APPS OFFERED, one order wherever they are listed (a group's "+ ⋯" menu, the new-tab page): each app once, by its
// name, then a terminal -- "…" only on an entry that opens a box to fill in first. An app that can have an agent of its
// own opens the way the reader chose on the Apps page (app_settings.py's `opens_with_agent`, yes until they say not):
// with a new actor attached to it (opensWithAgent), or on its own -- on its own also when no harness here can give an
// agent its tools (`tooled`).
export const byLabel = (x: AppManifest, y: AppManifest): number => x.label.localeCompare(y.label);
export const withAgentChosen = (a: AppManifest): boolean =>
  !!(a.agent && a.agent.offered && a.opens_with_agent !== false);
export const opensWithAgent = (a: AppManifest, tooled: string[]): boolean => withAgentChosen(a) && tooled.length > 0;
/** A long directory by its last two folders (the whole in its chip's title). */
export function shortDir(d: string | null | undefined): string {
  const all = String(d || ""),
    parts = all.replace(/\/+$/, "").split("/");
  return all.length > 40 && parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : all;
}
