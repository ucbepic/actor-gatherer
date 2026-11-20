// What more than one of the panel's modules changes: the dashboard reached (`ag`), the notebook as this panel has it,
// the page open, the line whose conversation is open, and a few flags of the keys and the pointer. A module can't
// assign another's bindings: each is changed here, by its setter, and read where it is imported (a live binding, as
// it is now).
import { rid } from "./helpers.js";

export let ag = null;                                    // the dashboard, through app_kit's SDK (start.js connects it)
export function setAg(x) { ag = x; }
export const ME = `p${rid()}`;                           // this panel: its own batches come back marked with it
// this browser's own (per instance): what the reader left open, and the like
export const store = {
  get(k, d) { try { const v = localStorage.getItem(`notes:${ag.instance}:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`notes:${ag.instance}:${k}`, JSON.stringify(v)); } catch { /* storage off: kept for now only */ } },
};

// -- the notebook, as this panel has it (model.js applies an op to it)
export let book = { version: 0, pages: [] };
export function setBook(b) { book = b; }
export const pages = new Map();
export const known = new Map();                          // block id -> its words as last applied or typed (an undo's "before")
export let ready = false;                                // the notebook read: others' batches applied as they come
export function setReady(on) { ready = on; }

// -- what the reader has open
export let current = null;                               // the page open (a page's id, or the Agents, Work or Logbook page)
export function setCurrent(id) { current = id; }
export let convo = null;                                 // {page, block, to}: the line whose conversation is open, and with which agent
export function setConvo(c) { convo = c; }

// -- typing, the pointer, what is said
export let run = null;                                   // the step keys typed are adding to (undo.js): {step, key, page, at}
export function setRun(r) { run = r; }
export let titleDirty = null;                            // the title typed, not yet queued: {page, title, timer}
export function setTitleDirty(d) { titleDirty = d; }
export let eatMouse = false;                             // the mousedown of a pointer down taken (picking): no text selected
export function setEatMouse(on) { eatMouse = on; }
export let sayTimer = 0;                                 // what is said in the bar (actors.js's say), hidden after a while
export function setSayTimer(t) { sayTimer = t; }
