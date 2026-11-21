// Notes: a line sent to an actor -- alone, or with others as one message; a reply about it; an agent taken off
// it; and what the line shows of it, at its end.
import { el, esc, now, oneLine, plainOf, rid, short, SVG } from "./helpers.js";
import { ag, convo, store } from "./state.js";
import { pagesAsMd } from "./model.js";
import { change, flushTyped, pump } from "./send.js";
import { drawPage, foldedNow, page } from "./page.js";
import { mdLines, sendable, unpick } from "./picked.js";
import { tableMd } from "./tables.js";
import { accept, actorOf, askedAll, callsOf, callTo, endedOf, face, findLine, groupStands, isWork, itemSaid,
  lineStands, nameOf, onIt, pageOf, redraw, say, sentWith, threadOf, viewFor, viewsOf, withCall } from "./actors.js";
import { askLine, followUpText, linesOf, sourcePart } from "./source.js";
import { openConvo, toggleConvo } from "./convo.js";
import { openPicker } from "./picker.js";

export const outgoing = new Set();                       // blocks being sent now
const quiet = new Set();                                 // ... with others, not the last of them: no status of its own
// A block's words sent to an actor, as the user's message: an actor there (`channel`; "gatherer", its gatherer agent),
// or a new one (`harness`, `folder`), with what the user added (`extra`: instructions beyond the line). The block then
// says it went to that one too, and with what (a call of its own: sent to it before, the call to it now). The note at
// its start says where it is from (the Notes app's [asked] reads it back: first, so a message the list cuts short keeps
// it) and asks for a report on it, if the reader wants one.
async function sendBlock(id, who, extra = "") {
  flushTyped();
  pump();
  const f = findLine(id), p = f && f.p, b = f && f.b;
  if (!p || !b) return;
  const words = plainOf(b.type === "code" ? esc(b.text) : pagesAsMd(b.text)).trim();
  if (!words) return say("Nothing to send", true);
  const report = store.get("report", true);
  extra = extra.trim();
  const text = `(From my Notes, page ${JSON.stringify(p.title || "Untitled")}, block ${b.id}.${alsoWith([b], who)}`
    + `${report ? " When you're done, report back with notes_report, in one to three lines." : ""})`
    + `\n\n${words}${extra ? `\n\n${extra}` : ""}`;
  outgoing.add(id);
  drawPage();
  try {
    const got = who.harness ? await ag.actors.start({ harness: who.harness, folder: who.folder, text })
      : await ag.actors.send(who.channel, text);
    const line = (findLine(id) || {}).b || b, call = { to: got.channel, sent: now(), ...(extra ? { extra: esc(extra).replace(/\n/g, "<br>") } : {}) };
    change([{ op: "block.put", page: p.id, block: { id, calls: withCall(line, call, who.channel), work: true, ended: "" } }], false);
    say(`Sent to ${nameOf(actorOf(got.channel), who.channel || got.channel)}${who.harness ? ", a new actor" : ""}`);
  } catch (e) {
    say(`Not sent: ${e.message}`, true);
  } finally {
    outgoing.delete(id);
    drawPage();
  }
}
// Several lines sent together, as one message: the note names each line (in the order they follow it) and asks for a
// report on each; the lines as markdown, then what the user added. Each line then says it went to that one, as one sent
// alone, and the `group` its calls to it share (`sentWith` finds them by it).
async function sendBlocks(ids, who, extra = "") {
  flushTyped();
  pump();
  const p = page();
  if (!p) return;
  const all = p.blocks.filter((b) => ids.includes(b.id)), bs = sendable(all), tables = all.filter((b) => b.type === "table");
  if (bs.length < 2) {                                   // (a table picked with one line: it goes along, with what the user added)
    const more = [...tables.map((t) => tableMd(t).join("\n")), extra.trim()].filter(Boolean).join("\n\n");
    return bs.length ? sendBlock(bs[0].id, who, more) : say("Nothing to send", true);
  }
  const report = store.get("report", true);
  extra = extra.trim();
  const text = `(From my Notes, page ${JSON.stringify(p.title || "Untitled")}, blocks ${bs.map((b) => b.id).join(", ")}: the lines below, in that order${tables.length ? ", the tables among them there to read" : ""}.${alsoWith(bs, who)}`
    + `${report ? " When you're done, report back on each with notes_report, in one to three lines." : ""})`
    + `\n\n${mdLines(all.filter((b) => bs.includes(b) || b.type === "table")).join("\n")}${extra ? `\n\n${extra}` : ""}`;
  for (const b of bs) { outgoing.add(b.id); if (b !== bs[bs.length - 1]) quiet.add(b.id); }
  drawPage();
  try {
    const got = who.harness ? await ag.actors.start({ harness: who.harness, folder: who.folder, text })
      : await ag.actors.send(who.channel, text);
    const at = now(), more = esc(extra).replace(/\n/g, "<br>"), group = rid();
    change(bs.map((b) => {
      const line = (findLine(b.id) || {}).b || b, call = { to: got.channel, sent: at, ...(more ? { extra: more } : {}), group };
      return { op: "block.put", page: p.id, block: { id: b.id, calls: withCall(line, call, who.channel), work: true, ended: "" } };
    }), false);
    unpick();
    say(`Sent ${bs.length} lines to ${nameOf(actorOf(got.channel), who.channel || got.channel)}${who.harness ? ", a new actor" : ""}`);
  } catch (e) {
    say(`Not sent: ${e.message}`, true);
  } finally {
    for (const b of bs) { outgoing.delete(b.id); quiet.delete(b.id); }
    drawPage();
  }
}
export const sendTo = (ids, who, extra) => (ids.length > 1 ? sendBlocks(ids, who, extra) : sendBlock(ids[0], who, extra));
// Lines sent to an agent while others are on them: the note says so, and that this message is the one's it goes to --
// else an agent of this gatherer, shown the other's message as a request made to another session in parallel, takes
// its own, the same words, for that one too, and leaves it. (No ")" in it: the [asked] pattern reads the note to its end.)
function alsoWith(bs, who) {
  const others = [...new Set(bs.flatMap((b) => onIt(b).filter((c) => !(who.channel && callTo(c, who.channel))).map((c) => short(c.to))))];
  if (!others.length) return "";
  const them = `${others.length > 1 ? "actors" : "actor"} ${others.join(", ")}`;
  return bs.length > 1 ? ` Some of them went to ${them} too; this message is for you.` : ` I sent this line to ${them} too; this message is for you.`;
}
// A reply on a block sent to an actor (`to`: which of its agents): sent to that actor, then a line of the block's
// thread, saying it went to that one. On lines sent together, about them all, and kept on the last of them.
export async function reply(id, words, to = null) {
  const f = findLine(id), p = f && f.p, b = f && ((to && viewFor(f.b, to)) || f.b);
  words = words.trim();
  if (!p || !b || !(b.to || b.source) || b.dropped || !words) return false;
  const g = linesOf(b);
  const text = b.to ? `(A reply in my Notes, page ${JSON.stringify(p.title || "Untitled")}, ${g.length > 1 ? `blocks ${g.map((x) => x.id).join(", ")}` : `block ${b.id}`}.`
    + ` Report back with notes_report when you're done.)\n\n${words}` : followUpText(p, g, words);
  try {
    await ag.actors.send(b.to || b.source, text);
  } catch (e) {
    say(`Not sent: ${e.message}`, true);
    return false;
  }
  change([{ op: "thread.add", page: p.id, block: id, line: { id: rid(), by: "user", ...(b.to ? { to: b.to } : {}), text: esc(words).replace(/\n/g, "<br>"), at: now() } }]);
  redraw();
  return true;
}
// One of a line's agents taken off it (`v`, its view): its call kept, `dropped` -- what was said stays, its reports on
// the line refused since -- on the lines sent to it with this one as one message too, which show as one; and the
// agent, if it is on them or yet to take them up, told to leave them, as a cancel tells it. Taken off every agent, a
// line is still a work item: sent to no one now (send it again, and the call is that agent's again).
export async function drop(v) {
  const g = sentWith(v), s = groupStands(g), p = pageOf(v), name = nameOf(actorOf(v.to), v.to);
  if (!p || v.dropped) return;
  const at = now();
  change(g.map((x) => (findLine(x.id) || {}).b).filter(Boolean).map((line) => ({ op: "block.put", page: p.id,
    block: { id: line.id, calls: callsOf(line).map((c) => (c.to === v.to && !c.dropped ? { ...c, dropped: at } : c)), work: true } })), false);
  redraw();
  if (["run", "queue", "ask"].includes(s.key) && s.word !== "Agent gone") {
    const many = g.length > 1, it = many ? "them" : "it";
    const text = `(From my Notes, page ${JSON.stringify(p.title || "Untitled")}, ${many ? `blocks ${g.map((x) => x.id).join(", ")}` : `block ${v.id}`}.`
      + ` The user took ${many ? "these lines" : "this line"} back from you: stop any work on ${it}, and don't report on ${it}.)`
      + `\n\nTaken back: ${g.map((x) => oneLine(x.type === "code" ? esc(x.text) : x.text, 200)).join("; ")}`;
    try { await ag.actors.send(v.to, text); } catch (e) { return say(`Removed ${name}, but couldn't tell it to stop: ${e.message}`, true); }
  }
  say(`Removed ${name} from ${g.length > 1 ? `these ${g.length} lines` : "this line"}`);
}
// What a block sent to agents shows under its words, at the line's end: each agent it is with now (its avatar) and how
// the line stands with that one (its chip -- the agent's name and its latest report, or what it asks, on hover -- which
// opens their conversation beside the page); "Answer" while one asks the reader about it, "Accept" while it is to
// review; a button that opens the conversation about it (how many messages); and, on hover, one that sends it to
// another agent too. An agent it went to with other lines, as one message, shows once, at the last of them. Sent to no
// one now: how it stands, as one. Neither a conversation nor a preview of one is on the page.
export function sentPart(n, b, ro) {
  n.classList.remove("has-src");
  if (!isWork(b) && b.source && !outgoing.has(b.id)) return sourcePart(n, b, ro);   // written by an agent: who, not a status
  let part = n.querySelector(":scope > .sent");
  const tailOf = (g) => [...g].reverse().find((x) => !foldedNow.has(x.id)) || g[g.length - 1];   // sent with others: shown at the last of them shown
  const groups = viewsOf(b).map((v) => ({ v, g: sentWith(v) }));
  const open = !!convo && (convo.block === b.id || groups.some(({ v, g }) => v.to === convo.to && g.some((x) => x.id === convo.block)));
  n.classList.toggle("convo-on", open && (isWork(b) || groups.length > 0 || !!(b.thread && b.thread.length)));
  const here = groups.filter(({ g }) => tailOf(g).id === b.id), on = here.filter(({ v }) => !v.dropped);
  const sending = outgoing.has(b.id) && !quiet.has(b.id), none = !onIt(b).length;
  if (!(on.length || sending || (none && !quiet.has(b.id) && (isWork(b) || here.length || (b.thread && b.thread.length))))) { if (part) part.remove(); return; }
  if (!part) { part = el("div", { class: "sent", contenteditable: "false" }); n.append(part); }
  const items = on.map(({ v, g }) => {
    const a = actorOf(v.to), s = groupStands(g), asks = !!askedAll(a, g);
    const latest = [...threadOf(g)].reverse().find((l) => l.by !== "user");
    const said = asks ? `Asks: ${askLine(a.asking)}` : g.length > 1 ? (latest ? oneLine(latest.text, 240) : "") : itemSaid(v, s);
    const told = `${nameOf(a, v.to)}: ${s.word}${g.length > 1 ? ` (${g.length} lines sent together)` : ""}${said ? `\n${said}` : ""}`;   // on hover, not on the page
    return { v, g, a, s, asks, told, open: open && convo.to === v.to };
  });
  const alone = none && !sending ? (isWork(b) ? lineStands(b) : { key: "none", cls: "idle", word: "Not sent to anyone" }) : null;
  const first = ["ask", "run", "review", "queue"].map((k) => items.find((x) => x.s.key === k)).find(Boolean) || items[0] || null;
  const ended = items.length > 1 && endedOf(b) ? items[0].s : null;   // ended: how, once, with every agent's avatar
  const review = !ro && !!first && first.s.key === "review";
  const asking = items.find((x) => x.asks && !x.open);
  const count = here.reduce((k, { v, g }) => k + (v.sent ? 1 : 0) + g.reduce((j, x) => j + (x.thread || []).length, 0), 0)
    + (none && !here.length ? (b.thread || []).length : 0);
  const talks = count > 0 && !(sending && !items.length), add = !ro && items.length > 0 && !sending;
  const sig = JSON.stringify([items.map((x) => [x.v.to, x.s.cls, x.s.word, x.a && x.a.avatar, x.told, x.open, x.g.length]), alone, sending,
    count, !!asking, open, ro, review, talks, add, !!ended]);
  if (part.dataset.sig === sig) return;
  part.dataset.sig = sig;
  const chip = (x) => el("button", { type: "button", class: `chip ${x.s.cls}`, title: `${x.told}\n(${x.open ? "close" : "open"} the conversation)`,
    "aria-label": x.told, onclick: () => toggleConvo(tailOf(x.g).id, x.v.to) }, face(x.a, 16), el("span", { text: x.s.word }));
  const talkTo = (asking || first || {}).v;
  part.replaceChildren(...[                              // (the slots left empty: none drawn, not "null")
    ...(ended ? [el("button", { type: "button", class: `chip ${ended.cls}`, title: `${items.map((x) => x.told).join("\n")}\n(${open ? "close" : "open"} the conversation)`,
      "aria-label": items.map((x) => x.told).join("\n"), onclick: () => toggleConvo(b.id) }, ...items.map((x) => face(x.a, 16)), el("span", { text: ended.word }))]
      : items.map(chip)),
    alone ? el("span", { class: `chip ${alone.cls}`, title: alone.word, "aria-label": alone.word }, el("span", { text: alone.word })) : null,
    sending ? el("span", { class: "chip work", title: "Sending…", "aria-label": "Sending…" }, el("span", { text: "Sending…" })) : null,
    review ? el("button", { type: "button", class: "accept", text: "Accept", title: "Accept as done",
      onclick: () => accept([...new Map(items.flatMap((x) => x.g).map((x) => [x.id, x])).values()]) }) : null,
    !talks ? null : asking ? el("button", { type: "button", class: "talk answer", text: "Answer", onclick: () => openConvo(b.id, asking.v.to) })
      : el("button", { type: "button", class: `talk${open ? " on" : ""}`, title: open ? "Close conversation" : "Open conversation",
        "aria-label": `${open ? "Close" : "Open"} conversation (${count} message${count === 1 ? "" : "s"})`, onclick: () => toggleConvo(b.id, open ? undefined : talkTo && talkTo.to) },
        el("span", { html: SVG.bubble }), el("span", { text: String(count) })),
    add ? el("button", { type: "button", class: "add-agent", title: "Send to another agent", "aria-label": "Send to another agent", html: SVG.plus,
      onclick: (ev) => openPicker(b.id, ev.currentTarget.getBoundingClientRect()) }) : null].filter(Boolean));
}
