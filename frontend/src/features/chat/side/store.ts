// How the files and commands at the left of the Chat view are shown: the reader's choices, kept in this browser -- the
// panel folded to its bar, the kinds of file switched off in its legend, the files in temporary folders and those only
// git changed shown, the background's section opened -- and, for each actor shown, its panel folded or not (the choice
// kept is the last made: an actor shown afresh starts so) and, its pane too narrow for the panel beside the conversation,
// whether it is opened over it (this page's alone). A change draws the panel again; nothing else of the page.
import { create } from "zustand";
import * as prefs from "../../../core/prefs";

const KINDS_KEY = "ag-dashboard-files-hidden-kinds",
  TMP_KEY = "ag-dashboard-files-tmp",
  GIT_KEY = "ag-dashboard-files-git",
  SIDE_KEY = "ag-dashboard-files-side-folded-2", // -2: folded by default
  BG_KEY = "ag-dashboard-files-bg-open";

/** A pane under this many pixels (two side by side, a small window) has no room for the panel beside the conversation:
 * there it starts folded, whatever the choice kept, and opens over the conversation (files-view.css), not beside it --
 * open until folded again or the pane widens; the choice kept is the wide pane's. */
export const NARROW_SIDE = 760;

/** An actor's panel: folded to its bar in a wide pane; its pane too narrow for the panel beside the conversation, and
 * there the panel opened over it. */
export interface Panel {
  folded: boolean;
  narrow: boolean;
  narrowOpen: boolean;
}

export interface SideState {
  /** the kinds of file left out of the tree, its legend's switches: search hits, until switched on */
  hiddenKinds: ReadonlySet<string>;
  showTmp: boolean;
  showGit: boolean;
  /** the panel folded to its bar, in a wide pane: the choice kept, an actor's panel's at first */
  folded: boolean;
  /** the background's section opened */
  bgOpen: boolean;
  /** each actor's panel, by its key */
  panels: Readonly<Record<string, Panel>>;
  switchKind: (kind: string) => void;
  setTmp: (on: boolean) => void;
  setGit: (on: boolean) => void;
  /** actor `key`'s folded to its bar, or opened: in a narrow pane, over the conversation, for now */
  fold: (key: string, fold: boolean) => void;
  openBackground: (open: boolean) => void;
  /** actor `key`'s pane's width now: crossing NARROW_SIDE, the narrow opening forgotten */
  setNarrow: (key: string, narrow: boolean) => void;
}

/** The panel as actor `key`'s Chat draws it: the choices, and its own. */
export type SideOf = Omit<SideState, "panels"> & Panel;

export const useSide = create<SideState>()((set, get) => ({
  hiddenKinds: new Set((prefs.list(KINDS_KEY) as string[] | null) || ["hit"]),
  showTmp: prefs.flag(TMP_KEY),
  showGit: prefs.flag(GIT_KEY),
  folded: prefs.flag(SIDE_KEY, true),
  bgOpen: prefs.flag(BG_KEY),
  panels: {},
  switchKind: (kind) => {
    const hiddenKinds = new Set(get().hiddenKinds);
    if (hiddenKinds.has(kind)) hiddenKinds.delete(kind);
    else hiddenKinds.add(kind);
    prefs.keep(KINDS_KEY, [...hiddenKinds]);
    set({ hiddenKinds });
  },
  setTmp: (showTmp) => {
    prefs.setFlag(TMP_KEY, showTmp);
    set({ showTmp });
  },
  setGit: (showGit) => {
    prefs.setFlag(GIT_KEY, showGit);
    set({ showGit });
  },
  fold: (key, fold) => {
    const p = panelOf(get(), key);
    if (p.narrow) return set({ panels: { ...get().panels, [key]: { ...p, narrowOpen: !fold } } });
    prefs.setFlag(SIDE_KEY, fold);
    set({ folded: fold, panels: { ...get().panels, [key]: { ...p, folded: fold } } });
  },
  openBackground: (bgOpen) => {
    prefs.setFlag(BG_KEY, bgOpen);
    set({ bgOpen });
  },
  setNarrow: (key, narrow) => {
    const p = panelOf(get(), key);
    if (narrow !== p.narrow || !get().panels[key])
      set({ panels: { ...get().panels, [key]: { ...p, narrow, narrowOpen: false } } });
  },
}));

// actor `key`'s panel: as kept, or -- not shown yet -- folded as the choice kept is
const panelOf = (s: SideState, key: string): Panel =>
  s.panels[key] ?? { folded: s.folded, narrow: false, narrowOpen: false };
/** The panel as actor `key`'s Chat draws it. */
export const sideOf = (s: SideState, key: string): SideOf => {
  const { panels, ...rest } = s;
  return { ...rest, ...(panels[key] ?? panelOf(s, key)) };
};
/** The panel as actor `key`'s Chat draws it, drawn again as it changes. */
export const useSideOf = (key: string): SideOf => sideOf(useSide(), key);

/** Whether actor `key`'s panel shows folded to its bar now (or a panel as given). */
export const sideFolded = (s: string | Pick<Panel, "narrow" | "narrowOpen" | "folded">): boolean => {
  const p = typeof s === "string" ? sideOf(useSide.getState(), s) : s;
  return p.narrow ? !p.narrowOpen : p.folded;
};
