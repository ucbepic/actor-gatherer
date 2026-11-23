// A NEW TAB's page, drawn (new-tab.ts says what it does): into the work area's box for a tab showing nothing, React's --
// the message box as the tab's draft left it, in focus; under it, its line ("In", "Directory", "On": a chip each, its
// drop-down or box a click away: popups.ts's openPop); why nothing started; the apps to open here instead, a terminal,
// and "Apps…"; a hint. Drawn afresh each time the tab comes in sight, its parts again as the home changes.
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { StrokeIcon } from "../../core/ui/Icon";
import { Html } from "../../core/ui/PageNode";
import { L, snap, state } from "./link";
import {
  canAlone,
  ntCwd,
  ntGroup,
  ntHarness,
  ntOpenApp,
  ntPlace,
  ntRun,
  ntSend,
  pickPlace,
  placeName,
  realGroups,
  type Place,
} from "./new-tab";
import { closePop, openPop, popMenu, rowPop, type PopItem } from "./popups";
import { byLabel, opensWithAgent, shortDir } from "./start-rules";
import { noHarness, startShell, startWithApp, startable, tooledOf } from "./starts";
import { DirBox } from "./StartBoxes";
import type { AppManifest } from "./types";
import { workPlacer } from "./work-area";

/** The page drawn: its tab, and the choices made on it (null: as they start), why nothing started, what it is doing. */
export const NT: {
  tab: string;
  place: unknown;
  cwd: string | null;
  harness: string | null;
  error: string;
  busy: string;
} = { tab: "", place: null, cwd: null, harness: null, error: "", busy: "" };
let page: { box: HTMLElement; host: HTMLElement; root: Root } | null = null;
let input: HTMLTextAreaElement | null = null;
let drawn = 0, // each time it comes in sight: its message box made again, from the tab's draft
  sig = "";

/** The page's message box, if it is drawn. */
export const ntInput = (): HTMLTextAreaElement | null => (input && input.isConnected ? input : null);
/** Whether a new tab's page is in sight. */
export const ntShown = (): boolean =>
  !!page && !page.box.hidden && page.box.isConnected && page.host.parentElement === page.box;
export const ntFocus = (): void => {
  const i = ntInput();
  if (i && !i.disabled) i.focus({ preventScroll: true });
};

/** The page, drawn into the work area's box for a tab showing nothing (`tab`, its id): the message box as the tab's draft
 * left it, in focus, and its parts. */
export function drawNewTab(box: HTMLElement, tab: string): void {
  if (snap() || !workPlacer) return;
  if (workPlacer.tabs.shownTab().page === "apps") return L.appsPage.drawAppsPage(box); // the Apps page's tab
  box.classList.remove("ap");
  if (tab !== NT.tab || !ntInput() || !box.contains(input))
    Object.assign(NT, { tab, place: null, cwd: null, harness: null, error: "" });
  if (page?.box !== box) {
    page?.root.unmount();
    const host = Object.assign(document.createElement("div"), { className: "nt-host" });
    host.style.display = "contents";
    page = { box, host, root: createRoot(host) };
  }
  if (page.host.parentElement !== box) box.replaceChildren(page.host);
  box.classList.add("nt");
  drawn++;
  render();
  requestAnimationFrame(() => {
    const i = ntInput();
    if (!i) return;
    L.data.fitBox(i);
    i.focus({ preventScroll: true });
  });
}
/** Its parts drawn again if what they show changed (the home: its groups, folders, harnesses; the apps found), or `now`. */
export function refreshNewTab(now = false): void {
  if (!page || !state.home || !ntShown()) return;
  const p = ntPlace(),
    apps = snap() ? [] : L.appHost.found();
  const next = JSON.stringify([
    p,
    placeName(p),
    startable(),
    ntHarness(),
    ntCwd(p),
    canAlone(),
    NT.busy,
    NT.error,
    state.home.terminals,
    apps.map((a) => [a.name, a.label, !!a.failed]),
  ]);
  if (!now && next === sig) return;
  sig = next;
  render();
}
// drawn at once, as the page draws (its message box made again each time it comes in sight: `drawn`)
function render(): void {
  const root = page?.root;
  if (root) flushSync(() => root.render(<NewTabPage key={`${NT.tab}:${drawn}`} />));
}

