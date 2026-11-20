// THE LIST'S VIEW-MODEL: what aside#agents draws, as plain data, from the home and what the page knows of it (ListCtx)
// and from the reader's choices and what is shown (ListView) -- each gatherer not hidden, in the folders of gatherers it
// is kept in, with its folders, its actors, tasks, apps and terminals as rows, each row's status and words, its folds
// (closed, saved, terminals), the actors on their own closed in their lines at the end, the hidden groups. The view
// draws it as it is, in its order; nothing here touches the page.
import { firstLine, plural } from "../../core/format";
import { appItem, key, taskId } from "../../core/model/keys";
import { askedOf } from "./envelope";
import {
  aloneActor,
  aloneFolds,
  aloneShut,
  choiceOf,
  crewAt,
  crewHideKey,
  crewNode,
  crewPlace,
  gathererCounts,
  gfOf,
  groupCrew,
  isCrewHome,
  isHidden,
  lastOf,
  nestedIn,
  placedIn,
  placeOf,
  titleOf,
  totals,
} from "./groups";
import { appNotices, appStatusOf, closeHow, groupOf, isCoordinator, savedAs, statusOf } from "./status";
import {
  actorTitle,
  appShown,
  appTaskOf,
  taskItems,
  taskActors,
  taskApps,
  taskById,
  taskLead,
  taskMembers,
  taskName,
  taskOf,
  taskStatus,
  taskWhat,
} from "./tasks";
import {
  actorsWithin,
  appFolder,
  boxGroups,
  closedKids,
  closedSays,
  folderOf,
  folderTally,
  GF,
  kidFolders,
  OPEN,
  SHELLS,
  shownClosed,
  treeOf,
  within,
} from "./tree";
import type { Actor, AppItem, Folder, Gatherer, ListCtx, Shell, Task } from "./types";
import {
  ALONE_KEY,
  boxKey,
  CREW_GROUP,
  folderKey,
  type ActorRow,
  type AloneNode,
  type AppRow,
  type FoldNode,
  type FolderNode,
  type GfFolderNode,
  type ListModel,
  type ListView,
  type Node,
  type Row,
  type ShellRow,
  type TaskRow,
} from "./rows";

export * from "./rows";

const isAt = (sel: readonly [string, string] | null | undefined, g: string, c: string | null): boolean =>
  !!sel && sel[0] === g && sel[1] === c;

/** The list, from the home and what is shown. */
export function buildList(ctx: ListCtx, view: ListView): ListModel {
  return new Builder(ctx, view).list();
}

class Builder {
  /** each task's row drawn once, where its first item comes */
  private tasksDrawn = new Set<string>();
  constructor(
    private ctx: ListCtx,
    private view: ListView,
  ) {}

  list(): ListModel {
    const { ctx, view } = this;
    const all = ctx.home.gatherers;
    const shown = all.filter((g) => !isHidden(ctx, g) && !isCrewHome(g)),
      hidden = all.filter((g) => isHidden(ctx, g));
    const top = shown.filter((g) => !placeOf(ctx, g.name)),
      visible = all.filter((g) => !isHidden(ctx, g));
    return {
      home: ctx.home.home,
      merged: !!ctx.home.merged,
      empty:
        !all.length && !view.folderEdit
          ? "No groups yet. Make one with the folder button above."
          : !shown.length
            ? "Every group is hidden."
            : null,
      overAll: this.crewRow("all"),
      top: [
        ...this.gfLevel(
          top.filter((g) => !aloneShut(ctx, g)),
          null,
        ),
        ...this.aloneShutRows(top.filter((g) => aloneShut(ctx, g))),
      ],
      hidden: hidden.map((g) => ({
        g,
        title: titleOf(ctx, g),
        hidden: choiceOf(ctx, g) === "hidden",
        last: lastOf(g),
      })),
      visible,
      totals: totals(ctx, visible),
    };
  }

