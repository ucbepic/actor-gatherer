// STARTING: a gatherer's start buttons, one for each harness a new session can run on here (the server's `harnesses`: in
// ag's config.toml, and installed) -- a click starts one, on the harness's default model, in the directory of the
// gatherer's most recently active actor, or, when no actor has one (or starting there failed), the form asks for the
// directory first, its buttons the same -- then an actor on a branch (Branches.tsx), the apps (StartBoxes.tsx's box for
// one with its agent), a terminal (a shell, in that same directory). What is started is shown at once, in a tab of its
// own, its message box ready.
import { post } from "../../core/api/client";
import { tildePath } from "../../core/ui/highlight";
import { brMenuClose, brMenuOpenFor, openBranchMenu } from "./Branches";
import { openAppTab } from "./app-hooks";
import { appMarkNode, showAppPanel } from "./app-panels";
import { L, renderAgents, snap, state } from "./link";
import { appsOnlyKey, focusedPane, taskKey } from "./open";
import { closePop, openPop, popMenu, rowPop, type PopItem } from "./popups";
import { openBeside, show, viaTabs } from "./show";
import {
  APP_START,
  BRANCH_START,
  SHELL_START,
  byLabel,
  opensWithAgent,
  startCwd,
  startKind,
  withAgentChosen,
} from "./start-rules";
import { appStartBox, railNewBox } from "./StartBoxes";
import type { Folder, Gatherer } from "./types";
import { keptHarness, keptStart } from "./new-tab";

export { APP_START, BRANCH_START, SHELL_START, byLabel, opensWithAgent, startCwd };
export { cwdOf } from "./start-rules";

/** The harnesses a new actor can run on here. */
export const startable = (): string[] => (state.home?.harnesses || []).filter((h) => L.helpers.runsHere(h));
export const noHarness = (): string =>
  `None of ${L.helpers.runnableNames("or")} is set up. Install one, or set its command under [cli.harnesses] in config.toml.`;
/** The harnesses that can give an app's agent its tools. */
export const tooledOf = (hs: string[]): string[] => hs.filter((h) => L.helpers.harnessInfo(h)?.mcp);
/** The apps offered (each once, by its label), and those that open with an agent of their own (which the list's form for
 * a new actor also offers on each harness). */
const openableApps = () => (snap() ? [] : L.appHost.found()).filter((a) => !a.failed).sort(byLabel);
export const startingApps = () => openableApps().filter(withAgentChosen);
const where = (g: Gatherer) => {
  const cwd = startCwd(g);
  return cwd ? tildePath(cwd, state.home?.home_dir) : null;
};

/** What a start button's value starts: a terminal, an app with its agent, an actor. */
export function startAny(gatherer: string, cwd: string, harness: string): Promise<unknown> {
  const s = startKind(harness);
  return s.kind === "shell"
    ? startShell(gatherer, cwd)
    : s.kind === "app"
      ? startWithApp(gatherer, cwd, s.app, s.harness)
      : startSession(gatherer, cwd, harness);
}

/** What the list's "+" holds (a gatherer row's, or a folder's line's, `folder`: what it starts goes in it): ONE "+",
 * everything that can start here, in one menu -- an actor on each harness, then an actor on a branch, the apps, a
 * terminal (moreStarts) -- headed by where (the folder, else the group) and its directory. Pressed, it aims what is
 * started next at its folder, or its gatherer's top (the list's aimStart). With nothing to start, its title says why. */
