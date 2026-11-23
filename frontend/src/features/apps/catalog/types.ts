// The Apps page's data (ag_dashboard/app_catalog.py's catalog: its types generated from the server's schema,
// core/api/types.ts), and what the page around it gives it.
import type { AppRequest, CatalogApp } from "../../../core/api/types";

// An app as the page shows it -- installed, one it can install, one staged, or as an agent's request names it -- and the
// catalog, as generated from the server's schema (core/api/types.ts).
export type { Broken, Catalog, CatalogApp, OnTask, Staged } from "../../../core/api/types";

/** An agent's asking to install, update or uninstall an app (ag_dashboard/app_requests.py), as the home lists them. */
export type AgentRequest = AppRequest;

/** What the page around it gives it. */
export interface PageHooks {
  /** The app opened where things start (a new tab, in its group). */
  open: (app: CatalogApp, withAgent?: boolean) => Promise<void>;
  /** The apps installed changed: the page reads them again, closes the panels of those gone. */
  changed: () => Promise<void>;
  /** A folder shown in the computer's file manager. */
  reveal?: (folder: string) => void;
}
