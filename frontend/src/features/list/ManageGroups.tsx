// MANAGE GROUPS and the question a move between groups asks first, as Radix's dialogs (each a <dialog> the page's styles
// know, .mg-dialog and .mv-dialog): focus kept in the one on top while it is open and given back after, Esc and a press
// outside closing it -- Esc while a new folder is named closes that box, not the panel; while a move is under way,
// neither closes it. Manage groups (manage-model.ts's rows): each group, its folders and actors set in by depth, each
// with its switch; rows dragged and dropped as the list's are, a change of group asked first. The question: what moves,
// from which group to which, and who rebuilds its context; Cancel, and the button that does it. What each does is the
// page's (features/list/group-moves.js's DIALOG_HOST).
import * as D from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { Html } from "../../core/ui/PageNode";
import { drops } from "./Boxes";
import { titleOf } from "./groups";
import type { ListHost, PageParts } from "./host";
import type { MgActorRow, MgRow } from "./manage-model";
import { Face } from "./Parts";
import { drags } from "./RowViews";
import { actorTitle } from "./tasks";
import type { Actor, Folder, Gatherer, ListCtx } from "./types";

/** What the dialogs call of the page around them. */
export interface DialogsHost
  extends
    Pick<PageParts, "snapshot" | "icon" | "avatarSrc" | "harnessLogo">,
    Pick<ListHost, "dragActor" | "dragFolder" | "dragEnd" | "dropEnter" | "dropOver" | "dropLeave" | "drop">,
    Pick<ListHost, "joinEnter" | "joinOver" | "joinDrop" | "saveIcon" | "hideIcon" | "closeIcon">,
    Pick<ListHost, "hideCrew" | "setSaved" | "togglePick"> {
  ctx: ListCtx;
  // -- Manage groups
  close(): void;
  /** a row's fold flipped (`open` given: opened, or folded) */
  toggle(fold: string, open?: boolean): void;
  /** a new folder named in place: in folder `parent` of group `g` (null: at the top, a group of its own) */
  startNaming(g: Gatherer | null, parent: number | null, fold: string | null): void;
  namingTyped(value: string): void;
  endNaming(keep: boolean): void;
  namingBlur(): void;
  askOwn(g: Gatherer, f: Folder): void;
  askAbove(g: Gatherer): void;
  askJoin(g: Gatherer): void;
  askAloneHere(g: Gatherer, a: Actor): void;
  dragGroup(ev: DragEvent, g: Gatherer): void;
  /** outside every group: whether what is dragged may go there, and it dropped there */
  outsideCan(): boolean;
  outsideDrop(): void;
  // -- the question
  moveClose(): void;
}
/** A move's question, as it stands: its title and lines, the actors that move by name, a note (working it out, under
 * way, refused), and its button -- none until it is worked out. */
export interface MoveAsk {
  label: string;
  busy: boolean;
  title: string;
  lines: string[];
  names: { shown: string[]; more: number } | null;
  note: string;
  go: (() => void) | null;
  goLabel: string;
}
export interface DialogsModel {
  manage: { rows: MgRow[]; naming: { n: number; value: string } | null } | null;
  move: MoveAsk | null;
}

export function ListDialogs({ m, host }: { m: DialogsModel; host: DialogsHost }) {
  return (
    <>
      <D.Root open={!!m.manage} onOpenChange={(open) => !open && host.close()}>
        <D.Portal>
          <D.Overlay className="mg-dim">
            {m.manage ? (
              <D.Content
                asChild
                aria-describedby={undefined}
                // Esc while a new folder is named: that box closed, not the panel
                onEscapeKeyDown={(ev) => {
                  if (!m.manage?.naming) return;
                  ev.preventDefault();
                  host.endNaming(false);
                }}
              >
                <dialog open className="br-dialog mg-dialog" aria-label="Manage groups">
                  <Manage rows={m.manage.rows} naming={m.manage.naming} host={host} />
                </dialog>
              </D.Content>
            ) : null}
          </D.Overlay>
        </D.Portal>
      </D.Root>
      <D.Root open={!!m.move} onOpenChange={(open) => !open && host.moveClose()}>
        <D.Portal>
          <D.Overlay className="mg-dim">{m.move ? <Move ask={m.move} host={host} /> : null}</D.Overlay>
        </D.Portal>
      </D.Root>
    </>
  );
}

