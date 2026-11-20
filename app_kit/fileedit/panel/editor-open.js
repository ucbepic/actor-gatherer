// Opening what the tree does not show. Go to file (⌘P, Ctrl+P): part of a file's name typed, the files under the folder
// shown that have it, best first. And the system's own Open dialog (Finder's on macOS), which the dashboard opens on its
// own machine (the app's chooser.py), as a page's own file picker never says where a file is on disk: its name (`ed.choose`,
// "Finder"...) comes with each listing, null when there is none, or the page is on another machine.
import { el, MAC, PANE, post, SNAPSHOT, state, strokeIcon } from "./page.js";
import { ed, edBase, edDir, edGo, edJoin, edOpen, edTilde, edUnder } from "./editor.js";
import { ED_DIR_GLYPH, edFileIcon, edMenuClose, edPickClose } from "./editor-tree.js";

const ED_RECENT_FILES_KEY = "ag-editor-recent-files", ED_RECENT_FILES_N = 40;
const ED_GO_SHOWN = 60;                  // the most files Go to file lists
const edGoCache = new Map();             // folder -> its files, as last listed: shown at once, listed again behind

// A short note at the Editor's foot, gone after a moment: a path copied, a dialog that did not open.
export function edNote(text, bad = false) {
  const top = document.getElementById("ed-top");
  if (!top) return;
  let n = top.querySelector(":scope > .ed-toast");
  if (!n) { n = el("div", { class: "ed-toast", role: "status" }); top.append(n); }
  n.textContent = text;
  n.classList.toggle("bad", bad);
  n.classList.add("on");
  clearTimeout(edNote.timer);
  edNote.timer = setTimeout(() => n.classList.remove("on"), bad ? 6000 : 2200);
}

// ---- the system's Open dialog -------------------------------------------------------------------------------------

// A file (what "file") opened from it, or a folder ("folder") shown: it opens at the folder of the file open, or the one
// shown, and the dashboard answers once it is answered. Its buttons pulse while it waits.
export async function edNative(what) {
  if (!ed.choose || ed.choosing) return;
  ed.choosing = what;
  edChoosing(true);
  let got = null;
  try { got = await post("/api/edit/choose", { what, start: what === "file" && ed.file ? edDir(ed.file) : ed.root }); }
  catch (e) { edNote(e.message, true); }
  finally { ed.choosing = null; edChoosing(false); }
  const path = got && got.path;
  if (!path) return;                                 // cancelled
  if (what === "folder") edGo(path);
  else edOpen(path);
}
function edChoosing(on) {
  for (const b of document.querySelectorAll(".ed-act.native")) {
    b.classList.toggle("busy", on);
    b.setAttribute("aria-busy", on ? "true" : "false");
  }
  if (on) edNote(`Waiting for ${ed.choose}…`);
}
export const edNativeName = (what) => what === "folder" ? `Choose a folder in ${ed.choose}…` : `Open a file from ${ed.choose}…`;

// ---- recent files ------------------------------------------------------------------------------------------------

// The files opened in the Editor, the latest first (kept in this browser): Go to file's list before anything is typed,
// and a little ahead of the others once it is.
export function edRememberFile(path) {
  const now = [path, ...edRecentFiles().filter((p) => p !== path)].slice(0, ED_RECENT_FILES_N);
  try { localStorage.setItem(ED_RECENT_FILES_KEY, JSON.stringify(now)); } catch (e) { /* this page only */ }
}
function edRecentFiles() {
  try { const had = JSON.parse(localStorage.getItem(ED_RECENT_FILES_KEY) || "[]"); return Array.isArray(had) ? had.filter((p) => typeof p === "string") : []; }
  catch (e) { return []; }
}

// ---- Go to file -------------------------------------------------------------------------------------------------

