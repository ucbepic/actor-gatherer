// The Preview's panel (app.toml): a project's preview -- its state, its form, the question about an agent's command,
// and the result or the output of its latest run -- ported from the dashboard Editor's preview side. Everything goes
// through app_kit's SDK (/_ag/app.js): the backend's tools for what changes (set, run, stop), its own routes for what
// is read (about, files/, synctex), its messages for each run as it goes, and intents with the rest of the page:
// `run` (the Editor's Execute) and `locate` (its "-> PDF") come in; `open-file` (a place in the PDF's source) goes out.
(async () => {
  "use strict";
  const ag = await AgApp.connect();
  window.preview = ag;                                  // the browser tests drive it as the page would
  const OUT_MAX = 300000;                               // the most characters of a run's output kept here
  const ANSI = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
  const NO_SIDEBAR = 0;                                 // pdf.js's SidebarView.NONE
  const root = document.getElementById("pv");
  const dom = { head: root.querySelector(".pv-h"), cmd: root.querySelector(".pv-cmd"), card: root.querySelector(".pv-card"),
    result: root.querySelector(".pv-result"), output: root.querySelector(".pv-out"), busy: root.querySelector(".pv-busy") };
  const pv = { path: null, file: null, about: null, run: null, out: "", picked: null, form: null, err: "", busy: false,
    sig: "", card: "", held: null, peek: null, pdf: null, pinned: true, tick: null };

  // ---- helpers
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
    return n;
  }
  const spell = (s) => s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - (t || 0)); return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
  const clean = (t) => t.replace(ANSI, "").replace(/\r\n/g, "\n").split("\n")
    .map((l) => l.includes("\r") ? l.split("\r").filter(Boolean).pop() || "" : l).join("\n");
  const json = (r) => { const t = (r.content || []).map((c) => c.text || "").join(""); if (r.isError) throw new Error(t); return JSON.parse(t); };
  const call = async (tool, args) => json(await ag.tools.call(tool, args));
  async function api(path, init) {
    const r = await ag.api(path, init);
    const got = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(got.error || `${r.status}`);
    return got;
  }
  const path = () => pv.path || undefined;

  // ---- what it is, and its runs as they go
  async function load() {
    try {
      const a = await api(`about${pv.path ? `?path=${encodeURIComponent(pv.path)}` : ""}`);
      const moved = !pv.about || pv.about.checkout !== a.checkout;
      pv.about = a; pv.err = "";
      if (moved || !pv.run || (a.run && a.run.id !== pv.run.id)) {
        pv.run = a.run; pv.out = (a.dropped ? "…\n" : "") + (a.output || ""); pv.picked = null; pv.sig = ""; pv.held = null;
      }
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
      pv.run = r; draw();
    } else if (m.out) {
      const o = m.out;
      if (o.reset) pv.out = (o.dropped ? "…\n" : "") + o.text;
      else if (pv.run && o.id === pv.run.id) pv.out += o.text;
      else return;
      if (pv.out.length > OUT_MAX) pv.out = "…" + pv.out.slice(-OUT_MAX);
      out();
    } else if ("preview" in m) {
      if (pv.about) pv.about.preview = m.preview;
      draw();
    }
  });

  // ---- what the page asks: run it (the Editor's Execute), and show a source's place in the PDF
  ag.intents.on("run", async (d) => {
    if (d && d.path) { pv.path = d.path; pv.file = d.file || d.path; }
    await load();
    execute();
  });
  ag.intents.on("locate", async (d) => {
    if (!d || !d.path) return;
    if (!pv.about) await load();
    toPdf(d.path, Number(d.line) || 1, Number(d.column) || 0);
  });
  document.addEventListener("keydown", (ev) => {                        // ⌘↵ / Ctrl+Enter here: run it, as in the Editor
    if (ev.key !== "Enter" || !(ev.metaKey || ev.ctrlKey) || ev.shiftKey || ev.altKey) return;
    if (ev.target && ev.target.closest && ev.target.closest("input, textarea, select")) return;
    ev.preventDefault();
    if (!ev.repeat) execute();
  });
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
      stopped: ["", "Stopped"], "timed out": ["bad", "Stopped: it ran over 5 minutes"] })[r.state] || ["", r.state];
  }
  // What the body shows unless the user picks: the result once there is one (the one made before kept while the next
  // is made, "Building…" over it), the output when it failed or is all there is, a server's while it starts.
  function auto(r) {
    const s = (r && r.shows) || {};
    if (!r) return "result";
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
    const url = s.path && s.exists && a ? `/api/files/${a.token}/${s.rel.split("/").map(encodeURIComponent).join("/")}?${q}` : null;
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
  dom.output.addEventListener("scroll", () => { const o = dom.output; pv.pinned = o.scrollTop + o.clientHeight >= o.scrollHeight - 8; });

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
    const tab = card ? null : pv.picked || auto(r);
    const hasResult = r && r.shows && (r.shows.url || r.shows.path);
    const url = shown(r);
    root.classList.toggle("hov", tab === "result");
    const building = tab === "result" && !!(r && r.shows && r.shows.path) && (r.state === "running" || pv.busy);
    dom.busy.hidden = !building;
    if (building) busyText();
    const btn = (text, title, onclick, attrs = {}) => el("button", { type: "button", title, onclick, ...attrs }, text);
    dom.head.replaceChildren(...[
      el("span", { class: "t", text: "Preview" }),
      el("span", { class: "nm", title: a ? (a.git ? `The git project ${a.key}, its worktrees too` : `The folder ${a.key} (not in a git project)`) : null, text: a ? a.name : "" }),
      card === "" || pv.busy ? stat : null,
      tab && hasResult ? el("span", { class: "pv-tabs", role: "group", "aria-label": "Show" },
        ...[["result", "Result"], ["output", "Output"]].map(([k, t]) => btn(t, k === "result" ? "What it makes" : "What it printed",
          () => { pv.picked = k; draw(); }, { class: tab === k ? "on" : null, "aria-pressed": tab === k ? "true" : "false" }))) : null,
      live ? btn("Stop", r.server ? "Stop its server" : "Stop its run", stopIt)
        : p && !p.needs_ok && !pv.form ? btn(r ? "Re-run" : "Run", `Run it again: ${p.command || "(nothing to run)"}`, () => runIt(), { disabled: pv.busy }) : null,
      p && !pv.form ? btn("Edit", "Change the command, or what it shows", edit) : null,
    ].filter(Boolean));
    dom.cmd.hidden = !p || !!pv.form;
    if (p && !pv.form) dom.cmd.replaceChildren(...[
      el("code", { title: `In ${a.checkout}: ${p.command || "nothing to run"}${p.show ? `, showing ${p.show}` : ""}` },
        p.command ? `$ ${p.command}` : "(nothing to run)", p.show ? el("span", { class: "to", text: `  →  ${p.show}` }) : null),
      url && tab === "result" ? el("a", { class: "pv-open", href: url, target: "_blank", rel: "noopener", title: "Open it in a tab of its own" }, "↗") : null,
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
          ? el("div", { class: "note", text: "Not run yet: Run (or Execute in the Editor) runs it, here." }) : card === "loading" ? el("div", { class: "note", text: "Loading…" }) : null].filter(Boolean));
      }
    }
    dom.result.classList.toggle("off", tab !== "result");       // laid out still: a PDF's viewer keeps its place
    dom.output.hidden = tab !== "output";
    if (tab === "result") result(url);
    if (tab === "output") out();
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
      field("Command", "command", "python3 {file}", "Run through your shell in the project's checkout. Empty: nothing runs, what it shows is shown as it is."),
      field("Show", "show", "out.png · {stem}.pdf · http://localhost:5173", "A file in the project it makes, or the URL of a server it starts (kept running until Stop). Empty: what it prints."),
      el("div", { class: "note" }, el("code", { text: "{file}" }), " ", el("code", { text: "{stem}" }), " ", el("code", { text: "{name}" }), " ",
        el("code", { text: "{dir}" }), " stand for the file run from the Editor: its path in the project, without its extension, its name, and its folder."),
      el("div", { class: "row" },
        el("button", { type: "button", class: "primary", onclick: () => save(true) }, "Save and run"),
        el("button", { type: "button", onclick: () => save(false) }, "Save"),
        el("button", { type: "button", onclick: () => { pv.form = null; pv.err = ""; pv.card = ""; draw(); } }, "Cancel")),
      el("div", { class: "note" }, "Agents can set it too: you are asked before an agent's command first runs."));
    setTimeout(() => { const i = node.querySelector("input"); if (i && pv.form && pv.form.node === node) i.focus(); }, 0);
    return node;
  }
  function ask() {
    const a = pv.about, p = a.preview;
    return el("div", { class: "pv-ask" },
      el("div", { class: "head", text: `An agent (${p.set_by.slice(0, 8)}) set this project's preview, ${ago(p.set_at)}:` }),
      el("pre", { text: `$ ${p.command}` }),
      el("div", { class: "note", text: `Shows: ${p.show || "what it prints"}. It runs in ${a.checkout} as you, outside the agent's own permissions, so it waits for you to let it.` }),
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
      el("code", { text: s.rel }), r.state === "running" ? " shows here once the run ends." : " is not there: the command did not make it."));
    if (s.url && r.state !== "ready") return box.replaceChildren(el("div", { class: "pv-note", text: `Waiting for ${s.url} to answer…` }));
    if (s.kind === "image" || s.kind === "svg") return box.replaceChildren(el("div", { class: "img" }, el("img", { src: url, alt: s.rel || "", draggable: "false" })));
    if (s.kind === "pdf") return pdf(box, url);
    if (s.kind === "url") return box.replaceChildren(el("iframe", { src: url, title: "The preview", class: "url" }));
    if (s.kind === "html") return box.replaceChildren(el("iframe", { src: url, title: "The preview", sandbox: "allow-scripts allow-forms allow-modals allow-popups" }));
    box.replaceChildren(el("div", { class: "pv-note", text: "Loading…" }));
    fetch(url, { cache: "no-store" }).then((x) => x.ok ? x.text() : Promise.reject(new Error(`${x.status}`))).then((text) => {
      if (pv.sig !== sig) return;
      if (s.kind === "markdown" && window.marked && window.DOMPurify) {
        const md = el("div", { class: "md" });
        md.innerHTML = DOMPurify.sanitize(marked.parse(text));
        box.replaceChildren(md);
      } else box.replaceChildren(el("pre", { text }));
    }).catch((e) => { if (pv.sig === sig) box.replaceChildren(el("div", { class: "pv-note", text: `It could not be read: ${e.message}` })); });
  }
  function out() {
    if (pv.outQueued) return;
    pv.outQueued = true;
    requestAnimationFrame(() => {
      pv.outQueued = false;
      const o = dom.output, r = pv.run, text = clean(pv.out);
      o.textContent = text || (r && r.state === "running" ? "" : r && r.command ? "(It printed nothing.)" : "(Nothing ran.)");
      if (pv.pinned) o.scrollTop = o.scrollHeight;
    });
  }

  // ---- a PDF, in pdf.js's viewer (the dashboard's copy, /_ag/lib/pdfjs): one viewer kept from run to run, each new
  // build opened where the user was; in the dashboard's colours; its own scripts not run; its sidebar closed on load.
  const viewer = (url) => `/_ag/lib/pdfjs/web/viewer.html?file=${encodeURIComponent(url)}`;
  function pdf(box, url) {
    const had = pv.pdf;
    if (had && had.frame.parentNode === box) { if (had.url !== url) pdfOpen(had, url); return; }
    const frame = el("iframe", { class: "pdf", title: "The preview", src: viewer(url) });
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
    box.addEventListener("dblclick", (ev) => fromPdf(f, ev));
    box.ownerDocument.addEventListener("keydown", (ev) => {                  // ⌘↵ in the viewer: run it
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && !ev.repeat) { ev.preventDefault(); execute(); }
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

  // ---- SyncTeX: a double-click in the PDF opens its source at that line (the page's Editor, by `open-file`); `locate`
  // (the Editor's "→ PDF") shows a source's line in the PDF, marked a moment.
  async function sync(askFor) {
    const s = pv.run && pv.run.shows;
    if (!s || !s.rel) return null;
    let said;
    try {
      const got = await api("synctex", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(pv.path ? { path: pv.path } : {}), pdf: s.rel, ...askFor }) });
      if (got.ok) return got;
      const asks = /synctex/i.test((pv.about.preview && pv.about.preview.command) || "");
      said = { "no-synctex": asks ? "This PDF has no SyncTeX yet: its build did not write it (latexmk saw nothing to rebuild). Change the source, or delete the PDF, and run it again."
          : "This PDF has no SyncTeX: add -synctex=1 to the preview's command (Edit), and run it again.",
        "no-tool": "SyncTeX needs TeX's synctex tool where the dashboard runs.",
        "no-match": "SyncTeX has no match for that place." }[got.reason] || `SyncTeX: ${got.reason}`;
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
    if (got) ag.intents.open("open-file", { path: `${pv.about.checkout}/${got.file}`, line: got.line }).catch((e) => { pv.err = e.message; draw(); });
  }
  async function toPdf(file, line, column) {
    const s = pv.run && pv.run.shows;
    if (!s || s.kind !== "pdf" || !s.exists || !pv.pdf) {
      pv.err = "No PDF is shown yet: run the preview first."; draw();
      return;
    }
    if (pv.picked === "output") { pv.picked = "result"; draw(); }
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

  await load();
  document.body.dataset.ready = "1";
})();
