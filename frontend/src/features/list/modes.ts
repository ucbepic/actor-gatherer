// ------------------------------------------------------------------ the list folded, or over the whole page
// The list's shape, kept in this browser: "list"; folded to a rail ("folded"), the actors at work or wanting the reader
// as their avatars; or over the whole page ("full"), the monitor (monitor.ts) -- left again for the shape it came from
// (listFrom), by its button, by Esc, or by picking an actor there. Over the whole page, the panes stay under it as they
// are: their terminals not resized, nor typed into. And the list HIDDEN, whatever its shape, sliding out when wanted.
import { isShell } from "../../core/model/keys";
import * as prefs from "../../core/prefs";
import { cardDraw, cardHide, hover, start as startCard } from "./hover-card";
import { listDrag, markDragged } from "./drag";
import { isOpenFolder, toggleFolder } from "./folders";
import type { ListButtonsInfo } from "./host";
import { L, S, inPane, snap } from "./link";
import { CTX, listView, renderAgents } from "./list";
import { LIST_HOST } from "./list-host";
import { folderKey } from "./model";
import { drawFullButton, drawListButtons as drawButtonsIn, drawRail, drawTotals as drawTotalsIn } from "./modes-mount";
import { monForget, renderMonitor } from "./monitor-feed";
import { markSeen } from "./seen";
import type { RailHost } from "./Rail";
import { buildRail, type RailAt } from "./rail-model";
import type { Totals } from "./groups";

const LIST_KEY = "ag-dashboard-list";
type Mode = ListButtonsInfo["mode"];
export let listMode: Mode = "list";
let listFrom: Mode = "list";
export function setListMode(to: string | null | undefined, keep = true): void {
  let mode = to as Mode;
  if (inPane() || !["list", "folded", "full"].includes(mode)) mode = "list";
  if (mode === "full" && listMode !== "full") listFrom = listMode;
  const was = listMode;
  listMode = mode;
  const root = document.documentElement;
  root.classList.toggle("list-folded", mode === "folded");
  root.classList.toggle("list-full", mode === "full");
  root.classList.toggle("list-was-folded", mode === "full" && listFrom === "folded"); // the panes as wide as they were
  drawListButtons();
  if (keep) prefs.keep(LIST_KEY, { mode, from: listFrom });
  if (mode === "full" && was !== "full") {
    // what had the keys -- a terminal, a pane's frame -- has them no more
    const at = document.activeElement as HTMLElement | null;
    if (at && at !== document.body && at.closest(".panes")) at.blur();
    document.getElementById("monitor")!.focus({ preventScroll: true });
  }
  if (mode !== "full") monForget();
  if (S().home) renderAgents();
}
// A column's width, dragged at its edge (grip): set as node's prop, at least min (its most: the stylesheet's max), kept
// under key; at(x) is the width the pointer at x gives. A double click: the stylesheet's width again.
function widthGrip(
  grip: HTMLElement,
  key: string,
  node: HTMLElement,
  prop: string,
  min: number,
  at: (x: number) => number,
) {
  const set = (w: number) =>
    w > 0 ? node.style.setProperty(prop, `${Math.round(Math.max(min, w))}px`) : node.style.removeProperty(prop);
  set(Number(prefs.text(key)));
  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    const box = document.getElementById("panes")!;
    grip.classList.add("on");
    box.classList.add("resizing"); // the frames let the pointer by while it drags
    const move = (e: PointerEvent) => set(at(e.clientX));
    const up = () => {
      grip.classList.remove("on");
      box.classList.remove("resizing");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      prefs.setText(key, String(parseInt(node.style.getPropertyValue(prop)) || ""));
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => {
    set(0);
    prefs.drop(key);
  });
}
// its buttons (ListButtons.tsx), as the list is: folded (or open again), and hidden (or kept open); none over the whole
// page -- at the list's head, and over the rail; and every actor over the whole page (or back), in the top bar
export const listButtonsInfo = (): ListButtonsInfo => ({ mode: listMode, hidden: listHidden, pane: inPane() });
function drawListButtons() {
  drawButtonsIn(document.getElementById("list-btns")!, listButtonsInfo(), LIST_HOST);
  drawFullButton(document.getElementById("top-full")!, listMode === "full", (full) =>
    full ? setListMode("full") : leaveFull(),
  );
}
// THE LIST HIDDEN (its button; kept in this browser), whatever its shape (the list, the rail): out of the way at once,
// the panes the page's whole width, a thin edge at the page's left. The pointer on that edge, or on the top bar's counts
// (#top-totals, drawTotals: what the list is for; or the keys in the list), it slides out over the panes, and stays
// while the pointer is on it -- still or moving -- or on those counts, a menu or card of it, a name is typed in it or a
// row dragged from it; it slides back a moment after the pointer has left (the counts too: a moment to get from them
// down to the list, though the rail is narrower than where they sit). Where the pointer is, is asked of the page at its
// last place (elementFromPoint): a list slid in under a still pointer is under it, though the browser's own hover may
// not say so till it moves -- and a pointer over a pane's frame moves unseen.
// Out over the panes, it floats over them (class "floats": features/apps/native.ts). In the ag app, a Browser's own page
// there is drawn over everything of the dashboard's, the list too, till the app has put it out of sight under a picture
// of it -- taken, sent to its panel and drawn there, which takes longer than the slide. So the list slides out once the
// pages under where it goes are out of sight (COVER_WAIT at the most), and they stay so till it has slid back (SLIDE_MS:
// its slide's time, features/page/layout.css). `peekAt`: "in"; "covering" (floating, the pages being put out of sight,
// it not out yet); "out" (list-peek); "back" (sliding back, the pages under it still covered).
const HIDE_KEY = "ag-dashboard-list-hidden",
  UNPEEK_MS = 300,
  SLIDE_MS = 160,
  COVER_WAIT = 400;
