// WHAT COMES TO WANT THE READER, said as it happens: an app's NOTIFICATION (app_kit's notices.py: sent by its backend's
// Host.notify or its panel's ag.notices.send; data.py's `app_notices`, a gatherer's `apps`), and an actor that comes to
// wait for them (a question, a plan to approve) or stops on an error -- each the same way, from what the homes bring
// (heedHome, as each is taken): a POP-UP in the page's corner (POP_SECONDS, longer while the pointer is on it; a click
// opening what it is about, its × putting it away) and, the page not in front of the reader, the computer's own
// notification too (`system`), each once. An app's only where the app asked: "ag" in its `show` for the pop-up, "system"
// for the computer's -- neither, it is only listed (a quiet one); an actor's only while the reader keeps actors' pop-ups
// (`heed.actors`). Nothing for what the reader has in front of
// them -- its pane or panel shown, the page in focus -- nor for what was there as the page loaded (its first home). The
// computer's needs the reader's leave once, in a browser (the desktop app gives it): asked from the settings. Both
// choices kept in this browser (HEED_KEY).
//
// An app's notification is listed until the reader looks at the app (04-seen.js: its panel shown, the page in front),
// the app clears it, or the reader dismisses it (its × in a card: dismissNotice). A click on one (a card's, a pop-up's,
// the computer's) shows the app's panel and hands it where the notification said (openNotice: the SDK's
// ag.notices.onOpen).
const HEED_KEY = "ag-dashboard-notify";
const POP_SECONDS = 8, POP_MOST = 3;
const heed = (() => {
  const v = { actors: true, system: true };
  try { const k = JSON.parse(localStorage.getItem(HEED_KEY)) || {}; for (const n of Object.keys(v)) if (typeof k[n] === "boolean") v[n] = k[n]; }
  catch (e) { /* none kept */ }
  return v;
})();
let heedWas = null;                                  // what wanted the reader in the last home taken (null: none taken)
const goneNotices = new Set();                       // dismissed here: left out of the homes until the server has it so
const pageInFront = () => document.visibilityState === "visible" && document.hasFocus();
const canSay = () => "Notification" in window && Notification.permission === "granted";

// what wants the reader in `home`, by a token naming it -- the same thing, the same token, home after home
function wanting(home) {
  const out = new Map();
  for (const g of home.gatherers) {
    for (const a of g.agents) {
      const cls = statusOf(a)[0];
      if (cls === "asking") out.set(["ask", g.name, a.channel, (a.asking && (a.asking.call || a.asking.at)) || ""].join("\u0000"), { g, a, why: "asking" });
      else if (cls === "error") out.set(["error", g.name, a.channel, (a.stopped && a.stopped.at) || (a.failing && a.failing.at) || ""].join("\u0000"), { g, a, why: "error" });
    }
    for (const [id, got] of Object.entries(g.apps || {})) {
      const since = seen.at[appKey(g.name, id)] || 0;
      for (const n of got.notices || []) if ((n.at || 0) > since) out.set(["notice", g.name, id, n.id].join("\u0000"), { g, id, n, app: got.app });
    }
  }
  return out;
}
// whether the reader has it in front of them: its pane (an actor's) or its panel (an app's) shown, the page in front
const inFront = (w) => pageInFront() && (w.a ? openActors().some((s) => isAt(s, w.g.name, w.a.channel))
  : panes.apps.some((p) => !p.held && p.instance.id === w.id));