function NewTabPage() {
  const tabs = workPlacer!.tabs;
  const say = (t: string) => {
    NT.error = t;
    refreshNewTab(true);
  };
  return (
    <div className="nt-page">
      <div className="nt-ask">
        <textarea
          ref={(n) => {
            if (n) input = n;
          }}
          className="nt-text"
          rows={2}
          placeholder="Message a new actor"
          aria-label="Message a new actor"
          title="Enter to start a new actor · Shift+Enter for a new line"
          enterKeyHint="send"
          spellCheck
          defaultValue={tabs.shownTab().draft}
          disabled={!!NT.busy}
          onInput={(ev) => {
            const box = ev.currentTarget;
            L.data.fitBox(box);
            tabs.setDraft(box.value);
            if (NT.error) say("");
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) {
              ev.preventDefault();
              void ntSend();
            }
          }}
        />
        <div className="nt-line">{state.home ? <Line p={ntPlace()} /> : null}</div>
      </div>
      <div className="nt-err" role="alert">
        {NT.error}
      </div>
      <div className="nt-apps">{state.home ? <Apps p={ntPlace()} /> : null}</div>
      <div className="nt-hint">{`Or click a task in the list to open it here.${keysSaid()}`}</div>
    </div>
  );
}
function keysSaid(): string {
  let app = false;
  try {
    app = !!(window.top as { agApp?: unknown } | null)?.agApp;
  } catch {
    /* not ours */
  }
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  if (app)
    return mac
      ? " ⌘T opens a new tab, ⌘W closes the current one."
      : " Ctrl+T opens a new tab, Ctrl+W closes the current one.";
  return mac ? " ⌃T opens a new tab, ⌃W closes the current one." : "";
}

// a chip of the line: what it is, its value, its drop-down or box a click away (none: it is off)
function Chip(props: {
  pop: string;
  label: string;
  title: string;
  open: ((button: HTMLElement) => void) | null;
  children: ReactNode;
}) {
  const { pop, open } = props;
  return (
    <button
      type="button"
      className="nt-chip"
      data-pop={pop}
      title={props.title}
      aria-haspopup={open ? "menu" : undefined}
      aria-expanded={open ? rowPop.key === pop : undefined}
      disabled={!open}
      onClick={(ev) => {
        if (!open) return;
        if (rowPop.key === pop) return closePop();
        open(ev.currentTarget);
      }}
    >
      <span className="lbl">{props.label}</span>
      {props.children}
      {open ? (
        <span className="caret down" aria-hidden="true">
          ▾
        </span>
      ) : null}
    </button>
  );
}
// a drop-down of the page's: scrolling, if long (many groups and folders)
const ntMenu = (head: string, items: PopItem[]) => popMenu(head, items, null, null, "nt-menu");
const chosen = () => {
  refreshNewTab(true);
  ntFocus();
};
/** "In", "Directory", "On": a chip each. */
function Line({ p }: { p: Place | null }) {
  if (NT.busy) return <span className="nt-busy">{NT.busy}</span>;
  const hs = startable(),
    h = ntHarness(),
    cwd = ntCwd(p);
  const h_ = L.helpers;
  const inTitle = p
    ? p.alone
      ? "On its own · shares context with no group"
      : `Start in ${placeName(p)}`
    : "Make a group first with the folder button at the top of the list";
  return (
    <>
      <Chip
        pop="nt:in"
        label="In"
        title={inTitle}
        open={realGroups().length ? (b) => openPop("nt:in", b, ntMenu("Start in", ntPlaces(p))) : null}
      >
        <span className="val">{placeName(p)}</span>
      </Chip>
      <Chip
        pop="nt:dir"
        label="Directory"
        title={cwd ? `Working directory: ${cwd}` : "Choose a working directory"}
        open={p ? (b) => openPop("nt:dir", b, dirBox(p)) : null}
      >
        <span className="val dir">{shortDir(cwd) || "Choose one"}</span>
      </Chip>
      {hs.length ? (
        <Chip
          pop="nt:on"
          label="On"
          title={`Harness: ${h_.harnessName(h)}`}
          open={
            hs.length > 1
              ? (b) =>
                  openPop(
                    "nt:on",
                    b,
                    ntMenu(
                      "Run on",
                      hs.map((x) => ({
                        mark: h_.harnessBadge(x),
                        text: h_.harnessName(x),
                        note: x === h ? "chosen" : "",
                        run: () => {
                          NT.harness = x;
                          chosen();
                        },
                      })),
                    ),
                  )
              : null
          }
        >
          <Html node={h_.harnessBadge(h)} />
          <span className="val">{h_.harnessName(h)}</span>
        </Chip>
      ) : (
        <span className="nt-none" title={noHarness()}>
          No harness here
        </span>
      )}
    </>
  );
}
/** "In"'s drop-down: each group, its open folders under it, then on its own (when an actor can start so). */
function ntPlaces(p: Place | null): PopItem[] {
  const at = (q: Place) => (JSON.stringify(q) === JSON.stringify(p) ? "chosen" : "");
  const pick = (q: Place) => () => {
    pickPlace(q);
    chosen();
  };
  const icons = L.helpers.ICONS,
    items: PopItem[] = [];
  const folders = (gname: string, id: number | null, depth: number) => {
    const g = realGroups().find((x) => x.name === gname)!;
    for (const f of L.list
      .kidFolders(gname, id)
      .filter((x) => !L.list.shownClosed(g, x))
      .sort((x, y) => L.list.byName(x.name, y.name))) {
      const q: Place = { g: gname, folder: f.id };
      items.push({ icon: icons.folder, text: f.name, note: at(q), depth, run: pick(q) });
      folders(gname, f.id, depth + 1);
    }
  };
  for (const g of realGroups()) {
    const q: Place = { g: g.name, folder: null };
    items.push({ icon: icons.layers, text: L.list.titleOf(g), note: at(q), run: pick(q) });
    folders(g.name, null, 1);
  }
  if (canAlone())
    items.push({
      icon: icons.agent,
      text: "On its own",
      note: at({ alone: true }) || "shares context with no group",
      run: pick({ alone: true }),
    });
  return items;
}
/** "Directory"'s box: the directory typed, the ones the place's actors work in a click away. */
const dirBox = (p: Place) => ({
  box: (
    <DirBox
      dir={ntCwd(p)}
      g={p.alone ? L.groupMoves.everyActor() : ntGroup(p)}
      alone={!!p.alone}
      onUse={(v) => {
        NT.cwd = v;
        closePop();
        chosen();
      }}
    />
  ),
});
/** The apps to open here instead -- each once, in the place's group, filed in its folder if it is a new one; an app that
 * opens with an agent of its own (start-rules.ts's opensWithAgent) started with it, on the harness chosen (or one that
 * can give it their tools) -- a terminal, and "Apps…": the Apps page, to see, install and uninstall them. */
