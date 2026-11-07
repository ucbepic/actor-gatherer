// Readies what build.mjs builds from, in this folder:
//   upstream/  DocWriter's source (github.com/docwriter-org/docwriter, MIT), a git submodule (.gitmodules, shallow):
//              the commit the repo records for it -- its pin -- is what its Svelte page is built from. Checked out
//              here if it is not yet (a new clone or worktree); one checked out at another commit is built as it
//              is, and said so, as when the pin is being moved
//   pdfjs/     pdf.js's prebuilt viewer at PDFJS (Apache-2.0), the files DocWriter's own setup takes from it
//              (scripts/setup-pdfjs.mjs there), its zip checked against PDFJS_SHA256 (ignored by git)
// Run: npm run fetch (npm run build runs it first). DocWriter is updated by moving the submodule, here:
//   git -C upstream fetch --depth 1 origin main && git -C upstream checkout FETCH_HEAD
// then npm run build; check the files src/ stands in for (vite.config.mjs) still have the shape src/ expects
// (git -C upstream diff <old pin> HEAD -- src/routes/api src/lib/server src/lib/yjs-doc.ts, say); and commit
// upstream -- the new pin -- with ag_apps/docwriter/ (panel/, tools.json, instructions.md) and ag_dashboard/vendor/pdfjs/.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const PDFJS = "4.0.379";
const PDFJS_SHA256 = "11e5e00cf620e73f4b0b832d662b37d6a0cd25b3d0c817acfffec8516bc922dc";
const VIEWER_PATCH = 2;     // what is changed in its viewer.html, below: a new one, extracted again
const PDFJS_URL = `https://github.com/mozilla/pdf.js/releases/download/v${PDFJS}/pdfjs-${PDFJS}-dist.zip`;
// What of pdf.js's zip is kept: as DocWriter keeps it
const PDFJS_FILES = ["LICENSE", "build/pdf.mjs", "build/pdf.sandbox.mjs", "build/pdf.worker.mjs", "web/locale/locale.json",
  "web/viewer.css", "web/viewer.html", "web/viewer.mjs", "web/cmaps/*", "web/images/*", "web/locale/en-US/*",
  "web/standard_fonts/*"];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

const upstream = path.join(here, "upstream");
const top = git("-C", here, "rev-parse", "--show-toplevel");
const pin = git("-C", top, "ls-files", "--stage", "--", path.relative(top, upstream)).split(/\s+/)[1];   // as staged
if (!pin) throw new Error("upstream: no DocWriter submodule recorded here (.gitmodules)");
if (!fs.existsSync(path.join(upstream, "package.json"))) {
  git("-C", top, "submodule", "update", "--init", "--", path.relative(top, upstream));
  console.log(`upstream: DocWriter checked out at its pin, ${pin.slice(0, 7)}`);
}
/** The commit of DocWriter the page is built from: its pin, unless another is checked out. */
export const UPSTREAM = git("-C", upstream, "rev-parse", "HEAD");
if (UPSTREAM !== pin) {
  console.log(`upstream: building DocWriter at ${UPSTREAM.slice(0, 7)}, not its pin ${pin.slice(0, 7)}: `
    + `commit upstream with the build to move the pin`);
}
// What SvelteKit's sync would write, which upstream's tsconfig.json extends: the compiler options the page is
// built with (TypeScript stripped by esbuild, its imports kept as written)
const kit = path.join(upstream, ".svelte-kit", "tsconfig.json");
fs.mkdirSync(path.dirname(kit), { recursive: true });
fs.writeFileSync(kit, JSON.stringify({ compilerOptions: {
  target: "esnext", module: "esnext", moduleResolution: "bundler", lib: ["esnext", "DOM", "DOM.Iterable"],
  verbatimModuleSyntax: true, isolatedModules: true, strict: true } }, null, 2) + "\n");

const pdfjs = path.join(here, "pdfjs");
const marker = path.join(pdfjs, ".version");
if (!fs.existsSync(marker) || fs.readFileSync(marker, "utf8").trim() !== `${PDFJS} ${VIEWER_PATCH}`) {
  const zip = path.join(here, ".cache", `pdfjs-${PDFJS}-dist.zip`);
  if (!fs.existsSync(zip)) {
    fs.mkdirSync(path.dirname(zip), { recursive: true });
    const res = await fetch(PDFJS_URL);
    if (!res.ok) throw new Error(`pdf.js: ${PDFJS_URL}: HTTP ${res.status}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  const sum = createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
  if (sum !== PDFJS_SHA256) {
    fs.rmSync(zip);
    throw new Error(`pdf.js: ${zip} is not the release (sha256 ${sum})`);
  }
  fs.rmSync(pdfjs, { recursive: true, force: true });
  fs.mkdirSync(pdfjs, { recursive: true });
  execFileSync("unzip", ["-q", zip, ...PDFJS_FILES, "-d", pdfjs], { stdio: "inherit" });
  // DocWriter's theme for the viewer, after the viewer's own stylesheet
  fs.copyFileSync(path.join(upstream, "assets", "pdfjs", "docwriter-theme.css"), path.join(pdfjs, "web", "docwriter-theme.css"));
  const viewer = path.join(pdfjs, "web", "viewer.html");
  const html = fs.readFileSync(viewer, "utf8");
  const css = '<link rel="stylesheet" href="viewer.css">';
  if (!html.includes(css)) throw new Error("pdf.js: viewer.html has no viewer.css link to put the theme after");
  // ... and DocWriter's theme taken from the preview page around it before the viewer's first paint -- not its own
  // light grey until the preview page themes it, once it has loaded
  const early = `<script>
      try {
        var from = parent.document.documentElement, to = document.documentElement;
        for (var i = 0; i < from.style.length; i++) {
          var k = from.style[i];
          if (k.indexOf("--") === 0) to.style.setProperty(k, from.style.getPropertyValue(k));
        }
        var theme = new URL(parent.location.href).searchParams.get("theme");
        if (theme) to.setAttribute("data-docwriter-theme", theme);
      } catch (e) {}
    </script>`;
  fs.writeFileSync(viewer, html.replace(css, `${css}\n    <link rel="stylesheet" href="docwriter-theme.css">\n    ${early}`));
  fs.writeFileSync(marker, `${PDFJS} ${VIEWER_PATCH}\n`);
  console.log(`pdfjs: pdf.js ${PDFJS}`);
}
