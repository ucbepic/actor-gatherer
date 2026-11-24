// ------------------------------------------------------------------ who changed the paper on Overleaf
// For a folder synced with an Overleaf project (Overleaf's Dropbox sync, or a project the reader names): the file open's
// lines that someone changed on Overleaf -- a co-author typing there or in their own Dropbox copy, or the reader on
// overleaf.com -- marked as an actor's change is (recent.js): a bar in the person's colour, their initials after the
// first line, who and when on hover. Its backend reads Overleaf's history as the reader (overleaf.py), once they have
// signed in from here: a Chrome window of its own opens on Overleaf's sign-in, and closes once they are in.
//
// Who changed the project there in the window (recent.js's: the last 30 min, …), each by their initials, as actors are
// shown by their avatars: in the header, beside the actors' (everyone who changed any of its files), and on the tree's
// rows (a file they changed, a closed folder with one in it). Their initials pressed: their latest change -- in the
// project, the file or the folder -- opened, its lines selected. The header's "Overleaf" button, pressed: its menu --
// sign in (or again, once it lapsed), sign out, the project (the folder's own, or one linked by its link). Who changed
// which file, and the open file's lines, are asked for every OL_EVERY ms while a project is known.
import { agApp, ago, el, get, HUE_MAIN, paneNote, post } from "/_ag/lib/fileedit/page.js";
import { ed, edHead, edRel, edShowFile, edUnder } from "/_ag/lib/fileedit/editor.js";
import { edTree } from "/_ag/lib/fileedit/editor-tree.js";
import { edSince, edWindowSaid } from "/_ag/lib/fileedit/recent.js";

const OL_EVERY = 5000;           // ms between asks for the file open's lines, while it is open
const OL_SIGNING_EVERY = 1500;   // ms between looks at the sign-in, while its window is open

ed.ol = { view: null, lines: [], people: [], path: "", err: "", pop: null, timer: 0, asking: false,
  files: {}, everyone: [], filesSig: "", goto: null };   // who changed which file (overleaf/files); a latest change to go to

