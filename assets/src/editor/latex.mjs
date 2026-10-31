// LaTeX and BibTeX for the Editor panel: a tokenizer that knows what a piece of a .tex file is for -- a section's
// title, math, an environment's name, a reference's key, a package's name, emphasis -- so the page can show it the
// way it reads (titles larger, math tinted, \emph in italics, braces faint), plus folding of sections and
// environments. Written here because the published LaTeX grammar for CodeMirror 6 is AGPL.
import { StreamLanguage, foldService } from "@codemirror/language";
import { Tag, tags as t } from "@lezer/highlight";

// The tags this file's tokens carry, and the page class each is shown with (page.html, `.hl-tex-*` and `.hl-*`).
const TAGS = {
  texCommand: [Tag.define(t.macroName), "hl-fn"],              // \foo
  texStructure: [Tag.define(t.keyword), "hl-kw"],              // \begin, \section, \usepackage, \item, \newcommand
  texEnv: [Tag.define(t.className), "hl-prop hl-b"],           // the name in \begin{figure}
  texRef: [Tag.define(t.labelName), "hl-meta"],                // the key in \label, \ref, \cite
  texFile: [Tag.define(t.string), "hl-str"],                   // a package, class, file or bibliography's name
  texUrl: [Tag.define(t.url), "hl-tex-url"],
  texMath: [Tag.define(t.string), "hl-tex-math"],   // everything inside math, delimiters included
  texMathCommand: [Tag.define(t.macroName), "hl-tex-mcmd"],    // \alpha, \frac inside math
  texH1: [Tag.define(t.heading1), "hl-tex-h1"],                // \part, \chapter, \section, \title and their titles
  texH2: [Tag.define(t.heading2), "hl-tex-h2"],                // \subsection
  texH3: [Tag.define(t.heading3), "hl-tex-h3"],                // \subsubsection, \paragraph
  texStrong: [Tag.define(t.strong), "hl-b"],
  texEmph: [Tag.define(t.emphasis), "hl-tex-em"],
  texMono: [Tag.define(t.monospace), "hl-tex-tt"],
  texUnderline: [Tag.define(t.content), "hl-tex-ul"],
  texOptional: [Tag.define(t.attributeValue), "hl-tex-opt"],   // [width=\linewidth]
  texBrace: [Tag.define(t.brace), "hl-tex-brace"],
  texSpecial: [Tag.define(t.operator), "hl-tex-special"],      // & and \\ in tables and alignments, ~
  texComment: [Tag.define(t.lineComment), "hl-com"],
  texVerbatim: [Tag.define(t.monospace), "hl-tex-verb"],
  texField: [Tag.define(t.propertyName), "hl-prop"],           // BibTeX: title = ...
  texNumber: [Tag.define(t.number), "hl-num"],
};
const tokenTable = Object.fromEntries(Object.entries(TAGS).map(([name, [tag]]) => [name, tag]));
export const latexStyles = Object.values(TAGS).map(([tag, cls]) => ({ tag, class: cls }));

const SECTIONS = { part: "texH1", chapter: "texH1", section: "texH1", title: "texH1", subsection: "texH2",
  subsubsection: "texH3", paragraph: "texH3", subparagraph: "texH3" };
const STRUCTURE = new Set(["begin", "end", "documentclass", "usepackage", "RequirePackage", "LoadClass", "item",
  "newcommand", "renewcommand", "providecommand", "newenvironment", "renewenvironment", "DeclareMathOperator", "def",
  "let", "input", "include", "includeonly", "subfile", "bibliography", "bibliographystyle", "addbibresource",
  "printbibliography", "maketitle", "tableofcontents", "appendix", "author", "date", "frontmatter", "mainmatter",
  "backmatter", "newtheorem", ...Object.keys(SECTIONS)]);
