// THE LIST'S VIEW-MODEL, its shape (model.ts builds it): what aside#agents draws -- its nodes (gatherers, folders, folds,
// the folders of gatherers) and its rows (actors, tasks, apps, terminals), each with what its row says -- and what it is
// built from besides the home: the reader's choices, and what is shown (ListView).
import type { Actor, AppItem, AppNotices, Folder, Gatherer, Shell, Status, Task } from "./types";
import type { Counts, Totals } from "./groups";
import type { Tally } from "./tree";
/** The group a coordinator agent's row is listed under (its row's data-group). */
export const CREW_GROUP = "Coordinator agent";
/** The folds of a box, each open or not by the box's key (foldKey): kept in this browser. */
export type FoldName = "Closed" | "Saved" | "Terminals";
/** The key the folds of the actors on their own closed are kept by. */
export const ALONE_KEY = "\u0000alone";
/** A box's key, for its folds: a gatherer's top by its name, a folder's by its gatherer and id. */
export const boxKey = (gname: string, id: number | null): string => (id === null ? gname : `${gname}\u0000f${id}`);
/** A folder's key, for whether it is open: its gatherer and id. */
export const folderKey = (gname: string, id: number): string => `${gname}\u0000${id}`;

/** Where a task is open in the screen tabs: its tab's number, and whether it is this one. */
export interface TabAt {
  n: number;
  here: boolean;
}
/** The reader's choices, and what is shown, as the list draws them. */
export interface ListView {
  /** the gatherers folded */
  collapsed: ReadonlySet<string>;
  /** each fold opened, by its box's key */
  foldOpen: Readonly<Record<FoldName, ReadonlySet<string>>>;
  /** the coordinator agents hidden from the list, by crewHideKey */
  crewHidden: ReadonlySet<string>;
  /** the folders opened, by folderKey */
  foldersOpen: ReadonlySet<string>;
  /** the folders of gatherers folded, by id */
  gfFolded: ReadonlySet<number>;
  /** the actors selected (Shift+click), of one gatherer */
  picks: { g: string | null; cs: ReadonlySet<string> };
  /** the gatherers selected (⌘/Ctrl+click), to drag at once */
  gPicks: ReadonlySet<string>;
  /** an actor's, a gatherer's (c null) or an item's name being typed */
  renaming: { g: string; c: string | null } | null;
  /** a folder's name being typed (id null: a new one, in `parent`) */
  folderEdit: { g: string; id: number | null; parent: number | null } | null;
  /** a folder's × asking first, in the list ("list") or a card */
  folderClosing: { g: string; id: number; from: string } | null;
  /** the form for a new actor, open under a gatherer's row */
  adding: { gatherer: string } | null;
  /** a group being made, named, till it is listed */
  gfMaking: { text: string; parent: number | null } | null;
  /** the actors open in panes, this page's own first */
  open: readonly (readonly [string, string])[];
  /** the actor in focus */
  focused: readonly [string, string] | null;
  /** this page's own pane's actor */
  selected: readonly [string, string] | null;
  /** this page's own pane out of sight */
  away: boolean;
  /** the app whose panel is selected (its instance's id) */
  appSelected: string | null;
  /** the task of apps only shown */
  appsOnly: string | null;
  /** the task of what is selected */
  selectedTask: string | null;
  /** the apps whose panels are shown (not held out of sight), by instance */
  appPanels: ReadonlySet<string>;
  /** where a task is open in the screen tabs */
  tab(k: string | null): TabAt | null;
}