  isOpenFolder(gname: string, id: number): boolean {
    return gname === GF ? !this.view.gfFolded.has(id) : this.view.foldersOpen.has(folderKey(gname, id));
  }
  private inPane(g: Gatherer, c: string): boolean {
    return this.view.open.some((sel) => isAt(sel, g.name, c));
  }
  private openIn(g: Gatherer, id: number): Actor[] {
    return actorsWithin(this.ctx, g, id).filter((a) => this.inPane(g, a.channel));
  }
  private editingNew(gname: string, parent: number | null): boolean {
    const e = this.view.folderEdit;
    return !!e && e.g === gname && e.id === null && e.parent === parent;
  }

  /** One level of folders of gatherers (`id` null: the list's top): the box naming a new one here, a group being made
   * here, its folders -- each its line and, open, what is in it -- then its gatherers of `shown`. */
  gfLevel(shown: Gatherer[], id: number | null): Node[] {
    const { ctx, view } = this,
      out: Node[] = [];
    if (this.editingNew(GF, id)) out.push({ kind: "folder-new", key: `${GF}/folder:new`, g: GF });
    if (view.gfMaking && view.gfMaking.parent === id)
      out.push({ kind: "gf-making", key: `${GF}/group:new`, text: view.gfMaking.text });
    for (const f of kidFolders(ctx, GF, id)) {
      const open = this.isOpenFolder(GF, f.id),
        e = view.folderEdit;
      const node: GfFolderNode = {
        kind: "gf-folder",
        key: `${GF}/folder:${f.id}`,
        f,
        open,
        editing: !!e && e.g === GF && e.id === f.id,
        crew: !!crewAt(ctx, `groups:${f.id}`)[1],
        kids: null,
        empty: null,
      };
      if (open) {
        const crew = this.crewRow(`groups:${f.id}`);
        node.kids = [...(crew ? [crew] : []), ...this.gfLevel(shown, f.id)];
        if (!node.kids.length) node.empty = this.gfEmpty(f);
      }
      out.push(node);
    }
    for (const g of shown) if (gfOf(ctx, g.name) === id) out.push(this.gathererBox(g));
    return out;
  }
  /** What an open folder of gatherers with nothing shown in it says: that its gatherers are hidden, or that it has none. */
  private gfEmpty(f: Folder): string {
    const { ctx } = this;
    const hid = Object.entries(treeOf(ctx, GF).filed).some(
      ([name, at]) => within(ctx, GF, at, f.id) && ctx.home.gatherers.some((g) => g.name === name),
    );
    return hid ? "Its groups are hidden" : ctx.snapshot ? "Empty" : "Empty · drag groups here";
  }

  /** A gatherer's box: its row, and, open, its coordinator agent's row then its box's rows. An actor on its own: its
   * rows alone. */
  gathererBox(g: Gatherer): Node {
    const { ctx, view } = this;
    if (g.alone) return this.aloneBox(g);
    const open = !view.collapsed.has(g.name),
      crew = groupCrew(g);
    const renaming = !!view.renaming && view.renaming.g === g.name && view.renaming.c === null;
    const kids: Node[] = [];
    if (open) {
      if (crew && !view.crewHidden.has(g.name)) kids.push(this.actorRow(g, crew, CREW_GROUP));
      kids.push(...this.boxRows(g, null));
    }
    return {
      kind: "gatherer",
      key: g.name,
      g,
      title: titleOf(ctx, g),
      open,
      nested: !!nestedIn(ctx, g),
      picking: view.picks.g === g.name && view.picks.cs.size > 1,
      gPicked: view.gPicks.has(g.name),
      draggable: !ctx.snapshot && (treeOf(ctx, GF).folders.length > 0 || !!ctx.home.merged) && !renaming,
      renaming,
      counts: gathererCounts(ctx, g),
      adding: !!view.adding && view.adding.gatherer === g.name,
      error: g.error || null,
      kids,
    };
  }
  private aloneBox(g: Gatherer): AloneNode {
    const a = aloneActor(g);
    return {
      kind: "alone",
      key: g.name,
      g,
      kids: [...(a ? this.rowsOf(g, a, groupOf(this.ctx, g, a)) : []), ...this.appRowsIn(g, null)],
    };
  }
  /** The actors on their own closed: a line each for the saved and the closed, at the list's end. */
  private aloneShutRows(gs: Gatherer[]): Node[] {
    const folds: FoldNode[] = [];
    for (const [name, list] of aloneFolds(this.ctx, gs)) {
      const shown = this.view.foldOpen[name].has(ALONE_KEY);
      folds.push({
        kind: "fold",
        key: `${ALONE_KEY}/${name}`,
        name,
        foldKey: ALONE_KEY,
        shown,
        says: `${list.length} ${name.toLowerCase()}`,
        title: `${shown ? "Hide" : "Show"} ${name === "Saved" ? "saved" : "closed"} actors on their own`,
        kids: shown
          ? list.flatMap((g) => this.rowsOf(g, aloneActor(g)!, name))
          : list
              .filter((g) => this.inPane(g, aloneActor(g)!.channel))
              .map((g) => this.actorRow(g, aloneActor(g)!, name)),
      });
    }
    return folds.length ? [{ kind: "alone-shut", key: `${ALONE_KEY}/shut`, folds }] : [];
  }

