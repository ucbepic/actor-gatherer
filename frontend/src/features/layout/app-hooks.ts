// What an APP'S PANEL is given of the page (features/apps/host.ts's PaneHooks): the actors as the list has them, an
// attached agent's state, a message sent, a question answered, a turn stopped, an actor started or shown -- as Chat sends,
// answers and stops -- and an intent or a link it raises, opened in the app that takes it. And an app OPENED: its panel
// in the top row, the actor it is attached to below it.
import { post } from "../../core/api/client";
import { firstLine } from "../../core/format";
import { appsSelection, instOf, showAppPanel } from "./app-panels";
import { askingSaid, folderOfPath, mediaTypeOf } from "./app-said";
import { paneNote } from "./heads";
import { gathererNamed, isAt, L, panes, renderAgents, snap, state, statusOf } from "./link";
import { actorPanes, allPanes, focusPane, focusedActor, taskKey, tasksLaidOut } from "./open";
import { openAppLink } from "./pane-links";
import { pressedAway } from "./popups";
import { taskLayout } from "./remember";
import { show } from "./show";
import { cwdOf, startCwd } from "./start-rules";
import { startable } from "./starts";
import type { AppFrameHooks } from "./link";
import type { Actor, AppManifest, AppPanel, Gatherer, Instance } from "./types";

/** An actor of the home (its gatherer, its channel), as the page has it now; one renamed since (from before `ag
 * --channel`), by the channel it started as. */
export const appActor = (g: string, c: string): Actor | null =>
  gathererNamed(g)?.agents.find((a) => a.channel === c || a.started_as === c || a.session?.started_as === c) || null;

/** The actors as the list has them, for a panel that asks (the SDK's ag.actors): each one's name, avatar, hue, folder,
 * status -- what an app shows of an actor -- and what it asks the user, by gatherer; the harnesses a new one can start on
 * here; and the dashboard's own folder and the home folder. */
function appActors() {
  const h = state.home;
  if (!h) return { gatherers: [], home_dir: "", cwd: "", harnesses: [] };
  return {
    home_dir: h.home_dir || "",
    cwd: h.cwd || "",
    harnesses: startable().map((x) => ({ name: x, label: L.helpers.harnessName(x) })),
    gatherers: h.gatherers.map((g) => ({
      name: g.name,
      start_cwd: startCwd(g) || null,
      agents: g.agents.map((a) => appActorSaid(g, a)),
    })),
  };
}
/** An actor as a panel is told of it: as appActors says. What it asks: as Chat shows it, less what only Chat draws, and
 * whether its answer can be given from the page (askWhere). What its latest message is about, when an app wrote it
 * (`asked_of`: the app, and the item its [asked] pattern's third group names -- a Notes line): the item it is on now. */
function appActorSaid(g: Gatherer, a: Actor): Record<string, unknown> {
  const { ask, said } = askingSaid(a);
  return {
    channel: a.channel,
    started_as: a.session?.started_as || null,
    name: a.name || null,
    last_user_message: firstLine(L.appActors.appAsked(a, a.last_user_message || ""), 200),
    avatar: a.avatar || null,
    avatar_hue: a.avatar_hue || null,
    cwd: cwdOf(a) || null,
    last: a.last || 0,
    status: statusOf(a),
    harness: a.harness || null,
    role: a.role || null,
    over: a.over || null,
    saved: !!L.list.savedAs(g.name, a),
    turn_over: !!a.turn_over,
    asked_of: a.asked_of || L.appActors.appAskedOf(a.last_user_message || ""), // (read before the apps were: from it now)
    recap: a.recap && a.recap.text ? { text: a.recap.text, at: a.recap.at } : null,
    asking: ask ? { ...said, id: L.chat.askKey(ask) } : null,
    answerable: !!ask && L.chat.askWhere(a, ask).here,
  };
}
/** What a panel is told of an attached agent (the SDK's agents.state), as DocWriter's page was told its actor's. */
function appAgentState(g: string, c: string): Record<string, unknown> | null {
  const a = appActor(g, c);
  return (
    a && {
      channel: a.channel,
      status: statusOf(a)[0],
      turn_over: a.turn_over,
      asking: a.asking || null,
      failing: a.failing || null,
      stopped: a.stopped || null,
      name: a.name?.text || null,
      session: a.session ? { session_id: a.session.session_id, terminal: !!a.session.terminal } : null,
    }
  );
}
// A message to an attached agent, its question answered, its turn stopped -- as Chat sends, answers and stops (Esc).
const appSessionOf = (g: string, c: string) => appActor(g, c)?.session?.session_id || null;
function appSend(g: string, c: string, text: string): Promise<unknown> {
  const sid = appSessionOf(g, c);
  return post("/api/send", sid ? { session_id: sid, text } : { gatherer: g, channel: c, text });
}
const appAnswer = (g: string, c: string, call: string, choice: unknown) =>
  post("/api/answer", { session_id: appSessionOf(g, c) || c, call, choice });
