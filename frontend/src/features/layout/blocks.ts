// How the TASKS shown are arranged in the work area -- each a block of its panels (work.ts) -- as a tree of their keys
// (tree.ts's), kept in this browser: a task no longer shown left out of it; one newly shown put where the reader dropped
// it (its row dragged from the list onto a side of another), else where a task shown so goes (addItem): a block of apps
// alone above the others, any other at the right of the one shown before it, as a task opened beside another goes.
import { addItem, insert, leaves, prune, type Side } from "./arrange";
import type { Node } from "./tree";

/** A block shown: its key, and whether it holds apps alone. */
export interface Block {
  key: string;
  alone: boolean;
}
/** A task to be put, once shown, on a side of another (`target`, a block's key). */
export interface Put {
  key: string;
  target: string;
  side: Side;
}

/** The blocks' arrangement for the blocks `shown`, from the one kept: those not shown left out, those not in it added. */
export function arrangeBlocks(kept: Node | null, shown: Block[], put: Put | null = null): Node | null {
  const keys = new Set(shown.map((b) => b.key)),
    alone = new Set(shown.filter((b) => b.alone).map((b) => b.key));
  let tree = kept ? prune(kept, (k) => keys.has(k)) : null;
  const items = shown.map((b) => ({ item: b.key, app: b.alone }));
  for (const it of items) {
    if (leaves(tree).includes(it.item)) continue;
    if (tree && put && put.key === it.item && leaves(tree).includes(put.target))
      tree = insert(tree, put.target, it.item, put.side);
    else tree = addItem(tree, it, items, (k) => alone.has(k));
  }
  return tree;
}
