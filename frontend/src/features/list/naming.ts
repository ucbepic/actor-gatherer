// NAMING an actor: its top line in the list, clicked once it is the one shown, becomes a box with its name in it; Enter
// (or a press anywhere else in the page, or Tab away) keeps what is typed, Esc leaves it as it was, and nothing typed
// takes the reader's name back -- the harness's own, or what it was last asked, shows again. Kept as an event in its
// gatherer and given to its harness (POST /api/name): Claude Code's or codex's own list of sessions shows it, and a
// session in the dashboard's terminal is told with its harness's /rename once its turn is over. The box (the list's,
// Parts.tsx's NameBox) is one element for as long as it is open (`nameInput`; `nameFor`, the naming it was opened for).
// A press anywhere but in the box ends it -- also where the keys stay put (History's rows, a scroll bar) or go into a
// pane's frame (agPanes.focus): the list's rows stay where they are as it is drawn again, so the press's click still
// lands on the row it was pressed on.
//
// Naming a TASK or an APP, as an actor is named: its name in its row double-clicked (or F2 on its row), or its card's
// pencil (card.ts's editInCard) -- `state.renaming.c` its item ("task:<id>", "app:<instance id>"), `kind` which, `auto`
// what it is called when not named. Kept: a task's name by the dashboard (tasks.py: POST /api/tasks rename), an app's
// with its instance (app_host.py's `rename`: POST /api/apps/rename), which its panel's head shows too. Nothing typed
// takes the name back: a task named by what is in it again, an app by its own title.
import { post } from "../../core/api/client";
import { appInfo, appsKnown, readApps } from "./apps";
import { tidyName } from "./folder-edits";
import { L, S } from "./link";
import { CTX, keepTitle, renderAgents, titleOf } from "./list";
import { takeTasks } from "./task-acts";
import { appShown, taskById, taskName } from "./tasks";
import type { Actor, AppItem, Gatherer, Task } from "./types";

let nameInput: HTMLInputElement | null = null,
  nameFor: unknown = null;
