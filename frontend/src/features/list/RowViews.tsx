// The list's ROWS (model.ts's Row): an actor's, a task's, an app's, a terminal's -- each its item's state at its left,
// its name, its buttons over its face while hovered (list.css), its face or faces at its right; pressed, its item shown;
// dragged, put in a folder or another item's task; an item dropped on it, put in its task. A row is a box (`.agent`, what
// is dragged and dropped on) holding its main button (`.a-main`: its state, name and face; what a press, a key or a
// right-click on the row does) and, beside it, its own buttons ("+", bookmark, ×, a selected actor's check): no button
// inside another, each one the keys reach in turn. A row being named is a box in place of its name, its main part a div.
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import { firstLine } from "../../core/format";
import { Html } from "../../core/ui/PageNode";
import type { ListHost } from "./host";
import { Face, NameBox, RowButton, TabMark, useSpin } from "./Parts";
import type { ActorRow, AppRow, ShellRow, TaskRow } from "./rows";
import type { Actor, Gatherer } from "./types";

/** What a row's own buttons and drags call of the page: the list's, or the rail's. */
export type RowHost = Pick<
  ListHost,
  | "snapshot"
  | "saveIcon"
  | "hideIcon"
  | "closeIcon"
  | "icon"
  | "hideCrew"
  | "setSaved"
  | "togglePick"
  | "dragEnd"
  | "joinEnter"
  | "joinOver"
  | "dropLeave"
  | "joinDrop"
>;

/** What an item's row does with what is dragged over it: put in its task (`k`, its item). */
export const joins = (host: RowHost, g: Gatherer, k: string) =>
  host.snapshot
    ? {}
    : {
        onDragEnter: (ev: DragEvent) => host.joinEnter(ev, g, k),
        onDragOver: (ev: DragEvent) => host.joinOver(ev, g, k),
        onDragLeave: (ev: DragEvent) => host.dropLeave(ev),
        onDrop: (ev: DragEvent) => host.joinDrop(ev, g, k),
      };
/** A row dragged: `start` says what. */
export const drags = (host: RowHost, start: (ev: DragEvent) => void) =>
  host.snapshot
    ? {}
    : {
        draggable: true,
        onDragStart: (ev: DragEvent) => {
          ev.stopPropagation();
          start(ev);
        },
        onDragEnd: () => host.dragEnd(),
      };
/** A row's name double-clicked (or F2 on its row): named in a box in its place. */
const namedOnDouble = (host: ListHost, g: Gatherer, k: string) =>
  host.snapshot
    ? {}
    : {
        onDoubleClick: (ev: MouseEvent) => {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
          ev.stopPropagation();
          host.cardHide(ev);
          host.startItemRename(g, k);
        },
      };

