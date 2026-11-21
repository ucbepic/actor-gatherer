// The bar under the list for the actors selected (PickBar.tsx), drawn after the list is (list.ts's renderAgents), and
// what its buttons do: the selected moved to a folder, saved, closed.
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { closable } from "../../core/model/session";
import { fileActors, freeName, kidFolders, makeFolder, startFolderEdit } from "./folders";
import type { MenuInfo, MenuItem } from "./host";
import { L, snap } from "./link";
import { clearPicks, pickedActors, savedAs, setSaved, titleOf } from "./list";
import { PickBar, type PickBarHost } from "./PickBar";
import { discardable } from "./seen";
import { closeActor, closeSession, discardSession } from "./task-acts";
import type { Actor, Gatherer } from "./types";

// "Move to…": the gatherer's top, each of its folders as a tree, or a new folder (at the top, then named in its line)
function moveMenu(g: Gatherer, list: Actor[]): MenuInfo {
  const top = document.createElement("span");
  top.className = "top-mark";
  top.append(L.helpers.strokeIcon(L.helpers.ICONS.folder, 16));
  const items: MenuItem[] = [{ mark: top, text: `Top of ${titleOf(g)}`, run: () => void movePicks(g, list, null) }];
  const walk = (id: number | null, depth: number) => {
    for (const f of kidFolders(g.name, id)) {
      items.push({ icon: "folder", text: f.name, depth, run: () => void movePicks(g, list, f.id) });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  items.push({
    icon: "folderNew",
    text: "New folder…",
    note: "at the top, with the selected actors",
    run: async () => {
      const got = await makeFolder(g.name, freeName(g.name, null, "New folder"), null);
      if (got && got.made !== undefined) {
        await movePicks(g, list, got.made);
        startFolderEdit(g.name, got.made);
      }
    },
  });
  return { head: `Move ${list.length} actors to`, items };
}
function movePicks(g: Gatherer, list: Actor[], id: number | null) {
  clearPicks(false);
  return fileActors(g.name, list, id);
}
async function savePicks(g: Gatherer, list: Actor[], save: boolean) {
  for (const a of list) if (!!savedAs(g.name, a) !== save) await setSaved(g.name, a, save);
}
async function closePicks(g: Gatherer, list: Actor[]) {
  clearPicks();
  for (const a of list) {
    if (closable(a, snap())) await closeActor(g, a, closeSession);
    else if (discardable(a)) await closeActor(g, a, () => discardSession(g, a));
  }
}

let bar: { node: HTMLElement; root: Root } | null = null;
// What the bar calls, the selection as it is when pressed
const HOST: PickBarHost = {
  icon: (name, size) => L.helpers.strokeIcon(L.helpers.ICONS[name] || name, size),
  saveIcon: (on) => L.helpers.saveIcon(on),
  closeIcon: () => L.helpers.closeIcon(),
  moveMenu: () => {
    const [g, list] = pickedActors();
    return g && list.length > 1 ? moveMenu(g, list) : null;
  },
  save: (on) => {
    const [g, list] = pickedActors();
    if (g) void savePicks(g, list, on);
  },
  close: () => {
    const [g, list] = pickedActors();
    if (g) void closePicks(g, list);
  },
  clear: () => clearPicks(),
};
/** The bar drawn under the list as the selection is now: hidden with fewer than two selected, or in a snapshot. */
export function drawPickBar(): void {
  if (!bar) {
    const node = Object.assign(document.createElement("div"), { id: "pick-bar", className: "pick-bar" });
    node.setAttribute("role", "toolbar");
    node.setAttribute("aria-label", "Selected actors");
    document.getElementById("agents")!.after(node);
    bar = { node, root: createRoot(node) };
  }
  const [g, list] = pickedActors();
  const hidden = snap() || !g || list.length < 2;
  bar.node.hidden = hidden;
  const { root } = bar;
  flushSync(() =>
    root.render(
      hidden ? null : (
        <PickBar
          m={{ n: list.length, allSaved: list.every((a) => savedAs(g!.name, a)), group: titleOf(g!) }}
          host={HOST}
        />
      ),
    ),
  );
}
