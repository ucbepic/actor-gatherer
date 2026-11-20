// The Messages view: the session's events, one row each -- the same rows as the context card's -- filtered by the types
// shown (the chips, in the pane's head), counted; then what waits for the turn to end.
import { itemType, useShown } from "../../core/model/items";
import { Columns, ContextItem } from "./Context";
import { rowKey, tally } from "./model";
import type { Item } from "./types";

/** What the page hands the view for the actor it shows. */
export interface MsgFrame {
  /** the actor's */
  key: string;
  items: Item[];
  pending: Item[];
  /** what waits for the turn to end */
  queued: string[];
  /** said when there is nothing, nothing pending and nothing waiting */
  noneYet: string;
}

/** The view's rows, in its frame (`div.chat-frame.ctx`: mount.tsx). */
export function Messages({ f }: { f: MsgFrame }) {
  const shown = useShown((s) => s.types);
  const items = [...f.items, ...f.pending].map((i) => ({ ...i, group: "Recent history" }));
  const listed = items.filter((it) => shown.has(itemType(it)[0]));
  const count = (all: Item[]) => all.reduce((n, i) => n + i.tokens, 0);
  return (
    <>
      <Columns />
      <div className="run">
        <strong>Messages</strong>
        <span>{tally(items.length, listed.length, count(items), count(listed), "message")}</span>
      </div>
      {listed.map((it, i) => (
        // a stored event by its row, kept while it is the same; one pending by where it is
        <ContextItem
          key={rowKey(it.row_id === null || it.row_id === undefined ? `p${i}` : `r${it.row_id}`, it)}
          it={it}
        />
      ))}
      {f.queued.map((q, i) => (
        <div key={`q${i}`} className="queued">{`Waiting for the turn to end: ${q}`}</div>
      ))}
      {!items.length && !f.queued.length ? <div className="desc">{f.noneYet}</div> : null}
    </>
  );
}
