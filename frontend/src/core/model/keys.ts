// What the page keys each thing of the home by: a gatherer's item, `${group}\0${id}` -- the id an actor's channel, an
// app's instance as "app:<its id>", a task of several items as "t<its number>" (features/list/task-acts.ts's TASKS), or a
// shell's "shell:<id>". The list, the rail, the panes and the screen tabs all key by it; read and made here, not by
// hand.

export const SEP = "\u0000";
export const APP = "app:";
export const SHELL = "shell:";
const TASK = /^t(\d+)$/;

export interface Key {
  /** The group (a gatherer's name). */
  group: string;
  /** What in it: a channel, "app:<id>", "t<n>", or "" for a key with none. */
  id: string;
}

/** The key of `id` in `group`. */
export const key = (group: string, id: string): string => group + SEP + id;

/** A key's group and id; a key with no separator is a group's alone (its id ""). */
export function parse(k: string | null | undefined): Key {
  const s = String(k ?? "");
  const at = s.indexOf(SEP);
  return at < 0 ? { group: s, id: "" } : { group: s.slice(0, at), id: s.slice(at + 1) };
}

/** Whether `id` is a task of several items ("t<n>"). */
export const isTask = (id: string | null | undefined): boolean => TASK.test(String(id ?? ""));

/** The task's number of a task's id ("t<n>"); null for any other id. */
export function taskNumber(id: string | null | undefined): number | null {
  const m = TASK.exec(String(id ?? ""));
  return m ? Number(m[1]) : null;
}

/** A task's id, from its number. */
export const taskId = (n: number): string => `t${n}`;

/** Whether `id` is an app's instance ("app:<id>"). */
export const isApp = (id: string | null | undefined): boolean => String(id ?? "").startsWith(APP);

/** The instance's id of an app's item; null for any other id. */
export const appInstance = (id: string | null | undefined): string | null =>
  isApp(id) ? String(id).slice(APP.length) : null;

/** An app instance's item. */
export const appItem = (instance: string): string => APP + instance;

/** Whether `id` is a shell's ("shell:<id>"). */
export const isShell = (id: unknown): boolean => typeof id === "string" && id.startsWith(SHELL);
