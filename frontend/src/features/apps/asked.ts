// What the page reads of an app's actor and of a message an app wrote, worked out apart from the page: the app and
// instance an actor's role names, and which app wrote a message and what it says in it (the manifest's [asked]).

/** An app as its manifest says (the apps' host's), as far as these read it. */
export interface AskingApp {
  name: string;
  label: string;
  /** it has a mark of its own (the manifest's `mark`) */
  mark?: unknown;
  /** how a message it writes is known and shown: it holds `when`; `pattern`'s groups are the user's words, where in
   * the app it came from (a Notes page's title), what in the app it is about (a Notes line); `otherwise`, said when the
   * pattern does not match */
  asked?: { when?: string; pattern?: string; otherwise?: string } | null;
}

/** The app and instance an actor's session's role names (app_agents.py): {"app": name, "key": instance}, or the
 * app's own older form, {"<name>": key}; null for an actor of none. */
export function roleOf(raw: string | null | undefined): { app: string; key: string } | null {
  if (!raw || raw[0] !== "{") return null;
  try {
    const r = JSON.parse(raw);
    if (r && typeof r.app === "string" && typeof r.key === "string") return { app: r.app, key: r.key };
    const ks = r ? Object.keys(r) : [];
    return ks.length === 1 && typeof r[ks[0]] === "string" ? { app: ks[0], key: r[ks[0]] } : null;
  } catch {
    return null;
  }
}

/** The app of `apps` that wrote a message (one holding its [asked] `when`), and its `pattern`'s match: {app, m}; null
 * for any other message. */
export function wroteIn<A extends AskingApp>(
  apps: readonly A[],
  text: unknown,
): { app: A; m: RegExpMatchArray | null } | null {
  if (typeof text !== "string") return null;
  for (const app of apps) {
    const a = app.asked;
    if (!a || !a.when || !text.includes(a.when)) continue;
    let m: RegExpMatchArray | null;
    try {
      m = a.pattern ? text.match(new RegExp(a.pattern)) : null;
    } catch {
      continue;
    }
    return { app, m };
  }
  return null;
}

/** What in an app such a message is about (its pattern's third group: a Notes line): {app, item}; null for none. */
export function askedOfIn(apps: readonly AskingApp[], text: unknown): { app: string; item: string } | null {
  const got = wroteIn(apps, text),
    m = got && got.m;
  return got && m && m[3] ? { app: got.app.name, item: m[3] } : null;
}

/** What an actor was asked, as the list shows it: in a message an app wrote (its [asked] `when`), the first group of
 * its `pattern`, else its `otherwise`; any other message as it is. */
export function askedIn(apps: readonly AskingApp[], text: string | null | undefined): string | null | undefined {
  const got = text ? wroteIn(apps, text) : null;
  if (!got) return text;
  return (got.m && got.m[1]) || (got.app.asked && got.app.asked.otherwise) || text;
}