export function startMenu(g: Gatherer, folder: Folder | null = null) {
  const hs = startable(),
    dir = where(g);
  const fid = folder ? folder.id : null,
    place = folder ? folder.name : g.name,
    at = folder ? `:${fid}` : "";
  const ours = !!state.starting && state.starting.gatherer === g.name;
  const startIn = L.list.startIn;
  const starting = ours && startIn.g === g.name && startIn.folder === fid ? String(state.starting!.harness) : "";
  const key = `start:${g.name}${at}`;
  const items: PopItem[] = [
    ...hs.map((h) => ({
      mark: L.helpers.harnessBadge(h),
      text: L.helpers.harnessName(h),
      run: () => void addSession(g, h),
    })),
    ...(hs.length ? [{ sep: true, text: "", run: () => {} }] : []),
    ...moreStarts(g, hs, dir, key),
  ];
  const busy =
    hs.includes(starting) || starting === SHELL_START || starting === BRANCH_START || starting.startsWith(APP_START);
  if (!items.some((it) => !it.sep))
    return { key, busy: false, off: true, title: noHarness(), label: noHarness(), head: "", items: [] };
  return {
    key,
    busy,
    off: !!state.starting,
    title: `New in ${place}${dir ? ` · ${dir}` : ""}`,
    label: `New in ${place}`,
    head: `New in ${place}`,
    sub: dir,
    items,
  };
}
/** The "+ more" drop-down's starts: what each is (an app by its name and mark alone, no description under it; a branch and
 * a terminal say where they work), and what choosing it does. `key`: its button's data-pop. */
function moreStarts(g: Gatherer, hs: string[], dir: string | null, key = `more:${g.name}`): PopItem[] {
  const there = dir ? `in ${dir}` : "in a directory you choose";
  const tooled = tooledOf(hs);
  const icons = L.helpers.ICONS;
  const items: (PopItem | null)[] = [
    hs.length
      ? {
          icon: icons.branch,
          text: "Actor on a branch…",
          note: "in its own worktree, merged into the project",
          run: (button) => openBranchMenu(g, button),
        }
      : null,
    ...openableApps().map((a): PopItem => ({
      icon: icons.app,
      mark: a.mark ? appMarkNode(a) : null,
      ...(opensWithAgent(a, tooled)
        ? { text: `${a.label}…`, run: (button: HTMLElement) => openPop(key, button, appStartBox(g, tooled, a)) }
        : { text: a.label, run: () => void openAppTab(g.name, a.name, startCwd(g)) }),
    })),
    // (where it opens: the menu's heading says it)
    state.home?.terminals !== false
      ? { icon: icons.terminal, text: "Terminal", note: dir ? null : there, run: () => void addSession(g, SHELL_START) }
      : null,
  ];
  return items.filter((x): x is PopItem => !!x);
}
// `key`: the button's data-pop (the rail's "+"); `start`: what a harness chosen does; `place`: the folder it starts in,
// named in its heading (else the group's)
function openActorMenu(
  g: Gatherer,
  hs: string[],
  button: HTMLElement,
  key: string,
  start: (h: string) => void,
  place: string | null,
) {
  const dir = where(g) || "";
  // headed by where it goes -- the folder, else the group, as the "+ ⋯" menu's -- its directory under that
  openPop(
    key,
    button,
    popMenu(
      `New actor in ${place || L.list.titleOf(g)}`,
      hs.map((h) => ({ mark: L.helpers.harnessBadge(h), text: L.helpers.harnessName(h), run: () => start(h) })),
      dir,
      dir,
    ),
  );
}
function openMoreMenu(g: Gatherer, hs: string[], button: HTMLElement, key: string, place: string): void {
  if (brMenuOpenFor(g.name)) return brMenuClose(); // the branch drop-down it opened: pressed again
  const dir = where(g);
  openPop(key, button, popMenu(`New in ${place}`, moreStarts(g, hs, dir, key), dir, dir));
}

