// The Editor's files, left of the file, as an editor's explorer shows them (moved from the dashboard's page as it was). At the top (edBar): the folder shown --
// clicked, another picked (edPicker) -- and buttons for a new file or folder, the folders read again, every folder
// closed, and the files folded away into a thin bar (edFoldTree). Under it the tree (edTree): each folder's entries,
// folders first, with a twistie, an icon of its kind, guides down the levels and what actors and pages do to each;
// moved through with the keys (edTreeKey), and a menu on a right-click (edMenu).
import { agApp, ago, el, ICONS, MAC, plural, post, state, statusOf, strokeIcon } from "./page.js";
import { ed, edAvatars, edBase, edDir, edGo, edJoin, edList, edOpen, edTilde, edTreeWriters,
  edUnder, edWaiting, edWhoName, edWriters } from "./editor.js";
import { edGoClose, edGoto, edNative, edNativeName, edNote } from "./editor-open.js";
import { edSince, edStartOpen } from "./recent.js";

export const ED_TREE_FOLDED_KEY = "ag-dashboard-editor-tree-folded";
const ED_RECENT_KEY = "ag-editor-recent-folders", ED_RECENT_N = 8;
const ED_FIND_MS = 800;              // ms between keys typed in the tree that still find one name

// Each kind of file: what its icon draws, and in which colour (--ft-*, both themes').
const ED_GLYPH = {
  code: "M5.5 4.5 2.25 8 5.5 11.5M10.5 4.5 13.75 8 10.5 11.5",
  text: "M2.75 3.75h10.5M2.75 6.75h10.5M2.75 9.75h10.5M2.75 12.75h6.5",
  data: "M6 2.75c-1.4 0-1.75.6-1.75 1.75v1.5c0 .9-.5 1.6-1.5 2 1 .4 1.5 1.1 1.5 2v1.5c0 1.15.35 1.75 1.75 1.75"
    + "M10 2.75c1.4 0 1.75.6 1.75 1.75v1.5c0 .9.5 1.6 1.5 2-1 .4-1.5 1.1-1.5 2v1.5c0 1.15-.35 1.75-1.75 1.75",
  style: "M6.5 2.5 5 13.5M11 2.5 9.5 13.5M2.75 6h11M2.25 10h11",
  term: "M2.75 3h10.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4.5 6.25 6.5 8l-2 1.75M8 10h3.25",
  image: "M2.75 2.75h10.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1zM1.75 11l3.5-3.5 3 3 2-2 4 4M10.5 5.75h.01",
  media: "M2.75 2.75h10.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1zM6.5 5.5v5l4-2.5z",
  table: "M2.25 3.25h11.5v9.5H2.25zM2.25 6.4h11.5M2.25 9.6h11.5M6.25 3.25v9.5",
  db: "M2.75 4.25c0-1 2.35-1.75 5.25-1.75s5.25.75 5.25 1.75S10.9 6 8 6 2.75 5.25 2.75 4.25zM2.75 4.25v7.5c0 1 2.35 1.75 5.25 1.75"
    + "s5.25-.75 5.25-1.75v-7.5M2.75 8c0 1 2.35 1.75 5.25 1.75S13.25 9 13.25 8",
  archive: "M2.25 3.25h11.5v3H2.25zM3.25 6.25v6.5h9.5v-6.5M6.5 8.75h3",
  lock: "M3.75 7.25h8.5v6.5h-8.5zM5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75M8 9.75v1.5",
  pkg: "M8 1.75 13.75 5v6L8 14.25 2.25 11V5zM2.25 5 8 8.25 13.75 5M8 8.25v6",
  info: "M8 1.75a6.25 6.25 0 1 0 0 12.5a6.25 6.25 0 1 0 0-12.5zM8 7.25v4M8 4.9h.01",
  git: "M4.5 2.5v8.5M3 12.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M10 4.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M11.5 6c0 3.25-7 2.25-7 5",
  doc: "M4.25 1.75h5l3 3v9.5h-8zM9 1.75v3.25h3.25",
};
const ED_SEARCH = "M7 2.25a4.75 4.75 0 1 0 0 9.5a4.75 4.75 0 1 0 0-9.5zM10.5 10.5l3.25 3.25";
const ED_COLLAPSE = "M3.25 2.75h9.5a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1zM5.25 8h5.5";
// an actor started here: a head and shoulders, a + beside it (the tree's menu)
const ED_ACTOR_GLYPH = "M6.5 7.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zM2.25 13.25c.4-2.3 2.1-3.75 4.25-3.75 1 0 1.9.3 2.6.85M12 9.5v4M10 11.5h4";
export const ED_DIR_GLYPH = {
  shut: "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z",
  open: "M1.75 11.6V4a1 1 0 0 1 1-1h3.4l1.5 1.6h4.85a1 1 0 0 1 1 1v1.65M1.95 12.7l1.6-4.75a1 1 0 0 1 .95-.7h9.05a.6.6 0 0 1 .57.8"
    + "l-1.45 4.3a1 1 0 0 1-.95.7H2.6a.7.7 0 0 1-.65-.35z",
};
const ED_KINDS = Object.entries({
  "code blue": "py pyi pyx c h lua r dockerfile",
  "code yellow": "js mjs cjs",
  "code teal": "jsx tsx go dart",
  "code blue2": "ts mts cts",
  "code orange": "html htm xml rs swift ml svelte",
  "code purple": "cpp cc cxx hpp hh kt kts php jl hs ex exs",
  "code red": "java scala rb",
  "code green": "cs vue diff patch",
  "data orange": "ipynb",
  "data yellow": "json jsonc json5 jsonl",
  "data purple": "yaml yml",
  "data gray": "toml ini cfg conf properties",
  "style blue": "css",
  "style pink": "scss sass less",
  "text blue": "md markdown mdx",
  "text gray": "txt log rst text",
  "text teal": "tex sty cls bib bst latex",
  "term green": "sh bash zsh fish ps1 bat cmd",
  "db pink": "sql db sqlite sqlite3",
  "table green": "csv tsv xls xlsx ods parquet",
  "image purple": "png jpg jpeg gif webp bmp ico avif heic tif tiff",
  "image yellow": "svg",
  "doc red": "pdf",
  "doc blue": "doc docx odt rtf",
  "doc orange": "ppt pptx key",
  "archive gray": "zip tar gz tgz bz2 xz 7z whl jar rar",
  "media pink": "mp3 wav flac ogg m4a mp4 mov webm mkv avi",
  "lock gray": "lock",
}).reduce((m, [kind, exts]) => { for (const x of exts.split(" ")) m[x] = kind; return m; }, {});
const ED_NAMED = {
  dockerfile: "pkg blue", makefile: "term orange", license: "doc yellow", "license.md": "doc yellow", "license.txt": "doc yellow",
  ".gitignore": "git orange", ".gitattributes": "git orange", ".gitmodules": "git orange", ".gitkeep": "git orange",
  "package.json": "pkg red", "pyproject.toml": "pkg blue", "requirements.txt": "pkg blue", "setup.py": "pkg blue",
  "setup.cfg": "pkg blue", "cargo.toml": "pkg orange", "go.mod": "pkg teal", "go.sum": "lock gray",
  "package-lock.json": "lock gray", "pnpm-lock.yaml": "lock gray", "yarn.lock": "lock gray",
};
// A file's kind, by its name: [what its icon draws, its colour]. A Markdown file named in capitals (a project's notes
// to whoever works in it, its changes, how to help) is one to read first, as a README is.
function edKind(name) {
  const n = (name || "").toLowerCase();
  const k = ED_NAMED[n] || (n.startsWith("readme") ? "info blue" : /^[A-Z][A-Z0-9_-]*\.md$/.test(name || "") ? "info orange"
    : n.startsWith(".env") ? "lock yellow" : n.startsWith("dockerfile") ? "pkg blue" : "")
    || ED_KINDS[n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : ""] || "doc gray";
  return k.split(" ");
}
export function edFileIcon(name) {
  const [glyph, hue] = edKind(name);
  const svg = strokeIcon(ED_GLYPH[glyph], 15);
  svg.setAttribute("class", `ic ft-${hue}`);
  return svg;
}
function edDirIcon(open) {
  const svg = strokeIcon(ED_DIR_GLYPH[open ? "open" : "shut"], 15);
  svg.setAttribute("class", "ic dir");
  return svg;
}

