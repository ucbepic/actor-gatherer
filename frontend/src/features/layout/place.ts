// The work area's panels PLACED where its tree (tree.ts) lays them out: each at its own spot in the one box, the bars
// between them over it. A panel is never moved in the page to go elsewhere -- a frame moved is a frame loaded again, its
// actor's view drawn anew, a Browser's page with it -- only its spot changes. Placed again as the box changes size, as
// a panel as long as what it shows does, or as the page says (place). A phone's width: none placed (the tree null), the
// page's own stylesheet lays them out.
import "./place.css";
import {
  drag,
  draggable,
  even,
  evens,
  isSplit,
  lay,
  lengths,
  type Laid,
  type Node,
  type Rect,
  type Size,
  type Split,
} from "./tree";

export interface PlaceHooks {
  /** What the work area shows, for a box this size; null: none placed. */
  tree: (box: { w: number; h: number }) => Node | null;
  /** A panel's element, by its id. */
  node: (id: string) => HTMLElement | null;
  /** A split's sizes, its bar dragged (`done`: let go) or double-clicked: the page keeps them, and places again. */
  resized: (key: string, sizes: Size[], done: boolean) => void;
}

const SPOT = ["left", "top", "width", "height", "bottom"] as const;
type Spot = Partial<Record<(typeof SPOT)[number], string>>;
const px = (n: number): string => `${n}px`;
// each style set only when it changes: placing again what has not moved is nothing to lay out
function spot(e: HTMLElement, s: Spot): void {
  for (const k of SPOT) {
    const v = s[k] ?? "";
    if (e.style[k] !== v) e.style[k] = v;
  }
}
const attr = (e: HTMLElement, name: string, v: string): void => {
  if (e.getAttribute(name) !== v) e.setAttribute(name, v);
};
const HIT = 2; // a bar is this much wider on each side than the room it takes, to be caught

export class Placer {
  private readonly bars: HTMLElement;
  private placed = new Map<string, HTMLElement>();
  private watched = new Set<HTMLElement>();
  private laid: Laid | null = null;
  private readonly sizes = new ResizeObserver(() => this.place());

  constructor(
    private readonly work: HTMLElement,
    private readonly hooks: PlaceHooks,
  ) {
    this.bars = document.createElement("div");
    this.bars.className = "lay-bars";
    work.append(this.bars);
    this.sizes.observe(work);
  }

  place(): void {
    const box = { w: this.work.clientWidth, h: this.work.clientHeight };
    const tree = this.hooks.tree(box);
    this.work.classList.toggle("placed", !!tree);
    if (!tree) {
      this.laid = null;
      for (const e of this.placed.values()) spot(e, {});
      this.placed.clear();
      this.watch(new Set());
      this.drawBars();
      return;
    }
    const laid = lay(tree, { x: 0, y: 0, ...box }, (kid, cross) => this.natural(kid, cross));
    const now = new Map<string, HTMLElement>();
    for (const [id, r] of laid.rects) {
      const e = this.hooks.node(id);
      if (!e) continue;
      now.set(id, e);
      // a panel as long as what it shows: as tall as it is, at the bottom of its spot
      spot(
        e,
        laid.fitted.has(id)
          ? { left: px(r.x), width: px(r.w), bottom: px(box.h - r.y - r.h), height: "auto" }
          : this.at(r),
      );
    }
    for (const [id, e] of this.placed) if (!now.has(id) || now.get(id) !== e) spot(e, {});
    this.placed = now;
    this.laid = laid;
    this.watch(new Set([...laid.fitted].map((id) => now.get(id)).filter((e): e is HTMLElement => !!e)));
    this.drawBars();
  }

