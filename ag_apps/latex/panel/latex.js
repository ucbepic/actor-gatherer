// ------------------------------------------------------------------ the LaTeX editor
// What the LaTeX editor adds to app_kit.fileedit's editor (its panel's code, from /_ag/lib/fileedit/), given to it by edAdd:
// the project's preview in a column beside the file (preview.js: ed.pv), run by Execute (⌘↵); a LaTeX build's problems
// marked on their lines; "→ PDF" and a double-click in a TeX source, to its place in the PDF; and ⌘B / ⌘I in LaTeX's
// markup, \textbf{…} and \textit{…}; the file's text folded away, the preview taking the width; and who changed its
// lines on Overleaf (overleaf.js). The panel's one entry
// (index.html): the rest imported, its parts given to edAdd, then the panel started (edStart).
import { agApp, el, ICONS, MAC, paneNote, strokeIcon, widthGrip } from "/_ag/lib/fileedit/page.js";
import { ed, edAdd, edBase, edDiskConflicts, edHead, edRel, edSave } from "/_ag/lib/fileedit/editor.js";
import { edStart } from "/_ag/lib/fileedit/start.js";
import { pvLocate, pvMount, pvRun } from "./preview.js";
import { olParts, olStart } from "./overleaf.js";

Object.assign(ed, { problems: new Map(), problemsAt: 0, pv: null,   // a LaTeX build's, by file (edProblems); the column
  textBar: null, textHide: null, folded: null });   // the text's fold: its bar, its button; while folded, {file} it was on
// Execute (⌘↵) runs the project's preview for the file open, else the folder shown (pvRun); → PDF, or a double-click
// in a TeX source, shows that place in what it built (pvLocate). A place in a PDF's source it sends back is opened here
// (edShowFile).
export const pvPath = () => ed.file || ed.root;
// ⌘↵ (Ctrl+Enter elsewhere) anywhere in the LaTeX editor -- the file, its tree, its header, a PDF's viewer: Execute. Taken
// before CodeMirror's own (a blank line below); a text box keeps its own Enter.
function edExecKey(ev) {
  if (ev.key !== "Enter" || !(MAC ? ev.metaKey : ev.ctrlKey) || ev.shiftKey || ev.altKey || ev.isComposing) return;
  const t = ev.target;
  if (t && t.closest && t.closest("input, textarea, select")) return;
  ev.preventDefault(); ev.stopPropagation();
  if (!ev.repeat) edExecute();                       // held down: once
}
// Execute: the file saved first (as it is here), then its project's preview run, beside it.
export async function edExecute() {
  const path = pvPath();
  if (!path) return;
  const s = ed.s;
  if (s && s.state && s.state.dirty && !s.state.missing && !edDiskConflicts(s).length) await edSave(s);
  try { await pvRun({ path, ...(ed.file ? { file: ed.file } : {}) }); }
  catch (e) { paneNote(e.message); }
}

// Execute: the project's preview run, beside the file (edExecute).
function edExecBtn() {
  return el("button", { type: "button", class: "ed-exec",
    title: `Run the project's preview (${MAC ? "⌘↵" : "Ctrl+Enter"})`,
    onclick: edExecute, "aria-keyshortcuts": MAC ? "Meta+Enter" : "Control+Enter" }, strokeIcon(ICONS.play, 13), "Execute");
}

