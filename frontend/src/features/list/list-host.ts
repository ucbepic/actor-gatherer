// What the list in React calls of the page (host.ts's ListHost): what a press, a key or a drag on a row does -- the
// list's own modules' -- and what of a row the page still builds (a gatherer's and a folder's start menu, a harness's
// mark, an actor's branch, the form for a new actor), the panes' module's.
import { ago } from "../../core/format";
import { addInfo, addItems } from "./task-acts";
import {
  closeActor,
  closeApp,
  closeSession,
  closeShell,
  closeTask,
  discardSession,
  openTask,
  saveTask,
} from "./task-acts";
import { selectApp } from "./task-acts";
import { cardHide, HOVERS } from "./hover-card";
import * as drag from "./drag";
import { appFace, appMarkOf, avatarSrc } from "./faces";
import {
  aimStart,
  closeAskSays,
  closeFolder,
  deleteFolder,
  endFolderEdit,
  folderBox,
  folderClosing,
  isOpenFolder,
  pressClose,
  reopenFolder,
  setFolderClosing,
  startFolderEdit,
  toggleFolder,
} from "./folders";
import { GF, GFS, gPicks, pickGatherer } from "./gatherer-folders";
import { aloneNewInfo, aloneNewPress } from "./group-moves";
import type { ListHost } from "./host";
import { L, S, snap } from "./link";
import {
  collapsed,
  crewHidden,
  CTX,
  renderAgents,
  setCrewHidden,
  setHidden,
  setSaved,
  toggleFold,
  toggleGatherer,
  togglePick,
} from "./list";
import { listButtonsInfo, setListHidden, setListMode } from "./modes";
import { listDrawing } from "./mount";
import { endRename, nameBox, nameNote, retitle, startItemRename, startRename } from "./naming";
import * as LG from "./groups";
import { statusOf } from "./seen";

// A coordinator agent's button on a node's row (Parts.tsx's CrewButton), as the list draws it: none while none can be
// started and the node has none
function crewInfo(g: Parameters<ListHost["crew"]>[0], node: string): ReturnType<ListHost["crew"]> {
  const [, crew] = LG.crewAt(CTX, node, g),
    hidden = !!crew && crewHidden.has(LG.crewHideKey(node));
  if (!L.panes.startable().length && !crew) return null;
  const place = LG.crewPlace(CTX, node, g),
    what =
      node === "all"
        ? "every group's actors"
        : node.startsWith("groups:")
          ? `the actors of the groups in ${place}`
          : node.startsWith("group:")
            ? "this group's actors"
            : `the actors in ${place}`;
  const st = hidden ? statusOf(crew!) : null,
    starting = S().starting;
  return {
    crew: crew || null,
    hidden: st,
    disabled: !!starting,
    busy: !!starting && starting.harness === "crew" && starting.node === node,
    title: hidden
      ? `Coordinator agent over ${place} · ${st![1]} · hidden from the list`
      : crew
        ? `Coordinator agent over ${place}`
        : `Start a coordinator agent for ${what}`,
    label: crew ? `The coordinator agent over ${place}` : `Start a coordinator agent over ${place}`,
  };
}
const H = () => L.helpers;