const stopIf = (busy: boolean) => (ev: Event) => {
  if (busy) ev.preventDefault();
};

/** The question a move asks first: its title, its lines, the actors that move, its note, then Cancel and its button. */
function Move({ ask, host }: { ask: MoveAsk; host: DialogsHost }) {
  const submit = useRef<HTMLButtonElement>(null);
  const ready = !!ask.go && !ask.busy;
  useEffect(() => {
    if (ready) submit.current?.focus();
  }, [ready, ask]);
  const off = ask.busy || undefined;
  return (
    <D.Content
      asChild
      aria-describedby={undefined}
      onEscapeKeyDown={stopIf(ask.busy)}
      onPointerDownOutside={stopIf(ask.busy)}
      onInteractOutside={stopIf(ask.busy)}
    >
      <dialog open className="br-dialog mv-dialog" aria-label={ask.label}>
        <form
          className="newform"
          method="dialog"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (ask.go && !ask.busy) ask.go();
          }}
        >
          <div className="br-title">
            <D.Title asChild>
              <h3>{ask.title}</h3>
            </D.Title>
            <button type="button" className="x" aria-label="Close" disabled={off} onClick={() => host.moveClose()}>
              <Html node={host.icon("x", 16)} />
            </button>
          </div>
          {ask.lines.map((t, i) => (
            <p key={i} className="mv-line">
              {t}
            </p>
          ))}
          {ask.names ? (
            <ul className="mv-names">
              {ask.names.shown.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
              {ask.names.more ? <li className="more">{`and ${ask.names.more} more`}</li> : null}
            </ul>
          ) : null}
          {ask.note ? (
            <p className="mv-note" role="status">
              {ask.note}
            </p>
          ) : null}
          <div className="row">
            <button type="button" disabled={off} onClick={() => host.moveClose()}>
              Cancel
            </button>
            {ask.go ? (
              <button ref={submit} type="submit" className="primary" disabled={off}>
                {ask.goLabel}
              </button>
            ) : null}
          </div>
        </form>
      </dialog>
    </D.Content>
  );
}

/** Manage groups' panel: its head (a new folder at the top, a group of its own; its ×), what it says, the place to drop
 * outside every group, then its rows. */
function Manage({
  rows,
  naming,
  host,
}: {
  rows: MgRow[];
  naming: { n: number; value: string } | null;
  host: DialogsHost;
}) {
  return (
    <div className="newform mg-form">
      <div className="br-title">
        <D.Title asChild>
          <h3>Manage groups</h3>
        </D.Title>
        <button
          type="button"
          className="mg-new"
          title="New folder at the top (a new group)"
          onClick={() => host.startNaming(null, null, null)}
        >
          <Html node={host.icon("folderNew", 14)} />
          New folder
        </button>
        <button type="button" className="x" aria-label="Close" onClick={() => host.close()}>
          <Html node={host.icon("x", 16)} />
        </button>
      </div>
      <div className="mg-top">
        <p className="mg-say">
          Actors share context only within their group. Change a folder&apos;s or actor&apos;s group with its switch, or
          drag rows as in the list. Each change asks for confirmation.
        </p>
        <OutsideDrop host={host} />
      </div>
      <div className="mg-tree">
        {rows.map((r) => (
          <Row key={r.key} r={r} naming={naming} host={host} />
        ))}
      </div>
    </div>
  );
}

/** The place to drop what is dragged outside every group, over the panel's top line: shown while such a drag goes on. */
function OutsideDrop({ host }: { host: DialogsHost }) {
  if (host.snapshot || !host.ctx.home.merged) return null;
  return (
    <div
      className="outside-drop"
      onDragEnter={(ev) => {
        if (!host.outsideCan()) return;
        ev.preventDefault();
        ev.currentTarget.classList.add("drop-on");
      }}
      onDragOver={(ev) => {
        if (!host.outsideCan()) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) ev.currentTarget.classList.remove("drop-on");
      }}
      onDrop={(ev) => {
        if (!host.outsideCan()) return;
        ev.preventDefault();
        ev.stopPropagation();
        host.outsideDrop();
      }}
    >
      Outside every group: a group of its own
    </div>
  );
}

