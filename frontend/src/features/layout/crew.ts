// A COORDINATOR AGENT's button (CREW_START), on its node's row -- a group's, a folder's, a folder of groups', the list's
// head for everything: the agent shown, started over the node if it has none -- on the first harness a session can run
// on here, in the directory of the actor latest at work under the node (coordination.py's `ensure`). Shown as a click on
// its row shows an actor on its own: where it is open in a screen tab, else in a tab of its own (viaTabs) -- started, once
// listed, as any actor started.
import { post } from "../../core/api/client";
import { L, renderAgents, state } from "./link";
import { focusedPane, taskKey } from "./open";
import { show, viaTabs } from "./show";
import { cwdOf } from "./start-rules";
import { startable, startCwd } from "./starts";
import type { Actor, Gatherer } from "./types";

export const CREW_START = "crew",
  CREW_GROUP = "Coordinator agent";

/** The directory a coordinator agent over `node` starts in: that of the actor latest at work under it. */
function crewCwd(node: string, g: Gatherer | null): string {
  const kind = node.slice(0, Math.max(0, node.indexOf(":"))),
    n = Number(node.slice(node.indexOf(":") + 1));
  const under: Actor[] =
    kind === "folder" && g
      ? L.list.actorsWithin(g, n)
      : kind === "group" && g
        ? g.agents
        : (state.home?.gatherers || [])
            .filter(
              (x) =>
                !x.alone && (node === "all" || L.list.within(L.gathererFolders.GF, L.gathererFolders.gfOf(x.name), n)),
            )
            .flatMap((x) => x.agents);
  const a = under.filter((y) => cwdOf(y) && !L.list.isCoordinator(y)).sort((x, y) => (y.last || 0) - (x.last || 0))[0];
  return a ? cwdOf(a) : "";
}
/** The coordinator agent over `node` shown -- started first if it has none. */
export async function openCoordinator(g: Gatherer | null, node = g ? `group:${g.name}` : "all"): Promise<void> {
  const hk = L.list.crewHideKey(node);
  if (L.list.crewHidden.has(hk)) L.list.setCrewHidden(hk, false);
  const [cg, there] = L.list.crewAt(node, g);
  const view = L.views.CHAT_VIEWS.has("files") ? "files" : null;
  if (cg && there) {
    await viaTabs(taskKey(cg.name, there.channel), {}, there.channel);
    return show(cg.name, there.channel, view);
  }
  state.starting = { gatherer: g ? g.name : "", harness: CREW_START, node };
  renderAgents();
  try {
    const s = await post<{ gatherer: string; session_id: string }>("/api/coordinator", {
      over: node,
      cwd: crewCwd(node, g),
      harness: startable()[0] || "",
    });
    L.list.collapsed.delete(s.gatherer);
    await L.data.loadHome();
    await viaTabs(taskKey(s.gatherer, s.session_id), {}); // a tab of its own
    await show(s.gatherer, s.session_id, view);
  } catch (e) {
    if (g) state.adding = { gatherer: g.name, cwd: startCwd(g), harness: null, error: (e as Error).message };
    else alert((e as Error).message);
  } finally {
    state.starting = null;
    renderAgents();
  }
  L.paneView.paneBox(focusedPane())?.focus();
}