// ---- the head ---------------------------------------------------------------------------------------------------

// The folder shown, a button that picks another; then Go to file, the system's Open dialog for the folder to show (when
// there is one: a file from it is Go to file's last choice), a new file or folder, and the files folded away. Reading the folders again and closing every one are in the menu. The thin
// bar that stands for the files folded says the folder too.
export function edBar() {
  if (!ed.bar) return;
  const sig = JSON.stringify([ed.root, ed.home, ed.choose]);
  if (sig === ed.barSig) return;
  ed.barSig = sig;
  const act = (icon, label, run, cls = "") => el("button", { type: "button", class: `ed-act ${cls}`.trim(), title: label,
    "aria-label": label, onclick: run }, strokeIcon(icon, 15));
  ed.bar.replaceChildren(el("div", { class: "row" },
    el("button", { type: "button", class: "ed-folder", "aria-haspopup": "dialog", "aria-expanded": ed.pick ? "true" : "false",
      title: `${edTilde(ed.root)}\nClick to open another folder`,
      onclick: (ev) => edPicker(ev.currentTarget) },
      edDirIcon(false), el("span", { class: "nm", text: ed.root === "/" ? "/" : edBase(ed.root) }), strokeIcon(ICONS.chevron, 11)),
    act(ED_SEARCH, `Go to a file… (${MAC ? "⌘P" : "Ctrl+P"})`, edGoto),
    ed.choose ? act(ED_DIR_GLYPH.open, edNativeName("folder"),
      () => edNative("folder"), "native") : null,
    act(ED_GLYPH.doc + "M8 7.75v4M6 9.75h4", "New file…", () => edNew(edTarget(), false), "opt"),
    act(ICONS.folderNew, "New folder…", () => edNew(edTarget(), true), "opt"),
    el("button", { type: "button", class: "ed-act ed-hide", title: "Hide files",
      "aria-label": "Hide files", "aria-expanded": "true", onclick: () => edFoldTree(true) }, strokeIcon(ICONS.sidebar, 15))));
  if (ed.fold) {
    ed.fold.title = `Show the files of ${edTilde(ed.root)}`;
    ed.fold.replaceChildren(strokeIcon(ICONS.sidebar, 15), el("span", { class: "nm", text: edShort(ed.root) }));
  }
}
// A long path said by its last two folders, the end of it what tells one from another (the whole in its title).
const edShort = (p) => { const t = edTilde(p), parts = t.split("/").filter(Boolean); return t.length <= 26 || parts.length <= 2 ? t : `…/${parts.slice(-2).join("/")}`; };
// The files folded away, or shown again: a thin bar in their place while folded, the reader's choice kept in this browser.
export function edFoldTree(fold, store = true) {
  if (!ed.nav) return;
  const moving = ed.host.contains(document.activeElement);
  ed.nav.hidden = fold; ed.fold.hidden = !fold;
  if (store) try { localStorage.setItem(ED_TREE_FOLDED_KEY, fold ? "1" : "0"); } catch (e) { /* this page only */ }
  if (fold) { edPickClose(); edMenuClose(); }
  if (!moving) return;                               // the keyboard's place: to the button that undoes it
  const to = fold ? ed.fold : ed.bar.querySelector(".ed-hide");
  if (to) to.focus({ preventScroll: true });
}
function edCollapseAll() { ed.open.clear(); edTree(); }
function edRefresh() {
  const dirs = new Set([ed.root, ...ed.open]);
  Promise.all([...dirs].map((d) => edList(d, false))).then(() => edTree());
}
// Where a new file or folder goes: in the folder last focused in the tree, or the one holding the file last focused
// (else the one open), else the folder shown.
function edTarget() {
  const row = ed.tree && ed.cursor && ed.tree.querySelector(`.ed-row[data-path="${CSS.escape(ed.cursor)}"]`);
  const p = row ? row.dataset.path : ed.file;
  if (!p || !ed.root || !edUnder(p, ed.root) || p === ed.root) return ed.root;
  return row && row.dataset.dir ? p : edDir(p);
}
// The folders the tree was shown at, the latest first (kept in this browser): the picker's "Recent".
export function edRemember(dir) {
  let had = [];
  try { had = JSON.parse(localStorage.getItem(ED_RECENT_KEY) || "[]"); } catch (e) { /* none */ }
  const now = [dir, ...(Array.isArray(had) ? had : []).filter((d) => typeof d === "string" && d !== dir)].slice(0, ED_RECENT_N);
  try { localStorage.setItem(ED_RECENT_KEY, JSON.stringify(now)); } catch (e) { /* this page only */ }
}
function edRecent() {
  try { const had = JSON.parse(localStorage.getItem(ED_RECENT_KEY) || "[]"); return Array.isArray(had) ? had.filter((d) => typeof d === "string") : []; }
  catch (e) { return []; }
}
// The actors' working directories, the latest at work first, each with up to three of its actors' names.
function edFolders() {
  const by = new Map();
  for (const g of (state.home && state.home.gatherers) || [])
    for (const a of g.agents) {
      const d = (a.cwd || "").replace(/\/+$/, "");
      if (!d) continue;
      const had = by.get(d) || { last: 0, names: [] };
      had.last = Math.max(had.last, a.last || 0);
      if (statusOf(a)[0] !== "closed" && had.names.length < 3) had.names.push(edWhoName(a));
      by.set(d, had);
    }
  return [...by.entries()].sort((x, y) => y[1].last - x[1].last).slice(0, 15);
}
// A folder's listing, or why there is none in words (the server's error, not the request's status).
export async function edFetchList(dir) {
  try {
    const r = await fetch(`/api/edit/list?${new URLSearchParams({ dir, root: "/", since: String(edSince()) })}`, { cache: "no-store" });
    const got = await r.json().catch(() => ({}));
    return r.ok ? got : { error: got.error || `Couldn't list this folder (${r.status})`, entries: [], ...("choose" in got ? { choose: got.choose } : {}) };
  } catch (e) { return { error: "The dashboard didn't respond. Is it still running?", entries: [] }; }
}

