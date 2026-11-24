// The panel, started -- by the app's own module, the panel's entry, once it has given its parts to edAdd: connected to
// the dashboard around it (app_kit's SDK), told the actors as its list has them (ag.actors, kept in `state.home`), the
// theme (each change also an "ag-theme" event, as the dashboard's page sent one), and what the page asks of it --
// open-file (a file shown, at a line), a link to a file clicked: edShowFile, the one way a file is opened from outside --
// then drawn (edMount) on its folder.
import { get, setAgApp, state } from "./page.js";
import { ed, edAdded, edAgentMarks, edBranches, edConflicts, edHead, edMount, edShowFile,
  edShowFolder } from "./editor.js";
import { edTree } from "./editor-tree.js";
import { edRecentStart } from "./recent.js";

export async function edStart() {
  window.ed = ed;                                    // what the editor has (editor.js's), as the browser tests read it
  edRecentStart();
  const ag = await AgApp.connect();
  setAgApp(ag);
  window.editor = ag;                                // the browser tests drive it as the page would
  const takeActors = (got) => {
    if (!got) return;
    state.home = { ...state.home, gatherers: got.gatherers || [], home_dir: got.home_dir || "", cwd: got.cwd || "",
      harnesses: got.harnesses || [] };
    if (got.home_dir) ed.home = ed.home || got.home_dir;
    if (ed.host) { ed.treeSig = ""; edTree(); edHead(); edBranches(); if (ed.s) { edConflicts(ed.s); edAgentMarks(ed.s); } }
  };
  takeActors(ag.actors.current);
  ag.actors.on(takeActors);
  ag.theme.on(() => window.dispatchEvent(new Event("ag-theme")));
  ag.selection.on((sel) => { state.selected = sel ? [sel.gatherer, sel.channel] : null; });
  ag.intents.on("open-file", (d) => { if (d && d.path) edShowFile(String(d.path), Number(d.line) || 0); });
  // a link to a file clicked in Chat (the app's [[links]], `ag://<app>/file/<its absolute path>#L<line>`): shown, at
  // its line -- the path absolute, whether or not the link keeps its first "/" -- and one to a folder (the Files app's
  // `folder/<path...>`), or a file's link to one, shown in the tree
  ag.links.onOpen((l) => {
    const linked = String((l && l.values && l.values.path) || "");
    const path = linked.startsWith("/") ? linked : `/${linked}`;
    const line = /^L?(\d+)$/i.exec(String((l && l.part) || ""));
    if (!linked) return;
    if (l.form === "folder/<path...>") edShowFolder(path);
    else edShowFile(path, line ? Number(line[1]) : 0);
  });
  ag.onMessage((m) => {                              // its backend's: the mode or on_disk set (here or elsewhere), a file to show
    if (m && m.mode) { ed.mode = m.mode; edHead(); }
    if (m && m.on_disk) { ed.onDisk = m.on_disk; edHead(); }
    if (m && m.show && m.show.path) edShowFile(String(m.show.path), Number(m.show.line) || 0);   // an agent's <app>_open
    for (const f of edAdded.message) f(m);
  });
  get("/api/mode").then((got) => { ed.mode = got.mode; edHead(); }).catch(() => {});
  get("/api/on_disk").then((got) => { ed.onDisk = got.on_disk; edHead(); }).catch(() => {});
  edMount();
  document.body.dataset.ready = "1";
}