const hues = Object.values(HUE_MAIN);
// A person's colour: always the same one for them.
function olColor(p) {
  let h = 0;
  for (const c of String(p.id || p.name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return hues[h % hues.length];
}
const olInitials = (p) => (String(p.name || "?").match(/\b\p{L}/gu) || ["?"]).slice(0, 2).join("").toUpperCase();
const olNames = (who) => who.map((p) => p.name).join(" and ");

// What the backend says of the sign-in and the project (GET overleaf): asked as the panel starts, after each change from
// the menu, and while a sign-in's window is open.
async function olLoad() {
  try { ed.ol.view = await get("/api/overleaf"); ed.ol.err = ""; }
  catch (e) { ed.ol.err = e.message; }
  const v = ed.ol.view;
  clearTimeout(ed.ol.signing);
  if (v && v.signing && v.signing.state === "open") ed.ol.signing = setTimeout(olLoad, OL_SIGNING_EVERY);
  edHead(); olDrawPop(); olAsk(true); olFiles();
}

// Who changed which of the project's files in the window (GET overleaf/files): the tree and the header drawn again
// when it changed.
async function olFiles() {
  const v = ed.ol.view;
  let got = { files: {}, people: [] };
  if (v && v.project) {
    try { got = await get(`/api/overleaf/files?${new URLSearchParams({ since: String(edSince()) })}`); }
    catch (e) { ed.ol.err = e.message; return; }
  }
  const sig = JSON.stringify([got.files, got.people.map((p) => [p.id, p.at])]);
  if (sig === ed.ol.filesSig) return;
  ed.ol.filesSig = sig; ed.ol.files = got.files || {}; ed.ol.everyone = got.people || [];
  ed.treeSig = ""; edTree(); edHead();
}

// The file open's lines changed on Overleaf (GET overleaf/changes), marked.
async function olAsk(force = false) {
  const s = ed.s, v = ed.ol.view;
  if (!s || !s.view || !s.ol || !v || !v.project || ed.ol.asking) { if (s && s.ol && (!v || !v.project)) olMark(s, []); return; }
  if (!force && document.hidden) return;
  ed.ol.asking = true;
  try {
    const got = await get(`/api/overleaf/changes?${new URLSearchParams({ path: s.path, root: s.root, since: String(edSince()) })}`);
    if (ed.s !== s) return;
    if (got.signed_out) { ed.ol.view = { ...v, signed_in: null, project: null, signed_out: got.signed_out }; ed.ol.lines = []; ed.ol.people = []; }
    else { ed.ol.lines = got.lines || []; ed.ol.people = got.people || []; }
    ed.ol.err = got.error || ""; ed.ol.path = s.path;
    olMark(s, ed.ol.lines);
    olGoDue(s);
    edHead();
  } catch (e) { ed.ol.err = e.message; }
  finally { ed.ol.asking = false; }
}

// The marks: each line the backend credits, found where it is now (the line it names, else the nearest with its text --
// edits made since moved it; not found, left out).
function olMark(s, lines) {
  const v = s.view, A = s.A;
  if (!v || !s.ol) return;
  const doc = v.state.doc, found = [];
  for (const l of lines) {
    let n = 0;
    for (let d = 0; d <= 40 && !n; d++) {
      for (const k of d ? [l.line - d, l.line + d] : [l.line]) if (k >= 1 && k <= doc.lines && doc.line(k).text === l.text) { n = k; break; }
    }
    if (n) found.push([n, l]);
  }
  found.sort((a, b) => a[0] - b[0]);
  s.ol.found = found;
  const sig = JSON.stringify(found.map(([n, l]) => [n, l.at, l.who.map((p) => p.id || p.name)]));
  if (sig === s.ol.sig) return;
  s.ol.sig = sig;
  const out = [];
  let prev = null;
  for (const [n, l] of found) {
    const line = doc.line(n), who = l.who[0], key = l.who.map((p) => p.id || p.name).join(",");
    const what = [olPieces("added", l.inserted), olPieces("removed", l.deleted)].filter(Boolean).join("; ");
    out.push(A.Decoration.line({ class: "ed-ol", attributes: { style: `--who: ${olColor(who)}`,
      title: `Changed by ${olNames(l.who)} on Overleaf, ${ago(l.at)}${what ? ` · ${what}` : ""}` } }).range(line.from));
    if (!prev || prev.key !== key || prev.n !== n - 1) out.push(A.Decoration.widget({ widget: new (olChipWidget(A))(l.who), side: 1 }).range(line.to));
    prev = { key, n };
  }
  v.dispatch({ effects: s.ol.set.of(A.Decoration.set(out, true)) });
}
// ---- a person's latest change, gone to
const olKey = (p) => p.id || p.name;
// Their latest change under `under` (a file, a folder; null: the whole project): its file opened, and -- once its lines
// are in (olAsk) -- the first line of it selected.
function olGoTo(p, under = null) {
  let best = null;
  for (const [path, by] of Object.entries(ed.ol.files)) {
    if (under && !edUnder(path, under)) continue;
    const mine = by.find((x) => olKey(x) === olKey(p));
    if (mine && (!best || mine.at > best.at)) best = { path, at: mine.at };
  }
  if (!best) { paneNote(`${p.name} changed nothing here on Overleaf in the last ${edWindowSaid()}`); return; }
  ed.ol.goto = { path: best.path, key: olKey(p), name: p.name };
  if (ed.s && ed.s.path === best.path && ed.ol.path === best.path) olGoDue(ed.s);
  else edShowFile(best.path);                      // its lines asked for as it opens (olParts' viewed)
}
// The change to go to, if its file's lines are in: the first line of their latest one, selected.
function olGoDue(s) {
  const g = ed.ol.goto;
  if (!g || !s || s.path !== g.path || !s.ol || ed.ol.path !== g.path) return;
  ed.ol.goto = null;
  let at = -1, line = 0;
  for (const [n, l] of s.ol.found || []) {
    if (!l.who.some((x) => olKey(x) === g.key)) continue;
    if (l.at > at + 1) { at = l.at; line = n; }          // the latest; of one change's lines, its first
  }
  if (line) edShowFile(g.path, line);
  else paneNote(`${g.name} changed ${edRel(g.path)} on Overleaf, but not on lines as they are here (not synced yet, or only deleted)`);
}

// "added “three”, “components”": a line's pieces, each quoted, the first few.
const olPieces = (did, list) => !list || !list.length ? ""
  : `${did} ${list.slice(0, 3).map((t) => `“${t.length > 60 ? t.slice(0, 60) + "…" : t}”`).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`;
let OlChip = null;
function olChipWidget(A) {
  return OlChip ||= class extends A.WidgetType {
    constructor(who) { super(); this.who = who; }
    eq(o) { return olNames(o.who) === olNames(this.who); }
    toDOM() { return el("span", { class: "ed-ol-chip", title: `${olNames(this.who)}, on Overleaf` }, ...this.who.slice(0, 2).map(olChip)); }
    ignoreEvent() { return true; }
  };
}
const olChip = (p) => el("span", { class: "ed-ol-who", style: `--who: ${olColor(p)}`, text: olInitials(p) });
// A person's initials, pressed: their latest change under `under` (olGoTo).
function olChipButton(p, under, what) {
  return el("button", { type: "button", class: "ed-ol-who", style: `--who: ${olColor(p)}`, "aria-label": `${p.name}'s latest change`,
    title: `${p.name} changed ${what} on Overleaf, latest ${ago(p.at)} · click to go to it`,
    onmousedown: (ev) => ev.stopPropagation(),
    onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); olGoTo(p, under); } }, olInitials(p));
}
// Beside the header's actors' avatars: everyone who changed the project in the window, the latest first.
function olWho(x) {
  const v = ed.ol.view, all = ed.ol.everyone;
  if (!v || !v.project || !all.length || (x && x !== ed.s)) return null;
  return el("span", { class: "ed-ol-people", title: `Changed on Overleaf in the last ${edWindowSaid()}` },
    ...all.slice(0, 5).map((p) => olChipButton(p, null, `${p.files} file${p.files === 1 ? "" : "s"} (latest ${edRel(p.path)})`)),
    all.length > 5 ? el("span", { class: "n", text: `+${all.length - 5}` }) : null);
}
// On a tree's row: who changed the file, or (a closed folder's) one in it.
function olRowMarks(path, dir) {
  const by = new Map();
  for (const [p, people] of Object.entries(ed.ol.files)) {
    if (dir ? !edUnder(p, path) : p !== path) continue;
    for (const x of people) if (!by.has(olKey(x)) || by.get(olKey(x)).at < x.at) by.set(olKey(x), x);
  }
  if (!by.size) return null;
  const people = [...by.values()].sort((a, b) => b.at - a.at);
  return el("span", { class: "ed-ol-row" }, ...people.slice(0, 3).map((p) => olChipButton(p, path, dir ? "files in it" : "it")));
}

