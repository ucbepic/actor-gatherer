import { SNAPSHOT, state } from "../../core/page/state.js";
import {
  ICONS, ago, el, harnessName, hasChat, parseKey, post, runnableNames, signature,
} from "../../core/page/helpers.js";
import { drafts, fitBox, keepDraft, setLive } from "../page/data.js";
import { keepingPlace } from "../settings/panel.js";
import { turnStatus } from "../list/seen.js";
import { DETAILS_TIP, renderMain, setDetails } from "../page/main-view.js";
import { shellSpan } from "../../core/page/code.js";
import { SHAPES, str, summary } from "../transcript/transcript.js";
import { plural } from "../../core/format";
import { CHAT_VIEWS, chatFeed, chatView, offeredViews, setChatView } from "./views.js";
import { CHAT_HOST, boxedFor, chatActor, sendFrom, setFilesTurn } from "./files-view.js";
import { MINI_VIEW, MIN_TIP, canMinimize, chatMin, setChatMin } from "../layout/top.js";
import { agDashboard } from "./own-views.js";
import { TASK_KINDS } from "./side/marks";
import { askKey, askWhere as askWhereOf } from "./asking/ask";
import { chatOf } from "./actors";
import { drawControls } from "./Controls";
import { refill } from "./esc";
import { send } from "./send";
import { drawSendError } from "./SendError";
import { drawCards } from "./asking/mount";

// ------------------------------------------------------------------ the chat
// The actor's history, as the chosen chat view draws it (chat views, below), in a frame that follows
// its newest and takes all the height there is; then what was sent and waits for the turn to end; then
// the box to write the next. A session not started here is resumed by the dashboard on its first message
// (in the directory its calls named); while another process has it open -- a terminal -- the box is off
// (`ctx.held`). An actor that cannot be messaged from here at all (a harness the dashboard does not run, or no directory; or
// a snapshot) has its history and no box; so has every actor in a view to read it by (`readOnly`: the ones in Details).
// Why an actor cannot be messaged from here, said the same in every view (the Chat's foot, the Terminal's cover): one
// the dashboard cannot run at all (a harness it does not run, or no directory: hasChat false) -- which closing a process
// would not change -- else one that can, but that another process has open (data.py's chattable false), else none.
const readOnlyWhy = () => `Read only. Only ${runnableNames("and")} sessions with a known directory can be messaged here.`;
const heldWhy = (info) => hasChat(info) && info.chattable === false
  ? `Open in another process${info.holder ? ` (PID ${info.holder.pid})` : info.pid ? ` (PID ${info.pid})` : ""}. `
    + "Close it there to message it here." : "";
