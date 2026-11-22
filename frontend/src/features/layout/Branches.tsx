// AN ACTOR ON A BRANCH of its own (branches.py): made from one of the gatherer's PROJECTS -- the git repositories set for
// it, each a clone here -- in a worktree beside it, on a new branch from its last commit; what it changes there merged into
// the project's folder (the one the Editor shows) as it changes it, but for the lines being edited in the Editor (its
// conflict zone) and those the project changed too, which wait for the reader -- and, with "auto-merge with approval",
// every change waits (kept in this browser, as the last choice). Its button opens a drop-down of the gatherer's sources
// (its projects) and "Add a source…" -- Radix's DropdownMenu, hung from the button that opened it -- either opening the
// popup to start it from: Radix's Dialog, the page's <dialog> look (.br-dialog), over the page on its backdrop (.mg-dim).
import * as D from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { get, post } from "../../core/api/client";
import { plural } from "../../core/format";
import * as prefs from "../../core/prefs";
import { StrokeIcon } from "../../core/ui/Icon";
import { tildePath } from "../../core/ui/highlight";
import { Html } from "../../core/ui/PageNode";
import { actorDirs, branchOf, branchRoute, branchWaiting, checkedOut, projectName } from "./branch-model";
import { L, renderAgents, state } from "./link";
import { focusedPane, taskKey } from "./open";
import { show, viaTabs } from "./show";
import { BRANCH_START } from "./start-rules";
import { noHarness, startable } from "./starts";
import type { Actor, Gatherer, Project } from "./types";

const BRANCH_APPROVE_KEY = "ag-branch-approve";

/** An actor's branch, on its row in the list: where it goes, and the changes waiting for the reader. */
export function branchChip(g: Gatherer, a: Actor): HTMLElement | null {
  const b = branchOf(state.home?.branches, g.name, a.channel);
  if (!b) return null;
  const n = branchWaiting(b),
    el = L.helpers.el;
  return el(
    "div",
    {
      class: "branchline",
      title:
        branchRoute(b, state.home?.home_dir) + (n ? `\n${plural(n, "change")} to approve in the LaTeX editor` : ""),
    },
    L.helpers.strokeIcon(L.helpers.ICONS.branch, 11),
    el("span", { class: "rt", text: `${b.branch} → ${checkedOut(b.onto)}` }),
    n ? el("span", { class: "wait", text: `${n} to approve` }) : null,
  );
}

/** What the picker shows: the drop-down (its group, the button it hangs from, whether its sources are read yet) and the
 * popup (its group, the source chosen, or the choosing of one, what is typed, why it failed, whether it is busy, the
 * approval asked); the group's sources, those its actors work in, and where they were looked for. */
interface Picker {
  menu: { g: string; anchor: HTMLElement; loading: boolean; error: string } | null;
  dialog: { g: string; project: string; choosing: boolean; where: string; error: string; busy: boolean } | null;
  approve: boolean;
  projects: Project[];
  suggestions: Project[];
  dirs: string[];
}
const usePicker = create<Picker>()(() => ({
  menu: null,
  dialog: null,
  approve: false,
  projects: [],
  suggestions: [],
  dirs: [],
}));
let root: Root | null = null;
// the picker's place on the page, made at its first use
function draw(): void {
  if (root) return;
  const node = document.createElement("div");
  node.className = "br-pick";
  document.body.append(node);
  root = createRoot(node);
  flushSync(() => root!.render(<BranchPicker />));
}
const setDialog = (d: Partial<NonNullable<Picker["dialog"]>>) =>
  usePicker.setState((s) => (s.dialog ? { dialog: { ...s.dialog, ...d } } : {}));

