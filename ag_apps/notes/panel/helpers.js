// Notes: small helpers -- the blocks' types and the kinds the / menu offers, the icons, ids, the kit's `el`,
// a line's words cleaned (DOMPurify's allowlist, before any is put in the page) or as plain text, and times said.

export const $ = (id) => document.getElementById(id);
export const TYPES = ["text", "h1", "h2", "h3", "todo", "bullet", "number", "quote", "code", "divider"];
export const INDENTED = ["text", "todo", "bullet", "number", "quote"];
export const LISTS = ["todo", "bullet", "number"];
export const MAX_INDENT = 6;
export const PH = { text: "Type ‘/’ for commands", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", todo: "To-do", bullet: "List",
  number: "List", quote: "Quote", code: "Code", image: "Add a caption", figma: "Add a caption" };
export const MEDIA = ["image", "figma"];                 // blocks that show a picture: their words, its caption
export const KINDS = [                                   // the / menu, and a block's "Turn into"
  { type: "text", label: "Text", note: "Plain text", glyph: "Aa", words: "text plain paragraph" },
  { type: "h1", label: "Heading 1", note: "A big section heading", glyph: "H1", words: "h1 heading title" },
  { type: "h2", label: "Heading 2", note: "A medium heading", glyph: "H2", words: "h2 heading subtitle" },
  { type: "h3", label: "Heading 3", note: "A small heading", glyph: "H3", words: "h3 heading" },
  { type: "todo", label: "To-do list", note: "Things to tick off", glyph: "☐", words: "todo to-do check task checkbox" },
  { type: "bullet", label: "Bulleted list", note: "A simple list", glyph: "•", words: "bullet list ul unordered" },
  { type: "number", label: "Numbered list", note: "A list with numbers", glyph: "1.", words: "number numbered list ol ordered" },
  { type: "quote", label: "Quote", note: "Capture a quote", glyph: "❝", words: "quote blockquote" },
  { type: "code", label: "Code", note: "Code snippet", glyph: "</>", words: "code snippet pre" },
  { type: "divider", label: "Divider", note: "A line between sections", glyph: "—", words: "divider line rule hr separator" },
  { type: "agents", label: "Agents", note: "Your actors and their status", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="6" cy="5.5" r="2.2"/><circle cx="11.5" cy="6.2" r="1.7"/><path d="M2 13c.5-2.3 2-3.4 4-3.4s3.5 1.1 4 3.4M10 9.9c.5-.3 1-.4 1.5-.4 1.5 0 2.5.9 2.9 2.6"/></svg>', words: "agents actors status table team" },
  { type: "work", label: "Work items", note: "Open work items and their status", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6.5"/></svg>', words: "work items tasks open tracker board" },
];
export const PAGE_KIND = { type: "page-new", label: "Page", note: "A new page inside this one", glyph: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2v3.3h3.3M8.25 7.6v4.2M6.15 9.7h4.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>', words: "page subpage new child doc document" };   // in the / menu too, not a block's type
export const LINK_KIND = { type: "page-link", label: "Link to a page", note: "Or type [[", glyph: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2v3.3h3.3M6 8.2h4.5M6 10.8h4.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>', words: "link page mention reference subpage" };   // in the / menu, not a block's type
export const IMAGE_KIND = { type: "image-new", label: "Image", note: "Upload, paste or drop a picture", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M2.3 11l3.4-3.4 2.8 2.8 1.8-1.8 3.4 3.4" stroke-linecap="round"/><circle cx="10.6" cy="6" r="1.1"/></svg>', words: "image picture photo png jpg screenshot figure upload" };   // in the / menu, not a block's type
export const FIGMA_KIND = { type: "figma-new", label: "Figma", note: "A live frame or board", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M5.5 2v12M10.5 2v12M2 5.5h12M2 10.5h12"/></svg>', words: "figma figjam design frame board embed diagram drawing" };
export const TABLE_KIND = { type: "table-new", label: "Table", note: "Rows and columns", glyph: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M2 9.8h12M6.5 3v10"/></svg>', words: "table grid rows columns spreadsheet cells" };   // in the / menu, not a block's type
export const ICONS = ["📄", "📝", "✅", "📌", "📚", "💡", "🎯", "🚀", "🛒", "🏠", "💼", "🧪", "🐛", "🔧", "📅", "⭐", "❤️", "🔥", "🌱", "🎨",
  "🎵", "✈️", "🍳", "💰", "📈", "🧠", "☕", "🗂️", "🔖", "🧩", "🏃", "📖", "🎓", "🧾", "📦", "⚙️", "🗒️", "🌟", "🍀", "🐣"];
export const SVG = {
  plus: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  grip: '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.3"/><circle cx="7.5" cy="2.5" r="1.3"/><circle cx="2.5" cy="7" r="1.3"/><circle cx="7.5" cy="7" r="1.3"/><circle cx="2.5" cy="11.5" r="1.3"/><circle cx="7.5" cy="11.5" r="1.3"/></svg>',
  caret: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3.5 2l3.5 3-3.5 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
  doc: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2v3.3h3.3M6 8.2h4.5M6 10.8h4.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  side: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.8" y="2.5" width="12.4" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 2.8v10.4" stroke="currentColor" stroke-width="1.3"/></svg>',
  hide: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4L4 8l4 4M12.5 4l-4 4 4 4"/></svg>',
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
export function rid() {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789", a = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (const x of a) s += c[x % 36];
  return s;
}
export function el(...a) { return window.agKit.el(...a); }   // the panels' kit (app_kit/js/kit.js)
export const clean = (h) => window.DOMPurify.sanitize((h || "").replace(/\u200b/g, ""), { ALLOWED_TAGS: ["b", "i", "u", "s", "code", "a", "br"], ALLOWED_ATTR: ["href"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|page:[a-z0-9]{6,24}$|ag:\/\/[a-z])/i })
  .replace(/<(b|i|u|s|code)><\/\1>/g, "").replace(/^(<br>)+$/, "");
export const plainOf = (h) => { const t = document.createElement("template"); t.innerHTML = (h || "").replace(/<br>/g, "\n"); return t.content.textContent; };
export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export const now = () => Date.now() / 1000;
export const DASH = new URLSearchParams(location.search).get("host") || "";   // the dashboard's origin: its avatars
export const AGENTS = "@agents";                       // the Agents page (no page of the notebook: never an id)
export const WORK = "@work", LOG = "@logbook";         // the Work page, the Logbook (nor these)
export const SPECIAL = [WORK, LOG, AGENTS];
export const UNSENT = ["divider", "agents", "work", "image", "figma", "table"];   // blocks with nothing in them to send (a caption is no line of work)
export const short = (ch) => String(ch || "").slice(0, 8);
export const since = (t) => { const d = Math.max(0, now() - (t || now())); return d < 60 ? "just now" : d < 3600 ? `${Math.round(d / 60)}m`
  : d < 86400 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`; };
export const clock = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const oneLine = (h, n = 120) => { const t = plainOf(h).replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