function chatCard(info) {
  const actor = chatActor();                         // the actor this page shows, by its key: all below is its
  const s = info.session || { cwd: info.cwd, permission_mode: "auto", queued: [], status: "stopped" };
  const view = chatMin() ? MINI_VIEW : chatView(), feed = chatFeed(view);
  const writable = hasChat(info) && !SNAPSHOT && !view.readOnly;
  const held = heldWhy(info);
  const data = feed.data() || { items: [], pending: [], earlier: false };
  const ctx = { actor, info, session: s, data, running: ["running", "building"].includes(turnStatus(info)[0]), queued: s.queued || [], held, writable,
    loadEarlier: async () => {                         // the view's "earlier" control: kept where the reader was
      if (!feed.loadEarlier) return;
      const n = document.getElementById("chat-list"), from = n ? n.scrollHeight - n.scrollTop : 0;
      await feed.loadEarlier(); renderMain();
      const m = document.getElementById("chat-list"); if (m) m.scrollTop = m.scrollHeight - from;
    },
    rerender: () => keepingPlace(renderMain), api: agDashboard };
  const card = el("section", { class: "chat" + (view.mini ? " mini" : ""), "aria-label": `${harnessName(info.harness || (state.agent && state.agent.harness))} · ${parseKey(actor).group}`,
    "data-morph": "", "data-for": signature([actor, view.id, writable, held, !!info.session]) });
  const safely = (what, fallback) => {
    try { return [].concat(what() || []); }
    catch (err) { console.error(err); return fallback ? [el("div", { class: "warn", text: `The ${view.name} view failed: ${err.message}` })] : []; }
  };
  // its controls go in the page's header (features/chat/Controls.tsx): the view's own (tools: Chat's its own), which
  // view, and the details panel. Minimized: the head hidden, kept as it was.
  const tools = view.chatTools ? [] : safely(() => view.tools && view.tools(ctx));
  if (!view.mini) drawControls(document.getElementById("controls"), {
    actor, chat: !!view.chatTools, tools: tools.length ? tools : null,
    views: offeredViews().filter((v) => !v.more || v.id === view.id)
      .map((v) => ({ id: v.id, name: v.name, description: v.description, icon: v.icon })),
    current: view.id, details: !!state.details, minimize: canMinimize() ? { title: MIN_TIP } : null, detailsTitle: DETAILS_TIP,
    icons: ICONS, show: (id) => setChatView(id), toggleDetails: () => setDetails(!state.details), doMinimize: () => setChatMin(true),
    latest: () => setFilesTurn(null) });
  // a view that draws its frame itself (the Chat view: React's, features/chat/mount.tsx), the same node from draw to draw
  const mounted = view.mount ? safely(() => view.mount(ctx), true) : null;
  const frame = mounted && mounted[0] && mounted[0].id === "chat-list" ? mounted[0]
    : el("div", { class: `chat-frame ${view.frame ?? "ctx"}`, id: "chat-list", "data-keep": "chat-list", "data-follow": "1", "data-morph": "",
      role: "log", "aria-label": `Chat history, ${view.name}` });
  // its blocks, put in by patch(): a block kept from the last draw is still on the page, and is left there
  const blocks = frame === (mounted && mounted[0]) ? [] : frame.kids = mounted || safely(() => view.render(ctx), true);
  if (view.feed !== "none" && view.chat !== false) {  // a view that draws the history: what waits, or that there is none yet
    if (view.queued !== false) for (const q of ctx.queued) blocks.push(el("div", { class: "queued", text: `Waiting for the turn to end: ${q}` }));
    if (!data.items.length && !data.pending.length && !ctx.queued.length && !view.greets)
      blocks.push(el("div", { class: "desc", text: SNAPSHOT ? "A snapshot has no conversation. Run `ag dashboard` live to see it."
        : s.status === "starting" ? "Starting the agent…" : writable ? "No messages yet. Write one below." : "No messages yet." }));
  }
  // a node of the view's own that is on the page now (the Chat view's frame and message box: React's) held apart from
  // the card being built, a stand-in in its place (`kids`): building the card does not take it from the page --
  // patch() finds it where it is, and leaves it there, its focus, caret and scroll with it
  const away = new Map();
  const put = (...ns) => card.append(...ns.filter((n) => n !== null && n !== undefined).map((n) => {
    if (n.nodeType !== 1 || !n.isConnected) return n;
    const stand = el("i");
    away.set(stand, n);
    return stand;
  }));
  const built = () => {
    if (away.size) { card.kids = [...card.childNodes].map((n) => away.get(n) || n); card.replaceChildren(); }
    return card;
  };
  if (!view.mini) put(frame);
  if (view.chat === false) {                         // not the conversation: no message box, and no word that there is none
    put(...safely(() => view.footer && view.footer(ctx)));
    return built();
  }
  if (view.feed !== "none" && view.asking !== false) {          // the terminal shows it itself
    const note = cardNode(info, !view.readOnly); if (note) put(note); }
  if (view.background) { const note = backgroundNote(info); if (note) put(note); }
  if (!writable) {
    // one line, even in a narrow pane: the whole reason in its tooltip (and on the Terminal's cover, which has room)
    if (!SNAPSHOT && !view.readOnly) put(el("div", { class: "readonly", title: readOnlyWhy(), text: "Read only. Can't be messaged from here." }));
    put(...safely(() => view.footer && view.footer(ctx)));
    return built();
  }
  // Sending, for every view's message box (features/chat/send.ts): the box is the view's (`composer`); what it sends,
  // the error it gets (features/chat/SendError.tsx) and the message the harness took back (esc.ts's refill) the actor's.
  refill(actor, info, boxedFor(actor));
  // A message box kept from an earlier draw (`patch`) still calls the send it was drawn with: each send goes to the
  // latest draw's (state.chatSend), which knows the session as it is now.
  ctx.send = (t) => state.chatSend(t);
  state.chatSend = (t) => send(actor, t, sendFrom(actor, info, held));
  state.chatSend.draft = actor;                      // whose it is: a new tab's first message sent by it (features/layout/new-tab.js)
  // The text box a composer is built around: Enter sends it, Shift+Enter starts a new line, and what is
  // typed in it survives the tab being drawn again (keepingPlace finds it by its id), and the reader going to another
  // actor or view and back (it starts with the actor's draft). A line high, growing with the lines typed (fitBox).
  ctx.input = (attrs = {}) => {
    const box = el("textarea", { rows: "1", placeholder: "Message the actor", "aria-label": "Message the actor", title: "Enter sends · Shift+Enter for a new line",
      enterkeyhint: "send", ...attrs, id: "composer-text", "data-draft": actor,
      ...(held ? { disabled: "", placeholder: "Open in another process" } : {}) });
    box.value = drafts()[actor] || "";
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
            fitBox(box); keepDraft(actor, box.value);
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
    if (box) box.dataset.sig = signature([actor, !!held]);
    if (box && box !== n) n.dataset.morph = ""; else if (!box) n.dataset.sig = sig;
  }
  // why nothing is sent, or the last message was not (React's, the actor's own: features/chat/SendError.tsx)
  const err = drawSendError({ actor, held, session: s, toTerminal: CHAT_VIEWS.has("terminal") ? () => setChatView("terminal") : null });
  put(...composer, err, ...safely(() => view.footer && view.footer(ctx)));
  if (held || chatOf(actor).sending) for (const n of card.querySelectorAll("[data-send], #composer-text")) if (held || n.matches("[data-send]")) n.disabled = true;   // whatever the view drew
  return built();
}
// What the harness still runs in the background for the actor (data.py's `background`): the commands,
// agents, monitors and workflows it started and has not been told have ended, each with what it is for and its
// last sign of life. Null when none runs. `term`: drawn as a terminal's status line.
function backgroundNote(info, term = false) {
  const tasks = (info && info.background) || [];
  if (!tasks.length) return null;
  return el("div", { class: term ? "status-line bg-tasks" : "bg-tasks", role: "status" },
    el("div", { class: "head" }, el("span", { class: "mark", "aria-hidden": "true" }),
      `${plural(tasks.length, "background task")} running${info.status === "background" ? " after the turn ended" : ""}`),
    ...tasks.map((t) => el("div", { class: "task", title: [t.label, t.output].filter(Boolean).join("\n") },
      el("span", { class: "kind", text: TASK_KINDS[t.kind] || t.kind }),
      el("span", { class: "label", text: t.label || t.id }),
      el("span", { class: "when", text: [`started ${ago(t.started)}`,
        t.event ? `last event ${ago(t.event_at)}: ${t.event}` : t.active && t.active - t.started > 2 ? `active ${ago(t.active)}` : null]
        .filter(Boolean).join(" · ") }))));
}
// The cards under an actor's history: the model call its turn stopped on, or keeps failing on; what the agent waits on
// the user for (answered here where the dashboard runs its terminal, unless `answerable` is false: a view to read by); an
// answer recorded otherwise than picked. React's (features/chat/asking/), each a node of its own kept from draw to draw;
// null while there is none. `only`: that card alone (the reader's own views ask for each: agDashboard).
const cardNode = (info, answerable = true, only) => !info ? null : drawCards(`${info.channel}\u0000${only || ""}\u0000${answerable}`,
  { info, home: state.home, answerable, snapshot: !!SNAPSHOT, terminalView: CHAT_VIEWS.has("terminal"), host: CHAT_HOST }, only);
const askingNote = (info, answerable = true) => cardNode(info, answerable, "asking");
const errorNote = (info) => cardNode(info, true, "error");
const answeredNote = (info) => cardNode(info, true, "answered");
// Where what an actor asks is answered (features/chat/asking/ask.ts): from the page, or in its terminal only.
const askWhere = (info, ask) => askWhereOf(info, ask, state.home, !!SNAPSHOT);
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
// The message box a view gets unless it brings its own: a text box, Enter sending it.
function defaultComposer(ctx) {
  const text = ctx.input();
  const form = el("form", { class: "composer" }, text);
  form.addEventListener("submit", (ev) => { ev.preventDefault(); ctx.send(text.value); });
  return form;
}
const chatAtEnd = () => { const n = document.getElementById("chat-list"); return !!n && n.scrollHeight - n.scrollTop - n.clientHeight < 40; };
const chatToEnd = () => { const n = document.getElementById("chat-list"); if (n) n.scrollTop = n.scrollHeight; };
export {
  TASK_KINDS, answeredNote, askKey, askWhere, askingNote, backgroundNote, chatAtEnd, chatCard, chatToEnd, errorNote,
  permissionVerb, permissionView, readOnlyWhy,
};
