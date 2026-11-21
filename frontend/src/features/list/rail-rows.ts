// THE RAIL'S VIEW-MODEL, its shape (rail-model.ts builds it): what nav#rail draws -- its nodes (gatherers, folders, their
// saved and closed lines, the folders of gatherers, the rail drilled in) and its tiles (actors, tasks, apps), each with
// what it says -- and what it is built from besides the list's view (RailView).
import type { Counts } from "./groups";
import type { Tally } from "./tree";
import type { Actor, AppItem, Folder, Gatherer, Status, Task } from "./types";

/** Where the rail is drilled in: a gatherer's top (`f` null) or a folder of it. */
export interface RailAt {
  g: string;
  f: number | null;
}
/** What the rail reads besides the list's view: what its foot shows, the busy folders folded, where it is drilled in,
 * and the group whose items are dragged (every folder of it shown, to drop them in). */
export interface RailView {
  show: { folders: boolean; saved: boolean; closed: boolean };
  /** the busy folders the reader folded in the rail, by folderKey */
  busyFolded: ReadonlySet<string>;
  at: RailAt | null;
  dragging: string | null;
}
/** What a box of the rail shows: its folders busy, those kept in view (busy, or one in a pane), whether only those are
 * shown, whether its saved and closed lines are. */
export interface BoxView {
  busy: ReadonlySet<number>;
  kept: ReadonlySet<number>;
  only: boolean;
  saved: boolean;
  closed: boolean;
}

export interface RActor {
  kind: "actor";
  key: string;
  /** its data-card: its gatherer and channel */
  card: string;
  g: Gatherer;
  a: Actor;
  status: Status;
  current: boolean;
  open: boolean;
  picked: boolean;
  /** its check on its face: two or more selected */
  checked: boolean;
  /** what it says under its face: its name, else what it was last asked, else that it has had none */
  name: { text: string; cls: "" | "unnamed" | "none" };
  saved: boolean;
  close: "close" | "discard" | null;
  coordinator: boolean;
}
export interface RTask {
  kind: "task";
  key: string;
  card: string;
  g: Gatherer;
  t: Task;
  name: string;
  status: Status;
  /** its lead's face, else its first app's mark */
  face: Actor | null;
  faceApp: AppItem | null;
  /** how many actors and apps it holds */
  n: number;
  /** its state's dot shown: it has a lead, or an app notified */
  dot: boolean;
  /** its apps' mark beside its face: it has actors too */
  apps: AppItem[];
  current: boolean;
  open: boolean;
  what: string;
  first: string | null;
  items: string[];
  members: number;
  saved: boolean;
  closable: boolean;
}
export interface RApp {
  kind: "app";
  key: string;
  card: string;
  g: Gatherer;
  o: AppItem;
  item: string;
  chosen: boolean;
  shown: boolean;
  told: Status | null;
}
export type RTile = RActor | RTask | RApp;
/** Counts under a folded name: a gatherer's, or a folder's (no idle). */
export type RCounts = { kind: "counts"; c: Counts } | { kind: "tally"; t: Tally };
export interface RGatherer {
  kind: "gatherer";
  key: string;
  g: Gatherer;
  title: string;
  open: boolean;
  /** folded: its counts, and its actors open in a pane; open: its coordinator agent and its box */
  counts: RCounts | null;
  kids: RNode[];
}
/** A folder: open, its name over what is in it (`kids`); folded, its name and counts. */
export interface RFolder {
  kind: "folder";
  key: string;
  card: string;
  g: Gatherer;
  f: Folder;
  open: boolean;
  closed: boolean;
  /** busy: folded or opened in the rail alone */
  busy: boolean;
  tally: Tally;
  kids: RNode[];
}
export interface RFold {
  kind: "fold";
  key: string;
  name: "Saved" | "Closed";
  foldKey: string;
  shown: boolean;
  says: string;
  title: string;
}
export interface RAlone {
  kind: "alone";
  key: string;
  shut: boolean;
  kids: RNode[];
}
/** A folder of gatherers: its name, and, open, what is in it. */
export interface RGf {
  kind: "gf";
  key: string;
  f: Folder;
  open: boolean;
  kids: RNode[];
}
export interface RNone {
  kind: "none";
  key: string;
  text: string;
}
/** The rail drilled in: Up and Root, the path to where it is, its name, then what is in it. */
export interface RHere {
  kind: "here";
  key: string;
  g: Gatherer;
  f: Folder | null;
  /** Up's title, and where it goes: the folder it is in, its gatherer's top; from that, every gatherer (null) */
  up: string;
  upAt: RailAt | null;
  steps: { name: string; at: RailAt }[];
  name: string;
  open: boolean;
  busy: boolean;
  counts: RCounts | null;
  kids: RNode[];
}
export type RNode = RTile | RGatherer | RFolder | RFold | RAlone | RGf | RNone | RHere;

export interface RailModel {
  nodes: RNode[];
  /** its foot: none with no group shown */
  foot: boolean;
  /** the busy folders folded by the reader that are busy no more: forgotten */
  forget: string[];
  show: RailView["show"];
}
