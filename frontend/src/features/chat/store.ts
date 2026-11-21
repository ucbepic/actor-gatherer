// The Chat view's own state, kept across the page's draws and across views: which latest replies a click folded, which
// turns show all their earlier messages, the turns before the latest a click showed or folded against the setting, the
// first turn drawn, and the turn last brought into view; the file picked in the turn's files, and the folders folded in
// their tree. Each actor's its own (`foldsOf`: every pane on the page shows its own actor's Chat): they start over when
// the pane's files feed does (`files`, made anew each time the pane is given the actor), as they did when they were kept
// in it. A change here draws that actor's Chat again (ChatMain.tsx reads it), nothing else of the page.
import { create, createStore, useStore, type StoreApi } from "zustand";

/** The latest turns drawn at first; and how many more each pull up past the top draws. */
export const TURNS_SHOWN = 5,
  TURNS_MORE = 5;

export interface Folds {
  /** the latest replies folded by a click, by their ids */
  closed: ReadonlySet<string>;
  /** the turns whose earlier messages are all shown */
  opened: ReadonlySet<number>;
  /** the turns before the latest a click showed (true) or folded */
  flips: ReadonlyMap<number, boolean>;
  /** the first turn drawn: the latest few at first; then where the reader pulled it to, or the turn they picked */
  first: number | null;
  /** the file picked in the turn's files, shown beside the conversation; the folders folded in their tree */
  sel: string | null;
  dirs: ReadonlySet<string>;
}

interface TurnsState extends Folds {
  /** the page's files feed the folds are of */
  files: object | null;
  /** the turn last brought into view ("<actor's key>:<turn>"): once each time one is shown, the latest or one picked */
  shown: string | null;
  /** the folds of this files feed: started over for another */
  forFiles: (files: object) => void;
  /** a latest reply folded or opened by a click */
  fold: (id: string, open: boolean) => void;
  /** a turn's earlier messages all shown, or folded behind its + again */
  toggleOpened: (n: number) => void;
  /** a turn before the latest shown whole or folded by a click: kept so, until a click puts it back as the setting has it */
  flip: (n: number, whole: boolean, atFirst: boolean) => void;
  /** the setting picked again: every turn as it has them */
  clearFlips: () => void;
  setFirst: (first: number) => void;
  setShown: (at: string | null) => void;
  /** a file picked, or none */
  pick: (path: string | null) => void;
  /** a folder of the tree folded, or opened again */
  foldDir: (path: string) => void;
}

const fresh = (): Folds => ({
  closed: new Set(),
  opened: new Set(),
  flips: new Map(),
  first: null,
  sel: null,
  dirs: new Set(),
});

const makeFolds = () =>
  createStore<TurnsState>()((set, get) => ({
    ...fresh(),
    files: null,
    shown: null,
    forFiles: (files) => {
      if (get().files !== files) set({ ...fresh(), files });
    },
    fold: (id, open) =>
      set((st) => {
        const closed = new Set(st.closed);
        if (open) closed.delete(id);
        else closed.add(id);
        return { closed };
      }),
    toggleOpened: (n) =>
      set((st) => {
        const opened = new Set(st.opened);
        if (opened.has(n)) opened.delete(n);
        else opened.add(n);
        return { opened };
      }),
    flip: (n, whole, atFirst) =>
      set((st) => {
        const flips = new Map(st.flips);
        if (!whole === atFirst) flips.delete(n);
        else flips.set(n, !whole);
        return { flips };
      }),
    clearFlips: () => set({ flips: new Map() }),
    setFirst: (first) => set({ first }),
    setShown: (shown) => set({ shown }),
    pick: (sel) => set({ sel }),
    foldDir: (path) =>
      set((st) => {
        const dirs = new Set(st.dirs);
        if (dirs.has(path)) dirs.delete(path);
        else dirs.add(path);
        return { dirs };
      }),
  }));

const folds = new Map<string, StoreApi<TurnsState>>();
/** Actor `key`'s Chat state (made the first time it is asked for). */
export function foldsOf(key: string): StoreApi<TurnsState> {
  let s = folds.get(key);
  if (!s) folds.set(key, (s = makeFolds()));
  return s;
}
/** Actor `key`'s Chat state, drawn again as it changes. */
export const useFoldsOf = (key: string): TurnsState => useStore(foldsOf(key));
/** The setting "Chat's earlier turns" picked again: every actor's turns as it has them. */
export function clearFlips(): void {
  for (const s of folds.values()) s.getState().clearFlips();
}

/** The actors whose frames are on the page now (mount.tsx): each pane's that shows Chat. One kept drawn off the page
 * stays as it was until shown again. */
export const useOnPage = create<{ keys: ReadonlySet<string> }>()(() => ({ keys: new Set<string>() }));
export const onPage = (key: string): boolean => useOnPage.getState().keys.has(key);

/** When this page first drew each turn opening (Pending.tsx's `seeing`), by the actor and its send: it grows in from then,
 * and the turn stored in its place goes on growing from there. */
export const turnsSeen = new Map<string, number>();
