// The page's side of an app's panel (app_kit/DESIGN.md, "Panels"; app_kit/js/app.js is the panel's side): an app's
// pane -- its head (the app, its instance, the agents attached, ×) and its iframe on the app's own origin -- and the
// bridge between them. Everything the panel asks goes through here, by postMessage, and on to the dashboard's routes
// (/api/apps/...), which check it against the app's manifest; what the panel is told (events, its backend's messages,
// the theme, the agent in focus, an intent) comes back the same way. The old page (src/legacy/07-panes.js) keeps the
// pane among its others, as it keeps an actor's.
import { get, post } from "../../core/api/client";
import { stream, type Stream } from "../../core/api/stream";
import "./apps.css";
import { desktop, nativePanes, nativeSoon, type NativePlace } from "./native";
import { ACTOR_OPS, toActors } from "./actors";
import { NOTICE_OPS, toNotices } from "./notices";
import { SPELLING_OPS, spellingOn, toSpelling } from "./spelling";
import { drawWho, nameable } from "./naming";

type Capability =
  "message_agents" | "transcript" | "edit_guard" | "native_view" | "docs" | "actors" | "notify" | "message_actors";
export interface AppInfo {
  name: string;
  label: string;
  description: string;
  origin: string;
  instances: string;
  offer?: string;
  agent?: { start: boolean; name: string };
  capabilities?: Partial<Record<Capability, boolean>>;
  tools?: { name: string; handled_by: string }[];
  handles: { intent: string; types: string[] }[];
  failed?: string | null;
}
export interface Instance {
  id: string;
  app: string;
  gatherer: string;
  folder: string | null;
  title: string;
  data: Record<string, unknown>;
  /** The user's name for it, over its title ("": none). */
  name?: string;
}
export interface Selection {
  gatherer: string;
  channel: string;
}
interface Listed {
  apps: AppInfo[];
  instances: Instance[];
  attached: Record<string, string[]>;
}
/** What the page around a pane gives it. */
export interface PaneHooks {
  close: () => void;
  focus: () => void;
  intent: (kind: string, data: Record<string, unknown>, from: AppPane) => Promise<void>;
  selection: () => Selection | null;
  /** The gatherer's actors, to attach: each one's channel and the name the list shows it by. */
  agents: (gatherer: string) => { channel: string; name: string }[];
  /** An actor as the page has it now (its status, whether its turn is over, what it asks, ...), else null. */
  agentState: (gatherer: string, channel: string) => AgentState | null;
  /** A message to an actor, as Chat sends one; its question answered, as Chat answers one. */
  send: (gatherer: string, channel: string, text: string) => Promise<unknown>;
  answer: (gatherer: string, channel: string, call: string, choice: unknown) => Promise<unknown>;
  interrupt: (gatherer: string, channel: string) => Promise<unknown>;
  /** The message box of an actor's pane focused, if one shows it (its keys taken back from a native page first). */
  focusAgent: (gatherer: string, channel: string) => void;
  /** The actors as the list shows them (an app asking `actors`): by gatherer, each one's name, avatar, folder and
   * status; and the dashboard's own folder and the home folder. */
  actors?: () => Actors;
  /** An app asking `message_actors`: a message to any actor of the gatherer, as Chat sends one ("gatherer": its
   * gatherer agent, started if it has none) -- the actor's channel; a new actor started on `harness` in `folder`, with
   * `text` its first message -- its channel; an actor shown in the pane in focus. */
  sendActor?: (gatherer: string, channel: string, text: string) => Promise<{ channel: string }>;
  startActor?: (gatherer: string, harness: string, folder: string, text: string) => Promise<{ channel: string }>;
  showActor?: (gatherer: string, channel: string) => Promise<unknown> | void;
  /** It named by the user in its head (naming.ts): the list told. */
  named?: (instance: Instance) => void;
}
/** What a panel asking `actors` is told of them (the SDK's ag.actors). */
export interface Actors {
  gatherers: { name: string; agents: Record<string, unknown>[] }[];
  home_dir: string;
  cwd: string;
}
/** What a panel is told of an attached agent (the SDK's agents.state). */
export interface AgentState {
  channel?: string;
  status?: string;
  turn_over?: boolean;
  asking?: unknown;
  failing?: unknown;
  stopped?: unknown;
  session?: { session_id?: string; terminal?: boolean } | null;
  name?: string | null;
}
type Msg = Record<string, unknown> & { ag?: number; id?: number; op?: string };

