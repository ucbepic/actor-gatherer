// ------------------------------------------------------------------ ag's settings ag's config.toml (settings.py):
// drawn by AgSettings.tsx (mount.tsx) at the top of the dashboard's panel, on a live page; what it calls of the page,
// through this module's link: the panel opened or closed. The page's stream and its place kept in a pane's draw are the
// page's shell's (features/page/stream.ts, place.ts); the old page's modules that import them from here (the panes, a
// shell's pane, the list) reach them through this module's link till they move.
import type { At, Pane } from "../../core/page/types";
import { SNAPSHOT } from "../../core/page/state";
import { link } from "./link";
import { mountSettings } from "./mount";

/** The page's node with id `id`. */
export const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
/** The page's stream opened again: for the actor of its own pane and the other panes'. */
export const connect = (): void => link.connect();
/** A message of the page's stream taken, in order. */
export const streamTake = (name: string, data: string, mine?: () => boolean, sel?: At | null): void =>
  link.streamTake(name, data, mine, sel);
/** `draw` run for pane `p` (the page's own, by default), the reader's place in it kept. */
export const keepingPlace = (draw: () => void, p?: Pane): void => link.keepingPlace(draw, p);

/** ag's own settings drawn into the panel's `#cfg` -- not in a snapshot, which has none: main.ts calls it once every
 * module has started. */
export function mountAgSettings(): void {
  const cfg = document.getElementById("cfg");
  if (cfg && !SNAPSHOT) mountSettings(cfg, { open: () => link.setAbout(true), close: () => link.setAbout(false) });
}