/** A switch of its options (two, or one: a group at the top, or an actor on its own there, has no group around it to
 * take): `now` the one pressed; the other asks (`ask`), or, `why`, it can't be had and says why. An option is its text,
 * or [text, what it means on hover]. */
function Switch(p: {
  label: string;
  options: (string | [string, string])[];
  now: number;
  ask: () => void;
  why?: string;
}) {
  return (
    <span className="mg-switch" role="group" aria-label={p.label}>
      {p.options.map((o, i) => {
        const [text, tip] = Array.isArray(o) ? o : [o, ""],
          on = p.now === i;
        return (
          <button
            key={i}
            type="button"
            className={"mg-opt" + (on ? " on" : "")}
            aria-pressed={on ? "true" : "false"}
            disabled={on || !!p.why || undefined}
            title={p.why && !on ? p.why : tip || undefined}
            onClick={() => {
              if (!on) p.ask();
            }}
          >
            {text}
          </button>
        );
      })}
    </span>
  );
}
/** The option of taking group `g`, the one a row sits in: by its name. */
const inOf = (ctx: ListCtx, g: Gatherer): [string, string] => [
  titleOf(ctx, g),
  `Shares context with ${titleOf(ctx, g)}'s actors`,
];

/** A row's name, its caret first -- turned down while open, folding what is under it, and its name so too -- or, nothing
 * under it, the caret's room, so names line up. */