// What each command's {arguments} are, in order ("" for an argument shown as plain text).
const ARGS = {
  textbf: ["texStrong"], emph: ["texEmph"], textit: ["texEmph"], textsl: ["texEmph"], texttt: ["texMono"],
  underline: ["texUnderline"], url: ["texUrl"], href: ["texUrl", ""], newenvironment: ["texEnv"],
  renewenvironment: ["texEnv"], newtheorem: ["texEnv"],
};
for (const c of ["label", "ref", "eqref", "pageref", "autoref", "nameref", "cref", "Cref", "vref", "cite", "citep",
  "citet", "citealp", "citeauthor", "citeyear", "nocite", "parencite", "textcite", "autocite", "footcite", "fullcite",
  "bibitem"]) ARGS[c] = ["texRef"];
for (const c of ["documentclass", "usepackage", "RequirePackage", "LoadClass", "input", "include", "includeonly",
  "subfile", "bibliography", "bibliographystyle", "addbibresource", "includegraphics", "includepdf",
  "includesvg"]) ARGS[c] = ["texFile"];
const MATH_ENVS = new Set(["equation", "align", "alignat", "gather", "multline", "flalign", "eqnarray", "math",
  "displaymath", "dmath"].flatMap((e) => [e, e + "*"]));
const VERBATIM_ENVS = new Set(["verbatim", "verbatim*", "Verbatim", "BVerbatim", "lstlisting", "minted", "filecontents",
  "filecontents*", "comment"]);
const MAX_DEPTH = 40;

const join = (...parts) => [...new Set(parts.join(" ").split(" ").filter(Boolean))].join(" ") || null;
const top = (state) => state.frames[state.frames.length - 1];
const style = (state) => (top(state) ? top(state).style : "");

// A {group} or [optional argument] opens a frame, which its own closing brace ends; text inside is shown with the
// frame's style (that of the argument it is, and of the frames around it). Frames are never changed, only replaced,
// since the parser's copies of the state share them.
function open(state, close, own, env, resume) {
  if (state.frames.length >= MAX_DEPTH) state.frames.shift();
  state.frames.push({ close, style: join(style(state), own), env: env || null, name: "", resume: resume || null });
}

function closeFrame(state, ch) {
  let at = state.frames.length - 1;
  if (ch === "}") while (at >= 0 && state.frames[at].close !== "}") at--;
  else if (at < 0 || state.frames[at].close !== "]") return null;
  if (at < 0) return null;
  const frame = state.frames[at];
  state.frames.length = at;
  if (frame.resume) state.pend = frame.resume;       // the [options] of a command whose {arguments} come next
  if (frame.env === "begin") {
    if (MATH_ENVS.has(frame.name)) state.math = { env: frame.name };
    else if (VERBATIM_ENVS.has(frame.name)) state.verbNext = frame.name;
  }
  return frame;
}

function inMath(stream, state) {
  const m = state.math, outer = style(state);
  if (stream.sol() && stream.match(/^\s+/)) return outer || null;   // a line's indent, left untinted
  if (stream.match("%")) { stream.skipToEnd(); return "texComment"; }
  if (m.env) {
    const end = stream.match(/^\\end(?=\s*\{([^}]*)\})/, false);
    if (end && end[1] === m.env) {
      stream.match("\\end"); state.math = null; state.pend = { args: ["texEnv"], env: "end" };
      return join(outer, "texStructure");
    }
  } else if (stream.match(m.close)) {
    state.math = null;
    return join(outer, "texMath");
  }
  if (state.mathRef) {                                // the key of a \label or \ref in an equation
    state.mathRef = false;
    if (stream.match(/^\s*\{[^}]*\}/)) return join(outer, "texRef");
  }
  if (stream.match(/^\\(?:label|tag\*?|ref|eqref)(?=\s*\{)/)) { state.mathRef = true; return join(outer, "texCommand"); }
  if (stream.match("\\\\")) return join(outer, "texMath texSpecial");
  if (stream.match(/^\\(?:[a-zA-Z@]+|.)/)) return join(outer, "texMath texMathCommand");
  if (stream.eat("&")) return join(outer, "texMath texSpecial");
  if (stream.match(/^[^\\$%&]+/) || stream.next()) return join(outer, "texMath");
  return null;
}

function inVerbatim(stream, state) {
  const kind = state.verb === "comment" ? "texComment" : "texVerbatim";
  const at = stream.string.indexOf(`\\end{${state.verb}}`, stream.pos);
  if (at < 0) { stream.skipToEnd(); return kind; }
  if (at > stream.pos) { stream.pos = at; return kind; }
  state.verb = null;
  return null;                                        // nothing consumed: the \end is read as usual
}

