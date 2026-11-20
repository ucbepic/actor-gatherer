// Notes: the Agents page, and an agents block.
// Every actor of the gatherer: how it stands, the blocks sent to it (newest first), and its last report -- else its
// recap. Needing the user first, then at work, then by when last active. Saved and closed ones as the reader picks.
import { $, AGENTS, clock, el, oneLine, SVG } from "./helpers.js";
import { ag, current, store } from "./state.js";
import { live } from "./model.js";
import { openPage, rowOf } from "./page.js";
import { actorOf, crew, face, isLead, nameOf, onIt, say, stands } from "./actors.js";
import { drawSent } from "./convo.js";

function agentsTable(showSaved, showClosed) {
  const sent = new Map(), last = new Map();
  for (const p of live()) for (const b of p.blocks) {
    for (const c of onIt(b)) {
      const a = actorOf(c.to);
      if (a) { if (!sent.has(a.channel)) sent.set(a.channel, []); sent.get(a.channel).push({ p, b, at: c.sent || 0 }); }
    }
    for (const l of b.thread || []) {
      if (l.by === "user") continue;
      const who = actorOf(l.by.slice(6));
      if (who && (!last.has(who.channel) || last.get(who.channel).at <= l.at)) last.set(who.channel, l);
    }
  }
  const rank = (a) => ({ ask: 0, work: 1, bad: 2 })[stands(a)[0]] ?? 3;
  const rows = crew.agents.filter((a) => isLead(a) || (a.saved ? showSaved : (a.status || [])[0] === "closed" ? showClosed : true))
    .sort((x, y) => rank(x) - rank(y) || (y.last || 0) - (x.last || 0));
  if (!rows.length) return el("div", { class: "agt-none", text: crew.agents.length ? "No actors to show. Check Saved or Closed to see them."
    : "No actors in this group yet. Type @ in a line to send it to a new one." });
  const go = (p, b) => { openPage(p.id); requestAnimationFrame(() => { const r = rowOf(b.id); if (r) { r.scrollIntoView({ block: "center" }); r.classList.add("flash"); } }); };
  const tr = (a) => {
    const [cls, word] = stands(a);
    const mine = (sent.get(a.channel) || []).sort((x, y) => y.at - x.at);
    const l = last.get(a.channel);
    return el("tr", { class: cls === "ask" ? "asks" : null },
      el("td", {}, el("button", { type: "button", class: "who-btn", title: `Open ${nameOf(a)}'s Chat`,
        onclick: () => ag.actors.show(a.channel).catch((e) => say(e.message, true)) }, face(a, 20), el("b", { text: nameOf(a) }))),
      el("td", {}, el("span", { class: `pill ${cls}`, text: word })),
      el("td", { class: "from" }, ...(mine.length ? mine.slice(0, 2).map(({ p, b }) => el("button", { type: "button", class: `blk-link${b.type === "todo" && b.checked ? " done" : ""}`,
        title: `On “${p.title || "Untitled"}”`, onclick: () => go(p, b), text: oneLine(b.text, 70) || "(empty)" })) : [el("span", { class: "dim", text: "—" })]),
        mine.length > 2 ? el("span", { class: "dim", text: `+${mine.length - 2} more` }) : null),
      el("td", { class: "said" }, l ? el("span", {}, oneLine(l.text, 160), el("span", { class: "dim", text: ` · ${clock(l.at)}` }))
        : cls === "ask" && a.asking ? el("span", {}, `Asks: ${(a.asking.questions && a.asking.questions[0] && a.asking.questions[0].question) || a.asking.said || "something"}`)
        : a.recap ? el("span", { class: "dim" }, `Recap: ${a.recap.text}`) : el("span", { class: "dim", text: "—" })));
  };
  return el("div", { class: "tbl-wrap" }, el("table", { class: "agt-tbl" },
    el("thead", {}, el("tr", {}, ...["Agent", "Status", "From your notes", "Last report"].map((t) => el("th", { scope: "col", text: t })))),
    el("tbody", {}, ...rows.map(tr))));
}
function shows() {
  const box = (k, label) => el("label", {}, el("input", { type: "checkbox", checked: store.get(k, k === "saved") ? true : null,
    onchange: (ev) => { store.set(k, ev.target.checked); if (current === AGENTS) drawAgentsPage(); else drawSent(); } }), label);
  return el("div", { class: "agt-show" }, el("span", { text: "Show:" }), box("saved", "Saved"), box("closed", "Closed"));
}
export function drawAgentsPage() {
  const needs = crew.agents.filter((a) => stands(a)[0] === "ask").length;
  $("agents-page").replaceChildren(
    el("h1", { class: "pg-title", text: "Agents" }),
    el("p", { class: "agt-sub", text: `Actors in ${ag.gatherer}, what you sent them from your notes, and their last reports.${needs ? ` ${needs} need${needs === 1 ? "s" : ""} you.` : ""}` }),
    agentsTable(store.get("saved", true), store.get("closed", false)), shows(),
    el("p", { class: "agt-sub dim", text: "Type /agents on any page to add this table." }));
}
export function drawAgentsBlock(n) {
  const box = n.querySelector(".agt");
  if (!box) return;
  box.replaceChildren(el("div", { class: "agt-hd" }, el("span", { html: SVG.people }), el("span", { text: "Agents" })),
    agentsTable(store.get("saved", true), store.get("closed", false)));
}
export function agentsEntry() {
  const needs = crew.agents.filter((a) => stands(a)[0] === "ask").length;
  return el("div", { class: `pg-row agents-row${current === AGENTS ? " on" : ""}`, role: "treeitem", "aria-selected": String(current === AGENTS),
    onclick: () => openPage(AGENTS) },
    el("span", { class: "caret none" }), el("span", { class: "ic", html: SVG.people }), el("span", { class: "nm", text: "Agents" }),
    needs ? el("span", { class: "needs", title: `${needs} waiting for you`, text: `${needs} need${needs === 1 ? "s" : ""} you` }) : null);
}
