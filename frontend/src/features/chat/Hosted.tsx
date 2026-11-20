// What the turn list shows of the old page's own drawing, until it moves too (types.ts's ChatHost): the actor's stage,
// kept on the page across renders while it shows the same, so its animations run on; and a node the old page builds,
// drawn as React's own.
import { useLayoutEffect, type RefObject } from "react";

/** Whether the node on the page shows what `next` does: by their data-sig, else by their markup -- the old page's
 * patch() rule for the nodes it kept from one draw to the next (features/page/main-view.js). */
function same(cur: Node, next: Node): boolean {
  if (cur instanceof HTMLElement && next instanceof HTMLElement && ("sig" in cur.dataset || "sig" in next.dataset))
    return cur.dataset.sig === next.dataset.sig && cur.tagName === next.tagName;
  return cur.isEqualNode(next);
}

/**
 * The old page's stage (`make`: core/page/helpers.js's atWork, atRest, greeting) first in `box`, before React's own nodes in it
 * (`after`, the first of them, if any): made again at each render, as each of the old page's draws made it -- its moments
 * counted on from the last -- and the node on the page kept while it shows the same, so its animations run on. The stage
 * may have put a node of its own in its place since (its next moment, on its own clock): what is first in `box` is
 * compared, not what was put there.
 */
export function useStage(
  box: RefObject<HTMLElement | null>,
  make: () => Node | null,
  after?: RefObject<Element | null>,
): void {
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    const first = b.firstChild;
    const cur = first && first !== (after?.current ?? null) ? first : null;
    const next = make();
    if (cur && next && same(cur, next)) return;
    if (cur && next) b.replaceChild(next, cur);
    else if (cur) cur.remove();
    else if (next) b.insertBefore(next, b.firstChild);
  });
}

// a node the old page builds, drawn as React's own: core/ui/PageNode.tsx, which the list draws with too
export { Html } from "../../core/ui/PageNode";
