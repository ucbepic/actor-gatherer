/* @ag/app: what an app's panel runs to talk to the dashboard that frames it (app_kit/DESIGN.md, "Panels").

The panel is a page on the app's own origin (http://<name>.localhost:<port>), in an iframe of the dashboard's page.
It loads this file from its own origin, `<script src="/_ag/app.js"></script>`, and calls

    const ag = await AgApp.connect();            // {app, label, gatherer, instance, title, folder}: the instance it shows

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
    ag.actors.current / on(cb)                           the actors as the dashboard lists them (capability actors):
                                                         {gatherers: [{name, agents: [{channel, name, avatar,
                                                         avatar_hue, cwd, status: [kind, said], ...}]}], home_dir, cwd}
    ag.actors.send(ch, text) / answer(ch, call, choice)  any actor of the panel's gatherer messaged, its question
                                                         answered, as the user (capability message_actors), as Chat
                                                         does: "gatherer" for its gatherer agent (started if it has
                                                         none). send's answer: {channel}, the actor's
    ag.actors.start({harness, folder, text})             a new actor of the gatherer, started in `folder` with `text`
                                                         as its first message: {channel}
    ag.actors.show(ch)                                   an actor of the gatherer shown in the pane in focus (its Chat)
    ag.theme.current / on(cb)                            {mode: "light"|"dark", vars}: the vars also set on :root
    ag.agents.focus(ch)                                  the message box of an attached agent's pane, focused (say after
                                                         the user pointed at something in the panel: they type next)
    ag.native.available                                  in the ag desktop app, for an app asking native_view: a native
                                                         page of the app's (its backend's, over the app's link) can be
                                                         shown over an element of the panel
    ag.native.show(el, target) / hide()                  page `target` kept over `el`, as it moves and resizes; anything
                                                         drawn over `el` (but what takes no pointer) covers it: the page
                                                         is then a still picture, drawn in el's own <img> (its first)
    ag.native.release()                                  the keys back from the native page, to the panel
    ag.spelling.available                                in the ag desktop app: the spellchecker of the user's system
                                                         (the one underlining misspelled words in text boxes) can be
                                                         asked about a word
    ag.spelling.check(word)                              {misspelled, suggestions} (its fixes, best first), or null
    ag.spelling.learn(word)                              the word added to the user's dictionary: only as they click
    ag.notices.send({title, text?, key?, show?, where?}) a notification to the user (capability notify): the dashboard
                                                         lists it until they look at this instance, and pops it up
                                                         where `show` says (default ["ag"]): "ag" there, "system" on
                                                         their computer, [] nowhere (only listed); a newer one of the
                                                         same key takes its place -> its id
    ag.notices.clear(idOrKey)                            one of its own (or every one of a key) no longer asking for them
    ag.notices.onOpen(cb)                                cb(where, id): the user clicked one of this instance's -- the
                                                         panel shown, `where` as it was sent (given once it connects)
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
                      states: [], actors: [] };
  const handlers = new Map();
  let info = null, attached = [], selection = null, theme = null, states = {}, nativeOn = false, actors = null;
  let spellOn = false;

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
    else if (m.push === "actors") { actors = m.value || null; for (const cb of listeners.actors) cb(actors); }
    else if (m.push === "still") drawStill(m.value || {});
    else if (m.push === "intent") { for (const cb of listeners.intent.get(m.kind) || []) cb(m.data); }
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || !(ev.key === "Escape" || ev.metaKey || ev.ctrlKey)) return;
    if (ev.key === "Meta" || ev.key === "Control") return;
    window.parent.postMessage({ ag: 1, op: "key", key: ev.key, code: ev.code, meta: ev.metaKey, ctrl: ev.ctrlKey,
                                shift: ev.shiftKey, alt: ev.altKey }, HOST);
  });

  // -- a native page over an element (ag.native): where it is, each frame, and whether something covers it
  const GRID = 5;                      // points across and down the element looked at for something over it
  let shown = null, reported = "";
  function covered(el, r) {
    for (let i = 0; i < GRID; i++)
      for (let j = 0; j < GRID; j++) {
        const hit = document.elementFromPoint(r.left + (r.width * (i + 0.5)) / GRID, r.top + (r.height * (j + 0.5)) / GRID);
        if (hit && hit !== el && !(hit.localName === "img" && hit.parentElement === el)) return true;
      }
    return false;
  }
  function report() {
    if (!nativeOn) return;
    let place = null;
    if (shown && shown.el.isConnected) {
      const r = shown.el.getBoundingClientRect();
      if (r.width >= 2 && r.height >= 2 && shown.el.checkVisibility())
        place = { target: shown.target, x: r.left, y: r.top, w: r.width, h: r.height, covered: covered(shown.el, r) };
    }
    const now = JSON.stringify(place);
    if (now === reported) return;
    reported = now;
    send("native.place", { place }).catch(() => { reported = ""; });
  }
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  let stillAsked = 0;
  // the page's still picture (or none), in the element's own <img>; the page told once it is drawn, so the native
  // page is hidden only with its picture in its place
  async function drawStill(still) {
    const n = ++stillAsked;
    const el = shown && shown.target === still.target ? shown.el : null;
    const img = el && el.querySelector(":scope > img");
    if (!img) return;
    if (!still.url) { img.hidden = true; return; }
    img.src = still.url;
    Object.assign(img.style, { width: `${el.clientWidth}px`, height: `${el.clientHeight}px` });
    await img.decode().catch(() => {});
    if (n !== stillAsked) return;
    img.hidden = false;
    await frame();                     // (drawn in this frame, on screen by the next)
    await frame();
    if (n === stillAsked) send("native.drawn", { target: still.target }).catch(() => {});
  }
  function everyFrame() { report(); requestAnimationFrame(everyFrame); }
  requestAnimationFrame(everyFrame);
  setInterval(report, 250);            // (frames stop while the window is hidden or covered)

  const ag = {
    get app() { return info && info.app; },
    get label() { return info && info.label; },
    get gatherer() { return info && info.gatherer; },
    get instance() { return info && info.instance; },
    get title() { return info && info.title; },
    get folder() { return info && info.folder; },
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
    native: {
      get available() { return nativeOn; },
      show(el, target) { shown = target ? { el, target: String(target) } : null; report(); },
      hide() { shown = null; report(); },
      release: () => send("native.release", {}),
    },
    spelling: {
      get available() { return spellOn; },
      check: (word) => (spellOn ? send("spelling.check", { word: String(word || "") }) : Promise.resolve(null)),
      learn: (word) => send("spelling.learn", { word: String(word || "") }),
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
      focus: (channel) => send("agents.focus", { channel }),
    },
    intents: {
      open: (kind, data) => send("intent", { kind, data: data || {} }),
      on(kind, cb) { if (!listeners.intent.has(kind)) listeners.intent.set(kind, []); listeners.intent.get(kind).push(cb); },
    },
    selection: { get current() { return selection; }, on(cb) { listeners.selection.push(cb); } },
    actors: {
      get current() { return actors; },
      on(cb) { listeners.actors.push(cb); },
      send: (channel, text) => send("actors.send", { channel, text }),
      answer: (channel, call, choice) => send("actors.answer", { channel, call, choice }),
      start: (o) => send("actors.start", { harness: (o && o.harness) || "", folder: (o && o.folder) || "", text: (o && o.text) || "" }),
      show: (channel) => send("actors.show", { channel }),
    },
    theme: { get current() { return theme; }, on(cb) { listeners.theme.push(cb); } },
    notices: {
      send: (n) => send("notices.send", { ...(n || {}) }),
      clear: (which) => send("notices.clear", { which: String(which || "") }),
      onOpen(cb) {
        if (!listeners.intent.has("notice")) listeners.intent.set("notice", []);
        listeners.intent.get("notice").push((d) => cb(d && d.where, d && d.id));
      },
    },
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
      nativeOn = !!got.native;
      spellOn = !!got.spelling;
      selection = got.selection || null;
      actors = got.actors || null;
      if (got.theme) applyTheme(got.theme);
      return ag;
    },
  });
})();
