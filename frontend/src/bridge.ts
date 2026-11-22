// What the page's tests, and a reader at the console, reach as `window.agNext`: the page's stream (streams.spec.ts) and
// its markdown (app-links.spec.ts, notes-links.spec.ts). The old page's modules (page.js's, plain JS) import the new
// code directly, ES modules as they are since A3b (ag_dashboard/DESIGN.md); they hand back `window.agLegacy`, what the
// new code calls of them. Imported first (main.ts), and with it the new modules whose stylesheets came before the old
// page's (the Apps page's, the apps' panels', the work area's): the styles cascade as they did.
import "./features/apps/catalog";
import "./features/apps/host";
import "./features/layout/work";
import { stream } from "./core/api/stream";
import { markdown } from "./core/ui/md";

/** What the old page gives the new code (src/features/settings/panel.js). */
export interface AgLegacy {
  /** The dashboard's panel opened or closed. */
  setAbout: (open: boolean) => void;
  /** The page is a snapshot (its data inside it): it has no ag's settings. */
  snapshot: boolean;
}

const agNext = Object.freeze({
  /** A stream of the dashboard's, as `new EventSource(url)`, on the page's one WebSocket (core/api/stream.ts). */
  stream,
  ui: Object.freeze({ markdown }),
});

declare global {
  interface Window {
    agNext: typeof agNext;
    agLegacy?: AgLegacy;
  }
}

window.agNext = agNext;
