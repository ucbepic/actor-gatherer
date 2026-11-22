// LINKS clicked in an actor's pane -- in a message, in its terminal. A link to a web page opened in a Browser of that
// actor's task, by app_kit's open-url intent (the Browser's panel takes it): the Browser attached to the actor -- the one
// whose panel shows, if several are -- in a new tab; with none, a new Browser in the actor's folder, put in its task (an
// actor alone made a task with it: task_links.py), opened at the link. Its panel shown above, selected; the actor's task
// entered first, if another is shown. Left as they were: a link to this dashboard or to no web page (mailto:, file:), a
// click with a key held (⌘, Ctrl, Shift, ⌥) or another button -- a tab of the browser's own, in the ag app the user's
// browser -- and a link where there is no agent to give a Browser: a terminal of its own, the gatherer agent's. A link to
// something in an app (ag://) or to a file opened in the app there (openAppLink, openFileLink).
import { isShell, key } from "../../core/model/keys";
import { paneNote } from "./heads";
import { L, panes, snap, state, gathererNamed } from "./link";
import { webLink, plainClick } from "./link-rules";
import { selectAppPane, selectedTask, taskKey } from "./open";
import { instOf, showAppPanel } from "./app-panels";
import { cwdOf } from "./start-rules";
import type { Actor, AppManifest, AppPanel, Gatherer, Instance, Pane } from "./types";

const LINK_APP = "browser";
const linkOpening = new Map<string, Promise<unknown>>(), // per actor: its links, opened one after another; the Browser
  linkMade = new Map<string, string>(); // a link made it (attachedTo's read may be a second old)
const appLink = (href: string) => L.appLinks.isAppHref(href);
const fileLink = (href: string) => !!L.appLinks.filePath(href); // a file's path (openFileLink)

/** Whether the page takes a click on a link to `href` shown with the actor of pane `p` (the one clicked in; this page's
 * own, by default). A link to something in an app (ag://, openAppLink), or to a file -- file://, or a path in what an
 * agent wrote (`path`: one Chat drew from its words, core/ui/md.ts's data-path; not one of the dashboard's own, as
 * /api/image?…): openFileLink -- always, whatever key is held: never the browser's to open. */
export function linkClicked(href: string, ev: MouseEvent | null, path = false, p: Pane | null = null): boolean {
  const pane = p || L.paneView.paneAt(ev?.target) || panes.here,
    sel = pane.g && pane.c ? [pane.g, pane.c] : [];
  if (appLink(href) || (fileLink(href) && (path || /^file:/i.test(String(href).trim())))) {
    if (ev && ev.button) return true; // another button: nothing opened (nor by the browser)
    openLink(sel[0] || state.home?.gatherers[0]?.name || "", sel[1] || null, String(href).trim());
    return true;
  }
  const url = webLink(href, location.href);
  if (!url || !plainClick(ev) || snap() || !sel.length) return false;
  return openLink(sel[0], sel[1], url);
}
/** `url` opened for actor `c` of `gname`, if a Browser can be given it: false, nothing done (a link to something in an
 * app: opened there; a file's path: in an app that shows files). */
