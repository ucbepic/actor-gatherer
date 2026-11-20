// Notes: the conversation about a line, beside the page.
// Opened from a sent line's status: the line as it was sent to one of its agents, then their thread -- the user's
// messages (each sent to that actor too) and its reports -- as bubbles; what it asks, answered there; a box to message
// it. Its head names the line's agents, one a tab (those it was taken back from too: what was said is kept), with a
// button that sends the line to another agent too, and one that takes it back from this one. One at a time, on the page
// shown; another line's status shows that one's instead. Three parts, each drawn again only when it changed: the
// message typed is never drawn over.
import { $, clean, clock, el, esc, LOG, oneLine, SVG, WORK } from "./helpers.js";
import { ag, convo, current, pages, setConvo } from "./state.js";
import { withLinks } from "./model.js";
import { app } from "./sidebar.js";
import { drawPage, page, rowOf } from "./page.js";
import { accept, actorOf, askedAll, callsOf, cancel, endedAt, endedOf, face, groupStands, isWork, lineStands, madeRow,
  nameOf, reopen, say, sentWith, threadOf, viewFor, viewsOf, when } from "./actors.js";
import { drop, reply, sentPart } from "./sent.js";
import { linesOf, srcStands, wroteAt, wroteLine } from "./source.js";
import { openPicker } from "./picker.js";
import { drawAgentsBlock } from "./agents.js";
import { drawWorkBlock, drawWorkPage } from "./work.js";

