// The list's BOXES (model.ts's nodes): a gatherer's -- its row, and, open, what is in it set in under it -- a folder's line
// and what is in it, a fold's line ("▸ 2 closed") and what it shows, a folder of gatherers', the actors on their own; each
// drawn where the model puts it, by its key, so a row stays the same element from one draw to the next.
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";
import { plural } from "../../core/format";
import type { ListHost } from "./host";
import { CountChips, CrewButton, FoldMark, FolderBox, NameBox, TallyChips, useFilled } from "./Parts";
import type { FoldNode, FolderNode, GathererNode, GfFolderNode, Node } from "./rows";
import { ActorRowView, AppRowView, ShellRowView, TaskRowView } from "./RowViews";
import { GF } from "./tree";
import type { Folder, Gatherer } from "./types";

/** The folders gatherers are kept in, as the page's drag code names them: a gatherer of their own. */
export const GFS: Gatherer = { name: GF, agents: [] };
/** A folder's name: as long as the server keeps (folders.py). */
const FOLDER_CHARS = 60;
const stop = (ev: MouseEvent) => ev.stopPropagation();

/** What a gatherer's row, a folder's line or the list's head does with what is dragged over it: put in folder `id` of
 * `g` (null: its top); held over it a moment, `open` opens it. */
export const drops = (host: ListHost, g: Gatherer, id: number | null, open: () => void) =>
  host.snapshot
    ? {}
    : {
        onDragEnter: (ev: DragEvent) => host.dropEnter(ev, g, id, open),
        onDragOver: (ev: DragEvent) => host.dropOver(ev, g, id),
        onDragLeave: (ev: DragEvent) => host.dropLeave(ev),
        onDrop: (ev: DragEvent) => host.drop(ev, g, id),
      };
/** A folder's line dragged: put in another folder, or at its gatherer's top. */
const dragsFolder = (host: ListHost, g: Gatherer, f: Folder) =>
  host.snapshot
    ? {}
    : { draggable: true, onDragStart: (ev: DragEvent) => host.dragFolder(ev, g, f), onDragEnd: () => host.dragEnd() };
/** F2 on a folder's button: named in its line. */
const renames = (host: ListHost, gname: string, id: number) => (ev: KeyboardEvent) => {
  if (ev.key === "F2" && !host.snapshot) {
    ev.preventDefault();
    host.startFolderEdit(gname, id);
  }
};

/** A node of the list, drawn. */
export function NodeView({ host, n }: { host: ListHost; n: Node }) {
  switch (n.kind) {
    case "gatherer":
      return <GathererBox host={host} n={n} />;
    case "alone":
      return (
        <div
          className="gatherer alone"
          title="On its own · shares context with no other actor. Drag it into a group to bring it back."
        >
          {n.kids.map((k) => (
            <NodeView key={k.key} host={host} n={k} />
          ))}
        </div>
      );
    case "alone-shut":
      return (
        <div className="gatherer alone shut">
          {n.folds.map((k) => (
            <Fold key={k.key} host={host} n={k} />
          ))}
        </div>
      );
    case "gf-folder":
      return <GfLines host={host} n={n} />;
    case "gf-making":
      return (
        <div className="folder-line gf-line making" data-key={n.key} role="status">
          <span className="fname">{n.text}</span>
          <span className="fill">Making the group…</span>
        </div>
      );
    case "folder-new":
      return (
        <div className={"folder-line" + (n.g === GF ? " gf-line" : "") + " editing"} data-key={n.key}>
          <FolderBox host={host} max={FOLDER_CHARS} />
        </div>
      );
    case "folder":
      return <FolderRows host={host} n={n} />;
    case "fold":
      return <Fold host={host} n={n} />;
    case "actor":
      return <ActorRowView host={host} r={n} />;
    case "task":
      return <TaskRowView host={host} r={n} />;
    case "app":
      return <AppRowView host={host} r={n} />;
    case "shell":
      return <ShellRowView host={host} r={n} />;
  }
}
const Kids = ({ host, kids }: { host: ListHost; kids: Node[] }) =>
  kids.map((k) => <NodeView key={k.key} host={host} n={k} />);

/** The form for a new actor, under a gatherer's row: the page's, made again only when what it shows changes, so what is
 * typed in it stays. */
function NewForm({ host, at }: { host: ListHost; at: string }) {
  const ref = useFilled<HTMLDivElement>(() => [host.newForm()], [at]);
  return <div style={{ display: "contents" }} ref={ref} />;
}

