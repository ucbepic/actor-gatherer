// ------------------------------------------------------------------ the chat
// The actor's history, as the chosen chat view draws it (chat views, below), in a frame that follows
// its newest and takes all the height there is; then what was sent and waits for the turn to end; then
// the box to write the next. A session not started here is resumed by the dashboard on its first message
// (in the directory its calls named); while another process has it open -- a terminal -- the box is off
// (`ctx.held`). An actor that cannot be messaged from here at all (not Claude Code, or no directory; or
// a snapshot) has its history and no box; so has every actor in a view to read it by (`readOnly`: the ones in Details).
function chatCard(info) {
  const s = info.session || { cwd: info.cwd, permission_mode: "auto", queued: [], status: "stopped" };
  const view = chatMin() ? MINI_VIEW : chatView(), feed = chatFeed(view);
  const writable = hasChat(info) && !SNAPSHOT && !view.readOnly;
  const held = info.chattable === false
    ? `Open in another process${info.holder ? ` (PID ${info.holder.pid})` : info.pid ? ` (PID ${info.pid})` : ""}: `
      + "close it there to message it here." : "";
  const data = feed.data() || { items: [], pending: [], earlier: false };
  const ctx = { info, session: s, data, running: ["running", "building"].includes(turnStatus(info)[0]), queued: s.queued || [], held, writable,
    loadEarlier: async () => {                         // the view's "earlier" control: kept where the reader was
      if (!feed.loadEarlier) return;
      const n = document.getElementById("chat-list"), from = n ? n.scrollHeight - n.scrollTop : 0;
      await feed.loadEarlier(); renderMain();
      const m = document.getElementById("chat-list"); if (m) m.scrollTop = m.scrollHeight - from;
    },
    rerender: () => keepingPlace(renderMain), api: agDashboard };
  const card = el("section", { class: "chat" + (view.mini ? " mini" : ""), "aria-label": `${harnessName(info.harness || (state.agent && state.agent.harness))} · ${state.selected[0]}`,
    "data-morph": "", "data-for": signature([state.selected, view.id, writable, held, !!info.session]) });
  const safely = (what, fallback) => {
    try { return [].concat(what() || []); }
    catch (err) { console.error(err); return fallback ? [el("div", { class: "warn", text: `The ${view.name} view failed: ${err.message}` })] : []; }
  };
  // its controls go in the page's header: the view's own (tools), which view, and the details panel
  const tools = safely(() => view.tools && view.tools(ctx));
  const controls = document.getElementById("controls");
  const heading = [...(tools.length ? [el("div", { class: "chat-tools" }, ...tools)] : []),
    ...[viewSwitcher(view)].filter(Boolean),
    el("div", { class: "side-btns" },
      !canMinimize() ? null : el("button", { type: "button", class: "details-btn", "aria-label": "Minimize the chat", title: MIN_TIP,
        onclick: () => setChatMin(true) }, strokeIcon(ICONS.minimize, 16)),
      el("button", { type: "button", class: "details-btn", "aria-expanded": state.details ? "true" : "false", "aria-label": "Details",
        title: "Details: what ag saw and did for this actor (its context, calls, history and builds), and the history's other views",
        onclick: () => setDetails(!state.details) }, strokeIcon(ICONS.panel, 16)))];
  // the page's own buttons, unchanged, kept as they are: a view that redraws every few seconds (History, while
  // the Gatherer works) does not make them flash under the pointer. A view's own tools are made again each
  // draw: what they do may be the draw's.
  const same = !tools.length && heading.length === controls.children.length && heading.every((n, i) => n.isEqualNode(controls.children[i]));
  if (!same && !view.mini) controls.replaceChildren(...heading);   // minimized: the head hidden, kept as it was
  const frame = el("div", { class: `chat-frame ${view.frame ?? "ctx"}`, id: "chat-list", "data-keep": "chat-list", "data-follow": "1", "data-morph": "",
    role: "log", "aria-label": `Chat history, ${view.name}` });
  // its blocks, put in by patch(): a block kept from the last draw is still on the page, and is left there
  const blocks = frame.kids = safely(() => view.render(ctx), true);
  if (view.feed !== "none" && view.chat !== false) {  // a view that draws the history: what waits, or that there is none yet
    if (view.queued !== false) for (const q of ctx.queued) blocks.push(el("div", { class: "queued", text: `Waiting for the turn to end: ${q}` }));
    if (!data.items.length && !data.pending.length && !ctx.queued.length && !view.greets)
      blocks.push(el("div", { class: "desc", text: SNAPSHOT ? "A snapshot has no conversation: run `ag dashboard` live to see it."
        : s.status === "starting" ? "Starting the agent…" : writable ? "No messages yet. Write one below." : "No messages yet." }));
  }
  if (!view.mini) card.append(frame);
  if (view.chat === false) {                         // not the conversation: no message box, and no word that there is none
    card.append(...safely(() => view.footer && view.footer(ctx)));
    return card;
  }
  if (view.feed !== "none" && view.asking !== false) {          // the terminal shows it itself
    const note = errorNote(info) || askingNote(info, !view.readOnly) || answeredNote(info); if (note) card.append(note); }
  if (view.background) { const note = backgroundNote(info); if (note) card.append(note); }
  if (!writable) {
    if (!SNAPSHOT && !view.readOnly) card.append(el("div", { class: "readonly", text: `Read only: the dashboard can message only ${runnableNames("and")} sessions with a known directory.` }));
    card.append(...safely(() => view.footer && view.footer(ctx)));
    return card;
  }
  // Sending, for every view's message box: the box is the view's (`composer`), what it sends and the
  // error it gets are the tab's.
  const draft = key(...state.selected);              // what is typed for this actor and not sent (keepDraft)
  // why its last message was not sent, kept for the draws after (sendFailed); for one its terminal's box could not take
  // (sessions.py's NotAtBox), the way to the terminal
  const failed = !held && sendFailed.get(draft);
  const err = el("div", { class: "err", role: "alert" }, ...(held ? [held] : failed ? [failed.text, ...(failed.box && CHAT_VIEWS.has("terminal")
    ? [" ", el("button", { type: "button", class: "to-term", onclick: () => setChatView("terminal") }, "Open the terminal")] : [])]
    : s.status === "failed" && s.last_error ? [s.last_error] : []));
  let sending = false;
  refill(info, draft);
  // A message box kept from an earlier draw (`patch`) still calls the send it was drawn with: each send goes to the
  // latest draw's (state.chatSend), which knows the session as it is now.
  ctx.send = (t) => state.chatSend(t);
  state.chatSend = async (t) => {
    t = String(t ?? "").trim();
    if (dashboardCommand(t)) { const box = document.getElementById("composer-text"); if (box) { box.value = ""; fitBox(box); } keepDraft(draft, ""); return true; }
    if (!t || sending || held) return false;
    sending = true; err.textContent = ""; sendFailed.delete(draft); state.interrupting = null;
    for (const n of document.querySelectorAll("[data-send]")) n.disabled = true;
    // a "/" command of the harness's own (dashboardCommand took the page's): what it does (a dialog, a report) is drawn
    // in the session's terminal, and may never come back as a message -- not shown pending; the terminal shown once
    // the session has one (its own, or one the message opened)
    const slash = t.startsWith("/");
    // else shown at once, by its id (`cid`), until the server's view of the conversation has it (chatSends, a moment
    // later: the dashboard keeps it from the moment it comes); `ran`: typed into a terminal open already, at its message
    // box (sessions.py's `send`) -- not one it opens, which may ask first (canInterrupt)
    const cid = "page:" + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const mine = slash ? null : { key: key(...state.selected), cid, text: t, at: Date.now(), ran: !!(info.session && info.session.terminal) };
    const box = document.getElementById("composer-text"), was = box ? box.value : "";
    if (mine) chatSends.push(mine);
    if (box) { box.value = ""; fitBox(box); }
    keepDraft(draft, "");
    if (mine) { keepingPlace(renderMain); talkToEnd(); }
    // a terminal the message opens (sessions.py's `send`): the Terminal view's screen, at its size if it was drawn
    const opens = { fullscreen: fullscreenFor(info), ...(term.sid === info.channel && term.opened ? { cols: term.xterm.cols, rows: term.xterm.rows } : {}) };
    try {
      const got = await post("/api/send", info.session ? { session_id: s.session_id, text: t, cid, ...opens }
        : { gatherer: state.selected[0], channel: state.selected[1], text: t, cid, ...opens });
      if (slash && got && got.terminal && CHAT_VIEWS.has("terminal")) { await setChatView("terminal"); return true; }
      if (state.paused || !state.stream) await refresh(); else { await loadChat(); render(); }
      chatToEnd();
      return true;
    } catch (e) {
      if (mine && chatSends.includes(mine)) chatSends.splice(chatSends.indexOf(mine), 1);
      // not sent: back as the actor's draft, unless something new was typed for it meanwhile
      if (!drafts()[draft]) {
        keepDraft(draft, was);
        const again = document.getElementById("composer-text");
        if (again && again.dataset.draft === draft) { again.value = was; fitBox(again); }
      }
      sendFailed.set(draft, { text: e.message, box: e.box });
      keepingPlace(renderMain);
      return false;
    }
    finally { sending = false; for (const n of document.querySelectorAll("[data-send]")) n.disabled = !!held; }
  };
  state.chatSend.draft = draft;                      // whose it is: a new tab's first message sent by it (07-new-tab.js)
  // The text box a composer is built around: Enter sends it, Shift+Enter starts a new line, and what is
  // typed in it survives the tab being drawn again (keepingPlace finds it by its id), and the reader going to another
  // actor or view and back (it starts with the actor's draft). A line high, growing with the lines typed (fitBox).
  ctx.input = (attrs = {}) => {
    const box = el("textarea", { rows: "1", placeholder: "Message the actor", "aria-label": "Message the actor", title: "Enter sends · Shift+Enter for a new line",
      enterkeyhint: "send", ...attrs, id: "composer-text", "data-draft": draft,
      ...(held ? { disabled: "", placeholder: "Open in another process" } : {}) });
    box.value = drafts()[draft] || "";
    if (box.value) requestAnimationFrame(() => { if (box.isConnected) fitBox(box); });   // fitted once drawn into the page
    box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); ctx.send(box.value); } });
    // an image pasted or dropped in: saved in the home (/api/upload), and its path typed in the message, for the agent to read
    const attach = (ev, list) => {
      const images = [...(list || [])].filter((f) => f.type && f.type.startsWith("image/"));
      if (!images.length) return;
      ev.preventDefault();
      for (const f of images) {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const { path } = await post("/api/upload", { type: f.type, data: String(reader.result).split(",")[1] });
            const at = box.selectionStart ?? box.value.length, tag = `[Image: ${path}] `;
            box.value = box.value.slice(0, at) + tag + box.value.slice(at);
            box.selectionStart = box.selectionEnd = at + tag.length;
            fitBox(box); keepDraft(draft, box.value);
          } catch (e) { setLive(`Image not attached: ${e.message}`); }
        };
        reader.readAsDataURL(f);
      }
    };
    box.addEventListener("paste", (ev) => attach(ev, ev.clipboardData && ev.clipboardData.files));
    box.addEventListener("dragover", (ev) => { if (ev.dataTransfer && [...ev.dataTransfer.types].includes("Files")) ev.preventDefault(); });
    box.addEventListener("drop", (ev) => attach(ev, ev.dataTransfer && ev.dataTransfer.files));
    return box;
  };
  // the composer kept across redraws while what it shows is unchanged: no redraw under the reader's typing. The text box
  // itself is kept while it is the same actor's and as usable (its data-sig), the rest patched round it (data-morph):
  // a turn's end, changing the rest, no longer replaces the box being typed in.
  const sig = signature([ctx.running, held, s.status, s.last_error, s.permission_mode, s.cwd]);
  const composer = safely(() => (view.composer || defaultComposer)(ctx), true);
  for (const n of composer) if (n.nodeType === 1) {
    const box = n.id === "composer-text" ? n : n.querySelector("#composer-text");
    if (box) box.dataset.sig = signature([draft, !!held]);
    if (box && box !== n) n.dataset.morph = ""; else if (!box) n.dataset.sig = sig;
  }
  card.append(...composer, err, ...safely(() => view.footer && view.footer(ctx)));
  if (held) for (const n of card.querySelectorAll("[data-send], #composer-text")) n.disabled = true;   // whatever the view drew
  return card;
}
// What Claude Code still runs in the background for the actor (data.py's `background`): the commands,
// agents, monitors and workflows it started and has not been told have ended, each with what it is for and its
// last sign of life. Null when none runs. `term`: drawn as a terminal's status line.
const TASK_KINDS = { command: "Command", agent: "Agent", monitor: "Monitor", workflow: "Workflow" };
function backgroundNote(info, term = false) {
  const tasks = (info && info.background) || [];
  if (!tasks.length) return null;
  return el("div", { class: term ? "status-line bg-tasks" : "bg-tasks", role: "status" },
    el("div", { class: "head" }, el("span", { class: "mark", "aria-hidden": "true" }),
      `${plural(tasks.length, "background task")} running${info.status === "background" ? ": the turn is over, the work is not" : ""}`),
    ...tasks.map((t) => el("div", { class: "task", title: [t.label, t.output].filter(Boolean).join("\n") },
      el("span", { class: "kind", text: TASK_KINDS[t.kind] || t.kind }),
      el("span", { class: "label", text: t.label || t.id }),
      el("span", { class: "when", text: [`started ${ago(t.started)}`,
        t.event ? `last event ${ago(t.event_at)}: ${t.event}` : t.active && t.active - t.started > 2 ? `active ${ago(t.active)}` : null]
        .filter(Boolean).join(" · ") }))));
}
// What the agent waits on the user for (data.py's `asking`): the questions it asked, each with its options,
// or the plan it asks them to approve. Where the dashboard runs the session's terminal, answered here: what is
// picked is typed into the terminal's dialog (POST /api/answer, sessions.py's `answer`), and the terminal shows
// it answered as if it had been picked there; elsewhere it is answered in the terminal that runs the session.
// `answerable` false (a view to read by): shown, and answered in Chat or the terminal. Null while it waits on nothing.
// Codex's questions asked as it goes on working (`async`) show while it runs; its plan, once its turn proposed one
// and its terminal (the dashboard's) asks whether to implement it. A permission it asks before a tool runs (`kind`
// "permission", as its hook reported it): the call as its harness shows it, allowed or denied ({allow, text}).
function askingNote(info, answerable = true) {
  const ask = info && (info.status === "asking" || (info.status === "running" && info.asking && info.asking.async)) ? info.asking : null;
  if (!ask) return null;
  // how its harness has a reader answer it (harness_kit's `ask_says`): its words, and the ways to take a plan
  const says = { plan_verb: "approve", plan_choices: [], plan_change: { label: "Or say what to change" }, own_answer: "Or type your own answer",
    ...((harnessInfo(ask.harness || (state.home || {}).harness_default) || {}).ask_says || {}) };
  const qs = ask.questions || [];
  const s = info.session || {};
  const { touched, reopened, here: answersHere } = askWhere(info, ask);
  const here = answerable && answersHere;
  const key = askKey(ask), perm = ask.kind === "permission", dialog = ask.kind === "dialog";
  const sent = info.answer && info.answer.call === key ? info.answer : null;
  const who = info.harness ? harnessName(info.harness) : "The agent";
  const what = dialog ? `${who} is asking you in its terminal`
    : perm ? `${who} asks to ${permissionVerb(ask)}${ask.agent ? " (a subagent of it)" : ""}`
    : ask.kind === "plan" ? `${who} has a plan for you to ${says.plan_verb}`
    : `${who} asked you ${qs.length > 1 ? plural(qs.length, "question") : "a question"}${ask.async ? " as it works" : ""}`;
  const d = draftOf(ask);
  const late = sent && Date.now() / 1000 - sent.at > ANSWER_LATE;
  if (sent && !late && !lateTimers.has(sent.call)) {   // drawn again once it would count as lost
    lateTimers.add(sent.call);
    setTimeout(() => keepingPlace(renderMain), Math.max(0, (sent.at + ANSWER_LATE) * 1000 - Date.now()) + 200);
  }
  const redraw = () => keepingPlace(renderMain);
  const send = async (choice) => {
    d.sending = true; d.error = ""; redraw();
    try { await post("/api/answer", { session_id: s.session_id, id: key, call: ask.call, choice }); await refresh(); }
    catch (err) { d.error = `Not answered: ${err.message}`; }
    finally { d.sending = false; redraw(); }
  };
  const busy = d.sending || !!sent;
  const own = (i, placeholder, onEnter) => el("input", { class: "own", type: "text", placeholder, "data-sig": `${key}:${i}:${d.cleared[i] || 0}`,
    value: i === "plan" ? d.change : d.answers[i].text, disabled: busy ? "" : null, "aria-label": placeholder,
    oninput: (ev) => { if (i === "plan") d.change = ev.target.value;
      else { d.answers[i].text = ev.target.value; if (ev.target.value) d.answers[i].options = []; } redraw(); },
    onkeydown: (ev) => { if (ev.key === "Enter" && !ev.isComposing && onEnter) { ev.preventDefault(); onEnter(); } } });
  const done = (i) => !!(d.answers[i].options.length || d.answers[i].text.trim());
  const ready = qs.length && qs.every((q, i) => done(i));
  const choice = () => ({ answers: d.answers.map((a) => a.text.trim() ? { text: a.text.trim() } : { options: a.options }) });
  const tab = Math.min(d.tab, Math.max(0, qs.length - 1));
  const go = (i) => { d.tab = i; redraw(); };
  // the next question not answered yet, after the one shown (then from the first): -1 if every one is
  const nextOpen = () => [...qs.keys()].map((k) => (tab + 1 + k) % qs.length).find((k) => !done(k)) ?? -1;
  const pick = (i, j, multi) => {
    const a = d.answers[i];
    a.options = multi ? (a.options.includes(j) ? a.options.filter((x) => x !== j) : [...a.options, j]) : [j];
    if (a.text) { a.text = ""; d.cleared[i] = (d.cleared[i] || 0) + 1; }
    if (!multi && qs.length > 1) { const n = nextOpen(); if (n >= 0) d.tab = n; }   // as the terminal's dialog does
    redraw();
  };
  const option = (q, i) => (o, j) => {
    const body = [el("span", { class: "lbl", text: o.label || "" }),
      o.description && o.description !== o.label ? el("span", { class: "odesc", text: o.description }) : null];
    if (!here) return el("li", { class: "opt ro" }, el("span", { class: "box", "aria-hidden": "true", text: String(j + 1) }), ...body);
    const on = d.answers[i].options.includes(j);
    return el("button", { type: "button", class: "opt", role: q.multiSelect ? "checkbox" : "radio", "aria-checked": on ? "true" : "false",
      disabled: busy ? "" : null, onclick: () => pick(i, j, q.multiSelect) }, el("span", { class: "box", "aria-hidden": "true" }), ...body);
  };
  const question = (q, i) => el("div", { class: "q", "data-morph": "", "data-q": String(i) },
    q.header && (!here || qs.length < 2) ? el("div", { class: "eyebrow", text: q.header }) : null,
    el("div", { class: "qline" }, el("span", { class: "text", text: q.question || "" }),
      q.multiSelect ? el("span", { class: "hint", text: "Pick any" }) : null),
    el(here ? "div" : "ol", { class: "opts" + (q.multiSelect ? " multi" : ""), role: here ? (q.multiSelect ? "group" : "radiogroup") : null,
      "aria-label": q.question || null }, ...(q.options || []).map(option(q, i))),
    here && !q.multiSelect ? own(i, ask.async ? "Or type your own answer" : says.own_answer, () => { const n = nextOpen(); if (n >= 0) go(n); else if (ready && !busy) send(choice()); }) : null);
  // answered here, several questions: one at a time, as the terminal asks them, a tab each
  const tabs = here && qs.length > 1 ? el("div", { class: "qtabs", role: "tablist", "aria-label": "Questions" }, ...qs.map((q, i) =>
    el("button", { type: "button", class: "qtab", role: "tab", "aria-selected": i === tab ? "true" : "false", onclick: () => go(i) },
      el("span", { class: "n" + (done(i) ? " done" : "") }, done(i) ? strokeIcon(CHECK, 11) : String(i + 1)),
      el("span", { text: q.header || `Question ${i + 1}` })))) : null;
  const plan = ask.kind === "plan" && ask.plan ? el("details", { id: "asking-plan", class: "plan", open: "" },
    el("summary", { text: "The plan" }), markdown(ask.plan)) : null;
  // the foot's line: how the answer sent goes, or why it is not answered here
  const said = (full) => {
    const [cls, text] = dialog ? ["", "Answer it in the terminal."]
      : sent ? [late ? "err" : "sent", late ? `Your answer (${sent.summary}) has not reached ${who}: answer it in the terminal.`
        : `Typing your answer into the terminal: ${sent.summary}`]
      : d.error ? ["err", d.error]
      : !here ? ["", touched ? "Something was typed into its terminal since it asked: finish answering there."
        : reopened ? `Its terminal was opened again since it asked, and ${who} does not ask it there again: answer in a message.`
        : SNAPSHOT ? "Answered in the terminal that runs the session."
        : !answerable && s.terminal ? "Answer it in Chat, or in the terminal." : "Answer it in the terminal that runs the session."]
      : [null, null];
    return text ? el("span", { class: ["say", cls, full ? "full" : ""].filter(Boolean).join(" "), role: cls === "err" ? "alert" : "status", text }) : null;
  };
  let foot = null;
  if (here && perm) {                                  // allowed, denied, or denied with what to do instead
    const deny = (text) => send({ allow: false, text: text || null });
    const instead = () => d.change.trim() && deny(d.change.trim());
    foot = el("div", { class: "foot", "data-morph": "" },
      said(true),
      el("div", { class: "change", "data-morph": "" }, own("plan", "Or say what to do instead", instead),
        el("button", { type: "button", disabled: busy || !d.change.trim() ? "" : null, onclick: instead,
          title: "Deny it, with this for the agent to go on with" }, "Deny with this")),
      el("div", { class: "acts" },
        el("button", { type: "button", disabled: busy ? "" : null, onclick: () => deny(null), title: "Deny it" }, "Deny"),
        el("button", { type: "button", class: "primary", disabled: busy ? "" : null, onclick: () => send({ allow: true }),
          title: "Let it run, this once" }, d.sending ? "Answering…" : "Allow")));
  } else if (here && ask.kind === "plan") {
    const change = () => d.change.trim() && send({ plan: "change", text: d.change.trim() });
    foot = el("div", { class: "foot", "data-morph": "" },
      said(true),
      el("div", { class: "change", "data-morph": "" }, own("plan", says.plan_change.label, change),
        el("button", { type: "button", disabled: busy || !d.change.trim() ? "" : null, onclick: change,
          title: says.plan_change.title || null }, "Ask for changes")),
      el("div", { class: "acts" }, ...says.plan_choices.map((c) => el("button", { type: "button", class: c.primary ? "primary" : "",
        disabled: busy ? "" : null, onclick: () => send({ plan: c.id }), title: c.title || null }, c.label))));
  } else if (here && qs.length) {
    const n = nextOpen();
    foot = el("div", { class: "foot", "data-morph": "" },
      said(),
      el("div", { class: "acts" },
        qs.length > 1 ? el("span", { class: "count", text: `${qs.filter((q, i) => done(i)).length} of ${qs.length} answered` }) : null,
        qs.length > 1 && done(tab) && n >= 0 ? el("button", { type: "button", disabled: busy ? "" : null, onclick: () => go(n) }, "Next") : null,
        el("button", { type: "button", class: "primary", disabled: !ready || busy ? "" : null,
          onclick: () => send(choice()) }, d.sending ? "Answering…" : "Answer")));
  } else if (said()) foot = el("div", { class: "foot" }, said());
  return el("div", { class: "asking-note", role: "group", "aria-label": `Waiting for you: ${what}`, "data-morph": "" },
    el("div", { class: "head" }, el("span", { class: "pill" }, el("i", { "aria-hidden": "true" }), "Waiting for you"),
      el("span", { class: "what", text: what }), el("span", { class: "ago", text: ago(ask.at) }),
      s.terminal && CHAT_VIEWS.has("terminal") ? el("span", { class: "end" }, el("button", { type: "button", class: "to-term",
        title: "Open the terminal", onclick: () => setChatView("terminal") }, strokeIcon(ICONS.terminal, 14), el("span", { class: "lbl", text: "Open the terminal" }))) : null),
    tabs,
    el("div", { class: "body", "data-keep": "asking-note", "data-morph": "" },
      ...(dialog ? [dialogView(ask)] : perm ? [permissionView(ask, `perm-${key}`)] : here && qs.length > 1 ? [question(qs[tab], tab)] : qs.map(question)), plan),
    foot);
}
const CHECK = "M3.5 8.5l3 3 6-7";
// The reader's answers as they make them, by the call they answer: kept across the page's redraws.
const answerDrafts = new Map(), lateTimers = new Set(), answersSeen = new Set();
const ANSWER_LATE = 12;                              // seconds after an answer is sent before it counts as lost
// What an answer names an ask by (data.py's `id`): a question's or a plan's call, a permission's own key.
const askKey = (ask) => ask.id || ask.call;
// Where what an actor asks is answered: the dashboard's terminal, and nothing typed into it since it asked -- answered
// from the page (`here`) -- not where its terminal was opened again since and its harness does not ask again
// (`asks_shown_again`): no dialog there to type into. A dialog no hook reported: in its terminal only.
function askWhere(info, ask) {
  const s = info.session || {};
  const touched = !!(s.terminal && s.typed && s.typed >= ask.at);
  const reopened = !!(s.terminal && s.since && ask.at && s.since > ask.at
    && (harnessInfo(ask.harness || info.harness) || {}).asks_shown_again === false);
  return { touched, reopened, here: !SNAPSHOT && !!s.terminal && !touched && !reopened };
}
// What a permission is for, after "asks to": by the call's shape, as its harness reads it (data.py's `view`).
const PERMISSION_VERBS = { shell: "run a command", edit: "edit a file", write: "write a file", patch: "change files",
  read: "read a file", search: "search files", web: "use the web", agent: "start an agent", skill: "use a skill" };
