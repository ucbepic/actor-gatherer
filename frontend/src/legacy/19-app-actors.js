// ------------------------------------------------------------------ apps' actors
// An actor an app started (ag_dashboard/app_agents.py: DocWriter's, say) is an ordinary actor -- its Chat, Terminal and
// History -- attached to the app's instance, whose panel is in the row above the panes (07-panes.js). The page knows it
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
// The app an actor's role names, if it is one the page knows (window.agNext.apps): its manifest, as /api/apps lists it.
const appOfActor = (info) => {
  const r = appRole(info);
  return r && !PANE && !SNAPSHOT && window.agNext ? window.agNext.apps.named(r.app) || null : null;
};
// The app's mark on an actor's avatar: its manifest's `mark`, from the dashboard's own origin.
function appMark(info) {
  const app = appOfActor(info);
  if (!app || !app.mark) return null;
  return el("img", { class: "dw-badge", src: `/apps/mark/${encodeURIComponent(app.name)}.svg`, alt: app.label, title: app.label,
    draggable: "false" });
}
// What an app's actor was asked, as the list shows it: in a message holding the manifest's `when`, the first group of
// its `pattern`, else its `otherwise`; any other message as it is.
function appAsked(info, text) {
  const app = appOfActor(info), a = app && app.asked;
  if (!text || !a || !a.when || !text.includes(a.when)) return text;
  let m = null;
  try { m = a.pattern ? text.match(new RegExp(a.pattern)) : null; } catch (e) { /* the manifest's pattern: checked when read */ }
  return (m && m[1]) || a.otherwise || text;
}