// A command's arguments: an optional star and [options], then its {arguments}, each opening a frame of its style.
function argument(stream, state) {
  const p = state.pend;
  if (stream.match(/^\s+/)) return "";
  if (p.star && stream.eat("*")) { state.pend = { ...p, star: false }; return join(style(state), p.own); }
  if (p.opt && stream.peek() === "[") {
    stream.next(); state.pend = null;
    open(state, "]", "texOptional", null, { ...p, star: false });
    return join(style(state), "texBrace");
  }
  if (p.args.length && stream.peek() === "{") {
    stream.next();
    const [first, ...rest] = p.args;
    state.pend = rest.length ? { ...p, args: rest, star: false, opt: false, env: null } : null;
    const was = style(state);
    open(state, "}", first, p.env);
    return join(was, p.head, "texBrace");
  }
  state.pend = null;
  return null;
}

function command(stream, state, name) {
  const outer = style(state), head = SECTIONS[name] || "";
  const own = join(STRUCTURE.has(name) ? "texStructure" : "texCommand", head);
  if (name === "begin" || name === "end") state.pend = { args: ["texEnv"], env: name };
  else if (head) state.pend = { args: [head], opt: true, star: true, own, head };
  else if (ARGS[name]) state.pend = { args: ARGS[name], opt: true, star: true, own };
  else state.pend = { args: [], opt: false, star: true, own };
  return join(outer, own);
}

function token(stream, state) {
  if (stream.sol() && state.verbNext) { state.verb = state.verbNext; state.verbNext = null; }
  if (state.verb) { const s = inVerbatim(stream, state); if (s !== null || state.verb) return s; }
  if (state.math) return inMath(stream, state);
  if (state.pend) {
    const s = argument(stream, state);
    if (s !== null) return s || null;
  }
  const outer = style(state), frame = top(state);
  if (frame && frame.env && !frame.name && stream.match(/^[^}%\s]+/)) {
    state.frames[state.frames.length - 1] = { ...frame, name: stream.current() };
    return outer;
  }
  if (stream.eat("%")) { stream.skipToEnd(); return "texComment"; }
  const verb = stream.match(/^\\verb\*?([^a-zA-Z\s*])/);
  if (verb) {
    if (!stream.skipTo(verb[1])) stream.skipToEnd(); else stream.next();
    return join(outer, "texVerbatim");
  }
  if (stream.match("\\[")) { state.math = { close: "\\]" }; return join(outer, "texMath"); }
  if (stream.match("\\(")) { state.math = { close: "\\)" }; return join(outer, "texMath"); }
  if (stream.match("$$")) { state.math = { close: "$$" }; return join(outer, "texMath"); }
  if (stream.eat("$")) { state.math = { close: "$" }; return join(outer, "texMath"); }
  if (stream.match("\\\\")) return join(outer, "texSpecial");
  const cmd = stream.match(/^\\([a-zA-Z@]+)/);
  if (cmd) return command(stream, state, cmd[1]);
  if (stream.match(/^\\./)) return join(outer, "texCommand");
  if (stream.eat("{")) { open(state, "}", ""); return join(outer, "texBrace"); }
  if (stream.peek() === "}" || stream.peek() === "]" && frame && frame.close === "]") {
    const ch = stream.next(), closed = closeFrame(state, ch);
    return join(closed ? closed.style : outer, "texBrace");
  }
  if (stream.eat(/[&~]/)) return join(outer, "texSpecial");
  if (stream.match(/^[^\\%${}&~\]]+/) || stream.next()) return outer || null;
  return null;
}

export const latexLanguage = StreamLanguage.define({
  name: "latex",
  startState: () => ({ frames: [], math: null, pend: null, verb: null, verbNext: null, mathRef: false }),
  copyState: (s) => ({ ...s, frames: s.frames.slice() }),
  token,
  // A blank line ends a paragraph, which no argument or inline math may run past: forget any still open, so that one
  // missing brace or $ doesn't colour the rest of the file.
  blankLine(state) {
    if (state.verbNext) { state.verb = state.verbNext; state.verbNext = null; }
    if (state.verb) return;
    state.frames = []; state.pend = null;
    if (state.math && !state.math.env && state.math.close !== "\\]") state.math = null;
  },
  tokenTable,
  languageData: { commentTokens: { line: "%" } },
});