function permissionVerb(ask) {
  const v = ask.view || {};
  return PERMISSION_VERBS[v.shape] || `use ${summary({ name: ask.tool, input: ask.input, view: v }).title}`;
}
// The call a permission is asked for, as Chat shows a call (summary's shapes): what it is for, then its command in
// full, or the change it would make, or (a shape not known) its input.
function permissionView(ask, id) {
  const v = ask.view || {}, call = { name: ask.tool, input: ask.input || {}, view: v };
  const s = summary(call);
  const shown = [v.command, v.path, v.url, v.query, v.pattern].map((x) => x == null ? "" : str(x));
  const out = [];
  if (ask.said && !shown.includes(ask.said)) out.push(el("div", { class: "qline" }, el("span", { class: "text", text: ask.said })));
  out.push(el("div", { class: "perm-call" }, el("b", { text: s.title }),
    s.arg && v.shape !== "shell" ? el("span", { class: "arg", text: s.arg }) : null));
  if (v.shape === "shell" && v.command) out.push(el("pre", { class: "perm-cmd" }, shellSpan(str(v.command))));
  else if (s.body) out.push(s.body(id));
  else if (!SHAPES[v.shape] && Object.keys(call.input).length) out.push(el("pre", { class: "perm-input", text: JSON.stringify(call.input, null, 2) }));
  return el("div", { class: "perm" }, ...out);
}
// A dialog the actor's terminal shows that no hook reported (data.py's `shown_ask`), as its screen has it: its head,
// what it shows, its question and its options -- answered in the terminal, so the options are not buttons.
function dialogView(ask) {
  return el("div", { class: "perm" },
    ask.title && ask.title !== ask.said ? el("div", { class: "perm-call" }, el("b", { text: ask.title })) : null,
    (ask.lines || []).length ? el("pre", { class: "perm-input", text: ask.lines.join("\n") }) : null,
    el("div", { class: "qline" }, el("span", { class: "text", text: ask.said || "" })),
    el("ol", { class: "shown-opts" }, ...(ask.options || []).map((o) => el("li", { text: o }))));
}
function draftOf(ask) {
  let d = answerDrafts.get(askKey(ask));
  if (!d) answerDrafts.set(askKey(ask), d = { answers: (ask.questions || []).map(() => ({ options: [], text: "" })), change: "",
    cleared: {}, sending: false, error: "", tab: 0 });
  return d;
}
// Once a question answered here has its answer recorded: what Claude Code recorded, when it is not what was
// picked (the dialog was not as it first showed, or Claude Code takes its keys otherwise). Null otherwise.
function answeredNote(info) {
  const a = info && info.answer;
  if (!a || a.recorded !== false || info.status === "asking" || answersSeen.has(a.call)) return null;
  return el("div", { class: "asking-note answered", role: "alert" },
    el("div", { class: "head" }, el("span", { class: "pill" }, el("i", { "aria-hidden": "true" }), "Check the answer"),
      el("span", { class: "what", text: "What was recorded is not what you picked" }),
      el("span", { class: "end" }, el("button", { type: "button", onclick: () => { answersSeen.add(a.call); keepingPlace(renderMain); } }, "Dismiss"))),
    el("div", { class: "body" }, el("div", { class: "pair" },
      el("span", { class: "k", text: "You picked" }), el("span", { class: "v", text: a.summary }),
      el("span", { class: "k", text: `${info.harness ? harnessName(info.harness) : "The agent"} recorded` }),
      el("span", { class: "v", text: a.result || "nothing" }))));
}
// The model call the agent's turn stopped on, or keeps failing on (data.py's `failing`, `stopped`): why, as ag's hook
// server saw it and as Claude Code put it, and how many tries failed. While the harness tries again, that it does;
// once it gave up, that a message tries again. Null while no call fails.
function errorNote(info) {
  const over = !!info && info.status === "error";
  const f = info && (over || info.status === "running") ? info.failing : null;
  const st = over ? info.stopped : null;
  if (!f && !st) return null;
  const who = info.harness ? harnessName(info.harness) : "The agent";
  const why = f ? (f.status ? `The model's endpoint answered ${f.status}: ${f.error}` : `No answer from the model's endpoint: ${f.error}`)
    : st.text || "Its call to the model failed.";
  const hint = errorHint(f, st);
  const tries = f ? `${f.attempts > 1 ? `${f.attempts} tries` : "1 try"} failed, the first ${ago(f.first)}` : null;
  return el("div", { class: "asking-note error-note" + (over ? "" : " retrying"), role: over ? "alert" : "status" },
    el("div", { class: "head" }, el("span", { class: "pill" }, el("i", { "aria-hidden": "true" }), over ? "Error" : "Retrying"),
      el("span", { class: "what", text: over ? `${who} stopped: its call to the model failed` : `${who}'s call to the model failed` }),
      el("span", { class: "ago", text: ago((f && f.at) || st.at) })),
    el("div", { class: "body" }, el("div", { class: "why", text: why }), hint ? el("div", { class: "hint", text: hint }) : null,
      st && st.text && f && !st.text.includes(f.error) ? el("div", { class: "pair", style: "margin-top: 8px" },   // only what it adds
        el("span", { class: "k", text: `${who} said` }), el("span", { class: "v", text: st.text })) : null),
    el("div", { class: "foot" }, el("span", { class: "say", text: [tries, over ? `${who} stopped trying. Send a message to try again.`
      : f.retrying ? "Trying again now." : `${who} will try again.`].filter(Boolean).join(" · ") })));
}
// What an error likely means, where its words say: a lookup or a connection that failed, a limit, an overload.
function errorHint(f, st) {
  const text = `${(f && f.error) || ""} ${(st && st.text) || ""}`;
  const status = (f && f.status) || (st && st.status);
  if (/nodename nor servname|Name or service not known|Temporary failure in name resolution|getaddrinfo/i.test(text))
    return "This machine couldn't look up the endpoint's address (DNS): check its network connection.";
  if (/Connection refused|Connect call failed|ECONNREFUSED|Cannot connect to host 127\.0\.0\.1/i.test(text))
    return "Nothing answered at the endpoint's address.";
  if (status === 429 || /rate.?limit/i.test(text)) return "Rate limited: the harness waits and tries again.";
  if (status === 529 || /overloaded/i.test(text)) return "The model's service is overloaded for now.";
  if (status === 401 || status === 403) return "Not authorized: the harness may need to log in again.";
  return null;
}
// The message box a view gets unless it brings its own: a text box, Enter sending it.
function defaultComposer(ctx) {
  const text = ctx.input();
  const form = el("form", { class: "composer" }, text);
  form.addEventListener("submit", (ev) => { ev.preventDefault(); ctx.send(text.value); });
  return form;
}
// The switch in the page's header: the views on the bar, and the one shown, if it is one of the others (in Details).
function viewSwitcher(current) {
  const views = offeredViews().filter((v) => !v.more || v.id === current.id);
  if (views.length < 2) return null;
  return el("div", { class: "views", role: "group", "aria-label": "How the history is shown" },
    ...views.map((v) => el("button", { type: "button", "aria-pressed": v.id === current.id ? "true" : "false", title: v.description || v.name,
      "aria-label": v.name, onclick: () => setChatView(v.id) }, v.icon ? strokeIcon(v.icon) : null, el("span", { class: "lbl", text: v.name }))));
}
// The other views (`more`), in the details panel: one picked is shown in place of the chat, and the panel closed.
function moreViews() {
  const more = [...CHAT_VIEWS.values()].filter((v) => v.more);
  if (!more.length) return null;
  const now = chatView().id;
  return el("section", { class: "more-views" }, el("h4", { text: "Show the history as" }),
    ...more.map((v) => el("button", { type: "button", "aria-pressed": v.id === now ? "true" : "false",
      onclick: () => { setDetails(false); setChatView(v.id); } },
      v.icon ? strokeIcon(v.icon, 16) : el("span"), el("span", { class: "name", text: v.name }),
      v.description ? el("span", { class: "desc", text: v.description }) : null)));
}
const chatAtEnd = () => { const n = document.getElementById("chat-list"); return !!n && n.scrollHeight - n.scrollTop - n.clientHeight < 40; };
const chatToEnd = () => { const n = document.getElementById("chat-list"); if (n) n.scrollTop = n.scrollHeight; };
function tile(labelText, value, note) {
  return el("div", { class: "tile" }, el("div", { class: "label", text: labelText }), el("div", { class: "value", text: value }), el("div", { class: "note", text: note }));
}
function sizeCard(reads, hasReal) {
  const card = el("section", { class: "card" }, el("h3", { text: "Context size" }),
    el("div", { class: "desc", text: (hasReal ? "Each model call's context, in tokens: as the provider counted it, and as ag counted all it sent "
      + "when it made the call (the harness's preamble included, where it was recorded)."
      : "Each model call's context, in tokens, as ag counts all it sent (these reads have no provider count).") + " Click the chart to see what a read held." }),
    legend([...(hasReal ? [{ label: "Provider's count", color: "var(--s1)" }] : []), { label: "ag's own count", color: "var(--s2)" },
      { label: "Rebuild", kind: "rule" }]),
    el("div", { id: "size-chart" }));
  const table = el("table", {}, el("thead", {}, el("tr", {}, ...["Read", "Time", "Provider's count", "ag's count", "of it, preamble", "ag's budgeted size", "Limit", "Tasks", "Build"].map((h, i) =>
    el("th", { class: i >= 2 && i <= 7 ? "n" : "", text: h })))));
  const body = el("tbody");
  for (const r of [...reads].reverse()) body.append(el("tr", {}, el("td", { class: "n", text: r.read_id }), el("td", { text: clock(r.at, true) }),
    el("td", { class: "n", text: full(r.real_tokens) }), el("td", { class: "n", text: full(r.counted_tokens ?? r.sent_tokens) }),
    el("td", { class: "n", text: r.preamble_tokens === null || r.preamble_tokens === undefined ? "not recorded" : full(r.preamble_tokens) }),
    el("td", { class: "n", text: full(r.est_tokens) }),
    el("td", { class: "n", text: full(r.limit_tokens) }),
    el("td", { class: "n", text: r.tasks }), el("td", { text: (r.basis ?? "none") + (r.rebuild ? " (rebuild)" : "") })));
  table.append(body);
  card.append(el("details", { id: "size-table" }, el("summary", { text: "Show as a table" }),
    el("div", { class: "scroll tall", "data-keep": "size-table" }, table)));
  return card;
}
function drawCharts() {
  const reads = state.agent.reads;
  const pick = async (id) => {
    state.readId = id; state.followLatest = id === reads[reads.length - 1].read_id;
    await loadContext(id);
    keepingPlace(renderMain);
    drawn.main = mainSignature();
  };
  const sizeHost = document.getElementById("size-chart");
  const series = [];
  if (reads.some((r) => typeof r.real_tokens === "number")) series.push({ field: "real_tokens", color: "var(--s1)", label: "provider's count" });
  if (!series.length || !sizeHost || !("providerOnly" in sizeHost.dataset)) series.push({ field: "counted_tokens", color: "var(--s2)", label: "ag's own count" });
  if (sizeHost) lineChart(sizeHost, { reads, series, onPick: pick, picked: state.readId, height: +sizeHost.dataset.height || 220 });
}
// The row of type chips: which items the lists show, by message type. With counts, only the types present, counted.
function typeChips(counts) {
  const row = el("div", { class: "filters", role: "group", "aria-label": "Message types shown" }, el("span", { class: "label", text: "Shows" }));
  for (const [type, name, swatch] of [TYPES[6], ...TYPES.slice(0, 6), OTHER_TYPE, PREAMBLE_TYPE]) {   // the Gatherer's first
    if (counts && !counts[type]) continue;
    if (!counts && (type === OTHER_TYPE[0] || type === PREAMBLE_TYPE[0])) continue;
    const on = shownTypes.has(type);
    row.append(el("button", { type: "button", class: "chip", "aria-pressed": on ? "true" : "false", onclick: () => toggleType(type) },
      el("span", { class: "dot", style: `background:${swatch}` }), counts ? `${name} ${counts[type]}` : name));
  }
  return row;
}
// The latest context as the next call will have it: what the channel has since the latest call (data.py's
// after_read: events stored by a call that logged no read, such as a side call, and the pending answers,
// which the next call will carry) at its end, as its recent history.
function withPending(ctx, latest) {
  const pending = latest && ctx && ctx.items ? (state.agent && (state.agent.after_read || state.agent.pending)) || [] : [];
  if (!pending.length) return ctx;
  const items = [...ctx.items, ...pending.map((it, i) => ({ ...it, group: "Recent history", position: ctx.items.length + i }))];
  return { ...ctx, items, tokens: ctx.tokens + pending.reduce((n, i) => n + i.tokens, 0) };
}
function contextCard() {
  const latest = state.followLatest;
  const title = el("div", { class: "card-title" }, el("h3", { text: latest ? "Context right now" : `Context at read ${state.readId}` }));
  if (!latest) title.append(el("button", { type: "button", onclick: backToLatest }, "Back to the latest"));
  const card = el("section", { class: "card" }, title);
  const ctx = pickedContext();
  if (!ctx || !ctx.items) {
    card.append(el("div", { class: "desc", text: SNAPSHOT && !latest
      ? "A snapshot keeps only each actor's latest context. Run `ag dashboard` live to see older ones." : "No context sent yet." }));
    return card;
  }
  const real = typeof ctx.real_tokens === "number" ? ` · the provider counted ${full(ctx.real_tokens)}` : "";
  const pre = (ctx.preamble || []).reduce((n, p) => n + p.tokens, 0);
  card.append(el("div", { class: "desc", text: `Everything ${latest ? "the latest call" : "this call"} sent (read ${ctx.read_id}, ${clock(ctx.at, true)}), in the order the model got it: `
    + (pre ? `the harness's preamble (${full(pre)} tokens), then ` : "") + `${full(ctx.items.length)} items, ${full(ctx.tokens)} tokens by ag's own count${real}.`
    + (ctx.cut ? ` Built from build ${ctx.basis}, which cut the history at row ${ctx.cut}.` : " No build yet: the whole history, verbatim.")
    + (latest ? " Click the size chart to see an earlier call's." : "") }));
  card.append(contextSplit(ctx));
  const chips = contextChips(ctx);
  if (chips) card.append(chips);
  card.append(el("div", { class: "ctx tall", "data-keep": "context" }, columns(), ...contextRuns(ctx)));
  return card;
}
// The context the size chart has picked: the latest call's, with what is pending, or an earlier one's.
const pickedContext = () => withPending(state.context, state.followLatest);
// Back to the latest call's context, from an earlier one picked on the chart.
async function backToLatest() {
  const reads = state.agent.reads;
  state.readId = reads[reads.length - 1].read_id; state.followLatest = true;
  await loadContext(state.readId); keepingPlace(renderMain);
}
// How a context divides by kind and by part, by ag's own count (a decomposition).
function contextSplit(ctx, bare = false) {
  const extra = [...(ctx.preamble || []).map((p) => entry(p, PREAMBLE)),
    ...(uncounted(ctx.not_counted) ? [entry({ name: "not counted", tokens: ctx.not_counted }, NOT_COUNTED)] : [])];
  return decomposition([...extra, ...placed(ctx.items)], "the context", bare);
}
// Which of a context's items to list, by type: the chips, counted; none when it has nothing to choose.
function contextChips(ctx) {
  const history = ctx.items.filter((i) => HISTORY.has(i.group) || GATHERER.has(i.group));
  if (!history.length && !(ctx.preamble || []).length) return null;
  const counts = { preamble: (ctx.preamble || []).length };
  for (const i of history) { const t = itemType(i)[0]; counts[t] = (counts[t] || 0) + 1; }
  return typeChips(counts);
}
// A context's items, in the order the model got them: a heading for each run of one kind, and the items
// of it the chips let through. Each item's row is kept from one draw to the next while the item is the same
// (ctxRows, by ctxKey), so one opened to read stays open, and in place, as the context grows around it.
const ctxRows = blockCache();
// What an item is across draws and reads: its event's row, ag's made item, or -- a preamble part, an answer no call
// has stored yet -- its name (and time); the same name again in one context counted on.
function ctxKey(it, seen) {
  const base = it.row_id !== null && it.row_id !== undefined ? `r${it.row_id}`
    : it.made_id !== null && it.made_id !== undefined ? `m${it.made_id}`
    : `${it.group}:${it.name}:${it.at ?? ""}`;
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return n > 1 ? `${base}#${n}` : base;
}
function contextRuns(ctx) {
  const pre = (ctx.preamble || []).reduce((n, p) => n + p.tokens, 0);
  const list = el("div", {});
  const seen = new Map();
  ctxRows.begin(signature(state.selected));
  const row = (it) => ctxRows.get(ctxKey(it, seen), `${it.group}:${it.name}:${it.tokens}:${it.clipped}:${it.text.length}`, () => contextItem(it));
  if ((ctx.preamble || []).length) {                 // what the harness sent besides its messages: first, its parts if chosen
    const n = ctx.preamble.length, shown = shownTypes.has("preamble");
    list.append(el("div", { class: "run" }, el("span", { class: "key-rect", style: `background:${color(PREAMBLE)}` }), el("strong", { text: PREAMBLE }),
      el("span", { text: `${tally(n, shown ? n : 0, pre, shown ? pre : 0, "part")} · `
        + "what the harness sent besides its messages" })));
    if (shown) for (const p of ctx.preamble) list.append(row(p));
  }
  let run = null;
  const head = (r) => {
    r.head.replaceChildren(el("span", { class: "key-rect", style: `background:${color(r.group)}` }), el("strong", { text: label(r.group) }),
      el("span", { text: tally(r.items, r.shown, r.tokens, r.shownTokens) }));
  };
  for (const it of ctx.items) {                      // one block per run of the same kind, in order
    // ag's messages among the history belong to the run they sit in (the recent history, before any)
    const group = INLINE.has(it.group) ? (run && HISTORY.has(run.group) ? run.group : "Recent history") : it.group;
    if (!run || run.group !== group) {
      run = { group, items: 0, shown: 0, tokens: 0, shownTokens: 0, head: el("div", { class: "run" }) };
      list.append(run.head);
    }
    run.items++; run.tokens += it.tokens;
    const listed = GATHERER.has(it.group) ? shownTypes.has("gatherer")
      : !HISTORY.has(group) || shownTypes.has(itemType(it)[0]);
    if (listed) { run.shown++; run.shownTokens += it.tokens; list.append(row(it)); }
    head(run);
  }
  if (uncounted(ctx.not_counted)) {                   // what the provider counted beyond all of it
    list.append(el("div", { class: "run" }, el("span", { class: "key-rect", style: `background:${color(NOT_COUNTED)}` }), el("strong", { text: NOT_COUNTED }),
      el("span", { text: `${full(ctx.not_counted)} tokens` })));
    list.append(el("div", { class: "uncounted", text: "The provider's count for this call, less everything above: what ag cannot see or count -- "
      + "the model's tokenizer differing from ag's, reasoning and hidden payloads (signatures in tool-call ids), message framing." }));
  }
  return [...list.childNodes];
}
// Where each item goes in the figure: its run's group -- ag's messages among the history in the
// history they sit in, as the list shows them -- and its part: a type for the history, a name for the summary.
function entry(it, group, items = 1) {
  if (group === PREAMBLE || group === NOT_COUNTED) return { group, part: it.name, label: it.name, color: color(group), tokens: it.tokens, items };
  const history = HISTORY.has(group);
  const t = itemType(it);
  return { group, part: history ? t[0] : it.name, label: history ? t[1] : it.name, color: history ? t[2] : color(group),
    tokens: it.tokens, items };
}
function placed(items) {                          // one context's items, in order
  let current = null;
  return items.map((it) => {
    const group = INLINE.has(it.group) ? (current || "Recent history") : it.group;
    if (HISTORY.has(it.group)) current = it.group;
    return entry(it, group);
  });
}
// `bare`: each row named only, not totalled again (its total is said once elsewhere).
function decomposition(entries, what = "the context", bare = false) {
  const total = entries.reduce((n, e) => n + e.tokens, 0) || 1;
  const groups = new Map();
  for (const p of entries) {
    const g = groups.get(p.group) || { group: p.group, tokens: 0, items: 0, parts: new Map() };
    g.tokens += p.tokens; g.items += p.items;
    const part = g.parts.get(p.part) || { label: p.label, color: p.color, tokens: 0, items: 0 };
    part.tokens += p.tokens; part.items += p.items;
    g.parts.set(p.part, part); groups.set(p.group, g);
  }
  const ordered = [...groups.values()].sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group));
  const pct = (v) => `${(v / total * 100).toFixed(1)}%`;
  const fig = el("figure", { class: "decomp", "aria-label": `How ${what} divides, by ag's own count` });
  const tip = el("div", { class: "tooltip" });
  const show = (seg, ev) => {
    const d = seg._d;
    tip.replaceChildren(el("div", { class: "row" }, el("b", { text: pct(d.tokens) }), el("span", { text: `${full(d.tokens)} tokens` })),
      el("div", { class: "t", text: d.name }), el("div", { class: "t", text: `${full(d.items)} item${d.items === 1 ? "" : "s"}` }));
    tip.style.display = "block";
    const box = fig.getBoundingClientRect(), r = seg.getBoundingClientRect();
    const x = ev && ev.clientX !== undefined ? ev.clientX - box.left : r.left - box.left + r.width / 2;
    tip.style.left = Math.min(Math.max(0, x + 12), box.width - 200) + "px";
    tip.style.top = (r.bottom - box.top + 6) + "px";
  };
  const segment = (d, width) => {
    const seg = el("div", { class: "seg", tabindex: "0", role: "img", style: `width:${width}%;background:${d.color}`,
      "aria-label": `${d.name}: ${full(d.tokens)} tokens, ${pct(d.tokens)} of ${what}, ${d.items} items` },
      el("span", { text: d.short }));
    seg._d = d;
    seg.addEventListener("pointermove", (ev) => show(seg, ev));
    seg.addEventListener("focus", () => show(seg));
    for (const e of ["pointerleave", "blur"]) seg.addEventListener(e, () => { tip.style.display = "none"; });
    return seg;
  };
  const row = (name, tokens, bar) => el("div", { class: "drow" },
    el("div", { class: "dlabel" }, el("span", { text: name }), bare ? null : el("span", { class: "dval", text: `${compact(tokens)} · ${pct(tokens)}` })), bar);
  const whole = el("div", { class: "dbar" });       // the whole context, by kind
  for (const g of ordered) if (g.tokens > 0) whole.append(segment({ name: label(g.group), short: label(g.group), color: color(g.group),
    tokens: g.tokens, items: g.items }, g.tokens / total * 100));
  fig.append(row(bare ? "Kind" : what === "the context" ? "Whole context" : "All calls", total, whole));
  // every kind's parts on one line, each kind where it sits in the line above: a finer split of the whole
  const parts = el("div", { class: "dbar" });
  const zero = [];
  for (const g of ordered) {
    if (g.tokens <= 0) continue;
    const inner = el("div", { class: "dinner", style: `width:${g.tokens / total * 100}%` });
    for (const part of [...g.parts.values()].sort((x, y) => y.tokens - x.tokens)) if (part.tokens > 0)
      inner.append(segment({ name: `${label(g.group)} · ${part.label}`, short: part.label, color: part.color,
        tokens: part.tokens, items: part.items }, part.tokens / g.tokens * 100));
    parts.append(inner);
    for (const p of g.parts.values()) if (!p.tokens) zero.push(`${p.items} ${p.label.toLowerCase()}`);
  }
  const r = row(bare ? "Part" : "By part", total, parts);
  if (zero.length) r.append(el("div", { class: "dzero", text: `also ${zero.join(", ")}, at 0 tokens by ag's count` }));
  fig.append(r);
  fig.append(tip);
  requestAnimationFrame(() => {                     // a label shows only where it fits, in ink that reads on its fill
    for (const seg of fig.querySelectorAll(".seg")) {
      const text = seg.firstChild;
      if (!text || text.scrollWidth > seg.clientWidth - 10) { if (text) text.style.visibility = "hidden"; continue; }
      const m = getComputedStyle(seg).backgroundColor.match(/\d+/g) || [0, 0, 0];
      const lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
      text.style.color = lum > 0.6 ? "#0b0b0b" : "#ffffff";
    }
  });
  return fig;
}
function usageCard() {
  const u = state.agent.usage;
  const card = el("section", { class: "card" }, el("h3", { text: "Tokens sent across all calls" }));
  if (!u || !u.entries || !u.entries.length) { card.append(el("div", { class: "desc", text: "No calls yet." })); return card; }
  const real = u.real_calls ? ` The provider counted ${full(u.real_tokens)} over the ${full(u.real_calls)} calls it reported.` : "";
  card.append(el("div", { class: "desc", text: `Everything sent to the model over this actor's ${full(u.calls)} calls, by kind: `
    + `${full(u.tokens)} tokens by ag's own count, each message (and the harness's preamble) counted once for every call it went in.${real}`
    + (uncounted(u.not_counted) ? ` ${full(u.not_counted)} of the provider's count is in none of them: "Not counted by ag".` : "") }));
  // ag's messages among the history count in the recent raw history, where they sit
  const notCounted = uncounted(u.not_counted) ? [entry({ name: "not counted", tokens: u.not_counted }, NOT_COUNTED, u.real_calls)] : [];
  card.append(decomposition([...u.entries.map((e) => entry(e, INLINE.has(e.group) ? "Recent history" : e.group, e.items)), ...notCounted],
    "all calls"));
  return card;
}
// What an item with no words is: Claude's thinking comes back encrypted (the API reads it, no one else);
// a model's text beside its tool call can be empty.
const wordless = (it) => it.name === "agent_reasoning" ? "thinking, encrypted: not readable" : "no text";
const columns = () => el("div", { class: "cols" }, el("span"), el("span", { text: "Type" }), el("span", { text: "Message" }),
  el("span", { class: "n", text: "Tokens", title: "ag's own count" }));
