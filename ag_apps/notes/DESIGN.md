# Notes: the editing core on ProseMirror

The Notes panel edits a page's lines in one ProseMirror view: `#blocks` is its root, each line a row of it. Before
(to 2026-11-21), each line was a contenteditable of its own (`#blocks > .blk > .tx`, a table's cells and a picture's
caption each another), and that was the root of the panel's costliest parts: picking several lines (`panel/picked.js`,
its own selection drawn over the page's), its own undo (`panel/undo.js`), and fixes for the browser carrying a
selection or its undo from one line into another (Shift+↑↓ at a line's edge; the browser's undo after a move took
letters out of another line). One editing surface has one selection, which can span lines, and no line's browser undo
to reach into another. The notebook (`notebook.py`), the agents' tools and the stored format did not change.

## ProseMirror, a committed ES module bundle

`assets/src/notes/` is to the Notes panel what `assets/src/editor/` is to the Files and LaTeX editors' CodeMirror: a
`package.json` pinning `prosemirror-model`, `-state`, `-view`, `-transform` and `-commands` (only what the panel uses:
not `-keymap`, `-inputrules` or `-history`), its `package-lock.json`, an `entry.mjs` re-exporting what the panel
uses, and a `build.mjs` running esbuild with `format: "esm"` into `ag_apps/notes/panel/vendor/prosemirror.js`
(193 KB) with `prosemirror.LICENSE` beside it. Rebuild: `npm ci && npm run build` there. The panel's modules import
it (`./vendor/prosemirror.js`); `frontend/scripts/lint-panels.mjs` follows that import to check the names imported,
and neither lints the bundle nor walks it for imports. Why a bundle, not the packages' own ESM files vendored: those
import each other by bare names (`prosemirror-model`, `orderedmap`...), which the browser resolves only through an
import map kept in step with each copied package; one bundle from a lockfile is reproducible, one file, and loads
with no build at serve time because it is committed.

## The doc and the notebook (`panel/doc.js`)

Pure functions of the notebook's blocks and the doc -- nothing of the page drawn -- tested by Vitest
(`frontend/src/features/apps/notes-doc.test.ts`).

