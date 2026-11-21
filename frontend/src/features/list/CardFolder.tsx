// A FOLDER'S AND A GATHERER'S HOVER CARD (Card.tsx): what a folder holds, as a tree, its first level shown -- live (in
// the rail), its buttons first, as its line's in the list ("+ actor", "+ ⋯", a new folder in it, rename, delete, close;
// a closed one's: rename, delete, reopen), its name box under them while one is named, the question its × asks first, a
// folder of the tree opened in place by a click, an actor shown by one, and at its foot, the folder opened in the rail or
// the rail drilled into it. A gatherer's: how many actors it holds open and how many folders, its counts, its buttons.
import { Fragment, type CSSProperties } from "react";
import { plural } from "../../core/format";
import { Html } from "../../core/ui/PageNode";
import { CardAct, EditBox, RowStatus, type CardEdit, type CardHost, type CardWhat } from "./CardParts";
import { gathererCounts, titleOf } from "./groups";
import { AskClose, CountChips } from "./Parts";
import { railName } from "./rail-model";
import { groupOf, isCoordinator, statusOf } from "./status";
import {
  boxGroups,
  closedSays,
  folderPath,
  folderTally,
  kidFolders,
  OPEN,
  parentOf,
  shownClosed,
  treeOf,
} from "./tree";
import type { Actor, Folder, Gatherer } from "./types";

type FolderWhat = Extract<CardWhat, { kind: "folder" }>;
type GathererWhat = Extract<CardWhat, { kind: "gatherer" }>;

/** A card's "+ actor" or "+ ⋯", started in its folder (`f`; null: its gatherer's top): the directory asked in a box
 * beside it, if none is known or starting there fails, the list being folded away. */
function StartAct({ host, which, g, f }: { host: CardHost; which: "new" | "more"; g: Gatherer; f: Folder | null }) {
  const s = host.startInfo(which, g, f);
  if (!s) return null;
  return (
    <button
      className={(which === "new" ? "act start new-actor" : "act start new-more") + (s.busy ? " busy" : "")}
      type="button"
      data-pop={s.key || undefined}
      disabled={s.disabled || undefined}
      title={s.title}
      aria-label={s.label}
      aria-haspopup={(s.haspopup as "menu" | "dialog" | null) || undefined}
      aria-expanded={s.expanded === null ? undefined : s.expanded ? "true" : "false"}
      onClick={(ev) => host.startPress(which, g, f, ev.currentTarget)}
    >
      <span className="plus" aria-hidden="true">
        +
      </span>
      <Html node={host.icon(which === "new" ? "agent" : "more", 14)} />
    </button>
  );
}
const Starts = ({ host, g, f }: { host: CardHost; g: Gatherer; f: Folder | null }) => (
  <>
    <StartAct host={host} which="new" g={g} f={f} />
    <StartAct host={host} which="more" g={g} f={f} />
  </>
);
const icon = (host: CardHost, name: string, size: number) => <Html node={host.icon(name, size)} />;

