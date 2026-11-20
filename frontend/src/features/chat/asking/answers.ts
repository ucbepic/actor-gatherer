// The reader's answers as they make them, by what they answer (ask.ts's askKey): the options picked and the words typed
// for each question, what to change in a plan (or to do instead of a permission), the question shown, and the answer on
// its way (`sending`) or why it was not taken (`error`) -- kept across draws and views, as long as the page is. And the
// answers recorded otherwise than picked that the reader dismissed (`seen`). Every change is an action here: the cards
// (Cards.tsx) only draw and call.
import { create } from "zustand";
import { post } from "../../../core/api/client";
import { askKey, type Ask } from "./ask";

export interface Draft {
  /** each question's options picked (their indexes), or the words typed in their place */
  answers: { options: number[]; text: string }[];
  /** a plan's change asked for, or what a permission's agent should do instead */
  change: string;
  sending: boolean;
  error: string;
  /** the question shown, answered one at a time */
  tab: number;
}

interface Answers {
  drafts: ReadonlyMap<string, Draft>;
  seen: ReadonlySet<string>;
}

export const useAnswers = create<Answers>()(() => ({ drafts: new Map(), seen: new Set() }));

const fresh = (ask: Ask): Draft => ({
  answers: (ask.questions || []).map(() => ({ options: [], text: "" })),
  change: "",
  sending: false,
  error: "",
  tab: 0,
});

/** The reader's answer to `ask` so far. */
export const draftOf = (drafts: ReadonlyMap<string, Draft>, ask: Ask): Draft => drafts.get(askKey(ask)) ?? fresh(ask);

function change(ask: Ask, how: (d: Draft) => Partial<Draft>) {
  useAnswers.setState((st) => {
    const d = draftOf(st.drafts, ask);
    return { drafts: new Map(st.drafts).set(askKey(ask), { ...d, ...how(d) }) };
  });
}

/** Whether question `i` has an answer: an option picked, or words typed. */
export const answered = (d: Draft, i: number): boolean =>
  !!(d.answers[i] && (d.answers[i].options.length || d.answers[i].text.trim()));

/** The next question not answered yet, after the one shown (then from the first): -1 if every one is. */
export function nextOpen(d: Draft, count: number, tab: number): number {
  for (let k = 0; k < count; k++) {
    const i = (tab + 1 + k) % count;
    if (!answered(d, i)) return i;
  }
  return -1;
}

/** The question shown, of `count`: the one picked, within those there are. */
export const tabOf = (d: Draft, count: number): number => Math.min(d.tab, Math.max(0, count - 1));

/** Option `j` of question `i` picked (or, `multi`, picked or put back), its words typed cleared; one question of several
 * answered with one pick (`advance`: not one the arrow keys went to), the next one not answered shown, as the terminal's
 * dialog does. */
export function pick(ask: Ask, i: number, j: number, multi: boolean, advance = true) {
  change(ask, (d) => {
    const a = d.answers[i] ?? { options: [], text: "" };
    const options = multi ? (a.options.includes(j) ? a.options.filter((x) => x !== j) : [...a.options, j]) : [j];
    const answers = d.answers.map((x, k) => (k === i ? { options, text: "" } : x));
    const count = (ask.questions || []).length;
    const next = { ...d, answers };
    const n = !multi && advance && count > 1 ? nextOpen(next, count, tabOf(next, count)) : -1;
    return n >= 0 ? { answers, tab: n } : { answers };
  });
}

/** Words typed as question `i`'s answer: in place of the options picked. */
export const type = (ask: Ask, i: number, text: string) =>
  change(ask, (d) => ({
    answers: d.answers.map((x, k) => (k === i ? { options: text ? [] : x.options, text } : x)),
  }));

/** What to change in the plan, or to do instead, as typed. */
export const typeChange = (ask: Ask, text: string) => change(ask, () => ({ change: text }));

/** Question `tab` shown. */
export const show = (ask: Ask, tab: number) => change(ask, () => ({ tab }));

/** The answers, as the server takes them: each question's words typed, else its options picked. */
export const choiceOf = (d: Draft) => ({
  answers: d.answers.map((a) => (a.text.trim() ? { text: a.text.trim() } : { options: a.options })),
});

/**
 * `choice` sent as the answer to `ask` (POST /api/answer: typed into the session's terminal, sessions.py's `answer`),
 * then the page's data loaded again (`after`); the card says it is on its way, and why, if it was not taken.
 */
export async function answer(ask: Ask, session: string | null | undefined, choice: unknown, after: () => unknown) {
  change(ask, () => ({ sending: true, error: "" }));
  try {
    await post("/api/answer", { session_id: session, id: askKey(ask), call: ask.call, choice });
    await after();
  } catch (err) {
    change(ask, () => ({ error: `Not answered: ${(err as Error).message}` }));
  } finally {
    change(ask, () => ({ sending: false }));
  }
}

/** An answer recorded otherwise than picked, dismissed: its card shows no more. */
export const dismiss = (call: string) => useAnswers.setState((st) => ({ seen: new Set(st.seen).add(call) }));
