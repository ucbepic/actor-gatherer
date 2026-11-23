// THE TOP ROW, as the actors' panes see it: above the panes, the apps' panels (app-panels.ts): whether it shows any
// (topShown), and each pane's chat MINIMIZED under what is above it, each on its own (work.ts): only its message box, right
// of it the conversation's last two lines -- the actor's avatar, small and still, on its own (features/chat/
// mini-history.js) -- and its ×; what is above or below it the rest. Offered where something of its task is above or below
// it; kept in its task's arrangement (the tab shown), so it is minimized again there; moved where nothing is, shown whole.
// The parts a minimized pane draws in place of its own (its footer, a shell's strip) are nodes Chat's card puts in and
// patches (features/chat/chat.js, features/page/main-view.js): built here as nodes, till Chat's card is React's.
import * as prefs from "../../core/prefs";
import { shellOf, shellPath } from "./heads";
import { L, panes, snap, type MiniCtx } from "./link";
import { allPanes } from "./open";
import type { Actor, Pane } from "./types";
import { placeIfShown, placeWork, workPlacer } from "./work-area";

/** Whether the top row shows any app's panel. */
export const topShown = (): boolean => !!panes.apps && panes.apps.some((p) => !p.held);
/** Drawn with a pane's view: the work area placed again if what it shows changed (another actor shown in a pane). */
export function topMount(): void {
  if (snap()) return;
  placeIfShown();
}
// A panel opened or closed in the top row: each pane drawn again (its head put in its Chat bar, or not).
let topWas: boolean | null = null;
export function topChanged(): void {
  if (snap()) return;
  placeWork();
  L.seen.markSeen(); // an app's panel shown: its notifications seen
  const now = topShown();
  if (now === topWas) {
    for (const p of allPanes()) L.mainView.drawPane(p);
    return;
  }
  topWas = now;
  for (const p of allPanes()) void minRedraw(p);
}
export const MIN_TIP = "Minimize chat";
export const chatMin = (p: Pane | null | undefined): boolean =>
  !snap() && !!p && !!workPlacer && workPlacer.isMin(p.node);
export const canMinimize = (p: Pane | null | undefined): boolean =>
  !snap() && !!p && !chatMin(p) && !!workPlacer && workPlacer.canMin(p.node);
export function setChatMin(p: Pane, on: boolean): void {
  workPlacer?.setMin(p.node, on); // drawn so as it is placed (minChanged: paneMinimized)
}
/** A pane minimized now, or shown whole again: drawn so. */
export function paneMinimized(node: HTMLElement): void {
  const p = allPanes().find((q) => q.node === node);
  if (p) void minRedraw(p);
}
/** Pane `p` minimized or shown again: its counts are the latest turn's, from the files' feed (chatFeed) -- then, shown
 * again, its view's own feed. Shown whole again, drawn so at once, with what it has, then again once loaded: not only once
 * its feed has loaded, which a busy page or server can hold up for seconds, the pane placed whole meanwhile with its
 * minimized strip in it. Minimized, drawn once loaded: its strip drawn at once would grow as its last lines come, and the
 * line above it move under a pointer about to press it. */
async function minRedraw(p: Pane): Promise<void> {
  const files = p.files as { key: string } | null; // (Chat's files feed: the actor it is for)
  if (chatMin(p) && files && L.chat.chatOf(files.key).picked !== null) L.chat.showTurn(files.key, null);
  topMount();
  if (!chatMin(p)) L.mainView.drawPane(p);
  await L.data.loadChat(p);
  L.mainView.drawPane(p);
  if (!chatMin(p)) L.chat.chatToEnd(p);
}
/** The view a minimized pane draws in place of its own (chatCard): no conversation, the message box, and miniFoot. */
export const MINI_VIEW = {
  id: "mini",
  name: "Chat",
  feed: "files",
  mini: true,
  background: false,
  queued: false,
  greets: true,
  render: () => [],
  footer: (ctx: MiniCtx) => miniFoot(ctx),
};
const el = (tag: string, attrs: Record<string, unknown> = {}, ...kids: (Node | string | null | undefined)[]) =>
  L.helpers.el(tag, attrs, ...kids);
const icon = (name: string, size: number) => L.helpers.strokeIcon(L.helpers.ICONS[name], size);
// the way back, at a minimized terminal's left (an actor's has none: its lines, or its avatar, pressed, are)
const miniBack = (p: Pane) =>
  el(
    "button",
    {
      type: "button",
      class: "mini-back",
      title: "Show the terminal again",
      "aria-label": "Show the terminal again",
      onclick: () => setChatMin(p, false),
    },
    icon("restore", 14),
  );
// its pane's × (its head, hidden while minimized, has it: pane.ts), at its far right
const miniClose = (p: Pane) => {
  const x = p.close;
  return el(
    "button",
    { type: "button", class: "mini-x", title: x.title, "aria-label": x.title, onclick: () => x.click() },
    icon("x", 16),
  );
};
// right of the box, the conversation's last two lines (features/chat/mini-history.js), hovered: the whole of it -- pressed,
// the chat shown again -- the line between them dragged (miniGrip); none shown (no turn yet, or a pane too narrow for
// them: top.css), the actor's avatar alone does that
const miniFoot = (ctx: MiniCtx): Node[] => {
  const lines = L.mini.miniHistory(ctx);
  return [
    lines,
    lines ? miniGrip() : null,
    miniMe(ctx.pane, ctx.info, L.mini.miniRest(ctx)),
    miniClose(ctx.pane),
  ].filter((n): n is Node => !!n);
};
// THE ROOM BETWEEN THE BOX AND THE LINES: the line between them dragged, the box's share of the room the two take (two
// parts in five at first; the box 150px at the least, the lines 140px) -- one for every minimized pane, kept in this
// browser, each page told when another changes it (storage); double-clicked, as it was. Each page's root holds it
// (--mini-box, --mini-hist: top.css), in thousandths: a share under 1fr alone -- the lines', the box held at its least --
// would leave the rest of the room empty. The grip is made again at each draw, the same each time, so the draw keeps it
// (patch); a drag is the page's, not the grip's -- followed on the page itself -- so a grip drawn again under it does not
// end it; every minimized pane's lines move with it. The apps' frames let the pointer by meanwhile: one passed over would
// take it.
const MINI_SPLIT_KEY = "ag-dashboard-mini-split",
  MINI_BOX_MIN = 150,
  MINI_LINES_MIN = 140;
