// ------------------------------------------------------------------ the Editor
// The Editor app's panel (ag_apps/editor/), above the actors' panes in the dashboard's top row, moved from the
// dashboard's own page (frontend/src/legacy/18-editor.js) as it was: what changed is how it reaches the rest -- its
// backend's routes on the app's own origin (the dashboard's routes before), the actors through the SDK (page.js),
// and the project's preview beside the file its own (preview.js), not another app's. A folder's tree, any folder -- an actor's, or one typed, or the one above -- and its files to
// edit (the host's, app_kit.docs): each file shared live by every page that has it open -- their edits and cursors shown as they
// type -- and the file on disk one more of its editors, so what an actor writes to it lands in the editor as it is
// written, around what was typed and not saved, marked in that actor's hue until the next change on disk -- but for
// the conflict zone: the lines edited here since the file was opened, tinted, which an actor's change is asked about
// (Restore yours / Accept its rewrite / Keep both / Edit: its lines edited in the box first, edBox), not merged into,
// until the zone is cleared (its button in the header) or the file closed. Who changed each file, of the
// actors, is what ag's hook found each tool call did on disk (the listing's `writers`): two or more changing one file
// are said in the tree and over the file. Saved by Save (or ⌘S / Ctrl+S): until then the file on disk, which the
// actors read, is as it was -- or, with Auto-save on (as it is unless the reader turns it off, kept in this browser), a moment after each
// edit. The editor (CodeMirror and Yjs, vendor/editor.js) is loaded the first time a file opens. A file that is not text --
// an image, a PDF, a sound, a video, anything else -- is shown in its place, not edited (18-editor-view.js).
const ED_TICK = 2500;            // ms between looks at the open folders (and the header's "Ns ago")
const ED_SEND = 40;              // ms the edits of a burst of keys are gathered before they are sent
const ED_CREDIT = [3, 20];       // s an actor's recorded change may come before, and after, a change seen on disk, to be its
const ED_AUTO_MS = 1000;         // ms after the last edit to a file that Auto-save saves it
const ED_NAME_KEY = "ag-editor-name", ED_COLOR_KEY = "ag-editor-color", ED_ROOT_KEY = "ag-editor-folder", ED_AUTO_KEY = "ag-editor-autosave";
const ED_WRAP_KEY = "ag-editor-wrap", ED_FILE_KEY = "ag-editor-file";
const ED_KEEP_AT_MS = 250;       // ms after the cursor or the scroll last moved that the open file's place is kept
const ED_LEFT_MS = 1000;         // ms from the panel losing the keys to its going, still left while typing (edHadKeys)
const ED_SHOWN_KEY = "ag-dashboard-editor", ED_HEIGHT_KEY = "ag-dashboard-editor-height";
const ed = { root: "", home: "", lists: new Map(), open: new Set(), file: null, s: null, lib: null, me: null, user: "", err: "",
  timer: null, treeSig: "", barSig: "", host: null, bar: null, tree: null, head: null, body: null, side: null, changes: null,
  v: null, turn: 0, keys: false, blurAt: -Infinity,                                 // v: 18-editor-view.js's; keys, blurAt: edHadKeys's
  branches: [], brSig: "", brs: null, brOpen: null,
  nav: null, fold: null, cursor: null, revealing: null, newItem: null, pick: null, menu: null, find: null,   // 18-editor-tree.js's
  choose: null, choosing: null, go: null,                                                                     // 18-editor-open.js's
  mode: "live",                                                                     // how an agent's change lands (edModePick)
  problems: new Map(), problemsAt: 0,                                               // a LaTeX build's, by file (edProblems)
  auto: (() => { try { return localStorage.getItem(ED_AUTO_KEY) !== "0"; } catch (e) { return true; } })(),   // on unless turned off
  wrap: (() => { try { return localStorage.getItem(ED_WRAP_KEY) !== "0"; } catch (e) { return true; } })() };  // long lines wrapped: likewise
const edB64 = (u8) => { let t = ""; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(t); };
const edBytes = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const edJoin = (dir, name) => (dir === "/" ? "/" : dir + "/") + name;
const edUnder = (p, dir) => dir === "/" ? p.startsWith("/") : p === dir || p.startsWith(dir + "/");
const edDir = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
const edBase = (p) => p.slice(p.lastIndexOf("/") + 1);
const edTilde = (p) => tildePath(p, ed.home);
const edRel = (p) => ed.root && ed.root !== "/" && p.startsWith(ed.root + "/") ? p.slice(ed.root.length + 1) : edTilde(p);
function edLib() {
  return ed.lib ||= new Promise((ok, no) => {
    const tag = document.createElement("script");
    tag.src = "vendor/editor.js";
    tag.onload = () => window.agEditor ? ok(window.agEditor) : no(new Error("The editor did not load."));
    tag.onerror = () => { ed.lib = null; tag.remove(); no(new Error("The editor did not load: is the dashboard still running?")); };
    document.head.append(tag);
  });
}
// Who this page is to the others with a file open: a name (the login, until the reader gives another, kept in this
// browser) and a colour of this tab's own.
function edMe() {
  if (ed.me) return ed.me;
  let name = "", color = "";
  try { name = localStorage.getItem(ED_NAME_KEY) || ""; color = sessionStorage.getItem(ED_COLOR_KEY) || ""; } catch (e) { /* this page only */ }
  if (!color) {
    const hues = Object.values(HUE_MAIN);
    color = hues[Math.floor(Math.random() * hues.length)];
    try { sessionStorage.setItem(ED_COLOR_KEY, color); } catch (e) { /* this page only */ }
  }
  return ed.me = { name: name || ed.user || "Someone", color, colorLight: color + "40" };
}
function edRename() {
  const name = (prompt("Your name, as the others with a file open see it", edMe().name) || "").trim();
  if (!name) return;
  try { localStorage.setItem(ED_NAME_KEY, name); } catch (e) { /* this page only */ }
  ed.me = { ...edMe(), name };
  if (ed.s) ed.s.awareness.setLocalStateField("user", ed.me);
  edHead();
}

// The actors: as the list has them (their names, avatars, hues), by gatherer and channel.
function edActor(g, c) {
  const gat = ((state.home && state.home.gatherers) || []).find((x) => x.name === g);
  return gat ? gat.agents.find((a) => a.channel === c) || null : null;
}
const edWhoName = (a) => {                           // its name; without one, its first message, quoted
  if (a.name && a.name.text) return a.name.text;
  const said = firstLine(a.last_user_message || "");
  return said ? `“${said.length > 40 ? said.slice(0, 40).trimEnd() + "…" : said}”` : a.channel.slice(0, 8);
};
const edWhoColor = (a) => (a && HUE_MAIN[a.avatar_hue]) || null;
// Until ag's hook has recorded who changed the file (a moment after), whose a change seen on disk likely is: the one
// actor running in a directory that holds the file, if just one is.
function edWho(path) {
  const found = [];
  for (const g of (state.home && state.home.gatherers) || [])
    for (const a of g.agents)
      if (a.cwd && edUnder(path, a.cwd.replace(/\/$/, "")) && statusOf(a)[0] === "running") found.push(a);
  return found.length === 1 ? found[0] : null;
}
// A file's writers (the listing's: [{gatherer, channel, at, how}], the latest first), one per actor, each with its actor.
const edWriters = (entry) => {
  const seen = new Set(), out = [];
  for (const w of (entry && entry.writers) || []) {
    const k = w.gatherer + "\u0000" + w.channel;
    if (!seen.has(k)) { seen.add(k); out.push({ ...w, actor: edActor(w.gatherer, w.channel) }); }
  }
  return out;
};
const edWriterName = (w) => w.actor ? edWhoName(w.actor) : w.channel.slice(0, 8);
// The writers the tree shows: not a closed actor (one not saved for later), unless a change of its there still waits
// for the reader (the listing's `waiting`: its branch's, a proposal, a conflict not settled) -- then marked `closed`.
const edClosed = (a) => !!a && statusOf(a)[0] === "closed" && !a.saved;
const edTreeWriters = (entry, writers) => {
  const waits = new Set(((entry && entry.waiting) || []).map((w) => w.gatherer + "\u0000" + w.channel));
  return writers.filter((w) => !edClosed(w.actor) || waits.has(w.gatherer + "\u0000" + w.channel))
    .map((w) => edClosed(w.actor) ? { ...w, closed: true } : w);
};
const edAvatar = (w) => w.actor && w.actor.avatar
  ? el("img", { src: avatarSrc(w.actor.avatar), alt: "", draggable: "false" })
  : el("span", { class: "ed-noav", style: `--who: ${edWhoColor(w.actor) || "var(--axis)"}` });
