/* The Notes panel: the gatherer's pages in a sidebar, and the page open, its blocks edited in place (a minimal
Notion). Every change is an op (notebook.py has their list): applied here at once, then sent to the backend, one batch
after another, in order. The backend tells every open panel each batch it applied, in order, numbered (`version`): a
panel skips its own, and applies another window's or an agent's -- never into the block the reader is typing in.

A block can be sent to an agent of the gatherer (`@` in it, or its Send button): its words go as the user's message
(ag.actors, as Chat sends one), ending with a note saying where they are from and asking for a report back. The block
then says who it went to (`to`), and under it, in one line, how that actor stands now and its latest report. Its
conversation -- the user's messages to it (sent to it too), its reports (the backend's notes_report), what it asks,
answered there -- is in a panel beside the page, opened from that line: never on the page itself. The Agents page, and an `agents` block,
show every actor of the gatherer: how it stands, what it was sent from the notes, and its last report.

A line sent to an agent, or marked as one, is a WORK ITEM (notebook.py), and only the reader ends one: they accept it
(a to-do one, ticked), or cancel it. Until then how it stands is read from its actor: needs you, working, queued, to
review (its agent stopped: a report since it was last sent, or none), not started (sent to no one). The Work page lists
every open one by how it stands, the Logbook those ended; on a page the ended ones fold away, a "✓ 3 done" row where
they were, until the reader shows them.

Several lines can be picked at once (whole lines, as Notion's block selection): deleted, copied, cut, indented, moved,
turned into another type or sent to an agent together, as one message naming each of them.

⌘Z takes back the reader's own changes to the page open, one at a time, and ⌘⇧Z does them again (see "undo"): never the
browser's own undo, which knows nothing of the ops.

A page can hold pictures (see "pictures"): an image pasted, dropped or picked from the / menu, kept by the backend, and a
Figma frame or board shown live from its link, with a snapshot the backend keeps of it -- shown when Figma can't show it,
and what agents see of it. The words under either are its caption. */
(async function () {
  "use strict";
  const ag = await AgApp.connect();
  const ME = `p${rid()}`;                                 // this panel: its own batches come back marked with it

  // ---------------------------------------------------------------- small helpers
  const $ = (id) => document.getElementById(id);
  const TYPES = ["text", "h1", "h2", "h3", "todo", "bullet", "number", "quote", "code", "divider"];
  const INDENTED = ["text", "todo", "bullet", "number", "quote"];
  const LISTS = ["todo", "bullet", "number"];
  const MAX_INDENT = 6;
  const PH = { text: "Type ‘/’ for commands", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", todo: "To-do", bullet: "List",
    number: "List", quote: "Quote", code: "Code", image: "Add a caption", figma: "Add a caption" };
  const MEDIA = ["image", "figma"];                        // blocks that show a picture: their words, its caption
  const KINDS = [                                          // the / menu, and a block's "Turn into"
    { type: "text", label: "Text", note: "Just writing", glyph: "Aa", words: "text plain paragraph" },
    { type: "h1", label: "Heading 1", note: "A big section heading", glyph: "H1", words: "h1 heading title" },
    { type: "h2", label: "Heading 2", note: "A medium heading", glyph: "H2", words: "h2 heading subtitle" },
    { type: "h3", label: "Heading 3", note: "A small heading", glyph: "H3", words: "h3 heading" },
    { type: "todo", label: "To-do list", note: "Things to tick off", glyph: "☐", words: "todo to-do check task checkbox" },
    { type: "bullet", label: "Bulleted list", note: "A simple list", glyph: "•", words: "bullet list ul unordered" },
    { type: "number", label: "Numbered list", note: "A list with numbers", glyph: "1.", words: "number numbered list ol ordered" },
    { type: "quote", label: "Quote", note: "Words set apart", glyph: "❝", words: "quote blockquote" },
    { type: "code", label: "Code", note: "Code, as it is typed", glyph: "</>", words: "code snippet pre" },
    { type: "divider", label: "Divider", note: "A line between parts", glyph: "—", words: "divider line rule hr separator" },
    { type: "agents", label: "Agents", note: "Your actors, as they are now", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="6" cy="5.5" r="2.2"/><circle cx="11.5" cy="6.2" r="1.7"/><path d="M2 13c.5-2.3 2-3.4 4-3.4s3.5 1.1 4 3.4M10 9.9c.5-.3 1-.4 1.5-.4 1.5 0 2.5.9 2.9 2.6"/></svg>', words: "agents actors status table team" },
    { type: "work", label: "Work items", note: "What is open, as it stands now", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6.5"/></svg>', words: "work items tasks open tracker board" },
  ];
  const PAGE_KIND = { type: "page-new", label: "Page", note: "A new page inside this one", glyph: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2v3.3h3.3M8.25 7.6v4.2M6.15 9.7h4.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>', words: "page subpage new child doc document" };   // in the / menu too, not a block's type
  const LINK_KIND = { type: "page-link", label: "Link to a page", note: "Or type [[", glyph: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2v3.3h3.3M6 8.2h4.5M6 10.8h4.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>', words: "link page mention reference subpage" };   // in the / menu, not a block's type
  const IMAGE_KIND = { type: "image-new", label: "Image", note: "Upload, paste or drop a picture", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M2.3 11l3.4-3.4 2.8 2.8 1.8-1.8 3.4 3.4" stroke-linecap="round"/><circle cx="10.6" cy="6" r="1.1"/></svg>', words: "image picture photo png jpg screenshot figure upload" };   // in the / menu, not a block's type
  const FIGMA_KIND = { type: "figma-new", label: "Figma", note: "A frame or board, kept live", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M5.5 2v12M10.5 2v12M2 5.5h12M2 10.5h12"/></svg>', words: "figma figjam design frame board embed diagram drawing" };
  const ICONS = ["📄", "📝", "✅", "📌", "📚", "💡", "🎯", "🚀", "🛒", "🏠", "💼", "🧪", "🐛", "🔧", "📅", "⭐", "❤️", "🔥", "🌱", "🎨",
    "🎵", "✈️", "🍳", "💰", "📈", "🧠", "☕", "🗂️", "🔖", "🧩", "🏃", "📖", "🎓", "🧾", "📦", "⚙️", "🗒️", "🌟", "🍀", "🐣"];
  const SVG = {
    plus: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    grip: '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.3"/><circle cx="7.5" cy="2.5" r="1.3"/><circle cx="2.5" cy="7" r="1.3"/><circle cx="7.5" cy="7" r="1.3"/><circle cx="2.5" cy="11.5" r="1.3"/><circle cx="7.5" cy="11.5" r="1.3"/></svg>',
    caret: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3.5 2l3.5 3-3.5 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
    doc: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2v3.3h3.3M6 8.2h4.5M6 10.8h4.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    side: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.8" y="2.5" width="12.4" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 2.8v10.4" stroke="currentColor" stroke-width="1.3"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    restore: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3.5 6.5A5 5 0 1 1 4 11M3.2 3v3.7h3.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    full: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10"/></svg>',
    check: '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    people: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="6" cy="5.5" r="2.2"/><circle cx="11.5" cy="6.2" r="1.7"/><path d="M2 13c.5-2.3 2-3.4 4-3.4s3.5 1.1 4 3.4M10 9.9c.5-.3 1-.4 1.5-.4 1.5 0 2.5.9 2.9 2.6"/></svg>',
    at: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="2.4"/><path d="M10.4 8v1.1a1.7 1.7 0 0 0 3.4 0V8A5.8 5.8 0 1 0 11.5 12.6"/></svg>',
    bubble: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 3h11v7.5H6.5L3 13.5v-3H2.5z"/></svg>',
    send: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8l11-5.5-4 11-1.6-4.4z"/></svg>',
    work: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6.5"/></svg>',
    log: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h7l1.5 1.5v9.5H4z"/><path d="M6.5 8.2l1.3 1.3 2.6-2.8"/></svg>',
    book: '<svg width="44" height="44" viewBox="0 0 44 44"><rect x="9" y="6" width="26" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="13" width="5" height="5" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.2 15.6l1 1 1.7-2M22 15.5h8M14 23.5h16M14 29.5h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function rid() {
    const c = "abcdefghijklmnopqrstuvwxyz0123456789", a = crypto.getRandomValues(new Uint8Array(8));
    let s = "";
    for (const x of a) s += c[x % 36];
    return s;
  }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
    return n;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`notes:${ag.instance}:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`notes:${ag.instance}:${k}`, JSON.stringify(v)); } catch { /* storage off: kept for now only */ } },
  };
  const clean = (h) => window.DOMPurify.sanitize((h || "").replace(/\u200b/g, ""), { ALLOWED_TAGS: ["b", "i", "u", "s", "code", "a", "br"], ALLOWED_ATTR: ["href"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|page:[a-z0-9]{6,24}$)/i })
    .replace(/<(b|i|u|s|code)><\/\1>/g, "").replace(/^(<br>)+$/, "");
  const plainOf = (h) => { const t = document.createElement("template"); t.innerHTML = (h || "").replace(/<br>/g, "\n"); return t.content.textContent; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const now = () => Date.now() / 1000;
  const DASH = new URLSearchParams(location.search).get("host") || "";   // the dashboard's origin: its avatars
  const AGENTS = "@agents";                              // the Agents page (no page of the notebook: never an id)
  const WORK = "@work", LOG = "@logbook";                // the Work page, the Logbook (nor these)
  const SPECIAL = [WORK, LOG, AGENTS];
  const UNSENT = ["divider", "agents", "work", "image", "figma"];   // blocks with nothing in them to send (a caption is no line of work)
  const short = (ch) => String(ch || "").slice(0, 8);
  const since = (t) => { const d = Math.max(0, now() - (t || now())); return d < 60 ? "just now" : d < 3600 ? `${Math.round(d / 60)}m`
    : d < 86400 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`; };
  const clock = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const oneLine = (h, n = 120) => { const t = plainOf(h).replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

  // ---------------------------------------------------------------- the notebook, as this panel has it
  let book = { version: 0, pages: [] };
  const pages = new Map();
  const known = new Map();                               // block id -> its words as last applied or typed (an undo's "before")
  const reindex = () => {
    pages.clear();
    known.clear();
    for (const p of book.pages) { p.blocks = p.blocks || []; pages.set(p.id, p); for (const b of p.blocks) known.set(b.id, b.text); }
  };
  const live = () => book.pages.filter((p) => !p.deleted);
  const kidsOf = (id) => live().filter((p) => (p.parent || null) === id);
  function below(id) {                                   // a page's subpages, theirs, ...
    const out = [], todo = [id];
    while (todo.length) { const here = todo.pop(); for (const p of book.pages) if (p.parent === here && !out.includes(p)) { out.push(p); todo.push(p.id); } }
    return out;
  }
  // A line's links to pages (href "page:<id>", notebook.py's), drawn as the page is now: its icon and title, struck while it
  // is in the trash or gone, and kept whole (not typed into: a click opens the page). What is saved of one is its href and
  // the title (clean() drops the rest).
  const PAGE_HREF = /^page:([a-z0-9]{6,24})$/;
  const pageOfLink = (a) => { const m = PAGE_HREF.exec(a.getAttribute("href") || ""); return m ? m[1] : null; };
  // Beside a link at a line's start or end, a zero-width space: a place for the caret, which Chrome has none for there
  // (never saved: clean() drops it).
  const ZW = "\u200b";
  function withLinks(h) {
    if (!h || !h.includes('href="page:')) return h;
    const t = document.createElement("template");
    t.innerHTML = h;
    drawLinks(t.content);
    for (const a of t.content.querySelectorAll("a.pg")) padLink(a);
    return t.innerHTML;
  }
  const isText = (n) => !!n && n.nodeType === 3 && n.length > 0;
  function padLink(a) {
    if (!isText(a.nextSibling)) a.after(ZW);
    if (!isText(a.previousSibling)) a.before(ZW);
  }
  function drawLinks(root) {                             // (a line being typed in too: the caret is never in a link)
    for (const a of root.querySelectorAll("a")) {
      const id = pageOfLink(a);
      if (!id) continue;
      const p = pages.get(id), cls = `pg${!p ? " gone" : p.deleted ? " binned" : ""}`;
      const tip = !p ? "That page was deleted" : p.deleted ? "In the trash: open it" : "Open the page";
      if (a.className !== cls) a.className = cls;
      if (a.getAttribute("contenteditable") !== "false") a.setAttribute("contenteditable", "false");
      if (p && a.textContent !== (p.title || "Untitled")) a.textContent = p.title || "Untitled";
      if (a.dataset.icon !== (p && p.icon ? p.icon : "")) a.dataset.icon = p && p.icon ? p.icon : "";
      if (a.title !== tip) a.title = tip;
    }
  }
  // whether a page has a link to one of those pages (renamed, binned, ...: the links drawn again)
  const linksTo = (p, ids) => !!p && ids.size > 0 && p.blocks.some((b) => b.text && b.text.includes('href="page:')
    && [...ids].some((id) => b.text.includes(`href="page:${id}"`)));
  // ... and as markdown, `[its title](page:<id>)`, the rest of the line as it was: a line sent to an agent, so it can read the page
  function pagesAsMd(h) {
    if (!h || !h.includes('href="page:')) return h;
    const t = document.createElement("template");
    t.innerHTML = clean(h);
    for (const a of t.content.querySelectorAll("a")) {
      const id = pageOfLink(a), p = id && pages.get(id);
      if (id) a.replaceWith(`[${p ? p.title || "Untitled" : a.textContent}](page:${id})`);
    }
    return t.innerHTML;
  }
  function placeAt(blocks, after) {
    if (after === "") return 0;
    const i = after == null ? -1 : blocks.findIndex((b) => b.id === after);
    return i < 0 ? blocks.length : i + 1;
  }
  // An op applied to the notebook here: the same as the backend applies it (notebook.py's Notebook.apply).
  function apply(op) {
    const p = typeof op.page === "string" ? pages.get(op.page) : null;
    switch (op.op) {
      case "page.new": {
        if (pages.has(op.page.id)) return;
        const made = { title: "", icon: "", parent: null, ...op.page, blocks: (op.blocks || []).map((b) => ({ ...b })) };
        book.pages.push(made);
        pages.set(made.id, made);
        return;
      }
      case "page.set": if (p) for (const k of ["title", "icon", "parent"]) if (k in op) p[k] = op[k]; return;
      case "page.delete":
        for (const id of op.pages || [op.page]) { const q = pages.get(id); if (q) { q.deleted = op.at || now(); q.deleted_with = op.page; } }
        return;
      case "page.restore":
        for (const id of op.pages || [op.page]) { const q = pages.get(id); if (q) { delete q.deleted; delete q.deleted_with; } }
        if (p && "parent" in op) p.parent = op.parent;
        return;
      case "page.purge": {
        const gone = new Set(op.pages || [op.page]);
        book.pages = book.pages.filter((q) => !gone.has(q.id));
        for (const id of gone) pages.delete(id);
        return;
      }
      case "block.put": {
        if (!p) return;
        const b = p.blocks.find((x) => x.id === op.block.id);
        if (b) Object.assign(b, op.block);
        else p.blocks.splice(placeAt(p.blocks, op.after), 0, { type: "text", text: "", checked: false, indent: 0, ...op.block });
        if (!b || "text" in op.block) known.set(op.block.id, op.block.text || "");
        return;
      }
      case "block.move": {
        if (!p) return;
        const i = p.blocks.findIndex((x) => x.id === op.block);
        if (i < 0) return;
        const [b] = p.blocks.splice(i, 1);
        p.blocks.splice(placeAt(p.blocks, op.after), 0, b);
        return;
      }
      case "block.delete": if (p) p.blocks = p.blocks.filter((x) => x.id !== op.block); known.delete(op.block); return;
      case "thread.add": {
        const b = p && p.blocks.find((x) => x.id === op.block);
        if (!b) return;
        b.thread = b.thread || [];
        if (!b.thread.some((l) => l.id === op.line.id)) b.thread.push({ at: now(), ...op.line });
        return;
      }
    }
  }

  // ---------------------------------------------------------------- sending, in order
  const queue = [];                                     // ops applied here, not yet taken by the backend
  const dirty = new Map();                              // block id -> {page, text, timer}: typed, not yet queued
  let titleDirty = null, sending = false, savedTimer = 0, status = "saved";
  let sideSoon = 0;
  function change(ops, undoable = true) {               // applied here, and sent after what was typed before it; a step
    flushTyped();                                       // ⌘Z takes back, unless it can't be (a line sent to an agent)
    const step = undoable && !replaying ? stepOf(ops) : null;
    for (const op of ops) { if (step) takeBackOf(step, op); apply(op); }
    queue.push(...ops);
    pump();
    if (step) keep(step);
    if (!sideSoon) sideSoon = requestAnimationFrame(() => { sideSoon = 0; drawSide(); });   // its to-dos counted again
  }
  function typed(page, id, text) {
    wordsTyped(page, id, text);
    const d = dirty.get(id);
    if (d) clearTimeout(d.timer);
    dirty.set(id, { page, text, timer: setTimeout(() => sendTyped(id), 450) });
    saved("saving");
  }
  function sendTyped(id) {
    const d = dirty.get(id);
    if (!d) return;
    clearTimeout(d.timer);
    dirty.delete(id);
    queue.push({ op: "block.put", page: d.page, block: { id, text: d.text } });
    pump();
  }
  function forget(id) { const d = dirty.get(id); if (d) { clearTimeout(d.timer); dirty.delete(id); } }
  function flushTyped() {
    for (const id of [...dirty.keys()]) sendTyped(id);
    if (titleDirty) { clearTimeout(titleDirty.timer); queue.push({ op: "page.set", page: titleDirty.page, title: titleDirty.title }); titleDirty = null; }
  }

  // ---------------------------------------------------------------- undo
  // ⌘Z takes back the reader's last change to the page open, ⌘⇧Z does it again -- never the browser's own undo, which
  // knows nothing of the lines' ops (after a line was moved, it took letters out of another). A step is a change() to the
  // page's lines (moved, split, joined, pasted, cut, indented, ticked, turned into another type...) or to its title or
  // icon, or a run of typing in one line or the title (until a pause, or another line). It holds the ops that do it and
  // those that take it back, worked out from the page as it was just before. If a line it touched has changed since (an
  // agent's change, another window's), the step is left as it is, and the reader told: nobody else's words are undone.
  // Not steps: a line sent to an agent, or canceled (its message can't be taken back), conversations, pages made, binned
  // or restored. One history per page, for as long as the panel is open.
  const PAUSE = 1000;                                      // a run of typing ends after this long without a key
  const LINE = ["type", "text", "checked", "indent"];      // what tells whether a line changed since
  const BLANK = { type: "text", text: "", checked: false, indent: 0, to: "", sent: "", extra: "", group: "", work: false, ended: "", ended_at: "" };
  const histories = new Map();                             // page id -> {done: [step], undone: [step]}
  let run = null, replaying = false;                       // run: the step keys typed are adding to {step, key, page, at}
  const historyOf = (id) => { if (!histories.has(id)) histories.set(id, { done: [], undone: [] }); return histories.get(id); };
  const blockId = (op) => (typeof op.block === "string" ? op.block : op.block.id);
  const copied = (x) => JSON.parse(JSON.stringify(x));
  // how lines (and "@page": the title and icon) stand now, to be told apart from how a step left them
  function standing(p, ids) {
    const m = new Map();
    for (const id of ids) {
      if (id === "@page") { m.set(id, JSON.stringify([p.title || "", p.icon || ""])); continue; }
      const b = p.blocks.find((x) => x.id === id);
      m.set(id, b ? JSON.stringify(LINE.map((k) => (k === "text" ? known.get(id) ?? b.text : b[k] ?? BLANK[k]))) : "gone");
    }
    return m;
  }
  function caretNow() {                                    // where the reader is typing: a line (or "@title"), and where in it
    const a = document.activeElement, tx = a === title ? title : a && box.contains(a) && a.closest(".tx");
    if (!tx) return null;
    const c = caretIn(tx);
    return { id: tx === title ? "@title" : tx.closest(".blk").dataset.id, at: c ? c.start : null };
  }
  function record(h, step) {
    h.done.push(step);
    h.undone.length = 0;
    if (h.done.length > 500) h.done.shift();
  }
  // -- a change(): its step begun, each op's way back worked out before it is applied, and the step kept
  function stepOf(ops) {
    const p = page(), mine = (op) => op.page === current && (op.op.startsWith("block.") || op.op === "page.set");
    if (!p || p.deleted || !ops.some(mine)) return null;
    const ids = [...new Set(ops.filter(mine).map((op) => (op.op === "page.set" ? "@page" : blockId(op))))];
    return { page: p.id, ids, fwd: [], back: [], before: standing(p, ids), pick: picked.size ? [...picked] : null, caret: caretNow() };
  }
  function takeBackOf(step, op) {
    const p = pages.get(step.page);
    if (!p || op.page !== step.page) return;
    let back = null;
    if (op.op === "page.set") {
      back = { op: "page.set", page: p.id };
      for (const k of ["title", "icon", "parent"]) if (k in op) back[k] = k === "parent" ? p.parent || null : p[k] || "";
      if (Object.keys(back).every((k) => k === "op" || k === "page" || back[k] === (op[k] ?? back[k]))) return;
    } else if (["block.put", "block.delete", "block.move"].includes(op.op)) {
      const i = p.blocks.findIndex((x) => x.id === blockId(op)), b = p.blocks[i], prev = i > 0 ? p.blocks[i - 1].id : "";
      if (op.op === "block.put" && !b) back = { op: "block.delete", page: p.id, block: op.block.id };
      else if (!b) return;
      else if (op.op === "block.put") {
        const was = { id: b.id };
        for (const k of Object.keys(op.block)) if (k !== "id") was[k] = copied(k === "text" ? known.get(b.id) ?? b.text : b[k] ?? BLANK[k] ?? "");
        if (Object.keys(was).every((k) => JSON.stringify(was[k]) === JSON.stringify(op.block[k]))) return;   // (as it was)
        back = { op: "block.put", page: p.id, block: was };
      } else if (op.op === "block.delete") back = { op: "block.put", page: p.id, block: copied({ ...b, text: known.get(b.id) ?? b.text }), after: prev };
      else if (op.after === prev) return;
      else back = { op: "block.move", page: p.id, block: b.id, after: prev };
    } else return;
    step.fwd.push(copied(op));
    step.back.unshift(back);
  }
  function keep(step) {
    run = null;                                            // a run of typing ends at any other change
    const p = pages.get(step.page);
    if (!p || !step.back.length) return;
    step.after = standing(p, step.ids);
    record(historyOf(step.page), step);
    requestAnimationFrame(() => { step.caretAfter = caretNow(); step.pickAfter = picked.size ? [...picked] : null; });
  }
  // -- typing: each key's change to a line's words (or the title) added to the run it belongs to
  function inRun(p, key, back) {                           // (before the words change: how they stood is the step's "before")
    const h = historyOf(p.id), at = Date.now();
    if (!(run && run.key === key && run.page === p.id && at - run.at <= PAUSE && h.done[h.done.length - 1] === run.step)) {
      const step = { page: p.id, ids: [key], fwd: [], back: [back], before: standing(p, [key]), pick: null, caret: null, words: true };
      record(h, step);
      run = { step, key, page: p.id };
    }
    run.at = at;
    return run.step;
  }
  function wordsTyped(pid, id, text) {
    const p = pages.get(pid), was = known.has(id) ? known.get(id) : text;
    if (!replaying && p && !p.deleted && pid === current && was !== text) {
      const step = inRun(p, id, { op: "block.put", page: pid, block: { id, text: was } });
      known.set(id, text);
      step.fwd = [{ op: "block.put", page: pid, block: { id, text } }];
      step.after = standing(p, [id]);
    } else known.set(id, text);
  }
  function titleTyped(p, was) {                            // (after the title changed, from `was`)
    if (replaying || p.deleted || p.id !== current || was === (p.title || "")) return;
    const now = p.title;
    p.title = was;
    const step = inRun(p, "@page", { op: "page.set", page: p.id, title: was });
    p.title = now;
    step.fwd = [{ op: "page.set", page: p.id, title: now }];
    step.after = standing(p, ["@page"]);
  }
  // -- ⌘Z, ⌘⇧Z
  function undoStep(again = false) {
    const p = page();
    if (!p || p.deleted || SPECIAL.includes(current)) return;
    flushTyped();
    run = null;
    const h = historyOf(p.id), step = (again ? h.undone : h.done).pop();
    if (!step) return;
    const now = standing(p, step.ids), want = again ? step.before : step.after;
    if (step.ids.some((id) => now.get(id) !== want.get(id))) {
      say(again ? "Not redone: those lines have changed since" : "Not undone: those lines have changed since", true);
      return;
    }
    const a = document.activeElement;                      // drawn afresh: no line kept back as being typed in
    if (a && (a === title || box.contains(a))) box.focus({ preventScroll: true });
    replaying = true;
    try { change(copied(again ? step.fwd : step.back)); } finally { replaying = false; }
    (again ? h.done : h.undone).push(step);
    unpick();
    drawSide();
    drawPage();
    placeAfter(step, again);
  }
  function placeAfter(step, again) {                       // the reader back where the step was: its lines picked, or the caret
    const pick = (again ? step.pickAfter : step.pick || []) || [], ids = pick.filter((id) => blockOf(id));
    if (ids.length) { pickRange(ids[0], ids[ids.length - 1]); return holdKeys(); }
    if (step.words) {                                     // where the words changed, at the end of what is there now
      const op = again ? step.fwd[0] : step.back[0], other = again ? step.back[0] : step.fwd[0];
      const plain = (o) => (o.op === "page.set" ? o.title || "" : (blockOf(o.block.id) || {}).type === "code" ? o.block.text : plainOf(o.block.text || ""));
      const s = plain(op), t = plain(other);
      let same = 0;
      while (same < s.length && same < t.length && s[s.length - 1 - same] === t[t.length - 1 - same]) same++;
      if (op.op === "page.set") { title.focus(); return setCaret(title, Math.min(s.length - same, title.textContent.length)); }
      return focusBlock(op.block.id, Math.max(0, s.length - same));
    }
    const c = again ? step.caretAfter : step.caret;
    if (c && c.id === "@title") { title.focus(); return setCaret(title, Math.min(c.at ?? title.textContent.length, title.textContent.length)); }
    if (c && blockOf(c.id)) return focusBlock(c.id, c.at ?? "end");
    const near = step.ids.find((id) => blockOf(id));
    if (near) focusBlock(near, "end");
  }
  async function pump(keepalive = false) {
    if (sending) return;
    if (!queue.length) { if (!dirty.size && !titleDirty && status !== "saved") saved("saved"); return; }
    sending = true;
    saved("saving");
    const ops = queue.splice(0, queue.length);
    let refused = null;
    try {
      const r = await ag.api("ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ by: ME, ops }), keepalive });
      if (r.status >= 400 && r.status < 500) refused = (await r.json().catch(() => ({}))).error || `refused (${r.status})`;
      else if (!r.ok) throw new Error(`${r.status}`);
    } catch {
      queue.unshift(...ops);                            // not reached: tried again, in the same order
      sending = false;
      saved("retry");
      setTimeout(() => pump(), 2500);
      return;
    }
    sending = false;
    if (refused) { console.error("notes: a change refused:", refused, ops); await resync(); }
    pump();
  }
  function saved(how) {
    const s = $("saved");
    status = how;
    clearTimeout(savedTimer);
    s.classList.remove("quiet", "bad");
    if (how === "saving") s.textContent = "Saving…";
    else if (how === "retry") { s.textContent = "Not saved yet: trying again"; s.classList.add("bad"); }
    else { s.textContent = "Saved"; savedTimer = setTimeout(() => s.classList.add("quiet"), 1400); }
  }
  addEventListener("pagehide", () => { flushTyped(); pump(true); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { flushTyped(); pump(true); } });

  // ---------------------------------------------------------------- what others change
  let ready = false;
  const early = [];
  ag.onMessage((m) => {
    if (!m || !Array.isArray(m.ops)) return;
    if (!ready) early.push(m);
    else heard(m);
  });
  function heard(m) {
    if (m.version <= book.version) return;
    const gap = m.version !== book.version + 1;          // a batch missed: everything read again, after these
    book.version = m.version;
    if (m.by !== ME) {
      const touched = new Set(), blocks = new Set(), retitled = new Set();
      for (const op of m.ops) {
        apply(op);
        touched.add(typeof op.page === "string" ? op.page : op.page && op.page.id);
        if (op.op === "block.put") blocks.add(op.block.id);
        if (op.op === "block.move" || op.op === "thread.add") blocks.add(op.block);
        if (op.op.startsWith("page.")) for (const id of op.pages || [typeof op.page === "string" ? op.page : op.page.id]) retitled.add(id);
      }
      if (current && !pages.has(current)) current = null;
      drawSide(m.agent ? touched : null);
      if (current && touched.has(current)) drawPage(m.quiet ? null : blocks);   // (a snapshot fetched again: no flash)
      else if (!current || SPECIAL.includes(current) || linksTo(pages.get(current), retitled)) drawPage();
      if (m.agent) told(m.agent, [...touched].map((id) => pages.get(id)).filter(Boolean));
    }
    if (gap) resync();
  }
  let whoTimer = 0;
  function told(channel, changed) {
    const st = ag.agents.state(channel), a = actorOf(channel);
    const name = a ? nameOf(a, channel) : (st && st.name) || "An agent";
    const what = changed.length === 1 ? `“${changed[0].title || "Untitled"}”` : changed.length ? `${changed.length} pages` : "the notes";
    const w = $("who");
    w.textContent = `${name} changed ${what}`;
    w.style.opacity = "1";
    clearTimeout(whoTimer);
    whoTimer = setTimeout(() => { w.style.opacity = "0"; setTimeout(() => { if (w.style.opacity === "0") w.textContent = ""; }, 450); }, 6000);
  }
  async function resync() {
    let got;
    try { got = await (await ag.api("state")).json(); } catch { return; }
    if (!got || !Array.isArray(got.pages) || got.version < book.version) return;
    book = got;
    reindex();
    for (const op of queue) apply(op);                   // what this window has not sent yet stays as it has it
    for (const [id, d] of dirty) { const p = pages.get(d.page); const b = p && p.blocks.find((x) => x.id === id); if (b) { b.text = d.text; known.set(id, d.text); } }
    if (titleDirty && pages.get(titleDirty.page)) pages.get(titleDirty.page).title = titleDirty.title;
    if (current && !pages.has(current)) current = null;
    drawSide();
    drawPage();
  }

  // ---------------------------------------------------------------- the sidebar
  let current = null;
  const opened = new Set(store.get("open", []));
  let trashOpen = false;
  function drawSide(flash = null) {
    const tree = $("tree"), q = $("find").value.trim().toLowerCase();
    tree.replaceChildren();
    const row = (p, depth, flat = false) => {
      const kids = flat ? [] : kidsOf(p.id);
      const open = opened.has(p.id);
      const todos = p.blocks.filter((b) => b.type === "todo"), left = todos.filter((b) => !b.checked).length;
      const r = el("div", { class: `pg-row${p.id === current ? " on" : ""}`, role: "treeitem", "data-id": p.id, style: `--d:${depth}`,
        "aria-selected": String(p.id === current), ...(kids.length ? { "aria-expanded": String(open) } : {}),
        onclick: () => openPage(p.id) },
        el("button", { class: `caret${kids.length ? "" : " none"}${open ? " open" : ""}`, type: "button", tabindex: "-1",
          "aria-label": open ? "Fold" : "Unfold", html: SVG.caret,
          onclick: (ev) => { ev.stopPropagation(); fold(p.id, !open); } }),
        el("span", { class: "ic", ...(p.icon ? { text: p.icon } : { html: SVG.doc }) }),
        el("span", { class: `nm${p.title ? "" : " untitled"}`, text: p.title || "Untitled" }),
        left ? el("span", { class: "count", title: `${left} of ${todos.length} to-dos open`, text: String(left) }) : null,
        el("span", { class: "acts" },
          el("button", { type: "button", title: "Add a page inside", "aria-label": "Add a page inside", html: SVG.plus,
            onclick: (ev) => { ev.stopPropagation(); newPage(p.id); } }),
          el("button", { type: "button", title: "More", "aria-label": "More", html: SVG.more,
            onclick: (ev) => { ev.stopPropagation(); pageMenu(p, ev.currentTarget); } })));
      if (flash && flash.has(p.id)) r.classList.add("flash");
      tree.append(r);
      if (open) for (const k of kids) row(k, depth + 1);
    };
    if (!q) tree.append(workEntry(), logEntry(), agentsEntry(), ...(live().length ? [el("div", { class: "tree-hd", text: "Pages" })] : []));
    if (q) {
      const hits = live().filter((p) => (p.title || "").toLowerCase().includes(q) || p.blocks.some((b) => plainOf(b.text).toLowerCase().includes(q)));
      for (const p of hits) row(p, 0, true);
      if (!hits.length) tree.append(el("div", { class: "tree-none", text: "No page has that" }));
    } else {
      for (const p of kidsOf(null)) row(p, 0);
      if (!live().length) tree.append(el("div", { class: "tree-none", text: "No pages yet" }));
    }
    const binned = book.pages.filter((p) => p.deleted && p.deleted_with === p.id);
    $("trash-btn").replaceChildren(el("span", { html: SVG.trash }), el("span", { text: "Trash" }),
      binned.length ? el("span", { class: "n", text: String(binned.length) }) : "");
    $("trash-btn").setAttribute("aria-expanded", String(trashOpen));
    const trash = $("trash");
    trash.hidden = !trashOpen;
    trash.replaceChildren(...(binned.length ? binned.map((p) => el("div", { class: "trash-row" },
      el("span", { class: "nm", text: `${p.icon ? p.icon + " " : ""}${p.title || "Untitled"}`, title: "Open it", onclick: () => openPage(p.id) }),
      el("button", { type: "button", title: "Restore", "aria-label": "Restore", html: SVG.restore, onclick: () => restore(p) }),
      el("button", { type: "button", title: "Delete for good", "aria-label": "Delete for good", html: SVG.x, onclick: () => purge(p) })))
      : [el("div", { class: "trash-none", text: "Nothing in the trash" })]));
  }
  function fold(id, open) {
    if (open) opened.add(id); else opened.delete(id);
    store.set("open", [...opened]);
    drawSide();
  }
  $("find").addEventListener("input", () => drawSide());
  $("trash-btn").addEventListener("click", () => { trashOpen = !trashOpen; drawSide(); });
  $("new-page").innerHTML = SVG.plus;
  $("new-page").addEventListener("click", () => newPage(null));
  $("empty-new").addEventListener("click", () => newPage(null));
  document.querySelector(".empty-mark").innerHTML = SVG.book;
  $("side-toggle").innerHTML = SVG.side;
  const narrow = () => matchMedia("(max-width: 600px)").matches;
  const app = $("app");
  document.querySelector(".main").addEventListener("mousedown", (ev) => { if (!ev.target.closest("#side-toggle")) app.classList.remove("side-on"); });
  if (store.get("side", true) === false) app.classList.add("side-off");
  $("side-toggle").addEventListener("click", () => {
    if (narrow()) return app.classList.toggle("side-on");
    app.classList.toggle("side-off");
    store.set("side", !app.classList.contains("side-off"));
  });

  function newPage(parent) {
    const p = { id: rid(), title: "", icon: "", parent };
    change([{ op: "page.new", page: p, blocks: [{ id: rid(), type: "text", text: "", checked: false, indent: 0 }] }]);
    if (parent) { opened.add(parent); store.set("open", [...opened]); }
    openPage(p.id);
    $("title").focus();
  }
  function trashPage(p) {
    const gone = [p, ...below(p.id).filter((q) => !q.deleted)];
    change([{ op: "page.delete", page: p.id, at: now(), pages: gone.map((q) => q.id) }]);
    if (gone.some((q) => q.id === current)) {
      const up = p.parent && pages.get(p.parent);
      current = up && !up.deleted ? up.id : (kidsOf(null)[0] || {}).id || null;
    }
    drawSide();
    drawPage();
  }
  function restore(p) {
    const back = book.pages.filter((q) => q.deleted && q.deleted_with === p.deleted_with && (q === p || below(p.id).includes(q)));
    const up = p.parent && pages.get(p.parent);
    change([{ op: "page.restore", page: p.id, pages: back.map((q) => q.id), parent: up && !up.deleted ? p.parent : null }]);
    drawSide();
    drawPage();
  }
  function purge(p) {
    change([{ op: "page.purge", page: p.id, pages: [p.id, ...below(p.id).map((q) => q.id)] }]);
    if (!pages.has(current)) current = (kidsOf(null)[0] || {}).id || null;
    drawSide();
    drawPage();
  }
  function pageMenu(p, button) {
    const row = button.closest(".pg-row");
    row.classList.add("menu-open");
    popUp(button.getBoundingClientRect(), (box) => {
      box.append(
        item({ glyph: SVG.plus, sm: true, label: "Add a page inside" }, () => newPage(p.id)),
        item({ glyph: SVG.trash, sm: true, label: "Move to trash", bad: true }, () => trashPage(p)));
    }, () => row.classList.remove("menu-open"));
  }

  // ---------------------------------------------------------------- the page
  function openPage(id) {
    flushTyped();
    pump();
    if (current !== id) unpick();
    if (convo && convo.page !== id) convo = null;         // a line's conversation: on its own page only
    current = id;
    store.set("page", id);
    for (let p = pages.get(id); p && p.parent; p = pages.get(p.parent)) opened.add(p.parent);
    if (narrow()) app.classList.remove("side-on");
    drawSide();
    drawPage();
    $("scroll").scrollTop = 0;
  }
  function drawPage(flash = null) {
    $("agents-page").hidden = current !== AGENTS;
    $("work-page").hidden = current !== WORK && current !== LOG;
    if (SPECIAL.includes(current)) {
      for (const id of ["empty", "page", "banner", "done-btn"]) $(id).hidden = true;
      $("crumbs").replaceChildren(el("button", { type: "button", text: current === AGENTS ? "Agents" : current === WORK ? "Work" : "Logbook" }));
      if (current === AGENTS) drawAgentsPage(); else drawWorkPage();
      return drawConvo();
    }
    const p = current && pages.get(current);
    const none = !live().length && !p;
    $("empty").hidden = !none;
    $("page").hidden = !p;
    $("banner").hidden = !(p && p.deleted);
    drawCrumbs(p);
    drawDoneBtn(p);
    if (!p) { $("blocks").replaceChildren(); $("fold-all").hidden = true; return drawConvo(); }
    const ro = !!p.deleted;
    $("page").classList.toggle("ro", ro);
    if (ro) $("banner").replaceChildren(el("span", { text: "This page is in the trash." }),
      el("button", { type: "button", text: "Restore", onclick: () => restore(pages.get(p.deleted_with) || p) }),
      el("button", { type: "button", text: "Delete for good", onclick: () => purge(pages.get(p.deleted_with) || p) }));
    const title = $("title");
    title.setAttribute("contenteditable", ro ? "false" : "plaintext-only");
    if (document.activeElement !== title && title.textContent !== (p.title || "")) title.textContent = p.title || "";
    $("icon").hidden = !p.icon;
    $("icon").textContent = p.icon || "";
    $("add-icon").hidden = !!p.icon || ro;
    drawBlocks(p, flash, ro);
    drawConvo();
  }
  function drawCrumbs(p) {
    const trail = [];
    for (let q = p; q; q = q.parent ? pages.get(q.parent) : null) trail.unshift(q);
    const c = $("crumbs");
    c.replaceChildren();
    trail.forEach((q, i) => {
      if (i) c.append(el("span", { class: "sep", text: "/" }));
      c.append(el("button", { type: "button", text: `${q.icon ? q.icon + " " : ""}${q.title || "Untitled"}`, onclick: () => openPage(q.id) }));
    });
  }
  const box = $("blocks");
  const rowOf = (id) => box.querySelector(`.blk[data-id="${CSS.escape(id)}"]`);
  const page = () => current && pages.get(current);
  const blockOf = (id) => { const p = page(); return p && p.blocks.find((b) => b.id === id); };
  const picked = new Set();                                // the lines picked: a run of the page's, `anchor` to `head`
  let anchor = null, head = null;
  function makeRow(b) {
    const gut = el("div", { class: "gut" },
      el("button", { class: "add", type: "button", tabindex: "-1", title: "Add a block below", "aria-label": "Add a block below", html: SVG.plus }),
      el("button", { class: "grip", type: "button", tabindex: "-1", title: "Drag to move, click for more", "aria-label": "Move, or more", html: SVG.grip }));
    const n = el("div", { class: "blk", "data-id": b.id }, gut);
    if (b.type === "divider") n.append(el("div", { class: "hr", tabindex: "0", role: "separator" }));
    else if (b.type === "agents") n.append(el("div", { class: "agt", tabindex: "0", role: "group", "aria-label": "The gatherer's actors" }));
    else if (b.type === "work") n.append(el("div", { class: "agt wkb", tabindex: "0", role: "group", "aria-label": "Your open work items" }));
    else if (MEDIA.includes(b.type)) n.append(el("div", { class: "fig", tabindex: "0", role: "figure" }), el("div", { class: "tx cap", spellcheck: "true" }));
    else n.append(el("div", { class: "mk" }), el("div", { class: "tx", spellcheck: "true" }),
      el("button", { class: "to-btn", type: "button", tabindex: "-1", title: "Send it to an agent (or type @)", html: SVG.at }));
    return n;
  }
  function updateRow(n, b, ro) {
    n.dataset.type = b.type;
    n.style.setProperty("--ind", b.indent || 0);
    n.classList.toggle("done", b.type === "todo" && !!b.checked);
    n.classList.toggle("ended", crossed(b));
    n.classList.toggle("is-sent", !!b.to || outgoing.has(b.id));
    n.classList.toggle("ro", !!ro);
    if (b.type === "agents") return drawAgentsBlock(n);
    if (b.type === "work") return drawWorkBlock(n);
    const tx = n.querySelector(".tx");
    if (!tx) return;
    const to = n.querySelector(".to-btn");                 // its words drawn by the style: not the block's text
    if (to) { to.dataset.label = b.type === "todo" ? "Assign" : "Ask"; to.setAttribute("aria-label", `${to.dataset.label}: send it to an agent`); }
    n.classList.toggle("picked", picked.has(b.id));
    sentPart(n, b, ro);
    tx.setAttribute("contenteditable", ro ? "false" : b.type === "code" ? "plaintext-only" : "true");
    tx.dataset.ph = PH[b.type] || "";
    if (tx !== document.activeElement && !dirty.has(b.id)) {
      if (b.type === "code") { if (tx.textContent !== b.text) tx.textContent = b.text; }
      else { const h = withLinks(clean(b.text)); if (tx.innerHTML !== h) tx.innerHTML = h; }
    } else if (b.type !== "code") drawLinks(tx);
    if (MEDIA.includes(b.type)) return drawMedia(n, b, ro);
    const mk = n.querySelector(".mk");
    const want = b.type === "todo" ? `todo:${!!b.checked}` : b.type === "bullet" ? `bullet:${(b.indent || 0) % 3}` : b.type;
    if (mk.dataset.is !== want) {
      mk.dataset.is = want;
      mk.replaceChildren();
      if (b.type === "todo") mk.append(el("button", { class: "chk", type: "button", role: "checkbox", tabindex: "-1",
        "aria-checked": String(!!b.checked), "aria-label": b.checked ? "Done" : "To do", html: SVG.check }));
      else if (b.type === "bullet") mk.append(el("span", { class: `dot d${(b.indent || 0) % 3}` }));
    }
  }
  // The page's blocks drawn as the notebook has them: rows kept, moved, made or removed, but the one typed in left
  // as the reader has it (it is theirs until it is sent). Lines folded away (`foldOf`) are not drawn: a fold says
  // where they are.
  function drawBlocks(p, flash, ro) {
    foldedNow = foldOf(p);
    const have = new Map([...box.children].map((n) => [n.dataset.id, n]));
    const want = new Set(p.blocks.filter((b) => !foldedNow.has(b.id)).map((b) => b.id));
    const focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement : null;
    const at = focus && focus.classList.contains("tx") ? caretIn(focus) : null;
    for (const [id, n] of have) if (!want.has(id)) n.remove();
    let prev = null;
    const shape = (t) => (["divider", "agents", "work", ...MEDIA].includes(t) ? t : "tx");
    for (const b of p.blocks) {
      if (foldedNow.has(b.id)) continue;
      let n = have.get(b.id);
      if (n && shape(n.dataset.type) !== shape(b.type)) { n.remove(); n = null; }
      if (!n) n = makeRow(b);
      updateRow(n, b, ro);
      const there = prev ? prev.nextSibling : box.firstChild;
      if (n !== there) box.insertBefore(n, there);
      prev = n;
      if (flash && flash.has(b.id)) { n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash"); }
    }
    drawFolds(p);
    numbers(p);
    drawPicked();
    if (focus && focus.isConnected && document.activeElement !== focus) {
      focus.focus();
      if (at) setCaret(focus, at.start, at.end);
    }
  }
  function numbers(p) {
    const counts = new Map();
    for (const b of p.blocks) {
      const k = b.indent || 0;
      for (const d of [...counts.keys()]) if (d > k) counts.delete(d);
      if (b.type !== "number") { counts.delete(k); continue; }
      counts.set(k, (counts.get(k) || 0) + 1);
      const mk = rowOf(b.id) && rowOf(b.id).querySelector(".mk");
      if (mk) mk.textContent = `${counts.get(k)}.`;
    }
  }
  // -- ended work items, folded away: a page's, unless the reader shows them (the bar's "Show done", or a fold)
  let foldedNow = new Set();                               // the lines of the page shown folded away now
  const doneShown = new Set(store.get("doneShown", []));   // pages whose ended lines the reader shows
  function showDone(pid, on) {
    if (on) doneShown.add(pid); else doneShown.delete(pid);
    store.set("doneShown", [...doneShown]);
  }
  // The lines folded away on a page: the work items the reader ticked (`crossed`), and what is set in under one -- but
  // an open work item.
  function foldOf(p) {
    const out = new Set();
    if (!p || doneShown.has(p.id)) return out;
    let under = null;
    for (const b of p.blocks) {
      const k = b.indent || 0;
      if (under !== null && k > under && !(isWork(b) && !endedOf(b))) { out.add(b.id); continue; }
      under = null;
      if (crossed(b)) { out.add(b.id); under = k; }
    }
    return out;
  }
  // the page as the reader sees it: its lines less those folded away (what the keys move among, and pick)
  const shown = () => { const p = page(); return p && { ...p, blocks: p.blocks.filter((b) => !foldedNow.has(b.id)) }; };
  // A fold for each run of lines folded away: in the line above them (at the top: the first line shown; every line
  // folded: alone), saying how many were done and canceled. A click shows them.
  function drawFolds(p) {
    for (const f of box.querySelectorAll(":scope > .blk > .fold")) f.remove();
    const all = $("fold-all");
    all.hidden = true;
    if (!foldedNow.size) return;
    const runs = [];
    let prev = null, run = null;
    for (const b of p.blocks) {
      if (!foldedNow.has(b.id)) { prev = b; run = null; continue; }
      if (!run) { run = { after: prev, items: [] }; runs.push(run); }
      run.items.push(b);
    }
    const first = p.blocks.find((b) => !foldedNow.has(b.id));
    for (const r of runs) {
      const f = foldRow(p, r.items), at = r.after || first;
      const n = at && rowOf(at.id);
      if (!n) { all.replaceChildren(f); all.hidden = false; continue; }
      f.classList.toggle("top", !r.after);
      f.style.setProperty("--fi", Math.max(0, (r.items[0].indent || 0) - (at.indent || 0)));
      n.append(f);
    }
  }
  function foldRow(p, items) {
    const d = items.filter((b) => endedOf(b) === "done").length, c = items.filter((b) => endedOf(b) === "canceled").length;
    const said = [d ? `${d} done` : "", c ? `${c} canceled` : ""].filter(Boolean).join(" · ") || `${items.length} folded`;
    return el("div", { class: "fold" }, el("button", { type: "button", title: "Show the lines done or canceled on this page", "aria-label": `${said}: show them`,
      onclick: () => { showDone(p.id, true); drawPage(); } }, el("span", { html: SVG.check }), el("span", { text: said })));
  }
  function drawDoneBtn(p) {
    const btn = $("done-btn"), n = p && !p.deleted ? p.blocks.filter(crossed).length : 0;
    btn.hidden = !n;
    if (!n) return;
    const on = doneShown.has(p.id);
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? "Fold away the lines done or canceled" : "Show the lines done or canceled";
    btn.replaceChildren(el("span", { class: "sw", "aria-hidden": "true" }), el("span", { text: `Show done (${n})` }));
  }
  $("done-btn").addEventListener("click", () => { const p = page(); if (!p) return; showDone(p.id, !doneShown.has(p.id)); drawPage(); });
  $("fold-all").addEventListener("animationend", (ev) => ev.target.classList.remove("flash"));
  box.addEventListener("animationend", (ev) => ev.target.classList.remove("flash"));
  $("tree").addEventListener("animationend", (ev) => ev.target.classList.remove("flash"));

  // ---------------------------------------------------------------- the caret
  function caretIn(tx) {
    const s = getSelection();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!tx.contains(r.startContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(tx);
    pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    pre.setEnd(r.endContainer, r.endOffset);
    return { start, end: pre.toString().length, collapsed: r.collapsed };
  }
  function pointAt(tx, n) {
    const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT);
    let node, last = null;
    while ((node = w.nextNode())) { if (n <= node.length) return besideLink(tx, node, n); n -= node.length; last = node; }
    return last ? besideLink(tx, last, last.length) : { node: tx, offset: tx.childNodes.length };
  }
  function besideLink(tx, node, n) {                     // a point in a link to a page: before it (at its start), else after it
    const a = node.parentElement && node.parentElement.closest("a.pg");
    if (!a || !tx.contains(a)) return { node, offset: n };
    const i = [...a.parentNode.childNodes].indexOf(a);
    return { node: a.parentNode, offset: n ? i + 1 : i };
  }
  function setCaret(tx, start, end = start) {
    const a = pointAt(tx, start), z = pointAt(tx, end), r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  function edge(tx, atEnd) {                              // nothing (no text, no line break) between the caret and an end
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return false;
    const r = s.getRangeAt(0), part = document.createRange();
    part.selectNodeContents(tx);
    if (atEnd) part.setStart(r.endContainer, r.endOffset); else part.setEnd(r.startContainer, r.startOffset);
    const f = part.cloneContents();
    return f.textContent.replace(/\u200b/g, "") === "" && !f.querySelector("br");
  }
  function onLine(tx, last) {                             // the caret on the first (or last) line of the block
    const s = getSelection();
    if (!s.rangeCount) return true;
    const rects = s.getRangeAt(0).getClientRects();
    const r = rects[last ? rects.length - 1 : 0];
    if (!r) return true;
    const t = tx.getBoundingClientRect(), lh = parseFloat(getComputedStyle(tx).lineHeight) || 22;
    return last ? t.bottom - r.bottom < lh * 0.9 : r.top - t.top < lh * 0.9;
  }
  function focusOnEdge(tx, last) {                        // the selection's moving end on the first (or last) row of the block
    const s = getSelection();
    if (!s.rangeCount || !s.focusNode) return true;
    const r = document.createRange();
    r.setStart(s.focusNode, s.focusOffset);
    const at = r.getClientRects()[0] || r.getBoundingClientRect();
    if (!at || (!at.top && !at.bottom)) return true;
    const t = tx.getBoundingClientRect(), lh = parseFloat(getComputedStyle(tx).lineHeight) || 22;
    return last ? t.bottom - at.bottom < lh * 0.9 : at.top - t.top < lh * 0.9;
  }
  function focusBlock(id, where = "end") {
    const n = rowOf(id);
    if (!n) return;
    const tx = n.querySelector(".tx");
    if (!tx) return n.querySelector(".hr, .agt, .fig").focus();
    tx.focus();
    const len = tx.textContent.length;
    setCaret(tx, where === "end" ? len : where === "start" ? 0 : Math.min(where, len));
  }
  const empty = (tx) => tx.textContent.replace(/\u200b/g, "") === "" && !tx.querySelector("br, a");
  const textOf = (n, b) => (b.type === "code" ? n.querySelector(".tx").textContent : clean(n.querySelector(".tx").innerHTML));
  const editable = (b) => !UNSENT.includes(b.type) || MEDIA.includes(b.type);   // (a picture's caption: typed in)

  // ---------------------------------------------------------------- typing
  box.addEventListener("input", (ev) => {
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    const n = tx.closest(".blk"), b = blockOf(n.dataset.id);
    if (!b) return;
    if (tx.innerHTML === "<br>") tx.innerHTML = "";
    if (shortcut(n, tx, b, ev)) return;
    b.text = textOf(n, b);
    typed(current, b.id, b.text);
    if (MEDIA.includes(b.type)) return pageInput(n, tx, b, ev);   // a caption: words and links to pages, no / or @
    slashInput(n, tx, b, ev);
    atInput(n, tx, b, ev);
    pageInput(n, tx, b, ev);
  });
  box.addEventListener("focusout", (ev) => {
    const n = ev.target.closest && ev.target.closest(".blk");
    if (n && dirty.has(n.dataset.id)) sendTyped(n.dataset.id);
    if (menu && (menu.kind === "slash" || menu.kind === "at" || menu.kind === "page") && ev.target === menu.tx
      && !(ev.relatedTarget && menu.el.contains(ev.relatedTarget))) closePop();   // (into the picker's box: kept)
  });
  // Markdown at the start of a block, as it is typed: "# " a heading, "- " a list, "[] " a to-do, "> " a quote, "```" code,
  // "---" a divider.
  const SHORT = [[/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^[-*+]\s$/, "bullet"], [/^1[.)]\s$/, "number"],
    [/^\[\s?\]\s$/, "todo"], [/^\[x\]\s$/i, "todo", true], [/^>\s$/, "quote"]];
  function shortcut(n, tx, b, ev) {
    if (ev.inputType !== "insertText" || !["text", "bullet"].includes(b.type)) return false;
    const c = caretIn(tx);
    if (!c || !c.collapsed) return false;
    const before = tx.textContent.slice(0, c.start);
    let to = null, checked = false;
    if (ev.data === " ") { const hit = SHORT.find(([rx]) => rx.test(before)); if (hit) { to = hit[1]; checked = !!hit[2]; } }
    else if (ev.data === "`" && before === "```") to = "code";
    else if (ev.data === "-" && tx.textContent === "---") to = "divider";
    if (!to || (b.type === "bullet" && to !== "todo")) return false;
    const r = document.createRange(), a = pointAt(tx, 0), z = pointAt(tx, before.length);
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    r.deleteContents();
    if (to === "divider") {
      forget(b.id);
      const next = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
      change([{ op: "block.put", page: current, block: { id: b.id, type: "divider", text: "", indent: 0 } },
        { op: "block.put", page: current, block: next, after: b.id }]);
      drawPage();
      focusBlock(next.id, 0);
      return true;
    }
    if (to === "code") tx.textContent = plainOf(clean(tx.innerHTML));
    retype(b, to, { checked, text: to === "code" ? tx.textContent : clean(tx.innerHTML) });
    focusBlock(b.id, 0);
    return true;
  }
  // A block made another type: its text kept (plain, into code; out of code, as text), its indent where it may have one.
  function retypeOp(b, type, extra = {}) {
    const was = b.type;
    let text = "text" in extra ? extra.text : b.text;
    if (!("text" in extra)) {
      if (type === "code" && was !== "code") text = plainOf(b.text);
      else if (was === "code" && type !== "code") text = esc(b.text).replace(/\n/g, "<br>");
    }
    forget(b.id);
    const put = { id: b.id, type, text, indent: INDENTED.includes(type) ? b.indent || 0 : 0, checked: type === "todo" ? !!(extra.checked ?? b.checked) : false };
    return { op: "block.put", page: current, block: put };
  }
  function retype(b, type, extra = {}) {
    const was = b.type, op = retypeOp(b, type, extra), text = op.block.text;
    change([op]);
    const tx = rowOf(b.id) && rowOf(b.id).querySelector(".tx");
    if (tx && (type === "code" || was === "code") && document.activeElement === tx) {
      if (type === "code") tx.textContent = text; else tx.innerHTML = withLinks(clean(text));
    }
    drawPage();
  }

  box.addEventListener("keydown", (ev) => {
    if (ev.isComposing) return;
    const hr = ev.target.closest && ev.target.closest(".hr, .agt, .fig");
    if (hr && ev.target === hr) return dividerKey(ev, hr.closest(".blk"));
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    const n = tx.closest(".blk"), p = shown(), i = p ? p.blocks.findIndex((b) => b.id === n.dataset.id) : -1;   // (lines folded away: passed over)
    if (i < 0 || p.deleted) return;
    const b = p.blocks[i];
    if (menu && menu.kind === "slash" && slashKey(ev)) return;
    if (menu && menu.kind === "at" && atKey(ev)) return;
    if (menu && menu.kind === "page" && pageKey(ev)) return;
    if (menu && menu.kind === "figma" && figmaKey(ev)) return;
    const mod = ev.metaKey || ev.ctrlKey, k = ev.key;
    if (MEDIA.includes(b.type) && !mod && captionKey(ev, p, i, n, tx)) return;
    if (k === "Escape" && !mod && !ev.shiftKey) { ev.preventDefault(); pickRange(b.id, b.id); return holdKeys(); }   // the line picked
    if (ev.shiftKey && !mod && !ev.altKey && (k === "ArrowUp" || k === "ArrowDown")) {
      const c = caretIn(tx), up = k === "ArrowUp", t = tx.textContent;   // its text selected to an end already: the lines
      if (c && !(up ? t.slice(0, c.start) : t.slice(c.end)).replace(/​/g, "")) {   // from here
        ev.preventDefault();
        const to = p.blocks[i + (up ? -1 : 1)];
        pickRange(b.id, to ? to.id : b.id);
        return holdKeys();
      }
      if (c && focusOnEdge(tx, !up)) {                     // on its first (last) row: to that end of the line -- not, as the
        ev.preventDefault();                               // browser would, out of it into the next line's words
        const z = pointAt(tx, up ? 0 : t.length);
        getSelection().extend(z.node, z.offset);
        return;
      }
    }
    if (mod && !ev.altKey) {
      const low = k.toLowerCase();
      if (low === "z") { ev.preventDefault(); return undoStep(ev.shiftKey); }   // the page's undo, not the browser's
      if (!ev.shiftKey && low === "a") {                    // ⌘A: the line's text, then (all of it selected) every line
        const c = caretIn(tx);
        if (c && c.start === 0 && c.end === tx.textContent.length) { ev.preventDefault(); pickAll(); return holdKeys(); }
        return;
      }
      if (b.type !== "code" && !ev.shiftKey && low === "b") return format(ev, n, "bold");
      if (b.type !== "code" && !ev.shiftKey && low === "i") return format(ev, n, "italic");
      if (b.type !== "code" && !ev.shiftKey && low === "u") return format(ev, n, "underline");
      if (b.type !== "code" && ev.shiftKey && (low === "s" || low === "x")) return format(ev, n, "strikeThrough");
      if (b.type !== "code" && !ev.shiftKey && low === "e") { ev.preventDefault(); return codeMark(n, tx); }
      if (b.type !== "code" && !ev.shiftKey && low === "k") { ev.preventDefault(); return linkBox(n, tx); }
      if (ev.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) { ev.preventDefault(); return shift(p, i, k === "ArrowUp" ? -1 : 1); }
      if (k === "Enter") {
        ev.preventDefault();
        if (b.type === "todo") return tick(b);
        return addAfter(b, "text");
      }
      return;
    }
    if (k === "Enter" && !ev.shiftKey) {
      if (b.type === "code") return;                      // a new line of code
      ev.preventDefault();
      return enter(p, i, n, tx);
    }
    if (k === "Enter" && ev.shiftKey && b.type === "code") { ev.preventDefault(); return addAfter(b, "text"); }
    if ((k === "Backspace" || k === "Delete") && !ev.altKey && overLink(n, tx, b, k === "Delete")) return ev.preventDefault();
    if (k === "Backspace" && edge(tx, false)) { ev.preventDefault(); return backspace(p, i, n, tx); }
    if (k === "Delete" && edge(tx, true) && i + 1 < p.blocks.length) { ev.preventDefault(); return joinNext(p, i, n, tx); }
    if (k === "Tab") {
      ev.preventDefault();
      if (b.type === "code" && !ev.shiftKey) document.execCommand("insertText", false, "\t");
      else if (INDENTED.includes(b.type)) indent(b, ev.shiftKey ? -1 : 1);
      return;
    }
    if ((k === "ArrowUp" && onLine(tx, false)) || (k === "ArrowLeft" && edge(tx, false))) {
      const prev = p.blocks.slice(0, i).reverse().find(editable);
      ev.preventDefault();
      if (prev) focusBlock(prev.id, "end");
      else { $("title").focus(); setCaret($("title"), $("title").textContent.length); }
      return;
    }
    if ((k === "ArrowDown" && onLine(tx, true)) || (k === "ArrowRight" && edge(tx, true))) {
      const next = p.blocks.slice(i + 1).find(editable);
      if (next) { ev.preventDefault(); focusBlock(next.id, "start"); }
    }
  });
  function dividerKey(ev, n) {
    const p = shown(), i = p.blocks.findIndex((b) => b.id === n.dataset.id);
    if (ev.key === "Escape") { ev.preventDefault(); pickRange(n.dataset.id, n.dataset.id); return holdKeys(); }
    if (p.deleted) return;
    if (ev.key === "Backspace" || ev.key === "Delete") {
      ev.preventDefault();
      const near = p.blocks[i - 1] || p.blocks[i + 1];
      change([{ op: "block.delete", page: p.id, block: n.dataset.id }]);
      drawPage();
      if (near) focusBlock(near.id, "end");
    } else if (ev.key === "ArrowDown" && MEDIA.includes(p.blocks[i].type)) {   // a picture: down to its caption
      ev.preventDefault();
      focusBlock(p.blocks[i].id, "start");
    } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      const to = ev.key === "ArrowUp" ? p.blocks[i - 1] : p.blocks[i + 1];
      if (to) { ev.preventDefault(); focusBlock(to.id, ev.key === "ArrowUp" ? "end" : "start"); }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      addAfter(p.blocks[i], "text");
    }
  }
  // Enter: an empty list item leaves the list (or comes out a level); at the start of a block, an empty one goes above
  // it; else the block is split at the caret, its rest a new block below -- a list's next item, or text.
  function enter(p, i, n, tx) {
    const b = p.blocks[i];
    if ([...LISTS, "quote"].includes(b.type) && empty(tx)) {
      if (b.indent > 0 && b.type !== "quote") return indent(b, -1);
      return retype(b, "text");
    }
    const kind = LISTS.includes(b.type) ? b.type : "text";
    const ind = INDENTED.includes(b.type) ? b.indent || 0 : 0;
    if (edge(tx, false) && !empty(tx)) {
      const above = { id: rid(), type: kind, text: "", checked: false, indent: ind };
      change([{ op: "block.put", page: p.id, block: above, after: i ? p.blocks[i - 1].id : "" }]);
      drawPage();
      return;
    }
    const s = getSelection(), r = s.getRangeAt(0);
    r.deleteContents();
    const tail = document.createRange();
    tail.setStart(r.startContainer, r.startOffset);
    tail.setEnd(tx, tx.childNodes.length);
    const hold = document.createElement("div");
    hold.append(tail.extractContents());
    const rest = clean(hold.innerHTML), left = clean(tx.innerHTML);
    if (tx.innerHTML !== withLinks(left)) tx.innerHTML = withLinks(left);
    const next = { id: rid(), type: kind, text: rest, checked: false, indent: ind };
    forget(b.id);
    change([{ op: "block.put", page: p.id, block: { id: b.id, text: left } }, { op: "block.put", page: p.id, block: next, after: b.id }]);
    drawPage();
    focusBlock(next.id, "start");
  }
  // Backspace at a block's start: a heading, list item or the like made text; text set in, out a level; else joined to
  // the block above (a divider above, removed).
  function backspace(p, i, n, tx) {
    const b = p.blocks[i];
    if (b.type !== "text") return retype(b, "text");
    if (b.indent > 0) return indent(b, -1);
    if (!i) return;
    const prev = p.blocks[i - 1];
    if (MEDIA.includes(prev.type)) {                       // a picture above: never joined; an empty line goes
      if (empty(tx)) { forget(b.id); change([{ op: "block.delete", page: p.id, block: b.id }]); drawPage(); }
      return focusFig(prev.id);
    }
    if (prev.type === "divider") {
      change([{ op: "block.delete", page: p.id, block: prev.id }]);
      drawPage();
      return focusBlock(b.id, "start");
    }
    const at = prev.type === "code" ? prev.text.length : plainOf(prev.text).length;
    const joined = prev.type === "code" ? prev.text + tx.textContent : clean(prev.text + clean(tx.innerHTML));
    forget(b.id);
    forget(prev.id);
    change([{ op: "block.put", page: p.id, block: { id: prev.id, text: joined } }, { op: "block.delete", page: p.id, block: b.id }]);
    drawPage();
    const ptx = rowOf(prev.id) && rowOf(prev.id).querySelector(".tx");
    if (ptx) { ptx.focus(); setCaret(ptx, at); }
  }
  function joinNext(p, i, n, tx) {
    const b = p.blocks[i], next = p.blocks[i + 1];
    if (MEDIA.includes(next.type)) return focusFig(next.id);
    if (next.type === "divider") { change([{ op: "block.delete", page: p.id, block: next.id }]); drawPage(); return; }
    const at = tx.textContent.length;
    const joined = b.type === "code" ? tx.textContent + plainOf(next.text) : clean(clean(tx.innerHTML) + (next.type === "code" ? esc(next.text) : next.text));
    forget(b.id);
    forget(next.id);
    if (b.type === "code") tx.textContent = joined; else tx.innerHTML = withLinks(joined);
    change([{ op: "block.put", page: p.id, block: { id: b.id, text: joined } }, { op: "block.delete", page: p.id, block: next.id }]);
    drawPage();
    setCaret(tx, at);
  }
  function indent(b, by) {
    const to = Math.max(0, Math.min(MAX_INDENT, (b.indent || 0) + by));
    if (to === (b.indent || 0)) return;
    const tx = rowOf(b.id) && rowOf(b.id).querySelector(".tx"), at = tx && caretIn(tx);
    change([{ op: "block.put", page: current, block: { id: b.id, indent: to } }]);
    drawPage();
    if (tx && at) { tx.focus(); setCaret(tx, at.start, at.end); }
  }
  function tick(b) {                                      // (a to-do work item: done as it is ticked, open again as it is not)
    change([{ op: "block.put", page: current, block: { id: b.id, checked: !b.checked, ...(isWork(b) ? { ended: b.checked ? "" : "done", ended_at: now() } : {}) } }]);
    drawPage();
  }
  function addAfter(b, type) {
    const next = { id: rid(), type, text: "", checked: false, indent: LISTS.includes(type) && INDENTED.includes(b.type) ? b.indent || 0 : 0 };
    change([{ op: "block.put", page: current, block: next, after: b.id }]);
    drawPage();
    focusBlock(next.id, 0);
    return next;
  }
  function shift(p, i, by) {
    const j = i + by;
    if (j < 0 || j >= p.blocks.length) return;
    const b = p.blocks[i], tx = rowOf(b.id).querySelector(".tx"), at = tx && caretIn(tx);
    const rest = p.blocks.filter((x) => x.id !== b.id);
    const after = by < 0 ? (j ? rest[j - 1].id : "") : rest[i].id;
    change([{ op: "block.move", page: p.id, block: b.id, after }]);
    drawPage();
    if (tx) { tx.focus(); if (at) setCaret(tx, at.start, at.end); }
  }

  // inline marks: bold, italic, underline, struck (the browser's), code and links (here)
  function format(ev, n, command) {
    ev.preventDefault();
    document.execCommand(command, false);
  }
  function codeMark(n, tx) {
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    const start = r.commonAncestorContainer;
    const inCode = (start.nodeType === 3 ? start.parentElement : start).closest("code");
    if (inCode && tx.contains(inCode)) inCode.replaceWith(...inCode.childNodes);
    else {
      const code = document.createElement("code");
      code.append(r.extractContents());
      for (const c of code.querySelectorAll("code")) c.replaceWith(...c.childNodes);
      r.insertNode(code);
      const pick = document.createRange();
      pick.selectNodeContents(code);
      s.removeAllRanges();
      s.addRange(pick);
    }
    const b = blockOf(n.dataset.id);
    b.text = textOf(n, b);
    typed(current, b.id, b.text);
  }
  function linkBox(n, tx) {
    const s = getSelection();
    if (!s.rangeCount) return;
    const kept = s.getRangeAt(0).cloneRange();
    const a0 = (kept.startContainer.nodeType === 3 ? kept.startContainer.parentElement : kept.startContainer).closest("a");
    const rect = kept.getBoundingClientRect().width ? kept.getBoundingClientRect() : tx.getBoundingClientRect();
    popUp(rect, (pop) => {
      const input = el("input", { type: "url", placeholder: "Paste a link", value: a0 ? a0.getAttribute("href") : "" });
      const done = (url) => {
        closePop();
        tx.focus();
        s.removeAllRanges();
        s.addRange(kept);
        if (!url) document.execCommand("unlink", false);
        else {
          const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
          if (kept.collapsed && !a0) document.execCommand("insertHTML", false, `<a href="${esc(href).replace(/"/g, "&quot;")}">${esc(url)}</a>`);
          else document.execCommand("createLink", false, href);
        }
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); done(input.value.trim()); }
        else if (e.key === "Escape") { e.preventDefault(); closePop(); tx.focus(); s.removeAllRanges(); s.addRange(kept); }
      });
      pop.append(el("div", { class: "row" }, input, el("button", { type: "button", text: a0 ? "Remove" : "Link",
        onclick: () => done(a0 ? "" : input.value.trim()) })));
      setTimeout(() => input.focus(), 0);
    });
  }

  // ---------------------------------------------------------------- the / menu, and the other pop-ups
  let menu = null;                                         // {kind, el, items?, on?, tx?, from?, done?}
  function popUp(rect, fill, done, kind = "menu", cls = "") {
    closePop();
    const pop = $("pop");
    pop.className = `pop ${cls}`;
    pop.replaceChildren();
    pop.hidden = false;
    menu = { kind, el: pop, done };
    fill(pop);
    place(pop, rect);
    return menu;
  }
  function place(pop, rect) {
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = Math.min(rect.left, innerWidth - w - 8), y = rect.bottom + 6;
    if (y + h > innerHeight - 8 && rect.top - h - 6 > 8) y = rect.top - h - 6;
    pop.style.left = `${Math.max(8, x)}px`;
    pop.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  }
  function closePop() {
    if (!menu) return;
    const m = menu;
    menu = null;
    $("pop").hidden = true;
    if (m.done) m.done();
  }
  function item(k, run) {
    const b = el("button", { class: `it${k.cur ? " cur" : ""}${k.bad ? " bad" : ""}`, type: "button", role: "menuitem",
      onmousedown: (ev) => ev.preventDefault(), onclick: () => { closePop(); run(); } },
      el("span", { class: `gl${k.sm ? " sm" : ""}`, ...(k.glyph && k.glyph.startsWith("<svg") ? { html: k.glyph } : { text: k.glyph || "" }) }),
      el("span", { class: "tt" }, el("span", { text: k.label }), k.note ? el("small", { text: k.note }) : null));
    return b;
  }
  document.addEventListener("mousedown", (ev) => { if (menu && !menu.el.contains(ev.target)) closePop(); }, true);
  document.addEventListener("keydown", (ev) => {
    if (menu && menu.kind === "at" && !menu.tx && atKey(ev)) return;          // the picker opened by a block's button
    if (menu && ev.key === "Escape" && !["slash", "at", "page"].includes(menu.kind)) { ev.preventDefault(); closePop(); }
  });
  $("convo").addEventListener("click", followPage);
  $("convo").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !menu && !ev.target.closest(".reply")) { ev.preventDefault(); closeConvo(); }
  });
  $("scroll").addEventListener("scroll", () => { if (menu && !["slash", "page", "figma"].includes(menu.kind) && !(menu.kind === "at" && menu.tx)) closePop(); });

  function slashInput(n, tx, b, ev) {
    if (menu && menu.kind === "slash") {
      const c = caretIn(tx);
      if (menu.tx !== tx || !c || c.start <= menu.from || tx.textContent[menu.from] !== "/") return closePop();
      const q = tx.textContent.slice(menu.from + 1, c.start);
      if (q.length > 24 || /\s\s/.test(q)) return closePop();
      return drawSlash(q);
    }
    if (ev.inputType !== "insertText" || ev.data !== "/" || b.type === "code") return;
    const c = caretIn(tx);
    if (!c) return;
    const before = tx.textContent.slice(0, c.start - 1);
    if (before && !/\s$/.test(before)) return;
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    const rect = r.width || r.height ? r : tx.getBoundingClientRect();
    popUp(rect, () => {}, null, "slash");
    Object.assign(menu, { tx, from: c.start - 1, block: b.id, rect });
    drawSlash("");
  }
  function drawSlash(q) {
    const words = q.trim().toLowerCase();
    const items = [...KINDS, PAGE_KIND, LINK_KIND, IMAGE_KIND, FIGMA_KIND].filter((k) => !words || k.label.toLowerCase().includes(words) || k.words.includes(words));
    menu.items = items;
    menu.on = Math.min(menu.on || 0, Math.max(0, items.length - 1));
    const pop = menu.el;
    pop.replaceChildren(el("div", { class: "hd", text: "Blocks" }));
    if (!items.length) pop.append(el("div", { class: "none", text: "No block like that" }));
    const m = menu;                                       // (closed by a click before its pick runs)
    items.forEach((k, j) => {
      const it = item(k, () => slashPick(k.type, m));
      if (j === menu.on) it.classList.add("on");
      it.addEventListener("mousemove", () => { if (menu.on !== j) { menu.on = j; drawSlash(q); } });
      pop.append(it);
    });
    place(pop, menu.rect);
    const on = pop.querySelector(".it.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }
  function slashKey(ev) {
    const n = menu.items ? menu.items.length : 0;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawSlash(menu.tx.textContent.slice(menu.from + 1, caretIn(menu.tx).start)); }
      return true;
    }
    if ((ev.key === "Enter" || ev.key === "Tab") && n) { ev.preventDefault(); slashPick(menu.items[menu.on].type); return true; }
    if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
    return false;
  }
  // A block type picked from the / menu: the "/..." typed taken out, and the block made that type -- or, if it holds
  // other words, a new block of it below.
  function slashPick(type, picked = null) {
    const m = picked || menu;
    closePop();
    if (!m || !m.tx || !m.tx.isConnected) return;
    const tx = m.tx, n = tx.closest(".blk"), b = blockOf(n.dataset.id);
    const c = caretIn(tx) || { start: m.from + 1 };
    const r = document.createRange(), a = pointAt(tx, m.from), z = pointAt(tx, Math.max(c.start, m.from + 1));
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    r.deleteContents();
    if (tx.innerHTML === "<br>") tx.innerHTML = "";
    b.text = textOf(n, b);
    tx.focus();
    setCaret(tx, m.from);
    if (type === LINK_KIND.type) return void document.execCommand("insertText", false, "[[");   // the pages, as "[[" opens them
    if (type === IMAGE_KIND.type) return pickPictures(b);
    if (type === FIGMA_KIND.type) return figmaBox(b, tx);
    if (type === PAGE_KIND.type) {                         // a page made inside this one, linked here, and opened
      const id = subpage("");
      putLink(tx, m.from, m.from, id);
      openPage(id);
      return $("title").focus();
    }
    if (UNSENT.includes(type)) {
      forget(b.id);
      const next = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
      if (empty(tx)) change([{ op: "block.put", page: current, block: { id: b.id, type, text: "", indent: 0 } },
        { op: "block.put", page: current, block: next, after: b.id }]);
      else {
        const line = { id: rid(), type, text: "", checked: false, indent: 0 };
        change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } },
          { op: "block.put", page: current, block: line, after: b.id },
          { op: "block.put", page: current, block: next, after: line.id }]);
      }
      drawPage();
      return focusBlock(next.id, 0);
    }
    if (empty(tx)) { retype(b, type, { text: "" }); return focusBlock(b.id, 0); }
    forget(b.id);
    change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } }]);
    addAfter(b, type);
  }

  // ---------------------------------------------------------------- [[: a link to a page
  // "[[" typed opens a list of the pages, found by the words typed after it; one picked takes the "[[..." out and puts a
  // link to it there. A page not there yet can be made, inside this one, and linked.
  function pageInput(n, tx, b, ev) {
    if (menu && menu.kind === "page") {
      const c = caretIn(tx);
      if (menu.tx !== tx || !c || c.start < menu.from + 2 || tx.textContent.slice(menu.from, menu.from + 2) !== "[[") return closePop();
      const q = tx.textContent.slice(menu.from + 2, c.start);
      if (q.length > 80 || q.includes("]")) return closePop();
      return drawPages(q);
    }
    if (ev.inputType !== "insertText" || !ev.data || !ev.data.endsWith("[") || b.type === "code") return;
    const c = caretIn(tx);
    if (!c || !c.collapsed || c.start < 2 || tx.textContent.slice(c.start - 2, c.start) !== "[[") return;
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    const rect = r.width || r.height ? r : tx.getBoundingClientRect();
    popUp(rect, () => {}, null, "page");
    Object.assign(menu, { tx, from: c.start - 2, block: b.id, rect });
    drawPages("");
  }
  const pathOf = (p) => { const up = []; for (let q = p.parent && pages.get(p.parent); q; q = q.parent && pages.get(q.parent)) up.unshift(q.title || "Untitled"); return up.join(" / "); };
  // the pages to link, for the words typed: none, this page's subpages first, then the rest as the sidebar has them; some,
  // the pages whose title has them, those starting with them first
  function pagesFor(q) {
    const words = q.trim().toLowerCase(), order = [];
    const walk = (id) => { for (const p of kidsOf(id)) { order.push(p); walk(p.id); } };
    walk(null);
    const others = order.filter((p) => p.id !== current);
    if (!words) return [...kidsOf(current), ...others.filter((p) => p.parent !== current)];
    const t = (p) => (p.title || "Untitled").toLowerCase();
    return others.filter((p) => t(p).includes(words)).sort((a, z) => Number(t(z).startsWith(words)) - Number(t(a).startsWith(words)));
  }
  function drawPages(q) {
    const name = q.trim(), here = page(), m = menu;       // (the menu: closed before a pick runs)
    const hits = pagesFor(q).slice(0, 50);
    const picks = hits.map((p) => ({ k: { glyph: p.icon || SVG.doc, sm: !p.icon, label: p.title || "Untitled", note: pathOf(p) }, run: () => pagePick(m, p.id) }));
    if (name && !hits.some((p) => (p.title || "").trim().toLowerCase() === name.toLowerCase()))
      picks.push({ k: { glyph: SVG.plus, sm: true, label: `New page “${name}”`, note: here ? `Inside ${here.title || "Untitled"}` : "" }, run: () => pagePick(m, null, name) });
    menu.items = picks;
    menu.on = Math.min(menu.on || 0, Math.max(0, picks.length - 1));
    const pop = menu.el;
    pop.replaceChildren(el("div", { class: "hd", text: "Link to a page" }));
    if (!picks.length) pop.append(el("div", { class: "none", text: "No pages yet: type a name to make one" }));
    picks.forEach((x, j) => {
      const it = item(x.k, x.run);
      if (j === menu.on) it.classList.add("on");
      it.addEventListener("mousemove", () => { if (menu.on !== j) { menu.on = j; drawPages(q); } });
      pop.append(it);
    });
    place(pop, menu.rect);
    const on = pop.querySelector(".it.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }
  function pageKey(ev) {
    const n = menu.items ? menu.items.length : 0;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawPages(menu.tx.textContent.slice(menu.from + 2, caretIn(menu.tx).start)); }
      return true;
    }
    if ((ev.key === "Enter" || ev.key === "Tab") && n) { ev.preventDefault(); const run = menu.items[menu.on].run; closePop(); run(); return true; }
    if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
    return false;
  }
  // A page picked from the menu `m` (or `title`: one made, inside this page): the "[[..." typed swapped for a link to it.
  function pagePick(m, id, title = "") {
    closePop();
    if (!m || !m.tx || !m.tx.isConnected || !blockOf(m.tx.closest(".blk").dataset.id)) return;
    const c = caretIn(m.tx), to = Math.max(c && c.start > m.from ? c.start : m.from + 2, m.from + 2);
    putLink(m.tx, m.from, to, id || subpage(title));
  }
  // A new page inside the one open (its row in the sidebar shown): its id.
  function subpage(title) {
    const made = { id: rid(), title, icon: "", parent: current };
    change([{ op: "page.new", page: made, blocks: [{ id: rid(), type: "text", text: "", checked: false, indent: 0 }] }]);
    if (current) { opened.add(current); store.set("open", [...opened]); }
    return made.id;
  }
  // The line's text from `from` to `to` (caret positions) swapped for a link to the page `id`, the caret after it, and kept.
  function putLink(tx, from, to, id) {
    const n = tx.closest(".blk"), b = blockOf(n.dataset.id), name = pages.get(id).title || "Untitled";
    const r = document.createRange(), a = pointAt(tx, from), z = pointAt(tx, to);
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    r.deleteContents();
    const t = document.createElement("template");
    t.innerHTML = `<a href="page:${id}">${esc(name)}</a>`;
    drawLinks(t.content);
    const link = t.content.firstChild;
    // a space after it, unless one is there already: the caret goes after it
    const next = tx.textContent.charAt(from), gap = next && /\s/.test(next) ? null : document.createTextNode(" ");
    if (gap) r.insertNode(gap);
    r.insertNode(link);
    if (!isText(link.previousSibling)) link.before(ZW);
    for (const x of [...tx.childNodes]) if (x.nodeType === 3 && !x.length) x.remove();
    tx.focus();
    const at = document.createRange(), sel = getSelection();
    if (gap) at.setStart(gap, 1); else at.setStartAfter(link);
    at.collapse(true);
    sel.removeAllRanges();
    sel.addRange(at);
    b.text = textOf(n, b);
    typed(current, b.id, b.text);
  }
  // Backspace (Delete: forward) with only the zero-width space put beside a link between the caret and it: the link taken
  // out whole, with the space -- not the space alone, which would leave the key seeming to do nothing.
  function overLink(n, tx, b, fwd) {
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return false;
    const { startContainer: node, startOffset: off } = s.getRangeAt(0);
    if (node.nodeType !== 3 || !tx.contains(node) || node.data.charAt(fwd ? off : off - 1) !== ZW) return false;
    const link = fwd ? (off + 1 === node.length ? node.nextSibling : null) : (off === 1 ? node.previousSibling : null);
    if (!link || link.nodeType !== 1 || !link.matches("a.pg")) return false;
    node.deleteData(fwd ? off : off - 1, 1);
    link.remove();
    if (!node.length && !tx.textContent) tx.replaceChildren();
    b.text = textOf(n, b);
    typed(current, b.id, b.text);
    return true;
  }
  // A link to a page clicked: that page opened (one in the trash too; one gone, nothing).
  function followPage(ev) {
    const a = ev.target.closest && ev.target.closest("a.pg");
    if (!a) return false;
    ev.preventDefault();
    const id = pageOfLink(a);
    if (id && pages.has(id)) openPage(id);
    return true;
  }

  // ---------------------------------------------------------------- the gutter: + and the grip (drag, or its menu)
  box.addEventListener("click", (ev) => {
    const act = ev.target.closest(".fig [data-do]");
    if (act) return figAct(act);
    const to = ev.target.closest(".to-btn");
    if (to) {
      const b = blockOf(to.closest(".blk").dataset.id);
      if (b && !page().deleted) openPicker(b.id, to.getBoundingClientRect());
      return;
    }
    const add = ev.target.closest(".gut .add");
    if (add) {
      const b = blockOf(add.closest(".blk").dataset.id);
      if (!b || page().deleted) return;
      addAfter(b, "text");
      document.execCommand("insertText", false, "/");      // the / menu, opened as typing "/" opens it
      return;
    }
    const chk = ev.target.closest(".chk");
    if (chk) {
      const b = blockOf(chk.closest(".blk").dataset.id);
      if (b && !page().deleted) tick(b);
      return;
    }
    if (followPage(ev)) return;
    const a = ev.target.closest(".tx a");
    if (a && (ev.metaKey || ev.ctrlKey || page().deleted)) { ev.preventDefault(); window.open(a.href, "_blank", "noopener"); }
  });
  box.addEventListener("mousedown", (ev) => { if (ev.target.closest(".chk, .gut .add, .to-btn, .tx a.pg")) ev.preventDefault(); });
  let drag = null;
  box.addEventListener("pointerdown", (ev) => {
    const grip = ev.target.closest(".gut .grip");
    if (!grip || ev.button !== 0 || page().deleted) return;
    ev.preventDefault();
    const row = grip.closest(".blk");                      // a picked line's grip: every picked line goes with it
    const rows = picked.size > 1 && picked.has(row.dataset.id) ? [...box.children].filter((r) => picked.has(r.dataset.id)) : [row];
    drag = { row, rows, y: ev.clientY, moved: false, before: undefined };
    grip.setPointerCapture(ev.pointerId);
  });
  box.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(ev.clientY - drag.y) < 4) return;
    if (!drag.moved) { drag.moved = true; for (const r of drag.rows) r.classList.add("dragging"); document.body.classList.add("dragging"); }
    const rows = [...box.children].filter((r) => !drag.rows.includes(r));
    drag.before = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }) || null;
    const line = $("drop"), at = drag.before ? drag.before.getBoundingClientRect() : (rows[rows.length - 1] || drag.row).getBoundingClientRect();
    const left = box.getBoundingClientRect();
    line.hidden = false;
    Object.assign(line.style, { left: `${left.left}px`, width: `${left.width}px`, top: `${(drag.before ? at.top : at.bottom) - 2}px` });
    const sc = $("scroll").getBoundingClientRect();
    if (ev.clientY < sc.top + 30) $("scroll").scrollTop -= 12;
    else if (ev.clientY > sc.bottom - 30) $("scroll").scrollTop += 12;
  });
  const endDrag = (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    $("drop").hidden = true;
    for (const r of d.rows) r.classList.remove("dragging");
    document.body.classList.remove("dragging");
    if (ev.type === "pointercancel") return;
    if (!d.moved) return blockMenu(d.row);
    const rows = [...box.children].filter((r) => !d.rows.includes(r));
    const at = d.before ? rows.indexOf(d.before) : rows.length;
    const after = at > 0 ? rows[at - 1].dataset.id : "";
    const p = page(), i = p.blocks.findIndex((b) => b.id === d.rows[0].dataset.id);
    if ((after === "" && i === 0) || (i > 0 && p.blocks[i - 1].id === after)) return;
    change(moveOps(d.rows.map((r) => r.dataset.id), after));
    drawPage();
    if (d.rows.length > 1) holdKeys();
  };
  // lines (a run, in order) moved to go after a block ("" the page's start)
  function moveOps(ids, after) {
    return ids.map((id) => { const op = { op: "block.move", page: current, block: id, after }; after = id; return op; });
  }
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);
  function blockMenu(n) {
    const b = blockOf(n.dataset.id);
    if (!b) return;
    if (picked.size > 1 && picked.has(b.id)) return linesMenu(n.querySelector(".grip").getBoundingClientRect(), n);
    n.classList.add("menu-open");
    popUp(n.querySelector(".grip").getBoundingClientRect(), (pop) => {
      pop.append(el("div", { class: "hd", text: "Turn into" }));
      for (const k of KINDS) if (!UNSENT.includes(k.type) || b.type === k.type)
        pop.append(item({ ...k, note: "", sm: true, cur: k.type === b.type }, () => { if (k.type !== b.type) { retype(b, k.type); focusBlock(b.id); } }));
      pop.append(el("div", { class: "sep" }),
        ...(UNSENT.includes(b.type) ? [] : b.to ? [
          item({ glyph: SVG.at, sm: true, label: "Open its Chat" }, () => ag.actors.show(b.to).catch((e) => say(e.message, true))),
          item({ glyph: SVG.x, sm: true, label: "Forget who it went to", note: "Still a work item" }, () => { change([{ op: "block.put", page: current, block: { id: b.id, to: "", work: true } }], false); drawPage(); }),
        ] : [item({ glyph: SVG.at, sm: true, label: "Send to an agent…" }, () => openPicker(b.id, n.getBoundingClientRect())),
          b.work ? item({ glyph: SVG.x, sm: true, label: "Not a work item" }, () => markWork([b], false))
            : item({ glyph: SVG.work, sm: true, label: "Mark as a work item", note: "Tracked on the Work page" }, () => markWork([b], true))]),
        ...(!isWork(b) ? [] : endedOf(b) ? [item({ glyph: SVG.restore, sm: true, label: "Reopen it" }, () => reopen([b]))] : [
          item({ glyph: SVG.check, sm: true, label: "Accept it as done" }, () => accept([b])),
          item({ glyph: SVG.x, sm: true, label: "Cancel it" }, () => cancel([b]))]),
        item({ glyph: "⧉", sm: true, label: "Duplicate" }, () => {
          const copy = copyOf(b);
          change([{ op: "block.put", page: current, block: copy, after: b.id }]);
          drawPage();
          focusBlock(copy.id);
        }),
        item({ glyph: SVG.trash, sm: true, label: "Delete", bad: true }, () => {
          const p = shown(), i = p.blocks.indexOf(b), near = p.blocks[i - 1] || p.blocks[i + 1];
          forget(b.id);
          change([{ op: "block.delete", page: current, block: b.id }]);
          drawPage();
          if (near) focusBlock(near.id);
        }));
    }, () => n.classList.remove("menu-open"));
  }

  // ---------------------------------------------------------------- lines picked: several at once
  // Whole lines (Notion's block selection), always a run of the page's, `anchor` to `head`: picked by a drag from one
  // line's words into others (back into its own, its text selected again), a box dragged from beside the lines,
  // Shift+click, Esc in a line (then Shift+↑↓ more or fewer), Shift+↑↓ past a line's end, ⌘A twice, or words selected
  // from one line into another. While lines are
  // picked the keys are the page's (the blocks' box has them, no caret): ⌫ deletes them (Undo brings them back), ⌘C ⌘X
  // copy and cut them (as markdown, and as themselves for these notes), ⌘V puts lines after them, Tab and ⇧Tab indent
  // them, ⌘D duplicates them, ⌘↵ ticks their to-dos, ⌘⇧↑↓ moves them, ↵ goes back to typing; their grip drags them all,
  // and its menu (or the bar over them) turns them into a type, or sends them to an agent as one message. A click
  // anywhere else, or Esc, puts them down.
  let undo = null;                                         // {pid, step}: lines just deleted, the toast's Undo
  box.tabIndex = -1;
  const order = () => { const p = shown(); return p ? p.blocks.map((b) => b.id) : []; };   // (the lines shown: none folded away)
  const pickedBlocks = () => { const p = page(); return p ? p.blocks.filter((b) => picked.has(b.id)) : []; };
  function pickRange(a, z) {
    const ids = order(), i = ids.indexOf(a), j = ids.indexOf(z);
    if (i < 0 || j < 0) return unpick();
    picked.clear();
    for (const id of ids.slice(Math.min(i, j), Math.max(i, j) + 1)) picked.add(id);
    anchor = a;
    head = z;
    drawPicked();
    const r = rowOf(z);
    if (r && !drag && !band && !sweep) r.scrollIntoView({ block: "nearest" });
  }
  function pickAll() { const ids = order(); if (ids.length) pickRange(ids[0], ids[ids.length - 1]); }
  function unpick() {
    if (!picked.size) return;
    picked.clear();
    anchor = head = null;
    drawPicked();
  }
  // the page's keys, not a line's: no caret, no text selected
  function holdKeys() {
    flushTyped();
    pump();
    const s = getSelection();
    if (s.rangeCount) s.removeAllRanges();
    if (document.activeElement !== box) box.focus({ preventScroll: true });
  }
  // the rows marked as picked (some gone, by another's change: forgotten), and the bar over a run of several
  function drawPicked() {
    const ids = order().filter((id) => picked.has(id));
    picked.clear();
    for (const id of ids) picked.add(id);
    if (ids.length && !picked.has(anchor)) anchor = ids[0];
    if (ids.length && !picked.has(head)) head = ids[ids.length - 1];
    for (const n of box.children) n.classList.toggle("picked", picked.has(n.dataset.id));
    box.classList.toggle("picking", ids.length > 0);
    box.classList.toggle("grp", ids.length > 1);
    const bar = $("pk-bar"), p = page();
    if (ids.length < 2 || !p || p.deleted) { bar.hidden = true; return; }
    const n = ids.length, can = sendable(pickedBlocks()).length;
    if (bar.dataset.n !== `${n}:${can}`) {
      bar.dataset.n = `${n}:${can}`;
      bar.replaceChildren(el("span", { class: "pk-n", text: `${n} lines` }),
        can ? el("button", { type: "button", class: "pk-send", title: `Send ${can === n ? "them" : `the ${can} with words`} to an agent, as one message`,
          onclick: (ev) => {                               // the lines picked now (the bar is drawn again only as their count changes)
            const now = pickedBlocks().map((b) => b.id);
            if (now.length) openPicker(now[0], ev.currentTarget.getBoundingClientRect(), now);
          } },
        el("span", { html: SVG.at }), el("span", { text: "Send to an agent" })) : null,
        el("button", { type: "button", class: "pk-more", title: "More", "aria-label": "More for these lines", html: SVG.more,
          onclick: (ev) => linesMenu(ev.currentTarget.getBoundingClientRect()) }));
    }
    bar.hidden = false;
    const first = rowOf(ids[0]);
    bar.style.top = `${Math.max(0, first.offsetTop - bar.offsetHeight - 4)}px`;
    bar.style.left = `${box.offsetLeft + box.offsetWidth - bar.offsetWidth}px`;
  }
  // a line as its copy has it: a new id, and nothing of whom it was sent to or how it was ended
  const copyOf = ({ to: _to, sent: _sent, thread: _thread, extra: _extra, group: _group, work: _work, ended: _ended, ended_at: _at,
    source: _source, source_at: _sourceAt, ...rest }) => ({ ...rest, id: rid() });
  // lines with words to send (no divider, no agents table)
  const sendable = (bs) => bs.filter((b) => !UNSENT.includes(b.type) && plainOf(b.type === "code" ? esc(b.text) : b.text).trim());

  // -- what picked lines do
  function deleteLines() {
    const p = page(), bs = pickedBlocks();
    if (!p || p.deleted || !bs.length) return;
    const i = p.blocks.indexOf(bs[0]), before = i > 0 ? p.blocks[i - 1].id : "";
    const gone = bs.map((b) => JSON.parse(JSON.stringify(b)));
    for (const b of bs) forget(b.id);
    const ops = bs.map((b) => ({ op: "block.delete", page: p.id, block: b.id }));
    const fresh = p.blocks.length === bs.length ? { id: rid(), type: "text", text: "", checked: false, indent: 0 } : null;
    if (fresh) ops.push({ op: "block.put", page: p.id, block: fresh });   // a page keeps a line to type in
    change(ops);
    unpick();
    if (convo && gone.some((b) => b.id === convo.block)) convo = null;
    drawPage();
    const near = fresh || (before ? blockOf(before) : page().blocks[0]);
    if (near) focusBlock(near.id, before ? "end" : "start");
    const h = historyOf(p.id);
    undoable(`${gone.length === 1 ? "A line" : `${gone.length} lines`} deleted`, p.id, h.done[h.done.length - 1]);
  }
  // a toast with Undo, for as long as its step is still the page's last
  function undoable(text, pid, step) {
    const w = $("who");
    undo = { pid, step };
    w.classList.remove("bad");
    w.replaceChildren(el("span", { text }), el("button", { type: "button", class: "undo", text: "Undo", onclick: () => takeBack() }));
    w.style.opacity = "1";
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { w.style.opacity = "0"; undo = null; }, 12000);
  }
  function takeBack() {
    const u = undo;
    undo = null;
    $("who").style.opacity = "0";
    if (!u) return;
    const h = historyOf(u.pid);
    if (h.done[h.done.length - 1] !== u.step) return;
    if (current !== u.pid) openPage(u.pid);
    undoStep();
  }
  function indentLines(by) {
    const ops = pickedBlocks().filter((b) => INDENTED.includes(b.type)).map((b) => [b, Math.max(0, Math.min(MAX_INDENT, (b.indent || 0) + by))])
      .filter(([b, to]) => to !== (b.indent || 0)).map(([b, to]) => ({ op: "block.put", page: current, block: { id: b.id, indent: to } }));
    if (ops.length) { change(ops); drawPage(); }
  }
  function tickLines() {                                   // all ticked, unless all are: then none
    const todos = pickedBlocks().filter((b) => b.type === "todo");
    if (!todos.length) return;
    const to = todos.some((b) => !b.checked), at = now();
    change(todos.map((b) => ({ op: "block.put", page: current, block: { id: b.id, checked: to, ...(isWork(b) ? { ended: to ? "done" : "", ended_at: at } : {}) } })));
    drawPage();
  }
  function duplicateLines() {
    const bs = pickedBlocks();
    if (!bs.length) return;
    let after = bs[bs.length - 1].id;
    const copies = bs.map(copyOf);
    change(copies.map((c) => { const op = { op: "block.put", page: current, block: c, after }; after = c.id; return op; }));
    drawPage();
    pickRange(copies[0].id, copies[copies.length - 1].id);
  }
  function moveLines(by) {
    const all = order(), ids = all.filter((id) => picked.has(id));
    const i = all.indexOf(ids[0]), j = all.indexOf(ids[ids.length - 1]);
    if (by < 0 ? i <= 0 : j >= all.length - 1) return;
    change(moveOps(ids, by < 0 ? (i >= 2 ? all[i - 2] : "") : all[j + 1]));
    drawPage();
    const r = rowOf(head);
    if (r) r.scrollIntoView({ block: "nearest" });
  }
  function retypeLines(type) {
    const ops = pickedBlocks().filter(editable).filter((b) => b.type !== type).map((b) => retypeOp(b, type));
    if (ops.length) { change(ops); drawPage(); }
  }
  // the picked lines' menu: a type for them all, sent to an agent together, duplicated, deleted
  function linesMenu(rect, n = null) {
    const bs = pickedBlocks(), can = sendable(bs);
    if (!bs.length) return;
    const types = new Set(bs.map((b) => b.type));
    if (n) n.classList.add("menu-open");
    popUp(rect, (pop) => {
      pop.append(el("div", { class: "hd", text: `${bs.length} lines: turn into` }));
      for (const k of KINDS) if (!UNSENT.includes(k.type))
        pop.append(item({ ...k, note: "", sm: true, cur: types.size === 1 && types.has(k.type) }, () => { retypeLines(k.type); holdKeys(); }));
      pop.append(el("div", { class: "sep" }),
        ...(can.length ? [item({ glyph: SVG.at, sm: true, label: `Send ${can.length === bs.length ? "them" : `${can.length} of them`} to an agent…` },
          () => openPicker(can[0].id, rect, can.map((b) => b.id)))] : []),
        ...(bs.some((b) => b.type === "todo") ? [item({ glyph: SVG.check, sm: true, label: bs.some((b) => b.type === "todo" && !b.checked) ? "Tick the to-dos" : "Untick the to-dos", note: "⌘↵" },
          () => { tickLines(); holdKeys(); })] : []),
        ...(can.some((b) => !isWork(b)) ? [item({ glyph: SVG.work, sm: true, label: `Mark ${can.filter((b) => !isWork(b)).length === 1 ? "one" : can.filter((b) => !isWork(b)).length} as work items`, note: "Tracked on the Work page" },
          () => { markWork(can.filter((b) => !isWork(b)), true); holdKeys(); })] : []),
        item({ glyph: "⧉", sm: true, label: "Duplicate", note: "⌘D" }, () => { duplicateLines(); holdKeys(); }),
        item({ glyph: SVG.trash, sm: true, label: `Delete ${bs.length} lines`, note: "⌫", bad: true }, () => deleteLines()));
    }, () => { if (n) n.classList.remove("menu-open"); });
  }

  // -- copied and pasted: as markdown for anywhere, and as the blocks themselves for these notes
  const CLIP = "application/x-ag-notes-blocks";
  function clip(dt) {
    const bs = pickedBlocks();
    dt.setData("text/plain", mdLines(bs).join("\n"));
    dt.setData(CLIP, JSON.stringify(bs.map((b) => ({ type: b.type, text: b.text, checked: !!b.checked, indent: b.indent || 0 }))));
  }
  function clipBlocks(dt) {
    let got;
    try { got = JSON.parse(dt.getData(CLIP) || "null"); } catch { return null; }
    if (!Array.isArray(got) || !got.length) return null;
    const ok = got.filter((b) => b && TYPES.includes(b.type) && typeof b.text === "string");
    return ok.length ? ok.map((b) => ({ id: rid(), type: b.type, text: b.text, checked: !!b.checked && b.type === "todo",
      indent: INDENTED.includes(b.type) ? Math.max(0, Math.min(MAX_INDENT, Number(b.indent) || 0)) : 0 })) : null;
  }
  // a block's text (clean HTML) as markdown: notebook.py's inline_markdown, a line break a new line
  function mdInline(h) {
    const t = document.createElement("template");
    t.innerHTML = clean(h);
    const walk = (node) => [...node.childNodes].map((c) => {
      if (c.nodeType === 3) return c.textContent;
      if (c.nodeType !== 1) return "";
      const tag = c.nodeName.toLowerCase(), inner = walk(c);
      if (tag === "br") return "\n";
      if (tag === "a") { const id = pageOfLink(c), p = id && pages.get(id); return `[${p ? p.title || "Untitled" : inner}](${c.getAttribute("href") || ""})`; }
      const m = { b: "**", i: "*", s: "~~", code: "`" }[tag] || "";
      return m + inner + m;
    }).join("");
    return walk(t.content);
  }
  // lines as markdown (notebook.py's markdown_lines, without ids): indents from the least of them, lists numbered afresh
  function mdLines(bs) {
    const ins = bs.filter((b) => INDENTED.includes(b.type)).map((b) => b.indent || 0);
    const base = ins.length ? Math.min(...ins) : 0, out = [], counts = new Map();
    for (const b of bs) {
      const k = INDENTED.includes(b.type) ? Math.max(0, (b.indent || 0) - base) : 0;
      for (const d of [...counts.keys()]) if (d > k) counts.delete(d);
      if (b.type === "number") counts.set(k, (counts.get(k) || 0) + 1); else counts.delete(k);
      if (b.type === "code") { out.push("```", ...String(b.text).split("\n"), "```"); continue; }
      if (b.type === "divider") { out.push("---"); continue; }
      if (b.type === "agents" || b.type === "work") continue;
      if (b.type === "image") { out.push(`![${mdInline(b.text)}](image:${b.file})`); continue; }
      if (b.type === "figma") { out.push(`[Figma: ${b.title || figmaTitle(b.url) || "a frame"}](${b.url})${b.text ? ` -- ${mdInline(b.text)}` : ""}`); continue; }
      const pad = "  ".repeat(k), mark = { text: "", h1: "# ", h2: "## ", h3: "### ", bullet: "- ", quote: "> ",
        todo: b.checked ? "- [x] " : "- [ ] ", number: `${counts.get(k)}. ` }[b.type] || "";
      out.push(pad + mark + mdInline(b.text).replace(/\n/g, `\n${pad}${" ".repeat(mark.length)}`));
    }
    return out;
  }

  // -- the keys, the clipboard, and clicks, while lines are picked
  const inField = (t) => !!(t && t.closest && t.closest(".tx, input, textarea, [contenteditable='true'], [contenteditable='plaintext-only'], .pop, .convo"));
  const theirs = () => picked.size > 0 && !inField(document.activeElement);
  document.addEventListener("keydown", (ev) => {
    if (ev.defaultPrevented || ev.isComposing || inField(ev.target)) return;
    const mod = ev.metaKey || ev.ctrlKey, k = ev.key, low = k.toLowerCase();
    if (mod && !ev.altKey && low === "z") { ev.preventDefault(); return undoStep(ev.shiftKey); }
    if (!picked.size || menu) return;
    const p = page(), ro = !p || !!p.deleted, all = order();
    if (k === "Escape") { ev.preventDefault(); return unpick(); }
    if (mod && !ev.shiftKey && low === "a") { ev.preventDefault(); return pickAll(); }
    if (k === "ArrowUp" || k === "ArrowDown") {
      ev.preventDefault();
      const up = k === "ArrowUp";
      if (mod && ev.shiftKey) return ro ? null : moveLines(up ? -1 : 1);
      if (ev.shiftKey) { const j = all.indexOf(head) + (up ? -1 : 1); if (j >= 0 && j < all.length) pickRange(anchor, all[j]); return; }
      const ids = all.filter((id) => picked.has(id)), j = up ? all.indexOf(ids[0]) - 1 : all.indexOf(ids[ids.length - 1]) + 1;
      if (j >= 0 && j < all.length) pickRange(all[j], all[j]);
      return;
    }
    if (k === "Enter" && !mod && !ev.shiftKey) { ev.preventDefault(); const at = head; unpick(); return focusBlock(at, "end"); }
    if (ro) return;
    if (k === "Backspace" || k === "Delete") { ev.preventDefault(); return deleteLines(); }
    if (k === "Tab") { ev.preventDefault(); return indentLines(ev.shiftKey ? -1 : 1); }
    if (mod && k === "Enter") { ev.preventDefault(); return tickLines(); }
    if (mod && !ev.shiftKey && low === "d") { ev.preventDefault(); return duplicateLines(); }
  });
  document.addEventListener("copy", (ev) => { if (theirs()) { ev.preventDefault(); clip(ev.clipboardData); } });
  document.addEventListener("cut", (ev) => {
    if (!theirs()) return;
    ev.preventDefault();
    clip(ev.clipboardData);
    if (!page().deleted) deleteLines();
  });
  document.addEventListener("paste", async (ev) => {      // after the lines picked, and then those picked
    if (!theirs() || page().deleted) return;
    ev.preventDefault();
    const ids = order().filter((id) => picked.has(id)), last = ids[ids.length - 1];
    const text = (ev.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    let got = clipBlocks(ev.clipboardData);
    if (!got) { try { got = text.trim() ? await parsed(text) : []; } catch { got = []; } }
    if (!got.length || !blockOf(last)) return;
    putBlocks(got, last);
    pickRange(got[0].id, got[got.length - 1].id);
    holdKeys();
  });
  // a click anywhere puts the lines down -- but in a menu, on the bar, on a picked line's grip, or Shift+click on a line
  document.addEventListener("pointerdown", (ev) => {
    if (!picked.size) return;
    const t = ev.target;
    if (t.closest && t.closest(".pop, .pk-bar, .blk.picked > .gut .grip")) return;
    if (ev.shiftKey && t.closest && t.closest("#blocks > .blk")) return;
    unpick();
  }, true);

  // -- the drags that pick: a sweep from a line's words, a box from beside the lines
  let sweep = null, band = null, eatMouse = false;
  const BAND_NOT = ".tx, button, input, textarea, a, .pg-title, .pg-icon, .pg-tools, .agt, .hr, .fig, .sent, .fold, .fold-all, .gut, .chk, .banner, .empty, .pk-bar";
  function rowAt(y) {                                     // the line at a height (above the first: it; below the last: it)
    const rows = [...box.children];
    return rows.find((r) => y < r.getBoundingClientRect().bottom) || rows[rows.length - 1] || null;
  }
  function edgeScroll(y) {
    const sc = $("scroll"), r = sc.getBoundingClientRect();
    if (y < r.top + 30) sc.scrollTop -= 12;
    else if (y > r.bottom - 30) sc.scrollTop += 12;
  }
  $("scroll").addEventListener("pointerdown", (ev) => {
    const sc = $("scroll");
    if (ev.button !== 0 || SPECIAL.includes(current) || !page() || ev.target.closest(".pop")) return;
    if (ev.target === sc && ev.clientX >= sc.getBoundingClientRect().left + sc.clientWidth) return;   // its scrollbar
    const n = ev.target.closest(".blk");
    if (ev.shiftKey && n && box.contains(n) && !ev.target.closest("button, .chk, a")) {
      const f = document.activeElement, fn = f && box.contains(f) && f !== box ? f.closest(".blk") : null;
      const from = picked.size ? anchor : fn ? fn.dataset.id : null;
      if (from && (picked.size || from !== n.dataset.id)) {   // (Shift+click in the line typed in: its text, as ever)
        eatMouse = true;
        pickRange(from, n.dataset.id);
        holdKeys();
        return;
      }
    }
    if (ev.target.closest(".tx") && n) { sweep = { row: n, on: false }; return; }
    if (ev.target.closest(BAND_NOT)) return;
    band = { x: ev.clientX, y: ev.clientY + sc.scrollTop, on: false, below: !!ev.target.closest("#below") };
    eatMouse = true;                                       // no text selected, no focus lost, as the box is dragged
  });
  document.addEventListener("mousedown", (ev) => { if (eatMouse) { eatMouse = false; ev.preventDefault(); } }, true);
  document.addEventListener("pointermove", (ev) => {
    if (sweep) {
      const r = rowAt(ev.clientY);
      if (!r) return;
      if (r !== sweep.row) {
        if (!sweep.on) { sweep.on = true; document.body.classList.add("sweeping"); }
        pickRange(sweep.row.dataset.id, r.dataset.id);
      } else if (sweep.on) {                               // back in its own line: its text, selected as the drag goes
        sweep.on = false;
        document.body.classList.remove("sweeping");
        unpick();
      }
      edgeScroll(ev.clientY);
    } else if (band) {
      const sc = $("scroll"), y0 = band.y - sc.scrollTop;
      if (!band.on && Math.hypot(ev.clientX - band.x, ev.clientY - y0) < 5) return;
      if (!band.on) { band.on = true; document.body.classList.add("banding"); }
      const top = Math.min(y0, ev.clientY), bottom = Math.max(y0, ev.clientY);
      Object.assign($("band").style, { left: `${Math.min(band.x, ev.clientX)}px`, top: `${top}px`,
        width: `${Math.abs(ev.clientX - band.x)}px`, height: `${bottom - top}px` });
      $("band").hidden = false;
      const hit = [...box.children].filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > top && b.top < bottom; });
      if (!hit.length) unpick();
      else {
        const down = ev.clientY >= y0, a = (down ? hit[0] : hit[hit.length - 1]).dataset.id, z = (down ? hit[hit.length - 1] : hit[0]).dataset.id;
        pickRange(a, z);
      }
      edgeScroll(ev.clientY);
    }
  });
  function endPick(ev) {
    if (sweep) {
      const s = sweep;
      sweep = null;
      document.body.classList.remove("sweeping");
      if (s.on && picked.size) holdKeys();
    }
    if (band) {
      const b = band;
      band = null;
      $("band").hidden = true;
      document.body.classList.remove("banding");
      if (b.on) { if (picked.size) holdKeys(); }
      else if (b.below && ev.type === "pointerup") belowClick();
    }
  }
  document.addEventListener("pointerup", endPick);
  document.addEventListener("pointercancel", endPick);
  // Words selected from one line into another, however the browser came to select them (its own Shift+↓ out of a line,
  // a drag from beside the lines): those lines picked, whole -- words across lines can't be cut, typed over or indented.
  // Looked at once the mouse is let go, not while it drags.
  let held = false;
  document.addEventListener("pointerdown", () => { held = true; }, true);
  function lineOf(node, offset) {
    if (node === box) return box.children[Math.min(offset, box.children.length - 1)] || null;
    const e = node && (node.nodeType === 1 ? node : node.parentElement), r = e && e.closest(".blk");
    return r && r.parentElement === box ? r : null;
  }
  function crossPick() {
    if (held || sweep || band) return;
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    const a = lineOf(s.anchorNode, s.anchorOffset), z = lineOf(s.focusNode, s.focusOffset);
    if (!a || !z || a === z) return;
    pickRange(a.dataset.id, z.dataset.id);
    holdKeys();
  }
  document.addEventListener("selectionchange", crossPick);
  document.addEventListener("pointerup", () => { held = false; crossPick(); });
  document.addEventListener("pointercancel", () => { held = false; });
  window.addEventListener("blur", () => { held = false; });

  // ---------------------------------------------------------------- the title, the icon, and below the blocks
  const title = $("title");
  title.addEventListener("input", () => {
    const p = page();
    if (!p) return;
    const was = p.title || "";
    p.title = title.textContent.replace(/\s+/g, " ").trimStart();
    titleTyped(p, was);
    if (titleDirty) clearTimeout(titleDirty.timer);
    titleDirty = { page: p.id, title: p.title, timer: setTimeout(() => { flushTyped(); pump(); }, 450) };
    saved("saving");
    drawSide();
    drawCrumbs(p);
  });
  for (const t of [box, title]) t.addEventListener("beforeinput", (ev) => {   // Undo and Redo from the browser's Edit menu
    if (ev.inputType === "historyUndo" || ev.inputType === "historyRedo") { ev.preventDefault(); undoStep(ev.inputType === "historyRedo"); }
  });
  title.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === "z") { ev.preventDefault(); return undoStep(ev.shiftKey); }
    if (ev.key !== "Enter" && !(ev.key === "ArrowDown" && onLine(title, true))) return;
    ev.preventDefault();
    const p = page();
    if (!p || p.deleted) return;
    const first = shown().blocks.find(editable);
    if (first && ev.key === "ArrowDown") return focusBlock(first.id, "start");
    if (first && first.type === "text" && !plainOf(first.text)) return focusBlock(first.id, "start");
    const b = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    change([{ op: "block.put", page: p.id, block: b, after: "" }]);
    drawPage();
    focusBlock(b.id, 0);
  });
  title.addEventListener("paste", (ev) => {
    ev.preventDefault();
    document.execCommand("insertText", false, (ev.clipboardData.getData("text/plain") || "").replace(/\s+/g, " "));
  });
  const iconPicker = (anchor) => popUp(anchor.getBoundingClientRect(), (pop) => {
    const p = page();
    pop.append(el("div", { class: "grid" }, ...ICONS.map((e) => el("button", { type: "button", text: e, title: e,
      onclick: () => { closePop(); change([{ op: "page.set", page: p.id, icon: e }]); drawSide(); drawPage(); } }))));
    if (p.icon) pop.append(el("div", { class: "sep" }), item({ glyph: SVG.x, sm: true, label: "Remove the icon" },
      () => { change([{ op: "page.set", page: p.id, icon: "" }]); drawSide(); drawPage(); }));
  }, null, "menu", "emoji");
  $("add-icon").addEventListener("click", (ev) => iconPicker(ev.currentTarget));
  $("icon").addEventListener("click", (ev) => { if (!page().deleted) iconPicker(ev.currentTarget); });
  function belowClick() {                                 // a click under the lines (a drag there picks them): one to type in
    const p = page();
    if (!p || p.deleted) return;
    const last = shown().blocks.slice(-1)[0];
    if (last && last.type === "text" && !plainOf(last.text)) return focusBlock(last.id, "end");
    const b = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    change([{ op: "block.put", page: p.id, block: b }]);
    drawPage();
    focusBlock(b.id, 0);
  }

  // ---------------------------------------------------------------- pasting: lines as blocks
  // Lines copied from these notes come back as they were (their own clipboard type: types, ticks, indents); other text
  // of several lines is read as markdown, a line each.
  box.addEventListener("paste", async (ev) => {
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    ev.preventDefault();
    const text = (ev.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    const ours = clipBlocks(ev.clipboardData);
    const n = tx.closest(".blk"), b = blockOf(n.dataset.id);
    const pics = [...(ev.clipboardData.files || [])].filter((f) => f.type.startsWith("image/"));
    if (b && pics.length && !ours && b.type !== "code" && !page().deleted) return void putPictures(pics, b);
    if (!b || (!text && !ours)) return;
    if (b.type === "code" || (!ours && !text.trim().includes("\n"))) {
      const alone = b.type === "text" && empty(tx) && FIGMA_URL.test(text.trim());
      document.execCommand("insertText", false, b.type === "code" ? text : text.replace(/\n+/g, " "));
      if (alone) figmaChoice(b, tx, text.trim());           // a Figma link alone on a line: the frame, or a link?
      return;
    }
    let got = ours || [];
    if (!ours) {
      try { got = await parsed(text); }
      catch { document.execCommand("insertText", false, text.replace(/\n+/g, " ")); return; }
    }
    if (!got.length || !blockOf(b.id)) return;
    focusBlock(putBlocks(got, b.id, empty(tx) && b.type === "text" ? tx : null), "end");
  });
  const parsed = async (text) => (await (await ag.api("parse", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown: text }) })).json()).blocks || [];
  // Blocks put in after one (`after`), in order -- the first into the empty line typed in (`into`), if it is one -- and
  // the last one's id.
  function putBlocks(got, after, into = null) {
    const ops = [];
    got = [...got];
    if (into) {
      const id = into.closest(".blk").dataset.id, first = got.shift();
      forget(id);
      ops.push({ op: "block.put", page: current, block: { ...first, id } });
      if (first.type === "code") into.textContent = first.text; else into.innerHTML = withLinks(clean(first.text));
    }
    for (const nb of got) { ops.push({ op: "block.put", page: current, block: nb, after }); after = nb.id; }
    change(ops);
    drawPage();
    return after;
  }

  // ---------------------------------------------------------------- pictures
  // An image block shows a picture the backend keeps (POST image: pasted, dropped, or picked from the / menu), as wide as
  // the reader drags its sides (`width`, a percent of the page's). A figma block shows a frame or board of Figma live, in
  // Figma's own embed, over the snapshot the backend keeps of it (POST figma/snap: asked for as the page shows it, at
  // most every SNAP_EVERY; fetched again only when Figma changed it). The snapshot shows while Figma loads, when it
  // can't (offline), or when the reader picks it; it is what agents are given. Signing in to Figma, or a file the reader
  // can't open, is for Figma's embed to say.
  const FIGMA_URL = /^https:\/\/(?:www\.)?figma\.com\/(design|file|board|proto|slides|deck)\/([A-Za-z0-9]{6,64})(?:\/([^/?#\s]*))?[^\s<>"']*$/;
  const SNAP_EVERY = 600;
  const LOAD_WAIT = 25000;                                 // ms: Figma's embed not loaded by then, the snapshot shown
  let figmaToken = { token: false, who: "" };
  const figView = new Map();                               // block id -> "snap" | "live": as the reader picked
  const snapAsked = new Map(), snapErr = new Map(), unloaded = new Set();
  let sizing = null, dropAt = null;
  const dark = () => !!(ag.theme.current && ag.theme.current.mode === "dark");
  const fileUrl = (name) => `/api/file/${encodeURIComponent(name)}?${new URLSearchParams({ gatherer: ag.gatherer, instance: ag.instance })}`;
  function figmaTitle(url) {
    const m = FIGMA_URL.exec(url || "");
    try { return m && m[3] ? decodeURIComponent(m[3]).replace(/-/g, " ").replace(/\s+/g, " ").trim() : ""; } catch { return ""; }
  }
  function embedUrl(url) {                                 // Figma's Embed Kit 2.0: the link, `embed` for `www`
    const m = FIGMA_URL.exec(url), node = (new URL(url).searchParams.get("node-id") || "").replace(/:/g, "-");
    const q = new URLSearchParams({ "embed-host": "ag", footer: "false", theme: dark() ? "dark" : "light" });
    if (node) { q.set("node-id", node); q.set("page-selector", "false"); }
    return `https://embed.figma.com/${m[1] === "file" ? "design" : m[1]}/${m[2]}/${m[3] || ""}?${q}`;
  }
  const viewOf = (b) => (navigator.onLine === false || unloaded.has(b.id) ? "snap" : figView.get(b.id) || "live");
  const focusFig = (id) => { const n = rowOf(id), f = n && n.querySelector(".fig"); if (f) f.focus(); };

  function drawMedia(n, b, ro) {
    const f = n.querySelector(".fig");
    f.setAttribute("aria-label", b.type === "image" ? `Picture${b.text ? `: ${plainOf(b.text)}` : ""}` : `Figma: ${b.title || figmaTitle(b.url) || "a frame"}`);
    if (b.type === "image") drawImage(f, b, ro);
    else drawFigma(f, b, ro);
  }
  function drawImage(f, b, ro) {
    const sig = JSON.stringify([b.file, b.w, b.h, b.width, ro]);
    if (f.dataset.sig === sig) return;
    f.dataset.sig = sig;
    f.dataset.kind = "image";
    let pic = f.querySelector(".pic");
    if (!pic) {
      pic = el("div", { class: "pic" }, el("img", { draggable: "false", alt: "" }),
        el("div", { class: "pic-tools" },
          el("button", { type: "button", "data-do": "caption", text: "Caption" }),
          el("button", { type: "button", "data-do": "replace", text: "Replace" }),
          el("button", { type: "button", "data-do": "open", text: "Open" }),
          el("button", { type: "button", "data-do": "delete", title: "Delete the picture", "aria-label": "Delete the picture", html: SVG.trash })),
        el("span", { class: "hdl l", "data-side": "l", title: "Drag to resize" }), el("span", { class: "hdl r", "data-side": "r", title: "Drag to resize" }));
      f.replaceChildren(pic);
    }
    const img = pic.querySelector("img");
    if (img.getAttribute("src") !== fileUrl(b.file)) img.src = fileUrl(b.file);
    if (b.w && b.h) { img.width = b.w; img.height = b.h; } else { img.removeAttribute("width"); img.removeAttribute("height"); }
    pic.style.width = b.width ? `${b.width}%` : "";
    pic.style.maxWidth = !b.width && b.w ? `min(100%, ${b.w}px)` : "";
    pic.classList.toggle("ro", ro);
  }
  function drawFigma(f, b, ro) {
    const view = viewOf(b), live = view === "live", err = snapErr.get(b.id) || "";
    const title = b.title || figmaTitle(b.url) || "Figma";
    const sig = JSON.stringify([b.url, title, b.snap, b.snap_at, b.w, b.h, ro, view, err, figmaToken.token, dark(), unloaded.has(b.id)]);
    snapSoon(b);
    if (f.dataset.sig === sig) return;
    f.dataset.sig = sig;
    f.dataset.kind = "figma";
    let head = f.querySelector(".fg-head"), band = f.querySelector(".fg-band"), body = f.querySelector(".fg-body");
    if (!head) {
      head = el("div", { class: "fg-head" });
      band = el("div", { class: "fg-band" });
      body = el("div", { class: "fg-body" }, el("img", { class: "fg-snap", alt: "", draggable: "false" }), el("div", { class: "fg-none" }));
      f.replaceChildren(head, band, body);
    }
    const state = live ? "Live" : b.snap ? `Snapshot · ${when(b.snap_at)}` : "No snapshot";
    head.replaceChildren(
      el("span", { class: "fg-mark", html: FIGMA_KIND.glyph }),
      el("b", { class: "fg-name", text: title, title }),
      el("span", { class: `fg-state ${live ? "live" : "snap"}`, text: state }),
      el("span", { class: "fg-gap" }),
      navigator.onLine === false ? null : el("button", { type: "button", class: "fg-btn", "data-do": "view", text: live ? "Snapshot" : "Live",
        title: live ? "Show the snapshot kept of it" : "Show it live, from Figma" }),
      el("a", { class: "fg-btn", href: b.url, target: "_blank", rel: "noopener", text: "Open in Figma" }),
      el("button", { type: "button", class: "fg-btn icon", "data-do": "open", title: "Show it full size", "aria-label": "Show it full size", html: SVG.full }),
      ro ? null : el("button", { type: "button", class: "fg-btn icon", "data-do": "more", title: "More", "aria-label": "More", text: "⋯" }));
    const said = !live ? (unloaded.has(b.id) ? "Figma didn't load here, so this is the snapshot kept of it." : navigator.onLine === false
      ? "Offline: this is the snapshot kept of it." : b.snap ? "" : err || "No snapshot of it yet.")
      : !b.snap && err ? `Your agents can't see this frame: ${err.replace(/\.$/, "")}.` : "";
    band.hidden = !said;
    band.replaceChildren(el("span", { text: said }),
      !ro && !figmaToken.token && /token|public/.test(said) ? el("button", { type: "button", class: "fg-btn", "data-do": "token", text: "Add a Figma token" }) : null,
      unloaded.has(b.id) ? el("button", { type: "button", class: "fg-btn", "data-do": "retry", text: "Try again" }) : null);
    const snap = body.querySelector(".fg-snap"), none = body.querySelector(".fg-none");
    if (b.snap && snap.getAttribute("src") !== fileUrl(b.snap)) snap.src = fileUrl(b.snap);
    snap.hidden = !b.snap;
    none.hidden = !!b.snap || live;
    none.textContent = "No snapshot";
    body.style.aspectRatio = b.w && b.h ? `${b.w} / ${b.h}` : "";
    let frame = body.querySelector("iframe");
    if (!live) { if (frame) frame.remove(); return; }
    const src = embedUrl(b.url);
    if (!frame) {
      frame = el("iframe", { class: "fg-live", allowfullscreen: true, referrerpolicy: "no-referrer-when-downgrade", title: `${title}, live from Figma` });
      body.append(frame);
    }
    if (frame.getAttribute("src") !== src) {
      clearTimeout(frame._wait);
      frame.addEventListener("load", () => clearTimeout(frame._wait), { once: true });
      frame._wait = setTimeout(() => { if (frame.isConnected) { unloaded.add(b.id); redrawFig(b.id); } }, LOAD_WAIT);
      frame.src = src;
    }
  }
  function redrawFig(id) {
    const n = rowOf(id), b = blockOf(id), p = page();
    if (n && b && MEDIA.includes(b.type)) drawMedia(n, b, !!(p && p.deleted));
  }
  // its snapshot asked for: when it has none, or it is SNAP_EVERY old (Figma's file unchanged: the backend keeps it)
  function snapSoon(b, force = false, tell = false) {
    const p = page(), t = now();
    if (!p || p.deleted || b.type !== "figma") return;
    if (!force && (t - (snapAsked.get(b.id) || 0) < SNAP_EVERY || (b.snap && t - (b.snap_at || 0) < SNAP_EVERY))) return;
    snapAsked.set(b.id, t);
    ag.api("figma/snap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block: b.id }) })
      .then((r) => r.json()).then((got) => {
        if (got.error) snapErr.set(b.id, got.error); else snapErr.delete(b.id);
        if (tell) say(got.error ? `No snapshot: ${got.error}` : "The snapshot is up to date", !!got.error);
        redrawFig(b.id);
      }).catch(() => {});
  }
  ag.api("figma").then((r) => r.json()).then((t) => { figmaToken = t; if (page()) drawPage(); }).catch(() => {});
  ag.theme.on(() => { if (page()) drawPage(); });
  for (const e of ["online", "offline"]) addEventListener(e, () => { if (page()) drawPage(); });

  // -- keys in a caption: Enter a line below, Backspace (or ↑) at its start the picture
  function captionKey(ev, p, i, n, tx) {
    const b = p.blocks[i], k = ev.key;
    if (k === "Enter" && !ev.shiftKey) { ev.preventDefault(); addAfter(b, "text"); return true; }
    if ((k === "Backspace" && edge(tx, false)) || (k === "ArrowUp" && onLine(tx, false)) || (k === "ArrowLeft" && edge(tx, false))) {
      ev.preventDefault();
      focusFig(b.id);
      return true;
    }
    if ((k === "Delete" && edge(tx, true)) || k === "Tab") { ev.preventDefault(); return true; }
    return false;
  }

  // -- pictures added: kept by the backend, then put on the page as blocks -- into the empty line they came from, or
  // after `at` ("": first) -- with a line to type in after them if they end the page; one step for ⌘Z
  async function upload(file) {
    const r = await ag.api("image", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    const got = await r.json().catch(() => ({}));
    if (!r.ok || got.error) throw new Error(got.error || `not kept (${r.status})`);
    return got;
  }
  async function putPictures(files, at) {
    say(files.length > 1 ? `Adding ${files.length} pictures…` : "Adding the picture…");
    const made = [];
    for (const f of files) {
      try { made.push({ type: "image", text: "", checked: false, indent: 0, ...(await upload(f)) }); }
      catch (e) { return say(`${f.name || "The picture"}: ${e.message}`, true); }
    }
    say(made.length > 1 ? `${made.length} pictures added` : "Picture added");
    putMedia(made, at && blockOf(at.id));
  }
  function putMedia(made, at, into = null) {
    const p = page();
    if (!p || p.deleted || !made.length) return;
    const tx = at && rowOf(at.id) && rowOf(at.id).querySelector(".tx");
    if (into === null) into = !!(at && at.type === "text" && tx && empty(tx));
    const i = at ? p.blocks.findIndex((x) => x.id === at.id) : -1, ops = [];
    let after = at ? at.id : "", next = p.blocks[i + 1];
    made.forEach((m, j) => {
      const id = j === 0 && into ? at.id : rid();
      if (j === 0 && into) forget(at.id);
      ops.push({ op: "block.put", page: p.id, block: { ...m, id }, ...(j === 0 && into ? {} : { after }) });
      after = id;
    });
    if (!next) { next = { id: rid(), type: "text", text: "", checked: false, indent: 0 }; ops.push({ op: "block.put", page: p.id, block: next, after }); }
    change(ops);
    drawPage();
    focusBlock(next.id, "start");
  }
  function pickFiles(then, many = true) {
    const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml", multiple: many });
    input.addEventListener("change", () => { if (input.files.length) then([...input.files]); });
    input.click();
  }
  const pickPictures = (b) => pickFiles((fs) => putPictures(fs, blockOf(b.id) || b));
  function replacePicture(b) {
    pickFiles(async ([f]) => {
      try {
        const got = await upload(f);
        change([{ op: "block.put", page: current, block: { id: b.id, ...got } }]);
        drawPage();
      } catch (e) { say(`${f.name || "The picture"}: ${e.message}`, true); }
    }, false);
  }
  function dropBlock(b) {
    const p = shown(), i = p.blocks.findIndex((x) => x.id === b.id), near = p.blocks[i + 1] || p.blocks[i - 1];
    forget(b.id);
    change([{ op: "block.delete", page: current, block: b.id }]);
    drawPage();
    if (near) focusBlock(near.id, "start");
  }

  // -- a Figma link: pasted alone on a line (shown live, or kept a link?), or given to the / menu's Figma
  function makeFigma(b, url, into) {
    const at = blockOf(b.id);
    if (at) putMedia([{ type: "figma", url, title: figmaTitle(url), text: "", checked: false, indent: 0 }], at, into);
  }
  function figmaChoice(b, tx, url) {
    const m = popUp(tx.getBoundingClientRect(), (pop) => pop.append(el("div", { class: "hd", text: "Show it as" }),
      item({ glyph: FIGMA_KIND.glyph, label: "The frame, live", note: figmaTitle(url) || "From Figma" }, () => makeFigma(b, url, true)),
      item({ glyph: "↗", label: "A link", note: "Keep it as words" }, () => linkIt(b, url))), null, "figma");
    m.on = 0;
    m.el.querySelector(".it").classList.add("on");
  }
  function figmaKey(ev) {
    const its = [...menu.el.querySelectorAll(".it")];
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      menu.on = (menu.on + 1) % its.length;
      its.forEach((x, j) => x.classList.toggle("on", j === menu.on));
      return true;
    }
    if (ev.key === "Enter") { ev.preventDefault(); its[menu.on].click(); return true; }
    if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
    closePop();                                            // typing on: the link stays as it was pasted
    return false;
  }
  function linkIt(b, url) {
    const x = blockOf(b.id), tx = rowOf(b.id) && rowOf(b.id).querySelector(".tx");
    if (!x || !tx) return;
    const h = clean(`<a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${esc(url)}</a>`);
    forget(x.id);
    x.text = h;
    tx.innerHTML = withLinks(h);
    change([{ op: "block.put", page: current, block: { id: x.id, text: h } }]);
    focusBlock(x.id, "end");
  }
  function figmaBox(b, tx) {
    const m = popUp(tx.getBoundingClientRect(), (pop) => {
      const input = el("input", { class: "fg-input", type: "url", placeholder: "Paste the link to a frame or board", "aria-label": "The Figma link", autocomplete: "off" });
      const bad = el("div", { class: "fg-bad", hidden: true });
      const go = () => {
        const url = input.value.trim();
        if (!FIGMA_URL.test(url)) { bad.textContent = "That isn't a link to a Figma file: figma.com/design/…, /board/…, /proto/…"; bad.hidden = false; return; }
        closePop();
        const at = blockOf(b.id), t = rowOf(b.id) && rowOf(b.id).querySelector(".tx");
        if (at) makeFigma(at, url, !!(t && empty(t) && at.type === "text"));
      };
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
      pop.append(el("div", { class: "hd", text: "Figma" }),
        el("div", { class: "fg-row" }, input, el("button", { type: "button", class: "primary", text: "Show it", onclick: go })), bad,
        el("p", { class: "fg-note", text: "In Figma, right-click a frame and pick Copy link to selection, or use Share, Copy link for the whole file." }));
    }, null, "figma-box", "fg-pop");
    setTimeout(() => { const i = m.el.querySelector("input"); if (i) i.focus(); });
  }
  function tokenBox(rect) {
    const m = popUp(rect, (pop) => {
      const input = el("input", { class: "fg-input", type: "password", placeholder: "figd_…", "aria-label": "Your Figma personal access token", autocomplete: "off" });
      const bad = el("div", { class: "fg-bad", hidden: true });
      const send = async (token) => {
        bad.hidden = true;
        let got;
        try { got = await (await ag.api("figma/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })).json(); }
        catch { got = { error: "the dashboard didn't answer" }; }
        if (got.error) { bad.textContent = got.error; bad.hidden = false; return; }
        figmaToken = { token: !!token, who: got.who || "" };
        closePop();
        say(token ? `Figma token saved${got.who ? ` (${got.who})` : ""}` : "Figma token forgotten");
        snapErr.clear();
        const p = page();
        if (p && token) for (const x of p.blocks) if (x.type === "figma") snapSoon(x, true);
        drawPage();
      };
      const save = () => { if (input.value.trim()) send(input.value.trim()); };
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save(); } });
      pop.append(el("div", { class: "hd", text: "A Figma token" }),
        el("p", { class: "fg-note", text: "With one, Notes keeps a snapshot of any frame you can open in Figma: it shows when Figma can't, and it is what your agents see. Without one, only a public file's cover." }),
        el("p", { class: "fg-note" }, "Make one in Figma's ", el("a", { href: "https://www.figma.com/settings", target: "_blank", rel: "noopener", text: "Settings" }),
          ": Security, Personal access tokens, with read access to file content. It stays on this computer."),
        el("div", { class: "fg-row" }, input, el("button", { type: "button", class: "primary", text: "Save", onclick: save })), bad,
        figmaToken.token ? el("button", { type: "button", class: "fg-forget", text: `Forget the token${figmaToken.who ? ` of ${figmaToken.who}` : ""}`, onclick: () => send("") }) : null);
    }, null, "token", "fg-pop");
    setTimeout(() => { const i = m.el.querySelector("input"); if (i) i.focus(); });
  }
  function figmaMenu(b, rect) {
    popUp(rect, (pop) => pop.append(
      item({ glyph: SVG.restore, sm: true, label: "Fetch the snapshot again" }, () => { unloaded.delete(b.id); snapSoon(b, true, true); }),
      item({ glyph: "⚿", sm: true, label: figmaToken.token ? "Figma token…" : "Add a Figma token…", note: figmaToken.who || "" }, () => tokenBox(rect)),
      item({ glyph: "⧉", sm: true, label: "Copy the link" }, () => navigator.clipboard.writeText(b.url).then(() => say("Link copied"), () => say("Couldn't copy the link", true))),
      el("div", { class: "sep" }),
      item({ glyph: SVG.trash, sm: true, label: "Delete", bad: true }, () => dropBlock(b))));
  }

  // -- a picture's buttons, its sides dragged, and full size
  function figAct(btn) {
    const n = btn.closest(".blk"), b = n && blockOf(n.dataset.id);
    if (!b) return;
    const what = btn.dataset.do, ro = !!page().deleted;
    if (what === "open") return showFull(b);
    if (what === "view") { figView.set(b.id, viewOf(b) === "live" ? "snap" : "live"); unloaded.delete(b.id); return redrawFig(b.id); }
    if (what === "retry") { unloaded.delete(b.id); figView.set(b.id, "live"); return redrawFig(b.id); }
    if (ro) return;
    if (what === "caption") return focusBlock(b.id, "end");
    if (what === "replace") return replacePicture(b);
    if (what === "delete") return dropBlock(b);
    if (what === "token") return tokenBox(btn.getBoundingClientRect());
    if (what === "more") return figmaMenu(b, btn.getBoundingClientRect());
  }
  box.addEventListener("dblclick", (ev) => {
    const img = ev.target.closest(".fig .pic img, .fig .fg-snap");
    const b = img && blockOf(img.closest(".blk").dataset.id);
    if (b) showFull(b);
  });
  box.addEventListener("pointerdown", (ev) => {
    const h = ev.target.closest(".fig .hdl");
    if (!h || ev.button !== 0 || !page() || page().deleted) return;
    ev.preventDefault();
    const n = h.closest(".blk"), pic = h.closest(".pic");
    sizing = { id: n.dataset.id, pic, col: n.querySelector(".fig").getBoundingClientRect().width, x: ev.clientX,
      w: pic.getBoundingClientRect().width, side: h.dataset.side, pct: null };
    h.setPointerCapture(ev.pointerId);
    document.body.classList.add("sizing");
  });
  box.addEventListener("pointermove", (ev) => {
    if (!sizing) return;
    const dx = (ev.clientX - sizing.x) * (sizing.side === "r" ? 1 : -1);   // (at the left edge: the side dragged moves)
    sizing.pct = Math.max(10, Math.min(100, ((sizing.w + dx) / sizing.col) * 100));
    sizing.pic.style.width = `${sizing.pct}%`;
    sizing.pic.style.maxWidth = "";
  });
  const endSize = () => {
    if (!sizing) return;
    const s = sizing;
    sizing = null;
    document.body.classList.remove("sizing");
    if (s.pct === null) return;
    change([{ op: "block.put", page: current, block: { id: s.id, width: Math.round(s.pct) } }]);
    drawPage();
  };
  box.addEventListener("pointerup", endSize);
  box.addEventListener("pointercancel", endSize);
  function showFull(b) {
    const lb = $("lightbox");
    let inner;
    if (b.type === "image") inner = el("img", { src: fileUrl(b.file), alt: plainOf(b.text) });
    else if (viewOf(b) === "live") inner = el("iframe", { src: embedUrl(b.url), allowfullscreen: true, title: `${b.title || figmaTitle(b.url) || "Figma"}, live from Figma` });
    else inner = b.snap ? el("img", { src: fileUrl(b.snap), alt: b.title || "" }) : el("p", { class: "lb-none", text: "No snapshot of it yet." });
    lb.replaceChildren(el("div", { class: `lb-in ${b.type}` }, inner),
      el("button", { type: "button", class: "lb-x", title: "Close (Esc)", "aria-label": "Close", html: SVG.x, onclick: hideFull }));
    lb.dataset.block = b.id;
    lb.hidden = false;
    lb.querySelector(".lb-x").focus();
  }
  function hideFull() {
    const lb = $("lightbox"), id = lb.dataset.block;
    lb.hidden = true;
    lb.replaceChildren();
    if (id) focusFig(id);
  }
  $("lightbox").addEventListener("click", (ev) => { if (ev.target === $("lightbox") || ev.target.classList.contains("lb-in")) hideFull(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("lightbox").hidden) { ev.preventDefault(); ev.stopPropagation(); hideFull(); } }, true);

  // -- pictures dropped on the page: put where the line shows, between lines
  const filesIn = (ev) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
  document.addEventListener("dragover", (ev) => { if (filesIn(ev)) ev.preventDefault(); });   // (never the file opened in the panel)
  document.addEventListener("drop", (ev) => { if (filesIn(ev)) { ev.preventDefault(); $("drop").hidden = true; } });
  $("scroll").addEventListener("dragover", (ev) => {
    const p = page();
    if (!filesIn(ev) || !p || p.deleted || SPECIAL.includes(current)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
    const rows = [...box.children], before = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }) || null;
    const k = before ? rows.indexOf(before) : rows.length;
    dropAt = k ? rows[k - 1].dataset.id : "";
    const at = (before || rows[rows.length - 1] || box).getBoundingClientRect(), left = box.getBoundingClientRect(), line = $("drop");
    line.hidden = false;
    Object.assign(line.style, { left: `${left.left}px`, width: `${left.width}px`, top: `${(before ? at.top : at.bottom) - 2}px` });
  });
  $("scroll").addEventListener("dragleave", (ev) => { if (!ev.relatedTarget || !$("scroll").contains(ev.relatedTarget)) $("drop").hidden = true; });
  $("scroll").addEventListener("drop", (ev) => {
    const p = page();
    if (!filesIn(ev) || !p || p.deleted || SPECIAL.includes(current)) return;
    ev.preventDefault();
    ev.stopPropagation();
    $("drop").hidden = true;
    const pics = [...ev.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (!pics.length) return say("Only pictures can be dropped into the notes", true);
    putPictures(pics, dropAt ? p.blocks.find((x) => x.id === dropAt) : null);
  });

  // ---------------------------------------------------------------- the gatherer's actors (ag.actors), to send blocks to
  let crew = { agents: [], harnesses: [], start: "", home: "" };
  let crewSig = "", crewKnown = false;                    // (not yet: an actor not found is not known gone)
  function takeActors(all) {
    if (all) crewKnown = true;
    const g = all && (all.gatherers || []).find((x) => x.name === ag.gatherer);
    crew = { agents: (g && g.agents) || [], harnesses: (all && all.harnesses) || [],
      start: (g && g.start_cwd) || (all && all.cwd) || "", home: (all && all.home_dir) || "" };
    const sig = JSON.stringify([crew.harnesses, crew.start, crew.agents.map((a) => [a.channel, a.started_as, a.name, a.avatar,
      a.status, a.role, a.saved, a.asking && a.asking.id, a.answerable, a.recap && a.recap.at])]);
    if (sig === crewSig) return;
    crewSig = sig;
    if (!ready) return;
    drawSide();
    if (current === AGENTS) drawAgentsPage(); else drawSent();
    if (menu && menu.kind === "at") drawAt(menu.q || "");
  }
  const isLead = (a) => !!a && a.role === "coordinator";
  // the actor a block went to (a codex actor's thread, the channel it became), or a thread's line is by
  const actorOf = (ch) => (ch === "gatherer" ? crew.agents.find(isLead)
    : crew.agents.find((a) => a.channel === ch || a.started_as === ch)) || null;
  const byOf = (a, by) => !!a && (by === `agent:${a.channel}` || (!!a.started_as && by === `agent:${a.started_as}`));
  const nameOf = (a, ch) => isLead(a) || ch === "gatherer" ? "Gatherer agent"
    : (a && a.name && a.name.text) || `Actor ${short(ch || (a && a.channel))}`;
  const tilde = (path) => (crew.home && path && path.startsWith(crew.home) ? `~${path.slice(crew.home.length)}` : path || "");
  function face(a, size = 18, lead = false) {
    const name = (a && a.avatar) || (lead || isLead(a) ? "roles/manager" : null);
    if (!name) return el("span", { class: "face none", style: `width:${size}px;height:${size}px`, "aria-hidden": "true" });
    return el("img", { class: `face${lead || isLead(a) ? " lead" : ""}`, src: `${DASH}/avatars/${name.split("/").map(encodeURIComponent).join("/")}.svg`,
      alt: "", width: String(size), height: String(size), draggable: "false" });
  }
  // How an actor stands, in a word, as the dashboard's list says it: [class, words]
  const WORDS = { running: ["work", "Working"], building: ["work", "Starting"], background: ["work", "In the background"],
    asking: ["ask", "Needs you"], error: ["bad", "Error"], failed: ["bad", "Failed"], finished: ["done", "Done"],
    closed: ["idle", "Closed"], idle: ["idle", "Idle"] };
  function stands(a) {
    if (!a) return ["gone", "Not here now"];
    const k = (a.status && a.status[0]) || "idle";
    if (a.saved && (k === "idle" || k === "closed")) return ["idle", "Saved"];
    return WORDS[k] || ["idle", (a.status && a.status[1]) || "Idle"];
  }
  // The lines an actor is on now: the ones its latest message is about (ag.actors' `asked_of`, a line of this notebook's,
  // or several sent together: their ids, ", " between), or none -- its latest message came from elsewhere (Chat, another app).
  const linesOn = (a) => (a && a.asked_of && a.asked_of.app === ag.app ? String(a.asked_of.item || "").split(/,\s*/).filter(Boolean) : []);
  // when a line last went to its actor: sent, or the user's latest message about it
  const lastSent = (b) => Math.max(b.sent || 0, ...(b.thread || []).filter((l) => l.by === "user").map((l) => l.at || 0));
  // -- work items (notebook.py): lines sent to an agent, or marked as one; only the reader ends one
  const isWork = (b) => !!b && !UNSENT.includes(b.type) && !!(b.to || b.work);
  // how the reader ended one -- "done", "canceled" -- or "": a to-do one is done as it is ticked
  const endedOf = (b) => (!isWork(b) ? "" : b.ended || (b.type === "todo" && b.checked ? "done" : ""));
  // crossed out, and folded away on its page: a work item the reader ticked (a to-do, done so). Ending one -- accepting
  // or canceling it -- changes no line: the page stays as the reader wrote it, the line's chip saying how its work ended.
  const crossed = (b) => isWork(b) && b.type === "todo" && !!b.checked;
  const endedAt = (b) => b.ended_at || Math.max(b.sent || 0, ...(b.thread || []).map((l) => l.at || 0)) || 0;
  const pageOf = (b) => { const f = findLine(b.id); return f ? f.p : null; };
  const SETTLE = 15;                                       // s: a line just sent to an actor not busy yet: not taken up yet
  // How a work item stands, {key, cls, word} -- its own state, not its actor's alone: ended (done, canceled); sent to no
  // one (new); its actor on it now (run; ask: it asks about it, errs on it, or is gone); reported on since it was last
  // sent, or its actor took it up and stopped without a report (review: the reader's to accept, or send back); sent,
  // its actor on something before it (queue).
  function itemStands(b) {
    const e = endedOf(b);
    if (e) return e === "done" ? { key: "done", cls: "done", word: "Done" } : { key: "canceled", cls: "gone", word: "Canceled" };
    if (!b.to) return { key: "new", cls: "new", word: "Not started" };
    const a = actorOf(b.to), [cls, word] = stands(a);
    if (cls === "gone") return crewKnown ? { key: "ask", cls: "bad", word: "Agent gone" } : { key: "queue", cls: "wait", word: "Sent" };
    const busy = cls === "work" || cls === "ask" || cls === "bad";
    if (busy && linesOn(a).includes(b.id)) return cls === "work" ? { key: "run", cls, word: `${word} · ${since(lastSent(b))}` } : { key: "ask", cls, word };
    const last = [...(b.thread || [])].reverse().find((l) => byOf(a, l.by));
    if (last && (last.at || 0) >= lastSent(b)) return { key: "review", cls: "review", word: "To review" };
    if (busy ? waiting(a, b) : now() - lastSent(b) < SETTLE) return { key: "queue", cls: "wait", word: busy ? "Queued" : "Sent" };
    return { key: "review", cls: "review", word: "To review" };
  }
  // what to say of a work item beside how it stands: what it asks, what it waits for, its latest report
  function itemSaid(b, s = itemStands(b)) {
    const a = b.to ? actorOf(b.to) : null;
    if (s.key === "new") return "Sent to no one yet";
    if (s.key === "ask") return s.word === "Agent gone" ? "Its agent is not here now: send it to another, or cancel it"
      : askedOn(a, b) ? `Asks: ${askLine(a.asking)}` : s.cls === "bad" ? "Its agent stopped with an error" : "";
    if (s.key === "queue" && s.word === "Queued") { const on = linesOn(a).length ? findLine(linesOn(a)[0]) : null; return on ? `After “${oneLine(on.b.text, 60)}”` : "After what it is on now"; }
    const latest = [...(b.thread || [])].reverse().find((l) => l.by !== "user");
    if (s.key === "review" && !(latest && (latest.at || 0) >= lastSent(b))) return "Stopped without a report";
    return latest ? oneLine(latest.text, 240) : "";
  }
  // what its agent said it made (its latest report that names any)
  const madeOf = (b) => ([...(b.thread || [])].reverse().find((l) => l.by !== "user" && l.results) || {}).results || [];
  // ops ending work items as the reader says ("done", "canceled"; "": open again), wherever they are. Ending one ticks
  // no to-do (only the reader ticks one); opening one again unticks it, a ticked to-do being one done.
  function endOps(bs, how) {
    const at = now();
    return bs.map((b) => [pageOf(b), b]).filter(([p]) => p).map(([p, b]) => ({ op: "block.put", page: p.id,
      block: { id: b.id, ended: how, ended_at: at, ...(b.type === "todo" && !how ? { checked: false } : {}) } }));
  }
  function accept(bs) {
    bs = bs.filter((b) => isWork(b) && !endedOf(b));
    if (!bs.length) return;
    change(endOps(bs, "done"));
    say(bs.length === 1 ? "Accepted as done" : `Accepted ${bs.length} lines as done`);
    redraw();
  }
  function reopen(bs) {
    bs = bs.filter((b) => endedOf(b));
    if (!bs.length) return;
    change(endOps(bs, ""));
    redraw();
  }
  function markWork(bs, on) {
    const ops = bs.map((b) => [pageOf(b), b]).filter(([p]) => p).map(([p, b]) => ({ op: "block.put", page: p.id, block: { id: b.id, work: on } }));
    if (!ops.length) return;
    change(ops);
    redraw();
  }
  // Work items canceled: ended so, and an agent still to finish one (on it, or yet to take it up) told to leave it, in
  // a message of the user's -- it reads one sent mid-turn at its next step, as Chat's.
  async function cancel(bs) {
    bs = bs.filter((b) => isWork(b) && !endedOf(b));
    if (!bs.length) return;
    const tell = new Map();                                 // per actor and page: its lines
    for (const b of bs) {
      const s = itemStands(b), p = pageOf(b);
      if (!b.to || !p || !["run", "queue", "ask"].includes(s.key) || s.word === "Agent gone") continue;
      const k = `${b.to} ${p.id}`;
      if (!tell.has(k)) tell.set(k, { to: b.to, p, them: [] });
      tell.get(k).them.push(b);
    }
    change(endOps(bs, "canceled"), false);                 // (its agent told to stop: not to be undone)
    redraw();
    for (const { to, p, them } of tell.values()) {
      const many = them.length > 1, it = many ? "them" : "it";
      const text = `(From my Notes, page ${JSON.stringify(p.title || "Untitled")}, ${many ? `blocks ${them.map((b) => b.id).join(", ")}` : `block ${them[0].id}`}.`
        + ` The user canceled ${many ? "these lines" : "this line"}: stop any work on ${it}, and don't report on ${it}.)`
        + `\n\nCanceled: ${them.map((b) => oneLine(b.type === "code" ? esc(b.text) : b.text, 200)).join("; ")}`;
      try { await ag.actors.send(to, text); } catch (e) { return say(`Canceled, but its agent was not told: ${e.message}`, true); }
    }
    say(bs.length === 1 ? "Canceled" : `Canceled ${bs.length} lines`);
  }
  // all that shows work items drawn again: the sidebar's counts, and the page or Work page shown
  function redraw() { drawSide(); drawPage(); }
  const when = (t) => { const d = new Date(t * 1000); return d.toDateString() === new Date().toDateString() ? clock(t)
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock(t)}`; };
  const ago = (t) => { const s = since(t); return s === "just now" ? s : `${s} ago`; };
  // what a report names it made: links open, the rest said
  const madeRow = (rs) => el("div", { class: "res" }, ...rs.map((r) => (/^https?:\/\/\S+$/.test(r)
    ? el("a", { href: r, target: "_blank", rel: "noopener", title: r, text: r.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60) })
    : el("span", { title: r, text: r }))));
  // a line sent to a busy actor after the one it is on (or while it is on something else): not taken up yet
  function waiting(a, b) {
    const on = linesOn(a)[0], found = on ? findLine(on) : null;
    return !found || lastSent(b) >= lastSent(found.b);       // (sent with it, or after: not taken up yet)
  }
  function findLine(id) {
    for (const p of live()) { const b = p.blocks.find((x) => x.id === id); if (b) return { p, b }; }
    return null;
  }
  // what an actor asks, if it asks it about this line (the line it is on now)
  const askedOn = (a, b) => (a && a.asking && stands(a)[0] === "ask" && linesOn(a).includes(b.id) ? a.asking : null);
  // The lines sent together with one -- to the same actor, as one message: the same `group` -- in the page's order; just
  // it, sent alone. They show once, at the last of them: how they stand together, and one conversation.
  function sentWith(b) {
    const p = pageOf(b);
    if (!p || !b.to || !b.group) return [b];
    const g = p.blocks.filter((x) => x.to === b.to && x.group === b.group);
    return g.includes(b) ? g : [b];
  }
  // How lines sent together stand: their open ones as one -- asking or working before all else; some to review, how
  // many of them; then queued, not started; all of them to review: to review. Every one ended: as the last.
  function groupStands(g) {
    if (g.length === 1) return itemStands(g[0]);
    const open = g.filter((b) => !endedOf(b));
    if (!open.length) return itemStands(g[g.length - 1]);
    const all = open.map(itemStands), first = (...ks) => ks.map((k) => all.find((s) => s.key === k)).find(Boolean);
    const busy = first("ask", "run");
    if (busy) return busy;
    const r = all.filter((s) => s.key === "review").length;
    if (r && r < all.length) return { key: "queue", cls: "review", word: `${r} of ${all.length} to review` };
    return first("queue", "new") || all[0];
  }
  const askedAll = (a, g) => g.map((b) => askedOn(a, b)).find(Boolean) || null;
  // the actor's reports and the user's messages on lines sent together, in the order written (a report saying its line)
  const threadOf = (g) => g.flatMap((x) => (x.thread || []).map((l) => (g.length > 1 && l.by !== "user" ? { ...l, on: oneLine(x.text, 48) } : l)))
    .sort((x, y) => (x.at || 0) - (y.at || 0));
  let sayTimer = 0;
  function say(text, bad = false) {
    const w = $("who");
    w.textContent = text;
    w.classList.toggle("bad", bad);
    w.style.opacity = "1";
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { w.style.opacity = "0"; }, 7000);
  }

  // ---------------------------------------------------------------- a block sent to an actor
  const outgoing = new Set();                              // blocks being sent now
  const quiet = new Set();                                 // ... with others, not the last of them: no status of its own
  // A block's words sent to an actor, as the user's message: an actor there (`channel`; "gatherer", its gatherer agent),
  // or a new one (`harness`, `folder`), with what the user added (`extra`: instructions beyond the line). The block then
  // says who it went to, and with what. The note at its start says where it is from (the Notes app's [asked] reads it
  // back: first, so a message the list cuts short keeps it) and asks for a report on it, if the reader wants one.
  async function sendBlock(id, who, extra = "") {
    flushTyped();
    pump();
    const f = findLine(id), p = f && f.p, b = f && f.b;
    if (!p || !b) return;
    const words = plainOf(b.type === "code" ? esc(b.text) : pagesAsMd(b.text)).trim();
    if (!words) return say("Write what to ask first, then send it.", true);
    const report = store.get("report", true);
    extra = extra.trim();
    const text = `(From my Notes, page ${JSON.stringify(p.title || "Untitled")}, block ${b.id}.`
      + `${report ? " When you're done, report back with notes_report, in one to three lines." : ""})`
      + `\n\n${words}${extra ? `\n\n${extra}` : ""}`;
    outgoing.add(id);
    drawPage();
    try {
      const got = who.harness ? await ag.actors.start({ harness: who.harness, folder: who.folder, text })
        : await ag.actors.send(who.channel, text);
      change([{ op: "block.put", page: p.id, block: { id, to: got.channel, sent: now(), extra: esc(extra).replace(/\n/g, "<br>"), group: "", work: true, ended: "" } }], false);
      say(`Sent to ${nameOf(actorOf(got.channel), who.channel || got.channel)}${who.harness ? ", a new actor" : ""}`);
    } catch (e) {
      say(`Not sent: ${e.message}`, true);
    } finally {
      outgoing.delete(id);
      drawPage();
    }
  }
  // Several lines sent together, as one message: the note names each line (in the order they follow it) and asks for a
  // report on each; the lines as markdown, then what the user added. Each line then says who it went to, as one sent alone,
  // and the `group` they share (`sentWith` finds them by it).
  async function sendBlocks(ids, who, extra = "") {
    flushTyped();
    pump();
    const p = page();
    if (!p) return;
    const bs = sendable(p.blocks.filter((b) => ids.includes(b.id)));
    if (bs.length < 2) return bs.length ? sendBlock(bs[0].id, who, extra) : say("Write what to ask first, then send it.", true);
    const report = store.get("report", true);
    extra = extra.trim();
    const text = `(From my Notes, page ${JSON.stringify(p.title || "Untitled")}, blocks ${bs.map((b) => b.id).join(", ")}: the lines below, in that order.`
      + `${report ? " When you're done, report back on each with notes_report, in one to three lines." : ""})`
      + `\n\n${mdLines(bs).join("\n")}${extra ? `\n\n${extra}` : ""}`;
    for (const b of bs) { outgoing.add(b.id); if (b !== bs[bs.length - 1]) quiet.add(b.id); }
    drawPage();
    try {
      const got = who.harness ? await ag.actors.start({ harness: who.harness, folder: who.folder, text })
        : await ag.actors.send(who.channel, text);
      const at = now(), more = esc(extra).replace(/\n/g, "<br>"), group = rid();
      change(bs.map((b) => ({ op: "block.put", page: p.id, block: { id: b.id, to: got.channel, sent: at, extra: more, group, work: true, ended: "" } })), false);
      unpick();
      say(`Sent ${bs.length} lines to ${nameOf(actorOf(got.channel), who.channel || got.channel)}${who.harness ? ", a new actor" : ""}`);
    } catch (e) {
      say(`Not sent: ${e.message}`, true);
    } finally {
      for (const b of bs) { outgoing.delete(b.id); quiet.delete(b.id); }
      drawPage();
    }
  }
  const sendTo = (ids, who, extra) => (ids.length > 1 ? sendBlocks(ids, who, extra) : sendBlock(ids[0], who, extra));
  // A reply on a block sent to an actor: sent to that actor, then a line of the block's thread. On lines sent together,
  // about them all, and kept on the last of them.
  async function reply(id, words) {
    const f = findLine(id), p = f && f.p, b = f && f.b;
    words = words.trim();
    if (!p || !b || !(b.to || b.source) || !words) return false;
    const g = linesOf(b);
    const text = b.to ? `(A reply in my Notes, page ${JSON.stringify(p.title || "Untitled")}, ${g.length > 1 ? `blocks ${g.map((x) => x.id).join(", ")}` : `block ${b.id}`}.`
      + ` Report back with notes_report when you're done.)\n\n${words}` : followUpText(p, g, words);
    try {
      await ag.actors.send(b.to || b.source, text);
    } catch (e) {
      say(`Not sent: ${e.message}`, true);
      return false;
    }
    change([{ op: "thread.add", page: p.id, block: id, line: { id: rid(), by: "user", text: esc(words).replace(/\n/g, "<br>"), at: now() } }]);
    redraw();
    return true;
  }
  // What a block sent to an actor shows under its words, at the line's end: who it went to (its avatar) and how the
  // line stands (its chip -- the actor's name and its latest report, or what it asks, on hover), and a button that opens
  // the conversation about it beside the page -- "Answer" while it asks the user. Neither the conversation nor a
  // preview of it is on the page.
  function sentPart(n, b, ro) {
    n.classList.remove("has-src");
    if (!isWork(b) && b.source && !outgoing.has(b.id)) return sourcePart(n, b, ro);   // written by an agent: who, not a status
    let part = n.querySelector(":scope > .sent");
    const g = sentWith(b), tail = [...g].reverse().find((x) => !foldedNow.has(x.id)) || g[g.length - 1];   // sent with others: shown once, at the last of them shown
    const has = isWork(b) || (b.thread && b.thread.length) || outgoing.has(b.id);
    const open = !!convo && g.some((x) => x.id === convo.block);
    n.classList.toggle("convo-on", !!has && open);
    if (!has || b !== tail || (quiet.has(b.id) && !b.to)) { if (part) part.remove(); return; }
    if (!part) { part = el("div", { class: "sent" }); n.append(part); }
    const a = b.to ? actorOf(b.to) : null;
    const sendingNow = outgoing.has(b.id) && !b.to;
    const s = sendingNow ? { key: "run", cls: "work", word: "Sending…" } : isWork(b) ? groupStands(g) : { key: "none", cls: "idle", word: "Sent to no one now" };
    const cls = s.cls, word = s.word, name = b.to ? nameOf(a, b.to) : "";
    const asks = !!askedAll(a, g);
    const latest = [...threadOf(g)].reverse().find((l) => l.by !== "user");
    const said = asks ? `Asks: ${askLine(a.asking)}` : g.length > 1 ? (latest ? oneLine(latest.text, 240) : "") : isWork(b) ? itemSaid(b, s) : "";
    const count = (b.sent ? 1 : 0) + g.reduce((k, x) => k + (x.thread || []).length, 0);
    const review = s.key === "review" && !ro, talks = !sendingNow && (!!b.to || count > 0);
    const sig = JSON.stringify([cls, word, name, a && a.avatar, said, count, asks, open, ro, g.length, review, talks]);
    if (part.dataset.sig === sig) return;
    part.dataset.sig = sig;
    const talk = () => toggleConvo(b.id);
    const told = `${name ? `${name}: ` : ""}${word}${g.length > 1 ? ` (${g.length} lines sent together)` : ""}${said ? `\n${said}` : ""}`;   // on hover, not on the page
    part.replaceChildren(...[                              // (the slots left empty: none drawn, not "null")
      b.to ? el("button", { type: "button", class: `chip ${cls}`, title: `${told}\n(${open ? "close" : "open"} the conversation)`,
        "aria-label": told, onclick: talk }, face(a, 16), el("span", { text: word }))
        : el("span", { class: `chip ${cls}`, title: told, "aria-label": told }, el("span", { text: word })),
      review ? el("button", { type: "button", class: "accept", text: "Accept", title: "Accept it as done", onclick: () => accept(g) }) : null,
      !talks ? null : asks && !open ? el("button", { type: "button", class: "talk answer", text: "Answer", onclick: () => openConvo(b.id) })
        : el("button", { type: "button", class: `talk${open ? " on" : ""}`, title: open ? "Close the conversation" : "Open the conversation",
          "aria-label": `${open ? "Close" : "Open"} the conversation: ${count} message${count === 1 ? "" : "s"}`, onclick: talk },
          el("span", { html: SVG.bubble }), el("span", { text: String(count) }))].filter(Boolean));
  }
  // ---------------------------------------------------------------- lines an agent wrote from its conversation
  // Lines an agent wrote from its own conversation with the user (`source`, `source_at`: notes_add or notes_change with
  // from_conversation) name it, once, at the end of the last of them: its avatar -- who wrote them and when, on hover,
  // and how it stands while it is on a follow-up about them -- which opens the conversation about them beside the page,
  // where the user follows up with it (`reply`). They were not sent to it: no status of their own, and no work for it
  // until the user asks.
  function writtenWith(b) {
    const p = page();
    if (!p || !b.source) return [b];
    const g = p.blocks.filter((x) => x.source === b.source && x.source_at === b.source_at);
    return g.includes(b) ? g : [b];
  }
  // the lines a block shows with: those sent with it (to an actor), else those written with it (by one), else itself
  const linesOf = (b) => (b.to ? sentWith(b) : b.source ? writtenWith(b) : [b]);
  const wroteAt = (t) => new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  // how the agent that wrote lines stands with them: on a follow-up about them (working, needs you, error), else no word
  function standsSrc(a, g) {
    const [cls, word] = stands(a);                         // (one no longer here: its avatar alone, as one idle)
    return (cls === "work" || cls === "ask" || cls === "bad") && g.some((x) => linesOn(a).includes(x.id)) ? [cls, word] : ["src", ""];
  }
  // ... said in the conversation's head
  const srcStands = (a, g) => { const [cls, word] = standsSrc(a, g); return { key: "source", ...(!a ? { cls: "gone", word: "Not here now" } : cls === "src" ? { cls: "idle", word: "Wrote this" } : { cls, word }) }; };
  const wroteLine = (b) => `Written from your conversation with ${nameOf(actorOf(b.source), b.source)} · ${wroteAt(b.source_at)}`;
  // A follow-up on lines an agent wrote: to that agent, as the user's message -- the note first (the Notes app's [asked]
  // reads it back), naming the lines and when it wrote them, then the lines, then what the user asks.
  function followUpText(p, g, words) {
    const many = g.length > 1;
    return `(A reply in my Notes, page ${JSON.stringify(p.title || "Untitled")}, ${many ? `blocks ${g.map((x) => x.id).join(", ")}` : `block ${g[0].id}`}:`
      + ` about ${many ? "lines" : "a line"} you wrote there on ${wroteAt(g[0].source_at)}, from our conversation.`
      + ` Answer as always, then put one to three lines beside ${many ? "them" : "it"} with notes_report${many ? `, one report, on block ${g[g.length - 1].id}` : ""}.)`
      + `\n\n${mdLines(g).join("\n")}\n\n${words}`;
  }
  function sourcePart(n, b, ro) {
    let part = n.querySelector(":scope > .sent");
    const g = writtenWith(b), tail = g[g.length - 1];     // written with others: shown once, at the last of them
    const open = !!convo && g.some((x) => x.id === convo.block);
    n.classList.toggle("convo-on", open);
    if (b !== tail) { if (part) part.remove(); return; }
    n.classList.add("has-src");                           // (its Ask button would cover the avatar: @ or its menu sends it)
    if (!part) { part = el("div", { class: "sent" }); n.append(part); }
    const a = actorOf(b.source), name = nameOf(a, b.source);
    const [cls, word] = standsSrc(a, g);
    const asks = !!askedAll(a, g);
    const count = g.reduce((k, x) => k + (x.thread || []).length, 0);
    const sig = JSON.stringify(["src", cls, word, name, a && a.avatar, count, asks, open, ro, g.length, b.source_at]);
    if (part.dataset.sig === sig) return;
    part.dataset.sig = sig;
    const talk = () => toggleConvo(b.id);
    const told = `Written by ${name} from your conversation · ${wroteAt(b.source_at)}${g.length > 1 ? ` (${g.length} lines)` : ""}${word ? `\n${name}: ${word}` : ""}`;
    const kids = [el("button", { type: "button", class: `chip ${cls}`, title: `${told}\n(${open ? "close the conversation" : "follow up with it"})`,
      "aria-label": told, onclick: talk }, face(a, 16), word ? el("span", { text: word }) : null)];
    if (asks && !open) kids.push(el("button", { type: "button", class: "talk answer", text: "Answer", onclick: () => openConvo(b.id) }));
    else if (count) kids.push(el("button", { type: "button", class: `talk${open ? " on" : ""}`, title: open ? "Close the conversation" : "Open the conversation",
      "aria-label": `${open ? "Close" : "Open"} the conversation: ${count} message${count === 1 ? "" : "s"}`, onclick: talk },
      el("span", { html: SVG.bubble }), el("span", { text: String(count) })));
    part.replaceChildren(...kids);
  }

  // what an actor asks, in a line
  function askLine(ask) {
    const q = ask.questions && ask.questions[0];
    return ask.kind === "permission" ? `to ${ask.said || `use ${ask.tool || "a tool"}`}`
      : ask.kind === "plan" ? "approve its plan" : ask.kind === "dialog" ? ask.said || "a question in its terminal"
      : q ? q.question || "a question" : "a question";
  }

  // ---------------------------------------------------------------- the conversation about a line, beside the page
  // Opened from a sent line's status: the line as it was sent, then its thread -- the user's messages (each sent to the
  // actor too) and the actor's reports -- as bubbles; what it asks, answered there; a box to message it. One at a time,
  // on the page shown; another line's status shows that one's instead. Three parts, each drawn again only when it
  // changed: the message typed is never drawn over.
  let convo = null;                                       // {page, block}: the line whose conversation is open
  function openConvo(id) {
    convo = { page: current, block: id };
    drawPage();
    const input = $("convo").querySelector(".reply input");
    if (input && !input.disabled) input.focus();
  }
  function closeConvo() {
    if (!convo) return;
    convo = null;
    drawPage();
  }
  const toggleConvo = (id) => (convo && convo.block === id ? closeConvo() : openConvo(id));
  function drawConvo() {
    const box = $("convo");
    const p = convo && current === convo.page ? pages.get(convo.page) : null;
    let b = p && p.blocks.find((x) => x.id === convo.block);
    const g = b ? linesOf(b) : [];
    if (b && g[g.length - 1] !== b) { b = g[g.length - 1]; convo.block = b.id; }   // lines sent together: one conversation, the last's
    if (!b || !(b.to || b.source || (b.thread && b.thread.length))) {
      convo = null;
      box.hidden = true;
      box.replaceChildren();
      delete box.dataset.block;
      app.classList.remove("convo-open");
      return;
    }
    app.classList.add("convo-open");
    box.hidden = false;
    if (box.dataset.block !== b.id) {
      box.dataset.block = b.id;
      box.replaceChildren(el("div", { class: "cv-head" }), el("div", { class: "cv-list", role: "log", "aria-live": "polite" }), el("div", { class: "cv-foot" }));
    }
    const who = b.to || b.source || "", a = who ? actorOf(who) : null, name = who ? nameOf(a, who) : "", ro = !!p.deleted;
    const s = isWork(b) ? groupStands(g) : b.source ? srcStands(a, g) : { key: "none", cls: "idle", word: "Sent to no one now" }, cls = s.cls, word = s.word;
    const words = (x) => (x.type === "code" ? esc(x.text) : x.text);
    const about = g.length > 1 ? `${g.length} lines: ${g.map((x) => oneLine(words(x), 60)).join(" · ")}` : oneLine(words(b), 160);
    const head = box.querySelector(".cv-head");
    const headSig = JSON.stringify([cls, word, name, a && a.avatar, about, !!a, b.source, b.source_at]);
    if (head.dataset.sig !== headSig) {
      head.dataset.sig = headSig;
      head.replaceChildren(
        el("div", { class: "cv-who" }, who ? face(a, 22) : null, el("b", { text: name || "No one" }), el("span", { class: `pill ${cls}`, text: word }),
          el("button", { type: "button", class: "cv-x", title: "Close", "aria-label": "Close the conversation", html: SVG.x, onclick: () => closeConvo() })),
        el("button", { type: "button", class: "cv-about", title: `${g.map((x) => oneLine(words(x), 400)).join("\n")}\n(show ${g.length > 1 ? "them" : "it"} on the page)`, onclick: () => {
          const rs = g.map((x) => rowOf(x.id)).filter(Boolean);
          if (rs[0]) rs[0].scrollIntoView({ block: "center", behavior: "smooth" });
          for (const r of rs) { r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); }
        } }, el("span", { class: "dim", text: "About: " }), about || "(empty)"),
        b.source ? el("div", { class: "cv-src", text: wroteLine(b) }) : "",
        a ? el("button", { type: "button", class: "cv-chat", text: "Open its Chat", onclick: () => ag.actors.show(who).catch((e) => say(e.message, true)) }) : "");
    }
    const list = box.querySelector(".cv-list");
    const lines = b.to ? threadOf(g) : threadOf(g).map((l) => ({ ...l, verb: "replied" }));
    const ask = askedAll(a, g);
    const listSig = JSON.stringify([g.map((x) => [x.id, x.text]), b.sent, b.extra, b.to ? 0 : b.source_at, lines.map((l) => [l.id, l.by === "user" ? "" : (actorOf(l.by.slice(6)) || {}).avatar || ""]),
      ask && ask.id, a && a.answerable, ro]);
    if (list.dataset.sig !== listSig) {
      const fresh = list.dataset.sig === undefined, atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.dataset.sig = listSig;
      list.replaceChildren(
        ...(b.sent ? [bubble({ by: "user", at: b.sent,                  // the line(s) as sent, with what the user added
          text: g.map(words).join("<br>") + (b.extra ? `<br><br>${b.extra}` : ""),
          note: g.length > 1 ? `${g.length} lines, as one message` : "" })]
          : b.source ? [bubble({ by: `agent:${b.source}`, at: b.source_at, verb: "wrote", text: g.map(words).join("<br>") })] : []),   // the line(s) as it wrote them
        ...lines.map(bubble),
        ...(ask ? [askCard(a, ask, b, ro)] : []));
      if (fresh || atEnd) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });   // once laid out
    }
    const foot = box.querySelector(".cv-foot");
    let end = foot.querySelector(".cv-end");
    if (!end) { end = el("div", { class: "cv-end" }); foot.prepend(end); }
    drawEnd(end, g, s, ro);
    let r = foot.querySelector(".reply");
    if ((b.to || b.source) && !ro) {
      if (!r) { r = replyBox(b.id); for (const x of foot.querySelectorAll(".cv-none")) x.remove(); foot.append(r); }
      r.querySelector("input").placeholder = !b.to ? `Follow up with ${name}` : s.key === "review" ? `Send it back to ${name}: what's left` : `Message ${name}`;
    } else if (r || !foot.querySelector(".cv-none")) {
      if (r) r.remove();
      foot.append(el("div", { class: "cv-none", text: ro ? "This page is in the trash."
        : "Sent to no one now: send the line to an agent again to talk about it." }));
    }
  }
  // Above the message box, whether it is done -- the reader's to say: to review, Accept or Cancel (or a message sending
  // it back); while it is worked on, the same as quiet links; ended, how, and Reopen.
  function drawEnd(end, g, s, ro) {
    const open = g.filter((x) => isWork(x) && !endedOf(x));
    const sig = JSON.stringify([s.key, open.map((x) => x.id), ro, g.map(endedOf)]);
    if (end.dataset.sig === sig) return;
    end.dataset.sig = sig;
    end.replaceChildren();
    if (ro || !g.some(isWork)) return;
    if (!open.length) {
      const e = endedOf(g[g.length - 1]), at = Math.max(...g.map(endedAt));
      end.append(el("div", { class: "cv-ended" }, el("span", { class: `pill ${e === "done" ? "done" : ""}`, text: e === "done" ? "Accepted as done" : "Canceled" }),
        at ? el("span", { class: "dim", text: when(at) }) : null,
        el("button", { type: "button", class: "link", text: "Reopen", onclick: () => reopen(g) })));
      return;
    }
    if (s.key === "review") {
      end.append(el("div", { class: "cv-q", text: open.length > 1 ? `Are these ${open.length} done?` : "Is it done?" }),
        el("div", { class: "cv-acts" },
          el("button", { type: "button", class: "accept big", text: "Accept: it's done", onclick: () => accept(open) }),
          el("button", { type: "button", class: "plain", text: "Cancel it", onclick: () => cancel(open) })),
        el("div", { class: "cv-hint", text: "Or send it back with what's left:" }));
      return;
    }
    end.append(el("div", { class: "cv-acts quiet" },
      el("button", { type: "button", class: "link", text: "Accept as done", onclick: () => accept(open) }),
      el("button", { type: "button", class: "link", text: "Cancel it", title: "Cancel it, and tell its agent to stop", onclick: () => cancel(open) })));
  }
  function bubble(l) {
    const mine = l.by === "user", ch = mine ? "" : l.by.slice(6), a = mine ? null : actorOf(ch);
    return el("div", { class: `msg${mine ? " you" : ""}` },
      mine ? null : face(a, 20),
      el("div", { class: "mb" },
        el("div", { class: "bub", html: withLinks(clean(l.text)) }),
        l.results && l.results.length ? madeRow(l.results) : null,
        el("div", { class: "mm", text: mine ? `You · ${clock(l.at)}${l.note ? ` · ${l.note}` : ""}` : `${nameOf(a, ch)} ${l.verb || "reported"}${l.on ? ` on “${l.on}”` : ""}${l.done ? ", says it's done" : ""} · ${l.verb === "wrote" ? wroteAt(l.at) : clock(l.at)}` })));
  }
  function replyBox(id) {
    const input = el("input", { type: "text", "aria-label": "Reply", autocomplete: "off" });
    const go = async () => {
      if (!input.value.trim() || input.disabled) return;
      input.disabled = true;
      if (await reply(id, input.value)) input.value = "";
      input.disabled = false;
      input.focus();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); go(); }
      else if (ev.key === "Escape") { ev.preventDefault(); if (input.value) input.blur(); else closeConvo(); }
    });
    return el("div", { class: "reply" }, input,
      el("button", { type: "button", title: "Send", "aria-label": "Send the message", html: SVG.send, onclick: go }));
  }
  // What an actor asks, in the conversation about the block it was sent: answered here, as Chat answers it, where the
  // dashboard's terminal
  // has the question and nothing was typed there since (`answerable`) -- a permission (allow, deny), or one question
  // picked from its options; anything else in its Chat.
  function askCard(a, ask, b, ro) {
    const qs = ask.questions || [], one = qs.length === 1 && !qs[0].multiSelect ? qs[0] : null;
    const card = el("div", { class: "ask-card" }, el("div", { class: "ask-hd" }, face(a, 14), el("span", { text: `${nameOf(a, b.to)} asks` })));
    const answer = async (choice, btns) => {
      for (const x of btns) x.disabled = true;
      try { await ag.actors.answer(a.channel, ask.id, choice); say("Answered"); }
      catch (e) { say(`Not answered: ${e.message}`, true); for (const x of btns) x.disabled = false; }
    };
    const can = a.answerable && !ro;
    const acts = el("div", { class: "ask-acts" });
    const btn = (label, choice) => el("button", { type: "button", text: label, onclick: () => answer(choice, acts.querySelectorAll("button")) });
    if (ask.kind === "permission") {
      card.append(el("div", { class: "ask-q", text: `To ${ask.said || `use ${ask.tool || "a tool"}`}` }));
      if (can) acts.append(btn("Allow", { allow: true }), btn("Deny", { allow: false, text: null }));
    } else if (ask.kind !== "plan" && ask.kind !== "dialog" && one) {
      card.append(el("div", { class: "ask-q", text: one.question || "" }));
      if (can) acts.append(...(one.options || []).map((o, j) => btn(o.label || `Option ${j + 1}`, { answers: [{ options: [j] }] })));
    } else {
      card.append(el("div", { class: "ask-q", text: ask.kind === "plan" ? "It has a plan for you to approve."
        : ask.kind === "dialog" ? ask.said || "It asks in its terminal." : `${qs.length} questions` }));
    }
    acts.append(el("button", { type: "button", class: "link", text: ask.kind === "dialog" || !a.answerable ? "Answer in its terminal" : "Answer in Chat",
      onclick: () => ag.actors.show(a.channel).catch((e) => say(e.message, true)) }));
    card.append(acts);
    return card;
  }
  // Every block of the page shown that was sent to an actor drawn again (how its actor stands changed; time passed).
  function drawSent() {
    if (current === WORK || current === LOG) return drawWorkPage();
    const p = page();
    if (!p) return;
    for (const b of p.blocks) {
      const n = rowOf(b.id);
      if (!n) continue;
      if (b.type === "agents") drawAgentsBlock(n);
      else if (b.type === "work") drawWorkBlock(n);
      else if (isWork(b) || b.source || (b.thread && b.thread.length)) sentPart(n, b, !!p.deleted);
    }
    drawConvo();
  }

  // ---------------------------------------------------------------- the picker: who a block goes to, and with what
  // `@` typed at a word's start in a block (as `/` opens the block menu), or its Assign / Ask button: the gatherer agent,
  // the actors (not closed ones, but saved ones), a new actor on each harness the dashboard runs here -- and, above
  // them, a box for what to add to the line (instructions it doesn't say yet), sent with it. What is typed after the @
  // narrows the agents, Tab goes into the box; ↑↓ pick, ↵ sends (⇧↵ a new line in the box), Esc closes. Opened by the
  // button, the box has the keys at once.
  function atInput(n, tx, b, ev) {
    if (menu && menu.kind === "at" && menu.tx) {
      const c = caretIn(tx);
      if (menu.tx !== tx || !c || c.start <= menu.from || tx.textContent[menu.from] !== "@") return closePop();
      const q = tx.textContent.slice(menu.from + 1, c.start);
      if (q.length > 30 || /\s\s/.test(q)) return closePop();
      return drawAt(q);
    }
    if (ev.inputType !== "insertText" || ev.data !== "@" || UNSENT.includes(b.type) || b.type === "code") return;
    const c = caretIn(tx);
    if (!c) return;
    const before = tx.textContent.slice(0, c.start - 1);
    if (before && !/\s$/.test(before)) return;           // an address's @ (a@b.c): not
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    atPop(r.width || r.height ? r : tx.getBoundingClientRect(), { tx, from: c.start - 1, block: b.id });
  }
  function openPicker(id, rect, ids = null) {
    atPop(rect, { tx: null, block: id, blocks: ids && ids.length > 1 ? ids : null });
    if (menu && menu.extra) menu.extra.focus();          // at once: keys typed next are its, however busy the page is
  }
  // the picker's frame: its head, the box for what to add (kept as the agents are drawn again), the agents, its foot
  function atPop(rect, m) {
    popUp(rect, (pop) => {
      const many = m.blocks ? m.blocks.length : 0;
      const extra = el("textarea", { class: "at-extra", rows: "1", "aria-label": `Instructions to send with the line${many ? "s" : ""}`,
        placeholder: m.tx ? "Add instructions (optional): Tab to type here" : "Add instructions (optional)" });
      extra.addEventListener("input", () => { extra.style.height = "auto"; extra.style.height = `${Math.min(extra.scrollHeight, 140)}px`; });
      extra.addEventListener("keydown", (ev) => extraKey(ev, extra));
      pop.append(el("div", { class: "hd lead", text: many ? `Send ${many} lines to an agent, as one message of yours` : "Send it to an agent, as your message" }), extra,
        el("div", { class: "at-list", role: "group", "aria-label": "Agents" }), el("div", { class: "at-end" }));
      menu.extra = extra;
    }, null, "at", "at-pop");
    Object.assign(menu, { rect, q: "", ...m });
    drawAt("");
  }
  function atItems(q) {
    const words = q.trim().toLowerCase();
    const hit = (...xs) => !words || xs.some((x) => String(x || "").toLowerCase().includes(words));
    const out = [];
    const lead = crew.agents.find(isLead);
    if (hit("gatherer agent", "coordinator", "manager"))
      out.push({ kind: "lead", group: "Coordinator", channel: lead ? lead.channel : "gatherer", a: lead, label: "Gatherer agent",
        note: "hands it to an actor, now or once another is done" });
    const shown = crew.agents.filter((a) => !isLead(a) && ((a.status || [])[0] !== "closed" || a.saved))
      .sort((x, y) => (y.last || 0) - (x.last || 0));
    for (const a of shown) if (hit(nameOf(a), a.last_user_message, a.channel))
      out.push({ kind: "actor", group: "Actors", channel: a.channel, a, label: nameOf(a), note: oneLine(a.last_user_message || "", 60) });
    for (const h of crew.harnesses) if (hit(`new ${h.label} actor`))
      out.push({ kind: "new", group: "Start a new actor on it", harness: h.name, label: `New ${h.label} actor`, note: `in ${tilde(crew.start) || "a folder you name"}` });
    if (crew.harnesses.length && hit("new actor in another folder"))
      out.push({ kind: "where", group: "Start a new actor on it", label: "In another folder…", note: "" });
    return out;
  }
  function drawAt(q) {
    const items = atItems(q);
    Object.assign(menu, { items, q, on: Math.min(menu.on || 0, Math.max(0, items.length - 1)) });
    if (menu.tx) menu.qEnd = menu.from + 1 + q.length;   // where the "@..." typed ends, should the caret leave the block
    const pop = menu.el, list = pop.querySelector(".at-list"), report = store.get("report", true);
    list.replaceChildren();
    if (!items.length) list.append(el("div", { class: "none", text: crew.agents.length || crew.harnesses.length ? "No agent like that" : "No agents here yet" }));
    let group = null;
    items.forEach((it, j) => {
      if (it.group !== group) { group = it.group; list.append(el("div", { class: "hd", text: group })); }
      const [cls, word] = it.a ? stands(it.a) : it.kind === "lead" ? ["idle", "Starts on it"] : [null, null];
      const row = el("button", { class: `it${j === menu.on ? " on" : ""}`, type: "button", role: "menuitem",
        onmousedown: (ev) => ev.preventDefault(), onclick: () => atPick(it) },
        it.kind === "new" || it.kind === "where" ? el("span", { class: "gl sm", html: SVG.plus }) : face(it.a, 24, it.kind === "lead"),
        el("span", { class: "tt" }, el("span", { text: it.label }), it.note ? el("small", { text: it.note }) : null),
        word ? el("span", { class: `pill ${cls}`, text: word }) : null);
      row.addEventListener("mousemove", () => { if (menu && menu.on !== j) { menu.on = j; drawAt(q); } });
      list.append(row);
    });
    pop.querySelector(".at-end").replaceChildren(el("div", { class: "sep" }), el("button", { type: "button", class: "at-foot", role: "checkbox",
      "aria-checked": String(report), onmousedown: (ev) => ev.preventDefault(), onclick: () => { store.set("report", !report); drawAt(q); } },
      el("span", { class: "box", html: report ? SVG.check : "" }), el("span", { text: "Ask it to report back here" }),
      el("small", { text: "↑↓ ↵" })));
    place(pop, menu.rect);
    const on = list.querySelector(".it.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }
  function atKey(ev) {
    const n = menu.items ? menu.items.length : 0;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawAt(menu.q || ""); }
      return true;
    }
    if (ev.key === "Tab" && menu.extra) { ev.preventDefault(); menu.extra.focus(); return true; }
    if (ev.key === "Enter" && n) { ev.preventDefault(); atPick(menu.items[menu.on]); return true; }
    if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
    return false;
  }
  // the box's own keys, kept from the page's: ↵ sends to the agent picked, ⇧↵ a new line; ↑↓ pick while it is one line;
  // Esc closes (back into the block the @ was typed in)
  function extraKey(ev, box) {
    ev.stopPropagation();
    if (ev.isComposing || !menu) return;
    const n = menu.items ? menu.items.length : 0;
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); if (n) atPick(menu.items[menu.on]); return; }
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && !box.value.includes("\n")) {
      ev.preventDefault();
      if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawAt(menu.q || ""); }
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      const tx = menu.tx;
      closePop();
      if (tx && tx.isConnected) tx.focus();
      else if (picked.size) holdKeys();                   // (sent from lines picked: they keep the keys)
    }
  }
  // Who was picked: the "@..." typed taken out of the block, and the block sent with what was added -- or, for another
  // folder, that asked first.
  function atPick(it) {
    const m = menu, extra = m && m.extra ? m.extra.value : "";
    closePop();
    if (!m) return;
    const b = (findLine(m.block) || {}).b;                // (the Work page's Assign: a line of any page)
    if (!b) return;
    if (m.tx && m.tx.isConnected) {
      const tx = m.tx, n = tx.closest(".blk"), c = caretIn(tx);
      const end = c && c.start > m.from ? c.start : m.qEnd || m.from + 1;
      const r = document.createRange(), a = pointAt(tx, m.from), z = pointAt(tx, Math.max(end, m.from + 1));
      r.setStart(a.node, a.offset);
      r.setEnd(z.node, z.offset);
      r.deleteContents();
      if (tx.innerHTML === "<br>") tx.innerHTML = "";
      b.text = textOf(n, b);
      forget(b.id);
      change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } }]);
    }
    if (it.kind === "where") return folderAsk(m.blocks || [b.id], m.rect, extra);
    sendTo(m.blocks || [b.id], it.kind === "new" ? { harness: it.harness, folder: crew.start } : { channel: it.channel }, extra);
  }
  // A new actor's folder, asked: typed, and a harness picked.
  function folderAsk(ids, rect, extra) {
    popUp(rect, (pop) => {
      const input = el("input", { type: "text", value: tilde(crew.start), "aria-label": "The folder it works in", placeholder: "~/a/folder" });
      const go = (h) => {
        const v = input.value.trim().replace(/^~(?=\/|$)/, crew.home);
        if (!v) return input.focus();
        closePop();
        sendTo(ids, { harness: h, folder: v }, extra);
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && crew.harnesses[0]) { e.preventDefault(); go(crew.harnesses[0].name); } });
      pop.append(el("div", { class: "hd", text: "A new actor, working in" }), el("div", { class: "row" }, input),
        el("div", { class: "row" }, ...crew.harnesses.map((h) => el("button", { type: "button", text: h.label, onclick: () => go(h.name) }))));
      setTimeout(() => input.focus(), 0);
    }, null, "menu", "at-pop");
  }

  // ---------------------------------------------------------------- the Agents page, and an agents block
  // Every actor of the gatherer: how it stands, the blocks sent to it (newest first), and its last report -- else its
  // recap. Needing the user first, then at work, then by when last active. Saved and closed ones as the reader picks.
  function agentsTable(showSaved, showClosed) {
    const sent = new Map(), last = new Map();
    for (const p of live()) for (const b of p.blocks) {
      const a = b.to ? actorOf(b.to) : null;
      if (a) { if (!sent.has(a.channel)) sent.set(a.channel, []); sent.get(a.channel).push({ p, b }); }
      for (const l of b.thread || []) {
        if (l.by === "user") continue;
        const who = actorOf(l.by.slice(6));
        if (who && (!last.has(who.channel) || last.get(who.channel).at <= l.at)) last.set(who.channel, l);
      }
    }
    const rank = (a) => ({ ask: 0, work: 1, bad: 2 })[stands(a)[0]] ?? 3;
    const rows = crew.agents.filter((a) => isLead(a) || (a.saved ? showSaved : (a.status || [])[0] === "closed" ? showClosed : true))
      .sort((x, y) => rank(x) - rank(y) || (y.last || 0) - (x.last || 0));
    if (!rows.length) return el("div", { class: "agt-none", text: crew.agents.length ? "No actor to show: tick Saved or Closed to see those"
      : "No actors in this gatherer yet. Type @ in a line to send it to a new one." });
    const go = (p, b) => { openPage(p.id); requestAnimationFrame(() => { const r = rowOf(b.id); if (r) { r.scrollIntoView({ block: "center" }); r.classList.add("flash"); } }); };
    const tr = (a) => {
      const [cls, word] = stands(a);
      const mine = (sent.get(a.channel) || []).sort((x, y) => (y.b.sent || 0) - (x.b.sent || 0));
      const l = last.get(a.channel);
      return el("tr", { class: cls === "ask" ? "asks" : null },
        el("td", {}, el("button", { type: "button", class: "who-btn", title: `Open ${nameOf(a)}'s Chat`,
          onclick: () => ag.actors.show(a.channel).catch((e) => say(e.message, true)) }, face(a, 20), el("b", { text: nameOf(a) }))),
        el("td", {}, el("span", { class: `pill ${cls}`, text: word })),
        el("td", { class: "from" }, ...(mine.length ? mine.slice(0, 2).map(({ p, b }) => el("button", { type: "button", class: `blk-link${b.type === "todo" && b.checked ? " done" : ""}`,
          title: `On “${p.title || "Untitled"}”`, onclick: () => go(p, b), text: oneLine(b.text, 70) || "(empty)" })) : [el("span", { class: "dim", text: "—" })]),
          mine.length > 2 ? el("span", { class: "dim", text: `+${mine.length - 2} more` }) : null),
        el("td", { class: "said" }, l ? el("span", {}, oneLine(l.text, 160), el("span", { class: "dim", text: ` · ${clock(l.at)}` }))
          : cls === "ask" && a.asking ? el("span", {}, `Asks: ${(a.asking.questions && a.asking.questions[0] && a.asking.questions[0].question) || a.asking.said || "something"}`)
          : a.recap ? el("span", { class: "dim" }, `Recap: ${a.recap.text}`) : el("span", { class: "dim", text: "—" })));
    };
    return el("div", { class: "tbl-wrap" }, el("table", { class: "agt-tbl" },
      el("thead", {}, el("tr", {}, ...["Agent", "Status", "From your notes", "Last report"].map((t) => el("th", { scope: "col", text: t })))),
      el("tbody", {}, ...rows.map(tr))));
  }
  function shows() {
    const box = (k, label) => el("label", {}, el("input", { type: "checkbox", checked: store.get(k, k === "saved") ? true : null,
      onchange: (ev) => { store.set(k, ev.target.checked); if (current === AGENTS) drawAgentsPage(); else drawSent(); } }), label);
    return el("div", { class: "agt-show" }, el("span", { text: "Show:" }), box("saved", "Saved"), box("closed", "Closed"));
  }
  function drawAgentsPage() {
    const needs = crew.agents.filter((a) => stands(a)[0] === "ask").length;
    $("agents-page").replaceChildren(
      el("h1", { class: "pg-title", text: "Agents" }),
      el("p", { class: "agt-sub", text: `Every actor of ${ag.gatherer}, what you sent it from your notes, and what it last reported${needs ? `. ${needs} need${needs === 1 ? "s" : ""} you.` : "."}` }),
      agentsTable(store.get("saved", true), store.get("closed", false)), shows(),
      el("p", { class: "agt-sub dim", text: "Type /agents on any page to put this table there." }));
  }
  function drawAgentsBlock(n) {
    const box = n.querySelector(".agt");
    if (!box) return;
    box.replaceChildren(el("div", { class: "agt-hd" }, el("span", { html: SVG.people }), el("span", { text: "Agents" })),
      agentsTable(store.get("saved", true), store.get("closed", false)));
  }
  function agentsEntry() {
    const needs = crew.agents.filter((a) => stands(a)[0] === "ask").length;
    return el("div", { class: `pg-row agents-row${current === AGENTS ? " on" : ""}`, role: "treeitem", "aria-selected": String(current === AGENTS),
      onclick: () => openPage(AGENTS) },
      el("span", { class: "caret none" }), el("span", { class: "ic", html: SVG.people }), el("span", { class: "nm", text: "Agents" }),
      needs ? el("span", { class: "needs", title: `${needs} waiting for you`, text: `${needs} need${needs === 1 ? "s" : ""} you` }) : null);
  }


  // ---------------------------------------------------------------- the Work page, the Logbook, and a work block
  // Every open work item of the notebook by how it stands -- needs you, to review, working, queued, not started -- and
  // those accepted in the last week (folded); each with its agent, page, latest report and what it made, and what the
  // reader may do with it. The Logbook: every ended one, by the day it was ended. A work block: the open ones, on a page.
  const GROUPS = [
    { key: "ask", name: "Needs you", hint: "Its agent waits on you" },
    { key: "review", name: "To review", hint: "Its agent stopped: accept it, or send it back with what's left" },
    { key: "run", name: "Working", hint: "An agent is on it now" },
    { key: "queue", name: "Queued", hint: "Sent: its agent gets to it after what it is on" },
    { key: "new", name: "Not started", hint: "Marked, sent to no one yet" },
    { key: "done", name: "Done", hint: "Accepted in the last 7 days" },
  ];
  const WEEK = 7 * 86400;
  function workItems() {
    const out = [];
    for (const p of live()) for (const b of p.blocks) if (isWork(b)) out.push({ p, b, s: itemStands(b) });
    return out;
  }
  const isOpen = (x) => x.s.key !== "done" && x.s.key !== "canceled";
  const forYou = () => workItems().filter((x) => x.s.key === "ask" || x.s.key === "review").length;
  const wordsOf = (b) => oneLine(b.type === "code" ? esc(b.text) : b.text, 160) || "(empty)";
  // A work item shown on its page: the page opened (its ended lines shown, if it is one of them), the line flashed --
  // and its conversation opened, if asked for and it has one.
  function goLine(p, b, talk = false) {
    if (foldOf(p).has(b.id)) showDone(p.id, true);
    openPage(p.id);
    if (talk && (b.to || (b.thread && b.thread.length))) openConvo(b.id);
    requestAnimationFrame(() => {
      const r = rowOf(b.id);
      if (r) { r.scrollIntoView({ block: "center" }); r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); }
    });
  }
  function workRow({ p, b, s }, compact = false) {
    const a = b.to ? actorOf(b.to) : null, done = s.key === "done";
    const said = done || s.key === "new" ? "" : itemSaid(b, s), made = done ? [] : madeOf(b);   // (not started: its meta says "No one yet")
    const latest = [...(b.thread || [])].reverse().find((l) => l.by !== "user");
    const time = done ? `accepted ${when(endedAt(b))}` : s.key === "review" && latest && (latest.at || 0) >= lastSent(b) ? `reported ${ago(latest.at)}`
      : b.to && s.key !== "run" ? `sent ${ago(lastSent(b))}` : "";
    const btn = (label, cls, run, title) => el("button", { type: "button", class: `wk-btn${cls ? ` ${cls}` : ""}`, text: label, title: title || null, onclick: run });
    const pick = (ev) => openPicker(b.id, ev.currentTarget.getBoundingClientRect());
    const acts = s.key === "ask" ? (s.word === "Agent gone" ? [btn("Cancel", "", () => cancel([b])), btn("Send to…", "primary", pick)]
      : [btn("Answer", "answer", () => goLine(p, b, true), "Open its conversation, where it asks")])
      : s.key === "review" ? [btn("Send back", "", () => goLine(p, b, true), "Open its conversation, to say what's left"), btn("Accept", "accept", () => accept([b]), "Accept it as done")]
      : s.key === "run" || s.key === "queue" ? [btn("Cancel", "", () => cancel([b]), "Cancel it, and tell its agent to stop")]
      : s.key === "new" ? [btn("Remove", "", () => markWork([b], false), "Not a work item: the line stays on its page"),     // (done without an agent: ended here)
        btn("Cancel", "", () => cancel([b]), "Cancel it: into the Logbook, as canceled"), btn("Done", "accept", () => accept([b]), "Accept it as done: no agent needed"),
        btn("Assign", "primary", pick, "Send it to an agent")]
      : [btn("Reopen", "", () => reopen([b]))];
    const pill = compact || s.key === "run" || s.key === "ask" || s.word === "Sent";
    return el("div", { class: `wk-row ${s.key}`, "data-id": b.id },
      b.to ? face(a, compact ? 18 : 22) : el("span", { class: "face dash", style: `width:${compact ? 18 : 22}px;height:${compact ? 18 : 22}px`, "aria-hidden": "true" }),
      el("div", { class: "wk-main" },
        el("button", { type: "button", class: "wk-text", title: "Show it on its page", onclick: () => goLine(p, b, !done && s.key !== "new") }, wordsOf(b)),
        el("div", { class: "wk-meta" }, pill ? el("span", { class: `pill ${s.cls}`, text: s.word }) : null,
          el("span", { text: [b.to ? nameOf(a, b.to) : "No one yet", p.title || "Untitled", time].filter(Boolean).join(" · ") })),
        said && !compact ? el("div", { class: "wk-said", text: said }) : null,
        made.length && !compact ? madeRow(made) : null),
      el("div", { class: "wk-acts" }, ...acts));
  }
  function drawWorkPage() {
    const box = $("work-page");
    if (current === LOG) return drawLogbook(box);
    const items = workItems(), open = items.filter(isOpen), on = new Set(open.map((x) => x.p.id)).size;
    const doneOpen = store.get("workDone", false);
    const sections = GROUPS.map((g) => {
      let its = items.filter((x) => x.s.key === g.key);
      if (g.key === "done") its = its.filter((x) => now() - endedAt(x.b) < WEEK).sort((x, y) => endedAt(y.b) - endedAt(x.b));
      else if (g.key !== "new") its.sort((x, y) => lastSent(x.b) - lastSent(y.b));   // oldest first: waited longest
      if (!its.length) return null;
      const folded = g.key === "done" && !doneOpen;
      return el("section", { class: `wk-group ${g.key}`, "aria-label": g.name },
        el("div", { class: "wk-hd" }, el("h2", { text: g.name }), el("span", { class: `wk-n ${g.key}`, text: String(its.length) }),
          el("span", { class: "wk-hint", text: g.hint }),
          g.key === "done" ? el("button", { type: "button", class: "wk-fold", "aria-expanded": String(!folded), text: folded ? "Show" : "Hide",
            onclick: () => { store.set("workDone", folded); drawWorkPage(); } }) : null),
        folded ? null : el("div", { class: "wk-list" }, ...its.map((x) => workRow(x))));
    }).filter(Boolean);
    box.replaceChildren(
      el("h1", { class: "pg-title", text: "Work" }),
      el("p", { class: "agt-sub", text: open.length ? `${open.length} open across ${on} page${on === 1 ? "" : "s"}. You decide when each is done.` : "Nothing open." }),
      ...(sections.length ? sections : [el("div", { class: "wk-none", text: "No work items yet. Send a line to an agent (type @ in it), or mark one from its menu (⋮⋮), and it shows here." })]),
      el("p", { class: "agt-sub dim" }, "Older finished items are in the ", el("button", { type: "button", class: "link", text: "Logbook", onclick: () => openPage(LOG) }),
        ". Type /work on any page to put the open ones there."));
  }
  const dayOf = (t) => {
    const d = new Date(t * 1000), y = new Date(Date.now() - 86400000);
    return d.toDateString() === new Date().toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday"
      : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  };
  function drawLogbook(box) {
    const items = workItems().filter((x) => !isOpen(x)).sort((x, y) => endedAt(y.b) - endedAt(x.b)).slice(0, 300);
    const days = [];
    for (const x of items) {
      const d = dayOf(endedAt(x.b));
      if (!days.length || days[days.length - 1].d !== d) days.push({ d, items: [] });
      days[days.length - 1].items.push(x);
    }
    box.replaceChildren(
      el("h1", { class: "pg-title", text: "Logbook" }),
      el("p", { class: "agt-sub", text: "Work items you accepted or canceled, newest first. They stay on their pages, folded away, so agents reading the notes still see them." }),
      ...(days.length ? days.map(({ d, items: its }) => el("section", { class: "lg-day", "aria-label": d }, el("h2", { text: d }),
        el("div", { class: "lg-list" }, ...its.map(logRow))))
        : [el("div", { class: "wk-none", text: "Nothing done or canceled yet. Work items you accept or cancel show here." })]));
  }
  function logRow({ p, b, s }) {
    const a = b.to ? actorOf(b.to) : null, done = s.key === "done", made = madeOf(b);
    return el("div", { class: `lg-row${done ? "" : " canceled"}`, "data-id": b.id },
      el("span", { class: "lg-mk", role: "img", "aria-label": done ? "Done" : "Canceled", html: done ? SVG.check : SVG.x }),
      el("div", { class: "wk-main" },
        el("div", { class: "wk-text", text: wordsOf(b) }),
        el("div", { class: "wk-meta" }, el("span", { text: [b.to ? nameOf(a, b.to) : "No agent", p.title || "Untitled", `${done ? "accepted" : "canceled"} ${clock(endedAt(b))}`].join(" · ") })),
        made.length ? madeRow(made) : null),
      el("div", { class: "wk-acts" },
        el("button", { type: "button", class: "wk-btn link", text: "Show line", onclick: () => goLine(p, b) }),
        el("button", { type: "button", class: "wk-btn", text: "Reopen", onclick: () => reopen([b]) })));
  }
  function drawWorkBlock(n) {
    const box = n.querySelector(".wkb");
    if (!box) return;
    const keys = GROUPS.map((g) => g.key), items = workItems().filter(isOpen).sort((x, y) => keys.indexOf(x.s.key) - keys.indexOf(y.s.key));
    box.replaceChildren(el("div", { class: "agt-hd" }, el("span", { html: SVG.work }), el("span", { text: `Work items · ${items.length} open` }),
      el("button", { type: "button", class: "wk-go", text: "Open the Work page", onclick: () => openPage(WORK) })),
      items.length ? el("div", { class: "wk-list compact" }, ...items.map((x) => workRow(x, true))) : el("div", { class: "agt-none", text: "Nothing open." }));
  }
  function workEntry() {
    const n = forYou();
    return el("div", { class: `pg-row spec-row${current === WORK ? " on" : ""}`, role: "treeitem", "aria-selected": String(current === WORK), onclick: () => openPage(WORK) },
      el("span", { class: "caret none" }), el("span", { class: "ic", html: SVG.work }), el("span", { class: "nm", text: "Work" }),
      n ? el("span", { class: "needs", title: `${n} waiting for you: an answer, or your review`, text: `${n} for you` }) : null);
  }
  function logEntry() {
    return el("div", { class: `pg-row spec-row${current === LOG ? " on" : ""}`, role: "treeitem", "aria-selected": String(current === LOG), onclick: () => openPage(LOG) },
      el("span", { class: "caret none" }), el("span", { class: "ic", html: SVG.log }), el("span", { class: "nm", text: "Logbook" }));
  }

  // ---------------------------------------------------------------- start
  try { book = await (await ag.api("state")).json(); } catch { book = { version: 0, pages: [] }; }
  if (!book || !Array.isArray(book.pages)) book = { version: 0, pages: [] };
  reindex();
  ready = true;
  for (const m of early.splice(0)) heard(m);
  const kept = store.get("page", null);
  current = SPECIAL.includes(kept) ? kept : kept && pages.has(kept) && !pages.get(kept).deleted ? kept : (kidsOf(null)[0] || {}).id || null;
  takeActors(ag.actors.current);
  ag.actors.on(takeActors);
  setInterval(() => { if (!document.hidden) drawSent(); }, 30_000);   // "Working · 4m": kept current
  for (let p = pages.get(current); p && p.parent; p = pages.get(p.parent)) opened.add(p.parent);
  if (narrow()) app.classList.remove("side-on");
  drawSide();
  drawPage();
  document.body.dataset.ready = "1";
})();