function appInterrupt(g: string, c: string): Promise<unknown> {
  const sid = appSessionOf(g, c);
  return sid ? post("/api/terminal/input", { session_id: sid, data: "\u001b" }) : Promise.resolve(null);
}
/** A message to any actor of a gatherer, as Chat sends one (an app asking message_actors): "gatherer", its gatherer
 * agent, started first if it has none, as its button starts it. -> {channel}, the actor's. */
async function appSendActor(g: string, c: string, text: string): Promise<{ channel: string }> {
  const gg = gathererNamed(g);
  if (!gg) throw new Error(`no gatherer ${g}`);
  const a = c === "gatherer" ? L.list.groupCrew(gg) : appActor(g, c);
  if (a) {
    await appSend(g, a.channel, text);
    return { channel: a.channel };
  }
  if (c !== "gatherer") throw new Error(`${c}: not an actor of ${g}`);
  const s = await post<{ session_id: string }>("/api/coordinator", {
    gatherer: g,
    cwd: startCwd(gg),
    harness: startable()[0] || "",
  });
  await post("/api/send", { session_id: s.session_id, text });
  void L.data.loadHome();
  return { channel: s.session_id };
}
/** A new actor of a gatherer, started on `harness` in `folder` with `text` its first message (an app asking
 * message_actors): listed, not shown -- the reader stays where they are. -> {channel}. */
async function appStartActor(g: string, harness: string, folder: string, text: string): Promise<{ channel: string }> {
  if (!startable().includes(harness))
    throw new Error(`${harness ? L.helpers.harnessName(harness) : "No harness"} can't start an actor here`);
  if (!folder) throw new Error("which folder it works in");
  const s = await post<{ session_id: string }>("/api/sessions", { gatherer: g, cwd: folder, harness });
  await post("/api/send", { session_id: s.session_id, text });
  void L.data.loadHome();
  return { channel: s.session_id };
}
/** An actor of a gatherer shown in the pane in focus, in Chat (an app asking message_actors). */
function appShowActor(g: string, c: string): Promise<void> | void {
  const a = appActor(g, c);
  if (a) return show(g, a.channel, L.views.CHAT_VIEWS.has("files") ? "files" : null);
}
/** The message box of the actor `c` of gatherer `g`, focused, if a pane shows it: its keys taken back from a native page
 * first, in the desktop app. */
function appFocusAgent(g: string, c: string): void {
  const a = appActor(g, c),
    p = a && allPanes().find((q) => isAt([q.g, q.c], g, a.channel));
  if (!p) return;
  (window as { agApp?: { focusDashboard?: () => void } }).agApp?.focusDashboard?.();
  L.paneView.paneBox(p)?.focus();
}
/** Every hook a panel is given but its own close (app-panels.ts's addAppPane adds that). */
export function frameHooks(): Omit<AppFrameHooks, "close"> {
  return {
    intent: (kind, data, from) => appIntent(kind, data, from.instance.gatherer),
    openLink: (href, from) =>
      openAppLink(from.instance.gatherer, null, href, {
        folder: from.instance.folder,
        item: L.list.appItem(from.instance.id),
      }),
    selection: () => appsSelection(),
    agents: (g) =>
      (gathererNamed(g)?.agents || []) // a gatherer's own agent: attached to no app
        .filter((a) => !a.closed && !L.list.isCoordinator(a))
        .map((a) => ({ channel: a.channel, name: a.name?.text || a.last_user_message || a.channel })),
    agentState: appAgentState,
    send: appSend,
    answer: appAnswer,
    interrupt: appInterrupt,
    focusAgent: appFocusAgent,
    actors: appActors,
    sendActor: appSendActor,
    startActor: appStartActor,
    showActor: appShowActor,
    pressed: pressedAway, // a press in its panel
  };
}

/** The actor an app's instance is attached to, shown below it: in the pane in focus, unless one of them is open in a pane
 * already (that pane focused). None attached: the panes as they are. */
