// A PANEL MOVED: its head dragged -- an actor's pane's, its Chat bar's grip (the head put there), a task's strip -- picks
// it up (none from a press on a button in it, nor one with nowhere to go); let go, it is put down (work.ts). Right-clicked:
// what it can be moved to, as a menu (move-choices.ts). An app's panel has no head: its row in the list, right-clicked,
// opens that menu for it (appPanelMenu).
import { firstLine } from "../../core/format";
import { isShell } from "../../core/model/keys";
import { closeAppPane } from "./app-panels";
import { appActor } from "./app-hooks";
import { L, panes, snap } from "./link";
import { moveChoices, moveHead, short, type MoveChoice } from "./move-choices";
import { allPanes } from "./open";
import { openPop, popMenu, type PopItem } from "./popups";
import type { AppItem } from "./types";
import { workClosed, workPlacer } from "./work-area";

const MOVE_FROM = "#panes > .pane > .pane-top, .pane .fl-grip, .lay-strip";
let movePress: EventTarget | null = null; // what the last press was on: a drag starting from a button is none
function moveStart(node: HTMLElement | null): boolean {
  return !!workPlacer && !!node && workPlacer.startMove(node);
}
/** A panel's drag ended (a drop the list took, too). */
export function moveEnd(): void {
  workPlacer?.endMove();
}

/** What a menu of a panel of its own adds to its moves: its heading, its items. */
interface More {
  head: (m: unknown) => string;
  items: (mark: (t: string) => Node) => PopItem[];
}
/** The menu a panel's head right-clicked opens at (x, y): which side of its task's block it goes along, or whose place it
 * takes. None for a panel with no other of its task shown -- unless `more` gives it items of its own. (A task's strip, or
 * the head of its only panel shown: the task moved among the tasks shown -- or, others shown with it, to another screen
 * tab, or a new one.) */
function moveMenu(node: HTMLElement, x: number, y: number, more: More | null = null): boolean {
  const m = workPlacer && node ? workPlacer.moves(node) : null;
  if (!m && !more) return false;
  let at = document.getElementById("lay-anchor"); // what the menu hangs from: the point pressed
  if (!at) {
    at = L.helpers.el("span", { id: "lay-anchor", class: "lay-anchor", "data-pop": "lay-move", "aria-hidden": "true" });
    document.body.append(at);
  }
  at.style.left = `${Math.round(x)}px`;
  at.style.top = `${Math.round(y)}px`;
  const mark = (t: string) => L.helpers.el("span", { class: "lay-mark", "aria-hidden": "true", text: t });
  const w = workPlacer!;
  const choices: MoveChoice[] = m
    ? moveChoices(m, panelName, {
        toSide: (side) => w.toSide(node, side),
        swapWith: (o) => w.swapWith(node, o),
        toTab: (id) => w.toTab(node, id),
        toNewTab: () => w.toNewTab(node),
        toScreenTab: (id) => w.toScreenTab(node, id),
      })
    : [];
  const moves: PopItem[] = choices.map((c) => ({ mark: mark(c.mark), text: c.text, run: c.run }));
  openPop("lay-move", at, popMenu(more ? more.head(m) : moveHead(m), [...moves, ...(more ? more.items(mark) : [])]));
  return true;
}
/** An app's row in the list, or its row in its task's card, right-clicked: its panel's menu, as a head's -- where the
 * panel can be moved, and the panel closed, the app left open (its row, or its task, opens it again). Its panel not
 * shown: the browser's own menu. */
export function appPanelMenu(gname: string, o: AppItem, ev: MouseEvent): void {
  if (snap()) return;
  const p = panes.apps.find((q) => q.g === gname && q.instance.id === o.id && !q.held && !q.node.hidden);
  if (!p) return;
  ev.preventDefault();
  ev.stopPropagation();
  const name = L.list.appShown(o);
  moveMenu(p.node, ev.clientX, ev.clientY, {
    head: (m) => (!m ? name : (m as { task: boolean }).task ? `Move ${name}'s task` : `Move ${name}`),
    items: (mark) => [
      {
        mark: mark("×"),
        text: "Close panel (app stays open)",
        run: () => {
          workClosed(p.node);
          closeAppPane(p);
        },
      },
    ],
  });
}
/** What a panel is called in the menu: an app's as its head names it, an actor's as the list does. */
function panelName(node: HTMLElement): string {
  if (node.matches(".lay-strip")) return node.dataset.name || "this task";
  const app = panes.apps.find((p) => p.node === node);
  if (app) return short(app.instance.name || app.instance.title || app.app.label);
  const q = allPanes().find((p) => p.node === node);
  if (!q || !q.g || !q.c) return "this pane";
  if (isShell(q.c)) return "the terminal";
  const a = appActor(q.g, q.c);
  return short(a ? a.name?.text || firstLine(a.last_user_message || "", 60) || q.c : q.c);
}

/** Panels picked up by their heads, and their menus, from now on: once, as the page starts. */
export function startMoves(): void {
  const head = document.querySelector<HTMLElement>("#pane-here > .pane-top");
  if (head) head.draggable = true;
  const from = (ev: Event) => (ev.target instanceof Element ? ev.target.closest<HTMLElement>(MOVE_FROM) : null);
  const panel = (f: HTMLElement) => (f.matches(".lay-strip") ? f : f.closest<HTMLElement>("#panes > .pane")); // a strip: its task
  const busy = () =>
    movePress instanceof Element && !!movePress.closest("button, input, textarea, select, a, [contenteditable]");
  document.addEventListener(
    "pointerdown",
    (ev) => {
      movePress = ev.target;
    },
    true,
  );
  document.addEventListener("dragstart", (ev) => {
    const f = from(ev);
    if (!f) return;
    if (busy() || !moveStart(panel(f))) {
      ev.preventDefault();
      return;
    }
    if (!ev.dataTransfer) return;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("application/x-ag-panel", "1");
  });
  document.addEventListener("dragend", (ev) => {
    if (from(ev)) moveEnd();
  });
  document.addEventListener("contextmenu", (ev) => {
    const f = from(ev);
    if (!f || (ev.target instanceof Element && ev.target.closest("input, textarea, [contenteditable]"))) return;
    const p = panel(f);
    if (p && moveMenu(p, ev.clientX, ev.clientY)) ev.preventDefault();
  });
}