/** A row's buttons ("+", bookmark, ×), one group -- shown over its face while it is hovered; none: nothing. */
const acts = (...bs: ReactNode[]) => (bs.some(Boolean) ? <span className="a-acts">{bs}</span> : null);
/** "+": something added to the item's task -- a new agent, or an app -- from its menu (`key`: the item's). */
function addButton(host: ListHost, g: Gatherer, k: string): ReactNode {
  const add = host.adds(g, k);
  return add ? <AddMenu key="add" host={host} g={g} k={k} title={add.title} /> : null;
}
const stop = (ev: { stopPropagation(): void }) => ev.stopPropagation();
function AddMenu({ host, g, k, title }: { host: ListHost; g: Gatherer; k: string; title: string }) {
  const [open, setOpen] = useState(false);
  const menu = open ? host.addMenu(g, k) : null;
  return (
    <Menu.Root modal={false} open={open && !!menu} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <button className="task-add" type="button" title={title} aria-label="Add to this task" onClick={stop}>
          <span className="task-add-in" aria-hidden="true">
            +
          </span>
        </button>
      </Menu.Trigger>
      {menu ? (
        <Menu.Portal>
          <Menu.Content
            className="br-menu row-menu"
            aria-label={`Add to ${menu.where}`}
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            // placed by Radix: in flow in its wrapper, not fixed as the page's own menus are
            style={{ position: "relative" }}
            // (not the row's: the menu is its child in React)
            onClick={stop}
            onContextMenu={stop}
            onDoubleClick={stop}
            // Esc closes the menu, not the selection under it too (list.ts's Esc)
            onEscapeKeyDown={stop}
          >
            <div className="hd">{`Add to ${menu.where}`}</div>
            {menu.items.map((it) => (
              <Menu.Item key={it.text} asChild onSelect={() => it.run()}>
                <button type="button">
                  <Html node={it.mark || host.icon(it.icon || "app", 16)} />
                  <span className="nm">{it.text}</span>
                  {it.note ? <span className="at">{it.note}</span> : null}
                </button>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      ) : null}
    </Menu.Root>
  );
}
/** A bookmark: saved (filled), or to be; in a snapshot, filled if saved, and nothing to press. */
export function saveButton(
  host: RowHost,
  saved: boolean,
  title: [string, string],
  label: [string, string],
  run: () => void,
) {
  if (host.snapshot)
    return saved ? (
      <span key="save" className="save-btn on" title="Saved for later">
        <Html node={host.saveIcon(true)} />
      </span>
    ) : null;
  return (
    <RowButton
      key="save"
      className={"save-btn" + (saved ? " on" : "")}
      aria-pressed={saved ? "true" : "false"}
      title={saved ? "Saved for later · click to unsave" : title[1]}
      aria-label={saved ? label[0] : label[1]}
      run={run}
    >
      <Html node={host.saveIcon(saved)} />
    </RowButton>
  );
}
/** An actor's bookmark; a coordinator agent's, in its place: hidden from the list (its face on its node's row shows it
 * again). */
export function actorSave(host: RowHost, g: Gatherer, a: Actor, saved: boolean): ReactNode {
  if (a.role === "coordinator")
    return host.snapshot ? null : (
      <RowButton
        key="save"
        className="save-btn"
        title="Hide the coordinator agent · click its face on the folder's row to show it again"
        aria-label="Hide the coordinator agent"
        run={() => host.hideCrew(g, a)}
      >
        <Html node={host.hideIcon()} />
      </RowButton>
    );
  return saveButton(host, saved, ["", "Save for later"], ["Unsave", "Save for later"], () =>
    host.setSaved(g.name, a, !saved),
  );
}
/** A ×: `title`, `label` what it says, `run` what it does. */
export const closeButton = (host: Pick<ListHost, "closeIcon">, title: string, label: string, run: () => void) => (
  <RowButton key="close" className="close-btn" title={title} aria-label={label} run={run}>
    <Html node={host.closeIcon()} />
  </RowButton>
);

/** A selected actor's check, over its face's corner, once two or more are selected: a click on it leaves it out. A
 * button of the row's own, beside its main one (list.css places it on the face). */
export function PickCheck({ host, g, a, name }: { host: RowHost; g: Gatherer; a: Actor; name: string }) {
  return (
    <button
      className="pick"
      type="button"
      title="Selected · click to deselect"
      aria-label={`Deselect ${name}`}
      onClick={(ev) => {
        ev.stopPropagation();
        host.togglePick(g, a);
      }}
    >
      <Html node={host.icon("M4.25 8.25l2.5 2.5 5-5.25", 11)} />
    </button>
  );
}

/** An actor's row: its state at its left, its name -- else what it was last asked -- its face at its right. Its name
 * double-clicked once it is the one shown (or F2): named there. Shift+click selects it with others. */
export function ActorRowView({ host, r }: { host: ListHost; r: ActorRow }) {
  const { g, a, naming, named, asked, current } = r,
    [cls, label] = r.status;
  const spin = useSpin();
  const hovers = host.hovers(),
    snap = host.snapshot;
  const nameIt =
    snap || !current
      ? {}
      : {
          title: hovers ? undefined : `${host.nameNote(g, a)}Double-click to ${named ? "rename" : "name"} it`,
          onDoubleClick: (ev: MouseEvent) => {
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
            ev.stopPropagation();
            host.startRename(g, a);
          },
        };
  const close =
    r.close &&
    closeButton(
      host,
      r.close === "close" ? "Close this session, even mid-turn" : "Never started · remove it from the list",
      "Close session",
      () => host.closeActor(g, a, r.close!),
    );
  const bg = a.background || [];
  const check = r.checked ? <PickCheck host={host} g={g} a={a} name={r.label.text} /> : null;
  const kids = (
    <>
      <span className={`dot ${cls}`} aria-label={label} style={spin} />
      <div>
        {naming ? (
          <NameBox host={host} />
        ) : (
          <div className={"name" + (r.label.cls ? ` ${r.label.cls}` : "")} {...nameIt}>
            {r.label.text}
          </div>
        )}
        <Html node={host.branch(g, a)} />
        {bg.length ? (
          <div className="bgline" title={bg.map((t) => `${host.taskKind(t.kind)}: ${t.label || t.id}`).join("\n")}>
            {`${bg.length} in background · ${bg.map((t) => t.label || t.id).join(", ")}`}
          </div>
        ) : null}
      </div>
      <span className="a-face">
        <TabMark at={r.tab} />
        <Face host={host} a={a} />
      </span>
    </>
  );
  const cl =
    "agent" + (naming ? " renaming" : "") + (r.coordinator ? " coordinator" : "") + (r.picked ? " picked" : "");
  // its state on its box too (data-current), as list.css draws it; its main button's for a screen reader (aria-current)
  const box = {
    "data-key": r.key,
    "data-group": r.group,
    "data-open": r.open ? "true" : undefined,
    "data-current": current ? "true" : undefined,
  } as const;
  const title = hovers
    ? undefined
    : `${host.harnessName(a.harness)} · ${label} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}` +
      (asked && named ? `\nAsked: ${firstLine(asked, 300)}` : "") +
      (a.recap && a.recap.text ? `\nRecap, ${host.ago(a.recap.at)}: ${a.recap.text}` : "") +
      (snap
        ? ""
        : `\n${host.besideKey}+click to open side by side${r.coordinator ? "" : "\nShift+click to select several"}`);
  if (naming)
    return (
      <div className={cl} {...box}>
        <div className="a-main" aria-current={current ? "true" : "false"} title={title}>
          {kids}
        </div>
        {check}
      </div>
    );
  const drag = r.coordinator ? {} : { ...drags(host, (ev) => host.dragActor(ev, g, a)), ...joins(host, g, a.channel) };
  return (
    <div className={cl} {...box} data-card={`${g.name}\u0000${a.channel}`} {...drag}>
      <button
        className="a-main"
        type="button"
        aria-current={current ? "true" : "false"}
        title={title}
        onClick={(ev) => {
          if (ev.shiftKey && !snap && !r.coordinator) {
            ev.preventDefault();
            host.togglePick(g, a);
            return;
          }
          host.pick(g.name, a.channel, ev);
        }}
        onContextMenu={(ev) => host.pickBeside(g.name, a.channel, ev)}
        onKeyDown={(ev) => {
          if (ev.key === "F2" && !snap) {
            ev.preventDefault();
            host.startRename(g, a);
          }
        }}
      >
        {kids}
      </button>
      {acts(addButton(host, g, a.channel), actorSave(host, g, a, r.saved), close)}
      {check}
    </div>
  );
}

/** A task's row: as an actor's -- its lead's state at its left, its name -- its actors' faces and its apps' marks at
 * its right, its "+" over them hovered. Pressed: opened. Dragged: all in it; an item dropped on it, put in it. */
export function TaskRowView({ host, r }: { host: ListHost; r: TaskRow }) {
  const { g, t, name, first, naming } = r,
    [cls, label] = r.status;
  const spin = useSpin();
  const k = `task:${t.id}`,
    snap = host.snapshot;
  const save =
    r.members.length > 0 &&
    saveButton(host, r.saved, ["", "Save the task for later"], ["Unsave the task", "Save the task for later"], () =>
      host.saveTask(g.name, t.id, !r.saved),
    );
  const close =
    r.closable &&
    closeButton(host, "Close the task · it reopens as it was", "Close the task", () => host.closeTask(g.name, t.id));
  const kids = (
    <>
      <span className={`dot ${cls}`} aria-label={label} style={spin} />
      <div>
        {naming ? (
          <NameBox host={host} />
        ) : (
          <div className="name" {...namedOnDouble(host, g, k)}>
            {name}
          </div>
        )}
      </div>
      <span className="t-faces">
        <TabMark at={r.tab} />
        {r.faces.map(({ a, status }) => {
          const src = host.avatarSrc(a.avatar);
          const said =
            (a.name && a.name.text) || (a.last_user_message ? firstLine(a.last_user_message, 120) : "No message yet");
          return src ? (
            <img
              key={a.channel}
              className="t-face"
              src={src}
              alt=""
              title={`${said} · ${status[1]}`}
              draggable="false"
            />
          ) : (
            <span key={a.channel} className="t-face none" title={said}>
              <Html node={host.harnessLogo(a.harness)} />
            </span>
          );
        })}
        {r.more ? <span className="t-more">{`+${r.more}`}</span> : null}
        {r.apps.length ? (
          <span className="t-apps">
            {r.apps.slice(0, 3).map((o) => (
              <Html key={o.id} node={host.appMark(o)} />
            ))}
          </span>
        ) : null}
      </span>
    </>
  );
  const box = {
    "data-key": r.key,
    "data-group": r.group,
    "data-open": r.open ? "true" : undefined,
    "data-current": r.current ? "true" : undefined,
  } as const;
  const current = r.current ? "true" : "false";
  const title = host.hovers()
    ? undefined
    : `${name} · ${r.what || "empty"}${snap ? "" : `\n${host.besideKey}+click to open side by side\nDouble-click the name (or F2) to ${t.name ? "rename" : "name"} it`}`;
  if (naming)
    return (
      <div className="agent task renaming" {...box}>
        <div className="a-main" aria-current={current} title={title}>
          {kids}
        </div>
      </div>
    );
  const drag = first ? { ...drags(host, (ev) => host.dragItems(ev, g, r.items)), ...joins(host, g, first) } : {};
  return (
    <div className="agent task" {...box} data-card={`${g.name}\u0000${k}`} {...drag}>
      <button
        className="a-main"
        type="button"
        aria-current={current}
        title={title}
        // pressed, its card put away: a live card stays while the pointer is on the row, over the panels the task opens
        onClick={(ev) => {
          host.cardHide(ev);
          host.openTask(g.name, t.id, ev);
        }}
        onKeyDown={(ev) => {
          if (ev.key === "F2" && !snap) {
            ev.preventDefault();
            host.startItemRename(g, k);
          }
        }}
      >
        {kids}
      </button>
      {acts(first ? addButton(host, g, first) : null, save || null, close || null)}
    </div>
  );
}

/** An app in no task, a task of its own: its row, as an actor's -- what it shows, its "+" and its ×, its face at its
 * right. Pressed: selected; right-clicked, its panel's menu; dragged onto another item's row, put in its task. */
export function AppRowView({ host, r }: { host: ListHost; r: AppRow }) {
  const { g, o, item: k, told, last, naming } = r,
    snap = host.snapshot;
  const kids = (
    <>
      {told ? (
        <span className={`dot ${told[0]}`} aria-label={told[1]} />
      ) : (
        <span className="dot-none" aria-hidden="true" />
      )}
      <div>
        {naming ? (
          <NameBox host={host} />
        ) : (
          <div className="name" {...namedOnDouble(host, g, k)}>
            {r.shownAs}
          </div>
        )}
      </div>
      <span className="a-face">
        <TabMark at={r.tab} />
        <Html node={host.appFace(o)} />
      </span>
    </>
  );
  const box = {
    "data-key": r.key,
    "data-instance": o.id,
    "data-group": "Open",
    "data-open": r.shown ? "true" : undefined,
    "data-current": r.chosen ? "true" : undefined,
  } as const;
  const current = r.chosen ? "true" : "false";
  const title = host.hovers()
    ? undefined
    : `${o.name ? `${o.name} · ` : ""}${o.title ? `${o.app.label} · ${o.title}` : o.app.label}${last ? `\n${last.title}` : ""}${o.folder ? `\n${o.folder}` : ""}${snap ? "" : `\n${host.besideKey}+click to open side by side\nRight-click to move or close the panel\nDouble-click the name (or F2) to ${o.name ? "rename" : "name"} it`}`;
  if (naming)
    return (
      <div className="agent app-row renaming" {...box}>
        <div className="a-main" aria-current={current} title={title}>
          {kids}
        </div>
      </div>
    );
  return (
    <div
      className="agent app-row"
      {...box}
      data-card={`${g.name}\u0000${k}`}
      {...drags(host, (ev) => host.dragItems(ev, g, [k]))}
      {...joins(host, g, k)}
    >
      <button
        className="a-main"
        type="button"
        aria-current={current}
        title={title}
        onClick={(ev) => {
          host.cardHide(ev);
          host.selectApp(g.name, o, ev);
        }}
        onKeyDown={(ev) => {
          if (ev.key === "F2" && !snap) {
            ev.preventDefault();
            host.startItemRename(g, k);
          }
        }}
        onContextMenu={(ev) => host.appPanelMenu(g.name, o, ev)}
      >
        {kids}
      </button>
      {acts(
        addButton(host, g, k),
        snap ? null : closeButton(host, `Close ${o.app.label}`, `Close ${o.app.label}`, () => host.closeApp(g.name, o)),
      )}
    </div>
  );
}

/** A terminal's row: where it was opened, and when; its × ends it, as a window's does. */
export function ShellRowView({ host, r }: { host: ListHost; r: ShellRow }) {
  const { g, s } = r,
    where = host.shellPath(s);
  return (
    <div
      className="agent shell"
      data-key={r.key}
      data-group="Terminals"
      data-open={r.open ? "true" : undefined}
      data-current={r.current ? "true" : undefined}
    >
      <button
        className="a-main"
        type="button"
        aria-current={r.current ? "true" : "false"}
        title={`Terminal · ${s.cwd}${host.snapshot ? "" : `\n${host.besideKey}+click to open side by side`}`}
        onClick={(ev) => host.pick(g.name, s.id, ev)}
        onContextMenu={(ev) => host.pickBeside(g.name, s.id, ev)}
      >
        <span className="logo shell-logo" aria-hidden="true">
          <Html node={host.icon("terminal", 18)} />
        </span>
        <div>
          <div className="name">{where.split("/").filter(Boolean).pop() || where}</div>
          <div className="asked">{where}</div>
          <div className="meta">
            <span>
              {"Terminal · opened "}
              <span data-ago={s.since || ""}>{host.ago(s.since)}</span>
            </span>
          </div>
        </div>
      </button>
      {acts(
        closeButton(host, "End the shell and everything running in it", "Terminate shell", () => host.closeShell(s)),
      )}
    </div>
  );
}
