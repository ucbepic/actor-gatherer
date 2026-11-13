// ------------------------------------------------------------------ the Files view
// A turn's files instead of its conversation: each file the agent read, searched or changed in it, the
// lines it saw at their numbers and its changes in place among them (files.py); the commands that were
// not just reading a file listed under them. One turn at a time: the latest, followed, unless one is picked.
const FILE_KINDS = { read: ["read", "var(--s1)"], hit: ["search hit", "var(--s4)"], edit: ["edited", "var(--s2)"],
  write: ["written", "var(--s3)"], delete: ["deleted", "var(--critical)"] };
// Each kind of file by a mark, in its colour, the same wherever a file shows -- in the tree, its legend, the folded bar,
// a call of the file, a command's files: a book read, a glass searched, a pencil edited, a page with a plus written
// whole, a bin deleted; and what git changed as a command ran, a branch.
const MARKS = {
  read: "M8 4.25C6.6 3.2 4.6 2.9 2 3.1v9.2c2.6-.2 4.6.1 6 1.15 1.4-1.05 3.4-1.35 6-1.15V3.1c-2.6-.2-4.6.1-6 1.15zM8 4.25v9.2",
  hit: "M6.75 2.5a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 0 0 0-8.5zM9.9 9.9l3.6 3.6",
  edit: "M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8",
  write: "M4.25 1.75h5l3 3v9a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5zM9 1.75v3.25h3.25M8 7.25v4.5M5.75 9.5h4.5",
  delete: "M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.65 9.1a.75.75 0 0 0 .75.65h4.7a.75.75 0 0 0 .75-.65l.65-9.1M6.75 6.75v4.5M9.25 6.75v4.5",
  git: "M5 5v6M11 7c0 2.6-6 1.4-6 4M5 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM5 11a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM11 3.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z",
};
// a kind of file's mark, `title` said on hover (its name unless given)
function kindMark(kind, size = 12, title) {
  const [name, color] = FILE_KINDS[kind] || [kind, "var(--muted)"];
  const svg = MARKS[kind] ? strokeIcon(MARKS[kind], size) : el("i", { class: "fb", style: `background: ${color}` });
  svg.style.color = color;
  return el("span", { class: "km", title: title === undefined ? name : title }, svg);
}
// what git changed of a file (files.py's `git`: its kinds) by git's mark
const gitMark = (kinds, size = 12) => kindMark("git", size, "by git: " + kinds.map((k) => (FILE_KINDS[k] || [k])[0]).join(", "));
// the lines a change added and removed, as a diff's +N −M (files.py's `changed`); none for none
const changedCount = (ch) => !ch || !(ch[0] || ch[1]) ? null
  : el("span", { class: "chg", title: `${plural(ch[0], "line")} added, ${plural(ch[1], "line")} removed` },
    ch[0] ? el("span", { class: "a", text: `+${full(ch[0])}` }) : null, ch[1] ? el("span", { class: "r", text: `−${full(ch[1])}` }) : null);
const addChanged = (all) => all.reduce((a, x) => !x ? a : !a ? [...x] : [a[0] + x[0], a[1] + x[1]], null);
// What the disk said of a call, where ag's hook server checked it as it ran (files.py's `checked`)
const CHECKED = { true: ["checked", "What the call showed of this file matched the file on disk right after it ran"],
  false: ["not as on disk", "What the call showed of this file did not match the file on disk right after it ran"] };
