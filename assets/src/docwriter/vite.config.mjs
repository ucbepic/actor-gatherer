// Builds DocWriter's page (upstream/, its git submodule) into the DocWriter app's panel (ag_apps/docwriter/panel/), the parts of it
// that talk to DocWriter's own server swapped for src/'s, which talk to the dashboard's: the aliases below. The
// page is served at the app's origin's root, so it is built with absolute paths (its preview page is served deeper).
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const here = import.meta.dirname;
const upstream = path.join(here, "upstream", "src");
const lib = path.join(upstream, "lib");

// DocWriter's page asks its server at absolute paths ('/api/...', '/preview?...', '/pdfjs/...'); here each DocWriter
// is an instance of the app, its requests to the app's backend under /api/w/<gatherer>/<instance> on the app's origin
// (__dwBase, set by index.html), and pdf.js the dashboard's shared copy at /_ag/lib/pdfjs/: rewritten so in the code
// of upstream's that the page runs.
const ABSOLUTE = /(api\/|preview\?)/.source;
function rebase(code) {
  return code
    .replace(new RegExp("`/" + ABSOLUTE, "g"), "`${globalThis.__dwBase}/$1")
    .replace(new RegExp("(['\"])/" + ABSOLUTE, "g"), "globalThis.__dwBase + $1/$2")
    .replace(/(['"`])\/pdfjs\//g, "$1/_ag/lib/pdfjs/");   // the shared pdf.js, on the panel's own origin
}
// DocWriter's server modules the page runs (its document tools, a critique pass's message): the Node modules and
// server state they import, stood in for by src/server/'s.
const STUBS = path.join(here, "src", "server");
const BUILTIN = { fs: "fs", "node:fs": "fs", path: "path", "node:path": "path", "node:async_hooks": "async_hooks",
  "@anthropic-ai/claude-agent-sdk": "agent-sdk" };
const STUBBED = new Set(["db", "document-files", "documents-store", "feedback-import", "file-utils", "path-router",
  "runtime-state", "workspace-path", "ws-server", "ydoc-persistence"]);
const serverStubs = {
  name: "docwriter-server-stubs",
  enforce: "pre",
  resolveId(source, importer) {
    const fromServer = importer && importer.startsWith(path.join(lib, "server") + path.sep);
    if (fromServer && BUILTIN[source]) return path.join(STUBS, BUILTIN[source] + ".ts");
    const name = fromServer && source.startsWith("./") ? source.slice(2).replace(/\.ts$/, "")
      : source.startsWith(path.join(lib, "server") + path.sep) ? path.basename(source).replace(/\.ts$/, "") : null;
    return name && STUBBED.has(name) ? path.join(STUBS, name + ".ts") : null;
  },
};

// Changes to DocWriter's own code, each of which must match exactly once (else the build stops: upstream moved):
const PATCHES = [
  // its editor wakes the agent after a pause in typing only where the dashboard's setting says so (default: not)
  ["lib/editor/TiptapEditor.svelte", "if ($agentSettings.paused) {\n\t\t\tcancelIdleTimer();",
    "if ($agentSettings.paused || !globalThis.__dwWake) {\n\t\t\tcancelIdleTimer();"],
  // its menus, less what the dashboard does not offer (main.ts's __dwMenus)
  ["routes/+page.svelte", "<MenuBar\n\t\t\t\t{menus}", "<MenuBar\n\t\t\t\tmenus={globalThis.__dwMenus(menus)}"],
];
const patched = {
  name: "docwriter-patches",
  enforce: "pre",
  transform(code, id) {
    let out = code;
    for (const [file, find, replace] of PATCHES) {
      if (!id.endsWith(path.join(upstream, file))) continue;
      const n = out.split(find).length - 1;
      if (n !== 1) throw new Error(`docwriter patch: ${file}: ${n} matches of ${JSON.stringify(find)}`);
      out = out.replace(find, replace);
    }
    return out === code ? null : { code: out, map: null };
  },
};
// The page's background, as its theme (?theme=, given by whoever opens it) has it, before anything else is drawn: not
// white, then the theme's colour once its script has run. Each theme's --bg, as DocWriter's theme list has it.
const THEME_BG = Object.fromEntries([...fs.readFileSync(path.join(lib, "themes.ts"), "utf8")
  .matchAll(/name: '([^']+)'[\s\S]*?'--bg': '([^']+)'/g)].map((m) => [m[1], m[2]]));
if (!THEME_BG.dark || !THEME_BG.light) throw new Error("docwriter: no theme colours found in themes.ts");
const earlyTheme = {
  name: "docwriter-early-theme",
  transformIndexHtml(html) {
    const script = `<script>
			(function () {
				var bg = ${JSON.stringify(THEME_BG)}, t = new URLSearchParams(location.search).get("theme");
				if (!bg[t]) return;
				document.documentElement.style.background = bg[t];
				document.documentElement.style.colorScheme = /dark|monokai/.test(t) ? "dark" : "light";
			})();
		</script>`;
    return html.replace("</title>", "</title>\n\t\t" + script);
  },
};
const rebased = {
  name: "docwriter-base",
  enforce: "pre",
  transform(code, id) {
    if (!id.startsWith(upstream) || id.includes("/lib/server/") || !/\.(ts|svelte)$/.test(id)) return null;
    if (id.endsWith(".ts")) return { code: rebase(code), map: null };
    return { map: null, code: code.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open, body, close) => open + rebase(body) + close)
      .replace(new RegExp("`/" + ABSOLUTE, "g"), "`${globalThis.__dwBase}/$1").replace(/(['"`])\/pdfjs\//g, "$1/_ag/lib/pdfjs/") };
  },
};
// the app's panel (ag_apps/docwriter/), served on its own origin; pdf.js is the dashboard's shared copy, which every
// app's panel loads from its own origin at /_ag/lib/pdfjs/ (ag_dashboard/libs.py)
export const OUT = path.resolve(here, "../../../ag_apps/docwriter/panel");
export const APP = path.resolve(here, "../../../ag_apps/docwriter");
export const PDFJS_OUT = path.resolve(here, "../../../ag_dashboard/vendor/pdfjs");

export default defineConfig({
  root: here,
  base: "/",                                          // the panel at its origin's root; its preview page under /api/w/...
  logLevel: "warn",
  plugins: [earlyTheme, serverStubs, patched, rebased, svelte({
    preprocess: vitePreprocess({ script: true }),
    // as DocWriter's svelte.config.js: runes, but for libraries
    compilerOptions: { runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true) },
  })],
  resolve: {
    alias: [
      { find: /^\$lib\/yjs-doc$/, replacement: path.join(here, "src", "yjs-doc.ts") },
      { find: /^\$env\/dynamic\/public$/, replacement: path.join(here, "src", "env.ts") },
      { find: /^\$lib/, replacement: lib },
    ],
  },
  build: { outDir: OUT, emptyOutDir: true,
    rollupOptions: { input: { index: path.join(here, "index.html"), preview: path.join(here, "preview.html") } }, chunkSizeWarningLimit: 4096, target: "es2022", sourcemap: false },
});
