// ------------------------------------------------------------------ the list folded, or over the whole page
// The list's shape, kept in this browser: "list"; folded to a rail ("folded"), the actors at work or wanting the reader
// as their avatars; or over the whole page ("full"), the monitor -- left again for the shape it came from (listFrom),
// by its button, by Esc, or by picking an actor there. Over the whole page, the panes stay under it as they are: their
// terminals not resized, nor typed into.
const LIST_KEY = "ag-dashboard-list";
let listMode = "list", listFrom = "list";
const LIST_ICONS = {
  full: "M9.75 2.25h4v4M13.75 2.25l-4.5 4.5M6.25 13.75h-4v-4M2.25 13.75l4.5-4.5",
  unfull: "M13.75 2.25l-4.5 4.5M9.25 3v3.75H13M2.25 13.75l4.5-4.5M6.75 13V9.25H3",
  fold: "M11 6l-2 2 2 2", unfold: "M9 6l2 2-2 2",
  hide: "M2.75 2.75v10.5M11 5L8 8l3 3M8 8h5.25", keep: "M2.75 2.75v10.5M8.5 5l3 3-3 3M11.5 8H5.5",
};
function setListMode(mode, keep = true) {
  if (PANE || !["list", "folded", "full"].includes(mode)) mode = "list";
  if (mode === "full" && listMode !== "full") listFrom = listMode;
  const was = listMode;
  listMode = mode;
  document.documentElement.classList.toggle("list-folded", mode === "folded");
  document.documentElement.classList.toggle("list-full", mode === "full");
  document.documentElement.classList.toggle("list-was-folded", mode === "full" && listFrom === "folded");   // the panes as wide as they were
  drawListButtons();
  if (keep) { try { localStorage.setItem(LIST_KEY, JSON.stringify({ mode, from: listFrom })); } catch (e) { /* this page only */ } }
  if (mode === "full" && was !== "full") {          // what had the keys -- a terminal, a pane's frame -- has them no more
    const at = document.activeElement;
    if (at && at !== document.body && at.closest(".panes")) at.blur();
    document.getElementById("monitor").focus({ preventScroll: true });
  }
  if (mode !== "full") monForget();
  if (state.home) renderAgents();
}
// A column's width, dragged at its edge (grip): set as node's prop, at least min (its most: the stylesheet's
// max), kept under key; at(x) is the width the pointer at x gives. A double click: the stylesheet's width again.
function widthGrip(grip, key, node, prop, min, at) {
  const set = (w) => w > 0 ? node.style.setProperty(prop, `${Math.round(Math.max(min, w))}px`) : node.style.removeProperty(prop);
  try { set(Number(localStorage.getItem(key))); } catch (e) { /* this page only */ }
  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    const box = document.getElementById("panes");
    grip.classList.add("on"); box.classList.add("resizing");   // the frames let the pointer by while it drags
    const move = (e) => set(at(e.clientX));
    const up = () => {
      grip.classList.remove("on"); box.classList.remove("resizing");
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
      try { localStorage.setItem(key, String(parseInt(node.style.getPropertyValue(prop)) || "")); } catch (e) { /* this page only */ }
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => { set(0); try { localStorage.removeItem(key); } catch (e) { /* this page only */ } });
}
widthGrip(document.getElementById("side-grip"), "ag-dashboard-side-width", document.documentElement, "--side-w", 200,
  (x) => x - document.querySelector(".side").getBoundingClientRect().left);
// the folded rail's own width (--rail-w), its right edge dragged as the list's is: 76px at the least, 360px at the most
const RAIL_GRIP = el("div", { class: "rail-grip", "aria-hidden": "true", title: "Drag to widen the rail · double-click: as narrow as it was" });
document.querySelector(".side").append(RAIL_GRIP);
widthGrip(RAIL_GRIP, "ag-dashboard-rail-width", document.documentElement, "--rail-w", 76,
  (x) => Math.min(360, x - document.querySelector(".side").getBoundingClientRect().left));
