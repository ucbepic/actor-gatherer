// WHAT A MOVE BETWEEN GROUPS SAYS before it is made (group-moves.ts asks it): who moves, from which group to which, how
// many others each has, how many of those moving are working now -- they rebuild their context at their next call --
// and the apps that go with them, or close for the other group's own; worked out apart from the page, from the home and
// the server's plan.
import * as LG from "./groups";
import { groupOf, isCoordinator } from "./status";
import { actorTitle } from "./tasks";
import * as LT from "./tree";
import type { Actor, Gatherer, ListCtx } from "./types";

/** What the words read: the list's derivations' context, and an app's name by its manifest. */
export interface Words {
  ctx: ListCtx;
  label(app: string): string;
}
/** An app a move takes (the server's plan): its instance, app and title; `joins`, the other group's own it closes for. */
export interface PlanApp {
  id: string;
  app: string;
  title?: string;
  joins?: string;
}
/** The server's plan of a move (groups.py's `plan`): the actors that move, a folder moving, the apps. */
export interface Plan {
  actors: string[];
  folder?: number | null;
  apps: PlanApp[];
}

const WORKING = new Set(["Running", "Waiting for you", "Background"]); // groupOf's: working now
export const mvCount = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;
const title = (w: Words, g: Gatherer) => LG.titleOf(w.ctx, g);

/** The apps a move takes, said: "The app Browser goes with it." -- and one that closes for the group `to`'s own of its
 * app (`joins`): "Its Paper news closes because the lab group has its own. It will use that one." */