export function FolderCard({ host, w, edit }: { host: CardHost; w: FolderWhat; edit: CardEdit | null }) {
  const { ctx } = host,
    { g, f, live } = w;
  const up = parentOf(ctx, g.name, f),
    closed = shownClosed(ctx, g, f);
  const rows = <Tree host={host} g={g} id={f.id} depth={0} live={live} opened={w.opened} />;
  const has = treeHas(host, g, f.id);
  const rename = (
    <CardAct
      key="rename"
      cls="rename"
      title={`Rename ${f.name}`}
      icon={icon(host, "pencil", 13)}
      run={() => host.editIn({ g: g.name, id: f.id, parent: up })}
    />
  );
  const del = (
    <CardAct
      key="delete"
      cls="delete"
      title={`Delete ${f.name} · its contents move up a level`}
      icon={icon(host, "bin", 14)}
      run={() => {
        host.cardHide();
        host.deleteFolder(g.name, f.id);
      }}
    />
  );
  const ask = w.asking && live ? host.closeAsk(g, f) : null;
  return (
    <>
      <div className="c-who">
        <span className="c-folder">{icon(host, "folder", 18)}</span>
        <div className="tx">
          <div className="c-nm">{f.name}</div>
          <div className="c-sub">
            {[titleOf(ctx, g), up === null ? null : folderPath(ctx, g.name, up), closed ? "closed" : null]
              .filter(Boolean)
              .join(" / ")}
          </div>
        </div>
      </div>
      {live ? (
        <div className="c-acts">
          {closed ? (
            <>
              {rename}
              {del}
              <CardAct
                cls="reopen"
                title={`Reopen ${f.name} · its actors stay closed`}
                icon={icon(host, "folderOpen", 14)}
                run={() => host.reopenFolder(g.name, f.id)}
              />
            </>
          ) : (
            <>
              <Starts host={host} g={g} f={f} />
              <CardAct
                cls="new"
                title={`New folder in ${f.name}`}
                icon={icon(host, "folderNew", 14)}
                run={() => host.editIn({ g: g.name, id: null, parent: f.id })}
              />
              {rename}
              {del}
              <CardAct
                cls="close"
                title={`Close ${f.name} and every actor in it`}
                icon={<Html node={host.closeIcon()} />}
                run={() => host.pressClose(g, f)}
              />
            </>
          )}
        </div>
      ) : null}
      {ask ? (
        <AskClose
          g={g}
          f={f}
          said={ask.said}
          where={ask.where}
          go={() => host.closeGo(g, f)}
          cancel={() => host.closeCancel()}
          focus={(which) => host.askFocus(which)}
          out={(ev) => host.askOut(ev)}
        />
      ) : null}
      {live && edit ? <EditBox host={host} e={edit} gname={g.name} /> : null}
      {has ? <div className="c-tree">{rows}</div> : <div className="c-st">Empty</div>}
      {/* in the rail: opened there, or, the rail drilled into it, nothing to open */}
      {live ? (
        w.here ? null : (
          <button
            className="c-more"
            type="button"
            onClick={() => {
              host.cardHide();
              host.openInRail(g.name, f.id);
            }}
          >
            Open in the rail ›
          </button>
        )
      ) : (
        <div className="c-hint">Click to open or fold it</div>
      )}
      {live && !w.here ? (
        <button className="c-more only" type="button" onClick={() => host.railDrill({ g: g.name, f: f.id })}>
          Show only this folder ›
        </button>
      ) : null}
    </>
  );
}

/** Whether folder `id`'s tree has anything to show: a folder not closed, an actor open, a saved or closed one. */
function treeHas(host: CardHost, g: Gatherer, id: number): boolean {
  const { ctx } = host,
    groups = new Map<string, unknown[]>(boxGroups(ctx, g, id));
  return (
    kidFolders(ctx, g.name, id).some((k) => !shownClosed(ctx, g, k)) ||
    !!(groups.get(OPEN) || []).length ||
    !!(groups.get("Saved") || []).length ||
    groups.has("Closed")
  );
}

/** What is in folder `id`, as the list has it, `depth` in: its folders, each with how many actors it holds open --
 * opened, what is in it under it -- then its actors open, then how many of its actors are saved and closed. Live, a
 * folder's row a button opening or folding it, an actor's one showing it. */
