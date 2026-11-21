// A GATHERER'S AND A FOLDER'S BUTTONS in the list (over their counts while hovered): "+" -- everything that can start
// there, in one menu -- and "⋯" (a new folder in it, rename, hide or delete), each Radix's DropdownMenu (arrow keys,
// Home/End, typing a letter, Esc giving the focus back); a folder's coordinator agent and its ×. An item that opens a
// box or a drop-down of its own (an app's box, the branch picker) opens it from the same button, the menu closed: its
// second step. A press the page never hears -- in a pane's frame, an app's panel -- closes the menu too, as it closes
// every drop-down of the page (features/layout/panes.js's pressedAway, its PRESSED_AWAY event).
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Html } from "../../core/ui/PageNode";
import type { ListHost, MenuInfo } from "./host";
import { CrewButton } from "./Parts";
import type { FolderNode } from "./rows";
import type { Folder, Gatherer } from "./types";

/** The event the page sends when a press it never hears is made (a pane's frame, an app's panel). */
export const PRESSED_AWAY = "ag-pressed-away";

const stop = (ev: { stopPropagation(): void }) => ev.stopPropagation();

/** A button with a menu of the page's (`menu`, made as it opens): the page's own drop-down look (.br-menu.row-menu, its
 * heading, its items, its separators). `opening`: what a press does first, before the menu opens. */
