// Notes: lines an agent wrote from its conversation.
// Lines an agent wrote from its own conversation with the user (`source`, `source_at`: notes_add or notes_change with
// from_conversation) name it, once, at the end of the last of them: its avatar -- who wrote them and when, on hover,
// and how it stands while it is on a follow-up about them -- which opens the conversation about them beside the page,
// where the user follows up with it (`reply`). They were not sent to it: no status of their own, and no work for it
// until the user asks.
import { el, SVG } from "./helpers.js";
import { convo } from "./state.js";
import { page } from "./page.js";
import { mdLines } from "./picked.js";
import { actorOf, askedAll, face, linesOn, nameOf, sentWith, stands } from "./actors.js";
import { openConvo, toggleConvo } from "./convo.js";

function writtenWith(b) {
  const p = page();
  if (!p || !b.source) return [b];
  const g = p.blocks.filter((x) => x.source === b.source && x.source_at === b.source_at);
  return g.includes(b) ? g : [b];
}
// the lines a block shows with: those sent with it (to an actor), else those written with it (by one), else itself
export const linesOf = (b) => (b.to ? sentWith(b) : b.source ? writtenWith(b) : [b]);
export const wroteAt = (t) => new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// how the agent that wrote lines stands with them: on a follow-up about them (working, needs you, error), else no word
function standsSrc(a, g) {
  const [cls, word] = stands(a);                         // (one no longer here: its avatar alone, as one idle)
  return (cls === "work" || cls === "ask" || cls === "bad") && g.some((x) => linesOn(a).includes(x.id)) ? [cls, word] : ["src", ""];
}
// ... said in the conversation's head
export const srcStands = (a, g) => { const [cls, word] = standsSrc(a, g); return { key: "source", ...(!a ? { cls: "gone", word: "Gone" } : cls === "src" ? { cls: "idle", word: "Wrote this" } : { cls, word }) }; };
export const wroteLine = (b) => `Written from your conversation with ${nameOf(actorOf(b.source), b.source)} · ${wroteAt(b.source_at)}`;
// A follow-up on lines an agent wrote: to that agent, as the user's message -- the note first (the Notes app's [asked]
// reads it back), naming the lines and when it wrote them, then the lines, then what the user asks.
export function followUpText(p, g, words) {
  const many = g.length > 1;
  return `(A reply in my Notes, page ${JSON.stringify(p.title || "Untitled")}, ${many ? `blocks ${g.map((x) => x.id).join(", ")}` : `block ${g[0].id}`}:`
    + ` about ${many ? "lines" : "a line"} you wrote there on ${wroteAt(g[0].source_at)}, from our conversation.`
    + ` Answer as always, then put one to three lines beside ${many ? "them" : "it"} with notes_report${many ? `, one report, on block ${g[g.length - 1].id}` : ""}.)`
    + `\n\n${mdLines(g).join("\n")}\n\n${words}`;
}
export function sourcePart(n, b, ro) {
  let part = n.querySelector(":scope > .sent");
  const g = writtenWith(b), tail = g[g.length - 1];     // written with others: shown once, at the last of them
  const open = !!convo && g.some((x) => x.id === convo.block);
  n.classList.toggle("convo-on", open);
  if (b !== tail) { if (part) part.remove(); return; }
  n.classList.add("has-src");                           // (its Ask button would cover the avatar: @ or its menu sends it)
  if (!part) { part = el("div", { class: "sent" }); n.append(part); }
  const a = actorOf(b.source), name = nameOf(a, b.source);
  const [cls, word] = standsSrc(a, g);
  const asks = !!askedAll(a, g);
  const count = g.reduce((k, x) => k + (x.thread || []).length, 0);
  const sig = JSON.stringify(["src", cls, word, name, a && a.avatar, count, asks, open, ro, g.length, b.source_at]);
  if (part.dataset.sig === sig) return;
  part.dataset.sig = sig;
  const talk = () => toggleConvo(b.id);
  const told = `Written by ${name} from your conversation · ${wroteAt(b.source_at)}${g.length > 1 ? ` (${g.length} lines)` : ""}${word ? `\n${name}: ${word}` : ""}`;
  const kids = [el("button", { type: "button", class: `chip ${cls}`, title: `${told}\n(${open ? "close the conversation" : "follow up with it"})`,
    "aria-label": told, onclick: talk }, face(a, 16), word ? el("span", { text: word }) : null)];
  if (asks && !open) kids.push(el("button", { type: "button", class: "talk answer", text: "Answer", onclick: () => openConvo(b.id) }));
  else if (count) kids.push(el("button", { type: "button", class: `talk${open ? " on" : ""}`, title: open ? "Close conversation" : "Open conversation",
    "aria-label": `${open ? "Close" : "Open"} conversation (${count} message${count === 1 ? "" : "s"})`, onclick: talk },
    el("span", { html: SVG.bubble }), el("span", { text: String(count) })));
  part.replaceChildren(...kids);
}

// what an actor asks, in a line
export function askLine(ask) {
  const q = ask.questions && ask.questions[0];
  return ask.kind === "permission" ? `to ${ask.said || `use ${ask.tool || "a tool"}`}`
    : ask.kind === "plan" ? "approve its plan" : ask.kind === "dialog" ? ask.said || "a question in its terminal"
    : q ? q.question || "a question" : "a question";
}
