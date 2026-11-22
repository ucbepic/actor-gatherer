// LaTeX in a message, as md.ts draws one: math between `$…$` or `\(…\)` (in a line), `$$…$$` or `\[…\]` (displayed,
// set apart when on lines of their own), and a ```math block, as GitHub takes it. marked's extensions here find it
// before markdown does (so a `_` or `*` in it is TeX's, not emphasis), and leave each in a placeholder showing it as
// written; typeset() draws them with KaTeX, which the page loads only once a message has some (loadTex()). A formula
// KaTeX can't read stays as written, the reason in its tooltip.
//
// A single `$` is math only as Pandoc takes it, so prices and shell variables stay words: the opening `$` is followed
// by no space (nor written after a letter or digit, as US$5), the closing one comes after no space and before no
// digit, and no line ends between them: "$5 and $10" and "$5-$10" are not math, "$x^2$" is. Nor does it run into code
// (`$HOME`), and what starts with a number and has spaces in it is math only with something of TeX's in it: "$40 a day,
// 2$" is words, "$2 + 2 = 4$" math.
import { escapeHtml } from "./html";

type Katex = typeof import("katex").default;

/** As much of marked's extension API as these use: a token, and what it was found in. */
interface TexToken {
  type: string;
  raw: string;
  tex: string;
  display: boolean;
}
interface Found {
  type: string;
  raw: string;
}

/** A placeholder for `tex`, showing `raw` (the formula as written) until typeset() draws it. */
function placeholder(tex: string, raw: string, display: boolean, block = false): string {
  const tag = block ? "div" : "span";
  const cls = display ? "md-tex md-tex-display" : "md-tex";
  return `<${tag} class="${cls}" data-tex="${escapeHtml(tex)}">${escapeHtml(raw)}</${tag}>${block ? "\n" : ""}`;
}

/** A ```math block's placeholder: its lines displayed. */
export const mathBlock = (text: string) => placeholder(text, "```math\n" + text + "\n```", true, true);