// Folding: a line that starts an environment folds to its \end, and a sectioning command to the next one of the same
// or a higher level (or the end of the document).
const LEVEL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const SCAN = 20000;
const latexFold = foldService.of((state, from, to) => {
  const doc = state.doc, line = doc.lineAt(from), text = line.text;
  const begin = /^\s*\\begin\s*\{([^}]+)\}/.exec(text);
  if (begin) {
    const name = begin[1], esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const opens = new RegExp(`\\\\begin\\s*\\{${esc}\\}`, "g"), shuts = new RegExp(`\\\\end\\s*\\{${esc}\\}`, "g");
    let depth = 0;
    for (let n = line.number; n <= Math.min(doc.lines, line.number + SCAN); n++) {
      const l = doc.line(n).text.replace(/(^|[^\\])%.*/, "$1");
      depth += (l.match(opens) || []).length - (l.match(shuts) || []).length;
      if (depth <= 0) return n > line.number + 1 ? { from: to, to: doc.line(n - 1).to } : null;
    }
    return null;
  }
  const sec = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/.exec(text);
  if (!sec) return null;
  const level = LEVEL[sec[1]];
  let last = line.number;
  for (let n = line.number + 1; n <= Math.min(doc.lines, line.number + SCAN); n++) {
    const l = doc.line(n).text;
    const next = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/.exec(l);
    if (next && LEVEL[next[1]] <= level) break;
    if (/^\s*\\(end\s*\{document\}|bibliography\s*\{|printbibliography|appendix\b)/.test(l)) break;
    if (l.trim()) last = n;
  }
  return last > line.number ? { from: to, to: doc.line(last).to } : null;
});

export function latex() { return [latexLanguage, latexFold]; }

// BibTeX: @type{key, field = {value} or "value" or number, ...}; text between entries is a comment to BibTeX.
function bibToken(stream, state) {
  if (state.quote) {
    if (stream.match(/^(?:[^"\\{}]|\\.|\{[^}]*\})+/)) return "texFile";
    if (stream.eat('"')) state.quote = false; else stream.next();
    return "texFile";
  }
  if (state.depth === 0) {
    if (stream.match(/^@[a-zA-Z]+/)) { state.entry = true; return "texStructure"; }
    if (state.entry && stream.eat(/[{(]/)) { state.depth = 1; state.key = true; state.entry = false; return "texBrace"; }
    if (stream.match(/^\s+/)) return null;
    state.entry = false;
    stream.skipTo("@") || stream.skipToEnd();
    return "texComment";
  }
  if (state.depth === 1) {
    if (stream.match(/^\s+/)) return null;
    if (state.key) { state.key = false; if (stream.match(/^[^,\s})]+/)) return "texRef"; }
    if (stream.eat(/[})]/)) { state.depth = 0; return "texBrace"; }
    if (stream.match(/^[a-zA-Z][\w-]*(?=\s*=)/)) return "texField";
    if (stream.eat("{")) { state.depth = 2; return "texFile"; }
    if (stream.eat('"')) { state.quote = true; return "texFile"; }
    if (stream.match(/^\d+/)) return "texNumber";
    if (stream.match(/^[a-zA-Z][\w-]*/)) return "texCommand";
    stream.next();
    return "texBrace";                                // = , #
  }
  if (stream.match(/^[^{}]+/)) return "texFile";
  if (stream.eat("{")) state.depth++; else { stream.next(); state.depth--; }
  return "texFile";
}

export const bibtexLanguage = StreamLanguage.define({
  name: "bibtex",
  startState: () => ({ depth: 0, entry: false, key: false, quote: false }),
  token: bibToken,
  tokenTable,
  languageData: { commentTokens: { line: "%" } },
});
export function bibtex() { return bibtexLanguage; }