export function appsLine(w: Words, apps: PlanApp[] | null | undefined, many: boolean, to: Gatherer | null = null) {
  if (!apps || !apps.length) return null;
  const named = (x: PlanApp) => w.label(x.app) + (x.title && x.title !== w.label(x.app) ? ` (${x.title})` : "");
  const going = apps.filter((x) => !x.joins),
    joining = apps.filter((x) => x.joins);
  const list = going.map(named),
    out: string[] = [];
  if (list.length)
    out.push(
      `The ${list.length === 1 ? "app" : "apps"} ${list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`} ` +
        `${list.length === 1 ? "goes" : "go"} with ${many ? "them" : "it"}.`,
    );
  for (const x of joining)
    out.push(
      `${many ? "Their" : "Its"} ${named(x)} closes because the ${to ? title(w, to) : "other"} group has its own. ` +
        `${many ? "They" : "It"} will use that one.`,
    );
  return out.join(" ");
}
/** The coordinator agents of `from` over folder `fid` or a folder in it: they go where it goes (groups.py's `_crews`). */
export const crewsWithin = (ctx: ListCtx, from: Gatherer, fid: number): Actor[] =>
  from.agents.filter(
    (a) =>
      isCoordinator(a) &&
      String(a.over || "").startsWith("folder:") &&
      LT.within(ctx, from.name, +a.over!.slice("folder:".length), fid),
  );
export const crewsSaid = (crews: Actor[], made: boolean): string | null =>
  !crews.length
    ? null
    : crews.length === 1
      ? `Its coordinator agent ${made ? "becomes the new group's" : "goes with it"}.`
      : `The ${crews.length} coordinator agents over it and its folders go with it${made ? ", and the one over it becomes the new group's" : ""}.`;
/** How many of `actors` (of group `from`) rebuild their context at their next call, working now. */
export function rebuildLine(ctx: ListCtx, from: Gatherer, actors: Actor[]): string {
  const working = actors.filter((a) => WORKING.has(groupOf(ctx, from, a))).length,
    one = actors.length === 1;
  if (!working) return `${one ? "It rebuilds its" : "Each rebuilds its"} context when it next runs.`;
  if (one) return "It is working now and will rebuild its context at its next call.";
  return (
    `${mvCount(working, "of them is", "of them are")} working now and will rebuild ${working === 1 ? "its" : "their"} context at the next call.` +
    (working < actors.length ? " The others rebuild when they next run." : "")
  );
}
/** The actors that move (by their channels), by name, when more than one. */
export function moveNames(from: Gatherer, channels: string[]): { shown: string[]; more: number } | null {
  const moving = from.agents.filter((a) => channels.includes(a.channel));
  if (moving.length < 2) return null;
  const shown = moving.slice(0, 6);
  return { shown: shown.map(actorTitle), more: moving.length - shown.length };
}
/** What the dialog says of a move (`plan`) from group `from` into `g`: the page's own counts, as the list has them. */
export function moveLines(w: Words, from: Gatherer, g: Gatherer, plan: Plan): string[] {
  const moving = new Set(plan.actors),
    actors = from.agents.filter((a) => moving.has(a.channel));
  const others = (x: Gatherer) => x.agents.filter((a) => !isCoordinator(a) && !moving.has(a.channel)).length;
  const f = plan.folder !== undefined && plan.folder !== null ? LT.folderById(w.ctx, from.name, plan.folder) : null;
  const n = actors.length,
    one = !f && n === 1;
  const what = f
    ? n
      ? `The folder ${f.name} and its ${mvCount(n, "actor")}`
      : `The folder ${f.name}`
    : one
      ? actorTitle(actors[0])
      : `${n} actors`;
  const out = [
    `${what} ${one ? "moves" : "move"} from the ${title(w, from)} group (${mvCount(others(from), "other")}) ` +
      `to the ${title(w, g)} group (${mvCount(others(g), "other")}).`,
  ];
  if (!n) return out;
  out.push(
    `${one ? "It" : "They"} will share context with the actors of ${title(w, g)}, and no longer with those of ${title(w, from)}.`,
  );
  out.push(rebuildLine(w.ctx, from, actors));
  const apps = appsLine(w, plan.apps, !one, g);
  if (apps) out.push(apps);
  return out;
}
/** What the dialog says of folder `f` of `g` made a group of its own -- in place (`here`), or at the list's top --
 * its actors (`inside`) leaving `g`, the apps going with it (`going`). */
export function ownLines(
  w: Words,
  g: Gatherer,
  f: { id: number; name: string },
  here: boolean,
  inside: string[],
  going: PlanApp[],
): string[] {
  const actors = g.agents.filter((a) => inside.includes(a.channel)),
    n = actors.length;
  const others = g.agents.filter((a) => !isCoordinator(a) && !inside.includes(a.channel)).length;
  const lines = [
    (here
      ? `${f.name} becomes a group of its own, in place, with the settings of ${title(w, g)}.`
      : `The folder ${f.name} becomes a group of its own, with its contents at the top.`) +
      (n
        ? ` ${n === 1 ? "Its actor leaves" : `Its ${n} actors leave`} the ${title(w, g)} group (${mvCount(others, "other")}) for it.`
        : here
          ? " It has no actors yet. Actors started there will share context only with each other."
          : ` It leaves the ${title(w, g)} group.`),
  ];
  if (n)
    lines.push(
      `${n === 1 ? "It" : "They"} will no longer share context with the actors of ${title(w, g)}` +
        `${n === 1 ? "" : ", only with each other"}.`,
      rebuildLine(w.ctx, g, actors),
    );
  const appsSaid = appsLine(w, going, n > 1),
    crewSaid = crewsSaid(crewsWithin(w.ctx, g, f.id), true);
  if (appsSaid) lines.push(appsSaid);
  if (crewSaid) lines.push(crewSaid);
  return lines;
}
/** What the dialog says of group `from` merged into `g` (into its folder `inside`), as the server's plan has it. */
export function mergeLines(
  w: Words,
  from: Gatherer,
  g: Gatherer,
  inside: { name: string } | null,
  plan: { folder: string; apps: PlanApp[] },
): string[] {
  const actors = from.agents.filter((a) => !isCoordinator(a)),
    n = actors.length;
  const others = g.agents.filter((a) => !isCoordinator(a)).length;
  const lines = [
    `${title(w, from)} becomes a folder of ${title(w, g)}, named ${plan.folder}${inside ? `, in ${inside.name}` : ""}, ` +
      "with everything in it.",
  ];
  if (n)
    lines.push(
      `Its ${mvCount(n, "actor")} and the ${mvCount(others, "actor")} of ${title(w, g)} will share context with each other.`,
      rebuildLine(w.ctx, from, actors),
    );
  const apps = appsLine(
    w,
    plan.apps.filter((x) => x.app !== "notes"),
    true,
    g,
  );
  if (apps) lines.push(apps);
  if (plan.apps.some((x) => x.app === "notes"))
    lines.push(`Its notes go under a page named ${title(w, from)} in the notes of ${title(w, g)}.`);
  if (LG.groupCrew(from)) lines.push("Its coordinator agent becomes the one over the new folder.");
  return lines;
}
/** What the dialog says of actor `a` of `from` put on its own -- `here`, staying in its folder (`where`), else taken
 * out of every group -- the apps going with it. */
export function aloneLines(
  w: Words,
  from: Gatherer,
  a: Actor,
  here: boolean,
  where: string,
  going: PlanApp[],
): string[] {
  const name = actorTitle(a),
    others = from.agents.filter((x) => !isCoordinator(x) && x.channel !== a.channel).length;
  return [
    `${name} leaves the ${title(w, from)} group (${mvCount(others, "other")}) and works on its own` +
      (here ? `, staying in ${where}` : "") +
      ". It won't share context with any other actor.",
    appsLine(w, going, false),
    here
      ? `It has no coordinator agent. Use Manage groups to bring it back into ${title(w, from)}.`
      : "It has no coordinator agent. Drag it into a group to bring it back.",
    rebuildLine(w.ctx, from, [a]),
  ].filter((x): x is string => !!x);
}