/** The name's box, as the list draws it: its element, once drawn, and whether a press elsewhere ends it. */
export const nameBox = {
  get input() {
    return nameInput;
  },
  ref(n: HTMLInputElement | null) {
    nameInput = n;
    nameFor = n ? S().renaming : null;
  },
  ownsNaming: () => !!S().renaming && S().renaming === nameFor,
  /** gone with its row (folded away): the naming dropped */
  dropIfGone() {
    if (S().renaming && !(nameInput && nameInput.isConnected)) {
      S().renaming = null;
      nameInput = null;
    }
  },
};
/** The box just drawn: in focus, all of it selected. */
function focusBox() {
  const n = nameInput as HTMLInputElement | null;
  if (n) {
    n.focus();
    n.select();
  }
}
const redrawNamed = () => {
  renderAgents();
  L.panes.drawWho();
};
const nameAnswers = new Map<string, { error?: string; store?: unknown; terminal?: unknown }>(); // what came of each name given from this page
const nameKey = (gname: string, c: string) => `${gname}\u0000${c}`;
export function nameNote(g: Gatherer, a: Actor): string {
  if (!a.name || !a.name.text) return "";
  const h = L.helpers;
  if (a.name.by !== "user") return `Named by ${h.harnessInfo(a.name.by) ? h.harnessName(a.name.by) : "its harness"}\n`;
  const how = nameAnswers.get(nameKey(g.name, a.channel));
  return (
    "Named by you" +
    (!how
      ? ""
      : how.error
        ? ` · not in ${h.harnessName(a.harness)}: ${how.error}`
        : how.store || how.terminal
          ? ` · in ${h.harnessName(a.harness)} too`
          : "") +
    "\n"
  );
}
// Named in the actor's name box, its channel null: Enter keeps it, Esc leaves it, empty gives its own back.
export function retitle(g: Gatherer): void {
  S().renaming = { g: g.name, c: null, value: titleOf(g), was: "" };
  nameInput = null;
  renderAgents();
  focusBox();
}
export function startRename(g: Gatherer, a: Actor): void {
  const r = S().renaming;
  if (r && r.g === g.name && r.c === a.channel) return;
  const was = (a.name && a.name.by === "user" && a.name.text) || "";
  S().renaming = { g: g.name, c: a.channel, value: (a.name && a.name.text) || "", was };
  nameInput = null;
  renderAgents();
  focusBox();
}
export async function endRename(keep: boolean): Promise<void> {
  const state = S(),
    r = state.renaming;
  if (!r) return;
  state.renaming = null;
  nameInput = null;
  if (r.kind) return keep ? nameItem(r.g, r.c!, r.value) : redrawNamed();
  const g = state.home!.gatherers.find((x) => x.name === r.g),
    a = g && g.agents.find((x) => x.channel === r.c);
  const text = tidyName(r.value, 120);
  if (r.c === null) return keep && g && text !== titleOf(g) ? keepTitle(r.g, text) : redrawNamed();
  if (!keep || !a || text === ((a.name && a.name.text) || "") || (!text && !r.was)) {
    redrawNamed();
    return;
  }
  const before = a.name;
  a.name = text ? { text, by: "user" } : null; // shown at once; the gatherer's event confirms it (the harness's own back)
  redrawNamed();
  try {
    const got = await post<{ error?: string }>("/api/name", {
      gatherer: r.g,
      channel: r.c,
      name: text,
      harness: a.harness,
      cwd: a.cwd,
    });
    nameAnswers.set(nameKey(r.g, r.c), got);
    if (got.error)
      L.data.setLive(
        `${text ? "Renamed" : "Name removed"} here but not in ${L.helpers.harnessName(a.harness)}: ${got.error}`,
      );
  } catch (err) {
    a.name = before;
    L.data.setLive(`Not named: ${(err as Error).message}`);
  }
  redrawNamed();
}
const TASK_ITEM = "task:";
const APP_ITEM = "app:";
const renamingItem = (gname: string, k: string) => !!S().renaming && S().renaming!.g === gname && S().renaming!.c === k;
/** A task's or an app's item, named: what it is, it, its name now, its name when not named, the user's. */
export type ItemNamed = ["task", Task, string, string, string] | ["app", AppItem, string, string, string];
// a task's or an app's item -> [kind, it, its name now, its name when not named, the user's]; null: no longer here
export function itemNamed(g: Gatherer, k: string): ItemNamed | null {
  if (k.startsWith(TASK_ITEM)) {
    const t = taskById(CTX, g.name, Number(k.slice(TASK_ITEM.length)));
    return t && ["task", t, taskName(CTX, g, t), taskName(CTX, g, { ...t, name: "" }), t.name || ""];
  }
  const o = k.startsWith(APP_ITEM) ? appInfo(g.name, k.slice(APP_ITEM.length)) : null;
  return o && ["app", o, appShown(o), o.title || o.app.label, o.name];
}
export function startItemRename(g: Gatherer, k: string): void {
  const got = itemNamed(g, k);
  if (!got || renamingItem(g.name, k)) return;
  if (S().renaming) void endRename(true);
  S().renaming = { g: g.name, c: k, kind: got[0], value: got[2], auto: got[3], was: got[4] };
  nameInput = null;
  renderAgents();
  focusBox();
}
export async function nameItem(gname: string, k: string, value: string): Promise<void> {
  const g = S().home!.gatherers.find((x) => x.name === gname),
    got = g && itemNamed(g, k);
  const text = tidyName(value, 120);
  if (!got || text === got[2] || (!text && !got[4])) return redrawNamed(); // as it was
  if (got[0] === "task") {
    const it = got[1];
    it.name = text; // shown at once; the answer confirms it
    redrawNamed();
    try {
      takeTasks(await post("/api/tasks", { gatherer: gname, do: "rename", id: it.id, to: text }));
    } catch (e) {
      it.name = got[4];
      L.data.setLive(`Not named: ${(e as Error).message}`);
    }
    return redrawNamed();
  }
  const it = got[1];
  const inst = ((appsKnown.get(gname) || { instances: [] }).instances || []).find((i) => i.id === it.id);
  if (inst) inst.name = text; // shown at once; the apps read again confirm it
  redrawNamed();
  try {
    await post("/api/apps/rename", { gatherer: gname, instance: it.id, name: text });
  } catch (e) {
    if (inst) inst.name = got[4];
    L.data.setLive(`Not named: ${(e as Error).message}`);
  }
  await readApps(gname, true);
  redrawNamed();
}
