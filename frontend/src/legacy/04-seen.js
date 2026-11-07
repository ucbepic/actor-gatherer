// ------------------------------------------------------------------ finished, not yet looked at
// When the reader last looked at each actor: its `last` (data.py: its latest activity, in the server's
// clock) at that moment. An actor that has stopped with activity after that is FINISHED: done, and not yet
// seen. Looking means having it open in a pane while the page is visible. Kept by the server (seen.py,
// `home.seen`: {gatherer: {channel: last}}) so every dashboard on this home shows the same: at either address
// (localhost, 127.0.0.1 -- each a browser storage of its own), in any browser, after a restart. The page's
// copy takes the larger of the server's and its own looks, so a home read before a look was kept does not
// undo it. Before any dashboard on the home kept a look (`home.seen` null), every actor there is taken as
// seen -- as of this browser's own look, where it kept one before -- and handed to the server. A server from
// before `seen` (none in its home): kept in this browser, as it was.
const SEEN_KEY = "ag-dashboard-seen";                // where this browser kept them before
const seen = { at: {}, here: false, handing: false, dropped: false };   // here: kept in this browser
const unseen = (a) => !!a.key && !!a.last && a.last > (seen.at[a.key] || 0);
function keptHere() {
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY)); return v && typeof v === "object" ? v : {}; }
  catch (e) { return {}; }
}
function dropHere() { try { localStorage.removeItem(SEEN_KEY); } catch (e) { /* stays; the server's looks win */ } }
// Every actor of `home` taken as seen: as of `had`, where it has one; else as it is.
function everySeen(home, had) {
  const at = { ...had };
  for (const g of home.gatherers) for (const a of g.agents) if (a.last && !at[a.key]) at[a.key] = a.last;
  return at;
}
function takeSeen(home) {
  if (home.seen === undefined) {                     // a server from before `seen`
    if (!seen.here) { seen.here = true; seen.at = everySeen(home, keptHere()); }
    return;
  }
  seen.here = false;                                 // (one restarted since, the page kept open: handed over)
  for (const [g, chs] of Object.entries(home.seen || {}))
    for (const [c, last] of Object.entries(chs)) { const k = key(g, c); if (!(seen.at[k] >= last)) seen.at[k] = last; }
  if (home.seen === null && !seen.handing) {         // none kept on the home yet
    seen.at = everySeen(home, { ...keptHere(), ...seen.at });
    const all = home.gatherers.flatMap((g) => g.agents.filter((a) => seen.at[a.key]).map((a) => [g.name, a.channel, seen.at[a.key]]));
    seen.handing = true;
    tellSeen(all).then((kept) => { if (kept) dropHere(); else seen.handing = false; });
  } else if (home.seen && !seen.dropped && !SNAPSHOT && !PANE) { seen.dropped = true; dropHere(); }
}
// Looks kept: by the server, or in this browser for a server from before `seen`. Whether they were.
async function tellSeen(looked) {
  if (SNAPSHOT || PANE || !looked.length) return false;
  if (seen.here) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen.at)); return true; } catch (e) { return false; } }
  try { await post("/api/seen", { seen: looked }); return true; }
  catch (err) { setLive(`Not saved: ${err.message}`); return false; }
}
// Homes taken so far: the first, then each the stream sends. What an action of the reader's changes in the home -- a
// gatherer hidden or named, an actor saved, a folder -- shows at once, then the server's answer (every choice of its
// kind, as kept after it) takes its place; but not where a home came while it was asked (`homeSince(asked)`, `asked`:
// `homesTaken` as it was sent). That home was read after the action's change, so has it, and maybe another made since
// (by the gatherer agent, another page) that the answer, read before, would undo till something else changed -- the
// stream sends a home only when it differs from the last it sent; or before it, and the stream sends the next once
// the change is rung.
let homesTaken = 0;
const homeSince = (asked) => homesTaken !== asked;
// Each actor's key, and what the reader has seen of a new home: what the server kept (everything, before
// it kept any); the selected actor, while the page is visible.
function takeHome(home) {
  homesTaken++;
  window.agNext.home(home);                        // the new code's store has it too (src/bridge.ts)
  for (const g of home.gatherers) for (const a of g.agents) {
    a.key = key(g.name, a.channel);
    if (appRole(a)) a.last_user_message = appAsked(a, a.last_user_message);
    else if (bwKey(a)) a.last_user_message = bwStrip(a.last_user_message);
  }
  if (state.selected) {                              // a codex session renamed to its thread: followed there
    const g = home.gatherers.find((x) => x.name === state.selected[0]);
    const moved = g && !g.agents.some((a) => a.channel === state.selected[1])
      && g.agents.find((a) => a.session && a.session.started_as === state.selected[1]);
    if (moved) {
      if (term.sid === state.selected[1]) { term.sid = moved.channel; if (term.es) { term.es.close(); term.es = null; } }   // listened to again, under its new id
      state.selected = [g.name, moved.channel];
      setTimeout(connect);
    }
  }
  takeSeen(home);
  state.home = home;
  markSeen();
  appsAtWork();                                      // apps' panels told their agents' states; held while they work
  bwTellScheme();
}
function markSeen() {
  if (SNAPSHOT || PANE || !state.home || document.visibilityState !== "visible") return;
  const looked = [];
  for (const [gname, c] of openActors()) {
    const g = state.home.gatherers.find((x) => x.name === gname);
    const a = g && g.agents.find((x) => x.channel === c);
    if (!a || !a.last || (seen.at[a.key] || 0) >= a.last) continue;
    seen.at[a.key] = a.last; looked.push([gname, c, a.last]);
  }
  tellSeen(looked);
}
document.addEventListener("visibilitychange", () => { if (state.home && document.visibilityState === "visible") { markSeen(); renderAgents(); } });

