// A DROP-DOWN OR A BOX of the page's -- "+ actor"'s drop-down, "+ more"'s, the box one of those opens, a panel's moves, the
// new-tab page's -- hung from a button (`key`, that button's data-pop, so found again after the list is drawn again),
// outside the list, so it may reach past the list's edge without the list scrolling, and the list's redraws leave it be:
// Radix's (Pops.tsx), which closes it by its button pressed again, a press elsewhere, Esc, the page resizing, or the page
// or a box holding its button scrolling. `rowPop`: what is open -- its button's key, and what it is (a box's pop; a
// menu's, its content).
import type { ReactNode } from "react";
import { brMenuClose } from "./Branches";
import { L } from "./link";
import { popShown, showPop, type Pop, type PopItem, type PopMenu } from "./Pops";

export type { PopItem, PopMenu };
/** What a button opens: a menu (popMenu), or a box -- a form to fill in, React's. */
export type PopWhat = { menu: PopMenu } | { box: ReactNode };

export const rowPop: { key: string; el: unknown } = { key: "", el: null };
export const popButton = (): HTMLElement | null =>
  (rowPop.key && document.querySelector<HTMLElement>(`[data-pop="${CSS.escape(rowPop.key)}"]`)) || null;
/** The one open, closed: its button told, the card it hung from let go of (unless the pointer is on it); an Esc's, the
 * focus back on its button. */
export function popClosed(pop: Pop, how: "esc" | "chosen" | "away" = "away"): void {
  if (rowPop.key !== pop.key) return;
  const button = popButton() || pop.anchor;
  Object.assign(rowPop, { key: "", el: null });
  button.setAttribute("aria-expanded", "false");
  L.modes.cardRelease();
  if (how === "esc" && button.isConnected) button.focus();
}
export function closePop(): void {
  const pop = popShown();
  if (!pop) return;
  showPop(null);
  popClosed(pop);
}
/** `pop` closed, if it is the one still shown (a box's form done). */
export function closePopIf(pop: Pop | null): void {
  if (pop && popShown() === pop) closePop();
}
/** `what` hung from `button`: a menu, or a box. The same menu's button pressed again: closed. */
export function openPop(key: string, button: HTMLElement, what: PopWhat): void {
  const menu = "menu" in what;
  const again = rowPop.key === key && menu;
  closePop();
  brMenuClose();
  if (again) return;
  const pop: Pop = menu ? { key, anchor: button, menu: what.menu } : { key, anchor: button, box: what.box };
  Object.assign(rowPop, { key, el: menu ? null : pop });
  button.setAttribute("aria-expanded", "true");
  showPop(pop);
  if (menu) rowPop.el = document.querySelector(".br-menu.row-menu[role=menu]") || {};
}
/** A drop-down's choices (Pops.tsx's menu): its heading, then an item for each choice -- its mark, what it is, and a note
 * under it. `sub`: a second line under its heading, muted (where a new actor would work); `cls`, a class of its own (the
 * new-tab page's: one that scrolls). */
export function popMenu(
  head: string,
  items: PopItem[],
  title?: string | null,
  sub?: string | null,
  cls?: string,
): { menu: PopMenu } {
  return { menu: { head, items, title, sub, cls } };
}
/** Every drop-down of the page's open closed: one hung from a button by openPop, the branch drop-down. */
export function closePops(): void {
  closePop();
  brMenuClose();
}
/** A press this page never hears -- in an app's panel (its `pressed`), a native page of the ag app (agApp.onPressed), the
 * focus gone into a frame: what floats over the page and closes on a press elsewhere (Settings, a row's drop-down, the
 * branch drop-down, History's types) closed, as such a press on the page closes it. */
export function pressedAway(): void {
  L.data.setAbout(false);
  closePop();
  brMenuClose();
  dispatchEvent(new Event(L.menus.PRESSED_AWAY)); // the list's own drop-downs
  const types = document.getElementById("hist-types") as HTMLDetailsElement | null;
  if (types && types.open) types.open = false;
}