let listHidden = false,
  peekTimer: ReturnType<typeof setTimeout> | undefined;
let peekAt: "in" | "covering" | "out" | "back" = "in",
  peekCancel = () => {},
  backTimer: ReturnType<typeof setTimeout> | undefined;
const pointerAt = { x: -1, y: -1 };
export function setListHidden(on: boolean, keep = true): void {
  listHidden = !!on && !inPane();
  document.documentElement.classList.toggle("list-hidden", listHidden);
  peekList(false); // pressed to hide it: hidden now, out again at the edge
  drawListButtons();
  if (keep) prefs.setText(HIDE_KEY, listHidden ? "1" : "");
  if (S().home) renderAgents(); // its head's buttons as it is now
}
function peekList(on: boolean) {
  const root = document.documentElement,
    side = document.querySelector(".side")!;
  if (on && listHidden) {
    if (peekAt === "covering") return; // (its way back kept: the pointer gone before it is out)
    clearTimeout(peekTimer);
    if (peekAt === "out") return;
    clearTimeout(backTimer);
    side.classList.add("floats");
    if (peekAt === "back") {
      peekAt = "out"; // (the pages under it covered still)
      root.classList.add("list-peek");
    } else {
      peekAt = "covering";
      peekCancel = L.native.onceUncovered(side, COVER_WAIT, () => {
        peekAt = "out";
        root.classList.add("list-peek");
      });
    }
    unpeekSoon(); // (left again at once, never come onto it: back too)
    return;
  }
  clearTimeout(peekTimer);
  peekCancel();
  root.classList.remove("list-peek");
  clearTimeout(backTimer);
  if (peekAt === "out" && listHidden) {
    peekAt = "back";
    backTimer = setTimeout(() => {
      side.classList.remove("floats");
      peekAt = "in";
    }, SLIDE_MS);
  } else {
    side.classList.remove("floats");
    peekAt = "in";
  }
}
// in use: the pointer on it (or a menu or card of it), a name typed in it, a row dragged from it
function listInUse() {
  if (listDrag || document.querySelector(".row-menu, .side :is(input, textarea, [contenteditable]):focus")) return true;
  const at = pointerAt.x < 0 ? null : document.elementFromPoint(pointerAt.x, pointerAt.y);
  return !!(at && at.closest(".side, .list-edge, #top-totals, .row-menu, #actor-card"));
}
function unpeekSoon() {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (listInUse()) unpeekSoon();
    else peekList(false);
  }, UNPEEK_MS);
}
export const leaveFull = (): void => setListMode(listFrom === "full" ? "list" : listFrom);
// The list in the shape it is in: the rail, or the monitor, drawn from the home (the list itself is drawn all the same).
export function renderFolded(): void {
  if (listMode === "folded") renderRail();
  else if (listMode === "full") renderMonitor();
  if (hover.from === "rail" && listMode !== "folded") cardHide();
}
// The rail: the list, small (Rail.tsx, from rail-model.ts's model). Each gatherer not hidden, its name over its actors --
// a button folding it, as the list's does; hovered, its card has its buttons (CardFolder.tsx) -- then its box as the
// list has it: its folders folded to their names and counts, or open in place; its saved and closed lines, as the
// reader checks at its foot (railShow); its actors' tiles. A double-click on a gatherer's or folder's name shows only it
// (railDrill). Dragged (every selected one with it) onto a folder's name, a gatherer's, the name drilled into or a step
// of the path over it, an actor moves there (railDragged).
// The rail drilled into a gatherer or a folder: only the tree from there, under "Up" and "Root". `railAt`: {g, f} (a
// gatherer's name, a folder's id; f null: the gatherer's top), or null: every gatherer. Kept across reloads; gone (a
// folder deleted, a gatherer hidden): its gatherer's top, or every gatherer.
const RAIL_AT_KEY = "ag-dashboard-rail-at";
export let railAt: RailAt | null = (() => {
  const v = prefs.json(RAIL_AT_KEY) as { at?: RailAt } | null;
  return v && v.at && typeof v.at.g === "string" ? v.at : null;
})();
let railMoved = false; // stepped in or out: the rail drawn from its top
export const sameAt = (x: RailAt | null, y: RailAt | null): boolean =>
  (!x && !y) || (!!x && !!y && x.g === y.g && x.f === y.f);
