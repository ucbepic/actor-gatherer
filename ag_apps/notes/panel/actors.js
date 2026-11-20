// Notes: the gatherer's actors (ag.actors), to send lines to -- who they are and how they stand; whom a line
// went to (its calls) and how a work item stands with each; work items ended, opened again or marked; and what the
// bar says.
import { $, AGENTS, clock, DASH, el, esc, now, oneLine, short, since, UNSENT } from "./helpers.js";
import { ag, current, ready, sayTimer, setSayTimer } from "./state.js";
import { live } from "./model.js";
import { change } from "./send.js";
import { drawSide } from "./sidebar.js";
import { drawPage } from "./page.js";
import { menu } from "./popups.js";
import { askLine } from "./source.js";
import { drawSent } from "./convo.js";
import { drawAt } from "./picker.js";
import { drawAgentsPage } from "./agents.js";

export let crew = { agents: [], harnesses: [], start: "", home: "" };
let crewSig = "", crewKnown = false;                    // (not yet: an actor not found is not known gone)
export function takeActors(all) {
  if (all) crewKnown = true;
  const g = all && (all.gatherers || []).find((x) => x.name === ag.gatherer);
  crew = { agents: (g && g.agents) || [], harnesses: (all && all.harnesses) || [],
    start: (g && g.start_cwd) || (all && all.cwd) || "", home: (all && all.home_dir) || "" };
  const sig = JSON.stringify([crew.harnesses, crew.start, crew.agents.map((a) => [a.channel, a.started_as, a.name, a.avatar,
    a.status, a.role, a.saved, a.asking && a.asking.id, a.answerable, a.recap && a.recap.at])]);
  if (sig === crewSig) return;
  crewSig = sig;
  if (!ready) return;
  drawSide();
  if (current === AGENTS) drawAgentsPage(); else drawSent();
  if (menu && menu.kind === "at") drawAt(menu.q || "");
}
// the group's coordinator agent (one over a folder in it, `over`, is listed with the actors)
export const isLead = (a) => !!a && a.role === "coordinator" && !a.over;
// the actor a block went to (a codex actor's thread, the channel it became), or a thread's line is by
export const actorOf = (ch) => (ch === "gatherer" ? crew.agents.find(isLead)
  : crew.agents.find((a) => a.channel === ch || a.started_as === ch)) || null;
const byOf = (a, by) => !!a && (by === `agent:${a.channel}` || (!!a.started_as && by === `agent:${a.started_as}`));
export const nameOf = (a, ch) => (a && a.name && a.name.text) // a coordinator agent's after its folder: "paper coordinator"
  || (isLead(a) || ch === "gatherer" ? "Coordinator agent" : `Actor ${short(ch || (a && a.channel))}`);
export const tilde = (path) => (crew.home && path && path.startsWith(crew.home) ? `~${path.slice(crew.home.length)}` : path || "");
export function face(a, size = 18, lead = false) {
  const name = (a && a.avatar) || (lead || isLead(a) ? "roles/manager" : null);
  if (!name) return el("span", { class: "face none", style: `width:${size}px;height:${size}px`, "aria-hidden": "true" });
  return el("img", { class: `face${lead || isLead(a) ? " lead" : ""}`, src: `${DASH}/avatars/${name.split("/").map(encodeURIComponent).join("/")}.svg`,
    alt: "", width: String(size), height: String(size), draggable: "false" });
}
// How an actor stands, in a word, as the dashboard's list says it: [class, words]
const WORDS = { running: ["work", "Working"], building: ["work", "Starting"], background: ["work", "In the background"],
  asking: ["ask", "Needs you"], error: ["bad", "Error"], failed: ["bad", "Failed"], finished: ["done", "Done"],
  closed: ["idle", "Closed"], idle: ["idle", "Idle"] };