// ---- the folder picker --------------------------------------------------------------------------------------------

// Under the folder's button: a path typed (~ for the home folder), its folders listed as it is typed -- Tab completes
// the one picked, Enter shows it, or the path typed -- and, before anything is typed, the folders above the one shown,
// the actors' and the recent ones. Esc, a press outside it, or the window resized put it away.
const edUntilde = (t) => t === "~" ? ed.home : t.startsWith("~/") && ed.home ? ed.home + t.slice(1) : t;
function edPicker(button) {
  if (ed.pick) { edPickClose(); return; }
  edMenuClose(); edGoClose();
  const first = ed.root === "/" ? "/" : `${edTilde(ed.root)}/`;
  const input = el("input", { type: "text", class: "ed-pk-in", spellcheck: "false", autocomplete: "off", value: first,
    "aria-label": "Folder path", placeholder: "Folder path (~/… or /…)", role: "combobox", "aria-autocomplete": "list",
    "aria-controls": "ed-pk-list", "aria-expanded": "true" });
  const err = el("div", { class: "ed-pk-err", role: "alert" });
  const list = el("div", { class: "ed-pk-list", id: "ed-pk-list", role: "listbox", "aria-label": "Folders" });
  const hint = el("div", { class: "ed-pk-hint", text: "Tab to complete · Enter to open · Esc to close" });
  const box = el("div", { class: "ed-pk", role: "dialog", "aria-label": "Open a folder" }, input, err, list, hint);
  const pk = ed.pick = { box, input, list, err, button, first, items: [], at: -1, cache: new Map(), seq: 0, off: null };
  input.addEventListener("input", () => { err.textContent = ""; edPickDraw(); });
  input.addEventListener("keydown", edPickKey);
  const outside = (ev) => { if (!box.contains(ev.target) && !button.contains(ev.target)) edPickClose(); };
  const resized = () => edPickClose();
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", resized);
  pk.off = () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", resized); };
  document.body.append(box);
  button.setAttribute("aria-expanded", "true");
  edPickPlace();
  edPickDraw();
  input.focus();
  input.setSelectionRange(first.length, first.length);
}
function edPickPlace() {
  const pk = ed.pick;
  if (!pk) return;
  const r = (ed.nav || pk.button).getBoundingClientRect(), b = pk.button.getBoundingClientRect();
  const w = Math.min(Math.max(r.width, 360), window.innerWidth - 16);
  pk.box.style.width = `${w}px`;
  pk.box.style.left = `${Math.round(Math.max(8, Math.min(r.left + 4, window.innerWidth - w - 8)))}px`;
  pk.box.style.top = `${Math.round(b.bottom + 4)}px`;
  pk.box.style.maxHeight = `${Math.max(180, Math.round(window.innerHeight - b.bottom - 16))}px`;
}
export function edPickClose(focus = false) {
  const pk = ed.pick;
  if (!pk) return;
  ed.pick = null;
  pk.off();
  pk.box.remove();
  if (pk.button.isConnected) {
    pk.button.setAttribute("aria-expanded", "false");
    if (focus) pk.button.focus({ preventScroll: true });
  }
}
// What the box lists for the text in it: the folders in the folder it names, those starting with the part after its
// last "/" (the folders a name starting with "." last, unless typed); and, the text as it opened, the folders above
// the one shown, the actors' and the recent ones -- once typed, those of them it is part of.
function edPickDraw() {
  const pk = ed.pick;
  if (!pk) return;
  const typed = pk.input.value, path = edUntilde(typed.trim());
  const untouched = typed === pk.first;
  const groups = [];
  if (path.startsWith("/")) {
    const dir = path.endsWith("/") ? path.replace(/\/+$/, "") || "/" : edDir(path);
    const start = path.endsWith("/") ? "" : edBase(path).toLowerCase();
    const got = pk.cache.get(dir);
    if (!got) {
      const seq = ++pk.seq;
      pk.cache.set(dir, { loading: true });
      edFetchList(dir).then((v) => { if (ed.pick !== pk) return; pk.cache.set(dir, v); if (seq === pk.seq || !untouched) edPickDraw(); });
    }
    const dirs = got && got.entries ? got.entries.filter((e) => e.dir && e.name.toLowerCase().startsWith(start)) : [];
    if (!start.startsWith(".")) dirs.sort((a, b) => (a.name.startsWith(".") - b.name.startsWith(".")));
    groups.push([`In ${edTilde(dir)}`, dirs.slice(0, 60).map((e) => ({ path: edJoin(dir, e.name), name: e.name, kind: "in" })),
      !got || got.loading ? "Loading…" : got.error ? got.error : start ? `No folders starting with “${start}”` : "No folders"]);
  }
  const has = (p) => !typed || untouched || edTilde(p).toLowerCase().includes(typed.trim().toLowerCase().replace(/\/+$/, ""));
  if (untouched && ed.root !== "/") {
    const up = [];
    for (let d = edDir(ed.root); ; d = edDir(d)) { up.push({ path: d, name: edTilde(d), kind: "up" }); if (d === "/") break; }
    groups.push(["Parent folders", up]);
  }
  const theirs = edFolders().filter(([d]) => d !== ed.root && has(d));
  groups.push(["Actors' folders", theirs.map(([d, v]) => ({ path: d, name: edBase(d) || "/", note: `${edTilde(d)}${v.names.length ? " — " + v.names.join(", ") : ""}`, kind: "actor" }))]);
  const seen = new Set(theirs.map(([d]) => d));
  groups.push(["Recent", edRecent().filter((d) => d !== ed.root && !seen.has(d) && has(d))
    .map((d) => ({ path: d, name: edBase(d) || "/", note: edTilde(d), kind: "recent" }))]);
  if (ed.choose) groups.push(["", [{ path: null, name: edNativeName("folder"), kind: "native" }]]);
  const keep = pk.items[pk.at] && (pk.items[pk.at].path || "native");
  pk.items = [];
  const nodes = [];
  for (const [head, items, none] of groups) {
    if (!items.length && !none) continue;
    if (head) nodes.push(el("div", { class: "ed-pk-hd", role: "presentation", text: head }));
    else nodes.push(el("div", { class: "ed-pk-sep", role: "presentation" }));
    if (!items.length) nodes.push(el("div", { class: "ed-pk-none", role: "presentation", text: none }));
    for (const it of items) {
      const i = pk.items.push(it) - 1;
      nodes.push(el("div", { class: "ed-pk-it" + (it.kind === "native" ? " native" : ""), role: "option", id: `ed-pk-${i}`, "aria-selected": "false",
        title: it.path ? edTilde(it.path) : null, onmousedown: (ev) => ev.preventDefault(), onclick: () => edPickItem(it) },
        it.kind === "up" ? strokeIcon(ICONS.folderUp, 15) : it.kind === "native" ? strokeIcon(ED_DIR_GLYPH.open, 15) : edDirIcon(false),
        el("span", { class: "nm", text: it.name }),
        it.note ? el("span", { class: "at", text: it.note }) : null));
    }
  }
  pk.list.replaceChildren(...nodes);
  const again = keep ? pk.items.findIndex((x) => (x.path || "native") === keep) : -1;
  // the one picked: as it was, else -- a name being typed -- the first of the folders it starts
  edPickAt(again >= 0 ? again : !untouched && !path.endsWith("/") && pk.items[0] && pk.items[0].kind === "in" ? 0 : -1);
}
function edPickAt(i) {
  const pk = ed.pick;
  pk.at = i;
  for (const [n, node] of [...pk.list.querySelectorAll(".ed-pk-it")].entries()) {
    node.classList.toggle("on", n === i);
    node.setAttribute("aria-selected", n === i ? "true" : "false");
    if (n === i) node.scrollIntoView({ block: "nearest" });
  }
  if (i >= 0) pk.input.setAttribute("aria-activedescendant", `ed-pk-${i}`); else pk.input.removeAttribute("aria-activedescendant");
}
function edPickKey(ev) {
  const pk = ed.pick;
  if (!pk) return;
  const n = pk.items.length;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (n) edPickAt(ev.key === "ArrowDown" ? (pk.at + 1) % n : pk.at <= 0 ? n - 1 : pk.at - 1);
  } else if (ev.key === "Tab" && !ev.shiftKey) {
    const it = pk.items[pk.at >= 0 ? pk.at : 0];
    if (!it || !it.path) return;
    ev.preventDefault();
    pk.input.value = it.path === "/" ? "/" : `${edTilde(it.path)}/`;
    pk.err.textContent = "";
    edPickDraw();
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const it = pk.items[pk.at];
    if (it) edPickItem(it); else edPickGo(edUntilde(pk.input.value.trim()));
  } else if (ev.key === "Escape") {
    ev.preventDefault(); ev.stopPropagation();
    edPickClose(true);
  }
}
function edPickItem(it) {
  if (it.kind === "native") { edPickClose(); edNative("folder"); }
  else edPickGo(it.path);
}
// A folder shown, once its listing says it is one; else why not, in the box, which stays.
async function edPickGo(path) {
  const pk = ed.pick;
  if (!pk) return;
  path = (path || "").replace(/\/+$/, "") || "/";
  if (!path.startsWith("/")) { pk.err.textContent = "Enter a path starting with / or ~"; return; }
  const got = pk.cache.get(path) && !pk.cache.get(path).loading ? pk.cache.get(path) : await edFetchList(path);
  if (ed.pick !== pk) return;
  if (got.error) { pk.err.textContent = got.error; pk.input.focus(); return; }
  edPickClose();
  edGo(path);
  ed.lists.set(path, got);
  ed.treeSig = ""; edTree();
  const row = ed.tree && ed.tree.querySelector(".ed-row");
  if (row) row.focus({ preventScroll: true });
}