function railGo(at: RailAt | null) {
  railAt = at;
  railMoved = true;
  prefs.keep(RAIL_AT_KEY, { at: railAt });
  cardHide();
  renderRail();
}
export const railDrill = (at: RailAt): void => {
  if (!sameAt(at, railAt)) railGo(at);
};
// In the page's top bar, beside its logo, whatever shape the list is in: every shown group's actors open, counted by
// what they do (Totals.tsx draws them; `t`, groups.ts's totals, the list's view-model's). The whole home's, wherever the
// list or the rail is, so what needs the reader elsewhere still shows.
export const drawTotals = (t: Totals): void => drawTotalsIn(document.getElementById("top-totals")!, t);
// The rail shows only what the reader checks at its foot, over every gatherer and drilled in alike, kept in this
// browser, each unchecked at first: "folders" -- unchecked, only the folders with an actor not closed in them, at any
// depth; "saved", "closed" -- their lines (unchecked, none: only those of them open in a pane, in view).
const RAIL_SHOW_KEY = "ag-dashboard-rail-show";
const railShow = (() => {
  const v = { folders: false, saved: false, closed: false };
  const k = (prefs.json(RAIL_SHOW_KEY) || {}) as Record<string, unknown>;
  for (const n of Object.keys(v) as (keyof typeof v)[]) v[n] = k[n] === true;
  return v;
})();
function setRailShow(what: keyof typeof railShow, on: boolean) {
  railShow[what] = on;
  prefs.keep(RAIL_SHOW_KEY, railShow);
  renderRail();
}
// A busy folder (an actor not closed in it) is open in the rail unless the reader folded it there (busyFolded, kept in
// this browser) -- forgotten once it is busy no more, so it opens again the next time; any other folder open or not as
// the list has it.
const BUSY_FOLDED_KEY = "ag-dashboard-rail-busy-folded";
const busyFolded = new Set((prefs.list(BUSY_FOLDED_KEY) as string[] | null) || []);
const keepBusyFolded = () => prefs.keep(BUSY_FOLDED_KEY, [...busyFolded]);
const railOpen = (gname: string, id: number, busy: boolean) =>
  busy ? !busyFolded.has(folderKey(gname, id)) : isOpenFolder(gname, id);