function setMiniSplit(f: number): void {
  const r = document.documentElement.style,
    n = Math.round(f * 1000);
  if (n > 0 && n < 1000) {
    r.setProperty("--mini-box", `${n}fr`);
    r.setProperty("--mini-hist", `${1000 - n}fr`);
  } else {
    r.removeProperty("--mini-box");
    r.removeProperty("--mini-hist");
  }
}
const keptMiniSplit = () => Number(prefs.text(MINI_SPLIT_KEY)) || 0;
const miniGrip = () =>
  el("div", {
    class: "mini-grip",
    "aria-hidden": "true",
    title: "Drag to resize · double-click to reset",
    onpointerdown: miniGripDown,
    ondblclick: () => {
      setMiniSplit(0);
      prefs.drop(MINI_SPLIT_KEY);
    },
  });
function miniGripDown(ev: PointerEvent): void {
  const grip = ev.currentTarget as HTMLElement,
    strip = grip.closest(".chat.mini");
  const box = strip?.querySelector(":scope > :is(.composer, .readonly)"),
    lines = strip?.querySelector(":scope > .mini-hist");
  if (ev.button !== 0 || !box || !lines) return;
  ev.preventDefault();
  try {
    grip.setPointerCapture(ev.pointerId);
  } catch {
    /* followed on the page all the same */
  }
  L.mini.miniCard.shut();
  const left = box.getBoundingClientRect().left,
    b = lines.getBoundingClientRect(),
    room = b.right - left,
    from = ev.clientX,
    was = b.left - left;
  // a drag on the page (its frames letting the pointer by), and the pane whose line it is (its line drawn as dragged:
  // top.css)
  const pane = grip.closest<HTMLElement>(".pane"),
    root = document.documentElement;
  let f: number | null = null;
  root.dataset.miniDrag = "on";
  if (pane) pane.dataset.miniDrag = "here";
  const move = (e: PointerEvent) => {
    if (!(e.buttons & 1)) {
      end(); // let go where the page did not see it
      return;
    }
    const w = Math.max(MINI_BOX_MIN, Math.min(room - MINI_LINES_MIN, was + e.clientX - from));
    f = Math.round((w / room) * 1000) / 1000;
    setMiniSplit(f);
  };
  const end = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", end);
    document.removeEventListener("pointercancel", end);
    delete root.dataset.miniDrag;
    if (pane) delete pane.dataset.miniDrag;
    if (f !== null) prefs.setText(MINI_SPLIT_KEY, String(f));
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
}
// The actor's avatar, small and still -- a mark at its corner while it asks the reader or stopped on an error, its turn
// over (`rest`: features/chat/mini-history.js's miniRest) a green check, as Chat's done avatar -- on its line of the
// history (mini-history.js's meIcon, meDone), or alone right of the box (miniFoot); no avatar, the way back's icon.
export const ME_MARKS: Readonly<Record<string, readonly [string, string]>> = {
  asking: ["ask", "?"],
  error: ["err", "!"],
  failed: ["err", "!"],
};
export const meMark = (m: readonly [string, string] | undefined | null): HTMLElement | null =>
  m ? el("span", { class: "mk " + m[0], text: m[1] }) : null;
function miniMe(p: Pane, info: Actor | null, rest: { row_id?: number | null } | null): HTMLElement {
  const src = L.helpers.bareAvatar(info),
    [st, word] = info ? L.seen.statusOf(info) : ["", ""],
    says = `${rest ? "Done" : word}. Show the chat`;
  return el(
    "button",
    {
      type: "button",
      class: "mini-me" + (rest ? " at-rest" : ""),
      title: says,
      "aria-label": says,
      style: rest ? `--r: ${L.helpers.restDelay(info, rest.row_id)}` : null,
      onclick: () => setChatMin(p, false),
    },
    src ? el("img", { src, alt: "", draggable: "false" }) : icon("restore", 14),
    rest ? el("span", { class: "mk ok" }, L.helpers.doneCheck()) : meMark(ME_MARKS[st]),
  );
}
/** A shell's pane, minimized: what it is, and the way back. */
export function shellMini(p: Pane, id: string): HTMLElement {
  const sh = shellOf(id);
  return el(
    "section",
    { class: "chat mini shell", "aria-label": "Terminal", "data-for": JSON.stringify([id, "mini"]) },
    miniBack(p),
    el(
      "span",
      { class: "mini-sh" },
      icon("terminal", 13),
      el("span", { text: sh ? `Terminal · ${shellPath(sh)}` : "Terminal" }),
    ),
    miniClose(p),
  );
}
/** What this module did as the page's script ran, in that order: page.js runs it once every module is loaded. */
export function start(): void {
  setMiniSplit(keptMiniSplit());
  window.addEventListener("storage", (ev) => {
    if (ev.key === MINI_SPLIT_KEY || ev.key === null) setMiniSplit(keptMiniSplit());
  });
}
