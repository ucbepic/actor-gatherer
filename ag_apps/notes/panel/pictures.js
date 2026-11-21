// Notes: pictures.
// An image block shows a picture the backend keeps (POST image: pasted, dropped, or picked from the / menu), as wide as
// the reader drags its sides (`width`, a percent of the page's). A figma block shows a frame or board of Figma live, in
// Figma's own embed, over the snapshot the backend keeps of it (POST figma/snap: asked for as the page shows it, at
// most every SNAP_EVERY; fetched again only when Figma changed it). The snapshot shows while Figma loads, when it
// can't (offline), or when the reader picks it; it is what agents are given. Signing in to Figma, or a file the reader
// can't open, is for Figma's embed to say.
import { $, clean, el, esc, FIGMA_KIND, MEDIA, now, plainOf, rid, SPECIAL, SVG } from "./helpers.js";
import { ag, current } from "./state.js";
import { change, forget } from "./send.js";
import { blockOf, box, drawPage, page, rowOf, shown } from "./page.js";
import { blank, focusBlock } from "./caret.js";
import { addAfter } from "./typing.js";
import { closePop, item, menu, popUp } from "./popups.js";
import { say, when } from "./actors.js";
import { view } from "./editor.js";

export const FIGMA_URL = /^https:\/\/(?:www\.)?figma\.com\/(design|file|board|proto|slides|deck)\/([A-Za-z0-9]{6,64})(?:\/([^/?#\s]*))?[^\s<>"']*$/;
const SNAP_EVERY = 600;
const LOAD_WAIT = 25000;                                 // ms: Figma's embed not loaded by then, the snapshot shown
let figmaToken = { token: false, who: "" };
const figView = new Map();                               // block id -> "snap" | "live": as the reader picked
const snapAsked = new Map(), snapErr = new Map(), unloaded = new Set();
let sizing = null, dropAt = null;
const dark = () => !!(ag.theme.current && ag.theme.current.mode === "dark");
const fileUrl = (name) => `/api/file/${encodeURIComponent(name)}?${new URLSearchParams({ gatherer: ag.gatherer, instance: ag.instance })}`;
export function figmaTitle(url) {
  const m = FIGMA_URL.exec(url || "");
  try { return m && m[3] ? decodeURIComponent(m[3]).replace(/-/g, " ").replace(/\s+/g, " ").trim() : ""; } catch { return ""; }
}
function embedUrl(url) {                                 // Figma's Embed Kit 2.0: the link, `embed` for `www`
  const m = FIGMA_URL.exec(url), node = (new URL(url).searchParams.get("node-id") || "").replace(/:/g, "-");
  const q = new URLSearchParams({ "embed-host": "ag", footer: "false", theme: dark() ? "dark" : "light" });
  if (node) { q.set("node-id", node); q.set("page-selector", "false"); }
  return `https://embed.figma.com/${m[1] === "file" ? "design" : m[1]}/${m[2]}/${m[3] || ""}?${q}`;
}
const figViewOf = (b) => (navigator.onLine === false || unloaded.has(b.id) ? "snap" : figView.get(b.id) || "live");
export const focusFig = (id) => { const n = rowOf(id), f = n && n.querySelector(".fig"); if (f) f.focus(); };

export function drawMedia(n, b, ro) {
  const f = n.querySelector(".fig");
  f.setAttribute("aria-label", b.type === "image" ? `Picture${b.text ? `: ${plainOf(b.text)}` : ""}` : `Figma: ${b.title || figmaTitle(b.url) || "a frame"}`);
  if (b.type === "image") drawImage(f, b, ro);
  else drawFigma(f, b, ro);
}
function drawImage(f, b, ro) {
  const sig = JSON.stringify([b.file, b.w, b.h, b.width, ro]);
  if (f.dataset.sig === sig) return;
  f.dataset.sig = sig;
  f.dataset.kind = "image";
  let pic = f.querySelector(".pic");
  if (!pic) {
    pic = el("div", { class: "pic" }, el("img", { draggable: "false", alt: "" }),
      el("div", { class: "pic-tools" },
        el("button", { type: "button", "data-do": "caption", text: "Caption" }),
        el("button", { type: "button", "data-do": "replace", text: "Replace" }),
        el("button", { type: "button", "data-do": "open", text: "Open" }),
        el("button", { type: "button", "data-do": "delete", title: "Delete picture", "aria-label": "Delete picture", html: SVG.trash })),
      el("span", { class: "hdl l", "data-side": "l", title: "Drag to resize" }), el("span", { class: "hdl r", "data-side": "r", title: "Drag to resize" }));
    f.replaceChildren(pic);
  }
  const img = pic.querySelector("img");
  if (img.getAttribute("src") !== fileUrl(b.file)) img.src = fileUrl(b.file);
  if (b.w && b.h) { img.width = b.w; img.height = b.h; } else { img.removeAttribute("width"); img.removeAttribute("height"); }
  pic.style.width = b.width ? `${b.width}%` : "";
  pic.style.maxWidth = !b.width && b.w ? `min(100%, ${b.w}px)` : "";
  pic.classList.toggle("ro", ro);
}
function drawFigma(f, b, ro) {
  const view = figViewOf(b), live = view === "live", err = snapErr.get(b.id) || "";
  const title = b.title || figmaTitle(b.url) || "Figma";
  const sig = JSON.stringify([b.url, title, b.snap, b.snap_at, b.w, b.h, ro, view, err, figmaToken.token, dark(), unloaded.has(b.id)]);
  snapSoon(b);
  if (f.dataset.sig === sig) return;
  f.dataset.sig = sig;
  f.dataset.kind = "figma";
  let head = f.querySelector(".fg-head"), band = f.querySelector(".fg-band"), body = f.querySelector(".fg-body");
  if (!head) {
    head = el("div", { class: "fg-head" });
    band = el("div", { class: "fg-band" });
    body = el("div", { class: "fg-body" }, el("img", { class: "fg-snap", alt: "", draggable: "false" }), el("div", { class: "fg-none" }));
    f.replaceChildren(head, band, body);
  }
  const state = live ? "Live" : b.snap ? `Snapshot · ${when(b.snap_at)}` : "No snapshot";
  head.replaceChildren(
    el("span", { class: "fg-mark", html: FIGMA_KIND.glyph }),
    el("b", { class: "fg-name", text: title, title }),
    el("span", { class: `fg-state ${live ? "live" : "snap"}`, text: state }),
    el("span", { class: "fg-gap" }),
    navigator.onLine === false ? null : el("button", { type: "button", class: "fg-btn", "data-do": "view", text: live ? "Snapshot" : "Live",
      title: live ? "Show snapshot" : "Show live from Figma" }),
    el("a", { class: "fg-btn", href: b.url, target: "_blank", rel: "noopener", text: "Open in Figma" }),
    el("button", { type: "button", class: "fg-btn icon", "data-do": "open", title: "Full size", "aria-label": "Full size", html: SVG.full }),
    ro ? null : el("button", { type: "button", class: "fg-btn icon", "data-do": "more", title: "More", "aria-label": "More", text: "⋯" }));
  const said = !live ? (unloaded.has(b.id) ? "Figma didn't load here." : navigator.onLine === false
    ? "You're offline." : b.snap ? "" : err || "No snapshot yet.")
    : !b.snap && err ? `Your agents can't see this frame: ${err.replace(/\.$/, "")}.` : "";
  band.hidden = !said;
  band.replaceChildren(el("span", { text: said }),
    !ro && !figmaToken.token && /token|public/.test(said) ? el("button", { type: "button", class: "fg-btn", "data-do": "token", text: "Add a Figma token" }) : null,
    unloaded.has(b.id) ? el("button", { type: "button", class: "fg-btn", "data-do": "retry", text: "Try again" }) : null);
  const snap = body.querySelector(".fg-snap"), none = body.querySelector(".fg-none");
  if (b.snap && snap.getAttribute("src") !== fileUrl(b.snap)) snap.src = fileUrl(b.snap);
  snap.hidden = !b.snap;
  none.hidden = !!b.snap || live;
  none.textContent = "No snapshot";
  body.style.aspectRatio = b.w && b.h ? `${b.w} / ${b.h}` : "";
  let frame = body.querySelector("iframe");
  if (!live) { if (frame) frame.remove(); return; }
  const src = embedUrl(b.url);
  if (!frame) {
    frame = el("iframe", { class: "fg-live", allowfullscreen: true, referrerpolicy: "no-referrer-when-downgrade", title: `${title}, live from Figma` });
    body.append(frame);
  }
  if (frame.getAttribute("src") !== src) {
    clearTimeout(frame._wait);
    frame.addEventListener("load", () => clearTimeout(frame._wait), { once: true });
    frame._wait = setTimeout(() => { if (frame.isConnected) { unloaded.add(b.id); redrawFig(b.id); } }, LOAD_WAIT);
    frame.src = src;
  }
}
function redrawFig(id) {
  const n = rowOf(id), b = blockOf(id), p = page();
  if (n && b && MEDIA.includes(b.type)) drawMedia(n, b, !!(p && p.deleted));
}
// its snapshot asked for: when it has none, or it is SNAP_EVERY old (Figma's file unchanged: the backend keeps it)
function snapSoon(b, force = false, tell = false) {
  const p = page(), t = now();
  if (!p || p.deleted || b.type !== "figma") return;
  if (!force && (t - (snapAsked.get(b.id) || 0) < SNAP_EVERY || (b.snap && t - (b.snap_at || 0) < SNAP_EVERY))) return;
  snapAsked.set(b.id, t);
  ag.api("figma/snap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ block: b.id }) })
    .then((r) => r.json()).then((got) => {
      if (got.error) snapErr.set(b.id, got.error); else snapErr.delete(b.id);
      if (tell) say(got.error ? `No snapshot: ${got.error}` : "Snapshot is up to date", !!got.error);
      redrawFig(b.id);
    }).catch(() => {});
}

// -- keys in a caption (`h`: where the caret is in it, editor.js's here()): Enter a line below, Backspace (or ↑) at its
// start the picture
export function captionKey(ev, p, i, h) {
  const b = p.blocks[i], k = ev.key;
  if (k === "Enter" && !ev.shiftKey) { addAfter(b, "text"); return true; }
  if ((k === "Backspace" && h.start) || (k === "ArrowUp" && view.endOfTextblock("up")) || (k === "ArrowLeft" && h.start)) {
    focusFig(b.id);
    return true;
  }
  return (k === "Delete" && h.end) || k === "Tab";
}

// -- pictures added: kept by the backend, then put on the page as blocks -- into the empty line they came from, or
// after `at` ("": first) -- with a line to type in after them if they end the page; one step for ⌘Z
async function upload(file) {
  const r = await ag.api("image", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  const got = await r.json().catch(() => ({}));
  if (!r.ok || got.error) throw new Error(got.error || `upload failed (${r.status})`);
  return got;
}
export async function putPictures(files, at) {
  say(files.length > 1 ? `Adding ${files.length} pictures…` : "Adding picture…");
  const made = [];
  for (const f of files) {
    try { made.push({ type: "image", text: "", checked: false, indent: 0, ...(await upload(f)) }); }
    catch (e) { return say(`${f.name || "The picture"}: ${e.message}`, true); }
  }
  say(made.length > 1 ? `${made.length} pictures added` : "Picture added");
  putMedia(made, at && blockOf(at.id));
}
function putMedia(made, at, into = null) {
  const p = page();
  if (!p || p.deleted || !made.length) return;
  if (into === null) into = !!(at && at.type === "text" && blank(at.id));
  const i = at ? p.blocks.findIndex((x) => x.id === at.id) : -1, ops = [];
  let after = at ? at.id : "", next = p.blocks[i + 1];
  made.forEach((m, j) => {
    const id = j === 0 && into ? at.id : rid();
    if (j === 0 && into) forget(at.id);
    ops.push({ op: "block.put", page: p.id, block: { ...m, id }, ...(j === 0 && into ? {} : { after }) });
    after = id;
  });
  if (!next) { next = { id: rid(), type: "text", text: "", checked: false, indent: 0 }; ops.push({ op: "block.put", page: p.id, block: next, after }); }
  change(ops);
  drawPage();
  focusBlock(next.id, "start");
}
function pickFiles(then, many = true) {
  const input = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml", multiple: many });
  input.addEventListener("change", () => { if (input.files.length) then([...input.files]); });
  input.click();
}
export const pickPictures = (b) => pickFiles((fs) => putPictures(fs, blockOf(b.id) || b));
function replacePicture(b) {
  pickFiles(async ([f]) => {
    try {
      const got = await upload(f);
      change([{ op: "block.put", page: current, block: { id: b.id, ...got } }]);
      drawPage();
    } catch (e) { say(`${f.name || "The picture"}: ${e.message}`, true); }
  }, false);
}
function dropBlock(b) {
  const p = shown(), i = p.blocks.findIndex((x) => x.id === b.id), near = p.blocks[i + 1] || p.blocks[i - 1];
  forget(b.id);
  change([{ op: "block.delete", page: current, block: b.id }]);
  drawPage();
  if (near) focusBlock(near.id, "start");
}

// -- a Figma link: pasted alone on a line (shown live, or kept a link?), or given to the / menu's Figma
function makeFigma(b, url, into) {
  const at = blockOf(b.id);
  if (at) putMedia([{ type: "figma", url, title: figmaTitle(url), text: "", checked: false, indent: 0 }], at, into);
}
const lineRect = (b) => { const n = rowOf(b.id), tx = n && n.querySelector(":scope > .tx"); return (tx || box).getBoundingClientRect(); };
export function figmaChoice(b, url) {
  const m = popUp(lineRect(b), (pop) => pop.append(el("div", { class: "hd", text: "Paste as" }),
    item({ glyph: FIGMA_KIND.glyph, label: "Live frame", note: figmaTitle(url) || "From Figma" }, () => makeFigma(b, url, true)),
    item({ glyph: "↗", label: "Link" }, () => linkIt(b, url))), null, "figma");
  m.on = 0;
  m.el.querySelector(".it").classList.add("on");
}
export function figmaKey(ev) {
  const its = [...menu.el.querySelectorAll(".it")];
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    menu.on = (menu.on + 1) % its.length;
    its.forEach((x, j) => x.classList.toggle("on", j === menu.on));
    return true;
  }
  if (ev.key === "Enter") { ev.preventDefault(); its[menu.on].click(); return true; }
  if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
  closePop();                                            // typing on: the link stays as it was pasted
  return false;
}
function linkIt(b, url) {
  const x = blockOf(b.id);
  if (!x) return;
  const h = clean(`<a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${esc(url)}</a>`);
  forget(x.id);
  change([{ op: "block.put", page: current, block: { id: x.id, text: h } }]);
  drawPage();
  focusBlock(x.id, "end");
}
export function figmaBox(b) {
  const m = popUp(lineRect(b), (pop) => {
    const input = el("input", { class: "fg-input", type: "url", placeholder: "Paste a link to a frame or board", "aria-label": "Figma link", autocomplete: "off" });
    const bad = el("div", { class: "fg-bad", hidden: true });
    const go = () => {
      const url = input.value.trim();
      if (!FIGMA_URL.test(url)) { bad.textContent = "Not a Figma file link (figma.com/design/…, /board/… or /proto/…)"; bad.hidden = false; return; }
      closePop();
      const at = blockOf(b.id);
      if (at) makeFigma(at, url, blank(at.id) && at.type === "text");
    };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
    pop.append(el("div", { class: "hd", text: "Figma" }),
      el("div", { class: "fg-row" }, input, el("button", { type: "button", class: "primary", text: "Embed", onclick: go })), bad,
      el("p", { class: "fg-note", text: "In Figma, right-click a frame and choose Copy link to selection, or use Share › Copy link for the whole file." }));
  }, null, "figma-box", "fg-pop");
  setTimeout(() => { const i = m.el.querySelector("input"); if (i) i.focus(); });
}
function tokenBox(rect) {
  const m = popUp(rect, (pop) => {
    const input = el("input", { class: "fg-input", type: "password", placeholder: "figd_…", "aria-label": "Figma personal access token", autocomplete: "off" });
    const bad = el("div", { class: "fg-bad", hidden: true });
    const send = async (token) => {
      bad.hidden = true;
      let got;
      try { got = await (await ag.api("figma/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })).json(); }
      catch { got = { error: "The dashboard didn't respond" }; }
      if (got.error) { bad.textContent = got.error; bad.hidden = false; return; }
      figmaToken = { token: !!token, who: got.who || "" };
      closePop();
      say(token ? `Figma token saved${got.who ? ` (${got.who})` : ""}` : "Figma token removed");
      snapErr.clear();
      const p = page();
      if (p && token) for (const x of p.blocks) if (x.type === "figma") snapSoon(x, true);
      drawPage();
    };
    const save = () => { if (input.value.trim()) send(input.value.trim()); };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save(); } });
    pop.append(el("div", { class: "hd", text: "Figma token" }),
      el("p", { class: "fg-note", text: "With a token, Notes keeps a snapshot of any frame you can open in Figma, for your agents to see. Without one, it can only get a public file's cover." }),
      el("p", { class: "fg-note" }, "Create one in Figma's ", el("a", { href: "https://www.figma.com/settings", target: "_blank", rel: "noopener", text: "Settings" }),
        " › Security › Personal access tokens, with read access to file content. It stays on this computer."),
      el("div", { class: "fg-row" }, input, el("button", { type: "button", class: "primary", text: "Save", onclick: save })), bad,
      figmaToken.token ? el("button", { type: "button", class: "fg-forget", text: `Remove token${figmaToken.who ? ` (${figmaToken.who})` : ""}`, onclick: () => send("") }) : null);
  }, null, "token", "fg-pop");
  setTimeout(() => { const i = m.el.querySelector("input"); if (i) i.focus(); });
}
function figmaMenu(b, rect) {
  popUp(rect, (pop) => pop.append(
    item({ glyph: SVG.restore, sm: true, label: "Refresh snapshot" }, () => { unloaded.delete(b.id); snapSoon(b, true, true); }),
    item({ glyph: "⚿", sm: true, label: figmaToken.token ? "Figma token…" : "Add a Figma token…", note: figmaToken.who || "" }, () => tokenBox(rect)),
    item({ glyph: "⧉", sm: true, label: "Copy link" }, () => navigator.clipboard.writeText(b.url).then(() => say("Link copied"), () => say("Couldn't copy the link", true))),
    el("div", { class: "sep" }),
    item({ glyph: SVG.trash, sm: true, label: "Delete", bad: true }, () => dropBlock(b))));
}

// -- a picture's buttons, its sides dragged, and full size
export function figAct(btn) {
  const n = btn.closest(".blk"), b = n && blockOf(n.dataset.id);
  if (!b) return;
  const what = btn.dataset.do, ro = !!page().deleted;
  if (what === "open") return showFull(b);
  if (what === "view") { figView.set(b.id, figViewOf(b) === "live" ? "snap" : "live"); unloaded.delete(b.id); return redrawFig(b.id); }
  if (what === "retry") { unloaded.delete(b.id); figView.set(b.id, "live"); return redrawFig(b.id); }
  if (ro) return;
  if (what === "caption") return focusBlock(b.id, "end");
  if (what === "replace") return replacePicture(b);
  if (what === "delete") return dropBlock(b);
  if (what === "token") return tokenBox(btn.getBoundingClientRect());
  if (what === "more") return figmaMenu(b, btn.getBoundingClientRect());
}
const endSize = () => {
  if (!sizing) return;
  const s = sizing;
  sizing = null;
  document.body.classList.remove("sizing");
  if (s.pct === null) return;
  change([{ op: "block.put", page: current, block: { id: s.id, width: Math.round(s.pct) } }]);
  drawPage();
};
function showFull(b) {
  const lb = $("lightbox");
  let inner;
  if (b.type === "image") inner = el("img", { src: fileUrl(b.file), alt: plainOf(b.text) });
  else if (figViewOf(b) === "live") inner = el("iframe", { src: embedUrl(b.url), allowfullscreen: true, title: `${b.title || figmaTitle(b.url) || "Figma"}, live from Figma` });
  else inner = b.snap ? el("img", { src: fileUrl(b.snap), alt: b.title || "" }) : el("p", { class: "lb-none", text: "No snapshot yet." });
  lb.replaceChildren(el("div", { class: `lb-in ${b.type}` }, inner),
    el("button", { type: "button", class: "lb-x", title: "Close (Esc)", "aria-label": "Close", html: SVG.x, onclick: hideFull }));
  lb.dataset.block = b.id;
  lb.hidden = false;
  lb.querySelector(".lb-x").focus();
}
function hideFull() {
  const lb = $("lightbox"), id = lb.dataset.block;
  lb.hidden = true;
  lb.replaceChildren();
  if (id) focusFig(id);
}

// -- pictures dropped on the page: put where the line shows, between lines
const filesIn = (ev) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");

export function wirePictures() {
  // whether there is a Figma token; the theme, or being online, changed: the pictures drawn again
  ag.api("figma").then((r) => r.json()).then((t) => { figmaToken = t; if (page()) drawPage(); }).catch(() => {});
  ag.theme.on(() => { if (page()) drawPage(); });
  for (const e of ["online", "offline"]) addEventListener(e, () => { if (page()) drawPage(); });
  // -- full size (a double-click), and a picture's sides dragged
  box.addEventListener("dblclick", (ev) => {
    const img = ev.target.closest(".fig .pic img, .fig .fg-snap");
    const b = img && blockOf(img.closest(".blk").dataset.id);
    if (b) showFull(b);
  });
  box.addEventListener("pointerdown", (ev) => {
    const h = ev.target.closest(".fig .hdl");
    if (!h || ev.button !== 0 || !page() || page().deleted) return;
    ev.preventDefault();
    const n = h.closest(".blk"), pic = h.closest(".pic");
    sizing = { id: n.dataset.id, pic, col: n.querySelector(".fig").getBoundingClientRect().width, x: ev.clientX,
      w: pic.getBoundingClientRect().width, side: h.dataset.side, pct: null };
    h.setPointerCapture(ev.pointerId);
    document.body.classList.add("sizing");
  });
  box.addEventListener("pointermove", (ev) => {
    if (!sizing) return;
    const dx = (ev.clientX - sizing.x) * (sizing.side === "r" ? 1 : -1);   // (at the left edge: the side dragged moves)
    sizing.pct = Math.max(10, Math.min(100, ((sizing.w + dx) / sizing.col) * 100));
    sizing.pic.style.width = `${sizing.pct}%`;
    sizing.pic.style.maxWidth = "";
  });
  box.addEventListener("pointerup", endSize);
  box.addEventListener("pointercancel", endSize);
  $("lightbox").addEventListener("click", (ev) => { if (ev.target === $("lightbox") || ev.target.classList.contains("lb-in")) hideFull(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("lightbox").hidden) { ev.preventDefault(); ev.stopPropagation(); hideFull(); } }, true);
  // -- pictures dropped on the page (filesIn)
  document.addEventListener("dragover", (ev) => { if (filesIn(ev)) ev.preventDefault(); });   // (never the file opened in the panel)
  document.addEventListener("drop", (ev) => { if (filesIn(ev)) { ev.preventDefault(); $("drop").hidden = true; } });
  $("scroll").addEventListener("dragover", (ev) => {
    const p = page();
    if (!filesIn(ev) || !p || p.deleted || SPECIAL.includes(current)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "copy";
    const rows = [...box.children], before = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }) || null;
    const k = before ? rows.indexOf(before) : rows.length;
    dropAt = k ? rows[k - 1].dataset.id : "";
    const at = (before || rows[rows.length - 1] || box).getBoundingClientRect(), left = box.getBoundingClientRect(), line = $("drop");
    line.hidden = false;
    Object.assign(line.style, { left: `${left.left}px`, width: `${left.width}px`, top: `${(before ? at.top : at.bottom) - 2}px` });
  });
  $("scroll").addEventListener("dragleave", (ev) => { if (!ev.relatedTarget || !$("scroll").contains(ev.relatedTarget)) $("drop").hidden = true; });
  $("scroll").addEventListener("drop", (ev) => {
    const p = page();
    if (!filesIn(ev) || !p || p.deleted || SPECIAL.includes(current)) return;
    ev.preventDefault();
    ev.stopPropagation();
    $("drop").hidden = true;
    const pics = [...ev.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (!pics.length) return say("Only pictures can be dropped here", true);
    putPictures(pics, dropAt ? p.blocks.find((x) => x.id === dropAt) : null);
  });
}
