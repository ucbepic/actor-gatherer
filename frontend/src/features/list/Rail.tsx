// THE RAIL (nav#rail): the list folded, small, from its view-model (rail-model.ts) -- each gatherer's name over its tiles
// (a button folding it; hovered, its card has its buttons), its folders folded to their names and counts or open in place
// (a square bracket down their left), its saved and closed lines, the folders of gatherers; drilled in, Up and Root and
// the path over the name drilled into; at its foot, "Show…": what it shows. Each node drawn where the model puts it, by
// its key, so a tile stays the same element from one draw to the next -- hovered, in focus or dragged, it stays so.
import { Fragment, useState, type MouseEvent } from "react";
import { plural } from "../../core/format";
import { key } from "../../core/model/keys";
import { Html } from "../../core/ui/PageNode";
import { drops } from "./Boxes";
import type { ListHost, PageParts } from "./host";
import { CountChips, FoldMark, TallyChips } from "./Parts";
import type { RailAt, RailModel, RAlone, RCounts, RFold, RFolder, RGatherer, RGf, RHere, RNode } from "./rail-model";
import { ActorTile, AppTile, RailDraw, TaskTile } from "./RailTiles";
import { GF, type Tally } from "./tree";
import type { Folder, ListCtx } from "./types";

/** What the rail calls of the page around it (features/list/modes.js's RAIL_HOST): the list's own presses and drags,
 * and the rail's -- drilled in or out, a busy folder folded, what its foot shows. */
export interface RailHost
  extends
    PageParts,
    Pick<
      ListHost,
      | "pick"
      | "pickBeside"
      | "togglePick"
      | "cardHide"
      | "openTask"
      | "selectApp"
      | "setSaved"
      | "hideCrew"
      | "closeActor"
      | "saveTask"
      | "closeTask"
      | "closeApp"
      | "toggleGatherer"
      | "toggleFolder"
      | "toggleFold"
      | "openGatherer"
      | "dragActor"
      | "dragItems"
      | "dragEnd"
      | "dropEnter"
      | "dropOver"
      | "dropLeave"
      | "drop"
      | "joinEnter"
      | "joinOver"
      | "joinDrop"
    > {
  ctx: ListCtx;
  /** the rail drilled in there (null: every gatherer); or there, unless it is there already */
  railGo(at: RailAt | null): void;
  railDrill(at: RailAt): void;
  /** a folder folded or opened in the rail: a busy one in the rail alone */
  railFold(gname: string, id: number, busy: boolean): void;
  /** held over, it opens */
  railSpring(gname: string, id: number, busy: boolean): void;
  setRailShow(what: "folders" | "saved" | "closed", on: boolean): void;
}

export function Rail({ m, host, draw }: { m: RailModel; host: RailHost; draw: number }) {
  return (
    <RailDraw value={draw}>
      <div className="r-actors">
        <Nodes nodes={m.nodes} host={host} />
      </div>
      {m.foot ? <Foot show={m.show} host={host} /> : null}
    </RailDraw>
  );
}

const Nodes = ({ nodes, host }: { nodes: RNode[]; host: RailHost }) =>
  nodes.map((n) => <NodeView key={n.key} n={n} host={host} />);

function NodeView({ n, host }: { n: RNode; host: RailHost }) {
  switch (n.kind) {
    case "actor":
      return <ActorTile n={n} host={host} />;
    case "task":
      return <TaskTile n={n} host={host} />;
    case "app":
      return <AppTile n={n} host={host} />;
    case "gatherer":
      return <GathererView n={n} host={host} />;
    case "folder":
      return <FolderView n={n} host={host} />;
    case "fold":
      return <FoldView n={n} host={host} />;
    case "alone":
      return <AloneView n={n} host={host} />;
    case "gf":
      return <GfView n={n} host={host} />;
    case "none":
      return <div className="r-none">{n.text}</div>;
    case "here":
      return <HereView n={n} host={host} />;
  }
}

/** A name's click folds or opens what it names; the second of a double-click folds it back as it was, and the rail
 * shows only it. */
const nameClick = (host: RailHost, fold: () => void, at: RailAt) => (ev: MouseEvent) => {
  host.cardHide();
  fold();
  if (ev.detail === 2) host.railDrill(at);
};
/** A name in a narrow column, broken after its _, - or . where it must break: "making_" over "ag", not "making_a"
 * over "g". */
const breakable = (text: string) =>
  String(text)
    .split(/(?<=[_\-.])/)
    .map((part, i) => (
      <Fragment key={i}>
        {i ? <wbr /> : null}
        {part}
      </Fragment>
    ));
