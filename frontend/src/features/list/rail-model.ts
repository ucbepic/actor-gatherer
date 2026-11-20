// THE RAIL'S VIEW-MODEL (the list folded to a rail of tiles), from the same derivations and view as the list's (model.ts):
// each gatherer not hidden -- in the folders of gatherers it is kept in -- its name over its actors, folded as the list
// folds it (its counts, and its actors open in a pane), open, its box: its saved and closed lines first, then its folders
// (open in place, or folded to their name and counts), the groups placed in them, its actors, its apps. Only what the
// reader checks at the rail's foot (RailView's `show`): unchecked, only the folders with an actor not closed in them (a
// busy folder open unless the reader folded it there), and no saved or closed lines. Drilled into a gatherer or a folder
// (RailView's `at`): only the tree from there. The view draws it as it is (Rail.tsx); nothing here touches the page.
import { firstLine, plural } from "../../core/format";
import { appItem, key, parse } from "../../core/model/keys";
import { askedOf } from "./envelope";
import {
  aloneActor,
  aloneFolds,
  aloneShut,
  crewAt,
  crewHideKey,
  gathererCounts,
  gfOf,
  groupCrew,
  isCrewHome,
  isHidden,
  placedIn,
  placeOf,
  titleOf,
  type Counts,
} from "./groups";
import { ALONE_KEY, boxKey, folderKey, type ListView } from "./rows";
import { appStatusOf, closeHow, groupOf, isCoordinator, savedAs, statusOf } from "./status";
import {
  appTaskOf,
  taskActors,
  taskApps,
  taskById,
  taskItems,
  taskLead,
  taskMembers,
  taskName,
  taskOf,
  taskStatus,
} from "./tasks";
import {
  actorsWithin,
  appFolder,
  boxGroups,
  closedKids,
  closedSays,
  folderById,
  folderOf,
  folderTally,
  GF,
  kidFolders,
  parentOf,
  SHELLS,
  shownClosed,
  type Tally,
} from "./tree";
import type { Actor, AppItem, Folder, Gatherer, ListCtx, Task } from "./types";
import type {
  BoxView,
  RActor,
  RAlone,
  RailAt,
  RailModel,
  RailView,
  RApp,
  RCounts,
  RFolder,
  RHere,
  RNode,
  RTask,
  RTile,
} from "./rail-rows";

export * from "./rail-rows";

const isAt = (sel: readonly [string, string] | null | undefined, g: string, c: string): boolean =>
  !!sel && sel[0] === g && sel[1] === c;
const NO_BUSY = { busy: new Set<number>(), kept: new Set<number>() };

/** The rail, from the home, the list's view, and the rail's own. */
export function buildRail(ctx: ListCtx, view: ListView, rv: RailView): RailModel {
  return new RailBuilder(ctx, view, rv).rail();
}

class RailBuilder {
  /** each task's tile drawn once, where its first item comes */
  private tasksDrawn = new Set<string>();
  private busy = new Map<string, { busy: Set<number>; kept: Set<number> }>();
  constructor(
    private ctx: ListCtx,
    private view: ListView,
    private rv: RailView,
  ) {}

  rail(): RailModel {
    const { ctx, view, rv } = this;
    const all = ctx.home.gatherers;
    const shown = all.filter((g) => !isHidden(ctx, g) && !isCrewHome(g)); // one above groups: at its node
    for (const g of shown) this.busy.set(g.name, this.busyFolders(g));
    const forget = [...rv.busyFolded].filter((k) => {
      const { group, id } = parse(k);
      return !(this.busy.get(group) || NO_BUSY).busy.has(Number(id));
    });
    // drilled in: there, or, it gone, its gatherer's top, or every gatherer
    const here = rv.at ? this.find(rv.at) || this.find({ g: rv.at.g, f: null }) : null;
    const atTop = shown.filter((g) => !placeOf(ctx, g.name));
    const nodes: RNode[] = [];
    if (here) nodes.push(this.here(here.g, here.f));
    else {
      const [allG, overAll] = crewAt(ctx, "all"); // the coordinator agent over everything
      if (allG && overAll && !view.crewHidden.has("all")) nodes.push(this.actor(allG, overAll));
      nodes.push(
        ...this.gfLevel(
          atTop.filter((g) => !aloneShut(ctx, g)),
          null,
        ),
        ...this.aloneShut(atTop.filter((g) => aloneShut(ctx, g))),
      );
    }
    if (!shown.length)
      nodes.push({ kind: "none", key: "none", text: all.length ? "Every group is hidden" : "No groups" });
    return { nodes, foot: shown.length > 0, forget, show: rv.show };
  }

