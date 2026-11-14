// The conversation kept at its end as its box changes size -- the window made shorter or narrower, the files and
// commands opened beside it, the message box grown with what is typed: read to its end before, at its end after. A box
// made smaller keeps its top where it was, so without this its end goes out of sight under the message box; the page
// follows the end only when it draws (03-settings.js's keepingPlace), and a size change is no draw.
//
// At its end: within END_PX of it, as keepingPlace has it -- known from the reader's last scroll, or where the page last
// put it (`placed`), since once the box has changed size it no longer is. A box hidden (a file shown beside it in a
// narrow window) is at its end again when shown, if it was; one taken from the page (another actor shown) is where the
// page puts it when it is back (the latest turn's end, or a turn picked at its top: Turns's effect), not moved by this.
export const END_PX = 40;

const atEnd = (n: HTMLElement) => n.scrollHeight - n.scrollTop - n.clientHeight < END_PX;
const ends = new WeakMap<Element, boolean>(); // each box: at its end when last scrolled, placed or sized
let sizes: ResizeObserver | null = null;

/** Where the page has just put `node`, at its end or not -- as a scroll event would say, which a scroll to where it
 * already was does not send. */
export function placed(node: HTMLElement): void {
  if (node.clientHeight) ends.set(node, atEnd(node));
}

function resized(seen: ResizeObserverEntry[]) {
  for (const { target } of seen) {
    const n = target as HTMLElement;
    if (!n.clientHeight) {
      if (!n.isConnected) ends.delete(n);
      continue;
    }
    if (ends.get(n)) n.scrollTop = n.scrollHeight;
    ends.set(n, atEnd(n));
  }
}

/** `node` kept at its end when it changes size, if it was there: once for each node, as it is made. */
export function followEnd(node: HTMLElement): void {
  if (typeof ResizeObserver === "undefined") return; // (jsdom, as Bubble.tsx's)
  sizes ??= new ResizeObserver(resized);
  node.addEventListener("scroll", () => placed(node), { passive: true });
  sizes.observe(node);
}
