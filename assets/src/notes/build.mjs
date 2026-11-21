// Bundles entry.mjs into ag_apps/notes/panel/vendor/prosemirror.js, an ES module, and the licenses of every package in it
// into prosemirror.LICENSE beside it. Run: npm ci && npm run build (here, in assets/src/notes).
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const vendor = path.resolve(import.meta.dirname, "../../../ag_apps/notes/panel/vendor");
const built = await esbuild.build({
  entryPoints: [path.join(import.meta.dirname, "entry.mjs")], bundle: true, minify: true, format: "esm",
  target: "es2020", outfile: path.join(vendor, "prosemirror.js"), metafile: true, legalComments: "none",
  banner: { js: "/* The Notes panel's editor: ProseMirror, bundled by assets/src/notes/build.mjs. Licenses: prosemirror.LICENSE */" },
});

const packages = new Set();
for (const file of Object.keys(built.metafile.inputs)) {
  const at = file.lastIndexOf("node_modules/");
  if (at < 0) continue;
  const parts = file.slice(at + "node_modules/".length).split("/");
  packages.add(file.slice(0, at) + "node_modules/" + (parts[0].startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/"));
}
const notices = [...packages].sort().map((dir) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = fs.readdirSync(dir).find((n) => /^(licen[cs]e|copying)/i.test(n));
  const text = file ? fs.readFileSync(path.join(dir, file), "utf8").trim() : `License: ${pkg.license}`;
  return `${pkg.name} ${pkg.version} (${pkg.license})\n\n${text}\n`;
});
fs.writeFileSync(path.join(vendor, "prosemirror.LICENSE"), notices.join("\n" + "-".repeat(72) + "\n\n"));
const size = fs.statSync(path.join(vendor, "prosemirror.js")).size;
console.log(`prosemirror.js: ${(size / 1024).toFixed(0)} KB, ${packages.size} packages`);
