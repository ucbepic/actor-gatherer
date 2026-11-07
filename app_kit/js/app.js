/* @ag/app: what an app's panel runs to talk to the dashboard that frames it (app_kit/DESIGN.md, "Panels").

The panel is a page on the app's own origin (http://<name>.localhost:<port>), in an iframe of the dashboard's page.
It loads this file from its own origin, `<script src="/_ag/app.js"></script>`, and calls

    const ag = await AgApp.connect();            // {app, label, gatherer, instance, title}: the instance it shows

Everything goes through the page around it, by postMessage, which checks it against the app's manifest:

    ag.events.read({types, after?, channel?, limit?})    the instance's events the app may read, oldest first
    ag.events.subscribe(types, onRow, {after?})          each one as it is stored (after `after`): a function that stops
    ag.events.insert(events, {channel?})                 its own types, or ag.context(...) for agents to see
    ag.context(stream, author, text)                     a context_stream event, in ag's shape
    ag.tools.handle(name, fn)                            a tool its manifest says the panel answers: fn(args, caller)
                                                         returns text, {content, isError}, or a promise of either
    ag.tools.call(name, args)                            one of its tools, called by the user: the result
    ag.agents.attached / onChange(cb) / attach(ch) / detach(ch)   the agents (channels) working with this instance
    ag.agents.state(ch) / onState(cb)                    an attached agent as the page has it: {status, turn_over,
                                                         asking, failing, stopped, session, name} (cb: each change)
    ag.agents.send(ch, text) / answer(ch, call, choice) / interrupt(ch)   a message to an attached agent, its question
                                                         answered, its turn stopped, as the user (capability
                                                         message_agents): as Chat sends, answers and Esc stops
    ag.agents.transcript(ch, {after?})                   an attached agent's transcript after row `after`, as the
                                                         dashboard's Transcript has it: {items: [{row_id, type, parts}]}
                                                         (capability transcript)
    ag.intents.open(kind, data) / on(kind, cb)           ask for something (open-file, open-url, ...) / be asked
    ag.selection.current / on(cb)                        the agent in focus in the page: {gatherer, channel}
    ag.theme.current / on(cb)                            {mode: "light"|"dark", vars}: the vars also set on :root
    ag.onMessage(cb)                                     what the app's backend tells its panels
    ag.api(path, init?)                                  its backend's own routes, on its own origin (no bridge)
    ag.close()                                           its pane closed

Esc, and keys with Ctrl or ⌘ the panel leaves unhandled, go on to the page, as they would outside the frame. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const HOST = params.get("host") || "";                  // the dashboard's origin: the only one listened to
  let seq = 0;
  const waiting = new Map();
  const listeners = { event: new Map(), message: [], attached: [], selection: [], theme: [], intent: new Map(),
                      states: [] };
  const handlers = new Map();
  let info = null, attached = [], selection = null, theme = null, states = {};

  function send(op, body) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve, reject });
      window.parent.postMessage({ ag: 1, id, op, ...body }, HOST);
    });
  }

  function applyTheme(t) {
    theme = t;
    const root = document.documentElement;
    root.style.colorScheme = t.mode;
    root.dataset.agTheme = t.mode;
    for (const [k, v] of Object.entries(t.vars || {})) root.style.setProperty(k, v);
    for (const cb of listeners.theme) cb(t);
  }

  async function answerCall(m) {
    const fn = handlers.get(m.tool);
    let result;
    try {
      if (!fn) throw new Error(`${m.tool}: this panel answers no such tool`);
      const got = await fn(m.args || {}, m.caller || {});
      result = typeof got === "string" ? { content: [{ type: "text", text: got }] }
        : got && Array.isArray(got.content) ? got : { content: [{ type: "text", text: JSON.stringify(got) }] };
    } catch (e) {
      result = { content: [{ type: "text", text: String((e && e.message) || e) }], isError: true };
    }
    send("tools.answer", { call: m.id, result }).catch(() => { /* asked of another panel too: its answer won */ });
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window.parent || ev.origin !== HOST) return;
    const m = ev.data;
    if (!m || m.ag !== 1) return;
    if (m.re !== undefined) {
      const w = waiting.get(m.re);
      if (!w) return;
      waiting.delete(m.re);
      return m.ok ? w.resolve(m.value) : w.reject(new Error(m.error || "refused"));
    }
    if (m.push === "event") { const cb = listeners.event.get(m.sub); if (cb) cb(m.row); }
    else if (m.push === "message") {
      const v = m.value;
      if (v && v.ag === "call") answerCall(v);
      else if (v && v.ag === "instance") { attached = v.attached || []; for (const cb of listeners.attached) cb(attached); }
      else for (const cb of listeners.message) cb(v);
    }
    else if (m.push === "selection") { selection = m.value; for (const cb of listeners.selection) cb(selection); }
    else if (m.push === "theme") applyTheme(m.value);
    else if (m.push === "states") { states = m.value || {}; for (const cb of listeners.states) cb(states); }
    else if (m.push === "intent") { for (const cb of listeners.intent.get(m.kind) || []) cb(m.data); }
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || !(ev.key === "Escape" || ev.metaKey || ev.ctrlKey)) return;
    if (ev.key === "Meta" || ev.key === "Control") return;
    window.parent.postMessage({ ag: 1, op: "key", key: ev.key, code: ev.code, meta: ev.metaKey, ctrl: ev.ctrlKey,
                                shift: ev.shiftKey, alt: ev.altKey }, HOST);
  });

  const ag = {
    get app() { return info && info.app; },
    get label() { return info && info.label; },
    get gatherer() { return info && info.gatherer; },
    get instance() { return info && info.instance; },
    get title() { return info && info.title; },
    events: {
      read: (q) => send("events.read", { query: q || {} }),
      subscribe(types, onRow, opts) {
        const sub = ++seq;
        listeners.event.set(sub, onRow);
        send("events.subscribe", { sub, types, after: (opts && opts.after) || 0 }).catch((e) => console.error(e));
        return () => { listeners.event.delete(sub); send("events.unsubscribe", { sub }).catch(() => {}); };
      },
      insert: (events, opts) => send("events.insert", { events, channel: (opts && opts.channel) || null }),
    },
    context: (stream, author, text) => ({ type: "context_stream", payload: { stream, author, text } }),
    tools: {
      handle(name, fn) { handlers.set(name, fn); },
      call: (name, args) => send("tools.call", { tool: name, args: args || {} }),
    },
    agents: {
      get attached() { return attached.slice(); },
      onChange(cb) { listeners.attached.push(cb); },
      attach: (channel) => send("agents.attach", { channel }),
      detach: (channel) => send("agents.detach", { channel }),
      state: (channel) => states[channel] || null,
      onState(cb) { listeners.states.push(cb); },
      send: (channel, text) => send("agents.send", { channel, text }),
      answer: (channel, call, choice) => send("agents.answer", { channel, call, choice }),
      interrupt: (channel) => send("agents.interrupt", { channel }),
      transcript: (channel, opts) => send("agents.transcript", { channel, after: (opts && opts.after) || 0 }),
    },
    intents: {
      open: (kind, data) => send("intent", { kind, data: data || {} }),
      on(kind, cb) { if (!listeners.intent.has(kind)) listeners.intent.set(kind, []); listeners.intent.get(kind).push(cb); },
    },
    selection: { get current() { return selection; }, on(cb) { listeners.selection.push(cb); } },
    theme: { get current() { return theme; }, on(cb) { listeners.theme.push(cb); } },
    onMessage(cb) { listeners.message.push(cb); },
    api(path, init) {
      const q = new URLSearchParams({ gatherer: info.gatherer, instance: info.instance });
      return fetch(`/api/${String(path).replace(/^\/+/, "")}${String(path).includes("?") ? "&" : "?"}${q}`, init);
    },
    close: () => send("close", {}),
  };

  window.AgApp = Object.freeze({
    /** Connected to the page around the panel: the instance it shows, the theme, the selection and its agents. */
    async connect() {
      if (info) return ag;
      if (!HOST || window.parent === window) throw new Error("not in the dashboard: an app's panel is opened there");
      const got = await send("hello", {});
      info = got.info;
      attached = got.attached || [];
      states = got.states || {};
      selection = got.selection || null;
      if (got.theme) applyTheme(got.theme);
      return ag;
    },
  });
})();