// its two buttons, as the list is: over the whole page (or back), and folded (or open again; none over the page)
function listButtons() {
  const full = listMode === "full", folded = listMode === "folded";
  const fold = folded ? "Open the list" : "Fold the list";
  return [el("button", { class: "list-btn lb-full", type: "button", "aria-pressed": full ? "true" : "false",
      title: full ? "Back to the list (Esc)" : "Every actor over the whole page: what each is doing",
      "aria-label": full ? "Leave full screen" : "Full screen", onclick: () => full ? leaveFull() : setListMode("full") },
      strokeIcon(full ? LIST_ICONS.unfull : LIST_ICONS.full)),
    full ? null : el("button", { class: "list-btn lb-fold", type: "button", "aria-expanded": folded ? "false" : "true", title: fold,
      "aria-label": fold, onclick: () => setListMode(folded ? "list" : "folded") },
      strokeIcon(ICONS.sidebar + (folded ? LIST_ICONS.unfold : LIST_ICONS.fold))),
    full || PANE ? null : el("button", { class: "list-btn lb-hide", type: "button", "aria-pressed": listHidden ? "true" : "false",
      title: listHidden ? "Keep the list open" : "Hide the list: it slides out when the pointer reaches the page's left edge",
      "aria-label": listHidden ? "Keep the list open" : "Hide the list", onclick: () => setListHidden(!listHidden) },
      strokeIcon(listHidden ? LIST_ICONS.keep : LIST_ICONS.hide))];
}
// THE LIST HIDDEN (its button; kept in this browser), whatever its shape (the list, the rail): out of the way at once,
// the panes the page's whole width, a thin edge at the page's left. The pointer on that edge (or the keys in the list),
// it slides out over the panes, and stays while the pointer is on it -- still or moving -- or on a menu or card of it,
// a name is typed in it or a row dragged from it; it slides back a moment after the pointer has left. Where the pointer
// is, is asked of the page at its last place (elementFromPoint): a list slid in under a still pointer is under it,
// though the browser's own hover may not say so till it moves -- and a pointer over a pane's frame moves unseen.
const HIDE_KEY = "ag-dashboard-list-hidden", UNPEEK_MS = 300;
let listHidden = false, peekTimer = null;
const pointerAt = { x: -1, y: -1 };
function setListHidden(on, keep = true) {
  listHidden = !!on && !PANE;
  document.documentElement.classList.toggle("list-hidden", listHidden);
  peekList(false);                                   // pressed to hide it: hidden now, out again at the edge
  drawListButtons();
  if (keep) { try { localStorage.setItem(HIDE_KEY, listHidden ? "1" : ""); } catch (e) { /* this page only */ } }
}
function peekList(on) {
  clearTimeout(peekTimer);
  const was = document.documentElement.classList.contains("list-peek");
  document.documentElement.classList.toggle("list-peek", on && listHidden);
  // out over the panes, it floats over them (features/apps/native.ts): a Browser's own page under it, in the ag app,
  // pictured in its place from the first frame it is over any of it
  document.querySelector(".side").classList.toggle("floats", on && listHidden);
  if (on && listHidden && !was) unpeekSoon();        // (left again at once, never come onto it: back too)
}
// in use: the pointer on it (or a menu or card of it), a name typed in it, a row dragged from it
function listInUse() {
  if (listDrag || document.querySelector(".row-menu, .side :is(input, textarea, [contenteditable]):focus")) return true;
  const at = pointerAt.x < 0 ? null : document.elementFromPoint(pointerAt.x, pointerAt.y);
  return !!(at && at.closest(".side, .list-edge, .row-menu, #actor-card"));
}
function unpeekSoon() {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { if (listInUse()) unpeekSoon(); else peekList(false); }, UNPEEK_MS);
}
if (!PANE && !SNAPSHOT) {
  const side = document.querySelector(".side"), edge = el("div", { class: "list-edge", "aria-hidden": "true" });
  side.after(edge);
  const at = (ev) => { pointerAt.x = ev.clientX; pointerAt.y = ev.clientY; };
  document.addEventListener("pointermove", at, { capture: true, passive: true });
  edge.addEventListener("pointerenter", (ev) => { at(ev); peekList(true); });
  edge.addEventListener("pointermove", (ev) => { at(ev); if (!document.documentElement.classList.contains("list-peek")) peekList(true); });
  side.addEventListener("pointerleave", (ev) => { at(ev); if (listHidden) unpeekSoon(); });   // (onto a frame: its last place)
  side.addEventListener("focusin", () => peekList(true));
  side.addEventListener("focusout", () => { if (listHidden) unpeekSoon(); });
  try { listHidden = localStorage.getItem(HIDE_KEY) === "1"; } catch (e) { /* none kept */ }
  const root = document.documentElement;
  root.classList.add("list-still");                  // the page opened with it hidden: hidden, not sliding away
  root.classList.toggle("list-hidden", listHidden);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("list-still")));
}
function drawListButtons() { document.getElementById("list-btns").replaceChildren(...listButtons().filter(Boolean)); }
const leaveFull = () => setListMode(listFrom === "full" ? "list" : listFrom);
document.addEventListener("keydown", (ev) => {        // first: Esc closes the settings first, if they are open
  if (ev.key !== "Escape" || listMode !== "full" || !document.getElementById("about").hidden || window.agNext.settings.fileOpen()) return;
  ev.preventDefault();
  leaveFull();
}, true);
// The list in the shape it is in: the rail, or the monitor, drawn from the home (the list itself is drawn all the same).
function renderFolded() {
  if (listMode === "folded") renderRail();
  else if (listMode === "full") renderMonitor();
  if (hover.from === "rail" && listMode !== "folded") cardHide();
}
// The rail: the list, small. Each gatherer not hidden, its name over its actors -- a button folding it, as the list's
// does (folded, the counts the list shows for it); hovered, its card has its buttons (gathererCard) -- then its box as
// the list has it (railBox): each of its folders, folded, its name as a gatherer's is, and under it, as under a folded
// gatherer, how many wait on the reader, stopped on an error, run (railFolded) -- a click opens it in place, its actors
// and folders set in under its name, a square bracket down their left from its name; hovered, a folder's name has its card with its buttons and
// its actors (folderCard); a double-click on a gatherer's or folder's name shows only it (railHere) -- then its actors
// open; its saved and closed ones, folded as the list folds them, to a line at its top that opens them (the one shown
// staying in view). Only what the reader checks at the rail's foot (railShow, RAIL_FOOT), over every gatherer or drilled
// in: unchecked, only the folders with an actor not closed in them, open, and no saved or closed lines. Each actor its
// avatar, its status's dot at
// its corner, and its name in small under it; hovered (or in focus from the keys), a card beside the rail says who it
// is (actorCard) -- a folder's, what it holds (folderCard) -- and an actor's bookmark and × show in its top corners. A
// click shows it, as in the list; Shift+click selects it, as there; dragged (every selected one with it) onto a folder's
// name, a gatherer's, the name drilled into or a step of the path over it, it moves there (railDragged).
// The rail drilled into a gatherer or a folder (a double-click on its name, or its card's "Show only it"): only the tree
// from there, under "Up" (the folder it is in; from a gatherer's top, every gatherer) and "Root" (every gatherer).
// `railAt`: {g, f} (a gatherer's name, a folder's id; f null: the gatherer's top), or null: every gatherer. Kept across
// reloads; gone (a folder deleted, a gatherer hidden): its gatherer's top, or every gatherer.
const RAIL_AT_KEY = "ag-dashboard-rail-at";
let railAt = (() => {
  try { const v = JSON.parse(localStorage.getItem(RAIL_AT_KEY)); if (v && v.at && typeof v.at.g === "string") return v.at; } catch (e) { /* none kept */ }
  return null;
})();
let railMoved = false;                                // stepped in or out: the rail drawn from its top
const sameAt = (x, y) => (!x && !y) || (!!x && !!y && x.g === y.g && x.f === y.f);
// where `at` is, as it is now: {g, f} (the gatherer, the folder or null), or null: gone
function railFind(at) {
  const g = at && state.home.gatherers.find((x) => x.name === at.g && !isHidden(x));
  if (!g) return null;
  if (at.f === null) return { g, f: null };
  const f = folderById(g.name, at.f);
  return f ? { g, f } : null;
}
function railGo(at) {
  railAt = at; railMoved = true;
  try { localStorage.setItem(RAIL_AT_KEY, JSON.stringify({ at: railAt })); } catch (e) { /* this page only */ }
  cardHide(); renderRail();
}
const railDrill = (at) => { if (!sameAt(at, railAt)) railGo(at); };
// one level up from where the rail is (`here`, as railFind finds it): a folder's, the folder it is in or its
// gatherer's top; a gatherer's top's, every gatherer
const railUp = ({ g, f }) => railGo(f ? { g: g.name, f: parentOf(g.name, f) } : null);
// A click on a gatherer's or a folder's name in the rail folds or opens it; the second of a double-click folds it back
// as it was, and the rail shows only it (railDrill)
const railNameClick = (fold, at) => (ev) => { cardHide(); fold(); if (ev.detail === 2) railDrill(at); };
// The rail drilled in (railAt): Up and Root, where it is (the path to it small over its name, its card hovered; the name
// a button folding or opening what is in it, as a folder's or gatherer's name does in the tree), then what is in it as
// the list has it -- a gatherer's top, its gatherer agent first; folded, its counts, and those of its actors open in a pane
function railHere(here, view) {
  const { g, f } = here, up = f ? parentOf(g.name, f) : null, crew = g.agents.find(isCoordinator);
  const open = f ? railOpen(g, f, view.busy) : !collapsed.has(g.name), name = f ? f.name : titleOf(g);
  const fold = f ? () => railFold(g, f, view.busy) : () => toggleGatherer(g.name);
  // the places above it, the gatherer first: a step each, a click showing only it
  const steps = [];
  if (f) {
    const seen = new Set();
    for (let k = up === null ? null : folderById(g.name, up); k && !seen.has(k.id); k = folderById(g.name, parentOf(g.name, k))) {
      seen.add(k.id); steps.unshift({ name: k.name, at: { g: g.name, f: k.id } });
    }
    steps.unshift({ name: titleOf(g), at: { g: g.name, f: null } });
  }
  return el("section", { class: "r-gatherer open r-drilled", "aria-label": f ? f.name : titleOf(g) },
    el("div", { class: "r-nav" },
      el("button", { class: "r-navb up", type: "button", title: f ? `Up: ${up === null ? titleOf(g) : folderById(g.name, up).name}` : "Up: every group",
        onclick: () => railUp(here) }, strokeIcon(ICONS.up, 13), el("span", { text: "Up" })),
      el("button", { class: "r-navb root", type: "button", title: "Root: every group", onclick: () => railGo(null) },
        strokeIcon(ICONS.home, 13), el("span", { text: "Root" }))),
    el("div", { class: "r-here" + (f ? " folder" : "") },
      steps.length ? el("div", { class: "r-path", role: "group", "aria-label": "Where it is" },
        ...steps.map((s) => dropOn(el("button", { class: "r-step", type: "button", title: `${s.name}: show only it`, onclick: () => railGo(s.at) },
          el("span", { class: "nm", text: s.name }), el("span", { class: "sep", "aria-hidden": "true", text: "›" })), g, s.at.f, () => {}))) : null,
      dropOn(el("button", { class: "r-hname", type: "button", "aria-expanded": open ? "true" : "false", "data-card": key(g.name, f ? `folder:${f.id}` : "gatherer:"),
        title: `${name}: ${open ? "fold it" : "open it"}`, onclick: () => { cardHide(); fold(); } },
        el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "nm" }, ...breakable(name))),
        g, f ? f.id : null, () => { if (!(f ? railOpen(g, f, view.busy) : !collapsed.has(g.name))) fold(); })),
    ...(open ? [!f && crew && !crewHidden.has(g.name) ? railActor(g, crew) : null, ...railBoxOr(g, f ? f.id : null, view)] : railHereFolded(g, f)));
}
function railHereFolded(g, f) {
  const counts = f ? tallyChips(folderTally(g, f.id), plural(folderTally(g, f.id).open, "actor")) : gathererCounts(g);
  const shown = f ? openIn(g, f.id) : g.agents.filter((a) => inPane(g, a));
  return [counts.length ? el("div", { class: "r-counts" }, ...counts) : null, ...shown.map((a) => railActor(g, a))];
}
// what is in it, or, all of it left out as the rail's foot says (railShow), that nothing open is
function railBoxOr(g, id, view) {
  const kids = railBox(g, id, view);
  return kids.length ? kids : [el("div", { class: "r-none", text: "Nothing open here" })];
}
// Over the rail, every gatherer's actors open (its gatherer agent left out, as a folder's counts leave it), counted by
// what they do -- waiting for the reader, stopped on an error, running (in the background too), finished and not yet
// seen, idle -- each a dot of its colour and a number, none for a state no actor is in. The whole home's, wherever the
// rail is drilled to, so what needs the reader elsewhere still shows.
function railTotals(shown) {
  const t = { asking: 0, error: 0, running: 0, background: 0, finished: 0, idle: 0 };
  for (const g of shown) for (const a of g.agents) {
    if (isCoordinator(a)) continue;
    const group = groupOf(g, a);
    if (group === "Waiting for you") t.asking++; else if (group === "Error") t.error++; else if (group === "Running") t.running++;
    else if (group === "Background") t.background++; else if (group === "Finished") t.finished++; else if (group === "Idle") t.idle++;
  }
  const chip = (k, cls, what) => k ? el("span", { class: `count ${cls}`, title: `${k} ${what}` }, el("i", { "aria-hidden": "true" }), String(k)) : null;
  const told = shown.reduce((n, g) => n + appsNotified(g), 0);
  const chips = [chip(t.asking, "asking", "waiting for you"), chip(t.error, "error", "stopped on an error"),
    chip(told, "notified", told === 1 ? "app with a notification you haven't seen" : "apps with a notification you haven't seen"),
    chip(t.running + t.background, "running", t.background ? `running (${t.background} in the background)` : "running"),
    chip(t.finished, "finished", "finished, not yet seen"), chip(t.idle, "idle", "idle")].filter(Boolean);
  return chips.length ? el("div", { class: "r-totals", role: "group", "aria-label": `Every group's actors: ${chips.map((c) => c.title).join(", ")}` },
    ...chips) : null;
}
// The rail shows only what the reader checks at its foot (RAIL_FOOT), over every gatherer and drilled in alike, kept in
// this browser, each unchecked at first: "folders" -- unchecked, only the folders with an actor not closed in them, at
// any depth (busyFolders); "saved", "closed" -- their lines (unchecked, none: only those of them open in a pane, in view).
const RAIL_SHOW_KEY = "ag-dashboard-rail-show";
const railShow = (() => {
  const v = { folders: false, saved: false, closed: false };
  try { const k = JSON.parse(localStorage.getItem(RAIL_SHOW_KEY)) || {}; for (const n of Object.keys(v)) v[n] = k[n] === true; } catch (e) { /* none kept */ }
  return v;
})();
function setRailShow(what, on) {
  railShow[what] = on;
  try { localStorage.setItem(RAIL_SHOW_KEY, JSON.stringify(railShow)); } catch (e) { /* this page only */ }
  renderRail();
}
// Its foot: "Show…", folded; hovered, in focus from the keys, or pressed (where there is no hovering), a box each for
// folders, saved and closed opens over the word, which stays where it is. Made once, and kept as the rail is drawn again
// above it (renderRail), so a redraw under the pointer does not fold it again; drawRailFoot ticks its boxes.
const RAIL_FOOT = (() => {
  const box = (what, says) => el("label", { class: "r-check", title: says },
    el("input", { type: "checkbox", "data-show": what, "aria-label": `Show ${what}`, onchange: (ev) => setRailShow(what, ev.target.checked) }),
    el("span", { text: what }));
  const foot = el("div", { class: "r-show", role: "group", "aria-label": "What the rail shows" },
    el("div", { class: "r-checks" },
      box("folders", "Every folder: unchecked, only those with an actor in them that is not closed"),
      box("saved", "The saved actors of each gatherer and folder, once closed: a line opening them"),
      box("closed", "The closed actors of each gatherer and folder: a line opening them")),
    el("button", { class: "r-show-hd", type: "button", "aria-expanded": "false", text: "Show…",
      title: "What else the rail shows: every folder, the saved actors, the closed ones",
      onclick: (ev) => ev.currentTarget.setAttribute("aria-expanded", String(foot.classList.toggle("open"))) }));
  return foot;
})();
function drawRailFoot() { for (const i of RAIL_FOOT.querySelectorAll("input[data-show]")) i.checked = railShow[i.dataset.show]; }
// An actor active, for the rail: any not closed, saved or not -- at work, waiting for the reader, stopped on an error,
// finished, idle. The ids of a gatherer's folders with one in them, at any depth (`busy`); and of those with one in them
// or one open in a pane (`kept`: the folder of a closed one shown stays in view, opened or not as the reader left it).
const railBusy = (g, a) => !["Saved", "Closed"].includes(groupOf(g, a));
function busyFolders(g) {
  const busy = new Set(), kept = new Set();
  const up = (a, ids) => { for (let f = folderById(g.name, folderOf(g.name, a)); f && !ids.has(f.id); f = folderById(g.name, f.parent)) ids.add(f.id); };
  for (const a of g.agents) {
    if (isCoordinator(a)) continue;
    if (railBusy(g, a)) { up(a, busy); up(a, kept); } else if (inPane(g, a)) up(a, kept);
  }
  return { busy, kept };
}
// A busy folder is open in the rail unless the reader folded it there (busyFolded, kept in this browser) -- forgotten once
// it is busy no more, so it opens again the next time; any other folder open or not as the list has it.
const BUSY_FOLDED_KEY = "ag-dashboard-rail-busy-folded";
const busyFolded = (() => {
  try { const v = JSON.parse(localStorage.getItem(BUSY_FOLDED_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
const keepBusyFolded = () => { try { localStorage.setItem(BUSY_FOLDED_KEY, JSON.stringify([...busyFolded])); } catch (e) { /* this page only */ } };
const railOpen = (g, f, busy) => busy.has(f.id) ? !busyFolded.has(folderKey(g.name, f.id)) : isOpenFolder(g.name, f.id);
function railFold(g, f, busy) {
  if (!busy.has(f.id)) return toggleFolder(g.name, f.id);
  const k = folderKey(g.name, f.id);
  if (busyFolded.has(k)) busyFolded.delete(k); else busyFolded.add(k);
  keepBusyFolded(); renderAgents();
}
// each shown gatherer's busy folders (busyFolders), by its name; those folded by the reader no longer busy, forgotten
function railBusyNow(shown) {
  const busy = new Map(shown.map((g) => [g.name, busyFolders(g)]));
  let gone = false;
  for (const k of busyFolded) {
    const [gname, id] = k.split("\u0000");
    if (!(busy.get(gname) || { busy: new Set() }).busy.has(Number(id))) { busyFolded.delete(k); gone = true; }
  }
  if (gone) keepBusyFolded();
  return busy;
}
function renderRail() {
  railTasksDrawn.clear();                            // each task's tile drawn once, where its first actor is (railRowsOf)
  const shown = state.home.gatherers.filter((g) => !isHidden(g));
  const list = el("div", { class: "r-actors" });
  const busy = railBusyNow(shown);
  // drilled in: there, or, it gone, its gatherer's top, or every gatherer
  const here = railAt ? railFind(railAt) || railFind({ g: railAt.g, f: null }) : null;
  // what each shows: its folders with an actor not closed in them, open; the rest, its saved and closed lines, as checked
  // -- every folder of the gatherer whose actors are dragged, to drop them in (railDragged)
  const view = (g) => ({ ...busy.get(g.name), only: !railShow.folders && !(listDrag && listDrag.g === g.name),
    saved: railShow.saved, closed: railShow.closed });
  // drilled in: where it is; else every gatherer, in the folders the reader keeps them in, if any (05-gatherer-folders.js)
  if (here) list.append(railHere(here, view(here.g)));
  else list.append(...railGfLevel(shown.filter((g) => !aloneShut(g)), null, (g) => railGatherer(g, view(g))),
    ...railAloneShut(shown.filter(aloneShut)));          // the actors on their own closed: in their lines (05-group-moves.js)
  if (!shown.length) list.append(el("div", { class: "r-none", text: state.home.gatherers.length ? "Every group is hidden" : "No groups" }));
  // its buttons -- open the list, settings, full screen -- the header's, in one row over it (01-layout.css); then the
  // totals of what every actor does (railTotals), then the tree, drawn again; then its foot, as it was (RAIL_FOOT)
  const rail = document.getElementById("rail"), was = rail.querySelector(".r-actors");
  const top = was ? was.scrollTop : 0, across = was ? was.scrollLeft : 0;
  for (const n of [...rail.children]) if (n !== RAIL_FOOT) n.remove();
  rail.prepend(...[railTotals(shown), list].filter(Boolean));
  if (!shown.length) RAIL_FOOT.remove();
  else { drawRailFoot(); if (RAIL_FOOT.parentNode !== rail) rail.append(RAIL_FOOT); }
  list.scrollTop = railMoved ? 0 : top; list.scrollLeft = railMoved ? 0 : across;   // drawn again where the reader had scrolled it
  railMoved = false;
  markDragged();                                     // drawn mid-drag: what is dragged, still shown as it
  if (hover.from === "rail") cardDraw();
}
// A gatherer in the rail: its name, a button folding it as the list does (a double-click: only it); folded, the counts
// the list shows for it, and its actors open in a pane; open, what is in it, under its name. `view`: as railBox's.
function railGatherer(g, view) {
  if (g.alone) return railAlone(g);                  // an actor on its own: its face alone (05-group-moves.js)
  const open = !collapsed.has(g.name), crew = g.agents.find(isCoordinator);
  const sec = el("section", { class: "r-gatherer" + (open ? " open" : ""), "aria-label": titleOf(g) },
    dropOn(el("button", { class: "r-gname", type: "button", "aria-expanded": open ? "true" : "false", "data-card": key(g.name, "gatherer:"),
      ...(HOVERS.matches ? {} : { title: `${titleOf(g)}${titleOf(g) !== g.name ? ` (${g.name})` : ""}: ${open ? "fold it" : "show its actors"} · double-click: only it` }),
      onclick: railNameClick(() => toggleGatherer(g.name), { g: g.name, f: null }) },
      el("span", { class: "tx" }, el("span", { class: "caret", text: "▶" }),
        el("span", { class: "nm", text: titleOf(g) }))), g, null, () => { if (collapsed.has(g.name)) toggleGatherer(g.name); }));
  if (!open) {                                      // folded: its counts, and those of its actors open in the panes
    const counts = gathererCounts(g);
    if (counts.length) sec.append(el("div", { class: "r-counts" }, ...counts));
    for (const a of g.agents) if (openActors().some((sel) => isAt(sel, g.name, a.channel))) sec.append(railActor(g, a));
  } else {
    // what is in it, in one box under its name (r-kids), set in: a tree, as the list's folders are, each folder's in its bracket
    sec.append(el("div", { class: "r-kids" }, crew && !crewHidden.has(g.name) ? railActor(g, crew) : null, ...railBox(g, null, view)));
  }
  return sec;
}
// An actor dragged from the rail (dragRow, startDrag): the rail drawn again with every folder of its gatherer -- those
// the foot's "folders" leaves out too, folded -- so it can be dropped in one (renderRail's view); as it was once the
// drag is over (endDrag, `revealed`). Drawn next, not now: the browser takes what is dragged's picture first.
function railDragged() {
  if (listMode !== "folded" || railShow.folders) return;
  setTimeout(() => {
    if (!listDrag || listMode !== "folded") return;
    listDrag.revealed = true;
    renderRail();
  }, 0);
}
// A gatherer's or a folder's box in the rail (`id` null: the gatherer's top), as the list's (boxRows) but its saved and
// closed folds first, at its top (its terminals: in the list only); then its folders -- each its name, or, opened, its
// name and what is in it set in under it -- then its actors open. `view`: its folders busy (busy: open unless the reader
// folded them, railOpen), those kept in view (kept: busy, or one in a pane), whether only those are shown (only), whether
// its saved and closed lines are (saved, closed). Its closed folders (shownClosed) are in its closed line, first, as the
// list has them (railClosed).
function railBox(g, id, view) {
  const lines = [], folders = [], open = [];
  for (const f of kidFolders(g.name, id)) {
    if (shownClosed(g, f)) continue;                                 // in its closed line
    if (view.only && !view.kept.has(f.id)) continue;                // all in it closed, none in a pane: left out
    const fold = () => railFold(g, f, view.busy);
    if (railOpen(g, f, view.busy)) {
      folders.push(el("div", { class: "r-fopen", role: "group", "aria-label": f.name },
        dropOn(el("button", { class: "r-fhead", type: "button", "aria-expanded": "true", "data-card": key(g.name, `folder:${f.id}`),
          title: `${f.name}: fold it · double-click: only it`, onclick: railNameClick(fold, { g: g.name, f: f.id }) },
          el("span", { class: "tx" }, el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "nm", text: f.name }))),
          g, f.id, () => {}),
        el("div", { class: "r-kids" }, ...railBox(g, f.id, view))));
    } else {
      folders.push(railFolded(g, f, fold, () => { if (!railOpen(g, f, view.busy)) fold(); }));
      for (const a of openIn(g, f.id)) folders.push(railActor(g, a));   // folded: those open in a pane, in view
    }
  }
  for (const [name, items] of boxGroups(g, id)) {
    if (name === SHELLS) continue;
    if (name === "Saved" || name === "Closed") {
      const k = boxKey(g.name, id), unfolded = foldOpen[name].has(k), what = name.toLowerCase();
      const kids = name === "Closed" ? closedKids(g, id) : [];
      const peek = () => [...kids.flatMap((f) => openIn(g, f.id)), ...items.filter((a) => inPane(g, a))].map((a) => railActor(g, a));
      if (!view[what]) { lines.push(...peek()); continue; }          // its line not shown: those open in a pane, in view
      lines.push(el("button", { class: "r-fold", type: "button", "aria-expanded": unfolded ? "true" : "false",
        title: `${unfolded ? "Hide" : "Show"} the ${what} ${kids.length ? "folders and actors" : "actors"}`, onclick: () => toggleFold(name, k) },
        `${unfolded ? "▾" : "▸"} ${name === "Closed" ? closedSays(g, id, items.length) : `${items.length} ${what}`}`));
      if (unfolded) lines.push(...kids.flatMap((f) => railClosed(g, f)), ...items.flatMap((a) => railRowsOf(g, a)));
      else lines.push(...peek());
      continue;
    }
    for (const a of items) open.push(...railRowsOf(g, a));
  }
  return [...lines, ...folders, ...open, ...railAppsIn(g, id)];
}
// A closed folder in the rail's closed line (shownClosed): its name, greyed, opening it in place to show all it holds --
// its folders, then its actors, the latest first -- or, folded, those of its actors open in a pane
function railClosed(g, f) {
  const fold = () => toggleFolder(g.name, f.id);
  if (!isOpenFolder(g.name, f.id))
    return [railFolded(g, f, fold, () => { if (!isOpenFolder(g.name, f.id)) fold(); }, true), ...openIn(g, f.id).map((a) => railActor(g, a))];
  const mine = g.agents.filter((a) => !isCoordinator(a) && folderOf(g.name, a) === f.id).sort((x, y) => (y.last || 0) - (x.last || 0));
  return [el("div", { class: "r-fopen closed", role: "group", "aria-label": `${f.name} (closed)` },
    dropOn(el("button", { class: "r-fhead", type: "button", "aria-expanded": "true", "data-card": key(g.name, `folder:${f.id}`),
      title: `${f.name}, closed: fold it · double-click: only it`, onclick: railNameClick(fold, { g: g.name, f: f.id }) },
      el("span", { class: "tx" }, el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "nm", text: f.name }))),
      g, f.id, () => {}),
    el("div", { class: "r-kids" }, ...kidFolders(g.name, f.id).flatMap((k) => railClosed(g, k)), ...mine.map((a) => railActor(g, a))))];
}
// A folded folder in the rail, as a folded gatherer is: its name -- a button opening it in place -- with how many actors
// it holds open, and under it how many of those wait on the reader, stopped on an error, run (its folders' too). An actor
// dropped on its name goes in it; held over it, it opens (`spring`).
function railFolded(g, f, fold, spring, closed = false) {
  const t = folderTally(g, f.id), counts = closed ? [] : tallyChips(t, plural(t.open, "actor"));
  return el("div", { class: "r-ffold" + (closed ? " closed" : "") },
    dropOn(el("button", { class: "r-fname", type: "button", "aria-expanded": "false", "data-card": key(g.name, `folder:${f.id}`),
      "aria-label": `${f.name}, a folder: ${plural(t.open, "actor")} open`, ...(HOVERS.matches ? {} : { title: folderSays(f, t) }),
      onclick: railNameClick(fold, { g: g.name, f: f.id }) },
      el("span", { class: "tx" }, el("span", { class: "caret", "aria-hidden": "true", text: "▶" }),
        el("span", { class: "nm", text: f.name }))), g, f.id, spring),
    counts.length ? el("div", { class: "r-counts" }, ...counts) : null);
}
// A name in a narrow column, broken after its _, - or . where it must break: "making_" over "ag", not "making_a" over "g".
const breakable = (text) => String(text).split(/(?<=[_\-.])/).flatMap((part, i) => i ? [el("wbr"), part] : [part]);
// What the rail writes under an actor's avatar, and its card at its top: its name, else what it was last asked (a message
// from another actor, as the list says it), else that it has had none.
function railName(a) {
  if (a.name && a.name.text) return { text: a.name.text, cls: "" };
  const env = envelope(a.last_user_message), asked = env ? crewLine(env) : a.last_user_message;
  if (asked) return { text: firstLine(asked, 160), cls: "unnamed" };
  return { text: isCoordinator(a) ? "Coordinator agent" : "No message yet", cls: "none" };
}
// A TASK in the rail (05-agent-list.js's TASKS): one tile where its first actor comes, as an actor's -- its actors'
// faces grouped in the room of one avatar (two side by side, more in a square of four), its lead's state at its corner,
// its name under it, and its row's bookmark and × (taskSaveButton, taskCloseButton) left of its faces, where an actor's
// are -- pressed, opened (openTask); hovered, its card.
const railTasksDrawn = new Set();
// the mark of an actor's or a task's apps in the rail: small, at its avatar's top right corner, outside it -- its first
// app's, one of a kind (two Browsers, one mark), the status dot at the corner under it left clear
const railApps = (list) => list.length ? el("span", { class: "r-apps", title: [...new Set(list.map((o) => o.app.label))].join(", ") }, appMarkOf(list[0])) : null;
function railRowsOf(g, a) {
  const id = taskOf(g.name, a);
  return id === null ? [railActor(g, a)] : railTaskOnce(g, id);
}
function railTaskOnce(g, id) {
  const k = `${g.name}\u0000${id}`;
  if (railTasksDrawn.has(k)) return [];
  railTasksDrawn.add(k);
  return [railTask(g, taskById(g.name, id))];
}
// the apps of a box in the rail, after its actors (as the list's appRowsIn): each in no task its own tile, and each task
// of apps only
function railAppsIn(g, id) {
  const out = [];
  for (const o of gathererApps(g.name)) {
    if (appFolder(g.name, o.id) !== id) continue;
    const t = appTaskOf(g.name, o.id);
    if (t === null) out.push(railApp(g, o));
    else if (!taskMembers(g, t).length) out.push(...railTaskOnce(g, t));
  }
  return out;
}
function railTask(g, t) {
  const all = taskMembers(g, t.id), apps = taskApps(g, t.id), lead = taskLead(g, t.id), open = taskActors(g, t.id);
  const faces = [...(open.length ? open : all).map(plainFace), ...(all.length ? [] : apps.map(appFace))].slice(0, 4);
  const [cls, label] = taskStatus(g, t.id), name = taskName(g, t);
  const current = selectedTask() === `${g.name}\u0000t${t.id}`;
  const inPane = !current && (all.some((a) => openActors().some((s) => isAt(s, g.name, a.channel)))
    || apps.some((o) => panes.apps.some((p) => !p.held && p.instance.id === o.id)));
  const what = [all.length ? plural(all.length, "actor") : null, apps.length ? plural(apps.length, "app") : null].filter(Boolean).join(", ");
  const first = lead ? lead.channel : apps.length ? appItem(apps[0].id) : null;
  const tile = el("button", { class: "r-actor r-task", type: "button", "data-card": key(g.name, `task:${t.id}`), "aria-current": current ? "true" : "false",
    ...(inPane ? { "data-open": "true" } : {}), "aria-label": `${name}, a task of ${what || "nothing"}, in ${titleOf(g)}: ${label}`,
    ...(HOVERS.matches ? {} : { title: `${name}\n${what} · ${label} · ${titleOf(g)}` }),
    onclick: (ev) => { cardHide(ev); openTask(g.name, t.id, null, ev); } },
  el("span", { class: "r-pic" }, el("span", { class: `logo r-group n${faces.length}` }, ...faces),
    lead || cls === "notified" ? el("i", { class: `rd ${cls}`, "aria-hidden": "true", style: `--spin-at: -${Date.now() % 1200}ms` }) : null,
    all.length ? railApps(apps) : null),
  el("span", { class: "r-name", "aria-hidden": "true", text: name }),
  taskSaveButton(g, t), taskCloseButton(g, t));
  return first ? dropOnItem(dragItems(tile, g, () => taskItems(g, t.id)), g, first) : tile;   // dragged: all in it
}
// An app in no task, in the rail: its mark where an actor's face is, what it shows under it, its × (closeApp) where an
// actor's is -- pressed, selected
function railApp(g, o) {
  const chosen = appSelected() === o.id, shown = !chosen && panes.apps.some((p) => !p.held && p.instance.id === o.id), k = appItem(o.id);
  const told = appStatusOf(g.name, o.id);
  const tile = el("button", { class: "r-actor r-app", type: "button", "aria-current": chosen ? "true" : "false", "data-key": `${g.name}/${k}`,
    ...(shown ? { "data-open": "true" } : {}), "data-card": appKey(g.name, o.id),
    "aria-label": `${appTitle(o)}, an app, in ${titleOf(g)}${told ? `: ${told[1]}` : ""}`,
    ...(HOVERS.matches ? {} : { title: `${appTitle(o)} · ${titleOf(g)}` }), onclick: (ev) => { cardHide(ev); selectApp(g.name, o, ev); } },
  el("span", { class: "r-pic" }, appFace(o), told ? el("i", { class: `rd ${told[0]}`, "aria-hidden": "true" }) : null),
  el("span", { class: "r-name", "aria-hidden": "true", text: o.title || o.app.label }),
  SNAPSHOT ? null : rowButton("close-btn", { title: `Close ${o.app.label}: the app closed`, "aria-label": `Close ${o.app.label}` },
    () => closeApp(g.name, o), closeIcon()));
  return dropOnItem(dragItems(tile, g, () => [k]), g, k);
}
function railActor(g, a) {
  const [cls, label] = statusOf(a);
  const current = !appSelected() && isAt(focusedActor(), g.name, a.channel);   // an app selected: it is, not the actor
  const open = !current && openActors().some((sel) => isAt(sel, g.name, a.channel));
  const nm = railName(a);
  return dragRow(el("button", { class: "r-actor" + (picked(g, a) ? " picked" : ""), type: "button", "data-card": key(g.name, a.channel),
    "aria-current": current ? "true" : "false",
    ...(open ? { "data-open": "true" } : {}), "aria-label": `${nm.text}, in ${titleOf(g)}: ${label}`,
    // where there is no hovering (a touch screen), the card's words as its title
    ...(HOVERS.matches ? {} : { title: `${nm.text}\n${label} · ${ago(a.last)} · ${titleOf(g)}` }),
    onclick: (ev) => {
      cardHide(ev);
      if (ev.shiftKey && !SNAPSHOT && !isCoordinator(a)) { ev.preventDefault(); togglePick(g, a); return; }
      pick(g.name, a.channel, ev);
    }, oncontextmenu: (ev) => pickBeside(g.name, a.channel, ev) },
    el("span", { class: "r-pic" }, pickMark(g, a, plainFace(a)), el("i", { class: `rd ${cls}`, "aria-hidden": "true", style: `--spin-at: -${Date.now() % 1200}ms` })),
    el("span", { class: "r-name" + (nm.cls === "none" ? " none" : ""), "aria-hidden": "true", text: nm.text }),
    // the list's bookmark and × (saveButton, closeButton), in the corners over its avatar: shown while hovered, in focus or
    // the one shown (a saved one's bookmark always, filled)
    saveButton(g, a), closeButton(g, a)), g, a);
}
// The card an actor shows while hovered, in the rail or the list (or in focus from the keys): its avatar and name, its
// gatherer and harness, its directory, its status, when it last did something and its size, what it was last asked
// (under its name, if it has one), its recap, what runs in the background, its branch. Beside the rail or the list (under
// the actor, where there is no room beside: the rail across a phone's top, the list as wide as the page), level with the
// actor, inside the window; the pointer passes through it (but a live card's: cardLive). It waits a moment the first
// time (HOVER_WAIT), then follows
// the pointer from actor to actor at once; none over an actor's own buttons, which say what they do. Kept by where it
// came from and the actor's key (data-card): the rail or the list drawn again under it, the card is said again from the
// new data, at the actor's new place. Where there is no hovering (a touch screen), the actor's title says it instead.
const HOVERS = matchMedia("(hover: hover)");
const HOVER_WAIT = 250, hover = { from: null, key: null, shown: false, timer: null, node: null, keys: false, still: null };
const HOVER_FROM = { rail: () => listMode === "folded", agents: () => listMode === "list" };
function hoverTo(from, k) {
  clearTimeout(hover.timer);
  if (!k) { hover.timer = setTimeout(cardLetGo, cardLive() ? 300 : 120); return; }
  if (k === hover.key && from === hover.from && hover.shown) return;
  const go = () => { hover.from = from; hover.key = k; hover.shown = true; cardDraw(); };
  // a live card shown: the pointer, on its way to it, may cross another item -- switched only once it lingers there
  // (CARD_ON_THE_WAY), the card's own pointerenter keeping it
  if (hover.shown && cardLive()) hover.timer = setTimeout(go, CARD_ON_THE_WAY);
  else if (hover.shown) go(); else hover.timer = setTimeout(go, HOVER_WAIT);
}
const CARD_ON_THE_WAY = 250;
// `ev`, the click that put it away: no card again until the pointer moves from where that was (`still`) -- the list
// drawn again under a pointer at rest is a pointerover there, which would bring a task's live card back over the panels
// the click opened, for as long as the pointer rests
function cardHide(ev = null) {
  clearTimeout(hover.timer);
  if (ev && "clientX" in ev) hover.still = [ev.clientX, ev.clientY];
  hover.from = null; hover.key = null; hover.shown = false;
  cardEdit = null; cardInput = null;
  if (folderClosing && folderClosing.from === "card") folderClosing = null;
  if (hover.node) hover.node.hidden = true;
}
// A LIVE card -- a folder's or a gatherer's, in the rail -- is one to use, not only read: the pointer may go onto it,
// and it stays while the pointer, a menu opened from it, or its name box is on it, or something starts (cardLetGo); its buttons do what the
// list's do on the folder's line or the gatherer's row, its name box names there (cardEdit), and a click on one of its
// actors shows it.
const cardLive = () => !!hover.node && !hover.node.hidden && hover.node.classList.contains("live");
function cardLetGo() {
  const card = hover.node;
  if (cardLive() && state.starting) { hover.timer = setTimeout(cardLetGo, 300); return; }   // what it started: its answer, first
  if (cardLive() && (card.matches(":hover") || ((cardEdit || folderClosing) && card.contains(document.activeElement))
    || (rowPop.el && card.contains(popButton())))) return;
  cardHide();
}
// a menu opened from the card closed: the card let go of too, once the pointer is not on it
function cardRelease() { if (cardLive() && !hover.node.matches(":hover")) hoverTo(hover.from, null); }
function cardDraw() {
  const box = hover.from && document.getElementById(hover.from);
  const at = box && [...box.querySelectorAll("[data-card]")].find((n) => n.dataset.card === hover.key);
  const [gname, channel] = (hover.key || "").split("\u0000");
  const g = state.home && state.home.gatherers.find((x) => x.name === gname), a = g && g.agents.find((x) => x.channel === channel);
  const f = g && !a && /^folder:\d+$/.test(channel || "") ? folderById(g.name, Number(channel.slice(7))) : null;
  const t = g && !a && /^task:\d+$/.test(channel || "") ? taskById(g.name, Number(channel.slice(5))) : null;
  const o = g && !a && isAppItem(channel) ? appInfo(g.name, channel.slice(APP_ITEM.length)) : null;
  const top = !!g && !a && channel === "gatherer:";
  if (!at || !(a || f || t || o || top) || !HOVER_FROM[hover.from]()) { cardHide(); return; }
  if (!hover.node) {
    hover.node = el("div", { class: "actor-card floats", id: "actor-card", role: "tooltip" });   // (floats: over a native page, it covers it -- apps/native.ts)
    hover.node.addEventListener("pointerenter", () => clearTimeout(hover.timer));
    hover.node.addEventListener("pointerleave", () => { if (cardLive()) hoverTo(hover.from, null); });
    document.body.append(hover.node);
  }
  // a task's: in the list too -- but one shown by the keys (a row in focus) only read, the pointer passing through it: its
  // buttons are the pointer's, and one put over the panels (focus given back to the row, Esc closing a menu) would take
  // the next click meant for what is under it
  const card = hover.node, live = !SNAPSHOT && !hover.keys && (!!t || !!o || (hover.from === "rail" && (!!f || top)));
  card.classList.toggle("live", live);
  card.setAttribute("role", live ? "group" : "tooltip");
  if (live) card.setAttribute("aria-label", t ? `The task ${taskName(g, t)}` : o ? `The app ${appTitle(o)}` : f ? `The folder ${f.name}` : `The group ${titleOf(g)}`);
  else card.removeAttribute("aria-label");
  const typing = cardInput && document.activeElement === cardInput && [cardInput.selectionStart, cardInput.selectionEnd];
  cardMoving = true;                                 // its name box taken out and put back: not a blur that ends it
  card.replaceChildren(...(t ? taskCard(g, t) : o ? appCard(g, o) : f ? folderCard(g, f, live) : top ? gathererCard(g)
    : actorCard(g, a, hover.from === "agents" && isAt(focusedActor(), g.name, a.channel))));
  cardMoving = false;
  if (typing && cardInput && cardInput.isConnected) { cardInput.focus({ preventScroll: true }); cardInput.setSelectionRange(...typing); }
  if (folderClosing && folderClosing.from === "card") askRefocus();   // its question's button, drawn anew
  card.hidden = false;
  at.setAttribute("aria-describedby", "actor-card");
  const r = at.getBoundingClientRect(), side = box.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  if (side.width > side.height || side.right + 8 + w > innerWidth) {      // no room beside it: under the actor
    card.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
    card.style.top = `${clamp(hover.from === "rail" ? side.bottom + 6 : r.bottom + 4, 8, innerHeight - h - 8)}px`;
  } else {
    card.style.left = `${side.right + 8}px`;
    card.style.top = `${clamp(r.top + r.height / 2 - h / 2, 8, innerHeight - h - 8)}px`;
  }
}
// a path's end, where it tells one actor's from another's: its worktree, its project
const tail = (t, n) => t.length > n ? "…" + t.slice(-(n - 1)) : t;
// `shown`: the one shown, in the list, whose name is renamed by double-clicking it -- said at its foot
// An actor's status in a card's row: its dot alone, at the row's end where its word was -- the word its title, and what
// a screen reader says
function rowStatus(cls, label) {
  return el("span", { class: `status ${cls}`, role: "img", "aria-label": label, title: label }, el("i", { "aria-hidden": "true" }));
}
function actorCard(g, a, shown = false) {
  const [cls, label] = statusOf(a), nm = railName(a), size = a.real_tokens ?? a.sent_tokens;
  const env = envelope(a.last_user_message), asked = env ? crewLine(env) : a.last_user_message;
  const bg = a.background || [], dir = cwdOf(a);
  const hint = [SNAPSHOT ? "Click to show it" : `Click to show it · ${BESIDE_KEY}+click: beside the one shown`];
  if (shown && !SNAPSHOT) hint.splice(0, 1, `${nameNote(g, a).trim() ? `${nameNote(g, a).trim()} · ` : ""}Double-click its name (or F2) to ${a.name && a.name.text ? "rename" : "name"} it`);
  return [
    el("div", { class: "c-who" }, plainFace(a),
      el("div", { class: "tx" }, el("div", { class: "c-nm" + (nm.cls ? ` ${nm.cls}` : ""), text: nm.text }),
        el("div", { class: "c-sub", text: `${titleOf(g)} · ${harnessName(a.harness)}` }))),
    dir ? el("div", { class: "c-dir", title: dir, text: tail(tildePath(dir, state.home.home_dir), 44) }) : null,
    el("div", { class: "c-st" }, el("span", { class: `status ${cls}` }, el("i", { "aria-hidden": "true" }), label),
      el("span", { text: [ago(a.last), size !== null && size !== undefined ? `${compact(size)} tokens` : null].filter(Boolean).join(" · ") }),
      // saved: said here, the rail's bookmark showing only while hovered
      !isCoordinator(a) && savedAs(g.name, a) ? el("span", { class: "c-saved" }, saveIcon(true), "Saved") : null),
    asked && nm.cls !== "unnamed" ? el("div", { class: "c-asked" }, el("span", { class: "lbl", text: "Asked" }), firstLine(asked, 400)) : null,
    a.recap && a.recap.text ? el("div", { class: "c-recap" }, el("span", { class: "lbl", text: "Recap" }), a.recap.text) : null,
    bg.length ? el("div", { class: "c-bg", text: `${bg.length} in background · ${bg.map((t) => t.label || t.id).join(", ")}` }) : null,
    branchChip(g, a),
    el("div", { class: "c-hint", text: hint.join(" · ") }),
  ].filter(Boolean);
}
// A task's card (05-agent-list.js's TASKS), live in the list and the rail: its name, its gatherer and what it holds, "+"
// (an agent or an app added) and its pencil (it renamed, its name box under them while it is), then its items -- its actors, the lead first, as its row has them, each shown by a click
// (⌘/Ctrl: beside the one shown); then its apps, each selected by a click (05-agent-list.js's selectApp) -- each with its
// own close (closeApp: the app closed for good, as its row's × does) and a mark taking it out of the task (takeOut).
function taskCard(g, t) {
  const rank = (a) => LEAD_RANK[groupOf(g, a)] ?? 9;
  const all = taskMembers(g, t.id).sort((x, y) => rank(x) - rank(y) || (y.last || 0) - (x.last || 0)), lead = taskLead(g, t.id), apps = taskApps(g, t.id);
  const first = lead ? lead.channel : apps.length ? appItem(apps[0].id) : null, name = taskName(g, t);
  const add = first ? addButton(g, first, "Add an agent or an app") : null;
  const what = [all.length ? plural(all.length, "actor") : null, apps.length ? plural(apps.length, "app") : null].filter(Boolean).join(", ");
  return [
    el("div", { class: "c-who" }, el("span", { class: "t-faces" }, ...taskFaces(g, t.id)),
      el("div", { class: "tx" }, el("div", { class: "c-nm", text: name }),
        el("div", { class: "c-sub", text: `${titleOf(g)} · ${what || "nothing"}` }))),
    SNAPSHOT ? null : el("div", { class: "c-acts" }, add,
      cardAct("rename", `${t.name ? "Rename" : "Name"} the task`, strokeIcon(ICONS.pencil, 13), () => editInCard({ g: g.name, item: `${TASK_ITEM}${t.id}` }))),
    SNAPSHOT ? null : cardEditBox(g.name),
    el("div", { class: "c-tree" }, ...all.map((a) => {
      const [cls, label] = statusOf(a);
      return el("div", { class: "c-task-row" },
        el("button", { class: "c-row", type: "button", title: `Show it · ${BESIDE_KEY}+click: beside the one shown`,
          onclick: (ev) => { cardHide(); pick(g.name, a.channel, ev); } },
        plainFace(a), el("span", { class: "nm", text: actorTitle(a) }), rowStatus(cls, label)),
        // its own bookmark and close, as its row's; then out of the task (its own mark: not a close)
        saveButton(g, a), closeButton(g, a),
        el("button", { class: "act take-out", type: "button", title: "Take it out of the task: an actor on its own again, detached from the task's apps",
          "aria-label": `Take ${actorTitle(a)} out of the task`, onclick: (ev) => { ev.stopPropagation(); takeOut(g.name, a.channel); } },
        strokeIcon(ICONS.takeOut, 13)));
    }), ...apps.map((o) => el("div", { class: "c-task-row c-app-row" },
      el("button", { class: "c-row", type: "button", title: `${o.app.label}: select it, its panel above the panes`,
        onclick: (ev) => { cardHide(ev); selectApp(g.name, o, ev); } },
      appMarkOf(o), el("span", { class: "nm", text: o.name || o.app.label }), el("span", { class: "st", text: o.title || "" })),
      SNAPSHOT ? null : rowButton("close-btn", { title: `Close ${o.app.label}: the app closed, and out of the task`, "aria-label": `Close ${o.app.label}` },
        () => closeApp(g.name, o), closeIcon()),
      el("button", { class: "act take-out", type: "button", title: `Take it out of the task: an app on its own again, the task's agents detached from it`,
        "aria-label": `Take ${o.app.label} out of the task`, onclick: (ev) => { ev.stopPropagation(); takeOut(g.name, appItem(o.id)); } },
      strokeIcon(ICONS.takeOut, 13))))),
    ...apps.map((o) => noticeList(g, o, apps.length > 1)),
    el("div", { class: "c-hint", text: "Click the task to open it: its apps above, its actors side by side · drag an actor or an app onto it to put it in · double-click its name in the list to rename it" }),
  ].filter(Boolean);
}
// An app's card (an app in no task: its row, its tile in the rail), live: what it is and shows -- the user's name for it
// over them -- its pencil (it renamed, its name box under it while it is) and its × (closeApp), its notifications
function appCard(g, o) {
  return [
    el("div", { class: "c-who" }, appFace(o),
      el("div", { class: "tx" }, el("div", { class: "c-nm", text: appShown(o) }),
        el("div", { class: "c-sub", text: [titleOf(g), o.app.label, o.name ? o.title : null, o.folder].filter(Boolean).join(" · ") }))),
    SNAPSHOT ? null : el("div", { class: "c-acts" },
      cardAct("rename", `${o.name ? "Rename" : "Name"} ${o.app.label}`, strokeIcon(ICONS.pencil, 13), () => editInCard({ g: g.name, item: appItem(o.id) })),
      cardAct("close", `Close ${o.app.label}: the app closed`, closeIcon(), () => { cardHide(); closeApp(g.name, o); })),
    SNAPSHOT ? null : cardEditBox(g.name),
    noticeList(g, o) || el("div", { class: "c-st", text: "No notifications" }),
    el("div", { class: "c-hint", text: "Click to show its panel · drag it onto an actor or a task to put it there · double-click its name in the list or its panel to rename it" }),
  ].filter(Boolean);
}
// AN APP'S NOTIFICATIONS in a card: the newest first (NOTICES_SHOWN), each opening the app where it says (openNotice:
// 07-notices.js) by a click, dismissed by its × -- those the reader has not seen marked; none, nothing. `named`: the app's
// name over them (a task's card, with apps of more than one)
const NOTICES_SHOWN = 5;
function noticeList(g, o, named = false) {
  const list = appNotices(g.name, o.id);
  if (!list.length) return null;
  const since = seen.at[appKey(g.name, o.id)] || 0;
  return el("div", { class: "c-notices", role: "list", "aria-label": `${o.app.label}'s notifications` },
    named ? el("div", { class: "c-nhead", text: appTitle(o) }) : null,
    ...list.slice(0, NOTICES_SHOWN).map((n) => el("div", { class: "c-notice" + ((n.at || 0) > since ? " new" : ""), role: "listitem" },
      el("button", { class: "c-row", type: "button", title: `Open ${o.app.label} there`,
        onclick: (ev) => { cardHide(ev); openNotice(g.name, o.id, n); } },
      el("span", { class: "status notified" }, el("i", { "aria-hidden": "true" })),
      el("span", { class: "nm" }, el("b", { text: n.title }), n.text ? el("span", { class: "nt", text: n.text }) : null),
      el("span", { class: "st", text: n.at ? ago(n.at) : "" })),
      el("button", { class: "act take-out", type: "button", title: "Dismiss it", "aria-label": `Dismiss ${n.title}`,
        onclick: (ev) => { ev.stopPropagation(); dismissNotice(g.name, o.id, n); } }, closeIcon()))),
    list.length > NOTICES_SHOWN ? el("div", { class: "c-st", text: `and ${list.length - NOTICES_SHOWN} more` }) : null);
}
// A folder's card: its name and where it is, then what is in it as a tree, its first level shown (cardTree). Live (in
// the rail): its buttons first, as its line's in the list -- "+ actor", "+ ⋯", a new folder in it, rename, delete, close
// (a closed one's: rename, delete, reopen) -- its name box under them while one is named, the question its × asks first
// (closeAsk), a folder in the tree opened in place by a click (`cardOpen`, for as long as
// the card shows this folder), an actor shown by one (⌘/Ctrl: beside the one shown), and its foot a button opening the
// folder in the rail.
let cardOpen = { key: null, ids: new Set() };
function folderCard(g, f, live = false) {
  if (cardOpen.key !== hover.key) cardOpen = { key: hover.key, ids: new Set() };   // another card: its tree as it starts
  const up = parentOf(g.name, f), rows = cardTree(g, f.id, 0, live), closed = shownClosed(g, f);
  const rename = cardAct("rename", `Rename ${f.name}`, strokeIcon(ICONS.pencil, 13), () => editInCard({ g: g.name, id: f.id, parent: up }));
  const del = cardAct("delete", `Delete ${f.name}: what is in it moves up a level`, strokeIcon(ICONS.bin, 14), () => { cardHide(); deleteFolder(g.name, f.id); });
  const asking = live && folderClosing && folderClosing.from === "card" && folderClosing.g === g.name && folderClosing.id === f.id;
  return [
    el("div", { class: "c-who" }, el("span", { class: "c-folder" }, strokeIcon(ICONS.folder, 18)),
      el("div", { class: "tx" }, el("div", { class: "c-nm", text: f.name }),
        el("div", { class: "c-sub", text: [titleOf(g), up === null ? null : folderPath(g.name, up), closed ? "closed" : null].filter(Boolean).join(" / ") }))),
    live ? el("div", { class: "c-acts" }, ...(closed ? [rename, del,
      cardAct("reopen", `Reopen ${f.name}: back with the open folders, its actors still closed`, strokeIcon(ICONS.folderOpen, 14), () => reopenFolder(g.name, f.id))]
      : [...cardStarts(g, f),
        cardAct("new", `New folder in ${f.name}`, strokeIcon(ICONS.folderNew, 14), () => editInCard({ g: g.name, id: null, parent: f.id })),
        rename, del,
        cardAct("close", `Close ${f.name}: every actor in it closed, and it put in the closed line`, closeIcon(), () => pressClose(g, f, "card"))])) : null,
    asking ? closeAsk(g, f) : null,
    live ? cardEditBox(g.name) : null,
    rows.length ? el("div", { class: "c-tree" }, ...rows) : el("div", { class: "c-st", text: "Empty" }),
    // in the rail: opened there, or, the rail drilled into it, nothing to open
    live ? (sameAt(railAt, { g: g.name, f: f.id }) ? null : el("button", { class: "c-more", type: "button",
      onclick: () => { cardHide(); showFolder(g.name, f.id, true); renderAgents(); } }, "Open it in the rail ›"))
      : el("div", { class: "c-hint", text: "Click to open or fold it" }),
    live && !sameAt(railAt, { g: g.name, f: f.id }) ? el("button", { class: "c-more only", type: "button", onclick: () => railDrill({ g: g.name, f: f.id }) },
      "Show only it ›") : null,
  ].filter(Boolean);
}
// What is in folder `id`, as the list has it (boxGroups), `depth` in: its folders, each with how many actors it holds open
// (its own folders' too) -- opened, what is in it under it -- then its actors open, then how many of its actors are
// saved and closed. Live, a folder's row a button opening or folding it, an actor's one showing it.
function cardTree(g, id, depth, live) {
  const out = [], pad = { style: `--depth: ${depth}` };
  for (const k of kidFolders(g.name, id)) {
    if (shownClosed(g, k)) continue;                                 // said with the closed ones

    const open = live && cardOpen.ids.has(k.id), n = folderTally(g, k.id).open;
    const parts = [el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "g" }, strokeIcon(open ? ICONS.folderOpen : ICONS.folder, 14)),
      el("span", { class: "nm", text: k.name }), el("span", { class: "st", text: n ? String(n) : "" })];
    out.push(live ? el("button", { class: "c-row c-frow", type: "button", "aria-expanded": open ? "true" : "false", ...pad,
      title: `${open ? "Fold" : "Open"} ${k.name}`, onclick: (ev) => {
        ev.stopPropagation();
        if (open) cardOpen.ids.delete(k.id); else cardOpen.ids.add(k.id);
        cardDraw();
      } }, ...parts) : el("div", { class: "c-row c-frow", ...pad }, ...parts));
    if (open) out.push(...cardTree(g, k.id, depth + 1, live));
  }
  const groups = new Map(boxGroups(g, id));
  for (const a of groups.get(OPEN) || []) {
    const [cls, label] = statusOf(a);
    const parts = [actorLogo(a), el("span", { class: "nm", text: railName(a).text }), rowStatus(cls, label)];
    out.push(live ? el("button", { class: "c-row", type: "button", ...pad, title: `Show it · ${BESIDE_KEY}+click: beside the one shown`,
      onclick: (ev) => { cardHide(); pick(g.name, a.channel, ev); } }, ...parts) : el("div", { class: "c-row", ...pad }, ...parts));
  }
  const rest = [(groups.get("Saved") || []).length ? `${groups.get("Saved").length} saved` : null,
    groups.has("Closed") ? closedSays(g, id, groups.get("Closed").length) : null].filter(Boolean);
  if (rest.length) out.push(el("div", { class: "c-rest", ...pad, text: rest.join(" · ") }));
  return out;
}
// A gatherer's card, in the rail: its name, how many actors it holds open and how many folders, and its buttons, as its
// row's in the list -- "+ actor", "+ ⋯", a new folder, rename, hide -- its name box under them while one is named.
function gathererCard(g) {
  const open = g.agents.filter((a) => !isCoordinator(a) && !["Saved", "Closed"].includes(groupOf(g, a))).length;
  const folders = treeOf(g.name).folders.length, counts = gathererCounts(g);
  return [
    el("div", { class: "c-who" }, el("span", { class: "c-folder" }, strokeIcon(ICONS.folder, 18)),
      el("div", { class: "tx" }, el("div", { class: "c-nm", text: titleOf(g) }),
        el("div", { class: "c-sub", text: [`${plural(open, "actor")} open`, folders ? plural(folders, "folder") : null].filter(Boolean).join(" · ") }))),
    counts.length ? el("div", { class: "c-counts" }, ...counts) : null,
    el("div", { class: "c-acts" }, ...cardStarts(g, null),
      cardAct("newfolder", `New folder in ${titleOf(g)}`, strokeIcon(ICONS.folderNew, 14), () => editInCard({ g: g.name, id: null, parent: null })),
      cardAct("rename", `Rename ${titleOf(g)}`, strokeIcon(ICONS.pencil, 13), () => editInCard({ g: g.name, gatherer: true })),
      cardAct("hide", `Hide ${g.name}`, hideIcon(), () => { cardHide(); setHidden(g, true); })),
    cardEditBox(g.name),
    sameAt(railAt, { g: g.name, f: null }) ? null : el("button", { class: "c-more only", type: "button", onclick: () => railDrill({ g: g.name, f: null }) },
      "Show only it ›"),
    el("div", { class: "c-hint", text: `Click its name to ${collapsed.has(g.name) ? "show" : "fold"} its actors · double-click: only it` }),
  ].filter(Boolean);
}
// A card's "+ actor" and "+ ⋯", started in its folder (`f`; null: its gatherer's top): the rail's own (railNew, railMore)
// -- the directory asked in a box beside them, if none is known or starting there fails, the list being folded away
const cardStarts = (g, f) => [railNew(g, f, "act start new-actor"), railMore(g, f, "act start new-more")].filter(Boolean);
const cardAct = (cls, title, icon, fn) => el("button", { class: `act ${cls}`, type: "button", title, "aria-label": title,
  onclick: (ev) => { ev.stopPropagation(); fn(); } }, icon);
