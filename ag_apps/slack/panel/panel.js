/* The Slack panel: the user's conversations, the one open with its thread beside it, new messages as the backend
tells them (backend.py), and drafts agents made, which only the user sends. Everything a message says is drawn as DOM
nodes from its text (`render`), never as HTML; links go out only to http, https and mailto. */
(async function () {
  "use strict";
  const ag = await AgApp.connect();
  const $ = (id) => document.getElementById(id);
  // Slack's emoji names, as Slack has them (emoji-datasource: emoji.json, made from it): {names: {name: character},
  // groups: [[category, [name, ...]], ...]} -- the picker's order
  const EMO = await fetch("emoji.json").then((r) => r.json()).catch(() => ({ names: {}, groups: [] }));
  const enc = encodeURIComponent;

  // ---------------------------------------------------------------- small helpers
  const SVG = {
    gear: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2" stroke-linecap="round"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    pen: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 13.5h2.8L13 5.8 10.2 3 2.5 10.7z"/></svg>',
    thread: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 3h11v7.5H6.2L2.5 13.5z"/></svg>',
    send: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2 8l12-6-4.5 12-1.6-4.6z"/></svg>',
    lock: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>',
    caret: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
    clock: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/></svg>',
    bell: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4 11.5V7.2a4 4 0 018 0v4.3l1.2 1.3H2.8z"/><path d="M6.5 14.2a1.6 1.6 0 003 0" stroke-linecap="round"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    people: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="5.5" r="2.4"/><path d="M1.8 13.5c.5-2.4 2.2-3.6 4.2-3.6s3.7 1.2 4.2 3.6" stroke-linecap="round"/><path d="M10.6 3.4a2.3 2.3 0 010 4.3M12 9.9c1.2.5 2 1.6 2.3 3.6" stroke-linecap="round"/></svg>',
  };
  function icon(name) {
    const t = document.createElement("template");
    t.innerHTML = SVG[name];
    const s = t.content.firstChild;
    s.setAttribute("aria-hidden", "true");
    return s;
  }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (k === "value") n.value = v;
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) {
      if (k === null || k === undefined || k === false || k === "") continue;
      n.append(k instanceof Node ? k : String(k));
    }
    return n;
  }
  const keep = {
    get(k, d) { try { const v = localStorage.getItem(`slack:${ag.instance}:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`slack:${ag.instance}:${k}`, JSON.stringify(v)); } catch { /* storage off: kept for now only */ } },
  };
  async function get(path) {
    const r = await ag.api(path);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${r.status}`);
    return j;
  }
  async function post(path, body) {
    const r = await ag.api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${r.status}`);
    return j;
  }
  const num = (ts) => { const n = parseFloat(ts); return Number.isFinite(n) ? n : 0; };
  const byTs = (a, b) => num(a.ts) - num(b.ts);

  // ---------------------------------------------------------------- what the panel holds
  const S = {
    setup: null, settings: {}, convs: new Map(), unread: {}, users: {}, drafts: new Map(),
    open: null, filter: keep.get("filter", "recent"), q: "",
    msgs: new Map(),          // conversation -> {list, more, loaded, older}
    readAt: {},               // conversation -> where it was read up to when opened: the "New" line's place
    thread: null,             // {cid, ts, list, loading, error}
    typed: new Map(keep.get("typed", [])),   // what was typed, per conversation (and thread), not yet sent
    folded: keep.get("folded", {}),          // the conversation list's sections folded: {drafts, channels, dms}
    newCount: 0, pinned: true, asked: null,
    members: new Map(),       // conversation -> who is in it (ids), asked when it is opened
    scheduled: new Map(),     // conversation -> its messages waiting to be posted
    editing: null,            // {cid, ts, text}: one of the user's messages being edited, and what is typed so far
    view: null,               // "threads" | "activity": shown over the conversation
    badges: {},               // {threads, activity}: those rows' counts
  };
  const me = () => (S.setup && S.setup.me) || "";
  const SYSTEM = new Set(["channel_join", "channel_leave", "group_join", "group_leave", "channel_topic", "channel_purpose",
    "channel_name", "group_topic", "group_purpose", "group_name", "channel_archive", "channel_unarchive", "pinned_item", "unpinned_item"]);
  const topLevel = (m) => !m.thread_ts || m.thread_ts === m.ts || m.subtype === "thread_broadcast";

  // ---------------------------------------------------------------- names, faces, times
  function uname(uid) { const u = S.users[uid]; return (u && (u.name || u.handle)) || uid || "someone"; }
  function who(m) { return m.bot_name || uname(m.user); }
  function hue(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
  function initials(name) {
    const p = String(name).trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  // a person's photo (Slack serves it to anyone), or their initials on a colour when there is none or it fails
  function face(uid, label, cls = "av", key = uid) {
    const u = uid && S.users[uid];
    const fall = () => el("span", { class: cls, "aria-hidden": "true", style: `--h:${hue(key || label)}` }, initials(label));
    if (!u || !u.image) return fall();
    const img = el("img", { class: `${cls} pic`, src: u.image, alt: "", "aria-hidden": "true", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.replaceWith(fall()), { once: true });
    return img;
  }
  function avatar(m) { return face(m.bot_name ? "" : m.user, who(m), "av", m.user || who(m)); }
  function statusOf(uid) {                       // a person's status, while it lasts
    const st = uid && S.users[uid] && S.users[uid].status;
    return st && !(st.until && st.until * 1000 < Date.now()) ? st : null;
  }
  function statusEl(uid) {
    const st = statusOf(uid);
    return st ? el("span", { class: "stat", title: st.text || st.emoji }, (st.emoji && emojiOf(st.emoji)) || "💬") : "";
  }
  function localTime(tz) { try { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz }); } catch { return ""; } }
  function convName(c) {
    if (!c) return "";
    if (c.kind === "channel" || c.kind === "private") return c.name || c.id;
    if (c.kind === "im") return uname(c.user);
    return (c.label || "").replace(/^group DM with /, "") || c.name || c.id;
  }
  function place(c) { return !c ? "" : (c.kind === "channel" || c.kind === "private") ? `#${convName(c)}` : convName(c); }
  const tsDate = (ts) => new Date(num(ts) * 1000);
  const clock = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  function timeEl(ts) {
    const d = tsDate(ts);
    return el("time", { datetime: d.toISOString(), title: d.toLocaleString([], { dateStyle: "full", timeStyle: "short" }) }, clock(d));
  }
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  function dayLabel(d) {
    const now = new Date();
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((a - b) / 86400000);            // calendar days, not 24-hour spans
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: "long" });
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric",
      ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
  }
  function ago(ts) {
    const d = tsDate(ts), s = (Date.now() - d) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    return dayKey(d) === dayKey(new Date()) ? `at ${clock(d)}` : `${dayLabel(d)} at ${clock(d)}`;
  }

  // ---------------------------------------------------------------- Slack's mrkdwn, drawn as nodes
  let CUSTOM = {};             // the workspace's own emoji: name -> its picture's address, or "alias:<name>"
  const EXTRA = { simple_smile: "🙂" };                    // Slack's own, not Unicode's
  const TONES = { "skin-tone-2": "\u{1F3FB}", "skin-tone-3": "\u{1F3FC}", "skin-tone-4": "\u{1F3FD}", "skin-tone-5": "\u{1F3FE}", "skin-tone-6": "\u{1F3FF}" };
  function emoji(name, depth = 0) {              // -> {char} | {url} | null
    const c = CUSTOM[name];
    if (typeof c === "string") return c.startsWith("alias:") ? (depth < 3 ? emoji(c.slice(6), depth + 1) : null) : { url: c };
    const ch = EMO.names[name] || EXTRA[name];
    return ch ? { char: ch } : null;
  }
  function emojiEl(name, tone, cls = "emoji") {
    const e = emoji(name), title = `:${name}:`;
    if (!e) return null;
    if (e.url) return el("img", { class: `${cls} custom`, src: e.url, alt: title, title, loading: "lazy" });
    return el("span", { class: cls, title, role: "img", "aria-label": title }, tone && TONES[tone] ? e.char.replace(/\uFE0F/g, "") + TONES[tone] : e.char);
  }
  function emojiOf(code) {                       // ":palm_tree:", "+1::skin-tone-2" -> its node, or null
    const [nm, tone] = String(code || "").replace(/^:|:$/g, "").split("::");
    return nm ? emojiEl(nm, tone) : null;
  }
  const EMOJI_ONLY = /^\s*(?::[a-z0-9_+'-]+:(?::skin-tone-[2-6]:)?\s*){1,23}$/;
  const onlyEmoji = (text) => EMOJI_ONLY.test(text || "") && [...String(text).matchAll(/:([a-z0-9_+'-]+):/g)].every((x) => x[1].startsWith("skin-tone-") || emoji(x[1]));
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  function safeHref(u) {
    try { const x = new URL(u); return ["http:", "https:", "mailto:"].includes(x.protocol) ? x.href : null; } catch { return null; }
  }
  const TOKEN = /(`[^`\n]+`)|(<[^<>\n]+>)|((?<![\w*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\w*]))|((?<![\w_])_(?!\s)[^_\n]+?(?<!\s)_(?![\w_]))|((?<![\w~])~(?!\s)[^~\n]+?(?<!\s)~(?![\w~]))|(:[a-z0-9_+'-]+:(?::skin-tone-[2-6]:)?)/g;
  function ref(body) {
    const bar = body.indexOf("|");
    const r = bar < 0 ? body : body.slice(0, bar), label = bar < 0 ? "" : unesc(body.slice(bar + 1));
    if (r[0] === "@") { const id = r.slice(1); return el("span", { class: `at${id === me() ? " me" : ""}` }, `@${label || uname(id)}`); }
    if (r[0] === "#") { const id = r.slice(1), c = S.convs.get(id); return el("span", { class: "at" }, `#${label || (c && c.name) || id}`); }
    if (r.startsWith("!subteam^")) return el("span", { class: "at" }, `@${label || "group"}`);
    if (r[0] === "!") return el("span", { class: "at me" }, `@${label || r.slice(1).split("^")[0]}`);
    const href = safeHref(unesc(r)), text = label || unesc(r).replace(/^mailto:/, "");
    return href ? el("a", { href, target: "_blank", rel: "noopener noreferrer" }, text) : document.createTextNode(text);
  }
  function inline(parent, s) {
    let at = 0;
    for (const m of s.matchAll(TOKEN)) {
      if (m.index > at) parent.append(unesc(s.slice(at, m.index)));
      const t = m[0];
      if (m[1]) parent.append(el("code", null, unesc(t.slice(1, -1))));
      else if (m[2]) parent.append(ref(t.slice(1, -1)));
      else if (m[3] || m[4] || m[5]) { const n = el(m[3] ? "b" : m[4] ? "i" : "s"); inline(n, t.slice(1, -1)); parent.append(n); }
      else parent.append(emojiOf(t) || t);
      at = m.index + t.length;
    }
    if (at < s.length) parent.append(unesc(s.slice(at)));
  }
  function lines(parent, s) {
    let quote = null, first = true;
    for (const line of s.split("\n")) {
      const q = /^(?:&gt;|>) ?/.exec(line);
      if (q) {
        if (!quote) { quote = el("blockquote"); parent.append(quote); } else quote.append("\n");
        inline(quote, line.slice(q[0].length));
      } else {
        if (!first && !quote) parent.append("\n");
        quote = null;
        inline(parent, line);
      }
      first = false;
    }
  }
  function render(text) {
    const frag = document.createDocumentFragment();
    const parts = String(text || "").split("```");
    const closed = parts.length % 2 === 1;                          // every fence closed
    parts.forEach((p, i) => {
      if (i % 2 === 1 && (closed || i < parts.length - 1)) {
        frag.append(el("pre", null, unesc(p.replace(/^\n/, "").replace(/\n$/, ""))));
        return;
      }
      let s = i % 2 === 1 ? "```" + p : p;                          // a fence never closed: text, as typed
      if (i > 0 && i % 2 === 0) s = s.replace(/^\n/, "");          // just after a code block
      if (i < parts.length - 1 && i % 2 === 0) s = s.replace(/\n$/, "");   // just before one
      if (s) lines(frag, s);
    });
    return frag;
  }
  function plainText(text) {                       // what an agent is quoted: names for ids, no markup
    return String(text || "").replace(/<([^<>\n]+)>/g, (_, body) => {
      const bar = body.indexOf("|"), r = bar < 0 ? body : body.slice(0, bar), label = bar < 0 ? "" : body.slice(bar + 1);
      if (r[0] === "@") return `@${label || uname(r.slice(1))}`;
      if (r[0] === "#") { const c = S.convs.get(r.slice(1)); return `#${label || (c && c.name) || r.slice(1)}`; }
      if (r[0] === "!") return `@${label || r.slice(1).split("^")[0]}`;
      return label ? `${label} (${r})` : r;
    }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }

  // ---------------------------------------------------------------- agents
  function actorsHere() {
    const cur = ag.actors.current;
    const g = cur && (cur.gatherers || []).find((x) => x.name === ag.gatherer);
    return (g && g.agents) || [];
  }
  function actor(ch) {
    const a = actorsHere().find((x) => x.channel === ch);
    const st = ag.agents.state(ch);
    return { channel: ch, name: (a && a.name) || (st && st.name) || (ch ? `actor ${ch.slice(0, 8)}` : "an agent"),
      hue: a && a.avatar_hue !== undefined ? a.avatar_hue : hue(ch || "") };
  }
  const attached = () => ag.agents.attached.map(actor);
  function drawAgents() {
    const box = $("agents");
    const list = attached();
    box.replaceChildren(list.length ? "Working with it:" : "No agent working with Slack",
      ...list.map((a) => el("button", { type: "button", class: "chip", title: `Go to ${a.name}`, onclick: () => ag.agents.focus(a.channel) },
        el("span", { class: "dot", style: `--h:${a.hue}`, "aria-hidden": "true" }), a.name)));
  }
  async function toAgent(ch, text) {
    if (!ag.agents.attached.includes(ch)) await ag.agents.attach(ch);
    await ag.agents.send(ch, text);
  }

  // ---------------------------------------------------------------- popovers
  let popClose = null;
  function openPop(anchor, build) {
    closePop();
    const pop = $("pop");
    pop.replaceChildren();
    build(pop);
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8), top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
    const f = pop.querySelector("textarea, input:not([type=radio]):not([type=checkbox]), button");
    if (f) f.focus();
    const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePop(); };
    setTimeout(() => document.addEventListener("mousedown", away), 0);
    popClose = () => { document.removeEventListener("mousedown", away); pop.hidden = true; anchor.focus({ preventScroll: true }); };
  }
  function closePop() { if (popClose) { const c = popClose; popClose = null; c(); } }

  // "Reply with Claude" / "Draft with Claude": what the user wants, to an agent working with Slack (one picked, or attached)
  function askClaude(anchor, what) {
    openPop(anchor, (pop) => {
      const list = attached();
      let pick = list.length ? list[0].channel : null;
      const ta = el("textarea", { rows: "3", placeholder: what.kind === "reply" ? "How should it reply? (optional)" : "What should it write?" });
      ta.value = what.instruction || "";
      const err = el("div", { class: "note", role: "alert" });
      pop.append(el("h3", null, what.kind === "reply" ? "Reply with Claude" : "Draft with Claude"), ta);
      if (list.length > 1) {
        pop.append(el("fieldset", null, el("legend", null, "Ask"), ...list.map((a, i) =>
          el("label", null, el("input", { type: "radio", name: "pick-agent", checked: i === 0, onchange: () => { pick = a.channel; } }), a.name))));
      } else if (!list.length) {
        const others = actorsHere().filter((a) => a.channel);
        pop.append(el("div", { class: "note" }, others.length ? "No agent works with Slack yet. Pick one to work with it, or start one from the + menu (Slack)."
          : "No agent works with Slack yet. Start one from the + menu: Slack."));
        const box = el("div");
        for (const a of others.slice(0, 8)) {
          const b = el("button", { type: "button", class: "pick", "aria-pressed": "false", onclick: () => {
            pick = a.channel;
            for (const o of box.children) o.setAttribute("aria-pressed", String(o === b));
          } }, el("span", { class: "dot", style: `--h:${a.avatar_hue !== undefined ? a.avatar_hue : hue(a.channel)}`, "aria-hidden": "true" }),
          a.name || a.channel.slice(0, 8));
          box.append(b);
        }
        pop.append(box);
      }
      const go = el("button", { type: "button", class: "btn primary small", onclick: async () => {
        if (!pick) { err.textContent = "Pick an agent first."; return; }
        if (what.kind !== "reply" && !ta.value.trim()) { err.textContent = "Say what it should write."; ta.focus(); return; }
        go.disabled = true;
        try {
          await toAgent(pick, what.message(ta.value.trim()));
          S.asked = { channel: pick, cid: what.cid, at: Date.now() };
          closePop();
          if (what.done) what.done();
          drawAsked();
        } catch (e) { err.textContent = `Couldn't ask it: ${e.message}`; go.disabled = false; }
      } }, "Ask");
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); go.click(); } });
      pop.append(el("div", { class: "row" }, go, el("span", { class: "note" }, "It drafts; you send.")), err);
    });
  }
  function replyAsk(cid, m) {
    const c = S.convs.get(cid) || { id: cid, kind: "channel" };
    const inThread = m.thread_ts && m.thread_ts !== m.ts;
    const thread = inThread ? m.thread_ts : (c.kind === "channel" || c.kind === "private") ? m.ts : "";
    const when = tsDate(m.ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    const said = c.kind === "im" ? `${who(m)} wrote to me in a DM (${when}):`
      : `${who(m)} wrote in ${c.kind === "mpim" ? `a group DM with ${convName(c)}` : place(c)}${inThread ? ", in a thread" : ""} (${when}):`;
    return {
      kind: "reply", cid,
      message: (how) => [
        `Reply to this Slack message for me. Draft the reply with slack_draft (conversation ${cid}${thread ? `, thread ${thread}` : ""}); I'll send it from the Slack panel.`,
        "",
        said,
        ...plainText(m.text).split("\n").map((l) => `> ${l}`),
        "",
        `[conversation ${cid}, ts ${m.ts}]`,
        ...(how ? ["", `How: ${how}`] : []),
      ].join("\n"),
    };
  }
  function drawAsked() {
    const note = document.querySelector("#composer .under");
    if (!note) return;
    const a = S.asked;
    if (a && a.cid === S.open && Date.now() - a.at < 180000) note.replaceChildren(`Asked ${actor(a.channel).name}. Its draft will show here, for you to send.`);
    else note.replaceChildren();
  }

  // ---------------------------------------------------------------- the conversations
  function setLists(x) {
    if (x.users) S.users = x.users;
    if (x.unread) S.unread = x.unread;
    if (x.conversations) {
      const was = S.convs;
      S.convs = new Map(x.conversations.map((c) => [c.id, c]));
      for (const [id, c] of was) if (!S.convs.has(id) && id === S.open) S.convs.set(id, c);   // kept while it is open
    }
  }
  function glyph(c) {
    if (c.kind === "channel") return el("span", { class: "g", "aria-hidden": "true" }, "#");
    if (c.kind === "private") { const g = el("span", { class: "g", "aria-hidden": "true" }); g.append(icon("lock")); g.style.display = "grid"; g.style.placeItems = "center"; return g; }
    if (c.kind === "im") return el("span", { class: "g", "aria-hidden": "true" }, face(c.user, convName(c), "g-av"));
    return el("span", { class: "g", "aria-hidden": "true" }, el("span", { class: "dot", style: `--h:${hue(c.user || c.id)};width:12px;height:12px;display:inline-block;vertical-align:-1px` }));
  }
  function convRow(c, when) {
    const [u, m] = S.unread[c.id] || [0, 0];
    const label = convName(c);
    const b = el("button", { type: "button", class: `cv${u ? " unread" : ""}`, "aria-current": S.open === c.id && !S.view ? "page" : null,
      "aria-label": `${place(c)}${u ? `, ${u} unread` : ""}${m ? `, ${m} for you` : ""}`, onclick: () => open(c.id) },
      glyph(c), el("span", { class: "nm" }, label), c.kind === "im" ? statusEl(c.user) : "");
    if (when && act(c)) b.append(el("time", { class: "when", datetime: tsDate(act(c)).toISOString(), title: tsDate(act(c)).toLocaleString() }, shortAgo(act(c))));
    if (m) b.append(el("span", { class: "badge", "aria-hidden": "true" }, m > 99 ? "99+" : String(m)));
    else if (u) b.append(el("span", { class: "count", "aria-hidden": "true" }, u > 99 ? "99+" : String(u)));
    return b;
  }
  const RECENT_DAYS = 14, RECENT_MAX = 25;            // (a section's)
  const act = (c) => Math.max(num(c.latest_ts), num(c.active_ts));      // when it was last active (seconds; 0: not known)
  function shortAgo(t) {
    const d = new Date(t * 1000), s = Date.now() / 1000 - t;
    if (s < 60) return "now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (dayKey(d) === dayKey(new Date())) return `${Math.floor(s / 3600)}h`;
    const days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
    if (days === 1) return "Yesterday";
    if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  // Recent: one list of the conversations active in the last RECENT_DAYS days (and any unread, or open), newest first
  function recentRows() {
    const since = Date.now() / 1000 - RECENT_DAYS * 86400;
    const list = [...S.convs.values()].filter((c) => act(c) > since || (S.unread[c.id] || [0])[0] || c.id === S.open)
      .sort((a, b) => act(b) - act(a) || convName(a).localeCompare(convName(b)));
    return list;
  }
  function drawConvs() {
    const box = $("convs");
    const q = S.q.trim().toLowerCase();
    const show = (c) => {
      const [u, m] = S.unread[c.id] || [0, 0];
      if (S.filter === "unread" && !u) return false;
      if (S.filter === "mentions" && !m) return false;
      return !q || convName(c).toLowerCase().includes(q);
    };
    const all = [...S.convs.values()];
    const chans = all.filter((c) => (c.kind === "channel" || c.kind === "private") && show(c)).sort((a, b) => convName(a).localeCompare(convName(b)));
    const dms = all.filter((c) => (c.kind === "im" || c.kind === "mpim") && show(c))
      .sort((a, b) => (num(b.latest_ts) - num(a.latest_ts)) || convName(a).localeCompare(convName(b)));
    const kids = q ? [] : sideViews();
    const drafts = [...S.drafts.values()];
    if (drafts.length && !q) {
      kids.push(...section("drafts", `Drafts to send (${drafts.length})`, drafts.map((d) => {
        const c = S.convs.get(d.channel);
        return { open: false, el: el("button", { type: "button", class: "cv unread", onclick: () => open(d.channel, { thread: d.thread_ts || null }) },
          el("span", { class: "g", "aria-hidden": "true" }, icon("pen")), el("span", { class: "nm" }, c ? place(c) : d.label),
          d.thread_ts ? el("span", { class: "count" }, "thread") : "") };
      })));
    }
    const rows = (list) => list.map((c) => ({ open: c.id === S.open, el: convRow(c) }));
    if (S.filter === "recent" && !q) {
      const list = recentRows();
      const isChan = (c) => c.kind === "channel" || c.kind === "private";
      const ch = list.filter(isChan), dm = list.filter((c) => !isChan(c));
      const shown = (l) => l.slice(0, RECENT_MAX).map((c) => ({ open: c.id === S.open, el: convRow(c, true) }));
      if (ch.length) kids.push(...section("channels", "Channels", shown(ch), ch));
      kids.push(...section("dms", "Direct messages", shown(dm), dm, newDMButton()));
      if (!list.length) {
        const s = S.setup || {};
        kids.push(el("div", { class: "sec-empty" }, s.status === "connecting" ? "Finding your recent conversations…" : `Nothing in the last ${RECENT_DAYS} days.`));
      }
      const more = Math.max(0, ch.length - RECENT_MAX) + Math.max(0, dm.length - RECENT_MAX);
      kids.push(el("div", { class: "sec-empty" }, `Active in the last ${RECENT_DAYS} days`),
        el("button", { type: "button", class: "all-link", onclick: () => setFilter("all") },
          more ? `${more} more, and all ${S.convs.size} conversations` : `All ${S.convs.size} conversations`));
    } else {
      if (chans.length) kids.push(...section("channels", "Channels", rows(chans), chans));
      if (dms.length || !q) kids.push(...section("dms", "Direct messages", rows(dms), dms, q ? null : newDMButton()));
      if (!chans.length && !dms.length) kids.push(el("div", { class: "sec-empty" }, q || S.filter !== "all" ? "Nothing here" : "No conversations yet"));
    }
    const top = box.scrollTop;
    box.replaceChildren(...kids);
    box.scrollTop = top;
  }
  // a section's heading, which folds it -- folded, only the conversation open stays, and the heading carries the
  // section's unread count -- and its rows ({el, open})
  function sideViews() {
    const b = S.badges || {};
    const row = (key, label, ic, n) => el("button", { type: "button", class: `cv view${n ? " unread" : ""}`, "aria-current": S.view === key ? "page" : null,
      "aria-label": `${label}${n ? `, ${n} new` : ""}`, onclick: () => showView(key) },
      el("span", { class: "g", "aria-hidden": "true" }, icon(ic)), el("span", { class: "nm" }, label),
      n ? el("span", { class: "badge", "aria-hidden": "true" }, n > 99 ? "99+" : String(n)) : "");
    return [row("threads", "Threads", "thread", b.threads), row("activity", "Activity", "bell", b.activity)];
  }
  const newDMButton = () => el("button", { type: "button", class: "sec-add", "aria-label": "New message", title: "New message",
    onclick: (e) => newDM(e.currentTarget) }, icon("plus"));
  function section(key, label, rows, convs, action) {
    const folded = !!S.folded[key];
    let u = 0, m = 0;
    for (const c of convs || []) { const x = S.unread[c.id] || [0, 0]; u += x[0]; m += x[1]; }
    const sum = !folded ? "" : m ? el("span", { class: "badge", "aria-label": `${m} for you` }, m > 99 ? "99+" : String(m))
      : u ? el("span", { class: "count", "aria-label": `${u} unread` }, u > 99 ? "99+" : String(u)) : "";
    const head = el("button", { type: "button", class: "sec", "aria-expanded": String(!folded),
      onclick: () => { S.folded[key] = !folded; keep.set("folded", S.folded); drawConvs(); } },
      el("span", { class: "caret", "aria-hidden": "true" }, icon("caret")), el("span", { class: "lbl" }, label), sum);
    return [action ? el("div", { class: "sec-row" }, head, action) : head, ...(folded ? rows.filter((r) => r.open) : rows).map((r) => r.el)];
  }
  function drawStatus() {
    const s = S.setup || {}, box = $("status");
    const [cls, text] = s.status === "connected" ? ["on", "Live: new messages arrive as they're sent"]
      : s.status === "connecting" ? ["warn", "Connecting to Slack…"]
      : s.status === "live-off" ? ["warn", "No app-level token: new messages show when you open a conversation"]
      : s.status === "copied" ? ["warn", "A copy of another ag home: new messages show when you open a conversation"]
      : s.status === "disconnected" ? ["warn", "Reconnecting…"]
      : s.status === "error" ? ["bad", `Can't reach Slack: ${s.error || "unknown error"}`]
      : ["", "Not connected"];
    box.className = `status ${cls}`;
    box.title = s.status === "copied" ? `Slack's live line stays with ${s.copy_of}, where you connected it, so this copy doesn't take its messages. Connecting again here moves it.` : "";
    box.replaceChildren(el("span", { class: "led", "aria-hidden": "true" }), el("span", null, text));
    $("team").textContent = s.team || "";
  }
  // the open conversation's head: its name; a DM's person (status, title, their time) or a channel's topic; who is in it
  function drawHead() {
    const c = S.convs.get(S.open), head = $("conv-head");
    if (!c) { head.replaceChildren(); return; }
    const kids = [el("span", { class: "nm" }, place(c))];
    if (c.kind === "im") {
      const u = S.users[c.user] || {}, st = statusOf(c.user);
      const bits = [u.title, u.tz && localTime(u.tz) && `${localTime(u.tz)} their time`].filter(Boolean);
      const about = el("span", { class: "topic" });
      if (st) about.append(emojiOf(st.emoji) || "", st.text ? ` ${st.text}` : "", bits.length ? " · " : "");
      about.append(bits.join(" · "));
      kids.push(about);
    } else kids.push(el("span", { class: "topic", title: plainText(c.topic) }, c.topic ? plainText(c.topic) : ""));
    const tools = el("span", { class: "head-tools" });
    if (c.kind !== "im") {
      const ids = S.members.get(c.id);
      tools.append(el("button", { type: "button", class: "head-btn", title: "Members", "aria-label": `Members${ids ? ` (${ids.length})` : ""}`,
        onclick: (e) => membersPop(e.currentTarget, c) }, icon("people"), ids ? el("span", null, String(ids.length)) : ""));
    }
    head.replaceChildren(...kids, tools);
  }
  async function loadMembers(cid) {
    const c = S.convs.get(cid);
    if (!c || c.kind === "im") return;
    try { const got = await get(`members?conversation=${enc(cid)}`); S.members.set(cid, got.members || []); } catch { return; }
    if (S.open === cid) drawHead();
  }
  function membersPop(anchor, c) {
    openPop(anchor, (pop) => {
      const ids = (S.members.get(c.id) || []).slice().sort((a, b) => uname(a).localeCompare(uname(b)));
      const find = ids.length > 10 ? el("input", { type: "text", placeholder: `Find among ${ids.length}`, "aria-label": "Find a member" }) : null;
      const list = el("div", { class: "people" });
      const draw = () => {
        const q = find ? find.value.trim().toLowerCase() : "";
        list.replaceChildren(...ids.filter((id) => !q || uname(id).toLowerCase().includes(q) || ((S.users[id] || {}).handle || "").toLowerCase().includes(q)).slice(0, 200)
          .map((id) => el("div", { class: "person" }, face(id, uname(id), "av sm"), el("span", { class: "pn" }, el("b", null, uname(id)), statusEl(id),
            (S.users[id] || {}).title ? el("span", { class: "meta" }, ` ${S.users[id].title}`) : ""),
          id === me() ? el("span", { class: "meta" }, "you") : el("button", { type: "button", class: "btn small quiet", onclick: () => { closePop(); openDM([id]).catch((e) => say(e.message)); } }, "Message"))));
      };
      pop.classList.add("wide");
      pop.append(el("h3", null, `${ids.length || "No"} ${ids.length === 1 ? "member" : "members"} of ${place(c)}`), find || "", list);
      if (find) find.addEventListener("input", draw);
      draw();
    });
  }

  // ---------------------------------------------------------------- the messages
  function msgEl(m, cid, { cont, inThread }) {
    const mine = m.user && m.user === me();
    const mention = !mine && me() && (m.text || "").includes(`<@${me()}>`);
    const sys = SYSTEM.has(m.subtype);
    const row = el("div", { class: `msg${cont ? "" : " first"}${mention ? " mention" : ""}`, "data-ts": m.ts });
    row.append(cont ? el("span", { class: "gut", "aria-hidden": "true" }, clock(tsDate(m.ts))) : avatar(m));
    const body = el("div", { class: "mb" });
    if (!cont) body.append(el("div", { class: "who" }, el("b", null, who(m)), m.bot_name ? "" : statusEl(m.user), timeEl(m.ts)));
    else body.append(el("span", { class: "sr" }, `${who(m)}, ${clock(tsDate(m.ts))}`));
    if (S.editing && S.editing.cid === cid && S.editing.ts === m.ts) body.append(editor(cid, m));
    else {
      const txt = el("div", { class: `txt${sys ? " sys" : ""}${onlyEmoji(m.text) ? " jumbo" : ""}` });
      txt.append(render(m.text));
      if (m.edited) txt.append(" ", el("span", { class: "edited" }, "(edited)"));
      body.append(txt);
    }
    for (const a of m.attachments || []) body.append(el("div", { class: "att" }, a.title ? el("b", null, a.title, a.text ? "\n" : "") : "", render(a.text)));
    if ((m.files || []).length) body.append(el("div", { class: "files" }, m.files.map((f) => el("span", { class: "file" }, f.title || f.name))));
    if ((m.reactions || []).length) {
      body.append(el("div", { class: "reacts" }, m.reactions.map((r) => el("span", { class: `react${r.mine ? " mine" : ""}`,
        title: `${r.count} reacted with :${r.name}:${r.mine ? " (you too)" : ""}` }, el("span", { "aria-hidden": "true" }, emojiOf(r.name) || `:${r.name}:`), el("span", null, String(r.count))))));
    }
    if (!inThread && m.subtype === "thread_broadcast" && m.thread_ts) {
      body.append(el("button", { type: "button", class: "replies", onclick: () => openThread(cid, m.thread_ts) }, "Replied to a thread"));
    } else if (!inThread && m.reply_count && (!m.thread_ts || m.thread_ts === m.ts)) {
      body.append(el("button", { type: "button", class: "replies", onclick: () => openThread(cid, m.ts) },
        `${m.reply_count} ${m.reply_count === 1 ? "reply" : "replies"}`, m.latest_reply ? el("span", null, `Last reply ${ago(m.latest_reply)}`) : ""));
    }
    row.append(body);
    if (!sys) {
      const acts = el("div", { class: "acts" });
      if (!mine) {
        acts.append(el("button", { type: "button", class: "act ai", onclick: (e) => askClaude(e.currentTarget, replyAsk(cid, m)) }, icon("pen"), "Reply with Claude"));
      }
      if (!inThread && topLevel(m) && m.subtype !== "thread_broadcast") {
        acts.append(el("button", { type: "button", class: "act", "aria-label": "Reply in thread", title: "Reply in thread", onclick: () => openThread(cid, m.ts) }, icon("thread")));
      }
      acts.append(el("button", { type: "button", class: "act", "aria-label": "More actions", title: "More", "aria-haspopup": "menu",
        onclick: (e) => msgMenu(e.currentTarget, cid, m) }, icon("more")));
      if (acts.children.length) row.append(acts);
    }
    return row;
  }
  // ---------------------------------------------------------------- a message's menu: its link, and the user's own edited or deleted
  function msgMenu(anchor, cid, m) {
    openPop(anchor, (pop) => {
      pop.classList.add("menu");
      pop.setAttribute("role", "menu");
      let url = "";
      const copy = el("button", { type: "button", class: "mi", role: "menuitem", disabled: true, onclick: async () => {
        closePop(); say((await copyText(url)) ? "Link copied" : url);
      } }, "Copy link");
      const visit = el("a", { class: "mi", role: "menuitem", href: "#", target: "_blank", rel: "noopener noreferrer", "aria-disabled": "true",
        onclick: (e) => { if (!url) e.preventDefault(); else closePop(); } }, "Open in Slack");
      get(`permalink?conversation=${enc(cid)}&ts=${enc(m.ts)}`)
        .then((g) => { url = g.url || ""; if (url) { visit.href = url; visit.removeAttribute("aria-disabled"); copy.disabled = false; } })
        .catch(() => { copy.textContent = "Copy link (Slack didn't give one)"; });
      pop.append(copy, visit);
      if (m.user && m.user === me() && !SYSTEM.has(m.subtype)) {
        pop.append(el("hr"),
          el("button", { type: "button", class: "mi", role: "menuitem", onclick: () => { closePop(); editMessage(cid, m); } }, "Edit message"),
          el("button", { type: "button", class: "mi danger", role: "menuitem", onclick: () => confirmDelete(anchor, cid, m) }, "Delete message…"));
      }
    });
  }
  function confirmDelete(anchor, cid, m) {
    openPop(anchor, (pop) => {
      const err = el("div", { class: "note", role: "alert" });
      const go = el("button", { type: "button", class: "btn small danger", onclick: async () => {
        go.disabled = true;
        try { await post("delete", { conversation: cid, ts: m.ts }); closePop(); } catch (e) { err.textContent = e.message; go.disabled = false; }
      } }, "Delete");
      pop.append(el("h3", null, "Delete this message?"), el("div", { class: "note" }, "It goes from Slack for everyone. This can't be undone."),
        el("div", { class: "row" }, el("button", { type: "button", class: "btn small quiet", onclick: closePop }, "Cancel"), go), err);
    });
  }
  // a message's text as the user would type it: people, channels and @here as names (they are made Slack's again when saved)
  function editable(text) {
    return String(text || "").replace(/<([@#!])([^<>|\n]+)(?:\|([^<>\n]*))?>/g, (all, sig, id, label) => {
      if (sig === "@") return `@${uname(id)}`;
      if (sig === "#") { const c = S.convs.get(id); return `#${label || (c && c.name) || id}`; }
      const w = id.split("^")[0];
      return ["here", "channel", "everyone"].includes(w) ? `@${w}` : all;
    }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }
  function redrawFor(cid) {
    if (cid === S.open) drawLog("keep");
    if (S.thread && S.thread.cid === cid) drawThread("keep");
  }
  function editMessage(cid, m) {
    S.editing = { cid, ts: m.ts, text: null };
    redrawFor(cid);
  }
  function grow(ta, most = 240) { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight + 2, most)}px`; }
  function editor(cid, m) {
    const ta = el("textarea", { class: "edit-ta", rows: "1", "aria-label": "Edit your message" });
    const was = editable(m.text);
    ta.value = S.editing.text !== null ? S.editing.text : was;
    const err = el("div", { class: "under", role: "status" });
    const done = () => { S.editing = null; redrawFor(cid); };
    const save = async () => {
      const text = ta.value.replace(/\s+$/, "");
      if (text === was) { done(); return; }
      if (!text.trim()) { err.textContent = "There's no text left: delete the message instead."; return; }
      ta.disabled = true;
      try { const got = await post("edit", { conversation: cid, ts: m.ts, text }); S.editing = null; landedEdit(cid, got.message); }
      catch (e) { err.textContent = `Not saved: ${e.message}`; ta.disabled = false; }
    };
    const sg = attachSuggest(ta);
    ta.addEventListener("input", () => { S.editing.text = ta.value; grow(ta); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); }
      else if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); save(); }
    });
    requestAnimationFrame(() => { grow(ta); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); });
    return el("div", { class: "editing" }, el("div", { class: "cmp" }, sg, ta),
      el("div", { class: "row" }, el("span", { class: "meta" }, "Enter to save, Esc to cancel"),
        el("button", { type: "button", class: "btn small quiet", onclick: done }, "Cancel"),
        el("button", { type: "button", class: "btn small primary", onclick: save }, "Save")), err);
  }
  function landedEdit(cid, m) {
    if (!m) { redrawFor(cid); return; }
    const st = S.msgs.get(cid);
    if (st && st.loaded) { const i = st.list.findIndex((x) => x.ts === m.ts); if (i >= 0) st.list[i] = m; }
    if (S.thread && S.thread.cid === cid) { const i = S.thread.list.findIndex((x) => x.ts === m.ts); if (i >= 0) S.thread.list[i] = m; }
    redrawFor(cid);
  }
  function lastMine(cid, thread) {
    const list = thread ? (S.thread && S.thread.cid === cid && S.thread.ts === thread ? S.thread.list.slice(1) : [])
      : ((S.msgs.get(cid) || {}).list || []).filter(topLevel);
    return [...list].reverse().find((m) => m.user === me() && !SYSTEM.has(m.subtype));
  }
  async function copyText(text) {
    if (!text) return false;
    try { await navigator.clipboard.writeText(text); return true; } catch { /* no clipboard in this frame: the old way */ }
    const t = el("textarea", { style: "position:fixed;opacity:0;top:0;left:0" });
    t.value = text; document.body.append(t); t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
    return ok;
  }
  let sayTimer = null;
  function say(text) {
    const n = $("say");
    n.textContent = text; n.hidden = false;
    clearTimeout(sayTimer); sayTimer = setTimeout(() => { n.hidden = true; }, 3000);
  }

  // ---------------------------------------------------------------- suggestions as the user types: @people, #channels, :emoji:
  const EMO_NAMES = Object.keys(EMO.names).filter((n) => !n.startsWith("skin-tone"));
  function suggestions(sig, q) {
    const starts = (x) => !!x && x.toLowerCase().startsWith(q);
    const words = (x) => !!x && x.toLowerCase().split(/[\s._-]+/).some((w) => w.startsWith(q));
    const out = [];
    if (sig === "@") {
      for (const sp of ["here", "channel", "everyone"]) {
        if (q && sp.startsWith(q)) out.push({ rank: 3, label: `@${sp}`, sub: sp === "here" ? "everyone here who is active" : "everyone in the conversation", insert: `@${sp}` });
      }
      const seen = {};
      for (const u of Object.values(S.users)) { const k = (u.name || "").toLowerCase(); seen[k] = (seen[k] || 0) + 1; }
      for (const [id, u] of Object.entries(S.users)) {
        if (u.deleted) continue;
        const r = starts(u.handle) ? 0 : starts(u.name) ? 1 : words(u.name) || words(u.handle) ? 2 : -1;
        if (r < 0) continue;
        const shown = u.name || u.handle;
        const typed = seen[(u.name || "").toLowerCase()] > 1 && u.handle ? u.handle : shown;   // a shared name: their handle
        out.push({ rank: r, label: shown, sub: u.handle && u.handle !== shown ? `@${u.handle}` : "", insert: `@${typed}`, icon: () => face(id, shown, "sg-av") });
      }
    } else if (sig === "#") {
      for (const c of S.convs.values()) {
        if (c.kind !== "channel" && c.kind !== "private") continue;
        const r = starts(c.name) ? 0 : words(c.name) ? 1 : -1;
        if (r >= 0) out.push({ rank: r, label: `#${c.name}`, sub: plainText(c.topic || ""), insert: `#${c.name}` });
      }
    } else {
      for (const n of [...Object.keys(CUSTOM), ...EMO_NAMES]) {
        const r = n.startsWith(q) ? (n.length === q.length ? 0 : 1) : n.includes(q) ? 2 : -1;
        if (r >= 0) out.push({ rank: r, label: `:${n}:`, insert: `:${n}:`, icon: () => emojiEl(n) || "" });
        if (out.length > 400) break;
      }
    }
    return out.sort((a, b) => a.rank - b.rank || a.label.length - b.label.length || a.label.localeCompare(b.label));
  }
  function attachSuggest(ta) {
    const box = el("div", { class: "suggest", role: "listbox", "aria-label": "Suggestions", hidden: true });
    let items = [], at = 0, span = null;
    const close = () => { box.hidden = true; items = []; };
    const pick = (i) => {
      const it = items[i];
      if (!it || !span) return;
      const ins = `${it.insert} `;
      ta.value = ta.value.slice(0, span[0]) + ins + ta.value.slice(span[1]);
      const p = span[0] + ins.length;
      ta.setSelectionRange(p, p);
      close();
      ta.dispatchEvent(new Event("input"));
    };
    const draw = () => {
      box.replaceChildren(...items.map((it, i) => el("div", { class: `sg${i === at ? " on" : ""}`, role: "option", "aria-selected": String(i === at),
        onmousedown: (e) => { e.preventDefault(); pick(i); } }, it.icon ? it.icon() : "", el("span", { class: "sg-l" }, it.label), it.sub ? el("span", { class: "sg-s" }, it.sub) : "")));
      box.hidden = !items.length;
    };
    const update = () => {
      const pos = ta.selectionStart;
      if (pos !== ta.selectionEnd) { close(); return; }
      const m = /(^|[\s(["'])([@#:])([^\s@#:<>]{0,40})$/.exec(ta.value.slice(0, pos));
      if (!m || (m[2] === ":" && m[3].length < 2)) { close(); return; }
      items = suggestions(m[2], m[3].toLowerCase()).slice(0, 8);
      span = [pos - m[3].length - 1, pos]; at = 0;
      draw();
    };
    ta.addEventListener("input", update);
    ta.addEventListener("click", update);
    ta.addEventListener("blur", () => setTimeout(close, 120));
    ta.addEventListener("keydown", (e) => {                 // (added before the box's own Enter: it goes first)
      if (box.hidden || !items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { at = (at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length; draw(); }
      else if ((e.key === "Enter" && !e.isComposing && e.keyCode !== 229) || e.key === "Tab") pick(at);
      else if (e.key === "Escape") close();
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    });
    return box;
  }

  // ---------------------------------------------------------------- scheduled messages
  function whenLabel(ms) {                       // a time ahead: "today at 3:16 PM", "tomorrow at 9:00 AM", "Monday at ..."
    const d = new Date(ms), now = new Date();
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days > 1 && days < 7 ? d.toLocaleDateString([], { weekday: "long" })
      : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
    return `${day} at ${clock(d)}`;
  }
  const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function schedulePop(anchor, cid, thread, ta, after) {
    openPop(anchor, (pop) => {
      const text = ta.value.replace(/\s+$/, "");
      pop.append(el("h3", null, "Schedule message"));
      if (!text.trim()) { pop.append(el("div", { class: "note" }, "Write the message first, then pick when it goes.")); return; }
      const err = el("div", { class: "note", role: "alert" });
      const go = async (ms) => {
        err.textContent = "";
        try {
          await post("schedule", { conversation: cid, text, thread: thread || "", at: ms / 1000 });
          closePop(); after(); say(`Scheduled for ${whenLabel(ms)}`); loadScheduled(cid);
        } catch (e) { err.textContent = e.message; }
      };
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0).getTime();
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (((8 - now.getDay()) % 7) || 7), 9, 0).getTime();
      const opts = [["In 1 hour", Date.now() + 3600e3], ["Tomorrow morning", tomorrow]];
      if (monday !== tomorrow) opts.push(["Monday morning", monday]);
      for (const [label, ms] of opts) pop.append(el("button", { type: "button", class: "mi", onclick: () => go(ms) }, label, el("span", { class: "mi-s" }, whenLabel(ms))));
      const pick = el("input", { type: "datetime-local", min: localInput(new Date(Date.now() + 60e3)), "aria-label": "Custom time" });
      pop.append(el("hr"), el("label", { class: "col" }, "Or at", pick),
        el("div", { class: "row" }, el("button", { type: "button", class: "btn small primary", onclick: () => {
          const ms = new Date(pick.value).getTime();
          if (!ms) { err.textContent = "Pick a date and a time."; return; }
          go(ms);
        } }, "Schedule")), err);
    });
  }
  async function loadScheduled(cid) {
    try { const got = await get(`scheduled?conversation=${enc(cid)}`); S.scheduled.set(cid, got.scheduled || []); } catch { S.scheduled.set(cid, []); }
    if (cid === S.open) drawScheduled();
  }
  function drawScheduled() {
    const box = $("sched"), cid = S.open;
    const list = (S.scheduled.get(cid) || []).slice().sort((a, b) => a.post_at - b.post_at);
    box.hidden = !cid || !list.length;
    box.replaceChildren(...list.map((x) => el("div", { class: "sched" }, icon("clock"),
      el("span", { class: "when" }, `Scheduled ${whenLabel(x.post_at * 1000)}${x.thread_ts ? " · in a thread" : ""}`),
      el("span", { class: "s-txt", title: plainText(x.text) }, plainText(x.text)),
      el("button", { type: "button", class: "btn small quiet", onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await post("unschedule", { conversation: cid, id: x.id }); say("Scheduled message canceled"); } catch (z) { say(`Couldn't cancel it: ${z.message}`); }
        loadScheduled(cid);
      } }, "Cancel"))));
  }

  function build(list, cid, { readAt, inThread } = {}) {
    const frag = document.createDocumentFragment();
    let prev = null, prevDay = null, newDone = readAt === undefined || readAt === "" || readAt === null;
    for (const m of list) {
      const d = tsDate(m.ts), dk = dayKey(d);
      if (dk !== prevDay) { frag.append(el("div", { class: "day", role: "separator" }, dayLabel(d))); prevDay = dk; prev = null; }
      if (!newDone && num(m.ts) > num(readAt) && m.user !== me()) {
        frag.append(el("div", { class: "new", role: "separator", "data-new": "1" }, "New"));
        newDone = true; prev = null;
      }
      const sys = SYSTEM.has(m.subtype), author = m.bot_name ? `bot:${m.bot_name}` : m.user;
      const cont = !!(prev && !sys && !prev.sys && prev.author === author && num(m.ts) - num(prev.ts) < 300);
      frag.append(msgEl(m, cid, { cont, inThread }));
      prev = { author, ts: m.ts, sys };
    }
    return frag;
  }
  const PIN = 80;
  const atBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < PIN;
  function anchorOf(box) {                         // the first message in view, and where it sits
    const top = box.getBoundingClientRect().top;
    for (const n of box.querySelectorAll(".msg")) {
      const r = n.getBoundingClientRect();
      if (r.bottom > top) return { ts: n.dataset.ts, off: r.top - top };
    }
    return null;
  }
  function restore(box, a) {
    if (!a) return;
    const n = box.querySelector(`.msg[data-ts="${CSS.escape(a.ts)}"]`);
    if (n) box.scrollTop += n.getBoundingClientRect().top - box.getBoundingClientRect().top - a.off;
  }
  // `to`: "bottom", "unread" (the New line near the top, else the bottom), "keep" (as it was: at the bottom if it was there,
  // else the same message where it was), or {ts} (that message, flashed)
  function drawLog(to) {
    const box = $("scroll"), log = $("log");
    const st = S.msgs.get(S.open);
    const wasPinned = S.pinned, anchor = to === "keep" && !wasPinned ? anchorOf(box) : null;
    $("empty").hidden = !!S.open;
    $("scroll").hidden = !S.open;
    $("conv-head").hidden = !S.open;
    if (!S.open) { log.replaceChildren(); $("here-drafts").replaceChildren(); $("older").hidden = true; drawJump(); return; }
    log.replaceChildren(st && st.loaded ? build(st.list, S.open, { readAt: S.readAt[S.open] }) : el("div", { class: "older" }, st && st.error ? st.error : "Loading…"));
    if (st && st.loaded && !st.list.length) log.replaceChildren(el("div", { class: "older" }, "No messages yet."));
    const older = $("older");
    older.hidden = !(st && st.loaded && (st.older || !st.more) && st.list.length);
    older.textContent = st && st.older ? "Loading earlier messages…" : `The start of ${place(S.convs.get(S.open))}`;
    drawDrafts();
    if (to === "bottom" || (to === "keep" && wasPinned)) box.scrollTop = box.scrollHeight;
    else if (to === "unread") {
      const line = log.querySelector("[data-new]");
      if (line) box.scrollTop = Math.max(0, line.offsetTop - box.offsetTop - 60);
      else box.scrollTop = box.scrollHeight;
    } else if (to && to.ts) {
      const n = log.querySelector(`.msg[data-ts="${CSS.escape(to.ts)}"]`);
      if (n) { n.scrollIntoView({ block: "center" }); n.classList.add("flash"); } else box.scrollTop = box.scrollHeight;
    } else restore(box, anchor);
    S.pinned = atBottom(box);
    drawJump();
  }
  function drawJump() {
    const j = $("jump");
    j.hidden = !S.newCount || S.pinned;
    j.textContent = `${S.newCount} new message${S.newCount === 1 ? "" : "s"}`;
  }
  async function loadOlder() {
    const st = S.msgs.get(S.open);
    if (!st || !st.loaded || !st.more || st.older || !st.list.length) return;
    st.older = true;
    const cid = S.open;
    drawLog("keep");
    try {
      const got = await get(`history?conversation=${enc(cid)}&before=${enc(st.list[0].ts)}`);
      const have = new Set(st.list.map((m) => m.ts));
      st.list = [...got.messages.filter((m) => !have.has(m.ts)), ...st.list].sort(byTs);
      st.more = got.more && got.messages.length > 0;
    } catch { st.more = false; }
    st.older = false;
    if (S.open === cid) drawLog("keep");
  }
  function markRead() {
    const cid = S.open, st = S.msgs.get(cid);
    if (!cid || !st || !st.loaded || document.visibilityState !== "visible" || !S.pinned) return;
    const last = [...st.list].reverse().find(topLevel);
    const [u] = S.unread[cid] || [0, 0];
    if (!last || !u) return;
    S.unread[cid] = [0, 0];
    drawConvs();
    post("read", { conversation: cid, ts: last.ts }).catch(() => {});
  }

  // what is open, told to the backend: an agent's conversation "open", and the first line of its slack_read
  let viewSaid = "";
  function reportView() {
    const v = JSON.stringify({ conversation: S.open || "", thread: (S.thread && S.thread.ts) || "" });
    if (v === viewSaid) return;
    viewSaid = v;
    post("view", JSON.parse(v)).catch(() => { viewSaid = ""; });
  }

  async function open(cid, opts = {}) {
    closeResults();
    if (!S.convs.has(cid)) return;
    if (S.open !== cid) {
      S.open = cid; S.newCount = 0; S.pinned = true;
      S.readAt[cid] = S.convs.get(cid).read_ts || "";
      keep.set("open", cid);
      if (S.thread && S.thread.cid !== cid) closeThread();
    }
    reportView();
    drawConvs(); drawHead(); drawComposer();
    if (!S.members.has(cid)) loadMembers(cid);
    loadScheduled(cid);
    let st = S.msgs.get(cid);
    if (!st || !st.loaded) {
      st = { list: [], more: true, loaded: false };
      S.msgs.set(cid, st);
      drawLog("bottom");
      try {
        const got = await get(`history?conversation=${enc(cid)}`);
        st.list = got.messages.slice().sort(byTs); st.more = got.more; st.loaded = true;
      } catch (e) { st.error = `Couldn't load it: ${e.message}`; }
    }
    if (S.open !== cid) return;
    drawLog(opts.ts ? { ts: opts.ts } : "unread");
    if (opts.thread) openThread(cid, opts.thread);
    markRead();
    if (opts.focus !== false) { const ta = $("composer").querySelector("textarea"); if (ta) ta.focus({ preventScroll: true }); }
  }

  // ---------------------------------------------------------------- drafts
  function draftEl(d) {
    const c = S.convs.get(d.channel), a = actor(d.by_channel);
    const ta = el("textarea", { "aria-label": "Draft reply", rows: "3" });
    ta.value = d.text;
    ta.dataset.draft = d.id;
    let saved = d.text;
    const save = () => { if (ta.value !== saved && ta.value.trim()) { saved = ta.value; post("draft", { id: d.id, action: "edit", text: ta.value }).catch(() => {}); } };
    ta.addEventListener("blur", save);
    const bc = d.thread_ts ? el("input", { type: "checkbox", checked: d.broadcast }) : null;
    const note = el("div", { class: "note", role: "status" }, "Sends from your account. You can edit it first.");
    const buttons = [];
    const busy = (on) => buttons.forEach((b) => { b.disabled = on; });
    const send = el("button", { type: "button", class: "btn primary small", onclick: async () => {
      if (!ta.value.trim()) { note.textContent = "There's nothing to send."; return; }
      busy(true); note.textContent = "Sending…";
      try {
        await post("draft", { id: d.id, action: "send", text: ta.value, broadcast: bc ? bc.checked : false });
        S.drafts.delete(d.id); drawDrafts(); drawConvs();
      } catch (e) { note.textContent = `Not sent: ${e.message}`; busy(false); }
    } }, icon("send"), "Send");
    const discard = el("button", { type: "button", class: "btn quiet small", onclick: async () => {
      busy(true);
      try { await post("draft", { id: d.id, action: "discard" }); S.drafts.delete(d.id); drawDrafts(); drawConvs(); }
      catch (e) { note.textContent = `Couldn't discard it: ${e.message}`; busy(false); }
    } }, "Discard");
    const change = el("button", { type: "button", class: "btn small", onclick: (e) => {
      const btn = e.currentTarget;
      openPop(btn, (pop) => {
        const fb = el("textarea", { rows: "3", placeholder: "What should change?" });
        const err = el("div", { class: "note", role: "alert" });
        const go = el("button", { type: "button", class: "btn primary small", onclick: async () => {
          if (!fb.value.trim()) { fb.focus(); return; }
          const ch = ag.agents.attached.includes(d.by_channel) ? d.by_channel : (ag.agents.attached[0] || d.by_channel);
          if (!ch) { err.textContent = "No agent works with Slack now."; return; }
          save();
          go.disabled = true;
          try {
            await toAgent(ch, `Change your Slack draft ${d.id} (${c ? place(c) : d.label}): ${fb.value.trim()}\nRevise it with slack_draft, draft "${d.id}".`);
            closePop(); note.textContent = `Asked ${actor(ch).name} to change it.`;
          } catch (x) { err.textContent = `Couldn't ask: ${x.message}`; go.disabled = false; }
        } }, "Ask");
        fb.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); go.click(); } });
        pop.append(el("h3", null, "Ask for changes"), fb, el("div", { class: "row" }, go), err);
      });
    } }, "Ask for changes");
    buttons.push(send, discard, change);
    return el("div", { class: "draft", "data-draft": d.id },
      el("div", { class: "draft-h" }, el("span", { class: "dot", style: `--h:${a.hue}`, "aria-hidden": "true" }),
        el("b", null, `Draft by ${a.name}`), el("span", { class: "pill" }, "Not sent"), el("span", { class: "where" }, d.thread_ts ? "thread reply" : "")),
      ta,
      el("div", { class: "draft-f" }, bc ? el("label", { class: "grow" }, bc, `Also send to ${c ? place(c) : "the conversation"}`) : el("span", { class: "grow" }), discard, change, send),
      note);
  }
  function drawDraftsIn(box, list) {
    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.draft;
    const have = new Map([...box.children].map((n) => [n.dataset.draft, n]));
    const want = new Set(list.map((d) => d.id));
    for (const [id, n] of have) if (!want.has(id)) n.remove();
    for (const d of list) {
      const n = have.get(d.id);
      if (n && focused === d.id) continue;                 // never under the user's typing
      const fresh = draftEl(d);
      if (n) n.replaceWith(fresh); else box.append(fresh);
    }
  }
  function drawDrafts() {
    const all = [...S.drafts.values()].sort((a, b) => a.made - b.made);
    drawDraftsIn($("here-drafts"), S.open ? all.filter((d) => d.channel === S.open && !d.thread_ts) : []);
    const tb = document.querySelector("#thread .drafts");
    if (tb && S.thread) drawDraftsIn(tb, all.filter((d) => d.channel === S.thread.cid && d.thread_ts === S.thread.ts));
  }

  // ---------------------------------------------------------------- composing
  function composer(cid, thread) {
    const key = thread ? `${cid}:${thread}` : cid, c = S.convs.get(cid);
    const where = thread ? "Reply…" : `Message ${place(c)}`;
    const ta = el("textarea", { rows: "1", "aria-label": where, placeholder: where });
    ta.value = S.typed.get(key) || "";
    const sg = attachSuggest(ta);
    const sendBtn = el("button", { type: "button", class: "send", "aria-label": "Send" }, icon("send"));
    const bc = thread ? el("input", { type: "checkbox" }) : null;
    const err = el("div", { class: "under", role: "status" });
    const size = () => { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`; sendBtn.classList.toggle("ready", !!ta.value.trim()); };
    const remember = () => { if (ta.value) S.typed.set(key, ta.value); else S.typed.delete(key); keep.set("typed", [...S.typed].slice(-50)); };
    ta.addEventListener("input", () => { size(); remember(); });
    const send = async () => {
      const text = ta.value.replace(/\s+$/, "");
      if (!text.trim() || ta.dataset.busy) return;
      ta.dataset.busy = "1"; err.textContent = "";
      try {
        const got = await post("send", { conversation: cid, text, thread: thread || "", broadcast: bc ? bc.checked : false });
        ta.value = ""; remember(); size();
        landed(cid, got.message, thread);
      } catch (e) { err.textContent = `Not sent: ${e.message}`; }
      delete ta.dataset.busy;
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
      else if (e.key === "ArrowUp" && !ta.value && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
        const last = lastMine(cid, thread);                // as in Slack: up in an empty box edits your last message
        if (last) { e.preventDefault(); editMessage(cid, last); }
      }
    });
    sendBtn.addEventListener("click", send);
    const schedBtn = el("button", { type: "button", class: "send sched-btn", "aria-label": "Schedule message", title: "Schedule message",
      onclick: (e) => schedulePop(e.currentTarget, cid, thread, ta, () => { ta.value = ""; remember(); size(); }) }, icon("clock"));
    const draftBtn = el("button", { type: "button", class: "btn small", onclick: (e) => askClaude(e.currentTarget, {
      kind: "draft", cid, instruction: ta.value.trim(),
      message: (how) => `Draft a Slack message for me in ${place(c)}${thread ? " (a reply in a thread)" : ""} with slack_draft (conversation ${cid}${thread ? `, thread ${thread}` : ""}); I'll send it from the Slack panel.\n\nWhat to write: ${how}`,
      done: () => { ta.value = ""; remember(); size(); },
    }) }, icon("pen"), "Draft with Claude");
    requestAnimationFrame(size);
    return el("div", { class: "cmp" }, sg, el("div", { class: "box" }, ta, draftBtn, schedBtn, sendBtn),
      bc ? el("label", { class: "under" }, bc, `Also send to ${place(c)}`) : "", err);
  }
  function drawComposer() {
    const box = $("composer");
    box.hidden = !S.open;
    box.replaceChildren(S.open ? composer(S.open, "") : "");
    drawAsked();
    drawScheduled();
  }
  function landed(cid, m, thread) {                // the user's own message, sent: shown now (the live copy is the same one)
    if (!m || !m.ts) return;
    const st = S.msgs.get(cid);
    if (!thread || m.subtype === "thread_broadcast") {
      if (st && st.loaded && !st.list.some((x) => x.ts === m.ts)) st.list.push(m), st.list.sort(byTs);
      if (cid === S.open) { S.pinned = true; drawLog("bottom"); }
    }
    if (thread && S.thread && S.thread.cid === cid && S.thread.ts === thread) {
      if (!S.thread.list.some((x) => x.ts === m.ts)) S.thread.list.push(m), S.thread.list.sort(byTs);
      drawThread("bottom");
    }
  }

  // ---------------------------------------------------------------- threads
  async function openThread(cid, ts) {
    S.thread = { cid, ts, list: [], loading: true };
    reportView();
    drawThread("bottom");
    try {
      const got = await get(`thread?conversation=${enc(cid)}&ts=${enc(ts)}`);
      if (!S.thread || S.thread.ts !== ts || S.thread.cid !== cid) return;
      S.thread.list = got.messages.slice().sort(byTs); S.thread.loading = false;
    } catch (e) { if (S.thread && S.thread.ts === ts) { S.thread.loading = false; S.thread.error = e.message; } }
    drawThread("bottom");
    const ta = document.querySelector("#thread textarea:not([data-draft])");
    if (ta) ta.focus({ preventScroll: true });
  }
  function closeThread() {
    const was = S.thread;
    S.thread = null; const t = $("thread"); t.hidden = true; t.replaceChildren(); $("thread-split").hidden = true;
    if (was) reportView();
  }
  function drawThread(to) {
    const t = $("thread"), th = S.thread;
    if (!th) { closeThread(); return; }
    const old = t.querySelector(".scroll"), wasPinned = !old || atBottom(old), anchor = old && !wasPinned ? anchorOf(old) : null;
    const c = S.convs.get(th.cid);
    const scroll = el("div", { class: "scroll" });
    const [parent, ...replies] = th.list;
    if (th.loading) scroll.append(el("div", { class: "older" }, "Loading the thread…"));
    else if (th.error) scroll.append(el("div", { class: "older" }, `Couldn't load it: ${th.error}`));
    else if (parent) {
      scroll.append(msgEl(parent, th.cid, { cont: false, inThread: true }));
      scroll.append(el("div", { class: "count-line" }, `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`));
      scroll.append(el("div", { class: "log", role: "log", "aria-live": "polite" }, build(replies, th.cid, { inThread: true })));
    }
    scroll.append(el("div", { class: "drafts" }));
    t.replaceChildren(
      el("div", { class: "thread-h" }, el("b", null, "Thread"), el("span", null, place(c)),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Close the thread", onclick: closeThread }, icon("x"))),
      scroll,
      el("div", { class: "composer" }, composer(th.cid, th.ts)));
    t.hidden = false;
    $("thread-split").hidden = false;
    drawDrafts();
    if (to === "bottom" || wasPinned) scroll.scrollTop = scroll.scrollHeight;
    else restore(scroll, anchor);
  }

  // ---------------------------------------------------------------- search
  let searched = 0;
  async function search(q) {
    const n = ++searched, box = $("results");
    box.hidden = false;
    const head = el("div", { class: "results-h" }, `Searching Slack for “${q}”…`,
      el("button", { type: "button", class: "icon-btn", "aria-label": "Close the results", onclick: closeResults }, icon("x")));
    box.replaceChildren(head);
    let got;
    try { got = await get(`search?q=${enc(q)}`); } catch (e) { if (n === searched) head.firstChild.textContent = `Couldn't search: ${e.message}`; return; }
    if (n !== searched) return;                          // a later search answers instead
    head.firstChild.textContent = got.messages.length ? `${got.messages.length} results for “${q}”` : `Nothing matches “${q}”`;
    for (const m of got.messages) {
      const c = S.convs.get(m.channel);
      const where = `${c ? place(c) : `#${m.channel_name || m.channel} (you're not in it)`}${m.thread_ts ? " · in a thread" : ""}`;
      box.append(el("button", { type: "button", class: "hit", disabled: !c, title: c ? null : "A channel you're not in: agents can read it, the panel lists only yours",
        onclick: () => { if (c) open(m.channel, m.thread_ts ? { ts: m.thread_ts, thread: m.thread_ts } : { ts: m.ts }); } },
        el("span", { class: "meta" }, `${where} · ${m.username || uname(m.user)} · ${tsDate(m.ts).toLocaleString()}`),
        el("span", { class: "txt" }, render(m.text))));
    }
  }
  function closeResults() {
    searched++; $("results").hidden = true; $("results").replaceChildren();
    if (S.view) { S.view = null; drawConvs(); }
  }

  // ---------------------------------------------------------------- Threads and Activity, shown over the conversation
  async function showView(kind, quiet) {
    const n = ++searched, box = $("results");
    if (S.view !== kind) { S.view = kind; drawConvs(); }
    box.hidden = false;
    const head = el("div", { class: "results-h" }, el("span", null, kind === "threads" ? "Threads" : "Activity"),
      el("span", { class: "meta" }, kind === "threads" ? "threads you started, replied in or follow" : "mentions of you, and reactions to your messages"),
      el("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: closeResults }, icon("x")));
    if (!quiet) box.replaceChildren(head, el("div", { class: "older" }, "Loading…"));
    let got;
    try { got = await get(kind); } catch (e) { if (n === searched) box.replaceChildren(head, el("div", { class: "older" }, `Couldn't load it: ${e.message}`)); return; }
    if (n !== searched) return;
    if (kind === "threads") {
      box.replaceChildren(head, ...(got.threads.length ? got.threads.map(threadRow) : [el("div", { class: "older" }, "No threads yet. Threads you start, reply in or follow show here.")]));
    } else {
      const items = got.items || [];
      box.replaceChildren(head, ...(items.length ? items.map((x) => activityRow(x, got.seen)) : [el("div", { class: "older" }, "Nothing yet. Mentions of you and reactions to your messages show here.")]));
      if (items[0] && items[0].at > got.seen) post("activity_seen", { at: items[0].at }).catch(() => {});
    }
  }
  function threadRow(t) {
    const c = S.convs.get(t.conversation), p = t.parent, l = t.last;
    const line = (m, cls) => el("span", { class: `hit-m ${cls}` }, face(m.bot_name ? "" : m.user, who(m), "av sm", m.user), el("span", { class: "hm" },
      el("b", null, who(m)), " ", el("span", { class: "meta" }, ago(m.ts)), el("span", { class: "txt clip" }, render(m.text))));
    return el("button", { type: "button", class: `hit thr${t.unread ? " unread" : ""}`, onclick: () => open(t.conversation, { ts: p.ts, thread: p.ts }) },
      el("span", { class: "meta" }, `${c ? place(c) : "Slack"} · ${p.reply_count || 1} ${(p.reply_count || 1) === 1 ? "reply" : "replies"}${t.unread ? " · new" : ""}`),
      line(p, "parent"), line(l, "last"));
  }
  function activityRow(x, seen) {
    const c = S.convs.get(x.conversation), m = x.message;
    const name = uname(x.user), where = c ? ` in ${place(c)}` : "";
    const what = x.kind === "reaction" ? [el("b", null, name), " reacted ", emojiOf(x.name) || `:${x.name}:`, ` to your message${where}`]
      : [el("b", null, name), ` mentioned you${where}`];
    const inThread = m && m.thread_ts && m.thread_ts !== m.ts;
    return el("button", { type: "button", class: `hit act-row${x.at > seen ? " unread" : ""}`,
      onclick: () => open(x.conversation, inThread ? { ts: m.thread_ts, thread: m.thread_ts } : { ts: x.ts }) },
      el("span", { class: "hit-m" }, face(x.user, name, "av sm"), el("span", { class: "hm" }, ...what, " ", el("span", { class: "meta" }, ago(String(x.at))),
        m ? el("span", { class: "txt clip" }, render(m.text)) : "")));
  }

  // ---------------------------------------------------------------- jump to (⌘K), and a new DM or group DM
  async function openDM(users) {
    const got = await post("open", { users });
    const c = got.conversation;
    if (!S.convs.has(c.id)) S.convs.set(c.id, c);
    await open(c.id);
  }
  function openSwitcher() {
    if ($("body").hidden) return;
    closePop();
    const box = $("switch");
    const input = el("input", { type: "text", placeholder: "Jump to a conversation or person", "aria-label": "Jump to", autocomplete: "off", spellcheck: "false" });
    const list = el("div", { class: "sw-list", role: "listbox" });
    let items = [], at = 0;
    const away = (e) => { if (!box.contains(e.target)) close(); };
    const close = () => { box.hidden = true; box.replaceChildren(); document.removeEventListener("mousedown", away, true); };
    const go = (it) => { close(); if (it.cid) open(it.cid); else openDM([it.uid]).catch((e) => say(e.message)); };
    const draw = () => {
      list.replaceChildren(...items.map((it, i) => el("div", { class: `sw${i === at ? " on" : ""}`, role: "option", "aria-selected": String(i === at),
        onmousedown: (e) => { e.preventDefault(); go(it); } }, it.icon(), el("span", { class: "sg-l" }, it.label), it.sub ? el("span", { class: "sg-s" }, it.sub) : "")));
      if (!items.length) list.append(el("div", { class: "sg-s pad" }, "Nothing matches"));
    };
    const update = () => {
      const q = input.value.trim().toLowerCase();
      const score = (x) => { x = (x || "").toLowerCase(); return !q ? 3 : x.startsWith(q) ? 0 : x.split(/[\s._-]+/).some((w) => w.startsWith(q)) ? 1 : x.includes(q) ? 2 : -1; };
      const out = [];
      const dmWith = new Set();
      for (const c of S.convs.values()) {
        if (c.kind === "im") dmWith.add(c.user);
        const r = score(convName(c));
        if (r >= 0) out.push({ r, a: act(c), cid: c.id, label: place(c), sub: c.kind === "mpim" ? "group DM" : c.kind === "im" ? "direct message" : "",
          icon: () => glyph(c) });
      }
      if (q) {
        for (const [id, u] of Object.entries(S.users)) {
          if (u.deleted || u.bot || dmWith.has(id) || id === me()) continue;
          const r = Math.min(...[score(u.name), score(u.handle)].map((v) => (v < 0 ? 9 : v)));
          if (r < 9) out.push({ r: r + 0.5, a: 0, uid: id, label: u.name || u.handle, sub: "start a direct message", icon: () => el("span", { class: "g" }, face(id, u.name || u.handle, "g-av")) });
        }
      }
      items = out.sort((x, y) => x.r - y.r || y.a - x.a || x.label.localeCompare(y.label)).slice(0, 12);
      at = 0; draw();
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { at = items.length ? (at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : 0; draw(); }
      else if (e.key === "Enter" && !e.isComposing) { if (items[at]) go(items[at]); }
      else if (e.key === "Escape") close();
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    box.replaceChildren(el("div", { class: "sw-in", role: "dialog", "aria-label": "Jump to" }, input, list,
      el("div", { class: "sg-s pad" }, "↑↓ to pick, Enter to open, Esc to close")));
    box.hidden = false;
    input.focus();
    update();
    setTimeout(() => document.addEventListener("mousedown", away, true), 0);
  }
  function newDM(anchor) {
    openPop(anchor, (pop) => {
      pop.classList.add("wide");
      const chosen = new Map();
      const input = el("input", { type: "text", placeholder: "Find people by name", "aria-label": "Find people" });
      const chips = el("div", { class: "chips" });
      const list = el("div", { class: "people" });
      const err = el("div", { class: "note", role: "alert" });
      const go = el("button", { type: "button", class: "btn small primary", disabled: true, onclick: async () => {
        go.disabled = true;
        try { await openDM([...chosen.keys()]); closePop(); } catch (e) { err.textContent = e.message; go.disabled = false; }
      } }, "Message");
      const draw = () => {
        chips.replaceChildren(...[...chosen].map(([id, name]) => el("button", { type: "button", class: "chip", title: `Remove ${name}`,
          onclick: () => { chosen.delete(id); draw(); } }, face(id, name, "sg-av"), name, icon("x"))));
        go.disabled = !chosen.size;
        go.textContent = chosen.size > 1 ? `Start a group DM (${chosen.size + 1} people)` : "Message";
        const q = input.value.trim().toLowerCase();
        const people = Object.entries(S.users).filter(([id, u]) => !u.deleted && !u.bot && id !== me() && !chosen.has(id)
          && (!q || (u.name || "").toLowerCase().includes(q) || (u.handle || "").toLowerCase().includes(q)))
          .sort((a, b) => (a[1].name || "").localeCompare(b[1].name || "")).slice(0, 40);
        list.replaceChildren(...people.map(([id, u]) => el("button", { type: "button", class: "person pick", onclick: () => {
          chosen.set(id, u.name || u.handle); input.value = ""; draw(); input.focus();
        } }, face(id, u.name || u.handle, "av sm"), el("span", { class: "pn" }, el("b", null, u.name || u.handle), statusEl(id),
          u.handle && u.handle !== u.name ? el("span", { class: "meta" }, ` @${u.handle}`) : ""))));
        if (!people.length) list.append(el("div", { class: "note" }, q ? "Nobody by that name" : "Nobody else here"));
      };
      input.addEventListener("input", draw);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !input.value && chosen.size) { chosen.delete([...chosen.keys()].pop()); draw(); }
      });
      pop.append(el("h3", null, "New message"), chips, input, list, el("div", { class: "row" }, go), err);
      draw();
    });
  }

  // ---------------------------------------------------------------- toasts
  function toast(x) {
    const m = x.message, cid = x.conversation, c = S.convs.get(cid);
    const box = $("toasts");
    let timer = null;
    const t = el("div", { class: "toast", role: "status" });
    const gone = () => { clearTimeout(timer); t.remove(); };
    const later = () => { clearTimeout(timer); timer = setTimeout(gone, 15000); };
    const inThread = m.thread_ts && m.thread_ts !== m.ts;
    const where = !c ? "Slack" : c.kind === "im" ? "Direct message" : c.kind === "mpim" ? `Group DM with ${convName(c)}` : place(c);
    t.append(
      el("div", { class: "toast-h" }, avatar(m), el("div", null, el("b", null, who(m)), el("span", null, `${where}${inThread ? " · thread" : ""} · now`)),
        el("button", { type: "button", class: "icon-btn", "aria-label": "Dismiss", onclick: gone }, icon("x"))),
      el("div", { class: "txt" }, render(m.text)),
      el("div", { class: "row" },
        el("button", { type: "button", class: "btn small", onclick: () => { gone(); open(cid, inThread ? { thread: m.thread_ts } : { ts: m.ts }); } }, "Open"),
        el("button", { type: "button", class: "btn primary small", onclick: (e) => askClaude(e.currentTarget, { ...replyAsk(cid, m), done: gone }) }, icon("pen"), "Reply with Claude")));
    t.addEventListener("mouseenter", () => clearTimeout(timer));
    t.addEventListener("mouseleave", later);
    t.addEventListener("focusin", () => clearTimeout(timer));
    box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    later();
  }

  // ---------------------------------------------------------------- settings, setup
  function settingsPop(anchor) {
    anchor.setAttribute("aria-expanded", "true");
    openPop(anchor, (pop) => {
      const s = S.setup || {};
      const opt = (v, label) => el("label", null, el("input", { type: "radio", name: "tell", value: v, checked: (S.settings.tell_agents || "all") === v,
        onchange: async () => { try { const got = await post("settings", { tell_agents: v }); S.settings = got.settings; } catch { /* kept as it was */ } } }), label);
      pop.append(el("h3", null, "Slack settings"),
        el("div", { class: "note" }, s.team ? `${s.team}, signed in as ${uname(s.me)}` : "Not connected"),
        el("fieldset", null, el("legend", null, "Tell the agents working with Slack about"),
          opt("all", "All new messages"), opt("mentions", "Only my DMs and mentions"), opt("none", "Nothing (they read when asked)")),
        el("fieldset", null, el("legend", null, "Notify me"),
          el("div", { class: "note" }, "DMs and mentions pop up in the dashboard. Other new messages show on Slack's row in the list."),
          el("label", null, el("input", { type: "checkbox", checked: S.settings.notify_system !== false,
            onchange: async (e) => { try { const got = await post("settings", { notify_system: e.target.checked }); S.settings = got.settings; } catch { e.target.checked = !e.target.checked; } } }),
          "DMs and mentions on this computer too")),
        el("div", { class: "row" }, el("button", { type: "button", class: "btn small", onclick: async () => {
          closePop();
          try { const got = await post("disconnect", {}); S.setup = got.setup; drawAll(); } catch { /* shown by the status */ }
        } }, "Disconnect Slack")));
    });
    const was = popClose;
    popClose = () => { anchor.setAttribute("aria-expanded", "false"); was(); };
  }
  async function drawSetup() {
    const box = $("setup"), s = S.setup || {};
    const user = el("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "xoxp-…", "aria-describedby": "tok-help" });
    const app = el("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "xapp-…" });
    const err = el("div", { class: "err", role: "alert" }, s.status === "error" ? `Slack said: ${s.error}` : "");
    const pre = el("pre", null, "Loading…");
    const copy = el("button", { type: "button", class: "btn small", onclick: async () => {
      try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = "Copied"; } catch { copy.textContent = "Select it and copy"; }
    } }, "Copy");
    const go = el("button", { type: "button", class: "btn primary", onclick: async () => {
      err.textContent = "";
      go.disabled = true;
      try { const got = await post("connect", { user_token: user.value.trim(), app_token: app.value.trim() }); S.setup = got.setup; drawAll(); }
      catch (e) { err.textContent = e.message; }
      go.disabled = false;
    } }, "Connect");
    box.replaceChildren(el("div", { class: "setup-in" },
      el("h2", null, "Connect your Slack"),
      el("p", null, "ag reads your Slack with a Slack app of your own, so your messages go only between this machine and Slack, and what you send is posted as you. Agents only draft; you send."),
      s.sdk === false ? el("p", { class: "err" }, "Slack's Python SDK isn't installed where ag runs: pip install slack_sdk, then restart the dashboard.") : "",
      el("ol", null,
        el("li", null, "Open ", el("a", { href: "https://api.slack.com/apps?new_app=1", target: "_blank", rel: "noopener noreferrer" }, "api.slack.com/apps"),
          ", choose Create New App, then From a manifest, pick your workspace, and paste this:", pre, el("div", { class: "row" }, copy)),
        el("li", null, "Install it to your workspace (Install App). If your workspace needs an admin to approve apps, the request goes from there."),
        el("li", null, "Copy the User OAuth Token from OAuth & Permissions. It starts xoxp-."),
        el("li", null, "In Basic Information, under App-Level Tokens, generate a token with the connections:write scope. It starts xapp-, and brings new messages as they're sent.")),
      el("label", null, "User OAuth Token", user),
      el("label", null, "App-Level Token", app),
      el("div", { id: "tok-help", class: "note" }, "Kept in ag's data folder on this machine, readable only by you."),
      el("div", { class: "row" }, go), err));
    try { const r = await ag.api("manifest"); pre.textContent = await r.text(); } catch { pre.textContent = "Couldn't load it."; }
  }
  function drawAll() {
    const s = S.setup || {};
    const setup = !s.tokens || (s.status === "error" && !S.convs.size);
    $("setup").hidden = !setup;
    $("body").hidden = setup;
    for (const id of ["filters", "find"]) $(id).closest(id === "find" ? ".find" : ".seg").hidden = setup;
    if (setup) drawSetup();
    drawStatus(); drawAgents(); drawConvs(); drawHead(); drawLog("keep");
    $("empty").replaceChildren(el("div", null, el("p", null, "Pick a conversation."),
      el("p", { class: "note" }, "Point at a message and choose Reply with Claude: an agent drafts the reply, and you send it.")));
  }

  // ---------------------------------------------------------------- what the backend tells
  function put(list, m) {
    const i = list.findIndex((x) => x.ts === m.ts);
    if (i >= 0) list[i] = m; else { list.push(m); list.sort(byTs); }
    return i < 0;
  }
  function arrived(x) {
    const cid = x.conversation, m = x.message;
    if (x.unread) S.unread = x.unread;
    const c = S.convs.get(cid);
    if (c && topLevel(m) && num(m.ts) > num(c.latest_ts)) c.latest_ts = m.ts;
    if (c && num(m.ts) > num(c.active_ts)) c.active_ts = m.ts;
    const st = S.msgs.get(cid);
    let added = false;
    if (st && st.loaded) {
      if (x.kind === "message" || m.subtype === "thread_broadcast") added = put(st.list, m);
      if (x.parent) put(st.list, x.parent);
    }
    const th = S.thread;
    if (th && th.cid === cid && !th.loading && (m.thread_ts === th.ts || m.ts === th.ts)) { put(th.list, m); drawThread("keep"); }
    if (cid === S.open && (added || x.parent)) {
      const pinned = S.pinned || x.mine;
      drawLog(pinned ? "bottom" : "keep");
      if (added && !pinned && !x.mine) { S.newCount++; drawJump(); }
      if (pinned) markRead();
    }
    drawConvs();
    const seen = cid === S.open && document.visibilityState === "visible" && S.pinned && (x.kind === "message" || (th && th.ts === m.thread_ts));
    if (x.mention && !x.mine && !seen) toast(x);
  }
  let noticeAsked = null;                  // a notification's conversation to open once the list has it
  ag.onMessage((x) => {
    if (x.badges) S.badges = x.badges;
    switch (x.kind) {
      case "status": S.setup = x.setup; drawAll(); if (x.setup.status === "connected" && !S.convs.size) reload(); break;
      case "conversations": setLists(x); drawConvs(); drawHead(); if ($("setup").hidden === false && S.convs.size) drawAll(); if (noticeAsked) openNoticed(noticeAsked); break;
      case "unread": S.unread = x.unread; drawConvs(); if (S.view === "activity") showView("activity", true); break;
      case "message": case "reply":
        arrived(x);
        if ((S.view === "threads" && x.kind === "reply") || (S.view === "activity" && x.mention)) showView(S.view, true);
        break;
      case "scheduled": if (x.conversation === S.open) loadScheduled(x.conversation); break;
      case "threads": if (S.view === "threads") showView("threads", true); break;
      case "changed": {
        const st = S.msgs.get(x.conversation);
        if (st && st.loaded && st.list.some((m) => m.ts === x.message.ts)) { put(st.list, x.message); if (x.conversation === S.open) drawLog("keep"); }
        if (S.thread && S.thread.cid === x.conversation && S.thread.list.some((m) => m.ts === x.message.ts)) { put(S.thread.list, x.message); drawThread("keep"); }
        break;
      }
      case "deleted": {
        if (x.unread) S.unread = x.unread;
        const st = S.msgs.get(x.conversation);
        if (st) st.list = st.list.filter((m) => m.ts !== x.ts);
        if (S.thread && S.thread.cid === x.conversation) {
          if (S.thread.ts === x.ts) closeThread();
          else { S.thread.list = S.thread.list.filter((m) => m.ts !== x.ts); drawThread("keep"); }
        }
        if (x.conversation === S.open) drawLog("keep");
        drawConvs();
        break;
      }
      case "history": {
        const st = S.msgs.get(x.conversation);
        if (st) st.loaded = false;
        if (x.conversation === S.open) open(x.conversation, { focus: false });
        break;
      }
      case "draft":
        if (x.draft.status === "pending") {
          S.drafts.set(x.draft.id, x.draft);
          if (S.asked && S.asked.channel === x.draft.by_channel) { S.asked = null; drawAsked(); }
        } else S.drafts.delete(x.draft.id);
        drawDrafts(); drawConvs();
        break;
      case "settings": S.settings = x.settings; break;
    }
  });

  // ---------------------------------------------------------------- wiring
  // the dividers: dragged (or arrow keys) to resize the list and the thread, kept per panel; double-click resets
  const MIN_MAIN = 320;
  function splitter(bar, name, def, min, max, grows) {
    const root = document.documentElement;
    const set = (w) => {
      const v = Math.round(Math.max(min, Math.min(max(), w)));
      root.style.setProperty(name, `${v}px`);
      bar.setAttribute("aria-valuenow", String(v));
      return v;
    };
    let width = set(keep.get(name, def));
    const save = () => keep.set(name, width);
    bar.setAttribute("aria-valuemin", String(min));
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { bar.setPointerCapture(e.pointerId); } catch { /* no live pointer (a synthetic event): moves still reach the bar */ }
      const x0 = e.clientX, w0 = width;
      bar.classList.add("dragging"); document.body.classList.add("resizing");
      const move = (ev) => { width = set(w0 + grows * (ev.clientX - x0)); };
      const up = () => {
        bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); bar.removeEventListener("pointercancel", up);
        bar.classList.remove("dragging"); document.body.classList.remove("resizing");
        save();
        if (S.pinned) $("scroll").scrollTop = $("scroll").scrollHeight;
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
      bar.addEventListener("pointercancel", up);
    });
    bar.addEventListener("dblclick", () => { width = set(def); save(); });
    bar.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 64 : 16;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        width = set(width + grows * (e.key === "ArrowRight" ? step : -step));
        save();
      }
    });
    window.addEventListener("resize", () => { width = set(width); });
  }
  const bodyW = () => $("body").clientWidth || window.innerWidth;
  const threadW = () => ($("thread").hidden ? 0 : $("thread").offsetWidth);
  splitter($("side-split"), "--side-w", 240, 160, () => Math.max(160, Math.min(520, bodyW() - threadW() - MIN_MAIN)), 1);
  splitter($("thread-split"), "--thread-w", 380, 260, () => Math.max(260, bodyW() - $("side").offsetWidth - MIN_MAIN), -1);
  $("settings-btn").append(icon("gear"));
  $("settings-btn").addEventListener("click", (e) => settingsPop(e.currentTarget));
  for (const b of $("filters").querySelectorAll("button")) b.addEventListener("click", () => setFilter(b.dataset.f));
  function setFilter(f) {
    S.filter = f;
    keep.set("filter", f);
    for (const o of $("filters").querySelectorAll("button")) o.setAttribute("aria-selected", String(o.dataset.f === f));
    drawConvs();
    $("convs").scrollTop = 0;
  }
  for (const o of $("filters").querySelectorAll("button")) o.setAttribute("aria-selected", String(o.dataset.f === S.filter));
  $("find").addEventListener("input", (e) => { S.q = e.target.value; drawConvs(); });
  $("find").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.target.value.trim()) { e.preventDefault(); search(e.target.value.trim()); }
  });
  const scroller = $("scroll");
  scroller.addEventListener("scroll", () => {
    S.pinned = atBottom(scroller);
    if (S.pinned && S.newCount) { S.newCount = 0; drawJump(); }
    if (S.pinned) markRead();
    if (scroller.scrollTop < 150) loadOlder();
  }, { passive: true });
  new ResizeObserver(() => { if (S.pinned) scroller.scrollTop = scroller.scrollHeight; }).observe($("log"));
  $("jump").addEventListener("click", () => { S.newCount = 0; scroller.scrollTop = scroller.scrollHeight; S.pinned = true; drawJump(); markRead(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") markRead(); });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); openSwitcher(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("switch").hidden) return;       // (the switcher's own box closes it)
    if (!$("pop").hidden) { e.stopPropagation(); closePop(); }
    else if (!$("results").hidden) { e.stopPropagation(); closeResults(); }
  }, true);
  ag.agents.onChange(() => { drawAgents(); drawDrafts(); });
  // a notification of the dashboard's clicked: its conversation opened there (its thread, for a reply), and its
  // notifications cleared -- also when it holds nothing unread to mark read
  async function openNoticed(where) {
    if (!where || !where.conversation) return;
    if (!S.convs.has(where.conversation)) { noticeAsked = where; return; }   // the list not read yet: after reload
    noticeAsked = null;
    await open(where.conversation, where.thread ? { ts: where.thread, thread: where.thread } : { ts: where.ts });
    post("notified", { conversation: where.conversation, thread: where.thread || "" }).catch(() => {});
  }
  ag.notices.onOpen((where) => { openNoticed(where); });
  ag.actors.on(() => { drawAgents(); drawDrafts(); });

  async function reload() {
    let got;
    try { got = await get("state"); } catch { got = { setup: { status: "error", error: "the backend didn't answer" }, conversations: [], drafts: [] }; }
    S.setup = got.setup; S.settings = got.settings || {};
    if (got.badges) S.badges = got.badges;
    setLists(got);
    S.drafts = new Map((got.drafts || []).map((d) => [d.id, d]));
    drawAll();
    const last = keep.get("open", null);
    viewSaid = "";       // said again: a restarted backend has forgotten it
    if (noticeAsked) openNoticed(noticeAsked);
    else if (!S.open && last && S.convs.has(last)) open(last, { focus: false });
    else reportView();
  }
  await reload();
})();
