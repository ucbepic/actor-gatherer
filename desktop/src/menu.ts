// The right-click menu of the app's window, and of the Browser's native pages: a browser's, with the spellchecker's
// fixes first when the word clicked is misspelled. On a Mac the spellchecker is the system's own, the one drawing the
// red underline under a word in a text box (and the one the dashboard's page asks through the preload: preload.cts).
import { clipboard, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from "electron";

export const FIXES = 5; // the spellchecker's guesses offered, at most

/** A misspelled word right-clicked in a text box: its fixes (one picked takes its place, as typing it would), and
 * "Add to Dictionary" (the user's own, the system's: it is no longer underlined anywhere). */
export function spellingItems(wc: WebContents, p: ContextMenuParams): MenuItemConstructorOptions[] {
  if (!p.isEditable || !p.misspelledWord) return [];
  const fixes: MenuItemConstructorOptions[] = p.dictionarySuggestions
    .slice(0, FIXES)
    .map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) }));
  return [
    ...(fixes.length ? fixes : [{ label: "No Guesses Found", enabled: false }]),
    { type: "separator" },
    { label: "Add to Dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
    { type: "separator" },
  ];
}

/** Cut, Copy and Paste in a text box, Copy for words picked, and a link's address: what a browser's menu has. */
export function editItems(p: ContextMenuParams): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  if (p.linkURL) items.push({ label: "Copy Link Address", click: () => clipboard.writeText(p.linkURL) }, { type: "separator" });
  if (p.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
  else if (p.selectionText) items.push({ role: "copy" });
  return items;
}

/** Separators only between items: none first, last, or two together. */
export function tidy(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [];
  for (const it of items) {
    if (it.type === "separator" && (!out.length || out[out.length - 1].type === "separator")) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].type === "separator") out.pop();
  return out;
}