  /** Where `at` is, as it is now; null, gone. */
  private find(at: RailAt): { g: Gatherer; f: Folder | null } | null {
    const g = this.ctx.home.gatherers.find((x) => x.name === at.g && !isHidden(this.ctx, x));
    if (!g) return null;
    if (at.f === null) return { g, f: null };
    const f = folderById(this.ctx, g.name, at.f);
    return f ? { g, f } : null;
  }

  // -- what is busy: an actor not closed, saved or not
  private railBusy(g: Gatherer, a: Actor): boolean {
    return !["Saved", "Closed"].includes(groupOf(this.ctx, g, a));
  }
  /** The ids of a gatherer's folders with an actor active in them, at any depth (`busy`); and of those with one in them
   * or one open in a pane (`kept`: the folder of a closed one shown stays in view). */
  private busyFolders(g: Gatherer): { busy: Set<number>; kept: Set<number> } {
    const { ctx } = this,
      busy = new Set<number>(),
      kept = new Set<number>();
    const up = (a: Actor, ids: Set<number>) => {
      for (
        let f = folderById(ctx, g.name, folderOf(ctx, g.name, a));
        f && !ids.has(f.id);
        f = folderById(ctx, g.name, f.parent)
      )
        ids.add(f.id);
    };
    for (const a of g.agents) {
      if (isCoordinator(a)) continue;
      if (this.railBusy(g, a)) {
        up(a, busy);
        up(a, kept);
      } else if (this.inPane(g, a)) up(a, kept);
    }
    return { busy, kept };
  }
  private viewOf(g: Gatherer): BoxView {
    const { rv } = this;
    return {
      ...(this.busy.get(g.name) || NO_BUSY),
      only: !rv.show.folders && rv.dragging !== g.name,
      saved: rv.show.saved,
      closed: rv.show.closed,
    };
  }
  isOpenFolder(gname: string, id: number): boolean {
    return gname === GF ? !this.view.gfFolded.has(id) : this.view.foldersOpen.has(folderKey(gname, id));
  }
  /** A busy folder is open unless the reader folded it in the rail; any other as the list has it. */
  private railOpen(g: Gatherer, f: Folder, busy: ReadonlySet<number>): boolean {
    return busy.has(f.id) ? !this.rv.busyFolded.has(folderKey(g.name, f.id)) : this.isOpenFolder(g.name, f.id);
  }
  private inPane(g: Gatherer, a: Actor): boolean {
    return this.view.open.some((sel) => isAt(sel, g.name, a.channel));
  }
  private openIn(g: Gatherer, id: number): Actor[] {
    return actorsWithin(this.ctx, g, id).filter((a) => this.inPane(g, a));
  }

  /** A level of folders of gatherers (`id` null: the top): each its name, and, open, what is in it; then its gatherers. */
  private gfLevel(shown: Gatherer[], id: number | null): RNode[] {
    const out: RNode[] = [];
    for (const f of kidFolders(this.ctx, GF, id)) {
      const open = this.isOpenFolder(GF, f.id);
      out.push({ kind: "gf", key: `gf:${f.id}`, f, open, kids: open ? this.gfLevel(shown, f.id) : [] });
    }
    for (const g of shown) if (gfOf(this.ctx, g.name) === id) out.push(this.gatherer(g));
    return out;
  }

