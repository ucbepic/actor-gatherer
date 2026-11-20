// ------------------------------------------------------------------ the Editor's viewers
// A file the Editor opens (edOpen) is edited when it is text; any other is shown, as what the dashboard finds it is
// (editor.about): an image -- fit to the panel, its own size on a click -- a PDF in pdf.js, a sound or a video to play;
// and for any other file (or text too large to edit) what it is, how large, when it changed, and the ways to it:
// Download, and Show in Finder (the system's file manager, on the dashboard's machine). An SVG is both: shown, and its
// header's Edit opens its text (View shows it again). Its bytes come from /api/edit/raw/<its path>. Shown, it is looked
// at again with its folder's listing (edTick): changed on disk -- an actor drawing a figure again, a PDF built again --
// it is shown again where the reader was (a sound or a video once it is not playing: until then the header offers it),
// credited to the actor whose recorded change is nearest, as an edited file's change is.
import { ago, el, full, ICONS, plural, post, strokeIcon } from "./page.js";
import { ed, edAdded, edAddedHead, edByChip, edCredit, edDir, edEntry, edHead, edHeadPut, edOpen,
  edPdfOpen, edPdfTheme, edPdfViewer, edRel, edWhoColor, edWriterName, edWriters } from "./editor.js";
import { edFileIcon } from "./editor-tree.js";
import { edNote } from "./editor-open.js";
import { edDrawChanges } from "./recent.js";

