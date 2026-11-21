// Notes: the gutter beside a line -- its + (a line below, the / menu open in it) and its grip (dragged: the line,
// or the lines picked with it, moved; clicked: the line's menu) -- and the line's other buttons and links, clicked.
import { $, el, KINDS, SVG, UNSENT } from "./helpers.js";
import { ag, current } from "./state.js";
import { change, forget } from "./send.js";
import { blockOf, box, drawPage, page, shown } from "./page.js";
import { focusBlock } from "./caret.js";
import { addAfter, retype, tick, typeIn } from "./typing.js";
import { item, popUp } from "./popups.js";
import { followPage } from "./pagelinks.js";
import { copyOf, holdKeys, linesMenu, picked } from "./picked.js";
import { tableSet } from "./tables.js";
import { figAct } from "./pictures.js";
import { accept, actorOf, cancel, endedOf, isWork, markWork, nameOf, onIt, reopen, say, viewsOn } from "./actors.js";
import { drop } from "./sent.js";
import { openPicker } from "./picker.js";

export let drag = null;
const endDrag = (ev) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  $("drop").hidden = true;
  for (const r of d.rows) r.classList.remove("dragging");
  document.body.classList.remove("dragging");
  if (ev.type === "pointercancel") return;
  if (!d.moved) return blockMenu(d.row);
  const rows = [...box.children].filter((r) => !d.rows.includes(r));
  const at = d.before ? rows.indexOf(d.before) : rows.length;
  const after = at > 0 ? rows[at - 1].dataset.id : "";
  const p = page(), i = p.blocks.findIndex((b) => b.id === d.rows[0].dataset.id);
  if ((after === "" && i === 0) || (i > 0 && p.blocks[i - 1].id === after)) return;
  change(moveOps(d.rows.map((r) => r.dataset.id), after));
  drawPage();
  if (d.rows.length > 1) holdKeys();
};
// lines (a run, in order) moved to go after a block ("" the page's start)
export function moveOps(ids, after) {
  return ids.map((id) => { const op = { op: "block.move", page: current, block: id, after }; after = id; return op; });
}
function blockMenu(n) {
  const b = blockOf(n.dataset.id);
  if (!b) return;
  if (picked.size > 1 && picked.has(b.id)) return linesMenu(n.querySelector(".grip").getBoundingClientRect(), n);
  n.classList.add("menu-open");
  popUp(n.querySelector(".grip").getBoundingClientRect(), (pop) => {
    const kinds = KINDS.filter((k) => !UNSENT.includes(k.type) || b.type === k.type);
    if (kinds.length) pop.append(el("div", { class: "hd", text: "Turn into" }));
    for (const k of kinds)
      pop.append(item({ ...k, note: "", sm: true, cur: k.type === b.type }, () => { if (k.type !== b.type) { retype(b, k.type); focusBlock(b.id); } }));
    if (b.type === "table") pop.append(el("div", { class: "hd", text: "Table" }),
      item({ glyph: b.head ? SVG.check : "", sm: true, label: "Header row", note: b.head ? "On" : "Off" }, () => tableSet(b, { head: !b.head })),
      item({ glyph: b.head_col ? SVG.check : "", sm: true, label: "Header column", note: b.head_col ? "On" : "Off" }, () => tableSet(b, { head_col: !b.head_col })));
    pop.append(el("div", { class: "sep" }),
      ...(UNSENT.includes(b.type) ? [] : onIt(b).length ? [
        item({ glyph: SVG.at, sm: true, label: "Send to another agent…" }, () => openPicker(b.id, n.getBoundingClientRect())),
        ...viewsOn(b).map((v) => item({ glyph: SVG.x, sm: true, label: `Remove ${nameOf(actorOf(v.to), v.to)}`, note: "from this line" }, () => drop(v))),
      ] : [item({ glyph: SVG.at, sm: true, label: "Send to an agent…" }, () => openPicker(b.id, n.getBoundingClientRect())),
        b.work ? item({ glyph: SVG.x, sm: true, label: "Remove from work items" }, () => markWork([b], false))
          : item({ glyph: SVG.work, sm: true, label: "Mark as a work item", note: "Tracked on the Work page" }, () => markWork([b], true))]),
      ...(!isWork(b) ? [] : endedOf(b) ? [item({ glyph: SVG.restore, sm: true, label: "Reopen" }, () => reopen([b]))] : [
        item({ glyph: SVG.check, sm: true, label: "Accept as done" }, () => accept([b])),
        item({ glyph: SVG.x, sm: true, label: "Cancel it" }, () => cancel([b]))]),
      item({ glyph: "⧉", sm: true, label: "Duplicate" }, () => {
        const copy = copyOf(b);
        change([{ op: "block.put", page: current, block: copy, after: b.id }]);
        drawPage();
        focusBlock(copy.id);
      }),
      item({ glyph: SVG.trash, sm: true, label: "Delete", bad: true }, () => {
        const p = shown(), i = p.blocks.indexOf(b), near = p.blocks[i - 1] || p.blocks[i + 1];
        forget(b.id);
        change([{ op: "block.delete", page: current, block: b.id }]);
        drawPage();
        if (near) focusBlock(near.id);
      }));
  }, () => n.classList.remove("menu-open"));
}

