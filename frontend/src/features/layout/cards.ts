// EACH TASK'S CARD (work.ts): a frame round its block's panels (its strip with them), where they were placed -- drawn
// over them, letting the pointer by; none at a phone's width, where nothing is placed. A block's box (withBlocks): its
// card's, its panels' all told.
import type { Rect } from "./tree";

export class Cards {
  /** What the frames are drawn in. */
  readonly el = document.createElement("div");
  private readonly cards = new Map<string, HTMLElement>();

  constructor() {
    this.el.className = "lay-cards";
  }

  /** Each of `blocks` framed where `rect` says it is (none: not framed); any other block's frame gone. */
  draw(blocks: string[], rect: (block: string) => Rect | undefined): void {
    const now = new Set<string>();
    for (const b of blocks) {
      const r = rect(b);
      if (!r) continue;
      now.add(b);
      let e = this.cards.get(b);
      if (!e) {
        e = document.createElement("div");
        e.className = "lay-card";
        e.setAttribute("aria-hidden", "true");
        this.el.append(e);
        this.cards.set(b, e);
      }
      const s = e.style;
      [s.left, s.top, s.width, s.height] = [r.x, r.y, r.w, r.h].map((n) => `${n}px`);
    }
    for (const [b, e] of this.cards)
      if (!now.has(b)) {
        e.remove();
        this.cards.delete(b);
      }
  }
}

/** `rects` (each panel's, by its id) and each block's too, all its panels' (`block`: a panel's block's id; none, of none). */
export function withBlocks(rects: Map<string, Rect>, block: (id: string) => string | undefined): Map<string, Rect> {
  const out = new Map(rects);
  for (const [id, r] of rects) {
    const b = block(id);
    if (b === undefined) continue;
    const was = out.get(b);
    if (!was) out.set(b, { ...r });
    else {
      const x = Math.min(was.x, r.x),
        y = Math.min(was.y, r.y);
      out.set(b, { x, y, w: Math.max(was.x + was.w, r.x + r.w) - x, h: Math.max(was.y + was.h, r.y + r.h) - y });
    }
  }
  return out;
}
