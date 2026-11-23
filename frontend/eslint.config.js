// Lint for the dashboard's front end, with the import rules between its folders (ag_dashboard/DESIGN.md, "Rules"):
// core/ imports no feature; a feature imports core/ and itself, not another feature; the app's own files (main.ts,
// styles.ts, and links/, what links each feature to the others) put them together.
import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // (src/core/api/types.gen.ts: generated from the server's schema by scripts/gen-types.mjs, over max-lines by far)
  { ignores: ["node_modules/", "test-results/", "playwright-report/", "src/core/api/types.gen.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], ...reactHooks.configs.flat["recommended-latest"] },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }] },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { node: { extensions: [".ts", ".tsx", ".js"] } },
      "boundaries/elements": [
        { type: "core", pattern: "src/core" },
        { type: "feature", pattern: "src/features/*", capture: ["name"] },
        { type: "app", pattern: "src/*.{ts,tsx}" },
        // what links each feature to the others (src/links/: a feature's link.ts, filled), called by main.ts
        { type: "app", pattern: "src/links" },
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
