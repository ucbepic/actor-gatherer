// Notes: the page's title and icon, and a click below the lines.
import { $, el, ICONS, plainOf, rid, SVG } from "./helpers.js";
import { setTitleDirty, titleDirty } from "./state.js";
import { change, flushTyped, pump, saved } from "./send.js";
import { titleTyped, undoStep } from "./undo.js";
import { drawSide } from "./sidebar.js";
import { box, drawCrumbs, drawPage, page, shown } from "./page.js";
import { focusBlock, onLine } from "./caret.js";
import { closePop, item, popUp } from "./popups.js";
import { canType } from "./tables.js";

export const title = $("title");
const iconPicker = (anchor) => popUp(anchor.getBoundingClientRect(), (pop) => {
  const p = page();
  pop.append(el("div", { class: "grid" }, ...ICONS.map((e) => el("button", { type: "button", text: e, title: e,
    onclick: () => { closePop(); change([{ op: "page.set", page: p.id, icon: e }]); drawSide(); drawPage(); } }))));
  if (p.icon) pop.append(el("div", { class: "sep" }), item({ glyph: SVG.x, sm: true, label: "Remove icon" },
    () => { change([{ op: "page.set", page: p.id, icon: "" }]); drawSide(); drawPage(); }));
}, null, "menu", "emoji");
export function belowClick() {                          // a click under the lines (a drag there picks them): one to type in
  const p = page();
  if (!p || p.deleted) return;
  const last = shown().blocks.slice(-1)[0];
  if (last && last.type === "text" && !plainOf(last.text)) return focusBlock(last.id, "end");
  const b = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
  change([{ op: "block.put", page: p.id, block: b }]);
  drawPage();
  focusBlock(b.id, 0);
}

export function wireTitle() {
  title.addEventListener("input", () => {
    const p = page();
    if (!p) return;
    const was = p.title || "";
    p.title = title.textContent.replace(/\s+/g, " ").trimStart();
    titleTyped(p, was);
    if (titleDirty) clearTimeout(titleDirty.timer);
    setTitleDirty({ page: p.id, title: p.title, timer: setTimeout(() => { flushTyped(); pump(); }, 450) });
    saved("saving");
    drawSide();
    drawCrumbs(p);
  });
  for (const t of [box, title]) t.addEventListener("beforeinput", (ev) => {   // Undo and Redo from the browser's Edit menu
    if (ev.inputType === "historyUndo" || ev.inputType === "historyRedo") { ev.preventDefault(); undoStep(ev.inputType === "historyRedo"); }
  });
  title.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === "z") { ev.preventDefault(); return undoStep(ev.shiftKey); }
    if (ev.key !== "Enter" && !(ev.key === "ArrowDown" && onLine(title, true))) return;
    ev.preventDefault();
    const p = page();
    if (!p || p.deleted) return;
    const first = shown().blocks.find(canType);
    if (first && ev.key === "ArrowDown") return focusBlock(first.id, "start");
    if (first && first.type === "text" && !plainOf(first.text)) return focusBlock(first.id, "start");
    const b = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    change([{ op: "block.put", page: p.id, block: b, after: "" }]);
    drawPage();
    focusBlock(b.id, 0);
  });
  title.addEventListener("paste", (ev) => {
    ev.preventDefault();
    document.execCommand("insertText", false, (ev.clipboardData.getData("text/plain") || "").replace(/\s+/g, " "));
  });
  $("add-icon").addEventListener("click", (ev) => iconPicker(ev.currentTarget));
  $("icon").addEventListener("click", (ev) => { if (!page().deleted) iconPicker(ev.currentTarget); });
}
