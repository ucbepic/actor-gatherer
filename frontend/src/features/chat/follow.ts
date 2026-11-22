// The conversation kept at its end as its box changes size -- the window made shorter or narrower, the files and
// commands opened beside it, the message box grown with what is typed: read to its end before, at its end after. A box
// made smaller keeps its top where it was, so without this its end goes out of sight under the message box; the page
// follows the end only when it draws (features/settings/panel.js's keepingPlace), and a size change is no draw. And kept
// at its end as what it holds grows by itself -- a reply streaming in, a turn growing in, the actor done under it --
// which react-virtuoso follows only for a turn added (Turns.tsx's followOutput): what it holds is watched too
// (`followContent`), and its end followed in the same frame, before it is painted cut off.
//
// At its end: within END_PX of it, as keepingPlace has it -- known from the reader's last scroll, or where the page last
// put it (`placed`), since once the box has changed size it no longer is. A box hidden (a file shown beside it in a
// narrow window) is at its end again when shown, if it was; one taken from the page (another actor shown) is where the
// page puts it when it is back (the latest turn's end, or a turn picked at its top: Turns's effect), not moved by this.
export const END_PX = 40;

const atEnd = (n: HTMLElement) => n.scrollHeight - n.scrollTop - n.clientHeight < END_PX;
const ends = new WeakMap<Element, boolean>(); // each box: at its end when last scrolled, placed or sized
const listened = new WeakSet<Element>();
const holds = new WeakMap<Element, HTMLElement>(); // a part of what a box holds, watched: its box
let sizes: ResizeObserver | null = null;

/** Where the page has just put `node`, at its end or not -- as a scroll event would say, which a scroll to where it
 * already was does not send. */
export function placed(node: HTMLElement): void {
  if (node.clientHeight) ends.set(node, atEnd(node));
}

/** Whether `node` is at its end, as last scrolled or placed. */
export const isAtEnd = (node: HTMLElement | null): boolean => !!node && !!ends.get(node);

function resized(seen: ResizeObserverEntry[]) {
  for (const { target } of seen) {
    const box = holds.get(target);
    if (box) {
      keepEnd(box); // what it holds grew or shrank
      continue;
    }
    const n = target as HTMLElement;
    if (!n.clientHeight) {
      if (!n.isConnected) ends.delete(n);
      continue;
    }
    if (ends.get(n)) n.scrollTop = n.scrollHeight;
    ends.set(n, atEnd(n));
  }
}

/** `node` at its end again, if it was there when last scrolled or placed: what it holds has grown since. */
export function keepEnd(node: HTMLElement): void {
  if (!node.clientHeight || !ends.get(node)) return;
  node.scrollTop = node.scrollHeight;
  ends.set(node, true);
}

/** `node` kept at its end when it changes size, if it was there: as it is made, and again once followed no longer. */
export function followEnd(node: HTMLElement): void {
  if (typeof ResizeObserver === "undefined") return; // (jsdom, as Bubble.tsx's)
  sizes ??= new ResizeObserver(resized);
  if (!listened.has(node)) node.addEventListener("scroll", () => placed(node), { passive: true });
  listened.add(node);
  sizes.observe(node);
}

/** `box` kept at its end as `part` of what it holds changes size, if it was there. */
export function followContent(box: HTMLElement, part: Element): void {
  if (typeof ResizeObserver === "undefined") return;
  sizes ??= new ResizeObserver(resized);
  holds.set(part, box);
  sizes.observe(part);
}

/** `node` no longer followed, nor `parts` of what it held: its conversation let go of (mount.tsx). */
export function unfollow(node: HTMLElement, parts: Element[] = []): void {
  sizes?.unobserve(node);
  ends.delete(node);
  for (const p of parts) {
    sizes?.unobserve(p);
    holds.delete(p);
  }
}
