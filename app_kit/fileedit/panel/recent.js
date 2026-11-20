// ------------------------------------------------------------------ what actors changed lately, and who they are
// Both apps' (the Files app's, the LaTeX editor's). The window, `ed.window` -- the last 10 min, 30 min, 1 h or 4 h,
// picked over the tree (edWindowPick) and kept in this browser for this instance -- is what "lately" means everywhere
// in the panel: the tree's avatars on a file and its folders (the listing's writers since then), the header's, the
// lines marked in the file, and the Changes list beside it.
//
// The lines: each actor that changed the file open in the window (the listing's writers), its changes to it as ag
// recorded them (/api/files/changes: an Edit's, a Write's, a patch's new lines), each found in the file as it is now and
// marked -- a bar in the actor's hue, its avatar after the first line, who and when on hover. A change made by a shell
// command has no recorded lines (only its avatar on the file); lines changed again since are not found; deleted lines
// show only in the Changes list. An avatar pressed, anywhere, opens its actor (edShowActor) as its row in the list does.
import { agApp, ago, changedCount, el, fileBlock, firstLine, get, kindMark, langOfPath, state } from "./page.js";
import { ed, edAvatar, edDir, edEntry, edHead, edKey, edList, edRel, edSelectText, edTilde,
  edWhoColor, edWriterName, edWriters } from "./editor.js";
import { edTree } from "./editor-tree.js";
import { edNote } from "./editor-open.js";

const ED_WINDOWS = [[600, "10 min"], [1800, "30 min"], [3600, "1 hour"], [14400, "4 hours"]];   // (said "the last …")
const ED_WINDOW_KEY = "ag-editor-window", ED_WINDOW_DEFAULT = 1800;
const edWindowKey = () => `${ED_WINDOW_KEY}:${(agApp && agApp.instance) || ""}`;
// Its state, as the panel starts (start.js's edStart): the window, until the one picked is read (edWindowLoad, as the
// panel is drawn), and the file open's changes, none yet.
export function edRecentStart() {
  ed.window = ED_WINDOW_DEFAULT;
  ed.recent = null;                                // {path, sig, items: [{w, x}], err, loading}: the file open's
}
export const edWindowSaid = () => (ED_WINDOWS.find((x) => x[0] === ed.window) || [0, `${Math.round(ed.window / 60)} min`])[1];
export function edWindowLoad() {
  let got = NaN;
  try { got = Number(localStorage.getItem(edWindowKey())); } catch (e) { /* this page only */ }
  ed.window = ED_WINDOWS.some((x) => x[0] === got) ? got : ED_WINDOW_DEFAULT;
}
function edWindowSet(secs) {
  ed.window = secs;
  try { localStorage.setItem(edWindowKey(), String(secs)); } catch (e) { /* this page only */ }
  ed.treeSig = "";
  const dirs = new Set([ed.root, ...ed.open, ...(ed.file ? [edDir(ed.file)] : [])].filter(Boolean));
  Promise.all([...dirs].map((d) => edList(d, false))).then(() => { edTree(); edHead(); edRecentFetch(true); });
}
// The picker, over the tree: "Changes: last 30 min ▾".
export function edWindowPick() {
  const sel = el("select", { "aria-label": "Show actors' changes from the last", onchange: (ev) => edWindowSet(Number(ev.target.value)) },
    ...ED_WINDOWS.map(([v, said]) => el("option", { value: String(v), selected: v === ed.window ? "" : null, text: `last ${said}` })));
  return el("label", { class: "ed-window", title: "Which actors' changes the tree, the file and its header show" },
    el("span", { class: "lbl", text: "Changes:" }), sel);
}
export const edSince = () => Math.floor(Date.now() / 1000 - ed.window);

// An actor (a writer's), opened as its row in the dashboard's list opens it: in its tab. One of another group: said.
export function edShowActor(w) {
  if (!agApp || !w) return;
  if (w.gatherer !== agApp.gatherer) { edNote(`${edWriterName(w)} is in the group ${w.gatherer}`); return; }
  Promise.resolve(agApp.actors.show(w.channel)).catch((e) => edNote(`Couldn't open it: ${e.message}`, true));
}
// An avatar that opens its actor: in the tree, the header, the file's lines, the Changes list.
export function edAvatarButton(w, cls = "ed-av") {
  return el("button", { type: "button", class: cls, "aria-label": `Open ${edWriterName(w)}`,
    title: `${edWriterName(w)}${w.closed ? " (closed)" : ""}, ${ago(w.at)} · click to open it`,
    onmousedown: (ev) => ev.stopPropagation(),
    onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); edShowActor(w); } }, edAvatar(w));
}

