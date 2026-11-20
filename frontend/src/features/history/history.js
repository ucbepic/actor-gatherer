import { SNAPSHOT, state } from "../../core/page/state.js";
import {
  ICONS, TYPES, ago, clock, compact, el, full, gathererNamed, get, harnessInfo, harnessName, itemType, key,
  post, selectedInfo, signature, span, statusEl, strokeIcon, svgEl,
} from "../../core/page/helpers.js";
import { drawn, mainSignature } from "../page/data.js";
import { keepingPlace } from "../settings/panel.js";
import { renderMain } from "../page/main-view.js";
import { str, wordless } from "../../core/model/items";
import { markdown } from "../../core/ui/md";
import { plural } from "../../core/format";
import { CHAT_FEEDS, addChatView, chatView } from "../chat/views.js";
import * as prefs from "../../core/prefs";

// ------------------------------------------------------------------ the History view
// The selected actor's history to look through and pick from -- its turns (a user message and all that answered it),
// grouped by the tasks ag split it into when the reader asks, each opening to its messages -- searched (history.py). What is picked is exported, or
// given to the Gatherer's model to summarize, or to make a memory or a skill of, with what the reader asks
// of it; what the model made is listed at the right, kept by the server (<home>/dashboard/extracts/).
const HIST_KINDS = { summary: ["Summarize", "Summary", "summary.md"], memory: ["Generate memory", "Memory", "memory.md"],
  agents: ["Generate AGENTS.md", "AGENTS.md", "AGENTS.md"], skill: ["Generate skill", "Skill", "SKILL.md"] };
const HIST_PAGES = 10;                              // the pages of history.py's OUTLINE_ITEMS loaded at once
const HIST_SHOWN = 2000;                            // the rows drawn before "show more"
// `group`: whether the turns are grouped by tasks, as the reader checked it for the actor shown; null until they do:
// an actor opens grouped when it has tasks.
const hist = { group: null,
  q: "", hits: null, hitsMore: false, open: new Set(), shut: new Set(), sel: new Map(), selFor: null, last: null,
  ask: "", err: "", busy: false, full: new Map(), recs: { gatherer: null, list: [], at: 0 }, recOpen: null, limit: HIST_SHOWN,
  byId: new Map(), flat: [], tops: [], version: 0 };
