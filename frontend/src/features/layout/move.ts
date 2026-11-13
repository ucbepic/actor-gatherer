// A panel MOVED by dragging its head: while it is dragged, the work area covered -- so the frames under the pointer take
// none of the drag, and a Browser's native page is pictured in its place (apps/native.ts) -- the panel dragged marked,
// and, over another panel of its task, where it would go: a side of it (the two then side by side, or one over the
// other) or all of it (the two swapped). Dropped there, it goes there. The drag is the browser's own (drag and drop), so
// one started in a pane's frame (its head is its page's) goes on over this page; whatever starts it ends it.
import { zoneAt, zoneRect, type Zone } from "./arrange";
import type { Rect } from "./tree";

export interface MoveHooks {
  /** Where each panel is, by its id (the work area's own coordinates). */
  rects: () => Map<string, Rect>;
  /** The panels `id` can go beside: its task's others shown. */
  targets: (id: string) => string[];
  /** How near a side of a target the drop goes on that side (arrange.ts's zoneAt): a half, always on a side. */
  edge?: (id: string) => number;
  moved: (id: string, target: string, zone: Zone) => void;
}

const px = (n: number): string => `${n}px`;
function at(e: HTMLElement, r: Rect): void {
  e.style.left = px(r.x);
  e.style.top = px(r.y);
  e.style.width = px(r.w);
  e.style.height = px(r.h);
}

export class Mover {
  private id = "";
  private cover: HTMLElement | null = null;

  constructor(
    private readonly work: HTMLElement,
    private readonly hooks: MoveHooks,
  ) {}

  /** The panel `id` picked up: false if it has nowhere to go. */
  start(id: string): boolean {
    if (!this.hooks.targets(id).length) return false;
    this.end();
    this.id = id;
    setTimeout(() => this.show(), 0); // not as the drag starts: a page changed under a drag then can end it
    return true;
  }

  end(): void {
    this.id = "";
    this.cover?.remove();
    this.cover = null;
  }

  // where the drop at the pointer would go: a panel of its task, and which part of it
  private over(ev: DragEvent): { target: string; zone: Zone; rect: Rect } | null {
    const box = this.work.getBoundingClientRect(),
      x = ev.clientX - box.left,
      y = ev.clientY - box.top,
      rects = this.hooks.rects();
    for (const target of this.hooks.targets(this.id)) {
      const r = rects.get(target);
      if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        const zone = zoneAt(r, x, y, this.hooks.edge ? this.hooks.edge(this.id) : 0.25);
        return { target, zone, rect: zoneRect(r, zone) };
      }
    }
    return null;
  }

  private show(): void {
    if (!this.id || this.cover) return;
    const cover = document.createElement("div"),
      from = document.createElement("div"),
      to = document.createElement("div");
    cover.className = "lay-cover";
    from.className = "lay-from";
    to.className = "lay-to";
    to.hidden = true;
    const r = this.hooks.rects().get(this.id);
    if (r) at(from, r);
    cover.append(from, to);
    cover.addEventListener("dragover", (ev) => {
      const o = this.over(ev);
      to.hidden = !o;
      if (!o) {
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "none";
        return;
      }
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      at(to, o.rect);
      to.dataset.zone = o.zone;
    });
    cover.addEventListener("dragleave", (ev) => {
      if (!cover.contains(ev.relatedTarget as globalThis.Node | null)) to.hidden = true;
    });
    cover.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const o = this.over(ev),
        id = this.id;
      this.end();
      if (o) this.hooks.moved(id, o.target, o.zone);
    });
    this.work.append(cover);
    this.cover = cover;
  }
}
