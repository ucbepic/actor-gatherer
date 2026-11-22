// WHAT THE TERMINAL TAKES FROM THE PAGE AROUND IT, beyond what a session's terminal asks of it (term.ts's TermHost): its
// view added among the panes' views (Chat's registry), whether an actor can be messaged here and why not, and -- for a
// shell's pane -- the panes, the page's selection, the list's gatherers and how a shell ends. src/links/terminal.ts fills
// it before any module starts; a feature's TypeScript may not import another feature (ag_dashboard/DESIGN.md's Rules).
import type { Home } from "../../core/api/types";
import type { TermActor } from "./term";

/** A pane, as far as the terminal reads it: its actor (`c`, a session or a shell), and its head's controls. */
export interface TermPane {
  readonly c: string | null;
  readonly controls: HTMLElement;
}

/** A group of actors, as the list has it. */
export interface TermGroup {
  name: string;
  agents: { channel: string }[];
}

/** What the Terminal view draws with, for the pane being drawn (Chat's view context, as far as it reads it). */
export interface TermViewCtx {
  actor: string;
  info: TermActor & { cwd?: string | null };
  held: string;
}

/** The Terminal view, as it is added (Chat's views.ts). */
export interface TermView {
  id: string;
  name: string;
  feed: "none";
  frame: string;
  icon: string;
  description: string;
  render(): Node[];
  mount(ctx: TermViewCtx): Node;
  composer(): Node[];
}

export interface TermPage {
  readonly snapshot: boolean;
  readonly icons: Readonly<Record<string, string>>;
  home(): (Home & { terminals?: boolean }) | null;
  /** a view added among the panes' views */
  addView(view: TermView): void;
  /** the actor can be messaged from here at all; why not, said as everywhere */
  hasChat(a: TermActor): boolean;
  readOnlyWhy(): string;

  // a shell's pane gone (shell.ts's shownGone): the panes beside the page's own, closed; the page's own's actor, given
  // the next pane's, or shown another
  others(): TermPane[];
  closePane(p: TermPane): void;
  closeHere(): void;
  /** the page's own pane's actor: [group, id] */
  selected(): readonly [string, string] | null;
  clearSelected(): void;
  /** the groups the list shows (not hidden) with an actor, and the first actor of one */
  shownGroups(): TermGroup[];
  firstAgent(g: TermGroup): { channel: string } | undefined;
  select(g: string, c: string): Promise<void>;
  savePanes(): void;
  connect(): void;
  render(now?: boolean): void;
  /** a shell ended, whatever runs in it (the list's ×) */
  closeShell(id: string): Promise<void>;
}

let page: TermPage | null = null;

export function setTermPage(link: TermPage): void {
  page = link;
}

/** The page's parts (there once the page has linked the terminal). */
export function T(): TermPage {
  if (!page) throw new Error("the terminal is linked to the page before it starts (src/links/terminal.ts)");
  return page;
}