function PageMenu({
  host,
  trigger,
  children,
  menu,
  opening,
}: {
  host: Pick<ListHost, "icon">;
  trigger: { className: string; "data-pop": string; title: string; "aria-label": string; disabled?: boolean };
  children: ReactNode;
  menu: () => MenuInfo | null;
  opening?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const chose = useRef(false);
  // closed too as the page's own drop-downs are: by a press it never hears, the page resizing, or the page or a box
  // holding its button scrolling (it no longer hangs where it should) -- another box scrolling by itself (a Chat's
  // history kept at its end as its pane is resized) leaves it be
  useEffect(() => {
    if (!open) return;
    const away = () => setOpen(false);
    const scrolled = (ev: Event) => {
      const t = ev.target;
      if (t instanceof Node && button.current && t.contains(button.current)) setOpen(false);
    };
    window.addEventListener(PRESSED_AWAY, away);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      window.removeEventListener(PRESSED_AWAY, away);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);
  const m = open ? menu() : null;
  return (
    <Menu.Root
      modal={false}
      open={open && !!m}
      onOpenChange={(next) => {
        if (next) {
          chose.current = false;
          opening?.();
        }
        setOpen(next);
      }}
    >
      <Menu.Trigger asChild>
        <button ref={button} type="button" {...trigger} disabled={trigger.disabled || undefined} onClick={stop}>
          {children}
        </button>
      </Menu.Trigger>
      {m ? (
        <Menu.Portal>
          <Menu.Content
            className="br-menu row-menu"
            aria-label={m.head}
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            // placed by Radix: in flow in its wrapper, not fixed as the page's own menus are
            style={{ position: "relative" }}
            onClick={stop}
            onContextMenu={stop}
            onDoubleClick={stop}
            // Esc closes the menu, not the selection under it too (list.js's Esc)
            onEscapeKeyDown={stop}
            // an item chosen: what it opened keeps the focus (a box's input), the button not given it back
            onCloseAutoFocus={(ev) => {
              if (chose.current) ev.preventDefault();
            }}
          >
            <div className="hd" title={m.title || undefined}>
              {m.head}
              {m.sub ? <span className="sub">{m.sub}</span> : null}
            </div>
            {m.items.map((it, i) =>
              it.sep ? (
                <Menu.Separator key={`sep${i}`} className="sep" />
              ) : (
                <Menu.Item
                  key={`${i}:${it.text}`}
                  asChild
                  onSelect={() => {
                    chose.current = true;
                    if (button.current) it.run(button.current);
                  }}
                >
                  <button type="button" style={it.depth ? { paddingLeft: `${10 + it.depth * 14}px` } : undefined}>
                    <Html node={it.mark || host.icon(it.icon || "app", 16)} />
                    <span className="nm">{it.text}</span>
                    {it.note ? <span className="at">{it.note}</span> : null}
                  </button>
                </Menu.Item>
              ),
            )}
          </Menu.Content>
        </Menu.Portal>
      ) : null}
    </Menu.Root>
  );
}

/** "+": everything that can start there (a new actor on each harness, on a branch, the apps, a terminal), headed by
 * where -- the folder, else the group -- and its directory; none can start here: a button that says why. */
function StartPlus({ host, g, f }: { host: ListHost; g: Gatherer; f: Folder | null }) {
  const s = host.startMenu(g, f);
  if (!s.items.length)
    return (
      <button className="act add" type="button" disabled title={s.title || ""} aria-label={s.title || ""}>
        <Html node={host.icon("plus", 16)} />
      </button>
    );
  return (
    <PageMenu
      host={host}
      trigger={{
        className: "act start new-actor new-more" + (s.busy ? " busy" : ""),
        "data-pop": s.key,
        title: s.title || "",
        "aria-label": s.label,
        disabled: s.off,
      }}
      menu={() => host.startMenu(g, f)}
      opening={() => host.startOpening(g, f)}
    >
      <Html node={host.icon("plus", 16)} />
    </PageMenu>
  );
}

/** "⋯": what it can do besides start things, as a menu -- so its row, hovered, shows two buttons, not six. */
function RowMore({ host, k, name, menu }: { host: ListHost; k: string; name: string; menu: () => MenuInfo }) {
  return (
    <PageMenu
      host={host}
      trigger={{
        className: "act row-more",
        "data-pop": k,
        title: `More for ${name}`,
        "aria-label": `More for ${name}`,
      }}
      menu={menu}
      opening={() => host.closePops()}
    >
      <Html node={host.icon("more", 16)} />
    </PageMenu>
  );
}

/** A gatherer's buttons, over its counts while it is hovered (or in focus), in a folder's line's order: "+", "⋯". */
export function GathererActs({ host, g, title }: { host: ListHost; g: Gatherer; title: string }) {
  return (
    <>
      {host.snapshot ? null : <StartPlus host={host} g={g} f={null} />}
      <RowMore host={host} k={`gmore:${g.name}`} name={title} menu={() => host.gathererMore(g, title)} />
    </>
  );
}

/** A small button on a folder's line, beside its start buttons. */
function FolderAct({ cls, title, icon, run }: { cls: string; title: string; icon: Node; run: () => void }) {
  return (
    <button
      className={`act folder-act ${cls}`}
      type="button"
      title={title}
      aria-label={title}
      onClick={(ev) => {
        ev.stopPropagation();
        run();
      }}
    >
      <Html node={icon} />
    </button>
  );
}

/** A folder's buttons, over its counts on its line while it is hovered or in focus: "+", its coordinator agent (none
 * yet), "⋯" -- a folder made in it, it renamed (F2), it deleted -- and its ×. A closed one's: rename, delete, reopen. */
export function FolderActs({ host, n }: { host: ListHost; n: FolderNode }) {
  const { g, f } = n;
  const rename = (
    <FolderAct
      cls="rename"
      title={`Rename ${f.name} (F2)`}
      icon={host.icon("pencil", 13)}
      run={() => host.startFolderEdit(g.name, f.id)}
    />
  );
  const del = (
    <FolderAct
      cls="delete"
      title={`Delete ${f.name} · its contents move up a level`}
      icon={host.icon("bin", 14)}
      run={() => host.deleteFolder(g.name, f.id)}
    />
  );
  if (n.closed)
    return (
      <>
        {rename}
        {del}
        <FolderAct
          cls="reopen"
          title={`Reopen ${f.name} · its actors stay closed`}
          icon={host.icon("folderOpen", 14)}
          run={() => host.reopenFolder(g.name, f.id)}
        />
      </>
    );
  return (
    <>
      <StartPlus host={host} g={g} f={f} />
      {n.crew ? null : <CrewButton host={host} g={g} node={`folder:${f.id}`} />}
      <RowMore host={host} k={`fmore:${g.name}:${f.id}`} name={f.name} menu={() => host.folderMore(g, f, n.crew)} />
      <FolderAct
        cls="close"
        title={`Close ${f.name} and every actor in it`}
        icon={host.closeIcon()}
        run={() => host.pressClose(g, f)}
      />
    </>
  );
}