export function openConvo(id, to = null) {
  setConvo({ page: current, block: id, to });
  drawPage();
  const input = $("convo").querySelector(".reply input");
  if (input && !input.disabled) input.focus();
}
export function closeConvo() {
  if (!convo) return;
  setConvo(null);
  drawPage();
}
// (`to` left out: the line's conversation, whichever agent it is with)
export const toggleConvo = (id, to = undefined) => (convo && convo.block === id && (to === undefined || convo.to === to) ? closeConvo() : openConvo(id, to || null));
export function drawConvo() {
  const box = $("convo");
  const p = convo && current === convo.page ? pages.get(convo.page) : null;
  let line = p && p.blocks.find((x) => x.id === convo.block);
  // with the agent asked for, else the most pressing of those it is with now, else the first it went to
  const pick = (x) => { const vs = viewsOf(x); return vs.find((v) => v.to === convo.to) || lineStands(x).v || vs.find((v) => !v.dropped) || vs[0] || x; };
  let b = line ? pick(line) : null;
  const g = b ? linesOf(b) : [];
  if (b && g[g.length - 1].id !== b.id) {                // lines sent together: one conversation, the last's
    line = p.blocks.find((x) => x.id === g[g.length - 1].id) || line;
    b = viewFor(line, b.to) || line;
    convo.block = line.id;
  }
  if (convo && b) convo.to = b.to || null;
  if (!b || !(b.to || b.source || (b.thread && b.thread.length))) {
    setConvo(null);
    box.hidden = true;
    box.replaceChildren();
    delete box.dataset.block;
    app.classList.remove("convo-open");
    return;
  }
  app.classList.add("convo-open");
  box.hidden = false;
  if (box.dataset.block !== b.id) {
    box.dataset.block = b.id;
    box.replaceChildren(el("div", { class: "cv-head" }), el("div", { class: "cv-list", role: "log", "aria-live": "polite" }), el("div", { class: "cv-foot" }));
  }
  const who = b.to || b.source || "", a = who ? actorOf(who) : null, name = who ? nameOf(a, who) : "", ro = !!p.deleted;
  const s = b.to || isWork(b) ? groupStands(g) : b.source ? srcStands(a, g) : { key: "none", cls: "idle", word: "Not sent to anyone" }, cls = s.cls, word = s.word;
  const words = (x) => (x.type === "code" ? esc(x.text) : x.text);
  const about = g.length > 1 ? `${g.length} lines: ${g.map((x) => oneLine(words(x), 60)).join(" · ")}` : oneLine(words(b), 160);
  // its agents, one a tab: how the line stands with each
  const tabs = b.to ? viewsOf(line).map((v) => { const x = actorOf(v.to); return { to: v.to, x, name: nameOf(x, v.to), s: v.to === b.to ? s : groupStands(sentWith(v)) }; }) : [];
  const add = !ro && !!b.to, canDrop = !ro && !!b.to && !b.dropped;
  const head = box.querySelector(".cv-head");
  const headSig = JSON.stringify([cls, word, name, a && a.avatar, about, !!a, b.source, b.source_at, b.to,
    tabs.length > 1 ? tabs.map((t) => [t.to, t.name, t.x && t.x.avatar, t.s.cls, t.s.word]) : 0, add, canDrop]);
  if (head.dataset.sig !== headSig) {
    head.dataset.sig = headSig;
    const tab = (t) => el("button", { type: "button", class: `cv-tab${t.to === b.to ? " on" : ""}`, role: "tab", "aria-selected": String(t.to === b.to),
      title: `${t.name}: ${t.s.word}`, onclick: () => { if (convo && t.to !== convo.to) { convo.to = t.to; drawPage(); } } },
      face(t.x, 18), el("b", { text: t.name }), el("span", { class: `pill ${t.s.cls}`, text: t.s.word }));
    head.replaceChildren(
      el("div", { class: "cv-who" },
        ...(tabs.length > 1 ? [el("div", { class: "cv-tabs", role: "tablist", "aria-label": "Agents" }, ...tabs.map(tab))]
          : [who ? face(a, 22) : null, el("b", { text: name || "No one" }), el("span", { class: `pill ${cls}`, text: word })]),
        add ? el("button", { type: "button", class: "cv-add", title: "Send to another agent", "aria-label": "Send to another agent", html: SVG.plus,
          onclick: (ev) => openPicker(line.id, ev.currentTarget.getBoundingClientRect()) }) : null,
        el("button", { type: "button", class: "cv-x", title: "Close", "aria-label": "Close conversation", html: SVG.x, onclick: () => closeConvo() })),
      el("button", { type: "button", class: "cv-about", title: `${g.map((x) => oneLine(words(x), 400)).join("\n")}\n(show ${g.length > 1 ? "them" : "it"} on the page)`, onclick: () => {
        const rs = g.map((x) => rowOf(x.id)).filter(Boolean);
        if (rs[0]) rs[0].scrollIntoView({ block: "center", behavior: "smooth" });
        for (const r of rs) { r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); }
      } }, el("span", { class: "dim", text: "About: " }), about || "(empty)"),
      b.source ? el("div", { class: "cv-src", text: wroteLine(b) }) : "",
      a || canDrop ? el("div", { class: "cv-links" },
        a ? el("button", { type: "button", class: "cv-chat", text: "Open its Chat", onclick: () => ag.actors.show(who).catch((e) => say(e.message, true)) }) : null,
        canDrop ? el("button", { type: "button", class: "cv-drop", text: "Remove from this line", title: `Take the line back from ${name}${["run", "queue", "ask"].includes(s.key) ? ", and tell it to stop" : ""}`,
          onclick: () => drop(b) }) : null) : "");
  }
  const list = box.querySelector(".cv-list");
  const lines = b.to ? threadOf(g) : threadOf(g).map((l) => ({ ...l, verb: "replied" }));
  const ask = b.dropped ? null : askedAll(a, g);
  const listSig = JSON.stringify([g.map((x) => [x.id, x.text]), b.to, b.sent, b.extra, b.to ? 0 : b.source_at, lines.map((l) => [l.id, l.by === "user" ? "" : (actorOf(l.by.slice(6)) || {}).avatar || ""]),
    ask && ask.id, a && a.answerable, ro]);
  if (list.dataset.sig !== listSig) {
    const fresh = list.dataset.sig === undefined, atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.dataset.sig = listSig;
    list.replaceChildren(
      ...(b.sent ? [bubble({ by: "user", at: b.sent,                  // the line(s) as sent, with what the user added
        text: g.map(words).join("<br>") + (b.extra ? `<br><br>${b.extra}` : ""),
        note: g.length > 1 ? `${g.length} lines, as one message` : "" })]
        : b.source ? [bubble({ by: `agent:${b.source}`, at: b.source_at, verb: "wrote", text: g.map(words).join("<br>") })] : []),   // the line(s) as it wrote them
      ...lines.map(bubble),
      ...(ask ? [askCard(a, ask, b, ro)] : []));
    if (fresh || atEnd) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });   // once laid out
  }
  const foot = box.querySelector(".cv-foot");
  let end = foot.querySelector(".cv-end");
  if (!end) { end = el("div", { class: "cv-end" }); foot.prepend(end); }
  drawEnd(end, g, s, ro || !!b.dropped);
  let r = foot.querySelector(".reply");
  const none = ro ? "This page is in the trash." : b.dropped ? `Removed from this line. Send it to ${name} again to continue.`
    : !(b.to || b.source) ? "Not sent to anyone. Send the line to an agent to continue." : "";
  if (!none) {
    if (!r) { r = replyBox(b.id); for (const x of foot.querySelectorAll(".cv-none")) x.remove(); foot.append(r); }
    r.querySelector("input").placeholder = !b.to ? `Follow up with ${name}` : s.key === "review" ? `Tell ${name} what's left` : `Message ${name}`;
  } else {
    if (r) r.remove();
    let x = foot.querySelector(".cv-none");
    if (!x) { x = el("div", { class: "cv-none" }); foot.append(x); }
    if (x.textContent !== none) x.textContent = none;
  }
}
// Above the message box, whether it is done -- the reader's to say: to review, Accept or Cancel (or a message sending
// it back); while it is worked on, the same as quiet links; ended, how, and Reopen.
function drawEnd(end, g, s, ro) {
  const open = g.filter((x) => isWork(x) && !endedOf(x));
  const sig = JSON.stringify([s.key, open.map((x) => x.id), ro, g.map(endedOf)]);
  if (end.dataset.sig === sig) return;
  end.dataset.sig = sig;
  end.replaceChildren();
  if (ro || !g.some(isWork)) return;
  if (!open.length) {
    const e = endedOf(g[g.length - 1]), at = Math.max(...g.map(endedAt));
    end.append(el("div", { class: "cv-ended" }, el("span", { class: `pill ${e === "done" ? "done" : ""}`, text: e === "done" ? "Accepted as done" : "Canceled" }),
      at ? el("span", { class: "dim", text: when(at) }) : null,
      el("button", { type: "button", class: "link", text: "Reopen", onclick: () => reopen(g) })));
    return;
  }
  if (s.key === "review") {
    end.append(el("div", { class: "cv-q", text: open.length > 1 ? `Are these ${open.length} done?` : "Is it done?" }),
      el("div", { class: "cv-acts" },
        el("button", { type: "button", class: "accept big", text: "Accept as done", onclick: () => accept(open) }),
        el("button", { type: "button", class: "plain", text: "Cancel it", onclick: () => cancel(open) })),
      el("div", { class: "cv-hint", text: "Or send it back with what's left:" }));
    return;
  }
  end.append(el("div", { class: "cv-acts quiet" },
    el("button", { type: "button", class: "link", text: "Accept as done", onclick: () => accept(open) }),
    el("button", { type: "button", class: "link", text: "Cancel it", title: "Cancel and tell the agent to stop", onclick: () => cancel(open) })));
}
function bubble(l) {
  const mine = l.by === "user", ch = mine ? "" : l.by.slice(6), a = mine ? null : actorOf(ch);
  return el("div", { class: `msg${mine ? " you" : ""}` },
    mine ? null : face(a, 20),
    el("div", { class: "mb" },
      el("div", { class: "bub", html: withLinks(clean(l.text)) }),
      l.results && l.results.length ? madeRow(l.results) : null,
      el("div", { class: "mm", text: mine ? `You · ${clock(l.at)}${l.note ? ` · ${l.note}` : ""}` : `${nameOf(a, ch)} ${l.verb || "reported"}${l.on ? ` on “${l.on}”` : ""}${l.done ? ", says it's done" : ""} · ${l.verb === "wrote" ? wroteAt(l.at) : clock(l.at)}` })));
}
function replyBox(id) {
  const input = el("input", { type: "text", "aria-label": "Reply", autocomplete: "off" });
  const go = async () => {
    if (!input.value.trim() || input.disabled) return;
    input.disabled = true;
    if (await reply(id, input.value, convo && convo.block === id ? convo.to : null)) input.value = "";
    input.disabled = false;
    input.focus();
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); go(); }
    else if (ev.key === "Escape") { ev.preventDefault(); if (input.value) input.blur(); else closeConvo(); }
  });
  return el("div", { class: "reply" }, input,
    el("button", { type: "button", title: "Send", "aria-label": "Send", html: SVG.send, onclick: go }));
}
// What an actor asks, in the conversation about the block it was sent: answered here, as Chat answers it, where the
// dashboard's terminal
// has the question and nothing was typed there since (`answerable`) -- a permission (allow, deny), or one question
// picked from its options; anything else in its Chat.
function askCard(a, ask, b, ro) {
  const qs = ask.questions || [], one = qs.length === 1 && !qs[0].multiSelect ? qs[0] : null;
  const card = el("div", { class: "ask-card" }, el("div", { class: "ask-hd" }, face(a, 14), el("span", { text: `${nameOf(a, b.to)} asks` })));
  const answer = async (choice, btns) => {
    for (const x of btns) x.disabled = true;
    try { await ag.actors.answer(a.channel, ask.id, choice); say("Answered"); }
    catch (e) { say(`Not answered: ${e.message}`, true); for (const x of btns) x.disabled = false; }
  };
  const can = a.answerable && !ro;
  const acts = el("div", { class: "ask-acts" });
  const btn = (label, choice) => el("button", { type: "button", text: label, onclick: () => answer(choice, acts.querySelectorAll("button")) });
  if (ask.kind === "permission") {
    card.append(el("div", { class: "ask-q", text: `To ${ask.said || `use ${ask.tool || "a tool"}`}` }));
    if (can) acts.append(btn("Allow", { allow: true }), btn("Deny", { allow: false, text: null }));
  } else if (ask.kind !== "plan" && ask.kind !== "dialog" && one) {
    card.append(el("div", { class: "ask-q", text: one.question || "" }));
    if (can) acts.append(...(one.options || []).map((o, j) => btn(o.label || `Option ${j + 1}`, { answers: [{ options: [j] }] })));
  } else {
    card.append(el("div", { class: "ask-q", text: ask.kind === "plan" ? "It has a plan for you to approve."
      : ask.kind === "dialog" ? ask.said || "It asks in its terminal." : `${qs.length} questions` }));
  }
  acts.append(el("button", { type: "button", class: "link", text: ask.kind === "dialog" || !a.answerable ? "Answer in its terminal" : "Answer in Chat",
    onclick: () => ag.actors.show(a.channel).catch((e) => say(e.message, true)) }));
  card.append(acts);
  return card;
}
// Every block of the page shown that was sent to an actor drawn again (how its actor stands changed; time passed).
export function drawSent() {
  if (current === WORK || current === LOG) return drawWorkPage();
  const p = page();
  if (!p) return;
  for (const b of p.blocks) {
    const n = rowOf(b.id);
    if (!n) continue;
    if (b.type === "agents") drawAgentsBlock(n);
    else if (b.type === "work") drawWorkBlock(n);
    else if (isWork(b) || b.source || callsOf(b).length || (b.thread && b.thread.length)) sentPart(n, b, !!p.deleted);
  }
  drawConvo();
}