function openLink(gname: string, c: string | null, url: string): boolean {
  if (appLink(url)) {
    openAppLink(gname, c, url).catch((e: Error) => paneNote(e.message));
    return true;
  }
  if (fileLink(url)) {
    openFileLink(gname, c, url).catch((e: Error) => paneNote(e.message));
    return true;
  }
  const g = gathererNamed(gname);
  const a = g && c && !isShell(c) ? L.list.actorOf(g, c) : null;
  const app = L.appHost.named(LINK_APP);
  if (!g || !a || !app || L.list.isCoordinator(a)) return false;
  const k = key(gname, a.channel);
  const next = (linkOpening.get(k) || Promise.resolve())
    .then(() => linkInBrowser(g, a, app, url))
    .catch((e: Error) => paneNote(`${app.label}: ${e.message}`));
  linkOpening.set(k, next);
  return true;
}
async function linkInBrowser(g: Gatherer, a: Actor, app: AppManifest, url: string): Promise<void> {
  await L.list.showItemsTask(g, a.channel);
  const k = key(g.name, a.channel),
    made = linkMade.get(k);
  const had = (await L.appHost.attachedTo(g.name, a.channel)).filter((i) => i.app === app.name);
  const shown = (id: string | undefined) => panes.apps.find((p) => !p.held && p.instance.id === id);
  let inst: Instance | null = had.find((i) => shown(i.id)) || (made && shown(made)?.instance) || had[0] || null;
  if (!inst) {
    const was = selectedTask();
    inst = await L.appHost.open(app.name, g.name, cwdOf(a) || null, a.channel);
    linkMade.set(k, inst.id);
    await L.list.readApps(g.name, true); // the task it made, as the server has it now
    L.list.retask(was);
  }
  const p = showAppPanel(app, inst);
  selectAppPane(p);
  p?.panel.intent("open-url", { url }); // held by the panel's host until a new panel has connected
}

// A LINK TO SOMETHING IN AN APP (`ag://<app>/<path>[?instance=<id>][#<part>]`, app_kit/links.py) -- clicked in an actor's
// pane (`c`, the actor whose message it is in), or opened by a panel (the SDK's ag.links.open; `from`: its instance's
// folder and item) -- opened in the app: its panel shown, selected, and handed the link (its `link` intent: the SDK's
// ag.links.onOpen), which takes it there. Only a path of a form the app's manifest lists ([[links]]).
// THE INSTANCE, the first of:
//   1. the one the link names, if it is still open in the gatherer;
//   2. for an actor's link, one of its task's (one attached to it: the one whose panel shows, of several);
//   3. one whose panel is shown;
//   4. one open in the gatherer -- one that opens here (in no task, or in this one) before one of another task, and of
//      those one on the actor's folder (the panel's) first;
//   5. the gatherer's for that folder, from the server: one that opens a new one only where the gatherer has none of the
//      app (or none for the folder, of an app with one per folder) -- put in no task.
// WHERE: its panel shown, it is selected there; else, an instance of another task, that task shown as a click on the
// app's row shows it (the list's selectApp) -- as a notification of the app's is opened; else its panel opened above what
// is shown. A click calls no tool and attaches no agent: the user only looks. What can't be opened: an error saying why.
export async function openAppLink(
  gname: string,
  c: string | null,
  href: string,
  from: { folder?: string | null; item?: string } = {},
): Promise<void> {
  const h = L.appLinks.parseHref(href);
  if (!h) throw new Error(`Not a link to anything in an app: ${href}`);
  const app = L.appHost.named(h.app);
  if (!app || app.failed) throw new Error(`No app called ${h.app} here, to open ${href}`);
  const m = L.appLinks.matchPath(app.links, h.path);
  if (!m) throw new Error(`${app.label}: no such place to open (${h.path || "nothing"})`);
  const g = gathererNamed(gname);
  if (!g || snap()) return;
  const a = c && !isShell(c) ? L.list.actorOf(g, c) : null;
  const here = a ? taskKey(gname, a.channel) : from.item ? taskKey(gname, from.item) : selectedTask();
  const shown = (id: string) => panes.apps.find((q) => !q.held && q.instance.id === id);
  const elsewhere = (id: string) => L.list.appTaskOf(gname, id) !== null && taskKey(gname, L.list.appItem(id)) !== here;
  const folder = (a && cwdOf(a)) || from.folder || null;
  let inst: Instance | null = null;
  if (h.instance) {
    inst = await L.appHost.instanceOf(app.name, gname, h.instance);
    if (!inst) throw new Error(`${app.label}: that one (${h.instance}) is closed`);
  }
  if (!inst && a) {
    const had = (await L.appHost.attachedTo(gname, a.channel)).filter((i) => i.app === app.name);
    inst = had.find((i) => shown(i.id)) || had[0] || null;
  }
  if (!inst) {
    const p = panes.apps.find((q) => !q.held && q.app.name === app.name && q.instance.gatherer === gname);
    if (p) inst = p.instance;
  }
  if (!inst) {
    await L.list.readApps(gname);
    const open = L.list.gathererApps(gname).filter((o) => o.app.name === app.name);
    const onFolder = (list: typeof open) => (folder && list.find((o) => o.folder === folder)) || list[0];
    const o = onFolder(open.filter((x) => !elsewhere(x.id))) || onFolder(open.filter((x) => elsewhere(x.id)));
    if (o) inst = instOf(o);
  }
  let fresh = false;
  if (!inst) {
    inst = await L.appHost.open(app.name, gname, folder);
    fresh = true;
  }
  const id = inst.id;
  let p: AppPanel | null = shown(id) || null;
  if (!p && elsewhere(id)) {
    // another task's: that task shown, its panel there
    let o = L.list.appInfo(gname, id);
    if (!o) {
      await L.list.readApps(gname, true);
      o = L.list.appInfo(gname, id);
    }
    if (!o) throw new Error(`${app.label}: closed`);
    await L.list.selectApp(gname, o);
    p = panes.apps.find((q) => q.instance.id === id) || null;
    if (!p) throw new Error(`${app.label}: not shown`);
  } else if (!p) {
    fresh = !panes.apps.some((q) => q.instance.id === id);
    p = showAppPanel(app, inst);
    selectAppPane(p);
  } else selectAppPane(p);
  // held by the panel's host until a panel just opened has connected
  p?.panel.intent("link", { href: h.href, path: h.path, part: h.part, values: m.values, form: m.form });
  if (fresh) await L.list.readApps(gname, true); // the list's rows, the app now open
}
/** A FILE'S PATH an agent wrote (features/apps/links.ts's `file`: `[parser.py](src/parser.py#L12)`, file:///…, a path its
 * terminal marks as a link) opened as a link to it (openAppLink) in an app that shows files -- one whose [[links]] take
 * `file/<path...>` (FILE_FORM): the one whose FILE_FORM says `paths` (the app files open in, as its manifest says), else
 * of several, one the actor has open, else the first installed. A relative path is from the actor's folder (a panel's:
 * its instance's). None installed: an error saying so. */
