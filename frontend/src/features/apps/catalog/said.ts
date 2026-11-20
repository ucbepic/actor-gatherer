// What the Apps page says of an app: sizes, token counts, where it came from, what it may do.
import type { CatalogApp } from "./types";

/** A size in words: "384 KB", "7.0 MB". */
export function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Tokens an agent carries for an app's tools, past which it is said in the warning colour. */
export const BIG = 5000;
/** About how many tokens: "≈8.9k", "≈350". */
export const aboutTokens = (n: number): string =>
  n >= 1000 ? `≈${(n / 1000).toFixed(1)}k` : `≈${Math.max(50, Math.round(n / 50) * 50)}`;

// a git source as its badge says it: github.com/…/repo, else its last two parts
function short(url: string): string {
  const s = url
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/+$/, "");
  const host = /^(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\/[^/]+\/(.+)$/.exec(s);
  if (host) return `${host[1]}/…/${host[2]}`;
  const parts = s.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : s;
}
const first = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** How many windows show `a`, in every group. */
export const windows = (a: CatalogApp): number => Object.values(a.open || {}).reduce((x, y) => x + y, 0);
/** Which agents may use `a`'s instances, in words. */
export const whoGets = (a: CatalogApp): string =>
  a.access === "group" ? "Every agent of a group" : "The agents in its task";

/** Its version, where it came from and its commit, in one line. */
export const fromLine = (a: CatalogApp): string =>
  [
    a.version ? `version ${a.version}` : "",
    a.origin === "builtin" ? "comes with ag" : a.source ? `from ${a.source}` : "",
    a.commit ? `at ${a.commit.slice(0, 7)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

/** What the page says of an app. */
export const said = {
  /** A count and its word: "1 tool", "19 tools". */
  count(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  },
  /** Where it came from, as its badge says it. */
  where(a: CatalogApp): string {
    if (a.origin === "builtin") return "Built in";
    if (a.origin === "path") return "AG_APPS_PATH";
    if (a.kind === "git" || a.origin === "index") return short(a.source || "");
    return "From a folder";
  },
  /** Its version and where it came from, under its name. */
  from(a: CatalogApp): string {
    const v = a.version ? `version ${a.version} · ` : "";
    if (a.origin === "builtin") return `${v}comes with ag`;
    if (a.origin === "path") return `${v}in AG_APPS_PATH`;
    return `${v}from ${a.source || "a folder"}`;
  },
  /** A phrase as a sentence. */
  sentence(t: string): string {
    const s = first((t || "").trim());
    return s && !/[.!?]$/.test(s) ? `${s}.` : s;
  },
  /** What it may do, each in words, and where its backend runs. */
  can(a: CatalogApp): string[] {
    return [
      ...(a.own_process ? ["Run its own process on this computer"] : []),
      ...(a.can || []).map(first),
      ...(a.own_process ? [] : ["Runs in the dashboard's process"]),
    ];
  },
  /** How it is kept up to date. */
  upToDate(a: CatalogApp): string {
    if (a.origin === "builtin") return "Updated with ag.";
    if (a.origin === "path") return "Updated in AG_APPS_PATH.";
    if (a.kind === "git") return `Up to date${a.commit ? ` (${a.commit.slice(0, 7)})` : ""}.`;
    return "Install it again to update.";
  },
};