// The card's name box: a folder named or made (`cardEdit`: {g, id -- null, made in `parent` -- parent}), the gatherer
// renamed ({g, gatherer: true}), or a task or an app ({g, item}: 05-agent-list.js's itemNamed), as the list's own box does, which is out of sight with the list folded. One element for
// as long as it is open (`cardInput`), put back in each redraw of the card (`cardMoving`), its caret kept. Enter, or
// leaving it, keeps what is typed; Esc, or nothing typed, leaves it.
let cardEdit = null, cardInput = null, cardMoving = false;
function editInCard(edit) {
  const g = state.home.gatherers.find((x) => x.name === edit.g);
  const item = edit.item && g ? itemNamed(g, edit.item) : null;
  if (edit.item && !item) return;
  cardEdit = { ...edit, key: hover.key, ...(item ? { kind: item[0], auto: item[3] } : {}),
    value: item ? item[2] : edit.gatherer ? (g ? titleOf(g) : edit.g) : edit.id !== null && edit.id !== undefined ? (folderById(edit.g, edit.id) || {}).name || "" : "" };
  cardInput = null;
  cardDraw();
  if (cardInput) { cardInput.focus(); cardInput.select(); }
}
function cardEditBox(gname) {
  const e = cardEdit;
  if (!e || e.g !== gname || e.key !== hover.key) return null;   // the card it was opened in only
  if (!cardInput) {
    cardInput = el("input", { class: "name-box c-box", type: "text", maxlength: String(e.gatherer || e.kind ? 120 : FOLDER_CHARS), spellcheck: "false",
      autocomplete: "off", placeholder: e.kind ? e.auto : e.gatherer ? gname : "Folder name",
      "aria-label": e.kind ? `The ${e.kind}'s name` : e.gatherer ? "This group's name" : "The folder's name" });
    cardInput.value = e.value;
    cardInput.addEventListener("input", () => { e.value = cardInput.value; });
    cardInput.addEventListener("keydown", (ev) => {
      ev.stopPropagation();                          // the page's own keys are not this box's
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); endCardEdit(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); endCardEdit(false); }
    });
    cardInput.addEventListener("blur", () => { if (!cardMoving && document.hasFocus() && cardEdit === e) endCardEdit(true); });
  }
  const what = e.kind ? `The ${e.kind}'s name` : e.gatherer ? "Its name" : e.id === null || e.id === undefined ? "A new folder's name" : "The folder's name";
  return el("label", { class: "c-edit" }, what, cardInput);
}
function endCardEdit(keep) {
  const e = cardEdit;
  if (!e) return;
  cardEdit = null; cardInput = null;
  if (keep && e.item) nameItem(e.g, e.item, e.value);
  else if (keep && e.gatherer) {
    const g = state.home.gatherers.find((x) => x.name === e.g), text = e.value.replace(/\s+/g, " ").trim();
    if (g && text !== titleOf(g)) keepTitle(e.g, text);
  } else if (keep) nameFolder(e.g, e.id ?? null, e.parent ?? null, e.value);
  if (hover.node && !hover.node.hidden) cardDraw();
}
for (const from of Object.keys(HOVER_FROM)) {
  const box = document.getElementById(from);
  box.addEventListener("pointerover", (ev) => {
    if (ev.pointerType === "touch") return;
    // at rest where a click put the card away (a few pixels: a click's place and a pointer event's are not given alike)
    if (hover.still && Math.abs(ev.clientX - hover.still[0]) < 4 && Math.abs(ev.clientY - hover.still[1]) < 4) return;
    hover.still = null;
    hover.keys = false;
    const at = ev.target.closest("[data-card]");
    hoverTo(from, at && !ev.target.closest(".save-btn, .close-btn, .branchline, .f-acts, .pick") ? at.dataset.card : null);
  });
  box.addEventListener("pointerleave", () => { hover.still = null; hoverTo(from, null); });   // gone and back: a card again
  box.addEventListener("focusin", (ev) => {
    const at = ev.target.closest("[data-card]");
    if (at && ev.target === at && at.matches(":focus-visible")) { hover.shown = true; hover.keys = true; hoverTo(from, at.dataset.card); }
  });
  box.addEventListener("focusout", () => hoverTo(from, null));
  box.addEventListener("scroll", () => { if (hover.shown && hover.from === from) cardDraw(); }, true);   // kept level with its actor
}
addEventListener("resize", () => { if (hover.shown) cardDraw(); });
// The monitor: every actor of the gatherers not hidden, a column for each group of the list that has any, side by side
// -- those wanting the reader first, then those at work, then those at rest (MON_ORDER), Closed last; Saved and Closed folded
// to a strip until opened, each column's fold kept in this browser -- and in each, a card for each actor: who it is, its status,
// and what it is doing -- what it waits on the reader for, its error, what it runs now and its newest calls, what runs
// in the background, or once done, what it said last -- with the files its latest turn worked on. What its turn did
// is read from the server (monitor.py) for the cards in view, again when the actor changes (monSig), at most every
// MON_GAP ms. A card, a column, and each column's place are only redrawn where they changed, so an actor at work goes
// on as it was (its stage, its glyphs: on the page's clock).
const MON_FOLD_KEY = "ag-dashboard-monitor-folded", MON_GAP = 1000, MON_BATCH = 24;
const MON_ORDER = ["Waiting for you", "Error", "Running", "Background", "Finished", "Idle", "Saved", "Closed"];
const monFolded = (() => {
  try { const v = JSON.parse(localStorage.getItem(MON_FOLD_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set(["Saved", "Closed"]);
})();
const mon = { got: new Map(), cards: new Map(), secs: new Map(), box: null, visible: new Set(), timer: null, busy: false, last: -Infinity, seen: null,
  old: false };                                    // old: the server started before the monitor was, and has no /api/monitor
// "N listed here (closed), of M saved in all: K still open, listed by their status"
const savedCount = (n, m) => !m ? "none" : `${n} listed here (closed), of ${m} in all`
  + (m > n ? `: ${m - n} still open, listed by ${m - n === 1 ? "its" : "their"} status` : "");
const monSig = (a) => `${a.last}|${a.events}|${statusOf(a)[0]}`;
function monForget() {                                 // left: nothing in view; what was read stays, for coming back
  if (mon.seen) mon.seen.disconnect();
  mon.seen = null; mon.box = null; mon.visible.clear(); mon.cards.clear(); mon.secs.clear();
  document.getElementById("monitor").replaceChildren();
}
function foldSection(name) {
  if (monFolded.has(name)) monFolded.delete(name); else monFolded.add(name);
  try { localStorage.setItem(MON_FOLD_KEY, JSON.stringify([...monFolded])); } catch (e) { /* this page only */ }
  renderMonitor();
}
// `nodes` in `box`, in order: those gone taken out first, then only those not in their place moved (a node moved starts
// its animations over)
function placeAll(box, nodes) {
  const keep = new Set(nodes);
  for (const n of [...box.children]) if (!keep.has(n)) n.remove();
  nodes.forEach((n, i) => { if (box.children[i] !== n) box.insertBefore(n, box.children[i] || null); });
}
function renderMonitor() {
  if (listMode !== "full" || !state.home) return;
  const box = document.getElementById("monitor");
  if (!SNAPSHOT && !mon.seen && "IntersectionObserver" in window)
    mon.seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) mon.visible.add(e.target.dataset.key); else mon.visible.delete(e.target.dataset.key);
      monFetch();
    }, { rootMargin: "200px 0px" });               // the page's: each column scrolls on its own
  const shown = state.home.gatherers.filter((g) => !isHidden(g)), many = shown.length > 1;
  const by = new Map(GROUPS.map((n) => [n, []]));
  for (const g of shown) for (const a of g.agents) by.get(groupOf(g, a)).push([g, a]);
  by.get("Closed").sort(([, x], [, y]) => (y.last || 0) - (x.last || 0));
  const total = shown.reduce((n, g) => n + g.agents.length, 0);
  const top = el("div", { class: "m-top" },
    el("h2", { text: `${plural(total, "actor")}${many ? ` in ${plural(shown.length, "gatherer")}` : ""}` }),
    mon.old ? el("span", { class: "m-old", role: "status",
      text: "This dashboard's server is older than its page: restart the dashboard to see each actor's calls and what it said." }) : null);
  const want = new Set(), columns = [];
  for (const n of MON_ORDER) {
    const list = by.get(n);
    if (!list.length) continue;
    const open = !monFolded.has(n);
    let s = mon.secs.get(n);
    if (!s) {
      s = { head: el("button", { class: "m-head", type: "button", onclick: () => foldSection(n) }), body: el("div", { class: "m-body" }) };
      s.node = el("section", { class: "m-col", "aria-label": n }, s.head);
      mon.secs.set(n, s);
    }
    s.node.classList.toggle("folded", !open);
    s.head.setAttribute("aria-expanded", open ? "true" : "false");
    s.head.title = open ? `Fold ${n.toLowerCase()}` : `Show ${n.toLowerCase()}`;
    const savedAll = n === "Saved" ? shown.reduce((k, g) => k + g.agents.filter((a) => !isCoordinator(a) && savedAs(g.name, a)).length, 0) : 0;
    s.head.replaceChildren(el("span", { class: "caret", text: "▶" }), groupMark(n), n,
      el("span", { class: "n", text: n === "Saved" ? `${list.length} of ${savedAll}` : String(list.length) }));
    if (n === "Saved") s.head.title += `: ${savedCount(list.length, savedAll)}`;
    if (open !== (s.body.parentNode === s.node)) { if (open) s.node.append(s.body); else s.body.remove(); }
    if (open) placeAll(s.body, monRows(n, list, many).map(([g, a, head]) => {
      if (head) return head;
      want.add(key(g.name, a.channel));
      return monCard(g, a, many);
    }));
    columns.push(s.node);
  }
  for (const [k, c] of mon.cards) if (!want.has(k)) { if (mon.seen) mon.seen.unobserve(c.node); mon.visible.delete(k); mon.cards.delete(k); }
  for (const [n, s] of mon.secs) if (!by.get(n).length) mon.secs.delete(n);
  if (!mon.box) mon.box = el("div", { class: "m-board" });
  placeAll(mon.box, columns);
  placeAll(box, [top, mon.box]);
  monFetch();
}
// A column's cards in order, Saved's under a heading for each folder (its gatherer's, by path), those in none last:
// [g, a] for a card, [g, null, heading] for a heading -- each kept, so it is not drawn again.
const monHeads = new Map();
function monRows(n, list, many) {
  if (n !== "Saved") return list;
  const at = new Map(state.home.gatherers.map((g, i) => [g.name, i]));
  const of = list.map(([g, a]) => { const fid = folderOf(g.name, a); return [g, a, fid === null ? null : folderPath(g.name, fid)]; });
  of.sort(([g, , f], [h, , e]) => (at.get(g.name) - at.get(h.name)) || (!f - !e) || byName(String(f || ""), String(e || "")));
  const out = [];
  let last = null;
  for (const [g, a, f] of of) {
    const k = f ? `${g.name}\u0000${f}` : `${g.name}\u0000`;
    if (k !== last && (f || of.some(([h, , e]) => h === g && e))) {   // "In no folder" only after some folder
      const text = `${f || "In no folder"}${many ? ` · ${titleOf(g)}` : ""}`;
      let head = monHeads.get(k);
      if (!head) monHeads.set(k, head = el("div", { class: "m-folder" }, folderMark(false), el("span")));
      head.lastChild.textContent = text;
      head.firstChild.style.visibility = f ? "" : "hidden";
      out.push([g, null, head]);
    }
    last = k;
    out.push([g, a]);
  }
  return out;
}
// A card, drawn again only when what it shows changed.
function monCard(g, a, many) {
  const k = key(g.name, a.channel), got = mon.got.get(k), d = got ? got.data : null;
  const current = isAt(focusedActor(), g.name, a.channel), open = !current && openActors().some((sel) => isAt(sel, g.name, a.channel));
  const sig = signature([a, d, got !== undefined, many, current, open, avatarMode, savedAs(g.name, a)]);   // read, even if to no avail: no "…"
  const had = mon.cards.get(k);
  if (had && had.sig === sig) return had.node;
  const node = drawCard(g, a, d, many, current, open, got !== undefined);
  node.dataset.key = k;
  if (had && mon.seen) mon.seen.unobserve(had.node);
  if (mon.seen) mon.seen.observe(node);
  mon.cards.set(k, { sig, node });
  return node;
}
const plainWords = (t) => String(t || "").replace(/```[\s\S]*?```/g, " … ").replace(/`|\*\*|^#{1,6}\s+|^\s*[-*]\s+/gm, "").replace(/\s+/g, " ").trim();
function drawCard(g, a, d, many, current, open, read) {
  const [cls, label] = statusOf(a), live = cls === "running";
  const named = a.name && a.name.text, words = a.last_user_message;
  const pic = live ? el("div", { class: "c-pic acting", "aria-hidden": "true" }, atWork({ ...a, channel: `monitor ${a.channel}` }, { work: (d && d.work) || {} }))
    : el("div", { class: "c-pic" }, actorLogo(a));
  const size = a.real_tokens ?? a.sent_tokens;
  const meta = el("div", { class: "c-meta" },
    el("span", { class: `status ${cls}` }, el("i", { "aria-hidden": "true", style: `--spin-at: -${Date.now() % 1200}ms` }), label),
    live && d && d.at ? el("span", { title: "This turn so far" }, "for ", el("span", { "data-lasting": d.at, text: lasting(d.at) }))
      : el("span", { "data-ago": a.last || "", text: ago(a.last) }),
    size !== null && size !== undefined ? el("span", { text: `${compact(size)} tokens` }) : null,
    many ? el("span", { class: "gname", text: titleOf(g) }) : null);
  const now = nowLine(a, cls, d);
  const steps = d && d.steps && ["running", "asking", "error", "background", "building"].includes(cls) ? d.steps.filter((s) =>
    !(s.running && (cls === "asking" || (now && now.dataset.call && s.text === now.dataset.call)))) : [];   // not what the line above says
  const earlier = d && steps.length ? d.calls - d.steps.length : 0;
  const said = d && d.said && !(now && now.classList.contains("said"))
    ? el("div", { class: "c-now said" }, el("span", { class: "lbl", text: "Said:" }), el("span", { class: "tx", text: plainWords(d.said) })) : null;
  const kinds = d && d.files ? Object.entries(d.files) : [];
  return el("button", { class: `m-card ${cls}`, type: "button", "aria-current": current ? "true" : "false", ...(open ? { "data-open": "true" } : {}),
    title: `${harnessName(a.harness)} · ${g.name} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}\nClick: show it${SNAPSHOT ? "" : ` · ${BESIDE_KEY}+click: beside the one shown`}`,
    onclick: (ev) => { leaveFull(); pick(g.name, a.channel, ev); },
    oncontextmenu: (ev) => { if (MAC && ev.ctrlKey && !SNAPSHOT) leaveFull(); pickBeside(g.name, a.channel, ev); } },
    el("div", { class: "c-head" }, pic, el("div", { class: "c-who" },
      named ? el("div", { class: "c-name", text: named }) : null,
      el("div", { class: "c-asked" + (words ? "" : " none"), text: words || "No message yet" }),
      meta)),
    now,
    steps.length ? el("div", { class: "c-steps" },
      earlier > 0 ? el("div", { class: "c-step more", text: `${plural(earlier, "earlier call")}` }) : null,
      ...steps.map((s) => {
        const [gc, word] = s.error ? ["err", "failed"] : !s.running ? ["ok", "ran"] : live ? ["run", "running"] : cls === "asking" ? ["run", "waiting"] : ["stop", "stopped"];
        return el("div", { class: "c-step", title: `${word}: ${s.text}` }, el("span", { class: `g ${gc}`, "aria-label": word, text: "●" }),
          el("span", { class: "t", text: s.text }));
      })) : null,
    said,
    a.recap && a.recap.text && !live ? el("div", { class: "c-recap", title: `Recap, ${ago(a.recap.at)}:\n${a.recap.text}` },
      el("span", { class: "lbl", text: "Recap" }), a.recap.text) : null,
    d && (kinds.length || d.calls) ? el("div", { class: "c-foot" },
      ...kinds.map(([k, n]) => el("span", { class: "fk" }, el("i", { style: `background: ${(FILE_KINDS[k] || [k, "var(--muted)"])[1]}` }),
        `${n} ${(FILE_KINDS[k] || [k])[0]}`)),
      d.calls ? el("span", { text: plural(d.calls, "call") }) : null,
      d.turns > 1 ? el("span", { text: `turn ${d.turns}` }) : null) : null,
    !d && !SNAPSHOT && !read ? el("div", { class: "c-wait", "aria-hidden": "true", text: "…" }) : null);
}
// What the actor is doing, or waits on, in a line: its question, its error, its call under way or its thinking, what runs
// in the background -- or, done, what it said last. None to say: null.
function nowLine(a, cls, d) {
  const line = (kind, lbl, text, extra) => el("div", { class: `c-now ${kind}` }, el("span", { class: "lbl", text: lbl }),
    text ? el("span", { class: "tx", text }) : null, extra || null);
  const since = (t) => t ? el("span", { class: "tm", "aria-hidden": "true", "data-ago": t, text: ago(t) }) : null;
  if (cls === "asking" && a.asking) return line("ask", "Waiting for you:", a.asking.kind === "permission" ? `Permission to ${permissionVerb(a.asking)}: ${a.asking.said || a.asking.tool}`
    : a.asking.kind === "dialog" ? `In its terminal: ${[a.asking.title, a.asking.said].filter(Boolean).join(" · ")}`
    : a.asking.kind === "plan" ? "A plan to approve"
    : (a.asking.questions || []).map((q) => q.question).filter(Boolean).join(" · ") || "A question", since(a.asking.at));
  if (cls === "error" || cls === "failed") return line("err", "Error:", (a.failing && a.failing.error) || (a.stopped && a.stopped.text)
    || (cls === "failed" ? "Its agent failed to start" : "Its turn stopped on an error"), since((a.failing || a.stopped || {}).at));
  if (cls === "running") {
    if (a.failing) return line("err", "Retrying:", `${a.failing.error || "its call to the model failed"} (${plural(a.failing.attempts, "try")})`, since(a.failing.at));
    const n = d && d.now;
    if (n && n.kind === "call") { const l = line("run", "Running:", n.text, since(a.last)); l.dataset.call = n.text; return l; }
    return line("run", n && n.kind === "thinking" ? "Thinking…" : "Working…", null, since(a.last));
  }
  if (cls === "background" && (a.background || []).length)
    return line("bg", "In the background:", a.background.map((t) => `${TASK_KINDS[t.kind] || t.kind}: ${t.label || t.id}`).join(" · "));
  if (d && d.said) return line("said", "Said:", plainWords(d.said));
  return null;
}
// What each card in view shows of its actor's turn, read for those changed since (MON_BATCH at a time).
function monFetch(soon = 150) {
  if (SNAPSHOT || listMode !== "full" || mon.timer || mon.busy) return;
  mon.timer = setTimeout(monLoad, Math.max(soon, MON_GAP - (performance.now() - mon.last)));
}
async function monLoad() {
  mon.timer = null;
  if (listMode !== "full" || !state.home) return;
  const stale = [];
  for (const g of state.home.gatherers) for (const a of g.agents) {
    const k = key(g.name, a.channel), had = mon.got.get(k);
    if (mon.visible.has(k) && (!had || had.sig !== monSig(a))) stale.push({ k, sig: monSig(a), ask: [g.name, a.channel, a.cwd || null] });
  }
  if (!stale.length) return;
  const batch = stale.slice(0, MON_BATCH);
  mon.busy = true; mon.last = performance.now();
  try {
    const got = await get(`/api/monitor?actors=${enc(JSON.stringify(batch.map((b) => b.ask)))}`);
    batch.forEach((b, i) => { const d = (got.actors || [])[i]; mon.got.set(b.k, { sig: b.sig, data: d && !d.error ? d : null }); });
    mon.old = false;
  } catch (e) {
    if (/: 404$/.test(e.message)) mon.old = true;
    for (const b of batch) mon.got.set(b.k, { sig: b.sig, data: (mon.got.get(b.k) || {}).data || null });   // tried again once it changes
  } finally { mon.busy = false; }
  renderMonitor();
  if (stale.length > batch.length) monFetch(0);
}
(() => {                                           // as the reader left it: over the whole page, from where it came
  let v = null;
  try { v = JSON.parse(localStorage.getItem(LIST_KEY)); } catch (e) { /* none kept */ }
  if (v && (v.from === "list" || v.from === "folded")) listMode = v.from;
  setListMode(v && v.mode, false);
})();
// Where each gatherer's actors were put when the list was last drawn: channel -> place, top first.
// The list is drawn whole each time; so that an actor changing status does not jump to its new place, each
// row, group heading and gatherer is keyed (data-key), its place and status taken before the list is drawn
// again (listPlaces), and after it (slideList) set back where it was and moved to where it is now. An actor
// whose status changed, and so its group, slides over the others; one new to the list fades in; its status dot
// grows into its new state. None of it for a reader who asks for less motion.
function listPlaces(root) {
  const places = new Map();
  for (const n of root.querySelectorAll("[data-key]")) {
    const dot = n.querySelector(":scope > .dot");
    places.set(n.dataset.key, { top: n.getBoundingClientRect().top, status: dot && dot.getAttribute("aria-label"), group: n.dataset.group });
  }
  return places;
}
function slideList(root, was) {
  if (!was.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const side = getComputedStyle(root).backgroundColor;
  for (const n of root.querySelectorAll("[data-key]")) {
    const before = was.get(n.dataset.key);
    if (!before) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" }); continue; }
    const dot = n.querySelector(":scope > .dot"), changed = dot && before.status && dot.getAttribute("aria-label") !== before.status;
    const regrouped = changed || (before.group && n.dataset.group !== before.group);
    const dy = before.top - n.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) {
      const frames = [{ transform: `translateY(${dy}px)` }, { transform: "none" }];
      if (regrouped) {     // past the rows between: over them, on the list's own background if it has none
        n.style.position = "relative"; n.style.zIndex = "1";
        const bg = getComputedStyle(n).backgroundColor;
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") { frames[0].backgroundColor = side; frames[1].backgroundColor = side; }
      }
      n.animate(frames, { duration: 380, easing: "cubic-bezier(.2, .8, .2, 1)" }).onfinish = () => { n.style.position = n.style.zIndex = ""; };
    }
    if (changed)
      dot.animate([{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, delay: 120, easing: "ease-out", fill: "backwards" });
  }
}
// Selecting an actor draws its chat as soon as it is loaded; its calls and context (the details) follow
// on the stream, which starts with them. The actor list is the stream's already.
async function select(g, c) {
  state.selected = [g, c]; state.readId = null; state.followLatest = true; state.context = null; state.agent = null;
  state.agentVersion = (state.agentVersion || 0) + 1;
  markSeen();
  savePanes();
  if (!PANE) { appsSelected(); showActorsApp(g, c); }   // an app's actor: its app's panel above it (19-app-actors.js)
  if (SNAPSHOT || state.paused) { await refresh(true); chatToEnd(); return; }
  const kept = !isShell(c) && showKept(g, c);        // shown before: drawn at once as it was, dimmed until brought up to date
  connect();
  const main = document.getElementById("main");
  main.classList.add("stale");
  if (kept) { render(true); chatToEnd(); }
  try { await loadChat(); } finally { main.classList.remove("stale"); }
  if (state.selected[0] === g && state.selected[1] === c) {
    const end = !kept || chatAtEnd();                // drawn already: the reader's place kept, should they have moved it
    render(true);
    if (end) chatToEnd();
  }
}
