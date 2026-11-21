// THE TOP BAR'S COUNTS (#top-totals), beside its logo, whatever shape the list is in: every shown group's actors open,
// counted by what they do -- waiting for the reader, stopped on an error, apps notified, running (the logo's dots going
// round, as on a list row), running only in the background, finished and not yet seen -- each a mark and a number, none
// for a state no actor is in. Idle actors need nothing, so they are counted only in the bar's one tooltip, which names
// every count; shown only when nothing else is (the bar keeps something to point at, which slides a hidden list out).
import type { Totals } from "./groups";
import { useSpin } from "./Parts";

/** Each count with any: [how many, its class, what they do]. */
export function totalsSaid(t: Totals): [number, string, string][] {
  const told = t.notified;
  const counts: [number, string, string][] = [
    [t.asking, "asking", "waiting for you"],
    [t.error, "error", "stopped on an error"],
    [
      told,
      "notified",
      told === 1 ? "app with a notification you haven't seen" : "apps with a notification you haven't seen",
    ],
    [t.running, "running", "running"],
    [t.background, "background", "running in the background"],
    [t.finished, "finished", "finished, not yet seen"],
    [t.idle, "idle", "idle"],
  ];
  return counts.filter(([k]) => k);
}

function Count({ k, cls }: { k: number; cls: string }) {
  const spin = useSpin(); // in step with the list's
  return (
    <span className={`count ${cls}`}>
      <i aria-hidden="true" style={cls === "running" ? spin : undefined} />
      {String(k)}
    </span>
  );
}

export function TotalsChips({ t }: { t: Totals }) {
  const counts = totalsSaid(t);
  const needs = counts.filter(([, cls]) => cls !== "idle");
  return (needs.length ? needs : counts).map(([k, cls]) => <Count key={cls} k={k} cls={cls} />);
}
