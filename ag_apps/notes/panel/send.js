// Notes: sending, in order -- a change applied here and queued (a step of undo.js's), a line's typing kept and
// queued after a pause, and the queue sent to the backend, one batch after another (one refused: each op sent alone).
import { $ } from "./helpers.js";
import { ag, ME, setTitleDirty, titleDirty } from "./state.js";
import { apply } from "./model.js";
import { keep, replaying, stepOf, takeBackOf, wordsTyped } from "./undo.js";
import { resync } from "./others.js";
import { drawSide } from "./sidebar.js";
import { cellOp } from "./tables.js";

export const queue = [];                              // ops applied here, not yet taken by the backend
export const dirty = new Map();                       // block id -> {page, text, timer}: typed, not yet queued
let sending = false, savedTimer = 0, status = "saved";
let sideSoon = 0;
export function change(ops, undoable = true) {        // applied here, and sent after what was typed before it; a step
  flushTyped();                                       // ⌘Z takes back, unless it can't be (a line sent to an agent)
  const step = undoable && !replaying ? stepOf(ops) : null;
  for (const op of ops) { if (step) takeBackOf(step, op); apply(op); }
  queue.push(...ops);
  pump();
  if (step) keep(step);
  if (!sideSoon) sideSoon = requestAnimationFrame(() => { sideSoon = 0; drawSide(); });   // its to-dos counted again
}
export function typed(page, id, text) {
  wordsTyped(page, id, text);
  const d = dirty.get(id);
  if (d) clearTimeout(d.timer);
  dirty.set(id, { page, text, timer: setTimeout(() => sendTyped(id), 450) });
  saved("saving");
}
export function sendTyped(id) {
  const d = dirty.get(id);
  if (!d) return;
  clearTimeout(d.timer);
  dirty.delete(id);
  queue.push(d.cell ? cellOp(d.page, d.cell.block, d.cell.row, d.cell.col, d.text) : { op: "block.put", page: d.page, block: { id, text: d.text } });
  pump();
}
export function forget(id) { const d = dirty.get(id); if (d) { clearTimeout(d.timer); dirty.delete(id); } }
export function flushTyped() {
  for (const id of [...dirty.keys()]) sendTyped(id);
  if (titleDirty) { clearTimeout(titleDirty.timer); queue.push({ op: "page.set", page: titleDirty.page, title: titleDirty.title }); setTitleDirty(null); }
}
export async function pump(keepalive = false) {
  if (sending) return;
  // (one refused says so till the next is saved)
  if (!queue.length) { if (!dirty.size && !titleDirty && status !== "saved" && status !== "refused") saved("saved"); return; }
  sending = true;
  saved("saving");
  const ops = queue.splice(0, queue.length);
  let refused = null;
  try {
    const r = await ag.api("ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ by: ME, ops }), keepalive });
    if (r.status >= 400 && r.status < 500) refused = (await r.json().catch(() => ({}))).error || `refused (${r.status})`;
    else if (!r.ok) throw new Error(`${r.status}`);
  } catch {
    queue.unshift(...ops);                            // not reached: tried again, in the same order
    sending = false;
    saved("retry");
    setTimeout(() => pump(), 2500);
    return;
  }
  if (refused) {
    // The notebook refuses a whole batch for one op it won't take: each sent again alone, so only that one is lost --
    // not the words typed beside it -- and the reader told. Then the page read again, still "sending": a change made
    // meanwhile waits in the queue, applied over the page as read -- not sent before the read comes, and lost under it.
    console.error("notes: a change refused:", refused, ops);
    let lost = ops.length === 1, left = [];
    if (ops.length > 1) {
      lost = false;
      for (let i = 0; i < ops.length; i++) {
        const one = await sendOps([ops[i]]);
        if (one === "refused") lost = true;
        else if (one === "unreached") { left = ops.slice(i); break; }   // tried again later, in the same order
      }
    }
    try { await resync(); } finally { sending = false; }
    if (left.length) { queue.unshift(...left); saved("retry"); setTimeout(() => pump(), 2500); return; }
    if (lost) saved("refused");
  }
  sending = false;
  pump();
}
// `ops` sent: "sent", "refused" (the notebook won't take them), or "unreached"
async function sendOps(ops) {
  try {
    const r = await ag.api("ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ by: ME, ops }) });
    return r.status >= 400 && r.status < 500 ? "refused" : r.ok ? "sent" : "unreached";
  } catch { return "unreached"; }
}
export function saved(how) {
  const s = $("saved");
  status = how;
  clearTimeout(savedTimer);
  s.classList.remove("quiet", "bad");
  if (how === "saving") s.textContent = "Saving…";
  else if (how === "retry") { s.textContent = "Not saved. Retrying…"; s.classList.add("bad"); }
  else if (how === "refused") { s.textContent = "A change couldn't be saved"; s.classList.add("bad"); }
  else { s.textContent = "Saved"; savedTimer = setTimeout(() => s.classList.add("quiet"), 1400); }
}

export function wireSend() {
  addEventListener("pagehide", () => { flushTyped(); pump(true); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { flushTyped(); pump(true); } });
}
