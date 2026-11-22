// ------------------------------------------------------------------ apps' actors
// An actor an app started (ag_dashboard/app_agents.py: DocWriter's, say) is an ordinary actor -- its Chat, Terminal and
// History -- attached to the app's instance, whose panel is in the row above the panes (features/layout/panes.js). The
// page knows it by its session's role (asked.ts's roleOf) and shows it as the app's manifest says, naming no app: its
// mark on the actor's avatar (`appMark`), and what it was asked, in the list, out of the message the app's page wrote
// (`appAsked`: the manifest's [asked]).
import { SNAPSHOT } from "../../core/page/state";
import { el } from "../../core/page/dom";
import { harnessBadge, harnessLogo } from "../../core/page/harness";
import type { PageActor } from "../../core/page/types";
import { askedIn, askedOfIn, roleOf, wroteIn, type AskingApp } from "./asked";
import * as appHost from "./host";

/** An app as the host lists it, with what of its manifest these read. */
type App = appHost.AppInfo & AskingApp;
const apps = (): App[] => (SNAPSHOT ? [] : (appHost.found() as App[]));

/** The actor's avatar (avatars.py), its harness's badge small at the corner; an actor with none (no picture to give, or
 * a snapshot from before them) has its harness's mark alone. */
export function actorLogo(a: PageActor): Element {
  const svg = SNAPSHOT && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
  const src = !a.avatar
    ? null
    : SNAPSHOT
      ? svg && "data:image/svg+xml," + encodeURIComponent(svg)
      : `/avatars/${a.avatar}.svg`;
  if (!src) return harnessLogo(a.harness);
  const mark = appMark(a); // an app's actor: its app's mark
  return el(
    "span",
    { class: "logo avatar" + (mark ? " dw" : "") },
    el("img", { src, alt: "", draggable: "false" }),
    mark,
    harnessBadge(a.harness),
  );
}
/** The app and instance an actor's role names; null for an actor of none. */
export const appRole = (info: Pick<PageActor, "session"> | null | undefined): { app: string; key: string } | null =>
  roleOf(info && info.session && info.session.role);
/** The app an actor's role names, if it is one the page knows (host.ts): its manifest, as /api/apps lists it. */
const appOfActor = (info: PageActor): App | null => {
  const r = appRole(info);
  return r && !SNAPSHOT ? (appHost.named(r.app) as App | undefined) || null : null;
};
/** The app's mark on an actor's avatar: its manifest's `mark`, from the dashboard's own origin. */
function appMark(info: PageActor): HTMLImageElement | null {
  const app = appOfActor(info);
  if (!app || !app.mark) return null;
  return el("img", {
    class: "dw-badge",
    src: `/apps/mark/${encodeURIComponent(app.name)}.svg`,
    alt: app.label,
    title: app.label,
    draggable: "false",
  });
}
/** What in an app a message an app wrote is about (a Notes line): {app, item}; null for none. */
export const appAskedOf = (text: unknown): { app: string; item: string } | null => askedOfIn(apps(), text);
/** Such a message shown in Chat by the user's words alone: the first group of its `pattern` -- under where in the app it
 * came from, with the app's mark, when the pattern has a second group (a Notes page's title); null, any other. */
export function appWordsOf(text: unknown): HTMLSpanElement | null {
  const got = wroteIn(apps(), text),
    m = got && got.m;
  if (!got || !m || !m[1]) return null;
  if (!m[2]) return el("span", { class: "tx" }, m[1]);
  const app = got.app;
  return el(
    "span",
    { class: "tx app-said" },
    el(
      "span",
      { class: "app-from" },
      app.mark
        ? el("img", { src: `/apps/mark/${encodeURIComponent(app.name)}.svg`, alt: "", draggable: "false" })
        : null,
      `From ${app.label} · ${m[2].replace(/\\(.)/g, "$1")}`,
    ),
    el("span", { class: "app-words" }, m[1]),
  );
}
/** What an actor was asked, as the list shows it: an app's words in a message it wrote, any other message as it is. */
export const appAsked = (_info: unknown, text: string | null | undefined): string | null | undefined =>
  askedIn(apps(), text);
