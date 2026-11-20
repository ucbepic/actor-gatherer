// Notes: typos -- a misspelled word, clicked.
// In the desktop app (ag.spelling), a click in a word the spellchecker underlines -- the system's own, asked about the
// word -- opens its fixes under it. One picked takes the word's place as typing it would (⌘Z takes it back); "Add to
// dictionary" puts the word in the user's own. Typing, Esc or a click elsewhere closes it. Outside the app a page
// can't ask the browser's spellchecker: its right-click menu has the fixes.
import { $, el } from "./helpers.js";
import { ag, setRun } from "./state.js";
import { box } from "./page.js";
import { caretIn, pointAt, setCaret } from "./caret.js";
import { closePop, item, menu, popUp } from "./popups.js";

const LETTER = /[\p{L}\p{M}'’]/u, QUOTE = /['’]/;
const KEYS_KEEP = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock", "Escape"]);
let spellAsked = 0;
function wordAround(tx, at) {                           // the word the caret is in or beside: {a, z, word}
  const t = tx.textContent;
  let a = at, z = at;
  while (a > 0 && LETTER.test(t[a - 1])) a--;
  while (z < t.length && LETTER.test(t[z])) z++;
  while (a < z && QUOTE.test(t[a])) a++;                // (quotes around a word aren't of it)
  while (z > a && QUOTE.test(t[z - 1])) z--;
  return z - a >= 2 && z - a <= 60 ? { a, z, word: t.slice(a, z) } : null;
}
function wordRange(tx, w) {
  const r = document.createRange(), a = pointAt(tx, w.a), z = pointAt(tx, w.z);
  r.setStart(a.node, a.offset);
  r.setEnd(z.node, z.offset);
  return r;
}
async function spellClick(ev) {
  if (!ag.spelling.available || ev.button !== 0 || ev.detail !== 1 || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const tx = ev.target.closest && (ev.target.closest(".tx") || ev.target.closest("#title"));
  if (!tx || !tx.isContentEditable || ev.target.closest("a") || menu) return;
  const c = caretIn(tx);
  if (!c || !c.collapsed) return;
  const w = wordAround(tx, c.start);
  if (!w || wordRange(tx, w).cloneContents().querySelector("a")) return;   // (a link's words are its page's)
  const asked = ++spellAsked;
  let got;
  try { got = await ag.spelling.check(w.word); } catch { return; }
  if (asked !== spellAsked || !got || !got.misspelled || menu || document.activeElement !== tx) return;
  const now = caretIn(tx);                              // (still there: nothing typed, nowhere else clicked)
  if (!now || !now.collapsed || now.start !== c.start || tx.textContent.slice(w.a, w.z) !== w.word) return;
  spellPop(tx, w, got.suggestions || []);
}
function spellPop(tx, w, fixes) {
  popUp(wordRange(tx, w).getBoundingClientRect(), (pop) => {
    pop.setAttribute("aria-label", `Fixes for “${w.word}”`);
    if (!fixes.length) pop.append(el("div", { class: "none", text: "No suggestions" }));
    for (const f of fixes.slice(0, 5)) pop.append(item({ label: f }, () => fixWord(tx, w, f)));
    pop.append(el("div", { class: "sep" }), item({ label: "Add to dictionary", glyph: "+", sm: true }, () => {
      ag.spelling.learn(w.word).catch(() => {});
      tx.focus();
    }));
  }, null, "spell", "spell");
}
function fixWord(tx, w, fix) {
  if (!tx.isConnected || tx.textContent.slice(w.a, w.z) !== w.word) return;
  tx.focus();
  setCaret(tx, w.a, w.z);
  setRun(null);                                           // a step of its own: ⌘Z takes back the fix alone
  document.execCommand("insertText", false, fix);      // as typed: saved as typing is
  setRun(null);
}

export function wireSpelling() {
  box.addEventListener("click", spellClick);
  $("title").addEventListener("click", spellClick);
  document.addEventListener("keydown", (ev) => {          // typing goes on into the line, the fixes closed
    if (menu && menu.kind === "spell" && !KEYS_KEEP.has(ev.key)) closePop();
    if (!KEYS_KEEP.has(ev.key)) spellAsked++;             // (an answer on its way is for a word typed over)
  }, true);
  $("scroll").addEventListener("scroll", () => { if (menu && !["slash", "page", "figma"].includes(menu.kind) && !(menu.kind === "at" && menu.tx)) closePop(); });
}
