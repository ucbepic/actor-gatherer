// The panel of an app built on app_kit.fileedit: the page around its code -- what the dashboard's own page gave the
// Editor when it was drawn there (frontend/src/core/page/helpers.js and the others), small and as it was, and the
// dashboard reached through app_kit's SDK instead: the actors (`ag.actors`: their names, avatars, hues, folders, what
// they are doing), the theme, the agent in focus, and an intent the page asks of it (open-file). A module, as the rest
// are (editor.js, editor-tree.js, editor-open.js, editor-view.js, editor-send.js, recent.js, plain.js, start.js): each
// imports what it uses of the others, and the app's own module -- the panel's one entry -- gives its parts to edAdd and
// starts the panel (start.js's edStart). The libraries the panel loads before it, as plain scripts, are read as the
// globals they set: the kit (agKit), the SDK (AgApp), marked and DOMPurify.
const DASH = new URLSearchParams(location.search).get("host") || "";   // the dashboard's origin: its avatars
export const PANE = null, SNAPSHOT = false;          // (the page's: a pane's frame, a snapshot -- never here)

// ------------------------------------------------------------------ helpers (core/page/helpers.js's)
export const el = window.agKit.el;                // the panels' kit (app_kit/js/kit.js)
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
export function strokeIcon(d, size = 15) {
  const svg = svgEl("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": "true", fill: "none", stroke: "currentColor",
    "stroke-width": 1.4, "stroke-linecap": "round", "stroke-linejoin": "round" });
  svg.append(svgEl("path", { d }));
  return svg;
}
export const ICONS = {
  chevron: "M6 3.5 10.5 8 6 12.5",
  code: "M5.25 4.75L2 8l3.25 3.25M10.75 4.75L14 8l-3.25 3.25M9.25 2.75l-2.5 10.5",
  folder: "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z",
  folderNew: "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1zM8 7.1v4M6 9.1h4",
  folderUp: "M1.75 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.6a1 1 0 0 1 1 1v6.65a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1zM8 11.1V7.1M6.3 8.8 8 7.1l1.7 1.7",
  page: "M4.25 1.75h5l3 3v9a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5zM9 1.75v3.25h3.25M5.75 8.25h4.5M5.75 11h4.5",
  play: "M5 3.25v9.5L12.75 8z",
  reload: "M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.5v3h-3",
  restore: "M4 10.5 8 6.5l4 4M3 3.25h10",
  sidebar: "M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5zM6.25 2.75v10.5",
  terminal: "M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5z"
    + "M4.5 6.25l2 1.75-2 1.75M8.25 10.25h3.25",
  wrap: "M2 3.5h12M2 7.5h9.25a2.25 2.25 0 0 1 0 4.5H8.5M10 10.5 8.5 12 10 13.5M2 11.5h3.5",
};
export const HUE_MAIN = { red: "#ef4444", orange: "#f97316", yellow: "#fbbf24", lime: "#84cc16", green: "#22a55a", teal: "#14b8a6", sky: "#38bdf8",
  blue: "#3b6cf6", purple: "#8b5cf6", pink: "#f472b6", brown: "#a0683a", gray: "#64748b" };
