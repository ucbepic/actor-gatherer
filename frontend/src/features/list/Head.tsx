// THE LIST'S HEAD, held at its top as it scrolls: its title; the place to drop what is dragged outside every group
// (shown while such a drag goes on, in the home's one database); a new group, an actor on its own and the coordinator
// agent over everything (none in a snapshot); the list's own buttons. A gatherer or a folder of gatherers dropped on it
// goes to the list's top (AgentList.tsx's drops).
import { StrokeIcon } from "../../core/ui/Icon";
import type { ListHost } from "./host";
import { ListButtons } from "./ListButtons";
import { CrewButton, OutsideDrop } from "./Parts";

/** What the head's "+" for an actor on its own opens: its box (panes.js's railNewBox), by this key (its data-pop). */
export const ALONE_NEW = "self:new";

export function HeadParts({ host, merged }: { host: ListHost; merged: boolean }) {
  const snap = host.snapshot;
  return (
    <>
      <h2>Agents</h2>
      {snap || !merged ? null : <OutsideDrop can={host.outsideCan} drop={host.outsideDrop} />}
      {snap ? null : (
        <button className="gf-new" type="button" title="New folder" aria-label="New folder" onClick={host.newGroup}>
          <StrokeIcon d={host.iconPath("folderNew")} size={15} />
        </button>
      )}
      <AloneNew host={host} />
      {snap || !merged ? null : <CrewButton host={host} g={null} node="all" />}
      <span className="list-btns">
        <ListButtons info={host.listButtons()} host={host} />
      </span>
    </>
  );
}

/** An actor on its own from its start (group-moves.ts's aloneNew): "+" and an actor's mark, opening its box -- the
 * directory it works in, the harness -- under the head; or, none can start, its title says why. */
function AloneNew({ host }: { host: ListHost }) {
  const n = host.aloneNew();
  if (!n) return null;
  return (
    <button
      className={"alone-new" + (n.busy ? " busy" : "")}
      type="button"
      data-pop={ALONE_NEW}
      disabled={!!n.why || n.off || undefined}
      title={n.why || "New actor on its own · shares context with no group"}
      aria-label="New actor on its own"
      aria-haspopup="dialog"
      aria-expanded={n.open ? "true" : "false"}
      onClick={(ev) => host.aloneNewPress(ev.currentTarget)}
    >
      <span className="plus" aria-hidden="true">
        +
      </span>
      <StrokeIcon d={host.iconPath("agent")} size={15} />
    </button>
  );
}
