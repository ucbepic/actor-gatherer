// Lint for the apps' panels (ag_apps/*/panel/, app_kit/js/, app_kit/fileedit/panel/): browser code outside this build,
// each panel's loaded by its index.html. ESLint looks only under its config's folder, so this lints them from the
// repository's root with a config of its own. A panel's page loads plain scripts, in order, and may load one ES module,
// its entry (`<script type="module">`), after them:
// - the plain scripts on a page share one scope: each is given, as globals, what the others on its pages declare -- so a
//   name declared on none of them is still caught;
// - a module, and each module it imports (app_kit.fileedit's, for the Files and LaTeX apps), is linted as one: no names
//   but its own, what it imports, and the libraries' globals -- so a missing import is an undefined name -- and each
//   import must name a module of the panels, and what that module exports.
import js from "@eslint/js";
import { ESLint, Linter } from "eslint";
import globals from "globals";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PANELS = ["ag_apps/*/panel/*.js", "app_kit/js/*.js", "app_kit/fileedit/panel/*.js"];
// what the shared libraries a panel loads before its own code put on window (app_kit/js/, ag_dashboard/vendor/)
const LIBS = { AgApp: "readonly", agKit: "readonly", marked: "readonly", DOMPurify: "readonly" };
const FILEEDIT = "/_ag/lib/fileedit/";

/** A served script's file: the SDK, the kit, app_kit.fileedit's, or the panel's own; null for a vendored library. */
function fileOf(app, src) {
  if (src === "/_ag/app.js") return "app_kit/js/app.js";
  if (src === "/_ag/lib/kit.js") return "app_kit/js/kit.js";
  if (src.startsWith(FILEEDIT) && src.endsWith(".js")) return `app_kit/fileedit/panel/${src.slice(FILEEDIT.length)}`;
  if (src.startsWith("/") || /^https?:/.test(src)) return null;
  return `ag_apps/${app}/panel/${src}`;
}

/** The file a module's import names (from the repository's root), as the page's origin serves it; null: none such. */
function imported(from, spec) {
  let file = null;
  if (spec.startsWith("./") || spec.startsWith("../")) file = path.join(path.dirname(from), spec);
  else if (spec.startsWith(FILEEDIT)) file = fileOf("", spec);
  return file && fs.existsSync(path.join(ROOT, file)) ? file : null;
}

const linter = new Linter({ configType: "flat" });
/** What `visit` finds walking a file's syntax tree, parsed as a script or a module. */
function scan(file, sourceType, visit) {
  const found = [];
  const plugin = { rules: { scan: { create: (ctx) => visit(ctx, found) } } };
  linter.verify(fs.readFileSync(path.join(ROOT, file), "utf8"), [
    { languageOptions: { ecmaVersion: "latest", sourceType }, plugins: { plugin }, rules: { "plugin/scan": "error" } },
  ]);
  return found;
}
/** The names `file` declares in the scope its page's scripts share. */
const declared = (file) =>
  scan(file, "script", (ctx, found) => ({
    "Program:exit": (node) => found.push(...ctx.sourceCode.getScope(node).variables.map((v) => v.name)),
  }));
/** The modules a module imports from (and exports from). */
const importsOf = (file) =>
  scan(file, "module", (_ctx, found) => {
    const from = (node) => node.source && found.push(node.source.value);
    return { ImportDeclaration: from, ExportNamedDeclaration: from, ExportAllDeclaration: from };
  });
/** The names a module exports ("default": its default). */
const exportsOf = (file) =>
  new Set(
    scan(file, "module", (_ctx, found) => ({
      ExportNamedDeclaration(node) {
        const d = node.declaration;
        if (d && d.id) found.push(d.id.name);
        for (const v of (d && d.declarations) || []) if (v.id.type === "Identifier") found.push(v.id.name);
        for (const s of node.specifiers) found.push(s.exported.name ?? s.exported.value);
      },
      ExportDefaultDeclaration: () => found.push("default"),
      ExportAllDeclaration: (node) => node.exported && found.push(node.exported.name ?? node.exported.value),
    })),
  );