// Its decorations, in each text file's view (edAdd's view).
function olField(s) {
  const A = s.A, set = A.StateEffect.define();
  const field = A.StateField.define({
    create: () => A.Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(set)) deco = e.value;
      return deco;
    },
    provide: (f) => A.EditorView.decorations.from(f),
  });
  s.ol = { set, sig: "" };
  return field;
}

// ---- the header's button, and its menu
function olButton(x) {
  const v = ed.ol.view;
  if (!v || (x && x !== ed.s)) return null;          // a file shown, not edited (an image, a PDF): none
  if (!v.project && !v.synced && !v.signed_in) return el("button", { type: "button", class: "ed-ol-btn quiet", title: "Link an Overleaf project to see who changed lines there",
    onclick: (ev) => olOpenPop(ev.currentTarget) }, "Overleaf");
  if (!v.signed_in) return el("button", { type: "button", class: "ed-ol-btn want", onclick: (ev) => olOpenPop(ev.currentTarget),
    title: v.signed_out ? "Your Overleaf sign-in lapsed. Sign in again to see who changed lines there." : "Sign in to Overleaf to see who changed lines there" },
    v.signing && v.signing.state === "open" ? "Signing in to Overleaf…" : v.signed_out ? "Overleaf: sign in again" : "Sign in to Overleaf");
  return el("button", { type: "button", class: "ed-ol-btn", onclick: (ev) => olOpenPop(ev.currentTarget),
    title: !v.project ? "No Overleaf project for this folder. Click to link one."
      : `Overleaf project: ${v.project.name}. Who changed it there in the last ${edWindowSaid()} is shown by their initials.` },
    "Overleaf");
}
function olOpenPop(anchor) {
  if (ed.ol.pop) return olClosePop();
  const box = el("div", { class: "ed-sendpop ed-olpop", role: "dialog", "aria-label": "Overleaf" });
  ed.ol.pop = { box, anchor, off: null, linking: false };
  const outside = (ev) => { if (!box.contains(ev.target) && !anchor.contains(ev.target)) olClosePop(); };
  const esc = (ev) => { if (ev.key === "Escape") olClosePop(); };
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", esc, true);
  ed.ol.pop.off = () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); };
  document.body.append(box);
  olDrawPop();
}
function olClosePop() {
  const p = ed.ol.pop;
  if (!p) return;
  ed.ol.pop = null;
  p.off(); p.box.remove();
}
async function olDo(path, body = {}) {
  try { ed.ol.view = await post(`/api/overleaf/${path}`, body); ed.ol.err = ""; }
  catch (e) { ed.ol.err = e.message; }
  if (ed.s && ed.s.ol) ed.s.ol.sig = "";
  await olLoad();
}
function olDrawPop() {
  const p = ed.ol.pop, v = ed.ol.view;
  if (!p || !v) return;
  const rows = [];
  const signing = v.signing && v.signing.state === "open";
  if (!v.signed_in) {
    rows.push(el("div", { class: "ed-ol-say", text: v.signed_out
      ? "Your Overleaf sign-in lapsed. Sign in again to see who changed this paper's lines on Overleaf."
      : "Sign in to Overleaf to see who changed this paper's lines there. A Chrome window opens on Overleaf's sign-in; sign in any way you like, and it closes by itself." }));
    if (signing) rows.push(el("div", { class: "ed-ol-row" }, el("span", { class: "ed-ol-wait", text: "Waiting for you to sign in, in the Chrome window…" }),
      el("button", { type: "button", onclick: () => olDo("cancel") }, "Cancel")));
    else rows.push(el("div", { class: "ed-ol-row" }, el("button", { type: "button", class: "primary", onclick: () => olDo("signin") }, "Sign in")));
    if (v.signing && v.signing.state === "failed") rows.push(el("div", { class: "ed-ol-err", text: v.signing.error || "The sign-in failed." }));
    if (v.signing && v.signing.state === "timeout") rows.push(el("div", { class: "ed-ol-err", text: "The sign-in window closed after waiting a long while." }));
  } else {
    rows.push(el("div", { class: "ed-ol-row" }, el("span", { class: "ed-ol-say", text: `Signed in as ${v.signed_in.email || "you"}` }),
      el("button", { type: "button", onclick: () => olDo("signout") }, "Sign out")));
    rows.push(el("div", { class: "ed-ol-say", text: v.project
      ? `Project: ${v.project.name}${v.project.how === "auto" ? " (this folder is its Dropbox copy)" : " (linked)"}`
      : v.synced ? `No project of yours is called “${v.synced}”. Link it by its Overleaf link:` : "No Overleaf project for this folder. Link one by its Overleaf link:" }));
    const people = ed.ol.path === (ed.s && ed.s.path) ? ed.ol.people : [];
    if (v.project) rows.push(el("div", { class: "ed-ol-say quiet", text: people.length
      ? `Changed ${ed.s ? "this file" : "it"} in the last ${edWindowSaid()}: ${people.map((x) => `${x.name}, ${ago(x.at)}`).join("; ")}`
      : `No one else changed this file on Overleaf in the last ${edWindowSaid()}.` }));
    if (!v.project || p.linking) {
      const input = el("input", { type: "url", class: "ed-ol-url", placeholder: "https://www.overleaf.com/project/…", "aria-label": "The project's Overleaf link" });
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") olDo("link", { url: input.value }); });
      rows.push(el("div", { class: "ed-ol-row" }, input, el("button", { type: "button", onclick: () => olDo("link", { url: input.value }) }, "Link")));
      setTimeout(() => input.focus(), 0);
    } else {
      rows.push(el("div", { class: "ed-ol-row" },
        el("button", { type: "button", onclick: () => { p.linking = true; olDrawPop(); } }, "Link another project…"),
        v.project.how === "set" ? el("button", { type: "button", onclick: () => olDo("link", { url: "" }) }, "Use the folder's own") : null));
    }
  }
  if (ed.ol.err) rows.push(el("div", { class: "ed-ol-err", text: ed.ol.err }));
  p.box.replaceChildren(el("div", { class: "ed-send-hd", text: "Overleaf" }), ...rows);
  const r = p.anchor.getBoundingClientRect(), w = Math.min(360, window.innerWidth - 16);
  p.box.style.width = `${w}px`;
  p.box.style.left = `${Math.round(Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)))}px`;
  p.box.style.top = `${Math.round(r.bottom + 6)}px`;
}

// Its parts, for latex.js to give to edAdd; started once the panel is (olStart).
export const olParts = { head: olButton, who: olWho, marks: olRowMarks, view: olField,
  viewed: (s) => { s.ol.sig = ""; olMark(s, ed.ol.path === s.path ? ed.ol.lines : []); olAsk(true); } };
export function olStart() {
  if (!agApp) return;
  olLoad();
  clearInterval(ed.ol.timer);
  ed.ol.timer = setInterval(() => { olAsk(); if (!document.hidden) olFiles(); }, OL_EVERY);
}