  /** A box's rows: a new folder's name typed, its folders, the groups placed in it, its actors open, its apps, its
   * folds. `id`: the folder; null, the gatherer's top. */
  boxRows(g: Gatherer, id: number | null): Node[] {
    const { ctx, view } = this,
      out: Node[] = [];
    if (this.editingNew(g.name, id)) out.push({ kind: "folder-new", key: `${g.name}/folder:new`, g: g.name });
    for (const f of kidFolders(ctx, g.name, id)) if (!shownClosed(ctx, g, f)) out.push(...this.folderRows(g, f));
    out.push(...this.placedRows(g, id));
    let apps = false;
    for (const [name, list] of boxGroups(ctx, g, id)) {
      if (!apps && name !== OPEN) {
        out.push(...this.appRowsIn(g, id)); // the apps: after the open actors
        apps = true;
      }
      if (name === SHELLS) {
        const k = boxKey(g.name, id),
          shown = view.foldOpen.Terminals.has(k);
        out.push({
          kind: "fold",
          key: `${g.name}/${id === null ? "" : id}/${name}`,
          name,
          foldKey: k,
          shown,
          says: plural(list.length, "terminal"),
          title: shown ? "Hide the terminals" : "Show the terminals",
          kids: shown ? list.map((s) => this.shellRow(g, s)) : [],
        });
      } else if (name === "Saved" || name === "Closed") out.push(this.foldRow(g, id, name, list));
      else for (const a of list) out.push(...this.rowsOf(g, a, name));
    }
    if (!apps) out.push(...this.appRowsIn(g, id));
    return out;
  }
  private placedRows(g: Gatherer, id: number | null): Node[] {
    return placedIn(this.ctx, g.name, id).map((x) => this.gathererBox(x));
  }
  /** A fold of saved or closed actors: its line, and under it, open, its actors -- its closed folders first -- or,
   * folded, those open in a pane. */
  private foldRow(g: Gatherer, id: number | null, name: "Saved" | "Closed", list: Actor[]): FoldNode {
    const { ctx } = this;
    const k = boxKey(g.name, id),
      shown = this.view.foldOpen[name].has(k);
    const kids = name === "Closed" ? closedKids(ctx, g, id) : [];
    return {
      kind: "fold",
      key: `${g.name}/${id === null ? "" : id}/${name}`,
      name,
      foldKey: k,
      shown,
      says: name === "Closed" ? closedSays(ctx, g, id, list.length) : `${list.length} ${name.toLowerCase()}`,
      title:
        name === "Saved"
          ? `${shown ? "Hide" : "Show"} the saved actors that are closed`
          : `${shown ? "Hide" : "Show"} the closed ${kids.length ? "folders and actors" : "actors"}`,
      kids: shown
        ? [...kids.flatMap((f) => this.folderRows(g, f)), ...list.flatMap((a) => this.rowsOf(g, a, name))]
        : [...kids.flatMap((f) => this.openIn(g, f.id)), ...list.filter((a) => this.inPane(g, a.channel))].map((a) =>
            this.actorRow(g, a, groupOf(ctx, g, a)),
          ),
    };
  }
  /** A folder's line, and under it, open, its box -- a closed one's, all it holds -- or, folded, its actors open in a
   * pane. */
  folderRows(g: Gatherer, f: Folder): Node[] {
    const { ctx, view } = this;
    const open = this.isOpenFolder(g.name, f.id),
      closed = shownClosed(ctx, g, f),
      t = folderTally(ctx, g, f.id);
    const e = view.folderEdit,
      fc = view.folderClosing;
    const node: FolderNode = {
      kind: "folder",
      key: `${g.name}/folder:${f.id}`,
      g,
      f,
      open,
      closed,
      tally: t,
      held: t.open + t.saved + t.closed,
      editing: !!e && e.g === g.name && e.id === f.id,
      asking: !!fc && fc.from === "list" && fc.g === g.name && fc.id === f.id,
      crew: !!crewAt(ctx, `folder:${f.id}`, g)[1],
      kids: null,
      empty: null,
      peek: [],
    };
    if (open) {
      const crew = closed ? null : this.crewRow(`folder:${f.id}`, g);
      node.kids = closed ? this.closedRows(g, f.id) : [...(crew ? [crew] : []), ...this.boxRows(g, f.id)];
      if (!node.kids.length)
        node.empty = ctx.snapshot || closed ? "Empty" : "Empty · drag actors here or start one with +";
    } else node.peek = this.openIn(g, f.id).map((a) => this.actorRow(g, a, groupOf(ctx, g, a)));
    return [node];
  }
  /** What a closed folder holds, all closed: its folders, then its actors, the latest first. */
  private closedRows(g: Gatherer, id: number): Node[] {
    const { ctx } = this;
    const mine = g.agents
      .filter((a) => !isCoordinator(a) && folderOf(ctx, g.name, a) === id)
      .sort((x, y) => (y.last || 0) - (x.last || 0));
    return [
      ...kidFolders(ctx, g.name, id).flatMap((f) => this.folderRows(g, f)),
      ...this.placedRows(g, id),
      ...mine.flatMap((a) => this.rowsOf(g, a, groupOf(ctx, g, a))),
    ];
  }

