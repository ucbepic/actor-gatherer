// Markdown, as the page draws a message: marked (GFM) and DOMPurify, the vendored scripts index.html loads before the
// page (window.marked, window.DOMPurify); raw HTML in a message shown as the agent wrote it, not rendered; links
// opening apart, a link to something in an app (`ag://<app>/...`, features/apps/links.ts) kept and marked with the app's
// mark (.ag-link: the page opens it there, src/features/layout/panes.js); fenced code coloured (codeFence); LaTeX math
// drawn by KaTeX (tex.ts). And a block a harness's model writes in a reply that its own
// terminal draws apart (harness_kit's `reply_block`), drawn as a card. Without the vendored scripts, the text as it is.
import { useDashboard } from "../store";
import { escapeHtml } from "./html";
import { codeFence, foldKept } from "./highlight/fence";
import { hasTex, loadTex, mathBlock, onTexLoaded, TEX_PURIFY, texExtensions, texLoaded, typeset } from "./tex";

/** As much of marked and DOMPurify as the page uses. */
interface Marked {
  use(options: {
    gfm: boolean;
    breaks: boolean;
    renderer: {
      html: (token: { text: string }) => string;
      code: (token: { text: string; lang?: string }) => string;
    };
    extensions: typeof texExtensions;
  }): void;
  parse(text: string, options?: { breaks: boolean }): string;
}
interface Purify {
  sanitize(html: string, config?: { ALLOWED_URI_REGEXP?: RegExp; ADD_TAGS?: string[]; ADD_ATTR?: string[] }): string;
  addHook(hook: "afterSanitizeAttributes", run: (node: Element) => void): void;
}
declare global {
  interface Window {
    marked?: Marked;
    DOMPurify?: Purify;
  }
}