// ---- the tree ---------------------------------------------------------------------------------------------------

function edToggle(dir) {
  if (ed.open.has(dir)) ed.open.delete(dir);
  else { ed.open.add(dir); if (!ed.lists.has(dir)) edList(dir); }
  edTree();
}
// The folders between the one shown and `dir` (both included, the one shown always is) opened, and listed.
export function edOpenTo(dir) {
  if (!ed.root || !edUnder(dir, ed.root)) return;
  for (let d = dir; d !== ed.root && d !== "/"; d = edDir(d)) {
    ed.open.add(d);
    if (!ed.lists.has(d)) edList(d);
  }
}
// The file open, shown in the tree: the folders down to it opened and its row scrolled to (once listed).
export function edReveal(path) {
  if (!ed.root || !path || path === ed.root || !edUnder(path, ed.root)) return;
  ed.revealing = path;
  edOpenTo(edDir(path));
}
// A folder a link showed (edShowFolder), flashed for ED_FLASH_MS (editor.css's .ed-row.flash, as long) from when its row
// was first drawn: `ed.flash`, {path, at}. A row drawn again meanwhile goes on where the last one was in the flash.
const ED_FLASH_MS = 2000;
const edFlashing = (path) => {
  const ms = ed.flash && ed.flash.path === path ? Date.now() - ed.flash.at : -1;
  return ms >= 0 && ms < ED_FLASH_MS ? ms : null;
};
// The rows, each a treeitem: a twistie (a folder's), its icon, its name and what is going on with it. Drawn again only
// when what it shows changed; the keyboard's place (a row, or a new name being typed) kept across a draw.
export function edTree() {
  if (!ed.tree || !ed.root) return;
  const rows = [], sig = [ed.root, ed.file, ed.newItem && [ed.newItem.dir, ed.newItem.folder]];
  const lvl = (depth) => `--d: ${depth}`;
  const walk = (dir, depth) => {
    if (ed.newItem && ed.newItem.dir === dir) { ed.newItem.el.style.cssText = lvl(depth); rows.push(ed.newItem.el); }
    const got = ed.lists.get(dir);
    if (!got || got.error || !got.entries.length) {
      sig.push(dir, got ? got.error || "empty" : "loading");
      rows.push(el("div", { class: "ed-note" + (got && got.error ? " err" : ""), style: lvl(depth), role: "none",
        text: !got ? "Loading…" : got.error || "Empty" }));
      return;
    }
    for (const e of got.entries) {
      const p = edJoin(dir, e.name), all = edWriters(e), writers = edTreeWriters(e, all), dim = e.name.startsWith(".") ? " dim" : "";
      const at = { type: "button", role: "treeitem", "aria-level": depth + 1, tabindex: "-1", style: lvl(depth), "data-path": p };
      if (e.dir) {
        const open = ed.open.has(p), flashed = edFlashing(p), flash = flashed === null ? "" : " flash";
        sig.push(p, open, writers.map((w) => w.channel), e.pending);
        if (flash) at.style += `; animation-delay: -${flashed}ms`;
        rows.push(el("button", { ...at, class: "ed-row dir" + dim + flash, "data-dir": "1", title: edTilde(p), "aria-expanded": open ? "true" : "false",
          onclick: () => edToggle(p) },
          el("span", { class: "tw" + (open ? " open" : "") }, strokeIcon(ICONS.chevron, 12)), edDirIcon(open), el("span", { class: "n", text: e.name }),
          open ? null : edAvatars(writers, "files in it"), open ? null : edWaiting(e.pending)));
        if (open) walk(p, depth + 1);
        continue;
      }
      const fresh = got.now - e.mtime < 60 && !all.some((w) => got.now - w.at < 60), on = p === ed.file;
      sig.push(p, fresh, e.pages, e.dirty, e.conflicts, e.pending, writers.map((w) => w.channel));
      rows.push(el("button", { ...at, class: "ed-row" + dim + (on ? " on" : ""), "aria-selected": on ? "true" : "false",
        title: [edTilde(p), fresh ? `Changed ${ago(e.mtime)}` : "", e.pages ? `Open in ${plural(e.pages, "editor")}` : "",
          e.dirty ? "Unsaved changes" : ""].filter(Boolean).join("\n"), onclick: () => edOpen(p) },
        el("span", { class: "tw" }), edFileIcon(e.name), el("span", { class: "n", text: e.name }),
        edAvatars(writers, "it"),
        fresh ? el("span", { class: "mk fresh", title: "Changed in the last minute" }) : null,
        e.conflicts ? el("span", { class: "mk cf", title: `${plural(e.conflicts, "conflict")} with the file on disk`, text: "!" }) : null,
        edWaiting(e.pending),
        e.dirty && !e.conflicts ? el("span", { class: "mk dirty", title: "Unsaved changes" }) : null,
        e.pages ? el("span", { class: "mk eds", title: `Open in ${plural(e.pages, "editor")}`, text: String(e.pages) }) : null));
    }
    if (got.more) rows.push(el("div", { class: "ed-note", style: lvl(depth), role: "none", text: "More not listed" }));
  };
  walk(ed.root, 0);
  const now = JSON.stringify(sig);
  if (now !== ed.treeSig || !ed.tree.childElementCount) {
    ed.treeSig = now;
    const had = ed.tree.contains(document.activeElement) ? document.activeElement : null;
    const was = had && had.dataset && had.dataset.path, typing = ed.newItem && had === ed.newItem.input;
    const sel = typing ? [had.selectionStart, had.selectionEnd] : null;
    ed.tree.replaceChildren(...rows);
    if (typing) { had.focus({ preventScroll: true }); had.setSelectionRange(...sel); }
    else if (was) { const r = ed.tree.querySelector(`.ed-row[data-path="${CSS.escape(was)}"]`); if (r) r.focus({ preventScroll: true }); }
  }
  edRove();
  if (ed.revealing) {
    const r = ed.tree.querySelector(`.ed-row[data-path="${CSS.escape(ed.revealing)}"]`);
    if (r) {
      ed.revealing = null; r.scrollIntoView({ block: "nearest" });
      if (ed.flashFolder === r.dataset.path) {         // edShowFolder's: flashed from now (edFlashing)
        ed.flashFolder = null; ed.flash = { path: r.dataset.path, at: Date.now() };
        r.classList.add("flash");
      }
    }
  }
}
// One row in the tab order (a tree's way): the one last focused, else the file open's, else the first.
function edRove() {
  const rows = [...ed.tree.querySelectorAll(".ed-row")];
  const sel = (p) => p && rows.find((r) => r.dataset.path === p);
  const want = sel(ed.cursor) || rows.find((r) => r.classList.contains("on")) || rows[0];
  for (const r of rows) r.tabIndex = r === want ? 0 : -1;
}
// The tree's own keys: ↑ ↓ Home End to move, → to open a folder (or into it), ← to close it (or to the folder above),
// Enter or Space to open, letters typed to go to the next name starting with them, the menu key or Shift+F10 for its menu.
export function edTreeWire(nav) {
  ed.tree.addEventListener("focusin", (ev) => {
    const r = ev.target.closest(".ed-row");
    if (!r) return;
    ed.cursor = r.dataset.path;
    for (const x of ed.tree.querySelectorAll('.ed-row[tabindex="0"]')) if (x !== r) x.tabIndex = -1;
    r.tabIndex = 0;
  });
  ed.tree.addEventListener("keydown", edTreeKey);
  nav.addEventListener("contextmenu", (ev) => {
    if (ev.target.closest(".ed-new-wrap, input")) return;
    if (!ev.target.closest(".ed-rows") && ev.target.closest(".ed-bar, .ed-brs")) return;
    ev.preventDefault();
    edMenu(ev.target.closest(".ed-row"), ev.clientX, ev.clientY);
  });
}
function edTreeKey(ev) {
  const r = ev.target.closest && ev.target.closest(".ed-row");
  if (!r || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const rows = [...ed.tree.querySelectorAll(".ed-row")], i = rows.indexOf(r), p = r.dataset.path, dir = !!r.dataset.dir;
  const to = (x) => { if (x) { x.focus({ preventScroll: true }); x.scrollIntoView({ block: "nearest" }); } };
  if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) {
    const b = r.getBoundingClientRect();
    edMenu(r, b.left + 24, b.bottom);
  } else if (ev.key === "ArrowDown") to(rows[i + 1]);
  else if (ev.key === "ArrowUp") to(rows[i - 1]);
  else if (ev.key === "Home") to(rows[0]);
  else if (ev.key === "End") to(rows[rows.length - 1]);
  else if (ev.key === "ArrowRight") {
    if (dir && !ed.open.has(p)) edToggle(p);
    else if (dir && rows[i + 1] && edUnder(rows[i + 1].dataset.path, p)) to(rows[i + 1]);
  } else if (ev.key === "ArrowLeft") {
    if (dir && ed.open.has(p)) edToggle(p);
    else to(rows.find((x) => x.dataset.path === edDir(p)));
  } else if (ev.key.length === 1 && ev.key !== " ") {
    const t = Date.now(), f = ed.find && t - ed.find.at < ED_FIND_MS ? ed.find : { s: "", at: 0 };
    f.s += ev.key.toLowerCase(); f.at = t; ed.find = f;
    const name = (x) => (x.querySelector(".n") || x).textContent.toLowerCase();
    const from = f.s.length === 1 ? i + 1 : i;               // a letter again: the next name; more of a name: this one may be it
    for (let k = 0; k < rows.length; k++) {
      const x = rows[(from + k) % rows.length];
      if (name(x).startsWith(f.s)) { to(x); break; }
    }
  } else return;
  ev.preventDefault();
}