export interface ActorRow {
  kind: "actor";
  /** its row's data-key: its gatherer's name and its channel */
  key: string;
  g: Gatherer;
  a: Actor;
  /** the group it is listed under (its row's data-group) */
  group: string;
  status: Status;
  /** the one in focus */
  current: boolean;
  /** open in a pane, not in focus */
  open: boolean;
  /** selected (Shift+click): tinted; `checked`, its check on its face, two or more selected */
  picked: boolean;
  checked: boolean;
  /** its name being typed, in its row */
  naming: boolean;
  coordinator: boolean;
  /** its name ("": none) */
  named: string;
  /** what it was last asked, as said (a message from another actor in a line); null: nothing yet */
  asked: string | null;
  /** its top line: its name, else what it was asked, else that it has nothing; its class */
  label: { text: string; cls: "" | "unnamed" | "none" };
  saved: boolean;
  /** what its × does */
  close: "close" | "discard" | null;
  /** its task's key (its own, in none) */
  task: string;
  tab: TabAt | null;
}
export interface TaskRow {
  kind: "task";
  key: string;
  g: Gatherer;
  t: Task;
  group: string;
  status: Status;
  name: string;
  current: boolean;
  open: boolean;
  /** what it holds, in words ("2 actors, 1 app") */
  what: string;
  /** its first item -- its lead, else its first app -- what "+" adds to and what is dropped on; none: nothing in it */
  first: string | null;
  naming: boolean;
  members: Actor[];
  apps: AppItem[];
  /** its items: its actors' channels, then its apps' items -- what dragging it takes */
  items: string[];
  /** its actors' faces (three at most: each its status, and the actor as said) and how many more */
  faces: { a: Actor; status: Status; said: string }[];
  more: number;
  /** every actor in it saved (it has any) */
  saved: boolean;
  /** one of its actors can be closed */
  closable: boolean;
  /** its key, as the page keys a task */
  task: string;
  tab: TabAt | null;
}
export interface AppRow {
  kind: "app";
  key: string;
  g: Gatherer;
  o: AppItem;
  /** its item ("app:<id>") */
  item: string;
  /** what its row says: its name, else what it shows, else its kind */
  shownAs: string;
  chosen: boolean;
  shown: boolean;
  told: Status | null;
  /** its newest notification, if it has one unseen */
  last: AppNotices["notices"][number] | null;
  naming: boolean;
  task: string;
  tab: TabAt | null;
}
export interface ShellRow {
  kind: "shell";
  key: string;
  g: Gatherer;
  s: Shell;
  current: boolean;
  open: boolean;
}
export type Row = ActorRow | TaskRow | AppRow | ShellRow;

export interface FolderNode {
  kind: "folder";
  key: string;
  g: Gatherer;
  f: Folder;
  open: boolean;
  /** closed (shownClosed): greyed, in its parent's closed line */
  closed: boolean;
  tally: Tally;
  /** how many actors it holds */
  held: number;
  /** its name being typed */
  editing: boolean;
  /** its × asking first, under its line */
  asking: boolean;
  /** a coordinator agent over it */
  crew: boolean;
  /** open: what is in it; folded, null */
  kids: Node[] | null;
  /** open, holding nothing: what it says */
  empty: string | null;
  /** folded: those of its actors open in a pane */
  peek: ActorRow[];
}
export interface FoldNode {
  kind: "fold";
  key: string;
  name: FoldName;
  /** the key it is kept open by (its box's, or ALONE_KEY) */
  foldKey: string;
  shown: boolean;
  /** "▸ 2 closed": its words, after its mark */
  says: string;
  title: string;
  /** what it shows: open, all in it; folded, those open in a pane */
  kids: Node[];
}
export interface GathererNode {
  kind: "gatherer";
  key: string;
  g: Gatherer;
  title: string;
  open: boolean;
  /** drawn inside another group's folder */
  nested: boolean;
  /** two or more of its actors selected */
  picking: boolean;
  /** selected (⌘/Ctrl+click), to drag */
  gPicked: boolean;
  /** dragged into a folder of gatherers, or another group */
  draggable: boolean;
  renaming: boolean;
  counts: Counts;
  /** the form for a new actor open under it */
  adding: boolean;
  error: string | null;
  /** open: its coordinator agent's row, then its box */
  kids: Node[];
}
export interface AloneNode {
  kind: "alone";
  key: string;
  g: Gatherer;
  kids: Row[];
}
export interface AloneShutNode {
  kind: "alone-shut";
  key: string;
  folds: FoldNode[];
}
export interface GfFolderNode {
  kind: "gf-folder";
  key: string;
  f: Folder;
  open: boolean;
  editing: boolean;
  crew: boolean;
  kids: Node[] | null;
  empty: string | null;
}
/** A new folder's name typed: a gatherer's (`g`), or one of gatherers (GF). */
export interface FolderNewNode {
  kind: "folder-new";
  key: string;
  g: string;
}
export interface GfMakingNode {
  kind: "gf-making";
  key: string;
  text: string;
}
export type Node =
  Row | FolderNode | FoldNode | GathererNode | AloneNode | AloneShutNode | GfFolderNode | FolderNewNode | GfMakingNode;

export interface HiddenRow {
  g: Gatherer;
  title: string;
  /** hidden by the reader, or inactive since (its last activity) */
  hidden: boolean;
  last: number | null;
}
export interface ListModel {
  home: string;
  merged: boolean;
  /** what the list says with nothing to list */
  empty: string | null;
  /** the coordinator agent over everything, at the list's top */
  overAll: ActorRow | null;
  /** the list's top level: its folders of gatherers and gatherers, then the actors on their own closed */
  top: Node[];
  hidden: HiddenRow[];
  /** the gatherers not hidden (a coordinator's own too), and their actors counted (the top bar's) */
  visible: Gatherer[];
  totals: Totals;
}