// An actor's changes to the file open, in the last ED_CHANGES_S, beside it (ed.side): opened by its avatar in the
// header, closed by it again or the panel's ×, or another file opened. Each change as the Chat view shows a file's
// (fileBlock), the latest first, under what the actor was asked; one whose new lines are in the file now has "Show",
// which selects them there. Fetched again when the actor changes the file again (edHead).
const ED_CHANGES_S = 600;
const edKey = (w) => `${w.gatherer}\u0000${w.channel}`;
function edChanges(w) {
  if (ed.changes && ed.changes.k === edKey(w) && ed.changes.path === ed.file) return edChangesClose();
  ed.changes = { k: edKey(w), w, path: ed.file, got: null, err: "", seen: w.at };
  edDrawChanges(); edHead(); edFetchChanges();
}
function edChangesClose() { ed.changes = null; edDrawChanges(); edHead(); }
async function edFetchChanges() {
  const c = ed.changes;
  if (!c) return;
  const q = new URLSearchParams({ gatherer: c.w.gatherer, channel: c.w.channel, path: c.path,
    since: String(Math.floor(Date.now() / 1000 - ED_CHANGES_S)), cwd: (c.w.actor && c.w.actor.cwd) || "" });
  let got = null, err = "";
  try { got = await get(`/api/files/changes?${q}`); err = got.error || ""; } catch (e) { err = e.message; }
  if (ed.changes !== c) return;
  c.got = got; c.err = err;
  edDrawChanges();
}
function edDrawChanges() {
  const side = ed.side, c = ed.changes;
  if (!side) return;
  if (!c || c.path !== ed.file) {
    ed.changes = null;
    if (!side.hidden) { side.hidden = true; side.replaceChildren(); }
    return;
  }
  side.hidden = false;
  const name = edWriterName(c.w), mins = `${ED_CHANGES_S / 60} minutes`;
  const list = c.got && !c.err ? [...(c.got.changes || [])].reverse() : [];
  const doc = ed.s && ed.s.view ? ed.s.view.state.doc.toString() : "";
  side.replaceChildren(
    el("div", { class: "ed-ch-h" }, el("span", { class: "ed-avs" }, edAvatar(c.w)),
      el("span", { class: "t", title: `${name}'s changes to ${edRel(c.path)} in the last ${mins}` }, el("b", { text: name }), ` · changes in the last ${mins}`),
      el("button", { type: "button", class: "ed-ch-x", title: "Close", "aria-label": "Close the changes", onclick: edChangesClose }, "×")),
    ...(c.err ? [el("div", { class: "none", text: c.err })] : !c.got ? [el("div", { class: "none", text: "Loading…" })]
      : !list.length ? [el("div", { class: "none", text: `No changes to this file in the last ${mins}.` })]
      : list.map((x) => edChangeView(x, doc))));
}
function edChangeView(x, doc) {
  const code = el("div", { class: "code" });
  for (const b of x.blocks) code.append(...fileBlock(b, langOfPath(ed.file)));
  const there = x.blocks.filter((b) => b.t === "diff" && b.new.length).map((b) => b.new.join("\n")).find((t) => doc.includes(t));
  return el("details", { class: "fv-call" + (x.error ? " err" : ""), open: "" },
    el("summary", {}, el("span", { class: "tw", text: "▸" }),
      el("span", { class: "kinds" }, ...x.kinds.map((k) => kindMark(k, 12))),
      el("span", { class: "via", text: firstLine(x.via, 160) }), changedCount(x.changed),
      el("span", { class: "what", text: x.at ? ago(x.at) : "" }),
      there ? el("button", { type: "button", class: "ed-ch-go", title: "Select these lines in the file",
        onclick: (ev) => { ev.preventDefault(); edSelectText(there); } }, "Show") : null),
    x.asked ? el("div", { class: "asked", title: x.asked, text: `Asked: ${firstLine(x.asked, 200)}` }) : null,
    code);
}
function edSelectText(text) {
  const s = ed.s, v = s && s.view, i = v ? v.state.doc.toString().indexOf(text) : -1;
  if (i < 0) return;
  v.dispatch({ selection: { anchor: i, head: i + text.length }, effects: s.A.EditorView.scrollIntoView(i, { y: "center" }) });
  v.focus();
}
// The project's preview is the Editor's own (preview.js), beside the file: Execute (⌘↵) runs it for the file open, else
// the folder shown (pvRun); → PDF, or a double-click in a TeX source, shows that place in what it built (pvLocate). A
// place in a PDF's source it sends back the Editor opens (edShowFile).
const pvPath = () => ed.file || ed.root;
const edRuns = () => true;
// ⌘↵ (Ctrl+Enter elsewhere) anywhere in the Editor -- the file, its tree, its header, a PDF's viewer: Execute. Taken
// before CodeMirror's own (a blank line below); a text box keeps its own Enter.
function edExecKey(ev) {
  if (ev.key !== "Enter" || !(MAC ? ev.metaKey : ev.ctrlKey) || ev.shiftKey || ev.altKey || ev.isComposing) return;
  const t = ev.target;
  if (t && t.closest && t.closest("input, textarea, select")) return;
  ev.preventDefault(); ev.stopPropagation();
  if (!ev.repeat) edExecute();                       // held down: once
}
// Execute: the file saved first (as it is here), then its project's preview run, beside it.
async function edExecute() {
  const path = pvPath();
  if (!path || !edRuns()) return;
  const s = ed.s;
  if (s && s.state && s.state.dirty && !s.state.missing && !edDiskConflicts(s).length) await edSave(s);
  try { await pvRun({ path, ...(ed.file ? { file: ed.file } : {}) }); }
  catch (e) { paneNote(e.message); }
}
// A line of the file open in the Editor (once it is: just opened, its document comes a moment later), selected and shown.
async function edGoLine(path, line) {
  for (let i = 0; i < 80 && !(ed.s && ed.s.path === path && ed.s.view); i++) await new Promise((r) => setTimeout(r, 100));
  const s = ed.s;
  if (!s || s.path !== path || !s.view) return;
  const doc = s.view.state.doc, l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  s.view.dispatch({ selection: { anchor: l.from, head: l.to }, effects: s.A.EditorView.scrollIntoView(l.from, { y: "center" }) });
  s.view.focus();
}
// A file opened in the Editor, at a line: an `open-file` the page asks of it, or a place in a PDF's source. A file
// outside the folder shown: its folder shown.
async function edShowFile(path, line) {
  if (!ed.root || !edUnder(path, ed.root)) edGo(edDir(path));
  if (!ed.s || ed.s.path !== path) edOpen(path);
  if (line) edGoLine(path, line);
}
// A LaTeX build's problems (preview.js, from its log), each file's marked on its lines when it is open -- whichever
// file of the document it is: a marker in the gutter, the place underlined (an undefined macro, a label: itself; else
// the line's text), the message on hover over either, the lines of errors and warnings tinted. Moved with the edits
// made since; the next build's replace them. `at`: the build's (its log's time).
function edProblems(list, at) {
  const by = new Map();
  for (const p of list || []) if (p.path && p.line) { if (!by.has(p.path)) by.set(p.path, []); by.get(p.path).push(p); }
  ed.problems = by; ed.problemsAt = at || 0;
  if (ed.s && ed.s.view) edMarkProblems(ed.s);
}
function edMarkProblems(s) {
  const A = s.A, v = s.view;
  if (!v || !s.probs || !A.setDiagnostics) return;
  const list = ed.problems.get((s.info && s.info.real) || s.path) || ed.problems.get(s.path) || [];
  const sig = JSON.stringify([ed.problemsAt, list.map((p) => [p.level, p.line, p.message])]);
  if (sig === s.probs.sig) return;
  s.probs.sig = sig;
  const doc = v.state.doc, diags = [], tints = new Map();
  for (const p of list) {
    const l = doc.line(Math.max(1, Math.min(p.line, doc.lines)));
    const at = p.token ? l.text.indexOf(p.token) : -1;
    const from = at >= 0 ? l.from + at : l.from + l.text.length - l.text.trimStart().length;
    const to = at >= 0 ? from + p.token.length : Math.max(from, l.from + l.text.trimEnd().length);
    diags.push({ from, to, severity: p.level === "error" ? "error" : p.level === "warning" ? "warning" : "info",
      source: p.level === "box" ? "LaTeX: a bad box" : "LaTeX", message: p.message });
    if (p.level !== "box" && tints.get(l.from) !== "error") tints.set(l.from, p.level);
  }
  const tinted = A.Decoration.set([...tints].map(([at, level]) => A.Decoration.line({ class: `ed-prob ${level}` }).range(at)), true);
  const told = A.setDiagnostics(v.state, diags);
  v.dispatch({ effects: [].concat(told.effects || [], s.probs.set.of(tinted),
    s.probs.gutter.reconfigure(diags.length && A.lintGutter ? A.lintGutter() : [])) });
}
// Whether the file open is a TeX source, its places in what it built shown: "→ PDF" offered.
const edTexToPdf = () => !!(ed.file && /\.(tex|ltx)$/i.test(ed.file));
// `at`: the place in the file (a double-click's); else the cursor's.
async function edToPdf(at = null) {
  const s = ed.s;
  if (!edTexToPdf() || !s || !s.view) return;
  const head = at ?? s.view.state.selection.main.head, l = s.view.state.doc.lineAt(head);
  try { await pvLocate({ path: ed.file, line: l.number, column: head - l.from }); }
  catch (e) { paneNote(e.message); }
}
// A double-click in a TeX source's text: that place in the PDF too -- the word under it selected by CodeMirror, as
// always (a modifier held, or a button of a box in the text: CodeMirror's or the box's alone).
function edToPdfClick(ev) {
  if (ev.button !== 0 || ev.detail !== 2 || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
  const s = ed.s, t = ev.target;
  if (!s || !s.view || !edTexToPdf() || !s.view.contentDOM.contains(t) || (t.closest && t.closest("button, input, a"))) return;
  const at = s.view.posAtCoords({ x: ev.clientX, y: ev.clientY });
  if (at != null) edToPdf(at);
}
// A PDF the Editor shows (editor-view.js), in pdf.js's viewer (/_ag/lib/pdfjs: the dashboard's copy, libs.py), in the
// dashboard's colours, with no scripts of the PDF's and its sidebar closed when it opens.
const PV_NO_SIDEBAR = 0;                             // pdf.js's SidebarView.NONE
const pvViewer = (url) => `/_ag/lib/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}`;
// A PDF opened again in its viewer (it changed on disk): where the reader was -- its page, zoom and place -- its sidebar
// as it was.
async function pvPdfOpen(f, url) {
  f.url = url;
  let app = null;
  try { app = f.frame.contentWindow.PDFViewerApplication; } catch (e) { /* not the viewer's page */ }
  if (!app || !app.pdfViewer || !app.initialized) { f.frame.src = pvViewer(url); return; }
  const at = app.pdfViewer._location;
  if (at && at.pdfOpenParams) app.initialBookmark = at.pdfOpenParams.slice(1);
  try {
    const side = app.pdfSidebar ? app.pdfSidebar.visibleView : PV_NO_SIDEBAR;
    f.frame.contentWindow.PDFViewerApplicationOptions.set("sidebarViewOnLoad", side);
  } catch (e) { /* an older viewer */ }
  try { await app.open({ url }); } catch (e) { f.frame.src = pvViewer(url); }
}
function pvPdfTheme(f) {
  let root;
  try { root = f && f.frame.contentDocument && f.frame.contentDocument.documentElement; } catch (e) { return; }
  if (!root) return;
  const cs = getComputedStyle(document.documentElement), v = (k) => cs.getPropertyValue(k).trim();
  const vars = { "--bg": "--page", "--bg-surface": "--page", "--bg-elevated": "--surface", "--text": "--ink",
    "--text-secondary": "--ink-2", "--text-faint": "--muted", "--accent": "--s1", "--bg-hover": "--wash", "--border-light": "--ring" };
  for (const [k, from] of Object.entries(vars)) if (v(from)) root.style.setProperty(k, v(from));
  root.setAttribute("data-docwriter-theme", shownTheme());    // its stylesheet's colours (the viewer DocWriter's build patched), from those
  root.style.colorScheme = shownTheme();
}
document.addEventListener("webviewerloaded", (ev) => {     // the viewer, before it starts: no scripts of the PDF's
  const w = ev.detail && ev.detail.source;
  if (!(ed.v && ed.v.pdf && ed.v.pdf.frame.contentWindow === w)) return;
  try {                                              // its stored preferences would set it again: not read
    w.PDFViewerApplicationOptions.set("disablePreferences", true);
    w.PDFViewerApplicationOptions.set("enableScripting", false);
    w.PDFViewerApplicationOptions.set("sidebarViewOnLoad", PV_NO_SIDEBAR);
  } catch (e) { /* an older viewer */ }
});
// The writers in the tree: their avatars, overlapped; two or more, on an amber ground with their count.
function edAvatars(writers, what) {
  if (!writers.length) return null;
  const many = writers.length > 1;
  return el("span", { class: "ed-avs" + (many ? " many" : ""),
    title: `${many ? `${writers.length} actors changed ${what}` : `Changed ${what}`} in the last half hour:\n`
      + writers.map((w) => `${edWriterName(w)}, ${ago(w.at)}${w.closed ? " (closed: its change waits for you)" : ""}`).join("\n") },
    ...writers.slice(0, 3).map(edAvatar), many ? el("span", { class: "n", text: String(writers.length) }) : null);
}
// Whose a change seen on disk at `t` was: the actor whose recorded change is nearest it, and not long before it (ag records
// a call's change a moment after the call made it; one recorded well before was an earlier change).
const edCredit = (writers, t) => writers.filter((w) => w.at >= t - ED_CREDIT[0] && w.at <= t + ED_CREDIT[1])
  .sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t))[0] || null;
const edEntry = (path) => ((ed.lists.get(edDir(path)) || {}).entries || []).find((e) => e.name === edBase(path)) || null;

