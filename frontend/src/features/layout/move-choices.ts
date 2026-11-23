// What a panel's menu (its head right-clicked, moves.ts) offers, worked out from where it can go (work.ts's Moves): each
// side of its task's block it can go along, each panel whose place it can take, each tab of its task, a new one, each
// other screen tab, a new one. Pure; Vitest: move-choices.test.ts.
import type { Side } from "./arrange";

/** Where a panel (or a task, by its strip) can be moved to: work.ts's Moves, its other panels of any kind. */
export interface MovesOf<N> {
  sides: Side[];
  others: N[];
  task: boolean;
  tabs: { id: string; name: string }[];
  split: boolean;
  screens: { id: string; n: number; name: string }[] | null;
}
/** What each choice does, to the panel the menu is of. */
export interface MoveActs<N> {
  toSide(side: Side): void;
  swapWith(other: N): void;
  toTab(id: string): void;
  toNewTab(): void;
  toScreenTab(id: string | null): void;
}
/** A choice: its mark (an arrow), what it says, what it does. */
export interface MoveChoice {
  mark: string;
  text: string;
  run: () => void;
}

const SIDES: [Side, string, string][] = [
  ["left", "←", "To the left"],
  ["right", "→", "To the right"],
  ["top", "↑", "To the top"],
  ["bottom", "↓", "To the bottom"],
];
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** The choices of a panel's menu, in order; `name`: what another panel is called. */
export function moveChoices<N>(m: MovesOf<N>, name: (other: N) => string, act: MoveActs<N>): MoveChoice[] {
  return [
    ...SIDES.filter(([side]) => m.sides.includes(side)).map(([side, mark, text]) => ({
      mark,
      text,
      run: () => act.toSide(side),
    })),
    ...m.others.map((o) => ({ mark: "⇄", text: `Swap with ${name(o)}`, run: () => act.swapWith(o) })),
    ...m.tabs.map((t) => ({ mark: "⇥", text: `To ${t.name}`, run: () => act.toTab(t.id) })),
    ...(m.split ? [{ mark: "+", text: "To a new tab of this task", run: () => act.toNewTab() }] : []),
    ...(m.screens || []).map((t) => ({
      mark: "⇥",
      text: `To tab ${t.n} · ${cut(t.name, 40)}`,
      run: () => act.toScreenTab(t.id),
    })),
    ...(m.screens ? [{ mark: "+", text: "To a new tab", run: () => act.toScreenTab(null) }] : []),
  ];
}
/** The menu's heading: a task moved (its strip, or its only panel's head), else a panel. */
export const moveHead = (m: { task: boolean } | null): string => (m?.task ? "Move this task" : "Move this panel");
/** A name for a menu, cut short to `n` characters. */
export const short = (t: string, n = 48): string => cut(t, n);
