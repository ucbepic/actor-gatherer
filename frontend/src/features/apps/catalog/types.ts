// The Apps page's data (ag_dashboard/app_catalog.py's catalog), and what the page around it gives it.

/** What "+" on an actor or a task does with an app (ag_dashboard/app_policy.py). */
export type OnTask = "join" | "folder" | "no";

export interface CatalogApp {
  name: string;
  label: string;
  version?: string;
  description: string;
  mark?: boolean;
  /** where it is: "builtin" (comes with ag), "home" (installed), "path" (AG_APPS_PATH), "index", "staged" */
  origin: string;
  kind?: string;
  source?: string;
  commit?: string;
  /** who may use its instances: "task" (the agents in its task) or "group" (every agent of the group) */
  access?: string;
  /** it can be opened with an agent of its own (its manifest's [agent] offered) */
  with_agent?: boolean;
  /** opened, it starts with an agent of its own: the reader's choice here (app_settings.py), yes until they say not */
  opens_with_agent?: boolean;
  /** what "+" on an actor or a task does with it, as chosen; its manifest's own; and those it can take (a group app:
   * not "join") */
  on_task?: OnTask;
  on_task_own?: OnTask;
  on_task_can?: OnTask[];
  instances?: string;
  tools?: string[];
  tokens?: number;
  can?: string[];
  own_process?: boolean;
  schedules?: string[];
  open?: Record<string, number>;
  data?: { path: string; bytes: number; there: boolean };
  failed?: string | null;
  needs?: string;
}

export interface Broken {
  folder: string;
  name: string;
  error: string;
  origin: string;
}

export interface Catalog {
  installed: CatalogApp[];
  available: CatalogApp[];
  broken: Broken[];
  /** the apps the server found added, gone or changed as it read their folders again for this */
  found?: { added: string[]; gone: string[]; changed: string[] };
}

/** An app copied aside and checked by the server, to be installed or discarded. */
export interface Staged extends CatalogApp {
  id: string;
  installed?: CatalogApp;
  changes?: {
    version: string[];
    tools_added: string[];
    tools_gone: string[];
    can_added: string[];
    own_process: boolean;
  };
}

/** An agent's asking to install, update or uninstall an app (ag_dashboard/app_requests.py), as the home lists them. */
export interface AgentRequest {
  id: string;
  actor: string;
  op: "install" | "update" | "uninstall";
  about: CatalogApp;
  args?: { data?: boolean };
}

/** What the page around it gives it. */
export interface PageHooks {
  /** The app opened where things start (a new tab, in its group). */
  open: (app: CatalogApp, withAgent?: boolean) => Promise<void>;
  /** The apps installed changed: the page reads them again, closes the panels of those gone. */
  changed: () => Promise<void>;
  /** A folder shown in the computer's file manager. */
  reveal?: (folder: string) => void;
}