/** Each panel's page: its plain scripts, in the order it loads them, and its modules (its entry, and what it imports). */
function pages() {
  const out = [];
  for (const app of fs.readdirSync(path.join(ROOT, "ag_apps"))) {
    const html = path.join(ROOT, "ag_apps", app, "panel", "index.html");
    if (!fs.existsSync(html)) continue;
    const page = { scripts: [], modules: new Set() };
    for (const [tag, src] of fs.readFileSync(html, "utf8").matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
      const file = fileOf(app, src);
      if (!file || !fs.existsSync(path.join(ROOT, file))) continue;
      if (/\btype="module"/.test(tag)) page.modules.add(file);
      else page.scripts.push(file);
    }
    // what the modules import, walked as it is found (a Set: each module once, those it adds after it)
    for (const file of page.modules)
      for (const spec of importsOf(file)) {
        const got = imported(file, spec);
        if (got) page.modules.add(got);
      }
    out.push(page);
  }
  return out;
}

const shared = new Map(); // a plain script: what the other scripts on its pages declare
const modules = new Set();
for (const page of pages()) {
  for (const file of page.modules) modules.add(file);
  for (const file of page.scripts) {
    const got = shared.get(file) || {};
    for (const other of page.scripts) if (other !== file) for (const n of declared(other)) got[n] = "writable";
    shared.set(file, got);
  }
}
for (const file of modules) if (shared.has(file)) throw new Error(`${file}: loaded as a plain script and as a module`);

// Each import (and export from another module) names a module of the panels, and what that module exports.
const panels = {
  rules: {
    imports: {
      meta: { type: "problem" },
      create(ctx) {
        const from = path.relative(ROOT, ctx.filename);
        const nameOf = (s) =>
          s.type === "ImportDefaultSpecifier"
            ? "default"
            : s.type === "ImportSpecifier"
              ? (s.imported.name ?? s.imported.value)
              : s.type === "ExportSpecifier"
                ? (s.local.name ?? s.local.value)
                : null; // `* as x`: the module, whatever it exports
        const check = (node) => {
          if (!node.source) return;
          const file = imported(from, node.source.value);
          if (!file)
            return ctx.report({ node: node.source, message: `No module of the panels at ${node.source.value}.` });
          const names = exportsOf(file);
          for (const s of node.specifiers || [])
            if (nameOf(s) && !names.has(nameOf(s)))
              ctx.report({ node: s, message: `${file} exports no ${nameOf(s)}.` });
        };
        return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check };
      },
    },
  },
};

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: true,
  overrideConfig: [
    { ignores: ["**/vendor/**", "**/assets/**", "**/node_modules/**"] },
    {
      files: PANELS,
      ...js.configs.recommended,
      languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: { ...globals.browser, ...LIBS } },
    },
    {
      files: PANELS,
      rules: {
        // a catch that only goes on, keys left out of a copy (`_x`), a value only some calls pass on
        "no-unused-vars": [
          "error",
          {
            vars: "local",
            caughtErrors: "none",
            ignoreRestSiblings: true,
            varsIgnorePattern: "^_",
            argsIgnorePattern: "^_",
          },
        ],
      },
    },
    ...[...modules].map((file) => ({
      files: [file],
      languageOptions: { sourceType: "module" },
      plugins: { panels },
      rules: { "panels/imports": "error" },
    })),
    ...[...shared].map(([file, names]) => ({ files: [file], languageOptions: { globals: names } })),
  ],
});
const results = await eslint.lintFiles(PANELS);
const out = (await eslint.loadFormatter("stylish")).format(results);
if (out) console.log(out);
process.exitCode = results.some((r) => r.errorCount) ? 1 : 0;