export const ED_VIEW_SAID = { image: "image", pdf: "PDF", audio: "sound", video: "video", text: "text", file: "file" };
const edRaw = (path, v = null, download = false) => {
  const q = new URLSearchParams({ root: "/" });
  if (v !== null) q.set("v", String(v));
  if (download) q.set("download", "1");
  return `/api/edit/raw${path.split("/").map(encodeURIComponent).join("/")}?${q}`;
};
const edExt = (name) => name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toUpperCase() : "";
function edSize(n) {
  if (n < 1000) return plural(n, "byte");             // as Finder says it: 1 KB, 1,000 bytes
  const units = ["KB", "MB", "GB", "TB"];
  let i = -1;
  do { n /= 1000; i++; } while (n >= 1000 && i < units.length - 1);
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
// What it is, to a reader: "PNG image", "PDF", "ZIP file", "File".
function edWhat(info) {
  const x = edExt(info.name), said = ED_VIEW_SAID[info.kind] || "file";
  if (info.kind === "pdf") return "PDF";
  return x ? `${x} ${said}` : said[0].toUpperCase() + said.slice(1);
}
export async function edAbout(path) {
  const r = await fetch(`/api/edit/about?${new URLSearchParams({ path, root: "/" })}`, { cache: "no-store" });
  const got = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(got.error || `Couldn't open the file (${r.status})`);
  return got;
}

// The file shown, in place of the editor (ed.body): `info` its about.
export function edShow(path, info) {
  const v = ed.v = { path, info, at: info.mtime, size: info.size, changed: null, gone: false, stale: false, dims: null,
    full: false, pdf: null, media: null, img: null };
  ed.body.replaceChildren(edViewBody(v));
  edHead();
}
function edViewBody(v) {
  const { info } = v, url = edRaw(v.path, v.at);
  if (info.kind === "image") {
    const img = v.img = el("img", { src: url, alt: info.name, draggable: "false",
      onload: () => { if (ed.v !== v) return; v.dims = [img.naturalWidth, img.naturalHeight]; v.broken = false; edHead(); },
      onerror: () => { if (ed.v !== v || v.broken) return; v.broken = true; ed.body.replaceChildren(edCard(v, "The browser can't display this image.")); edHead(); } });
    const box = el("div", { class: "ed-view ev-img", title: "Click to switch between actual size and fit" }, img);
    box.addEventListener("click", () => { v.full = !v.full; box.classList.toggle("ev-full", v.full); });
    return box;
  }
  if (info.kind === "pdf") {
    const frame = el("iframe", { class: "pdf", title: info.name, src: edPdfViewer(url) });
    v.pdf = { frame, url };
    frame.addEventListener("load", () => {
      edPdfTheme(v.pdf);
      try { for (const f of edAdded.keys) frame.contentDocument.addEventListener("keydown", f, true); } catch (e) { /* not the viewer's page */ }
    });
    return el("div", { class: "ed-view ev-pdf" }, frame);
  }
  if (info.kind === "audio" || info.kind === "video") {
    const m = v.media = el(info.kind, { src: url, controls: "", preload: "metadata",
      onloadedmetadata: () => { if (ed.v !== v) return; v.dims = info.kind === "video" && m.videoWidth ? [m.videoWidth, m.videoHeight] : null; v.length = m.duration; edHead(); },
      onpause: () => { if (ed.v === v && v.stale) edViewAgain(v); },
      onerror: () => { if (ed.v === v && m.error) { ed.body.replaceChildren(edCard(v, `The browser can't play this ${info.kind}.`)); edHead(); } } });
    return el("div", { class: `ed-view ev-media ev-${info.kind}` }, info.kind === "audio" ? el("div", { class: "ed-snd" }, edBigIcon(info.name), el("div", { class: "nm", text: info.name }), m) : m);
  }
  return edCard(v, info.why || (info.kind === "text"
    ? `Too large to edit (${edSize(info.size)}). The limit is ${edSize(info.max)}.`
    : "This type of file can't be opened here."));
}
function edBigIcon(name) {
  const svg = edFileIcon(name);
  svg.setAttribute("width", "44"); svg.setAttribute("height", "44");
  svg.setAttribute("stroke-width", "1");
  return svg;
}
// A file not shown: what it is, and the ways to it.
function edCard(v, why) {
  const { info } = v;
  return el("div", { class: "ed-view ev-card" }, el("div", { class: "ed-card" },
    edBigIcon(info.name),
    el("div", { class: "nm", text: info.name }),
    el("div", { class: "meta", text: [edWhat(info), edSize(v.size), `changed ${ago(v.at)}`].join(" · ") }),
    el("p", { class: "why", text: why }),
    el("div", { class: "acts" }, edDownload(v, true), edRevealBtn(v, true))));
}
function edDownload(v, big = false) {
  return el("a", { class: "ed-dl" + (big ? " big" : ""), href: edRaw(v.path, v.at, true), download: v.info.name,
    title: `Download ${v.info.name}` }, strokeIcon(ED_DL, big ? 14 : 13), "Download");
}
const ED_DL = "M8 2.5v8M4.75 7.25 8 10.5l3.25-3.25M3 13.25h10";
function edRevealBtn(v, big = false) {
  const where = v.info.reveal;
  if (!where) return null;
  return el("button", { type: "button", class: "ed-reveal" + (big ? " big" : ""), title: `Show ${v.info.name} in ${where}`,
    onclick: async () => { try { await post("/api/edit/reveal", { path: v.path, root: "/" }); } catch (e) { edNote(e.message, true); } } },
    strokeIcon(ICONS.folder, big ? 14 : 13), `Show in ${where}`);
}

// Its header: where it is, what it is (its size, an image's pixels, a sound's length), who changed it lately, when it last
// changed on disk, and Edit (an SVG's text), Download, Show in Finder, Execute, ×.
export function edViewHead(v) {
  const { info } = v;
  const writers = edWriters(edEntry(v.path));
  if (ed.changes && ed.changes.path !== ed.file) edDrawChanges();          // another file's actor's changes: closed
  const len = v.length && isFinite(v.length) ? `${Math.floor(v.length / 60)}:${String(Math.round(v.length % 60)).padStart(2, "0")}` : null;
  const said = [edWhat(info), v.dims ? `${full(v.dims[0])} × ${full(v.dims[1])}` : null, len, edSize(v.size)].filter(Boolean).join(" · ");
  const [cls, status] = v.gone ? ["bad", "Deleted on disk"] : ["", said];
  let changed = null;
  if (v.changed && (v.stale || Date.now() / 1000 - v.changed < 120)) {
    const near = edCredit(writers, v.changed), color = near ? edWhoColor(near.actor) : null;
    const tip = near ? `By ${edWriterName(near)}` : "Changed outside this editor";
    changed = v.stale
      ? el("button", { type: "button", class: "ed-changed again", style: color ? `--who: ${color}` : null, title: `${tip} · click to reload`,
        onclick: () => edViewAgain(v, true) }, `Changed on disk ${ago(v.changed)} · Reload`)
      : el("span", { class: "ed-changed", style: color ? `--who: ${color}` : null, title: tip }, `Changed on disk ${ago(v.changed)}`);
  }
  edHeadPut([
    el("span", { class: "ed-path", title: v.path, text: edRel(v.path) }),
    el("span", { class: `ed-status ${cls}`, role: "status", text: status }),
    edByChip(writers), changed,
    el("span", { class: "grow", style: "flex: 1" }),
    info.text && info.kind !== "text" ? el("button", { type: "button", class: "ed-mode", title: `Edit ${info.name} as text`,
      onclick: () => edOpen(v.path, "edit") }, strokeIcon(ICONS.code, 13), "Edit") : null,
    edDownload(v), edRevealBtn(v),
    ...edAddedHead(v)].filter(Boolean));
}
// Its listing looked at again (edTick): changed on disk, shown again -- deleted, said.
export async function edViewCheck(v) {
  if (ed.v !== v) return;
  const got = ed.lists.get(edDir(v.path));
  if (!got || got.error) return;
  const e = edEntry(v.path);
  if (!e || e.dir) { if (!v.gone) { v.gone = true; edHead(); } return; }
  const back = v.gone;
  v.gone = false;
  if (e.mtime === v.at && e.size === v.size && !back) return;
  v.at = e.mtime; v.size = e.size; v.changed = e.mtime;
  let info;
  try { info = await edAbout(v.path); } catch (err) { return; }
  if (ed.v !== v) return;
  if (info.kind !== v.info.kind || (info.kind === "text" && info.text)) {     // another kind now: opened again as it is
    edViewClose(); return edOpen(v.path);
  }
  v.info = { ...info, why: v.info.why };
  v.at = info.mtime; v.size = info.size;
  edViewAgain(v);
}
// Shown as the file now is, where the reader was: an image's new bytes swapped in once loaded, a PDF opened again at its
// page and zoom (edPdfOpen), a sound or video once it is not playing -- its place kept.
function edViewAgain(v, now = false) {
  if (ed.v !== v) return;
  const url = edRaw(v.path, v.at);
  if (v.img && !v.broken) {
    const next = new Image();
    next.onload = () => { if (ed.v === v && v.img) v.img.src = url; };
    next.onerror = next.onload;
    next.src = url;
  } else if (v.pdf) {
    edPdfOpen(v.pdf, url);
  } else if (v.media && !v.media.error) {
    if (!v.media.paused && !now) { v.stale = true; edHead(); return; }
    const at = v.media.currentTime, playing = !v.media.paused;
    v.media.src = url;
    v.media.addEventListener("loadedmetadata", () => {
      try { v.media.currentTime = Math.min(at, v.media.duration || at); } catch (e) { /* from the start */ }
      if (playing) v.media.play().catch(() => {});
    }, { once: true });
  } else {                                           // not shown as what it is (yet): drawn again
    v.broken = false; v.img = v.pdf = v.media = null;
    ed.body.replaceChildren(edViewBody(v));
  }
  v.stale = false;
  edHead();
}
export function edViewClose() {
  const v = ed.v;
  if (!v) return;
  ed.v = null;
  if (v.media) { v.media.pause(); v.media.removeAttribute("src"); v.media.load(); }   // its download stopped too
  if (ed.body) ed.body.replaceChildren();
}
window.addEventListener("ag-theme", () => { if (ed.v && ed.v.pdf) edPdfTheme(ed.v.pdf); });
