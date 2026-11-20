// What the list in React (AgentList.tsx) calls of the page around it (features/list/list.js's LIST_HOST), until those parts
// move too: what a press, a key or a drag on a row does, the words the page says things in, and the parts of a row the
// page still builds -- its start buttons and menus, an actor's face, its branch -- which the list puts in its own
// elements as they are.
import type { MouseEvent, KeyboardEvent, DragEvent } from "react";
import type { FolderNode, ListModel } from "./rows";
import type { Actor, AppItem, Folder, Gatherer, Shell, Status } from "./types";

/** An event of the list's (React's) or the page's own: what the page's handlers read of it. */
export type AnyEvent = MouseEvent | KeyboardEvent | Event;
export type AnyDrag = DragEvent | globalThis.DragEvent;

/** A coordinator agent's button, on its node's row (crewButton): its face, and, hidden from the list, its status. */
export interface CrewInfo {
  /** the coordinator agent, or none yet (a press starts one) */
  crew: Actor | null;
  /** hidden from the list: its status at the face's corner */
  hidden: Status | null;
  busy: boolean;
  disabled: boolean;
  title: string;
  label: string;
}

/** A "+" adding to an item's task (addButton): what it says it adds. */
export interface AddInfo {
  title: string;
}
/** An item of its menu: a new agent on a harness, or an app. */
export interface AddItem {
  mark: Node | null;
  icon?: string;
  text: string;
  note?: string;
  run: () => void;
}

/** What every view of the list -- the list, the rail, the monitor, a card -- draws as the page draws it. */
export interface PageParts {
  /** a snapshot of the page: no server, nothing to press */
  snapshot: boolean;
  /** where the pointer hovers, a row's card says who it is: no title */
  hovers(): boolean;
  /** "⌘" on a Mac, else "Ctrl" */
  besideKey: string;
  harnessName(h: string | undefined): string;
  ago(t: number | null | undefined): string;
  /** where a session's image is: its avatar's, or a snapshot's own copy; null, none */
  avatarSrc(name: string | null | undefined): string | null;
  /** a harness's mark, for an actor with no avatar */
  harnessLogo(h: string | undefined): Node;
  /** an app's face, and its mark */
  appFace(o: AppItem): Node;
  appMark(o: AppItem): Node;
  /** an icon: a stroke ICONS names; a bookmark (filled: saved); the coordinator agent hidden; a ×; a check */
  icon(name: string, size: number): Node;
  saveIcon(on: boolean): Node;
  hideIcon(): Node;
  closeIcon(): Node;
}

export interface ListHost extends PageParts {
  // -- words
  /** who named an actor, and how it went ("" for none) */
  nameNote(g: Gatherer, a: Actor): string;
  /** what runs in the background, by its kind */
  taskKind(kind: string | undefined): string;
  shellPath(s: Shell): string;

  // -- the page's own drawing, put in the list's elements as it builds it, afresh at each draw
  /** the list's head: its title, the drop outside every group, a new group, an actor on its own, the coordinator
   * agent over everything, the list's own buttons */
  head(model: ListModel): Node[];
  /** a gatherer's buttons over its counts: "+" and "⋯" */
  gathererActs(g: Gatherer, title: string): Node[];
  /** a folder's buttons over its counts */
  folderActs(n: FolderNode): Node[];
  /** a folder of gatherers' buttons */
  gfActs(f: Folder, crew: boolean): Node[];
  /** the form for a new actor, under a gatherer's row; what it shows, in a word (made again when that changes) */
  newForm(): Node;
  formAt(): string;
  /** an actor's branch, under its name (none: null) */
  branch(g: Gatherer, a: Actor): Node | null;

  // -- a coordinator agent's button, a "+" adding to a task
  crew(g: Gatherer | null, node: string): CrewInfo | null;
  openCoordinator(g: Gatherer | null, node: string): void;
  adds(g: Gatherer, k: string): AddInfo | null;
  /** its menu: where it adds to, and what it can add (a harness's mark, or an app's; else an icon of ICONS) */
  addMenu(g: Gatherer, k: string): { where: string; items: AddItem[] } | null;

  // -- what a press does
  toggleGatherer(name: string): void;
  /** a gatherer's or a folder's box opened, if it is folded (something held over it) */
  openGatherer(name: string): void;
  openFolder(gname: string, id: number): void;
  toggleFolder(gname: string, id: number): void;
  toggleFold(name: string, key: string): void;
  pick(gname: string, c: string, ev: AnyEvent): void;
  pickBeside(gname: string, c: string, ev: AnyEvent): void;
  togglePick(g: Gatherer, a: Actor): void;
  cardHide(ev?: AnyEvent): void;
  openTask(gname: string, id: number, ev: AnyEvent): void;
  selectApp(gname: string, o: AppItem, ev: AnyEvent): void;
  appPanelMenu(gname: string, o: AppItem, ev: AnyEvent): void;
  setSaved(gname: string, a: Actor, save: boolean): void;
  hideCrew(g: Gatherer, a: Actor): void;
  closeActor(g: Gatherer, a: Actor, how: "close" | "discard"): void;
  saveTask(gname: string, id: number, save: boolean): void;
  closeTask(gname: string, id: number): void;
  closeApp(gname: string, o: AppItem): void;
  closeShell(s: Shell): void;
  setHidden(g: Gatherer, hide: boolean): void;
  startFolderEdit(gname: string, id: number | null, parent?: number | null): void;

  // -- naming, in a box in its row
  startRename(g: Gatherer, a: Actor): void;
  startItemRename(g: Gatherer, k: string): void;
  /** the box an actor, a task, an app or a gatherer is named in, and the folder's: what is typed, and how it ends */
  renaming(): { value: string; placeholder: string; label: string } | null;
  nameRef(el: HTMLInputElement | null): void;
  nameTyped(value: string): void;
  nameBlur(): void;
  endRename(keep: boolean): void;
  folderEditing(): { value: string; label: string } | null;
  folderRef(el: HTMLInputElement | null): void;
  folderTyped(value: string): void;
  folderBlur(): void;
  endFolderEdit(keep: boolean): void;

  // -- a folder's × asking first
  closeAsk(g: Gatherer, f: Folder): { said: string; where: string };
  closeFolderGo(g: Gatherer, f: Folder): void;
  closeAskCancel(): void;
  askFocus(which: string): void;

  // -- dragging rows, and dropping on them: into a folder (`id`; null, the gatherer's top) or into an item's task
  dragActor(ev: AnyDrag, g: Gatherer, a: Actor): void;
  dragItems(ev: AnyDrag, g: Gatherer, items: string[]): void;
  dragFolder(ev: AnyDrag, g: Gatherer, f: Folder): void;
  dragGatherer(ev: AnyDrag, g: Gatherer): void;
  /** a gatherer's row clicked with ⌘/Ctrl: selected to drag with others (true: the click is taken) */
  pickGatherer(ev: MouseEvent, g: Gatherer): boolean;
  dragEnd(): void;
  dropEnter(ev: AnyDrag, g: Gatherer, id: number | null, open: () => void): void;
  dropOver(ev: AnyDrag, g: Gatherer, id: number | null): void;
  dropLeave(ev: AnyDrag): void;
  drop(ev: AnyDrag, g: Gatherer, id: number | null): void;
  joinEnter(ev: AnyDrag, g: Gatherer, k: string): void;
  joinOver(ev: AnyDrag, g: Gatherer, k: string): void;
  joinDrop(ev: AnyDrag, g: Gatherer, k: string): void;
}
