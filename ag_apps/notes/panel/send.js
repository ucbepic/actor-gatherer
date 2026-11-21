// Notes: sending, in order -- a change applied here and queued (a step of undo.js's), a line's typing kept and
// queued after a pause, and the queue sent to the backend, one batch after another (one refused: each op sent alone).
// Each batch is named, and the backend takes each name once (backend.py): one tried again after no answer came keeps
// its name and its ops, so it is never applied twice. The page going away (the panel closed, reloaded, its tab shut)
// while a batch is being sent: that batch and everything behind it -- queued, or typed and waiting for its pause --
// sent at once in one request kept alive past the page, in order (`leaving`). Whichever of the two reaches the
// backend first applies the batch being sent; what is behind it is applied only after it. Hidden but not gone (another
// tab shown), the panel goes on sending as before, and what it sends again is taken once.
import { $ } from "./helpers.js";
import { ag, ME, setTitleDirty, titleDirty } from "./state.js";
import { apply } from "./model.js";
import { keep, replaying, stepOf, takeBackOf, wordsTyped } from "./undo.js";
import { resync } from "./others.js";
import { drawSide } from "./sidebar.js";
import { cellOp } from "./tables.js";

export const queue = [];                              // ops applied here, not yet taken by the backend
export const dirty = new Map();                       // block id -> {page, text, timer}: typed, not yet queued
const named = [];                                     // the queue's first ops, in batches named already (sent once,
                                                      // maybe taken): each {id, n}, in order, sent again as they were
let sending = null, savedTimer = 0, status = "saved"; // sending: the batch on its way, {id, ops}
let made = 0;
const newName = () => `${ME}.${++made}`;
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
export async function pump() {
  if (sending) return;
  // (one refused says so till the next is saved)
  if (!queue.length) { if (!dirty.size && !titleDirty && status !== "saved" && status !== "refused") saved("saved"); return; }
  const { id, n } = named.shift() || { id: newName(), n: queue.length };
  const ops = queue.splice(0, n);
  sending = { id, ops };
  saved("saving");
  let refused = null;
  try {
    const r = await post([sending]);
    if (r.status >= 400 && r.status < 500) refused = (await r.json().catch(() => ({}))).error || `refused (${r.status})`;
    else if (!r.ok) throw new Error(`${r.status}`);
  } catch {
    queue.unshift(...ops);                            // not reached (or no answer): tried again, as it was, first
    named.unshift({ id, n: ops.length });
    sending = null;
    saved("retry");
    setTimeout(() => pump(), 2500);
    return;
  }
  if (refused) {
    // The notebook refuses a whole batch for one op it won't take: each sent again alone, so only that one is lost --
    // not the words typed beside it -- and the reader told. Then the page read again, still "sending": a change made
    // meanwhile waits in the queue, applied over the page as read -- not sent before the read comes, and lost under it.
    console.error("notes: a change refused:", refused, ops);
    // (each op named after its batch, `<batch>.<n>`, as the backend names them when it tries them alone itself)
    let lost = ops.length === 1, unsentFrom = -1;
    if (ops.length > 1) {
      lost = false;
      for (let i = 0; i < ops.length; i++) {
        const one = await sendOne({ id: `${id}.${i}`, ops: [ops[i]] });
        if (one === "refused") lost = true;
        else if (one === "unreached") { unsentFrom = i; break; }   // tried again later, in the same order, as named
      }
    }
    const unsent = unsentFrom < 0 ? [] : ops.slice(unsentFrom);
    queue.unshift(...unsent);
    named.unshift(...unsent.map((_, j) => ({ id: `${id}.${unsentFrom + j}`, n: 1 })));
    try { await resync(); } finally { sending = null; }
    if (unsent.length) { saved("retry"); setTimeout(() => pump(), 2500); return; }
    if (lost) saved("refused");
  }
  sending = null;
  pump();
}
// `batches` sent ({id, ops} each), to be applied in order: the answer (`leaving`: each op of a batch the notebook
// refuses whole tried alone by the backend; `keepalive`: the request kept alive past the page)
function post(batches, leaving = false, keepalive = leaving) {
  const body = JSON.stringify({ by: ME, batches, ...(leaving ? { leaving } : {}) });
  return ag.api("ops", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive });
}
// a batch sent: "sent", "refused" (the notebook won't take it), or "unreached"
async function sendOne(batch) {
  try {
    const r = await post([batch]);
    return r.status >= 400 && r.status < 500 ? "refused" : r.ok ? "sent" : "unreached";
  } catch { return "unreached"; }
}
// The page hidden, maybe going away: what is typed queued, and everything not yet taken -- the batch being sent, the
// batches named before, the rest of the queue (named now: sent again as it is) -- sent in one request kept alive past
// the page. Then sent as usual too, if the page lives on: each batch is taken once.
let sentLeaving = "";                                 // the names of the batches the last leaving request had
function leaving() {
  flushTyped();
  const unnamed = queue.length - named.reduce((all, b) => all + b.n, 0);
  if (unnamed) named.push({ id: newName(), n: unnamed });
  let at = 0;
  const batches = [...(sending ? [sending] : []), ...named.map((b) => ({ id: b.id, ops: queue.slice(at, at += b.n) }))];
  const names = batches.map((b) => b.id).join(" ");
  if (names && names !== sentLeaving) {               // (pagehide right after visibilitychange: sent once)
    sentLeaving = names;
    const failed = () => { if (sentLeaving === names) sentLeaving = ""; };
    // too large to keep alive (the browser keeps 64 KB in all): sent as an ordinary request, which may still get there
    post(batches, true).catch(() => post(batches, true, false)).then((r) => { if (!r.ok) failed(); }, failed);
  }
  pump();
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
  addEventListener("pagehide", leaving);
  document.addEventListener("visibilitychange", () => { if (document.hidden) leaving(); });
}
