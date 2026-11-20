// THE HOVER CARD's parts (Card.tsx, CardTask.tsx, CardFolder.tsx): what it is drawn from and what it calls of the page
// (CardHost), and what each kind of card has -- a row's status, a card's own button, the tab it is open in, its name box.
import { useCallback, type MouseEvent, type ReactNode } from "react";
import type { ListHost, PageParts } from "./host";
import type { TabAt } from "./rows";
import type { Actor, AppItem, Folder, Gatherer, ListCtx, Task } from "./types";

/** A card's name box: a folder named or made (`id` null: made in `parent`), the gatherer renamed (`gatherer`), or a task
 * or an app (`item`, its kind and what it is called unnamed: `kind`, `auto`). `n`: which one, a box of its own each. */
export interface CardEdit {
  n: number;
  g: string;
  id?: number | null;
  parent?: number | null;
  gatherer?: boolean;
  item?: string;
  kind?: string;
  auto?: string;
  value: string;
}
/** Which card shows: an actor's (`shown`: the one shown, in the list), a task's, an app's, a folder's (`live`: in the
 * rail, to use; `opened`, the folders opened in its tree; `asking`, its ×'s question; `here`, the rail drilled into it),
 * a gatherer's. */
export type CardWhat =
  | { kind: "actor"; g: Gatherer; a: Actor; shown: boolean }
  | { kind: "task"; g: Gatherer; t: Task }
  | { kind: "app"; g: Gatherer; o: AppItem }
  | {
      kind: "folder";
      g: Gatherer;
      f: Folder;
      live: boolean;
      opened: ReadonlySet<number>;
      asking: boolean;
      here: boolean;
    }
  | { kind: "gatherer"; g: Gatherer; here: boolean; folded: boolean };
export interface CardModel {
  what: CardWhat;
  /** its name box, open in this card */
  edit: CardEdit | null;
}
/** A start button of a card ("+ actor", "+ ⋯"): what it says, and whether it is pressed. */
export interface StartInfo {
  key: string | null;
  disabled: boolean;
  busy: boolean;
  title: string;
  label: string;
  haspopup: string | null;
  expanded: boolean | null;
}
/** A notification of an app's, as its card lists it. */
export interface Notice {
  id?: string;
  title?: string;
  text?: string;
  at?: number;
}

/** What a card calls of the page around it (features/list/modes.js's CARD_HOST). */
export interface CardHost
  extends
    PageParts,
    Pick<ListHost, "nameNote" | "branch" | "pick" | "selectApp" | "appPanelMenu" | "closeApp" | "setSaved">,
    Pick<ListHost, "hideCrew" | "closeActor" | "togglePick" | "dragEnd" | "joinEnter" | "joinOver" | "dropLeave">,
    Pick<ListHost, "joinDrop"> {
  ctx: ListCtx;
  tabAt(k: string): TabAt | null;
  /** an actor's working directory, and a path said from the home (~) */
  cwdOf(a: Actor): string;
  tilde(path: string): string;
  /** an actor's face with its harness's badge, as the list's rows had it */
  actorLogo(a: Actor): Node;
  cardHide(ev?: MouseEvent): void;
  takeOut(gname: string, k: string): void;
  openNotice(gname: string, id: string, n: Notice): void;
  dismissNotice(gname: string, id: string, n: Notice): void;
  /** "+" adding to a task: its menu's key and title (none: nothing to add), and its menu opened from `button` */
  adds(g: Gatherer, k: string, label: string): { key: string; title: string } | null;
  openAdd(g: Gatherer, k: string, label: string, button: HTMLElement): void;
  /** a card's "+ actor" and "+ ⋯": what each says, and a press */
  startInfo(which: "new" | "more", g: Gatherer, f: Folder | null): StartInfo | null;
  startPress(which: "new" | "more", g: Gatherer, f: Folder | null, button: HTMLElement): void;
  // -- its name box
  editIn(edit: Omit<CardEdit, "n" | "value">): void;
  editTyped(value: string): void;
  editEnd(keep: boolean): void;
  editBlur(e: CardEdit): void;
  // -- a folder's and a gatherer's
  deleteFolder(gname: string, id: number): void;
  reopenFolder(gname: string, id: number): void;
  pressClose(g: Gatherer, f: Folder): void;
  setHidden(g: Gatherer, hide: boolean): void;
  railDrill(at: { g: string; f: number | null }): void;
  openInRail(gname: string, id: number): void;
  /** a folder in a folder's tree opened or folded, for as long as the card shows that folder */
  treeToggle(id: number): void;
  closeAsk(g: Gatherer, f: Folder): { said: string; where: string };
  closeGo(g: Gatherer, f: Folder): void;
  closeCancel(): void;
  askFocus(which: string): void;
  /** the focus gone from its question: taken back (a click elsewhere) */
  askOut(ev: FocusEvent): void;
}

/** An actor's status in a card's row: its dot alone, at the row's end -- the word its title, and what a screen reader
 * says. */
export const RowStatus = ({ cls, label }: { cls: string; label: string }) => (
  <span className={`status ${cls}`} role="img" aria-label={label} title={label}>
    <i aria-hidden="true" />
  </span>
);
/** A card's own button: a stroke, its title its words. */
export function CardAct({ cls, title, icon, run }: { cls: string; title: string; icon: ReactNode; run: () => void }) {
  return (
    <button
      className={`act ${cls}`}
      type="button"
      title={title}
      aria-label={title}
      onClick={(ev) => {
        ev.stopPropagation();
        run();
      }}
    >
      {icon}
    </button>
  );
}
/** Where an item's task is open in the screen tabs, said. */
export function TabLine({ host, k }: { host: CardHost; k: string }) {
  const at = host.tabAt(k);
  return at ? <div className="c-tab">{at.here ? `Open here, in tab ${at.n}` : `Open in tab ${at.n}`}</div> : null;
}

/** The card's name box, as the list's own box does (out of sight with the list folded): Enter, or leaving it, keeps what
 * is typed; Esc, or nothing typed, leaves it. Focused, all of it selected, as it opens. */
export function EditBox({ host, e, gname }: { host: CardHost; e: CardEdit; gname: string }) {
  const opened = useCallback((n: HTMLInputElement | null) => {
    if (!n) return;
    n.focus();
    n.select();
  }, []);
  const what = e.kind
    ? `The ${e.kind}'s name`
    : e.gatherer
      ? "The group's name"
      : e.id === null || e.id === undefined
        ? "A new folder's name"
        : "The folder's name";
  return (
    <label className="c-edit">
      {what}
      <input
        key={e.n}
        ref={opened}
        className="name-box c-box"
        type="text"
        maxLength={e.gatherer || e.kind ? 120 : 60}
        spellCheck="false"
        autoComplete="off"
        placeholder={e.kind ? e.auto : e.gatherer ? gname : "Folder name"}
        aria-label={e.kind ? `The ${e.kind}'s name` : e.gatherer ? "This group's name" : "The folder's name"}
        defaultValue={e.value}
        onInput={(ev) => host.editTyped(ev.currentTarget.value)}
        onKeyDown={(ev) => {
          ev.stopPropagation(); // the page's own keys are not this box's
          if (ev.key === "Enter" && !ev.nativeEvent.isComposing) {
            ev.preventDefault();
            host.editEnd(true);
          } else if (ev.key === "Escape") {
            ev.preventDefault();
            host.editEnd(false);
          }
        }}
        onBlur={() => host.editBlur(e)}
      />
    </label>
  );
}