  private at(r: Rect): Spot {
    return { left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) };
  }

  // How long a kid sized `fit` is: what its panels show, `w` wide -- each panel as tall as it is
  private natural(n: Node, w: number): number {
    if (!isSplit(n)) {
      const e = this.hooks.node(n.id);
      if (!e) return 0;
      spot(e, { left: e.style.left, width: px(w), bottom: e.style.bottom, height: "auto" });
      return e.offsetHeight;
    }
    if (n.dir === "col") return n.kids.reduce((sum, k) => sum + this.natural(k, w), 0) + n.bar * (n.kids.length - 1);
    const ls = lengths(n, w, 0, (k, cross) => this.natural(k, cross));
    return Math.max(0, ...n.kids.map((k, i) => this.natural(k, ls[i])));
  }

  // the panels as long as what they show: placed again as that changes (the box itself always watched)
  private watch(now: Set<HTMLElement>): void {
    for (const e of this.watched) if (!now.has(e)) this.sizes.unobserve(e);
    for (const e of now) if (!this.watched.has(e)) this.sizes.observe(e);
    this.watched = now;
  }

  // The bars between the kids of each split, each where it is laid out, a little wider to be caught -- the same element
  // for the same bar while the tree keeps its shape, so one dragged stays under the pointer
  private drawBars(): void {
    const all = this.laid ? this.laid.bars : [];
    while (this.bars.children.length > all.length) this.bars.lastElementChild!.remove();
    while (this.bars.children.length < all.length) this.bars.append(this.newBar());
    all.forEach((b, i) => {
      const e = this.bars.children[i] as HTMLElement;
      const row = b.split.dir === "row",
        still = !draggable(b.split, b.at);
      attr(e, "data-split", b.split.key);
      attr(e, "data-dir", b.split.dir);
      attr(e, "aria-orientation", row ? "vertical" : "horizontal");
      attr(
        e,
        "title",
        still
          ? ""
          : `Drag to resize${evens(b.split) ? ` · double-click: all the same ${row ? "width" : "height"}` : ""}`,
      );
      e.classList.toggle("thick", !!b.split.thick);
      e.classList.toggle("still", still);
      const r = b.rect;
      spot(e, this.at(row ? { ...r, x: r.x - HIT, w: r.w + 2 * HIT } : { ...r, y: r.y - HIT, h: r.h + 2 * HIT }));
    });
  }

  private barOf(e: HTMLElement) {
    const i = Array.prototype.indexOf.call(this.bars.children, e);
    return this.laid ? this.laid.bars[i] || null : null;
  }

  // A bar dragged: the split's sizes as the pointer has moved since it was pressed, told as it moves and once let go
  // -- the frames letting the pointer by meanwhile, so it goes on over them. Double-clicked: its kids even.
  private newBar(): HTMLElement {
    const e = document.createElement("div");
    e.className = "lay-bar";
    e.setAttribute("role", "separator");
    e.addEventListener("pointerdown", (ev) => {
      const b = this.barOf(e);
      if (!b || ev.button !== 0 || !draggable(b.split, b.at)) return;
      ev.preventDefault();
      e.setPointerCapture(ev.pointerId);
      const split: Split = b.split,
        at = b.at,
        ls = b.lengths,
        row = split.dir === "row",
        from = row ? ev.clientX : ev.clientY;
      let sizes: Size[] | null = null;
      e.classList.add("on");
      this.work.dataset.resizing = split.dir;
      const move = (m: PointerEvent): void => {
        sizes = drag(split, at, ls, (row ? m.clientX : m.clientY) - from);
        this.hooks.resized(split.key, sizes, false);
      };
      const up = (): void => {
        e.removeEventListener("pointermove", move);
        e.removeEventListener("pointerup", up);
        e.removeEventListener("pointercancel", up);
        e.classList.remove("on");
        delete this.work.dataset.resizing;
        if (sizes) this.hooks.resized(split.key, sizes, true);
      };
      e.addEventListener("pointermove", move);
      e.addEventListener("pointerup", up);
      e.addEventListener("pointercancel", up);
    });
    e.addEventListener("dblclick", () => {
      const b = this.barOf(e);
      if (b && draggable(b.split, b.at) && evens(b.split)) this.hooks.resized(b.split.key, even(b.split), true);
    });
    return e;
  }
}

/** The work area `work` placed as `hooks` say, from now on: place() again whenever what it shows changes. */
export const placer = (work: HTMLElement, hooks: PlaceHooks): Placer => new Placer(work, hooks);
