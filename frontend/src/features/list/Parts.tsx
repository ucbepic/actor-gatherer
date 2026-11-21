// The small parts the list's rows and lines are made of (AgentList.tsx): the page's own drawing put in an element of the
// list's, a fold's mark, counts, a name's box, a coordinator agent's face, a row's buttons, its tab, an actor's face.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { plural } from "../../core/format";
import { Html } from "../../core/ui/PageNode";
import type { ListHost, PageParts } from "./host";
import type { Counts } from "./groups";
import type { TabAt } from "./rows";
import type { Tally } from "./tree";
import type { Actor, Folder, Gatherer } from "./types";

/** An element of the list's whose contents the page builds (`make`, afresh at each draw -- or, `deps` given, only when
 * they change), as it built them: put in it whole, in place of what was. */
export function useFilled<T extends HTMLElement>(make: () => Node[], deps?: unknown[]) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(...make());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** The glyph's turn of a status that moves (running), set by the clock once, so all of them turn together. */
export function useSpin(): Record<string, string> {
  const [at] = useState(() => `-${Date.now() % 1200}ms`);
  return { "--spin-at": at };
}

/** A fold's mark: the chevron every fold shows, turned down while open (its character for its words). */
export const FoldMark = ({ open }: { open: boolean }) => (
  <span className={open ? "caret open" : "caret"} aria-hidden="true">
    {open ? "▾" : "▸"}
  </span>
);

/** One count, with its dot: "3 of 5 actors running". */
function Chip({ k, cls, of, what }: { k: number; cls: string; of: string; what: string }) {
  return k ? (
    <span className={"count" + cls} title={`${k} of ${of} ${what}`}>
      <i aria-hidden="true" />
      {String(k)}
    </span>
  ) : null;
}
function Told({ n }: { n: number }) {
  return n ? (
    <span className="count notified" title={`${plural(n, "app")} with a notification you haven't seen`}>
      <i aria-hidden="true" />
      {String(n)}
    </span>
  ) : null;
}
/** How many of a group's actors wait on the reader, stopped on an error, run; its apps notified. */
export function CountChips({ c }: { c: Counts }) {
  const of = plural(c.of, "actor");
  return (
    <>
      <Chip k={c.asking} cls=" asking" of={of} what="waiting for you" />
      <Chip k={c.error} cls=" error" of={of} what="stopped on an error" />
      <Told n={c.notified} />
      <Chip k={c.running} cls="" of={of} what="running" />
    </>
  );
}
/** A folder's: the same, and (on its line in the list) how many are idle. */
export function TallyChips({ t, idle = true }: { t: Tally; idle?: boolean }) {
  const of = plural(t.open, "actor");
  return (
    <>
      <Chip k={t.asking} cls=" asking" of={of} what="waiting for you" />
      <Chip k={t.error} cls=" error" of={of} what="stopped on an error" />
      <Told n={t.notified} />
      <Chip k={t.running} cls="" of={of} what="running" />
      {idle ? <Chip k={t.idle} cls=" idle" of={of} what="idle" /> : null}
    </>
  );
}

/** The box a name is typed in: what was typed kept as it is typed; Enter keeps it, Esc leaves it, leaving it (Tab away)
 * keeps it -- as the page says (`blur`). */