// ---- the menu -----------------------------------------------------------------------------------------------------

// On a row (or the tree's empty space): what can be done there -- open it, a new file or folder in it (or beside it),
// show that folder alone, its path copied.
function edMenu(row, x, y) {
  edMenuClose(); edPickClose(); edGoClose();
  const p = row ? row.dataset.path : ed.root, dir = row ? !!row.dataset.dir : true, into = dir ? p : edDir(p);
  const rel = ed.root === "/" ? p.slice(1) : p === ed.root ? "." : p.slice(ed.root.length + 1);
  const item = (icon, text, run) => el("button", { type: "button", role: "menuitem", tabindex: "-1",
    onclick: () => { edMenuClose(true); run(); } }, strokeIcon(icon, 15), el("span", { class: "nm", text }));
  const sep = () => el("div", { class: "sep", role: "separator" });
  const items = [
    row && !dir ? item(ED_GLYPH.doc, "Open", () => edOpen(p)) : null,
    row && dir ? item(ICONS.folder, ed.open.has(p) ? "Close" : "Open", () => edToggle(p)) : null,
    item(ED_GLYPH.doc + "M8 7.75v4M6 9.75h4", into === ed.root ? "New file…" : `New file in ${edBase(into)}…`, () => edNew(into, false)),
    item(ICONS.folderNew, into === ed.root ? "New folder…" : `New folder in ${edBase(into)}…`, () => edNew(into, true)),
    row && dir ? item(ED_DIR_GLYPH.open, "Show this folder alone", () => edGo(p)) : null,
    sep(),
    agApp && ((state.home && state.home.harnesses) || []).length
      ? item(ED_ACTOR_GLYPH, row && !dir ? "Start an actor on this file…" : "Start an actor here…",
        () => edStartOpen(p, dir, x, y)) : null,
    sep(),
    item("M5.25 5.25V3.5a1 1 0 0 1 1-1h6.25a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1H10.75M3.5 5.25h6.25a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6.25a1 1 0 0 1 1-1z",
      "Copy path", () => edCopy(p)),
    row ? item("M5.25 5.25V3.5a1 1 0 0 1 1-1h6.25a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1H10.75M3.5 5.25h6.25a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6.25a1 1 0 0 1 1-1z",
      "Copy relative path", () => edCopy(rel)) : null,
    sep(),
    item(ICONS.reload, "Refresh", edRefresh),
    item(ED_COLLAPSE, "Collapse all folders", edCollapseAll),
  ].filter(Boolean);
  const box = el("div", { class: "br-menu row-menu ed-menu", role: "menu", "aria-label": row ? edBase(p) : edTilde(ed.root) }, ...items);
  const buttons = () => [...box.querySelectorAll("button")];
  box.addEventListener("keydown", (ev) => {
    const bs = buttons(), i = bs.indexOf(document.activeElement);
    if (ev.key === "ArrowDown") bs[(i + 1) % bs.length].focus();
    else if (ev.key === "ArrowUp") bs[i <= 0 ? bs.length - 1 : i - 1].focus();
    else if (ev.key === "Home") bs[0].focus();
    else if (ev.key === "End") bs[bs.length - 1].focus();
    else if (ev.key === "Escape") { ev.stopPropagation(); edMenuClose(true); }
    else if (ev.key === "Tab") edMenuClose(true);
    else return;
    ev.preventDefault();
  });
  const outside = (ev) => { if (!box.contains(ev.target)) edMenuClose(); };
  const away = () => edMenuClose();
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", away); window.addEventListener("blur", away);
  ed.tree.addEventListener("scroll", away, { once: true }); if (ed.nav) ed.nav.addEventListener("scroll", away, { once: true });
  ed.menu = { box, row: row && row.dataset.path, off: () => {
    document.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("resize", away); window.removeEventListener("blur", away);
  } };
  if (row) row.classList.add("menu-on");
  document.body.append(box);
  box.style.left = `${Math.round(Math.max(8, Math.min(x, window.innerWidth - box.offsetWidth - 8)))}px`;
  box.style.top = `${Math.round(Math.max(8, y + box.offsetHeight + 8 > window.innerHeight ? y - box.offsetHeight : y))}px`;
  buttons()[0].focus({ preventScroll: true });
}
export function edMenuClose(back = false) {
  const m = ed.menu;
  if (!m) return;
  ed.menu = null;
  m.off();
  m.box.remove();
  const row = m.row && ed.tree && ed.tree.querySelector(`.ed-row[data-path="${CSS.escape(m.row)}"]`);
  if (row) { row.classList.remove("menu-on"); if (back) row.focus({ preventScroll: true }); }
}
async function edCopy(text) {
  try { await navigator.clipboard.writeText(text); edNote(`Copied ${text}`); }
  catch (e) { edNote("Couldn't copy. The browser blocked the clipboard.", true); }
}