// What a home brought that wants the reader, and was not there before: popped up, and, the page not in front, said on
// the computer.
function heedHome() {
  if (SNAPSHOT || PANE || !state.home) return;
  const now = wanting(state.home), was = heedWas;
  heedWas = new Set(now.keys());
  if (was === null) return;
  const fresh = [...now].filter(([k, w]) => !was.has(k) && (!w.a || heed.actors) && !inFront(w));
  for (const [k, w] of fresh.filter(([, w]) => w.a || (w.n.show || []).includes("ag")).slice(-POP_MOST)) popUp(k, w);
  if (heed.system && !pageInFront() && canSay())
    for (const [k, w] of fresh) if (w.a || (w.n.show || []).includes("system")) sayOnComputer(k, w);
}
// what it says: [title, line, where it is]
function saidOf(w) {
  if (w.n) {
    const o = appInfo(w.g.name, w.id), info = o ? o.app : (window.agNext && window.agNext.apps.named(w.app)) || {};
    const label = o && (o.name || (o.title && o.title !== info.label)) ? appTitle(o) : info.label || w.app || "An app";
    return [w.n.title, w.n.text || "", `${label} · ${titleOf(w.g)}`];
  }
  const who = actorTitle(w.a), ask = w.a.asking || {};
  if (w.why === "error") return [`Stopped on an error: ${who}`, (w.a.stopped && w.a.stopped.text) || (w.a.failing && w.a.failing.error) || "", titleOf(w.g)];
  const q = Array.isArray(ask.questions) && ask.questions[0];
  return [`Waiting for you: ${who}`, ask.kind === "plan" ? "A plan to approve" : (q && (q.question || q.header)) || "A question for you", titleOf(w.g)];
}
// opened: an actor shown, as a click on its row shows it; an app's panel, where the notification says
function openWant(w) {
  if (w.n) return openNotice(w.g.name, w.id, w.n);
  pick(w.g.name, w.a.channel, {});                   // as a plain click: where its task is open (07-panes.js's viaTabs)
}
function popsBox() {
  let box = document.getElementById("pops");
  if (!box) {
    box = el("div", { class: "pops", id: "pops", role: "region", "aria-label": "Notifications" });
    document.body.append(box);
  }
  return box;
}
function popUp(k, w) {
  const box = popsBox();
  for (const old of box.children) if (old.dataset.want === k) old.remove();
  const [title, line, where] = saidOf(w), face = w.a ? plainFace(w.a) : ((o) => o ? appFace(o) : el("span", { class: "logo app-face" }, strokeIcon(ICONS.app, 16)))(appInfo(w.g.name, w.id));
  const cls = w.n ? "notified" : w.why;
  let timer = null;
  const away = () => { clearTimeout(timer); pop.remove(); };
  const later = () => { clearTimeout(timer); timer = setTimeout(away, POP_SECONDS * 1000); };
  const pop = el("div", { class: `pop ${cls}`, "data-want": k, role: "status" },
    el("button", { class: "pop-open", type: "button", title: w.n ? "Open the app there" : "Show this actor",
      onclick: () => { away(); openWant(w); } },
    el("span", { class: "pop-face" }, face, el("i", { class: `pop-dot ${cls}`, "aria-hidden": "true" })),
    el("span", { class: "pop-tx" }, el("b", { text: title }), line ? el("span", { class: "pop-line", text: line }) : null,
      el("span", { class: "pop-where", text: where }))),
    el("button", { class: "pop-x", type: "button", title: "Put it away", "aria-label": `Put away: ${title}`, onclick: away }, closeIcon()));
  pop.addEventListener("pointerenter", () => clearTimeout(timer));
  pop.addEventListener("pointerleave", later);
  box.append(pop);
  while (box.children.length > POP_MOST) box.firstElementChild.remove();
  later();
}
function sayOnComputer(k, w) {
  const [title, line, where] = saidOf(w);
  try {
    const n = new Notification(title, { body: [line, where].filter(Boolean).join("\n"), tag: k });
    n.onclick = () => {
      n.close();
      window.focus();
      if (window.agApp && window.agApp.raise) window.agApp.raise();
      openWant(w);
    };
  } catch (e) { /* this browser says none from a page */ }
}
// An app's notification opened: the app's panel shown (selected, as its row's click does) and handed where it said
async function openNotice(gname, id, n) {
  let o = appInfo(gname, id);
  if (!o) { await readApps(gname, true); o = appInfo(gname, id); }
  if (!o) return paneNote("That app is closed");
  await selectApp(gname, o, {});
  const p = panes.apps.find((q) => q.instance.id === id);
  if (p) p.panel.intent("notice", { id: n.id, where: n.where === undefined ? null : n.where });
}
// One dismissed by the reader: gone from the list at once, and settled on the server (its `app_notice_settled`)
async function dismissNotice(gname, id, n) {
  goneNotices.add(n.id);
  dropGone(state.home);
  renderAgents();
  if (hover.shown) cardDraw();
  try { await post("/api/apps/notices/settle", { gatherer: gname, instance: id, which: n.id, by: "user" }); }
  catch (err) { goneNotices.delete(n.id); setLive(`Not dismissed: ${err.message}`); }
}
// a home's notifications without those dismissed here (a home read before the server had it so); those it no longer
// has, forgotten
function dropGone(home) {
  if (!home || !goneNotices.size) return;
  const still = new Set();
  for (const g of home.gatherers) for (const [id, got] of Object.entries(g.apps || {})) {
    for (const n of got.notices || []) if (goneNotices.has(n.id)) still.add(n.id);
    got.notices = (got.notices || []).filter((n) => !goneNotices.has(n.id));
    if (!got.notices.length) delete g.apps[id];
    else got.last = Math.max(...got.notices.map((n) => n.at || 0)) || null;
  }
  for (const k of [...goneNotices]) if (!still.has(k)) goneNotices.delete(k);
}
// The settings' "Notifications": actors' pop-ups on or off, the computer's too or not -- and, in a browser that has not
// given its leave, a button asking for it
function setHeed(what, on, keep = true) {
  heed[what] = on;
  if (keep) { try { localStorage.setItem(HEED_KEY, JSON.stringify(heed)); } catch (e) { /* this page only */ } }
  drawHeed();
}
function drawHeed() {
  for (const b of document.querySelectorAll("[data-heed]")) {
    const [what, v] = b.dataset.heed.split(":");
    b.setAttribute("aria-pressed", String(heed[what] === (v === "on")));
  }
  const note = document.getElementById("notify-leave");
  if (!note) return;
  const can = "Notification" in window, asked = can && Notification.permission;
  note.replaceChildren(...(!heed.system ? [] : !can ? [el("span", { class: "cfg-note", text: "This browser shows none from a page" })]
    : asked === "granted" ? [] : asked === "denied" ? [el("span", { class: "cfg-note", text: "Blocked by the browser: allow them in its site settings" })]
      : [el("button", { type: "button", onclick: () => Notification.requestPermission().then(drawHeed, drawHeed) }, "Allow notifications…")]));
}
if (!PANE && !SNAPSHOT) {
  for (const id of ["notify-actors", "notify-system"]) document.getElementById(id)?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-heed]");
    if (!b) return;
    const [what, v] = b.dataset.heed.split(":");
    setHeed(what, v === "on");
  });
  drawHeed();
  window.addEventListener("focus", () => { if (state.home) markSeen(); });   // the page in front: what its panels show, seen
}
