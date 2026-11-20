// The list's state in React (AgentList.tsx draws it): its view-model, as the page made it at its last draw (features/list/
// list.js's renderAgents: model.ts's buildList, from the home and what is shown), and what the list calls of the page.
import { create } from "zustand";
import type { ListHost } from "./host";
import type { ListModel } from "./rows";

interface ListState {
  model: ListModel | null;
  host: ListHost | null;
}

export const useList = create<ListState>()(() => ({ model: null, host: null }));
