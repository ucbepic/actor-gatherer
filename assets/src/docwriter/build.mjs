// Builds DocWriter's page into the DocWriter app's panel, ag_apps/docwriter/panel/ (vite.config.mjs), with its
// instructions and its tools beside the app's manifest (instructions.md, tools.json); puts pdf.js's viewer in the
// dashboard's shared copy, ag_dashboard/vendor/pdfjs/ (from fetch.mjs; ag_dashboard/libs.py serves it to the Editor
// and to every app's panel); and writes the licenses of what is in them: panel/LICENSE (DocWriter's, and every
// package bundled), pdfjs/LICENSE (pdf.js's). Run: npm ci && npm run build (here, in assets/src/docwriter).
import fs from "node:fs";
import path from "node:path";
import { build } from "vite";
import config, { APP, OUT, PDFJS_OUT } from "./vite.config.mjs";
import { UPSTREAM } from "./fetch.mjs";

const here = import.meta.dirname;
const bundled = new Set();
await build({ ...config, configFile: false, plugins: [...config.plugins, {
  name: "licenses",
  generateBundle(_, chunks) {                       // the packages whose code is in the bundle
    for (const chunk of Object.values(chunks)) {
      for (const raw of Object.keys(chunk.modules || {})) {
        const id = raw.replace(/^\0/, "").split("?")[0];       // a plugin's virtual module names its file so
        const at = id.lastIndexOf("node_modules/");
        if (at < 0) continue;
        const parts = id.slice(at + "node_modules/".length).split("/");
        bundled.add(id.slice(0, at) + "node_modules/" + (parts[0].startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/"));
      }
    }
  },
}] });

fs.copyFileSync(path.join(here, "upstream", "static", "docwriter-mark.svg"), path.join(OUT, "docwriter-mark.svg"));
fs.rmSync(PDFJS_OUT, { recursive: true, force: true });
fs.cpSync(path.join(here, "pdfjs"), PDFJS_OUT, { recursive: true, filter: (p) => !p.endsWith(".version") });

// DocWriter's system prompt, the actor's instructions (ag_dashboard/docwriter.py's `instructions`): upstream's
// buildSystemPrompt template, its interpolations filled in as they read for an actor -- the rules come with each
// message instead (render.ts) -- and any other one stops the build.
const src = (p) => fs.readFileSync(path.join(here, "upstream", "src", p), "utf8");
const route = src("routes/api/render/+server.ts");
const replyNote = src("lib/server/mcp-doc-tools.ts").match(/REPLY_BEFORE_EDIT_PROMPT_NOTE =\s*\n?\s*"([^"]+)"/);
if (!replyNote) throw new Error("instructions: REPLY_BEFORE_EDIT_PROMPT_NOTE not found");
const FILLS = {
  rulesBlock: "(My rules arrive in <session_state> with my messages: the latest list there is the one in force. None until then.)",
  AGENT_SCRATCH_DIR: ".docwriter/agent/scratch",
  REPLY_BEFORE_EDIT_PROMPT_NOTE: replyNote[1],
};
let at = route.indexOf("return `", route.indexOf("function buildSystemPrompt"));
if (at < 0) throw new Error("instructions: buildSystemPrompt's template not found");
let prompt = "";
for (at += "return `".length; route[at] !== "`"; at++) {
  if (at >= route.length) throw new Error("instructions: buildSystemPrompt's template not closed");
  if (route[at] === "\\") { at++; prompt += route[at] === "n" ? "\n" : route[at]; continue; }
  if (route[at] === "$" && route[at + 1] === "{") {
    const end = route.indexOf("}", at);
    const name = route.slice(at + 2, end).trim();
    if (!(name in FILLS)) throw new Error(`instructions: no filling for \${${name}}`);
    prompt += FILLS[name];
    at = end;
    continue;
  }
  prompt += route[at];
}
// the app's instructions (app.toml's instructions_file): who it is, the tools as agents are given them (the tool
// gateway's docwriter_<tool>), then upstream's system prompt
const HEAD = "# DocWriter\n\nYou are the agent of DocWriter, a writing app open in the ag dashboard, where the author " +
  "writes and reviews your work. The workspace is your working folder: its files open in DocWriter as tabs. Change an " +
  "open document only with DocWriter's tools (docwriter_read_doc, docwriter_edit_doc, docwriter_write_doc, " +
  "docwriter_comment_doc, docwriter_reply_to_comment, docwriter_list_threads): your edits are proposed beside the " +
  "text, and the file changes only when the author accepts them. Each message from DocWriter carries the " +
  "workspace's state (<workspace_state>) and the author's request.\n\n";
fs.writeFileSync(path.join(APP, "instructions.md"), (HEAD + prompt).trim() + "\n");

// the app's tools (app.toml's tools_file): DocWriter's document tools as its page answers them (src/tools.ts), each
// with its input's JSON Schema -- built from that same module, so the two never differ
const toolsOut = path.join(here, "node_modules", ".tools-build");
await build({ ...config, configFile: false, logLevel: "error", plugins: config.plugins.filter((p) => p.name !== "docwriter-early-theme"),
  build: { ssr: path.join(here, "src", "tools-list.ts"), outDir: toolsOut, emptyOutDir: true, rollupOptions: { output: { format: "es" } } } });
const { TOOLS } = await import(path.join(toolsOut, "tools-list.js"));
fs.writeFileSync(path.join(APP, "tools.json"), JSON.stringify(TOOLS.map((t) => ({ name: t.name, description: t.description,
  input_schema: Object.fromEntries(Object.entries(t.inputSchema).filter(([k]) => k !== "$schema")), handled_by: "panel" })),
  null, 1) + "\n");
const licenseOf = (dir, fallback) => {
  const file = fs.readdirSync(dir).find((n) => /^(licen[cs]e|copying)/i.test(n));
  return file ? fs.readFileSync(path.join(dir, file), "utf8").trim() : `License: ${fallback}`;
};
const notices = [`DocWriter (github.com/docwriter-org/docwriter at ${UPSTREAM}) (MIT)\n\n${licenseOf(path.join(here, "upstream"), "MIT")}\n`];
for (const dir of [...bundled].sort()) {
  if (!fs.existsSync(path.join(dir, "package.json"))) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  notices.push(`${pkg.name} ${pkg.version} (${pkg.license})\n\n${licenseOf(dir, pkg.license)}\n`);
}
fs.writeFileSync(path.join(OUT, "LICENSE"), notices.join("\n" + "-".repeat(72) + "\n\n"));
let size = 0;
for (const f of fs.readdirSync(OUT, { recursive: true })) {
  const s = fs.statSync(path.join(OUT, f));
  if (s.isFile()) size += s.size;
}
console.log(`ag_apps/docwriter/panel: ${(size / 1024 / 1024).toFixed(1)} MB, ${bundled.size} packages`);
