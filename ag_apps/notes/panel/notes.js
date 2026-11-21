/* The Notes panel: the gatherer's pages in a sidebar, and the page open, its blocks edited in place (a minimal
Notion). Every change is an op (notebook.py has their list): applied here at once, then sent to the backend, one batch
after another, in order. The backend tells every open panel each batch it applied, in order, numbered (`version`): a
panel skips its own, and applies another window's or an agent's -- never into the block the reader is typing in.

A block can be sent to an agent of the gatherer (`@` in it, or its Send button): its words go as the user's message
(ag.actors, as Chat sends one), ending with a note saying where they are from and asking for a report back. The block
then says who it went to (`to`), and under it, in one line, how that actor stands now and its latest report. Its
conversation -- the user's messages to it (sent to it too), its reports (the backend's notes_report), what it asks,
answered there -- is in a panel beside the page, opened from that line: never on the page itself. The Agents page, and
an `agents` block, show every actor of the gatherer: how it stands, what it was sent from the notes, and its last report.

A line sent to an agent, or marked as one, is a WORK ITEM (notebook.py), and only the reader ends one: they accept it
(a to-do one, ticked), or cancel it. Until then how it stands is read from its actor: needs you, working, queued, to
review (its agent stopped: a report since it was last sent, or none), not started (sent to no one). The Work page lists
every open one by how it stands, the Logbook those ended; on a page the ended ones fold away, a "✓ 3 done" row where
they were, until the reader shows them.

Several lines can be picked at once (whole lines, as Notion's block selection): deleted, copied, cut, indented, moved,
turned into another type or sent to an agent together, as one message naming each of them (picked.js).

⌘Z takes back the reader's own changes to the page open, one at a time, and ⌘⇧Z does them again (undo.js): never the
browser's own undo, which knows nothing of the ops.

A page can hold pictures (pictures.js): an image pasted, dropped or picked from the / menu, kept by the backend, and a
Figma frame or board shown live from its link, with a snapshot the backend keeps of it -- shown when Figma can't show it,
and what agents see of it. The words under either are its caption.

A page's lines are edited in one ProseMirror view (editor.js; DESIGN.md says how): the page drawn from the notebook as
its document (doc.js), and each change made in it the notebook's ops. ProseMirror itself is a bundle the panel imports
(vendor/prosemirror.js, built by assets/src/notes).

The panel is ES modules, this one its entry, loaded after the plain scripts its page loads first (DOMPurify, the
panels' kit, app_kit's SDK), which they read as the globals those set. Each module is a part of the panel -- the
notebook (model.js), sending its ops (send.js), undo, others' changes (others.js), the sidebar, the page (page.js), the
lines' document and editor, the caret, typing, the pop-ups, typos, the / menu (slash.js), [[ links (pagelinks.js), the
gutter, lines picked, the title, pasting, tables, pictures, the actors and work items (actors.js), sending a line to
one (sent.js), lines an agent wrote (source.js), a line's conversation (convo.js), the @ picker (picker.js), the Agents
page, the Work page, links to the notes (links.js) -- and imports what it uses of the others. What more than one of them changes is in state.js, each
with its setter. Nothing runs as they load: start.js connects the panel, sets each module's listeners (its wire
function) in order, and reads the notebook. */
import { start } from "./start.js";

start();