export const LIST_HOST: ListHost = {
  get snapshot() {
    return snap();
  },
  hovers: () => HOVERS.matches,
  get besideKey() {
    return H().BESIDE_KEY;
  },
  harnessName: (h) => H().harnessName(h),
  ago,
  avatarSrc,
  shellPath: (s) => H().shellPath(s),
  nameNote,
  taskKind: (k) => (L.chat.TASK_KINDS[k as string] || k) as string,
  // its head (Head.tsx): a gatherer or a folder of gatherers dropped on it, at the list's top (gatherer-folders.ts)
  outsideCan: () => drag.canOutside(),
  outsideDrop: drag.outsideDropped,
  newGroup: () => startFolderEdit(GF, null, null), // a group (gatherer-folders.ts)
  aloneNew: aloneNewInfo, // an actor on its own (group-moves.ts)
  aloneNewPress,
  listButtons: () => listButtonsInfo(),
  setListMode,
  setListHidden,
  iconPath: (name) => H().ICONS[name] || name,
  // a gatherer's and a folder's buttons (Menus.tsx): "+" (all that starts there: startMenu) and "⋯"
  startMenu: (g, f) => L.panes.startMenu(g, f),
  startOpening: (g, f) => {
    L.panes.closePops();
    aimStart(g.name, f ? f.id : null);
  },
  closePops: () => L.panes.closePops(),
  // a gatherer's "⋯": a new folder, rename, and hide
  gathererMore: (g, title) => ({
    head: title,
    items: [
      ...(snap()
        ? []
        : [
            { icon: "folderNew", text: "New folder", run: () => startFolderEdit(g.name, null, null) },
            { icon: "pencil", text: "Rename", run: () => retitle(g) },
          ]),
      { mark: H().hideIcon(), text: "Hide", run: () => void setHidden(g, true) },
    ],
  }),
  // a folder's "⋯": a folder made in it, it renamed (F2), it deleted
  folderMore: (g, f, crew) => ({
    head: f.name,
    items: [
      { icon: "folderNew", text: "New folder", run: () => startFolderEdit(g.name, null, f.id) },
      { icon: "pencil", text: "Rename", run: () => startFolderEdit(g.name, f.id) },
      {
        icon: "bin",
        text: crew ? "Delete (its coordinator agent closes)" : "Delete",
        run: () => void deleteFolder(g.name, f.id),
      },
    ],
  }),
  deleteFolder: (gname, id) => void deleteFolder(gname, id),
  reopenFolder: (gname, id) => void reopenFolder(gname, id),
  pressClose: (g, f) => pressClose(g, f, "list", renderAgents),
  newForm: () => L.panes.newForm(),
  formAt: () => JSON.stringify([S().adding, S().starting]),
  branch: (g, a) => L.panes.branchChip(g, a),
  harnessLogo: (h) => H().harnessLogo(h),
  appFace: (o) => appFace(o),
  appMark: (o) => appMarkOf(o),
  icon: (name, size) => H().strokeIcon(H().ICONS[name] || name, size),
  saveIcon: (on) => H().saveIcon(on),
  hideIcon: () => H().hideIcon(),
  closeIcon: () => H().closeIcon(),
  crew: crewInfo,
  openCoordinator: (g, node) => L.panes.openCoordinator(g, node),
  adds: (g, k) => addInfo(g, k),
  addMenu: (g, k) => addItems(g, k),
  toggleGatherer,
  toggleFolder,
  toggleFold,
  openGatherer: (name) => {
    if (collapsed.has(name)) toggleGatherer(name);
  },
  openFolder: (gname, id) => {
    if (!isOpenFolder(gname, id)) toggleFolder(gname, id);
  },
  pick: (gname, c, ev) => void L.panes.pick(gname, c, ev),
  pickBeside: (gname, c, ev) => L.panes.pickBeside(gname, c, ev),
  togglePick,
  cardHide: () => cardHide(),
  openTask: (gname, id, ev) => void openTask(gname, id, null, ev),
  selectApp: (gname, o, ev) => void selectApp(gname, o, ev),
  appPanelMenu: (gname, o, ev) => L.panes.appPanelMenu(gname, o, ev),
  setSaved: (gname, a, save) => void setSaved(gname, a, save),
  saveTask: (gname, id, save) => void saveTask(gname, id, save),
  closeTask: (gname, id) => void closeTask(gname, id),
  closeApp: (gname, o) => void closeApp(gname, o),
  closeShell: (s) => void closeShell(s),
  setHidden: (g, hide) => void setHidden(g, hide),
  startFolderEdit,
  hideCrew: (g, a) => setCrewHidden(LG.crewHideKey(LG.crewNode(g, a)), true),
  closeActor: (g, a, how) => void closeActor(g, a, how === "close" ? closeSession : () => discardSession(g, a)),
  startRename,
  startItemRename,
  endRename: (keep) => void endRename(keep),
  endFolderEdit,
  renaming: () => {
    const r = S().renaming;
    return (
      r && {
        value: r.value,
        placeholder: r.c === null ? r.g : r.kind ? r.auto || "" : "Name this actor",
        label: r.c === null ? "This group's name" : r.kind ? `This ${r.kind}'s name` : "This actor's name",
      }
    );
  },
  nameRef: (n) => nameBox.ref(n),
  nameTyped: (v) => {
    const r = S().renaming;
    if (r) r.value = v;
  },
  // Tab away keeps it (a press has ended it already) -- not a blur of the list's own drawing, nor the window going to
  // the back (it comes back focused)
  nameBlur: () => {
    if (!listDrawing() && document.hasFocus() && nameBox.ownsNaming()) void endRename(true);
  },
  folderEditing: () => {
    const f = S().folderEdit;
    return f && { value: f.value, label: f.id === null ? "The new folder's name" : "The folder's name" };
  },
  folderRef: (n) => folderBox.ref(n),
  folderTyped: (v) => {
    const f = S().folderEdit;
    if (f) f.value = v;
  },
  folderBlur: () => {
    if (!listDrawing() && document.hasFocus() && folderBox.ownsEdit()) endFolderEdit(true);
  },
  closeAsk: (g, f) => closeAskSays(g, f),
  closeFolderGo: (g, f) => {
    setFolderClosing(null);
    void closeFolder(g, f);
  },
  closeAskCancel: () => {
    setFolderClosing(null);
    renderAgents();
  },
  askFocus: (which) => {
    if (folderClosing) folderClosing.focus = which;
  },
  dragActor: (ev, g, a) => drag.startDrag(ev, g, { cs: drag.draggedWith(g, a) }),
  dragItems: (ev, g, items) => drag.startDrag(ev, g, { cs: items }),
  dragFolder: (ev, g, f) => drag.startDrag(ev, g, { folder: f.id }),
  dragGatherer: (ev, g) => drag.startDrag(ev, GFS, { gs: gPicks.has(g.name) ? [...gPicks] : [g.name] }),
  pickGatherer: (ev, g) => pickGatherer(ev, g),
  dragEnd: () => drag.endDrag(),
  dropEnter: drag.dropEnter,
  dropOver: drag.dropOver,
  dropLeave: drag.dropLeave,
  drop: drag.dropDone,
  joinEnter: drag.joinEnter,
  joinOver: drag.joinOver,
  joinDrop: drag.joinDrop,
};
