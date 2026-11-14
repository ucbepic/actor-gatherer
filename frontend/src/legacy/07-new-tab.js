// A NEW TAB's page (features/layout/work.ts's `blank` hook): what a tab showing nothing shows -- one made by "+" on the
// tabs' bar or the new-tab key, or the last tab closed. A message box for a new actor: Enter starts one where its line
// says -- IN a group (or a folder of one), or on its own; in a DIRECTORY; ON a harness -- with what was typed its first
// message, shown in this tab, in Chat (startSession: the tab shown showing nothing, the actor goes in it). Nothing is
// started till then: typing alone leaves no actor. Under it, the apps to open here instead (and a terminal), in that
// group. What is typed is the tab's draft (tabs.ts's setDraft): kept with it, the tab kept when left.
// Where things go to start with: the place last started in -- an actor, an app with its agent, a terminal from the list's
// "+" or a new tab, an app from a new tab -- or picked on a new tab, kept in this browser; else the group of the actor
// last shown, else the latest active group. The harness: the last one an actor was started on. The directory: the
// place's (its latest active actor's), changed from its chip.
// KEYS for the screen tabs: the new-tab key opens a new tab (its box in focus), the close key closes the tab shown
// (tabs.ts's closeShown). In the ag app, ⌘T and ⌘W (its menu: desktop/src/menu.ts); in a browser, which keeps those for
// its own tabs, ⌃T and ⌃W -- on a Mac only, where they are no one else's. Not in a terminal: there ⌃W deletes a word, and
// ⌃T is Claude Code's to-do list. A Browser panel's page keeps the app's ⌘T and ⌘W for its own tabs, as in Chrome.
const START_PLACE_KEY = "ag-dashboard-start-place", START_HARNESS_KEY = "ag-dashboard-start-harness";
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
// the page drawn: its tab, the choices made on it (null: as they start), its parts redrawn as the home changes
const newTab = { tab: "", box: null, input: null, parts: null, place: null, cwd: null, harness: null, error: "", busy: "", sig: "" };
const keptValue = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
const keepValue = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* this page only */ } };
const realGroups = () => (state.home ? state.home.gatherers.filter((g) => !g.alone) : []);
const canAlone = () => !!(state.home && state.home.merged && aloneHarnesses().length && aloneUnder());
// a place as it is now: its group still there, its folder still in it and not closed (else the group's top); on its own,
// while an actor can be started so. null: none.
function placeNow(p) {
  if (!p || !state.home) return null;
  if (p.alone) return canAlone() ? { alone: true } : null;
  const g = realGroups().find((x) => x.name === p.g);
  if (!g) return null;
  const f = folderById(g.name, p.folder);
  return { g: g.name, folder: f && !shownClosed(g, f) ? f.id : null };
}
function startPlace() {
  const kept = placeNow(keptValue(START_PLACE_KEY));
  if (kept) return kept;
  const gs = realGroups(), shown = state.selected && gs.find((g) => g.name === state.selected[0]);
  const g = shown || [...gs].sort((x, y) => (y.last || 0) - (x.last || 0))[0];
  return g ? { g: g.name, folder: null } : null;
}
// Something started in group `gname` -- in the folder aimed at (startIn), or `folder` -- or on its own: kept, where the next
// new tab starts things
function keptStart(gname, alone = false, folder = undefined) {
  const fid = folder !== undefined ? folder : startIn.g === gname && folderById(gname, startIn.folder) ? startIn.folder : null;
  keepValue(START_PLACE_KEY, alone ? { alone: true } : { g: gname, folder: fid });
}
const keptHarness = (h) => keepValue(START_HARNESS_KEY, h);
const ntPlace = () => placeNow(newTab.place) || startPlace();
const ntGroup = (p) => !p ? null : p.alone ? aloneUnder() : realGroups().find((g) => g.name === p.g) || null;
const ntHarnesses = (p) => p && p.alone ? aloneHarnesses() : startable();
function ntHarness(p) {
  const hs = ntHarnesses(p), last = keptValue(START_HARNESS_KEY);
  return hs.includes(newTab.harness) ? newTab.harness : hs.includes(last) ? last : hs[0] || null;
}
function ntCwd(p) {
  if (newTab.cwd !== null) return newTab.cwd;
  const g = p && (p.alone ? everyActor() : ntGroup(p));
  return tildePath((g && startCwd(g)) || state.home.cwd || "", state.home.home_dir);
}
// a long directory by its last two folders (the whole in its chip's title)
function shortDir(d) {
  const all = String(d || ""), parts = all.replace(/\/+$/, "").split("/");
  return all.length > 40 && parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : all;
}
const placeName = (p) => !p ? "No group yet" : p.alone ? "On its own"
  : titleOf(ntGroup(p)) + (p.folder !== null ? ` › ${(folderById(p.g, p.folder) || {}).name || ""}` : "");