  /** An actor's rows: its own, or its task's, once -- where the first of its items comes. */
  rowsOf(g: Gatherer, a: Actor, group: string): Row[] {
    const id = taskOf(this.ctx, g.name, a);
    return id === null ? [this.actorRow(g, a, group)] : this.taskRows(g, id, group);
  }
  private taskRows(g: Gatherer, id: number, group: string): Row[] {
    const k = `${g.name}\u0000${id}`;
    if (this.tasksDrawn.has(k)) return [];
    this.tasksDrawn.add(k);
    return [this.taskRow(g, taskById(this.ctx, g.name, id)!, group)];
  }
  /** The apps of a box, after its open actors: each in no task its row, and each task of apps only. */
  private appRowsIn(g: Gatherer, id: number | null): Row[] {
    const { ctx } = this,
      out: Row[] = [];
    for (const o of ctx.apps(g.name)) {
      if (appFolder(ctx, g.name, o.id) !== id) continue;
      const t = appTaskOf(ctx, g.name, o.id);
      if (t === null) out.push(this.appRow(g, o));
      else if (!taskMembers(ctx, g, t).length) out.push(...this.taskRows(g, t, OPEN));
    }
    return out;
  }
  /** The coordinator agent's row at the top of `node`: none while it has none, or the reader hid it. */
  crewRow(node: string, g: Gatherer | null = null): ActorRow | null {
    const [cg, a] = crewAt(this.ctx, node, g);
    return cg && a && !this.view.crewHidden.has(crewHideKey(node)) ? this.actorRow(cg, a, CREW_GROUP) : null;
  }

