// MANAGE GROUPS' VIEW-MODEL: who shares context with whom, at a glance -- each group at its place, its folders and open
// actors under it (the closed counted), the groups and actors on their own placed in its folders, those on their own at
// the top last -- as one column of rows, each set in by its depth, each with its switch: a folder's "<the group it is
// in> | Own group", a group's (inside another's folder) "<that group> | Own group", an actor's "<its group> | On its own".
// What the reader folded (`folded`: "g:<group>", "f:<group>:<folder id>", "alone") is left out; a new folder's name
// being typed is a row of its own. The view draws it as it is (ManageGroups.tsx).
import { plural } from "../../core/format";
import { isCrewHome, isHidden, nestedIn, placedIn, placeOf, titleOf } from "./groups";
import { groupOf, isCoordinator } from "./status";
import { byName, folderOf, kidFolders } from "./tree";
import type { Actor, Folder, Gatherer, ListCtx } from "./types";

/** A row's name: its fold's key and whether it has anything under it to fold. */
interface Named {
  key: string;
  depth: number;
  fold: string;
  has: boolean;
  open: boolean;
}
export interface MgGroupRow extends Named {
  kind: "group";
  g: Gatherer;
  title: string;
  /** the group it is drawn inside, in its folder: its switch's other side */
  outer: Gatherer | null;
  says: string;
}
export interface MgFolderRow extends Named {
  kind: "folder";
  g: Gatherer;
  f: Folder;
}
export interface MgActorRow {
  kind: "actor";
  key: string;
  depth: number;
  g: Gatherer;
  a: Actor;
  /** on its own: a group of one */
  lone: boolean;
  /** the group it sits in: none for one on its own at the list's top */
  around: Gatherer | null;
  /** why its switch can't be had ("": it can) */
  why: string;
}
export interface MgShutRow {
  kind: "shut";
  key: string;
  depth: number;
  says: string;
}
export interface MgNamingRow {
  kind: "naming";
  key: string;
  depth: number;
  /** in a group (its name), or at the top: a group of its own (null) */
  g: string | null;
}
export interface MgAloneRow extends Named {
  kind: "alone";
}
export type MgRow = MgGroupRow | MgFolderRow | MgActorRow | MgShutRow | MgNamingRow | MgAloneRow;

/** What Manage groups reads besides the home: what the reader folded, a new folder named (in folder `parent` of group
 * `g`; g null: at the top), and whether an actor is in a task with other actors (tasks move as a whole). */
export interface ManageView {
  folded: ReadonlySet<string>;
  naming: { g: string | null; parent: number | null } | null;
  inTask(g: Gatherer, a: Actor): boolean;
}

/** Manage groups' rows, from the home and what the reader folded. */
export function buildManage(ctx: ListCtx, mv: ManageView): MgRow[] {
  const shown = ctx.home.gatherers.filter((g) => !isHidden(ctx, g) && !isCrewHome(g) && !placeOf(ctx, g.name));
  const lone = shown.filter((g) => g.alone);
  const naming = (gname: string | null, parent: number | null) =>
    !!mv.naming && mv.naming.g === gname && mv.naming.parent === parent;
  const namingRow = (gname: string | null, parent: number | null, depth: number): MgNamingRow => ({
    kind: "naming",
    key: `naming:${gname ?? ""}:${parent ?? ""}`,
    depth,
    g: gname,
  });
  const named = (key: string, fold: string, depth: number, has: boolean): Named => ({
    key,
    depth,
    fold,
    has,
    open: !mv.folded.has(fold),
  });

  function actorRow(g: Gatherer, a: Actor, depth: number): MgActorRow {
    const lone = !!g.alone,
      inTask = !lone && mv.inTask(g, a);
    return {
      kind: "actor",
      key: `${g.name}/${a.channel}`,
      depth,
      g,
      a,
      lone,
      around: lone ? nestedIn(ctx, g) : g,
      why: isCoordinator(a)
        ? "The coordinator agent stays with its group"
        : inTask
          ? "In a task with other actors. Tasks move as a whole."
          : "",
    };
  }
  /** group `g`'s folder `id` (null: its top), at `depth`: its folders, each with what is in it; the groups and actors on
   * their own put there; its open actors (the closed counted) */
  function box(g: Gatherer, id: number | null, depth: number): MgRow[] {
    const out: MgRow[] = naming(g.name, id) ? [namingRow(g.name, id, depth)] : [];
    for (const f of kidFolders(ctx, g.name, id)) {
      const fold = `f:${g.name}:${f.id}`,
        kids = box(g, f.id, depth + 1);
      const row: MgFolderRow = {
        kind: "folder",
        ...named(`${g.name}/folder:${f.id}`, fold, depth, kids.length > 0),
        g,
        f,
      };
      out.push(row, ...(row.open ? kids : []));
    }
    for (const x of placedIn(ctx, g.name, id))
      out.push(...(x.alone ? x.agents.map((a) => actorRow(x, a, depth)) : group(x, depth)));
    const mine = g.agents.filter((a) => folderOf(ctx, g.name, a) === id && !isCoordinator(a));
    const shut = mine.filter((a) => ["Saved", "Closed"].includes(groupOf(ctx, g, a)));
    out.push(...mine.filter((a) => !shut.includes(a)).map((a) => actorRow(g, a, depth)));
    if (shut.length)
      out.push({
        kind: "shut",
        key: `${g.name}/${id ?? ""}/shut`,
        depth,
        says: `${plural(shut.length, "closed actor")} here too`,
      });
    return out;
  }
  /** a group: its row -- placed in a folder, its switch; at the top, its own group, the only option -- then what is in
   * it */
  function group(g: Gatherer, depth: number): MgRow[] {
    const fold = `g:${g.name}`,
      kids = box(g, null, depth + 1);
    const row: MgGroupRow = {
      kind: "group",
      ...named(g.name, fold, depth, kids.length > 0),
      g,
      title: titleOf(ctx, g),
      outer: nestedIn(ctx, g),
      says: plural(g.agents.filter((a) => !isCoordinator(a)).length, "actor"),
    };
    return [row, ...(row.open ? kids : [])];
  }

  const loneRows = lone.flatMap((x) => x.agents.map((a) => actorRow(x, a, 1)));
  const alone = named("alone", "alone", 0, true);
  return [
    ...(naming(null, null) ? [namingRow(null, null, 0)] : []),
    ...shown
      .filter((g) => !g.alone)
      .sort((x, y) => byName(titleOf(ctx, x), titleOf(ctx, y)))
      .flatMap((g) => group(g, 0)),
    ...(lone.length ? [{ kind: "alone" as const, ...alone }] : []),
    ...(alone.open ? loneRows : []),
  ];
}