// what a run's or list's header counts: all its items and tokens, and of them what the type filters leave shown
const tally = (n, shown, tokens, shownTokens, noun = "item") => `${full(n)} ${noun}${n !== 1 ? "s" : ""}`
  + (shown < n ? ` (${full(shown)} shown)` : "") + ` and ${full(tokens)} tokens` + (shown < n ? ` (${full(shownTokens)} shown)` : "");
function contextItem(it) {
  const preview = it.text.replace(/\s+/g, " ").slice(0, 220);
  const typed = (HISTORY.has(it.group) || GATHERER.has(it.group)) && it.group !== PREAMBLE;
  const row = el("details", { class: "item" },
    el("summary", {}, el("span", { class: "bar-key", style: `background:${typed ? itemType(it)[2] : color(it.group)}` }),
      el("span", { class: "mono kind", text: it.name }), el("span", { class: "preview" + (preview ? "" : " none"), text: preview || wordless(it) }),
      el("span", { class: "n", text: full(it.tokens) })));
  row.addEventListener("toggle", () => {             // the whole text, only once asked for
    if (row.open && !row.querySelector("pre")) {
      row.append(el("pre", { text: (it.text || `(${wordless(it)})`) + (it.clipped ? `\n… ${full(it.clipped)} more characters not shown` : "") }));
    }
  });
  return row;
}
function buildsCard(builds) {
  const card = el("section", { class: "card" }, el("h3", { text: `Builds · ${builds.length}` }),
    el("div", { class: "desc", text: "Each analysis of the history: why it started, how long it took, how it ended." }));
  if (!builds.length) { card.append(el("div", { class: "desc", text: "None yet." })); return card; }
  const longest = Math.max(1, ...builds.map((b) => (b.finished || Date.now() / 1000) - (b.started || 0)));
  const table = el("table", {}, el("thead", {}, el("tr", {}, ...["#", "Started", "Reason", "Status", "Duration", ""].map((h, i) => el("th", { class: i === 0 ? "n" : "", text: h })))));
  const body = el("tbody");
  for (const b of [...builds].reverse()) {
    const dur = (b.finished || Date.now() / 1000) - (b.started || 0);
    const st = b.status === "failed" ? ["failed", "Failed"] : b.status === "running" ? ["building", "Running"] : b.status === "ready" ? ["running", "Ready"] : ["idle", b.status === "nothing" ? "Nothing to do" : (b.status || "?")];
    body.append(el("tr", { title: b.error || "" }, el("td", { class: "n", text: b.build_id }), el("td", { text: clock(b.started, true) }), el("td", { text: b.reason || "–" }),
      el("td", {}, statusEl(st[0], st[1])), el("td", { class: "n", text: span(b.started, b.finished || (b.status === "running" ? Date.now() / 1000 : null)) }),
      el("td", { style: "width:35%" }, el("span", { class: "bar", style: `width:${Math.max(2, dur / longest * 100)}%` }))));
    if (b.error) body.append(el("tr", {}, el("td"), el("td", { colspan: 5, class: "desc-cell", text: b.error })));
  }
  table.append(body);
  card.append(el("div", { class: "scroll tall", "data-keep": "builds" }, table));
  return card;
}
function llmCard(a) {
  const card = el("section", { class: "card" }, el("h3", { text: "ag's own model calls" }),
    el("div", { class: "desc", text: "The Gatherer's calls for this actor: new-task checks, segmentation, summaries, ranking." }));
  const rows = a.llm.by_purpose;
  if (!rows.length) { card.append(el("div", { class: "desc", text: "None found in the home's call log." })); return card; }
  const table = el("table", {}, el("thead", {}, el("tr", {}, ...["Purpose", "Calls", "Tokens in", "Tokens out", "Time", "Errors", "Cost"].map((h, i) => el("th", { class: i ? "n" : "", text: h })))));
  const body = el("tbody");
  for (const p of rows) body.append(el("tr", { title: p.models.join(", ") }, el("td", { text: p.purpose }), el("td", { class: "n", text: full(p.calls) }),
    el("td", { class: "n", text: compact(p.tokens_in) }), el("td", { class: "n", text: compact(p.tokens_out) }), el("td", { class: "n", text: `${p.seconds}s` }),
    el("td", { class: "n", text: full(p.errors) }), el("td", { class: "n", text: usd(p.cost) + (p.unpriced ? "*" : "") })));
  const t = a.llm.total;
  body.append(el("tr", { class: "total" }, el("td", { text: "Total" }), el("td", { class: "n", text: full(t.calls) }), el("td", { class: "n", text: compact(t.tokens_in) }),
    el("td", { class: "n", text: compact(t.tokens_out) }), el("td"), el("td", { class: "n", text: full(t.errors) }), el("td", { class: "n", text: usd(t.cost) })));
  table.append(body);
  card.append(el("div", { class: "scroll" }, table));
  if (t.unpriced) card.append(el("div", { class: "warn", text: `* ${t.unpriced} calls on models LiteLLM has no price for are not in the cost.` }));
  if (a.llm_attributed_by_time) card.append(el("div", { class: "warn", text: `${a.llm_attributed_by_time} calls predate job tags and were matched to this actor by time.` }));
  return card;
}

