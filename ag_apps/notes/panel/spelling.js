// Notes: typos -- a misspelled word, clicked.
// In the desktop app (ag.spelling), a click in a word the spellchecker underlines -- the system's own, asked about the
// word -- opens its fixes under it. One picked takes the word's place as typing it would (⌘Z takes it back); "Add to
// dictionary" puts the word in the user's own. Typing, Esc or a click elsewhere closes it. Outside the app a page
// can't ask the browser's spellchecker: its right-click menu has the fixes.
import { $, el } from "./helpers.js";
import { ag, setRun } from "./state.js";
import { TextSelection } from "./vendor/prosemirror.js";
import { schema } from "./doc.js";
import { box } from "./page.js";
import { caretIn, pointAt, setCaret } from "./caret.js";
import { closePop, item, menu, popUp } from "./popups.js";
import { boxAt, edit, view } from "./editor.js";

const LETTER = /[\p{L}\p{M}'’]/u, QUOTE = /['’]/;
const KEYS_KEEP = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock", "Escape"]);
let spellAsked = 0;
// Where a word is: in the title, its element and places in its text; in a line, the line's id and places in its node
// (a link to a page one place: never part of a word).
function wordAround(t, at) {                            // the word in `t` the place `at` is in or beside: {a, z, word}
  let a = at, z = at;
  while (a > 0 && LETTER.test(t[a - 1])) a--;
  while (z < t.length && LETTER.test(t[z])) z++;
  while (a < z && QUOTE.test(t[a])) a++;                // (quotes around a word aren't of it)
  while (z > a && QUOTE.test(t[z - 1])) z--;
  return z - a >= 2 && z - a <= 60 ? { a, z, word: t.slice(a, z) } : null;
}
const lineText = (node) => node.textBetween(0, node.content.size, "", "\ufffc");
// the word the caret is in, in a line -- the browser's caret, which a click has just put (the editor reads it a moment
// later): null if none, or if a link has it
function lineWord() {
  const s = getSelection();
  if (!s.rangeCount || !s.isCollapsed || !box.contains(s.anchorNode) || !view.hasFocus()) return null;
  let $p;
  try { $p = view.state.doc.resolve(view.posAtDOM(s.anchorNode, s.anchorOffset)); } catch { return null; }
  if ($p.depth !== 1 || !$p.parent.inlineContent) return null;
  const node = $p.parent, pos = $p.before(1), w = wordAround(lineText(node), $p.parentOffset);
  if (!w || view.state.doc.rangeHasMark(pos + 1 + w.a, pos + 1 + w.z, schema.marks.link)) return null;
  return { ...w, id: node.attrs.id, pos, at: $p.parentOffset };
}
function wordRange(tx, w) {
  const r = document.createRange(), a = pointAt(tx, w.a), z = pointAt(tx, w.z);
  r.setStart(a.node, a.offset);
  r.setEnd(z.node, z.offset);
  return r;
}
async function spellClick(ev) {
  if (!ag.spelling.available || ev.button !== 0 || ev.detail !== 1 || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if (ev.target.closest && ev.target.closest("a") || menu) return;
  if (ev.target.closest && ev.target.closest("#title")) return titleClick();
  if (!ev.target.closest || !ev.target.closest(".blk > .tx") || !view.editable) return;
  const w = lineWord();
  if (!w) return;
  const asked = ++spellAsked;
  let got;
  try { got = await ag.spelling.check(w.word); } catch { return; }
  if (asked !== spellAsked || !got || !got.misspelled || menu || !view.hasFocus()) return;
  const now = lineWord();                               // (still there: nothing typed, nowhere else clicked)
  if (!now || now.id !== w.id || now.at !== w.at || now.word !== w.word) return;
  const a = boxAt(w.pos + 1 + w.a), z = boxAt(w.pos + 1 + w.z);
  spellPop({ left: a.left, right: z.right, top: a.top, bottom: Math.max(a.bottom, z.bottom), width: z.right - a.left, height: a.height },
    got.suggestions || [], w.word, (f) => fixLine(w, f), () => view.focus());
}
async function titleClick() {
  const tx = $("title");
  if (!tx.isContentEditable) return;
  const c = caretIn(tx);
  if (!c || !c.collapsed) return;
  const w = wordAround(tx.textContent, c.start);
  if (!w) return;
  const asked = ++spellAsked;
  let got;
  try { got = await ag.spelling.check(w.word); } catch { return; }
  if (asked !== spellAsked || !got || !got.misspelled || menu || document.activeElement !== tx) return;
  const now = caretIn(tx);                              // (still there: nothing typed, nowhere else clicked)
  if (!now || !now.collapsed || now.start !== c.start || tx.textContent.slice(w.a, w.z) !== w.word) return;
  spellPop(wordRange(tx, w).getBoundingClientRect(), got.suggestions || [], w.word, (f) => fixWord(tx, w, f), () => tx.focus());
}
// the fixes for `word`, under it (`rect`): one picked, `fix`; added to the dictionary, the keys `back` where they were
function spellPop(rect, fixes, word, fix, back) {
  popUp(rect, (pop) => {
    pop.setAttribute("aria-label", `Fixes for “${word}”`);
    if (!fixes.length) pop.append(el("div", { class: "none", text: "No suggestions" }));
    for (const f of fixes.slice(0, 5)) pop.append(item({ label: f }, () => fix(f)));
    pop.append(el("div", { class: "sep" }), item({ label: "Add to dictionary", glyph: "+", sm: true }, () => {
      ag.spelling.learn(word).catch(() => {});
      back();
    }));
  }, null, "spell", "spell");
}
// a fix taking the word's place as typing it would (a step of its own: ⌘Z takes back the fix alone)
function fixWord(tx, w, fix) {
  if (!tx.isConnected || tx.textContent.slice(w.a, w.z) !== w.word) return;
  tx.focus();
  setCaret(tx, w.a, w.z);
  setRun(null);
  document.execCommand("insertText", false, fix);      // as typed: saved as typing is
  setRun(null);
}
function fixLine(w, fix) {
  const doc = view.state.doc, line = doc.nodeAt(w.pos), from = w.pos + 1 + w.a, to = w.pos + 1 + w.z;
  if (!line || line.attrs.id !== w.id || to > doc.content.size || doc.textBetween(from, to, "") !== w.word) return;
  view.focus();
  setRun(null);
  const tr = view.state.tr.insertText(fix, from, to);
  edit(tr.setSelection(TextSelection.create(tr.doc, from + fix.length)));
  setRun(null);
}

export function wireSpelling() {
  box.addEventListener("click", spellClick);
  $("title").addEventListener("click", spellClick);   // (its own: titleClick)
  document.addEventListener("keydown", (ev) => {          // typing goes on into the line, the fixes closed
    if (menu && menu.kind === "spell" && !KEYS_KEEP.has(ev.key)) closePop();
    if (!KEYS_KEEP.has(ev.key)) spellAsked++;             // (an answer on its way is for a word typed over)
  }, true);
  $("scroll").addEventListener("scroll", () => { if (menu && !["slash", "page", "figma"].includes(menu.kind) && !(menu.kind === "at" && menu.tx)) closePop(); });
}