// The "+ actor" and "+ ⋯" of a gatherer's or a folder's card in the rail (the list's CardFolder; `f` null: the gatherer's
// top): what each says (cardStart), and what a press does (cardStartPress). "+ actor": a new actor there, as the list's
// "+ actor" starts one -- on the one harness at once, or on the one picked from a drop-down -- in the directory of its
// gatherer's most recently active actor. With none (or starting there failed), a box under it asks for the directory
// first (railNewBox): the list's form, under its gatherer's row, is out of sight with the list folded. Pressed again, what
// it opened closes. "+ ⋯": the list's "+ more" drop-down, under it.
const railKey = (g: Gatherer, f: Folder | null = null) => `rail:${g.name}${f ? `:${f.id}` : ""}`;
const railMoreKey = (g: Gatherer, f: Folder | null = null) => `railmore:${g.name}${f ? `:${f.id}` : ""}`;
export function cardStart(which: "new" | "more", g: Gatherer, f: Folder | null = null) {
  const hs = startable(),
    place = f ? f.name : L.list.titleOf(g),
    off = !!state.starting;
  if (which === "more") {
    const key = railMoreKey(g, f),
      others = moreStarts(g, hs, null, key);
    if (!others.length) return null;
    return {
      key,
      disabled: off,
      busy: false,
      label: `More to start in ${place}`,
      haspopup: "menu",
      expanded: rowPop.key === key,
      title: `More to start in ${place}: ${others.map((o) => o.text.replace("…", "").toLowerCase()).join(", ")}`,
    };
  }
  if (!hs.length)
    return {
      key: null,
      disabled: true,
      busy: false,
      title: noHarness(),
      label: noHarness(),
      haspopup: null,
      expanded: null,
    };
  const key = railKey(g, f),
    cwd = startCwd(g),
    dir = where(g);
  const busy =
    !!state.starting &&
    state.starting.gatherer === g.name &&
    L.list.startIn.folder === (f ? f.id : null) &&
    hs.includes(String(state.starting.harness));
  const pops = hs.length > 1 || !cwd;
  return {
    key,
    disabled: off,
    busy,
    label: `New actor in ${place}`,
    title: `New actor in ${place}${dir ? ` · ${dir}` : ""} · ${hs.map((h) => L.helpers.harnessName(h)).join(" or ")}`,
    haspopup: pops ? (cwd ? "menu" : "dialog") : null,
    expanded: pops ? rowPop.key === key : null,
  };
}
export function cardStartPress(which: "new" | "more", g: Gatherer, f: Folder | null, button: HTMLElement): void {
  const hs = startable(),
    place = f ? f.name : L.list.titleOf(g);
  if (which === "more") {
    L.list.aimStart(g.name, f ? f.id : null);
    openMoreMenu(g, hs, button, railMoreKey(g, f), place);
    return;
  }
  const key = railKey(g, f),
    cwd = startCwd(g);
  if (rowPop.key === key) return closePop();
  L.list.aimStart(g.name, f ? f.id : null);
  if (!cwd) openPop(key, button, railNewBox(g, hs));
  else if (hs.length > 1) openActorMenu(g, hs, button, key, (h) => void railStart(g, h, key), f ? place : null);
  else void railStart(g, hs[0], key);
}
async function railStart(g: Gatherer, harness: string, key = railKey(g)): Promise<void> {
  const cwd = startCwd(g);
  try {
    await startSession(g.name, cwd, harness);
  } catch (e) {
    const button = document.querySelector<HTMLElement>(`[data-pop="${CSS.escape(key)}"]`);
    if (button) openPop(key, button, railNewBox(g, startable(), harness, cwd, (e as Error).message));
    else L.data.setLive(`Not started: ${(e as Error).message}`);
  }
}

/** A new actor in `g` on `harness` in its latest directory -- or, with none (or starting there failed), the list's form
 * for it, in sight, asking. */
async function addSession(g: Gatherer, harness: string): Promise<unknown> {
  const cwd = startCwd(g);
  if (harness && cwd) {
    try {
      return await startAny(g.name, cwd, harness);
    } catch (e) {
      state.adding = { gatherer: g.name, cwd, harness, error: (e as Error).message };
    }
  } else state.adding = { gatherer: g.name, cwd, harness };
  if (L.modes.listMode === "folded") L.modes.setListMode("list"); // its form is the list's: in sight
  renderAgents();
  document.querySelector<HTMLInputElement>(".newform input")?.focus();
}
// the box of the pane in focus, once what was started is shown
const focusBox = () => L.paneView.paneBox(focusedPane())?.focus();

