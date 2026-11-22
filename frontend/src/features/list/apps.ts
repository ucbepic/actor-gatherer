// THE APPS of each gatherer (/api/apps, the host's): its open instances, and its tasks with them (which an app is in) --
// read again as the list is drawn, at most every APPS_READ ms (`now`: at once; -> once read) -- the list drawn again if
// they changed.
import { get } from "../../core/api/client";
import type { Apps, Instance } from "../../core/api/types";
import { L, S, inPane, snap, type PageHome } from "./link";
import { renderAgents } from "./list";
import { newerTasks } from "./seen";
import type { AppItem } from "./types";

/** An instance of an app, as the host lists it. */
export type { Instance } from "../../core/api/types";
/** What the list knows of a gatherer's apps: its instances, and the agents attached to each. */
export interface Known {
  instances: Instance[];
  attached: Record<string, string[]>;
}
const APPS_READ = 2000;
export const appsKnown = new Map<string, Known>();
const appsRead = new Map<string, number>();
export function readApps(gname: string, now = false): Promise<void> {
  if (inPane() || snap() || !L.appHost.found().length) return Promise.resolve();
  if (!now && Date.now() - (appsRead.get(gname) || 0) < APPS_READ) return Promise.resolve();
  appsRead.set(gname, Date.now());
  return get<Apps>(`/api/apps?gatherer=${encodeURIComponent(gname)}`)
    .then((got) => {
      const state = S();
      const is = JSON.stringify({ instances: got.instances || [], attached: got.attached || {} });
      const had = JSON.stringify(state.home!.tasks || {});
      if (got.tasks)
        state.home!.tasks = newerTasks(
          state.home!.tasks,
          got.tasks.tasks && got.tasks.tasks.length ? { [gname]: got.tasks } : {},
          got.now,
          gname,
        );
      const moved = had !== JSON.stringify(state.home!.tasks || {});
      if (!moved && JSON.stringify(appsKnown.get(gname) || null) === is) return;
      appsKnown.set(gname, JSON.parse(is) as Known);
      appsFollowHome(state.home!); // read before a move the home has since: where the home has it
      renderAgents();
    })
    .catch(() => {
      /* none known: none shown */
    });
}
// Each app where the home says it is (its `app_groups`, the server's app host's: read with the actors): one read under
// another group -- moved since with its task or folder -- taken over to that one, its agents with it. Else the list
// draws it twice for a moment: in its task in the new group, and alone in the old one, as last read there.
export function appsFollowHome(home: PageHome): void {
  const where = home && home.app_groups;
  if (!where) return;
  for (const [g, known] of [...appsKnown]) {
    const gone = (known.instances || []).filter((i) => where[i.id] !== undefined && where[i.id] !== g);
    if (!gone.length) continue;
    const ids = new Set(gone.map((i) => i.id)),
      attached = known.attached || {};
    appsKnown.set(g, {
      ...known,
      instances: known.instances.filter((i) => !ids.has(i.id)),
      attached: Object.fromEntries(Object.entries(attached).filter(([id]) => !ids.has(id))),
    });
    for (const i of gone) {
      const to = where[i.id],
        there = appsKnown.get(to) || { instances: [], attached: {} };
      appsKnown.set(to, {
        ...there,
        instances: [...(there.instances || []).filter((x) => x.id !== i.id), { ...i, gatherer: to }],
        attached: { ...(there.attached || {}), [i.id]: attached[i.id] || [] },
      });
    }
  }
}
// an open instance as the list has it -- {app (its manifest), id, title, name (the user's), folder, inst} -- null: of an
// app not found here
function appOf(i: Instance, gname: string): AppItem | null {
  const app = L.appHost.named(i.app);
  return app
    ? { app, id: i.id, title: i.title || "", name: i.name || "", folder: i.folder || null, group: gname, inst: i }
    : null;
}
export const gathererApps = (gname: string): AppItem[] =>
  inPane() || snap()
    ? []
    : ((appsKnown.get(gname) || { instances: [] }).instances || [])
        .map((i) => appOf(i, gname))
        .filter((o): o is AppItem => !!o);
export const appInfo = (gname: string, id: string): AppItem | null =>
  gathererApps(gname).find((o) => o.id === id) || null;
