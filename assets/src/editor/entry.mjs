// What the dashboard's Editor panel (ag_dashboard/page.html) uses, as `window.agEditor`: CodeMirror 6 to edit
// in, Yjs to share each file between everyone editing it (y-codemirror.next binds the two, with each other
// editor's cursor and selection), and a language for a file's name, coloured with the page's own classes (LaTeX and
// BibTeX are latex.mjs's).
// Bundled by build.mjs into ag_dashboard/vendor/editor.js, which the page loads the first time it opens the view.
import { basicSetup } from "codemirror";
import { EditorState, StateEffect, StateField, Compartment, RangeSet } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, StreamLanguage } from "@codemirror/language";
import { tags as t, tagHighlighter } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { yaml } from "@codemirror/lang-yaml";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { latex, bibtex, latexStyles } from "./latex.mjs";
import * as Y from "yjs";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";

// The page's code colours (its .hl-* classes, the Chat view's), by what the parser says each piece is.
const highlight = syntaxHighlighting(tagHighlighter([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "hl-com" },
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self,
    t.bool, t.null, t.tagName], class: "hl-kw" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.escape], class: "hl-str" },
  { tag: [t.number, t.integer, t.float, t.atom, t.unit], class: "hl-num" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)),
    t.className, t.definition(t.typeName), t.macroName], class: "hl-fn" },
  { tag: [t.propertyName, t.attributeName, t.labelName], class: "hl-prop" },
  { tag: [t.meta, t.annotation, t.processingInstruction, t.documentMeta], class: "hl-meta" },
  { tag: t.heading, class: "hl-sec" },
  { tag: t.strong, class: "hl-b" },
  { tag: t.inserted, class: "hl-add" },
  { tag: t.deleted, class: "hl-del" },
  ...latexStyles,
]));

const BY_EXTENSION = {
  js: () => javascript({ jsx: true }), mjs: () => javascript(), cjs: () => javascript(), jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }), mts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  py: python, pyi: python, md: markdown, markdown: markdown, json: json, jsonc: json, css: css, html: html, htm: html,
  yaml: yaml, yml: yaml, rs: rust, c: cpp, h: cpp, cc: cpp, cpp: cpp, cxx: cpp, hpp: cpp, hh: cpp, java: java, go: go,
  sql: sql, xml: xml, svg: xml, sh: () => StreamLanguage.define(shell), bash: () => StreamLanguage.define(shell),
  zsh: () => StreamLanguage.define(shell), toml: () => StreamLanguage.define(toml),
  tex: latex, latex: latex, ltx: latex, sty: latex, cls: latex, dtx: latex, bbl: latex, tikz: latex, bib: bibtex,
};

// The language a file's name says it is in, or none.
function language(name) {
  const base = name.split("/").pop().toLowerCase();
  const ext = base.includes(".") ? base.split(".").pop() : base;
  const make = BY_EXTENSION[ext] || (/^(makefile|dockerfile)$/.test(base) || base.startsWith(".") && /rc$/.test(base)
    ? BY_EXTENSION.sh : null);
  return make ? make() : [];
}

window.agEditor = {
  basicSetup, EditorState, StateEffect, StateField, Compartment, RangeSet, EditorView, Decoration, WidgetType, keymap, indentWithTab,
  highlight, language, Y, yCollab, yUndoManagerKeymap,
  Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates,
};