/** A gatherer's box: its row -- its name, its coordinator agent, its counts, its buttons over them on hover -- and,
 * open, what is in it set in under it. Its row dragged: put in a folder of gatherers, or another group. */
function GathererBox({ host, n }: { host: ListHost; n: GathererNode }) {
  const g = n.g;
  const acts = useFilled<HTMLSpanElement>(() => host.gathererActs(g, n.title));
  const toggle = () => host.toggleGatherer(g.name);
  const drag = n.draggable
    ? {
        draggable: true,
        onClickCapture: (ev: MouseEvent) => host.pickGatherer(ev, g), // before its name's button folds it
        onDragStart: (ev: DragEvent) => host.dragGatherer(ev, g),
        onDragEnd: () => host.dragEnd(),
      }
    : {};
  return (
    <div className={"gatherer" + (n.nested ? " nested" : "") + (n.picking ? " picking" : "")}>
      <div
        className={"gatherer-row" + (n.draggable && n.gPicked ? " picked" : "")}
        data-key={n.key}
        {...drag}
        {...drops(host, g, null, () => host.openGatherer(g.name))}
      >
        <button
          className="name"
          type="button"
          aria-expanded={n.open ? "true" : "false"}
          onClick={toggle}
          title={g.policy ? `${g.name} · policy ${g.policy}` : g.name}
        >
          <span className="caret">▶</span>
          {n.renaming ? null : <span className="gname">{n.title}</span>}
        </button>
        {n.renaming ? <NameBox host={host} /> : null}
        {host.snapshot ? null : <CrewButton host={host} g={g} node={`group:${g.name}`} />}
        <span className="fill" onClick={toggle}>
          <CountChips c={n.counts} />
          <span className="g-acts" ref={acts} onClick={stop} />
        </span>
      </div>
      {n.adding ? <NewForm host={host} at={host.formAt()} /> : null}
      {n.error ? <div className="servers">{`Database unreadable: ${n.error}`}</div> : null}
      {n.kids.length ? (
        <div className="g-kids">
          <Kids host={host} kids={n.kids} />
        </div>
      ) : null}
    </div>
  );
}

/** A folder's line, and under it, while its × asks first, the question; open, its box, set in -- a closed one's all it
 * holds -- or, folded, its actors open in a pane. */
function FolderRows({ host, n }: { host: ListHost; n: FolderNode }) {
  return (
    <>
      {n.editing ? (
        <div className="folder-line editing" data-key={n.key}>
          <FolderBox host={host} max={FOLDER_CHARS} />
        </div>
      ) : (
        <FolderLine host={host} n={n} />
      )}
      {n.asking ? <CloseAsk host={host} g={n.g} f={n.f} /> : null}
      {n.kids ? (
        <div className="f-kids">
          {n.kids.length ? <Kids host={host} kids={n.kids} /> : <div className="f-empty">{n.empty}</div>}
        </div>
      ) : n.peek.length ? (
        <div className="f-kids peek">
          <Kids host={host} kids={n.peek} />
        </div>
      ) : null}
    </>
  );
}

/** A folder's line: its caret and name, a button opening or folding it; at its right how many of the actors it holds
 * wait on the reader, stopped on an error, run, are idle; hovered or in focus, its buttons over those (the page's). A
 * closed one, greyed, says how many actors it holds. Dragged: put in another folder; actors dropped on it, put in it. */
function FolderLine({ host, n }: { host: ListHost; n: FolderNode }) {
  const { g, f, closed, held } = n,
    t = n.tally;
  const acts = useFilled<HTMLSpanElement>(() => host.folderActs(n));
  const toggle = () => host.toggleFolder(g.name, f.id);
  const says = closed
    ? `${f.name}: closed, ${plural(held, "actor")} in it`
    : `${f.name}: ${plural(t.open, "actor")} open${t.saved ? `, ${t.saved} saved` : ""}${t.closed ? `, ${t.closed} closed` : ""}`;
  return (
    <div
      className={"folder-line" + (closed ? " closed" : "")}
      data-key={n.key}
      data-card={`${g.name}\u0000folder:${f.id}`}
      {...dragsFolder(host, g, f)}
      {...drops(host, g, f.id, () => host.openFolder(g.name, f.id))}
    >
      <button
        className="fbtn"
        type="button"
        aria-expanded={n.open ? "true" : "false"}
        title={host.hovers() ? undefined : says}
        onClick={toggle}
        onKeyDown={renames(host, g.name, f.id)}
      >
        <span className="caret" aria-hidden="true">
          ▶
        </span>
        <span className="fname">{f.name}</span>
      </button>
      {host.snapshot || closed || !n.crew ? null : <CrewButton host={host} g={g} node={`folder:${f.id}`} />}
      <span className="fill" onClick={toggle}>
        {closed ? (
          held ? (
            <span className="count closed" title={plural(held, "closed actor")}>
              <i aria-hidden="true" />
              {String(held)}
            </span>
          ) : null
        ) : (
          <TallyChips t={t} />
        )}
        {host.snapshot ? null : <span className="f-acts" ref={acts} onClick={stop} />}
      </span>
    </div>
  );
}