// One load at a time, and at most one more after it, for all that asked while it ran -- not one each: a stream
// message asks with every change, and while a load is held up (the browser's connections all taken by streams:
// 03-settings.js's loadedSoon) they would pile up, each to be fetched in turn once it goes through.
let filesLoading = null, filesAgain = null;
function loadFiles() {
  if (!filesLoading) {
    const now = loadFilesNow();
    filesLoading = now.then(() => {}, () => {}).then(() => { filesLoading = null; });   // its caller has its failure
    return now;
  }
  if (!filesAgain) filesAgain = filesLoading.then(() => { filesAgain = null; return loadFiles(); });
  return filesAgain;
}
async function loadFilesNow() {
  if (!state.selected || SNAPSHOT) return;
  const [g, c] = state.selected, k = key(g, c);
  if (!state.files || state.files.key !== k) state.files = { key: k, turn: null, sel: null, data: null };
  const f = state.files, info = selectedInfo();
  const cwd = (info && (info.cwd || (info.session && info.session.cwd))) || "";
  const turn = f.turn;
  const got = await get(`/api/files?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}`
    + `${turn === null ? "" : `&turn=${turn}`}&cwd=${encodeURIComponent(cwd)}`);
  if (state.files !== f) return;
  if (!got.error) f.data = got;                      // no database yet (none before the gatherer's first call): no turns
  else if (got.error.startsWith("no database")) f.data = { turns: [], turn: null, files: [], commands: [], home: "" };
  if (turn === null && f.data) keep(k, "data", f.data);   // the latest turn's: what the actor opens on, kept for next time
}
// The Chat of the actors shown lately, as last loaded -- its files feed's data (at the latest turn) and the server's view --
// drawn at once when one is picked again (`showKept`), then each brought up to date as it comes. Together, as one moment's:
// the turns are not drawn before the view of what they are at (Chat waits for both, `filesRender`).
const KEPT_ACTORS = 12;
const chatKept = new Map();                           // key -> {data, view}, the latest shown last
function keep(k, what, value) {
  const got = chatKept.get(k) || {};
  chatKept.delete(k);
  chatKept.set(k, { ...got, [what]: value });
  while (chatKept.size > KEPT_ACTORS) chatKept.delete(chatKept.keys().next().value);
}
// The actor's Chat as last loaded, made the one shown: true if both its parts were kept, false (nothing changed) if not.
function showKept(g, c) {
  const k = key(g, c), got = chatKept.get(k);
  if (!got || !got.data || !got.view) return false;
  state.files = { key: k, turn: null, sel: null, data: got.data };
  state.chatView = { key: k, view: got.view };
  return true;
}
CHAT_FEEDS.files = {
  load: loadFiles,
  data: () => state.files && state.selected && state.files.key === key(...state.selected) && state.files.data
    ? { items: state.files.data.turns, pending: [], earlier: false } : null,
  signature: () => state.files ? [state.files.key, state.files.turn, state.files.sel, signature(state.files.data),
    signature(state.chatView), chatSends.length] : null,
};
async function setFilesTurn(n) {
  if (!state.files || !state.files.data) return;
  const last = state.files.data.turns.length - 1;
  state.files.turn = n === null || n >= last ? null : Math.max(0, n);
  state.files.sel = null;
  await loadFiles();
  keepingPlace(renderMain);
}
// The kinds of file in the tree, switched in its legend: a file shows while any of its kinds is on. Search
// hits are off until switched on (a file only matched by a search is left out); the choice kept in this browser.
const KINDS_KEY = "ag-dashboard-files-hidden-kinds";
let hiddenKinds = (() => {
  try { const v = JSON.parse(localStorage.getItem(KINDS_KEY)); return new Set(Array.isArray(v) ? v : ["hit"]); }
  catch (e) { return new Set(["hit"]); }
})();
function kindSwitches(gitFiles) {
  return el("div", { class: "fl-legend fl-kinds" }, ...Object.entries(FILE_KINDS).map(([k, [name, color]]) => {
    const on = !hiddenKinds.has(k);
    return el("button", { type: "button", class: "kind" + (on ? "" : " off"), "aria-pressed": on ? "true" : "false",
      title: on ? `Leave out the files only ${name}` : `Show the files ${name}`,
      onclick: () => {
        on ? hiddenKinds.add(k) : hiddenKinds.delete(k);
        try { localStorage.setItem(KINDS_KEY, JSON.stringify([...hiddenKinds])); } catch (e) { /* this page only */ }
        keepingPlace(renderMain);
      } }, kindMark(k, 12, ""), name);
  }), gitFiles ? gitSwitch(gitFiles) : null);
}
// The files in temporary folders (/tmp, $TMPDIR: scratchpads, tests' folders): hidden until asked for, the choice
// kept in this browser. The commands are all listed, whatever folders they touched.
const TMP_KEY = "ag-dashboard-files-tmp";
let showTmp = (() => { try { return localStorage.getItem(TMP_KEY) === "1"; } catch (e) { return false; } })();
function tmpSwitch(n) {
  const box = el("input", { type: "checkbox" });
  box.checked = showTmp;
  box.addEventListener("change", () => {
    showTmp = box.checked;
    try { localStorage.setItem(TMP_KEY, showTmp ? "1" : "0"); } catch (e) { /* this page only */ }
    keepingPlace(renderMain);
  });
  return el("label", { class: "tmp", title: "Files in temporary folders (/tmp, $TMPDIR: scratchpads, tests' folders)" },
    box, `tmp (${n})`);
}
// What git changed as the commands ran -- a pull, a merge, a checkout, a new work tree; in this session's commands or
// another's running then (files.py's `git`): left out until switched on in the files' legend, of the files, a file's
// calls and a command's files; the choice kept in this browser.
const GIT_KEY = "ag-dashboard-files-git";
let showGit = (() => { try { return localStorage.getItem(GIT_KEY) === "1"; } catch (e) { return false; } })();
const gitOnly = (f) => !f.kinds.length && !!(f.git || []).length;   // a file only git changed
function gitSwitch(n) {
  return el("button", { type: "button", class: "kind" + (showGit ? "" : " off"), "aria-pressed": showGit ? "true" : "false",
    title: `${showGit ? "Leave out" : "Show"} what git changed as the commands ran (a pull, a merge, a checkout, a new work tree): `
      + plural(n, "file"),
    onclick: () => {
      showGit = !showGit;
      try { localStorage.setItem(GIT_KEY, showGit ? "1" : "0"); } catch (e) { /* this page only */ }
      keepingPlace(renderMain);
    } }, kindMark("git", 12, ""), `by git (${full(n)})`);
}
// The files and commands at the left, folded to a thin bar of what they hold until opened: by a click on the
// bar or on a message's button for them (or ⌘+click on it), and folded again by the button in their heading or that button
// of the turn they show. The choice kept in this browser.
const SIDE_KEY = "ag-dashboard-files-side-folded-2";   // -2: folded by default
let sideFolded = (() => { try { return localStorage.getItem(SIDE_KEY) !== "0"; } catch (e) { return true; } })();
function foldSide(fold, draw = true) {
  sideFolded = fold;
  try { localStorage.setItem(SIDE_KEY, fold ? "1" : "0"); } catch (e) { /* this page only */ }
  if (fold && state.files && state.files.turn !== null) return setFilesTurn(null);   // folded: the latest turn, which its bar counts
  if (draw) keepingPlace(renderMain);
}
// The background's section under the commands: folded to its heading until opened, the choice kept in this browser.
const BG_KEY = "ag-dashboard-files-bg-open";
let bgOpen = (() => { try { return localStorage.getItem(BG_KEY) === "1"; } catch (e) { return false; } })();
function openBackground(open, draw = true) {
  bgOpen = open;
  try { localStorage.setItem(BG_KEY, open ? "1" : "0"); } catch (e) { /* this page only */ }
  if (draw) keepingPlace(renderMain);
}
// The bar: the files, by kind, in the colours of the tree's (a file of two kinds counted in both; the kinds switched
// off left out); the commands, by how they went, in the colours of the commands' dots; the tasks in the background.
// A click on the background's opens their section too.
function sideBar(files, cmds, info) {
  const bg = (info.background || []).length, n = cmds.ok + cmds.err + cmds.run;
  const kinds = Object.entries(FILE_KINDS).filter(([k]) => !hiddenKinds.has(k))
    .map(([k, [name]]) => [files.filter((f) => f.kinds.includes(k)).length, k, name]).filter(([c]) => c);
  const changed = addChanged(files.map((f) => f.changed));
  const how = [[cmds.ok, "ok", "passed"], [cmds.err, "err", "failed"], [cmds.run, "run", "running"]].filter(([k]) => k);
  const said = [plural(files.length, "file") + (kinds.length ? ": " + kinds.map(([c, , w]) => `${full(c)} ${w}`).join(", ") : "")
    + (changed ? `; ${plural(changed[0], "line")} added, ${full(changed[1])} removed` : ""),
    plural(n, "command") + (how.length ? ": " + how.map(([k, , w]) => `${full(k)} ${w}`).join(", ") : ""),
    bg ? plural(bg, "background task") : null].filter(Boolean).join(" · ");
  const dot = (cls, color) => el("i", { class: "g " + cls, "aria-hidden": "true", style: color ? `background: ${color}` : null });
  const bar = el("button", { type: "button", class: "fl-bar", title: `${said}. Show the files and commands`,
    "aria-label": `Show the files and commands: ${said}`,
    onclick: (ev) => { if (ev.target.closest(".it.bg")) openBackground(true, false); foldSide(false); } },
    strokeIcon(ICONS.sidebar, 15),
    el("span", { class: "stats" },
      el("span", { class: "it" }, strokeIcon(ICONS.page, 13),
        ...(kinds.length ? kinds.map(([c, k]) => el("span", { class: "sub kd" }, kindMark(k, 10, ""), full(c)))
          : [el("span", { text: full(files.length) })]),
        changed && changed[0] ? el("span", { class: "sub chg-a", text: `+${full(changed[0])}` }) : null,
        changed && changed[1] ? el("span", { class: "sub chg-r", text: `−${full(changed[1])}` }) : null),
      el("span", { class: "it" }, strokeIcon(ICONS.terminal, 13),
        ...(how.length ? how.map(([k, cls]) => el("span", { class: "sub " + cls }, dot(cls), full(k))) : [el("span", { text: "0" })])),
      bg ? el("span", { class: "it bg", title: `${plural(bg, "background task")}: show them` }, strokeIcon(ICONS.pulse, 13),
        el("span", { class: "sub bg" }, dot("bg"), full(bg))) : null));
  const acts = barActs();
  return acts ? el("div", { class: "fl-barbox" }, acts, bar) : bar;
}
// With a panel open above the panes (the top row), a pane's head is put in its Chat view's folded bar, at the other end
// from the numbers, as small icons -- a grip to move the pane by (dragged, or right-clicked: 07-panes.js's MOVE_FROM),
// which view, Details, and (panes side by side) the pane's close -- and the head itself hidden (.pane:has(.fl-acts)), its
// room the chat's.
function barActs() {
  if (SNAPSHOT || !topShown()) return null;
  const now = chatView().id;
  const act = (label, title, icon, onclick, pressed = null, cls = "") => el("button", { type: "button", class: `fl-act ${cls}`.trim(),
    title, "aria-label": label, "aria-pressed": pressed === null ? null : pressed ? "true" : "false", onclick }, icon);
  return el("div", { class: "fl-acts", role: "group", "aria-label": "This pane" },
    el("span", { class: "fl-act fl-grip", draggable: "true", title: "Drag to move this pane beside another of its task · right-click: move it",
      "aria-label": "Move this pane" }, strokeIcon(ICONS.move, 14)),
    ...offeredViews().filter((v) => !v.more || v.id === now).map((v) =>
      act(v.name, v.description || v.name, v.icon ? strokeIcon(v.icon, 14) : v.name.slice(0, 1), () => setChatView(v.id), v.id === now)),
    act("Details", "Details: what ag saw and did for this actor, and the history's other views", strokeIcon(ICONS.panel, 14),
      () => setDetails(!state.details), !!state.details),
    act("Minimize the chat", MIN_TIP, strokeIcon(ICONS.minimize, 14), () => setChatMin(true)),
    act("Close this pane", "Close this pane", "×", () => $("pane-close").click(), null, "close"));
}
// Turns are picked in the conversation at the right; the header only offers going back to the latest.
function filesTools() {
  const d = state.files && state.files.data;
  if (!d || !d.turns.length || state.files.turn === null) return [];
  return [el("button", { type: "button", title: "Show the latest turn, and follow it", onclick: () => setFilesTurn(null) }, "Latest")];
}
// A shell call's command, as its harness's rules read it (its view's); null for any other call.
const shellCommand = (call) => call && call.view && call.view.shape === "shell" ? str(call.view.command) : null;
const homeDir = () => (state.files && state.files.data && state.files.data.home) || "";
// A call's line (files.py's `_label`) as the commands list and the turn's latest call show it: a shell command it
// is (no description given: codex's) in the terminal's type, coloured
function callLabel(c, n) {
  const text = firstLine(c.text, n);
  return shellCommand(c.call) !== null && !c.call.view.description ? el("span", { class: "cmdline" }, shellSpan(text)) : text;
}
// A call opened: its command as a terminal would show it (shellHtml); a script, or a file's new text, coloured in its
// language; a change as its lines out and in; any other call its inputs one by one, each whole. Under it what it
// printed (ansiHtml), its exit code and run time beside. Copy takes the call as written.
function callView(call, ran = {}) {
  const box = el("div", { class: "cv" + (ran.error ? " err" : "") });
  if (!call) return box;
  const input = call.input && typeof call.input === "object" ? call.input : {}, v = call.view || {};
  const code = (cls, html, copy) => {
    const src = el("div", { class: "cv-src" });
    src.innerHTML = html;
    return el("div", { class: "cv-in " + cls }, src,
      copy === undefined ? null : el("button", { type: "button", class: "code-copy", title: "Copy it as written", "data-copy": copy }, "Copy"));
  };
  const lined = (hs, cls, mark) => hs.map((h) => `<div class="cl ${cls}"><span class="mk">${mark}</span><span class="tx">${h || "&#8203;"}</span></div>`).join("");
  const cwd = ((selectedInfo() || {}).cwd || "").replace(/\/$/, "");   // a path from the session's directory, else from ~
  const path = (p) => el("div", { class: "cv-path", title: str(p), text: cwd && str(p).startsWith(cwd + "/") ? str(p).slice(cwd.length + 1) : tildePath(str(p), homeDir()) });
  const cmd = shellCommand(call);
  if (cmd !== null) {
    box.append(code("sh", shellHtml(cmd, homeDir()), cmd));
    const tags = [v.cwd ? `in ${tildePath(str(v.cwd), homeDir())}` : null, v.background ? "in the background" : null].filter(Boolean);
    if (tags.length) box.append(el("div", { class: "cv-tags" }, ...tags.map((t) => el("span", { text: t }))));
  } else if (v.shape === "script") {                  // a script (codex's code mode), in its language
    box.append(code("src", hlLines(str(v.code), v.lang || "js").join("\n"), str(v.code)));
  } else if (v.shape === "patch") {
    const p = str(v.patch);
    box.append(code("src", hlLines(p, "diff").join("\n"), p));
  } else if (v.shape === "edit" || v.shape === "write") {
    const p = v.path, lang = v.lang || langOfPath(p);
    const edits = v.shape === "edit" ? v.edits || [] : [];
    // a change's two sides read from inside a comment or a string they begin in; a whole file from its top
    const whole = str(v.content), pair = (e) => hlPart(lang, str(e.old), str(e.new));
    const html = edits.length ? edits.map((e) => { const [was, now] = pair(e); return lined(was, "del", "−") + lined(now, "add", "+"); })
      .join('<div class="cv-sep"></div>') : lined(hlLines(whole, lang === "html" ? guessWeb(whole) : lang), "", "");
    box.append(path(p), code("diff", html));
  } else {
    const args = typeof call.input === "string" || !call.input ? [["", str(call.input)]] : Object.entries(input);
    box.append(el("div", { class: "cv-args" }, ...args.flatMap(([k, v]) => {
      const val = el("span", { class: "v" + (typeof v === "string" ? "" : " json") });
      if (typeof v === "string") val.textContent = v; else val.innerHTML = hlLines(JSON.stringify(v, null, 1), "json").join("\n");
      return [el("span", { class: "k", text: k }), val];
    })));
  }
  // what it printed, its harness's lines about the run taken off (files.py's `output`), and what they said: its exit
  // code, how long it ran
  if (ran.output !== undefined && ran.output !== null && (ran.output !== "" || ran.exit != null)) {
    const text = str(ran.output).replace(/\n+$/, ""), out = el("pre", { class: "out" });
    out.innerHTML = text ? outputHtml(text, cmd) : '<span class="a-dim">no output</span>';
    if (ran.exit != null || ran.took) box.append(el("div", { class: "cv-tags" },
      ran.exit != null ? el("span", { class: String(ran.exit) === "0" ? "ok" : "bad", text: `exit ${ran.exit}` }) : null, ran.took ? el("span", { text: ran.took }) : null));
    box.append(out);
  }
  return box;
}
// A file, call by call: each call that touched it in the turn, in order, with what it did to the file --
// the lines it read or found, or its change, at their line numbers.
function fileView(f, rel, id) {
  const box = el("div", { class: "fv" }, el("div", { class: "fv-h" }, el("div", { class: "fv-path", text: rel(f.path) }),
    el("button", { type: "button", class: "fv-close", title: "Close the file", "aria-label": "Close the file",
      onclick: () => { state.files.sel = null; keepingPlace(renderMain); } }, "×")));
  // the last call opened when it first shows -- the file opened, or a call new to it -- and left as the reader leaves it;
  // what git changed left out unless shown (gitSwitch)
  const shown = f.sources.map((s, i) => [s, i]).filter(([s]) => showGit || !s.git);
  const last = `${id}-s${shown.length ? shown[shown.length - 1][1] : -1}`, fresh = !document.getElementById(last);
  shown.forEach(([s, i], n) => {
    const kinds = s.kinds.map((k) => k === "write" ? (s.blocks.some((b) => b.created) ? "created" : "written") : (FILE_KINDS[k] || [k])[0]);
    // folded to its header until clicked; opened, what it did to the file, and its exact call behind "command"
    const code = el("div", { class: "code" });
    for (const b of s.blocks) code.append(...fileBlock(b, langOfPath(f.path)));
    if (s.error && !s.blocks.length) code.append(el("div", { class: "fv-note", text: "The call failed." }));
    box.append(el("details", { class: "fv-call" + (s.error ? " err" : ""), id: `${id}-s${i}`, open: fresh && `${id}-s${i}` === last ? "" : null },
      el("summary", {}, el("span", { class: "tw", text: "▸" }), el("span", { class: "k", text: `${n + 1}` }),
        el("span", { class: "kinds" }, s.git ? gitMark(s.kinds) : null, ...s.kinds.map((k) => kindMark(k, 12))),
        el("span", { class: "via", text: firstLine(s.via, 160) }), changedCount(s.changed),
        el("span", { class: "what", text: (s.git ? "by git: " : "") + kinds.join(", ") + (s.error ? " · failed" : "") },
          CHECKED[s.checked] ? el("span", { class: "chk" + (s.checked ? "" : " off"), title: CHECKED[s.checked][1],
            text: " · " + CHECKED[s.checked][0] }) : null)),
      s.call ? el("details", { class: "fv-cmd", id: `${id}-s${i}-c` }, el("summary", { text: "command" }), callView(s.call)) : null,
      code));
  });
  return box;
}
// One line of a file as a call saw it: its number (null: not known), a mark (+ − ›), its text -- `html`, coloured, if given.
const fileLine = (n, cls, mark, text, html) => {
  const tx = el("span", { class: "tx" });
  if (html === undefined) tx.textContent = text; else tx.innerHTML = html || "&#8203;";
  return el("div", { class: "ln " + cls }, el("span", { class: "no", text: n === null || n === undefined ? "" : String(n) }), el("span", { class: "mk", text: mark }), tx);
};
const fileGap = (text) => el("div", { class: "gap", text });
// a block of the file's lines (`lang` the file's language, langOfPath), each run of them coloured together -- from
// inside a comment or a string it begins in, unless it starts at the file's top (hlPart); what a command printed (an
// "output" block) as it printed it
function fileBlock(b, lang) {
  const out = [];
  const hl = (ls, top) => { const t = ls.join("\n"); return top ? hlLines(t, lang === "html" ? guessWeb(t) : lang) : hlPart(lang, t)[0]; };
  const cut = () => { if (b.cut) out.push(fileGap(`+${plural(b.cut, "more line")} not shown`)); };
  if (b.t === "lines") {
    if (b.start === null) out.push(fileGap("where in the file is not known"));
    const h = hl(b.lines, b.start === 1);
    b.lines.forEach((t, i) => out.push(fileLine(b.start === null ? null : b.start + i, "read", "", t, h[i])));
    cut();
  } else if (b.t === "output") {                 // the file's lines are somewhere in it: which, not known
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
    if (b.at === null) out.push(fileGap("where in the file is not known: its lines were not seen"));
    const above = b.above || [], below = b.below || [], ctx = (rows) => rows.map((r) => r[1]);
    // the lines before and after, coloured once with the old lines between them and once with the new, both from
    // inside what the lines above begin in
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
    const [g] = state.selected || [];
    out.push(el("a", { class: "fv-img", target: "_blank", rel: "noopener",
      href: `/api/image?gatherer=${encodeURIComponent(g)}&row_id=${b.row_id}&id=${encodeURIComponent(b.id)}` },
      el("img", { alt: "the image the agent viewed", loading: "lazy",
        src: `/api/image?gatherer=${encodeURIComponent(g)}&row_id=${b.row_id}&id=${encodeURIComponent(b.id)}` })));
  } else if (b.t === "note") {
    out.push(el("div", { class: "fv-note", text: b.text }));
  }
  return out;
}
function filesRender({ info, session, running, writable, held }) {
  const d = state.files && state.files.data;
  const asking = errorNote(info) || askingNote(info) || answeredNote(info);
  // the files feed, and -- the page's stream live -- the server's view of the conversation (its `chat`): drawn once both
  // have come, not the turns first and what they are at a moment later (the actor done under the latest popping in, and
  // the conversation moved under the reader)
  const waits = !d || (!chatViewOf(info) && !!state.stream && !state.paused && !SNAPSHOT);
  if (waits) return [el("div", { class: "desc", style: "padding: 10px 16px", text: SNAPSHOT ? "A snapshot has no files: run `ag dashboard` live to see them." : "Loading…" }), asking].filter(Boolean);
  // the view opened afresh (from another view, or the page's first draw): the conversation and the
  // commands start where they would for a new turn -- the commands at their end, the conversation at its end or at the turn picked
  const afresh = !document.querySelector("#main .files .fl-grid");
  // the conversation, at the right: drawn by the new code (src/features/chat/) into a node of the actor's own, the same
  // from draw to draw (agNext.chat.draw) -- before its first turn, all there is (the actor waving hello). From its first
  // message on -- the moment it is sent, its turn opening before any is stored -- beside its files and commands, so the
  // message does not move as its turn is stored.
  const talk = window.agNext.chat.draw(talkFeed(info, session, writable, held, afresh), CHAT_HOST);
  const view = chatViewOf(info), opening = !d.turns.length;
  if (opening && !(view && (view.turns.length || view.opening)) && !mySends().length) return [talk, asking].filter(Boolean);
  // its node, drawn before its first turn was stored at the frame's top, goes into the grid now: taken out first, so
  // patch() does not look for it at the top once the grid has taken it in (fill)
  if (talk.parentElement && !talk.parentElement.classList.contains("fl-right")) talk.remove();
  if (afresh) cmdsShown = null;
  const t = d.turns[d.turn];
  const cwd = (info.cwd || "").replace(/\/$/, "");
  const home = (d.home || "").replace(/\/$/, "");
  const under = (p, dir) => !!dir && p !== null && (p === dir || p.startsWith(dir + "/"));
  const rel = (p) => cwd && p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : under(p, home) ? "~" + p.slice(home.length) : p;
  const sel = d.files.find((f) => f.path === state.files.sel && (showGit || !gitOnly(f))) || null;   // none until one is clicked
  const list = el("div", { class: "fl-scroll", "data-keep": "files-list" });
  // the files as one tree of their folders, from / -- the home folder shown as ~, the session's directory
  // marked -- a folder with one child folder and no files shown as one ("ag_dashboard/vendor/"), each
  // folder folded or opened (opened unless folded by a click). A path not absolute (the session's
  // directory not known) goes under a folder of its own. Only the files of the kinds switched on (kindSwitches), and
  // those only git changed when shown (gitSwitch).
  const untmp = d.files.filter((f) => showTmp || !f.temporary);
  const kept = untmp.filter((f) => showGit || !gitOnly(f));
  const files = kept.filter((f) => !f.kinds.length || f.kinds.some((k) => !hiddenKinds.has(k)));
  const kindHidden = kept.length - files.length, gitHidden = untmp.length - kept.length;
  const tmpFiles = d.files.filter((f) => f.temporary).length, gitFiles = untmp.filter((f) => (f.git || []).length).length;
  const commands = d.commands;
  const UNKNOWN = "\0";
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = ((f.path.startsWith("/") ? "" : UNKNOWN + "/") + f.path).split("/"), name = parts.pop();
    let node = root;
    parts.forEach((p, i) => {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [], path: parts.slice(0, i + 1).join("/") });
      node = node.dirs.get(p);
    });
    node.files.push([f, name]);
  }
  const fileRow = (f, name, depth) => el("button", { type: "button", class: "fl-file" + (f === sel ? " on" : ""), title: f.path,
    style: `padding-left: ${12 + depth * 14}px`, "aria-pressed": f === sel ? "true" : "false",
    onclick: () => { state.files.sel = f === sel ? null : f.path; keepingPlace(renderMain); } },   // again: closed
    el("span", { class: "name", text: name }), changedCount(f.changed),
    el("span", { class: "badges" }, ...f.kinds.map((k) => kindMark(k, 12, k === "write" && f.created ? "created" : undefined)),
      showGit && (f.git || []).length ? gitMark(f.git) : null));
  const folded = state.files.folded || (state.files.folded = new Set());
  // a folder's row: its path from the row above it ("" the root, /); from above the home folder into it, as ~. A
  // harness's memory of a directory (harness_kit's `memory_folder`) marked, the long name it gives the directory cut.
  const MEMORY = memoryFolders();
  const memoryKey = MEMORY.length ? new RegExp(MEMORY.map(([re]) => re.source).join("|")) : /(?!)/;
  const label = (above, path) => path === UNKNOWN ? "relative to an unknown folder"
    : (under(path, home) && !under(above, home) ? "~" + path.slice(home.length)
      : above === null ? path : path.slice(above.length + 1))
      .replace(memoryKey, (m, ...g) => m.replace(g.slice(0, MEMORY.length).find((k) => k !== undefined) ?? "", "…")) + "/";
  const grow = (node, into, depth, above) => {
    for (const [, sub] of [...node.dirs].sort((x, y) => (x[0] === UNKNOWN) - (y[0] === UNKNOWN) || x[0].localeCompare(y[0]))) {
      let dir = sub;
      while (!dir.files.length && dir.dirs.size === 1 && !(cwd && dir.path === cwd) && dir.path !== UNKNOWN) {
        dir = [...dir.dirs.values()][0];                                // a chain of single folders: one row
      }
      const count = (x) => x.files.length + [...x.dirs.values()].reduce((a, y) => a + count(y), 0);
      const open = !folded.has(dir.path);
      into.append(el("button", { type: "button", class: "fl-dir", title: dir.path.startsWith(UNKNOWN) ? dir.path.slice(2) : dir.path || "/",
        style: `padding-left: ${12 + depth * 14}px`, "aria-expanded": open ? "true" : "false",
        onclick: () => { open ? folded.add(dir.path) : folded.delete(dir.path); keepingPlace(renderMain); } },
        el("span", { class: "tw", text: open ? "▾" : "▸" }), el("span", { class: "name", text: label(above, dir.path) }),
        cwd && dir.path === cwd ? el("span", { class: "wd", title: "The session's working directory", text: "cwd" }) : null,
        MEMORY.find(([re]) => re.test(dir.path)) ? el("span", { class: "wd", text: "memory",
          title: `${harnessName(MEMORY.find(([re]) => re.test(dir.path))[1])}'s memory of a directory: what it keeps for later sessions there` }) : null,
        open ? null : el("span", { class: "n", text: `${count(dir)}` })));
      if (!open) continue;
      const kids = el("div", { class: "fl-kids", style: `--guide: ${17 + depth * 14}px` });   // under its caret's middle
      grow(dir, kids, depth + 1, dir.path);
      into.append(kids);
    }
    for (const [f, name] of node.files.sort((x, y) => x[1].localeCompare(y[1]))) into.append(fileRow(f, name, depth));
  };
  grow(root, list, 0, null);
  if (!files.length) list.append(el("div", { class: "fv-note", text: kindHidden ? `Only ${plural(kindHidden, "file")} of the kinds switched off below.`
    : gitHidden ? `Only ${plural(gitHidden, "file")} git changed.`
    : tmpFiles ? `Only ${plural(tmpFiles, "file")} in temporary folders.`
    : opening || (running && d.turn === d.turns.length - 1) ? "No files yet in this turn." : "The agent touched no files in this turn." }));
  // every call of the turn, in the order made: what it did, its outcome, and the files it touched (a click opens one) --
  // those only git changed as it ran when shown (gitSwitch)
  const cmdFiles = (c) => (c.files || []).filter((p) => showGit || (c.did || {})[p] || !(c.git || {})[p]);
  const cmds = el("div", { class: "fl-scroll", "data-keep": `files-cmds-${d.turn}`, "data-follow": "1" });
  commands.forEach((c, i) => cmds.append(el("div", { class: "fl-cmd" },
    el("span", { class: "g " + (c.error ? "err" : c.running && running ? "run" : "ok"), text: "●" }),
    el("details", { id: `fl-${d.turn}-c${i}` }, el("summary", {}, el("span", { class: "k", text: `${i + 1}` }), callLabel(c, 140),
      changedCount(c.changed)),
      cmdFiles(c).length ? el("div", { class: "fl-cmd-files" }, ...cmdFiles(c).map((p) => el("button", { type: "button", title: p,
        onclick: () => { state.files.sel = p; keepingPlace(renderMain); } }, ...((c.did || {})[p] || []).map((k) => kindMark(k, 11)),
        showGit && (c.git || {})[p] ? gitMark(c.git[p], 11) : null, rel(p).split("/").pop()))) : null,
      callView(c.call, c)))));
  if (!commands.length) cmds.append(el("div", { class: "fv-note", text: "No commands in this turn." }));
  const shown = `${state.files.key}:${d.turn}`;
  if (cmdsShown !== shown) requestAnimationFrame(() => {   // once each time a turn is shown, the latest or one picked: at its end
    const n = document.querySelector(`[data-keep="files-cmds-${d.turn}"]`);
    if (!n) return;
    cmdsShown = shown;
    n.scrollTop = n.scrollHeight;
  });
  // two sections, each its own size and scrolling, each with the legend of its colours
  const legend = (pairs) => el("div", { class: "fl-legend" }, ...pairs.map(([name, color]) =>
    el("span", {}, el("i", { class: "fb", style: `background: ${color}` }), name)));
  const failed = commands.filter((c) => c.error).length;
  const busy = commands.filter((c) => !c.error && c.running && running).length;
  const side = sideFolded ? sideBar(files, { ok: commands.length - failed - busy, err: failed, run: busy }, info)
    : el("div", { class: "fl-side" },
    el("section", { class: "fl-sec files-sec" },
      el("div", { class: "fl-h" }, el("span", { text: files.length ? plural(files.length, "file") : "No files" }),
        tmpFiles ? tmpSwitch(tmpFiles) : null,
        el("button", { type: "button", class: "fold", title: "Fold the files and commands to a bar", "aria-label": "Fold the files and commands",
          onclick: () => foldSide(true) }, strokeIcon(ICONS.sidebar, 14))),
      cwd ? el("div", { class: "fl-wd", title: cwd }, el("span", { text: "Working directory" }),
        el("span", { class: "p", text: under(cwd, home) ? "~" + cwd.slice(home.length) : cwd })) : null, list,
      kindSwitches(gitFiles)),
    el("section", { class: "fl-sec cmds-sec" },
      el("div", { class: "fl-h", text: plural(commands.length, "command") + (failed ? ` · ${failed} failed` : "") }), cmds,
      legend([["passed", "var(--good)"], ["failed", "var(--critical)"], ["running", "var(--warning)"]])),
    filesBackground(info));
  // the file view only while a file is picked: the files and the conversation have the page until then
  const pane = sel ? el("div", { class: "fl-pane", "data-keep": "files-pane" }, fileView(sel, rel, `fl-${d.turn}-${d.files.indexOf(sel)}`)) : null;
  // patched in place to the note (data-morph): what is typed in it keeps its focus as the page draws again; the
  // conversation's node held apart (`kids`, as the chat frame's), so building this does not take it from the page: patch()
  // finds it where it is, and leaves it there
  const right = el("div", { class: "fl-right", "data-morph": "" });
  right.kids = [talk, asking].filter(Boolean);
  return el("div", { class: "fl-grid" + (sel ? " open" : "") + (sideFolded ? " folded" : ""), "data-morph": "" }, side, pane, right);
}
let cmdsShown = null;
// What runs in the background, under the commands: a section folded to its heading (openBackground), opened to
// its tasks, each a row as a command is -- its dot, what kind it is and what it is for, opened to when it started,
// its last sign of life and the file it writes to. Null when none runs.
function filesBackground(info) {
  const tasks = info.background || [];
  if (!tasks.length) return null;
  const head = el("button", { type: "button", class: "fl-h", "aria-expanded": bgOpen ? "true" : "false",
    title: bgOpen ? "Fold the background tasks" : "Show the background tasks", onclick: () => openBackground(!bgOpen) },
    el("span", { class: "tw", "aria-hidden": "true", text: bgOpen ? "▼" : "▶" }), el("span", { class: "mark", "aria-hidden": "true" }),
    el("span", { text: `${plural(tasks.length, "background task")} running` }));
  if (!bgOpen) return el("section", { class: "fl-sec bg-sec" }, head);
  const meta = (k, v, cls) => v ? el("div", { class: "fl-bg-meta" }, `${k} `, el("span", { class: cls || "", text: v })) : null;
  return el("section", { class: "fl-sec bg-sec open" }, head,
    el("div", { class: "fl-scroll", "data-keep": "files-bg" }, ...tasks.map((t) => el("div", { class: "fl-cmd" },
      el("span", { class: "g bg", text: "●" }),
      el("details", { id: `fl-bg-${t.id}` },
        el("summary", {}, el("span", { class: "kind", text: TASK_KINDS[t.kind] || t.kind }), firstLine(t.label || t.id, 140)),
        el("div", { class: "fl-bg-meta" }, "started ", el("span", { "data-ago": t.started || "", text: ago(t.started) }),
          t.active && t.active - t.started > 2 && !t.event ? el("span", {}, " · active ", el("span", { "data-ago": t.active, text: ago(t.active) })) : null),
        t.event ? el("div", { class: "fl-bg-meta" }, "last event ", el("span", { "data-ago": t.event_at || "", text: ago(t.event_at) }),
          ": ", el("span", { text: t.event })) : null,
        meta("writes to", t.output, "p"))))));
}
// The conversation, at the right: src/features/chat/ (ag_dashboard/DESIGN.md, A5), drawn from what talkFeed hands it,
// calling what CHAT_HOST gives it of this page. What it shows is the server's view of the conversation
// (ag_dashboard/CHAT_VIEW.md: the stream's `chat`, chat_view.py's), made from one read -- the turns, the latest's state,
// what waits, the message Esc took back -- by the actor's key (`state.chatView`); and the messages sent from this page's
// box, each by its id (`cid`), until the view has it, a moment later: the dashboard keeps each from the moment it is sent.
state.chatView = null;                                // {key, view}
const chatSends = [];                                 // {key, cid, text, at (the page's ms), ran}
function takeChatView(g, c, view) {
  if (!view || view.error || !view.current) view = null;   // one the server could not make: none
  const k = key(g, c), has = window.agNext.chat.cidsOf(view);
  state.chatView = { key: k, view };
  if (view) keep(k, "view", view);
  for (let i = chatSends.length - 1; i >= 0; i--) if (chatSends[i].key === k && has.has(chatSends[i].cid)) chatSends.splice(i, 1);
}
// the view of an actor -- the selected one's; null before it has come
const chatViewOf = (a) => !!a && !!state.selected && state.selected[1] === a.channel && !!state.chatView
  && state.chatView.key === key(...state.selected) ? state.chatView.view : null;
