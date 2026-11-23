// What an app's panel is told, and what it asks for, worked out apart from the page (pure; Vitest: app-said.test.ts): what
// an actor asks the reader, as a panel is told it; the media type of a file an intent opens.
import type { Actor, Asking } from "./types";

const CHAT_ONLY = ["input", "view", "lines"];
/** What an actor asks the reader, as a panel is told it: while it asks (or, at work, asks without waiting), its question
 * less what only Chat draws (a permission's input, a dialog's screen, its lines). */
export function askingSaid(a: Actor): { ask: Asking | null; said: Record<string, unknown> } {
  const ask = a.status === "asking" || (a.status === "running" && a.asking?.async) ? a.asking || null : null;
  const said = Object.fromEntries(Object.entries(ask || {}).filter(([k]) => !CHAT_ONLY.includes(k)));
  return { ask, said };
}

const TYPES: Readonly<Record<string, string>> = {
  md: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  html: "text/html",
  json: "application/json",
  tex: "text/x-tex",
  ltx: "text/x-tex",
  sty: "text/x-tex",
  cls: "text/x-tex",
  bib: "text/x-bibtex",
};
/** The media type of the file an intent opens (`open-file`, its path's extension): a text type for one not known; none
 * for another intent, or a path with no extension. */
export function mediaTypeOf(kind: string, data: { path?: unknown } | null | undefined): string | undefined {
  const ext = kind === "open-file" && data && data.path ? String(data.path).split(".").pop()!.toLowerCase() : "";
  return TYPES[ext] || (ext ? "text/plain" : undefined);
}
/** The folder of the file an intent opens, for an app opened there; none, for one with no path. */
export const folderOfPath = (data: { path?: unknown } | null | undefined): string | null =>
  data && data.path ? String(data.path).replace(/\/[^/]*$/, "") : null;