const NameText = ({ name }: { name: string }) => (
  <span className="tx">
    <span className="caret" aria-hidden="true">
      ▶
    </span>
    <span className="nm">{name}</span>
  </span>
);
const folderSays = (f: Folder, t: Tally) =>
  `${f.name}: ${plural(t.open, "actor")} open${t.saved ? `, ${t.saved} saved` : ""}${t.closed ? `, ${t.closed} closed` : ""}`;
function CountsView({ c }: { c: RCounts }) {
  return (
    <div className="r-counts">{c.kind === "counts" ? <CountChips c={c.c} /> : <TallyChips t={c.t} idle={false} />}</div>
  );
}

/** A gatherer: its name, a button folding it as the list does (a double-click: only it); folded, the counts the list
 * shows for it, and its actors open in a pane; open, what is in it, under its name. */
function GathererView({ n, host }: { n: RGatherer; host: RailHost }) {
  const g = n.g;
  return (
    <section className={"r-gatherer" + (n.open ? " open" : "")} aria-label={n.title}>
      <button
        className="r-gname"
        type="button"
        aria-expanded={n.open ? "true" : "false"}
        data-card={key(g.name, "gatherer:")}
        title={
          host.hovers()
            ? undefined
            : `${n.title}${n.title !== g.name ? ` (${g.name})` : ""} · double-click to show only this group`
        }
        onClick={nameClick(host, () => host.toggleGatherer(g.name), { g: g.name, f: null })}
        {...drops(host, g, null, () => host.openGatherer(g.name))}
      >
        <span className="tx">
          <span className="caret">▶</span>
          <span className="nm">{n.title}</span>
        </span>
      </button>
      {n.open ? (
        // what is in it, in one box under its name, set in: a tree, each folder's in its bracket
        <div className="r-kids">
          <Nodes nodes={n.kids} host={host} />
        </div>
      ) : (
        <>
          {n.counts ? <CountsView c={n.counts} /> : null}
          <Nodes nodes={n.kids} host={host} />
        </>
      )}
    </section>
  );
}

/** A folder: open, its name over what is in it, set in; folded, as a folded gatherer is -- its name, how many actors it
 * holds open, and under it how many of those wait on the reader, stopped on an error, run. Dropped on, what is dragged
 * goes in it; held over folded, it opens. A closed one, greyed, in its closed line. */
function FolderView({ n, host }: { n: RFolder; host: RailHost }) {
  const { g, f, tally: t } = n;
  const fold = () => host.railFold(g.name, f.id, n.busy);
  const at = { g: g.name, f: f.id };
  if (n.open)
    return (
      <div
        className={"r-fopen" + (n.closed ? " closed" : "")}
        role="group"
        aria-label={n.closed ? `${f.name} (closed)` : f.name}
      >
        <button
          className="r-fhead"
          type="button"
          aria-expanded="true"
          data-card={n.card}
          title={`${f.name}${n.closed ? " (closed)" : ""} · double-click to show only this folder`}
          onClick={nameClick(host, fold, at)}
          {...drops(host, g, f.id, () => {})}
        >
          <NameText name={f.name} />
        </button>
        <div className="r-kids">
          <Nodes nodes={n.kids} host={host} />
        </div>
      </div>
    );
  const counts = !n.closed && (t.asking || t.error || t.notified || t.running);
  return (
    <div className={"r-ffold" + (n.closed ? " closed" : "")}>
      <button
        className="r-fname"
        type="button"
        aria-expanded="false"
        data-card={n.card}
        aria-label={`${f.name}, a folder: ${plural(t.open, "actor")} open`}
        title={host.hovers() ? undefined : folderSays(f, t)}
        onClick={nameClick(host, fold, at)}
        {...drops(host, g, f.id, () => host.railSpring(g.name, f.id, n.busy))}
      >
        <NameText name={f.name} />
      </button>
      {counts ? <CountsView c={{ kind: "tally", t }} /> : null}
    </div>
  );
}

/** A box's saved or closed line: "▸ N closed", opening what it holds in place. */
function FoldView({ n, host }: { n: RFold; host: RailHost }) {
  return (
    <button
      className="r-fold"
      type="button"
      aria-expanded={n.shown ? "true" : "false"}
      title={n.title}
      onClick={() => host.toggleFold(n.name, n.foldKey)}
    >
      <FoldMark open={n.shown} />
      {` ${n.says}`}
    </button>
  );
}

const ALONE_SAYS = "On its own · shares context with no other actor. Drag it into a group to bring it back.";
/** An actor on its own: its face alone; those closed, in their lines. */
function AloneView({ n, host }: { n: RAlone; host: RailHost }) {
  return n.shut ? (
    <section className="r-gatherer r-alone shut" aria-label="Closed, on their own">
      <Nodes nodes={n.kids} host={host} />
    </section>
  ) : (
    <section className="r-gatherer r-alone" aria-label="On its own" title={ALONE_SAYS}>
      <Nodes nodes={n.kids} host={host} />
    </section>
  );
}