const mySends = () => { const k = state.selected && key(...state.selected); return chatSends.filter((m) => m.key === k); };
const AT_WORK = ["opening", "working", "asking"];
// A message as the user typed it, to match what was sent with what is stored (the server gives the user's words as
// typed: harness_kit's): "!echo hi" the same as "! echo hi".
const typedAs = (text) => String(text ?? "").trim().replace(/^!\s*/, "! ");
// whether two say the same: their start, as a stored message is clipped
const sameWords = (a, b) => typedAs(a).slice(0, 200) === typedAs(b).slice(0, 200);
state.chatSend = async () => false;                    // the message box's send, as the latest draw made it (chatCard)
const sendFailed = new Map();                         // per actor (its draft's key): why its last message was not sent
// Whether the message Claude Code took back is in its input box untouched, as sessions.py's `took_back` reads it: what was
// last typed into its terminal, the dashboard's, is the key that stopped the turn, after the call before (`since`).
const takenBack = (info) => { const v = chatViewOf(info); return (v && v.taken_back) || (info && info.taken_back) || null; };
const untouched = (info) => {
  const tb = takenBack(info), s = info && info.session;
  return !!tb && !!s && !!s.stopped_at && s.stopped_at > (tb.since || 0);
};
// Claude Code put the message it was stopped on (Esc before any of its answer came: data.py's `taken_back`) back in its
// input box, out of the conversation -- as Chat shows it too, the message in no turn. Untouched there: in this message
// box too, as the actor's draft -- once, and only where nothing is written for the actor. Sent from here, Claude Code's box is emptied
// first (sessions.py's `took_back`), so the two do not go as one. Once it is no longer there untouched -- sent or changed
// in the terminal, or its process gone -- it is taken out of this box too, if it is still as it was put. What was put,
// by the actor's draft ({at, text}), is kept in the tab as drafts are, so a reload does not put back what was cleared.
const REFILLED_KEY = "ag-dashboard-refilled", refilledHere = {};
function refills() {
  try { const v = JSON.parse(sessionStorage.getItem(REFILLED_KEY)); return v && typeof v === "object" ? v : {}; }
  catch (e) { return refilledHere; }
}
function markRefill(draft, mark) {
  const m = refills();
  if (mark) m[draft] = mark; else delete m[draft];
  try { sessionStorage.setItem(REFILLED_KEY, JSON.stringify(m)); } catch (e) { if (mark) refilledHere[draft] = mark; else delete refilledHere[draft]; }
}
function refill(info, draft) {
  const tb = takenBack(info), mark = refills()[draft], box = document.getElementById("composer-text");
  const mine = box && box.dataset.draft === draft ? box : null;
  if (tb && untouched(info)) {
    if (mark && mark.at === tb.at) return;
    markRefill(draft, { at: tb.at, text: tb.text });
    if (drafts()[draft] || (mine && mine.value)) return;
    keepDraft(draft, tb.text);
    if (mine) { mine.value = tb.text; fitBox(mine); }
  } else if (mark) {
    markRefill(draft, null);
    if (drafts()[draft] !== mark.text) return;
    keepDraft(draft, "");
    if (mine && mine.value === mark.text) { mine.value = ""; fitBox(mine); }
  }
}
// Esc, as in the harness's own terminal: the agent's turn interrupted -- the key typed into the session's terminal, which
// the dashboard runs. Only while it works or asks (an idle Claude Code takes Esc twice for its rewind; one starting, for
// "No" to trusting its folder), and once a second. `state.interrupting`: the actor it was sent for, and when.
state.interrupting = null;
// Or a message sent from here into its terminal, pending: its turn under way before the dashboard has heard of it (the
// key waits for the message's Enter: sessions.py's `type`) -- not into a terminal the message opened, which may ask
// first whether to trust the folder, where Esc is "No".
const canInterrupt = (info) => !!info && !!info.session && !!info.session.terminal && info.session.status !== "starting"
  && (["running", "asking"].includes(info.status) || viewAtWork(info) || sentPending(info));   // not a build of its context, idle