export const full = (v) => v === null || v === undefined ? "–" : Math.round(v).toLocaleString();
export const ago = agKit.ago;                        // as the dashboard says it (the panels' kit)
export const firstLine = (t, n = 160) => { const l = String(t ?? "").split("\n")[0]; return l.length > n ? l.slice(0, n) + "…" : l; };
export const plural = (n, w) => `${full(n)} ${w}${n === 1 ? "" : "s"}`;
export const MAC = /mac|iphone|ipad/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "");
// A path with the home folder as ~ (the highlighter's, frontend/src/core/ui/highlight/command.ts).
export const tildePath = (p, home) => !p ? "" : home && (p === home || p.startsWith(home + "/")) ? "~" + p.slice(home.length) : p;
// The language of a file by its name, and the dashboard's highlighter: from the editor's bundle, once it is loaded
// (the first file opened; an actor's changes are shown only beside a file open).
export const langOfPath = (p) => (window.agEditor ? window.agEditor.ui.langOfPath(p) : null);
const hlLines = (t, lang) => window.agEditor.ui.hlLines(t, lang);
const hlPart = (...a) => window.agEditor.ui.hlPart(...a);
const guessWeb = (t) => window.agEditor.ui.guessWeb(t);
const ansiHtml = (t) => window.agEditor.ui.ansiHtml(t);
// The theme the dashboard shows, as its page has it (features/page/data.js's shownTheme): told to this panel by the SDK.
export const shownTheme = () => (agApp && agApp.theme.current && agApp.theme.current.mode) || "light";
// The panel's backend: its requests on its own origin, as the dashboard's routes were (a JSON body; {error} refused),
// each naming its Editor (`forEditor`: its gatherer and instance, which the host passes on to the backend).
export const forEditor = (path) => {
  if (!agApp || !agApp.instance) return path;
  const q = new URLSearchParams({ gatherer: agApp.gatherer, instance: agApp.instance });
  return `${path}${path.includes("?") ? "&" : "?"}${q}`;
};
export async function get(path) {
  const r = await fetch(forEditor(path), { cache: "no-store" });
  const got = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(got.error || `${path}: ${r.status}`), { status: r.status });
  return got;
}
// `keep`: sent even if the panel goes meanwhile (taken away with its task, or the page closed), the request outliving it --
// as long as it is small enough for the browser to allow that (KEEPALIVE_MAX).
const KEEPALIVE_MAX = 60000;     // bytes: what the browser lets the requests outliving a page carry is 64 KiB in all
export async function post(path, body, keep = false) {
  const data = JSON.stringify(body);
  const r = await fetch(forEditor(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: data,
    keepalive: keep && data.length < KEEPALIVE_MAX });
  const got = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(got.error || `${path}: ${r.status}`), { status: r.status });
  return got;
}
// A line over the panel for a moment: why nothing happened (features/layout/panes.js's, over the panes).
export function paneNote(text) {
  const n = el("div", { class: "pane-note", role: "status", text });
  document.body.append(n);
  setTimeout(() => n.remove(), 3500);
}
// A column's width, dragged at its edge (grip): set as node's prop, at least min (its most: the stylesheet's max),
// kept under key; at(x) is the width the pointer at x gives. A double click: the stylesheet's width again.
export function widthGrip(grip, key, node, prop, min, at) {
  const set = (w) => w > 0 ? node.style.setProperty(prop, `${Math.round(Math.max(min, w))}px`) : node.style.removeProperty(prop);
  try { set(Number(localStorage.getItem(key))); } catch (e) { /* this page only */ }
  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    grip.classList.add("on"); document.body.classList.add("resizing");   // the frames let the pointer by while it drags
    const move = (e) => set(at(e.clientX));
    const up = () => {
      grip.classList.remove("on"); document.body.classList.remove("resizing");
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
      try { localStorage.setItem(key, String(parseInt(node.style.getPropertyValue(prop)) || "")); } catch (e) { /* this page only */ }
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => { set(0); try { localStorage.removeItem(key); } catch (e) { /* this page only */ } });
}

// ------------------------------------------------------------------ the actors (the SDK's ag.actors)
// As the dashboard's list has them: `state.home.gatherers`, each {name, agents: [{channel, name, last_user_message,
// avatar, avatar_hue, cwd, status: [kind, said], last}]}, and the dashboard's own folder and the home folder.
export const state = { home: { gatherers: [], home_dir: "", cwd: "" }, selected: null, editor: true };
export const statusOf = (a) => (a && a.status) || ["idle", "Idle"];
// An avatar's picture, from the dashboard (an image from another origin: shown, never read).
export const avatarSrc = (name) => `${DASH}/avatars/${encodeURIComponent(name)}.svg`;
// What an actor's branch is (features/layout/panes.js's branchRoute): where it works, and where its changes go.
const checkedOut = (o) => !o || !o.head ? "?" : o.branch || `${o.head} (no branch)`;
export const branchRoute = (b) => `Branch ${b.branch} in ${tildePath(b.worktree, state.home.home_dir)}, `
  + `started from ${b.started_on || "a commit"} at ${(b.start || "").slice(0, 7)}.\n`
  + `Merges into ${tildePath(b.project, state.home.home_dir)} (on ${checkedOut(b.onto)} now)`
  + `${b.approve ? " once you approve each change" : ", except on lines you're editing or changed"}.`;

// ------------------------------------------------------------------ a file's lines, as Chat shows them (features/chat/files-view.js's)
const FILE_KINDS = { read: ["read", "var(--s1)"], hit: ["search hit", "var(--s4)"], edit: ["edited", "var(--s2)"],
  write: ["written", "var(--s3)"], delete: ["deleted", "var(--critical)"] };