// The tree: the folder's entries, and those of each folder opened in it; drawn again only when what it shows changed.
async function edList(dir, draw = true) {
  const got = await edFetchList(dir);
  if (!(ed.root && edUnder(dir, ed.root)) && !(ed.file && dir === edDir(ed.file))) return;   // a folder shown before
  if (got.user) ed.user = got.user;
  if (got.home) ed.home = got.home;
  if ("choose" in got && got.choose !== ed.choose) { ed.choose = got.choose; edBar(); }   // the system's Open dialog: its name, null when none opens here
  ed.lists.set(dir, got);
  if (draw) { edTree(); edHead(); }
}
const edWaiting = (n, what) => n ? el("span", { class: "mk br", title: `${plural(n, "change")} from an actor's branch ${what}, waiting for you`, text: String(n) }) : null;
// Above the tree, under the folder: the actors on branches of the project shown (branches.py), and what waits from them.
async function edFetchBranches() {
  if (!ed.root) return;
  let got = [];
  try { got = await get(`/api/branches?${new URLSearchParams({ root: ed.root })}`); } catch (e) { return; }
  ed.branches = got;
  edBranches();
}
const ED_KIND = { created: "new file", deleted: "deleted on its branch", missing: "not in the project" };
// One line of avatars, one per actor on a branch of the project shown, each with how many of its changes wait for the
// reader; its name and branch in its title. An avatar clicked: what waits from it, under the line (one at a time, the one
// picked kept in this browser), clicked again: put away.
const ED_BR_OPEN_KEY = "ag-dashboard-editor-branch-open";
function edBrPicked() {
  if (ed.brOpen === null) try { ed.brOpen = localStorage.getItem(ED_BR_OPEN_KEY) || ""; } catch (e) { ed.brOpen = ""; }
  return ed.brOpen;
}
function edBrToggle(b) {
  ed.brOpen = edBrPicked() === b.session_id ? "" : b.session_id;
  try { localStorage.setItem(ED_BR_OPEN_KEY, ed.brOpen); } catch (e) { /* this page only */ }
  ed.brSig = ""; edBranches();
}
function edBranches() {
  if (!ed.brs) return;
  const list = ed.branches || [], picked = edBrPicked();
  const sig = JSON.stringify([list, list.map((b) => { const a = edActor(b.gatherer, b.channel); return a ? [edWhoName(a), a.avatar, a.avatar_hue] : null; }), picked]);
  if (sig === ed.brSig) return;
  ed.brSig = sig;
  if (!list.length) { ed.brs.replaceChildren(); return; }
  const shown = list.find((b) => b.session_id === picked);
  const avs = list.map((b) => {
    const a = edActor(b.gatherer, b.channel), color = edWhoColor(a), name = a ? edWhoName(a) : "An actor";
    const waiting = Object.values(b.held || {}).reduce((n, v) => n + (v.kind === "lines" ? v.n || 1 : 1), 0), on = b === shown;
    return el("button", { type: "button", class: "ed-br-av" + (on ? " on" : ""), style: color ? `--who: ${color}` : null,
      "aria-pressed": on ? "true" : "false", "aria-label": `${name}${waiting ? `, ${plural(waiting, "change")} waiting` : ""}`,
      title: `${name}\n${branchRoute(b)}\n${waiting ? `${plural(waiting, "change")} waiting for you. ` : ""}${on ? "Click to put away" : "Click to see what it merges"}`,
      onclick: () => edBrToggle(b) },
      a && a.avatar ? el("img", { src: avatarSrc(a.avatar), alt: "", draggable: "false" }) : el("span", { class: "ed-noav" }),
      waiting ? el("span", { class: "n", text: String(waiting) }) : null);
  });
  ed.brs.replaceChildren(...[el("div", { class: "ed-br-avs", role: "group", "aria-label": "Actors merging in" }, ...avs),
    shown ? edBranch(shown) : null].filter(Boolean));
}
// What waits from an actor on a branch: a file's changed lines, asked about in the file (opened by its name); a file it
// made, or deleted, or the project no longer has, asked about here -- and its "auto-merge with approval".
function edBranch(b) {
  const color = edWhoColor(edActor(b.gatherer, b.channel));
  const files = Object.entries(b.held || {}).sort(([x], [y]) => x.localeCompare(y));
  const decide = (path, take) => edDecide(b, path, take);
  return el("div", { class: "ed-br", style: color ? `--who: ${color}` : null },
    el("label", { class: "ap", title: "On: each of its changes waits for you to accept or reject it. Off: its changes are merged in as they come, but for lines you are editing here (the conflict zone), and lines you changed too." },
      el("input", { type: "checkbox", checked: b.approve ? "" : null, onchange: (ev) => edApprove(b, ev.target.checked) }), "Auto-merge with approval"),
    ...(files.length ? files.map(([path, v]) => {
      const whole = v.kind !== "lines", there = v.kind === "created" || v.kind === "missing";
      const open = there ? b.worktree + path.slice(b.project.length) : path;
      return el("div", { class: "f" },
        el("button", { type: "button", class: "go", title: there ? `Open its file on its branch: ${edTilde(open)}` : `Open ${edTilde(path)}`,
          onclick: () => edOpen(open) }, edRel(path)),
        el("span", { class: "k", text: whole ? ED_KIND[v.kind] || v.kind : plural(v.n, "change") }),
        whole || v.n > 1 ? el("button", { type: "button", class: "pick", title: { created: "Add the file to the project", deleted: "Delete the file from the project",
          missing: "Add the file to the project again" }[v.kind] || "Take every change of its into the file", onclick: () => decide(path, "theirs") }, whole ? "Accept" : "Accept all") : null,
        whole || v.n > 1 ? el("button", { type: "button", class: "pick", title: whole ? "Leave the project's as it is: not asked about again, until it changes the file again"
          : "Leave every change of its out of the file", onclick: () => decide(path, "mine") }, whole ? "Reject" : "Reject all") : null);
    }) : [el("div", { class: "none", text: b.approve ? "Nothing waiting for you" : "Merged as it goes: nothing waiting" })]));
}
async function edApprove(b, on) {
  try { await post("/api/branches/approve", { session_id: b.session_id, approve: on }); } catch (e) { ed.err = e.message; edHead(); }
  edFetchBranches();
}
async function edDecide(b, path, take) {
  try { await post("/api/branches/decide", { session_id: b.session_id, path, take }); } catch (e) { ed.err = e.message; edHead(); }
  edFetchBranches();
  const dirs = new Set([ed.root, ...ed.open]);
  Promise.all([...dirs].map((d) => edList(d, false))).then(() => edTree());
}

function edGo(dir) {
  dir = (dir || "").replace(/\/+$/, "") || "/";
  if (!dir.startsWith("/")) { ed.barSig = ""; edBar(); return; }        // not a path: shown as it was
  if (dir === ed.root) return;
  ed.root = dir;
  ed.lists = new Map([...ed.lists].filter(([d]) => ed.file && d === edDir(ed.file)));
  ed.open.clear(); ed.treeSig = ""; ed.barSig = "";
  try { localStorage.setItem(edRootKey(), dir); } catch (e) { /* this page only */ }
  edRemember(dir);
  ed.branches = []; edBranches();
  edBar(); edTree(); edList(dir); edFetchBranches();
}
function edTick() {
  if (ed.timer) return;
  ed.timer = setInterval(() => {
    if (document.hidden || !ed.root) return;
    const dirs = new Set([ed.root, ...ed.open, ...(ed.file ? [edDir(ed.file)] : [])]);
    Promise.all([...dirs].map((d) => edList(d, false))).then(() => { edTree(); edHead(); if (ed.s) edConflicts(ed.s); if (ed.v) edViewCheck(ed.v); });
    edBar(); edFetchBranches();
    if (ed.s) { edConflicts(ed.s); edAgentMarks(ed.s); }
  }, ED_TICK);
}