// How well `q` (small letters, no spaces) names the file at `p` (its path from the folder, small letters; `orig` as it
// is): its letters in order in the file's name, else in its path -- together, at the start of a word, the name starting
// with it, a short path better -- or null. `hits`: where in the path its letters are.
function edScore(q, p, orig) {
  const base = p.lastIndexOf("/") + 1;
  const run = (at) => at < 0 ? null : Array.from(q, (_, k) => at + k);
  let hits = q.includes("/") ? null : run(p.indexOf(q, base)) || edSubseq(q, p, base), score = 0;
  if (hits) score += 1000;
  else if (!(hits = run(p.indexOf(q)) || edSubseq(q, p, 0))) return null;
  for (let k = 0; k < hits.length; k++) {
    const h = hits[k], prev = h ? p[h - 1] : "/";
    if (k && hits[k - 1] === h - 1) score += 20;
    if (h === base || "/_-. ".includes(prev)) score += 12;
    else if (orig[h] !== p[h] && orig[h - 1] === p[h - 1]) score += 10;   // a capital after a small letter: a camelCase word
  }
  const name = p.slice(base);
  if (name === q || name.startsWith(q + ".")) score += 600;
  else if (name.startsWith(q)) score += 300;
  return { score: score - (hits[0] - (hits[0] >= base ? base : 0)) * 2 - p.length * 0.3, hits };
}
function edSubseq(q, p, from) {
  const hits = [];
  for (let k = 0, at = from; k < q.length; k++, at++) {
    at = p.indexOf(q[k], at);
    if (at < 0) return null;
    hits.push(at);
  }
  return hits;
}
// The box, over the top of the Editor: the name typed, the files that have it (↑ ↓ to pick, Enter to open), and last,
// the system's dialog. Esc, a press outside it, or the window resized put it away.
export function edGoto() {
  if (PANE || SNAPSHOT || !state.editor || !ed.root) return;
  if (ed.go) { ed.go.input.focus(); ed.go.input.select(); return; }
  edPickClose(); edMenuClose();
  const input = el("input", { type: "text", class: "ed-go-in", spellcheck: "false", autocomplete: "off", role: "combobox",
    "aria-autocomplete": "list", "aria-controls": "ed-go-list", "aria-expanded": "true", "aria-label": `A file in ${edTilde(ed.root)}`,
    placeholder: `Search files in ${ed.root === "/" ? "/" : edBase(ed.root)} by name or path` });
  const list = el("div", { class: "ed-go-list", id: "ed-go-list", role: "listbox", "aria-label": "Files" });
  const status = el("div", { class: "ed-go-st" });
  const box = el("div", { class: "ed-go", role: "dialog", "aria-label": "Go to file" }, input, list, status);
  const go = ed.go = { box, input, list, status, root: ed.root, at: -1, items: [], got: edGoCache.get(ed.root) || null, err: "", off: null };
  input.addEventListener("input", () => edGoDraw());
  input.addEventListener("keydown", edGoKey);
  const outside = (ev) => { if (!box.contains(ev.target)) edGoClose(); };
  const resized = () => edGoClose();
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", resized);
  go.off = () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", resized); };
  document.body.append(box);
  edGoPlace();
  edGoDraw();
  input.focus();
  edGoFetch(go);
}
async function edGoFetch(go) {
  let got;
  try {
    const r = await fetch(`/api/edit/files?${new URLSearchParams({ dir: go.root, root: "/" })}`, { cache: "no-store" });
    got = await r.json().catch(() => ({}));
    if (!r.ok) got = { error: got.error || `Couldn't list the files (${r.status})` };
  } catch (e) { got = { error: "The dashboard didn't respond. Is it still running?" }; }
  if (!got.error) { got.lower = got.files.map((f) => f.toLowerCase()); edGoCache.set(go.root, got); }
  if (ed.go !== go) return;
  if (got.error) go.err = got.error; else { go.got = got; go.err = ""; }
  edGoDraw();
}
function edGoPlace() {
  const go = ed.go, top = document.getElementById("ed-top");
  if (!go || !top) return;
  const r = top.getBoundingClientRect(), w = Math.min(640, Math.max(300, r.width - 40), window.innerWidth - 16);
  go.box.style.width = `${Math.round(w)}px`;
  go.box.style.left = `${Math.round(Math.max(8, r.left + (r.width - w) / 2))}px`;
  go.box.style.top = `${Math.round(Math.max(8, r.top + 8))}px`;
  go.box.style.maxHeight = `${Math.round(Math.max(200, Math.min(480, window.innerHeight - r.top - 24)))}px`;
}
export function edGoClose(back = false) {
  const go = ed.go;
  if (!go) return;
  ed.go = null;
  go.off();
  go.box.remove();
  if (back) { const r = ed.tree && ed.tree.querySelector('.ed-row[tabindex="0"]'); if (r) r.focus({ preventScroll: true }); }
}
// A path's letters, those at `hits` (from `from` on) marked.
function edMarked(text, from, hits) {
  const on = new Set(hits), out = [];
  let run = "", marked = false;
  const flush = () => { if (run) out.push(marked ? el("b", { text: run }) : document.createTextNode(run)); run = ""; };
  for (let k = 0; k < text.length; k++) {
    const m = on.has(from + k);
    if (m !== marked) { flush(); marked = m; }
    run += text[k];
  }
  flush();
  return out;
}
function edGoDraw() {
  const go = ed.go;
  if (!go) return;
  const q = go.input.value.trim().toLowerCase().replace(/\s+/g, "");
  const got = go.got, files = (got && got.files) || [];
  const cut = (p) => p.slice(go.root === "/" ? 1 : go.root.length + 1);
  const recent = edRecentFiles().filter((p) => p !== go.root && edUnder(p, go.root)).map(cut);
  let items = [], head = "", found = 0;
  if (!q) {
    items = recent.slice(0, 12).map((rel) => ({ rel, hits: [] }));
    head = items.length ? "Recently opened" : "";
  } else if (files.length) {
    const lately = new Set(recent), scored = [];
    for (let i = 0; i < files.length; i++) {
      const s = edScore(q, got.lower[i], files[i]);
      if (s) scored.push([s.score + (lately.has(files[i]) ? 300 : 0), i, s.hits]);
    }
    scored.sort((a, b) => b[0] - a[0] || files[a[1]].length - files[b[1]].length);
    found = scored.length;
    items = scored.slice(0, ED_GO_SHOWN).map(([, i, hits]) => ({ rel: files[i], hits }));
  }
  items = items.map((it) => ({ ...it, path: edJoin(go.root, it.rel) }));
  if (ed.choose) items.push({ native: true });
  const keep = go.items[go.at] && (go.items[go.at].path || "native");
  go.items = items;
  const nodes = head ? [el("div", { class: "ed-pk-hd", role: "presentation", text: head })] : [];
  items.forEach((it, i) => {
    if (it.native) {
      nodes.push(el("div", { class: "ed-go-it native", role: "option", id: `ed-go-${i}`, "aria-selected": "false",
        onmousedown: (ev) => ev.preventDefault(), onclick: () => edGoPick(it) },
        strokeIcon(ED_DIR_GLYPH.open, 15), el("span", { class: "nm", text: edNativeName("file") })));
      return;
    }
    const base = it.rel.lastIndexOf("/") + 1;
    nodes.push(el("div", { class: "ed-go-it", role: "option", id: `ed-go-${i}`, "aria-selected": "false", title: edTilde(it.path),
      onmousedown: (ev) => ev.preventDefault(), onclick: () => edGoPick(it) },
      edFileIcon(it.rel.slice(base)), el("span", { class: "nm" }, ...edMarked(it.rel.slice(base), base, it.hits)),
      el("span", { class: "at" }, ...edMarked(it.rel.slice(0, Math.max(0, base - 1)), 0, it.hits))));
  });
  go.list.replaceChildren(...nodes);
  // what is searched: said under the list
  const n = files.length.toLocaleString();
  go.status.textContent = go.err ? go.err
    : !got ? `Listing files in ${edTilde(go.root)}…`
    : !q ? `${n} files in ${edTilde(go.root)}${got.git ? ", git-ignored files left out" : ""}${got.more ? ", more not listed" : ""}`
    : `${found ? `${found.toLocaleString()} found` : "None found"} in ${n} files${got.more ? " (more not listed: open a smaller folder to search them)" : ""}`;
  go.status.classList.toggle("bad", !!go.err);
  const again = keep ? items.findIndex((it) => (it.path || "native") === keep) : -1;
  edGoAt(q ? 0 : again);                             // typed: the best found; else the one picked, if still there
}
function edGoAt(i) {
  const go = ed.go;
  go.at = i;
  for (const [k, node] of [...go.list.querySelectorAll(".ed-go-it")].entries()) {
    node.classList.toggle("on", k === i);
    node.setAttribute("aria-selected", k === i ? "true" : "false");
    if (k === i) node.scrollIntoView({ block: "nearest" });
  }
  if (i >= 0) go.input.setAttribute("aria-activedescendant", `ed-go-${i}`); else go.input.removeAttribute("aria-activedescendant");
}
function edGoKey(ev) {
  const go = ed.go;
  if (!go) return;
  const n = go.items.length;
  ev.stopPropagation();
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (n) edGoAt(ev.key === "ArrowDown" ? (go.at + 1) % n : go.at <= 0 ? n - 1 : go.at - 1);
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const it = go.items[go.at >= 0 ? go.at : 0];
    if (it) edGoPick(it);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    edGoClose(true);
  } else if (ev.key === "Tab") ev.preventDefault();
}
function edGoPick(it) {
  edGoClose();
  if (it.native) edNative("file");
  else edOpen(it.path);
}
// ⌘P (Ctrl+P) in the Editor: Go to file.
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "p" && ev.key !== "P") return;
  if (ev.shiftKey || ev.altKey || !(MAC ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey)) return;
  ev.preventDefault();
  ev.stopPropagation();
  edGoto();
}, true);