/** The theme's colours a panel is given, as the dashboard's own page has them now. */
const THEME_VARS = [
  "--page",
  "--surface",
  "--side",
  "--ink",
  "--ink-2",
  "--muted",
  "--grid",
  "--axis",
  "--ring",
  "--wash",
  "--good",
  "--warning",
  "--critical",
  "--selected",
  "--md-link",
  "--md-code",
  "--hl-com",
  "--hl-kw",
  "--hl-str",
  "--hl-num",
  "--hl-fn",
  "--hl-prop",
  "--hl-meta",
  "--hl-bg",
  "--scroll",
];

let listed: Listed = { apps: [], instances: [], attached: {} };

/** The apps found, read again (the gatherer's instances too, given one). */
export async function load(gatherer?: string): Promise<AppInfo[]> {
  try {
    listed = await get<Listed>("/api/apps" + (gatherer ? `?gatherer=${encodeURIComponent(gatherer)}` : ""));
  } catch {
    listed = { apps: [], instances: [], attached: {} };
  }
  return listed.apps;
}
export const found = (): AppInfo[] => listed.apps;
export const named = (name: string): AppInfo | undefined => listed.apps.find((a) => a.name === name);

/** The app's instance for a gatherer and folder (the open one, where it has one per folder), `channel` attached. */
export const open = (app: string, gatherer: string, folder: string | null, channel?: string | null) =>
  post<Instance>("/api/apps/open", { app, gatherer, folder, ...(channel ? { channel } : {}) });

/** The instance, if it is still open in its gatherer. */
export async function instanceOf(app: string, gatherer: string, id: string): Promise<Instance | null> {
  const got = await get<Listed>(`/api/apps?gatherer=${encodeURIComponent(gatherer)}`).catch(() => null);
  return (got && got.instances.find((i) => i.id === id && i.app === app)) || null;
}

/** The instances an agent (gatherer, channel) is attached to, as the host has them (read at most once a second). */
const attachedRead = new Map<string, { at: number; got: Promise<Listed | null> }>();
export async function attachedTo(gatherer: string, channel: string): Promise<Instance[]> {
  let r = attachedRead.get(gatherer);
  if (!r || Date.now() - r.at > 1000) {
    r = { at: Date.now(), got: get<Listed>(`/api/apps?gatherer=${encodeURIComponent(gatherer)}`).catch(() => null) };
    attachedRead.set(gatherer, r);
  }
  const got = await r.got;
  return got ? got.instances.filter((i) => (got.attached[i.id] || []).includes(channel)) : [];
}

/** An app whose manifest starts an agent of its own ([agent] start): a new instance in `cwd`, and a new actor there
 * (on `harness`) attached to it -> the instance and the actor's session. */
export const start = (app: string, gatherer: string, cwd: string, harness: string) =>
  post<{ instance: Instance; session: { session_id: string; gatherer: string } }>("/api/apps/start", {
    app,
    gatherer,
    cwd,
    harness,
  });

/** The app that takes an intent of `kind` (for open-file: a file of that media type): one that names the type first,
 * else one that takes any -- the first found of each. */
export function handler(kind: string, mediaType?: string): AppInfo | undefined {
  const names = (t: string) =>
    mediaType !== undefined && (t === mediaType || (t.endsWith("/*") && mediaType.startsWith(t.slice(0, -1))));
  return (
    listed.apps.find((a) => a.handles.some((h) => h.intent === kind && h.types.some(names))) ||
    listed.apps.find((a) => a.handles.some((h) => h.intent === kind && !h.types.length))
  );
}