// A file open: what it is first (editor.about) -- text, its document (Yjs), shared through the dashboard with every page
// that has it open and with the disk; any other file, shown (edShow). `how`: "edit", its text whatever it is (an SVG's,
// from its header's Edit); "view", shown (an SVG's View). `kept`: the file this Editor had open when its panel last went
// (edKeptFile), opened again where it was -- or, gone since, not.
async function edOpen(path, how = null, kept = null) {
  if (how !== "view" && ed.s && ed.s.path === path && !ed.s.err) return;
  if (how !== "edit" && ed.v && ed.v.path === path) return;
  edClose();
  const turn = ++ed.turn;                            // a later pick's, meanwhile, wins
  ed.file = path; ed.err = "";
  edKeepFile({ path, how, at: kept && kept.at ? { ...kept.at, focused: false } : null });   // the keys: as it next closes
  if (!ed.lists.has(edDir(path))) edList(edDir(path));      // its writers
  edReveal(path);                                    // and its row in the tree, the folders down to it opened
  edRememberFile(path);                              // Go to file's "Opened lately"
  edTree(); edHead();
  let info, A;
  try { info = await edAbout(path); } catch (e) {
    if (ed.turn !== turn) return;
    if (kept) { ed.file = null; edKeepFile(null); edTree(); edHead(); return; }   // gone since: the folder alone
    ed.err = e.message; edHead(); return;
  }
  if (ed.turn !== turn) return;
  if (how !== "edit" && (info.kind !== "text" || !info.text)) return edShow(path, info);
  try { A = await edLib(); } catch (e) { if (ed.turn === turn) { ed.err = e.message; edHead(); } return; }
  if (ed.turn !== turn || ed.s) return;              // another picked meanwhile
  const doc = new A.Y.Doc(), ytext = doc.getText("text"), awareness = new A.Awareness(doc);
  const conn = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const s = ed.s = { A, path, root: "/", doc, ytext, awareness, conn, es: null, view: null, marks: null, markN: 0, boxes: new Map(),
    epoch: null, state: null, err: "", note: "", out: [], sending: false, awareAt: null, who: null, info, how, at: kept ? kept.at : null };
  awareness.setLocalStateField("user", edMe());
  doc.on("update", (u, origin) => { if (origin !== "remote" && origin !== "disk") { s.out.push(u); edFlush(s); } });
  awareness.on("update", (_, origin) => { if (origin === "local") edAware(s); });
  awareness.on("change", () => { if (ed.s === s) edHead(); });
  ytext.observe((ev, tr) => { if (tr.origin === "disk") edDiskMarks(s, ev.delta); });
  const es = s.es = new EventSource(forEditor(`/api/edit/stream?${new URLSearchParams({ path, root: s.root, conn, client: doc.clientID })}`));
  const on = (name, f) => es.addEventListener(name, (e) => {
    if (ed.s !== s) return;
    try { f(JSON.parse(e.data)); } catch (err) { console.error(err); }
  });
  on("init", (v) => {
    if (s.epoch && s.epoch !== v.epoch) return edReopen(s);     // the dashboard restarted: its document is another
    const first = !s.epoch;
    s.epoch = v.epoch;
    A.Y.applyUpdate(doc, edBytes(v.update), "remote");
    if (!first) {                                    // back after the stream broke: what was typed meanwhile, sent
      const mine = A.Y.encodeStateAsUpdate(doc, edBytes(v.sv));
      if (mine.length > 2) { s.out.push(mine); edFlush(s); }
    }
    for (const u of v.aware) A.applyAwarenessUpdate(awareness, edBytes(u), "remote");
    edAware(s);                                      // this page's cursor, to the stream's new end
    if (first) edView(s);
    edHead();
  });
  on("update", (v) => A.Y.applyUpdate(doc, edBytes(v.update), v.disk ? "disk" : "remote"));
  on("aware", (v) => A.applyAwarenessUpdate(awareness, edBytes(v.update), "remote"));
  on("left", (v) => A.removeAwarenessStates(awareness, [v.client], "remote"));
  on("state", (v) => { s.state = v; edZone(s); edAgentMarks(s); edConflicts(s); edAutoLater(s); edHead(); });   // after each edit, any page's, and the disk's
  on("failed", (v) => {
    if (!s.epoch && how !== "edit") { edClose(); return edShow(path, { ...info, text: false, why: `${v.error}: it is shown, not edited.` }); }   // not text after all
    s.err = v.error; es.close(); edHead();
  });
  es.onerror = es.onopen = () => { if (ed.s === s) edHead(); };   // the header says while it reconnects
}
function edView(s) {
  const A = s.A;
  const add = A.StateEffect.define(), clear = A.StateEffect.define();
  const marks = A.StateField.define({                // what was written to the file on disk, marked a moment
    create: () => A.Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(add)) deco = deco.update({ add: e.value, sort: true });
        else if (e.is(clear)) deco = A.Decoration.none;
      }
      return deco;
    },
    provide: (f) => A.EditorView.decorations.from(f),
  });
  s.marks = { add, clear };
  const setConflicts = A.StateEffect.define();
  const conflicts = A.StateField.define({            // the conflicts with the file on disk: this page's lines, its file's under them
    create: () => A.Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setConflicts)) deco = e.value;
      return deco;
    },
    provide: (f) => A.EditorView.decorations.from(f),
  });
  s.conflicts = { set: setConflicts, field: conflicts, sig: "" };
  const setZone = A.StateEffect.define();
  const zone = A.StateField.define({                 // the conflict zone: the lines edited here, tinted
    create: () => A.Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setZone)) deco = e.value;
      return deco;
    },
    provide: (f) => A.EditorView.decorations.from(f),
  });
  s.zone = { set: setZone, sig: "" };
  const setAgents = A.StateEffect.define();
  const agents = A.StateField.define({               // the lines of actors' branches, merged in: in each one's hue
    create: () => A.Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setAgents)) deco = e.value;
      return deco;
    },
    provide: (f) => A.EditorView.decorations.from(f),
  });
  s.agents = { set: setAgents, sig: "" };
  const setProbs = A.StateEffect.define();
  const probs = A.StateField.define({                // the lines of a LaTeX build's errors and warnings, tinted (edProblems)
    create: () => A.Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setProbs)) deco = e.value;
      return deco;
    },
    provide: (f) => A.EditorView.decorations.from(f),
  });
  s.probs = { set: setProbs, sig: "", gutter: new A.Compartment() };   // its gutter's markers only once it has some
  s.wrapping = new A.Compartment();                  // long lines wrapped, or not (the header's Wrap)
  ed.body.replaceChildren();
  s.view = new A.EditorView({
    parent: ed.body,
    state: A.EditorState.create({
      doc: s.ytext.toString(),
      extensions: [
        A.keymap.of([...A.yUndoManagerKeymap, { key: "Mod-s", preventDefault: true, run: () => { edSave(s); return true; } }, A.indentWithTab]),
        A.basicSetup, A.EditorState.lineSeparator.of("\n"), A.highlight, A.language(s.path), A.yCollab(s.ytext, s.awareness), marks,
        zone, agents, conflicts, probs, s.probs.gutter.of([]), s.wrapping.of(ed.wrap ? A.EditorView.lineWrapping : []),
        A.EditorView.updateListener.of((u) => {
          if (u.docChanged && s.top) s.top = u.changes.mapPos(s.top);     // the line at the top, where edits moved it
          if (u.selectionSet) edPlaceMoved(s);
          if (u.selectionSet || u.focusChanged || u.geometryChanged) edSendPlace();   // its Send to an actor (editor-send.js)
        }),
      ],
    }),
  });
  edPlaceAt(s);
  s.view.scrollDOM.addEventListener("scroll", () => {
    const d = s.view.scrollDOM;
    if (d.clientHeight) s.top = s.view.lineBlockAtHeight(d.scrollTop).from;   // drawn only: going, its frame reads 0
    edPlaceMoved(s);
    edSendPlace();
  }, { passive: true });
  edZone(s);
  edAgentMarks(s);
  edConflicts(s);
  edMarkProblems(s);
}
// The file open, where it is, kept as this Editor's (edKeepFile): its cursor, as the view has it now; the line at the top
// of its view, as last seen while it was drawn (`s.top`: as the panel goes, its frame is no longer drawn, and its scroll
// reads 0); and, `focused`, whether the reader left from typing in it (edHadKeys) -- so that, opened again, it takes the
// keys back, the cursor shown where it was. Kept a moment after the cursor or the view last moves (edPlaceMoved), and
// as the file closes (edClose).
function edKeepPlace(s, focused = false) {
  clearTimeout(s.keepT);
  if (!s.view) return;
  const sel = s.view.state.selection.main;
  edKeepFile({ path: s.path, how: s.how, at: { anchor: sel.anchor, head: sel.head, top: s.top || 0, focused } });
}
function edPlaceMoved(s) {
  clearTimeout(s.keepT);
  s.keepT = setTimeout(() => { if (ed.s === s) edKeepPlace(s); }, ED_KEEP_AT_MS);
}
// Whether the reader is typing in the file `s` as the panel goes: the file was the last thing focused in the panel
// (`ed.keys`, set by each focus within it; the keys going to the dashboard around it are no focus within), and the panel
// kept the keys until it went -- it has them, or lost them only a moment ago (the window's blur), as taking the panel
// away does. Gone to the dashboard's message box first, it lost them earlier: not typing in the file.
function edHadKeys(s) {
  if (!ed.keys || !s.view) return false;
  return document.hasFocus() || performance.now() - ed.blurAt < ED_LEFT_MS;
}
document.addEventListener("focusin", (e) => { ed.keys = !!(ed.s && ed.s.view && e.target === ed.s.view.contentDOM); });
window.addEventListener("blur", () => { ed.blurAt = performance.now(); });
// The file opened again where it was left (`s.at`): its cursor, its view scrolled to the line that was at its top -- each
// within the file as it is now -- and, left while typing in it, the keys back, so the cursor shows and typing goes on there.
function edPlaceAt(s) {
  const at = s.at, v = s.view;
  s.at = null;
  if (!v) return;
  const n = v.state.doc.length, within = (x) => Math.max(0, Math.min(Number(x) || 0, n));
  s.top = at ? within(at.top) : 0;
  if (!at) return;
  v.dispatch({ selection: { anchor: within(at.anchor), head: within(at.head) },
    effects: s.A.EditorView.scrollIntoView(s.top, { y: "start" }) });
  if (at.focused) v.focus();
}
// The lines actors' branches put in the file (the state's `marks`), tinted in each one's hue -- as long as the actor is
// not closed.
function edAgentMarks(s) {
  const v = s.view;
  if (!v || !s.agents) return;
  const list = ((s.state && s.state.marks) || []).map((m) => ({ ...m, a: edActor(m.gatherer, m.channel) }))
    .filter((m) => !m.a || statusOf(m.a)[0] !== "closed");
  const sig = JSON.stringify(list.map((m) => [m.from, m.to, m.channel, edWhoColor(m.a)]));
  if (sig === s.agents.sig) return;
  s.agents.sig = sig;
  const A = s.A, doc = v.state.doc, out = new Map();
  for (const m of list) {
    const from = Math.min(m.from, doc.length), to = Math.min(Math.max(m.to, from), doc.length), color = edWhoColor(m.a);
    const attributes = { title: `From ${m.a ? edWhoName(m.a) : "an actor"}'s branch`, ...(color ? { style: `--who: ${color}` } : {}) };
    const last = doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = doc.lineAt(from).number; n <= last && out.size < 20000; n++) {
      const at = doc.line(n).from;
      if (!out.has(at)) out.set(at, A.Decoration.line({ class: "ed-agent", attributes }).range(at));
    }
  }
  v.dispatch({ effects: s.agents.set.of(A.Decoration.set([...out.values()], true)) });
}
// The conflict zone (the state's `zone`: ranges of the document), drawn: each line a range is on, or an empty one is at.
function edZone(s) {
  const v = s.view, list = (s.state && s.state.zone) || [];
  if (!v || !s.zone) return;
  const sig = JSON.stringify(list);
  if (sig === s.zone.sig) return;
  s.zone.sig = sig;
  const A = s.A, doc = v.state.doc, lines = new Set();
  for (const [a, b] of list) {
    const from = Math.min(a, doc.length), to = Math.min(Math.max(b, from), doc.length);
    const last = doc.lineAt(Math.max(from, to - 1)).number;
    for (let n = doc.lineAt(from).number; n <= last && lines.size < 20000; n++) lines.add(doc.line(n).from);
  }
  v.dispatch({ effects: s.zone.set.of(A.Decoration.set([...lines].map((at) => A.Decoration.line({ class: "ed-zone" }).range(at)), true)) });
}
async function edClearZone(s) {
  try { s.state = await post("/api/edit/zone/clear", { path: s.path, root: s.root }); s.err = ""; }
  catch (e) { s.err = e.message; }
  if (ed.s === s) { edZone(s); edHead(); }
}
// What a box's change does within its lines, by word: (the lines here, the lines it would put in their place) as
// [kind, text] parts -- "same", "del" (in the lines here only), "add" (in its lines only) -- from the longest run of
// words the two share (their common start and end first left out); null where one side is empty, or too long to work
// out at once (the whole lines are marked anyway).
const ED_WORDS = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu, ED_DIFF_MAX = 250000;
function edWordDiff(mine, theirs) {
  if (!mine || !theirs || mine === theirs) return null;
  const a = mine.match(ED_WORDS) || [], b = theirs.match(ED_WORDS) || [];
  let pre = 0, post = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  while (post < a.length - pre && post < b.length - pre && a[a.length - 1 - post] === b[b.length - 1 - post]) post++;
  const x = a.slice(pre, a.length - post), y = b.slice(pre, b.length - post);
  if (x.length * y.length > ED_DIFF_MAX) return null;
  const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [], put = (kind, text) => { const last = out[out.length - 1]; if (last && last[0] === kind) last[1] += text; else out.push([kind, text]); };
  if (pre) put("same", a.slice(0, pre).join(""));
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { put("same", x[i]); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) put("add", y[j++]);
    else put("del", x[i++]);
  }
  if (post) put("same", a.slice(a.length - post).join(""));
  return out;
}
// A word diff's parts as a box shows them: each change whole -- what it takes out, then what it puts in -- its runs of
// changed words, and the punctuation or spaces between them (ED_GLUE, on one line), one ["change", out, in]; the rest
// ["same", text]. So "3.14" made "math.pi" reads as the one, struck, then the other, not word by word in turn.
const ED_GLUE = /^[^\S\n]*[^\s\p{L}\p{N}_]{0,2}[^\S\n]*$/u;
function edGroups(parts) {
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const [kind, text] = parts[i];
    if (kind === "same") { out.push(["same", text]); continue; }
    let gone = "", put = "";
    for (; i < parts.length; i++) {
      const [k, t] = parts[i];
      if (k === "del") gone += t;
      else if (k === "add") put += t;
      else if (ED_GLUE.test(t) && i + 1 < parts.length && parts[i + 1][0] !== "same") { gone += t; put += t; }
      else { i--; break; }
    }
    out.push(["change", gone, put]);
  }
  return out;
}
// The conflicts, drawn: the lines kept here marked, and under them the file's lines, with what to do about them.
let EdConflict = null;
function edConflictWidget(A) {
  return EdConflict ||= class extends A.WidgetType {
    constructor(s, c, by, parts) { super(); this.s = s; this.c = c; this.by = by; this.parts = parts; }
    eq(other) {
      if (this.box || other.box) return this.box === other.box;    // its lines being edited: the same box, kept as it is
      return other.c.id === this.c.id && other.c.theirs === this.c.theirs && other.by.names.join("\n") === this.by.names.join("\n")
        && JSON.stringify(other.parts) === JSON.stringify(this.parts);
    }
    toDOM() {
      if (this.box) return this.box.dom;
      const { s, c } = this, name = this.by.label, many = this.by.names.length > 1;
      const pick = (take, label, title) => el("button", { type: "button", title,
        onclick: (ev) => { ev.preventDefault(); edSettle(s, c.id, take); } }, label);
      const mine = c.to > c.from, kind = !c.theirs ? "deleted" : mine ? "rewrote" : "added";
      let what, picks;
      const branch = c.agent, who = branch ? edActor(branch.gatherer, branch.channel) : null;
      const put = branch && branch.put;              // an actor's change through its tools (editor_edit), not its branch's
      if (put && branch.why === "approve") {         // Review: its proposal, accepted or rejected
        const nm = who ? edWhoName(who) : "An actor";
        what = { rewrote: `${nm} proposes to change these lines`, deleted: `${nm} proposes to delete these lines`, added: `${nm} proposes to add lines here` }[kind];
        picks = [
          pick("theirs", "Accept", c.theirs ? "Put its lines in the file, in place of these (written to the file on disk)" : "Delete these lines, as it proposes"),
          pick("mine", "Reject", "Leave its change out: the file keeps these lines, and the actor is told"),
          kind === "rewrote" ? pick("both", "Keep both", "Keep these lines, and its after them") : null];
      } else if (c.asked) {                          // Review or Hands off: the file changed on disk, around the tools
        const nm = name || "Something";
        what = { rewrote: `${nm} changed these lines on disk`, deleted: `${nm} deleted these lines on disk`, added: `${nm} added lines here on disk` }[kind];
        picks = [
          pick("theirs", "Accept", c.theirs ? "Take the file's lines in place of these" : "Delete these lines, as the file did"),
          pick("mine", "Reject", mine ? "Put these lines back on the file on disk, in place of its change" : "Take the lines it added out of the file on disk"),
          kind === "rewrote" ? pick("both", "Keep both", "Keep these lines, and the file's after them") : null];
      } else if (branch && !c.zone) {                // an actor's branch's change: taken in, or left out, as the reader says
        const nm = who ? edWhoName(who) : branch.branch;
        what = branch.why === "approve"
          ? { rewrote: `${nm} changed these lines on its branch`, deleted: `${nm} deleted these lines on its branch`, added: `${nm} added lines here on its branch` }[kind]
          : `${nm} changed these lines on its branch, and they were changed here too`;
        picks = branch.why === "approve" ? [
          pick("theirs", "Accept", c.theirs ? "Put its lines in the file, in place of these" : "Delete these lines, as its branch did"),
          pick("mine", "Reject", "Leave its change out: the file keeps these lines, and it is not asked about again"),
          kind === "rewrote" ? pick("both", "Keep both", "Keep these lines, and its after them") : null]
          : [pick("mine", "Keep yours", "Leave its change out: the file keeps these lines"),
            pick("theirs", c.theirs ? "Take its" : "Delete them", c.theirs ? "Put its lines in place of these" : "Delete these lines, as its branch did"),
            c.theirs && mine ? pick("both", "Keep both", "Keep these lines, and its after them") : null];
      } else if (c.zone) {                                  // in the conflict zone: the reader's lines, rewritten on disk
        what = { rewrote: name ? `${name} rewrote lines you edited` : "Lines you edited were rewritten on disk",
          deleted: name ? `${name} deleted lines you edited` : "Lines you edited were deleted on disk",
          added: name ? `${name} added lines among those you edited` : "Lines were added on disk among those you edited" }[kind];
        picks = [
          pick("mine", mine ? "Restore yours" : "Leave them out", mine ? "Keep your lines; a save (or Auto-save) writes them over the file's"
            : "Leave the file's new lines out; a save (or Auto-save) writes the file without them"),
          pick("theirs", { rewrote: many ? "Accept their rewrite" : "Accept its rewrite", deleted: "Accept the deletion", added: "Add them" }[kind],
            c.theirs ? "Put the file's lines in place of yours" : "Delete your lines, as the file did"),
          kind === "rewrote" ? pick("both", "Keep both", "Keep your lines, and the file's after them") : null];
      } else {                                       // both changed, differently, outside the zone (it was cleared)
        what = `${c.theirs ? "Changed" : "Deleted"} on disk${name ? ` by ${name}` : ""} where it was edited here too`;
        picks = [pick("mine", "Keep yours", "Keep the lines above; the file's are left out (a save writes yours)"),
          pick("theirs", c.theirs ? "Take theirs" : "Delete them", c.theirs ? "Put the file's lines in place of yours" : "Delete your lines, as the file did"),
          c.theirs && mine ? pick("both", "Keep both", "Keep your lines, and the file's after them") : null];
      }
      picks.push(el("button", { type: "button", title: "Edit its lines here, in this box, before they go in place of yours: what they take out of your lines and put in shows as you type. Accept edit puts them in the file; Cancel leaves everything as it is.",
        onclick: (ev) => { ev.preventDefault(); edBoxOpen(s, c); } }, "Edit"));
      const color = branch ? edWhoColor(who) : null;
      return el("div", { class: "ed-cf" + (branch ? " from-branch" : ""), style: color ? `--who: ${color}` : null },
        el("div", { class: "ed-cf-head" }, branch && who && who.avatar ? el("span", { class: "ed-avs" }, el("img", { src: avatarSrc(who.avatar), alt: "", draggable: "false" })) : null,
          el("span", { class: "what", title: put ? null : branch ? `Its branch: ${branch.branch}` : many ? `Their changes, one after the other:\n${this.by.names.join("\n")}` : null,
          text: `${what}, ${ago(c.at)}.` }), el("span", { class: "grow" }), ...picks),
        // its lines -- with the words changed, both those it takes out of the lines above (red) and those it puts in
        // (green), in place, where they are told (edWordDiff)
        c.theirs ? el("div", { class: "ed-cf-label" }, put ? (this.parts ? "Its change to the lines above: " : mine ? "Its lines, in place of those above:" : "Its lines:")
          : branch ? (this.parts ? "Its change to the lines above: " : mine ? "On its branch, in place of the lines above:" : "On its branch:")
          : this.parts ? "The change on disk to the lines above: " : mine ? "On disk now, in place of the lines above:" : "On disk now:",
          ...(this.parts ? [el("span", { class: "ed-del", text: "taken out" }), ", ", el("span", { class: "ed-add", text: "put in" })] : [])) : null,
        c.theirs ? el("pre", { class: "ed-cf-theirs" }, ...(this.parts
          ? edGroups(this.parts).map((g, k, all) => {
            const end = (t) => k === all.length - 1 ? t.replace(/\n$/, "") : t;
            if (g[0] === "same") return end(g[1]);
            const out = [g[1].trim() ? el("span", { class: "ed-del", text: g[2] ? g[1] : end(g[1]) }) : g[1],
              g[2].trim() ? el("span", { class: "ed-add", text: end(g[2]) }) : end(g[2])];
            return el("span", { class: "ed-chg" }, ...out);
          })
          : [c.theirs.replace(/\n$/, "")])) : null);
    }
    ignoreEvent() { return true; }
  };
}
// Drawn again when the conflicts or their places change, or who made one is known (ag records an actor's change a
// moment after it lands: the listing's `writers`), and whenever one's box is missing -- an edit can take it away (one
// that deletes the line break after it) while leaving the conflict where it was. Called with each state, and with each
// of the panel's ticks.
// Who made a conflict: every actor whose change landed from the first of its lines' changes (`since`) to its last.
function edConflictBy(s, c) {
  if (c.agent) {                                     // an actor's branch's, or one put in by its tools: that actor
    const a = edActor(c.agent.gatherer, c.agent.channel), name = a ? edWhoName(a) : c.agent.branch || "An actor";
    return { label: name, names: [name] };
  }
  const ws = edWriters(edEntry(s.path)).filter((w) => w.at >= (c.since ?? c.at) - ED_CREDIT[0] && w.at <= c.at + ED_CREDIT[1]).reverse();
  return { label: ws.length > 1 ? `${ws.length} actors` : ws.length ? edWriterName(ws[0]) : "", names: ws.map(edWriterName) };
}
function edConflicts(s) {
  const v = s.view, list = (s.state && s.state.conflicts) || [];
  if (!v || !s.conflicts) return;
  for (const id of [...s.boxes.keys()]) if (!list.some((c) => c.id === id)) edBoxClose(s, id);   // settled elsewhere
  for (const c of list) if (s.boxes.has(c.id)) edBoxAgain(s, c, s.boxes.get(c.id));
  const sig = JSON.stringify(list.map((c) => [c.id, c.from, c.to, c.theirs, edConflictBy(s, c), s.boxes.has(c.id) ? s.boxes.get(c.id).n : null]));
  const shown = new Set();
  v.state.field(s.conflicts.field).between(0, v.state.doc.length, (from, to, d) => { if (d.spec.cf) shown.add(d.spec.cf); });
  if (sig === s.conflicts.sig && list.every((c) => shown.has(c.id))) return;
  try { edDrawConflicts(s, list); s.conflicts.sig = sig; }
  catch (err) { console.error("the conflicts were not drawn:", err); }   // drawn at the next state, or tick
}
function edDrawConflicts(s, list) {
  const v = s.view, A = s.A, doc = v.state.doc, Widget = edConflictWidget(A), out = [];
  for (const c of list) {
    const from = Math.min(c.from, doc.length), to = Math.min(Math.max(c.to, from), doc.length);
    const box = s.boxes.get(c.id), parts = box ? null : edWordDiff(doc.sliceString(from, to), c.theirs);
    let at = from;                                   // what the change takes out of the lines here, marked in them
    for (const [kind, text] of parts || []) {
      if (kind === "del" && text.trim()) out.push(A.Decoration.mark({ class: "ed-del" }).range(at, at + text.length));
      if (kind !== "add") at += text.length;
    }
    if (box && doc.sliceString(from, to) === box.mine) {             // ... as the box has it now: what it struck
      for (const g of box.view.state.field(box.field)) {
        if (g.k === "add") continue;
        if (g.k === "gone" && g.t.trim()) out.push(A.Decoration.mark({ class: "ed-del" }).range(at, at + g.t.length));
        at += g.t.length;
      }
    }
    if (to > from) {
      const color = c.agent ? edWhoColor(edActor(c.agent.gatherer, c.agent.channel)) : null;
      const deco = A.Decoration.line({ class: "ed-cf-mine" + (c.agent ? " from-branch" : ""), ...(color ? { attributes: { style: `--who: ${color}` } } : {}) });
      for (let p = from; p < to; ) { const line = doc.lineAt(p); out.push(deco.range(line.from)); p = line.to + 1; }
      const last = doc.lineAt(Math.max(from, to - 1));
      out.push(A.Decoration.widget({ widget: edBoxed(new Widget(s, c, edConflictBy(s, c), parts), box), block: true, side: 1, cf: c.id }).range(last.to));
    } else {
      out.push(A.Decoration.widget({ widget: edBoxed(new Widget(s, c, edConflictBy(s, c), parts), box), block: true, side: -1, cf: c.id }).range(doc.lineAt(from).from));
    }
  }
  v.dispatch({ effects: s.conflicts.set.of(A.Decoration.set(out, true)) });
}
async function edSettle(s, conflict, take) {
  try { s.state = await post("/api/edit/settle", { path: s.path, root: s.root, conflict, take }); s.err = ""; }
  catch (e) { s.err = e.message; }
  if (ed.s === s) { edConflicts(s); edHead(); }
}
// Every change proposed in the file accepted, or rejected (edit/settle_all): one that cannot be -- its lines changed
// since -- said, the rest still settled.
async function edSettleAll(s, take) {
  try { s.state = await post("/api/edit/settle_all", { path: s.path, root: s.root, take }); s.err = s.state.error || ""; }
  catch (e) { s.err = e.message; }
  if (ed.s === s) { edConflicts(s); edHead(); }
}
// How an agent's change to a file open here lands, for the whole Editor (its backend's MODES): Live, at once (lines
// you are editing asked about); Review, each change a proposal to accept or reject; Hands off, refused -- and in both of
// those, a write around the Editor's tools (a shell command's) asked about too. Its agents are told when it changes.
const ED_MODES = [
  ["live", "Live", "Agents' changes land as they come, in their colour, and are written to the file. Only a change to lines you are editing is asked about."],
  ["review", "Review", "Each change an agent makes is a proposal here, to accept or reject; the file on disk changes only when you accept. A write that does not come through the Editor (a shell command's) is asked about too."],
  ["handsoff", "Hands off", "Agents may not change the files you have open here: they are told to ask you first. A write that does not come through the Editor is asked about."]];