async function showAttached(p: AppPanel): Promise<void> {
  const chans = await p.panel.refresh();
  if (!chans.length) return;
  const g = p.instance.gatherer;
  const there = chans
    .map((c) => actorPanes().find((q) => isAt([q.g, q.c], g, c)) || (isAt(state.selected, g, c) ? panes.here : null))
    .find(Boolean);
  if (there) return focusPane(there);
  const agents = gathererNamed(g)?.agents || [];
  const c =
    chans.find((ch) => agents.some((a) => a.channel === ch && !a.closed)) ||
    chans.find((ch) => agents.some((a) => a.channel === ch));
  if (c) await show(g, c);
}
/** The app's instance for gatherer `g` (in `folder`: the one there, for an app with one per folder) in the top row -- its
 * panel there already, if it is open -- and the actor it is attached to below it. No agent attached by opening it:
 * attaching puts the two in one task (task_links.py), so the actor in focus would take a new instance into its task, its
 * other apps and agents with it. A task's "+" (the list's addAppToTask) or the panel's agents menu put it with agents. */
export async function openApp(g: string, name: string, folder: string | null): Promise<AppPanel | null> {
  const app = L.appHost.named(name);
  if (!app || snap()) return null;
  let instance: Instance;
  try {
    instance = await L.appHost.open(name, g, folder || null);
  } catch (e) {
    paneNote(`${app.label}: ${(e as Error).message}`);
    return null;
  }
  const p = showAppPanel(app, instance); // (one held out of sight while its agent worked: shown now)
  renderAgents();
  await L.list.readApps(g, true); // the task it is in, as the server has it now
  if (p) await showAttached(p);
  return p;
}
/** An app opened from a group's menu: as a click on its row does (the list's selectApp) -- in the tab its task is open in,
 * else in a tab of its own. */
export async function openAppTab(gname: string, name: string, folder: string | null): Promise<void> {
  const app = L.appHost.named(name);
  if (!app || snap()) return;
  let inst: Instance;
  try {
    inst = await L.appHost.open(name, gname, folder || null);
  } catch (e) {
    paneNote(`${app.label}: ${(e as Error).message}`);
    return;
  }
  await L.list.readApps(gname, true);
  const o = L.list.appInfo(gname, inst.id);
  if (o) await L.list.selectApp(gname, o, {});
  else await openApp(gname, name, folder);
}
/** An intent (app_kit's INTENTS) raised by a panel or a view: the app that takes it opened (in `g`) and told it. */
async function appIntent(kind: string, data: Record<string, unknown> | null, g: string | null): Promise<void> {
  const apps = L.appHost.handlers(kind, mediaTypeOf(kind, data)),
    app = apps[0];
  if (!app) throw new Error(`no app here takes ${kind}`);
  const into = g || (focusedActor() || [])[0] || state.home?.gatherers[0]?.name || "";
  // an app opened anew each time (instances "many": the Files app's, the LaTeX editor's) with one open above the panes:
  // that one told, not another opened -- the first of the apps that take it that has one open (a LaTeX source: a LaTeX
  // editor's, else the Files app's); none open, the first is opened as its instances say (one per folder: the file's
  // folder's)
  const open = apps
    .map(
      (a) =>
        a.instances === "many" &&
        panes.apps.find((q) => !q.held && q.app.name === a.name && q.instance.gatherer === into),
    )
    .find(Boolean);
  if (open) return open.panel.intent(kind, data || {});
  // a web page (open-url), none shown: one the gatherer has open in no task -- so no agent's: a Browser a panel's link
  // opened before, its panel closed since -- shown again and told, not another opened each time (a page needs no folder:
  // any will do; for a file, the server's open picks the instance by its folder)
  if (kind === "open-url") {
    await L.list.readApps(into, true);
    const free = L.list
      .gathererApps(into)
      .find((o) => o.app.name === app.name && L.list.appTaskOf(into, o.id) === null);
    const inst = instOf(free),
      p = inst && showAppPanel(app, inst);
    if (p) {
      renderAgents();
      return p.panel.intent(kind, data || {});
    }
  }
  const p = await openApp(into, app.name, folderOfPath(data));
  if (!p) throw new Error(`${app.label} could not be opened`);
  p.panel.intent(kind, data || {});
}
/** An actor an app started, selected: its app's panel in the top row -- shown, if held out of sight -- as a DocWriter's
 * actor showed DocWriter when it was its view. Any other actor: nothing opened. */
export async function showActorsApp(g: string, c: string): Promise<void> {
  if (snap()) return;
  const k = taskKey(g, c);
  if (k && (tasksLaidOut.has(k) || taskLayout(k))) return; // its task laid out, or remembered: its layout decides
  const r = L.appActors.appRole(gathererNamed(g)?.agents.find((a) => a.channel === c));
  const app: AppManifest | undefined = r ? L.appHost.named(r.app) : undefined;
  if (!r || !app) return;
  const there = panes.apps.find((p) => p.instance.id === r.key);
  if (there) {
    showAppPanel(app, there.instance);
    return;
  }
  const inst = await L.appHost.instanceOf(app.name, g, r.key).catch(() => null);
  if (!inst || !isAt(state.selected, g, c)) return;
  showAppPanel(app, inst);
}
