// Notes: the Work page, the Logbook, and a work block.
// Every open work item of the notebook by how it stands -- needs you, to review, working, queued, not started -- and
// those accepted in the last week (folded); each with its agent, page, latest report and what it made, and what the
// reader may do with it. The Logbook: every ended one, by the day it was ended. A work block: the open ones, on a page.
import { $, clock, el, esc, LOG, now, oneLine, SVG, WORK } from "./helpers.js";
import { current, store } from "./state.js";
import { live } from "./model.js";
import { foldOf, openPage, rowOf, showDone } from "./page.js";
import { accept, actorOf, ago, callsOf, cancel, endedAt, face, isWork, itemSaid, lastSent, lineStands, madeOf, madeRow,
  markWork, nameOf, onIt, reopen, viewsOn, when } from "./actors.js";
import { openConvo } from "./convo.js";
import { openPicker } from "./picker.js";

const GROUPS = [
  { key: "ask", name: "Needs you", hint: "The agent is waiting for you" },
  { key: "review", name: "To review", hint: "The agent stopped. Accept it or send it back." },
  { key: "run", name: "Working", hint: "An agent is working on it" },
  { key: "queue", name: "Queued", hint: "Starts after the agent's current work" },
  { key: "new", name: "Not started", hint: "Not sent to an agent yet" },
  { key: "done", name: "Done", hint: "Accepted in the last 7 days" },
];
const WEEK = 7 * 86400;
function workItems() {
  const out = [];
  for (const p of live()) for (const b of p.blocks) if (isWork(b)) out.push({ p, b, s: lineStands(b) });
  return out;
}
const isOpen = (x) => x.s.key !== "done" && x.s.key !== "canceled";
const forYou = () => workItems().filter((x) => x.s.key === "ask" || x.s.key === "review").length;
const wordsOf = (b) => oneLine(b.type === "code" ? esc(b.text) : b.text, 160) || "(empty)";
// A work item shown on its page: the page opened (its ended lines shown, if it is one of them), the line flashed --
// and its conversation opened (with the agent `to`, else the one most pressing), if asked for and it has one.
function goLine(p, b, talk = false, to = null) {
  if (foldOf(p).has(b.id)) showDone(p.id, true);
  openPage(p.id);
  if (talk && (callsOf(b).length || (b.thread && b.thread.length))) openConvo(b.id, to);
  requestAnimationFrame(() => {
    const r = rowOf(b.id);
    if (r) { r.scrollIntoView({ block: "center" }); r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); }
  });
}
// the agents a work item is with now, by name
const namesOf = (b) => onIt(b).map((c) => nameOf(actorOf(c.to), c.to)).join(", ");
function workRow({ p, b, s }, compact = false) {
  const v = s.v || viewsOn(b)[0] || null, a = v ? actorOf(v.to) : null, done = s.key === "done";   // (with several: the one its status is from)
  const said = done || s.key === "new" ? "" : itemSaid(b, s), made = done ? [] : madeOf(b);   // (not started: its meta says "No one yet")
  const latest = [...((v || b).thread || [])].reverse().find((l) => l.by !== "user");
  const time = done ? `accepted ${when(endedAt(b))}` : s.key === "review" && latest && (latest.at || 0) >= lastSent(v || b) ? `reported ${ago(latest.at)}`
    : v && s.key !== "run" ? `sent ${ago(lastSent(v))}` : "";
  const btn = (label, cls, run, title) => el("button", { type: "button", class: `wk-btn${cls ? ` ${cls}` : ""}`, text: label, title: title || null, onclick: run });
  const pick = (ev) => openPicker(b.id, ev.currentTarget.getBoundingClientRect());
  const acts = s.key === "ask" ? (s.word === "Agent gone" ? [btn("Cancel", "", () => cancel([b])), btn("Send to…", "primary", pick)]
    : [btn("Answer", "answer", () => goLine(p, b, true, v && v.to), "Open the conversation")])
    : s.key === "review" ? [btn("Send back", "", () => goLine(p, b, true, v && v.to), "Open the conversation to say what's left"), btn("Accept", "accept", () => accept([b]), "Accept as done")]
    : s.key === "run" || s.key === "queue" ? [btn("Cancel", "", () => cancel([b]), "Cancel and tell the agent to stop")]
    : s.key === "new" ? [btn("Remove", "", () => markWork([b], false), "Remove from work items. The line stays on its page."),     // (done without an agent: ended here)
      btn("Cancel", "", () => cancel([b]), "Cancel and move to the Logbook"), btn("Done", "accept", () => accept([b]), "Mark as done without an agent"),
      btn("Assign", "primary", pick, "Send to an agent")]
    : [btn("Reopen", "", () => reopen([b]))];
  const pill = compact || s.key === "run" || s.key === "ask" || s.word === "Sent";
  return el("div", { class: `wk-row ${s.key}`, "data-id": b.id },
    v ? face(a, compact ? 18 : 22) : el("span", { class: "face dash", style: `width:${compact ? 18 : 22}px;height:${compact ? 18 : 22}px`, "aria-hidden": "true" }),
    el("div", { class: "wk-main" },
      el("button", { type: "button", class: "wk-text", title: "Show on its page", onclick: () => goLine(p, b, !done && s.key !== "new", v && v.to) }, wordsOf(b)),
      el("div", { class: "wk-meta" }, pill ? el("span", { class: `pill ${s.cls}`, text: s.word }) : null,
        el("span", { text: [namesOf(b) || "No one yet", p.title || "Untitled", time].filter(Boolean).join(" · ") })),
      said && !compact ? el("div", { class: "wk-said", text: said }) : null,
      made.length && !compact ? madeRow(made) : null),
    el("div", { class: "wk-acts" }, ...acts));
}
export function drawWorkPage() {
  const box = $("work-page");
  if (current === LOG) return drawLogbook(box);
  const items = workItems(), open = items.filter(isOpen), on = new Set(open.map((x) => x.p.id)).size;
  const doneOpen = store.get("workDone", false);
  const sections = GROUPS.map((g) => {
    let its = items.filter((x) => x.s.key === g.key);
    if (g.key === "done") its = its.filter((x) => now() - endedAt(x.b) < WEEK).sort((x, y) => endedAt(y.b) - endedAt(x.b));
    else if (g.key !== "new") its.sort((x, y) => lastSent(x.b) - lastSent(y.b));   // oldest first: waited longest
    if (!its.length) return null;
    const folded = g.key === "done" && !doneOpen;
    return el("section", { class: `wk-group ${g.key}`, "aria-label": g.name },
      el("div", { class: "wk-hd" }, el("h2", { text: g.name }), el("span", { class: `wk-n ${g.key}`, text: String(its.length) }),
        el("span", { class: "wk-hint", text: g.hint }),
        g.key === "done" ? el("button", { type: "button", class: "wk-fold", "aria-expanded": String(!folded), text: folded ? "Show" : "Hide",
          onclick: () => { store.set("workDone", folded); drawWorkPage(); } }) : null),
      folded ? null : el("div", { class: "wk-list" }, ...its.map((x) => workRow(x))));
  }).filter(Boolean);
  box.replaceChildren(
    el("h1", { class: "pg-title", text: "Work" }),
    el("p", { class: "agt-sub", text: open.length ? `${open.length} open across ${on} page${on === 1 ? "" : "s"}.` : "Nothing open." }),
    ...(sections.length ? sections : [el("div", { class: "wk-none", text: "No work items yet. Send a line to an agent with @, or mark one from its ⋮⋮ menu." })]),
    el("p", { class: "agt-sub dim" }, "Older finished items are in the ", el("button", { type: "button", class: "link", text: "Logbook", onclick: () => openPage(LOG) }),
      ". Type /work on any page to list open items there."));
}
const dayOf = (t) => {
  const d = new Date(t * 1000), y = new Date(Date.now() - 86400000);
  return d.toDateString() === new Date().toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday"
    : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
};
function drawLogbook(box) {
  const items = workItems().filter((x) => !isOpen(x)).sort((x, y) => endedAt(y.b) - endedAt(x.b)).slice(0, 300);
  const days = [];
  for (const x of items) {
    const d = dayOf(endedAt(x.b));
    if (!days.length || days[days.length - 1].d !== d) days.push({ d, items: [] });
    days[days.length - 1].items.push(x);
  }
  box.replaceChildren(
    el("h1", { class: "pg-title", text: "Logbook" }),
    el("p", { class: "agt-sub", text: "Work items you accepted or canceled, newest first. They stay on their pages." }),
    ...(days.length ? days.map(({ d, items: its }) => el("section", { class: "lg-day", "aria-label": d }, el("h2", { text: d }),
      el("div", { class: "lg-list" }, ...its.map(logRow))))
      : [el("div", { class: "wk-none", text: "Nothing done or canceled yet." })]));
}
function logRow({ p, b, s }) {
  const done = s.key === "done", made = madeOf(b);
  return el("div", { class: `lg-row${done ? "" : " canceled"}`, "data-id": b.id },
    el("span", { class: "lg-mk", role: "img", "aria-label": done ? "Done" : "Canceled", html: done ? SVG.check : SVG.x }),
    el("div", { class: "wk-main" },
      el("div", { class: "wk-text", text: wordsOf(b) }),
      el("div", { class: "wk-meta" }, el("span", { text: [namesOf(b) || "No agent", p.title || "Untitled", `${done ? "accepted" : "canceled"} ${clock(endedAt(b))}`].join(" · ") })),
      made.length ? madeRow(made) : null),
    el("div", { class: "wk-acts" },
      el("button", { type: "button", class: "wk-btn link", text: "Show line", onclick: () => goLine(p, b) }),
      el("button", { type: "button", class: "wk-btn", text: "Reopen", onclick: () => reopen([b]) })));
}
export function drawWorkBlock(n) {
  const box = n.querySelector(".wkb");
  if (!box) return;
  const keys = GROUPS.map((g) => g.key), items = workItems().filter(isOpen).sort((x, y) => keys.indexOf(x.s.key) - keys.indexOf(y.s.key));
  box.replaceChildren(el("div", { class: "agt-hd" }, el("span", { html: SVG.work }), el("span", { text: `Work items · ${items.length} open` }),
    el("button", { type: "button", class: "wk-go", text: "Open the Work page", onclick: () => openPage(WORK) })),
    items.length ? el("div", { class: "wk-list compact" }, ...items.map((x) => workRow(x, true))) : el("div", { class: "agt-none", text: "Nothing open." }));
}
export function workEntry() {
  const n = forYou();
  return el("div", { class: `pg-row spec-row${current === WORK ? " on" : ""}`, role: "treeitem", "aria-selected": String(current === WORK), onclick: () => openPage(WORK) },
    el("span", { class: "caret none" }), el("span", { class: "ic", html: SVG.work }), el("span", { class: "nm", text: "Work" }),
    n ? el("span", { class: "needs", title: `${n} waiting for your answer or review`, text: `${n} for you` }) : null);
}
export function logEntry() {
  return el("div", { class: `pg-row spec-row${current === LOG ? " on" : ""}`, role: "treeitem", "aria-selected": String(current === LOG), onclick: () => openPage(LOG) },
    el("span", { class: "caret none" }), el("span", { class: "ic", html: SVG.log }), el("span", { class: "nm", text: "Logbook" }));
}