  /** A gatherer: its name; folded, its counts and its actors open in a pane; open, what is in it. */
  private gatherer(g: Gatherer): RNode {
    const { ctx, view } = this;
    if (g.alone) return this.alone(g);
    const open = !view.collapsed.has(g.name),
      crew = groupCrew(g);
    const kids: RNode[] = [];
    if (!open) for (const a of g.agents) if (this.inPane(g, a)) kids.push(this.actor(g, a));
    if (open) {
      if (crew && !view.crewHidden.has(g.name)) kids.push(this.actor(g, crew));
      kids.push(...this.box(g, null, this.viewOf(g)));
    }
    const c = gathererCounts(ctx, g);
    return {
      kind: "gatherer",
      key: `g:${g.name}`,
      g,
      title: titleOf(ctx, g),
      open,
      counts: !open && countsAny(c) ? { kind: "counts", c } : null,
      kids,
    };
  }
  /** An actor on its own: its face alone. */
  private alone(g: Gatherer): RAlone {
    const a = aloneActor(g);
    return {
      kind: "alone",
      key: `alone:${g.name}`,
      shut: false,
      kids: [...(a ? this.rowsOf(g, a) : []), ...this.appsIn(g, null)],
    };
  }
  /** The actors on their own closed: a line each for the saved and the closed, as the foot says. */
  private aloneShut(gs: Gatherer[]): RNode[] {
    const out: RNode[] = [];
    for (const [name, list] of aloneFolds(this.ctx, gs)) {
      const what = name.toLowerCase() as "saved" | "closed",
        unfolded = this.view.foldOpen[name].has(ALONE_KEY);
      const peek = () => list.filter((g) => this.inPane(g, aloneActor(g)!)).map((g) => this.actor(g, aloneActor(g)!));
      if (!this.rv.show[what]) {
        out.push(...peek()); // its line not shown: those open in a pane, in view
        continue;
      }
      out.push({
        kind: "fold",
        key: `fold:${ALONE_KEY}/${name}`,
        name,
        foldKey: ALONE_KEY,
        shown: unfolded,
        says: `${list.length} ${what}`,
        // its words: too wide here
        title: `${list.length} ${what}: ${unfolded ? "hide" : "show"} ${list.length === 1 ? "it" : "them"}`,
      });
      out.push(...(unfolded ? list.flatMap((g) => this.rowsOf(g, aloneActor(g)!)) : peek()));
    }
    return out.length ? [{ kind: "alone", key: "alone:shut", shut: true, kids: out }] : [];
  }

  /** A gatherer's or a folder's box (`id` null: the gatherer's top): its saved and closed lines first, then its folders
   * (and the groups placed in it), its actors open, its apps. */
  private box(g: Gatherer, id: number | null, v: BoxView): RNode[] {
    const { ctx, view } = this;
    const lines: RNode[] = [],
      folders: RNode[] = [],
      open: RNode[] = [];
    for (const f of kidFolders(ctx, g.name, id)) {
      if (shownClosed(ctx, g, f)) continue; // in its closed line
      if (v.only && !v.kept.has(f.id)) continue; // all in it closed, none in a pane: left out
      const isOpen = this.railOpen(g, f, v.busy);
      folders.push(this.folder(g, f, isOpen, v.busy.has(f.id), false, isOpen ? this.box(g, f.id, v) : []));
      if (!isOpen) for (const a of this.openIn(g, f.id)) folders.push(this.actor(g, a)); // folded: those in a pane
    }
    for (const [name, items] of boxGroups(ctx, g, id)) {
      if (name === SHELLS) continue;
      if (name === "Saved" || name === "Closed") {
        const k = boxKey(g.name, id),
          unfolded = view.foldOpen[name].has(k),
          what = name.toLowerCase() as "saved" | "closed";
        const actors = items as Actor[];
        const kids = name === "Closed" ? closedKids(ctx, g, id) : [];
        const peek = () =>
          [...kids.flatMap((f) => this.openIn(g, f.id)), ...actors.filter((a) => this.inPane(g, a))].map((a) =>
            this.actor(g, a),
          );
        if (!v[what]) {
          lines.push(...peek()); // its line not shown: those open in a pane, in view
          continue;
        }
        lines.push({
          kind: "fold",
          key: `fold:${g.name}/${id === null ? "" : id}/${name}`,
          name,
          foldKey: k,
          shown: unfolded,
          says: name === "Closed" ? closedSays(ctx, g, id, actors.length) : `${actors.length} ${what}`,
          title: `${unfolded ? "Hide" : "Show"} the ${what} ${kids.length ? "folders and actors" : "actors"}`,
        });
        if (unfolded)
          lines.push(...kids.flatMap((f) => this.closed(g, f)), ...actors.flatMap((a) => this.rowsOf(g, a)));
        else lines.push(...peek());
        continue;
      }
      for (const a of items as Actor[]) open.push(...this.rowsOf(g, a));
    }
    // groups and actors on their own put in it, after its folders
    for (const x of placedIn(ctx, g.name, id)) folders.push(x.alone ? this.alone(x) : this.gatherer(x));
    return [...lines, ...folders, ...open, ...this.appsIn(g, id)];
  }
  private folder(g: Gatherer, f: Folder, open: boolean, busy: boolean, closed: boolean, kids: RNode[]): RFolder {
    return {
      kind: "folder",
      key: `f:${g.name}/${f.id}`,
      card: key(g.name, `folder:${f.id}`),
      g,
      f,
      open,
      closed,
      busy,
      tally: folderTally(this.ctx, g, f.id),
      kids,
    };
  }
  /** A closed folder in the closed line: its name, greyed; open, all it holds -- its folders, then its actors, the latest
   * first -- folded, those of its actors open in a pane. */
  private closed(g: Gatherer, f: Folder): RNode[] {
    const { ctx } = this;
    if (!this.isOpenFolder(g.name, f.id))
      return [this.folder(g, f, false, false, true, []), ...this.openIn(g, f.id).map((a) => this.actor(g, a))];
    const mine = g.agents
      .filter((a) => !isCoordinator(a) && folderOf(ctx, g.name, a) === f.id)
      .sort((x, y) => (y.last || 0) - (x.last || 0));
    const kids = [
      ...kidFolders(ctx, g.name, f.id).flatMap((k) => this.closed(g, k)),
      ...mine.map((a) => this.actor(g, a)),
    ];
    return [this.folder(g, f, true, false, true, kids)];
  }