async function load(g: Gatherer): Promise<void> {
  const dirs = actorDirs(g, state.home?.cwd);
  usePicker.setState({ dirs });
  const got = await get<{ projects: Project[]; suggestions: Project[] }>(
    `/api/projects?${new URLSearchParams({ gatherer: g.name, dirs: JSON.stringify(dirs) })}`,
  );
  usePicker.setState({ projects: got.projects, suggestions: got.suggestions });
}
/** Whether the drop-down is open for group `g` (its button pressed again closes it). */
export const brMenuOpenFor = (g: string): boolean => usePicker.getState().menu?.g === g;
/** The drop-down closed, its button told. */
export function brMenuClose(): void {
  const m = usePicker.getState().menu;
  if (!m) return;
  flushSync(() => usePicker.setState({ menu: null }));
  m.anchor.setAttribute("aria-expanded", "false");
}
/** The drop-down of `g`'s sources, hung from `button`: pressed again, closed. */
export async function openBranchMenu(g: Gatherer, button: HTMLElement): Promise<void> {
  if (brMenuOpenFor(g.name)) return brMenuClose();
  brMenuClose();
  draw();
  const menu = { g: g.name, anchor: button, loading: true, error: "" };
  flushSync(() => usePicker.setState({ menu }));
  button.setAttribute("aria-expanded", "true");
  let error = "";
  try {
    await load(g);
  } catch (e) {
    error = (e as Error).message;
  }
  if (usePicker.getState().menu !== menu) return;
  usePicker.setState({ menu: { ...menu, loading: false, error } });
}
/** The popup: the source (chosen in the drop-down, or here -- among the gatherer's, the repositories its actors work in,
 * or a folder or GitHub repository typed), where the branch comes from and where its changes go, whether each change
 * waits for approval (the last choice, kept in this browser), and the harness that starts it. */
export function openBranchDialog(g: Gatherer, project: string | null): void {
  draw();
  usePicker.setState({
    approve: prefs.flag(BRANCH_APPROVE_KEY),
    dialog: { g: g.name, project: project || "", choosing: !project, where: "", error: "", busy: false },
  });
}
// sources added or removed: the group's as the server has them then, the one added chosen
async function sources(body: Record<string, unknown>): Promise<void> {
  const d = usePicker.getState().dialog;
  if (!d) return;
  setDialog({ busy: true, error: "" });
  try {
    const { projects, dirs } = usePicker.getState();
    const had = new Set(projects.map((p) => p.path));
    const got = await post<{ projects: Project[]; suggestions: Project[] }>("/api/projects", {
      gatherer: d.g,
      dirs,
      ...body,
    });
    usePicker.setState({ projects: got.projects, suggestions: got.suggestions });
    const added = got.projects.find((p) => !had.has(p.path));
    if (added) setDialog({ project: added.path, where: "", choosing: false });
    const now = usePicker.getState().dialog;
    if (now && !got.projects.some((p) => p.path === now.project)) setDialog({ project: "", choosing: true });
  } catch (e) {
    setDialog({ error: (e as Error).message });
  }
  setDialog({ busy: false });
}
async function startBranch(gatherer: string, project: string, harness: string, approve: boolean): Promise<void> {
  state.starting = { gatherer, harness: BRANCH_START };
  renderAgents();
  try {
    const s = await post<{ gatherer: string; session_id: string }>("/api/branches", {
      gatherer,
      project,
      harness,
      approve,
    });
    await L.list.fileStarted(gatherer, s.session_id);
    state.adding = null;
    L.list.collapsed.delete(s.gatherer);
    await L.data.loadHome();
    await viaTabs(taskKey(s.gatherer, s.session_id), {}); // a tab of its own
    await show(s.gatherer, s.session_id, "files");
  } finally {
    state.starting = null;
    renderAgents();
  }
  L.paneView.paneBox(focusedPane())?.focus();
}

function BranchPicker() {
  const menu = usePicker((s) => s.menu),
    dialog = usePicker((s) => s.dialog);
  return (
    <>
      {menu ? <BranchMenu key={menu.g} menu={menu} /> : null}
      <D.Root open={!!dialog} onOpenChange={(open) => !open && usePicker.setState({ dialog: null })}>
        <D.Portal>
          <D.Overlay className="mg-dim">{dialog ? <BranchDialog d={dialog} /> : null}</D.Overlay>
        </D.Portal>
      </D.Root>
    </>
  );
}

