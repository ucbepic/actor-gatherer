// Selecting the History's rows, as text is selected (HistoryView.tsx says how): the list's presses, and the keys while
// it is on the page. While a drag goes on only what is selected changes; the panel follows once it ends.
import { useEffect, useRef, type MouseEvent, type RefObject } from "react";
import { select, toggleOpen, useHist } from "./store";
import { nodeOfKey, rangeOf, withRows, type HNode, type Selection } from "./tree";

interface Drag {
  from: string;
  anchor: string;
  base: Selection;
  at: string | null;
  moved: boolean;
  add: boolean;
  extend: boolean;
  wasOn: boolean;
  x: number;
  y: number;
}

export interface Selecting {
  list: RefObject<HTMLDivElement | null>;
  /** the rows' keys, in order */
  flat: string[];
  byId: ReadonlyMap<string, HNode>;
  /** what ⌘A selects */
  tops: HNode[];
  /** a record is being made: the panel stays */
  making: boolean;
}

/** what a press on starts no selection: a row's twisty, its whole text (to select words in), a link, a button */
const OWN = ".h-tw, .h-full, a, button";
const EDGE = 36;

export function useSelecting(now: Selecting) {
  const at = useRef(now);
  useEffect(() => {
    at.current = now;
  });
  const drag = useRef<Drag | null>(null);

  const to = (k: string) => {
    const d = drag.current;
    if (!d || k === d.at) return;
    d.at = k;
    if (k !== d.from) d.moved = true;
    const { flat, byId } = at.current;
    useHist.setState({ sel: withRows(rangeOf(flat, d.anchor, k, byId), d.base, byId) });
  };
  const rowAt = (x: number, y: number) => {
    const under = document.elementFromPoint(x, y);
    return (under?.closest?.(".hist .h-list .h-row") as HTMLElement | null) ?? null;
  };
  // near the list's top or bottom edge, it scrolls, and the drag goes on
  const scrolling = () => {
    const d = drag.current,
      list = at.current.list.current;
    if (!d) return;
    if (list) {
      const r = list.getBoundingClientRect();
      const by = d.y < r.top + EDGE ? d.y - (r.top + EDGE) : d.y > r.bottom - EDGE ? d.y - (r.bottom - EDGE) : 0;
      if (by) {
        list.scrollTop += Math.max(-24, Math.min(24, by / 2));
        const row = rowAt(d.x, Math.max(r.top + 2, Math.min(r.bottom - 2, d.y)));
        if (row) to(row.dataset.key!);
      }
    }
    requestAnimationFrame(scrolling);
  };
  const moved = (ev: globalThis.MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    d.x = ev.clientX;
    d.y = ev.clientY;
    const row = rowAt(ev.clientX, ev.clientY);
    if (row) to(row.dataset.key!);
  };
  const up = () => {
    const d = drag.current;
    document.removeEventListener("mousemove", moved);
    document.removeEventListener("mouseup", up);
    if (!d) return;
    drag.current = null;
    let sel = useHist.getState().sel;
    if (d.add && d.wasOn && !d.moved) {
      // ⌘-click on a selected row: out of the selection
      const n = nodeOfKey(at.current.byId, d.from),
        out = new Map(sel);
      if (n) for (const r of n.rows) out.delete(r);
      sel = out;
    }
    select(sel, at.current.making, d.extend ? undefined : d.from);
  };

  // Esc clears what is selected, ⌘A selects every row listed: while the list is on the page, not typed in a box
  useEffect(() => {
    const keys = (ev: KeyboardEvent) => {
      const list = at.current.list.current,
        t = ev.target as Element | null;
      if (!list || !list.isConnected || t?.closest?.("input, textarea, select, [contenteditable]")) return;
      const { sel } = useHist.getState();
      if (ev.key === "Escape" && sel.size) {
        ev.preventDefault();
        select(new Map(), at.current.making);
      } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "a" && at.current.tops.length) {
        ev.preventDefault();
        select(withRows(at.current.tops, new Map(), at.current.byId), at.current.making);
      }
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  return {
    onMouseDown(ev: MouseEvent<HTMLDivElement>) {
      if (ev.button !== 0) return;
      const t = ev.target as Element,
        row = t.closest(".h-row") as HTMLElement | null;
      const { sel, last } = useHist.getState();
      if (!row) {
        // below the rows
        if (!t.closest("button, a") && sel.size) select(new Map(), at.current.making);
        return;
      }
      if (t.closest(OWN)) return;
      ev.preventDefault(); // no text selected as the rows are
      const k = row.dataset.key!,
        add = ev.metaKey || ev.ctrlKey,
        extend = ev.shiftKey && !!last && at.current.flat.includes(last);
      drag.current = {
        from: k,
        anchor: extend ? last! : k,
        base: add || extend ? new Map(sel) : new Map(),
        at: null,
        moved: false,
        add,
        extend,
        wasOn: row.classList.contains("on"),
        x: ev.clientX,
        y: ev.clientY,
      };
      if (!(add && drag.current.wasOn)) to(k); // a ⌘-click on a selected row: taken out, on release
      document.addEventListener("mousemove", moved);
      document.addEventListener("mouseup", up);
      requestAnimationFrame(scrolling);
    },
    onDoubleClick(ev: MouseEvent<HTMLDivElement>) {
      const t = ev.target as Element,
        row = t.closest(".h-row") as HTMLElement | null;
      if (row && !t.closest(OWN)) toggleOpen(row.dataset.key!.replace(/\/h$/, ""));
    },
  };
}