  /** The rail drilled into a gatherer's top or a folder: the path over it, its name, then what is in it. */
  private here(g: Gatherer, f: Folder | null): RHere {
    const { ctx, view } = this;
    const v = this.viewOf(g),
      up = f ? parentOf(ctx, g.name, f) : null,
      node = f ? `folder:${f.id}` : `group:${g.name}`;
    const crew = crewAt(ctx, node, g)[1];
    const open = f ? this.railOpen(g, f, v.busy) : !view.collapsed.has(g.name);
    // the places above it, the gatherer first: a step each, a click showing only it
    const steps: { name: string; at: RailAt }[] = [];
    if (f) {
      const seen = new Set<number>();
      for (
        let k = up === null ? null : folderById(ctx, g.name, up);
        k && !seen.has(k.id);
        k = folderById(ctx, g.name, parentOf(ctx, g.name, k))
      ) {
        seen.add(k.id);
        steps.unshift({ name: k.name, at: { g: g.name, f: k.id } });
      }
      steps.unshift({ name: titleOf(ctx, g), at: { g: g.name, f: null } });
    }
    const kids: RNode[] = [];
    let counts: RCounts | null = null;
    if (open) {
      if (crew && !view.crewHidden.has(crewHideKey(node))) kids.push(this.actor(g, crew));
      const box = this.box(g, f ? f.id : null, v);
      kids.push(...(box.length ? box : [{ kind: "none" as const, key: "none", text: "Nothing open here" }]));
    } else {
      if (f) {
        const t = folderTally(ctx, g, f.id);
        counts = tallyAny(t) ? { kind: "tally", t } : null;
      } else {
        const c = gathererCounts(ctx, g);
        counts = countsAny(c) ? { kind: "counts", c } : null;
      }
      const shown = f ? this.openIn(g, f.id) : g.agents.filter((a) => this.inPane(g, a));
      kids.push(...shown.map((a) => this.actor(g, a)));
    }
    return {
      kind: "here",
      key: `here:${g.name}/${f ? f.id : ""}`,
      g,
      f,
      up: f ? `Up: ${up === null ? titleOf(ctx, g) : folderById(ctx, g.name, up)!.name}` : "Up: every group",
      upAt: f ? { g: g.name, f: up } : null,
      steps,
      name: f ? f.name : titleOf(ctx, g),
      open,
      busy: !!f && v.busy.has(f.id),
      counts,
      kids,
    };
  }

