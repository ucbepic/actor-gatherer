// The page's state that more than one view reads: what the server streams. For now the old page's stream feeds it
// (src/features/list/seen.ts's takeHome); the stream moves here with the shell (ag_dashboard/DESIGN.md, A6).
import { create } from "zustand";
import type { Home } from "../api/types";

export interface DashboardState {
  home: Home | null;
  setHome: (home: Home | null) => void;
}

export const useDashboard = create<DashboardState>()((set) => ({
  home: null,
  setHome: (home) => set({ home }),
}));
