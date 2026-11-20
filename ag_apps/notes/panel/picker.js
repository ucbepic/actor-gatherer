// Notes: the picker -- who a line goes to, and with what.
// `@` typed at a word's start in a block (as `/` opens the block menu), or its Assign / Ask button: the gatherer agent,
// the actors (not closed ones, but saved ones), a new actor on each harness the dashboard runs here -- and, above
// them, a box for what to add to the line (instructions it doesn't say yet), sent with it. What is typed after the @
// narrows the agents, Tab goes into the box; ↑↓ pick, ↵ sends (⇧↵ a new line in the box), Esc closes. Opened by the
// button, the box has the keys at once.
import { el, oneLine, SVG, UNSENT } from "./helpers.js";
import { current, store } from "./state.js";
import { change, forget } from "./send.js";
import { caretIn, pointAt, textOf } from "./caret.js";
import { closePop, menu, place, popUp } from "./popups.js";
import { holdKeys, picked } from "./picked.js";
import { callTo, crew, face, findLine, isLead, nameOf, onIt, stands, tilde } from "./actors.js";
import { sendTo } from "./sent.js";

export function atInput(n, tx, b, ev) {
  if (menu && menu.kind === "at" && menu.tx) {
    const c = caretIn(tx);
    if (menu.tx !== tx || !c || c.start <= menu.from || tx.textContent[menu.from] !== "@") return closePop();
    const q = tx.textContent.slice(menu.from + 1, c.start);
    if (q.length > 30 || /\s\s/.test(q)) return closePop();
    return drawAt(q);
  }
  if (ev.inputType !== "insertText" || ev.data !== "@" || UNSENT.includes(b.type) || b.type === "code") return;
  const c = caretIn(tx);
  if (!c) return;
  const before = tx.textContent.slice(0, c.start - 1);
  if (before && !/\s$/.test(before)) return;           // an address's @ (a@b.c): not
  const r = getSelection().getRangeAt(0).getBoundingClientRect();
  atPop(r.width || r.height ? r : tx.getBoundingClientRect(), { tx, from: c.start - 1, block: b.id });
}
export function openPicker(id, rect, ids = null) {
  atPop(rect, { tx: null, block: id, blocks: ids && ids.length > 1 ? ids : null });
  if (menu && menu.extra) menu.extra.focus();          // at once: keys typed next are its, however busy the page is
}
// the picker's frame: its head, the box for what to add (kept as the agents are drawn again), the agents, its foot
function atPop(rect, m) {
  popUp(rect, (pop) => {
    const many = m.blocks ? m.blocks.length : 0;
    const extra = el("textarea", { class: "at-extra", rows: "1", "aria-label": `Instructions to send with the line${many ? "s" : ""}`,
      placeholder: m.tx ? "Add instructions (optional) · Tab to type" : "Add instructions (optional)" });
    extra.addEventListener("input", () => { extra.style.height = "auto"; extra.style.height = `${Math.min(extra.scrollHeight, 140)}px`; });
    extra.addEventListener("keydown", (ev) => extraKey(ev, extra));
    const also = !many && onIt((findLine(m.block) || {}).b).length > 0;
    pop.append(el("div", { class: "hd lead", text: many ? `Send ${many} lines to an agent as one message` : also ? "Send to another agent" : "Send to an agent" }), extra,
      el("div", { class: "at-list", role: "group", "aria-label": "Agents" }), el("div", { class: "at-end" }));
    menu.extra = extra;
  }, null, "at", "at-pop");
  Object.assign(menu, { rect, q: "", ...m });
  drawAt("");
}
function atItems(q) {
  const words = q.trim().toLowerCase();
  const hit = (...xs) => !words || xs.some((x) => String(x || "").toLowerCase().includes(words));
  const out = [];
  const lead = crew.agents.find(isLead);
  // the agents a line is with now: not offered again (lines sent together: any agent, the call to it sent again)
  const line = menu && !menu.blocks ? (findLine(menu.block) || {}).b : null;
  const taken = (ch) => !!line && onIt(line).some((c) => callTo(c, ch));
  if (!taken(lead ? lead.channel : "gatherer") && hit("coordinator agent", "gatherer agent", "manager"))
    out.push({ kind: "lead", group: "Coordinator", channel: lead ? lead.channel : "gatherer", a: lead, label: nameOf(lead, "gatherer"),
      note: "Assigns it to an actor" });
  const shown = crew.agents.filter((a) => !isLead(a) && ((a.status || [])[0] !== "closed" || a.saved))
    .sort((x, y) => (y.last || 0) - (x.last || 0));
  for (const a of shown) if (!taken(a.channel) && hit(nameOf(a), a.last_user_message, a.channel))
    out.push({ kind: "actor", group: "Actors", channel: a.channel, a, label: nameOf(a), note: oneLine(a.last_user_message || "", 60) });
  for (const h of crew.harnesses) if (hit(`new ${h.label} actor`))
    out.push({ kind: "new", group: "Start a new actor", harness: h.name, label: `New ${h.label} actor`, note: `in ${tilde(crew.start) || "a folder you name"}` });
  if (crew.harnesses.length && hit("new actor in another folder"))
    out.push({ kind: "where", group: "Start a new actor", label: "In another folder…", note: "" });
  return out;
}
export function drawAt(q) {
  const items = atItems(q);
  Object.assign(menu, { items, q, on: Math.min(menu.on || 0, Math.max(0, items.length - 1)) });
  if (menu.tx) menu.qEnd = menu.from + 1 + q.length;   // where the "@..." typed ends, should the caret leave the block
  const pop = menu.el, list = pop.querySelector(".at-list"), report = store.get("report", true);
  list.replaceChildren();
  if (!items.length) list.append(el("div", { class: "none", text: crew.agents.length || crew.harnesses.length ? "No matching agents" : "No agents yet" }));
  let group = null;
  items.forEach((it, j) => {
    if (it.group !== group) { group = it.group; list.append(el("div", { class: "hd", text: group })); }
    const [cls, word] = it.a ? stands(it.a) : it.kind === "lead" ? ["idle", "Starts on it"] : [null, null];
    const row = el("button", { class: `it${j === menu.on ? " on" : ""}`, type: "button", role: "menuitem",
      onmousedown: (ev) => ev.preventDefault(), onclick: () => atPick(it) },
      it.kind === "new" || it.kind === "where" ? el("span", { class: "gl sm", html: SVG.plus }) : face(it.a, 24, it.kind === "lead"),
      el("span", { class: "tt" }, el("span", { text: it.label }), it.note ? el("small", { text: it.note }) : null),
      word ? el("span", { class: `pill ${cls}`, text: word }) : null);
    row.addEventListener("mousemove", () => { if (menu && menu.on !== j) { menu.on = j; drawAt(q); } });
    list.append(row);
  });
  pop.querySelector(".at-end").replaceChildren(el("div", { class: "sep" }), el("button", { type: "button", class: "at-foot", role: "checkbox",
    "aria-checked": String(report), onmousedown: (ev) => ev.preventDefault(), onclick: () => { store.set("report", !report); drawAt(q); } },
    el("span", { class: "box", html: report ? SVG.check : "" }), el("span", { text: "Ask for a report" }),
    el("small", { text: "↑↓ ↵" })));
  place(pop, menu.rect);
  const on = list.querySelector(".it.on");
  if (on) on.scrollIntoView({ block: "nearest" });
}
export function atKey(ev) {
  const n = menu.items ? menu.items.length : 0;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawAt(menu.q || ""); }
    return true;
  }
  if (ev.key === "Tab" && menu.extra) { ev.preventDefault(); menu.extra.focus(); return true; }
  if (ev.key === "Enter" && n) { ev.preventDefault(); atPick(menu.items[menu.on]); return true; }
  if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
  return false;
}
// the box's own keys, kept from the page's: ↵ sends to the agent picked, ⇧↵ a new line; ↑↓ pick while it is one line;
// Esc closes (back into the block the @ was typed in)
function extraKey(ev, box) {
  ev.stopPropagation();
  if (ev.isComposing || !menu) return;
  const n = menu.items ? menu.items.length : 0;
  if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); if (n) atPick(menu.items[menu.on]); return; }
  if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && !box.value.includes("\n")) {
    ev.preventDefault();
    if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawAt(menu.q || ""); }
    return;
  }
  if (ev.key === "Escape") {
    ev.preventDefault();
    const tx = menu.tx;
    closePop();
    if (tx && tx.isConnected) tx.focus();
    else if (picked.size) holdKeys();                   // (sent from lines picked: they keep the keys)
  }
}
// Who was picked: the "@..." typed taken out of the block, and the block sent with what was added -- or, for another
// folder, that asked first.
function atPick(it) {
  const m = menu, extra = m && m.extra ? m.extra.value : "";
  closePop();
  if (!m) return;
  const b = (findLine(m.block) || {}).b;                // (the Work page's Assign: a line of any page)
  if (!b) return;
  if (m.tx && m.tx.isConnected) {
    const tx = m.tx, n = tx.closest(".blk"), c = caretIn(tx);
    const end = c && c.start > m.from ? c.start : m.qEnd || m.from + 1;
    const r = document.createRange(), a = pointAt(tx, m.from), z = pointAt(tx, Math.max(end, m.from + 1));
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    r.deleteContents();
    if (tx.innerHTML === "<br>") tx.innerHTML = "";
    b.text = textOf(n, b);
    forget(b.id);
    change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } }]);
  }
  if (it.kind === "where") return folderAsk(m.blocks || [b.id], m.rect, extra);
  sendTo(m.blocks || [b.id], it.kind === "new" ? { harness: it.harness, folder: crew.start } : { channel: it.channel }, extra);
}
// A new actor's folder, asked: typed, and a harness picked.
function folderAsk(ids, rect, extra) {
  popUp(rect, (pop) => {
    const input = el("input", { type: "text", value: tilde(crew.start), "aria-label": "Folder", placeholder: "~/a/folder" });
    const go = (h) => {
      const v = input.value.trim().replace(/^~(?=\/|$)/, crew.home);
      if (!v) return input.focus();
      closePop();
      sendTo(ids, { harness: h, folder: v }, extra);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && crew.harnesses[0]) { e.preventDefault(); go(crew.harnesses[0].name); } });
    pop.append(el("div", { class: "hd", text: "New actor in" }), el("div", { class: "row" }, input),
      el("div", { class: "row" }, ...crew.harnesses.map((h) => el("button", { type: "button", text: h.label, onclick: () => go(h.name) }))));
    setTimeout(() => input.focus(), 0);
  }, null, "menu", "at-pop");
}