**The schema:** the doc a run of top-level blocks, each with the block's `id` (and `indent`, `checked` where its type
has them). A line of text is a `line` node and code a `codeblock` (`text` and `code` are ProseMirror's own words and
a mark's); `h1`-`h3`, `todo`, `bullet`, `number`, `quote` as their types. Their content is the line's words: marks `b`,
`i`, `u`, `s`, `code` and `link` (`href`: the URIs `clean()` allows; outermost, so one `<a>` covers the words it
marks), `hard_break` for `<br>`, and `pagelink`, an inline atom for a link to a page (`page:<id>`, its title). Code
is plain text. `divider`, `agents`, `work` and `table` are atoms with nothing typed in them; `image` and `figma` have
the caption as their content. Only what is edited is in the doc: a block's calls, thread, work state, source, picture
and cells stay in the notebook (`state.js`'s `pages`), read by id as before. Each node can be written as HTML (what
the browser's clipboard is given of a copy); the rows on the page are the panel's node views.

- `nodeOf(block)` / `docOf(blocks)`: the notebook to the doc (the words parsed by ProseMirror's DOMParser, whose
  rules are the allowlist); `fieldsOf(node)` and `htmlOf(content)`: the doc to the notebook's fields and words, in
  the HTML `clean()` keeps, as the browser writes it (a line of line breaks alone has no words; a link to a page is
  written with the page's title as it is now).
- `opsOf(old, new)`: a change to the doc as the notebook's ops -- `block.delete` for blocks gone, `block.put` with
  `after` for blocks new, `block.move` for the fewest (those off the longest run kept in order), and `block.put` of
  the fields changed (all of them for a new type, as a line turned into another is put).
- `syncTr(state, nodes)`: the transaction that makes the doc what the notebook says: blocks gone or moved deleted (the
  longest run in order kept), new and moved ones put in, and each kept block changed only where it differs (its
  markup, then its content between the first and last difference) -- so a caret in a line maps through a change to
  words before or after it.
- `selectionAt` / `selectionIn`: a selection by its lines' ids and places in them, found again after a sync.
- `LinesSelection`: whole lines picked, a run of top-level blocks from the anchor's to the head's (as
  `prosemirror-tables`' CellSelection is for cells).

## The view (`panel/editor.js`)

**Rows.** Every block is drawn by a node view as its row always was, made by `page.js`'s `makeRow`: `.blk[data-id]
[data-type]`, its `.gut` (+ and grip), `.mk`, the words (`.tx`, the content DOM), the `.to-btn`, what it was sent
(`.sent`), a `.fold`. What is not words is `contenteditable=false`, and the editor ignores its mutations and events
(the panel's listeners have them, as before); `drawRows` draws those parts of each row from the notebook, as
`updateRow` drew them. A line with no words has `.tx.blank` (its placeholder: ProseMirror keeps a `<br>` in an empty
line, so `:empty` no longer matches), and the row the caret is in `.caret` (the placeholder of a line of text shows
only there, as it did on `:focus`). A link to a page is a node view of its own, drawn by `model.js`'s `drawLink` as
the page is now (gone: the words it was linked with). Lines folded away (ended work items) are not in the doc at all:
the doc is the page's lines shown.

**The notebook to the doc.** `drawPage` draws the doc from the notebook (`drawDoc`: a new page a new state; else
`syncTr`, the selection found again by its lines if they moved), then each row's other parts. A line with words typed
and not yet sent (`send.js`'s `dirty`), or being composed by an input method, is left as the reader has it -- the
rule that the line being typed in is the reader's until its words are sent. Others' ops (`others.js`) are applied to
the notebook as before, and drawn the same way: a caret in a line they change maps through the change.

**The doc to the notebook.** Each transaction the reader makes is compared with the doc before it (`opsOf`): a line's
words alone changed are typing -- `typed()`, sent after a pause, a run of undo, as the `input` event was before;
anything else is one `change()`, one step of undo, with the caret before it kept for that step. Transactions of the
panel's own say what they are (`edit(tr, how)`): words as typed, one change, the selection alone, or the notebook
drawn (no ops of its own). A plugin gives a block with no id, or another's, an id of its own.

**Structural keys are ops.** Enter, Backspace at a line's start, Delete at its end, Tab, ⌘⇧↑↓, ⌘↵, markdown at a
line's start, the / menu, pasting lines: each works out its ops from the notebook and the line's node, as each did
from the DOM, and calls `change()` and `drawPage()`, then puts the caret by line (`caret.js`'s `focusBlock`, the
editor's `caretTo`). So each is one step of undo, as before.

## Undo

`undo.js` keeps its steps: each holds the ops that do a change and those that take it back, and is checked against
how its lines stand now -- a line an agent changed since is left as it is, and the reader told "Can't undo"
(`notes-undo.spec.ts`). Its ops are applied through `change()`, as every change is, and drawn. ProseMirror's history
(`prosemirror-history`) is not used: it maps the reader's steps over others' and undoes them anyway, and doesn't
expose its next event's ranges to refuse it first. The browser's undo never reaches the doc: the editor's keys take
⌘Z ⌘⇧Z (`typing.js`'s `lineKey`), and a `beforeinput` listener the Edit menu's `historyUndo`/`historyRedo`
(`title.js`).

## Lines picked

A `LinesSelection` is the editor's selection while lines are picked, and while it is -- or while a table's cells are
picked -- the view is not editable: no caret, no text selected, `#blocks` focused with the page's keys
(`picked.js`'s document listeners: ⌫, Tab, ⌘D, ⌘↵, ⌘⇧↑↓, Esc, ↵; the clipboard, copied and pasted as lines with
`application/x-ag-notes-blocks`). The editor refuses the browser's selection moving under them; the panel puts them
down (a click elsewhere, Esc). Shift+↑↓ past a line's edge, ⌘A twice, Esc in a line, Shift+click, and words selected
from one line into another set it. A drag -- a sweep from a line's words, a box beside the lines -- marks the lines as
it goes and makes them the selection when it ends, leaving the browser's own drag alone meanwhile (a sweep back into
its own line selects its words, as before). `#pk-bar` stays outside the doc.

## Typing, IME and shortcuts

ProseMirror composes text itself, and its keys and characters typed reach the panel first (`handleKeyDown`:
`typing.js`'s `lineKey`; `handleTextInput`: `textIn`, never during composition). Markdown at a line's start ("# ",
"- ", "[] ", "> ", "```", "---") runs on characters typed. The / menu, `[[` and `@` open on the character typed, and
follow the line as it changes (`slash.js`'s `followMenu`, each transaction): the words typed since narrow them, the
caret leaving them closes them; their places are places in the doc, mapped through each change. Marks toggle with
ProseMirror's `toggleMark` (⌘B ⌘I ⌘U ⌘⇧S ⌘E), and ⌘K's link is a `link` mark. A key pressed right after another the
browser moved the caret with (End, then Enter) first reads the browser's caret into the editor (`readCaret`): the
editor reads a moved caret only as the selection-change event comes. A misspelled word clicked (`spelling.js`) is
found from the browser's caret, and its fix typed as a transaction.

## Tables

A table is an atom the editor doesn't type in: its node view is the table as `tables.js` draws it, and its cells stay
editable elements of their own inside it, unseen by the editor (it ignores their events and mutations, and doesn't
read a selection in them). So each cell is still its own focused element (`notes-tables.spec.ts`), and `tables.js`
types, picks, copies and pastes cells as before, with the DOM helpers of `caret.js` and `typing.js` it shares with the
title. The editor isn't editable while cells are picked (`cellsPicked`), so the page's keys reach them.

## The browser tests

ProseMirror has one contenteditable, its root: with the caret in any line, `document.activeElement` is `#blocks`,
never the line, and a line's words can't be focused (`focus()` on a descendant of an editing host does nothing). So
the tests that checked a line was the focused element now check the caret is in it (`notes-home.ts`'s `caretIn`: the
editor focused and editable, the selection in the line): `notes-work.spec.ts` (the line after a fold),
`notes-pictures.spec.ts` (the line after a pasted picture; a picture's caption), `notes-spelling.spec.ts` (the line a
fix went into). `notes-select.spec.ts` puts the caret in a line by a click, Home and the arrows rather than focusing
it and setting a DOM range; its checks that the page has the keys (`#blocks` focused, which it is while typing too)
also check the lines are not editable. `notes-tables.spec.ts` is unchanged: a table's cells are still elements of
their own.