// ---- a new file or folder -----------------------------------------------------------------------------------------

// A name typed in the tree, at the top of the folder it goes in (that folder opened): Enter makes it -- the folders a
// name like "src/a.py" names too -- and opens a new file in the editor; Esc, or leaving it, makes nothing.
function edNew(dir, folder) {
  if (!ed.root) return;
  if (ed.nav && ed.nav.hidden) edFoldTree(false);
  if (!edUnder(dir, ed.root)) dir = ed.root;
  edOpenTo(dir);
  const input = el("input", { type: "text", class: "ed-new-in", spellcheck: "false", autocomplete: "off",
    "aria-label": folder ? `New folder name in ${edTilde(dir)}` : `New file name in ${edTilde(dir)}`,
    placeholder: folder ? "Folder name" : "File name or path (a/b.py)" });
  const icon = el("span", { class: "ed-new-ic" }, folder ? edDirIcon(false) : edFileIcon(""));
  const err = el("div", { class: "ed-new-err", role: "alert" });
  const wrap = el("div", { class: "ed-new-wrap", role: "none" }, el("div", { class: "ed-new" }, el("span", { class: "tw" }), icon, input), err);
  const it = ed.newItem = { dir, folder, el: wrap, input, err, busy: false };
  input.addEventListener("input", () => {
    err.textContent = ""; input.classList.remove("bad");
    if (!folder) icon.replaceChildren(edFileIcon(edBase(input.value.trim())));
  });
  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") { ev.preventDefault(); edMake(it); }
    else if (ev.key === "Escape") { ev.preventDefault(); edNewDone(it, true); }
  });
  input.addEventListener("blur", () => setTimeout(() => {
    if (ed.newItem === it && !it.busy && document.activeElement !== input) edNewDone(it);
  }, 0));
  ed.treeSig = ""; edTree();
  input.focus();
  wrap.scrollIntoView({ block: "nearest" });
}
function edNewDone(it, back = false) {
  if (ed.newItem !== it) return;
  ed.newItem = null;
  ed.treeSig = ""; edTree();
  if (back) { const r = ed.tree.querySelector(`.ed-row[tabindex="0"]`); if (r) r.focus({ preventScroll: true }); }
}
async function edMake(it) {
  const name = it.input.value.trim().replace(/\/+$/, "");
  if (!name) { edNewDone(it, true); return; }
  const bad = name.startsWith("/") ? "Enter a name in this folder, not a path from /"
    : name.split("/").some((x) => !x || x === "." || x === "..") ? "Folder names can't be empty, . or .." : "";
  if (bad) { it.err.textContent = bad; it.input.classList.add("bad"); return; }
  it.busy = true;
  const path = edJoin(it.dir, name);
  try {
    await post("/api/edit/create", { path, root: "/", dir: it.folder });
  } catch (e) {
    it.busy = false;
    it.err.textContent = e.message; it.input.classList.add("bad"); it.input.focus();
    return;
  }
  const made = it.folder ? path : edDir(path);
  edNewDone(it);
  await Promise.all([...new Set([it.dir, ...(made === it.dir ? [] : [made])])].map((d) => edList(d, false)));
  edOpenTo(made);
  if (it.folder) ed.cursor = path; else ed.revealing = path;
  edTree();
  if (it.folder) { const r = ed.tree.querySelector(`.ed-row[data-path="${CSS.escape(path)}"]`); if (r) { r.focus(); r.scrollIntoView({ block: "nearest" }); } }
  else edOpen(path);
}