// The changes of the file open, in the window: fetched again when its writers change (each tick, edTick), the window
// does, or `force` (the file read again from disk, the Changes list opened).
export async function edRecentFetch(force = false) {
  const s = ed.s, path = ed.file;
  if (!s || !path || s.path !== path) { if (ed.recent) { ed.recent = null; edDrawChanges(); } return; }
  const since = edSince();
  const writers = edWriters(edEntry(path)).filter((w) => w.at >= since);
  const sig = JSON.stringify([path, ed.window, writers.map((w) => [edKey(w), w.at])]);
  if (!force && ed.recent && ed.recent.sig === sig) return;
  const was = ed.recent && ed.recent.path === path ? ed.recent.items : [];
  const r = ed.recent = { path, sig, items: was, err: "", loading: true };
  const got = await Promise.all(writers.map(async (w) => {
    const q = new URLSearchParams({ gatherer: w.gatherer, channel: w.channel, path, since: String(since),
      cwd: (w.actor && w.actor.cwd) || "" });
    try {
      const x = await get(`/api/files/changes?${q}`);
      if (x.error) throw new Error(x.error);
      return (x.changes || []).map((c) => ({ w, x: c }));
    } catch (e) { r.err = e.message; return []; }
  }));
  if (ed.recent !== r) return;
  r.items = got.flat(); r.loading = false;
  if (ed.s && ed.s.path === path) edRecentMarks(ed.s);
  edDrawChanges();
}
// The text a change left in the file: a diff's new lines, a Write's whole text (its lines as recorded).
const edChangeText = (b) => b.t === "diff" ? (b.new || []).join("\n") : b.t === "write" ? (b.lines || []).join("\n") : "";
// The lines of the file each change is found on now, marked: the latest change's actor on a line it shares with another.
export function edRecentMarks(s) {
  const v = s.view;
  if (!v || !s.recent) return;
  const r = ed.recent && ed.recent.path === s.path ? ed.recent : null;
  const A = s.A, doc = v.state.doc, text = doc.toString(), found = [];
  for (const it of (r ? r.items : [])) {
    for (const b of it.x.blocks || []) {
      const t = edChangeText(b);
      if (!t.trim()) continue;
      const i = text.indexOf(t);
      if (i >= 0) found.push({ from: i, to: i + t.length, w: it.w, at: it.x.at || it.w.at });
    }
  }
  found.sort((a, b) => a.at - b.at);
  const lines = new Map();                           // a line's start -> {w, at, first}
  for (const f of found) {
    const first = doc.lineAt(f.from).number, last = doc.lineAt(Math.max(f.from, f.to - 1)).number;
    for (let n = first; n <= last && lines.size < 20000; n++) lines.set(doc.line(n).from, { w: f.w, at: f.at, first: n === first });
  }
  const sig = JSON.stringify([...lines].map(([at, m]) => [at, edKey(m.w), m.at, m.first]));
  if (sig === s.recent.sig) return;
  s.recent.sig = sig;
  const out = [];
  for (const [at, m] of lines) {
    const color = edWhoColor(m.w.actor) || "var(--axis)";
    out.push(A.Decoration.line({ class: "ed-recent", attributes: { style: `--who: ${color}`,
      title: `Changed by ${edWriterName(m.w)}, ${ago(m.at)}` } }).range(at));
    if (m.first) out.push(A.Decoration.widget({ widget: new (edRecentAvatar(A))(m.w), side: 1 }).range(doc.lineAt(at).to));
  }
  v.dispatch({ effects: s.recent.set.of(A.Decoration.set(out, true)) });
}
// The avatar after the first line of an actor's change: pressed, its actor opened.
let EdRecentAv = null;
function edRecentAvatar(A) {
  return EdRecentAv ||= class extends A.WidgetType {
    constructor(w) { super(); this.w = w; }
    eq(o) { return edKey(o.w) === edKey(this.w) && o.w.at === this.w.at; }
    toDOM() { return edAvatarButton(this.w, "ed-recent-av"); }
    ignoreEvent() { return true; }
  };
}

// The Changes list, beside the file (ed.side): what the actors that changed it in the window changed in it, the latest
// first -- each as the Chat view shows a file's change (fileBlock), with its actor's avatar (pressed: opened) and what it
// was asked; one whose new lines are in the file now has "Show", which selects them there. Opened by the header's
// Changes, closed by it again, the list's ×, or another file opened.
export function edChanges() {
  if (ed.changes) return edChangesClose();
  ed.changes = { path: ed.file };
  edDrawChanges(); edHead(); edRecentFetch(true);
}
function edChangesClose() { ed.changes = null; edDrawChanges(); edHead(); }
export function edDrawChanges() {
  const side = ed.side, c = ed.changes;
  if (!side) return;
  if (!c || c.path !== ed.file) {
    ed.changes = null;
    if (!side.hidden) { side.hidden = true; side.replaceChildren(); }
    return;
  }
  side.hidden = false;
  const r = ed.recent && ed.recent.path === ed.file ? ed.recent : null;
  const list = r ? [...r.items].sort((a, b) => (b.x.at || 0) - (a.x.at || 0)) : [];
  const doc = ed.s && ed.s.view ? ed.s.view.state.doc.toString() : "";
  side.replaceChildren(
    el("div", { class: "ed-ch-h" },
      el("span", { class: "t", title: `Actors' changes to ${edRel(c.path)} in the last ${edWindowSaid()}` },
        el("b", { text: "Changes" }), ` · last ${edWindowSaid()}`),
      el("button", { type: "button", class: "ed-ch-x", title: "Close", "aria-label": "Close the changes", onclick: edChangesClose }, "×")),
    ...(!r || (r.loading && !list.length) ? [el("div", { class: "none", text: "Loading…" })]
      : !list.length ? [el("div", { class: "none", text: r.err || `No recorded changes to this file in the last ${edWindowSaid()}.` })]
      : list.map((it) => edChangeView(it.x, doc, it.w))));
}
function edChangeView(x, doc, w) {
  const code = el("div", { class: "code" });
  for (const b of x.blocks) code.append(...fileBlock(b, langOfPath(ed.file)));
  const there = x.blocks.map(edChangeText).find((t) => t.trim() && doc.includes(t));
  return el("details", { class: "fv-call" + (x.error ? " err" : ""), open: "" },
    el("summary", {}, el("span", { class: "tw", text: "▸" }),
      w ? edAvatarButton(w, "ed-ch-av") : null,
      el("span", { class: "kinds" }, ...x.kinds.map((k) => kindMark(k, 12))),
      el("span", { class: "via", text: firstLine(x.via, 160) }), changedCount(x.changed),
      el("span", { class: "what", text: x.at ? ago(x.at) : "" }),
      there ? el("button", { type: "button", class: "ed-ch-go", title: "Select these lines in the file",
        onclick: (ev) => { ev.preventDefault(); edSelectText(there); } }, "Show") : null),
    x.asked ? el("div", { class: "asked", title: x.asked, text: `${w ? `${edWriterName(w)} was asked` : "Asked"}: ${firstLine(x.asked, 200)}` }) : null,
    code);
}

