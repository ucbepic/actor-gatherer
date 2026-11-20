// Lint for the dashboard's front end, with the import rules between its folders (ag_dashboard/DESIGN.md, "Rules"):
// core/ imports no feature; a feature imports core/ and itself, not another feature; the app's own files (main.ts,
// bridge.ts, page.js) put them together.
import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// The page's script from before its views were rewritten -- page.html's sections, modules now (src/page.js starts
// them): the .js files in features/ (core/page/ holds what they share, and keeps core/'s rules). Each still imports
// other features' modules, as the one script they were, so the import rules leave them out; each goes, or becomes a
// feature's own code, as its view is rewritten (A5, A6). Files of it over max-lines, until then: this list only shrinks.
const PAGE_LONG = [
  "src/features/history/history.js",
  "src/features/layout/panes.js",
  "src/features/list/group-moves.js",
  "src/features/list/list.js",
  "src/features/list/modes.js",
];

export default tseslint.config(
  { ignores: ["node_modules/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], ...reactHooks.configs.flat["recommended-latest"] },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ["src/**/*.js"],
    rules: {
      // a catch that only goes on (`catch (e) { ... }`), keys left out of a copy, and `on ? a() : b()` as a statement
      "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none", ignoreRestSiblings: true }],
      "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true, allowShortCircuit: true }],
    },
  },
  { files: PAGE_LONG, rules: { "max-lines": "off" } },
  {
    // xterm.js and its addons: vendored scripts the page loads before its own (index.html's <!--VENDOR-->)
    files: ["src/features/terminal/terminal.js"],
    languageOptions: { globals: { Terminal: "readonly", FitAddon: "readonly", WebglAddon: "readonly" } },
  },
  {
    files: ["src/**/*.{ts,tsx}", "src/core/**/*.js", "src/*.js"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { node: { extensions: [".ts", ".tsx", ".js"] } },
      "boundaries/elements": [
        { type: "core", pattern: "src/core" },
        { type: "feature", pattern: "src/features/*", capture: ["name"] },
        { type: "app", pattern: "src/*.{ts,tsx,js}" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            { from: { element: { type: "core" } }, allow: { to: { element: { type: "core" } } } },
            { from: { element: { type: "feature" } }, allow: { to: { element: { type: "core" } } } },
            {
              from: { element: { type: "app" } },
              allow: { to: { element: { types: { anyOf: ["core", "feature", "app"] } } } },
            },
            { allow: { to: { module: { origin: "external" } } } },
          ],
        },
      ],
    },
  },
);