const enc = encodeURIComponent;
const histKey = () => state.selected ? key(...state.selected) : null;
// The history's events, light (history.outline): all at first, a page at a time, then each time only those
// after the last one kept. One load at a time.
let histLoading = Promise.resolve();
function loadOutline() {
  histLoading = histLoading.then(loadOutlineNow, loadOutlineNow);
  return histLoading;
}
async function loadOutlineNow() {
  if (!state.selected || SNAPSHOT) return;
  const [g, c] = state.selected, k = histKey();
  if (!state.hist || state.hist.key !== k) {
    state.hist = { key: k, gatherer: g, channel: c, events: [], tasks: [], builds: {}, last: 0, more: false,
      error: "", version: 0 };
    hist.group = hist.stay = null;                   // another actor: grouped by its tasks if it has them
  }
  const h = state.hist;
  for (let page = 0; page < HIST_PAGES; page++) {
    let got;
    try { got = await get(`/api/outline?gatherer=${enc(g)}&channel=${enc(h.channel)}&after=${h.last}`); }
    catch (err) { got = { error: `Not loaded: ${err.message}` }; }
    if (state.hist !== h) return;
    if (got.error) { if (h.error !== got.error) { h.error = got.error; h.version++; } break; }
    const fresh = got.events.filter((e) => e.row_id > h.last);
    if (fresh.length || signature(got.tasks) !== signature(h.tasks) || signature(got.builds) !== signature(h.builds) || h.error
      || h.more !== got.more) h.version++;
    h.error = ""; h.tasks = got.tasks; h.builds = got.builds || {}; h.more = got.more;
    h.events.push(...fresh);
    if (fresh.length) h.last = fresh[fresh.length - 1].row_id;
    if (!got.more) break;
  }
  if (!h.loaded) { h.loaded = true; h.version++; }  // what the actor had when opened is in: tasks after it came in later
  if (hist.recs.gatherer !== g || Date.now() - hist.recs.at > 10000) await loadExtracts(g);   // another page's, too
  if (chatView().id === "history" && hist.askedFor !== key(g, c)) { hist.askedFor = key(g, c); askBuild(h, c); }
  if (((h.builds || {})[c] || {}).status === "running") pollBuild();
}
// Opening History on an actor -- the view, or another actor in it -- asks ag to build its history (an ordinary
// build, which the actor takes up at its next user message: history.build), once it has HIST_BUILD_MESSAGES
// user messages since its last build; fewer, and they are its running task as they are. ag
// checks it again; the page only spares it the asking. While the build runs, the outline is looked at
// every few seconds: its tasks come in when it is done.
const HIST_BUILD_MESSAGES = 10;
async function askBuild(h, c) {
  const b = (h.builds || {})[c];
  if (!b || b.status === "running" || b.since < HIST_BUILD_MESSAGES) return;
  h.builds[c] = { ...b, status: "running" };          // asked: not asked again before the outline says how it went
  let got;
  try { got = await post("/api/history/build", { gatherer: h.gatherer, channel: c }); }
  catch (err) { got = { failed: err.message }; }
  hist.built = { for: key(h.gatherer, c), ...got };
  if (got.started || got.running) { await loadOutline(); histRedraw(); pollBuild(); }
  else { hist.version++; histRedraw(); }
}
let buildTimer = null;
function pollBuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(async () => {
    if (chatView().id !== "history" || state.paused) return;
    await loadOutline();
    histRedraw();
  }, 3000);
}
// What the Gatherer's model made of the gatherer's history, newest first; looked at again every
// 2 s while one is being made.
let extractsTimer = null;
async function loadExtracts(g) {
  try {
    const list = await get(`/api/extracts?gatherer=${enc(g)}`);
    if (hist.recs.gatherer !== g || signature(list) !== signature(hist.recs.list)) { hist.recs = { gatherer: g, list }; hist.version++; }
    hist.recs.at = Date.now();
  } catch (err) { /* kept as it was */ }
  if (hist.recs.list.some((r) => r.status === "running")) pollExtracts();
}
function pollExtracts() {
  clearTimeout(extractsTimer);
  extractsTimer = setTimeout(async () => {
    const g = hist.recs.gatherer;
    if (!g || state.paused) return;
    await loadExtracts(g);
    histRedraw();
  }, 2000);
}
function histRedraw() {
  if (chatView().id !== "history") return;
  keepingPlace(renderMain);
  drawn.main = mainSignature();
}
// The history as a tree: actor > task (where ag has segmented its history) > turn > message, each node with
// the rows it holds. A task holds the events from its first row to the next task's; a turn, a user message
// and all after it until the next. Built again only when the events or tasks change.
let histTreeOf = { h: null, v: -1, tree: [] };
function histTree(h) {
  if (histTreeOf.h === h && histTreeOf.v === h.version) return histTreeOf.tree;
  const tasksBy = new Map();
  for (const t of h.tasks) (tasksBy.get(t.channel) || tasksBy.set(t.channel, []).get(t.channel)).push(t);
  for (const ts of tasksBy.values()) ts.sort((a, b) => a.first_row - b.first_row);
  const node = (kind, id, extra) => ({ kind, id, children: [], rows: [], tokens: 0, first: null, ...extra });
  const add = (n, e) => { n.rows.push(e.row_id); n.tokens += e.tokens; if (n.first === null) n.first = e.at; };
  const actors = new Map(), byId = new Map();
  for (const e of h.events) {
    let a = actors.get(e.channel);
    if (!a) {
      a = node("actor", `a:${e.channel}`, { channel: e.channel, tasks: tasksBy.get(e.channel) || [], ti: -2, turnN: 0, task: null, turn: null, ask: "" });
      if (!a.tasks.length) {                         // not split into tasks: its turns under one task of their own, never shown
        a.task = node("task", `k:${e.channel}:all`, { channel: e.channel, task: null, whole: true });
        a.children.push(a.task); byId.set(a.task.id, a.task);
      }
      actors.set(e.channel, a); byId.set(a.id, a);
    }
    if (a.tasks.length) {
      let ti = a.ti < -1 ? -1 : a.ti;
      while (ti + 1 < a.tasks.length && a.tasks[ti + 1].first_row <= e.row_id) ti++;
      if (ti !== a.ti) {
        a.ti = ti;
        a.task = node("task", `k:${e.channel}:${ti}`, { channel: e.channel, task: ti >= 0 ? a.tasks[ti] : null, current: ti === a.tasks.length - 1 });
        a.children.push(a.task); byId.set(a.task.id, a.task); a.turn = null;
      }
    }
    if (e.type === "user_message") { a.turnN++; a.turn = null; }
    if (!a.turn) {
      const asks = e.type === "user_message";
      a.turn = node("turn", `t:${e.channel}:${a.ti}:${a.turnN}`, { channel: e.channel, n: a.turnN, ask: asks ? e.text : "", cont: !asks && a.turnN > 0, reply: "" });
      a.task.children.push(a.turn); byId.set(a.turn.id, a.turn);
      if (asks && !a.ask) a.ask = e.text;
      if (asks && !a.task.ask) a.task.ask = e.text;                     // the request a task opens with
    }
    if (e.type === "agent_message" && e.text) a.turn.reply = e.text;
    const m = node("message", `m:${e.row_id}`, { channel: e.channel, event: e });
    byId.set(m.id, m);
    add(m, e); a.turn.children.push(m); add(a.turn, e);
    add(a.task, e);
    add(a, e);
  }
  for (const a of actors.values()) a.turns = a.turnN;
  histTreeOf = { h, v: h.version, tree: [...actors.values()] };
  hist.byId = byId;
  return histTreeOf.tree;
}
// Which message types the History view lists -- its own choice, kept in this browser: by default the user's and
// the assistant's messages (not the Gatherer's, nor tools'). A node is listed when it holds a message of a type
// shown and, searching, one that matches.
const HIST_TYPES_KEY = "ag-dashboard-history-types";
const histTypes = (() => {
  { const v = prefs.list(HIST_TYPES_KEY); if (v) return new Set(v); }
  return new Set(["user_message", "agent_message"]);
})();
function toggleHistType(type) {
  if (histTypes.has(type)) histTypes.delete(type); else histTypes.add(type);
  prefs.keep(HIST_TYPES_KEY, [...histTypes]);
  hist.version++; histRedraw();
}
const histShown = (r) => { const m = hist.byId.get(`m:${r}`); return !m || histTypes.has(itemType({ name: m.event.type, group: "Recent history" })[0]); };
const histHas = (n) => n.rows.some((r) => histShown(r) && (!hist.hits || hist.hits.has(r)));
// The rows the list shows, in order: [node, depth, header]. Turns, always one step in from the left, each opened to
// its messages where the reader opened it; grouped by tasks, each task's row at the left with its turns under it
// once opened -- so grouping only adds the tasks between the turns, nothing else moves. A search keeps the rows
// with a match.
function histVisible(tree, grouped) {
  const out = [], tops = [];
  const walk = (n, depth) => {
    if (!histHas(n)) return;
    out.push([n, depth, false]);
    if (hist.open.has(n.id) && n.kind !== "message") for (const c of n.children) walk(c, depth + 1);
  };
  for (const a of tree) for (const t of a.children) {
    if (!histHas(t)) continue;
    if (grouped) { out.push([t, 0, false]); tops.push(t); }
    if (!grouped || hist.open.has(t.id)) for (const c of t.children) { if (histHas(c)) { if (!grouped) tops.push(c); walk(c, 1); } }
  }
  hist.tops = tops;
  return out;
}
const histState = (n) => {
  let on = 0;
  for (const r of n.rows) if (hist.sel.has(r)) on++;
  return on === 0 ? "none" : on === n.rows.length ? "all" : "some";
};
// Selecting, as text is selected: a click on a row selects it -- all it holds -- and a drag, the rows from where it
// began to where it is; with ⌘ (Ctrl) they are added to what is selected already (a click on a selected row takes
// it out), with shift, from the row last clicked. A row's twisty, or a double click, opens it; Esc, or a click
// below the rows, clears it; ⌘A selects every row listed. Rows are named by `data-key`: a node's id, "/h" after
// an actor's heading. While a drag goes on only the rows' marks change; the page is drawn again when it ends.
const histNode = (k) => hist.byId.get(String(k).replace(/\/h$/, ""));
// A tool call opened, as its input reads: its tool, then its command (a shell's), else its fields one by one.
function callInput(p) {
  const inp = p.input;
  if (!inp || typeof inp !== "object") return [p.name, str(inp)].filter(Boolean).join("\n\n");
  const cmd = typeof inp.command === "string" ? inp.command : Array.isArray(inp.command) ? inp.command.join(" ") : null;
  const rest = Object.entries(inp).filter(([k]) => k !== "description" && (cmd === null || k !== "command"));
  return [p.name, ...(cmd !== null ? [cmd] : []), ...rest.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v, null, 1)}`)].join("\n\n");
}
function histWith(nodes, base) {
  const sel = new Map(base);
  for (const n of nodes) for (const r of n.rows) { const e = hist.byId.get(`m:${r}`); sel.set(r, [e ? e.channel : n.channel, e ? e.tokens : 0]); }
  return sel;
}
function histRange(a, b) {
  const i = hist.flat.indexOf(a), j = hist.flat.indexOf(b);
  const keys = i < 0 || j < 0 ? [b] : hist.flat.slice(Math.min(i, j), Math.max(i, j) + 1);
  return keys.map(histNode).filter(Boolean);
}
function histSelect(sel) {
  hist.sel = sel;
  if (sel.size) hist.panel = true;
  else if (!hist.recOpen && !hist.recs.list.some((r) => r.status === "running")) hist.panel = false;
  hist.version++;
  histRedraw();
}
function histPaint() {                              // each row's mark, from what is selected now
  for (const row of document.querySelectorAll(".hist .h-list .h-row")) {
    const n = histNode(row.dataset.key);
    if (!n) continue;
    const st = histState(n);
    row.classList.toggle("on", st === "all"); row.classList.toggle("some", st === "some");
  }
}
let histDrag = null;
function histDragTo(k) {
  const d = histDrag;
  if (!d || k === d.at) return;
  d.at = k;
  if (k !== d.from) d.moved = true;
  hist.sel = histWith(histRange(d.anchor, k), d.base);
  histPaint();
}
function histScrollWhileDragging() {                 // near the list's top or bottom edge, it scrolls, and the drag goes on
  const d = histDrag, list = document.querySelector(".hist .h-list");
  if (!d) return;
  if (list && d.y !== undefined) {
    const r = list.getBoundingClientRect(), edge = 36;
    const by = d.y < r.top + edge ? d.y - (r.top + edge) : d.y > r.bottom - edge ? d.y - (r.bottom - edge) : 0;
    if (by) {
      list.scrollTop += Math.max(-24, Math.min(24, by / 2));
      const under = document.elementFromPoint(d.x, Math.max(r.top + 2, Math.min(r.bottom - 2, d.y)));
      const row = under && under.closest(".h-row");
      if (row) histDragTo(row.dataset.key);
    }
  }
  requestAnimationFrame(histScrollWhileDragging);
}
// The rows picked, as [first, last] runs: what the server takes.
function histRanges(rows = [...hist.sel.keys()]) {
  const out = [];
  for (const r of rows.sort((x, y) => x - y)) if (out.length && r === out[out.length - 1][1] + 1) out[out.length - 1][1] = r; else out.push([r, r]);
  return out;
}
async function histOpen(id, header) {
  const set = header ? hist.shut : hist.open;
  if (set.has(id)) set.delete(id); else set.add(id);
  hist.version++;
  histRedraw();
  const n = hist.byId.get(id);
  if (!header && n && n.kind === "message" && hist.open.has(id) && !hist.full.has(n.event.row_id)) {
    const [g] = state.selected, e = n.event;
    const into = hist.full;                         // this group's: an answer that comes after another's is shown, dropped
    try {
      if (e.type === "tool_call") {
        const got = await get(`/api/event?gatherer=${enc(g)}&row_id=${e.row_id}`);
        into.set(e.row_id, (got.parts || []).filter((p) => p.kind === "call").map(callInput).join("\n\n") || "(no input)");
        hist.version++; histRedraw();
        return;
      }
      const got = await get(`/api/history?gatherer=${enc(g)}&channel=${enc(e.channel)}&from=${e.row_id}&to=${e.row_id}`);
      const it = got.items && got.items[0];
      into.set(e.row_id, it ? (it.text || `(${wordless(it)})`) + (it.clipped ? `\n… ${full(it.clipped)} more characters not shown` : "") : "(not found)");
    } catch (err) { into.set(e.row_id, `Not loaded: ${err.message}`); }
    hist.version++;
    histRedraw();
  }
}
let histSearchTimer = null;
function histSearch(q) {
  hist.q = q;
  clearTimeout(histSearchTimer);
  histSearchTimer = setTimeout(runHistSearch, 250);
}
async function runHistSearch() {
  const h = state.hist, q = hist.q.trim();
  if (!h) return;
  hist.limit = HIST_SHOWN;
  if (!q) { hist.hits = null; hist.version++; return histRedraw(); }
  let got;
  try { got = await get(`/api/search?gatherer=${enc(h.gatherer)}&channel=${enc(h.channel)}&q=${enc(q)}`); }
  catch (err) { got = { hits: [], more: false }; }
  if (state.hist !== h || hist.q.trim() !== q) return;
  hist.hits = new Map((got.hits || []).map((x) => [x.row_id, x.snippet]));
  hist.hitsMore = !!got.more;
  hist.version++;
  histRedraw();
}
function setHistGroup(on) { hist.group = on; hist.stay = null; hist.limit = HIST_SHOWN; hist.version++; histRedraw(); }
// `text` with each match of `q` marked.
function histMark(text, q, cls = "h-hit") {
  const out = el("div", { class: cls });
  const low = text.toLowerCase(), ql = (q || "").toLowerCase();
  let i = 0;
  if (ql) for (let j = low.indexOf(ql); j >= 0; j = low.indexOf(ql, i)) { out.append(text.slice(i, j), el("mark", { text: text.slice(j, j + ql.length) })); i = j + ql.length; }
  out.append(text.slice(i));
  return out;
}
function histLabel(n, hits) {
  const kind = (t, ...more) => el("span", { class: "h-kind" }, ...more, t);
  const first = hits.length ? hist.hits.get(hits[0]) : null;
  const hit = first ? histMark(first, hist.q.trim()) : null;
  if (n.kind === "actor") {
    const a = (selectedGatherer() || { agents: [] }).agents.find((x) => x.channel === n.channel);
    const mine = state.selected && state.selected[1] === n.channel;
    return [el("div", { class: "h-label" }, ...(mine ? [el("span", { class: "h-badge", text: "Selected" })] : []),
      n.ask || (a && a.last_user_message) || n.channel), hit];
  }
  if (n.kind === "task") {
    const t = n.task;
    if (t && n.current)                              // the build's last task, still open, and all since: as it is
      return [el("div", { class: "h-label" }, kind("Running task")),
        el("div", { class: "h-sub dim", text: "In progress · not summarized yet" }), hit];
    return [el("div", { class: "h-label" + (t ? "" : " dim") }, t ? t.name : "Before ag's first task"),
      t && t.description ? el("div", { class: "h-sub", text: t.description }) : null, hit];
  }
  if (n.kind === "turn")
    return [el("div", { class: "h-label" + (n.n && n.ask ? "" : " dim") },
      !n.n ? "Harness setup: system text, tools, environment" : n.ask || (n.cont ? "Continued from the previous task" : "(no text)")), hit];
  const e = n.event, [, name] = itemType({ name: e.type, group: "Recent history" });
  return [el("div", { class: "h-label" + (e.text ? "" : " dim"), title: name }, e.text || wordless({ name: e.type })), hit];
}
function histMeta(n, hits) {
  const bits = [hits.length && n.kind !== "message" ? `${full(hits.length)} match${hits.length === 1 ? "" : "es"}` : null,
    n.kind === "task" ? plural(n.children.length, "turn") : null, `${compact(n.tokens)} tok`, n.first ? ago(n.first) : null];
  return bits.filter(Boolean).join(" · ");
}
// Rows already drawn, by their key, with what they were drawn from (`sig`): handed back as the same nodes while that is
// unchanged, so a redraw builds only what is new and patch() keeps the rest in place. Emptied when `begin` is given
// another owner; a row not asked for in a draw is forgotten.
function blockCache() {
  let owner = null, now = new Map(), before = new Map();
  return {
    begin(key) { if (key !== owner) { owner = key; before = new Map(); } else before = now; now = new Map(); },
    get(k, sig, make) {
      const had = before.get(k);
      const v = had && had.sig === sig ? had.v : make();
      now.set(k, { sig, v });
      return v;
    },
  };
}
const histRows = blockCache(), histRecs = blockCache();
function histRow(n, depth, header) {
  const st = histState(n);
  const open = header ? !hist.shut.has(n.id) : hist.open.has(n.id);
  const hits = hist.hits ? n.rows.filter((r) => hist.hits.has(r)) : [];
  const fullText = n.kind === "message" ? hist.full.get(n.event.row_id) : undefined;
  const sig = [st, open, depth, n.rows.length, n.tokens, n.reply || "", hits.length, hist.q.trim(), fullText === undefined ? "" : fullText.length].join("|");
  const k = n.id + (header ? "/h" : "");
  return histRows.get(k, sig, () => {
    const what = n.kind === "message" ? (open ? "Hide full text" : "Show full text") : (open ? "Fold" : "Open");
    const row = el("div", { class: `h-row ${n.kind}${header ? " head" : ""}${depth ? " nested" : ""}${n.current ? " current" : ""}`
        + `${st === "all" ? " on" : st === "some" ? " some" : ""}${open ? " open" : ""}`,
      style: `--depth:${depth}`, "data-key": k, title: histMeta(n, hits) },
      el("button", { type: "button", class: "h-tw", title: what, "aria-label": what, "aria-expanded": open ? "true" : "false",
        onclick: () => histOpen(n.id, header) }, open ? "▾" : "▸"),
      el("div", { class: "h-main" + (n.kind === "message" ? " keyed" : ""),
        ...(n.kind === "message" ? { style: `--key:${itemType({ name: n.event.type, group: "Recent history" })[2]}` } : {}) }, ...histLabel(n, hits)),
      el("div", { class: "h-meta", "aria-hidden": "true", text: histMeta(n, hits) }));
    if (n.kind === "message" && open) row.append(el("pre", { class: "h-full", text: fullText ?? "Loading…" }));
    return row;
  });
}
const selectedGatherer = () => state.home && state.selected ? gathererNamed(state.selected[0]) : null;
function searchIcon() {
  const svg = svgEl("svg", { viewBox: "0 0 16 16", width: 13, height: 13, "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round" });
  svg.append(svgEl("circle", { cx: 7, cy: 7, r: 4.75 }), svgEl("line", { x1: 10.5, y1: 10.5, x2: 14, y2: 14 }));
  return svg;
}
function histSwitch(label, pairs, current, pick) {
  return el("div", { class: "views", role: "group", "aria-label": label }, ...pairs.map(([id, name, ok = true, why = "", cls = ""]) =>
    el("button", { type: "button", "aria-pressed": id === current ? "true" : "false", ...(ok ? {} : { disabled: "" }), title: ok ? "" : why,
      ...(cls ? { class: cls } : {}), onclick: () => pick(id) }, name)));
}
// The selected actor's tasks, as of its latest build: being made, how far behind they are, or why not.
function histBuildNote(h) {
  const c = state.selected && state.selected[1], b = c && (h.builds || {})[c];
  if (!b) return null;
  const since = `${plural(b.since, "user message")} since`;
  const asked = hist.built && hist.built.for === key(h.gatherer, c) ? hist.built : null;
  if (b.status === "running" && !h.tasks.length) return null;      // the checkbox says so
  const [cls, text, title] = b.status === "running" ? ["run", "Updating tasks…", "ag is splitting this actor's history into tasks again"]
    : asked && asked.failed ? ["bad", "Build not started", asked.failed]
    : b.status === "failed" ? ["bad", `Last build failed · ${since}`, b.error || ""]
    : !b.build_id ? ["", `No tasks yet · ${plural(b.since, "user message")}`, `ag builds tasks once an actor has ${HIST_BUILD_MESSAGES} user messages`]
    : ["", `Tasks as of ${clock(b.finished || b.started, true)} · ${since}`,
      b.since < HIST_BUILD_MESSAGES ? `Rebuilt after ${HIST_BUILD_MESSAGES} new user messages. Until then, new messages are in the running task.` : ""];
  return el("span", { class: "h-build " + cls, title }, cls === "run" ? el("span", { class: "spin", "aria-hidden": "true" }) : null, text);
}
// Which message types the list shows (`histTypes`): one button, its menu of the types.
const TYPE_SHORT = { gatherer: "Gatherer", system: "System" };
function typesMenu() {
  const all = [TYPES[6], ...TYPES.slice(0, 6)];
  const on = all.filter(([t]) => histTypes.has(t)).map(([t, name]) => TYPE_SHORT[t] || name);
  const said = on.length === all.length ? "All" : on.length > 3 ? `${on.length} types` : on.join(", ") || "None";
  return el("details", { class: "h-types", id: "hist-types" },
    el("summary", { title: "Message types shown" }, el("span", { class: "lbl", text: "Show" }), said, el("span", { class: "lbl", text: "▾" })),
    el("div", { class: "menu", role: "group", "aria-label": "Message types shown" }, ...all.map(([type, name, swatch]) => {
      const box = el("input", { type: "checkbox", ...(histTypes.has(type) ? { checked: "" } : {}) });
      box.addEventListener("change", () => toggleHistType(type));
      return el("label", {}, box, el("i", { style: `background:${swatch}` }), name);
    })));
}
// Group by tasks: a checkbox, on when the actor has tasks; while ag builds them, saying so; pulsing when they come in.
function groupBox(h, grouped, hasTasks) {
  const building = ((h.builds || {})[h.channel] || {}).status === "running";
  const flash = hist.flash && hist.flash.key === h.key && Date.now() < hist.flash.until;
  const box = el("input", { type: "checkbox", ...(grouped ? { checked: "" } : {}), ...(hasTasks ? {} : { disabled: "" }) });
  box.addEventListener("change", () => setHistGroup(box.checked));
  return el("label", { class: "h-group" + (hasTasks ? "" : " off") + (flash ? " flash" : ""),
    title: hasTasks ? "Group turns by the tasks ag found"
      : building ? "ag is splitting this actor's history into tasks" : `ag splits an actor's history into tasks once it has ${HIST_BUILD_MESSAGES} user messages` },
    box, ...(building && !hasTasks ? [el("span", { class: "spin", "aria-hidden": "true" }), "Building tasks…"] : ["Group by tasks"]));
}
function histBar(h, grouped, hasTasks) {
  const box = el("input", { type: "search", placeholder: "Search this actor's history",
    "aria-label": "Search the history", spellcheck: "false", value: hist.q });
  box.addEventListener("input", () => histSearch(box.value));
  box.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && box.value) { ev.stopPropagation(); box.value = ""; histSearch(""); } });
  const q = hist.q.trim();
  // the controls on a line of their own, which nothing else on the bar changes the width of; what a search
  // found and how the actor's build stands under them, on a line that is always there
  return el("div", { class: "h-bar", "data-morph": "" },
    el("div", { class: "h-controls", "data-morph": "" },
      el("label", { class: "h-search", "data-sig": `search:${h.key}` }, searchIcon(), box),
      groupBox(h, grouped, hasTasks),
      typesMenu(),
      el("div", { class: "h-status" },
        q ? el("span", { class: "h-found", text: !hist.hits ? "Searching…"
          : `${full(hist.hits.size)}${hist.hitsMore ? "+" : ""} matching message${hist.hits.size === 1 ? "" : "s"}` }) : null,
        histBuildNote(h))));
}
// What can be done with what is selected, at the top of the panel at the right: the Gatherer's model asked for
// one of HIST_KINDS, with what the reader wants of it; or the history saved as a file.
function histActions() {
  const rows = [...hist.sel.values()], n = rows.length;
  const tokens = rows.reduce((t, [, k]) => t + k, 0), actors = new Set(rows.map(([c]) => c)).size;
  const ask = el("textarea", { id: "hist-ask", rows: "2", "data-sig": "hist-ask", "aria-label": "Instructions",
    placeholder: "Instructions (optional)" });
  ask.value = hist.ask;
  ask.addEventListener("input", () => { hist.ask = ask.value; });
  const off = !n || hist.busy ? { disabled: "" } : {};
  return el("div", { class: "h-act", "data-morph": "" },
    el("div", { class: "row" },
      el("span", { class: "h-picked" }, ...(n ? [el("b", { text: plural(n, "message") }), ` · about ${compact(tokens)} tokens`
        + (actors > 1 ? ` · ${actors} actors` : "")] : ["Nothing selected"])),
      el("button", { type: "button", class: "h-x", title: "Close", "aria-label": "Close",
        onclick: () => { hist.panel = false; hist.recOpen = null; hist.saving = null; histSelect(new Map()); } }, strokeIcon(ICONS.x, 16))),
    ask,
    el("div", { class: "kinds" }, ...Object.entries(HIST_KINDS).filter(([, [label]]) => label).map(([k, [label]]) => el("button", { type: "button", ...off,
      title: `${label} with the Gatherer's model`, onclick: () => histMake(k) }, label))),
    el("div", { class: "row" }, el("span", { class: "h-picked", text: "Export" }),
      el("button", { type: "button", ...(n ? {} : { disabled: "" }), title: "Save the selected history as a Markdown transcript", onclick: () => histExport("md") }, ".md"),
      el("button", { type: "button", ...(n ? {} : { disabled: "" }), title: "Save the selected events as JSON", onclick: () => histExport("json") }, ".json")),
    el("div", { class: "err", role: "alert", text: hist.err }));
}
function saveFile(name, text, type = "text/markdown") {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function histExport(fmt) {
  const h = state.hist;
  if (!h || !hist.sel.size) return;
  try {
    const got = await post("/api/history/export", { gatherer: h.gatherer, rows: histRanges(), format: fmt });
    saveFile(got.name, got.text, fmt === "json" ? "application/json" : "text/markdown");
    hist.err = "";
  } catch (err) { hist.err = `Not exported: ${err.message}`; }
  hist.version++; histRedraw();
}
async function histMake(kind, again = null) {
  const h = state.hist;
  if (!h || hist.busy || (!again && !hist.sel.size)) return;
  hist.busy = true; hist.err = ""; hist.version++; histRedraw();
  try {
    const rec = await post("/api/history/extract", again ? { gatherer: again.gatherer, kind: again.kind, rows: again.rows, ask: again.ask }
      : { gatherer: h.gatherer, kind, rows: histRanges(), ask: hist.ask.trim() });
    hist.recs = { gatherer: rec.gatherer, list: [rec, ...(hist.recs.gatherer === rec.gatherer ? hist.recs.list : [])], at: Date.now() };
    hist.recOpen = rec.id; hist.panel = true;
    const side = document.querySelector(".hist .h-side"); if (side) side.scrollTop = 0;
    pollExtracts();
  } catch (err) { hist.err = err.message; }
  finally { hist.busy = false; hist.version++; histRedraw(); }
}
async function histDelete(r) {
  try { await post("/api/history/delete", { id: r.id }); } catch (err) { /* gone already */ }
  hist.recs.list = hist.recs.list.filter((x) => x.id !== r.id);
  hist.version++; histRedraw();
}
// What the model made, as it reads: a skill's front matter apart, the rest as Markdown.
function recContent(r) {
  if (r.kind === "memory") return (r.memories || []).length ? r.memories.map((m) => el("div", { class: "h-mem" },
    el("div", { class: "t" }, m.title, el("span", { text: m.type })), el("div", { class: "d", text: m.description }), markdown(m.body)))
    : [el("div", { class: "h-note", text: "The model found nothing worth remembering." })];
  const m = r.kind === "skill" && /^---\n([\s\S]*?)\n---\n?/.exec(r.output);
  return m ? [el("pre", { class: "front", text: m[1] }), markdown(r.output.slice(m[0].length))] : [markdown(r.output)];
}
// What a record is as one file to copy or download: memories as their MEMORY.md lines, then each file.
const recText = (r) => r.kind !== "memory" ? r.output : (r.memories || []).length
  ? ["# MEMORY.md", ...r.memories.map((m) => `- [${m.title}](${m.name}.md) — ${m.description}`),
    ...r.memories.flatMap((m) => ["", `# ${m.name}.md`, "---", `name: ${JSON.stringify(m.name)}`, `description: ${JSON.stringify(m.description)}`,
      "metadata:", `  type: ${m.type}`, "---", "", m.body])].join("\n") + "\n" : "";
// Saving a record where a harness reads it (harness_kit's `saves`: those that have a place for its kind): which harness,
// where to (this directory's sessions, or every session), then what each file would get -- written only once the reader
// has seen it (history.py's plan and save).
const saveKind = (r) => r.kind === "claude" ? "agents" : r.kind;     // "claude": one made as a CLAUDE.md, before
const savers = (r) => Object.entries((state.home && state.home.harness_info) || {})
  .filter(([, h]) => h.saves && h.saves[saveKind(r)]).map(([n]) => n);
function recSave(r) {
  const sv = hist.saving;
  if (!sv || sv.id !== r.id) return null;
  const hs = savers(r);
  if (!hs.includes(sv.harness)) sv.harness = hs[0];
  const says = (harnessInfo(sv.harness) || {}).saves?.[saveKind(r)] || {};
  const info = selectedInfo() || {};
  const dirs = [...new Set([...(r.dirs || []), info.cwd].filter(Boolean))];
  const box = el("input", { type: "text", value: sv.dir, list: `dirs-${r.id}`, spellcheck: "false", "aria-label": "Directory",
    ...(sv.target === "user" ? { disabled: "" } : {}) });
  box.addEventListener("input", () => { sv.dir = box.value; sv.plan = null; sv.err = ""; });
  box.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); recPlan(r); } });
  const targets = [["dir", "A directory"], ...(says.user === true ? [["user", "All my projects"]] : [])];   // else a directory's
  const where = says.where || "";
  const p = sv.plan;
  return el("div", { class: "h-save" },
    hs.length > 1 ? el("div", { class: "row" }, histSwitch("For", hs.map((h) => [h, harnessName(h)]), sv.harness,
      (h) => { sv.harness = h; sv.plan = null; sv.err = ""; recPlan(r); })) : null,
    el("div", { class: "row" }, histSwitch("Save to", targets, sv.target, (t) => { sv.target = t; sv.plan = null; sv.err = ""; recPlan(r); }),
      el("span", { class: "where", text: sv.target !== "user" ? where   // for every directory: its folder, once a preview said it
        : `${(hist.homes || {})[sv.harness] ? `${hist.homes[sv.harness]}: ` : ""}${where.replace(" there", "")}` })),
    sv.target === "dir" ? el("div", { class: "row" }, box, el("datalist", { id: `dirs-${r.id}` }, ...dirs.map((d) => el("option", { value: d }))),
      el("button", { type: "button", onclick: () => recPlan(r) }, "Preview")) : null,
    ...(p ? [el("div", { class: "where", text: `For ${p.where}. ${plural(p.files.length, "file")} below. Nothing is written until you press Write.` }),
      ...(p.note ? [el("div", { class: "warnline", text: p.note })] : []),
      ...p.files.map((f, i) => el("details", { class: "file", id: `save-${r.id}-${i}` },
        el("summary", {}, el("span", { class: `a ${f.action}`, text: f.action === "append" ? "add to end" : f.action }), el("span", { class: "p", text: f.path })),
        el("pre", { text: f.text })))] : []),
    sv.err ? el("div", { class: "err", role: "alert", text: sv.err }) : null,
    sv.done ? el("div", { class: "ok", text: `Saved: ${sv.done.join(", ")}` }) : null,
    el("div", { class: "row" },
      p && !sv.done ? el("button", { type: "button", class: "primary", onclick: () => recWrite(r) },
        p.files.some((f) => f.action === "replace") ? "Replace and write" : `Write ${plural(p.files.length, "file")}`) : null,
      el("button", { type: "button", onclick: () => { hist.saving = null; hist.version++; histRedraw(); } }, sv.done ? "Close" : "Cancel")));
}
async function recPlan(r) {
  const sv = hist.saving;
  if (!sv || sv.id !== r.id) return;
  sv.err = ""; sv.done = null;
  try { sv.plan = await post("/api/history/save", { id: r.id, target: sv.target, dir: sv.dir, harness: sv.harness }); }
  catch (err) { sv.plan = null; sv.err = err.message; }
  if (sv.plan && sv.plan.home) hist.homes = { ...(hist.homes || {}), [sv.plan.harness]: sv.plan.home };
  hist.version++; histRedraw();
}
async function recWrite(r) {
  const sv = hist.saving;
  if (!sv || !sv.plan) return;
  try {
    const got = await post("/api/history/save", { id: r.id, target: sv.target, dir: sv.dir, harness: sv.harness, version: sv.plan.version });
    sv.done = got.saved; sv.err = "";
    await loadExtracts(r.gatherer);
  } catch (err) { sv.err = err.message; if (/changed since/.test(err.message)) sv.plan = null; }
  hist.version++; histRedraw();
}
function copyButton(text) {
  const b = el("button", { type: "button" }, "Copy");
  b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch (e) { b.textContent = "Not copied"; }
    setTimeout(() => { b.textContent = "Copy"; }, 1500);
  });
  return b;
}
function recCard(r) {
  const running = r.status === "running", now = Date.now() / 1000;
  const sv = hist.saving && hist.saving.id === r.id ? hist.saving : null;
  const sig = [r.status, r.output.length, r.error, r.model, (r.saved || []).length,
    sv ? signature([sv.harness, sv.target, sv.plan && sv.plan.version, sv.err, sv.done, sv.target === "dir" ? "" : (hist.homes || {})[sv.harness]]) : ""].join("|");
  return histRecs.get(r.id, sig, () => {
    const [, name, file] = HIST_KINDS[r.kind] || ["", r.kind, "extract.md"];
    const body = el("div", { class: "body" });
    if (running) body.append(el("div", { class: "working" }, el("span", { class: "spin", "aria-hidden": "true" }),
      `Asking ${r.model || "the Gatherer's model"}…`, el("span", { class: "ticking", "data-since": r.created, text: span(r.created, now) })));
    else if (r.status === "failed") body.append(el("div", { class: "fail", text: r.error || "The call failed." }));
    else body.append(...recContent(r));
    const done = r.status === "done";
    const savable = done && savers(r).length && !(r.kind === "memory" && !(r.memories || []).length);
    const acts = el("div", { class: "acts" },
      savable ? el("button", { type: "button", class: sv ? "" : "primary", title: `Save where ${savers(r).map(harnessName).join(" or ")} reads it. You'll preview each file first.`,
        onclick: () => {
          if (sv) { hist.saving = null; } else {
            const info = selectedInfo() || {};
            hist.saving = { id: r.id, harness: savers(r).includes(info.harness) ? info.harness : savers(r)[0], target: "dir",
              dir: (r.dirs || [])[0] || info.cwd || "", plan: null, err: "", done: null };
            setTimeout(() => recPlan(r));
          }
          hist.version++; histRedraw();
        } }, "Save to…") : null,
      done ? copyButton(recText(r)) : null,
      done ? el("button", { type: "button", title: `Download as ${file}`, onclick: () => saveFile(file, recText(r)) }, "Download") : null,
      el("button", { type: "button", title: "Reselect the history it was made from", onclick: () => {
        const sel = new Map();
        for (const [a, b] of r.rows) for (let x = a; x <= b; x++) { const e = hist.byId.get(`m:${x}`); sel.set(x, e ? [e.channel, e.tokens] : [r.channels[0], 0]); }
        hist.ask = r.ask || ""; const box = document.getElementById("hist-ask"); if (box) box.value = hist.ask;
        histSelect(sel);
      } }, "Select again"),
      r.status === "failed" ? el("button", { type: "button", onclick: () => histMake(r.kind, r) }, "Try again") : null,
      el("button", { type: "button", title: running ? "Stop and remove" : "Remove", onclick: () => histDelete(r) }, running ? "Stop" : "Delete"));
    const what = [plural(r.messages, "message"), plural(r.turns, "turn"), r.channels.length > 1 ? `${r.channels.length} actors` : null,
      r.model && !running ? r.model : null].filter(Boolean).join(" · ");
    return el("details", { class: "h-rec", id: `rec-${r.id}`, ...(r.id === hist.recOpen ? { open: "" } : {}) },
      el("summary", {},
        el("div", { class: "top" }, el("span", { class: `chip-k ${r.kind}`, text: name }),
          running ? statusEl("building", "Working") : r.status === "failed" ? statusEl("failed", "Failed") : null,
          el("span", { class: "when", text: clock(r.created, true) })),
        el("div", { class: "what", text: what }),
        r.ask ? el("div", { class: "ask", text: `“${r.ask}”` }) : null),
      body, acts, recSave(r),
      ...(r.saved || []).map((x) => el("div", { class: "saved" }, el("b", { text: "Saved " }), `${clock(x.at, true)} · ${x.paths.join(", ")}`)));
  });
}
// The panel at the right: its room kept empty until something is selected, then what can be done with it, and the
// HIST_RECENT artifacts the Gatherer made last (the rest a click away). It stays while a result it asked for shows,
// until closed.
const HIST_RECENT = 3;
function histSide(h) {
  const list = hist.recs.gatherer === h.gatherer ? hist.recs.list.filter((r) => (r.channels || []).includes(h.channel)) : [];   // this actor's
  histRecs.begin(h.gatherer);
  if (!hist.panel) return el("div", { class: "h-side closed", "aria-hidden": "true" });
  const side = el("div", { class: "h-side open", "data-keep": "hist-side", "data-morph": "", role: "complementary", "aria-label": "Selected history" });
  const shown = hist.allRecs ? list : list.slice(0, HIST_RECENT);
  side.kids = [histActions(), ...(list.length ? [el("div", { class: "h-side-h", text: "Recent artifacts" })] : []), ...shown.map(recCard),
    list.length > HIST_RECENT ? el("button", { type: "button", class: "h-older", onclick: () => { hist.allRecs = !hist.allRecs; hist.version++; histRedraw(); } },
      hist.allRecs ? "Show fewer" : `Show ${list.length - HIST_RECENT} older`) : null].filter(Boolean);
  return side;
}
function histRender() {
  const h = state.hist;
  if (!h || h.key !== histKey() || !h.loaded) return el("div", { class: "h-note", text: "Loading…" });
  // another group's: its messages are other rows (row ids are a group's database's), so none picked, opened or read yet
  if (hist.selFor !== h.gatherer) {
    hist.sel = new Map(); hist.selFor = h.gatherer; hist.last = null; hist.panel = false;
    hist.open = new Set(); hist.full = new Map();
  }
  const tree = histTree(h);
  const hasTasks = h.tasks.length > 0;
  if (hist.hadTasks && hist.hadTasks.key === h.key && !hist.hadTasks.had && hasTasks) {
    // tasks come in while the reader looks: the list stays as it is, and Group by tasks pulses a few times
    hist.flash = { key: h.key, until: Date.now() + 2600 };
    if (hist.group === null) hist.stay = { key: h.key };
    setTimeout(() => { hist.version++; histRedraw(); }, 2700);
  }
  hist.hadTasks = { key: h.key, had: hasTasks };
  const grouped = hasTasks && (hist.group ?? !(hist.stay && hist.stay.key === h.key));
  const vis = h.error ? [] : histVisible(tree, grouped);
  hist.flat = vis.map(([n, , head]) => n.id + (head ? "/h" : ""));
  histRows.begin(signature([h.key, [...histTypes]]));
  const shown = vis.slice(0, hist.limit);
  const list = el("div", { class: "h-list", "data-keep": `hist-list:${h.key}`, "data-morph": "" });
  const q = hist.q.trim();
  list.kids = h.error ? [el("div", { class: "h-note", text: h.error })]
    : !h.events.length ? [el("div", { class: "h-note", text: "No history yet." })]
    : hist.hits && !vis.length ? [el("div", { class: "h-note", text: `Nothing in this history matches “${q}”.` })]
    : [...shown.map(([n, depth, head]) => histRow(n, depth, head)),
      vis.length > shown.length ? el("button", { type: "button", class: "h-more", onclick: () => { hist.limit += HIST_SHOWN; hist.version++; histRedraw(); } },
        `Show ${full(Math.min(HIST_SHOWN, vis.length - shown.length))} more of ${full(vis.length - shown.length)}`) : null,
      h.more ? el("button", { type: "button", class: "h-more", onclick: async () => { await loadOutline(); histRedraw(); } }, "Load more") : null].filter(Boolean);
  const left = el("div", { class: "h-left", "data-morph": "" }, histBar(h, grouped, hasTasks), list);
  return el("div", { class: "h-grid", "data-morph": "" }, left, histSide(h));
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start() {
  HIST_KINDS.claude = ["", "CLAUDE.md", "CLAUDE.md"];      // one made before AGENTS.md: shown, not offered
  CHAT_FEEDS.outline = {
    load: loadOutline,
    data: () => state.hist && state.hist.key === histKey() ? { items: state.hist.events, pending: [], earlier: false } : null,
    signature: () => [state.hist && state.hist.key, state.hist && state.hist.version, hist.version],
  };
  document.addEventListener("mousedown", (ev) => {
    const list = ev.button === 0 && ev.target.closest && ev.target.closest(".hist .h-list");
    if (!list) return;
    const row = ev.target.closest(".h-row");
    if (!row) { if (!ev.target.closest("button, a") && hist.sel.size) histSelect(new Map()); return; }   // below the rows
    if (ev.target.closest(".h-tw, .h-full, a, button")) return;     // its twisty; its whole text, to select words in
    ev.preventDefault();                                             // no text selected as the rows are
    const k = row.dataset.key, add = ev.metaKey || ev.ctrlKey, extend = ev.shiftKey && hist.flat.includes(hist.last);
    histDrag = { from: k, anchor: extend ? hist.last : k, base: add || extend ? new Map(hist.sel) : new Map(), at: null, moved: false,
      add, extend, wasOn: row.classList.contains("on"), x: ev.clientX, y: ev.clientY };
    if (!(add && histDrag.wasOn)) histDragTo(k);                     // a ⌘-click on a selected row: taken out, on release
    requestAnimationFrame(histScrollWhileDragging);
  });
  document.addEventListener("mousemove", (ev) => {
    if (!histDrag) return;
    histDrag.x = ev.clientX; histDrag.y = ev.clientY;
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const row = under && under.closest && under.closest(".hist .h-list .h-row");
    if (row) histDragTo(row.dataset.key);
  });
  document.addEventListener("mouseup", () => {
    const d = histDrag;
    if (!d) return;
    histDrag = null;
    if (d.add && d.wasOn && !d.moved) {                              // ⌘-click on a selected row: out of the selection
      const n = histNode(d.from), sel = new Map(hist.sel);
      if (n) for (const r of n.rows) sel.delete(r);
      hist.sel = sel;
    }
    if (!d.extend) hist.last = d.from;
    histSelect(hist.sel);
  });
  document.addEventListener("dblclick", (ev) => {
    const row = ev.target.closest && ev.target.closest(".hist .h-list .h-row");
    if (row && !ev.target.closest(".h-tw, .h-full, a, button")) histOpen(row.dataset.key.replace(/\/h$/, ""), row.dataset.key.endsWith("/h"));
  });
  document.addEventListener("keydown", (ev) => {
    if (chatView().id !== "history" || (ev.target && ev.target.closest && ev.target.closest("input, textarea, select, [contenteditable]"))) return;
    if (ev.key === "Escape" && hist.sel.size) { ev.preventDefault(); histSelect(new Map()); }
    else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "a" && hist.tops.length) { ev.preventDefault(); histSelect(histWith(hist.tops, new Map())); }
  });
  document.addEventListener("click", (ev) => {                 // the types' menu closes on a click elsewhere
    const menu = document.getElementById("hist-types");
    if (menu && menu.open && !menu.contains(ev.target)) menu.open = false;
  });
  if (!SNAPSHOT) addChatView({
    id: "history", name: "History", feed: "outline", frame: "hist", chat: false, icon: ICONS.history,
    description: "Search, export and summarize the history",
    render: histRender,
  });
}

export { enc, hist };
