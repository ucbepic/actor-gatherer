// THE LIST OF ACTORS (aside#agents), in React: its head, then each gatherer not hidden -- in the folders of gatherers it
// is kept in, with its folders, actors, tasks, apps and terminals -- the actors on their own closed in their lines at the
// end, and the hidden groups, as its view-model has them (model.ts); each drawn where the model puts it, by its key.
import { useList } from "./store";
import { drops, GFS, NodeView } from "./Boxes";
import type { ListHost } from "./host";
import { HeadParts } from "./Head";
import { ActorRowView } from "./RowViews";
import type { HiddenRow, ListModel } from "./rows";

export function AgentList() {
  const model = useList((s) => s.model),
    host = useList((s) => s.host);
  if (!model || !host) return null;
  return (
    <>
      <Head host={host} model={model} />
      {model.empty ? <div className="servers">{model.empty}</div> : null}
      {model.overAll ? (
        <div className="g-kids crew-top">
          <ActorRowView host={host} r={model.overAll} />
        </div>
      ) : null}
      {model.top.map((n) => (
        <NodeView key={n.key} host={host} n={n} />
      ))}
      {model.hidden.length ? <Hidden host={host} hidden={model.hidden} /> : null}
    </>
  );
}

/** The list's head, held at its top as it scrolls (Head.tsx); a gatherer or a folder of gatherers dropped on it, at the
 * list's top. */
function Head({ host, model }: { host: ListHost; model: ListModel }) {
  return (
    <div className="aside-head" {...drops(host, GFS, null, () => {})}>
      <HeadParts host={host} merged={model.merged} />
    </div>
  );
}

/** The hidden groups, folded under a line: each with why, and a button showing it again. */
function Hidden({ host, hidden }: { host: ListHost; hidden: HiddenRow[] }) {
  return (
    <details className="hidden-list" id="hidden-gatherers">
      <summary>{`${hidden.length} hidden group${hidden.length === 1 ? "" : "s"}`}</summary>
      {hidden.map((h) => (
        <div className="hidden-row" key={h.g.name}>
          <span className="gname">{h.title}</span>
          <span className="why">
            {h.hidden ? (
              "hidden"
            ) : (
              <>
                {"inactive, last active "}
                <span data-ago={h.last ?? undefined}>{host.ago(h.last)}</span>
              </>
            )}
          </span>
          <button type="button" onClick={() => host.setHidden(h.g, false)}>
            Show
          </button>
        </div>
      ))}
    </details>
  );
}