export function theme(): { mode: string; vars: Record<string, string> } {
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const picked = root.dataset.theme;
  const mode =
    picked === "dark" || picked === "light"
      ? picked
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  return {
    mode,
    vars: Object.fromEntries(THEME_VARS.map((v) => [v, css.getPropertyValue(v).trim()]).filter(([, x]) => x)),
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** One app's pane: its head, its frame, and the bridge to the panel in it. */
export class AppPane {
  readonly node: HTMLElement;
  readonly frame: HTMLIFrameElement;
  private readonly head: HTMLElement;
  private readonly who: HTMLElement;
  private readonly agentsBtn: HTMLButtonElement;
  private menu: HTMLElement | null = null;
  private base: Stream | null = null;
  private subs = new Map<number, { stream: Stream; last: number }>();
  private attached: string[] = [];
  private ready = false;
  private held: [string, string, Record<string, unknown>][] = []; // intents for a panel not yet connected
  private readonly onMessage = (ev: MessageEvent) => this.take(ev);
  /** Where its panel asks a native page of its app kept (ag.native.show), in the frame's own coordinates. */
  native: NativePlace | null = null;

  constructor(
    readonly app: AppInfo,
    public instance: Instance,
    private readonly hooks: PaneHooks,
  ) {
    this.node = el("section", "app-pane");
    this.node.dataset.app = app.name;
    this.head = el("div", "app-head");
    this.who = el("span", "app-who");
    this.agentsBtn = el("button", "app-agents");
    this.agentsBtn.type = "button";
    this.agentsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.toggleMenu();
    });
    const close = el("button", "app-close", "×");
    close.type = "button";
    close.title = `Close ${app.label}`;
    close.setAttribute("aria-label", `Close ${app.label}`);
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      hooks.close();
    });
    // its name double-clicked: named by the user (naming.ts)
    nameable(this.who, this);
    this.head.append(this.who, this.agentsBtn, close);
    this.head.addEventListener("pointerdown", () => hooks.focus());
    const q = new URLSearchParams({ gatherer: instance.gatherer, instance: instance.id, host: location.origin });
    this.frame = el("iframe", "app-frame");
    this.frame.src = `${app.origin}/?${q}`;
    this.frame.title = `${app.label}${instance.title ? ` · ${instance.title}` : ""}`;
    this.frame.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals",
    );
    // the head inside a top as tall as the page's top row (--top-h): the page measures the head, never the top, which
    // that height is given to -- measured, the top would make itself a pixel taller every frame (07-panes.js's topRow)
    const top = el("div", "app-top");
    top.append(this.head);
    this.node.append(top, this.frame);
    window.addEventListener("message", this.onMessage);
    this.drawHead();
  }

  /** What the old page asks of a pane (07-panes.js's `call`): the theme, which it tells every pane of. */
  call(what: string): void {
    if (what === "theme") requestAnimationFrame(() => this.push("theme", { value: theme() }));
  }
  private lastActors = "";
  /** The page's actors changed: told to a panel that asks for them, if what it is told changed. */
  actorsChanged(): void {
    if (!this.app.capabilities?.actors || !this.hooks.actors) return;
    const now = this.hooks.actors();
    const sig = JSON.stringify(now);
    if (sig === this.lastActors) return;
    this.lastActors = sig;
    this.push("actors", { value: now });
  }
  selection(sel: Selection | null): void {
    this.push("selection", { value: sel });
  }
  /** An intent for the panel: held until it has connected (a pane just opened for it), then given. */
  intent(kind: string, data: Record<string, unknown>): void {
    if (this.ready) this.push("intent", { kind, data });
    else this.held.push(["intent", kind, data]);
  }

  destroy(): void {
    window.removeEventListener("message", this.onMessage);
    this.native = null;
    nativePanes.delete(this);
    nativeSoon();
    this.base?.close();
    for (const s of this.subs.values()) s.stream.close();
    this.subs.clear();
    this.menu?.remove();
  }

  /** Named by the user (naming.ts): drawn so, and the list told. */
  renamed(got: Instance): void {
    this.instance = got;
    this.hooks.named?.(got);
    this.drawHead();
  }

  private drawHead(): void {
    drawWho(this.who, this.app, this.instance);
    const n = this.attached.length;
    this.agentsBtn.textContent = n ? `${n} agent${n > 1 ? "s" : ""}` : "No agent";
    this.agentsBtn.title = "The agents working with it: attach or detach";
  }

  private toggleMenu(): void {
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
      return;
    }
    const menu = el("div", "app-menu");
    menu.setAttribute("role", "menu");
    const actors = this.hooks.agents(this.instance.gatherer);
    if (!actors.length) menu.append(el("div", "app-menu-none", "No actor in this gatherer yet"));
    for (const a of actors) {
      const on = this.attached.includes(a.channel);
      const item = el("button", "app-menu-item" + (on ? " on" : ""), (on ? "✓ " : "") + a.name);
      item.type = "button";
      item.setAttribute("role", "menuitemcheckbox");
      item.setAttribute("aria-checked", String(on));
      item.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        // closed at once, not when the answer comes: by then the button may have opened the menu again
        menu.remove();
        if (this.menu === menu) this.menu = null;
        await post(`/api/apps/${on ? "detach" : "attach"}`, {
          gatherer: this.instance.gatherer,
          instance: this.instance.id,
          channel: a.channel,
        }).catch(() => undefined);
      });
      menu.append(item);
    }
    this.head.append(menu);
    this.menu = menu;
    const away = (ev: Event) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        if (this.menu === menu) this.menu = null;
        document.removeEventListener("pointerdown", away, true);
      }
    };
    document.addEventListener("pointerdown", away, true);
  }

  private push(kind: string, body: Record<string, unknown>): void {
    if (!this.ready || !this.frame.contentWindow) return;
    this.frame.contentWindow.postMessage({ ag: 1, push: kind, ...body }, this.app.origin);
  }

  private reply(id: number | undefined, ok: boolean, value: unknown, error?: string): void {
    if (id === undefined || !this.frame.contentWindow) return;
    this.frame.contentWindow.postMessage({ ag: 1, re: id, ok, value, error }, this.app.origin);
  }

  private where(): Record<string, string> {
    return { app: this.app.name, gatherer: this.instance.gatherer, instance: this.instance.id };
  }

  private take(ev: MessageEvent): void {
    if (ev.source !== this.frame.contentWindow || ev.origin !== this.app.origin) return;
    const m = ev.data as Msg;
    if (!m || m.ag !== 1 || typeof m.op !== "string") return;
    this.answer(m).then(
      (v) => {
        this.reply(m.id, true, v);
        if (m.op === "hello") for (const [, kind, data] of this.held.splice(0)) this.push("intent", { kind, data });
      },
      (e: unknown) => this.reply(m.id, false, null, String((e as Error).message || e)),
    );
  }

  private async answer(m: Msg): Promise<unknown> {
    const w = this.where();
    if (ACTOR_OPS.has(String(m.op))) return toActors(this.app, this.hooks, m, w.gatherer);
    if (NOTICE_OPS.has(String(m.op))) return toNotices(this.app, m, w);
    if (SPELLING_OPS.has(String(m.op))) return toSpelling(m);
    switch (m.op) {
      case "hello": {
        this.ready = true;
        this.openBase();
        return {
          info: { ...w, label: this.app.label, title: this.instance.title, folder: this.instance.folder },
          attached: this.attached,
          native: !!desktop() && !!this.app.capabilities?.native_view,
          spelling: spellingOn(),
          states: this.states(),
          selection: this.hooks.selection(),
          theme: theme(),
          actors: this.app.capabilities?.actors && this.hooks.actors ? this.hooks.actors() : null,
        };
      }
      case "events.read": {
        const q = (m.query || {}) as Record<string, unknown>;
        const p = new URLSearchParams({
          ...w,
          types: ([] as string[]).concat((q.types as string[]) || []).join(","),
          after: String(q.after || 0),
          limit: String(q.limit || 500),
          ...(q.channel ? { channel: String(q.channel) } : {}),
        });
        return (await get<{ events: unknown[] }>(`/api/apps/events?${p}`)).events;
      }
      case "events.subscribe":
        return this.subscribe(Number(m.sub), (m.types as string[]) || [], Number(m.after || 0));
      case "events.unsubscribe": {
        const s = this.subs.get(Number(m.sub));
        s?.stream.close();
        this.subs.delete(Number(m.sub));
        return null;
      }
      case "events.insert":
        return post("/api/apps/insert", { ...w, events: m.events, channel: m.channel || null });
      case "tools.call":
        return post("/api/apps/call", { ...w, tool: m.tool, args: m.args || {} });
      case "tools.answer":
        return post("/api/apps/answer", { ...w, id: m.call, result: m.result });
      case "agents.attach":
        return post("/api/apps/attach", { gatherer: w.gatherer, instance: w.instance, channel: m.channel });
      case "agents.detach":
        return post("/api/apps/detach", { gatherer: w.gatherer, instance: w.instance, channel: m.channel });
      case "agents.send":
      case "agents.answer":
      case "agents.interrupt": {
        if (!this.app.capabilities?.message_agents) throw new Error(`${this.app.label} may not message its agents`);
        const ch = this.mine(m.channel);
        if (m.op === "agents.send") return this.hooks.send(w.gatherer, ch, String(m.text || ""));
        if (m.op === "agents.answer") return this.hooks.answer(w.gatherer, ch, String(m.call || ""), m.choice);
        return this.hooks.interrupt(w.gatherer, ch);
      }
      case "agents.focus":
        this.hooks.focusAgent(w.gatherer, this.mine(m.channel));
        return null;
      case "native.place": {
        if (!desktop() || !this.app.capabilities?.native_view)
          throw new Error(`${this.app.label} shows no native page`);
        const p = m.place as NativePlace | null;
        this.native = p && typeof p.target === "string" ? p : null;
        if (this.native) nativePanes.add(this);
        else nativePanes.delete(this);
        nativeSoon();
        return null;
      }
      case "native.drawn":
        desktop()?.stillDrawn?.(String(m.target || ""));
        return null;
      case "native.release":
        desktop()?.focusDashboard?.();
        this.frame.focus();
        return null;
      case "agents.transcript": {
        if (!this.app.capabilities?.transcript)
          throw new Error(`${this.app.label} may not read its agents' transcript`);
        const p = new URLSearchParams({ gatherer: w.gatherer, channel: this.mine(m.channel) });
        if (Number(m.after) > 0) p.set("after", String(Number(m.after)));
        return get(`/api/transcript?${p}`);
      }
      case "intent":
        return this.hooks.intent(String(m.kind), (m.data || {}) as Record<string, unknown>, this);
      case "close":
        this.hooks.close();
        return null;
      case "key": {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: String(m.key),
            code: String(m.code || ""),
            metaKey: !!m.meta,
            ctrlKey: !!m.ctrl,
            shiftKey: !!m.shift,
            altKey: !!m.alt,
            bubbles: true,
            cancelable: true,
          }),
        );
        return null;
      }
      default:
        throw new Error(`${m.op}: no such request`);
    }
  }

  /** The panel's one stream with its backend's messages (a tool call, the agents attached): open while it is. */
  private openBase(): void {
    if (this.base) return;
    const p = new URLSearchParams({ ...this.where(), types: "", messages: "1" });
    const s = stream(`/api/apps/stream?${p}`);
    s.addEventListener("message", (ev) => {
      const value = JSON.parse((ev as MessageEvent).data);
      if (value && value.ag === "instance") {
        if (typeof value.name === "string") this.instance = { ...this.instance, name: value.name };
        this.attached = value.attached || [];
        this.lastStates = "";
        this.agentsChanged();
        this.drawHead();
      }
      this.push("message", { value });
    });
    this.base = s;
  }

  /** Rows of `types` after `after`, each once -- a stream opened again starts from `after` again -- as they come. */
  private subscribe(sub: number, types: string[], after: number): null {
    this.subs.get(sub)?.stream.close();
    const p = new URLSearchParams({ ...this.where(), types: types.join(","), after: String(after), messages: "0" });
    const s = stream(`/api/apps/stream?${p}`);
    const kept = { stream: s, last: after };
    s.addEventListener("event", (ev) => {
      const row = JSON.parse((ev as MessageEvent).data);
      if (row.row_id <= kept.last) return;
      kept.last = row.row_id;
      this.push("event", { sub, row });
    });
    this.subs.set(sub, kept);
    return null;
  }

  /** The agents attached to it, as it was last told. */
  agents(): string[] {
    return [...this.attached];
  }

  /** A native page's still picture for its panel (the desktop app's, while something covers it), or none. */
  still(target: string, url: string | null): void {
    this.push("still", { value: { target, url } });
  }

  /** A channel a panel names, if it is one of its attached agents' (or a codex agent's thread its channel became). */
  private mine(channel: unknown): string {
    const ch = String(channel || "");
    if (this.attached.includes(ch)) return ch;
    const now = this.attached.find((c) => this.hooks.agentState(this.instance.gatherer, c)?.channel === ch);
    if (now) return ch;
    throw new Error(`${ch}: not an agent attached to this ${this.app.label}`);
  }

  /** Its agents' states, as the page has them now (the SDK's agents.state). */
  private states(): Record<string, AgentState> {
    const out: Record<string, AgentState> = {};
    for (const c of this.attached) {
      const s = this.hooks.agentState(this.instance.gatherer, c);
      if (s) out[c] = s;
    }
    return out;
  }
  private lastStates = "";
  /** The page's actors changed: its attached agents' states told to the panel, if they changed. */
  agentsChanged(): void {
    const now = this.states();
    const sig = JSON.stringify(now);
    if (sig === this.lastStates) return;
    this.lastStates = sig;
    this.push("states", { value: now });
  }

  /** Its agents, as the host has them now: read again, drawn, and given (the page opens the first below it). */
  async refresh(): Promise<string[]> {
    const got = await get<Listed>(`/api/apps?gatherer=${encodeURIComponent(this.instance.gatherer)}`).catch(() => null);
    if (got) {
      this.attached = got.attached[this.instance.id] || [];
      this.lastStates = "";
      this.agentsChanged();
      this.drawHead();
    }
    return [...this.attached];
  }
}
