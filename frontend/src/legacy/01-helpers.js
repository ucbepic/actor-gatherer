// ------------------------------------------------------------------ helpers
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
const compact = (v) => v === null || v === undefined ? "–" : v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M"
  : v >= 1e3 ? (v / 1e3).toFixed(v >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "K" : String(Math.round(v));
const full = (v) => v === null || v === undefined ? "–" : Math.round(v).toLocaleString();
const axisTime = (t, days, seconds) => new Date(t * 1000).toLocaleString([], days
  ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
  : seconds ? { hour: "2-digit", minute: "2-digit", second: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
const clock = (t, withDate) => t ? new Date(t * 1000).toLocaleString([], withDate
  ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "–";
const ago = (t) => {
  if (!t) return "never";
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
// " (… <what> Ns ago)", counting: the time `t` (the server's seconds) set every second (the ticker by `data-since`);
// hidden from screen readers, so a status line holding it is not read out again each second.
// How long since the time `t` (the server's seconds), as a clock counting up: "45s", "2m 05s", "1h 12m" (spell: `s`
// seconds, so).
const spell = (s) => {
  s = Math.max(0, Math.floor(s)); const pad = (n) => String(n).padStart(2, "0");
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : `${Math.floor(s / 3600)}h ${pad(Math.floor(s / 60) % 60)}m`;
};
const lasting = (t) => spell(Date.now() / 1000 - t);
const agoEl = (what, t) => el("span", { "aria-hidden": "true" }, ` (${what} `, el("span", { "data-ago": t || "", text: ago(t) }), ")");
const span = (a, b) => {
  if (!a || !b) return "–";
  const s = Math.max(0, b - a);
  return s < 60 ? `${s.toFixed(0)}s` : s < 3600 ? `${(s / 60).toFixed(1)}m` : `${(s / 3600).toFixed(1)}h`;
};
// The agent's own events by type, as the context card colors and filters them; fixed order, fixed colors.
const TYPES = [["user_message", "User", "var(--s7)"], ["agent_message", "Assistant", "var(--s1)"],
  ["tool_call", "Tool call", "var(--t-call)"], ["tool_output", "Tool output", "var(--t-output)"],
  ["agent_reasoning", "Reasoning", "var(--s5)"], ["system", "System / developer", "var(--s8)"],
  ["gatherer", "Gatherer messages", "var(--t-gatherer)"]];
// the harness's preamble is filtered like a type, though it is not among the messages
const PREAMBLE_TYPE = ["preamble", PREAMBLE, "var(--s8)"];
const OTHER_TYPE = ["other", "Other", "var(--muted)"];
// ag's own messages placed among the history -- shown in it, where ag put them
const INLINE = new Set(["File-change notices", "Other agents' requests", "Stream messages"]);
// what the Gatherer wrote (its sections, and its messages among the history) is one type; the harness's
// own system/developer messages (its `context` events: instructions, environment notes) another
const GATHERER = new Set(["ag's sections", ...INLINE]);
const OUTSIDE = new Set(["environment_update", "context_stream"]);   // events from outside the conversation
const itemType = (it) => GATHERER.has(it.group) || OUTSIDE.has(it.name) ? typeOf("gatherer")
  : it.name === "context" ? typeOf("system") : typeOf(it.name);
const typeOf = (name) => TYPES.find((t) => t[0] === name) || OTHER_TYPE;
const HISTORY = new Set(["Recent history", "Kept from before the cut"]);
const SHOWN_KEY = "ag-dashboard-shown-types-4";   // -4: system/developer messages and the preamble hidden by default
const shownTypes = (() => {                       // the reader's choice, kept in this browser; by default the
                                                  // conversation: user and assistant messages, and the Gatherer's
  try { const v = JSON.parse(localStorage.getItem(SHOWN_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set(["user_message", "agent_message", "gatherer"]);
})();
function toggleType(type) {
  if (shownTypes.has(type)) shownTypes.delete(type); else shownTypes.add(type);
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...shownTypes])); } catch (e) { /* kept for this page only */ }
  keepingPlace(renderMain);
}
const GROUP_COLORS = { [PREAMBLE]: "var(--s8)", [NOT_COUNTED]: "var(--axis)", "Gatherer guide": "var(--t-gatherer)" };
// a group GROUP_ORDER does not name (or its first, index 0) takes --s6: there is no --s-1
const color = (group) => GROUP_COLORS[group] || `var(--s${GROUP_ORDER.indexOf(group) > 0 ? GROUP_ORDER.indexOf(group) : 6})`;
const usd = (v) => v === null || v === undefined ? "–" : v > 0 && v < 0.01 ? "<$0.01" : "$" + v.toFixed(2);
// Each harness as harness_kit describes it (data.py's `harness_info`), by its name: the page names none itself. A
// session that names none is the home's `harness_default`'s.
const harnessInfo = (h) => ((state.home && state.home.harness_info) || {})[h] || null;
const harnessName = (h) => (harnessInfo(h) || {}).label || "Unknown harness";
// Each harness's mark (harness_kit/marks/<name>.svg): its logo, white, on its colour, in a 24x24 circle -- as a badge
// at the corner of an actor's avatar, on what starts one, and alone for an actor with no avatar. One harness_kit has
// no mark for: a grey circle with "?".
const HARNESS_MARKS = new Map();                   // each mark's SVG, parsed once
function harnessMark(h, cls) {
  const info = harnessInfo(h);
  let src = info && info.mark ? HARNESS_MARKS.get(info.mark) : null;
  if (info && info.mark && src === undefined) {
    const root = new DOMParser().parseFromString(info.mark, "image/svg+xml").documentElement;
    HARNESS_MARKS.set(info.mark, src = root && root.nodeName === "svg" ? root : null);
  }
  let svg;
  if (src) svg = document.importNode(src, true);
  else {
    svg = svgEl("svg", { viewBox: "0 0 24 24" });
    const t = svgEl("text", { x: 12, y: 16, "text-anchor": "middle", fill: "#fff", "font-size": 12, "font-weight": 700, "font-family": "system-ui, sans-serif" });
    t.textContent = "?";
    svg.append(svgEl("circle", { cx: 12, cy: 12, r: 12, fill: "#898781" }), t);
  }
  svg.querySelectorAll("title").forEach((t) => t.remove());
  const title = svgEl("title"); title.textContent = harnessName(h);
  svg.prepend(title);
  for (const [k, v] of Object.entries({ class: cls, role: "img", "aria-label": harnessName(h) })) svg.setAttribute(k, v);
  return svg;
}
const harnessLogo = (h) => harnessMark(h, "logo");
const harnessBadge = (h) => harnessMark(h, "badge");
// The actor's avatar (avatars.py), its harness's badge small at the corner; an actor with none (no
// picture to give, or a snapshot from before them) has its harness's mark alone.
function actorLogo(a) {
  const svg = SNAPSHOT && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
  const src = !a.avatar ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${a.avatar}.svg`;
  if (!src) return harnessLogo(a.harness);
  const mark = appMark(a);                            // an app's actor: its app's mark (19-app-actors.js)
  return el("span", { class: "logo avatar" + (mark ? " dw" : "") }, el("img", { src, alt: "", draggable: "false" }),
    mark, harnessBadge(a.harness));
}
// The words an actor at work says, in its avatar's hue (avatars/README.md's hues, assets/src/avatars/kit.py's
// shades): its dark shade on a light page, halfway from its main shade to its light one on a dark page.
const HUE_INK = { red: ["#b91c1c", "#f57474"], orange: ["#c2410c", "#fb9645"], yellow: ["#b45309", "#fcd257"],
  lime: ["#4d7c0f", "#aee259"], green: ["#166534", "#54ca83"], teal: ["#0f766e", "#56d7c5"], sky: ["#0369a1", "#79d1fa"],
  blue: ["#1e40af", "#7095f9"], purple: ["#5b21b6", "#a788f9"], pink: ["#be185d", "#f7a0cf"], brown: ["#6b4226", "#c1966c"],
  gray: ["#334155", "#aab4c2"] };
const hueInk = (a) => { const ink = a && HUE_INK[a.avatar_hue]; return ink ? `color: light-dark(${ink[0]}, ${ink[1]})` : null; };
// The actor's avatar without its circle, its character alone: where to get it (null: none to show).
function bareAvatar(a) {
  const svg = SNAPSHOT && a && a.avatar && (SNAPSHOT.avatars || {})[a.avatar];
  return !a || !a.avatar ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg.replace(/<circle cx="32" cy="32" r="32"[^>]*\/>/, ""))
    : `/avatars/${a.avatar}.svg?bare=1`;
}
// The actor done, at its turn's end in the Chat view: its avatar small, still, a check at its corner -- grown in, if the
// page saw the turn end.
function atRest(a, turn) {
  const src = bareAvatar(a);
  if (a) stage.rest(a.channel);
  const gone = a ? reaction(`${a.channel} done`, turn, a.last) : null;
  const ok = svgEl("svg", { viewBox: "0 0 10 10", "aria-hidden": "true" });
  ok.append(svgEl("path", { d: "M2.2 5.2L4.2 7.1L7.9 3.1", fill: "none", stroke: "#fff", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" }));
  return el("span", { class: "done", style: `--r: -${Math.round(gone === null ? 60000 : gone)}ms`, "data-sig": signature([src, turn]) },
    src ? el("img", { src, alt: "", draggable: "false" }) : null, el("span", { class: "ok" }, ok));
}
// The actor at work in the Chat view: its avatar acting out its turn -- `t`, the turn, its `work` (work.py's summary) --
// on the stage; or, the setting "Simple" (avatarMode), buddy()'s one motion. An actor with no avatar has the turning glyph.
function atWork(a, t) {
  const src = bareAvatar(a);
  if (!src) return el("span", { class: "spin", "aria-hidden": "true" });
  return avatarMode === "simple" ? buddy(a, !!a.failing) : stage(a, (t && t.work) || {}, src);
}
// The actor before its first message, in the Chat view: its avatar waving hello -- a hand in its hue, its wrist at 0, 0
// (HAND: its fingers and thumb, each a line), raised beside it on the stage; or, the setting "Simple" (avatarMode),
// buddy()'s one motion. On the page's clock, so a redraw does not start it over. Its first turn's actor then arrives on
// the stage (stage.rest). An actor with no avatar: none.
const HAND = [[-3.4, -8, -4.9, -14.6], [-1.1, -9, -1.6, -16.6], [1.3, -9, 1.7, -16.2], [3.4, -7.6, 4.8, -13.4], [-3.8, -4.6, -8.4, -8.2]];
function greeting(a) {
  const src = bareAvatar(a);
  if (!src) return null;
  stage.rest(a.channel);
  if (avatarMode === "simple") return buddy(a, false);
  const hand = (cls, w, r) => `<g class="${cls}">${HAND.map(([x1, y1, x2, y2]) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`).join("")}<circle cy="-5.6" r="${r}" stroke="none"/></g>`;
  const box = el("span", { class: "stage-box", "data-sig": signature(["hello", src, a.avatar_hue]) });   // kept while the same
  box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="stage s-hello" viewBox="-8 -14 102 82" aria-hidden="true" style="`
    + `--t: -${Math.round(performance.now())}ms; --dot: ${HUE_MAIN[a.avatar_hue] || "var(--muted)"}">`
    + `<g class="me"><image href="${escapeHtml(src)}" x="0" y="0" width="64" height="64"/></g>`
    + `<g transform="translate(66 30) scale(1.25)"><g class="hand"><rect x="-9" y="-17.5" width="18" height="17.5" fill="none"/>`
    + `${hand("ho", 4.4, 6.1)}${hand("hf", 2.8, 5.3)}</g>`
    + `<path class="swish" d="M-12 -15q-2.2 3.4 -.6 7"/><path class="swish s2" d="M11.5 -15q2.2 3.4 .6 7"/></g></svg>`;
  return box;
}
// What the actor says before its first message, under it waving: src/features/chat/Hello.tsx.
// The actor at work, small: its avatar's character out of its circle, moving as it does (its avatar_motion: a move, then an
// effect round it, if any -- the .buddy CSS), on the page's clock so a redraw does not start it over; `still`, its calls
// failing: not moving.
function buddy(a, still) {
  const [move, fx] = (a.avatar_motion || "").split(/\s+/).map((w) => /^[a-z0-9-]+$/.test(w) ? w : "");
  return el("span", { class: ["buddy", move && `m-${move}`, fx && `f-${fx}`, still && "still"].filter(Boolean).join(" "),
    style: `--t: -${Math.round(performance.now())}ms`, "aria-hidden": "true", "data-sig": signature([bareAvatar(a), move, fx, !!still]) },
    el("img", { src: bareAvatar(a), alt: "", draggable: "false" }), ...(fx ? [el("i"), el("i"), el("i")] : []));
}
// What an actor's stage reacts to, once: a call that ended, its turn over (`id`: which; null, none). Started when the
// page sees it change -- or, seen on first drawing the actor, from when it happened, if that was lately; null once over.
const REACT_MS = 3200, REACT_LATE = 6;
const reacted = new Map();                          // "<channel> <what>" -> {id, start (performance.now())}
function reaction(k, id, at) {
  id = id === undefined ? null : id;
  let r = reacted.get(k);
  if (!r || r.id !== id) {
    const late = Math.max(0, Date.now() / 1000 - (at || 0));
    r = { id, start: r ? performance.now() : late < REACT_LATE ? performance.now() - late * 1000 : -Infinity };
    reacted.set(k, r);
  }
  const gone = performance.now() - r.start;
  return id !== null && gone < REACT_MS ? gone : null;
}
// The main shade of each avatar hue (assets/src/avatars/kit.py's), for its thought's dots.
const HUE_MAIN = { red: "#ef4444", orange: "#f97316", yellow: "#fbbf24", lime: "#84cc16", green: "#22a55a", teal: "#14b8a6", sky: "#38bdf8",
  blue: "#3b6cf6", purple: "#8b5cf6", pink: "#f472b6", brown: "#a0683a", gray: "#64748b" };
// The stage: any avatar's character (its picture, 64 units square at 0, 0) acting out what its turn does with the same tool
// whatever the character, so a tool always means one thing -- a book (read), a magnifying glass (search), a pencil and
// sheet (edit), a checklist (test), gears (run), a parcel sent off (ship), an hourglass (wait), little copies of it (team);
// as a call ends, slowing to a stop and putting the tool away to think (a thought by its head, its dots in the avatar's
// hue, the character moving as it does: its avatar_motion's move, and its effect round it), until the next; and
// reacting to how a call ended, what shows on its head and at the stage's corner.
const stage = (() => {
  const star = (k) => `<path class="star s${k}" d="M0 -2.6L.7 -.7L2.6 0L.7 .7L0 2.6L-.7 .7L-2.6 0L-.7 -.7Z"/>`;
  const CONFETTI = [[-24, -14, "#22c55e"], [-16, -24, "#fbbf24"], [-6, -28, "#f472b6"], [6, -27, "#38bdf8"], [16, -24, "#a78bfa"], [24, -15, "#f97316"],
    [-28, -4, "#38bdf8"], [28, -5, "#22c55e"]];
  const CLOUD = [[61, -1.8, 4], [66.2, -5, 5], [71.4, -1.8, 4], [66.2, -.6, 4.6]];
  const OVER = `
    <g class="ov o-think"><circle class="tb tb1" cx="50.5" cy="9.6" r="1.5"/><circle class="tb tb2" cx="55" cy="4.6" r="2.3"/>
      <g class="tb tb3">${CLOUD.map(([x, y, r]) => `<circle class="te" cx="${x}" cy="${y}" r="${r}"/>`).join("")}
        ${CLOUD.map(([x, y, r]) => `<circle class="tf" cx="${x}" cy="${y}" r="${r}"/>`).join("")}
        <g class="td"><circle cx="62.6" cy="-2.6" r="1.3"/><circle cx="66.2" cy="-2.6" r="1.3"/><circle cx="69.8" cy="-2.6" r="1.3"/></g></g></g>
    <g class="ov o-bang"><text x="54" y="6" font-size="15" font-weight="800" fill="#ef4444" font-family="system-ui, sans-serif">!</text></g>
    <g class="ov o-cloud"><g transform="translate(0 -9)"><path d="M22 6C22 2.5 25.5 1 28 2.8C29.5 -.6 35.5 -.6 37 2.8C39.5 1 43 2.6 42.5 6C45 6.6 45 10.6 42 10.6H22.5C19.5 10.6 19 6.8 22 6Z" fill="#78716c"/>
      <path d="M29 8.6l2.4 -3l1.4 1.8l2.4 -3" stroke="#fde68a" stroke-width="1.1" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    <g class="ov o-stars"><g transform="translate(32 2)">${star(1)}${star(2)}${star(3)}</g></g>
    <g class="ov o-confetti"><g transform="translate(32 16)">${CONFETTI.map(([dx, dy, c], i) => `<rect class="cf" x="-1" y="-1.6" width="2" height="3.2" rx=".5" `
      + `fill="${c}" style="--dx:${dx}px;--dy:${dy}px;animation-delay:calc(var(--r) - ${i * 40}ms)"/>`).join("")}</g></g>
    <g class="ov o-q"><g transform="translate(57 1)"><circle class="qb" r="6.5"/><text class="qt" x="-2.6" y="3.2">?</text></g></g>
    <g class="ov o-check" transform="translate(86 2)"><g class="bd"><circle r="7" fill="#22a55a"/><path d="M-3.3 .2L-1 2.6L3.4 -2.2" stroke="#fff" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    <g class="ov o-cross" transform="translate(86 2)"><g class="bd"><circle r="7" fill="#ef4444"/><path d="M-2.6 -2.6L2.6 2.6M2.6 -2.6L-2.6 2.6" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/></g></g>`;
  const ROWS = [10, 16.5, 23];                       // the checklist's lines
  const gear = (cls, x, y, r) => `<g transform="translate(${x} ${y})"><g class="gear ${cls}">
    <circle r="${r}" stroke-width="${r * .55}" stroke-dasharray="${(r * .5).toFixed(2)} ${(r * .42).toFixed(2)}"/>
    <circle r="${r * .72}" style="fill: var(--metal)"/><circle r="${r * .28}" style="fill: var(--surface)"/></g></g>`;
  // each of work.py's kinds, and thinking alone: its tool, behind and before the character
  const PROPS = {
    think: () => ({}),
    read: () => ({ front: `<g class="prop">
      <path d="M17 46.5Q24.5 44.5 32 47Q39.5 44.5 47 46.5V58.8Q39.5 56.8 32 59.3Q24.5 56.8 17 58.8Z" fill="#3b6cf6"/>
      <path d="M18.5 46Q25 44.2 32 46.4V57.6Q25 55.4 18.5 57.2Z" fill="#fff"/><path d="M45.5 46Q39 44.2 32 46.4V57.6Q39 55.4 45.5 57.2Z" fill="#fff"/>
      <path d="M21 49.2h7.5M21 51.7h7.5M21 54.2h5.5M35.5 49.2h7.5M35.5 51.7h7.5M35.5 54.2h5.5" stroke="#b9ad9f" stroke-width=".9" stroke-linecap="round"/>
      <path class="flip" d="M45.5 46Q39 44.2 32 46.4V57.6Q39 55.4 45.5 57.2Z" fill="#efeae1"/></g>` }),
    search: () => ({ front: `<g class="prop"><g transform="translate(66 38)"><g class="mag">
      <path d="M5.8 5.8L12.6 12.6" stroke="#8b5a2b" stroke-width="3.6" stroke-linecap="round"/>
      <circle r="8.2" fill="rgba(186, 230, 253, .45)" stroke="#64748b" stroke-width="2.4"/>
      <path class="glint" d="M-4.8 -2.2A5.2 5.2 0 0 1 -1.8 -5.3" stroke="#fff" stroke-width="1.7" fill="none" stroke-linecap="round"/></g></g></g>` }),
    edit: () => ({
      back: `<g class="prop"><g transform="rotate(5 63 49)"><rect class="paper" x="51" y="38" width="24" height="22" rx="1.6"/>
        <path class="ln l1" d="M55 43.5h16"/><path class="ln l2" d="M55 48h16"/><path class="ln l3" d="M55 52.5h11"/></g></g>`,
      front: `<g class="prop"><g transform="translate(55.5 42.8)"><g class="pen"><g transform="rotate(250)">
        <path d="M0 0L5 -2V2Z" fill="#f1d3a6"/><path d="M0 0L1.9 -.76V.76Z" fill="#3a2a2a"/>
        <rect x="5" y="-2" width="10" height="4" fill="#fbbf24"/><path d="M5 0H15" stroke="#f59e0b" stroke-width=".8"/>
        <rect x="15" y="-2" width="1.6" height="4" fill="#a8a29e"/><rect x="16.6" y="-2" width="2.8" height="4" rx="1" fill="#f9a8d4"/></g></g></g></g>` }),
    test: () => ({ front: `<g class="prop"><g transform="translate(60 21)">
      <rect x="0" y="2" width="24" height="30" rx="2.5" fill="#b9824f"/><rect x="2.5" y="5" width="19" height="25" rx="1" fill="#fff"/>
      <rect x="7" y="0" width="10" height="5" rx="1.5" fill="#94a3b8"/>
      ${ROWS.map((y, i) => `<rect x="5" y="${y - 2.2}" width="4.4" height="4.4" rx=".8" fill="none" stroke="#94a3b8" stroke-width=".9"/>
        <path d="M11.5 ${y}h7.5" stroke="#cbd5e1" stroke-width="1.4" stroke-linecap="round"/><path class="tk tk${i}" d="M5.7 ${y}l1.4 1.4l2.5 -2.8"/>`).join("")}
      <path class="tx" d="M5.6 ${ROWS[1] - 1.6}l3.2 3.2M8.8 ${ROWS[1] - 1.6}l-3.2 3.2" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></g></g>` }),
    run: () => ({ back: `<g class="prop">${gear("g1", 69, 31, 8)}${gear("g2", 81.5, 43, 5.4)}</g>` }),
    ship: () => ({ front: `<g class="prop"><g transform="translate(62 43)"><g class="parcel">
      <rect width="18" height="14" rx="1.5" fill="#d6a86c"/><path d="M0 4.5H18" stroke="#b07d3e" stroke-width="1"/><rect x="7.5" width="3" height="14" fill="#f3e1c4"/></g>
      <path class="arrow" d="M9 -4v-8M5.5 -8.5L9 -12L12.5 -8.5" stroke="#22a55a" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>` }),
    wait: () => ({ front: `<g class="prop"><g transform="translate(74 45)"><g class="hg">
      <rect class="wood" x="-6.5" y="-13" width="13" height="2.4" rx="1.2"/><rect class="wood" x="-6.5" y="10.6" width="13" height="2.4" rx="1.2"/>
      <path class="glass" d="M-4.6 -10.6H4.6C4.6 -4.5 1.1 -2.2 1.1 0C1.1 2.2 4.6 4.5 4.6 10.6H-4.6C-4.6 4.5 -1.1 2.2 -1.1 0C-1.1 -2.2 -4.6 -4.5 -4.6 -10.6Z"/>
      <path class="sand st" d="M-3.6 -9.2H3.6C3.6 -5 .8 -2.6 0 -.6C-.8 -2.6 -3.6 -5 -3.6 -9.2Z"/><path class="stream" d="M0 -.6V9"/>
      <path class="sand sb" d="M-3.9 10.4Q0 3.2 3.9 10.4Z"/></g></g></g>` }),
    team: (src, n) => ({ front: `<g class="prop">${[[65, 50], [78, 53], [91, 50]].slice(0, n).map(([x, y], k) =>
      `<g transform="translate(${x} ${y})"><g class="mini m${k}"><image href="${src}" x="-10" y="-10" width="20" height="20"/></g></g>`).join("")}</g>` }),
  };
  const props = (look, src) => look.startsWith("team") ? PROPS.team(src, +look.slice(4) || 1) : (PROPS[look] || PROPS.think)();
  // what came of a call: on its own tool (a test's checklist, a commit's parcel) or on whatever it does now
  const ENDS = { pass: "test", tfail: "test", ship: "ship" };
  const MOVE_MS = 600, WIND_MS = 1400;
  const PUT_AFTER = 900, PUT_MS = 650;              // a call over: its tool put away this long after, taking this long
  // where the action's animations are, by the page's clock, `e` ms after a call ended: slowing evenly to a stop over WIND_MS
  const wound = (since, now) => { const e = Math.min(WIND_MS, Math.max(0, now - since)); return since + e - e * e / (2 * WIND_MS); };
  const WINDS = new Set(["w-read", "w-flip", "w-search", "w-sweep", "w-glint", "w-edit", "w-l1", "w-l2", "w-l3", "w-pen", "w-test", "w-tk0",
    "w-tk1", "w-tk2", "w-run", "w-gear", "w-ship", "w-parcel", "w-arrow", "w-wait", "w-stream", "w-hg", "w-st", "w-sb", "w-team", "w-scurry"]);
  // the action's animations held where `wound` says, frame by frame until stopped: drawn already where it starts them (--a)
  const windDown = (svg, since, from) => {
    const anims = svg.getAnimations({ subtree: true }).filter((x) => WINDS.has(x.animationName));
    for (const x of anims) x.pause();
    const step = () => {
      if (!svg.isConnected) return;
      const now = performance.now();
      for (const x of anims) x.currentTime = wound(since, now) - from;
      if (now - since < WIND_MS) requestAnimationFrame(step);
    };
    step();
  };
  // what each actor's stage last showed: {look, at (when it changed), was (the look before), musing, musedAt (when that changed),
  // putAt (when its tool is put away; null: none to), bubbleAt (when its thought grows in), popBubble, done, arrivedAt}
  const shown = new Map();
  const stage = (a, w, src) => {
    const ch = a.channel;
    const e = w.ended, gone = reaction(`${ch} call`, e ? e.id : null, e && e.at);
    const react = gone === null ? null : !e.ok ? (e.kind === "test" ? "tfail" : "fail")
      : e.kind === "test" ? "pass" : e.kind === "ship" ? "ship" : null;
    const musing = !w.doing, t0 = performance.now();
    let sh = shown.get(ch);
    if (!sh || sh.done) {                            // first seen (no change to show), or a new turn after its last: it arrives
      sh = { look: null, at: -Infinity, was: null, musing, musedAt: -Infinity, putAt: null, bubbleAt: -Infinity, popBubble: false,
        done: false, arrivedAt: sh ? t0 : -Infinity };
      shown.set(ch, sh);
    }
    const wasPut = sh.putAt !== null && t0 >= sh.putAt;   // what it showed is being put away, or is
    if (sh.musing !== musing) {                      // a call over (the model at work), or one begun
      const acting = sh.look !== null && sh.look !== "think";
      const putAt = musing && acting ? t0 + (react ? REACT_MS - 300 : PUT_AFTER) : null;
      Object.assign(sh, { musing, musedAt: t0, putAt, popBubble: !musing && sh.bubbleAt <= t0,
        bubbleAt: !musing ? sh.bubbleAt : putAt === null ? t0 : putAt + 350 });
    }
    // a call running; else, the call it made last, until it is put away (and while nothing readable was said since); else thinking
    const putting = musing && sh.putAt !== null && t0 < sh.putAt + PUT_MS;
    const doing = (react && ENDS[react]) || w.doing || (putting && w.last) || "think";
    const look = doing === "team" ? `team${Math.min(3, Math.max(1, w.helpers || 0))}` : doing;
    if (sh.look === null) sh.look = look;            // first seen: as it is
    else if (sh.look !== look)                       // what it showed, put away already, has nothing left to take off
      Object.assign(sh, { was: wasPut && sh.look !== "think" ? null : sh.look, look, at: t0 });
    const moving = sh.was !== null && t0 - sh.at < MOVE_MS;
    const href = escapeHtml(src), p = props(look, href), q = moving ? props(sh.was, href) : null;
    const since = Math.max(sh.musedAt, t0 - 60000);
    const [move, fx] = (a.avatar_motion || "").split(/\s+/).map((x) => /^[a-z0-9-]+$/.test(x) ? x : "");
    const cls = ["stage", `s-${doing}`, musing && "musing", putting && "putting", !musing && sh.popBubble && t0 - sh.musedAt < 400 && "popping",
      t0 - sh.arrivedAt < MOVE_MS && "arriving", react && `r-${react}`, (!react || react === "fail") && w.failed >= 3 && "streak",
      a.failing && "retry"].filter(Boolean).join(" ");
    const box = el("span", { class: "stage-box" });
    box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="-8 -14 102 82" aria-hidden="true" style="`
      + `--t: -${Math.round(t0)}ms; --r: -${Math.round(gone || 0)}ms; --dot: ${HUE_MAIN[a.avatar_hue] || "var(--muted)"}; `
      + `--x: -${Math.round(Math.min(60000, t0 - sh.at))}ms; --y: -${Math.round(Math.min(60000, t0 - sh.musedAt))}ms; `
      + `--z: -${Math.round(Math.min(60000, t0 - sh.arrivedAt))}ms; --a: -${Math.round(musing ? wound(since, t0) : t0)}ms; `
      + `--p: ${Math.round(Math.max(-60000, (sh.putAt ?? t0 - 60000) - t0))}ms; --b: ${Math.round(Math.max(-60000, sh.bubbleAt - t0))}ms">`
      + `${q && q.back ? `<g class="leave">${q.back}</g>` : ""}${p.back ? `<g class="enter">${p.back}</g>` : ""}`
      + `<g class="me${move ? ` m-${move}` : ""}"><image href="${href}" x="0" y="0" width="64" height="64"/></g>`
      + `${q && q.front ? `<g class="leave">${q.front}</g>` : ""}${p.front ? `<g class="enter">${p.front}</g>` : ""}${OVER}</svg>`;
    if (fx) box.append(el("span", { class: `buddy f-${fx}`, style: `--t: -${Math.round(t0)}ms` }, el("i"), el("i"), el("i")));
    // what it shows, not when it was drawn (its clock's --t, --a): drawn again the same, the one on the page is kept --
    // also once a moment is over, its one-time animation done (popping, arriving; the tool put away faded out, `was`):
    // the one kept looks the same
    const shows = cls.split(" ").filter((c) => c !== "popping" && c !== "arriving").join(" ");
    box.dataset.sig = signature([shows, look, href, fx, a.avatar_hue]);
    const svg = box.firstElementChild;
    if (musing) requestAnimationFrame(() => windDown(svg, since, wound(since, t0)));   // once drawn: its animations exist
    const left = Math.max(gone === null ? 0 : REACT_MS - gone, moving ? MOVE_MS - (t0 - sh.at) : 0,
      putting ? sh.putAt + PUT_MS - t0 : 0);         // put away: drawn thinking
    // over: drawn as it is now -- the one shown kept if it shows the same, to look again when what is next is due
    box.agLeft = left;
    const again = () => {
      if (!box.isConnected) return;
      const next = stage(a, w, src);
      if (next.dataset.sig !== box.dataset.sig) box.replaceWith(next);
      else if (next.agLeft) setTimeout(again, next.agLeft + 30);
    };
    if (left) setTimeout(again, left + 30);
    return box;
  };
  // its turn over (atRest): the next turn's actor arrives
  stage.rest = (ch) => { const sh = shown.get(ch); if (sh) sh.done = true; else shown.set(ch, { done: true }); };
  return stage;
})();
// An eye with a stroke through it: hide.
function hideIcon() {
  const svg = svgEl("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": "true", fill: "none", stroke: "currentColor",
    "stroke-width": 1.5, "stroke-linecap": "round" });
  svg.append(svgEl("path", { d: "M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" }),
    svgEl("circle", { cx: 8, cy: 8, r: 2 }), svgEl("line", { x1: 2.5, y1: 13.5, x2: 13.5, y2: 2.5 }));
  return svg;
}
// An icon drawn as a stroke: `d`, an SVG path in a 16x16 box.
function strokeIcon(d, size = 15) {
  const svg = svgEl("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": "true", fill: "none", stroke: "currentColor",
    "stroke-width": 1.4, "stroke-linecap": "round", "stroke-linejoin": "round" });
  svg.append(svgEl("path", { d }));
  return svg;
}
const ICONS = {
  bubble: "M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z",
  // the gatherer agent: one that the others hang from
  crew: "M8 2.25a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5zM3.25 10.25a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5z"
    + "M12.75 10.25a1.75 1.75 0 1 1 0 3.5a1.75 1.75 0 1 1 0-3.5zM7 5.5l-2.6 4.9M9 5.5l2.6 4.9",
  terminal: "M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5z"
    + "M4.5 6.25l2 1.75-2 1.75M8.25 10.25h3.25",
  history: "M2.6 8a5.4 5.4 0 1 0 1.58-3.82M2.4 2.6v2.6H5M8 5.2v3l2 1.3",
  list: "M5.75 4h7.75M5.75 8h7.75M5.75 12h7.75M2.5 4h.01M2.5 8h.01M2.5 12h.01",
  page: "M4.25 1.75h5l3 3v9a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5zM9 1.75v3.25h3.25M5.75 8.25h4.5M5.75 11h4.5",
  layers: "M8 2.25l6 3-6 3-6-3zM2 8l6 3 6-3M2 10.75l6 3 6-3",
  // an app (app_kit's): four tiles
  app: "M3.5 2.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM9.5 2.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3"
    + "a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM3.5 8.5h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1zM9.5 8.5h3"
    + "a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z",
  panel: "M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5zM9.75 2.75v10.5",
  sidebar: "M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5zM6.25 2.75v10.5",
  pulse: "M1.5 8.5h2.75l1.75-4.25 2.5 7.5 2-5.5 1.25 2.25h2.75",   // what runs in the background: alive
  code: "M5.25 4.75L2 8l3.25 3.25M10.75 4.75L14 8l-3.25 3.25M9.25 2.75l-2.5 10.5",   // the Editor: a file's code
  quill: "M13.5 2.5c-4.75.25-8 3.5-9 8.75L2.75 13.5M4.6 10.4h3.15c2.4-1.1 4.25-3.6 5.75-7.9M6.2 7.4h3.3",   // DocWriter: writing
  folderUp: "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1zM8 11.1V7.1M6.3 8.8 8 7.1l1.7 1.7",   // the folder above
  folder: "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z",   // a folder of actors
  folderOpen: "M1.75 12V4a1 1 0 0 1 1-1h3.4l1.5 1.6h4.6a1 1 0 0 1 1 1v1.2M1.75 12l1.7-4.7a1 1 0 0 1 .94-.66h9.1a.6.6 0 0 1 .56.8l-1.6 4.4a1 1 0 0 1-.94.66H2.75a1 1 0 0 1-1-1z",   // one opened
  folderNew: "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1zM8 7.1v4M6 9.1h4",   // one made
  pencil: "M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8",   // renamed
  bin: "M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5M4.1 4.25l.65 8.6a1 1 0 0 0 1 .9h4.5a1 1 0 0 0 1-.9l.65-8.6M6.6 6.75v4.5M9.4 6.75v4.5",   // deleted
  power: "M8 1.75v5.5M4.6 3.9a5.25 5.25 0 1 0 6.8 0",                  // a shell terminated
  chevron: "M6 3.5 10.5 8 6 12.5",                                     // more, folded: turned down once shown
  wrap: "M2 3.5h12M2 7.5h9.25a2.25 2.25 0 0 1 0 4.5H8.5M10 10.5 8.5 12 10 13.5M2 11.5h3.5",   // long lines wrapped
  branch: "M4.5 2.5v8.5M3 12.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0"
    + "M11.5 6c0 3.25-7 2.25-7 5",                                       // an actor on a branch of its own
  agent: "M4.75 5.25h6.5A1.75 1.75 0 0 1 13 7v4.5a1.75 1.75 0 0 1-1.75 1.75h-6.5A1.75 1.75 0 0 1 3 11.5V7a1.75 1.75 0 0 1 1.75-1.75z"
    + "M8 2.5v2.75M6.25 8.25v1.5M9.75 8.25v1.5M1.25 8.5v2.5M14.75 8.5v2.5",   // a new actor: an agent's head
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",                              // more of them, in a drop-down
  globe: "M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5zM1.75 8h12.5M8 1.75c1.75 1.75 2.6 3.9 2.6 6.25S9.75 12.5 8 14.25"
    + "M8 1.75C6.25 3.5 5.4 5.65 5.4 8s.85 4.5 2.6 6.25",                   // a Browser
  pointer: "M3.25 2.25l9.5 4.6-4.05 1.35-1.7 4.3z",                    // pick an element
  area: "M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11M7 2.5h2M7 13.5h2M2.5 7v2M13.5 7v2",   // pick an area
  back: "M9.75 3.5 5.25 8l4.5 4.5",
  forward: "M6.25 3.5 10.75 8l-4.5 4.5",
  up: "M8 13.25V3M3.75 7.25 8 3l4.25 4.25",                          // the rail: the folder it is in
  home: "M2.25 7.25 8 2.5l5.75 4.75M3.75 6v7.25h3.1V9.75h2.3v3.5h3.1V6",   // the rail's root: every gatherer
  reload: "M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.5v3h-3",
  plus: "M8 3.25v9.5M3.25 8h9.5",
  play: "M5 3.25v9.5L12.75 8z",                                        // run: the Editor's preview
  minimize: "M4 5.5 8 9.5l4-4M3 12.75h10",                             // the chat minimized under the Editor: down to a line
  restore: "M4 10.5 8 6.5l4 4M3 3.25h10",                              // and shown again: up from it
  move: "M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6 2 8l2 2M12 6l2 2-2 2",   // a pane moved, dragged by it: four ways
  takeOut: "M9 2.75h3.25v10.5H9M10.25 8H3m2.5-2.75L2.75 8l2.75 2.75",  // out of its task: an arrow leaving a box
};
// A circled cross: end the dashboard's own idle agent for a session, which then shows Closed.
function closeIcon() {
  const svg = svgEl("svg", { viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": "true", fill: "none", stroke: "currentColor",
    "stroke-width": 1.5, "stroke-linecap": "round" });
  svg.append(svgEl("circle", { cx: 8, cy: 8, r: 6 }), svgEl("line", { x1: 5.8, y1: 5.8, x2: 10.2, y2: 10.2 }),
    svgEl("line", { x1: 10.2, y1: 5.8, x2: 5.8, y2: 10.2 }));
  return svg;
}
// A bookmark: the actor saved for later (filled), or to be.
function saveIcon(on) {
  const svg = svgEl("svg", { viewBox: "0 0 16 16", width: 12, height: 12, "aria-hidden": "true", fill: on ? "currentColor" : "none",
    stroke: "currentColor", "stroke-width": 1.5, "stroke-linejoin": "round" });
  svg.append(svgEl("path", { d: "M4.25 2.25h7.5v11.5L8 11l-3.75 2.75z" }));
  return svg;
}
// Whether the dashboard runs a process for the session -- its agent, mid-turn or not, or its terminal -- or kept
// it, idle, from a restart, and no process outside has it: it can be closed from the list.
const closable = (a) => !SNAPSHOT && !!a.session && !!(a.session.terminal || a.session.pid || a.session.kept)
  && a.chattable !== false;
async function closeSession(a) {
  try { await post("/api/stop", { session_id: a.session.session_id }); }
  catch (err) { setLive(`Not closed: ${err.message}`); }
}
// A session made here that never started -- no process of it now, none starting, nothing of it in its gatherer (no
// events, no calls): its × discards it (sessions.py's `discard`), so it is listed nowhere and nothing of it is kept.
// The panes showing it close, as a shell's do when it ends (shownGone).
const discardable = (a) => !SNAPSHOT && !!a.session && !a.events && !a.reads && !closable(a) && a.chattable !== false
  && !["starting", "running", "idle", "terminal"].includes(a.session.status) && !(a.session.queued || []).length && !opened(a);
async function discardSession(g, a) {
  try { await post("/api/discard", { session_id: a.session.session_id }); }
  catch (err) { return setLive(`Not closed: ${err.message}`); }
  await loadHome();
  for (const p of [...panes.others]) if (isAt([p.g, p.c], g.name, a.channel)) closePane(p);
  if (isAt(state.selected, g.name, a.channel)) return shownGone(a.channel);
  renderAgents();
}
// what data.py decided (status_of): running, idle -- its turn over -- or closed, its process gone; asking, its
// turn waiting on the user (a question asked, a plan to approve, in its terminal), which shows before all else; error,
// its turn stopped on a model call that failed, given up on (data.py's `failing`, `stopped`), shown next; a build
// running for it shows over the first, and one that stopped since the reader last looked shows Finished
// until they do -- but not while something it started runs in the background: Background, its turn over
// and not done. A server from before `status`: running or idle by `running`.
// A session started from the page says first what its agent is doing: starting, a message waiting, failed. The selected
// actor runs, too, from the moment Claude Code sends a message that opens a turn, before ag has stored it (opened()).
const sessionStatus = (s) => !s ? null : s.status === "starting" ? ["building", "Starting"]
  : s.status === "running" || (s.queued && s.queued.length) ? ["running", "Running"] : s.status === "failed" ? ["failed", "Failed"] : null;
const statusOf = (a) => sessionStatus(a.session) || (opened(a) ? ["running", "Running"] : a.status === "asking" ? ["asking", "Waiting for you"]
  : a.status === "error" ? ["error", "Error"]
  : a.building ? ["building", "Building"]
  : (a.status ? a.status === "running" : a.running) ? ["running", "Running"]
  : a.status === "background" ? ["background", "Background"]
  : unseen(a) ? ["finished", "Finished"] : a.status === "closed" ? ["closed", "Closed"] : ["idle", "Idle"]);
// Its status as its conversation shows it: statusOf's, but a build of its context that runs once its turn is over -- a
// check that found a new task, its message then taken back (Esc) -- is ag's work, not its turn's: the status under it.
const turnStatus = (a) => {
  const st = statusOf(a);
  return st[0] === "building" && a.building && a.status !== "running" && !sessionStatus(a.session) && !opened(a)
    ? statusOf({ ...a, building: false }) : st;
};
// Whether an actor can be messaged here: a session the page started, or any session of a harness the dashboard runs
// (harness_kit's, that says how to start it: `runs`) with a directory to resume it in. Its message box works while no
// other process has it open (data.py's `chattable`).
const runsHere = (h) => !!(harnessInfo(h) || {}).runs;
const hasChat = (a) => !!a && (!!a.session || (runsHere(a.harness) && !!a.cwd));
// The harnesses the dashboard runs, by their names for a person: "Claude Code, Codex or Antigravity".
function runnableNames(join) {
  const names = Object.keys((state.home && state.home.harness_info) || {}).filter(runsHere).map(harnessName);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${join} ${names[names.length - 1]}` : names[0] || "no harness";
}
// A shell: the user's own shell in a terminal, opened from a gatherer's row (sessions.py's `shell`) and listed under it --
// no actor, but shown as one is, in a pane, by its id in a channel's place ("shell:…", which no channel is).
const isShell = (c) => typeof c === "string" && c.startsWith("shell:");
const shellOf = (c) => (isShell(c) && state.home && (state.home.shells || []).find((s) => s.id === c)) || null;
const shellPath = (s) => tildePath(s.cwd, state.home && state.home.home_dir);
const statusEl = (cls, label) => el("span", { class: "status " + cls }, el("i", { "aria-hidden": "true" }), label);

async function get(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const got = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(got.error || `${path}: ${r.status}`), { box: got.box });   // box: /api/send's
  return got;
}
const selectedInfo = () => {
  if (!state.selected || !state.home) return null;
  const [g, c] = state.selected;
  return (state.home.gatherers.find((x) => x.name === g) || { agents: [] }).agents.find((x) => x.channel === c) || null;
};
const key = (g, c) => g + "\u0000" + c;