// ---- an actor started on a file or folder of the tree (its menu's "Start an actor here…")
// A box over the tree: the harness to start (each this dashboard can start here), and what to do -- for a file, its
// path put in first, for the reader to keep or change. ↵ starts it in the folder (the file's), with what they wrote as
// its first message (ag.actors.start, capability message_actors), and opens it.
export function edStartOpen(path, dir, x, y) {
  edStartClose();
  const harnesses = (state.home && state.home.harnesses) || [];
  if (!agApp || !harnesses.length) { edNote("No harness can start an actor here.", true); return; }
  const folder = dir ? path : edDir(path);
  const ask = el("textarea", { class: "ed-send-ask", rows: "3", "aria-label": "What the new actor should do",
    placeholder: "What should it do?" });
  if (!dir) ask.value = `${path}\n\n`;
  let on = 0;
  const pick = el("div", { class: "ed-start-hs", role: "radiogroup", "aria-label": "Harness" });
  const drawPick = () => pick.replaceChildren(...harnesses.map((h, i) => el("button", { type: "button", role: "radio",
    class: "ed-start-h" + (i === on ? " on" : ""), "aria-checked": String(i === on), onmousedown: (ev) => ev.preventDefault(),
    onclick: () => { on = i; drawPick(); ask.focus(); } }, h.label)));
  drawPick();
  const go = el("button", { type: "button", class: "primary", onclick: () => edStartGo() }, "Start");
  const box = el("div", { class: "ed-sendpop ed-startpop", role: "dialog", "aria-label": "Start an actor here" },
    el("div", { class: "ed-send-hd", title: folder, text: `Start an actor in ${edTilde(folder)}` }),
    pick, ask, el("div", { class: "ed-start-ft" }, el("span", { class: "ed-send-ft", text: "↵ start · ⇧↵ new line · Esc close" }), go));
  const p = ed.starting = { box, ask, folder, harness: () => harnesses[on].name, off: null };
  ask.addEventListener("keydown", (ev) => {
    if (ev.isComposing) return;
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); edStartGo(); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); edStartClose(); }
  });
  ask.addEventListener("input", () => ask.classList.remove("bad"));
  const outside = (ev) => { if (!box.contains(ev.target)) edStartClose(); };
  document.addEventListener("pointerdown", outside, true);
  p.off = () => document.removeEventListener("pointerdown", outside, true);
  document.body.append(box);
  const w = Math.min(420, window.innerWidth - 16), h = box.offsetHeight;
  box.style.width = `${w}px`;
  box.style.left = `${Math.round(Math.max(8, Math.min(x, window.innerWidth - w - 8)))}px`;
  box.style.top = `${Math.round(Math.max(8, Math.min(y, window.innerHeight - h - 8)))}px`;
  ask.focus();
  ask.setSelectionRange(ask.value.length, ask.value.length);
}
function edStartClose() {
  const p = ed.starting;
  if (!p) return;
  ed.starting = null;
  p.off();
  p.box.remove();
}
async function edStartGo() {
  const p = ed.starting;
  if (!p) return;
  const text = p.ask.value.trim();
  if (!text) { p.ask.classList.add("bad"); p.ask.placeholder = "Say what it should do first."; p.ask.focus(); return; }
  const harness = p.harness(), folder = p.folder;
  edStartClose();
  try {
    const got = await agApp.actors.start({ harness, folder, text });
    edNote(`Started an actor in ${edTilde(folder)}`);
    if (got && got.channel) await agApp.actors.show(got.channel);
  } catch (e) {
    edNote(`Not started: ${e.message}`, true);
  }
}