function railFold(gname: string, id: number, busy: boolean) {
  if (!busy) return toggleFolder(gname, id);
  const k = folderKey(gname, id);
  if (busyFolded.has(k)) busyFolded.delete(k);
  else busyFolded.add(k);
  keepBusyFolded();
  renderAgents();
}
// what the rail calls of the page (Rail.tsx's RailHost): the list's own, and the rail's
let railHost: RailHost | null = null;
const RAIL_HOST = (): RailHost =>
  (railHost ??= {
    ...LIST_HOST,
    ctx: CTX,
    railGo,
    railDrill,
    railFold,
    setRailShow,
    railSpring: (gname, id, busy) => {
      if (!railOpen(gname, id, busy)) railFold(gname, id, busy);
    },
  });
function renderRail() {
  const rail = document.getElementById("rail")!;
  const m = buildRail(CTX, listView(), {
    show: { ...railShow },
    busyFolded,
    at: railAt,
    dragging: listDrag ? listDrag.g : null,
  });
  if (m.forget.length) {
    for (const k of m.forget) busyFolded.delete(k); // busy no more
    keepBusyFolded();
  }
  drawRail(rail, m, RAIL_HOST());
  const list = rail.querySelector(".r-actors");
  if (railMoved && list) {
    list.scrollTop = 0;
    list.scrollLeft = 0;
  }
  railMoved = false;
  markDragged(); // drawn mid-drag: what is dragged, still shown as it
  if (hover.from === "rail") cardDraw();
}
// An actor dragged from the rail (drag.ts's startDrag): the rail drawn again with every folder of its gatherer -- those
// the foot's "folders" leaves out too, folded -- so it can be dropped in one (rail-model.ts's `dragging`); as it was once
// the drag is over (endDrag, `revealed`). Drawn next, not now: the browser takes what is dragged's picture first.
export function railDragged(): void {
  if (listMode !== "folded" || railShow.folders) return;
  setTimeout(() => {
    if (!listDrag || listMode !== "folded") return;
    listDrag.revealed = true;
    renderRail();
  }, 0);
}
// Selecting an actor draws its chat as soon as it is loaded; its calls and context (the details) follow on the stream,
// which starts with them. The actor list is the stream's already.
export async function select(g: string, c: string): Promise<void> {
  const state = S(),
    D = L.data;
  state.selected = [g, c];
  state.readId = null;
  state.followLatest = true;
  state.context = null;
  state.agent = null;
  state.agentVersion = (state.agentVersion || 0) + 1;
  markSeen();
  L.panes.savePanes();
  if (!inPane()) {
    L.panes.appsSelected();
    L.panes.showActorsApp(g, c); // an app's actor: its app's panel above it (features/apps/app-actors.js)
  }
  if (snap() || state.paused) {
    await D.refresh(true);
    L.chat.chatToEnd();
    return;
  }
  const kept = !isShell(c) && L.files.showKept(g, c); // shown before: drawn at once as it was, dimmed until brought up to date
  L.panel.connect();
  const main = document.getElementById("main")!;
  main.classList.add("stale");
  D.render(true); // else drawn loading: not the actor shown before, as if this one
  if (kept) L.chat.chatToEnd();
  try {
    await D.loadChat();
  } finally {
    main.classList.remove("stale");
  }
  if (state.selected[0] === g && state.selected[1] === c) {
    const end = !kept || L.chat.chatAtEnd(); // drawn already: the reader's place kept, should they have moved it
    D.render(true);
    if (end) L.chat.chatToEnd();
  }
}
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start(): void {
  const side = document.querySelector<HTMLElement>(".side")!,
    root = document.documentElement;
  widthGrip(
    document.getElementById("side-grip")!,
    "ag-dashboard-side-width",
    root,
    "--side-w",
    200,
    (x) => x - side.getBoundingClientRect().left,
  );
  // the folded rail's own width (--rail-w), its right edge dragged as the list's is: 76px at the least, 360px at the most
  const railGrip = Object.assign(document.createElement("div"), {
    className: "rail-grip",
    title: "Drag to resize · double-click to reset",
  });
  railGrip.setAttribute("aria-hidden", "true");
  side.append(railGrip);
  widthGrip(railGrip, "ag-dashboard-rail-width", root, "--rail-w", 76, (x) =>
    Math.min(360, x - side.getBoundingClientRect().left),
  );
  if (!inPane() && !snap()) {
    const edge = Object.assign(document.createElement("div"), { className: "list-edge" });
    edge.setAttribute("aria-hidden", "true");
    side.after(edge);
    const at = (ev: PointerEvent) => {
      pointerAt.x = ev.clientX;
      pointerAt.y = ev.clientY;
    };
    document.addEventListener("pointermove", at, { capture: true, passive: true });
    edge.addEventListener("pointerenter", (ev) => {
      at(ev);
      peekList(true);
    });
    edge.addEventListener("pointermove", (ev) => {
      at(ev);
      if (!root.classList.contains("list-peek")) peekList(true);
    });
    side.addEventListener("pointerleave", (ev) => {
      at(ev);
      if (listHidden) unpeekSoon(); // (onto a frame: its last place)
    });
    side.addEventListener("focusin", () => peekList(true));
    side.addEventListener("focusout", () => {
      if (listHidden) unpeekSoon();
    });
    // the counts at the top: out as at the edge (over the whole page, there is nothing to slide out)
    const totals = document.getElementById("top-totals")!;
    const peekHere = (ev: PointerEvent) => {
      at(ev);
      if (listHidden && listMode !== "full" && !root.classList.contains("list-peek")) peekList(true);
    };
    totals.addEventListener("pointerenter", peekHere);
    totals.addEventListener("pointermove", peekHere);
    totals.addEventListener("pointerleave", (ev) => {
      at(ev);
      if (listHidden) unpeekSoon();
    });
    listHidden = prefs.flag(HIDE_KEY);
    root.classList.add("list-still"); // the page opened with it hidden: hidden, not sliding away
    root.classList.toggle("list-hidden", listHidden);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("list-still")));
  }
  document.addEventListener(
    "keydown",
    (ev) => {
      // first: Esc closes the settings first, if they are open
      if (
        ev.key !== "Escape" ||
        listMode !== "full" ||
        !document.getElementById("about")!.hidden ||
        L.settings.useSettings.getState().file.open
      )
        return;
      ev.preventDefault();
      leaveFull();
    },
    true,
  );
  startCard(); // the rows' hover card (card.ts)
  // as the reader left it: over the whole page, from where it came
  const v = prefs.json(LIST_KEY) as { mode?: string; from?: string } | null;
  if (v && (v.from === "list" || v.from === "folded")) listFrom = v.from;
  setListMode(v && v.mode, false);
}
// What the old page's modules import of these from here, as they did: the hover card (card.ts)
export { cardDraw, cardRelease, hover } from "./hover-card";
