// The project's preview, beside the LaTeX editor's file (ed.pv): its state, its form, the question about an agent's command,
// and the result or the output of its latest run -- the Preview app's panel before the LaTeX editor took it in, as it was.
// Its backend's tools for what changes (preview_set, _run, _stop), its own routes for what is read (preview/about,
// preview/files/, preview/synctex), its messages for each run as it goes; the LaTeX editor runs it (pvRun: Execute, ⌘↵) and
// asks for a source's place in the PDF (pvLocate: "→ PDF"), and opens what it sends back (a place in the PDF's source:
// edShowFile). Hidden until it is first run, or opened by its button; its × hides it again. A LaTeX build's errors,
// warnings and bad boxes (its log's, read by the backend: runs.problems) are listed under Problems, each opening its
// file at its line, and marked on those lines in the LaTeX editor (edProblems).
import { agApp, el } from "/_ag/lib/fileedit/page.js";
import { ed, edShowFile } from "/_ag/lib/fileedit/editor.js";
import { edExecute, edProblems, pvPath } from "./latex.js";

let pvApi = null;
// What this LaTeX editor's preview showed, kept in this browser (as its file is: edKeepFile), so that, its panel drawn again
// (its task left and come back to, the page reloaded), it opens as it was left: shown or not; for the run it showed,
// the tab picked and where its output and its result were scrolled; and, for the PDF it showed, its place (page, zoom,
// where on it) -- pdf.js keeps one itself only for the very same build, not for one made meanwhile.
const PV_KEEP_MS = 250;          // ms after the preview last moves that where it is is kept
const pvKey = () => `ag-editor-preview:${(agApp && agApp.instance) || ""}`;
function pvKept() {
  try { const v = JSON.parse(localStorage.getItem(pvKey()) || "null"); return v && typeof v === "object" ? v : {}; }
  catch (e) { return {}; }
}
let pvRec = null, pvDirty = false, pvKeepT = null;   // this LaTeX editor's record, as this page keeps it
function pvKeep(change) {
  const rec = pvRec || (pvRec = pvKept());
  if (change.run && change.run !== rec.run) { delete rec.picked; delete rec.out; delete rec.result; delete rec.probs; }   // another run's
  Object.assign(rec, change);
  pvDirty = true;
  clearTimeout(pvKeepT);
  pvKeepT = setTimeout(pvFlush, PV_KEEP_MS);
}
function pvFlush() {
  clearTimeout(pvKeepT);
  if (!pvDirty) return;
  try { localStorage.setItem(pvKey(), JSON.stringify(pvRec)); } catch (e) { /* this page only */ }
  pvDirty = false;
}
window.addEventListener("pagehide", pvFlush);       // what moved last, as the panel goes
function pvShow(on) {
  if (!ed.pv) return;
  ed.pv.hidden = !on;
  try { localStorage.setItem("ag-editor-preview-shown", on ? "1" : ""); } catch (e) { /* this page only */ }   // a new LaTeX editor's
  pvKeep({ shown: !!on }); pvFlush();
  if (on && pvApi) pvApi.shown();                    // what it is, for the file open (or the folder shown), once
}
export async function pvRun(d) { pvShow(true); if (pvApi) await pvApi.run(d); }
export async function pvLocate(d) { pvShow(true); if (pvApi) await pvApi.locate(d); }
export function pvMount(box) {
  box.replaceChildren(el("div", { id: "pv", class: "pv" },
    el("div", { class: "pv-edge", "aria-hidden": "true" }),
    el("div", { class: "pv-top" }, el("div", { class: "pv-h" }), el("div", { class: "pv-cmd", hidden: "" })),
    el("div", { class: "pv-body" },
      el("div", { class: "pv-card", hidden: "" }), el("div", { class: "pv-result" }),
      el("div", { class: "pv-probs", hidden: "" }),
      el("pre", { class: "pv-out", tabindex: "0", "aria-label": "Output", hidden: "" }),
      el("button", { type: "button", class: "pv-busy", hidden: "",
        title: "Rebuilding · click to see the output" }))));
  pvApi = pvMake(agApp, box.firstChild);
  let shown = pvKept().shown;                        // this LaTeX editor's, else as the last one was left
  if (typeof shown !== "boolean") try { shown = localStorage.getItem("ag-editor-preview-shown") === "1"; } catch (e) { shown = false; }
  if (shown) queueMicrotask(() => pvShow(true));     // (once the LaTeX editor has its folder: edMount)
}
function pvMake(ag, root) {
  const OUT_MAX = 300000;                               // the most characters of a run's output kept here
  // eslint-disable-next-line no-control-regex -- a terminal's escapes (ESC [ ..., ESC ] ... BEL), taken out
  const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
  const NO_SIDEBAR = 0;                                 // pdf.js's SidebarView.NONE
  const dom = { head: root.querySelector(".pv-h"), cmd: root.querySelector(".pv-cmd"), card: root.querySelector(".pv-card"),
    result: root.querySelector(".pv-result"), output: root.querySelector(".pv-out"), busy: root.querySelector(".pv-busy"),
    probs: root.querySelector(".pv-probs") };
  const pv = { path: null, file: null, about: null, run: null, out: "", picked: null, form: null, err: "", busy: false,
    sig: "", card: "", held: null, peek: null, pdf: null, pinned: true, tick: null,
    probs: null, probsSig: "", probsOpen: new Set(), boxesOpen: false,    // the latest LaTeX build's problems (problems())
    back: pvKept(), outTop: null, resultTop: null, probsTop: null };  // back: as it was left (pvKept), taken once each; *Top: its scrolls

  // ---- helpers
  function el(...a) { return window.agKit.el(...a); }   // the panels' kit (app_kit/js/kit.js)
  const spell = (s) => s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - (t || 0)); return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
  const clean = (t) => t.replace(ANSI, "").replace(/\r\n/g, "\n").split("\n")
    .map((l) => l.includes("\r") ? l.split("\r").filter(Boolean).pop() || "" : l).join("\n");
  const json = (r) => { const t = (r.content || []).map((c) => c.text || "").join(""); if (r.isError) throw new Error(t); return JSON.parse(t); };
  const call = async (tool, args) => json(await ag.tools.call(`preview_${tool}`, args));
  async function api(path, init) {
    const r = await ag.api(`preview/${path}`, init);
    const got = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(got.error || `${r.status}`);
    return got;
  }

  // ---- what it is, and its runs as they go
  async function load() {
    try {
      const a = await api(`about${pv.path ? `?path=${encodeURIComponent(pv.path)}` : ""}`);
      const moved = !pv.about || pv.about.checkout !== a.checkout;
      pv.about = a; pv.err = "";
      if (moved || !pv.run || (a.run && a.run.id !== pv.run.id)) {
        pv.run = a.run; pv.out = (a.dropped ? "…\n" : "") + (a.output || ""); pv.picked = null; pv.sig = ""; pv.held = null;
        if (moved || !a.run || a.run.state !== "running") problems(a.run && a.run.problems);
      }
      const b = pv.back;
      if (b.run && pv.run && b.run === pv.run.id) {   // the run it showed when it was left: its tab, its scrolls
        pv.picked = ["result", "output", "problems"].includes(b.picked) ? b.picked : null;
        if (typeof b.out === "number") { pv.pinned = false; pv.outTop = b.out; }
        if (typeof b.result === "number") pv.resultTop = b.result;
        if (typeof b.probs === "number") pv.probsTop = b.probs;
      }
      b.run = null;
    } catch (e) { pv.err = e.message; }
    draw(); out();
  }
  ag.onMessage((m) => {
    if (!m) return;
    if (m.run) {
      const r = m.run;
      if (pv.about && r.checkout !== pv.about.checkout) return;         // another worktree's run
      if (pv.run && r.id !== pv.run.id && r.started < pv.run.started) return;
      if (!pv.run || r.id !== pv.run.id) { pv.out = ""; pv.picked = null; }
      if (pv.peek === r.id && r.state !== "running") { pv.picked = null; pv.peek = null; }
      if (r.state !== "running" && !(r.server && r.state === "ready")) problems(r.problems);   // while it runs: the last build's
      pv.run = r; draw();
    } else if (m.out) {
      const o = m.out;
      if (o.reset) pv.out = (o.dropped ? "…\n" : "") + o.text;
      else if (pv.run && o.id === pv.run.id) pv.out += o.text;
      else return;
      if (pv.out.length > OUT_MAX) pv.out = "…" + pv.out.slice(-OUT_MAX);
      out();
    } else if ("preview" in m && m.preview) {
      if (!pv.about || m.preview.key !== pv.about.key) return;          // another project's
      pv.about.preview = m.preview.row;
      draw();
    }
  });

  // ---- what the LaTeX editor asks: run it (Execute), and show a source's place in the PDF ("→ PDF")
  async function runFor(d) {
    if (d && d.path) { pv.path = d.path; pv.file = d.file || d.path; }
    await load();
    execute();
  }
  async function locate(d) {
    if (!d || !d.path) return;
    if (!pv.about || pv.path !== d.path) { pv.path = d.path; pv.file = d.path; await load(); }
    toPdf(d.path, Number(d.line) || 1, Number(d.column) || 0);
  }
  function execute() {
    if (!pv.about || pv.busy) return;
    const p = pv.about.preview;
    if (!p) return edit();
    if (p.needs_ok) return draw();                                       // its card asks
    runIt();
  }
  async function runIt(ok = null) {
    if (!pv.about || pv.busy) return;
    pv.busy = true; pv.err = ""; pv.picked = null; draw();
    try {
      const got = await call("run", { ...(pv.path ? { path: pv.path } : {}), ...(pv.file ? { file: pv.file } : {}), ...(ok !== null ? { ok } : {}) });
      pv.about.preview = got.preview; pv.about.token = got.token;
      if (!pv.run || got.run.id !== pv.run.id) { pv.run = got.run; pv.out = got.output || ""; }
    } catch (e) { pv.err = e.message; }
    pv.busy = false; draw(); out();
  }
  async function stopIt() {
    try { await call("stop", { ...(pv.path ? { path: pv.path } : {}) }); } catch (e) { pv.err = e.message; draw(); }
  }
  function edit() {
    const p = (pv.about && (pv.about.preview || pv.about.guess)) || { command: "", show: "" };
    pv.form = { command: p.command || "", show: p.show || "", node: null };
    draw();
  }

  // ---- drawing
  function state(r) {
    if (!r) return ["", "Not run yet"];
    const t = (r.ended || Date.now() / 1000) - r.started, took = t < 10 ? `${Math.max(t, 0.1).toFixed(1)}s` : spell(t);
    return ({ running: ["run", r.server ? `Starting · ${took}` : `Running · ${took}`], ready: ["ok", r.command ? "Serving" : "Shown"],
      done: ["ok", r.command ? `Done · ${took}` : "Shown"], failed: ["bad", `Failed · exit ${r.code}`],
      stopped: ["", "Stopped"], "timed out": ["bad", "Timed out after 5 minutes"] })[r.state] || ["", r.state];
  }
  // What the body shows unless the user picks: the result once there is one (the one made before kept while the next
  // is made, "Building…" over it), the output when it failed or is all there is, a server's while it starts.
  function auto(r) {
    const s = (r && r.shows) || {};
    if (!r) return "result";
    if ((r.state === "failed" || r.state === "timed out") && pv.probs && pv.probs.list.some((p) => p.level === "error")) return "problems";
    if (!s.url && !s.path) return "output";
    if (r.state === "failed" || r.state === "timed out") return "output";
    if (s.url) return r.state === "ready" ? "result" : "output";
    return r.state === "running" || s.exists ? "result" : "output";
  }
  // The address of a run's file: while it runs, the one shown before it, not the file as it is being written.
  function shown(r) {
    const a = pv.about, s = r && r.shows;
    if (!s) return null;
    if (s.url) return s.url;
    const q = new URLSearchParams({ gatherer: ag.gatherer, instance: ag.instance, v: String(s.mtime || 0) });
    const url = s.path && s.exists && a ? `/api/preview/files/${a.token}/${s.rel.split("/").map(encodeURIComponent).join("/")}?${q}` : null;
    if (r.state === "running" && pv.held !== null && !(pv.held && pv.held.rel !== s.rel)) return pv.held && pv.held.url;
    pv.held = url ? { rel: s.rel, url } : (r.state === "running" ? false : null);
    return url;
  }
  function busyText() {
    const r = pv.run, t = r && r.state === "running" ? Date.now() / 1000 - r.started : null;
    dom.busy.replaceChildren(el("span", { text: "Building…" }),
      t !== null ? el("span", { class: "t", text: t < 10 ? `${Math.max(t, 0.1).toFixed(1)}s` : spell(t) }) : null,
      el("span", { class: "o", text: "Output" }));
  }
  dom.busy.addEventListener("click", () => { if (pv.run) { pv.picked = "output"; pv.peek = pv.run.id; draw(); } });
  dom.output.addEventListener("scroll", () => {
    const o = dom.output;
    if (!o.clientHeight) return;                      // not drawn (the panel going): as it was
    pv.pinned = o.scrollTop + o.clientHeight >= o.scrollHeight - 8;
    if (pv.run) pvKeep({ run: pv.run.id, out: pv.pinned ? null : Math.round(o.scrollTop) });
  });
  dom.result.addEventListener("scroll", (ev) => {    // a text's or a page of Markdown's (a PDF's: its own, pdfKeep)
    const n = ev.target;
    if (pv.run && n.clientHeight && (n === dom.result || n.parentNode === dom.result)) pvKeep({ run: pv.run.id, result: Math.round(n.scrollTop) });
  }, true);
  dom.probs.addEventListener("scroll", () => {      // the problems' list: where it was left, as the output's
    const n = dom.probs;
    if (pv.run && n.clientHeight) pvKeep({ run: pv.run.id, probs: Math.round(n.scrollTop) });
  });
  // a tab picked: kept for the run it shows
  function pick(k) {
    pv.picked = k;
    if (pv.run) pvKeep({ run: pv.run.id, picked: k });
    draw();
  }

  function draw() {
    const a = pv.about, p = a && a.preview, r = pv.run;
    const stat = el("span", { class: "pv-st", role: "status" });
    const [cls, said] = pv.busy && !(r && r.state === "running") ? ["run", "Starting…"] : state(r);
    stat.className = `pv-st ${cls}`; stat.textContent = said;
    const live = r && (r.state === "running" || (r.server && r.state === "ready"));
    if (r && r.state === "running" && !pv.tick) pv.tick = setInterval(() => {
      if (!pv.run || pv.run.state !== "running") { clearInterval(pv.tick); pv.tick = null; return; }
      const s = dom.head.querySelector(".pv-st");
      if (s) s.textContent = state(pv.run)[1];
      if (!dom.busy.hidden) busyText();
    }, 1000);
    const card = pv.form ? "form" : pv.err && !a ? "err" : !a ? "loading" : !p ? "none" : p.needs_ok ? "ask" : !r ? "idle" : "";
    let tab = card ? null : pv.picked || auto(r);
    if (tab === "problems" && !pv.probs) tab = auto(r);
    const hasResult = r && r.shows && (r.shows.url || r.shows.path);
    const url = shown(r);
    root.classList.toggle("hov", tab === "result");
    const building = (tab === "result" && !!(r && r.shows && r.shows.path) || tab === "problems") && (r && r.state === "running" || pv.busy);
    dom.busy.hidden = !building;
    if (building) busyText();
    const btn = (text, title, onclick, attrs = {}) => el("button", { type: "button", title, onclick, ...attrs }, text);
    dom.head.replaceChildren(...[
      el("span", { class: "t", text: "Preview" }),
      el("span", { class: "nm", title: a ? (a.git ? `${a.key} and its worktrees` : `${a.key} (not a git project)`) : null, text: a ? a.name : "" }),
      card === "" || pv.busy ? stat : null,
      tab && (hasResult || pv.probs) ? el("span", { class: "pv-tabs", role: "group", "aria-label": "Show" },
        ...[hasResult && ["result", "Result", "What it makes"], pv.probs && ["problems", probsLabel(), probsTitle()],
          ["output", "Output", "What it printed"]].filter(Boolean).map(([k, t, title]) => btn(t, title,
          () => pick(k), { class: tab === k ? "on" : null, "aria-pressed": tab === k ? "true" : "false" }))) : null,
      live ? btn("Stop", r.server ? "Stop the server" : "Stop the run", stopIt)
        : p && !p.needs_ok && !pv.form ? btn(r ? "Re-run" : "Run", `${r ? "Run again" : "Run"}: ${p.command || "nothing to run"}`, () => runIt(), { disabled: pv.busy }) : null,
      p && !pv.form ? btn("Edit", "Edit the command and what it shows", edit) : null,
      el("button", { type: "button", class: "pv-x", title: "Hide the preview", "aria-label": "Hide the preview",
        onclick: () => pvShow(false) }, "×"),
    ].filter(Boolean));
    dom.cmd.hidden = !p || !!pv.form;
    if (p && !pv.form) dom.cmd.replaceChildren(...[
      el("code", { title: `In ${a.checkout}: ${p.command || "nothing to run"}${p.show ? `, showing ${p.show}` : ""}` },
        p.command ? `$ ${p.command}` : "(nothing to run)", p.show ? el("span", { class: "to", text: `  →  ${p.show}` }) : null),
      url && tab === "result" ? el("a", { class: "pv-open", href: url, target: "_blank", rel: "noopener", title: "Open in a new tab" }, "↗") : null,
      el("span", { class: "by", title: `Set ${new Date((p.set_at || 0) * 1000).toLocaleString()}` },
        p.set_by ? `set by an agent (${p.set_by.slice(0, 8)}), ${ago(p.set_at)}` : `set by you, ${ago(p.set_at)}`),
    ].filter(Boolean));
    const err = pv.err ? el("div", { class: "err", text: pv.err }) : null;
    dom.card.hidden = !card && !pv.err;
    if (card === "form") {
      if (!pv.form.node) pv.form.node = form();
      if (pv.card !== "form" + pv.err || dom.card.lastChild !== pv.form.node) {
        pv.card = "form" + pv.err;
        dom.card.replaceChildren(...[err, pv.form.node].filter(Boolean));
      }
    } else {
      const sig = JSON.stringify([card, pv.err, p && [p.command, p.show, p.set_by, p.needs_ok], a && a.name]);
      if (sig !== pv.card) {
        pv.card = sig;
        dom.card.replaceChildren(...[err, card === "ask" ? ask() : card === "none" ? none() : card === "idle"
          ? el("div", { class: "note", text: "Not run yet." }) : card === "loading" ? el("div", { class: "note", text: "Loading…" }) : null].filter(Boolean));
      }
    }
    dom.result.classList.toggle("off", tab !== "result");       // laid out still: a PDF's viewer keeps its place
    dom.output.hidden = tab !== "output";
    dom.probs.hidden = tab !== "problems";
    dom.probs.classList.toggle("old", tab === "problems" && building);
    if (tab === "result") result(url);
    if (tab === "output") out();
    if (tab === "problems") probsDraw();
  }
  function form() {
    const f = pv.form, a = pv.about || {};
    const field = (label, key, placeholder, hint) => {
      const input = el("input", { type: "text", value: f[key], placeholder, spellcheck: "false", autocomplete: "off", name: key });
      input.addEventListener("input", () => { f[key] = input.value; });
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save(true); } });
      return el("label", {}, label, input, el("span", { class: "note", text: hint }));
    };
    const save = async (run) => {
      try {
        const got = await call("set", { command: f.command, show: f.show, ...(pv.path ? { path: pv.path } : {}) });
        pv.about = { ...pv.about, ...got }; pv.form = null; pv.err = ""; pv.card = "";
        draw();
        if (run) runIt();
      } catch (e) { pv.err = e.message; draw(); }
    };
    const node = el("div", { class: "pv-form" },
      el("div", { class: "head" }, a.preview ? "Change this project's preview" : "Set up a preview for this project",
        a.name ? el("span", { class: "note", text: ` · ${a.name}${a.git ? ", and its worktrees" : ""}` }) : null),
      field("Command", "command", "python3 {file}", "Runs in your shell, in the project's checkout. Leave empty to show without running anything."),
      field("Show", "show", "out.png · {stem}.pdf · http://localhost:5173", "A file the command makes, or the URL of a server it starts. Leave empty to show its output."),
      el("div", { class: "note" }, el("code", { text: "{file}" }), " ", el("code", { text: "{stem}" }), " ", el("code", { text: "{name}" }), " ",
        el("code", { text: "{dir}" }), " stand for the open file's path in the project, that path without its extension, its name, and its folder."),
      el("div", { class: "row" },
        el("button", { type: "button", class: "primary", onclick: () => save(true) }, "Save and run"),
        el("button", { type: "button", onclick: () => save(false) }, "Save"),
        el("button", { type: "button", onclick: () => { pv.form = null; pv.err = ""; pv.card = ""; draw(); } }, "Cancel")),
      el("div", { class: "note" }, "Agents can set it too. You're asked before an agent's command first runs."));
    setTimeout(() => { const i = node.querySelector("input"); if (i && pv.form && pv.form.node === node) i.focus(); }, 0);
    return node;
  }
  function ask() {
    const a = pv.about, p = a.preview;
    return el("div", { class: "pv-ask" },
      el("div", { class: "head", text: `An agent (${p.set_by.slice(0, 8)}) set this project's preview, ${ago(p.set_at)}:` }),
      el("pre", { text: `$ ${p.command}` }),
      el("div", { class: "note", text: `Shows: ${p.show || "its output"}. It runs in ${a.checkout} as you, outside the agent's permissions, so it needs your OK first.` }),
      el("div", { class: "row" },
        el("button", { type: "button", class: "primary", onclick: () => runIt(p.command) }, "Run it"),
        el("button", { type: "button", onclick: edit }, "Edit…")));
  }
  function none() {
    return el("div", {}, el("div", { class: "note", text: `No preview is set for ${pv.about.name} yet.` }),
      el("div", { class: "row" }, el("button", { type: "button", class: "primary", onclick: edit }, "Set one up")));
  }
  function result(url) {
    const r = pv.run, s = (r && r.shows) || {}, box = dom.result;
    const sig = JSON.stringify([url ? null : r && r.id, url, s.kind, url ? null : s.exists, r && r.state === "ready", !url && r && r.state === "running"]);
    if (sig === pv.sig) return;
    pv.sig = sig;
    if (!r) return box.replaceChildren();
    if (s.error) return box.replaceChildren(el("div", { class: "pv-note", text: s.error }));
    if (s.path && !url) return box.replaceChildren(el("div", { class: "pv-note" },
      el("code", { text: s.rel }), r.state === "running" ? " shows here once the run ends." : " wasn't made by the command."));
    if (s.url && r.state !== "ready") return box.replaceChildren(el("div", { class: "pv-note", text: `Waiting for ${s.url}…` }));
    if (s.kind === "image" || s.kind === "svg") return box.replaceChildren(el("div", { class: "img" }, el("img", { src: url, alt: s.rel || "", draggable: "false" })));
    if (s.kind === "pdf") return pdf(box, url, s.rel);
    if (s.kind === "url") return box.replaceChildren(el("iframe", { src: url, title: "Preview", class: "url" }));
    if (s.kind === "html") return box.replaceChildren(el("iframe", { src: url, title: "Preview", sandbox: "allow-scripts allow-forms allow-modals allow-popups" }));
    box.replaceChildren(el("div", { class: "pv-note", text: "Loading…" }));
    fetch(url, { cache: "no-store" }).then((x) => x.ok ? x.text() : Promise.reject(new Error(`${x.status}`))).then((text) => {
      if (pv.sig !== sig) return;
      if (s.kind === "markdown" && window.marked && window.DOMPurify) {
        const md = el("div", { class: "md" });
        md.innerHTML = DOMPurify.sanitize(marked.parse(text));
        box.replaceChildren(md);
        scrollBack(box);
      } else { box.replaceChildren(el("pre", { text })); scrollBack(box.firstChild); }
    }).catch((e) => { if (pv.sig === sig) box.replaceChildren(el("div", { class: "pv-note", text: `Couldn't read it: ${e.message}` })); });
  }
  function scrollBack(node) {                         // where it was left, once: the run it showed then
    if (pv.resultTop > 0) node.scrollTop = pv.resultTop;
    pv.resultTop = null;
  }
  function out() {
    if (pv.outQueued) return;
    pv.outQueued = true;
    requestAnimationFrame(() => {
      pv.outQueued = false;
      const o = dom.output, r = pv.run, text = clean(pv.out);
      o.textContent = text || (r && r.state === "running" ? "" : r && r.command ? "(No output.)" : "(Nothing ran.)");
      if (pv.pinned) o.scrollTop = o.scrollHeight;
      else if (pv.outTop !== null && text) { o.scrollTop = pv.outTop; pv.outTop = null; }   // where it was left
    });
  }

  // ---- a LaTeX build's problems: its errors, then its warnings, then its bad boxes (folded into one row), each opening
  // its file at its line in the LaTeX editor; its log's lines for it shown under it (▸). Those of the latest build that has
  // ended: a build running, the last one's, dimmed. Marked on their lines in the LaTeX editor too (edProblems).
  function problems(p) {
    const was = pv.probs;
    pv.probs = p || null;
    if (!was || !p || was.at !== p.at) { pv.probsOpen.clear(); pv.probsSig = ""; }
    edProblems(p ? p.list : [], p ? p.at : 0);
  }
  const count = (level) => pv.probs ? pv.probs.list.filter((p) => p.level === level).length : 0;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function probsLabel() {
    const e = count("error"), w = count("warning");
    return el("span", { class: "pv-pr-tab" }, "Problems", e ? el("span", { class: "n error", text: String(e) }) : null,
      w ? el("span", { class: "n warning", text: String(w) }) : null);
  }
  function probsTitle() {
    return `${plural(count("error"), "error", "errors")}, ${plural(count("warning"), "warning", "warnings")} and ` +
      `${plural(count("box"), "bad box", "bad boxes")} in the log`;
  }
  function probsDraw() {
    const P = pv.probs, box = dom.probs, a = pv.about;
    const sig = JSON.stringify([P && P.at, P && P.list.length, P && P.fresh, pv.boxesOpen, [...pv.probsOpen], a && a.checkout]);
    if (sig === pv.probsSig) return;
    pv.probsSig = sig;
    if (!P) return box.replaceChildren();
    const at = P.list.map((p, i) => [p, i]), kids = [];
    if (!P.fresh) kids.push(el("div", { class: "pv-pr-note", text: `From the build ${ago(P.at)}. This run didn't rebuild the document.` }));
    if (!P.list.some((p) => p.level !== "box")) kids.push(el("div", { class: "pv-pr-none", text: "No errors or warnings." }));
    for (const level of ["error", "warning"]) for (const [p, i] of at) if (p.level === level) kids.push(...probRow(p, i));
    const boxes = at.filter(([p]) => p.level === "box");
    if (boxes.length) {
      kids.push(el("button", { type: "button", class: "pv-pr-group", "aria-expanded": pv.boxesOpen ? "true" : "false",
        onclick: () => { pv.boxesOpen = !pv.boxesOpen; probsDraw(); } },
        el("span", { class: "tw", text: "▸" }), `${plural(boxes.length, "bad box", "bad boxes")}: overfull and underfull`));
      if (pv.boxesOpen) for (const [p, i] of boxes) kids.push(...probRow(p, i));
    }
    kids.push(el("div", { class: "pv-pr-foot" }, el("span", { text: `From ${P.log}` }),
      el("button", { type: "button", onclick: () => pick("output") }, "Show output")));
    box.replaceChildren(...kids);
    if (pv.probsTop > 0) requestAnimationFrame(() => { box.scrollTop = pv.probsTop; pv.probsTop = null; });
  }
  function probRow(p, i) {
    const a = pv.about, go = p.rel && a ? () => edShowFile(`${a.checkout}/${p.rel}`, p.line) : null;
    const where = (p.rel || (p.path || p.file || "").split("/").pop() || "") + (p.line ? `:${p.line}` : "");
    const open = pv.probsOpen.has(i), more = p.log && p.log.length > 1;
    const row = el("div", { class: `pv-pr ${p.level}${go ? " go" : ""}`, role: go ? "button" : null, tabindex: go ? "0" : null,
      title: go ? `Open ${p.rel}${p.line ? ` at line ${p.line}` : ""}` : p.path ? `${p.path}: not in this project` : null },
      el("span", { class: "ic", "aria-label": { error: "Error", warning: "Warning", box: "Bad box" }[p.level] }),
      el("span", { class: "msg", text: p.message }),
      where ? el("span", { class: "at", text: where }) : null,
      more ? el("button", { type: "button", class: "more", "aria-expanded": open ? "true" : "false",
        title: open ? "Hide log lines" : "Show log lines",
        onclick: (ev) => { ev.stopPropagation(); if (open) pv.probsOpen.delete(i); else pv.probsOpen.add(i); probsDraw(); } }, "▸") : null);
    if (go) {
      row.addEventListener("click", go);
      row.addEventListener("keydown", (ev) => { if (ev.target === row && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); go(); } });
    }
    return open ? [row, el("pre", { class: "pv-pr-log", text: p.log.join("\n") })] : [row];
  }

  // ---- a PDF, in pdf.js's viewer (the dashboard's copy, /_ag/lib/pdfjs): one viewer kept from run to run, each new
  // build opened where the user was; in the dashboard's colours; its own scripts not run; its sidebar closed on load.
  const viewer = (url) => `/_ag/lib/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}`;
  // `rel`: the PDF's path in the project -- shown first in this panel, it opens where it was left, if it was this PDF:
  // the viewer's own open parameters (#page=3&zoom=150,40,700), which it takes over its history of this very build.
  function pdf(box, url, rel) {
    const had = pv.pdf;
    if (had && had.frame.parentNode === box) { if (had.url !== url) pdfOpen(had, url); return; }
    const back = pv.back.pdf, at = back && back.rel === rel && typeof back.at === "string" ? `#${back.at}` : "";
    pv.back.pdf = null;
    const frame = el("iframe", { class: "pdf", title: "The preview", src: viewer(url) + at });
    const f = pv.pdf = { frame, url };
    frame.addEventListener("load", () => { pdfTheme(f); pdfHooks(f); });
    box.replaceChildren(frame);
  }
  const pdfApp = (f) => { try { return f && f.frame.contentWindow.PDFViewerApplication; } catch (e) { return null; } };
  async function pdfOpen(f, url) {
    f.url = url;
    const app = pdfApp(f);
    if (!app || !app.pdfViewer || !app.initialized) { f.frame.src = viewer(url); return; }
    const at = app.pdfViewer._location;
    if (at && at.pdfOpenParams) app.initialBookmark = at.pdfOpenParams.slice(1);
    try { f.frame.contentWindow.PDFViewerApplicationOptions.set("sidebarViewOnLoad", app.pdfSidebar ? app.pdfSidebar.visibleView : NO_SIDEBAR); }
    catch (e) { /* an older viewer */ }
    try { await app.open({ url }); } catch (e) { f.frame.src = viewer(url); }
  }
  function pdfTheme(f) {
    let doc;
    try { doc = f && f.frame.contentDocument && f.frame.contentDocument.documentElement; } catch (e) { return; }
    if (!doc) return;
    const cs = getComputedStyle(document.documentElement), v = (k) => cs.getPropertyValue(k).trim();
    const vars = { "--bg": "--page", "--bg-surface": "--page", "--bg-elevated": "--surface", "--text": "--ink",
      "--text-secondary": "--ink-2", "--text-faint": "--muted", "--accent": "--s1", "--bg-hover": "--wash", "--border-light": "--ring" };
    for (const [k, from] of Object.entries(vars)) if (v(from)) doc.style.setProperty(k, v(from));
    const mode = (ag.theme.current && ag.theme.current.mode) || "light";
    doc.setAttribute("data-docwriter-theme", mode);            // the viewer's stylesheet (DocWriter's build): its colours
    doc.style.colorScheme = mode;
  }
  ag.theme.on(() => { if (pv.pdf) pdfTheme(pv.pdf); });
  function pdfHooks(f) {
    let box = null;
    try { box = f.frame.contentDocument.getElementById("viewerContainer"); } catch (e) { /* not the viewer's page */ }
    if (!box || box.agSync) return;
    box.agSync = true;
    const app = pdfApp(f);                                                  // its place, kept as it moves (pv.back.pdf)
    if (app && app.initializedPromise) app.initializedPromise.then(() => app.eventBus.on("updateviewarea", (e) => {
      const at = e.location && e.location.pdfOpenParams, s = pv.run && pv.run.shows;
      if (at && s && s.rel && pv.pdf === f && box.clientHeight) pvKeep({ pdf: { rel: s.rel, at: at.replace(/^#/, "") } });
    }));
    box.addEventListener("dblclick", (ev) => fromPdf(f, ev));
    box.ownerDocument.addEventListener("keydown", (ev) => {                  // ⌘↵ in the viewer: Execute, as in the file
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && !ev.repeat) { ev.preventDefault(); edExecute(); }
    }, true);
  }
  document.addEventListener("webviewerloaded", (ev) => {      // the viewer, before it starts: no scripts of the PDF's
    const w = ev.detail && ev.detail.source;
    if (!pv.pdf || pv.pdf.frame.contentWindow !== w) return;
    try {
      w.PDFViewerApplicationOptions.set("disablePreferences", true);
      w.PDFViewerApplicationOptions.set("enableScripting", false);
      w.PDFViewerApplicationOptions.set("sidebarViewOnLoad", NO_SIDEBAR);
    } catch (e) { /* an older viewer */ }
  });

  // ---- SyncTeX: a double-click in the PDF opens its source at that line, in the LaTeX editor (edShowFile); `locate`
  // (the LaTeX editor's "→ PDF") shows a source's line in the PDF, marked a moment.
  async function sync(askFor) {
    const s = pv.run && pv.run.shows;
    if (!s || !s.rel) return null;
    let said;
    try {
      const got = await api("synctex", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(pv.path ? { path: pv.path } : {}), pdf: s.rel, ...askFor }) });
      if (got.ok) return got;
      const asks = /synctex/i.test((pv.about.preview && pv.about.preview.command) || "");
      said = { "no-synctex": asks ? "This PDF has no SyncTeX data yet because latexmk had nothing to rebuild. Change the source or delete the PDF, then run again."
          : "This PDF has no SyncTeX data. Add -synctex=1 to the preview's command (Edit), then run again.",
        "no-tool": "SyncTeX needs the synctex tool on the dashboard's machine.",
        "no-match": "SyncTeX found no match for that spot." }[got.reason] || `SyncTeX: ${got.reason}`;
    } catch (e) { said = e.message; }
    pv.err = said; draw();
    setTimeout(() => { if (pv.err === said) { pv.err = ""; draw(); } }, 6000);
    return null;
  }
  async function fromPdf(f, ev) {
    const app = pdfApp(f), at = ev.target && ev.target.closest && ev.target.closest(".page");
    if (!app || !at || !pv.run || !pv.about) return;
    const n = Number(at.dataset.pageNumber), view = app.pdfViewer.getPageView(n - 1);
    if (!view || !view.pdfPage) return;
    const r = view.div.getBoundingClientRect(), [px, py] = view.viewport.convertToPdfPoint(ev.clientX - r.left, ev.clientY - r.top);
    const page = view.pdfPage.view;
    const got = await sync({ page: n, x: px - page[0], y: page[3] - py });
    if (got) edShowFile(`${pv.about.checkout}/${got.file}`, got.line);
  }
  async function toPdf(file, line, column) {
    const s = pv.run && pv.run.shows;
    if (!s || s.kind !== "pdf" || !s.exists || !pv.pdf) {
      pv.err = "No PDF yet. Run the preview first."; draw();
      return;
    }
    if (pv.picked === "output") pick("result");
    const got = await sync({ mode: "forward", file, line, column });
    if (got) mark(pv.pdf, got);
  }
  function mark(f, got) {
    const app = pdfApp(f), view = app && app.pdfViewer.getPageView(got.page - 1);
    if (!view || !view.pdfPage) return;
    const page = view.pdfPage.view, h = got.h ?? got.x, v = got.v ?? got.y;
    const w = Math.max(got.w || 0, 24), tall = Math.max(got.height || 0, 9);
    const top = page[3] - v + tall;
    app.pdfViewer.scrollPageIntoView({ pageNumber: got.page, destArray: [null, { name: "XYZ" }, page[0] + Math.max(0, h - 36), Math.min(page[3], top + 48), null] });
    requestAnimationFrame(() => {
      const [x1, y1, x2, y2] = view.viewport.convertToViewportRectangle([page[0] + h, page[3] - v, page[0] + h + w, top]);
      const m = f.frame.contentDocument.createElement("div");
      Object.assign(m.style, { position: "absolute", left: `${Math.min(x1, x2) - 3}px`, top: `${Math.min(y1, y2) - 3}px`,
        width: `${Math.abs(x2 - x1) + 6}px`, height: `${Math.abs(y2 - y1) + 6}px`, background: "rgba(255, 190, 0, .38)",
        borderRadius: "3px", pointerEvents: "none", zIndex: "10", transition: "opacity .8s" });
      view.div.append(m);
      setTimeout(() => { m.style.opacity = "0"; }, 1800);
      setTimeout(() => m.remove(), 2800);
    });
  }

  return { run: runFor, locate, shown: () => { if (!pv.about) { pv.path = pvPath() || null; pv.file = ed.file; load(); } } };
}
