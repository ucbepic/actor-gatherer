// The Terminal view: the session in its harness's own UI, xterm.js's (term.ts), in the view's frame, and over it while
// its terminal does not run, why -- opening, ended, failed (with "Open again"), or why it cannot be messaged here.
// Showing a session in the view opens its terminal, once each time the session is chosen: one that exits or fails to
// open is not opened again until asked.

/** What the page hands the view for the actor it shows. */
export interface TermFrame {
  /** the actor's */
  key: string;
  /** this system has no pseudo-terminals */
  none: boolean;
  /** its terminal runs */
  running: boolean;
  /** why it cannot be messaged here: another process has it open, or the dashboard cannot run it */
  held: string;
  readOnly: string;
  /** how its terminal went: ended (its code), or did not open (why) */
  exited: number | null;
  error: string;
  open(): unknown;
}

/** What covers the terminal while it does not run (none while it does). */
export function Cover({ f }: { f: TermFrame }) {
  if (f.none)
    return (
      <div className="xterm-cover">
        <div className="desc">Terminals need a Unix pseudo-terminal, which this system doesn&apos;t have.</div>
      </div>
    );
  if (f.running) return null;
  const why = f.held || f.readOnly;
  return (
    <div className="xterm-cover">
      <div className="desc">
        {why ||
          (f.exited !== null
            ? "The session's process ended."
            : f.error
              ? "The terminal did not open."
              : "Opening the terminal…")}
      </div>
      {why || (!f.error && f.exited === null) ? null : (
        <button type="button" className="primary" onClick={() => f.open()}>
          Open again
        </button>
      )}
      {f.error ? <div className="err">{f.error}</div> : null}
    </div>
  );
}