  // -- tiles
  /** An actor's tile, or its task's -- once, where the first of its items comes. */
  private rowsOf(g: Gatherer, a: Actor): RTile[] {
    const id = taskOf(this.ctx, g.name, a);
    return id === null ? [this.actor(g, a)] : this.taskOnce(g, id);
  }
  private taskOnce(g: Gatherer, id: number): RTile[] {
    const k = `${g.name}\u0000${id}`;
    if (this.tasksDrawn.has(k)) return [];
    this.tasksDrawn.add(k);
    return [this.task(g, taskById(this.ctx, g.name, id)!)];
  }
  /** The apps of a box, after its actors: each in no task its own tile, and each task of apps only. */
  private appsIn(g: Gatherer, id: number | null): RTile[] {
    const { ctx } = this,
      out: RTile[] = [];
    for (const o of ctx.apps(g.name)) {
      if (appFolder(ctx, g.name, o.id) !== id) continue;
      const t = appTaskOf(ctx, g.name, o.id);
      if (t === null) out.push(this.app(g, o));
      else if (!taskMembers(ctx, g, t).length) out.push(...this.taskOnce(g, t));
    }
    return out;
  }
  actor(g: Gatherer, a: Actor): RActor {
    const { ctx, view } = this;
    const current = !view.appSelected && isAt(view.focused, g.name, a.channel); // an app selected: it is, not the actor
    const picked = view.picks.g === g.name && view.picks.cs.has(a.channel);
    return {
      kind: "actor",
      key: `a:${g.name}/${a.channel}`,
      card: key(g.name, a.channel),
      g,
      a,
      status: statusOf(ctx, a),
      current,
      open: !current && this.inPane(g, a),
      picked,
      checked: picked && view.picks.cs.size >= 2,
      name: railName(a),
      saved: !!savedAs(ctx, g.name, a),
      close: closeHow(ctx, a),
      coordinator: isCoordinator(a),
    };
  }
  private task(g: Gatherer, t: Task): RTask {
    const { ctx, view } = this;
    const all = taskMembers(ctx, g, t.id),
      apps = taskApps(ctx, g, t.id),
      lead = taskLead(ctx, g, t.id),
      open = taskActors(ctx, g, t.id);
    const who = lead || open[0] || all[0] || null;
    const status = taskStatus(ctx, g, t.id),
      current = view.selectedTask === `${g.name}\u0000t${t.id}`;
    return {
      kind: "task",
      key: `t:${g.name}/${t.id}`,
      card: key(g.name, `task:${t.id}`),
      g,
      t,
      name: taskName(ctx, g, t),
      status,
      face: who,
      faceApp: who ? null : apps[0] || null,
      n: all.length + apps.length,
      dot: !!lead || status[0] === "notified",
      apps: all.length ? apps : [],
      current,
      open: !current && (all.some((a) => this.inPane(g, a)) || apps.some((o) => view.appPanels.has(o.id))),
      what: [all.length ? plural(all.length, "actor") : null, apps.length ? plural(apps.length, "app") : null]
        .filter(Boolean)
        .join(", "),
      first: lead ? lead.channel : apps.length ? appItem(apps[0].id) : null,
      items: taskItems(ctx, g, t.id),
      members: all.length,
      saved: all.length > 0 && all.every((a) => !!savedAs(ctx, g.name, a)),
      closable: all.some((a) => closeHow(ctx, a) === "close"),
    };
  }
  private app(g: Gatherer, o: AppItem): RApp {
    const { ctx, view } = this;
    const chosen = view.appSelected === o.id;
    return {
      kind: "app",
      key: `o:${g.name}/${o.id}`,
      card: key(g.name, appItem(o.id)),
      g,
      o,
      item: appItem(o.id),
      chosen,
      shown: !chosen && view.appPanels.has(o.id),
      told: appStatusOf(ctx, g.name, o.id),
    };
  }
}

const countsAny = (c: Counts): boolean => !!(c.asking || c.error || c.notified || c.running);
const tallyAny = (t: Tally): boolean => !!(t.asking || t.error || t.notified || t.running);

/** What the rail writes under an actor's avatar, and its card at its top: its name, else what it was last asked (a
 * message from another actor, as the list says it), else that it has had none. */
export function railName(a: Actor): RActor["name"] {
  if (a.name && a.name.text) return { text: a.name.text, cls: "" };
  const asked = askedOf(a.last_user_message);
  if (asked) return { text: firstLine(asked, 160), cls: "unnamed" };
  return { text: isCoordinator(a) ? "Coordinator agent" : "No message yet", cls: "none" };
}