function edModePick() {
  const now = ED_MODES.find((m) => m[0] === ed.mode) || ED_MODES[0];
  return el("label", { class: "ed-mode-pick", title: `How the agents' changes land in the files open here:\n${ED_MODES.map((m) => `${m[1]}: ${m[2]}`).join("\n")}` },
    el("span", { class: "lbl", text: "Agents:" }),
    el("select", { "aria-label": "How the agents' changes land", onchange: (ev) => edSetMode(ev.target.value) },
      ...ED_MODES.map(([v, label]) => el("option", { value: v, selected: v === now[0] ? "" : null }, label))));
}
async function edSetMode(mode) {
  const was = ed.mode;
  ed.mode = mode;
  edHead();
  try { ed.mode = (await post("/api/mode", { mode })).mode; ed.err = ""; }
  catch (e) { ed.mode = was; ed.err = e.message; }
  edHead();
}

// ------------------------------------------------------------------ a conflict's lines, edited in its box
// Edit: the box's lines made editable, in an editor of its own -- not the file's: the reader's lines stay in the file
// as they are, until Accept edit. What it shows is worked out once, when the editing begins -- the reader's lines and its,
// word by word (edWordDiff) -- and from then on each piece keeps what it is (`segs`: [{k, t}]): "same" (in both,
// plain), "add" (put in, green: its, and what the reader types), "gone" (taken out of the reader's lines, struck: what
// it took out, and what the reader deletes of theirs; a click puts it back). So typing changes only what it types,
// and nothing is matched again. The same pieces strike, in the reader's lines above, what the box takes out of them.
// The "same" and "gone" pieces, in order, are always the reader's lines; the "same" and "add", the box's text. Accept
// edit sends the box's text (Room.settle's "edited": refused where its lines, or the reader's, changed since), Cancel
// closes it. A box lives in this page alone (`s.boxes`, by conflict), until Accept edit, Cancel, or its file closes.
function edSegsJoin(segs) {
  const out = [];
  for (const g of segs) {
    if (!g.t) continue;
    const last = out[out.length - 1];
    if (last && last.k === g.k) last.t += g.t; else out.push({ k: g.k, t: g.t });
  }
  return out;
}
function edSegsFrom(mine, theirs) {
  if (mine === theirs) return edSegsJoin([{ k: "same", t: mine }]);
  const parts = mine && theirs ? edWordDiff(mine, theirs) : null;
  if (!parts) return edSegsJoin([{ k: "gone", t: mine }, { k: "add", t: theirs }]);
  return edSegsJoin(edGroups(parts).flatMap((g) => g[0] === "same" ? [{ k: "same", t: g[1] }] : [{ k: "gone", t: g[1] }, { k: "add", t: g[2] }]));
}
// One change of the box's text -- `from` to `to` (its positions before it) made `text`: what it takes out of the
// reader's lines struck, what it takes out of the rest gone; what it puts in, put in -- after anything struck there.
function edSegsEdit(segs, from, to, text) {
  const out = [];
  let at = 0, put = !text;
  const putIn = () => { if (!put) { out.push({ k: "add", t: text }); put = true; } };
  for (const g of segs) {
    if (g.k === "gone") { out.push(g); continue; }  // no width in the text: kept where it is
    const end = at + g.t.length;
    const a = Math.min(Math.max(from, at), end), b = Math.min(Math.max(to, at), end);
    if (a > at) out.push({ k: g.k, t: g.t.slice(0, a - at) });
    if (b > a && g.k === "same") out.push({ k: "gone", t: g.t.slice(a - at, b - at) });
    if (end > b) { putIn(); out.push({ k: g.k, t: g.t.slice(b - at) }); }
    at = end;
  }
  putIn();
  return edSegsJoin(out);
}
function edSegsApply(segs, changes) {
  const list = [];
  changes.iterChanges((fromA, toA, fromB, toB, text) => list.push([fromA, toA, text.toString(), fromB]));
  for (let i = list.length - 1; i >= 0; i--) segs = edSegsEdit(segs, ...list[i].slice(0, 3));   // the last first: the others' places hold
  for (const [, , text, at] of list) if (!text) segs = edSegsTidy(segs, at);   // a deletion: what it left of both, plain
  return segs;
}
// Where a deletion was (`at`, in the text after it): what it struck there -- of the reader's lines -- beside what is put
// in right there, before it or after it: as much as reads the same on both sides (a line break of the reader's struck,
// where its own stays: the same text either way) is in both, plain. Nothing else: what is shown elsewhere stays as it was.
function edSegsTidy(segs, at) {
  let pos = 0, i = 0;
  for (; i < segs.length; i++) {
    if (pos === at && segs[i].k === "gone") break;
    if (pos > at) return segs;
    if (segs[i].k !== "gone") pos += segs[i].t.length;
  }
  if (i >= segs.length) return segs;
  const out = segs.map((g) => ({ ...g })), g = out[i], prev = out[i - 1], next = out[i + 1];
  let n = 0;
  if (prev && prev.k === "add") {                    // ... its end, and the end of what is put in before it
    while (n < g.t.length && n < prev.t.length && g.t[g.t.length - 1 - n] === prev.t[prev.t.length - 1 - n]) n++;
    if (n) {
      const same = g.t.slice(g.t.length - n);
      g.t = g.t.slice(0, g.t.length - n); prev.t = prev.t.slice(0, prev.t.length - n);
      return edSegsJoin([...out.slice(0, i + 1), { k: "same", t: same }, ...out.slice(i + 1)]);
    }
  }
  if (next && next.k === "add") {                    // ... its start, and the start of what is put in after it
    while (n < g.t.length && n < next.t.length && g.t[n] === next.t[n]) n++;
    if (n) {
      const same = g.t.slice(0, n);
      g.t = g.t.slice(n); next.t = next.t.slice(n);
      return edSegsJoin([...out.slice(0, i), { k: "same", t: same }, ...out.slice(i)]);
    }
  }
  return segs;
}
// A struck piece in the box: a click puts it back where it was -- in place of what was put in right after it, if
// anything (that one change undone).
let EdBoxGone = null;
function edBoxGoneWidget(A) {
  return EdBoxGone ||= class extends A.WidgetType {
    constructor(box, text, i, put) { super(); this.box = box; this.text = text; this.i = i; this.put = put; }
    eq(other) { return other.text === this.text && other.i === this.i && other.put === this.put; }
    toDOM(view) {
      const span = el("span", { class: "ed-gone", text: this.text.replace(/\n/g, "↵"),
        title: `Taken out of your lines: click to put it back${this.put.trim() ? ` in place of "${this.put.trim().slice(0, 60)}"` : ""}${this.text.includes("\n") ? " (its line breaks too)" : ""}` });
      span.addEventListener("mousedown", (ev) => ev.preventDefault());
      span.addEventListener("click", (ev) => {
        ev.preventDefault();
        const segs = view.state.field(this.box.field), next = segs[this.i + 1];
        let at = 0;
        for (let k = 0; k < this.i; k++) if (segs[k].k !== "gone") at += segs[k].t.length;
        const drop = next && next.k === "add" ? next.t.length : 0;
        view.dispatch({ changes: { from: at, to: at + drop, insert: this.text }, effects: this.box.putBack.of(this.i),
          selection: { anchor: at + this.text.length }, userEvent: "input.putback" });
        view.focus();
      });
      return span;
    }
    ignoreEvent() { return true; }
  };
}
function edBoxDeco(A, box, segs) {
  const Gone = edBoxGoneWidget(A), out = [];
  let at = 0;
  segs.forEach((g, i) => {
    if (g.k === "gone") {
      const next = segs[i + 1];
      out.push(A.Decoration.widget({ widget: new Gone(box, g.t, i, next && next.k === "add" ? next.t : ""), side: -1 }).range(at));
      return;
    }
    if (g.k === "add") out.push(A.Decoration.mark({ class: "ed-add" }).range(at, at + g.t.length));
    at += g.t.length;
  });
  return A.Decoration.set(out, true);
}
const edBoxed = (widget, box) => { widget.box = box || null; return widget; };
function edBoxOpen(s, c) {
  if (s.boxes.has(c.id) || !s.view) return;
  const A = s.A, doc = s.view.state.doc;
  const from = Math.min(c.from, doc.length), mine = doc.sliceString(from, Math.min(Math.max(c.to, from), doc.length));
  const box = { id: c.id, mine, theirs: c.theirs, n: 0, undo: [], redo: [], lastAt: 0,
    setSegs: A.StateEffect.define(), putBack: A.StateEffect.define() };
  box.field = A.StateField.define({
    create: () => edSegsFrom(mine, c.theirs),
    update(segs, tr) {
      for (const e of tr.effects) {
        if (e.is(box.setSegs)) return e.value;
        if (e.is(box.putBack)) {                      // struck piece i back, in place of what was put in after it
          const i = e.value, next = segs[i + 1];
          return edSegsJoin([...segs.slice(0, i), { k: "same", t: segs[i].t }, ...segs.slice(next && next.k === "add" ? i + 2 : i + 1)]);
        }
      }
      return tr.docChanged ? edSegsApply(segs, tr.changes) : segs;
    },
    provide: (f) => A.EditorView.decorations.from(f, (segs) => edBoxDeco(A, box, segs)),
  });
  // undone and done again with what each piece was (the editor's own history knows the text only)
  const snap = (st) => ({ text: st.doc.toString(), segs: st.field(box.field), at: st.selection.main.head });
  const back = (from, to) => {
    const v = box.view, was = from.pop();
    if (!was) return true;
    to.push(snap(v.state));
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: was.text }, effects: box.setSegs.of(was.segs),
      selection: { anchor: Math.min(was.at, was.text.length) }, userEvent: "undo" });
    box.lastAt = 0;
    return true;
  };
  const kept = A.EditorView.updateListener.of((u) => {
    if (!u.docChanged) return;
    box.n++;
    if (!u.transactions.some((tr) => tr.isUserEvent("undo"))) {
      const now = Date.now();
      if (now - box.lastAt > 700 || u.transactions.some((tr) => tr.isUserEvent("input.putback"))) box.undo.push(snap(u.startState));
      box.lastAt = now;
      box.redo = [];
    }
    if (!s.redraw) s.redraw = requestAnimationFrame(() => { s.redraw = 0; if (ed.s === s) edConflicts(s); });   // its marks above
  });
  const host = el("div", { class: "ed-box" });
  box.note = el("div", { class: "ed-cf-again", hidden: "" });
  box.err = el("div", { class: "ed-cf-err", hidden: "" });
  const branch = c.agent, who = branch ? edActor(branch.gatherer, branch.channel) : null, color = branch ? edWhoColor(who) : null;
  const nm = branch ? (who ? edWhoName(who) : branch.branch) : edConflictBy(s, c).label;
  const btn = (label, title, f, cls) => el("button", { type: "button", class: cls || null, title, onclick: (ev) => { ev.preventDefault(); f(); } }, label);
  box.dom = el("div", { class: "ed-cf editing" + (branch ? " from-branch" : ""), style: color ? `--who: ${color}` : null },
    el("div", { class: "ed-cf-head" }, branch && who && who.avatar ? el("span", { class: "ed-avs" }, el("img", { src: avatarSrc(who.avatar), alt: "", draggable: "false" })) : null,
      el("span", { class: "what", text: `Editing ${nm ? `${nm}'s` : "the file's"} lines${branch ? ", from its branch" : ""}: what you leave here goes in place of your lines above` }),
      el("span", { class: "grow" }),
      btn("Accept edit", branch ? "Put these lines in the file, in place of yours above; the actor is told what you changed of its" : "Put these lines in the file, in place of yours above",
        () => edBoxDone(s, c.id), "primary"),
      btn("Cancel", "Close the box: your lines and the file as they are", () => { edBoxClose(s, c.id); edConflicts(s); edHead(); })),
    box.note,
    el("div", { class: "ed-cf-label" }, "Its lines, to edit here: ", el("span", { class: "ed-del", text: "taken out of yours" }), ", ",
      el("span", { class: "ed-add", text: "put in" }), ". Click a struck piece to put it back."),
    host, box.err);
  box.view = new A.EditorView({
    parent: host,
    state: A.EditorState.create({
      doc: c.theirs,
      extensions: [
        A.keymap.of([{ key: "Mod-z", preventDefault: true, run: () => back(box.undo, box.redo) },
          { key: "Mod-Shift-z", preventDefault: true, run: () => back(box.redo, box.undo) },
          { key: "Mod-y", preventDefault: true, run: () => back(box.redo, box.undo) },
          { key: "Mod-s", preventDefault: true, run: () => true }]),
        A.basicSetup, A.EditorState.lineSeparator.of("\n"), A.highlight, A.language(s.path), box.field, kept,
        ed.wrap ? A.EditorView.lineWrapping : [],
      ],
    }),
  });
  s.boxes.set(c.id, box);
  s.conflicts.sig = "";
  edConflicts(s); edHead();
  requestAnimationFrame(() => { box.view.focus(); box.view.dispatch({ selection: { anchor: box.view.state.doc.length } }); });
}
function edBoxClose(s, id) {
  const box = s.boxes.get(id);
  if (!box) return;
  s.boxes.delete(id);
  box.view.destroy();
  if (s.conflicts) s.conflicts.sig = "";
}
// Its lines changed again on disk (or on its branch), or the reader's above: said, with a way to begin again from them.
function edBoxAgain(s, c, box) {
  const doc = s.view.state.doc, from = Math.min(c.from, doc.length);
  const mine = doc.sliceString(from, Math.min(Math.max(c.to, from), doc.length));
  const theirsNew = c.theirs !== box.theirs, mineNew = mine !== box.mine;
  const sig = `${theirsNew}|${mineNew}`;
  if (sig === box.noteSig) return;
  box.noteSig = sig;
  box.note.hidden = !(theirsNew || mineNew);
  box.note.replaceChildren(...(theirsNew || mineNew ? [
    theirsNew ? "Its lines changed again since you began editing them." : "Your lines above changed since you began.",
    el("button", { type: "button", title: "Begin again: its lines as they are now, against your lines as they are now (what you changed here is dropped)",
      onclick: (ev) => {
        ev.preventDefault();
        const d = s.view.state.doc, f = Math.min(c.from, d.length), cur = (s.state.conflicts || []).find((x) => x.id === c.id) || c;
        box.mine = d.sliceString(f, Math.min(Math.max(cur.to, f), d.length)); box.theirs = cur.theirs;
        box.undo = []; box.redo = []; box.noteSig = "";
        box.view.dispatch({ changes: { from: 0, to: box.view.state.doc.length, insert: cur.theirs },
          effects: box.setSegs.of(edSegsFrom(box.mine, cur.theirs)), userEvent: "undo" });
        box.err.hidden = true;
        edConflicts(s);
      } }, theirsNew ? "Start again from its new lines" : "Start again")] : []));
}
async function edBoxDone(s, id) {
  const box = s.boxes.get(id);
  if (!box) return;
  for (let i = 0; i < 100 && (s.sending || s.out.length) && !s.err; i++) await new Promise((r) => setTimeout(r, 20));   // the file's last keys first
  try {
    s.state = await post("/api/edit/settle", { path: s.path, root: s.root, conflict: id, take: "edited",
      text: box.view.state.doc.toString(), theirs: box.theirs, mine: box.mine });
    s.err = "";
    edBoxClose(s, id);
  } catch (e) { box.err.textContent = e.message; box.err.hidden = false; }
  if (ed.s === s) { edConflicts(s); edHead(); }
}
function edUnmark(s) {
  if (s.view) s.view.dispatch({ effects: s.marks.clear.of(null) });
  s.marked = false;
  edHead();
}
function edToConflict(s) {                             // the first conflict, shown
  const c = ((s.state && s.state.conflicts) || [])[0];
  if (c && s.view) s.view.dispatch({ effects: s.A.EditorView.scrollIntoView(Math.min(c.from, s.view.state.doc.length), { y: "center" }) });
}
// The disk's change, marked where it landed -- each line it touched, and the text it put there -- until the next
// one, or until the reader clears it (the header's ×).
function edDiskMarks(s, delta) {
  queueMicrotask(() => {                             // once y-codemirror has put the change in the editor
    const v = s.view;
    if (!v || ed.s !== s) return;
    const A = s.A, doc = v.state.doc, len = doc.length, n = ++s.markN, out = [], lines = new Set(), within = new Map();
    s.who = edWho(s.path);
    const color = edWhoColor(s.who), attributes = color ? { style: `--who: ${color}` } : undefined;
    const mark = (a, b) => out.push(A.Decoration.mark({ class: "ed-disk", n, attributes }).range(a, b));
    const part = (line, a, b) => { if (!within.has(line.from)) within.set(line.from, []); within.get(line.from).push([a, b]); };
    let pos = 0;
    for (const op of delta) {
      if (op.retain) pos += op.retain;
      else if (op.insert) {
        const k = typeof op.insert === "string" ? op.insert.length : 1, a = Math.min(pos, len), b = Math.min(pos + k, len);
        if (b > a) {                                 // its first and last lines' parts by word (edWords); the lines between whole
          const first = doc.lineAt(a), last = doc.lineAt(b);
          if (first.number === last.number) part(first, a, b);
          else {
            part(first, a, first.to);
            if (last.from > first.to + 1) mark(first.to + 1, last.from - 1);
            if (b > last.from) part(last, last.from, b);
          }
        }
        let p = a;
        do { const line = doc.lineAt(p); lines.add(line.from); p = line.to + 1; } while (p < b && lines.size < 2000);
        pos += k;
      } else if (op.delete) lines.add(doc.lineAt(Math.min(pos, len)).from);
    }
    for (const [from, parts] of within) for (const [a, b] of edWords(doc.lineAt(from), parts)) mark(a, b);
    for (const from of lines) out.push(A.Decoration.line({ class: "ed-disk-line", n, attributes }).range(from));
    if (!out.length) return;
    v.dispatch({ effects: [s.marks.clear.of(null), s.marks.add.of(out)] });
    s.marked = true;
    edHead();
  });
}
// What a change put in a line, to mark, by word: it is put in by character (editor.py's change), so that what others type
// stays where it is -- which leaves a rewritten line in bits, the letters old and new have in common not put in. Each
// part grown to the words it falls in; parts apart by spaces only, or one mark between words, joined; and a line it
// mostly put in (most of its letters), marked from its first letter to its last.
const ED_WORD = /[\p{L}\p{N}_]/u, ED_MOSTLY = 0.6;   // ED_MOSTLY: of a line's letters put in, it is marked whole
function edWords(line, parts) {
  const t = line.text, w = (i) => i >= 0 && i < t.length && ED_WORD.test(t[i]);
  const grown = parts.map(([a, b]) => {
    a -= line.from; b -= line.from;
    while (a > 0 && w(a - 1) && w(a)) a--;
    while (b < t.length && w(b - 1) && w(b)) b++;
    return [a, b];
  }).sort((x, y) => x[0] - y[0]);
  const joined = [];
  for (const [a, b] of grown) {
    const prev = joined[joined.length - 1], gap = prev ? t.slice(prev[1], a) : null;
    if (prev && (a <= prev[1] || /^\s*$/.test(gap) || /^\s*[^\p{L}\p{N}_\s]\s*$/u.test(gap))) prev[1] = Math.max(prev[1], b);
    else joined.push([a, b]);
  }
  const letters = (x) => x.replace(/\s+/g, "").length;
  const put = joined.reduce((k, [a, b]) => k + letters(t.slice(a, b)), 0), all = letters(t);
  if (all && put / all >= ED_MOSTLY) {
    const a = t.length - t.trimStart().length, b = t.trimEnd().length;
    return b > a ? [[line.from + a, line.from + b]] : [];
  }
  return joined.filter(([a, b]) => b > a).map(([a, b]) => [line.from + a, line.from + b]);
}
// This page's edits, sent a burst at a time, one request at a time; kept to send again if one fails.
function edFlush(s) {
  if (s.sending || !s.out.length || !s.epoch || ed.s !== s) return;
  s.sending = true;
  setTimeout(async () => {
    const u = s.out.length === 1 ? s.out[0] : s.A.Y.mergeUpdates(s.out);
    s.out = [];
    try {
      s.state = await post("/api/edit/update", { path: s.path, root: s.root, conn: s.conn, update: edB64(u) }, true);
      s.err = "";
    } catch (e) {
      s.out.unshift(u);
      s.err = e.message;
      setTimeout(() => edFlush(s), 2000);
    }
    s.sending = false;
    if (ed.s === s) { edHead(); if (s.out.length && !s.err) edFlush(s); }
  }, ED_SEND);
}
// This page's user and cursor, to the others: at most one request at a time, the latest after it.
function edAware(s) {
  if (!s.epoch) return;
  if (s.awareAt) { s.awareAgain = true; return; }
  s.awareAt = Date.now();
  post("/api/edit/aware", { path: s.path, root: s.root, conn: s.conn,
    update: edB64(s.A.encodeAwarenessUpdate(s.awareness, [s.doc.clientID])) }).catch(() => {}).finally(() => {
    s.awareAt = null;
    if (s.awareAgain) { s.awareAgain = false; edAware(s); }
  });
}
async function edSave(s) {
  for (let i = 0; i < 100 && (s.sending || s.out.length) && !s.err; i++) await new Promise((r) => setTimeout(r, 20));   // its last keys first
  try { s.state = await post("/api/edit/save", { path: s.path, root: s.root }); s.err = ""; }
  catch (e) { s.err = e.message; }
  if (ed.s === s) edHead();
}
// Auto-save: the file saved ED_AUTO_MS after the last edit to it, this page's or another's -- not a file deleted on disk,
// which only Save writes again, nor one with a conflict with the file on disk, which waits for the reader (an actor's
// branch's change waiting does not hold it back: the file has none of it).
const edDiskConflicts = (s) => ((s && s.state && s.state.conflicts) || []).filter((c) => !c.agent);
function edAutoLater(s) {
  clearTimeout(s.autoT);
  const due = () => ed.auto && ed.s === s && s.state && s.state.dirty && !s.state.missing && !edDiskConflicts(s).length;
  if (due()) s.autoT = setTimeout(() => { if (due()) edSave(s); }, ED_AUTO_MS);
}
function edSetWrap(on) {
  ed.wrap = on;
  try { localStorage.setItem(ED_WRAP_KEY, on ? "1" : "0"); } catch (e) { /* this page only */ }
  if (ed.body) ed.body.classList.toggle("wrap", on);
  const s = ed.s;
  if (s && s.view && s.wrapping) s.view.dispatch({ effects: s.wrapping.reconfigure(on ? s.A.EditorView.lineWrapping : []) });
  edHead();
}
function edSetAuto(on) {
  ed.auto = on;
  try { localStorage.setItem(ED_AUTO_KEY, on ? "1" : "0"); } catch (e) { /* this page only */ }
  if (ed.s) edAutoLater(ed.s);
  edHead();
}
function edClose() {
  edViewClose();
  const s = ed.s;
  if (!s) return;
  ed.s = null;
  edSendClose();                                     // its lines' Send to an actor, gone with it
  edSendPlace();
  clearTimeout(s.autoT);
  edKeepPlace(s, edHadKeys(s));                      // where it was, for the next time this Editor's panel is drawn
  ed.keys = false;
  // its last keys, still sent, and -- auto-saved -- saved, not over a conflict: in one request, which outlives the panel
  // (taken away with its task, the page closed), where a second one sent after the first would never be
  const save = ed.auto && s.epoch && (s.out.length || (s.state && s.state.dirty && !s.state.missing)) && !edDiskConflicts(s).length;
  let sent = Promise.resolve();
  if (s.out.length && s.epoch) {
    const u = s.A.Y.mergeUpdates(s.out);
    sent = post("/api/edit/update", { path: s.path, root: s.root, conn: s.conn, update: edB64(u), ...(save ? { save: true } : {}) }, true);
  } else if (save) sent = post("/api/edit/save", { path: s.path, root: s.root }, true);
  sent.catch(() => {});
  for (const id of [...s.boxes.keys()]) edBoxClose(s, id);
  s.awareness.setLocalState(null);                   // its cursor gone from the others' at once
  s.awareness.destroy();
  if (s.es) s.es.close();
  if (s.view) s.view.destroy();
  s.doc.destroy();
}
function edReopen(s) {
  const lost = s.state && s.state.dirty;
  edClose();
  edOpen(s.path, s.info && s.info.kind !== "text" ? "edit" : null).then(() => {
    if (lost && ed.s) { ed.s.note = "The dashboard restarted, and this file's unsaved changes there were lost: it was opened again from disk."; edHead(); }
  });
}
window.addEventListener("pagehide", edClose);

function edHead() {
  if (!ed.head) return;
  const s = ed.s;
  if (ed.v && ed.v.path === ed.file) return edViewHead(ed.v);
  if (!ed.file) {
    ed.head.replaceChildren(el("span", { class: "ed-hint", text: "Pick a file to open it. Text opens to edit: everyone with it open sees the others' edits as they type, and what an actor writes to it shows here as it lands. Images, PDFs, sound and video open to look at." }),
      el("span", { class: "grow", style: "flex: 1" }), edModePick(), edExecBtn());
    return;
  }
  const st = s && s.state;
  const all = (st && st.conflicts) || [], proposed = all.filter((c) => c.agent && c.agent.put && c.agent.why === "approve");
  const nc = edDiskConflicts(s).length, np = proposed.length, na = all.length - nc - np, nb = s ? s.boxes.size : 0;
  const nasked = all.filter((c) => c.asked).length;
  const [cls, said] = ed.err || (s && s.err) ? ["bad", ed.err || s.err]
    : nb ? ["warn", `Editing ${nb > 1 ? `${nb} changes` : "a change"} in ${nb > 1 ? "their boxes" : "its box"}: Accept edit or Cancel there`]
    : nasked && nasked === nc ? ["warn", `${plural(nasked, "change")} on disk to review`]
    : nc ? ["bad", `${plural(nc, "conflict")} with the file on disk`]
    : np ? ["warn", `${plural(np, "change")} to review`]
    : na ? ["warn", `${plural(na, "change")} held for you`]
    : !s || !s.epoch ? ["", "Opening…"]
    : s.es.readyState !== 1 ? ["warn", "Reconnecting…"]
    : st && st.missing ? ["bad", "Deleted on disk: Save writes it again"]
    : st && st.error ? ["bad", st.error]
    : st && st.dirty ? (ed.auto ? ["", "Saving…"] : ["warn", "Unsaved"]) : ["ok", "Saved"];
  const others = s ? [...s.awareness.getStates().entries()].filter(([id, v]) => id !== s.doc.clientID && v && v.user) : [];
  // who changed it on disk last: the actor whose recorded change is nearest it, else (not yet recorded) the likely one
  const writers = edWriters(edEntry(ed.file));
  if (ed.changes && ed.changes.path !== ed.file) edDrawChanges();          // another file: its panel closed
  else if (ed.changes) {                                                   // the actor changed it again: fetched again
    const w = writers.find((x) => edKey(x) === ed.changes.k);
    if (w && w.at > ed.changes.seen) { ed.changes.seen = w.at; ed.changes.w = w; edFetchChanges(); }
  }
  let changed = null;
  if (st && st.changed && (s.marked || Date.now() / 1000 - st.changed < 120)) {
    const near = edCredit(writers, st.changed);
    const who = near ? near.actor : s.who, color = edWhoColor(who);
    changed = el("span", { class: "ed-changed", style: color ? `--who: ${color}` : null,
      title: near ? `By ${edWriterName(near)}, as ag's hook recorded the actor's change` : s.who ? `Likely by ${edWhoName(s.who)}: the one actor running in a directory that holds the file, until ag records who it was`
        : "Written to the file by something other than this editor" },
      `Changed on disk ${ago(st.changed)}`,
      s.marked ? el("button", { type: "button", class: "ed-unmark", title: "Clear the marks of what changed on disk", "aria-label": "Clear the marks",
        onclick: () => edUnmark(s) }, "×") : null);
  }
  const zoned = s && st && (st.zone || []).length ? el("span", { class: "ed-zone-chip",
    title: "The lines edited here since the file was opened, tinted: an actor's change to them is asked about, not merged in. Cleared when the file is closed, or by Clear." },
    "Conflict zone", el("button", { type: "button", title: "Clear the conflict zone: the actors' changes to its lines merge in, as anywhere else",
      onclick: () => edClearZone(s) }, "Clear")) : null;
  const by = edByChip(writers);
  ed.head.replaceChildren(...[
    el("span", { class: "ed-path", title: ed.file, text: edRel(ed.file) }),
    (nc || na || np) && !(ed.err || (s && s.err)) ? el("button", { type: "button", class: `ed-status ${cls}`, role: "status",
      title: nc && nasked !== nc ? "Show the first: keep yours, take the file's, or both" : "Show the first: accept it, or reject it",
      onclick: () => edToConflict(s) }, said) : el("span", { class: `ed-status ${cls}`, role: "status", text: said }),
    np > 1 && !nb ? el("span", { class: "ed-all" },
      el("button", { type: "button", title: "Accept every change proposed here: each written to the file on disk, and its actor told", onclick: () => edSettleAll(s, "theirs") }, "Accept all"),
      el("button", { type: "button", title: "Reject every change proposed here: the file keeps its lines, and the actors are told", onclick: () => edSettleAll(s, "mine") }, "Reject all")) : null,
    zoned, by, changed,
    s && s.note ? el("span", { class: "ed-status bad", text: s.note }) : null,
    el("span", { class: "ed-people" },
      ...others.map(([, v]) => el("span", { class: "ed-person", style: `--who: ${v.user.color}`, title: `${v.user.name} has it open`, text: v.user.name })),
      s ? el("button", { type: "button", class: "ed-person", style: `--who: ${edMe().color}`, title: "You, as the others see you: click to change your name",
        onclick: edRename, text: `${edMe().name} (you)` }) : null),
    el("button", { type: "button", class: "ed-wrap" + (ed.wrap ? " on" : ""), "aria-pressed": ed.wrap ? "true" : "false",
      title: ed.wrap ? "Long lines wrapped, here and in the boxes of changes to merge: click to scroll them instead"
        : "Wrap long lines, here and in the boxes of changes to merge, so they read whole without scrolling",
      "aria-label": "Wrap long lines", onclick: () => edSetWrap(!ed.wrap) }, strokeIcon(ICONS.wrap, 15)),
    el("label", { class: "ed-auto", title: "Save the file a moment after each edit to it, yours or another's: the actors read it as it is typed. Not while a conflict with the file waits." },
      el("input", { type: "checkbox", checked: ed.auto ? "" : null, onchange: (ev) => edSetAuto(ev.target.checked) }), "Auto-save"),
    edModePick(),
    s && s.info && s.info.kind !== "text" ? el("button", { type: "button", class: "ed-mode", title: `Show ${edBase(s.path)} as ${ED_VIEW_SAID[s.info.kind] === "image" ? "an image" : `a ${ED_VIEW_SAID[s.info.kind]}`}`,
      onclick: () => edOpen(s.path, "view") }, strokeIcon(ICONS.page, 13), "View") : null,
    edTexToPdf() ? el("button", { type: "button", class: "ed-topdf", onclick: () => edToPdf(),
      title: "Show the cursor's line in the PDF beside (SyncTeX), or double-click a word of the source. Double-click the PDF to come back to its source." }, "→ PDF") : null,
    edExecBtn(),
    el("button", { type: "button", class: "primary", title: nc ? "Write it to the file on disk, your lines kept where they conflict (⌘S / Ctrl+S)" : "Write it to the file on disk (⌘S / Ctrl+S)",
      disabled: s && st && (st.dirty || st.missing) ? null : "", onclick: () => s && edSave(s) }, "Save"),
    ].filter(Boolean));
}

// The actors changing the file open: their avatars -- each pressed, its changes to it in the last minutes (edChanges) --
// and, two or more, how many.
function edByChip(writers) {
  if (!writers.length) return null;
  const many = writers.length > 1;
  return el("span", { class: "ed-writers" + (many ? " many" : ""),
    title: `${many ? `${writers.length} actors are changing this file` : "The actor changing this file"} (in the last half hour):\n`
      + writers.map((w) => `${edWriterName(w)}, ${ago(w.at)}`).join("\n") },
    el("span", { class: "ed-avs" }, ...writers.slice(0, 4).map((w) => el("button", { type: "button",
      class: "ed-av" + (ed.changes && ed.changes.k === edKey(w) ? " on" : ""), "aria-label": `${edWriterName(w)}'s changes to this file`,
      title: `${edWriterName(w)}: its changes to this file in the last ${ED_CHANGES_S / 60} minutes`, onclick: () => edChanges(w) }, edAvatar(w)))),
    many ? el("span", { class: "lbl", text: `${writers.length} actors changing it` }) : null);
}

// The panel: in the dashboard's top row, above the actors' panes, as the Browser's and DocWriter's are -- closed by the
// head the dashboard draws over it. Its folder is the one it was started on (its instance's), until the reader shows
// another (kept in this browser, for this Editor).
const edShown = () => true;
const edRootKey = () => `${ED_ROOT_KEY}:${(agApp && agApp.instance) || ""}`;
// The file open in this Editor -- {path, how (edOpen's), at: where it was (edKeepPlace) or null} -- kept in this browser as
// its folder is: its panel goes when the reader goes to another task (the dashboard's enterTask), or the page reloads,
// and drawn again it opens the file again, where it was (edMount).
const edFileKey = () => `${ED_FILE_KEY}:${(agApp && agApp.instance) || ""}`;
function edKeepFile(v) {
  try { if (v) localStorage.setItem(edFileKey(), JSON.stringify(v)); else localStorage.removeItem(edFileKey()); }
  catch (e) { /* this page only */ }
}
function edKeptFile() {
  try { const v = JSON.parse(localStorage.getItem(edFileKey()) || "null"); return v && typeof v.path === "string" && v.path ? v : null; }
  catch (e) { return null; }
}
// Execute: the project's preview run, beside the file (edExecute).
function edExecBtn() {
  if (!edRuns()) return null;
  return el("button", { type: "button", class: "ed-exec",
    title: "Run this project's preview, and show what it makes beside: the first time, set what it runs (⌘↵ / Ctrl+Enter)",
    onclick: edExecute, "aria-keyshortcuts": MAC ? "Meta+Enter" : "Control+Enter" }, strokeIcon(ICONS.play, 13), "Execute");
}
// Drawn the first time, and its folder shown: the one last shown in this Editor, else the one it was started on -- and the
// file it last had open, if any, where it was.
function edMount() {
  const top = document.getElementById("ed-top");
  if (!ed.host) {
    ed.bar = el("div", { class: "ed-bar" });
    ed.tree = el("div", { class: "ed-rows", role: "tree", "aria-label": "The folder's files" });
    ed.head = el("div", { class: "ed-head" });
    ed.body = el("div", { class: "ed-body" + (ed.wrap ? " wrap" : "") });
    ed.body.addEventListener("mousedown", edToPdfClick, true);     // before CodeMirror's: a double-click, to the PDF too
    ed.side = el("aside", { class: "ed-changes files", hidden: "", "aria-label": "An actor's changes to the file" });
    ed.brs = el("div", { class: "ed-brs" });
    const nav = ed.nav = el("nav", { class: "ed-tree", id: "ed-files", "aria-label": "Files" }, ed.bar, ed.brs, ed.tree);
    ed.fold = el("button", { type: "button", class: "ed-fold", hidden: "", "aria-label": "Show the files",
      "aria-controls": "ed-files", "aria-expanded": "false", onclick: () => edFoldTree(false) });
    const colGrip = () => el("div", { class: "ed-col-grip", role: "separator", "aria-orientation": "vertical",
      title: "Drag to resize · double-click: the width it had first" });
    const treeGrip = colGrip(), sideGrip = colGrip(), pvGrip = colGrip();
    ed.pv = el("section", { class: "ed-pv", hidden: "", "aria-label": "The project's preview" });
    ed.host = el("div", { class: "ed" }, ed.fold, nav, treeGrip,
      el("div", { class: "ed-main" }, ed.head, el("div", { class: "ed-work" }, ed.body, sideGrip, ed.side, pvGrip, ed.pv)));
    ed.host.addEventListener("keydown", edExecKey, true);          // ⌘↵: Execute
    widthGrip(treeGrip, "ag-dashboard-editor-tree-width", nav, "width", 120, (x) => x - nav.getBoundingClientRect().left);
    widthGrip(sideGrip, "ag-dashboard-editor-changes-width", ed.side, "width", 200, (x) => ed.side.getBoundingClientRect().right - x);
    widthGrip(pvGrip, "ag-editor-preview-width", ed.pv, "width", 220, (x) => ed.pv.getBoundingClientRect().right - x);
    top.replaceChildren(ed.host);
    edTreeWire(nav);
    pvMount(ed.pv);
    let folded = false;
    try { folded = localStorage.getItem(ED_TREE_FOLDED_KEY) === "1"; } catch (e) { /* this page only */ }
    edFoldTree(folded, false);
  }
  if (!ed.root) {
    let dir = "";
    try { dir = localStorage.getItem(edRootKey()) || ""; } catch (e) { /* this page only */ }
    edGo(dir || (agApp && agApp.folder) || state.home.cwd || "/");
  }
  if (!ed.file) {                                    // the file it had open, opened again where it was
    const kept = edKeptFile();
    if (kept) edOpen(kept.path, kept.how === "edit" || kept.how === "view" ? kept.how : null, kept);
  }
  edTick();
}
