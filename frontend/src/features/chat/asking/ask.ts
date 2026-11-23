// What the agent waits on the user for, and the model call it stopped on, as the home has them (data.py's `asking`,
// `answer`, `failing`, `stopped`): read the same wherever they show -- Chat's cards (Cards.tsx), the other views' (the
// old page's chatCard, through mount.tsx), a panel told of its actor (features/layout/app-hooks.ts).
import type { Answered, Ask, AskSays, Failing, Home, Session, Stopped } from "../../../core/api/types";
import type { Actor } from "../types";

// What the home says an actor asks, the answer sent from here, its calls failing and the call its turn stopped on, as
// generated from the server's schema (core/api/types.ts).
export type { Ask, AskOption, AskQuestion, AskSays, Failing } from "../../../core/api/types";
/** An answer sent from here (data.py's `answer`): what it was, when, and -- once recorded -- whether as picked. */
export type Answer = Answered;
/** The model call the turn stopped on (data.py's `stopped`), as the harness put it. */
export type StoppedCall = Stopped;

const SAYS: AskSays = {
  plan_verb: "approve",
  plan_choices: [],
  plan_change: { label: "Or say what to change", title: null },
  own_answer: "Or type your own answer",
};

/** The harness `h`, as the home describes it. */
const harnessOf = (home: Home | null, h: string | null | undefined) => (h && home?.harness_info?.[h]) || null;

/** A harness's name, as the page says it. */
export const harnessName = (home: Home | null, h: string | null | undefined): string =>
  harnessOf(home, h)?.label || "Unknown harness";

/** Who asks: the actor's harness, by name. */
export const whoAsks = (home: Home | null, info: Actor): string =>
  info.harness ? harnessName(home, info.harness) : "The agent";

/** How the harness that asks has it answered. */
export const askSays = (home: Home | null, ask: Ask): AskSays => ({
  ...SAYS,
  ...(harnessOf(home, ask.harness || home?.harness_default)?.ask_says || {}),
});

/** What the actor asks now: while it asks -- or, a question asked as it works, while it runs. Null otherwise. */
export const askOf = (info: Actor | null | undefined): Ask | null =>
  info && (info.status === "asking" || (info.status === "running" && !!info.asking?.async))
    ? info.asking || null
    : null;

/** What an answer names an ask by (data.py's `id`): a question's or a plan's call, a permission's own key. */
export const askKey = (ask: Ask): string => ask.id || ask.call || "";

/**
 * Where what an actor asks is answered: the dashboard's terminal, and nothing typed into it since it asked -- answered
 * from the page (`here`) -- not where its terminal was opened again since and its harness does not ask again
 * (`asks_shown_again`): no dialog there to type into. A dialog no hook reported: in its terminal only.
 */
export function askWhere(info: Actor, ask: Ask, home: Home | null, snapshot: boolean) {
  const s: Partial<Session> = info.session || {};
  const touched = !!(s.terminal && s.typed && ask.at != null && s.typed >= ask.at);
  const reopened = !!(
    s.terminal &&
    s.since &&
    ask.at &&
    s.since > ask.at &&
    harnessOf(home, ask.harness || info.harness)?.asks_shown_again === false
  );
  return { touched, reopened, here: !snapshot && !!s.terminal && !touched && !reopened };
}

/** Seconds after an answer is sent before it counts as lost. */
export const ANSWER_LATE = 12;

/** Whether an answer sent counts as lost by now; when it will, in the page's milliseconds. */
export const isLate = (sent: Answer): boolean => Date.now() / 1000 - sent.at > ANSWER_LATE;
export const lateAt = (sent: Answer): number => (sent.at + ANSWER_LATE) * 1000;

/** What an error likely means, where its words say: a lookup or a connection that failed, a limit, an overload. */
export function errorHint(f: Failing | null, st: StoppedCall | null): string | null {
  const text = `${f?.error || ""} ${st?.text || ""}`;
  const status = f?.status || st?.status;
  if (/nodename nor servname|Name or service not known|Temporary failure in name resolution|getaddrinfo/i.test(text))
    return "Couldn't resolve the endpoint's address (DNS). Check the network connection.";
  if (/Connection refused|Connect call failed|ECONNREFUSED|Cannot connect to host 127\.0\.0\.1/i.test(text))
    return "Nothing is listening at the endpoint's address.";
  if (status === 429 || /rate.?limit/i.test(text)) return "Rate limited. The harness will retry.";
  if (status === 529 || /overloaded/i.test(text)) return "The model's service is overloaded.";
  if (status === 401 || status === 403) return "Not authorized. The harness may need to log in again.";
  return null;
}

/** Which card shows for the actor, if any: the call it stopped on or keeps failing on, else what it asks, else an answer
 * recorded otherwise than picked (`seen`: those dismissed). */
export type CardKind = "error" | "asking" | "answered";

export function cardOf(info: Actor | null | undefined, seen: ReadonlySet<string>): CardKind | null {
  if (!info) return null;
  const over = info.status === "error";
  if ((over || info.status === "running") && info.failing) return "error";
  if (over && info.stopped) return "error";
  if (askOf(info)) return "asking";
  const a = info.answer;
  if (a && a.recorded === false && info.status !== "asking" && !seen.has(a.call ?? "")) return "answered";
  return null;
}
