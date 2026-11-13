// ------------------------------------------------------------------ the lines selected, sent to an actor
// Text selected in the file open: a button beside it, "Send to an actor", opens a picker over the Editor -- a box for
// what to ask, then the actors of the Editor's gatherer (not closed ones, but saved ones; its coordinator agent first) --
// and the one picked is sent the user's words, then where the lines are and the lines themselves, as the user's own
// message, as its Chat sends one (ag.actors.send, capability message_actors): it reads it as any message of theirs. The
// file is saved first, auto-saved, so the lines it reads there are the ones quoted; else the message says they are not.
const ED_SEND_QUOTE_MAX = 20000;   // characters of a selection quoted in the message; more: only where they are
const edSend = { btn: null, pop: null, down: false, frame: 0 };

// The selection in the file open, if any: its text, and its first and last lines (a selection ending at a line's start
// ends on the line before).
function edSendSel() {
  const s = ed.s, v = s && s.view;
  if (!v) return null;
  const sel = v.state.selection.main;
  if (sel.empty) return null;
  const doc = v.state.doc, first = doc.lineAt(sel.from).number;
  let last = doc.lineAt(sel.to).number;
  if (last > first && doc.line(last).from === sel.to) last--;
  return { s, from: sel.from, to: sel.to, text: doc.sliceString(sel.from, sel.to), first, last };
}
const edSendLines = (q) => q.first === q.last ? `line ${q.first}` : `lines ${q.first}-${q.last}`;

// The button, kept beside the selection's end as the selection, the view and its scroll change -- shown while the file
// has the keys and text is selected (not while the mouse is still selecting), within the file's view.
function edSendPlace() {
  cancelAnimationFrame(edSend.frame);
  edSend.frame = requestAnimationFrame(edSendDraw);  // the view's layout is read after its update, not in it
}
function edSendDraw() {
  const q = edSendSel(), v = q && q.s.view;
  const show = !!q && !edSend.pop && !edSend.down && v.hasFocus;
  const at = show ? v.coordsAtPos(q.to, -1) : null, box = show ? v.scrollDOM.getBoundingClientRect() : null;
  if (!at || at.bottom < box.top || at.top > box.bottom) { if (edSend.btn) edSend.btn.hidden = true; return; }
  const b = edSend.btn ||= edSendButton();
  b.hidden = false;
  const w = b.offsetWidth || 120, h = b.offsetHeight || 24;
  const below = at.bottom + 4 + h <= box.bottom;
  b.style.left = `${Math.round(Math.max(box.left + 4, Math.min(at.left, box.right - w - 6)))}px`;
  b.style.top = `${Math.round(below ? at.bottom + 4 : Math.max(box.top + 2, at.top - h - 4))}px`;
}
function edSendButton() {
  const b = el("button", { type: "button", class: "ed-send", hidden: "", title: "Send the lines selected to an actor, with what to do",
    onmousedown: (ev) => ev.preventDefault(),        // the file keeps the keys, and its selection
    onclick: () => edSendOpen() },
  strokeIcon("M2.25 8h10.5M9 4.25 12.75 8 9 11.75", 13), el("span", { text: "Send to an actor" }));
  document.body.append(b);
  return b;
}
// the mouse selecting: no button until it lets go
document.addEventListener("pointerdown", (ev) => {
  if (ed.s && ed.s.view && ed.s.view.contentDOM.contains(ev.target)) { edSend.down = true; if (edSend.btn) edSend.btn.hidden = true; }
}, true);
document.addEventListener("pointerup", () => { if (edSend.down) { edSend.down = false; edSendPlace(); } }, true);
window.addEventListener("resize", () => { edSendClose(); edSendPlace(); });

// The actors it can go to: the Editor's gatherer's, as its list has them -- its coordinator agent first, then the
// others, the latest busy first.
function edSendActors() {
  const g = ((state.home && state.home.gatherers) || []).find((x) => x.name === (agApp && agApp.gatherer));
  const open = ((g && g.agents) || []).filter((a) => statusOf(a)[0] !== "closed" || a.saved);
  const lead = open.filter((a) => a.role === "coordinator");
  return [...lead, ...open.filter((a) => a.role !== "coordinator").sort((x, y) => (y.last || 0) - (x.last || 0))];
}