// A LaTeX build's problems (preview.js, from its log), each file's marked on its lines when it is open -- whichever
// file of the document it is: a marker in the gutter, the place underlined (an undefined macro, a label: itself; else
// the line's text), the message on hover over either, the lines of errors and warnings tinted. Moved with the edits
// made since; the next build's replace them. `at`: the build's (its log's time).
export function edProblems(list, at) {
  const by = new Map();
  for (const p of list || []) if (p.path && p.line) { if (!by.has(p.path)) by.set(p.path, []); by.get(p.path).push(p); }
  ed.problems = by; ed.problemsAt = at || 0;
  if (ed.s && ed.s.view) edMarkProblems(ed.s);
}
function edMarkProblems(s) {
  const A = s.A, v = s.view;
  if (!v || !s.probs || !A.setDiagnostics) return;
  const list = ed.problems.get((s.info && s.info.real) || s.path) || ed.problems.get(s.path) || [];
  const sig = JSON.stringify([ed.problemsAt, list.map((p) => [p.level, p.line, p.message])]);
  if (sig === s.probs.sig) return;
  s.probs.sig = sig;
  const doc = v.state.doc, diags = [], tints = new Map();
  for (const p of list) {
    const l = doc.line(Math.max(1, Math.min(p.line, doc.lines)));
    const at = p.token ? l.text.indexOf(p.token) : -1;
    const from = at >= 0 ? l.from + at : l.from + l.text.length - l.text.trimStart().length;
    const to = at >= 0 ? from + p.token.length : Math.max(from, l.from + l.text.trimEnd().length);
    diags.push({ from, to, severity: p.level === "error" ? "error" : p.level === "warning" ? "warning" : "info",
      source: p.level === "box" ? "LaTeX (bad box)" : "LaTeX", message: p.message });
    if (p.level !== "box" && tints.get(l.from) !== "error") tints.set(l.from, p.level);
  }
  const tinted = A.Decoration.set([...tints].map(([at, level]) => A.Decoration.line({ class: `ed-prob ${level}` }).range(at)), true);
  const told = A.setDiagnostics(v.state, diags);
  v.dispatch({ effects: [].concat(told.effects || [], s.probs.set.of(tinted),
    s.probs.gutter.reconfigure(diags.length && A.lintGutter ? A.lintGutter() : [])) });
}
// Whether the file open is a TeX source, its places in what it built shown: "→ PDF" offered.
const edTexToPdf = () => !!(ed.file && /\.(tex|ltx)$/i.test(ed.file));
// `at`: the place in the file (a double-click's); else the cursor's.
async function edToPdf(at = null) {
  const s = ed.s;
  if (!edTexToPdf() || !s || !s.view) return;
  const head = at ?? s.view.state.selection.main.head, l = s.view.state.doc.lineAt(head);
  try { await pvLocate({ path: ed.file, line: l.number, column: head - l.from }); }
  catch (e) { paneNote(e.message); }
}
// A double-click in a TeX source's text: that place in the PDF too -- the word under it selected by CodeMirror, as
// always (a modifier held, or a button of a box in the text: CodeMirror's or the box's alone).
function edToPdfClick(ev) {
  if (ev.button !== 0 || ev.detail !== 2 || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
  const s = ed.s, t = ev.target;
  if (!s || !s.view || !edTexToPdf() || !s.view.contentDOM.contains(t) || (t.closest && t.closest("button, input, a"))) return;
  const at = s.view.posAtCoords({ x: ev.clientX, y: ev.clientY });
  if (at != null) edToPdf(at);
}

// LaTeX's markup (`opens`, closed by `}`) on [from, to]: [open's length, 1] if one of them is just around it, or its own
// ends (`.inside`) -- the brace it opens closed by that `}`, not one before; else null.
function edLatexOff(doc, from, to, opens) {
  const balanced = (a, b) => {                       // [a, b) of the text: its braces balanced (escaped ones not counted)
    let d = 0;
    const t = doc.sliceString(a, b);
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "\\") { i++; continue; }
      if (t[i] === "{") d++;
      else if (t[i] === "}" && --d < 0) return false;
    }
    return d === 0;
  };
  for (const o of opens) {
    if (from >= o.length && doc.sliceString(from - o.length, from) === o && doc.sliceString(to, to + 1) === "}"
      && balanced(from, to)) return [o.length, 1];
  }
  for (const o of opens) {
    if (to - from > o.length && doc.sliceString(from, from + o.length) === o && doc.sliceString(to - 1, to) === "}"
      && balanced(from + o.length, to - 1)) return Object.assign([o.length, 1], { inside: true });
  }
  return null;
}

// The lines of a LaTeX build's errors and warnings, tinted (edProblems): a field of each text file's view, and its
// gutter's markers, only once it has some.
function edProblemsField(s) {
  const A = s.A, setProbs = A.StateEffect.define();
  const probs = A.StateField.define({
    create: () => A.Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setProbs)) deco = e.value;
      return deco;
    },
    provide: (f) => A.EditorView.decorations.from(f),
  });
  s.probs = { set: setProbs, sig: "", gutter: new A.Compartment() };
  return [probs, s.probs.gutter.of([])];
}
// ⌘B and ⌘I in a TeX source: \textbf{…} and \textit{…} (\emph read as \textit), as Markdown's in a Markdown file.
const ED_TEX_MARKUP = { test: (ext) => /^(tex|latex|ltx|sty|cls|dtx|tikz)$/.test(ext),
  bold: { open: ["\\textbf{"], close: "}" }, italic: { open: ["\\textit{", "\\emph{"], close: "}" },
  off: (doc, from, to, k) => edLatexOff(doc, from, to, k.open) };
