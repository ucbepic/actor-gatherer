// ------------------------------------------------------------------ a minimized pane's history
// A pane minimized (18-top.js's MINI_VIEW) shows, right of its message box, two lines of its conversation: the user's
// last message, and what the actor does now -- or, its turn over, the first line of what it said last. Hovering either
// shows the whole conversation in a card over what is above the pane (miniCard): each turn, the user's message, then
// what the agent did, in order -- its messages among its commands (each reply's `after`: how many of the turn's calls came
// before it, files.py's) -- an earlier turn folded to a line, its commands fetched when opened; the latest its last few
// steps; and each turn's reply. The card is this page's, made from its own data with its own helpers, and put in the page
// around it, where there is room: a pane's frame is only as tall as its strip (fitMini). A pane too narrow for the lines
// shows none (07-top.css).
const MINI_STEPS = 10;                               // the latest turn's steps shown; the earlier ones a press away
const MINI_REPLY = 420;                              // an earlier turn's reply longer than this: its first lines, then a press
// The files feed's data, for this page's actor: its turns, and the latest turn's commands (minimized: the latest is loaded).
const miniData = () => state.files && state.selected && state.files.key === key(...state.selected) ? state.files.data : null;
// The turns as Chat has them: the server's view's, else the files feed's.
const miniTurns = (info) => { const v = chatViewOf(info), d = miniData(); return (v && v.turns) || (d && d.turns) || []; };
// What the agent said last in a turn, readable: its last message.
const lastSaid = (t) => { const r = (t.replies || []).filter((x) => x.kind === "text" && str(x.text).trim()); return r.length ? r[r.length - 1].text : null; };
const plainLine = (text, n = 200) => firstLine(str(window.agNext.ui.unplanned(str(text))).replace(/`|\*\*|^#{1,6}\s+/gm, "").trim(), n);

// The two lines, right of the message box: built at each draw of the pane, from what the Chat view has.
function miniHistory({ info, running }) {
  const turns = miniTurns(info), v = chatViewOf(info), cur = v ? v.current : null;
  const t = turns.length ? turns[turns.length - 1] : null;
  const mine = mySends(), atWork = viewAtWork(info) || running;
  const opening = (v && v.opening) || (mine.length && !atWork ? mine[0] : null);
  const waits = [...((v && v.waiting) || []), ...(atWork ? mine.filter((m) => !(v && window.agNext.chat.cidsOf(v).has(m.cid))) : [])];
  if (!t && !opening) { miniCard.shut(); return null; }
  const rows = [];
  // the user's: what waits to reach the agent, else the turn's latest message (one written while it ran, else its own)
  const said = opening || (waits.length ? waits[waits.length - 1] : null);
  const more = t && (t.more || []).length ? t.more[t.more.length - 1] : null;
  if (said) rows.push(miniRow("you pending", el("span", { class: "ic", text: "›" }),
    [el("span", { class: "sub", text: "Pending ·" }), plainLine(said.text)], null));
  else rows.push(miniRow("you", el("span", { class: "ic", text: "›" }),
    [more ? el("span", { class: "sub", text: "While it worked ·" }) : null, plainLine(more ? more.text : t.text)],
    agoOf(more ? more.at : t.at)));
  // the agent's: what it does now, else how its turn ended
  const state_ = opening ? "opening" : cur ? cur.state : running ? "working" : "done";
  if (opening) rows.push(miniRow("now quiet", el("span", { class: "ic" }, strokeIcon(ICONS.history, 12)), "Sent · waiting for the actor to take it", null));
  else if (state_ === "asking") rows.push(miniRow("now ask", el("span", { class: "ic mk ask", text: "?" }), "Waiting for you", null));
  else if (atWork || state_ === "working") {
    // a call under way; else thinking; else its latest call, if nothing was said since (files.py's `last`); else what it
    // said last
    const doing = (cur && cur.doing) || t.now, call = t.last || null;
    const thinking = !(call && call.running) && doing && doing.kind === "thinking";
    const words = cur && cur.failing ? "Retrying…" : thinking ? "Thinking…" : null;
    const said_ = !words && !call ? lastSaid(t) : null;
    const text = words || (call ? callLabel(call, 160) : said_ ? plainLine(said_) : "Working…");
    const dot = call && !words ? el("i", { class: "dotc " + (call.running ? "run" : call.error ? "err" : "ok") }) : null;
    const began = t.began || t.at;
    rows.push(miniRow("now live", el("span", { class: "ic" }, dot || (said_ ? el("img", { src: bareAvatar(info) || "", alt: "", draggable: "false" })
      : el("span", { class: "spin", "aria-hidden": "true" }))), text,
      began ? el("span", { class: "dur", "data-since": began, text: lasting(began) }) : null, said_ ? " said" : ""));
  } else {
    const reply = lastSaid(t), stopped = t.stopped || (cur && cur.state === "stopped" ? cur.stopped : null);
    const src = bareAvatar(info);
    if (reply && !stopped) rows.push(miniRow("now reply", el("span", { class: "ic" }, src ? el("img", { src, alt: "", draggable: "false" }) : null),
      plainLine(reply), agoOf(t.end || t.at)));
    else rows.push(miniRow("now quiet", el("span", { class: "ic", text: "■" }),
      stopped ? stoppedWords(stopped) : t.calls ? `Done · ${plural(t.calls, "command")}` : "Done", agoOf(t.end || t.at)));
  }
  miniCard.drawn(info, rows);
  return el("div", { class: "mini-hist", role: "group", "aria-label": "The conversation, last lines" }, ...rows);
}
const agoOf = (t) => t ? el("span", { "data-ago": t, text: ago(t) }) : null;
const stoppedWords = (s) => s.kind === "interrupted" ? "Interrupted" : s.text ? `Stopped: ${firstLine(s.text, 120)}` : "Stopped";
function miniRow(kind, icon, text, meta, extra = "") {
  const r = el("button", { type: "button", class: `mh-row ${kind}${extra}`, "data-kind": kind.split(" ")[0],
    title: "Hover for the whole conversation · click: show the chat" },
    icon, el("span", { class: "tx" }, ...[].concat(text).filter((x) => x !== null && x !== undefined)), el("span", { class: "meta" }, meta));
  r.addEventListener("mouseenter", () => miniCard.hover(r));
  r.addEventListener("mouseleave", () => miniCard.leave());
  r.addEventListener("focus", () => miniCard.open(r, true));
  r.addEventListener("blur", () => miniCard.leave());
  r.addEventListener("click", (ev) => { miniCard.shut(); miniOpenAt(null, ev.metaKey || ev.ctrlKey); });
  return r;
}
// The chat shown again -- at turn `n` (null: at its end); `side`, its files and commands too.
function miniOpenAt(n, side) {
  setChatMin(false);
  setTimeout(() => {
    if (side) foldSide(false, false);
    if (n !== null) setFilesTurn(n); else if (side) keepingPlace(renderMain);
  }, 60);
}

// ------------------------------------------------------------------ the card: the whole conversation
const miniCard = (() => {
  let card = null, anchor = null, kind = "now", info = null, timer = 0, shutAt = 0;
  const opened = new Set();                        // what the reader opened in it: earlier turns, a command, a reply
  const fetched = new Map();                       // an earlier turn's commands: "<actor> <n>" -> list, or a promise
  let forKey = null;
  const host = () => PANE ? window.parent.document : document;
  const hostWin = () => PANE ? window.parent : window;
  const isOpen = () => !!card && card.isConnected;
  // Esc closes it, from anywhere on the page or the page around -- the message box too: open, it is what the reader is
  // looking at (it shows only while a line or it is hovered, or a line focused); a second Esc there interrupts the turn
  const onKey = (ev) => {
    if (ev.key !== "Escape" || !isOpen()) return;
    ev.preventDefault(); ev.stopPropagation();
    const a = anchor, inside = card.contains(host().activeElement);
    shut();
    if (inside && a && a.isConnected) { hush = true; a.focus({ preventScroll: true }); hush = false; }   // back on its line, closed
  };
  let hush = false;
  const docs = () => [...new Set([document, host()])];
  function shut() {
    clearTimeout(timer); clearTimeout(shutAt);
    for (const d of docs()) d.removeEventListener("keydown", onKey, true);
    if (card) card.remove();
    card = null; anchor = null;
    for (const n of document.querySelectorAll(".mh-row.hot")) n.classList.remove("hot");
  }
  function hover(r) {
    clearTimeout(shutAt);
    if (isOpen()) { open(r, false); return; }      // open: another line's at once
    clearTimeout(timer);
    timer = setTimeout(() => open(r, true), 140);
  }
  function leave() { clearTimeout(timer); clearTimeout(shutAt); shutAt = setTimeout(shut, 260); }
  function open(r, grow) {
    if (hush) return;
    clearTimeout(shutAt);
    const k = key(...state.selected);
    if (forKey !== k) { opened.clear(); forKey = k; }
    const again = isOpen() && kind === r.dataset.kind;
    for (const n of document.querySelectorAll(".mh-row.hot")) n.classList.remove("hot");
    r.classList.add("hot");
    anchor = r; kind = r.dataset.kind;
    if (!info) info = selectedInfo();
    if (!isOpen()) {
      card = el("div", { class: "mh-card floats", role: "dialog", "aria-label": "The conversation" });
      card.addEventListener("mouseenter", () => clearTimeout(shutAt));
      card.addEventListener("mouseleave", leave);
      host().body.append(card);
      for (const d of docs()) d.addEventListener("keydown", onKey, true);
    }
    fill(false);
    place();
    if (grow) { card.classList.remove("grow"); void card.offsetWidth; card.classList.add("grow"); }
    if (!again) aim();
  }
  // the pane drawn again: the card, if open, with it -- anchored to the new line, its scroll kept (at its end: kept there)
  // (patch() keeps a line that did not change, so the line is found on the page once it is drawn)
  function drawn(a, rows) {
    info = a;
    if (!isOpen()) return;
    if (!state.selected || key(...state.selected) !== forKey) { shut(); return; }
    const r = rows.find((x) => x.dataset.kind === kind);
    if (r) r.classList.add("hot");
    queueMicrotask(() => {
      if (!isOpen()) return;
      const lines = [...document.querySelectorAll(".chat.mini .mh-row")];
      const now = lines.find((x) => x.dataset.kind === kind) || lines[lines.length - 1];
      if (!now || !chatMin()) { shut(); return; }
      for (const n of lines) n.classList.toggle("hot", n === now);
      anchor = now;
      fill(true);
      place();
    });
  }
  // over the pane, rising from its lines: at least 420px wide, as tall as its content up to 640px or the room above it
  function place() {
    if (!anchor || !card) return;
    const box = anchor.closest(".mini-hist"), strip = anchor.closest(".chat.mini");
    if (!box || !strip) return;
    const off = PANE && window.frameElement ? window.frameElement.getBoundingClientRect() : { left: 0, top: 0 };
    const h = box.getBoundingClientRect(), s = strip.getBoundingClientRect(), W = hostWin().innerWidth, H = hostWin().innerHeight;
    const w = Math.min(W - 24, Math.max(420, Math.min(640, h.width + 80)));
    const left = Math.min(Math.max(12, off.left + h.left - 6), W - w - 12), top = off.top + s.top;
    Object.assign(card.style, { width: `${w}px`, left: `${left}px`, bottom: `${H - top + 8}px`, maxHeight: `${Math.min(640, Math.max(200, top - 56))}px` });
    card.style.setProperty("--ox", `${off.left + anchor.getBoundingClientRect().left - left + 20}px`);
  }
  // opened at its end; from the user's line, at their last message
  function aim() {
    const body = card && card.querySelector(".mh-body");
    if (!body) return;
    body.scrollTop = body.scrollHeight;
    if (kind === "you") { const y = [...body.querySelectorAll(".mh-you")].pop(); if (y) body.scrollTop = y.offsetTop - 8; }
  }
  function fill(update) {
    const a = info || selectedInfo();
    if (!card || !a) return;
    const old = card.querySelector(".mh-body");
    const atEnd = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 8, top = old ? old.scrollTop : 0;
    const turns = miniTurns(a), v = chatViewOf(a), cur = v ? v.current : null, last = turns.length - 1;
    const live = !!cur && cur.state === "working" || (!cur && !!a.running);
    const src = bareAvatar(a), t = turns[last];
    const head = el("div", { class: "mh-head" }, src ? el("img", { src, alt: "", draggable: "false" }) : null,
      el("span", { class: "who", text: a.name && a.name.text ? a.name.text : harnessName(a.harness) }),
      el("span", { class: "st" }, ...headState(a, t, cur, live), ` · ${plural(turns.length, "turn")}`));
    const body = el("div", { class: "mh-body" });
    turns.forEach((tt, i) => body.append(...turnNodes(a, tt, i, i === last, live && i === last)));
    if (cur && cur.state === "asking") body.append(el("div", { class: "mh-now ask" }, el("span", { class: "mk ask", text: "?" }), "Waiting for you: its question is over the message box"));
    else if (live) body.append(el("div", { class: "mh-now" }, src ? buddy(a, !!a.failing) : el("span", { class: "spin" }),
      cur && cur.failing ? "Retrying…" : ((cur && cur.doing) || (t && t.now) || {}).kind === "thinking" ? "Thinking…" : "Working…"));
    const foot = el("div", { class: "mh-foot" }, el("span", {}, el("kbd", { text: "Click" }), " a message: the chat there"),
      el("span", {}, el("kbd", { text: "⌘" }), " with its commands"), el("span", {}, el("kbd", { text: "Esc" }), " close"));
    const ink = HUE_INK[a.avatar_hue];
    if (ink) card.style.setProperty("--mh-ink", `light-dark(${ink[0]}, ${ink[1]})`); else card.style.removeProperty("--mh-ink");
    card.replaceChildren(head, body, foot);
    if (update) body.scrollTop = atEnd ? body.scrollHeight : top;
  }
  function headState(a, t, cur, live) {
    if (!t) return [el("span", { class: "x", text: "No turn yet" })];
    if (cur && cur.state === "asking") return [el("span", { class: "w", text: "Waiting for you" })];
    if (live) return [el("span", { class: "w", text: cur && cur.failing ? "Retrying" : "Working" }), " ",
      el("span", { "data-since": t.began || t.at, text: lasting(t.began || t.at) })];
    const stopped = t.stopped || (cur && cur.state === "stopped" ? cur.stopped : null);
    return [el("span", { class: stopped ? "x" : "d", text: stopped ? stoppedWords(stopped) : "Done" }), " ",
      el("span", { "data-ago": t.end || t.at, text: ago(t.end || t.at) })];
  }
  // a turn: where it began, the user's message(s), what it did, its reply
  function turnNodes(a, t, i, latest, live) {
    const out = [el("div", { class: "mh-sep" }, el("b", { text: `Turn ${i + 1}` }), el("span", { "data-ago": t.at, text: ago(t.at) }))];
    const you = el("div", { class: "mh-you", tabindex: "0", title: "Show the chat at this turn · ⌘ click: with its commands" },
      el("span", { class: "lbl", text: "You" }), el("div", { class: "tx", text: str(t.text) }),
      ...(t.more || []).map((m) => el("div", { class: "tx more" }, el("span", { class: "lbl", text: "While it worked" }), str(m.text))));
    you.addEventListener("click", (ev) => { shut(); miniOpenAt(latest ? null : t.n, ev.metaKey || ev.ctrlKey); });
    you.addEventListener("keydown", (ev) => { if (ev.key === "Enter") you.click(); });
    out.push(you);
    const k = `${key(...state.selected)} ${t.n}`, reply = lastSaid(t);
    const finalAt = live ? -1 : (t.replies || []).map((r, j) => [r, j]).filter(([r]) => r.kind === "text" && str(r.text).trim()).map(([, j]) => j).pop() ?? -1;
    if (!latest && !opened.has(`t${t.n}`)) {
      if (t.calls) out.push(el("button", { type: "button", class: "mh-sum", "data-turn": t.n, onclick: () => { opened.add(`t${t.n}`); fetchTurn(a, t.n, k); fill(true); } },
        el("span", { class: "car", text: "▸" }), plural(t.calls, "command")));
    } else {
      const cmds = latest ? latestCommands(miniTurns(a).length, t) : fetched.get(k);
      if (!latest && t.calls) out.push(el("button", { type: "button", class: "mh-sum open", "data-turn": t.n, onclick: () => { opened.delete(`t${t.n}`); fill(true); } },
        el("span", { class: "car", text: "▸" }), plural(t.calls, "command")));
      if (!Array.isArray(cmds) && t.calls) out.push(el("div", { class: "mh-wait", text: "Loading its commands…" }));
      const steps = stepsOf(t, Array.isArray(cmds) ? cmds : [], finalAt);
      const cut = latest && steps.length > MINI_STEPS && !opened.has(`t${t.n}`) ? steps.length - MINI_STEPS : 0;
      if (cut) out.push(el("button", { type: "button", class: "mh-more", text: plural(cut, "earlier step"),
        onclick: () => { opened.add(`t${t.n}`); fill(true); } }));
      steps.slice(cut).forEach((s, j) => out.push(stepNode(s, t, live && cut + j === steps.length - 1)));
    }
    if (finalAt >= 0) {
      const long = !latest && str(reply).length > MINI_REPLY && !opened.has(`r${t.n}`);
      out.push(el("div", { class: "mh-reply" + (long ? " clamp" : "") }, window.agNext.ui.markdown(str(reply))));
      if (long) out.push(el("button", { type: "button", class: "mh-more", text: "Show the whole reply", onclick: () => { opened.add(`r${t.n}`); fill(true); } }));
    } else if (!live && !(latest && miniCurState(a) === "asking")) {
      const stopped = t.stopped || null;
      if (stopped) out.push(el("div", { class: "mh-quiet", text: stoppedWords(stopped) }));
    }
    return out;
  }
  const miniCurState = (a) => { const v = chatViewOf(a); return v ? v.current.state : null; };
  // the latest turn's commands, from the files feed -- when it has that turn (its turns as many as the view's)
  function latestCommands(n, t) {
    const d = miniData();
    return d && d.turns.length === n && d.turn === n - 1 ? d.commands : t.calls ? null : [];
  }
  function fetchTurn(a, n, k) {
    if (fetched.has(k)) return;
    const [g, c] = state.selected, cwd = (a && (a.cwd || (a.session && a.session.cwd))) || "";
    fetched.set(k, get(`/api/files?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}&turn=${n}&cwd=${encodeURIComponent(cwd)}`)
      .then((got) => { fetched.set(k, got && !got.error ? got.commands || [] : []); if (isOpen()) fill(true); },
        () => { fetched.delete(k); }));
  }
  // a turn's steps in order: its messages among its commands, each message after as many commands as its `after` says;
  // its last message (`finalAt`) left for the reply, under them; thinking left out (the line at the end says it)
  function stepsOf(t, cmds, finalAt) {
    const out = [];
    let i = 0;
    (t.replies || []).forEach((r, j) => {
      const upto = Math.min(typeof r.after === "number" ? r.after : cmds.length, cmds.length);
      while (i < upto) out.push({ c: cmds[i], i: i++ });
      if (j === finalAt || r.kind === "thinking") return;
      if ((r.kind === "text" && str(r.text).trim()) || r.kind === "report" || r.kind === "peer") out.push({ r, j });
    });
    while (i < cmds.length) out.push({ c: cmds[i], i: i++ });
    return out;
  }
  function stepNode(s, t, current) {
    if (s.r) {
      const r = s.r, k = `m${t.n}-${s.j}`, open = opened.has(k);
      const label = r.kind === "report" ? "Subagent's report:" : r.kind === "peer" ? `Message from ${r.name || "another session"}:` : null;
      const n = el("div", { class: "mh-said" + (open ? " open" : ""), title: open ? "Fold the message" : "Show the whole message",
        onclick: () => { opened[open ? "delete" : "add"](k); fill(true); } },
        el("span", { class: "dot", text: "●" }), label ? el("span", { class: "lbl", text: label }) : null,
        open ? window.agNext.ui.markdown(str(r.text)) : el("span", { class: "first", text: plainLine(r.text) }));
      return n;
    }
    const c = s.c, k = `c${t.n}-${s.i}`, open = opened.has(k);
    const cls = c.running && current ? "run" : c.error ? "err" : c.running ? "stop" : "ok";
    const n = el("div", { class: "mh-cmd" + (open ? " open" : "") },
      el("button", { type: "button", class: "line", title: open ? "Fold the call" : "Show the call and its output",
        onclick: () => { opened[open ? "delete" : "add"](k); fill(true); } },
        el("i", { class: "dotc " + cls }), el("span", { class: "tx" }, callLabel(c, 200)),
        c.changed && (c.changed[0] || c.changed[1]) ? el("span", { class: "chg" },
          c.changed[0] ? el("span", { class: "chg-a", text: `+${full(c.changed[0])}` }) : null,
          c.changed[1] ? el("span", { class: "chg-r", text: `−${full(c.changed[1])}` }) : null)
          : cls === "err" ? el("span", { class: "mh-side", text: "failed" }) : cls === "run" ? el("span", { class: "mh-side", text: "running" }) : null));
    if (open) n.append(callView(c.call, c));
    return n;
  }
  if (PANE) window.addEventListener("pagehide", shut);
  if (!SNAPSHOT) (PANE ? window.parent : window).addEventListener("resize", () => { if (isOpen()) place(); });
  return { hover, leave, open, shut, drawn, isOpen };
})();