  private naming(gname: string, c: string): boolean {
    const r = this.view.renaming;
    return !!r && r.g === gname && r.c === c;
  }
  actorRow(g: Gatherer, a: Actor, group: string): ActorRow {
    const { ctx, view } = this;
    const away = view.away && isAt(view.selected, g.name, a.channel);
    const current = !away && !view.appSelected && !view.appsOnly && isAt(view.focused, g.name, a.channel);
    const open = !current && !away && !view.appsOnly && this.inPane(g, a.channel);
    const picked = view.picks.g === g.name && view.picks.cs.has(a.channel);
    const named = (a.name && a.name.text) || "",
      asked = askedOf(a.last_user_message);
    const coordinator = isCoordinator(a);
    const t = taskOf(ctx, g.name, a),
      task = key(g.name, t === null ? a.channel : taskId(t));
    return {
      kind: "actor",
      key: `${g.name}/${a.channel}`,
      g,
      a,
      group,
      status: statusOf(ctx, a),
      current,
      open,
      picked,
      checked: picked && view.picks.cs.size >= 2,
      naming: this.naming(g.name, a.channel),
      coordinator,
      named,
      asked,
      label: {
        text:
          named ||
          (asked
            ? firstLine(asked, 200)
            : coordinator
              ? `Coordinates ${crewPlace(ctx, crewNode(g, a), g)}`
              : "No message yet"),
        cls: named ? "" : asked ? "unnamed" : "none",
      },
      saved: !!savedAs(ctx, g.name, a),
      close: closeHow(ctx, a),
      task,
      tab: view.tab(task),
    };
  }
  taskRow(g: Gatherer, t: Task, group: string): TaskRow {
    const { ctx, view } = this;
    const all = taskMembers(ctx, g, t.id),
      apps = taskApps(ctx, g, t.id),
      lead = taskLead(ctx, g, t.id),
      open = taskActors(ctx, g, t.id);
    const task = `${g.name}\u0000t${t.id}`,
      current = view.selectedTask === task;
    return {
      kind: "task",
      key: `${g.name}/task:${t.id}`,
      g,
      t,
      group,
      status: taskStatus(ctx, g, t.id),
      name: taskName(ctx, g, t),
      current,
      open: !current && (all.some((a) => this.inPane(g, a.channel)) || apps.some((o) => view.appPanels.has(o.id))),
      what: taskWhat(ctx, g, t.id),
      first: lead ? lead.channel : apps.length ? appItem(apps[0].id) : null,
      naming: this.naming(g.name, `task:${t.id}`),
      members: all,
      apps,
      items: taskItems(ctx, g, t.id),
      faces: open.slice(0, 3).map((a) => ({ a, status: statusOf(ctx, a), said: actorTitle(a) })),
      more: Math.max(0, open.length - 3),
      saved: all.length > 0 && all.every((a) => !!savedAs(ctx, g.name, a)),
      closable: all.some((a) => closeHow(ctx, a) === "close"),
      task,
      tab: view.tab(task),
    };
  }
  appRow(g: Gatherer, o: AppItem): AppRow {
    const { ctx, view } = this;
    const item = appItem(o.id),
      chosen = view.appSelected === o.id;
    const told = appStatusOf(ctx, g.name, o.id),
      t = appTaskOf(ctx, g.name, o.id),
      task = key(g.name, t === null ? item : taskId(t));
    return {
      kind: "app",
      key: `${g.name}/${item}`,
      g,
      o,
      item,
      shownAs: appShown(o),
      chosen,
      shown: !chosen && view.appPanels.has(o.id),
      told,
      last: told ? appNotices(ctx, g.name, o.id)[0] || null : null,
      naming: this.naming(g.name, item),
      task,
      tab: view.tab(task),
    };
  }
  shellRow(g: Gatherer, s: Shell): ShellRow {
    const current = isAt(this.view.focused, g.name, s.id);
    return {
      kind: "shell",
      key: `${g.name}/${s.id}`,
      g,
      s,
      current,
      open: !current && this.inPane(g, s.id),
    };
  }
}
