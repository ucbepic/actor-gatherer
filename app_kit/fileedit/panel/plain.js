// ------------------------------------------------------------------ a text file edited plain
// For an app that edits its files plain (the Files app, which gives edPlain to edAdd as its `plain` part): a text
// file read whole (edit/text: its text and version), edited in this page alone, and saved whole (edit/put) -- by Save,
// ⌘S, or Auto-save a moment after the last edit. No live document, no mode, no conflict zone, no actors' branches. Its
// version is looked at on each tick (edTick): changed on disk with nothing unsaved here, the file is read again, the
// cursor and the view kept where they were; with something unsaved here, the reader chooses -- Reload (theirs dropped)
// or Keep mine (saved over the change) -- and no save goes over the change until they do.
import { el, get, ICONS, MAC, post, strokeIcon } from "./page.js";
import { ed, edAddedHead, edAutoLater, edBase, edByChip, edChangedChip, edEntry, edHead, edOpen,
  edRel, edSave, edSetAuto, edSetWrap, edView, edWriters } from "./editor.js";
import { edRecentFetch } from "./recent.js";

// The session (ed.s) of a file opened plain, its view made -- edOpen's, in place of a live document; its `plain`, this
// part (edPlain).
async function edPlainOpen(path, how, kept, info, A, turn) {
  let got;
  try { got = await get(`/api/edit/text?${new URLSearchParams({ path, root: "/" })}`); }
  catch (e) { if (ed.turn === turn) { ed.err = e.message; edHead(); } return; }
  if (ed.turn !== turn || ed.s) return;
  if (got.missing) { ed.err = "No such file."; edHead(); return; }
  const s = ed.s = { A, plain: edPlain, path, root: "/", view: null, info, how, at: kept ? kept.at : null, text: got.text,
    version: got.version, saved: got.text, err: "", note: "", out: [], sending: false, boxes: new Map(), stale: false,
    loading: false, saving: null, checking: false, epoch: "plain",
    state: { dirty: false, missing: false, conflicts: [], zone: [], marks: [], changed: 0 } };
  edView(s);
  edHead();
}
// An edit typed here (not the file read again): unsaved, and Auto-save due a moment after.
function edPlainEdited(s) {
  if (s.loading) return;
  s.state.dirty = true;
  edAutoLater(s);
  edHead();
}
// Saved: the text as it is here, whole, over the file as this page read it -- refused if it changed on disk since (the
// reader to choose: edPlainStale), unless `force` (their Keep mine).
function edPlainSave(s, force = false, keep = false) {
  if (s.saving) return s.saving;
  if (!s.view || (s.stale && !force)) return Promise.resolve();
  const text = s.view.state.doc.toString();
  const sent = post("/api/edit/put", { path: s.path, root: s.root, text, base: s.version, ...(force ? { force: true } : {}) }, keep);
  if (keep) return sent.catch(() => {});
  return s.saving = sent.then((got) => {
    s.version = got.version; s.saved = text; s.stale = false; s.theirs = null; s.err = "";
    s.state.missing = false;
    s.state.dirty = !!s.view && s.view.state.doc.toString() !== text;   // typed on while it was saved
  }).catch((e) => {
    if (e.status === 409) { s.stale = true; edPlainCheck(s); }
    else s.err = e.message;
  }).finally(() => {
    s.saving = null;
    if (ed.s === s) { edAutoLater(s); edHead(); }
  });
}
// Auto-save's: due when something is unsaved, the file not changed on disk since (that waits for the reader).
const edPlainDue = (s) => ed.auto && ed.s === s && s.state.dirty && !s.stale && !s.state.missing;
// The file on disk looked at (each tick): changed since this page read it -- nothing unsaved here, read again; else the
// reader asked (s.stale, s.theirs: the file as it is now). Gone: said, and Save writes it again.
async function edPlainCheck(s) {
  if (s.checking || s.saving || ed.s !== s) return;
  s.checking = true;
  let got = null;
  try { got = await get(`/api/edit/text?${new URLSearchParams({ path: s.path, root: s.root, have: s.version || "" })}`); }
  catch (e) { /* the next tick tries again */ }
  s.checking = false;
  if (!got || ed.s !== s || s.saving) return;
  if (got.missing) {
    if (!s.state.missing) { s.state.missing = true; s.version = null; edHead(); }
    return;
  }
  s.state.missing = false;
  if (got.same) return;
  if (!s.state.dirty) {                              // nothing of the reader's lost: the file as it is now
    edPlainLoad(s, got.text);
    s.version = got.version; s.saved = got.text; s.stale = false; s.theirs = null;
    s.state.changed = Date.now() / 1000;
    edHead();
    edRecentFetch(true);
    return;
  }
  s.stale = true; s.theirs = { text: got.text, version: got.version };
  edHead();
}
// The view's text made `text`: only what differs replaced, so the cursor, the selection and the view stay where they
// were, as far as the text around them is the same.
function edPlainLoad(s, text) {
  const v = s.view;
  if (!v) return;
  const old = v.state.doc.toString();
  if (old === text) return;
  let a = 0;
  const n = Math.min(old.length, text.length);
  while (a < n && old.charCodeAt(a) === text.charCodeAt(a)) a++;
  let b = 0;
  while (b < n - a && old.charCodeAt(old.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
  s.loading = true;
  try { v.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) }, userEvent: "disk" }); }
  finally { s.loading = false; }
}
// The reader's choice, the file changed on disk with their edits unsaved: Reload -- the file as it is now, theirs
// dropped -- or Keep mine, saved over it.
async function edPlainReload(s) {
  let got = s.theirs;
  try {
    const now = await get(`/api/edit/text?${new URLSearchParams({ path: s.path, root: s.root })}`);
    got = now.missing ? null : now;
  } catch (e) { /* as it was last read */ }
  if (ed.s !== s) return;
  if (!got) { s.state.missing = true; s.stale = false; edHead(); return; }
  edPlainLoad(s, got.text);
  s.version = got.version; s.saved = got.text; s.stale = false; s.theirs = null; s.state.dirty = false;
  s.state.changed = Date.now() / 1000;
  edHead();
  edRecentFetch(true);
}
const edPlainKeep = (s) => edPlainSave(s, true);
// Closed (another file opened, the panel going): Auto-save on, what is unsaved saved -- one request, which outlives the
// panel -- unless the file changed on disk since, which is the reader's to choose, and they are gone.
function edPlainGone(s) {
  if (ed.auto && s.state.dirty && !s.stale && !s.state.missing) edPlainSave(s, false, true);
  if (s.view) s.view.destroy();
  s.view = null;
}
// The header's status for a file open plain, and its choice when the file changed on disk under unsaved edits.
function edPlainStatus(s) {
  const st = s.state;
  if (ed.err || s.err) return [["bad", ed.err || s.err], null];
  if (s.stale) return [["bad", "Changed on disk since you opened it"], el("span", { class: "ed-all" },
    el("button", { type: "button", title: "Drop your unsaved edits and show the file as it is on disk now", onclick: () => edPlainReload(s) }, "Reload"),
    el("button", { type: "button", title: "Save your version over the change on disk", onclick: () => edPlainKeep(s) }, "Keep mine"))];
  if (st.missing) return [["bad", "Deleted on disk. Save to restore it."], null];
  if (s.saving) return [["", "Saving…"], null];
  return [st.dirty ? (ed.auto ? ["", "Saving…"] : ["warn", "Unsaved"]) : ["ok", "Saved"], null];
}
// The header of a file open plain (edHead's): its path, its status (and the reader's choice, changed on disk under their
// unsaved edits), the actors that changed it lately, wrap, Auto-save, the app's own, Save.
function edPlainHead(s) {
  const st = s.state, [[cls, said], choice] = edPlainStatus(s), writers = edWriters(edEntry(ed.file));
  return [
    el("span", { class: "ed-path", title: ed.file, text: edRel(ed.file) }),
    el("span", { class: `ed-status ${cls}`, role: "status", text: said }), choice,
    edByChip(writers), s.stale ? null : edChangedChip(s, writers),
    s.note ? el("span", { class: "ed-status bad", text: s.note }) : null,
    el("span", { class: "grow", style: "flex: 1" }),
    el("button", { type: "button", class: "ed-wrap" + (ed.wrap ? " on" : ""), "aria-pressed": ed.wrap ? "true" : "false",
      title: ed.wrap ? "Wrapping long lines · click to turn off" : "Wrap long lines",
      "aria-label": "Wrap long lines", onclick: () => edSetWrap(!ed.wrap) }, strokeIcon(ICONS.wrap, 15)),
    el("label", { class: "ed-auto", title: "Save a moment after each edit. Paused while the file has changed on disk under your edits." },
      el("input", { type: "checkbox", checked: ed.auto ? "" : null, onchange: (ev) => edSetAuto(ev.target.checked) }), "Auto-save"),
    s.info && s.info.kind !== "text" ? el("button", { type: "button", class: "ed-mode", title: `Show ${edBase(s.path)} as it is`,
      onclick: () => edOpen(s.path, "view") }, strokeIcon(ICONS.page, 13), "View") : null,
    ...edAddedHead(s),
    el("button", { type: "button", class: "primary", title: `Save (${MAC ? "⌘S" : "Ctrl+S"})`,
      disabled: st.dirty || st.missing ? null : "", onclick: () => edSave(s) }, "Save"),
  ].filter(Boolean);
}
// The part, as edAdd takes it (editor.js): edOpen opens a text file with it, and the editor asks it, of a file it opened,
// for each edit, each tick, a save, Auto-save, the file closed, and the header.
export const edPlain = { open: edPlainOpen, edited: edPlainEdited, check: edPlainCheck, save: edPlainSave, due: edPlainDue,
  gone: edPlainGone, head: edPlainHead };