function TypedBox({
  className,
  max,
  value,
  placeholder,
  label,
  boxRef,
  typed,
  end,
  blur,
}: {
  className: string;
  max: number;
  value: string;
  placeholder: string;
  label: string;
  boxRef: (el: HTMLInputElement | null) => void;
  typed: (v: string) => void;
  end: (keep: boolean) => void;
  blur: () => void;
}) {
  const keys = (ev: KeyboardEvent<HTMLInputElement>) => {
    ev.stopPropagation(); // the page's own keys are not this box's
    if (ev.key === "Enter" && !ev.nativeEvent.isComposing) {
      ev.preventDefault();
      end(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      end(false);
    }
  };
  return (
    <input
      ref={boxRef}
      className={className}
      type="text"
      maxLength={max}
      spellCheck="false"
      autoComplete="off"
      placeholder={placeholder}
      aria-label={label}
      defaultValue={value}
      onInput={(ev) => typed(ev.currentTarget.value)}
      onKeyDown={keys}
      onBlur={blur}
    />
  );
}
/** An actor's, a task's, an app's or a gatherer's name, typed in its row. */
export function NameBox({ host }: { host: ListHost }) {
  const r = host.renaming();
  if (!r) return null;
  return (
    <TypedBox
      className="name-box"
      max={120}
      value={r.value}
      placeholder={r.placeholder}
      label={r.label}
      boxRef={host.nameRef}
      typed={host.nameTyped}
      end={host.endRename}
      blur={host.nameBlur}
    />
  );
}
/** A folder's name, typed in its line. */
export function FolderBox({ host, max }: { host: ListHost; max: number }) {
  const f = host.folderEditing();
  if (!f) return null;
  return (
    <TypedBox
      className="name-box folder-box"
      max={max}
      value={f.value}
      placeholder="Folder name"
      label={f.label}
      boxRef={host.folderRef}
      typed={host.folderTyped}
      end={host.endFolderEdit}
      blur={host.folderBlur}
    />
  );
}

/** A node's coordinator agent, its face on the node's row: a click shows it (started if it has none), and, hidden from
 * the list, its status at the face's corner. */
export function CrewButton({ host, g, node }: { host: ListHost; g: Gatherer | null; node: string }) {
  const c = host.crew(g, node);
  if (!c) return null;
  const src = host.avatarSrc(c.crew?.avatar || "roles/manager");
  return (
    <button
      className={"act start crew" + (c.busy ? " busy" : "") + (c.crew ? " on" : "")}
      type="button"
      disabled={c.disabled || undefined}
      title={c.title}
      aria-label={c.label}
      onClick={(ev) => {
        ev.stopPropagation();
        host.openCoordinator(g, node);
      }}
    >
      {src ? (
        <img className="crew-face" src={src} alt="" draggable="false" />
      ) : (
        <span className="crew-face none" aria-hidden="true">
          <Html node={host.icon("crew", 12)} />
        </span>
      )}
      {c.hidden ? <i className={`crew-dot ${c.hidden[0]}`} aria-hidden="true" /> : null}
    </button>
  );
}

/** A row's own button -- its bookmark, its × -- beside the row's main button, not in it: a press on one does only what
 * it says, not showing the row's item. */
export function RowButton({
  className,
  run,
  children,
  ...attrs
}: {
  className: string;
  run: (button: HTMLElement) => void;
  children: ReactNode;
  title?: string;
  "aria-label"?: string;
  "aria-pressed"?: "true" | "false";
  "data-pop"?: string;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: "true" | "false";
}) {
  return (
    <button
      className={className}
      type="button"
      {...attrs}
      onClick={(ev) => {
        ev.stopPropagation();
        run(ev.currentTarget);
      }}
    >
      {children}
    </button>
  );
}

/** Where a row's task is open in the screen tabs: its tab's number, for a screen reader only. */
export function TabMark({ at }: { at: TabAt | null }) {
  if (!at) return null;
  const said = at.here ? `Open here in tab ${at.n}` : `Open in tab ${at.n} · click to switch to it`;
  return (
    <span className={"tab-no" + (at.here ? " here" : "")} aria-label={said}>
      {String(at.n)}
    </span>
  );
}

/** An actor's face alone, no harness's badge: its avatar, else its harness's mark. */
export function Face({ host, a }: { host: Pick<PageParts, "avatarSrc" | "harnessLogo">; a: Actor }) {
  const src = host.avatarSrc(a.avatar);
  if (!src) return <Html node={host.harnessLogo(a.harness)} />;
  return (
    <span className="logo avatar">
      <img src={src} alt="" draggable="false" />
    </span>
  );
}

/** A folder's × asking first, under its line or in its card: what closing it would close, end, take off -- "Close
 * folder", or Cancel (Esc). `focus`: its button now in focus; `out`, the focus gone from it. */
export function AskClose({
  g,
  f,
  said,
  where,
  go,
  cancel,
  focus,
  out,
}: {
  g: Gatherer;
  f: Folder;
  said: string;
  where: string;
  go: () => void;
  cancel: () => void;
  focus: (which: string) => void;
  out?: (ev: FocusEvent) => void;
}) {
  const button = (which: string, cls: string, text: string, run: () => void) => (
    <button
      type="button"
      className={`pb ${cls}`}
      data-ask={which}
      onClick={(ev) => {
        ev.stopPropagation();
        run();
      }}
      onFocus={() => focus(which)}
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
      onClick={(ev) => ev.stopPropagation()}
      onKeyDown={(ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          cancel();
        }
      }}
      onBlur={out ? (ev) => out(ev.nativeEvent) : undefined}
    >
      <p>
        <b>{`Close ${f.name}?`}</b>
        {` This ${said}. The folder moves to ${where}'s closed line.`}
      </p>
      <div className="f-ask-btns">
        {button("go", "go", "Close folder", go)}
        {button("cancel", "", "Cancel", cancel)}
      </div>
    </div>
  );
}

/** The place to drop what is dragged outside every group -- over the list's head, and over Manage groups' top line --
 * shown while such a drag goes on (body.drag-out; drag.ts's showOutside says what it does there): `can`, whether what is
 * dragged may go there; `drop`, it dropped there. */
export function OutsideDrop({ can, drop }: { can: () => boolean; drop: () => void }) {
  return (
    <div
      className="outside-drop"
      onDragEnter={(ev) => {
        if (!can()) return;
        ev.preventDefault();
        ev.currentTarget.classList.add("drop-on");
      }}
      onDragOver={(ev) => {
        if (!can()) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) ev.currentTarget.classList.remove("drop-on");
      }}
      onDrop={(ev) => {
        if (!can()) return;
        ev.preventDefault();
        ev.stopPropagation(); // the list's head it is over: not dropped there too
        drop();
      }}
    >
      Outside every group: a group of its own
    </div>
  );
}
