// A minimized pane's two lines, right of its message box (the layout's minimized view, features/layout/top.js's
// MINI_VIEW, puts them in its footer): the user's last message, and what the actor does now -- or, its turn over, the
// first line of what it said last -- by its avatar, small and still, at work in its own ink (as Chat's "Working…").
// Hovering either shows the whole conversation in a card over what is above the pane (card.ts); pressing one shows the
// chat again (⌘: its files and commands too). React's: one root for each pane, the lines' box itself (.mini-hist), the
// same node from draw to draw; a line kept while it shows the same, drawn anew when it changes (as the old page's patch()
// had it: what the card's race with a line drawn anew is about). Its pointer and focus heard as the browser says them,
// not through React's own (which hears an element entered from another root's node -- the card -- not at all). A pane
// too narrow for the lines shows none (features/layout/top.css).
import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { HUE_INK } from "../../../core/ui/stage/model";
import type { Pane } from "../link";
import { useHot, miniCard } from "./card";
import { lineSig, linesOf, restOf, type Line } from "./model";
import { Ago, Icon, miniOf, openAt, Part, Since, type KeyedActor } from "./parts";

function Row({ line, info, pane }: { line: Line; info: KeyedActor; pane: Pane }) {
  const kind = line.kind.split(" ")[0];
  const hot = useHot((s) => s.pane === pane && s.kind === kind);
  const row = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const r = row.current!;
    const on: [string, (ev: Event) => void][] = [
      ["mouseenter", () => miniCard.hover(r)],
      ["mouseleave", () => miniCard.leave()],
      ["focus", () => miniCard.open(r, true)],
      ["blur", () => miniCard.leave()],
      [
        "click",
        (ev) => {
          miniCard.shut();
          openAt(pane, null, (ev as MouseEvent).metaKey || (ev as MouseEvent).ctrlKey);
        },
      ],
    ];
    for (const [type, f] of on) r.addEventListener(type, f);
    return () => {
      for (const [type, f] of on) r.removeEventListener(type, f);
    };
  }, [pane]);
  return (
    <button
      ref={row}
      type="button"
      className={`mh-row ${line.kind}${line.extra}${hot ? " hot" : ""}`}
      data-kind={kind}
      title="Hover to see the conversation · click to open the chat"
    >
      <Icon icon={line.icon} info={info} />
      <span className="tx">
        {line.text.map((part, i) => (
          <Part key={i} part={part} />
        ))}
      </span>
      <span className="meta">
        {line.since ? <Since t={line.since} className="dur" /> : line.ago ? <Ago t={line.ago} /> : null}
      </span>
    </button>
  );
}

const boxes = new WeakMap<Pane, { node: HTMLDivElement; root: Root }>();

/** The lines of a minimized pane (`pane`) for its actor (`info`; `running`, as the list has it): their box, drawn now,
 * for the minimized view to put right of its box; null with none to show (the card shut then). */
export function miniHistory({
  pane,
  info,
  running,
}: {
  pane: Pane;
  info: KeyedActor;
  running: boolean;
}): HTMLDivElement | null {
  const lines = linesOf(miniOf(pane, info, running));
  if (!lines) {
    miniCard.shut();
    return null;
  }
  let box = boxes.get(pane);
  if (!box) {
    const node = document.createElement("div");
    node.className = "mini-hist";
    node.setAttribute("role", "group");
    node.setAttribute("aria-label", "Latest messages");
    box = { node, root: createRoot(node) };
    boxes.set(pane, box);
  }
  const ink = info.avatar_hue ? HUE_INK[info.avatar_hue] : null;
  if (ink) box.node.style.setProperty("--mh-ink", `light-dark(${ink[0]}, ${ink[1]})`);
  else box.node.style.removeProperty("--mh-ink");
  const { root } = box;
  flushSync(() =>
    root.render(
      <>
        {lines.map((l) => (
          <Row key={lineSig(l)} line={l} info={info} pane={pane} />
        ))}
      </>,
    ),
  );
  miniCard.drawn(pane, info);
  return box.node;
}

/** The latest turn of pane `pane`'s actor, if it is over as Chat shows it (its avatar's check; model.ts's restOf). */
export const miniRest = ({ pane, info, running }: { pane: Pane; info: KeyedActor; running: boolean }) =>
  restOf(miniOf(pane, info, running));
