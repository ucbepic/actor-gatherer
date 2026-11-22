// DRAGGING an actor's row -- every selected one's, if it is selected -- or a folder's line, onto a folder's line (into
// it) or its gatherer's row (to its top): `listDrag`, what is dragged, of its gatherer only (drag-rules.ts says what it
// may do). The list, the rail and Manage groups draw each row by its key, so the row dragged stays the same element as
// they are drawn again meanwhile; over when it says (dragend) -- its own listener, so said even by a row drawn elsewhere
// meanwhile (a folder opened round it) -- or a drop anywhere. A folder held over for DROP_OPEN_MS opens. The rail's
// actors are dragged so too, onto its names (modes.ts's railDragged: the folders it leaves out shown while one is).
import { key } from "../../core/model/keys";
import { cardHide } from "./hover-card";
import * as DR from "./drag-rules";
import { fileItems, moveFolder } from "./folders";
import { fileGatherers, gPicks } from "./gatherer-folders";
import { askAlone, askMerge, askMove, askSplit, placeGroup } from "./group-moves";
import type { AnyDrag } from "./host";
import { L, S } from "./link";
import { clearPicks, CTX, picked, picks, renderAgents } from "./list";
import { railDragged } from "./modes";
import { joinTask } from "./task-acts";
import { taskItems, taskOf } from "./tasks";
import type { Actor, Gatherer } from "./types";

/** What is dragged, and what the drag has done meanwhile: the rail's folders shown for it, a folder about to open, its
 * task offered to the work area (features/layout/panes.js). */
export interface ListDrag extends DR.Drag {
  revealed: boolean;
  spring: ReturnType<typeof setTimeout> | undefined;
  offered?: boolean;
}
export let listDrag: ListDrag | null = null;
const DROP_OPEN_MS = 700;
/** What the rules read of the page now (read when asked: the modules of the list load each other in a ring). */
export const RULES: DR.Rules = {
  get ctx() {
    return CTX;
  },
  ownKey: (a) => {
    const r = L.appActors.appRole({ session: { role: a.role } });
    return r ? r.key : null;
  },
};
const named = (gname: string): Gatherer | null => S().home!.gatherers.find((x) => x.name === gname) || null;
const evOf = (ev: AnyDrag) => ev as globalThis.DragEvent;

export function startDrag(ev: AnyDrag, g: Gatherer, what: { cs?: string[]; gs?: string[]; folder?: number }): void {
  if (listDrag) endDrag();
  const e = evOf(ev);
  const target = e.target instanceof Element ? e.target : null;
  listDrag = {
    g: g.name,
    cs: what.cs || null,
    gs: what.gs || null,
    folder: what.folder ?? null,
    revealed: false,
    spring: undefined,
    ask: !!target && !!target.closest(".mg-dialog"), // from Manage groups: a change of group asked first
  };
  const from = e.currentTarget instanceof Element ? e.currentTarget : target;
  if (from) from.addEventListener("dragend", endDrag, { once: true });
  e.dataTransfer!.effectAllowed = "move";
  e.dataTransfer!.setData(
    "text/plain",
    what.cs ? what.cs.join(",") : what.gs ? what.gs.join(",") : `folder:${what.folder}`,
  );
  if (what.cs && what.cs.length > 1) {
    // several: said on what is dragged
    const ghost = Object.assign(document.createElement("div"), {
      className: "drag-ghost",
      textContent: `${what.cs.length} ${what.cs.some((c) => c.startsWith("app:")) ? "items" : "actors"}`,
    });
    document.body.append(ghost);
    e.dataTransfer!.setDragImage(ghost, 14, 14);
    setTimeout(() => ghost.remove(), 0);
  }
  markDragged();
  cardHide();
  railDragged();
  setTimeout(showOutside, 0); // after dragstart: the page unmoved till then
}
// what is dragged, shown so -- again after the list, or the rail, is drawn mid-drag (the rail's by their data-card, its
// \u0000 one CSS.escape cannot write)
export function markDragged(): void {
  const d = listDrag;
  if (!d) return;
  const keys = d.cs
    ? d.cs.map((c) => `${d.g}/${c}`)
    : d.gs
      ? d.gs // a gatherer: its row's
      : [`${d.g}/folder:${d.folder}`];
  for (const k of keys)
    for (const n of document.querySelectorAll(`:is(#agents, .mg-dialog) [data-key="${CSS.escape(k)}"]`))
      n.classList.add("dragging");
  const cards = new Set(d.cs ? d.cs.map((c) => key(d.g, c)) : []);
  for (const n of document.querySelectorAll<HTMLElement>("#rail .r-actor[data-card]"))
    if (cards.has(n.dataset.card!)) n.classList.add("dragging");
}
// An actor's row dragged: the selection, if it is in it; else it -- one of a task, the task: all in it, which are in one
// place
export function draggedWith(g: Gatherer, a: Actor): string[] {
  if (picked(g, a) && picks.cs.size > 1) return [...picks.cs];
  const id = taskOf(CTX, g.name, a);
  return id === null ? [a.channel] : taskItems(CTX, g, id);
}
// An item's row, what is dragged dropped on it: put in its task (joinTask) -- the list's rows and the rail's tiles
// (React's handlers, RowViews.tsx's joins): `ev.currentTarget` the row
const canJoin = (g: Gatherer, k: string) => DR.canJoin(RULES, listDrag, g, k);
export function joinEnter(ev: AnyDrag, g: Gatherer, k: string): void {
  if (!canJoin(g, k)) return;
  evOf(ev).preventDefault();
  (evOf(ev).currentTarget as Element).classList.add("drop-on");
}
export function joinOver(ev: AnyDrag, g: Gatherer, k: string): void {
  if (!canJoin(g, k)) return;
  evOf(ev).preventDefault();
  evOf(ev).dataTransfer!.dropEffect = "move";
}
export function joinDrop(ev: AnyDrag, g: Gatherer, k: string): void {
  if (!canJoin(g, k)) return;
  evOf(ev).preventDefault();
  const d = listDrag!;
  endDrag();
  if (d.cs!.length > 1) clearPicks(false);
  void joinTask(g.name, k, d.cs!);
}
export function endDrag(): void {
  const d = listDrag;
  if (!d) return;
  listDrag = null;
  clearTimeout(d.spring);
  document.body.classList.remove("drag-out");
  for (const n of document.querySelectorAll(":is(#agents, #rail, .mg-dialog) :is(.dragging, .drop-on)"))
    n.classList.remove("dragging", "drop-on", "drop-across");
  if (d.revealed) renderAgents(); // the rail, its folders shown for the drag: as it was again
  if (d.offered) L.panes.moveEnd(); // over the work area too: its cover put away (features/layout/panes.js)
}
const canDrop = (g: Gatherer, id: number | null) => DR.canDrop(RULES, listDrag, g, id);
// What is dragged dropped on a line or a row (`ev.currentTarget`): into folder `id` (null: the gatherer's top); `open`,
// what opens when one is held over it -- the list's, the rail's and Manage groups' (React's handlers, Boxes.tsx's drops)
export function dropEnter(ev: AnyDrag, g: Gatherer, id: number | null, open: () => void): void {
  if (!canDrop(g, id)) return;
  const n = evOf(ev).currentTarget as Element,
    d = listDrag!;
  evOf(ev).preventDefault();
  n.classList.add("drop-on");
  n.classList.toggle("drop-across", d.ask && d.g !== g.name); // into another group, in Manage groups: asked first
  clearTimeout(d.spring);
  d.spring = setTimeout(() => {
    if (listDrag && canDrop(g, id)) open();
  }, DROP_OPEN_MS);
}
export function dropOver(ev: AnyDrag, g: Gatherer, id: number | null): void {
  if (!canDrop(g, id)) return;
  evOf(ev).preventDefault();
  evOf(ev).dataTransfer!.dropEffect = "move";
}
export function dropLeave(ev: AnyDrag): void {
  const n = evOf(ev).currentTarget as Element;
  if (n.contains(evOf(ev).relatedTarget as Node | null)) return;
  n.classList.remove("drop-on", "drop-across");
  if (listDrag) clearTimeout(listDrag.spring);
}
export function dropDone(ev: AnyDrag, g: Gatherer, id: number | null): void {
  if (!canDrop(g, id)) return;
  evOf(ev).preventDefault();
  const d = listDrag!,
    now = named(g.name) || g;
  const a = DR.dropOf(RULES, d, g, id);
  endDrag();
  switch (a.do) {
    case "place":
      if (a.picks) gPicks.clear();
      void placeGroup(a.name, a.to, a.id);
      return;
    case "merge":
      gPicks.clear();
      void askMerge(a.name, now, a.id, false, d.ask);
      return;
    case "move":
      void askMove(d, g, a.id);
      return;
    case "folder":
      void moveFolder(g.name, a.folder, a.id);
      return;
    case "gatherers":
      gPicks.clear();
      void fileGatherers(a.names, a.id);
      return;
    case "file":
      if (a.picks) clearPicks(false);
      void fileItems(g.name, a.items, a.id);
      return;
  }
}

