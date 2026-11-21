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
    ag.links.onOpen(cb)                                  cb({href, path, part, values, form}): the user clicked a link to
                                                         something in this app (`ag://<app>/<path>#<part>`, of a form its
                                                         manifest's [[links]] lists; `values` its <name>s, decoded) -- the
                                                         panel shown first; go there (given once it connects)
    ag.links.href(path, part?)                           a link to `path` in this app (each segment %-encoded), to hand
                                                         an agent or put in a page
    ag.links.open(href)                                  a link to something in any app (`ag://...`), opened as a click on
                                                         it in Chat opens it: that app's panel shown, handed the link
    ag.onMessage(cb)                                     what the app's backend tells its panels
    ag.api(path, init?)                                  its backend's own routes, on its own origin (no bridge)
    ag.close()                                           its pane closed

A call the page doesn't answer fails, its promise rejected: after 30 s, or 3 min for ag.tools.call and 1 min for
starting or messaging an actor and reading a transcript (a page reloaded meanwhile never answers it).

Esc, and keys with Ctrl or ⌘ the panel leaves unhandled, go on to the page, as they would outside the frame. A press in
the panel is told to the page too, which closes what floats over it (a menu, Settings), as a press outside the frame would.

The page draws a × over the panel's top right corner (its panel closed, the app left open): a bar along the panel's top
keeps var(--ag-corner) clear at its right end, which this file sets on :root. */
(function () {
  "use strict";
  const params = new URLSearchParams(location.search);
  const HOST = params.get("host") || "";                  // the dashboard's origin: the only one listened to
  // what the page's × covers at the panel's top right (frontend/src/features/apps/apps.css's .app-x: 28px, 6px in, and a
  // 6px gap), the same × as an actor pane's
  document.documentElement.style.setProperty("--ag-corner", "40px");
  let seq = 0;
  const waiting = new Map();
  const listeners = { event: new Map(), message: [], attached: [], selection: [], theme: [], intent: new Map(),
                      states: [], actors: [] };
  const handlers = new Map();
  let info = null, attached = [], selection = null, theme = null, states = {}, nativeOn = false, actors = null;
  let spellOn = false;

  // How long a request waits for the page's answer, in ms, before it fails: a page reloaded or gone between the request
  // and its answer never answers it, and a panel waiting on it (Notes' saving, a button's busy state) would wait for good.
  // Each is longer than the page's own longest wait for it: a tool the app's panel answers waits 30 s for a panel to be
  // open and 120 s for its answer (ag_dashboard/app_host.py's PAGE_WAIT, TOOL_WAIT); starting an actor or sending it a
  // message waits on its terminal.
  const WAITS = { "tools.call": 180000, "actors.start": 60000, "actors.send": 60000, "agents.send": 60000,
                  "agents.transcript": 60000 };
  const WAIT = 30000;

  function send(op, body) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const ms = WAITS[op] || WAIT;
      const timer = setTimeout(() => {
        if (waiting.delete(id)) reject(new Error(`${op}: the dashboard did not answer in ${ms / 1000} s`));
      }, ms);
      const settle = (fn) => (v) => { clearTimeout(timer); fn(v); };
      waiting.set(id, { resolve: settle(resolve), reject: settle(reject) });
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

  // a press anywhere in the panel -- also one the panel's own code stops -- told to the page, which never hears it
  window.addEventListener("pointerdown", () => {
    if (HOST && window.parent !== window) window.parent.postMessage({ ag: 1, op: "pressed" }, HOST);
  }, true);

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
  // the look, each frame and every 250 ms (frames stop while the window is hidden or covered) -- only while a native
  // page is shown: a panel without one is not woken each frame for nothing
  let loop = null;
  function look() {
    if (loop || !nativeOn || !shown) return;
    const me = (loop = { interval: setInterval(() => step(me), 250) });
    const tick = () => { if (step(me)) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  function step(me) {                  // true while `me` is the loop and a native page is shown
    if (loop !== me) return false;
    if (!nativeOn || !shown) { clearInterval(me.interval); loop = null; return false; }
    report();
    return true;
  }

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
      show(el, target) { shown = target ? { el, target: String(target) } : null; report(); look(); },
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
    links: {
      onOpen(cb) {
        if (!listeners.intent.has("link")) listeners.intent.set("link", []);
        listeners.intent.get("link").push((d) => cb(d || {}));
      },
      href(path, part) {
        const segs = String(path || "").split("/").map(encodeURIComponent).join("/");
        return `ag://${info.app}/${segs}` + (part ? `#${encodeURIComponent(String(part))}` : "");
      },
      open: (href) => send("link", { href: String(href || "") }),
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
      look();                          // (a page shown before the host said native pages are there)
      spellOn = !!got.spelling;
      selection = got.selection || null;
      actors = got.actors || null;
      if (got.theme) applyTheme(got.theme);
      return ag;
    },
  });
})();
