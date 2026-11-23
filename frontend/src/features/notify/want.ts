// What wants the reader in a home, worked out apart from the page (notify.ts says it): an actor waiting for them or
// stopped on an error, an app's notification not yet seen -- each by a token naming it, the same home after home --
// what of it is new, where it is said, in what words; and a home's notifications less those dismissed here.
import type { AppNotice, PageActor, PageGatherer, PageHome } from "../../core/page/types";

/** What wants the reader: an actor (`a`, waiting: `why` "asking", or "error"), or an app instance's notification
 * (`id`, `n`; `app`, its app's name). */
export interface Want {
  g: PageGatherer;
  a?: PageActor;
  why?: "asking" | "error";
  id?: string;
  n?: AppNotice;
  app?: string;
}

/** What wants the reader in `home`, by a token naming it. `status`: an actor's status class; `seenAt`: when the reader
 * last looked at each app instance, by its key (`appKey`). */
export function wanting(
  home: PageHome,
  status: (a: PageActor) => string,
  seenAt: Readonly<Record<string, number>>,
  appKey: (gname: string, id: string) => string,
): Map<string, Want> {
  const out = new Map<string, Want>();
  for (const g of home.gatherers) {
    for (const a of g.agents) {
      const cls = status(a);
      if (cls === "asking")
        out.set(["ask", g.name, a.channel, (a.asking && (a.asking.call || a.asking.at)) || ""].join("\u0000"), {
          g,
          a,
          why: "asking",
        });
      else if (cls === "error")
        out.set(
          ["error", g.name, a.channel, (a.stopped && a.stopped.at) || (a.failing && a.failing.at) || ""].join("\u0000"),
          { g, a, why: "error" },
        );
    }
    for (const [id, got] of Object.entries(g.apps || {})) {
      const since = seenAt[appKey(g.name, id)] || 0;
      for (const n of got.notices || [])
        if ((n.at || 0) > since) out.set(["notice", g.name, id, n.id].join("\u0000"), { g, id, n, app: got.app });
    }
  }
  return out;
}

/** What wants the reader now and did not in the last home taken (`was`; null: none taken yet, so nothing is new), but
 * an actor's while the reader keeps actors' pop-ups (`actors`), nor what they have in front of them. */
export const freshOf = (
  now: Map<string, Want>,
  was: ReadonlySet<string> | null,
  actors: boolean,
  inFront: (w: Want) => boolean,
): [string, Want][] =>
  was === null ? [] : [...now].filter(([k, w]) => !was.has(k) && (!w.a || actors) && !inFront(w));

/** Whether it is said `where` -- "ag" (the page's pop-up) or "system" (the computer's): an actor's, always; an app's
 * notification, where it asked. */
export const saidWhere = (w: Want, where: string): boolean => !!w.a || (w.n?.show || []).includes(where);

/** What the page reads of an app instance and its words, to say a notification. */
export interface Words {
  appInfo(gname: string, id: string): { app: { label?: string }; name?: string; title?: string } | null;
  /** an app by its name (the apps' host's) */
  named(name: string): { label?: string } | null | undefined;
  appTitle(o: { app: { label?: string }; name?: string; title?: string }): string;
  titleOf(g: PageGatherer): string;
  actorTitle(a: PageActor): string;
}

/** What it says: [title, line, where it is]. */
export function saidOf(w: Want, words: Words): [string, string, string] {
  if (w.n) {
    const o = words.appInfo(w.g.name, w.id as string),
      info = o ? o.app : words.named(w.app as string) || {};
    const label =
      o && (o.name || (o.title && o.title !== info.label)) ? words.appTitle(o) : info.label || w.app || "An app";
    return [w.n.title as string, w.n.text || "", `${label} · ${words.titleOf(w.g)}`];
  }
  const a = w.a as PageActor;
  const who = words.actorTitle(a),
    ask = a.asking || {};
  if (w.why === "error")
    return [
      `Stopped on an error: ${who}`,
      (a.stopped && a.stopped.text) || (a.failing && a.failing.error) || "",
      words.titleOf(w.g),
    ];
  const q = Array.isArray(ask.questions) && ask.questions[0];
  return [
    `Waiting for you: ${who}`,
    ask.kind === "plan" ? "A plan to approve" : (q && (q.question || q.header)) || "A question for you",
    words.titleOf(w.g),
  ];
}

/** `home`'s notifications without those dismissed here (`gone`: a home read before the server had it so); those it no
 * longer has, forgotten from `gone`. */
export function dropGoneIn(home: PageHome | null, gone: Set<string>): void {
  if (!home || !gone.size) return;
  const still = new Set<string>();
  for (const g of home.gatherers) {
    const apps = g.apps || {};
    for (const [id, got] of Object.entries(apps)) {
      for (const n of got.notices || []) if (gone.has(n.id)) still.add(n.id);
      got.notices = (got.notices || []).filter((n) => !gone.has(n.id));
      if (!got.notices.length) delete apps[id];
      else got.last = Math.max(...got.notices.map((n) => n.at || 0)) || null;
    }
  }
  for (const k of [...gone]) if (!still.has(k)) gone.delete(k);
}