/** The new session shown in Chat, its message box ready: its agent starts with its first message. Listed before it is
 * shown: drawn at once, the box there to take the focus. `join`, for one added to a task (the list's addToTask): what
 * puts it there, once started -- and it shown beside the actor it was added to, the rest as any other's. `alone`: an
 * actor on its own from its start, run under `gatherer` (the list's aloneNew): filed in no folder, listed as its group of
 * one. Where it started kept for the next new tab (new-tab.ts's keptStart), but for one added to a task. -> the session. */
export async function startSession(
  gatherer: string,
  cwd: string,
  harness: string,
  join: ((s: { session_id: string }) => Promise<void>) | null = null,
  alone = false,
): Promise<{ session_id: string; gatherer: string }> {
  state.starting = { gatherer: alone ? L.groupMoves.ALONE_NEW : gatherer, harness };
  renderAgents();
  let s: { session_id: string; gatherer: string };
  try {
    s = await post("/api/sessions", { gatherer, cwd, harness, ...(alone ? { alone: true } : {}) });
    if (!join) {
      keptStart(gatherer, alone);
      keptHarness(harness);
    }
    if (join) await join(s);
    else if (!alone) await L.list.fileStarted(gatherer, s.session_id);
    state.adding = null;
    L.list.collapsed.delete(s.gatherer);
    await L.data.loadHome();
    if (join && state.selected && !appsOnlyKey()) await openBeside(s.gatherer, s.session_id, "files");
    else {
      await viaTabs(taskKey(s.gatherer, s.session_id), {}); // a tab of its own
      await show(s.gatherer, s.session_id, "files");
    }
  } finally {
    state.starting = null;
    renderAgents();
  }
  focusBox();
  return s;
}
/** One of an app with an agent of its own started (app_agents.py's `start`): its actor listed and shown, its panel above. */
export async function startWithApp(gatherer: string, cwd: string | null, name: string, harness: string): Promise<void> {
  state.starting = { gatherer, harness: `${APP_START}${name}:${harness}` };
  renderAgents();
  try {
    const got = await L.appHost.start(name, gatherer, cwd, harness);
    keptStart(gatherer);
    await L.list.fileStarted(gatherer, got.session.session_id);
    state.adding = null;
    L.list.collapsed.delete(gatherer);
    await L.data.loadHome();
    await viaTabs(taskKey(gatherer, got.session.session_id), {}); // a tab of its own
    await show(gatherer, got.session.session_id, "files");
    const app = L.appHost.named(name);
    if (app) showAppPanel(app, got.instance);
  } finally {
    state.starting = null;
    renderAgents();
  }
}
/** A shell started: shown in the pane in focus, its terminal opened at once (sessions.py's `shell`), at the size of the
 * terminal this page draws now, if it draws one (fitted to its pane once drawn there). */
export async function startShell(gatherer: string, cwd: string): Promise<void> {
  state.starting = { gatherer, harness: SHELL_START };
  renderAgents();
  try {
    const shown = focusedPane(),
      t = shown && shown.c ? L.terminal.termOf(shown.c) : null; // the terminal the pane in focus draws
    const size = t && t.opened && t.host.isConnected ? { cols: t.xterm.cols, rows: t.xterm.rows } : {};
    const folder = L.list.shellFolder(gatherer); // opened in the folder aimed at, listed there
    const s = await post<{ id: string }>("/api/shells", {
      gatherer,
      cwd,
      ...size,
      ...(folder !== null ? { folder } : {}),
    });
    keptStart(gatherer, false, folder);
    state.adding = null;
    L.list.collapsed.delete(gatherer);
    await L.data.loadHome(); // listed before it is shown: its pane's head says where it is
    await show(gatherer, s.id);
  } finally {
    state.starting = null;
    renderAgents();
  }
}
