// What the harness still runs in the background for the actor (data.py's `background`): the commands, agents, monitors
// and workflows it started and has not been told have ended, each with what it is for and its last sign of life. Under a
// view's frame in the card (card.tsx); in the Transcript as a terminal's status line; and, as a node of its own, for the
// views of the reader's own (agDashboard.backgroundNote).
import { ago, plural } from "../../core/format";
import { nodeOf } from "../../core/ui/node";
import { TASK_KINDS } from "./side/marks";
import type { Task } from "./side/Side";
import type { Actor } from "./types";

const tasksOf = (info: Actor | null | undefined): Task[] => ((info && info.background) || []) as Task[];

/** A task's last sign of life: when it started, then its last event, or when it was last active. */
export function taskWhen(t: Task): string {
  const started = t.started === undefined ? NaN : (t.started ?? 0); // (as the server's numbers subtract)
  const last = t.event
    ? `last event ${ago(t.event_at)}: ${t.event}`
    : t.active && t.active - started > 2
      ? `active ${ago(t.active)}`
      : null;
  return [`started ${ago(t.started)}`, last].filter(Boolean).join(" · ");
}

function Tasks({ info, tasks }: { info: Actor; tasks: Task[] }) {
  return (
    <>
      <div className="head">
        <span className="mark" aria-hidden="true" />
        {`${plural(tasks.length, "background task")} running${info.status === "background" ? " after the turn ended" : ""}`}
      </div>
      {tasks.map((t, i) => (
        <div key={`${t.id}\u0000${i}`} className="task" title={[t.label, t.output].filter(Boolean).join("\n")}>
          <span className="kind">{TASK_KINDS[t.kind] || t.kind}</span>
          <span className="label">{t.label || t.id}</span>
          <span className="when">{taskWhen(t)}</span>
        </div>
      ))}
    </>
  );
}

const boxClass = (term: boolean) => (term ? "status-line bg-tasks" : "bg-tasks");

/** The tasks, in their box; none while none runs. `term`: drawn as a terminal's status line. */
export function BackgroundNote({ info, term = false }: { info: Actor; term?: boolean }) {
  const tasks = tasksOf(info);
  if (!tasks.length) return null;
  return (
    <div className={boxClass(term)} role="status">
      <Tasks info={info} tasks={tasks} />
    </div>
  );
}

/** The same, as a node of its own; null while none runs. */
export function backgroundNote(info: Actor | null | undefined, term = false): HTMLDivElement | null {
  const tasks = tasksOf(info);
  if (!info || !tasks.length) return null;
  return nodeOf("div", { class: boxClass(term), role: "status" }, <Tasks info={info} tasks={tasks} />);
}
