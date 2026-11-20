// Notes: the pop-ups (the / menu, the [[ and @ pickers, the menus) -- one at a time, put by what opened it,
// closed by a click elsewhere or Esc.
import { $, el } from "./helpers.js";
import { followPage } from "./pagelinks.js";
import { closeConvo } from "./convo.js";
import { atKey } from "./picker.js";

export let menu = null;                                  // {kind, el, items?, on?, tx?, from?, done?}
export function popUp(rect, fill, done, kind = "menu", cls = "") {
  closePop();
  const pop = $("pop");
  pop.className = `pop ${cls}`;
  pop.replaceChildren();
  pop.hidden = false;
  menu = { kind, el: pop, done };
  fill(pop);
  place(pop, rect);
  return menu;
}
export function place(pop, rect) {
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let x = Math.min(rect.left, innerWidth - w - 8), y = rect.bottom + 6;
  if (y + h > innerHeight - 8 && rect.top - h - 6 > 8) y = rect.top - h - 6;
  pop.style.left = `${Math.max(8, x)}px`;
  pop.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
}
export function closePop() {
  if (!menu) return;
  const m = menu;
  menu = null;
  $("pop").hidden = true;
  if (m.done) m.done();
}
export function item(k, run) {
  const b = el("button", { class: `it${k.cur ? " cur" : ""}${k.bad ? " bad" : ""}`, type: "button", role: "menuitem",
    onmousedown: (ev) => ev.preventDefault(), onclick: () => { closePop(); run(); } },
    el("span", { class: `gl${k.sm ? " sm" : ""}`, ...(k.glyph && k.glyph.startsWith("<svg") ? { html: k.glyph } : { text: k.glyph || "" }) }),
    el("span", { class: "tt" }, el("span", { text: k.label }), k.note ? el("small", { text: k.note }) : null));
  return b;
}

export function wirePopups() {
  document.addEventListener("mousedown", (ev) => { if (menu && !menu.el.contains(ev.target)) closePop(); }, true);
  document.addEventListener("keydown", (ev) => {
    if (menu && menu.kind === "at" && !menu.tx && atKey(ev)) return;          // the picker opened by a block's button
    if (menu && ev.key === "Escape" && !["slash", "at", "page"].includes(menu.kind)) { ev.preventDefault(); closePop(); }
  });
  $("convo").addEventListener("click", followPage);
  $("convo").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !menu && !ev.target.closest(".reply")) { ev.preventDefault(); closeConvo(); }
  });
}
