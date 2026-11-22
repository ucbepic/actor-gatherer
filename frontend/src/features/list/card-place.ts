// Where the hover card goes (card.ts), apart from the page: beside the rail or the list, level with what it is of; under
// it where there is no room beside (the rail across a phone's top, the list as wide as the page); inside the window.

/** A box on the page: its left, top, right, bottom, width and height. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The card's place (its left and top, px), `w` by `h`, for the item at `at` in the list or rail at `side`, in a window
 * `win` wide and high; `rail`: the rail's, under the whole rail when not beside it. */
export function cardPlace(
  at: Rect,
  side: Rect,
  w: number,
  h: number,
  win: { width: number; height: number },
  rail: boolean,
): { left: number; top: number } {
  if (side.width > side.height || side.right + 8 + w > win.width)
    // no room beside it: under the actor
    return {
      left: clamp(at.left + at.width / 2 - w / 2, 8, win.width - w - 8),
      top: clamp(rail ? side.bottom + 6 : at.bottom + 4, 8, win.height - h - 8),
    };
  return { left: side.right + 8, top: clamp(at.top + at.height / 2 - h / 2, 8, win.height - h - 8) };
}