export function stands(a) {
  if (!a) return ["gone", "Gone"];
  const k = (a.status && a.status[0]) || "idle";
  if (a.saved && (k === "idle" || k === "closed")) return ["idle", "Saved"];
  return WORDS[k] || ["idle", (a.status && a.status[1]) || "Idle"];
}
// The lines an actor is on now: the ones its latest message is about (ag.actors' `asked_of`, a line of this notebook's,
// or several sent together: their ids, ", " between), or none -- its latest message came from elsewhere (Chat, another app).
export const linesOn = (a) => (a && a.asked_of && a.asked_of.app === ag.app ? String(a.asked_of.item || "").split(/,\s*/).filter(Boolean) : []);
// -- who a line went to (notebook.py): its calls, one an agent, in the order sent -- {to, sent, extra?, group?,
// dropped?}; `dropped`: the reader took it back from that agent. (A notebook kept before a line could go to several
// said its one agent as the line's own `to`, `sent`, `extra`, `group`: read as its one call, as the notebook reads it.)
export const callsOf = (b) => (!b ? [] : Array.isArray(b.calls) ? b.calls : b.to ? [{ to: b.to, sent: b.sent, extra: b.extra, group: b.group }] : []);
export const onIt = (b) => callsOf(b).filter((c) => !c.dropped);
// whether a call went to this actor (a codex actor's thread, the channel it became; the gatherer agent, however named)
export const callTo = (c, ch) => c.to === ch || (!!actorOf(c.to) && actorOf(c.to) === actorOf(ch));
const byCall = (c, by) => by === `agent:${c.to}` || byOf(actorOf(c.to), by);
// whether a line of a block's thread is of its conversation with this call's agent: the reader's messages to it, its
// reports -- and what no call claims: a message from before a line could go to several, its first agent's; a report by
// an agent the line never went to (one its agent handed it to), the first's it is with now
function claims(calls, c, l) {
  const own = (x) => (l.by === "user" ? !!l.to && callTo(x, l.to) : byCall(x, l.by));
  if (calls.some(own)) return own(c);
  const home = l.by === "user" ? calls[0] : calls.find((x) => !x.dropped) || calls[0];
  return !!home && c.to === home.to;
}
// A line as one of its agents has it: the line, with that call's `to`, `sent`, `extra`, `group` and `dropped`, and
// their conversation as its `thread`. Its status, its chip and the conversation beside the page are drawn from it.
function viewOf(b, c) {
  const calls = callsOf(b);
  return { ...b, to: c.to, sent: c.sent || 0, extra: c.extra || "", group: c.group || "", dropped: c.dropped || 0,
    thread: (b.thread || []).filter((l) => claims(calls, c, l)) };
}
export const viewsOf = (b) => callsOf(b).map((c) => viewOf(b, c));
export const viewsOn = (b) => viewsOf(b).filter((v) => !v.dropped);
export const viewFor = (b, ch) => { const c = ch ? callsOf(b).find((x) => callTo(x, ch)) : null; return c ? viewOf(b, c) : null; };
// a line's calls with one more: to the agent it just went to -- in the place of the one to that agent before, if any
export function withCall(b, call, asked = "") {
  const calls = callsOf(b).map((c) => ({ ...c })), i = calls.findIndex((c) => callTo(c, call.to) || (!!asked && callTo(c, asked)));
  if (i < 0) calls.push(call); else calls[i] = call;
  return calls;
}
// when a line last went to its actor (a view's: its call's), or to its agents: sent, or the user's latest message about it
const sentOf = (b) => ("sent" in b ? b.sent || 0 : Math.max(0, ...onIt(b).map((c) => c.sent || 0)));
export const lastSent = (b) => Math.max(sentOf(b), ...(b.thread || []).filter((l) => l.by === "user").map((l) => l.at || 0));
// -- work items (notebook.py): lines sent to an agent, or marked as one; only the reader ends one
export const isWork = (b) => !!b && !UNSENT.includes(b.type) && !!(onIt(b).length || b.work);
// how the reader ended one -- "done", "canceled" -- or "": a to-do one is done as it is ticked
export const endedOf = (b) => (!isWork(b) ? "" : b.ended || (b.type === "todo" && b.checked ? "done" : ""));
// crossed out, and folded away on its page: a work item the reader ticked (a to-do, done so). Ending one -- accepting
// or canceling it -- changes no line: the page stays as the reader wrote it, the line's chip saying how its work ended.
export const crossed = (b) => isWork(b) && b.type === "todo" && !!b.checked;
export const endedAt = (b) => b.ended_at || Math.max(sentOf(b), ...(b.thread || []).map((l) => l.at || 0)) || 0;
export const pageOf = (b) => { const f = findLine(b.id); return f ? f.p : null; };
const SETTLE = 15;                                       // s: a line just sent to an actor not busy yet: not taken up yet
// How a work item stands with one of its agents (`b`, its view), {key, cls, word} -- its own state, not its actor's
// alone: ended (done, canceled); sent to no one (new); taken back from that agent (dropped); its actor on it now (run;
// ask: it asks about it, errs on it, or is gone); reported on since it was last sent, or its actor took it up and
// stopped without a report (review: the reader's to accept, or send back); sent, its actor on something before it (queue).
function itemStands(b) {
  const e = endedOf(b);
  if (e) return e === "done" ? { key: "done", cls: "done", word: "Done" } : { key: "canceled", cls: "gone", word: "Canceled" };
  if (!b.to) return { key: "new", cls: "new", word: "Not started" };
  if (b.dropped) return { key: "dropped", cls: "gone", word: "Removed" };
  const a = actorOf(b.to), [cls, word] = stands(a);
  if (cls === "gone") return crewKnown ? { key: "ask", cls: "bad", word: "Agent gone" } : { key: "queue", cls: "wait", word: "Sent" };
  const busy = cls === "work" || cls === "ask" || cls === "bad";
  if (busy && linesOn(a).includes(b.id)) return cls === "work" ? { key: "run", cls, word: `${word} · ${since(lastSent(b))}` } : { key: "ask", cls, word };
  const last = [...(b.thread || [])].reverse().find((l) => byOf(a, l.by));
  if (last && (last.at || 0) >= lastSent(b)) return { key: "review", cls: "review", word: "To review" };
  if (busy ? waiting(a, b) : now() - lastSent(b) < SETTLE) return { key: "queue", cls: "wait", word: busy ? "Queued" : "Sent" };
  return { key: "review", cls: "review", word: "To review" };
}
// How a work item stands, as one: ended; sent to no one now (new) -- else as the most pressing of its agents: one
// asking about it, one on it, one it is to review from, one it waits for (`v`: that agent's view of it).
export function lineStands(b) {
  const vs = endedOf(b) ? [] : viewsOn(b);
  if (!vs.length) return itemStands(endedOf(b) ? b : { ...b, to: "" });
  const all = vs.map((v) => ({ ...itemStands(v), v }));
  return ["ask", "run", "review", "queue"].map((k) => all.find((s) => s.key === k)).find(Boolean) || all[0];
}
// what to say of a work item beside how it stands (`b`: the view of it its status is from): what it asks, what it
// waits for, its latest report
export function itemSaid(b, s = itemStands(b)) {
  if (s.v) b = s.v;
  const a = b.to ? actorOf(b.to) : null;
  if (s.key === "new") return "Not sent yet";
  if (s.key === "ask") return s.word === "Agent gone" ? "The agent is gone. Send it to another agent or cancel it."
    : askedOn(a, b) ? `Asks: ${askLine(a.asking)}` : s.cls === "bad" ? "The agent stopped with an error" : "";
  if (s.key === "queue" && s.word === "Queued") { const on = linesOn(a).length ? findLine(linesOn(a)[0]) : null; return on ? `After “${oneLine(on.b.text, 60)}”` : "After its current work"; }
  const latest = [...(b.thread || [])].reverse().find((l) => l.by !== "user");
  if (s.key === "review" && !(latest && (latest.at || 0) >= lastSent(b))) return "Stopped without a report";
  return latest ? oneLine(latest.text, 240) : "";
}
// what its agent said it made (its latest report that names any)
export const madeOf = (b) => ([...(b.thread || [])].reverse().find((l) => l.by !== "user" && l.results) || {}).results || [];
// ops ending work items as the reader says ("done", "canceled"; "": open again), wherever they are. Ending one ticks
// no to-do (only the reader ticks one); opening one again unticks it, a ticked to-do being one done.
function endOps(bs, how) {
  const at = now();
  return bs.map((b) => [pageOf(b), b]).filter(([p]) => p).map(([p, b]) => ({ op: "block.put", page: p.id,
    block: { id: b.id, ended: how, ended_at: at, ...(b.type === "todo" && !how ? { checked: false } : {}) } }));
}
export function accept(bs) {
  bs = bs.filter((b) => isWork(b) && !endedOf(b));
  if (!bs.length) return;
  change(endOps(bs, "done"));
  say(bs.length === 1 ? "Accepted as done" : `Accepted ${bs.length} lines as done`);
  redraw();
}
export function reopen(bs) {
  bs = bs.filter((b) => endedOf(b));
  if (!bs.length) return;
  change(endOps(bs, ""));
  redraw();
}
export function markWork(bs, on) {
  const ops = bs.map((b) => [pageOf(b), b]).filter(([p]) => p).map(([p, b]) => ({ op: "block.put", page: p.id, block: { id: b.id, work: on } }));
  if (!ops.length) return;
  change(ops);
  redraw();
}
// Work items canceled: ended so, and an agent still to finish one (on it, or yet to take it up) told to leave it, in
// a message of the user's -- it reads one sent mid-turn at its next step, as Chat's.
export async function cancel(bs) {
  bs = [...new Map(bs.filter((b) => isWork(b) && !endedOf(b)).map((b) => [b.id, (findLine(b.id) || {}).b || b])).values()];
  if (!bs.length) return;
  const tell = new Map();                                 // per actor and page: its lines
  for (const b of bs) for (const v of viewsOn(b)) {
    const s = itemStands(v), p = pageOf(b);
    if (!p || !["run", "queue", "ask"].includes(s.key) || s.word === "Agent gone") continue;
    const k = `${v.to} ${p.id}`;
    if (!tell.has(k)) tell.set(k, { to: v.to, p, them: [] });
    tell.get(k).them.push(b);
  }
  change(endOps(bs, "canceled"), false);                 // (its agent told to stop: not to be undone)
  redraw();
  for (const { to, p, them } of tell.values()) {
    const many = them.length > 1, it = many ? "them" : "it";
    const text = `(From my Notes, page ${JSON.stringify(p.title || "Untitled")}, ${many ? `blocks ${them.map((b) => b.id).join(", ")}` : `block ${them[0].id}`}.`
      + ` The user canceled ${many ? "these lines" : "this line"}: stop any work on ${it}, and don't report on ${it}.)`
      + `\n\nCanceled: ${them.map((b) => oneLine(b.type === "code" ? esc(b.text) : b.text, 200)).join("; ")}`;
    try { await ag.actors.send(to, text); } catch (e) { return say(`Canceled, but couldn't tell the agent to stop: ${e.message}`, true); }
  }
  say(bs.length === 1 ? "Canceled" : `Canceled ${bs.length} lines`);
}
// all that shows work items drawn again: the sidebar's counts, and the page or Work page shown
export function redraw() { drawSide(); drawPage(); }
export const when = (t) => { const d = new Date(t * 1000); return d.toDateString() === new Date().toDateString() ? clock(t)
  : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock(t)}`; };
export const ago = (t) => { const s = since(t); return s === "just now" ? s : `${s} ago`; };
// what a report names it made: links open, the rest said
export const madeRow = (rs) => el("div", { class: "res" }, ...rs.map((r) => (/^https?:\/\/\S+$/.test(r)
  ? el("a", { href: r, target: "_blank", rel: "noopener", title: r, text: r.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60) })
  : el("span", { title: r, text: r }))));
// a line sent to a busy actor after the one it is on (or while it is on something else): not taken up yet
function waiting(a, b) {
  const on = linesOn(a)[0], found = on ? findLine(on) : null;
  return !found || lastSent(b) >= lastSent(viewFor(found.b, a.channel) || found.b);   // (sent with it, or after: not taken up yet)
}
export function findLine(id) {
  for (const p of live()) { const b = p.blocks.find((x) => x.id === id); if (b) return { p, b }; }
  return null;
}
// what an actor asks, if it asks it about this line (the line it is on now)
const askedOn = (a, b) => (a && a.asking && stands(a)[0] === "ask" && linesOn(a).includes(b.id) ? a.asking : null);
// The lines sent together with one (`b`, its view for one of its agents) -- to that agent, as one message: the same
// `group` -- in the page's order, as that agent has each; just it, sent alone. They show once for that agent, at the
// last of them: how they stand together, and one conversation.
export function sentWith(b) {
  const p = pageOf(b);
  if (!p || !b.to || !b.group) return [b];
  const g = p.blocks.map((x) => { const c = callsOf(x).find((y) => y.to === b.to && y.group === b.group); return c ? viewOf(x, c) : null; }).filter(Boolean);
  return g.some((x) => x.id === b.id) ? g : [b];
}
// How lines sent together stand: their open ones as one -- asking or working before all else; some to review, how
// many of them; then queued, not started; all of them to review: to review. Every one ended: as the last.
export function groupStands(g) {
  if (g.length === 1) return itemStands(g[0]);
  const open = g.filter((b) => !endedOf(b));
  if (!open.length) return itemStands(g[g.length - 1]);
  const all = open.map(itemStands), first = (...ks) => ks.map((k) => all.find((s) => s.key === k)).find(Boolean);
  const busy = first("ask", "run");
  if (busy) return busy;
  const r = all.filter((s) => s.key === "review").length;
  if (r && r < all.length) return { key: "queue", cls: "review", word: `${r} of ${all.length} to review` };
  return first("queue", "new") || all[0];
}
export const askedAll = (a, g) => g.map((b) => askedOn(a, b)).find(Boolean) || null;
// the actor's reports and the user's messages on lines sent together, in the order written (a report saying its line)
export const threadOf = (g) => g.flatMap((x) => (x.thread || []).map((l) => (g.length > 1 && l.by !== "user" ? { ...l, on: oneLine(x.text, 48) } : l)))
  .sort((x, y) => (x.at || 0) - (y.at || 0));
export function say(text, bad = false) {
  const w = $("who");
  w.textContent = text;
  w.classList.toggle("bad", bad);
  w.style.opacity = "1";
  clearTimeout(sayTimer);
  setSayTimer(setTimeout(() => { w.style.opacity = "0"; }, 7000));
}
