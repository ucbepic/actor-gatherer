// The settings panel (features/settings/) linked to the page's shell: the panel opened or closed, and the page's stream
// and its place kept in a pane's draw, which the old page's modules still import from the panel. Called once by page.js
// before any module starts.
import { setSettingsLink } from "../features/settings/link";
import { setAbout } from "../features/page/look";
import { keepingPlace } from "../features/page/place";
import { connect, streamTake } from "../features/page/stream";

/** The settings panel handed what it takes of the page's shell. */
export function linkSettings(): void {
  setSettingsLink({ setAbout, connect, streamTake, keepingPlace });
}
