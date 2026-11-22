// WHAT THE SETTINGS PANEL TAKES FROM THE PAGE'S SHELL (features/page/), which a feature's TypeScript may not import
// (ag_dashboard/DESIGN.md's Rules): the panel opened or closed, and the page's stream and its place kept in a pane's draw,
// which the old page's modules still import from here (panel.ts). src/links/settings.ts hands them over as the page
// starts, before any module starts.
import type { At, Pane } from "../../core/page/types";

export interface SettingsLink {
  /** the dashboard's panel opened or closed */
  setAbout(open: boolean): void;
  /** the page's stream opened again (features/page/stream.ts) */
  connect(): void;
  /** a message of the stream taken, in order */
  streamTake(name: string, data: string, mine?: () => boolean, sel?: At | null): void;
  /** `draw` run for pane `p`, the reader's place in it kept (features/page/place.ts) */
  keepingPlace(draw: () => void, p?: Pane): void;
}

export let link: SettingsLink = null as unknown as SettingsLink;
export function setSettingsLink(l: SettingsLink): void {
  link = l;
}