const MARKS = {
  read: "M8 4.25C6.6 3.2 4.6 2.9 2 3.1v9.2c2.6-.2 4.6.1 6 1.15 1.4-1.05 3.4-1.35 6-1.15V3.1c-2.6-.2-4.6.1-6 1.15zM8 4.25v9.2",
  hit: "M6.75 2.5a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 0 0 0-8.5zM9.9 9.9l3.6 3.6",
  edit: "M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8",
  write: "M4.25 1.75h5l3 3v9a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5zM9 1.75v3.25h3.25M8 7.25v4.5M5.75 9.5h4.5",
  delete: "M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.65 9.1a.75.75 0 0 0 .75.65h4.7a.75.75 0 0 0 .75-.65l.65-9.1M6.75 6.75v4.5M9.25 6.75v4.5",
  git: "M5 5v6M11 7c0 2.6-6 1.4-6 4M5 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM5 11a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM11 3.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z",
};
export function kindMark(kind, size = 12, title) {
  const [name, color] = FILE_KINDS[kind] || [kind, "var(--muted)"];
  const svg = MARKS[kind] ? strokeIcon(MARKS[kind], size) : el("i", { class: "fb", style: `background: ${color}` });
  svg.style.color = color;
  return el("span", { class: "km", title: title === undefined ? name : title }, svg);
}
export const changedCount = (ch) => !ch || !(ch[0] || ch[1]) ? null
  : el("span", { class: "chg", title: `${plural(ch[0], "line")} added, ${plural(ch[1], "line")} removed` },
    ch[0] ? el("span", { class: "a", text: `+${full(ch[0])}` }) : null, ch[1] ? el("span", { class: "r", text: `−${full(ch[1])}` }) : null);
const fileLine = (n, cls, mark, text, html) => {
  const tx = el("span", { class: "tx" });
  if (html === undefined) tx.textContent = text; else tx.innerHTML = html || "&#8203;";
  return el("div", { class: "ln " + cls }, el("span", { class: "no", text: n === null || n === undefined ? "" : String(n) }), el("span", { class: "mk", text: mark }), tx);
};
const fileGap = (text) => el("div", { class: "gap", text });
// a block of the file's lines (`lang` the file's language, langOfPath), each run of them coloured together -- from
// inside a comment or a string it begins in, unless it starts at the file's top (hlPart); what a command printed (an
// "output" block) as it printed it
export function fileBlock(b, lang) {
  const out = [];
  const hl = (ls, top) => { const t = ls.join("\n"); return top ? hlLines(t, lang === "html" ? guessWeb(t) : lang) : hlPart(lang, t)[0]; };
  const cut = () => { if (b.cut) out.push(fileGap(`+${plural(b.cut, "more line")} not shown`)); };
  if (b.t === "lines") {
    if (b.start === null) out.push(fileGap("position in the file unknown"));
    const h = hl(b.lines, b.start === 1);
    b.lines.forEach((t, i) => out.push(fileLine(b.start === null ? null : b.start + i, "read", "", t, h[i])));
    cut();
  } else if (b.t === "output") {
    out.push(fileGap(b.note));
    const h = ansiHtml(b.lines.join("\n")).split("\n");
    b.lines.forEach((t, i) => out.push(fileLine(null, "read", "", t, h[i] ?? "")));
    cut();
  } else if (b.t === "hits") {
    let prev = null, run = [];
    const flush = () => { const h = hl(run.map((r) => r[1])); run.forEach(([n, t], i) => out.push(fileLine(n, "hit", "›", t, h[i]))); run = []; };
    for (const r of b.rows) {
      if (prev !== null && r[0] > prev + 1) { flush(); out.push(fileGap("⋯")); }
      run.push(r);
      prev = r[0];
    }
    flush();
    cut();
  } else if (b.t === "diff") {
    if (b.at === null) out.push(fileGap("position in the file unknown"));
    const above = b.above || [], below = b.below || [], ctx = (rows) => rows.map((r) => r[1]);
    const [was, now] = hlPart(lang, [...ctx(above), ...b.old, ...ctx(below)].join("\n"), [...ctx(above), ...b.new, ...ctx(below)].join("\n"));
    above.forEach(([n, t], i) => out.push(fileLine(n, "ctx", "", t, was[i])));
    b.old.forEach((t, i) => out.push(fileLine(b.at === null ? null : b.at + i, "del", "−", t, was[above.length + i])));
    b.new.forEach((t, i) => out.push(fileLine(b.at === null ? null : b.at + i, "add", "+", t, now[above.length + i])));
    below.forEach(([n, t], i) => out.push(fileLine(n, "ctx", "", t, now[above.length + b.new.length + i])));
    out.push(el("div", { class: "sep" }));
  } else if (b.t === "write") {
    const h = hl(b.lines, true);
    b.lines.forEach((t, i) => out.push(fileLine(i + 1, "add", "+", t, h[i])));
    cut();
  } else if (b.t === "append") {
    out.push(fileGap("added at the end of the file"));
    const h = hl(b.lines, true);
    b.lines.forEach((t, i) => out.push(fileLine(null, "add", "+", t, h[i])));
    cut();
  } else if (b.t === "image") {
    out.push(fileGap("an image the agent viewed"));
  } else if (b.t === "note") {
    out.push(el("div", { class: "fv-note", text: b.text }));
  }
  return out;
}

// ------------------------------------------------------------------ the dashboard around it
export let agApp = null;                             // the SDK, once connected (start.js's edStart: setAgApp)
export function setAgApp(ag) { agApp = ag; }
