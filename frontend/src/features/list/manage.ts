// ---- MANAGE GROUPS: who shares context with whom, at a glance, and the switches (the Notes design's section 4): a
// dialog from the settings panel (manageEntry), drawn by ManageGroups.tsx from manage-model.ts's rows -- each group at
// its place, its folders and open actors under it, each with its switch. A switch asks first, as in the list
// (group-moves.ts's askOwn, askAbove, askAloneHere, askJoin), then the dialog is drawn again from the new home
// (renderAgents calls drawManage while it is open). The CLI's `ag groups` has the same. A group's or folder's row folds
// what is under it (mgFolded, kept in this browser). Rows are dragged and dropped as the list's are -- the same rules,
// but asked first (drag.ts's listDrag `ask`; in the list, done at once) -- and its "Outside every group" area is over the
// panel's top line while one is dragged. New folders are made here too: at the top (a group of its own) from its head,
// in a group or a folder from its row's button, named in a box in place (manage.naming). In the home's one database
// only. And the question a move between groups asks first (group-moves.ts), in a dialog of the same kind.
import * as prefs from "../../core/prefs";
import { withOwn } from "./drag-rules";
import { canOutside, outsideDropped, RULES, startDrag } from "./drag";
import { nameFolder } from "./folders";
import { GFS, nameGroup } from "./gatherer-folders";
import { askAbove, askAloneHere, askJoin, askOwn } from "./group-moves";
import { L, S, snap } from "./link";
import { CTX } from "./list";
import { LIST_HOST } from "./list-host";
import { buildManage } from "./manage-model";
import type { DialogsHost, MoveAsk } from "./ManageGroups";
import { drawListDialogs, drawingNow } from "./modes-mount";
import type { Actor, Gatherer } from "./types";

// the move's question, as it stands: open, its label, busy (its change under way), what it shows
export const moveAsk = { open: false, label: "", busy: false, shown: null as Omit<MoveAsk, "label" | "busy"> | null };
// The dialog opened (ManageGroups.tsx's Move)
export function mvOpen(label: string): void {
  Object.assign(moveAsk, { open: true, label, busy: false, shown: null });
  drawDialogs();
}
export function mvClose(): void {
  if (moveAsk.busy) return;
  Object.assign(moveAsk, { open: false, shown: null });
  drawDialogs();
}
// The dialog drawn: its title, `lines`, the actors `names`, `note`, then Cancel and `goLabel` (`go`; none: not yet) --
// its button in focus, once there is one to press
export function mvDraw({
  title,
  lines = [],
  names = null,
  note = "",
  go = null,
  goLabel = "",
}: Partial<Omit<MoveAsk, "label" | "busy">> & { title: string }): void {
  if (!moveAsk.open) return;
  moveAsk.shown = { title, lines, names, note, go, goLabel };
  drawDialogs();
}

export const manage = {
  open: false,
  naming: null as { g: string | null; parent: number | null; value: string; n: number } | null,
};
let namings = 0;
// the settings panel's entry: shown in the home's one database only; a click there closes the panel, opens this
export function manageEntry(): void {
  const n = document.getElementById("groups-cfg");
  if (n) n.hidden = snap() || !S().home!.merged;
}
function openManage() {
  manage.open = true;
  drawManage();
}
function closeManage() {
  Object.assign(manage, { open: false, naming: null });
  drawManage();
}
// What the panel has folded: "g:<group>", "f:<group>:<folder id>", "alone" (those on their own at the top)
const MG_FOLDED_KEY = "ag-dashboard-manage-groups-folded";
const mgFolded = new Set((prefs.list(MG_FOLDED_KEY) as string[] | null) || []);
// `key` folded or opened (`open`; flipped, left out), and the panel drawn so
function mgToggle(key: string, open?: boolean) {
  const fold = open === undefined ? !mgFolded.has(key) : !open;
  if (fold === mgFolded.has(key)) return;
  if (fold) mgFolded.add(key);
  else mgFolded.delete(key);
  prefs.keep(MG_FOLDED_KEY, [...mgFolded]);
  drawManage();
}
// A new folder named in place: in folder `parent` of group `g` (g null: at the top, a group of its own by the default
// rule), the row it is in opened (`key`), its box drawn first under it; Enter makes it, Esc or an empty box leaves it, a
// click elsewhere makes it as typed -- as the list's own box does (nameFolder, nameGroup)
function mgStartNaming(g: Gatherer | null, parent: number | null, key: string | null) {
  manage.naming = { g: g ? g.name : null, parent, value: "", n: ++namings };
  if (key) mgFolded.delete(key);
  drawManage();
}
function mgEndNaming(keep: boolean) {
  const n = manage.naming;
  if (!n) return;
  manage.naming = null;
  if (keep && n.value.trim()) {
    if (n.g === null) nameGroup(null, n.value);
    else nameFolder(n.g, null, n.parent, n.value);
  }
  drawManage();
}
// An actor of group `g` in a task with other actors: its switch can't be had (tasks move as a whole)
const inTaskWithOthers = (g: Gatherer, a: Actor) =>
  withOwn(RULES, g, [a.channel]).filter((c) => !c.startsWith("app:")).length > 1;
// what Manage groups and the move's question call of the page (ManageGroups.tsx's DialogsHost)
let dialogHost: DialogsHost | null = null;
const DIALOG_HOST = (): DialogsHost =>
  (dialogHost ??= {
    ...LIST_HOST,
    ctx: CTX,
    close: closeManage,
    toggle: mgToggle,
    startNaming: mgStartNaming,
    endNaming: mgEndNaming,
    namingTyped: (v) => {
      if (manage.naming) manage.naming.value = v;
    },
    namingBlur: () => {
      if (!drawingNow() && manage.naming && document.hasFocus()) mgEndNaming(true);
    },
    askOwn: (g, f) => askOwn(g, f),
    askAbove,
    askJoin,
    askAloneHere,
    dragGroup: (ev, g) => startDrag(ev, GFS, { gs: [g.name] }),
    outsideCan: canOutside,
    outsideDrop: outsideDropped,
    moveClose: mvClose,
  });
// Manage groups and the move's question drawn as they are now: the groups as the home has them (renderAgents calls this)
export function drawDialogs(): void {
  drawListDialogs(
    {
      manage: manage.open
        ? {
            rows: buildManage(CTX, { folded: mgFolded, naming: manage.naming, inTask: inTaskWithOthers }),
            naming: manage.naming && { n: manage.naming.n, value: manage.naming.value },
          }
        : null,
      move: moveAsk.open
        ? {
            label: moveAsk.label,
            busy: moveAsk.busy,
            ...(moveAsk.shown || { title: "", lines: [], names: null, note: "", go: null, goLabel: "" }),
          }
        : null,
    },
    DIALOG_HOST(),
  );
}
export const drawManage = drawDialogs;
// What this module did as the page's script ran, in that order: page.js runs it once every module is loaded.
export function start(): void {
  document.getElementById("manage-groups")?.addEventListener("click", () => {
    L.data.setAbout(false);
    openManage();
  });
}
