// A MESSAGE BETWEEN ACTORS (coordination.py's `envelope`), typed into the receiver's terminal: its first line who it is
// from -- a coordinator agent, or another actor (its id, its name as JSON) -- and how to answer, then a blank line, then
// the message (or, as the list has it, its lines made one). Or the news of a watch the actor asked for
// (coordination.py's `update`, UPDATE): which actor is done, and how, then what it was asked and said. Chat draws one
// with its sender's avatar and name (features/chat/Bubble.tsx); the list, as a line (crewLine). Its patterns are
// coordination.py's (test_dashboard_coordination.py checks).

// prettier-ignore
const ENVELOPE = /^Message from (the (?:gatherer|coordinator) agent(?: over (everything|"(?:[^"\\]|\\.)*"))?|actor ([\w-]+)(?:, ("(?:[^"\\]|\\.)*"))?)(?: \(answer it with: (?:ag actors send ([\w-]+) )?[^\n]*?\))?:\s+([\s\S]*)$/;
// prettier-ignore
const UPDATE = /^Update \(you asked with `ag actors when`, watch (\d+)\): actor ([\w-]+)(?: \(("(?:[^"\\]|\\.)*")\))? is done: ([^\n]*?)\.(?:\s+([\s\S]*))?$/;
/** coordination.py's ALIASES: a coordinator agent's that names no id to answer to */
const CREW_ALIASES = ["gatherer", "gatherer-agent", "coordinator"];

/** A message read: who it is from, and its words; a watch's news, which actor is done, and how. */
export type Envelope =
  | { from: "update"; id: string; name: string | null; how: string; watch: number; text: string }
  | { from: "coordinator"; id: string | null; name: null; over: string | null; text: string }
  | { from: "actor"; id: string | null; name: string | null; text: string };

/** The message `text` read, or null: neither a message from another actor nor a watch's news. */
export function envelope(text: unknown): Envelope | null {
  const s = String(text ?? "");
  const named = (raw: string | undefined): string | null => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  let m = UPDATE.exec(s);
  if (m) return { from: "update", id: m[2], name: named(m[3]), how: m[4], watch: +m[1], text: m[5] || "" };
  m = ENVELOPE.exec(s);
  if (!m) return null;
  if (m[1].startsWith("the ")) {
    // a coordinator agent's: the node it is over, and its id to answer to
    const over = m[2] && m[2] !== "everything" ? named(m[2]) : m[2] || null;
    const reply = m[5] && !CREW_ALIASES.includes(m[5].toLowerCase()) ? m[5] : null;
    return { from: "coordinator", id: reply, name: null, over, text: m[6] };
  }
  return { from: "actor", id: m[3] || null, name: named(m[4]), text: m[6] };
}

/** An actor's id as a label shows it: its first characters (messages name ids whole, for the actors to answer by). */
export const crewId = (id: unknown): string => String(id || "").slice(0, 8);

/** A coordinator agent's name (data.py's), after the node its messages say it is over: "the Figures coordinator" -- a
 * folder's own name, its path's last part; "the Everything coordinator"; one from before nodes, "the coordinator
 * agent". */
export const crewOverName = (over: string | null | undefined): string =>
  !over
    ? "the coordinator agent"
    : `the ${over === "everything" ? "Everything" : String(over).split("/").pop()} coordinator`;

/** A message in a line (the list's): who it is from, and its words. */
export const crewLine = (env: Envelope): string =>
  env.from === "update"
    ? `${env.name || `Actor ${crewId(env.id)}`} is done: ${env.how}`
    : `${env.from === "coordinator" ? `From ${crewOverName(env.over)}` : `From ${env.name || `actor ${crewId(env.id)}`}`}: ${env.text}`;

/** What an actor was last asked, as the list says it: a message from another actor in a line; null, nothing yet. */
export function askedOf(message: string | null | undefined): string | null {
  const env = envelope(message);
  return env ? crewLine(env) : message || null;
}