function Tree(p: {
  host: CardHost;
  g: Gatherer;
  id: number;
  depth: number;
  live: boolean;
  opened: ReadonlySet<number>;
}) {
  const { host, g, id, depth, live, opened } = p,
    { ctx } = host;
  const pad = { "--depth": depth } as CSSProperties;
  const groups = new Map<string, unknown[]>(boxGroups(ctx, g, id));
  const actors = (groups.get(OPEN) || []) as Actor[];
  const saved = (groups.get("Saved") || []) as Actor[];
  const rest = [
    saved.length ? `${saved.length} saved` : null,
    groups.has("Closed") ? closedSays(ctx, g, id, (groups.get("Closed") || []).length) : null,
  ].filter(Boolean);
  return (
    <>
      {kidFolders(ctx, g.name, id)
        .filter((k) => !shownClosed(ctx, g, k)) // said with the closed ones
        .map((k) => {
          const open = live && opened.has(k.id),
            n = folderTally(ctx, g, k.id).open;
          const parts = (
            <>
              <span className="caret" aria-hidden="true">
                ▶
              </span>
              <span className="g">{icon(host, open ? "folderOpen" : "folder", 14)}</span>
              <span className="nm">{k.name}</span>
              <span className="st">{n ? String(n) : ""}</span>
            </>
          );
          return (
            <Fragment key={`f${k.id}`}>
              {live ? (
                <button
                  className="c-row c-frow"
                  type="button"
                  aria-expanded={open ? "true" : "false"}
                  style={pad}
                  title={`${open ? "Fold" : "Open"} ${k.name}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    host.treeToggle(k.id);
                  }}
                >
                  {parts}
                </button>
              ) : (
                <div className="c-row c-frow" style={pad}>
                  {parts}
                </div>
              )}
              {open ? <Tree {...p} id={k.id} depth={depth + 1} /> : null}
            </Fragment>
          );
        })}
      {actors.map((a) => {
        const [cls, label] = statusOf(ctx, a);
        const parts = (
          <>
            <Html node={host.actorLogo(a)} />
            <span className="nm">{railName(a).text}</span>
            <RowStatus cls={cls} label={label} />
          </>
        );
        return live ? (
          <button
            key={`a${a.channel}`}
            className="c-row"
            type="button"
            style={pad}
            title={`Show it · ${host.besideKey}+click to open side by side`}
            onClick={(ev) => {
              host.cardHide();
              host.pick(g.name, a.channel, ev);
            }}
          >
            {parts}
          </button>
        ) : (
          <div key={`a${a.channel}`} className="c-row" style={pad}>
            {parts}
          </div>
        );
      })}
      {rest.length ? (
        <div className="c-rest" style={pad}>
          {rest.join(" · ")}
        </div>
      ) : null}
    </>
  );
}

/** A gatherer's card, in the rail: its name, how many actors it holds open and how many folders, its counts, and its
 * buttons, as its row's in the list -- "+ actor", "+ ⋯", a new folder, rename, hide -- its name box under them while
 * one is named. */
export function GathererCard({ host, w, edit }: { host: CardHost; w: GathererWhat; edit: CardEdit | null }) {
  const { ctx } = host,
    g = w.g,
    title = titleOf(ctx, g);
  const open = g.agents.filter((a) => !isCoordinator(a) && !["Saved", "Closed"].includes(groupOf(ctx, g, a))).length;
  const folders = treeOf(ctx, g.name).folders.length,
    c = gathererCounts(ctx, g);
  return (
    <>
      <div className="c-who">
        <span className="c-folder">{icon(host, "folder", 18)}</span>
        <div className="tx">
          <div className="c-nm">{title}</div>
          <div className="c-sub">
            {[`${plural(open, "actor")} open`, folders ? plural(folders, "folder") : null].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
      {c.asking || c.error || c.notified || c.running ? (
        <div className="c-counts">
          <CountChips c={c} />
        </div>
      ) : null}
      <div className="c-acts">
        <Starts host={host} g={g} f={null} />
        <CardAct
          cls="newfolder"
          title={`New folder in ${title}`}
          icon={icon(host, "folderNew", 14)}
          run={() => host.editIn({ g: g.name, id: null, parent: null })}
        />
        <CardAct
          cls="rename"
          title={`Rename ${title}`}
          icon={icon(host, "pencil", 13)}
          run={() => host.editIn({ g: g.name, gatherer: true })}
        />
        <CardAct
          cls="hide"
          title={`Hide ${g.name}`}
          icon={<Html node={host.hideIcon()} />}
          run={() => {
            host.cardHide();
            host.setHidden(g, true);
          }}
        />
      </div>
      {edit ? <EditBox host={host} e={edit} gname={g.name} /> : null}
      {w.here ? null : (
        <button className="c-more only" type="button" onClick={() => host.railDrill({ g: g.name, f: null })}>
          Show only this group ›
        </button>
      )}
      <div className="c-hint">{`Click the name to ${w.folded ? "show" : "fold"} its actors · double-click to show only this group`}</div>
    </>
  );
}
