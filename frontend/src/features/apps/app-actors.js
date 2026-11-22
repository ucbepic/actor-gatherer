import { SNAPSHOT } from "../../core/page/state.js";
import { el, harnessBadge, harnessLogo } from "../../core/page/helpers.js";
import * as appHost from "./host";

// The actor's avatar (avatars.py), its harness's badge small at the corner; an actor with none (no
// picture to give, or a snapshot from before them) has its harness's mark alone.
function actorLogo(a) {
  const svg = SNAPSHOT && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
  const src = !a.avatar ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${a.avatar}.svg`;
  if (!src) return harnessLogo(a.harness);
  const mark = appMark(a);                            // an app's actor: its app's mark (features/apps/app-actors.js)
  return el("span", { class: "logo avatar" + (mark ? " dw" : "") }, el("img", { src, alt: "", draggable: "false" }),
    mark, harnessBadge(a.harness));
}
// ------------------------------------------------------------------ apps' actors
// An actor an app started (ag_dashboard/app_agents.py: DocWriter's, say) is an ordinary actor -- its Chat, Terminal and
// History -- attached to the app's instance, whose panel is in the row above the panes (features/layout/panes.js). The page knows it
// by its session's role, {"app": name, "key": instance}, or the app's own older form, {"<name>": key}, and shows it
// as the app's manifest says, naming no app: its mark on the actor's avatar (`appMark`), and what it was asked, in
// the list, out of the message the app's page wrote (`appAsked`: the manifest's [asked]).
function appRole(info) {
  const raw = info && info.session && info.session.role;
  if (!raw || raw[0] !== "{") return null;
  try {
    const r = JSON.parse(raw);
    if (r && typeof r.app === "string" && typeof r.key === "string") return { app: r.app, key: r.key };
    const ks = r ? Object.keys(r) : [];
    return ks.length === 1 && typeof r[ks[0]] === "string" ? { app: ks[0], key: r[ks[0]] } : null;
  } catch (e) { return null; }
}
// The app an actor's role names, if it is one the page knows (features/apps/host.ts): its manifest, as /api/apps lists it.
const appOfActor = (info) => {
  const r = appRole(info);
  return r && !SNAPSHOT ? appHost.named(r.app) || null : null;
};
// The app's mark on an actor's avatar: its manifest's `mark`, from the dashboard's own origin.
function appMark(info) {
  const app = appOfActor(info);
  if (!app || !app.mark) return null;
  return el("img", { class: "dw-badge", src: `/apps/mark/${encodeURIComponent(app.name)}.svg`, alt: app.label, title: app.label,
    draggable: "false" });
}
// The app that wrote a message (one holding its [asked] `when`: DocWriter's prompt, a Browser's message from before it
// was an app, a line Notes sent), and its `pattern`'s match: {app, m}; null for any other message.
function appWrote(text) {
  if (typeof text !== "string" || SNAPSHOT) return null;
  for (const app of appHost.found()) {
    const a = app.asked;
    if (!a || !a.when || !text.includes(a.when)) continue;
    let m;
    try { m = a.pattern ? text.match(new RegExp(a.pattern)) : null; } catch (e) { continue; }
    return { app, m };
  }
  return null;
}
// What in an app such a message is about (its pattern's third group: a Notes line): {app, item}; null for none.
function appAskedOf(text) {
  const got = appWrote(text), m = got && got.m;
  return m && m[3] ? { app: got.app.name, item: m[3] } : null;
}
// Such a message shown in Chat by the user's words alone: the first group of its `pattern` -- under where in the app it
// came from, with the app's mark, when the pattern has a second group (a Notes page's title); null, any other.
function appWordsOf(text) {
  const got = appWrote(text), m = got && got.m;
  if (!m || !m[1]) return null;
  if (!m[2]) return el("span", { class: "tx" }, m[1]);
  const app = got.app;
  return el("span", { class: "tx app-said" },
    el("span", { class: "app-from" },
      app.mark ? el("img", { src: `/apps/mark/${encodeURIComponent(app.name)}.svg`, alt: "", draggable: "false" }) : null,
      `From ${app.label} · ${m[2].replace(/\\(.)/g, "$1")}`),
    el("span", { class: "app-words" }, m[1]));
}
// What an actor was asked, as the list shows it: in a message an app wrote (its [asked] `when`), the first group of its
// `pattern`, else its `otherwise`; any other message as it is.
function appAsked(info, text) {
  const got = text ? appWrote(text) : null;
  if (!got) return text;
  return (got.m && got.m[1]) || got.app.asked.otherwise || text;
}
export { actorLogo, appAsked, appAskedOf, appRole, appWordsOf };