// The picker, over the Editor at the button: what the lines are (kept as they were when it opened), the box for what to
// ask (it has the keys: ↵ sends to the actor marked, ⇧↵ a new line, ↑↓ mark another), the actors. Esc, or a press
// outside it, puts it away, the keys back in the file.
function edSendOpen() {
  const q = edSendSel();
  if (!q || !agApp) return;
  edSendClose();
  const ask = el("textarea", { class: "ed-send-ask", rows: "2", "aria-label": "What the actor should do with the lines",
    placeholder: "What should it do with them?" });
  const list = el("div", { class: "ed-send-list", role: "listbox", "aria-label": "Actors" });
  const box = el("div", { class: "ed-sendpop", role: "dialog", "aria-label": "Send the lines selected to an actor" },
    el("div", { class: "ed-send-hd", text: `Send ${edSendLines(q)} of ${edBase(q.s.path)} to an actor, as your message` }),
    ask, list, el("div", { class: "ed-send-ft", text: "↵ sends · ⇧↵ a new line · ↑↓ another actor · Esc" }));
  const p = edSend.pop = { box, ask, list, q, items: edSendActors(), on: 0, off: null };
  ask.addEventListener("keydown", edSendKey);
  ask.addEventListener("input", () => { ask.classList.remove("bad"); ask.style.height = "auto"; ask.style.height = `${Math.min(ask.scrollHeight, 160)}px`; });
  const outside = (ev) => { if (!box.contains(ev.target)) edSendClose(); };
  document.addEventListener("pointerdown", outside, true);
  p.off = () => document.removeEventListener("pointerdown", outside, true);
  document.body.append(box);
  edSendList();
  const at = edSend.btn && !edSend.btn.hidden ? edSend.btn.getBoundingClientRect() : q.s.view.scrollDOM.getBoundingClientRect();
  if (edSend.btn) edSend.btn.hidden = true;
  const w = Math.min(420, window.innerWidth - 16), h = box.offsetHeight;
  box.style.width = `${w}px`;
  box.style.left = `${Math.round(Math.max(8, Math.min(at.left, window.innerWidth - w - 8)))}px`;
  box.style.top = `${Math.round(at.top + h + 8 <= window.innerHeight ? at.top : Math.max(8, window.innerHeight - h - 8))}px`;
  ask.focus();
}
function edSendList() {
  const p = edSend.pop;
  if (!p) return;
  p.on = Math.min(p.on, Math.max(0, p.items.length - 1));
  p.list.replaceChildren(...(p.items.length ? p.items.map((a, i) => {
    const color = edWhoColor(a);
    const row = el("div", { class: `ed-send-it${i === p.on ? " on" : ""}`, role: "option", "aria-selected": String(i === p.on),
      onmousedown: (ev) => ev.preventDefault(), onclick: () => edSendGo(a),
      onmousemove: () => { if (p.on !== i) { p.on = i; edSendList(); } } },
    a.avatar ? el("img", { src: avatarSrc(a.avatar), alt: "", draggable: "false" })
      : el("span", { class: "ed-noav", style: `--who: ${color || "var(--axis)"}` }),
    el("span", { class: "nm", text: a.role === "coordinator" ? "Coordinator agent" : edWhoName(a) }),
    el("span", { class: "st", text: statusOf(a)[1] || "" }));
    return row;
  }) : [el("div", { class: "ed-send-none", text: "No actors in this group yet." })]));
  const on = p.list.querySelector(".ed-send-it.on");
  if (on) on.scrollIntoView({ block: "nearest" });
}
function edSendKey(ev) {
  const p = edSend.pop;
  if (!p || ev.isComposing) return;
  const n = p.items.length;
  if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); if (n) edSendGo(p.items[p.on]); return; }
  if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && !p.ask.value.includes("\n") && n) {
    ev.preventDefault();
    p.on = (p.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
    edSendList();
    return;
  }
  if (ev.key === "Escape") { ev.preventDefault(); edSendClose(true); }
}
function edSendClose(back = false) {
  const p = edSend.pop;
  if (!p) return;
  edSend.pop = null;
  p.off();
  p.box.remove();
  if (back && ed.s && ed.s.view) ed.s.view.focus();
  edSendPlace();
}

// What the actor is sent: the user's words, then where the lines are -- the file's whole path -- and the lines, in a
// fence longer than any run of backticks in them (too many: only where they are, to read in the file).
function edSendText(words, q, saved) {
  const lines = edSendLines(q);
  const where = `${lines[0].toUpperCase()}${lines.slice(1)} of ${q.s.path}${saved ? "" : " (as I have them in my Editor: not saved yet)"}`;
  if (q.text.length > ED_SEND_QUOTE_MAX) return `${words}\n\n${where}: too long to quote here, read them in the file.`;
  const ext = (edBase(q.s.path).match(/\.([A-Za-z0-9+#-]{1,10})$/) || [])[1] || "";
  const fence = "`".repeat(Math.max(3, ...(q.text.match(/`+/g) || []).map((r) => r.length + 1)));
  return `${words}\n\n${where}:\n\n${fence}${ext.toLowerCase()}\n${q.text.replace(/\n$/, "")}\n${fence}`;
}
async function edSendGo(a) {
  const p = edSend.pop;
  if (!p) return;
  const words = p.ask.value.trim();
  if (!words) {
    p.ask.classList.add("bad");
    p.ask.placeholder = "Say what it should do first, then pick the actor.";
    p.ask.focus();
    return;
  }
  const q = p.q, s = q.s, name = a.role === "coordinator" ? "the coordinator agent" : edWhoName(a);
  edSendClose(true);
  const unsaved = () => !!(s.out.length || s.sending || (s.state && s.state.dirty));   // its last keys too, not sent yet
  let saved = !unsaved();
  if (!saved && ed.auto && !(s.state && s.state.missing) && !edDiskConflicts(s).length) {
    await edSave(s);                                 // (a failure is its own: s.err, said in the header)
    saved = !unsaved() && !s.err;
  }
  try {
    await agApp.actors.send(a.channel, edSendText(words, q, saved));
    edNote(`Sent to ${name}`);
  } catch (e) {
    edNote(`Not sent: ${e.message}`, true);
  }
}
