import { panes, state } from "../../core/page/state.js";
import { ICONS, el, signature, strokeIcon } from "../../core/page/helpers.js";
import { render } from "../page/data.js";
import { connect } from "../settings/panel.js";
import { closeShell, firstAgent, isHidden } from "../list/list";
import { select } from "../list/modes";
import { closeHere, closePane, savePanes } from "../layout/panes.js";
import { termFor, termListen, termWebgl } from "./terminal.js";

// ------------------------------------------------------------------ a shell
// A shell (isShell) in its pane: its terminal, drawn as a session's is (`term`), and nothing else -- no views, no details,
// no message box -- but, in the pane's head, its Terminate button: the shell ended, whatever runs in it, as by the list's ×.
// Not the pane's own ×, split, which closes the pane alone, the shell running on under its gatherer. Its button opened it
// (startShell), so here it is only listened to. Once it ends -- exited, or terminated -- its pane closes, as a terminal's
// window does (shownGone).
function shellCard(p, id) {
  const end = el("button", { type: "button", class: "terminate", "data-shell": id, "aria-label": "Terminate shell",
    title: "End the shell and everything running in it",
    onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; await closeShell({ id }); b.disabled = false; } },
    strokeIcon(ICONS.power, 14), "Terminate");
  const controls = p.controls;                       // kept as it is while the same: no flash under the pointer
  if (!(controls.children.length === 1 && controls.firstElementChild.isEqualNode(end))) controls.replaceChildren(end);
  const t = termFor(id);
  termListen(id);
  requestAnimationFrame(() => {                      // drawn into the page: opened there once, then fitted to it
    if (!t.host.isConnected) return;
    if (!t.opened) { t.xterm.open(t.host); t.opened = true; termWebgl(t); t.xterm.focus(); }
    try { t.fit.fit(); } catch (e) { /* not shown */ }
  });
  const frame = el("div", { class: "chat-frame xterm-frame", "data-morph": "" });
  frame.kids = [t.host];                             // put in by patch(): the same node each draw
  return el("section", { class: "chat", "aria-label": "Terminal", "data-morph": "", "data-for": signature([id]) }, frame);
}
// The shell a pane shows ended, or the actor it shows discarded (discardSession): its pane closed -- this page's own, the
// next pane's actor moved into it, or with none, its gatherer's actor shown (firstAgent), else the first gatherer's.
function shownGone(sid) {
  for (const p of [...panes.others]) if (p.c === sid) closePane(p);
  if (!state.selected || state.selected[1] !== sid) return;
  if (panes.others.length) return closeHere();
  const shown = state.home ? state.home.gatherers.filter((g) => g.agents.length && !isHidden(g)) : [];
  const g = shown.find((x) => x.name === state.selected[0]) || shown[0];
  if (g) return select(g.name, firstAgent(g).channel);
  state.selected = null;
  savePanes(); connect(); render(true);
}

export { shellCard, shownGone };