export function wireGutter() {
  box.addEventListener("click", (ev) => {
    const act = ev.target.closest(".fig [data-do]");
    if (act) return figAct(act);
    const to = ev.target.closest(".to-btn");
    if (to) {
      const b = blockOf(to.closest(".blk").dataset.id);
      if (b && !page().deleted) openPicker(b.id, to.getBoundingClientRect());
      return;
    }
    const add = ev.target.closest(".gut .add");
    if (add) {
      const b = blockOf(add.closest(".blk").dataset.id);
      if (!b || page().deleted) return;
      addAfter(b, "text");
      typeIn("/");                                         // the / menu, opened as typing "/" opens it
      return;
    }
    const chk = ev.target.closest(".chk");
    if (chk) {
      const b = blockOf(chk.closest(".blk").dataset.id);
      if (b && !page().deleted) tick(b);
      return;
    }
    if (followPage(ev)) return;
    const a = ev.target.closest(".tx a");
    if (!a || !(ev.metaKey || ev.ctrlKey || page().deleted)) return;
    ev.preventDefault();
    const href = a.getAttribute("href") || "";
    // a link to something in an app (ag://, a page's line here too): opened there, as a click on it in Chat opens it
    if (/^ag:\/\//.test(href)) ag.links.open(href).catch((e) => say(e.message, true));
    else window.open(a.href, "_blank", "noopener");
  });
  box.addEventListener("mousedown", (ev) => { if (ev.target.closest(".chk, .gut .add, .to-btn, .tx a.pg")) ev.preventDefault(); });
  box.addEventListener("pointerdown", (ev) => {
    const grip = ev.target.closest(".gut .grip");
    if (!grip || ev.button !== 0 || page().deleted) return;
    ev.preventDefault();
    const row = grip.closest(".blk");                      // a picked line's grip: every picked line goes with it
    const rows = picked.size > 1 && picked.has(row.dataset.id) ? [...box.children].filter((r) => picked.has(r.dataset.id)) : [row];
    drag = { row, rows, y: ev.clientY, moved: false, before: undefined };
    grip.setPointerCapture(ev.pointerId);
  });
  box.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(ev.clientY - drag.y) < 4) return;
    if (!drag.moved) { drag.moved = true; for (const r of drag.rows) r.classList.add("dragging"); document.body.classList.add("dragging"); }
    const rows = [...box.children].filter((r) => !drag.rows.includes(r));
    drag.before = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }) || null;
    const line = $("drop"), at = drag.before ? drag.before.getBoundingClientRect() : (rows[rows.length - 1] || drag.row).getBoundingClientRect();
    const left = box.getBoundingClientRect();
    line.hidden = false;
    Object.assign(line.style, { left: `${left.left}px`, width: `${left.width}px`, top: `${(drag.before ? at.top : at.bottom) - 2}px` });
    const sc = $("scroll").getBoundingClientRect();
    if (ev.clientY < sc.top + 30) $("scroll").scrollTop -= 12;
    else if (ev.clientY > sc.bottom - 30) $("scroll").scrollTop += 12;
  });
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);
}
