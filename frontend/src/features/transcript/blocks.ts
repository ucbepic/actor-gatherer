// The transcript's blocks, in order, worked out apart from drawing them: messages as they are; each stretch of tool
// calls between two of them as Claude Code shows it -- a line for each call, its last RUN_SHOWN listed and the earlier
// ones behind "+N more", each result drawn with its call wherever it was stored; thinking a folded line of its own; the
// harness's system messages and ag's notes, between them, if shown. Each block keyed by what it is, so it stays the same
// element from one draw to the next.
import type { Part, TranscriptItem } from "../../core/api/types";

/** A part of an event (data.py's `parts`: every harness's events made the same parts), as generated from the server's
 * schema (core/api/types.ts). */
export type { Part } from "../../core/api/types";

/** An event, as the transcript feed has it: stored (its row), or pending (none). */
export type TxItem = TranscriptItem;

export interface Note {
  id: string;
  name: string;
  text: string;
}

/** A call's line in a stretch: its result, if it has come; at work, if it is the actor's latest and it runs. */
export type Line =
  | { kind: "call"; key: string; id: string; part: Part; result: Part | null; running: boolean }
  | { kind: "think"; key: string; id: string; text: string };

export type TxBlock =
  | Line
  | { kind: "user"; key: string; text: string }
  | { kind: "text"; key: string; text: string }
  | { kind: "result"; key: string; id: string; text: string; error: boolean }
  | { kind: "notes"; key: string; id: string; notes: Note[] }
  | { kind: "more"; key: string; id: string; lines: Line[] };

/** a stretch's last calls listed; the earlier ones behind "+N more" */
const RUN_SHOWN = 5;

export function transcriptBlocks(items: TxItem[], running: boolean, showNotes: boolean): TxBlock[] {
  const results = new Map<string, Part>();
  for (const it of items) for (const p of it.parts) if (p.kind === "result" && p.id) results.set(p.id, p);
  const calls = new Set(items.flatMap((it) => it.parts.filter((p) => p.kind === "call" && p.id).map((p) => p.id!)));
  const out: TxBlock[] = [];
  let notes: Note[] = [],
    run: { part: Part; id: string }[] = [];
  const flushNotes = () => {
    if (!notes.length) return;
    const id = `tx-n-${notes[0].id}`;
    out.push({ kind: "notes", key: id, id, notes });
    notes = [];
  };
  const flushRun = (last = false) => {
    if (!run.length) return;
    if (run.some((x) => x.part.kind === "call")) {
      const lines = run.map(({ part, id }): Line => {
        if (part.kind !== "call") return { kind: "think", key: id, id, text: part.text ?? "" };
        const result = part.id ? results.get(part.id) || null : null;
        return { kind: "call", key: `${id}-l`, id, part, result, running: running && last };
      });
      if (lines.length <= RUN_SHOWN + 1) out.push(...lines);
      else {
        const id = `${run[0].id}-more`;
        out.push({ kind: "more", key: id, id, lines: lines.slice(0, lines.length - RUN_SHOWN) });
        out.push(...lines.slice(-RUN_SHOWN));
      }
    } else for (const { part, id } of run) out.push({ kind: "think", key: id, id, text: part.text ?? "" });
    run = [];
  };
  items.forEach((it, n) => {
    const base = it.row_id !== null ? `r${it.row_id}` : `p${n}`;
    it.parts.forEach((p, j) => {
      const id = `tx-${base}-${j}`;
      const isNote = p.kind === "note" || (p.kind === "text" && p.role === "system");
      if (isNote) {
        if (showNotes) notes.push({ id, name: p.name || "system", text: p.text ?? "" });
        return;
      }
      if (p.kind === "call" || (p.kind === "thinking" && (p.text ?? "").trim())) {
        flushNotes();
        run.push({ part: p, id });
        return;
      }
      if (p.kind === "thinking" || (p.kind === "result" && p.id && calls.has(p.id))) return; // encrypted; or with its call
      flushRun();
      flushNotes();
      if (p.kind === "text" && p.role === "user") out.push({ kind: "user", key: id, text: p.text ?? "" });
      else if (p.kind === "text") out.push({ kind: "text", key: id, text: p.text ?? "" });
      else if (p.kind === "result")
        // its call is not loaded: shown alone
        out.push({ kind: "result", key: id, id, text: p.text ?? "", error: !!p.error });
    });
  });
  flushRun(true);
  flushNotes();
  return out;
}