function Name({
  fold,
  name,
  has,
  open,
  host,
  children,
}: {
  fold: string;
  name: string;
  has: boolean;
  open: boolean;
  host: DialogsHost;
  children: ReactNode;
}) {
  return (
    <span className={"mg-name" + (has ? " foldable" : "")} onClick={has ? () => host.toggle(fold) : undefined}>
      {has ? (
        <button
          type="button"
          className="mg-fold"
          aria-expanded={open ? "true" : "false"}
          aria-label={`${open ? "Fold" : "Open"} ${name}`}
          onClick={(ev) => {
            ev.stopPropagation();
            host.toggle(fold);
          }}
        >
          <span className="caret" aria-hidden="true">
            ▶
          </span>
        </button>
      ) : (
        <span className="mg-fold" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
/** A row's button making a folder in it (folder `id` of group `g`; null: its top), seen while the row is hovered. */
const Add = ({
  host,
  g,
  id,
  name,
  fold,
}: {
  host: DialogsHost;
  g: Gatherer;
  id: number | null;
  name: string;
  fold: string;
}) => (
  <button
    type="button"
    className="mg-add"
    title={`New folder in ${name}`}
    aria-label={`New folder in ${name}`}
    onClick={(ev) => {
      ev.stopPropagation();
      host.startNaming(g, id, fold);
    }}
  >
    <Html node={host.icon("folderNew", 14)} />
  </button>
);

function Row({ r, naming, host }: { r: MgRow; naming: { n: number; value: string } | null; host: DialogsHost }) {
  const depth = { "--depth": r.depth } as CSSProperties;
  const folder = <Html node={host.icon("folder", 14)} />;
  switch (r.kind) {
    case "naming":
      return naming ? (
        <div className="mg-row naming" style={depth}>
          <Name fold="" name="" has={false} open host={host}>
            {folder}
            <NamingBox key={naming.n} g={r.g} value={naming.value} host={host} />
          </Name>
        </div>
      ) : null;
    case "folder":
      return (
        <div
          className="mg-row folder"
          data-key={r.key}
          style={depth}
          {...(host.snapshot
            ? {}
            : {
                draggable: true,
                onDragStart: (ev: DragEvent) => host.dragFolder(ev, r.g, r.f),
                onDragEnd: () => host.dragEnd(),
              })}
          {...drops(host, r.g, r.f.id, () => host.toggle(r.fold, true))} // held over: opened
        >
          <Name fold={r.fold} name={r.f.name} has={r.has} open={r.open} host={host}>
            {folder}
            <span>{r.f.name}</span>
          </Name>
          <Add host={host} g={r.g} id={r.f.id} name={r.f.name} fold={r.fold} />
          <Switch
            label={`${r.f.name}: its group`}
            options={[inOf(host.ctx, r.g), "Own group"]}
            now={0}
            ask={() => host.askOwn(r.g, r.f)}
          />
        </div>
      );
    case "group":
      return (
        <div
          className="mg-row group defines" // a group starts here
          data-key={r.key}
          style={depth}
          title={`${r.title} is its own group. Its actors share context with each other${r.outer ? `, not with ${titleOf(host.ctx, r.outer)}'s` : ""}.`}
          {...(host.snapshot
            ? {}
            : {
                // dragged as the list's group row is: into a folder of another group
                draggable: true,
                onDragStart: (ev: DragEvent) => host.dragGroup(ev, r.g),
                onDragEnd: () => host.dragEnd(),
              })}
          {...drops(host, r.g, null, () => host.toggle(r.fold, true))}
        >
          <Name fold={r.fold} name={r.title} has={r.has} open={r.open} host={host}>
            {folder}
            <b>{r.title}</b>
            <span className="mg-n">{r.says}</span>
          </Name>
          <Add host={host} g={r.g} id={null} name={r.title} fold={r.fold} />
          {r.outer ? (
            <Switch
              label={`${r.title}: its group`}
              options={[inOf(host.ctx, r.outer), "Own group"]}
              now={1}
              ask={() => host.askAbove(r.g)}
            />
          ) : (
            <Switch label={`${r.title}: its group`} options={["Own group"]} now={0} ask={() => {}} />
          )}
        </div>
      );
    case "actor":
      return <ActorRow r={r} host={host} />;
    case "shut":
      return (
        <div className="mg-row shut" style={depth}>
          {r.says}
        </div>
      );
    case "alone":
      return (
        <div className="mg-row group" style={depth}>
          <Name fold={r.fold} name="those on their own" has={r.has} open={r.open} host={host}>
            <Html node={host.icon("alone", 14)} />
            <b>On their own</b>
          </Name>
        </div>
      );
  }
}

/** An actor's row: on its own, a group of one (highlighted); its switch, its group or on its own. */
function ActorRow({ r, host }: { r: MgActorRow; host: DialogsHost }) {
  const { g, a, lone, around } = r,
    name = actorTitle(a);
  const drag = host.snapshot || a.role === "coordinator" ? {} : drags(host, (ev) => host.dragActor(ev, g, a));
  return (
    <div
      className={"mg-row actor" + (lone ? " defines" : "")}
      data-key={r.key}
      style={{ "--depth": r.depth } as CSSProperties}
      title={
        lone
          ? `On its own · shares context with no other actor${around ? "" : ". Drag it into a folder to join that folder's group."}`
          : undefined
      }
      {...drag}
    >
      <Name fold="" name="" has={false} open host={host}>
        <Face host={host} a={a} />
        <span>{name || a.channel.slice(0, 8)}</span>
      </Name>
      <Switch
        label={`${name}: its group`}
        options={around ? [inOf(host.ctx, around), "On its own"] : ["On its own"]}
        now={lone && around ? 1 : 0}
        ask={() => (lone ? host.askJoin(g) : host.askAloneHere(g, a))}
        why={r.why}
      />
    </div>
  );
}

/** A new folder's name, typed in its row: Enter makes it, Esc (the dialog's) or an empty box leaves it, a click elsewhere
 * makes it as typed -- as the list's own box does. Focused as it opens, its caret at the end. */
function NamingBox({ g, value, host }: { g: string | null; value: string; host: DialogsHost }) {
  const opened = useCallback((n: HTMLInputElement | null) => {
    if (!n) return;
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  }, []);
  return (
    <input
      ref={opened}
      className="mg-input"
      type="text"
      maxLength={60}
      aria-label="New folder's name"
      placeholder={g === null ? "Folder name (a new group)" : "Folder name"}
      defaultValue={value}
      onInput={(ev) => host.namingTyped(ev.currentTarget.value)}
      onKeyDown={(ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        host.endNaming(true);
      }}
      onBlur={() => host.namingBlur()}
    />
  );
}