const BLOCK_DOLLARS = /^ {0,3}\$\$((?:\\[\s\S]|[^\\$]|\$(?!\$))+?)\$\$[ \t]*(?:\n+|$)/;
const BLOCK_BRACKETS = /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/;
const BLOCK_START = /(?:^|\n) {0,3}(?:\$\$|\\\[)/;
const DISPLAY_DOLLARS = /^\$\$((?:\\[\s\S]|[^\\$]|\$(?!\$))+?)\$\$/;
const DISPLAY_BRACKETS = /^\\\[([\s\S]+?)\\\]/;
const PARENS = /^\\\(([\s\S]+?)\\\)/;
const DOLLAR = /^\$((?:\\[^\n]|[^\\$\n`])+?)\$(?!\d)/;
const TEXISH = /[\\^_{}=+<>|]/;
const INLINE_START = /\$|\\[([]/;
const BLANK_LINE = /\n[ \t]*\n/;

/** A formula's TeX as found, less the space around it: none when empty, or (as TeX itself refuses) with a blank line
 * in it. */
const body = (tex: string | undefined) => (tex && tex.trim() && !BLANK_LINE.test(tex) ? tex.trim() : null);

/** marked's extensions for math: displayed math on lines of its own, and math in a line. */
export const texExtensions = [
  {
    name: "texBlock",
    level: "block" as const,
    // where a paragraph stops, so a formula on the lines after it is displayed, not taken into it
    start(src: string): number | undefined {
      const m = BLOCK_START.exec(src);
      return m ? m.index + (m[0][0] === "\n" ? 1 : 0) : undefined;
    },
    tokenizer(src: string): TexToken | undefined {
      const m = BLOCK_DOLLARS.exec(src) || BLOCK_BRACKETS.exec(src);
      const tex = body(m?.[1]);
      return m && tex ? { type: "texBlock", raw: m[0], tex, display: true } : undefined;
    },
    renderer: (t: TexToken) => placeholder(t.tex, t.raw.trim(), true, true),
  },
  {
    name: "tex",
    level: "inline" as const,
    start(src: string): number | undefined {
      const i = src.search(INLINE_START);
      return i < 0 ? undefined : i;
    },
    tokenizer(src: string, tokens: Found[]): TexToken | undefined {
      for (const [re, display] of [
        [DISPLAY_DOLLARS, true],
        [DISPLAY_BRACKETS, true],
        [PARENS, false],
      ] as const) {
        const m = re.exec(src);
        const tex = body(m?.[1]);
        if (m && tex) return { type: "tex", raw: m[0], tex, display };
      }
      const m = DOLLAR.exec(src);
      if (!m || /^\s|\s$/.test(m[1])) return undefined;
      if (/^\d/.test(m[1]) && /\s/.test(m[1]) && !TEXISH.test(m[1])) return undefined; // $40 a day, ... 2$
      const before = tokens.at(-1);
      if (before?.type === "text" && /[A-Za-z0-9]$/.test(before.raw)) return undefined; // US$5
      return { type: "tex", raw: m[0], tex: m[1], display: false };
    },
    renderer: (t: TexToken) => placeholder(t.tex, t.raw, t.display),
  },
];

/** Whether marked's HTML holds a formula to typeset. */
export const hasTex = (html: string) => html.includes('data-tex="');

// KaTeX as a message's math needs it: what it doesn't know as LaTeX it refuses (throwOnError), so the formula stays as
// written; no warnings for what it reads anyway; no size or macro expansion beyond reason.
const OPTIONS = { throwOnError: true, strict: "ignore", maxSize: 20, maxExpand: 500 } as const;
// What papers' LaTeX has and KaTeX doesn't, drawn as near as it can: small capitals (no font for them) upright, slanted
// as italic, \mathds's double-struck letters as \mathbb's. Agents quoting a paper write \textsc{Merge}(A, B) and the like.
const MACROS: Record<string, string> = {
  "\\textsc": "\\textrm{#1}",
  "\\textsl": "\\textit{#1}",
  "\\ensuremath": "#1",
  "\\mathds": "\\mathbb{#1}",
};

const drawn = new Map<string, string | Error>(); // a formula's drawing, or why it has none: the same formula, the same

/** One formula drawn by KaTeX; refused as LaTeX it doesn't know is, if it names a link, a class, an id or a file
 * (\href, \url, \htmlClass, \includegraphics...): KaTeX would draw that command in red, its own way of refusing it.
 * Kept: a message streaming in, and a formula a reply repeats, drawn once. */
function draw(katex: Katex, tex: string, displayMode: boolean): string {
  const k = (displayMode ? "\u0001" : "") + tex;
  let got = drawn.get(k);
  if (got === undefined) {
    try {
      got = drawOnce(katex, tex, displayMode);
    } catch (e) {
      got = e instanceof Error ? e : new Error(String(e));
    }
    if (drawn.size > 4000) drawn.clear();
    drawn.set(k, got);
  }
  if (got instanceof Error) throw got;
  return got;
}

function drawOnce(katex: Katex, tex: string, displayMode: boolean): string {
  let refused = "";
  const html = katex.renderToString(tex, {
    ...OPTIONS,
    displayMode,
    macros: { ...MACROS }, // a copy: a formula's \gdef is its own
    trust: ({ command }) => ((refused ||= command), false),
  });
  if (refused) throw new Error(`${refused} is left out of a message's math`);
  return html;
}

/** marked's HTML with each placeholder's formula drawn by KaTeX, or left as written with the reason it can't be. */
export function typeset(html: string, katex: Katex): string {
  const t = document.createElement("template");
  t.innerHTML = html;
  for (const n of t.content.querySelectorAll<HTMLElement>(".md-tex[data-tex]")) {
    const tex = n.dataset.tex!;
    n.removeAttribute("data-tex");
    try {
      n.innerHTML = draw(katex, tex, n.classList.contains("md-tex-display"));
    } catch (e) {
      n.classList.add("md-tex-error");
      // KaTeX's reason without its message's marks under where it stopped (\̲f̲r̲a̲c̲c̲)
      const why = (e as { rawMessage?: string }).rawMessage || (e as Error).message;
      n.title = `Not drawn as LaTeX: ${why}`;
    }
  }
  return t.innerHTML;
}

// What KaTeX writes for a screen reader beside what it draws (MathML's <semantics> and the TeX in its <annotation>),
// kept when its HTML is made safe: DOMPurify drops these by default.
export const TEX_PURIFY = { ADD_TAGS: ["semantics", "annotation"], ADD_ATTR: ["encoding"] };

let katex: Katex | undefined;
let loading: Promise<Katex | undefined> | undefined;
const waiting = new Set<() => void>();

/** KaTeX, once loaded. */
export const texLoaded = (): Katex | undefined => katex;

/** KaTeX loaded (its script, styles and fonts, a part of the build of its own), once; each waiting told. If it can't
 * be (a page open from before the dashboard built itself anew: its part is gone), math stays as written. */
export function loadTex(): Promise<Katex | undefined> {
  loading ??= import("./katex").then(
    (m) => {
      katex = m.default;
      for (const told of [...waiting]) told();
      return katex;
    },
    () => undefined,
  );
  return loading;
}

/** `told` called once KaTeX loads, for a box drawn before then to be drawn again. Returns what stops it. */
export function onTexLoaded(told: () => void): () => void {
  waiting.add(told);
  return () => waiting.delete(told);
}