const viewAtWork = (a) => { const v = chatViewOf(a); return !!v && AT_WORK.includes(v.current.state) && !(v.opening && v.opening.unseen); };
const sentPending = (info) => !!state.selected && state.selected[1] === info.channel && mySends().some((m) => m.ran);
function interrupt(info) {
  const k = state.selected && key(...state.selected);
  if (!canInterrupt(info) || (state.interrupting && state.interrupting.key === k && Date.now() - state.interrupting.at < 1000)) return false;
  state.interrupting = { key: k, at: Date.now() };
  post("/api/terminal/input", { session_id: info.session.session_id, data: "\u001b" })
    .catch((err) => { state.interrupting = null; setLive(`Not interrupted: ${err.message}`); });
  keepingPlace(renderMain);
  return true;
}
const INTERRUPTING_MS = 10000;                      // "Interrupting…" shown at most this long, if the turn goes on
const isInterrupting = () => !!state.interrupting && !!state.selected && state.interrupting.key === key(...state.selected)
  && Date.now() - state.interrupting.at < INTERRUPTING_MS;
// A turn its session has opened that ag has not stored yet -- the harness has its message (the view's opening, `seen`):
// the actor runs. For an actor, the selected one's.
function opened(a) {
  const v = chatViewOf(a);
  return !!v && !!v.opening && !!v.opening.seen;
}
const talkToEnd = () => { const n = document.querySelector("#main .fl-talk"); if (n) n.scrollTop = n.scrollHeight; };
// What the conversation is drawn from (src/features/chat/types.ts's ChatFeed): the server's view of it, the messages sent
// from here it does not have yet, and how this page shows it now.
function talkFeed(info, session, writable, held, afresh) {
  return { key: key(...state.selected), gatherer: state.selected[0], files: state.files, data: state.files.data,
    picked: state.files.turn, home: state.home, info, session, view: chatViewOf(info), writable, held,
    canInterrupt: canInterrupt(info), interrupting: isInterrupting(), mine: mySends().map(({ cid, text, at }) => ({ cid, text, at })),
    sideFolded, earlierTurns, terminalView: CHAT_VIEWS.has("terminal"), afresh };
}
// What the conversation calls of this page (src/features/chat/types.ts's ChatHost), until those parts move too: the actor's
// stage, a call as the commands show it, an actor's face, a Browser's message, a message's words as matched, the icons;
// and this page's redraw, its files and commands, its views, its Esc.
const CHAT_HOST = Object.freeze({
  atWork, atRest, greeting, callView, callLabel, bareAvatar, hueInk, envelope, typedAs, sameWords, icons: ICONS, beside: BESIDE_KEY,
  crewFace: (a, coordinator) => crewFace(a, coordinator ? MANAGER : null),
  appWords: (text) => appWordsOf(text),
  redraw: () => keepingPlace(renderMain), foldSide, setFilesTurn, setChatView,
  interruptOver: () => { state.interrupting = null; },
});
addChatView({
  // "files": named so once, and kept as its id, with the readers' choices of it
  id: "files", name: "Chat", feed: "files", frame: "files", icon: ICONS.bubble,
  background: false,                                 // drawn under its commands
  greets: true,                                      // says itself that there is no conversation yet
  asking: false,                                     // drawn under its conversation, at the right
  queued: false,                                     // what waits for the turn to end: at its conversation's end, pending
  description: "The conversation, and beside it each turn's files and commands: what the agent read, searched and changed, with the lines it saw and its changes in place.",
  tools: filesTools,
  render: filesRender,
});