// DOMPurify's own list of the links it keeps (its ALLOWED_URI_REGEXP), `ag://` ones (links to things in apps) and
// `file://` ones: a file's, which the page opens in an app as it does a path (src/features/layout/panes.js's openFileLink)
const URIS =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|ag:\/\/[a-z]|file:\/\/(?:localhost)?\/|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;
const APP_LINK = /^ag:\/\/([a-z][a-z0-9_]{0,23})(?:[/?#]|$)/;
// A file's path, as an agent writes one (no scheme, not to a host, not an anchor or query alone), or a file:// link:
// marked data-path, for the page to open in an app that shows files (src/features/layout/panes.js's openFileLink; the rules
// it is read by, features/apps/links.ts's filePath) -- not a link the dashboard draws itself, as /api/image?…
const FILE_LIKE = /^(?:file:\/\/|(?![a-z][a-z0-9+.-]*:|\/\/|[#?~]))./i;

let ready: boolean | undefined;
/** marked and DOMPurify set up as the page uses them, once: whether they are there. */
function setUp(): boolean {
  if (ready === undefined) {
    const { marked, DOMPurify } = window;
    ready = !!marked && !!DOMPurify;
    if (marked && DOMPurify) {
      marked.use({
        gfm: true,
        breaks: false,
        renderer: {
          html: ({ text }) => escapeHtml(text),
          code: ({ text, lang }) => (lang === "math" ? mathBlock(text) : codeFence(text, lang)),
        },
        extensions: texExtensions,
      });
      DOMPurify.addHook("afterSanitizeAttributes", (n) => {
        if (n.tagName !== "A") return;
        const app = APP_LINK.exec(n.getAttribute("href") || "");
        if (app) {
          // a link to something in an app: opened by the page, never by the browser; its app's mark before it
          n.classList.add("ag-link");
          n.setAttribute("data-app", app[1]);
          n.setAttribute("style", `--ag-mark: url("/apps/mark/${app[1]}.svg")`);
          n.removeAttribute("target");
          return;
        }
        if (FILE_LIKE.test(n.getAttribute("href") || "")) {
          n.setAttribute("data-path", "");
          n.removeAttribute("target");
          return;
        }
        n.setAttribute("target", "_blank");
        n.setAttribute("rel", "noopener noreferrer");
      });
    }
  }
  return ready;
}

// A block a harness's model writes in a reply that its own terminal draws apart (harness_kit's `reply_block`: codex's
// proposed plan, between <proposed_plan> and </proposed_plan>), each tag on a line of its own (the closing one perhaps
// not streamed yet). markdown() draws it as a card headed as the harness heads it. A tag in a sentence is only words.
export interface ReplyBlock {
  open: string;
  close: string;
  title: string;
}
interface Block extends ReplyBlock {
  re: RegExp;
  tags: RegExp;
}
const reEscape = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
let blocksOf: Block[] = [],
  blocksFrom: unknown = null;

/** The harnesses' reply blocks, from the home's harness_info (the store's: the stream's last home). */
export function replyBlocks(): Block[] {
  const info = useDashboard.getState().home?.harness_info || {};
  if (blocksFrom !== info) {
    blocksFrom = info;
    blocksOf = Object.values(info)
      .map((h) => h.reply_block)
      .filter((b): b is ReplyBlock => !!(b && b.open && b.close))
      .map((b) => ({
        ...b,
        re: new RegExp(
          `^${reEscape(b.open)}[ \\t]*(?:\\r?\\n|$)([\\s\\S]*?)\\s*(?:^${reEscape(b.close)}[ \\t]*$|(?![\\s\\S]))`,
          "m",
        ),
        tags: new RegExp(`^(?:${reEscape(b.open)}|${reEscape(b.close)})[ \\t]*(?:\\r?\\n|$)`, "gm"),
      }));
  }
  return blocksOf;
}

/** A reply less its blocks' tags: its words, as a summary line shows them. */
export const unplanned = (t: unknown): string => replyBlocks().reduce((s, b) => s.replace(b.tags, ""), String(t ?? ""));

/** A reply with a harness's block in it: what is around the block, its heading, and what is in it. */
export interface Reply {
  before: string;
  title: string;
  inner: string;
  after: string;
}

export function splitReply(text: string): Reply | null {
  const block = typeof text === "string" ? replyBlocks().find((b) => text.includes(b.open)) : null;
  const plan = block ? block.re.exec(text) : null;
  if (!block || !plan) return null;
  return {
    before: text.slice(0, plan.index).trim(),
    title: block.title,
    inner: plan[1],
    after: text.slice(plan.index + plan[0].length).trim(),
  };
}

const mdCache = new Map<string, string>(); // a text's rendered markdown: the same text renders the same

/**
 * `text` as HTML, sanitized: what a message's box holds. `breaks`: each line break kept, for text written as lines
 * rather than as markdown (a subagent's report). null: no marked or DOMPurify, so no markdown. Math in it is typeset
 * once KaTeX is loaded; before then (loading it) it shows as written, and that HTML is not kept: drawn again once it
 * loads (onTexLoaded), the math is typeset.
 */
export function markdownHtml(text: string, breaks = false): string | null {
  if (!setUp()) return null;
  const k = (breaks ? "\u0001" : "") + text;
  let html = mdCache.get(k);
  if (html === undefined) {
    let keep = true;
    try {
      const parsed = window.marked!.parse(text, breaks ? { breaks: true } : undefined);
      const katex = hasTex(parsed) ? texLoaded() : null;
      if (katex === undefined) {
        keep = false;
        void loadTex();
      }
      html = window.DOMPurify!.sanitize(
        katex ? typeset(parsed, katex) : parsed,
        katex ? { ALLOWED_URI_REGEXP: URIS, ...TEX_PURIFY } : { ALLOWED_URI_REGEXP: URIS },
      );
    } catch {
      html = escapeHtml(text);
    }
    if (!keep) return html;
    if (mdCache.size > 2000) mdCache.clear();
    mdCache.set(k, html);
  }
  return html;
}

/** Whether `html` (markdownHtml's) shows math as written, KaTeX not yet loaded to typeset it. */
export const texWaiting = (html: string) => hasTex(html) && !texLoaded();

const div = (cls: string, ...kids: Node[]) => {
  const n = document.createElement("div");
  n.className = cls;
  n.append(...kids);
  return n;
};

/** `text` drawn as markdown into a box of its own (.md): a harness's block in it as a card (.proposed-plan). */
export function markdown(text: string, breaks = false): HTMLDivElement {
  const reply = splitReply(text);
  if (reply) {
    // a harness's block: what is around it as it is, the block as a card
    const head = div("pp-head");
    head.textContent = reply.title;
    return div(
      "md",
      ...[
        reply.before && markdown(reply.before, breaks),
        div("proposed-plan", head, markdown(reply.inner, breaks)),
        reply.after && markdown(reply.after, breaks),
      ].filter((n): n is HTMLDivElement => !!n),
    );
  }
  const box = div("md");
  const html = markdownHtml(text, breaks);
  if (html === null) {
    box.style.whiteSpace = "pre-wrap";
    box.textContent = text;
    return box;
  }
  box.innerHTML = html; // sanitized by DOMPurify, raw HTML escaped before it
  foldKept(box);
  if (texWaiting(html)) {
    // its math typeset once KaTeX loads: the box drawn again
    const stop = onTexLoaded(() => {
      stop();
      box.innerHTML = markdownHtml(text, breaks) ?? box.innerHTML;
      foldKept(box);
    });
  }
  return box;
}
