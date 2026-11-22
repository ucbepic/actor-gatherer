// The list's derivations (tasks.ts, status.ts) bound to the page's home (list.ts's CTX), by the names and arguments the
// old page's modules call them with.
import { CTX } from "./list";
import * as LS from "./status";
import * as LK from "./tasks";
import type { Actor, AppItem, Gatherer, Status, Task } from "./types";

export const taskById = (gname: string, id: number | null | undefined): Task | null => LK.taskById(CTX, gname, id);
export const taskOf = (gname: string, a: Actor): number | null => LK.taskOf(CTX, gname, a);
export const appTaskOf = (gname: string, id: string): number | null => LK.appTaskOf(CTX, gname, id);
export const taskMembers = (g: Gatherer, id: number): Actor[] => LK.taskMembers(CTX, g, id);
export const taskActors = (g: Gatherer, id: number): Actor[] => LK.taskActors(CTX, g, id);
export const taskLead = (g: Gatherer, id: number): Actor | null => LK.taskLead(CTX, g, id);
export const taskApps = (g: Gatherer, id: number): AppItem[] => LK.taskApps(CTX, g, id);
export const taskName = (g: Gatherer, t: Task): string => LK.taskName(CTX, g, t);
export const appStatusOf = (gname: string, id: string): Status | null => LS.appStatusOf(CTX, gname, id);