async function openFileLink(gname: string, c: string | null, href: string, from: { folder?: string | null } = {}) {
  const f = L.appLinks.filePath(href);
  if (!f) throw new Error(`Not a file's path: ${href}`);
  const g = gathererNamed(gname);
  if (!g || snap()) return;
  const a = c && !isShell(c) ? L.list.actorOf(g, c) : null;
  let path = f.path;
  if (!path.startsWith("/")) {
    const base = (a && cwdOf(a)) || from.folder;
    if (!base) throw new Error(`${path}: from which folder isn't known`);
    path = L.appLinks.joinPath(base, path);
  }
  const FORM = L.appLinks.FILE_FORM;
  const takers = L.appHost.found().filter((x) => !x.failed && (x.links || []).some((l) => l.form === FORM));
  if (!takers.length) throw new Error(`No app here opens files, to open ${path}`);
  const plain = takers.find((x) => (x.links || []).some((l) => l.form === FORM && l.paths));
  let app = plain || takers[0];
  if (!plain && takers.length > 1 && a) {
    const had = await L.appHost.attachedTo(gname, a.channel);
    app = takers.find((x) => had.some((i) => i.app === x.name)) || app;
  }
  await openAppLink(gname, c, L.appLinks.fileHref(app.name, path, f.line), from);
}

/** Links clicked in the panes opened so from now on: once, as the page starts. */
export function startLinks(): void {
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
      if (!a || a.hasAttribute("download") || ev.defaultPrevented || !a.closest("#panes > .pane")) return;
      if (!linkClicked(a.getAttribute("href") || "", ev, a.hasAttribute("data-path"))) return;
      ev.preventDefault();
      ev.stopPropagation(); // a link's click: not also its message's
    },
    true,
  );
}
