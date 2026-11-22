// THE BAR UNDER THE LIST while two actors or more are selected (list.ts's picks): how many, then Move to… -- the
// gatherer's top, each of its folders as a tree, or a new folder (Radix's DropdownMenu, as Menus.tsx's) -- Save or
// Unsave them all, Close them all, and ✕ to clear the selection (Esc too).
import { Html } from "../../core/ui/PageNode";
import type { MenuInfo } from "./host";
import { PageMenu } from "./Menus";

/** The bar as it is now: how many are selected, whether every one is saved, its group's name; and what it calls. */
export interface PickBarModel {
  n: number;
  allSaved: boolean;
  group: string;
}
export interface PickBarHost {
  icon(name: string, size: number): Node;
  saveIcon(on: boolean): Node;
  closeIcon(): Node;
  moveMenu(): MenuInfo | null;
  save(on: boolean): void;
  close(): void;
  clear(): void;
}

export function PickBar({ m, host }: { m: PickBarModel; host: PickBarHost }) {
  return (
    <>
      <span className="n">{`${m.n} selected`}</span>
      <PageMenu
        host={host}
        trigger={{ className: "pb", "data-pop": "picks:move", title: `Move to a folder in ${m.group}` }}
        menu={host.moveMenu}
      >
        <Html node={host.icon("folder", 14)} />
        Move to…
      </PageMenu>
      <button
        type="button"
        className="pb"
        title={m.allSaved ? "Unsave them all" : "Save them all for later"}
        onClick={() => host.save(!m.allSaved)}
      >
        <Html node={host.saveIcon(m.allSaved)} />
        {m.allSaved ? "Unsave" : "Save"}
      </button>
      <button type="button" className="pb" title="Close them all, even mid-turn" onClick={() => host.close()}>
        <Html node={host.closeIcon()} />
        Close
      </button>
      <button
        type="button"
        className="pb x"
        title="Clear the selection (Esc)"
        aria-label="Clear the selection"
        onClick={() => host.clear()}
      >
        ✕
      </button>
    </>
  );
}