// ---- outside every group: a folder dropped there is made a group of its own (askSplit), an actor is on its own
// (askAlone)
export const canOutside = (): boolean => DR.canOutside(RULES, listDrag);
// The place shown, while what is dragged may go there (startDrag's), saying what it does
export function showOutside(): void {
  const can = canOutside();
  document.body.classList.toggle("drag-out", can);
  if (can)
    for (const n of document.querySelectorAll(".outside-drop")) {
      // the list's, and Manage groups' when it is open
      n.textContent =
        listDrag!.folder !== null || listDrag!.gs
          ? "Outside every group: a group of its own"
          : "Outside every group: on its own";
    }
}
// What is dragged dropped there (the list's head's, or Manage groups': ManageGroups.tsx's OutsideDrop)
export function outsideDropped(): void {
  const d = listDrag!;
  endDrag();
  switch (DR.outsideOf(d)) {
    case "place-group":
      void placeGroup(d.gs![0], "", null); // nothing anyone shares changes: no question
      return;
    case "split":
      askSplit(d);
      return;
    case "place-alone":
      void placeGroup(d.g, "", null);
      return;
    case "alone":
      askAlone(d);
  }
}
/** The drop of the list's head is what to make once: drawn by Head.tsx, its handlers these. */
export const outsideHandlers = {
  enter(ev: AnyDrag) {
    if (!canOutside()) return;
    evOf(ev).preventDefault();
    (evOf(ev).currentTarget as Element).classList.add("drop-on");
  },
  over(ev: AnyDrag) {
    if (!canOutside()) return;
    evOf(ev).preventDefault();
    evOf(ev).dataTransfer!.dropEffect = "move";
  },
  leave(ev: AnyDrag) {
    const n = evOf(ev).currentTarget as Element;
    if (!n.contains(evOf(ev).relatedTarget as Node | null)) n.classList.remove("drop-on");
  },
  drop(ev: AnyDrag) {
    if (!canOutside()) return;
    evOf(ev).preventDefault();
    evOf(ev).stopPropagation(); // the list's head it is over: not dropped there too
    outsideDropped();
  },
};
// What this module did as the page's script ran: a drop anywhere ends a drag, after the line's own
export function start(): void {
  document.addEventListener(
    "drop",
    () => {
      if (listDrag) setTimeout(endDrag, 0);
    },
    true,
  );
}