// the anchor's place, for a trigger of Radix's laid over it (it never takes a press: the page's button does)
function over(anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  return {
    position: "fixed" as const,
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    pointerEvents: "none" as const,
    visibility: "hidden" as const,
  };
}
function BranchMenu({ menu }: { menu: NonNullable<Picker["menu"]> }) {
  const projects = usePicker((s) => s.projects);
  const content = useRef<HTMLDivElement>(null);
  const esc = useRef(false);
  const g = menu.g;
  // closed as the page resizes or scrolls: it no longer hangs where it should
  useEffect(() => {
    window.addEventListener("resize", brMenuClose);
    window.addEventListener("scroll", brMenuClose, true);
    return () => {
      window.removeEventListener("resize", brMenuClose);
      window.removeEventListener("scroll", brMenuClose, true);
    };
  }, []);
  // its first choice in focus once the sources are read
  useEffect(() => {
    if (!menu.loading) content.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [menu.loading]);
  const pick = (p: Project | null) => () => {
    const gg = state.home?.gatherers.find((x) => x.name === menu.g);
    brMenuClose();
    if (gg) openBranchDialog(gg, p ? p.path : null);
  };
  const home = state.home?.home_dir;
  const head = menu.loading
    ? "Loading sources…"
    : menu.error || (projects.length ? "New actor on a branch of" : "No sources yet");
  return (
    <Menu.Root
      modal={false}
      open
      onOpenChange={(open) => {
        if (open) return;
        brMenuClose();
        if (esc.current && menu.anchor.isConnected) menu.anchor.focus();
      }}
    >
      <Menu.Trigger asChild>
        <span aria-hidden="true" style={over(menu.anchor)} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          ref={content}
          className="br-menu"
          aria-label={`New actor on a branch, in ${g}`}
          aria-labelledby={undefined}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          style={{ position: "relative" }}
          onCloseAutoFocus={(ev) => ev.preventDefault()}
          onEscapeKeyDown={(ev) => {
            ev.stopPropagation(); // the menu's Esc, not the list's too
            esc.current = true;
          }}
          onPointerDownOutside={(ev) => {
            // its own button: not a press away -- the button's click opens or closes it
            if (ev.target instanceof Node && menu.anchor.contains(ev.target)) ev.preventDefault();
          }}
          onFocusOutside={(ev) => ev.preventDefault()}
        >
          <div className="hd">{head}</div>
          {menu.loading
            ? null
            : projects.map((p) => (
                <Menu.Item key={p.path} asChild onSelect={pick(p)}>
                  <button type="button" title={`${p.path}${p.remote ? "\n" + p.remote : ""}`}>
                    <span className="nm">{projectName(p)}</span>
                    <span className="on">{checkedOut(p)}</span>
                    <span className="at">{tildePath(p.path, home)}</span>
                  </button>
                </Menu.Item>
              ))}
          {!menu.loading && projects.length ? <Menu.Separator className="sep" /> : null}
          {menu.loading ? null : (
            <Menu.Item asChild onSelect={pick(null)}>
              <button type="button" className="add">
                + Add a source…
              </button>
            </Menu.Item>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

const icon = (name: string, size: number): ReactNode => <StrokeIcon d={L.helpers.ICONS[name]} size={size} />;
function BranchDialog({ d }: { d: NonNullable<Picker["dialog"]> }) {
  const { projects, suggestions, approve } = usePicker();
  const home = state.home?.home_dir;
  const hs = startable();
  const chosen = projects.find((p) => p.path === d.project);
  const close = () => usePicker.setState({ dialog: null });
  const choosing = d.choosing || !chosen;
  const add = () => {
    if (d.where.trim()) void sources({ add: d.where.trim() });
  };
  const ready = !!chosen && !d.choosing && !d.busy && !state.starting;
  const source = choosing ? (
    <>
      {projects.length ? (
        <div className="projects">
          <div className="lbl">{`${d.g}'s sources`}</div>
          {projects.map((p) => (
            <div key={p.path} className={"br-row" + (p.path === d.project ? " on" : "")}>
              <button
                type="button"
                className="use"
                title={p.path}
                disabled={d.busy}
                onClick={() => setDialog({ project: p.path, choosing: false, error: "" })}
              >
                <span className="nm">{projectName(p)}</span>
                <span className="at">{tildePath(p.path, home)}</span>
                <span className="on">{checkedOut(p)}</span>
              </button>
              <button
                type="button"
                className="rm"
                title={`Remove from ${d.g}'s sources. Existing branches are kept.`}
                aria-label={`Remove ${projectName(p)}`}
                disabled={d.busy}
                onClick={() => void sources({ remove: p.path })}
              >
                {icon("x", 14)}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {suggestions.length ? (
        <div className="projects">
          <div className="lbl">Where its actors work</div>
          {suggestions.map((p) => (
            <button
              key={p.path}
              type="button"
              className="suggest"
              title={`${p.path}${p.remote ? "\n" + p.remote : ""}`}
              disabled={d.busy}
              onClick={() => void sources({ add: p.path })}
            >
              <span>{`+ ${projectName(p)}`}</span>
              <span className="at">{tildePath(p.path, home)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="projects br-add">
        <div className="lbl">Another source</div>
        <div className="addrow">
          <input
            value={d.where}
            placeholder="a folder in a git repository, or owner/repo"
            spellCheck={false}
            aria-label="A folder in a git repository, or a GitHub repository"
            onChange={(ev) => setDialog({ where: ev.target.value })}
            onKeyDown={(ev) => {
              if (ev.key !== "Enter") return;
              ev.preventDefault();
              add();
            }}
          />
          <button type="button" disabled={d.busy} onClick={add}>
            {d.busy ? "Adding…" : "Add"}
          </button>
        </div>
        <div className="desc">A GitHub repository with no clone here is cloned under ag's home.</div>
      </div>
    </>
  ) : (
    <div className="br-src">
      <div className="top">
        <span className="nm">{projectName(chosen)}</span>
        <span className="at" title={chosen.path}>
          {tildePath(chosen.path, home)}
        </span>
        <button type="button" className="link" onClick={() => setDialog({ choosing: true })}>
          Change
        </button>
      </div>
      <div className="desc route">
        A new branch off <code>{checkedOut(chosen)}</code>
        {` at ${chosen.head || "?"}, merged into `}
        <code>{tildePath(chosen.path, home)}</code> on <code>{checkedOut(chosen)}</code>.
      </div>
    </div>
  );
  return (
    <D.Content
      asChild
      aria-describedby={undefined}
      // its first box in focus: a source's, while one is chosen; else its first start
      onOpenAutoFocus={(ev) => {
        ev.preventDefault();
        const box = ev.currentTarget as HTMLElement;
        box.querySelector<HTMLElement>(choosing ? ".br-add input" : "button[type=submit]")?.focus();
      }}
    >
      <dialog open className="br-dialog" aria-label="New actor on a branch">
        <form
          className="newform"
          method="dialog"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!chosen || d.choosing) return;
            const submitter = (ev.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            const harness = submitter ? submitter.value : hs[0];
            setDialog({ busy: true });
            try {
              await startBranch(d.g, chosen.path, harness, approve);
              close();
            } catch (e) {
              setDialog({ error: (e as Error).message, busy: false });
            }
          }}
        >
          <div className="br-title">
            <D.Title asChild>
              <h3>
                {icon("branch", 15)}
                New actor on a branch
              </h3>
            </D.Title>
            <button type="button" className="x" aria-label="Close" onClick={close}>
              {icon("x", 16)}
            </button>
          </div>
          <div className="desc">{`In ${d.g}. Works in its own worktree on a new branch from the source's last commit. Its changes are merged into the source's folder as it makes them.`}</div>
          <div className="lbl">Source</div>
          {source}
          <label
            className="check"
            title="When off, changes merge as they come. Lines you're editing in the LaTeX editor, or also changed, wait for you."
          >
            <input
              type="checkbox"
              checked={approve}
              onChange={(ev) => {
                usePicker.setState({ approve: ev.target.checked });
                prefs.setFlag(BRANCH_APPROVE_KEY, ev.target.checked);
              }}
            />
            <span>
              <b>Auto-merge with approval</b>: accept or reject each change in the LaTeX editor
            </span>
          </label>
          <div className="err" role="alert">
            {d.error || (hs.length ? "" : noHarness())}
          </div>
          <div className="row">
            <button type="button" onClick={close}>
              Cancel
            </button>
            {hs.map((h) => (
              <button key={h} type="submit" value={h} disabled={!ready}>
                <Html node={L.helpers.harnessBadge(h)} />
                {L.helpers.harnessName(h)}
              </button>
            ))}
          </div>
        </form>
      </dialog>
    </D.Content>
  );
}
