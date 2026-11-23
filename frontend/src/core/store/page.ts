// The page's own state (core/page/state.ts's `state`): the home it draws from, the actor of its own pane, whether live
// updates are paused, its stream, and what the list has open (a new gatherer's or actor's form, a name or a folder being
// typed, what is starting). One store, so a view in React can follow it; the old page's modules read and write it as
// `state.<field>`, which reads and sets it here.
import { create } from "zustand";
import type { PageFields } from "../page/types";

export const usePage = create<PageFields>()(() => ({
  home: null,
  selected: null,
  paused: false,
  stream: null,
  adding: null,
  renaming: null,
  folderEdit: null,
  starting: null,
}));
