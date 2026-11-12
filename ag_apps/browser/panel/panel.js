// The Browser's panel (ag_apps/browser/; app_kit/DESIGN.md step 8): a Chrome tab the user and the agent attached to
// it use together -- its bar (back, forward, reload, the address, Pick, Area, "⋯"), its tabs when it has more than
// one, and its screen, as Chrome casts it over the Browser's stream (`listen`), at the panel's own size (`resize`), the
// page laid out to it. In the ag desktop app the tab's own native page is laid over the screen instead (ag.native):
// the stream sends no screen then. What the user does on the screen -- mouse, wheel, keys, a paste -- goes to the tab
// as Chrome's own input (`queue`); Cmd+C copies what the page has selected. Pick: the element clicked, outlined as the
// pointer moves over the page; Area: a box dragged over it. Each pick a chip under the page, told the agent at once
// (backend.py: a message of the Browser's in its channel), and a ref its tools take; put away after the user's next
// message to it. What the agent does is outlined on the screen and said in a line under it (`feed`), done or not; the
// element it acted on flashes, its outline fading over 3 s. While the panel is seen (`watch`), each action is first
// shown coming -- the agent's pointer moved to it, "Next: ..." -- a moment before it is done, and Esc, or Stop, stops it.
//
// Moved from the dashboard's page (legacy/20-browser.js) as it was: what changed is how it reaches the rest -- its
// backend's routes on the app's own origin (`post`, `listen`), the SDK for the theme, its agent, the native page.
(async function () {
  "use strict";

  // ---------------------------------------------------------------- helpers (the dashboard page's own, small)
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined) n.append(kid);
    return n;
  };
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  function strokeIcon(d, size = 15) {
    const svg = svgEl("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": "true", fill: "none", stroke: "currentColor",
      "stroke-width": 1.4, "stroke-linecap": "round", "stroke-linejoin": "round" });
    svg.append(svgEl("path", { d }));
    return svg;
  }
  const ICONS = {
    back: "M9.75 3.5 5.25 8l4.5 4.5",
    forward: "M6.25 3.5 10.75 8l-4.5 4.5",
    reload: "M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.5v3h-3",
    plus: "M8 3.25v9.5M3.25 8h9.5",
    pointer: "M3.25 2.25l9.5 4.6-4.05 1.35-1.7 4.3z",
    area: "M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11M7 2.5h2M7 13.5h2M2.5 7v2M13.5 7v2",
    chevron: "M6 3.5 10.5 8 6 12.5",
    more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  };
  const signature = (value) => JSON.stringify(value);
  const clock = (t) => t ? new Date(t * 1000).toLocaleString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–";
  const ago = (t) => {
    if (!t) return "never";
    const s = Math.max(0, Date.now() / 1000 - t);
    return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
  };

  // ---------------------------------------------------------------- the dashboard around it, and its backend
  const ag = await AgApp.connect();
  const BASE = `/api/w/${encodeURIComponent(ag.gatherer)}/${ag.instance}`;
  const NATIVE = ag.native.available;
  const PAGE = Math.random().toString(36).slice(2, 12);    // this panel, as its Browser knows it: whether it is seen
  const agent = () => ag.agents.attached[0] || "";
  // its Browser's routes (`what`), or, `top`, the backend's own for every Browser (/api/<what>: logins)
  async function post(what, body, top = false) {
    const res = await fetch(`${top ? "/api" : BASE}/${what}`, { method: "POST", headers: { "Content-Type": "application/json" },
                                                               body: JSON.stringify(body || {}) });
    const got = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(got.error || `HTTP ${res.status}`);
    return got;
  }
  async function get(what, top = false) {
    const res = await fetch(`${top ? "/api" : BASE}/${what}`);
    const got = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(got.error || `HTTP ${res.status}`);
    return got;
  }
  // a word of what went wrong, under the page a few seconds
  let sayTimer = 0;
  const sayEl = el("div", { class: "bw-say", role: "status", hidden: "" });
  function say(text) {
    sayEl.textContent = text;
    sayEl.hidden = false;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { sayEl.hidden = true; }, 6000);
  }
  const bwSay = () => (e) => say(`Browser: ${e.message}`);
  // the user, about to say what they mean by what they picked: the agent's message box, in its pane
  const toAgent = () => { const c = agent(); if (c) ag.agents.focus(c).catch(() => {}); };

  // ---------------------------------------------------------------- the view
  const b = { state: null, frameSize: [0, 0], mode: null, queue: [], sending: false, hovering: false, drag: null, sized: "",
              lastClick: { at: 0, x: 0, y: 0, n: 0 }, outlined: "", feedOpen: false, es: null, seenNow: true };
  const btn = (icon, label, onclick, extra = {}) => el("button", { type: "button", title: label, "aria-label": label, onclick, ...extra }, strokeIcon(icon, 16));
  b.back = btn(ICONS.back, "Back", () => post("nav", { action: "back" }).catch(bwSay(b)));
  b.fwd = btn(ICONS.forward, "Forward", () => post("nav", { action: "forward" }).catch(bwSay(b)));
  b.reload = btn(ICONS.reload, "Reload", () => post("nav", { action: "reload" }).catch(bwSay(b)));
  b.newTab = btn(ICONS.plus, "New tab (a link Cmd+clicked, or middle-clicked, opens in one too)",
    () => post("tab", { action: "new" }).then(() => { b.addr.focus(); b.addr.select(); }).catch(bwSay(b)));
  b.addr = el("input", { type: "text", spellcheck: "false", autocomplete: "off", "aria-label": "Address", placeholder: "Search Google or type a URL" });
  const form = b.addrForm = el("form", {}, b.addr);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const url = b.addr.value.trim();
    b.histClose?.();
    if (url) post("nav", { url }).then(() => b.stage.focus()).catch(bwSay(b));
  });
  b.addr.addEventListener("paste", (ev) => {     // lines pasted run together with a space, as in Chrome's address bar
    const text = ev.clipboardData?.getData("text/plain") || "";   // (a text box drops the breaks: "oneline two")
    if (!/[\r\n]/.test(text)) return;
    ev.preventDefault();
    b.addr.setRangeText(text.replace(/\s*[\r\n]+\s*/g, " ").trim(), b.addr.selectionStart, b.addr.selectionEnd, "end");
    b.addr.dispatchEvent(new Event("input", { bubbles: true }));
  });
  b.pickBtn = btn(ICONS.pointer, "Pick an element to point the agent at (Esc to stop)", () => bwMode(b, bwModeOn(b) === "pick" ? null : "pick"), { "aria-pressed": "false" });
  b.areaBtn = btn(ICONS.area, "Pick an area: drag a box over the page (Esc to stop)", () => bwMode(b, bwModeOn(b) === "area" ? null : "area"), { "aria-pressed": "false" });
  b.moreBtn = btn(ICONS.more, "More", () => moreMenu(), { "aria-haspopup": "menu" });
  b.mine = el("span", { class: "mine", hidden: "", text: "Your Chrome",
    title: "This page runs in your own Chrome (config.toml's [dashboard] browser_profile = \"mine\"): your logins and history, a tab hidden from its tab strip" });
  b.find = bwFindBar(b);
  b.bar = el("div", { class: "bw-bar" }, b.back, b.fwd, b.reload, b.newTab, form, b.find, b.mine, el("span", { class: "sep" }), b.pickBtn, b.areaBtn, b.moreBtn);
  b.tabs = el("div", { class: "bw-tabs", hidden: "" });
  b.img = el("img", { alt: "" });
  b.cv = el("canvas", { class: "screen", hidden: "" });   // the screen as video, where it comes so (bwVideo)
  b.acting = el("div", { class: "acting", hidden: "" });
  b.acting.addEventListener("animationend", (ev) => { if (ev.animationName === "bw-fade") bwOutline(b, null); });
  b.agentPtr = el("div", { class: "agent-pointer", hidden: "", "aria-hidden": "true" }, (() => {
    const svg = svgEl("svg", { width: 20, height: 20, viewBox: "0 0 20 20" });
    svg.append(svgEl("path", { d: "M3 2 L3 16 L7 12.2 L9.6 18 L12.2 16.8 L9.7 11.2 L15 11 Z", fill: "#E8590C", stroke: "#fff",
      "stroke-width": "1.4", "stroke-linejoin": "round" }));
    return svg;
  })(), el("span", { class: "ripple" }));
  b.dragBox = el("div", { class: "drag", hidden: "" });
  b.hint = el("div", { class: "hint", hidden: "" });
  b.cover = el("div", { class: "cover" }, el("div", { text: "Opening the browser…" }));
  b.dialog = bwShield(el("div", { class: "dialog", hidden: "" }));   // (its input and buttons its own, not the page's)
  b.tip = el("div", { class: "tip", role: "tooltip", hidden: "" });
  b.chooser = bwShield(el("div", { class: "dialog chooser", hidden: "" }));
  b.dl = bwShield(el("div", { class: "dl", hidden: "" }));
  b.stage = el("div", { class: "bw-stage", tabindex: "0", "aria-label": "The page: click to use it, as the agent does" },
    b.img, b.cv, b.acting, b.agentPtr, b.keycap = el("kbd", { class: "keycap", hidden: "", "aria-hidden": "true" }),
    b.scrollCue = el("div", { class: "scroll-cue", hidden: "", "aria-hidden": "true" }),
    b.dragBox, b.hint, b.tip, b.dl, b.dialog, b.chooser, b.cover);
  b.picks = el("div", { class: "bw-picks", "aria-label": "Picked in the browser", hidden: "" });
  b.feed = bwFeed(b);
  b.host = document.getElementById("app");
  b.host.append(b.bar, b.tabs, b.stage, b.picks, b.feed.root, sayEl);
  bwInput(b);
  // the user scrolling: an outline from before is no longer where its element is
  b.stage.addEventListener("wheel", () => { bwOutline(b, null); b.agentPtr.hidden = true; }, { passive: true, capture: true });
  b.stage.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !b.mode && bwStoppable(b)) {          // the agent's actions stopped, not the page's Esc
      ev.preventDefault();
      ev.stopImmediatePropagation();
      b.escTaken = true;                                             // (its keyup too)
      return bwStop(b);
    }
    if (BW_SCROLL_KEYS.has(ev.key)) { bwOutline(b, null); b.agentPtr.hidden = true; }
  }, { capture: true });
  b.stage.addEventListener("keyup", (ev) => {
    if (ev.key === "Escape" && b.escTaken) { b.escTaken = false; ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, { capture: true });
  bwUi(b);
  bwHistory(b);
  new ResizeObserver(() => bwResize(b)).observe(b.stage);

  // In the ag app (desktop/DESIGN.md), the tab's own native page is placed over the screen (ag.native): the stream
  // sends no screen, and the panel says which page it shows.
  function bwNative(b) {
    if (!NATIVE) return;
    const st = b.state || {}, tab = st.tabs?.[st.active];
    if (tab && tab.target) ag.native.show(b.stage, tab.target); else ag.native.hide();
    b.framed = !!tab;                                  // the page shows over the view: nothing to wait for under it
    // Pick and Area run in the page (core.py's set_mode): the buttons say which is on; a pick made, the agent's message
    // box has the keys (the native page had them)
    b.pickBtn.setAttribute("aria-pressed", String(st.picking === "pick"));
    b.areaBtn.setAttribute("aria-pressed", String(st.picking === "area"));
    const picks = (st.picks || []).length;
    if (b.picksSeen !== undefined && picks > b.picksSeen) toAgent();
    b.picksSeen = picks;
  }
  // The Browser's stream: its state and screen. While the panel is out of sight, it says so (`hidden`), as the
  // dashboard's page did while its tab was.
  function bwListen(b) {
    if (b.es) return;
    b.seenNow = seen();                                // what joining says: told again only once it changes
    const q = new URLSearchParams({ page: PAGE,
                                    ...(NATIVE ? { native: "1" } : typeof VideoDecoder === "function" ? { video: "1" } : {}),
                                    ...(!b.seenNow ? { hidden: "1" } : {}) });
    const es = b.es = new EventSource(`${BASE}/stream?${q}`);
    es.addEventListener("state", (ev) => {
      b.state = JSON.parse(ev.data);
      bwNative(b);
      bwDraw(b);
    });
    es.addEventListener("frame", (ev) => {
      const f = JSON.parse(ev.data);
      b.img.src = `data:image/jpeg;base64,${f.data}`;
      if (f.w && f.h && (f.w !== b.frameSize[0] || f.h !== b.frameSize[1])) {
        b.frameSize = [f.w, f.h];
        Object.assign(b.img.style, { width: `${f.w}px`, height: `${f.h}px` });
      }
      if (b.img.hidden) { b.img.hidden = false; b.cv.hidden = true; }
      b.framed = true;
      b.cover.hidden = true;
    });
    es.addEventListener("video", (ev) => bwVideo(b, JSON.parse(ev.data)));
    es.onerror = () => { if (es.readyState === EventSource.CLOSED && b.es === es) { b.es = null; setTimeout(() => bwListen(b), 2000); } };
  }
  // The screen as video, where the backend sends it so (its own Chrome: video.py): each chunk decoded and drawn on the
  // canvas where the JPEG frames' image is -- the page at its own size, from its top left, so a click lands where it
  // would on the image. A key frame (re)starts the decoder; one failing, the stream is joined again, for a key frame.
  const bwBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  function bwVideo(b, c) {
    if (c.t === "key" && c.codec) {
      const kind = `${c.codec} ${c.w}x${c.h}`;
      if (!b.dec || b.dec.state === "closed" || b.decKind !== kind) {
        try { if (b.dec && b.dec.state !== "closed") b.dec.close(); } catch (e) { /* gone already */ }
        b.dec = new VideoDecoder({ output: (f) => bwShowVideo(b, f), error: () => bwVideoLost(b) });
        b.dec.configure({ codec: c.codec, hardwareAcceleration: "prefer-hardware", optimizeForLatency: true });
        b.decKind = kind;
      }
      b.keyed = true;
    }
    if (!b.dec || b.dec.state !== "configured" || !b.keyed) return;
    try { b.dec.decode(new EncodedVideoChunk({ type: c.t, timestamp: c.ts, data: bwBytes(c.d) })); } catch (e) { bwVideoLost(b); }
  }
  function bwShowVideo(b, f) {
    const cv = b.cv, vw = (b.state && b.state.viewport && b.state.viewport[0]) || f.displayWidth;
    const k = f.displayWidth / vw || 1;                 // the screen's pixels per page pixel
    if (cv.width !== f.displayWidth || cv.height !== f.displayHeight) {
      cv.width = f.displayWidth; cv.height = f.displayHeight;
      Object.assign(cv.style, { width: `${f.displayWidth / k}px`, height: `${f.displayHeight / k}px` });
    }
    (b.cvCtx || (b.cvCtx = cv.getContext("2d"))).drawImage(f, 0, 0);
    f.close();
    if (cv.hidden) { cv.hidden = false; b.img.hidden = true; }
    b.framed = true;
    b.cover.hidden = true;
  }
  function bwVideoLost(b) {
    try { if (b.dec && b.dec.state !== "closed") b.dec.close(); } catch (e) { /* gone already */ }
    b.dec = null; b.keyed = false;
    if (b.es) { b.es.close(); b.es = null; bwListen(b); }
  }
  // The view's size, told: the page laid out to it (and the agent's screenshots at it).
  function bwResize(b) {
    clearTimeout(b.sizing);
    b.sizing = setTimeout(() => {
      const r = b.stage.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) return;
      const want = [Math.floor(r.width), Math.floor(r.height), Math.min(2, window.devicePixelRatio || 1)];
      if (want.join() === b.sized) return;
      b.sized = want.join();
      post("resize", { width: want[0], height: want[1], dpr: want[2] }).catch(() => { b.sized = ""; });
    }, 120);
  }
  function bwDraw(b) {
    const st = b.state || {}, tabs = st.tabs || [], tab = tabs[st.active] || null;
    if (tab && document.activeElement !== b.addr) b.addr.value = tab.url === "about:blank" ? "" : tab.url;
    // its tabs, when it has more than one
    b.tabs.hidden = tabs.length < 2;
    if (tabs.length > 1) b.tabs.replaceChildren(...tabs.map((t, i) => el("div", { class: "t" + (i === st.active ? " on" : ""),
        title: `${t.title || ""}\n${t.url}`, onclick: () => post("tab", { action: "switch", index: i }).catch(bwSay(b)) },
      el("span", { class: "nm", text: (t.loading ? "… " : "") + (t.title || t.url || "New tab") }),
      el("button", { type: "button", class: "x", "aria-label": "Close the tab", text: "×",
        onclick: (ev) => { ev.stopPropagation(); post("tab", { action: "close", index: i }).catch(bwSay(b)); } }))),
      el("button", { type: "button", class: "add", "aria-label": "New tab", title: "New tab", text: "+",
        onclick: () => post("tab", { action: "new" }).catch(bwSay(b)) }));
    // what the agent is about to do, and does now: outlined, its pointer there; what it did, flashed then fading
    // (bwFeedDraw), and said under the page
    const a = st.acting, nx = st.next;
    if (nx && nx.box) { bwOutline(b, nx.box, "next"); bwPoint(b, nx.box); }
    else if (a && a.box) {
      bwOutline(b, a.box, "doing");
      bwPoint(b, a.box);
      if (a.tool === "click" && b.pressed !== a.label + a.box.join()) { b.pressed = a.label + a.box.join(); bwPress(b); }
    } else if (b.outlined === "doing" || b.outlined === "next") bwOutline(b, null);
    bwCue(b, nx || a);
    if (!nx && !a && !b.agentPtr.hidden && !b.agentIdle) b.agentIdle = setTimeout(() => { b.agentPtr.hidden = true; b.agentIdle = 0; }, 2500);
    bwFeedDraw(b);
    if (b.outlined && b.outlinedAt !== bwSpot(b)) bwOutline(b, null);   // another page, or tab: it is not there
    // the page's dialog: answered here, or by the agent
    const d = st.dialog;
    b.dialog.hidden = !d;
    if (d && b.dialog.dataset.sig !== JSON.stringify(d)) {
      b.dialog.dataset.sig = JSON.stringify(d);
      const input = d.type === "prompt" ? el("input", { type: "text", value: d.default || "" }) : null;
      const answer = (accept) => post("dialog", { accept, ...(input ? { text: input.value } : {}) }).catch(bwSay(b));
      b.dialog.replaceChildren(...[el("div", { class: "lbl", text: `The page says (${d.type})` }), el("div", { class: "msg", text: d.message }), input].filter(Boolean),
        el("div", { class: "row" }, d.type === "alert" ? null : el("button", { type: "button", onclick: () => answer(false) }, "Cancel"),
          el("button", { type: "button", class: "primary", onclick: () => answer(true) }, "OK")));
    }
    if (!d) b.dialog.dataset.sig = "";
    b.mine.hidden = st.chrome !== "mine";
    // nothing to show yet, or why not -- your Chrome asking whether to let the dashboard in, first
    const err = st.allow ? "" : st.error;
    b.cover.hidden = !!b.framed && !err && !st.allow;
    if (!b.cover.hidden) b.cover.replaceChildren(...[el("div", { text: st.allow ? "Waiting for your Chrome: click Allow in its “Allow remote debugging?” dialog"
      : err ? "The browser did not open." : "Opening the browser…" }), err ? el("div", { class: "err", text: err }) : null].filter(Boolean));
    bwPicks(b);
    bwUiDraw(b);
  }
  // The outline of what the agent acts on (`kind` "doing"), did ("done": flashed, then fading over 3 s), didn't
  // because a check of it failed ("no", amber, the same), or did once, its line hovered ("hover", "hover no": where its
  // element is now). Gone as the user scrolls, and on another page or tab (`bwSpot`: where it was drawn).
  const BW_SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "]);
  const bwSpot = (b) => { const st = b.state || {}, t = (st.tabs || [])[st.active]; return `${st.active}|${t ? t.url : ""}`; };
  function bwOutline(b, box, kind = "") {
    const o = b.acting;
    if (!box) { o.hidden = true; o.className = "acting"; b.outlined = ""; return; }
    Object.assign(o.style, { left: `${box[0] - 3}px`, top: `${box[1] - 3}px`, width: `${box[2] + 6}px`, height: `${box[3] + 6}px` });
    if (b.outlined !== kind || kind === "done" || kind === "no") {
      o.className = "acting";
      void o.offsetWidth;                              // its flash and fade started again
      o.className = `acting ${kind}`;
    }
    o.hidden = false;
    b.outlined = kind;
    b.outlinedAt = bwSpot(b);
    if (kind === "doing" || kind === "next") b.doingAt = b.outlinedAt;
  }
  // The agent's pointer, gliding to where it acts (css: .agent-pointer's transition): from the bottom middle of the page
  // the first time, and after it was hidden (2.5 s after the agent last acted, or the user scrolled). A click: a ripple.
  function bwPoint(b, box) {
    const p = b.agentPtr, x = box[0] + box[2] / 2, y = box[1] + box[3] / 2;
    clearTimeout(b.agentIdle);
    b.agentIdle = 0;
    if (p.hidden) {
      p.style.transition = "none";
      p.style.transform = `translate(${b.stage.clientWidth / 2}px, ${b.stage.clientHeight - 30}px)`;
      p.hidden = false;
      void p.offsetWidth;
      p.style.transition = "";
    }
    p.style.transform = `translate(${x}px, ${y}px)`;
  }
  function bwPress(b) {
    b.agentPtr.classList.remove("press");
    void b.agentPtr.offsetWidth;
    b.agentPtr.classList.add("press");
  }
  // Where an action acts outside the page (core.py's `_cue`), pointed at as it comes and while it is done: the address
  // bar, filled with the address it opens; Back, Forward, Reload; the tab it switches to or closes, or + for a new one;
  // the key it presses on the page as a whole, as a key cap; the way it scrolls the page, as an arrow.
  function bwCue(b, c) {
    const t = c ? c.tool : "", x = (c && c.cue) || {};
    const mark = (node, on) => { if (node) node.classList.toggle("coming", !!on); };
    mark(b.back, t === "back"); mark(b.fwd, t === "forward"); mark(b.reload, t === "reload");
    mark(b.addr, t === "navigate");
    if (t === "navigate" && x.url && document.activeElement !== b.addr) b.addr.value = x.url;
    mark(b.newTab, t === "tabs" && x.action === "new");
    mark(b.tabs.querySelector(".add"), t === "tabs" && x.action === "new");
    b.tabs.querySelectorAll(".t").forEach((n, i) => mark(n, t === "tabs" && x.action !== "new" && i === Number(x.index) - 1));
    b.keycap.hidden = !(t === "press" && x.key);
    if (t === "press" && x.key) b.keycap.textContent = x.key;
    b.scrollCue.hidden = !(t === "scroll" && x.direction);
    if (t === "scroll" && x.direction) b.scrollCue.dataset.dir = x.direction;
  }
  // Esc, or Stop: the agent's actions stopped -- the one shown coming, the rest of its steps -- until the user's next
  // message (core.py's `stop`). Offered while it acts, or is about to, and not stopped already.
  const bwStoppable = (b) => { const st = b.state || {}; return !st.halted && !!(st.next || st.acting || st.playing); };
  const bwStop = (b) => post("stop", {}).catch(bwSay(b));
  // Whether the panel is seen: its page shown, its frame in sight (a panel held out of sight while its agent works is
  // not) -- told the Browser, which shows each action coming only while one is (`watch`).
  let inSight = true;
  const seen = () => !document.hidden && inSight;
  const tellSeen = () => {
    if (!b.es || b.seenNow === seen()) return;       // (not joined yet: its joining says it)
    b.seenNow = seen();
    post("watch", { page: PAGE, visible: b.seenNow }).catch(() => {});
  };
  document.addEventListener("visibilitychange", tellSeen);
  new IntersectionObserver((entries) => { inSight = entries.some((e) => e.isIntersecting); tellSeen(); }).observe(b.stage);
  // The Browsers' pages shown in the dashboard's theme, as one's own Chrome shows them in the system's (core.py's
  // `set_scheme`): told at the start, on each change of the theme, and when the panel is looked at again (another
  // panel, in another theme, may have told its own meanwhile).
  let scheme = "";
  function tellScheme(again = false) {
    const s = (ag.theme.current && ag.theme.current.mode) || "light";
    if (s === scheme && !again) return;
    scheme = s;
    post("scheme", { scheme: s }).catch(() => { scheme = ""; });
  }
  ag.theme.on(() => tellScheme());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tellScheme(true); });

  // What the agent did (core.py's `show`: the state's `actions`), as the user is told it: the latest in a line under
  // the page -- while it acts, what it does now -- which opens to the last ten, with their times; one of them hovered,
  // outlined again where its element is now (`where`), if it is still on the page. Each new one flashes the element it
  // was on (or, not done, the one whose check failed); one done before the view was shown, or more than BW_FRESH ms
  // ago (the view shown again later), is listed, not flashed.
  const BW_FRESH = 4000;
  function bwFeed(b) {
    const f = { dot: el("span", { class: "dot", "aria-hidden": "true" }), text: el("span", { class: "tx", "aria-live": "polite" }),
                when: el("span", { class: "tm", "aria-hidden": "true" }), list: el("ol", { class: "list", hidden: "" }) };
    f.line = el("button", { type: "button", class: "line", "aria-expanded": "false", onclick: () => bwFeedOpen(b, !b.feedOpen) },
      f.dot, f.text, f.when, el("span", { class: "more", "aria-hidden": "true" }, strokeIcon(ICONS.chevron, 12)));
    f.stop = el("button", { type: "button", class: "stop", hidden: "", title: "Stop the agent (Esc): its actions wait for your next message",
                            onclick: () => bwStop(b) }, "Stop", el("kbd", { text: "Esc" }));
    f.root = el("div", { class: "bw-feed idle" }, f.list, el("div", { class: "row" }, f.line, f.stop));
    f.root.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      if (b.feedOpen) { ev.preventDefault(); ev.stopPropagation(); bwFeedOpen(b, false); f.line.focus(); }
      else if (bwStoppable(b)) { ev.preventDefault(); ev.stopPropagation(); bwStop(b); }
    });
    return f;
  }
  function bwFeedDraw(b) {
    const st = b.state || {}, f = b.feed, acts = st.actions || [], last = acts[acts.length - 1] || null;
    const doing = st.next ? { label: `Next: ${st.next.label}` } : st.acting;
    const top = last ? last.i : 0;
    if (b.seen === undefined || top < b.seen) b.seen = top;            // joined (or the dashboard started again)
    else if (top > b.seen) {
      b.seen = top;
      // done: where its element was as it acted -- unless that took it to another page (a check that failed: now)
      if (last.box && Date.now() - last.at < BW_FRESH && (!last.ok || !b.doingAt || b.doingAt === bwSpot(b)))
        bwOutline(b, last.box, last.ok ? "done" : "no");
      f.root.classList.remove("fresh");
      void f.root.offsetWidth;
      f.root.classList.add("fresh");
    }
    if (st.reading) {                                  // looking at the page: said a moment, however quick the look
      b.reading = st.reading;
      b.readUntil = performance.now() + 700;
      clearTimeout(b.readTimer);
      b.readTimer = setTimeout(() => bwFeedDraw(b), 720);
    }
    const reading = !doing && b.reading && (st.reading || performance.now() < b.readUntil) ? b.reading : "";
    f.root.classList.toggle("reading", !!reading);
    f.root.classList.toggle("idle", !doing && !last && !reading);
    f.root.classList.toggle("doing", !!doing);
    f.root.classList.toggle("no", !doing && !!last && !last.ok && !st.halted);
    f.root.classList.toggle("halted", !doing && !!st.halted);
    f.stop.hidden = !bwStoppable(b);
    const said = doing ? `${doing.label}…` : reading ? `${reading}…` : st.halted ? "You stopped the agent (Esc): it waits for your next message"
      : last ? last.text : "The agent has done nothing on the page yet";
    if (f.text.textContent !== said) f.text.textContent = said;
    f.line.title = doing || !last ? "" : last.detail ? `${last.text}\n\nWhat the agent was told:\n${last.detail}` : last.text;
    if (!doing && !reading && last && !st.halted) { f.when.dataset.ago = String(last.at / 1000); f.when.textContent = ago(last.at / 1000); }
    else { delete f.when.dataset.ago; f.when.textContent = ""; }
    f.line.disabled = !acts.length;
    if (!acts.length && b.feedOpen) bwFeedOpen(b, false);
    if (b.feedOpen) bwFeedList(b);
  }
  setInterval(() => { const w = b.feed.when; if (w.dataset.ago) w.textContent = ago(Number(w.dataset.ago)); }, 1000);
  function bwFeedOpen(b, open) {
    b.feedOpen = open;
    b.feed.list.hidden = !open;
    b.feed.line.setAttribute("aria-expanded", String(open));
    b.feed.root.classList.toggle("open", open);
    if (open) bwFeedList(b);
    else if (b.outlined.startsWith("hover")) bwOutline(b, null);
  }
  function bwFeedList(b) {
    const acts = (b.state && b.state.actions) || [];
    const sig = signature(acts.map((a) => a.i));
    if (b.feed.list.dataset.sig === sig) return;
    b.feed.list.dataset.sig = sig;
    b.feed.list.replaceChildren(...acts.slice().reverse().map((a) => el("li", {
      class: a.ok ? "" : "no", title: a.detail ? `${a.text}\n\nWhat the agent was told:\n${a.detail}` : a.text,
      onmouseenter: () => bwWhere(b, a), onmouseleave: () => { b.hoverI = 0; if (b.outlined.startsWith("hover")) bwOutline(b, null); } },
    el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "tx", text: a.text }),
    el("span", { class: "tm", text: clock(a.at / 1000) }))));
  }
  async function bwWhere(b, a) {
    b.hoverI = a.i;
    let box = null;
    try { box = (await post("where", { i: a.i })).box; } catch (e) { /* not there */ }
    if (b.hoverI === a.i && b.feedOpen) bwOutline(b, box, a.ok ? "hover" : "hover no");
  }
  document.addEventListener("pointerdown", (ev) => {
    if (b.feedOpen && !b.feed.root.contains(ev.target)) bwFeedOpen(b, false);
    if (b.more && !b.more.contains(ev.target) && ev.target !== b.moreBtn && !b.moreBtn.contains(ev.target)) closeMore();
  }, true);

  // Pick (an element) and Area (a box): what the pointer does on the screen meanwhile; Esc, or the button again, stops it.
  const bwModeOn = (b) => (NATIVE ? b.state?.picking || null : b.mode);   // the Pick or Area on: the page's, in the app
  function bwMode(b, mode) {
    if (NATIVE) return void post("mode", { mode }).catch(bwSay(b));      // in the app's page itself (bwNative)
    b.mode = mode;
    b.pickBtn.setAttribute("aria-pressed", String(mode === "pick"));
    b.areaBtn.setAttribute("aria-pressed", String(mode === "area"));
    b.stage.classList.toggle("picking", !!mode);
    b.hint.hidden = !mode;
    b.hint.textContent = mode === "pick" ? "Click the element to point the agent at" : mode === "area" ? "Drag a box over the area" : "";
    b.dragBox.hidden = true; b.drag = null;
    if (mode !== "pick" && b.hovered) { b.hovered = false; post("hover", {}).catch(() => {}); }
    if (mode) b.stage.focus();
  }
  // What the user does on the screen, in order, one request at a time; a move waiting to go replaced by the next.
  function bwQueue(b, e) {
    const last = b.queue[b.queue.length - 1];
    if (e.kind === "mouseMoved" && last && last.kind === "mouseMoved") b.queue[b.queue.length - 1] = e;
    else if (e.kind === "mouseWheel" && last && last.kind === "mouseWheel") { last.deltaX += e.deltaX; last.deltaY += e.deltaY; }
    else b.queue.push(e);
    if (!b.sending) bwFlush(b);
  }
  async function bwFlush(b) {
    b.sending = true;
    while (b.queue.length) {
      const events = b.queue.splice(0);
      try {
        const r = await post("input", { events });
        if (r && r.clipboard) bwToClipboard(b, r.clipboard);
      } catch (e) { say(`Browser: ${e.message}`); }
    }
    b.sending = false;
  }
  // What a copy or cut in the page put on its Chrome's clipboard, onto the user's: its text, and its formatting if
  // it had some (Google Docs', a code editor's colours). Nothing when nothing was copied: the user's stays.
  function bwToClipboard(b, c) {
    if (!c.text && !c.html) return;
    const item = { "text/plain": new Blob([c.text || ""], { type: "text/plain" }) };
    if (c.html) item["text/html"] = new Blob([c.html], { type: "text/html" });
    navigator.clipboard.write([new ClipboardItem(item)]).catch(() => navigator.clipboard.writeText(c.text || "")).catch(bwSay(b));
  }
  const bwMods = (ev) => (ev.altKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0) | (ev.metaKey ? 4 : 0) | (ev.shiftKey ? 8 : 0);
  const BW_BUTTONS = ["left", "middle", "right"];
  function bwInput(b) {
    const at = (ev) => { const r = (b.cv.hidden ? b.img : b.cv).getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const st = b.stage;
    st.addEventListener("pointerdown", (ev) => {
      st.focus({ preventScroll: true });
      const p = at(ev);
      if (b.mode === "pick") {
        ev.preventDefault();
        bwMode(b, null);
        post("pick", p).then(toAgent).catch(bwSay(b));
        return;
      }
      if (b.mode === "area") { ev.preventDefault(); b.drag = { x: p.x, y: p.y }; st.setPointerCapture(ev.pointerId); return; }
      if (ev.button > 2) return;
      st.setPointerCapture(ev.pointerId);
      const c = b.lastClick, now = Date.now();
      c.n = now - c.at < 450 && Math.abs(c.x - p.x) < 5 && Math.abs(c.y - p.y) < 5 ? c.n + 1 : 1;
      Object.assign(c, { at: now, x: p.x, y: p.y });
      bwQueue(b, { type: "mouse", kind: "mousePressed", ...p, button: BW_BUTTONS[ev.button], buttons: ev.buttons, clickCount: c.n, modifiers: bwMods(ev) });
    });
    st.addEventListener("pointermove", (ev) => {
      const p = at(ev);
      if (b.mode === "pick") {                         // the element under it outlined, as DevTools' picker does
        b.hoverAt = p;
        if (!b.hovering) {
          b.hovering = true;
          const go = () => { const q = b.hoverAt; b.hoverAt = null;
            post("hover", q).catch(() => {}).finally(() => { b.hovered = true; if (b.hoverAt && b.mode === "pick") go(); else b.hovering = false; }); };
          go();
        }
        return;
      }
      if (b.mode === "area") {
        if (!b.drag) return;
        const x = Math.min(b.drag.x, p.x), y = Math.min(b.drag.y, p.y);
        b.dragBox.hidden = false;
        Object.assign(b.dragBox.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(p.x - b.drag.x)}px`, height: `${Math.abs(p.y - b.drag.y)}px` });
        return;
      }
      bwQueue(b, { type: "mouse", kind: "mouseMoved", ...p, button: ev.buttons ? BW_BUTTONS[[1, 4, 2].indexOf(ev.buttons & 7)] || "left" : "none",
        buttons: ev.buttons, modifiers: bwMods(ev) });
    });
    st.addEventListener("pointerup", (ev) => {
      const p = at(ev);
      if (b.mode === "area") {
        if (!b.drag) return;
        const box = [Math.min(b.drag.x, p.x), Math.min(b.drag.y, p.y), Math.abs(p.x - b.drag.x), Math.abs(p.y - b.drag.y)];
        b.drag = null;
        bwMode(b, null);
        if (box[2] >= 4 && box[3] >= 4) post("pick", { box }).then(toAgent).catch(bwSay(b));
        return;
      }
      if (b.mode) return;
      bwQueue(b, { type: "mouse", kind: "mouseReleased", ...p, button: BW_BUTTONS[ev.button] || "left", buttons: ev.buttons,
        clickCount: b.lastClick.n, modifiers: bwMods(ev) });
    });
    st.addEventListener("pointerleave", () => { if (b.mode === "pick" && b.hovered) { b.hovered = false; post("hover", {}).catch(() => {}); } });
    st.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const k = ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? b.stage.clientHeight : 1;
      bwQueue(b, { type: "mouse", kind: "mouseWheel", ...at(ev), deltaX: ev.deltaX * k, deltaY: ev.deltaY * k, modifiers: bwMods(ev) });
    }, { passive: false });
    st.addEventListener("contextmenu", (ev) => ev.preventDefault());
    st.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return;
      ev.stopPropagation();                            // the page's keys, not the dashboard's (its Esc, its shortcuts)
      if (b.mode && ev.key === "Escape") { ev.preventDefault(); return bwMode(b, null); }
      const cmd = ev.metaKey || ev.ctrlKey;
      if (cmd && (ev.key === "v" || ev.key === "V")) { b.pasteMods = bwMods(ev); return; }   // the paste event brings the clipboard
      if (cmd && /^[cxCX]$/.test(ev.key)) {                     // the page's own copy or cut, then onto the user's clipboard
        ev.preventDefault();
        bwQueue(b, { type: "copy", cut: /x/i.test(ev.key), modifiers: bwMods(ev) });
        return;
      }
      if (cmd && ["r", "R"].includes(ev.key) && !ev.shiftKey) { ev.preventDefault(); post("nav", { action: "reload" }).catch(bwSay(b)); return; }
      if (cmd && ["l", "L"].includes(ev.key)) { ev.preventDefault(); b.addr.focus(); b.addr.select(); return; }
      ev.preventDefault();
      bwQueue(b, { type: "key", down: true, key: ev.key, code: ev.code, keyCode: ev.keyCode, location: ev.location, repeat: ev.repeat, modifiers: bwMods(ev) });
    });
    st.addEventListener("keyup", (ev) => {
      ev.stopPropagation();
      if (b.mode || ((ev.metaKey || ev.ctrlKey) && /^[cvxrlCVXRL]$/.test(ev.key))) return;
      ev.preventDefault();
      bwQueue(b, { type: "key", down: false, key: ev.key, code: ev.code, keyCode: ev.keyCode, location: ev.location, modifiers: bwMods(ev) });
    });
    st.addEventListener("paste", (ev) => {                       // pasted by the page itself, its formatting kept
      const d = ev.clipboardData, text = d ? d.getData("text/plain") : "", html = d ? d.getData("text/html") : "";
      if (!text && !html) return;
      ev.preventDefault();
      bwQueue(b, { type: "paste", text, html, modifiers: b.pasteMods || 4 });
    });
  }
  // What Chrome would show itself, which a Chrome with no window doesn't (core.py's UI_JS tells it, in the state): the
  // pointer's shape; a tooltip; a drop-down's list or a date or color picker, opened here, in the user's own Chrome
  // (what they choose set in the page: choose); the right-click menu; the find bar; the page's file chooser (the
  // user's own, the files sent: file, chosen); files dropped on the view (drop); a download done (shown in its folder:
  // reveal).
  const BW_USER_WAIT = 4000;   // ms after the user's click or key in the view that a list, picker or file chooser the page
                               // asks for opens by itself (the browser opens one only just after the user acted)
  const BW_FILE_MAX = 22e6;    // the largest file sent for the page (core.py's MAX_UPLOAD)
  function bwUi(b) {
    const st = b.stage;
    b.userAt = 0; b.pointer = { x: 0, y: 0 }; b.pop = null;
    const at = (ev) => { const r = st.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const inPop = (ev) => b.pop && b.pop.contains(ev.target);
    st.addEventListener("pointerdown", (ev) => {
      if (inPop(ev)) return;
      b.userAt = Date.now(); b.pointer = at(ev); b.down = true; b.later = null;
      bwPopClose(b);
    }, true);
    const up = () => {                               // the button up: a list or chooser the page asked for meanwhile, opened
      b.down = false;
      const later = b.later;
      b.later = null;
      if (later) setTimeout(later, 0);
    };
    st.addEventListener("pointerup", up, true);
    st.addEventListener("pointercancel", up, true);
    st.addEventListener("pointermove", (ev) => { b.pointer = at(ev); }, true);
    st.addEventListener("wheel", (ev) => { if (!inPop(ev)) bwPopClose(b); }, { capture: true, passive: true });
    st.addEventListener("keydown", (ev) => {
      if (inPop(ev)) return;
      b.userAt = Date.now();
      if (ev.key === "Escape" && b.pop) { ev.preventDefault(); ev.stopImmediatePropagation(); bwPopClose(b); }   // ours, not the page's
    }, true);
    const files = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
    st.addEventListener("dragover", (ev) => {
      if (!files(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      st.classList.add("dropping");
    });
    st.addEventListener("dragleave", (ev) => { if (!st.contains(ev.relatedTarget)) st.classList.remove("dropping"); });
    st.addEventListener("drop", (ev) => {
      st.classList.remove("dropping");
      if (!files(ev)) return;
      ev.preventDefault();
      const p = at(ev), list = [...ev.dataTransfer.files];
      if (list.length) bwUpload(b, list).then((ids) => post("drop", { ...p, ids })).catch(bwSay(b));
    });
  }
  // A box of the panel's over the page: what is done in it is not the page's.
  function bwShield(node) {
    for (const t of ["pointerdown", "pointerup", "pointermove", "click", "dblclick", "wheel", "keydown", "keyup", "paste", "copy"])
      node.addEventListener(t, (ev) => ev.stopPropagation());
    node.addEventListener("contextmenu", (ev) => { ev.stopPropagation(); ev.preventDefault(); });
    return node;
  }
  // Files the user gives the page, sent to the backend, one at a time -> their ids.
  async function bwUpload(b, files) {
    const ids = [];
    for (const f of files) {
      if (f.size > BW_FILE_MAX) throw new Error(`${f.name} is larger than ${Math.round(BW_FILE_MAX / 1e6)} MB`);
      const data = await new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(",")[1] || "");
        r.onerror = () => no(r.error);
        r.readAsDataURL(f);
      });
      ids.push((await post("file", { name: f.name, data })).id);
    }
    return ids;
  }
  const BW_DL_SHOWN = 8000;    // ms a download done is said in the app, over the page's picture
  function bwUiDraw(b) {
    const st = b.state || {};
    b.stage.style.setProperty("--bw-cursor", st.cursor || "default");
    // the page's tooltip, by the pointer
    const tip = st.tip;
    b.tip.hidden = !tip;
    if (tip) {
      b.tip.textContent = tip.text;
      const [x, y] = tip.at || [b.pointer.x, b.pointer.y], w = b.stage.clientWidth, h = b.stage.clientHeight;
      b.tip.style.left = `${Math.max(4, Math.min(x + 10, w - b.tip.offsetWidth - 4))}px`;
      b.tip.style.top = `${y + 24 + b.tip.offsetHeight > h ? Math.max(4, y - b.tip.offsetHeight - 8) : y + 20}px`;
    }
    // a list, picker, menu or find bar the page asked for: opened once, and only if the user just acted in the view
    const p = st.popup;
    if (p && p.n !== b.popSeen) {
      b.popSeen = p.n;
      if (p.k === "suggest" && !p.options.length) { if (b.pop && b.pop.classList.contains("suggest")) bwPopClose(b); }   // gone
      else if (NATIVE ? p.k === "find" : Date.now() - b.userAt < BW_USER_WAIT) bwWhenUp(b, () => bwPopOpen(b, p));   // (in
      // the app only the user's own Cmd+F in the page asks: core.py's CUES_JS)
    }
    if (!p && b.pop) bwPopClose(b);                  // the page it was on went
    // the page's file chooser: the user's own, at once if they just acted, else from the bar
    const c = st.chooser;
    b.chooser.hidden = !c;
    if (c && b.chooserSeen !== c.n) {
      b.chooserSeen = c.n;
      const many = c.mode === "multiple";
      b.chooser.replaceChildren(el("div", { text: `The page asks for ${many ? "files" : "a file"}` }),
        el("div", { class: "row" }, el("button", { type: "button", onclick: () => post("chosen", { n: c.n, ids: [] }).catch(bwSay(b)) }, "Cancel"),
          el("button", { type: "button", class: "primary", onclick: () => bwChoose(b, c) }, many ? "Choose files…" : "Choose a file…")));
      if (Date.now() - b.userAt < BW_USER_WAIT) bwWhenUp(b, () => bwChoose(b, c));
    }
    // a download done, from now on: shown in its folder
    const d = (st.downloads || []).at(-1);
    if (b.dlSeen === undefined) b.dlSeen = d ? d.i : 0;
    b.dl.hidden = !d || d.i <= b.dlSeen;
    if (NATIVE && !b.dl.hidden && b.dlFor !== d.i) {        // in the app it sits over the page's still picture: gone
      b.dlFor = d.i;                                        // by itself after a while, the page live again
      setTimeout(() => { if (b.dlSeen < d.i) { b.dlSeen = d.i; b.dl.hidden = true; } }, BW_DL_SHOWN);
    }
    if (d && !b.dl.hidden && b.dl.dataset.i !== String(d.i)) {
      b.dl.dataset.i = String(d.i);
      b.dl.replaceChildren(el("span", { class: "nm", title: d.name, text: `Downloaded ${d.name}` }),
        el("button", { type: "button", onclick: () => post("reveal", { i: d.i }).catch(bwSay(b)) },
          /Mac/.test(navigator.platform) ? "Show in Finder" : "Show in folder"),
        el("button", { type: "button", class: "x", "aria-label": "Dismiss", title: "Dismiss", text: "×",
          onclick: () => { b.dlSeen = d.i; b.dl.hidden = true; } }));
    }
  }
  // `open` now, or once the user's mouse button is up, if it is down: a Mac's own menu (a drop-down's list), opened
  // while the button is down, takes its release as a choice -- of the item put under the pointer, the one chosen
  // already -- and closes at once.
  function bwWhenUp(b, open) {
    if (b.down) b.later = open; else open();
  }
  // The user's own file chooser, for the page's: the files chosen sent, then given to the page.
  function bwChoose(b, c) {
    const input = el("input", { type: "file" });
    if (c.mode === "multiple") input.multiple = true;
    if (c.accept) input.accept = c.accept;
    input.addEventListener("change", () => {
      const list = [...input.files];
      if (list.length) bwUpload(b, list).then((ids) => post("chosen", { n: c.n, ids })).catch(bwSay(b));
    });
    input.click();
  }
  const bwPlace = (node, box) => Object.assign(node.style, { left: `${box[0]}px`, top: `${box[1]}px`,
    width: `${Math.max(box[2], 1)}px`, height: `${Math.max(box[3], 1)}px` });
  function bwPopClose(b) {
    if (b.pop) { b.pop.remove(); b.pop = null; }
  }
  function bwPopOpen(b, p) {
    bwPopClose(b);
    const box = p.box || [b.pointer.x, b.pointer.y, 0, 0];
    const back = () => b.stage.focus({ preventScroll: true });
    if (p.k === "select") {                          // a drop-down: the user's Chrome's own list, at the page's
      const s = el("select", { class: "pop-native", tabindex: "-1", "aria-hidden": "true" });
      let group = null;
      for (const o of p.options) {
        const opt = el("option", { text: o.t });
        opt.disabled = !!o.d;
        if (o.g && !(group && group.label === o.g)) s.append(group = el("optgroup", { label: o.g }));
        else if (!o.g) group = null;
        (group || s).append(opt);
      }
      s.selectedIndex = p.i;
      bwPlace(s, box);
      b.stage.append(s);
      s.getBoundingClientRect();                     // laid out first: its list opens where it is, not at the view's corner
      s.addEventListener("change", () => { const i = s.selectedIndex; bwPopClose(b); back(); post("choose", { n: p.n, index: i }).catch(bwSay(b)); });
      const own = () => {                            // a list of the panel's, under the field
        const items = [];
        let last = null;
        p.options.forEach((o, i) => {
          if (o.g && o.g !== last) items.push({ head: o.g });
          last = o.g;
          items.push({ label: o.t, on: i === p.i, disabled: o.d, run: () => post("choose", { n: p.n, index: i }).catch(bwSay(b)) });
        });
        bwMenu(b, box[0], box[1] + box[3], items, "list", { width: box[2] });
      };
      try { s.showPicker(); } catch (e) { s.remove(); return own(); }   // the browser shows none now
      b.pop = s;
      setTimeout(() => {                             // its list closed at once, nothing chosen and the user not on it since:
        if (b.pop === s && !s.matches(":open")) own();   // never shown (a Chrome with no window shows none)
      }, 300);
      return;
    }
    if (p.k === "picker") {                          // a date's or a color's: the user's Chrome's own picker
      const input = el("input", { type: p.type, class: "pop-native", tabindex: "-1", "aria-hidden": "true" });
      for (const k of ["min", "max", "step"]) if (p[k]) input.setAttribute(k, p[k]);
      input.value = p.value;
      const send = () => post("choose", { n: p.n, value: input.value }).catch(bwSay(b));
      input.addEventListener("change", () => { clearTimeout(b.colorT); send(); bwPopClose(b); back(); });
      if (p.type === "color") input.addEventListener("input", () => { clearTimeout(b.colorT); b.colorT = setTimeout(send, 150); });
      bwPlace(input, box);
      b.stage.append(input);
      input.getBoundingClientRect();                 // laid out first: its picker opens where it is
      try { input.showPicker(); b.pop = input; return; } catch (e) { input.remove(); }
      input.className = "";                          // the browser opens none now: the field, to open it from
      input.removeAttribute("style");
      const m = bwShield(el("div", { class: "bw-menu field" }, input,
        el("button", { type: "button", text: "Set", onclick: () => { send(); bwPopClose(b); back(); } })));
      b.stage.append(m);
      b.pop = m;
      bwPlace(m, [box[0], box[1] + box[3] + 2, 0, 0]);
      Object.assign(m.style, { width: "", height: "" });
      return;
    }
    if (p.k === "suggest") {                         // a field's suggestions, under it: the field keeps the keys
      return bwMenu(b, box[0], box[1] + box[3] + 2, p.options.map((o, i) => ({ label: o.t, note: o.l,
        run: () => post("choose", { n: p.n, index: i }).catch(bwSay(b)) })), "suggest", { focus: false, width: box[2] });
    }
    if (p.k === "menu") {                            // the right-click menu, where the page has none of its own
      const [x, y] = p.at || [b.pointer.x, b.pointer.y];
      const copy = (text) => navigator.clipboard.writeText(text).catch(bwSay(b));
      const nav = (action) => () => post("nav", { action }).catch(bwSay(b));
      const tab = (url) => () => post("tab", { action: "new", url }).catch(bwSay(b));
      const items = [];
      if (p.link) items.push({ label: "Open link in new tab", run: tab(p.link) }, { label: "Copy link address", run: () => copy(p.link) }, null);
      if (p.img) items.push({ label: "Open image in new tab", run: tab(p.img) }, { label: "Copy image address", run: () => copy(p.img) }, null);
      const own = (cut) => () => bwQueue(b, { type: "copy", cut, modifiers: 4 });   // the page's own copy, as Cmd+C's
      const paste = async () => {                      // as Cmd+V: the page's own paste, with the clipboard's formatting
        let text = "", html = "";
        try {
          for (const item of await navigator.clipboard.read()) {
            if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
            if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
          }
        } catch (e) { text = await navigator.clipboard.readText(); }
        if (text || html) bwQueue(b, { type: "paste", text, html, modifiers: 4 });
      };
      if (p.sel && p.editable) items.push({ label: "Cut", run: own(true) });
      if (p.sel) items.push({ label: "Copy", run: own(false) });
      if (p.editable) items.push({ label: "Paste", run: () => paste().catch(bwSay(b)) });
      if (p.sel || p.editable) items.push(null);
      items.push({ label: "Back", run: nav("back") }, { label: "Forward", run: nav("forward") }, { label: "Reload", run: nav("reload") }, null,
        { label: "Find in page…", run: () => bwFindOpen(b) },
        { label: "Point the agent at this", run: () => post("pick", { x, y }).then(toAgent).catch(bwSay(b)) });
      return bwMenu(b, x, y, items);
    }
    if (p.k === "find") bwFindOpen(b);
  }
  // A menu of the panel's over the page, at (x, y): items {label, note?, run, on?, disabled?} | {head} | null (a
  // line); focused (its keys its own) unless `focus` is false, at least `width` wide.
  function bwMenu(b, x, y, items, kind = "", { focus = true, width = 0 } = {}) {
    bwPopClose(b);
    const m = bwShield(el("div", { class: `bw-menu ${kind}`.trim(), role: "menu" }));
    for (const it of items) {
      if (!it) { if (m.lastChild && m.lastChild.localName !== "hr") m.append(el("hr")); continue; }
      if (it.head) { m.append(el("div", { class: "grp", text: it.head })); continue; }
      const btn = el("button", { type: "button", role: "menuitem", class: it.on ? "on" : "", title: it.label, tabindex: focus ? null : "-1" },
        it.label, it.note ? el("span", { class: "note", text: it.note }) : null);
      btn.disabled = !!it.disabled;
      btn.addEventListener("click", () => { bwPopClose(b); b.stage.focus({ preventScroll: true }); it.run(); });
      m.append(btn);
    }
    if (m.lastChild && m.lastChild.localName === "hr") m.lastChild.remove();
    m.addEventListener("keydown", (ev) => {
      const all = [...m.querySelectorAll("button:not([disabled])")], i = all.indexOf(document.activeElement);
      if (ev.key === "Escape") { ev.preventDefault(); bwPopClose(b); b.stage.focus({ preventScroll: true }); }
      else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && all.length) {
        ev.preventDefault();
        const down = ev.key === "ArrowDown", n = all.length;
        all[i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : n - 1)) % n].focus();
      }
    });
    if (width) m.style.minWidth = `${width}px`;
    b.stage.append(m);
    b.pop = m;
    const w = b.stage.clientWidth, h = b.stage.clientHeight;
    m.style.left = `${Math.max(4, Math.min(x, w - m.offsetWidth - 4))}px`;
    m.style.top = `${y + m.offsetHeight + 4 > h ? Math.max(4, y - m.offsetHeight) : y}px`;
    if (focus) (m.querySelector("button.on:not([disabled])") || m.querySelector("button:not([disabled])"))?.focus({ preventScroll: true });
  }
  // The address bar's suggestions: the pages the Browsers went to (backend.py's `visited`: visited.py), under it as the
  // user types -- Up/Down to one (the box then has its address), Enter or a click opens it, Esc closes them (the box
  // has what was typed again); its x, or Shift+Delete on the one picked, forgets it. They lie over the page: in the ag
  // app the native page is then its still picture -- which the shade over the whole page makes sure of (ag.native looks
  // at points across it for something over it), a click on it closing them.
  function bwHistory(b) {
    const list = el("div", { class: "bw-menu hist", id: "bw-hist", role: "listbox", "aria-label": "Pages opened before", hidden: "" });
    const shade = el("div", { class: "hist-shade", hidden: "" });
    for (const n of [list, shade]) {
      bwShield(n);
      n.addEventListener("mousedown", (ev) => { ev.preventDefault(); ev.stopPropagation(); });   // the box keeps the keys
    }
    b.stage.append(shade, list);
    Object.entries({ role: "combobox", "aria-autocomplete": "list", "aria-controls": "bw-hist", "aria-expanded": "false" })
      .forEach(([k, v]) => b.addr.setAttribute(k, v));
    const shown = (u) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
    let pages = [], at = -1, typed = "", asked = 0, timer = 0;
    const close = b.histClose = () => {
      asked++;
      clearTimeout(timer);
      list.hidden = shade.hidden = true;
      pages = [];
      at = -1;
      b.addr.setAttribute("aria-expanded", "false");
      b.addr.removeAttribute("aria-activedescendant");
    };
    function draw() {
      if (!pages.length || document.activeElement !== b.addr) return close();
      list.replaceChildren(...pages.map((p, i) => {
        const row = el("div", { class: "row" + (i === at ? " on" : ""), role: "option", id: `bw-hist-${i}`, "aria-selected": String(i === at),
          title: p.title ? `${p.title}\n${p.url}` : p.url },
          el("span", { class: "u", text: shown(p.url) }), p.title ? el("span", { class: "tt", text: p.title }) : null,
          el("button", { type: "button", class: "x", tabindex: "-1", title: "Forget this page (Shift+Delete)", "aria-label": "Forget this page", text: "×" }));
        row.addEventListener("click", (ev) => { if (ev.target.closest(".x")) forget(i); else go(p.url); });
        return row;
      }));
      const s = b.stage.getBoundingClientRect(), a = b.addr.getBoundingClientRect();
      const w = Math.min(Math.max(a.width, 360), s.width - 8);
      Object.assign(list.style, { width: `${w}px`, top: "4px", left: `${Math.max(4, Math.min(a.left - s.left, s.width - w - 4))}px` });
      list.hidden = false;
      shade.hidden = !NATIVE;
      b.addr.setAttribute("aria-expanded", "true");
      if (at >= 0) { b.addr.setAttribute("aria-activedescendant", `bw-hist-${at}`); list.children[at]?.scrollIntoView({ block: "nearest" }); }
      else b.addr.removeAttribute("aria-activedescendant");
    }
    async function ask() {
      const q = b.addr.value.trim(), n = ++asked;
      if (!q) return close();
      let got;
      try { got = await get(`visited?q=${encodeURIComponent(q)}`, true); } catch { return; }
      if (n !== asked || document.activeElement !== b.addr) return;
      pages = got.pages || [];
      at = -1;
      draw();
    }
    function go(url) {
      b.addr.value = url;
      b.addrForm.requestSubmit();
    }
    function forget(i) {
      const p = pages[i];
      if (!p) return;
      post("visited", { forget: p.url }, true).catch(bwSay(b));
      const picked = at;
      pages.splice(i, 1);
      if (picked === i) {                              // the one picked: the next takes its place, in the box too
        at = Math.min(i, pages.length - 1);
        b.addr.value = at >= 0 ? pages[at].url : typed;
      } else if (picked > i) at = picked - 1;
      draw();
    }
    b.addr.addEventListener("input", () => {
      typed = b.addr.value;
      clearTimeout(timer);
      timer = setTimeout(ask, 40);
    });
    b.addr.addEventListener("keydown", (ev) => {
      if (list.hidden) {
        if (ev.key === "ArrowDown" && b.addr.value.trim()) { ev.preventDefault(); typed = b.addr.value; ask(); }
        return;
      }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const n = pages.length;
        at = ev.key === "ArrowDown" ? (at + 1 >= n ? -1 : at + 1) : (at < 0 ? n - 1 : at - 1);
        b.addr.value = at < 0 ? typed : pages[at].url;
        draw();
      } else if (ev.key === "Escape") {
        ev.preventDefault();                           // (theirs, not the dashboard's: the SDK passes on no Esc taken)
        b.addr.value = typed;
        close();
      } else if ((ev.key === "Delete" || ev.key === "Backspace") && ev.shiftKey && at >= 0) {
        ev.preventDefault();
        forget(at);
      }
    });
    b.addr.addEventListener("blur", close);
    shade.addEventListener("click", () => { close(); b.stage.focus({ preventScroll: true }); });
  }
  // The find bar, in the Browser's bar (Cmd+F, where the page takes it not; or the right-click menu): Enter for the
  // next, Shift+Enter the one before, Esc to close it.
  function bwFindBar(b) {
    const input = el("input", { type: "text", spellcheck: "false", "aria-label": "Find in page", placeholder: "Find in page" });
    const count = el("span", { class: "n", "aria-live": "polite" });
    let seq = 0, timer = 0;
    const run = async (back, again) => {
      const q = input.value, mine = ++seq;
      if (!q) { count.textContent = ""; count.classList.remove("none"); return; }
      try {
        const r = await post("find", { q, back, again });
        if (mine !== seq) return;
        count.textContent = !r.count ? "No matches" : r.index >= 0 ? `${r.index + 1} of ${r.count}` : `${r.count} ${r.count === 1 ? "match" : "matches"}`;
        count.classList.toggle("none", !r.count);
      } catch (e) { if (mine === seq) count.textContent = ""; bwSay(b)(e); }
    };
    b.findRun = run;
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(false, false), 150); });
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();                          // the bar's keys, not the dashboard's
      if (ev.key === "Enter") { ev.preventDefault(); run(ev.shiftKey, true); }
      else if (ev.key === "Escape") { ev.preventDefault(); bwFindClose(b); }
      else if ((ev.metaKey || ev.ctrlKey) && (ev.key === "f" || ev.key === "F")) { ev.preventDefault(); input.select(); }
    });
    const btn = (d, label, onclick) => el("button", { type: "button", title: label, "aria-label": label, onclick }, strokeIcon(d, 14));
    b.findInput = input; b.findCount = count;
    return el("div", { class: "bw-find", hidden: "" }, input, count,
      btn("M4 10 8 6l4 4", "The one before (Shift+Enter)", () => run(true, true)),
      btn("M4 6l4 4 4-4", "The next (Enter)", () => run(false, true)),
      btn("M4.5 4.5l7 7M11.5 4.5l-7 7", "Close (Esc)", () => bwFindClose(b)));
  }
  function bwFindOpen(b) {
    if (NATIVE) ag.native.release().catch(() => {});      // (the keys were the native page's)
    b.find.hidden = false;
    b.findInput.focus();
    b.findInput.select();
    if (b.findInput.value) b.findRun(false, false);
  }
  function bwFindClose(b) {
    b.find.hidden = true;
    b.findCount.textContent = "";
    if (NATIVE) post("find", { q: "" }).catch(() => {});   // the native page's own find ended, its marks gone
    b.stage.focus({ preventScroll: true });
  }
  // The chips of what the user picked, under the page: each told the agent at once, put away after the user's next
  // message to it, or taken off here.
  function bwPicks(b) {
    const picks = (b.state && b.state.picks) || [];
    const sig = signature(picks.map((p) => [p.id, p.label]));
    if (b.picks.dataset.sig === sig) return;
    b.picks.dataset.sig = sig;
    b.picks.hidden = !picks.length;
    b.picks.replaceChildren(el("span", { class: "lbl", text: "Picked:" }), ...picks.map((p) => el("span", { class: "pk", title: `${p.id}: ${p.label} -- told the agent: name it in your message` },
      el("span", { class: "id", text: p.id }), el("span", { class: "nm", text: p.label }),
      el("button", { type: "button", "aria-label": `Take ${p.id} off`, text: "×", onclick: () => post("unpick", { id: p.id }).catch(bwSay(b)) }))));
  }

  // ---------------------------------------------------------------- "⋯": the logins of the user's Chrome, imported
  function closeMore() { if (b.more) { b.more.remove(); b.more = null; } }
  function moreMenu() {
    if (b.more) return closeMore();
    const mine = (b.state || {}).chrome === "mine";
    const m = bwShield(el("div", { class: "bw-menu bw-more-menu", role: "menu" },
      el("button", { type: "button", role: "menuitem", disabled: mine ? "" : null,
        title: mine ? "This Browser runs in your own Chrome: its logins are there already" : "Copy sites' logins from your Chrome into the Browsers' own",
        onclick: () => { closeMore(); logins(); } }, "Import logins from your Chrome…")));
    b.host.append(m);
    b.more = m;
    m.querySelector("button:not([disabled])")?.focus();
  }
  async function logins() {
    const note = el("div", { class: "note", text: "Waiting for your Chrome: click Allow in its “Allow remote debugging?” dialog…" });
    const filter = el("input", { type: "text", placeholder: "Filter sites", spellcheck: "false", "aria-label": "Filter sites", hidden: "" });
    const list = el("div", { class: "list", role: "group", "aria-label": "Sites", hidden: "" });
    const count = el("span", { class: "note" });
    const take = el("button", { type: "button", class: "primary", disabled: "" }, "Import");
    const sheet = bwShield(el("div", { class: "bw-sheet", role: "dialog", "aria-label": "Import logins" },
      el("div", { class: "box" }, el("h4", { text: "Import logins from your Chrome" }), note, filter, list,
        el("div", { class: "row" }, count, el("button", { type: "button", onclick: () => sheet.remove() }, "Cancel"), take))));
    sheet.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.preventDefault(); sheet.remove(); } });
    b.host.append(sheet);
    const picked = new Set();
    let sites = [];
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      list.replaceChildren(...sites.filter((x) => !q || x.site.includes(q)).map((x) => el("label", {},
        Object.assign(el("input", { type: "checkbox", onchange: (ev) => { if (ev.target.checked) picked.add(x.site); else picked.delete(x.site); drawCount(); } }), { checked: picked.has(x.site) }),
        el("span", { text: x.site }), el("span", { class: "n", text: `${x.cookies}` }))));
    };
    const drawCount = () => {
      count.textContent = picked.size ? `${picked.size} picked` : "";
      if (picked.size) take.removeAttribute("disabled"); else take.setAttribute("disabled", "");
    };
    filter.addEventListener("input", draw);
    try {
      sites = (await get("logins", true)).sites || [];
    } catch (e) {
      note.textContent = e.message;
      note.classList.add("err");
      return;
    }
    note.textContent = `Your Chrome has cookies for ${sites.length} sites. Pick those whose logins every Browser here, and its agent, may use.`;
    filter.hidden = list.hidden = false;
    draw();
    filter.focus();
    take.addEventListener("click", async () => {
      take.setAttribute("disabled", "");
      try {
        const got = await post("logins", { sites: [...picked] }, true);
        const done = got.imported.map((i) => `${i.site} (${i.cookies} cookie${i.cookies === 1 ? "" : "s"})`).join(", ");
        const again = got.reloaded ? ` ${got.reloaded} tab${got.reloaded === 1 ? "" : "s"} on them loaded again.` : "";
        note.textContent = `Imported: ${done}.${again}`;
        note.classList.remove("err");
        filter.hidden = list.hidden = true;
        count.textContent = "";
      } catch (e) {
        count.textContent = e.message;
        drawCount();
      }
    });
  }

  // ---------------------------------------------------------------- started
  // a link clicked in the dashboard, in an agent's pane (the open-url intent): opened here -- in the tab shown, if this
  // Browser was just opened for it, else in a new tab (backend.py's `open`)
  ag.intents.on("open-url", (d) => {
    if (d && d.url) post("open", { url: String(d.url) }).catch(bwSay(b));
  });
  // its agent's next message, seen by the backend, puts the picks away: drawn again with the state that says so
  tellScheme();
  bwListen(b);
  bwDraw(b);
  requestAnimationFrame(() => bwResize(b));
})();