/** A folder of gatherers: its name in a bracket, a button folding or opening it (no card, no drilling in, nothing
 * dropped on it), and, open, what is in it under it. */
function GfView({ n, host }: { n: RGf; host: RailHost }) {
  const f = n.f;
  const name = (
    <button
      className={n.open ? "r-fhead" : "r-fname"}
      type="button"
      aria-expanded={n.open ? "true" : "false"}
      title={`${f.name}: a folder of groups · click to ${n.open ? "fold" : "open"}`}
      onClick={() => {
        host.cardHide();
        host.toggleFolder(GF, f.id);
      }}
    >
      <NameText name={f.name} />
    </button>
  );
  if (!n.open) return <div className="r-ffold r-gf">{name}</div>;
  return (
    <div className="r-fopen r-gf" role="group" aria-label={f.name}>
      {name}
      <div className="r-kids">
        {n.kids.length ? <Nodes nodes={n.kids} host={host} /> : <div className="r-none">Empty</div>}
      </div>
    </div>
  );
}

/** The rail drilled in: Up and Root, where it is (the path to it small over its name, its card hovered; the name a
 * button folding or opening what is in it), then what is in it -- folded, its counts, and its actors open in a pane. */
function HereView({ n, host }: { n: RHere; host: RailHost }) {
  const { g, f } = n;
  const fold = () => (f ? host.railFold(g.name, f.id, n.busy) : host.toggleGatherer(g.name));
  return (
    <section className="r-gatherer open r-drilled" aria-label={n.name}>
      <div className="r-nav">
        <button className="r-navb up" type="button" title={n.up} onClick={() => host.railGo(n.upAt)}>
          <Html node={host.icon("up", 13)} />
          <span>Up</span>
        </button>
        <button className="r-navb root" type="button" title="Root: every group" onClick={() => host.railGo(null)}>
          <Html node={host.icon("home", 13)} />
          <span>Root</span>
        </button>
      </div>
      <div className={"r-here" + (f ? " folder" : "")}>
        {n.steps.length ? (
          <div className="r-path" role="group" aria-label="Path">
            {n.steps.map((s) => (
              <button
                key={s.at.f === null ? "" : s.at.f}
                className="r-step"
                type="button"
                title={`Show only ${s.name}`}
                onClick={() => host.railGo(s.at)}
                {...drops(host, g, s.at.f, () => {})}
              >
                <span className="nm">{s.name}</span>
                <span className="sep" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <button
          className="r-hname"
          type="button"
          aria-expanded={n.open ? "true" : "false"}
          data-card={key(g.name, f ? `folder:${f.id}` : "gatherer:")}
          title={`${n.open ? "Fold" : "Open"} ${n.name}`}
          onClick={() => {
            host.cardHide();
            fold();
          }}
          {...drops(host, g, f ? f.id : null, () =>
            f ? host.railSpring(g.name, f.id, n.busy) : host.openGatherer(g.name),
          )}
        >
          <span className="caret" aria-hidden="true">
            ▶
          </span>
          <span className="nm">{breakable(n.name)}</span>
        </button>
      </div>
      {n.counts ? <CountsView c={n.counts} /> : null}
      <Nodes nodes={n.kids} host={host} />
    </section>
  );
}

/** The rail's foot: "Show…", folded; hovered, in focus from the keys, or pressed (where there is no hovering), a box
 * each for folders, saved and closed opens over the word, which stays where it is -- opened or not as the reader left
 * it, the rail drawn again above it. */
let footOpen = false;
function Foot({ show, host }: { show: RailModel["show"]; host: RailHost }) {
  const [open, setOpen] = useState(footOpen);
  const box = (what: "folders" | "saved" | "closed", says: string) => (
    <label className="r-check" title={says}>
      <input
        type="checkbox"
        data-show={what}
        aria-label={`Show ${what}`}
        checked={show[what]}
        onChange={(ev) => host.setRailShow(what, ev.currentTarget.checked)}
      />
      <span>{what}</span>
    </label>
  );
  return (
    <div className={"r-show" + (open ? " open" : "")} role="group" aria-label="What the rail shows">
      <div className="r-checks">
        {box("folders", "Show every folder, not only those with open actors")}
        {box("saved", "Show saved actors that are closed")}
        {box("closed", "Show closed actors")}
      </div>
      <button
        className="r-show-hd"
        type="button"
        aria-expanded={open ? "true" : "false"}
        title="Choose what the rail shows"
        onClick={() => setOpen((footOpen = !open))}
      >
        Show…
      </button>
    </div>
  );
}