function Apps({ p }: { p: Place | null }) {
  const g = ntGroup(p),
    alone = !!p?.alone,
    off = !p || alone || !!NT.busy;
  const tooled = tooledOf(startable());
  const apps = (snap() ? [] : L.appHost.found()).filter((a) => !a.failed).sort(byLabel); // a group's "+ ⋯" order
  const why = alone ? "Apps open in a group. Pick one under In." : !p ? "Make a group first" : "";
  const folder = p && !p.alone ? p.folder : null;
  const button = (mark: ReactNode, label: string, title: string, run: () => Promise<unknown>) => (
    <button
      key={label}
      type="button"
      className="nt-app"
      title={why || title}
      disabled={off}
      onClick={() => void ntRun(label, run)}
    >
      {mark}
      <span>{label}</span>
    </button>
  );
  const markOf = (a: AppManifest) =>
    a.mark ? (
      <img className="app-mark" src={`/apps/mark/${encodeURIComponent(a.name)}.svg`} alt="" draggable={false} />
    ) : (
      <StrokeIcon d={L.helpers.ICONS.app} size={16} />
    );
  return (
    <>
      <div className="nt-lbl">Or open</div>
      <div className="nt-row">
        {apps.map((a) =>
          !opensWithAgent(a, tooled)
            ? button(markOf(a), a.label, a.description || a.label, () => ntOpenApp(g!, p!, a))
            : button(markOf(a), a.label, `${a.description || a.label} · with its own agent`, () => {
                const h = tooled.includes(ntHarness() || "") ? ntHarness()! : tooled[0];
                L.list.aimStart(g!.name, folder);
                return startWithApp(g!.name, ntCwd(p), a.name, h);
              }),
        )}
        {state.home?.terminals !== false
          ? button(
              <StrokeIcon d={L.helpers.ICONS.terminal} size={16} />,
              "Terminal",
              `Terminal in ${ntCwd(p) || "the chosen directory"}`,
              () => {
                L.list.aimStart(g!.name, folder);
                return startShell(g!.name, ntCwd(p));
              },
            )
          : null}
        <button type="button" className="nt-app manage" title="Manage apps" onClick={() => L.appsPage.openAppsPage()}>
          <StrokeIcon d={L.helpers.ICONS.app} size={16} />
          <span>Apps…</span>
        </button>
      </div>
    </>
  );
}