/** A folder's × asking first, under its line: what closing it would close, end, take off -- "Close folder", or Cancel
 * (Esc). */
function CloseAsk({ host, g, f }: { host: ListHost; g: Gatherer; f: Folder }) {
  const { said, where } = host.closeAsk(g, f);
  const button = (which: string, cls: string, text: string, run: () => void) => (
    <button
      type="button"
      className={`pb ${cls}`}
      data-ask={which}
      onClick={(ev) => {
        ev.stopPropagation();
        run();
      }}
      onFocus={() => host.askFocus(which)}
    >
      {text}
    </button>
  );
  return (
    <div
      className="f-ask"
      role="alertdialog"
      aria-label={`Close ${f.name}?`}
      data-key={`${g.name}/folder:${f.id}/ask`}
      onClick={stop}
      onKeyDown={(ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          host.closeAskCancel();
        }
      }}
    >
      <p>
        <b>{`Close ${f.name}?`}</b>
        {` This ${said}. The folder moves to ${where}'s closed line.`}
      </p>
      <div className="f-ask-btns">
        {button("go", "go", "Close folder", () => host.closeFolderGo(g, f))}
        {button("cancel", "", "Cancel", () => host.closeAskCancel())}
      </div>
    </div>
  );
}

/** A box's fold: its line ("▸ N closed"), and under it what it shows -- open, all in it; folded, those open in a pane. */
function Fold({ host, n }: { host: ListHost; n: FoldNode }) {
  return (
    <>
      <button
        className="agent-group fold-line"
        type="button"
        aria-expanded={n.shown ? "true" : "false"}
        data-key={n.key}
        title={n.title}
        onClick={() => host.toggleFold(n.name, n.foldKey)}
      >
        <FoldMark open={n.shown} /> {n.says}
      </button>
      <Kids host={host} kids={n.kids} />
    </>
  );
}

/** A folder of gatherers: its line -- its caret and name, a button opening or folding it, its coordinator agent's face
 * if it has one; hovered or in focus, its buttons (the page's) -- and, open, what is in it under it. Dragged: into
 * another, or onto the list's head; a gatherer or a folder of them dropped on it, put in it. */
function GfLines({ host, n }: { host: ListHost; n: GfFolderNode }) {
  const f = n.f;
  const acts = useFilled<HTMLSpanElement>(() => host.gfActs(f, n.crew));
  const toggle = () => host.toggleFolder(GF, f.id);
  return (
    <>
      {n.editing ? (
        <div className="folder-line gf-line editing" data-key={n.key}>
          <FolderBox host={host} max={FOLDER_CHARS} />
        </div>
      ) : (
        <div
          className="folder-line gf-line"
          data-key={n.key}
          {...dragsFolder(host, GFS, f)}
          {...drops(host, GFS, f.id, () => host.openFolder(GF, f.id))}
        >
          <button
            className="fbtn"
            type="button"
            aria-expanded={n.open ? "true" : "false"}
            title={`${f.name}: a folder of groups`}
            onClick={toggle}
            onKeyDown={renames(host, GF, f.id)}
          >
            <span className="caret" aria-hidden="true">
              ▶
            </span>
            <span className="fname">{f.name}</span>
          </button>
          {host.snapshot || !n.crew ? null : <CrewButton host={host} g={null} node={`groups:${f.id}`} />}
          <span className="fill" onClick={toggle}>
            {host.snapshot ? null : <span className="f-acts" ref={acts} onClick={stop} />}
          </span>
        </div>
      )}
      {n.kids ? (
        <div className="gf-kids">
          {n.kids.length ? <Kids host={host} kids={n.kids} /> : <div className="f-empty">{n.empty}</div>}
        </div>
      ) : null}
    </>
  );
}