// The page, drawn into the work area's box for a tab showing nothing (`tab`, its id): the message box as the tab's draft
// left it, in focus, and its parts
function drawNewTab(box, tab) {
  if (PANE || SNAPSHOT || !workPlacer) return;
  if (tab !== newTab.tab || !newTab.input || !box.contains(newTab.input))
    Object.assign(newTab, { tab, place: null, cwd: null, harness: null, error: "", sig: "" });
  newTab.box = box;
  box.classList.add("nt");
  const input = el("textarea", { class: "nt-text", rows: "2", placeholder: "Message a new actor", "aria-label": "Message a new actor",
    title: "Enter starts a new actor with this message · Shift+Enter for a new line", enterkeyhint: "send", spellcheck: "true" });
  input.value = workPlacer.tabs.shownTab().draft;
  input.addEventListener("input", () => { fitBox(input); workPlacer.tabs.setDraft(input.value); if (newTab.error) ntSay(""); });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void ntSend(); }
  });
  const line = el("div", { class: "nt-line" }), apps = el("div", { class: "nt-apps" }), err = el("div", { class: "nt-err", role: "alert" });
  newTab.input = input;
  newTab.parts = { line, apps, err };
  box.replaceChildren(el("div", { class: "nt-page" },
    el("div", { class: "nt-ask" }, input, line), err, apps,
    el("div", { class: "nt-hint", text: `Or click a task in the list to open it here.${keysSaid()}` })));
  refreshNewTab(true);
  requestAnimationFrame(() => { if (input.isConnected) { fitBox(input); input.focus({ preventScroll: true }); } });
}
function keysSaid() {
  let app = false;
  try { app = !!window.top.agApp; } catch (e) { /* not ours */ }
  if (app) return IS_MAC ? " ⌘T opens a new tab, ⌘W closes the one shown." : " Ctrl+T opens a new tab, Ctrl+W closes the one shown.";
  return IS_MAC ? " ⌃T opens a new tab, ⌃W closes the one shown." : "";
}
// Its parts drawn again if what they show changed (the home: its groups, folders, harnesses; the apps found), or `now`
function refreshNewTab(now = false) {
  const box = newTab.box, parts = newTab.parts;
  if (!box || !parts || box.hidden || !box.isConnected || !state.home) return;
  const p = ntPlace(), apps = PANE || SNAPSHOT ? [] : window.agNext.apps.found();
  const sig = JSON.stringify([p, placeName(p), ntHarnesses(p), ntHarness(p), ntCwd(p), canAlone(), newTab.busy, newTab.error,
    state.home.terminals, apps.map((a) => [a.name, a.label, !!a.failed])]);
  if (!now && sig === newTab.sig) return;
  newTab.sig = sig;
  newTab.input.disabled = !!newTab.busy;
  parts.err.textContent = newTab.error;
  parts.line.replaceChildren(...ntLine(p));
  parts.apps.replaceChildren(...ntApps(p, apps));
}
function ntSay(text) { newTab.error = text; refreshNewTab(true); }
// "In", "Directory", "On": a chip each, its drop-down or box a click away
function ntLine(p) {
  if (newTab.busy) return [el("span", { class: "nt-busy", text: newTab.busy })];
  const hs = ntHarnesses(p), h = ntHarness(p), off = !p;
  const chip = (key, label, value, title, open, extra = {}) => el("button", { type: "button", class: "nt-chip", "data-pop": key,
    title, "aria-haspopup": open ? "menu" : undefined, "aria-expanded": open ? String(rowPop.key === key) : undefined,
    ...(open ? { onclick: (ev) => { if (rowPop.key === key) return closePop(); open(ev.currentTarget); } } : { disabled: "" }), ...extra },
    el("span", { class: "lbl", text: label }), ...value, open ? el("span", { class: "caret", "aria-hidden": "true", text: "▾" }) : null);
  return [
    chip("nt:in", "In", [el("span", { class: "val", text: placeName(p) })],
      p ? `Where the new actor goes: ${placeName(p)}${p.alone ? " (it shares context with no group)" : ""}` : "Make a group first: + New group in the list",
      realGroups().length ? (b) => openPop("nt:in", b, ntMenu("Start it in", ntPlaces(p))) : null),
    chip("nt:dir", "Directory", [el("span", { class: "val dir", text: shortDir(ntCwd(p)) || "Choose one" })], `It works in ${ntCwd(p) || "a directory you choose"}`,
      off ? null : (b) => openPop("nt:dir", b, ntDirBox(p))),
    hs.length ? chip("nt:on", "On", [harnessBadge(h), el("span", { class: "val", text: harnessName(h) })],
      `Its harness: ${harnessName(h)}${p && p.alone && startable().length > hs.length ? " (on its own: the ones that name their session from the start)" : ""}`,
      hs.length > 1 ? (b) => openPop("nt:on", b, ntMenu("Run it on", hs.map((x) => ({ mark: harnessBadge(x), text: harnessName(x),
        note: x === h ? "chosen" : "", run: () => { newTab.harness = x; refreshNewTab(true); ntFocus(); } })))) : null)
      : el("span", { class: "nt-none", title: noHarness(), text: p && p.alone ? "No harness starts an actor on its own here" : "No harness here" }),
  ];
}
// a drop-down of the page's: scrolling, if long (many groups and folders)
function ntMenu(head, items) { const m = popMenu(head, items); m.classList.add("nt-menu"); return m; }
// "In"'s drop-down: each group, its open folders under it, then on its own (when an actor can start so)
function ntPlaces(p) {
  const at = (q) => JSON.stringify(q) === JSON.stringify(p) ? "chosen" : "";
  const pick = (q) => () => { newTab.place = q; newTab.cwd = null; keepValue(START_PLACE_KEY, q); refreshNewTab(true); ntFocus(); };
  const items = [];
  const folders = (g, id, depth) => {
    for (const f of kidFolders(g.name, id).filter((x) => !shownClosed(g, x)).sort((x, y) => byName(x.name, y.name))) {
      const q = { g: g.name, folder: f.id };
      items.push({ icon: ICONS.folder, text: f.name, note: at(q), depth, run: pick(q) });
      folders(g, f.id, depth + 1);
    }
  };
  for (const g of realGroups()) {
    const q = { g: g.name, folder: null };
    items.push({ icon: ICONS.layers, text: titleOf(g), note: at(q), run: pick(q) });
    folders(g, null, 1);
  }
  if (canAlone()) items.push({ icon: ICONS.agent, text: "On its own", note: at({ alone: true }) || "shares context with no group", run: pick({ alone: true }) });
  return items;
}
// "Directory"'s box: the directory typed, the ones the place's actors work in a click away
function ntDirBox(p) {
  const dir = ntCwd(p), err = el("div", { class: "err", role: "alert" });
  const use = () => {
    const v = input.value.trim();
    if (!v) { err.textContent = "Which directory?"; input.focus(); return; }
    newTab.cwd = v;
    closePop(); refreshNewTab(true); ntFocus();
  };
  const input = el("input", { type: "text", value: dir, spellcheck: "false", "aria-label": "Working directory", placeholder: "~/projects/my-project",
    oninput: () => { err.textContent = ""; }, onkeydown: (ev) => { if (ev.key === "Enter") { ev.preventDefault(); use(); } } });
  const g = p.alone ? everyActor() : ntGroup(p);
  return el("div", { class: "dw-menu", role: "dialog", "aria-label": "Working directory" },
    el("div", { class: "head", text: "Where the new actor works" }),
    el("label", {}, "Working directory", input),
    g ? folderPicks(g, dir, input, err, p.alone ? "Where actors work" : "Where its actors work") : null,
    el("div", { class: "on" }, el("button", { type: "button", class: "go", onclick: use }, "Use it")),
    err);
}
// The apps to open here instead -- each in the place's group, filed in its folder if it is a new one -- the apps with an
// agent of their own started with it (on the harness chosen, or one that can give it their tools), and a terminal
function ntApps(p, found) {
  const g = ntGroup(p), alone = !!(p && p.alone), off = !p || alone || !!newTab.busy;
  const tooled = startable().filter((h) => (harnessInfo(h) || {}).mcp);
  const plain = found.filter((a) => !(a.agent && a.agent.start) && !a.failed);
  const agented = tooled.length ? found.filter((a) => a.agent && a.agent.start && !a.failed) : [];
  const why = alone ? "Apps open in a group: pick one under In" : !p ? "Make a group first" : "";
  const button = (mark, label, title, run) => el("button", { type: "button", class: "nt-app", title: why || title, ...(off ? { disabled: "" } : {}),
    onclick: () => void ntRun(label, run) }, mark, el("span", { text: label }));
  const markOf = (a) => a.mark ? appMarkImg(a) : strokeIcon(ICONS.app, 16);
  const items = [
    ...plain.map((a) => button(markOf(a), a.label, a.description || a.label, () => ntOpenApp(g, p, a))),
    ...agented.map((a) => button(markOf(a), a.label, `${a.description || a.label} -- with an agent of its own`, () => {
      const h = tooled.includes(ntHarness(p)) ? ntHarness(p) : tooled[0];
      aimStart(g.name, p.folder);
      return startWithApp(g.name, ntCwd(p), a.name, h);
    })),
    ...(state.home.terminals !== false ? [button(strokeIcon(ICONS.terminal, 16), "Terminal", `A terminal in ${ntCwd(p) || "the directory chosen"}`,
      () => { aimStart(g.name, p.folder); return startShell(g.name, ntCwd(p)); })] : []),
  ];
  return items.length ? [el("div", { class: "nt-lbl", text: "Or open" }), el("div", { class: "nt-row" }, ...items)] : [];
}
// One of them opened -- in this tab, whatever is typed (tabs.ts's filling): what is typed stays with the tab
async function ntRun(what, run) {
  if (newTab.busy) return;
  newTab.busy = `Opening ${what}…`; newTab.error = "";
  refreshNewTab(true);
  workPlacer.tabs.filling(true);
  try { await run(); }
  catch (e) { newTab.error = `${what}: ${e.message}`; }
  finally { workPlacer.tabs.filling(false); newTab.busy = ""; refreshNewTab(true); }
}
async function ntOpenApp(g, p, app) {
  const inst = await window.agNext.apps.open(app.name, g.name, ntCwd(p) || null);
  const id = appItem(inst.id), fresh = !appInfo(g.name, inst.id);
  if (fresh && p.folder !== null)                   // a new one: filed where it was started (one there already stays put)
    await folderPost(g.name, { do: "file", channels: [id], folder: p.folder }, (tree) => { tree.filed[id] = p.folder; openUp(tree, p.folder); });
  keptStart(g.name, false, p.folder);
  await readApps(g.name, true);
  const o = appInfo(g.name, inst.id);
  if (o) await selectApp(g.name, o, {}); else await openApp(g.name, app.name, ntCwd(p) || null);
}
const ntFocus = () => { if (newTab.input && newTab.input.isConnected && !newTab.input.disabled) newTab.input.focus({ preventScroll: true }); };
// Enter: a new actor where the line says, its first message what was typed -- shown in this tab, the message sent as Chat
// sends one (shown at once, kept as its draft if it could not be sent). The tab's draft gone once it has started.
async function ntSend() {
  const input = newTab.input, text = input ? input.value.trim() : "";
  if (!text || newTab.busy) return;
  const p = ntPlace(), g = ntGroup(p), h = ntHarness(p), cwd = ntCwd(p).trim();
  if (!p || !g) return ntSay("Make a group first: + New group in the list.");
  if (!h) return ntSay(p.alone ? "No harness here starts an actor on its own: pick a group under In." : noHarness());
  if (!cwd) return ntSay("Which directory? Choose one under Directory.");
  newTab.busy = "Starting…"; newTab.error = "";
  refreshNewTab(true);
  if (!p.alone) aimStart(g.name, p.folder);
  const tab = workPlacer.tabs.shownTab().id;
  let s = null;
  workPlacer.tabs.filling(true);                     // the actor in this tab
  try {
    s = await startSession(g.name, cwd, h, null, !!p.alone);
    workPlacer.tabs.setDraft("", tab);
  } catch (e) {
    newTab.error = `Not started: ${e.message}`;
  } finally { workPlacer.tabs.filling(false); newTab.busy = ""; }
  if (!s) { refreshNewTab(true); ntFocus(); return; }
  const k = key(s.gatherer, s.session_id);
  if (state.chatSend && state.chatSend.draft === k) {
    if (await state.chatSend(text)) return;
    if (!drafts()[k]) { keepDraft(k, text); renderMain(); }   // not sent (Chat says why): its draft, not lost
    return;
  }
  keepDraft(k, text);                                // not in Chat here (another view): its draft, to send from there
  try { await post("/api/send", { session_id: s.session_id, text }); keepDraft(k, ""); }
  catch (e) { setLive(`Not sent: ${e.message}`); }
}

// The keys: the tab shown's page's -- a pane's frame hands them to the page (agPanes.tabKey) -- or the ag app's menu's
function tabKey(what) {
  if (PANE) { PANE.tabKey(window, what); return; }
  if (!workPlacer || SNAPSHOT) return;
  if (what === "closeTab") { void workPlacer.tabs.closeShown(); return; }
  if (what !== "newTab") return;
  if (newTab.box && !newTab.box.hidden && newTab.box.isConnected) ntFocus();   // a new tab's page shown: its box
  else void workPlacer.tabs.blank();
}
if (!SNAPSHOT && IS_MAC) document.addEventListener("keydown", (ev) => {
  if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.defaultPrevented || ev.isComposing) return;
  const k = String(ev.key).toLowerCase();
  if (k !== "t" && k !== "w") return;
  if (ev.target && ev.target.closest && ev.target.closest(".xterm")) return;   // the terminal's own
  ev.preventDefault(); ev.stopPropagation();
  tabKey(k === "t" ? "newTab" : "closeTab");
}, true);
if (!PANE && !SNAPSHOT) { try { if (window.agApp && window.agApp.onKey) window.agApp.onKey(tabKey); } catch (e) { /* not the app */ } }
