# Notes: the editing core on ProseMirror (not done)

The Notes panel edits each line in a contenteditable of its own (`#blocks > .blk > .tx`, a table's cells and a
picture's caption each another). That is the root of its three costliest parts: picking several lines
(`panel/picked.js`, its own selection drawn over the page's), its own undo (`panel/undo.js`), and fixes for the
browser carrying a selection or its undo from one line into another (Shift+↑↓ at a line's edge, `typing.js`; the
browser's undo after a move took letters out of another line). One editing surface on ProseMirror would let one
selection span lines, and one history cover them. This note says what that move needs, and where it stopped
(2026-11-19): the panel's browser tests check that a line *is the focused element*, which one editing surface can't
keep -- so the move needs those tests changed with it, and was not made.

## Where it stopped

ProseMirror has one contenteditable, its view's root: with the caret in any line, `document.activeElement` is that
root, never the line. Playwright's `toBeFocused()` is `activeElement === element`. These assertions can't hold:

- a line's words focused: `notes-work.spec.ts:115` (`row(…).locator(".tx")`), `notes-pictures.spec.ts:70` (the line
  after a pasted picture), `:113` (a picture's caption, `.tx.cap`), `notes-spelling.spec.ts:88` (the line a fix went
  into);
- a table's cell focused: `notes-tables.spec.ts:32, 42, 46, 54, 91, 168` -- unless each cell stays an editor of its
  own (below);
- `#blocks` focused as the sign that lines are picked and no line has the caret: `notes-select.spec.ts:63, 148`. With
  `#blocks` the view's root this passes, but says nothing: it is focused while typing too.

And the tests drive a line as the focusable element it is now: `notes-select.spec.ts:129-138` calls `tx.focus()` on a
line and puts a DOM range in it before pressing Shift+↑ (a descendant of an editing host isn't focusable: `focus()`
does nothing), and `:161-166` sets a DOM selection across lines and expects the lines picked.

Undo differs in kind, not just in wiring: `notes-undo.spec.ts:126` ("a line an agent changed since is left as it is,
and the reader told") expects ⌘Z refused, with "Can't undo", when an agent changed the line since. ProseMirror's
history (`prosemirror-history`) maps the reader's steps over others' (added with `addToHistory: false`) and undoes
them anyway; it doesn't expose the ranges of its next event to refuse it first. Keeping the rule means keeping
undo.js's steps (each the ops that take a change back, checked against how its lines stand now) and applying them as
transactions -- not ProseMirror's history.

So the move is one change together with the tests: "the caret is in this line" in place of "this line is focused" (a
helper reading the selection -- `getSelection().anchorNode` inside the row, or the view's state through a test hook),
and the caret put by a click or that hook in place of `tx.focus()` plus a DOM range. That changes the Notes specs,
which this step was to leave as they are, so the panel stayed on its contenteditables (its code now ES modules:
`panel/notes.js`).

## What the move needs

**ProseMirror, supplied as a committed ES module bundle.** `assets/src/notes/` as `assets/src/editor/` is for
CodeMirror: a `package.json` pinning `prosemirror-model`, `-state`, `-view`, `-transform`, `-keymap`, `-commands`,
`-inputrules` (and `-history` only if it is used), its `package-lock.json`, an `entry.mjs` re-exporting what the panel
uses, and a `build.mjs` running esbuild with `format: "esm"` into `ag_apps/notes/panel/vendor/prosemirror.js` (roughly
200 KB minified) with `prosemirror.LICENSE` beside it. The panel's modules import it (`./vendor/prosemirror.js`);
lint-panels follows the import and checks its exports, and skips linting `vendor/`. Why a bundle, not the packages'
own ESM files vendored: those import each other by bare names (`prosemirror-model`, `orderedmap`, `rope-sequence`,
`w3c-keyname`), which the browser resolves only through an import map kept in step with eight copied packages; one
bundle from a lockfile is reproducible, one file, and loads with no build at serve time because it is committed.

**A schema of Notes' blocks**, the doc a run of top-level block nodes, each with an `id` attribute:
- `text`, `h1`-`h3`, `todo` (`checked`), `bullet`, `number`, `quote`: inline content; `indent` where notebook.py
  allows one. Marks `b`, `i`, `u`, `s`, `code`, `link` (`href`: the URIs `clean()` allows); a `pagelink` inline atom
  (`page:<id>`, drawn as `a.pg[contenteditable=false]` with the page's icon and title -- no zero-width spaces needed
  beside it); `hard_break` for `<br>`.
- `code`: text only, `code: true`, no marks.
- `divider`, `agents`, `work`: atoms, their node views drawing what `page.js`, `agents.js`, `work.js` draw now.
- `image`, `figma`: the caption as inline content; the picture a non-editable part of the node view (`pictures.js`'s
  drawing, unchanged).
- `table`: an atom whose node view keeps a nested ProseMirror view per cell (as ProseMirror's footnote example
  nests one) -- each cell then is its own focused element, as `notes-tables.spec.ts` expects -- or
  `prosemirror-tables`, which would change those tests too.
Only what is edited lives in the doc (type, words, indent, checked); a block's calls, thread, work state and source
stay in the notebook (`state.js`'s `pages`), read by id as now, so actors.js, sent.js, convo.js, work.js keep working.
Node views draw each row as today -- `.blk[data-id][data-type]`, `.gut` (+ and grip), `.mk`/`.chk`, `.tx` as the
content DOM, `.to-btn`, `.sent`, a `.fold` -- and the folded ended lines become node decorations, hidden.

**Transactions to ops** (notebook.py and the agent protocol unchanged): after each transaction the panel compares the
old doc with the new by top-level block id:
- a block's words changed by typing: queued as `block.put {id, text}` after a pause (`send.js`'s `typed()`, as now),
  the words serialized through ProseMirror's DOMSerializer and then `clean()` -- the same allowlisted HTML;
- its type, indent or checked changed: `block.put` with those fields at once (`change()`);
- a block new (Enter splits, paste, the / menu): `block.put` with `after`; ids given by a plugin's
  `appendTransaction` to any block without one, or with one another block has (a split copies its attrs);
- a block gone: `block.delete`; blocks reordered: `block.move`s, the fewest (those off the longest run kept in order).

**Others' ops to transactions:** `others.js` applies a batch to the notebook as now, then, for each touched block of
the page open, one transaction replacing that node with one built from the notebook (`clean()` before
DOMParser, as `withLinks(clean(…))` is before innerHTML now), with `addToHistory: false` and a meta flag the op
mapper skips. The rule "never into the block the reader is typing in" can go: the reader's selection maps through the
change (or keep it: skip a block with unsent words, as `dirty` does now).

**Undo:** undo.js's steps kept (see above), their ops applied through the same path as others' ops; a run of typing
a step. The browser's own undo never reaches the doc: the view's keymap binds ⌘Z ⌘⇧Z to `undoStep`, and a
`beforeinput` handler takes the Edit menu's `historyUndo`/`historyRedo`, as `title.js` does now.

**Lines picked:** a Selection subclass for whole top-level blocks from an anchor to a head (as `prosemirror-tables`'
CellSelection is for cells), drawn by node decorations (`.picked`); a keymap active while it is the selection
(⌫, Tab, ⌘D, ⌘↵, ⌘⇧↑↓, Esc, ↵); copy and paste through `clipboardSerializer`/`transformPasted` keeping
`application/x-ag-notes-blocks`. Shift+↑↓ past a line's edge, ⌘A twice, a sweep from a line into others and a box
dragged beside the lines all set it; words selected across lines become it (`picked.js`'s crossPick, done in
`appendTransaction`). `#pk-bar` stays outside the doc.

**IME and shortcuts:** ProseMirror composes text itself; markdown at a line's start becomes input rules, which run on
text input, not during composition (as `typing.js` waits for `insertText` now). The / menu, [[ and @ become a plugin
watching the text before the caret (slash.js, pagelinks.js, picker.js read characters by DOM offsets now; they would
read ProseMirror positions).

**Order:** (1) the bundle, the schema and the doc⇄notebook mapping (block to node, node to block, old and new doc to
ops) as pure functions, with Vitest tests -- nothing drawn differently; (2) node views drawing today's rows, behind a
switch; (3) typing, the caret, keys and lines picked moved onto the view, with the specs' focus assertions changed to
caret assertions in the same change; (4) tables last. `caret.js`, most of `typing.js`, the selection half of
`picked.js` and the cross-line fixes go; `model.js`, `send.js`, `others.js`, the sidebar, the actors' and work items'
modules, the conversation and the pages stay as they are.