// The preview's column, beside the file's (and the actor's changes'), its width dragged at its left edge; and the text's
// fold, its bar in the text's place, left of it.
function edPreviewColumn(work) {
  const grip = el("div", { class: "ed-col-grip ed-pv-grip", role: "separator", "aria-orientation": "vertical",
    title: "Drag to resize · double-click to reset" });
  ed.pv = el("section", { class: "ed-pv", hidden: "", "aria-label": "Preview" });
  work.append(grip, ed.pv);
  widthGrip(grip, "ag-editor-preview-width", ed.pv, "width", 220, (x) => ed.pv.getBoundingClientRect().right - x);
  ed.body.id = "ed-text";
  ed.textBar = el("button", { type: "button", class: "ed-fold ed-text-fold", hidden: "", "aria-label": "Show the text",
    "aria-controls": "ed-text", "aria-expanded": "false", onclick: () => edFoldText(false, true) });
  ed.textHide = el("button", { type: "button", class: "ed-act ed-text-hide", title: "Hide the text so the preview takes the width",
    "aria-label": "Hide the text", "aria-controls": "ed-text", "aria-expanded": "true", onclick: () => edFoldText(true, true) },
    strokeIcon(ED_TEXT_GLYPH, 15));
  work.prepend(ed.textBar);
  pvMount(ed.pv);
  let folded = false;
  try { folded = localStorage.getItem(edTextKey()) === "1"; } catch (e) { /* this page only */ }
  if (folded) queueMicrotask(() => edFoldText(true));   // once the preview is shown again (pvMount's, queued first) -- if it is
}

// The file's text folded away, so the preview takes the width, as the files fold away (editor-tree.js's edFoldTree):
// offered while the preview is shown (else nothing would be left), by a button first in the header; while folded, a thin
// bar in the text's place, the file's name down it, clicked to show the text again where it was (CodeMirror keeps its
// scroll while hidden). The keys, in the panel as the reader folds it or shows it, move to the control that undoes it.
// Shown again by itself when the preview is hidden, when another file is opened, or when a place in one is asked for from
// outside the panel (a link, an agent's latex_open, a double-click in the PDF, a problem picked): that is what the reader
// is to see. Kept in this browser for this LaTeX editor, as its preview is: its panel drawn again (its task left and come
// back to, the page reloaded), it is folded again if its preview is shown again.
const ED_TEXT_GLYPH = "M3.25 2.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5"
  + "a1.5 1.5 0 0 1 1.5-1.5zM8.5 2.75v10.5M4.25 6h2.25M4.25 8.25h2.25M4.25 10.5h1.25";   // two columns, text in the left
const edTextKey = () => `ag-latex-text-folded:${(agApp && agApp.instance) || ""}`;
const edPreviewOn = () => !!(ed.pv && !ed.pv.hidden);
// `reader`: by the reader's click (the button, the bar), the keys moved with it if they were in the panel; else (the
// preview hidden, another file opened) moved only off the bar, as it goes.
export function edFoldText(fold, reader = false) {
  if (!ed.textBar) return;
  fold = fold && edPreviewOn();
  try { if (fold) localStorage.setItem(edTextKey(), "1"); else localStorage.removeItem(edTextKey()); } catch (e) { /* this page only */ }
  if (!!ed.folded === fold) return;
  const had = document.activeElement, moving = reader ? ed.host.contains(had) : had === ed.textBar;
  ed.folded = fold ? { file: ed.file } : null;
  ed.host.classList.toggle("text-folded", fold);
  ed.textBar.hidden = !fold;
  edTextBar();
  edHead();                                          // its button out of the header, or back first in it
  if (moving) (fold ? ed.textBar : ed.textHide).focus({ preventScroll: true });
}
// The bar's name for the file open (the folder alone, gone since: none).
function edTextBar() {
  const f = ed.file || "", bar = ed.textBar;
  if (!bar || bar.dataset.file === f) return;
  bar.dataset.file = f;
  bar.title = f ? `Show the text of ${edRel(f)}` : "Show the text";
  bar.replaceChildren(strokeIcon(ED_TEXT_GLYPH, 15), ...(f ? [el("span", { class: "nm", text: edBase(f) })] : []));
}
// The preview shown, or hidden (preview.js): the fold offered, or not -- hidden, the text shown again, all there is.
export function edPreviewShown(on) {
  if (!on) edFoldText(false);
  edHead();
}
// Another file opened, or a place in one asked for: the text shown again (not the panel's own file opened again as it
// is drawn, or as the dashboard restarted: the same file).
function edTextOpening(path, asked) {
  if (ed.folded && (asked || path !== ed.folded.file)) edFoldText(false);
}
edAdd({
  lead: () => { edTextBar(); return edPreviewOn() && !ed.folded ? ed.textHide : null; },
  head: (x) => [x && x === ed.s && edTexToPdf() ? el("button", { type: "button", class: "ed-topdf", onclick: () => edToPdf(),
    title: "Show the cursor's line in the PDF. Double-click in the source or the PDF to jump between them." }, "→ PDF") : null,
  edExecBtn()],
  work: edPreviewColumn,
  opening: edTextOpening,
  keys: edExecKey,
  down: edToPdfClick,
  view: edProblemsField,
  viewed: edMarkProblems,
  markup: ED_TEX_MARKUP,
});
edAdd(olParts);                                      // who changed the paper's lines on Overleaf (overleaf.js)
edStart().then(olStart);
