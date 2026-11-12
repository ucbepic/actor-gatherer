// FOLDERS OF GATHERERS (gatherer_folders.py, `home.gatherer_folders`: {folders: [{id, parent, name}], filed: {gatherer:
// folder id}}), kept by the server so every dashboard on this home shows the same: above the gatherers, only to organise
// the list. None kept: the list as without them, every gatherer at its top. One holds gatherers and folders of gatherers
// and nothing else: no actor is started in one, none is counted on its line -- its buttons, on hover: a folder in it,
// rename (F2), delete (what is in it moves up a level). Made from the list's head (its folder button); a gatherer put in
// one by dragging its row onto its line (dragGatherer), or onto the list's head for the top; a folder of them dragged
// so too. The list's folder code draws and changes them, as a gatherer's folders: their gatherer GF, a name no gatherer
// has (each a directory's name: no "/") -- treeOf, folderPost, makeFolder, startFolderEdit, ... -- and GFS where a
// gatherer is asked for. Each open till the reader folds it (gfFolded, kept in this browser); folded, nothing of it is in
// view, not even an actor open in a pane. The rail shows them so too (railGfLevel), to fold and open only.
const GF = "/";
const GFS = { name: GF, agents: [] };
const GF_FOLDED_KEY = "ag-dashboard-gatherer-folders-folded";
const gfFolded = (() => {
  try { const v = JSON.parse(localStorage.getItem(GF_FOLDED_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
function gfShow(id, open) {
  if (open) gfFolded.delete(id); else gfFolded.add(id);
  try { localStorage.setItem(GF_FOLDED_KEY, JSON.stringify([...gfFolded])); } catch (e) { /* kept for this page only */ }
}
// The folder the gatherer named `name` is kept in: its id, or null for the list's top (its folder deleted since: the top)
const gfOf = (name) => { const id = treeOf(GF).filed[name]; return folderById(GF, id) ? id : null; };
// Gatherers put in folder `id` (null: the list's top), by name: it opened
function fileGatherers(names, id) {
  if (!names.length) return null;
  showFolder(GF, id, true);
  return folderPost(GF, { do: "file", gatherers: names, folder: id }, (tree) => {
    for (const n of names) { if (id === null) delete tree.filed[n]; else tree.filed[n] = id; }
  });
}
// Gatherers selected (⌘+click on a Mac, else Ctrl+click: either key, as for an actor opened beside, rather than one
// guessed from the platform the browser names) to drag into a folder at once; Esc, or a drop, clears it
const gPicks = new Set();
function clearGPicks() { if (gPicks.size) { gPicks.clear(); renderAgents(); } }
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || !gPicks.size || ev.defaultPrevented || (ev.target.closest && ev.target.closest("input, textarea, [contenteditable], .xterm"))) return;
  clearGPicks();
});
// A gatherer's row, made to drag into a folder of gatherers: once there is one, and not while its name is typed
function dragGatherer(row, g) {
  if (SNAPSHOT || !treeOf(GF).folders.length || (state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, null))) return row;
  row.classList.toggle("picked", gPicks.has(g.name));
  row.addEventListener("click", (ev) => {           // captured: before its name's button folds it
    if (!(ev.metaKey || ev.ctrlKey) || ev.target.closest(".g-acts")) return;
    ev.preventDefault(); ev.stopPropagation();
    if (!gPicks.delete(g.name)) gPicks.add(g.name);
    renderAgents();
  }, true);
  row.draggable = true;
  row.addEventListener("dragstart", (ev) => startDrag(ev, GFS, { gs: gPicks.has(g.name) ? [...gPicks] : [g.name] }));
  row.addEventListener("dragend", endDrag);
  return row;
}
// One level of the list (`id` null: its top): the box naming a new folder here, its folders by name -- each its line
// (gfLine) and, open, what is in it set in under it (gf-kids) -- then its gatherers of `shown`, in the home's order
// (the newest first), each `draw(g)`.
function gfLevel(shown, id, draw) {
  const out = [], edit = state.folderEdit;
  if (edit && edit.g === GF && edit.id === null && edit.parent === id)
    out.push(el("div", { class: "folder-line gf-line editing", "data-key": `${GF}/folder:new` }, folderBox()));
  for (const f of kidFolders(GF, id)) {
    out.push(gfLine(f));
    if (isOpenFolder(GF, f.id)) {
      const rows = gfLevel(shown, f.id, draw);
      out.push(el("div", { class: "gf-kids" }, ...(rows.length ? rows : [el("div", { class: "f-empty", text: gfEmpty(f) })])));
    }
  }
  for (const g of shown) if (gfOf(g.name) === id) out.push(draw(g));
  return out;
}
// what an open folder with nothing shown in it says: that its gatherers are hidden, or that it has none
function gfEmpty(f) {
  const hid = Object.entries(treeOf(GF).filed).some(([name, at]) => within(GF, at, f.id) && state.home.gatherers.some((g) => g.name === name));
  return hid ? "Its gatherers are hidden" : SNAPSHOT ? "Empty" : "Empty: drag gatherers here";
}
// A folder of gatherers' line: a button opening or folding it -- its caret, its name -- and, hovered or in focus, its
// buttons: a folder made in it, it renamed (F2), it deleted. No counts, no start buttons. Dragged: into another, or onto
// the list's head (its top); a gatherer or a folder dropped on it put in it, and it opened when one is held over it.
function gfLine(f) {
  const open = isOpenFolder(GF, f.id), edit = state.folderEdit, k = `${GF}/folder:${f.id}`;
  if (edit && edit.g === GF && edit.id === f.id) return el("div", { class: "folder-line gf-line editing", "data-key": k }, folderBox());
  const toggle = () => toggleFolder(GF, f.id);
  const line = el("div", { class: "folder-line gf-line", "data-key": k },
    el("button", { class: "fbtn", type: "button", "aria-expanded": open ? "true" : "false", title: `${f.name}: a folder of groups`,
      onclick: toggle, onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startFolderEdit(GF, f.id); } } },
      el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "fname", text: f.name })),
    el("span", { class: "fill", onclick: toggle },
      SNAPSHOT ? null : el("span", { class: "f-acts", onclick: (ev) => ev.stopPropagation() },
        folderAct("new", `New folder in ${f.name}`, strokeIcon(ICONS.folderNew, 14), () => startFolderEdit(GF, null, f.id)),
        folderAct("rename", `Rename ${f.name} (F2)`, strokeIcon(ICONS.pencil, 13), () => startFolderEdit(GF, f.id)),
        folderAct("delete", `Delete ${f.name}: what is in it moves up a level`, strokeIcon(ICONS.bin, 14), () => deleteFolder(GF, f.id)))));
  return dropOn(dragFolder(line, GFS, f), GFS, f.id, () => { if (!isOpenFolder(GF, f.id)) toggle(); });
}
// A level of the rail (`id` null: its top), as the list's (gfLevel): each folder its name in a bracket, as a gatherer's
// folders are -- a button folding or opening it, as in the list (no card, no drilling in, nothing dropped on it) -- and,
// open, what is in it under it; folded, nothing. Then its gatherers, each `draw(g)`.
function railGfLevel(shown, id, draw) {
  const out = [];
  for (const f of kidFolders(GF, id)) {
    const open = isOpenFolder(GF, f.id);
    const name = el("button", { class: open ? "r-fhead" : "r-fname", type: "button", "aria-expanded": open ? "true" : "false",
      title: `${f.name}: a folder of groups · ${open ? "fold it" : "open it"}`, onclick: () => { cardHide(); toggleFolder(GF, f.id); } },
      el("span", { class: "tx" }, el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "nm", text: f.name })));
    if (open) {
      const kids = railGfLevel(shown, f.id, draw);
      out.push(el("div", { class: "r-fopen r-gf", role: "group", "aria-label": f.name }, name,
        el("div", { class: "r-kids" }, ...(kids.length ? kids : [el("div", { class: "r-none", text: "Empty" })]))));
    } else out.push(el("div", { class: "r-ffold r-gf" }, name));
  }
  for (const g of shown) if (gfOf(g.name) === id) out.push(draw(g));
  return out;
}
